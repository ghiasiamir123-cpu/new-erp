import { useEffect, useState } from "react";
import { DocLetterhead, PrintableDoc, faDigits, jLong, jShort } from "../shared/core.jsx";
import { WEEKDAYS, addDays, awayText, dayInfo, round1, toDate, weekStart } from "./planutil.jsx";
import { EVERYONE, choreText, spanText, whoText } from "./planextras.jsx";

/* ============ برنامه‌ریزی تولید — برنامهٔ هر نفر، و کارهای عمومی روی تقویم ============
   سرور می‌گوید هر کس هر روز چند ساعت سرِ کدام کار است (days[].people)، چه کارِ عمومی‌ای در وقتِ بی‌کاری‌اش افتاده
   (days[].fill) و چه کسی کارِ پروژه ندارد (days[].free). اینجا فقط کنارِ هم گذاشتن و نمایش است. */

/** کارهای عمومیِ در جریان یا پیشِ رو، هر کدام با ساعتِ هر روزش. کارِ «در وقتِ بی‌کاری» ساعتش را از خودِ زمان‌بندی
    می‌گیرد (پس با رسیدنِ کارِ پروژه کم می‌شود)؛ کارِ «به‌جای کارِ پروژه» همان است که ثبت شده.
    خروجی: [{ ...ردیف, hoursOn(روز) → ساعتِ هر نفر, peopleOn(روز) → چند نفر, total }] */
export function choreRows(data) {
  const live = Object.fromEntries((data.days || []).map((x) => [x.date, x]));
  const rows = (data.leaves || []).filter((l) => (l.kind === "fill" || l.kind === "general") && l.to >= data.today);
  const got = {};                                                       // شناسهٔ ردیف -> روز -> [ساعت، نفر]
  const auto = {};                                                      // کسی که تیکِ «کار عمومی» دارد: وقتِ خالی‌اش، بی هیچ ردیفی
  (data.days || []).forEach((x) => (x.fill || []).forEach((f) => {
    const day = ((got[f.id] = got[f.id] || {})[x.date] = got[f.id][x.date] || [0, 0]);
    day[0] += f.hours;
    day[1] += 1;
    if (f.auto) auto[f.id] = { id: f.id, employee: f.name, kind: "fill", note: f.note || "کار عمومی", from: data.today, to: "2099-12-31", open: true, hours: null, auto: true };
  }));
  rows.push(...Object.values(auto));
  return rows.map((l) => {
    const must = l.kind === "general";
    const on = (iso) => {
      if (!must) return got[l.id]?.[iso] || [0, 0];
      if (iso < l.from || iso > l.to) return [0, 0];
      const info = dayInfo(data, iso);
      if (info.base <= 0) return [0, 0];
      const n = l.employee === EVERYONE ? data.employees.length - info.leave.length : info.leave.includes(l.employee) ? 0 : 1;
      const each = l.hours ? Math.min(l.hours, info.base) : info.base;
      return n > 0 ? [each * n, n] : [0, 0];
    };
    const total = must ? null : Object.values(got[l.id] || {}).reduce((a, v) => a + v[0], 0);
    return { ...l, must, hoursOn: (iso) => on(iso)[0], peopleOn: (iso) => on(iso)[1], total, known: (iso) => must || !!live[iso] };
  }).sort((a, b) => Number(!!a.auto) - Number(!!b.auto) || Number(b.must) - Number(a.must) || Number(a.open) - Number(b.open)
    || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** کارهای یک نفر در یک روز، برای «برنامهٔ نفرات»: کارِ پروژه (از زمان‌بندی)، کارِ عمومی، مرخصی و وقتِ بی‌کار.
    هر مورد: { cls, title, sub, hours, row? } — row ردیفِ کارِ عمومی است تا با کلیک ویرایش شود. */
export function personDay(data, live, name, iso) {
  const info = dayInfo(data, iso);
  const out = [];
  if (info.base + info.overtime <= 0) return out;
  if (info.leave.includes(name)) return [{ cls: "leave", title: "مرخصی", sub: "کلِ روز", hours: 0 }];
  info.away.filter((a) => a.name === name && a.kind !== "general" && a.hours)
    .forEach((a) => out.push({ cls: "leave", title: "مرخصی", sub: `${faDigits(a.hours)} ساعت`, hours: 0 }));
  const x = live[iso];
  const mine = (x && x.people && x.people[name]) || [];
  // روزی که در محلِ پروژه است: یک مورد برای هر پروژه (کلِ روزش آنجا می‌گذرد، با رفت‌وآمد)
  const there = {};
  mine.filter((i) => i.kind === "site" || i.kind === "sitetime").forEach((i) => {
    const t = (there[i.projectId] = there[i.projectId] || { title: i.project, hours: 0, stages: [] });
    t.hours += i.hours;
    if (i.stage && !t.stages.includes(i.stage)) t.stages.push(i.stage);
  });
  Object.values(there).forEach((t) => out.push({ cls: "site", title: t.title, hours: round1(t.hours),
    sub: `در محلِ پروژه · ${t.stages.join("، ")} · ${faDigits(round1(t.hours))} ساعت` }));
  mine.filter((i) => i.kind !== "site" && i.kind !== "sitetime").forEach((i) => out.push({
    cls: i.kind === "setup" ? "setup" : "job", title: i.project, hours: i.hours,
    sub: `${i.kind === "setup" ? "شست‌وشو و تعویض رنگ · " : ""}${i.stage} · ${faDigits(i.hours)} ساعت${i.role === "lead" ? " · اصلی" : i.role === "help" ? " · کمکی" : ""}`,
  }));
  (data.leaves || []).filter((l) => l.kind === "general" && (l.employee === name || l.employee === EVERYONE) && l.from <= iso && iso <= l.to)
    .forEach((l) => {
      const h = l.hours ? Math.min(l.hours, info.base) : info.base;
      if (h > 0) out.push({ cls: "must", title: l.note || "کار عمومی", hours: h, row: l,
        sub: `واجب · ${l.hours ? `${faDigits(h)} ساعت` : "کلِ روز"}${l.employee === EVERYONE ? " · همهٔ کارگاه" : ""}` });
    });
  let filled = 0;
  ((x && x.fill) || []).filter((f) => f.name === name).forEach((f) => {
    filled += f.hours;
    out.push({ cls: "fill", title: f.note || "کار عمومی", hours: f.hours, sub: `${f.auto ? "وقتِ خالی" : "کارِ مشخص"} · ${faDigits(f.hours)} ساعت`,
      row: (data.leaves || []).find((l) => l.id === f.id) });
  });
  const idle = x ? round1(((x.free && x.free[name]) || 0) * 8 - filled) : 0;
  // وقتِ آزادِ سرکارگر برای سرکشی به کارِ بقیه است
  const boss = (data.foremen || []).includes(name);
  if (idle >= 0.5) out.push({ cls: boss ? "watch" : "idle", title: boss ? "سرکشی به کارِ نفرات" : "بی‌کار", hours: idle,
    sub: `${faDigits(idle)} ساعت کارِ پروژه ندارد` });
  return out;
}

const Item = ({ it, onEdit }) => (
  <div className={`plan-line pp-${it.cls}${it.row && onEdit ? " can" : ""}`}
    onClick={it.row && onEdit ? (e) => { e.stopPropagation(); onEdit(it.row); } : undefined}
    title={it.row && onEdit ? "ویرایشِ این کارِ عمومی" : ""}>
    <b>{it.title}</b>
    <small>{it.sub}</small>
  </div>
);

/** برنامهٔ هفتگیِ نفرات: هر نفر هر روز سرِ کدام کار است، چه کارِ عمومی‌ای دارد و چه وقتی بی‌کار است. با کلیک روی یک
    خانه، همان نفر در همان روز کارِ عمومی می‌گیرد؛ با کلیک روی یک کارِ عمومی، همان ویرایش می‌شود. */
export function PeoplePlan({ data, onChore }) {
  const [from, setFrom] = useState(() => weekStart(data.today));
  const [who, setWho] = useState("");                                    // خالی = همهٔ نفرات
  const [printing, setPrinting] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const live = Object.fromEntries(data.days.map((d) => [d.date, d]));
  const people = data.employees.filter((e) => !who || e === who);
  const skilled = new Set(data.generalPeople || []);
  const masters = new Set(data.masters || []);
  const foremen = new Set(data.foremen || []);
  const canEdit = data.canEdit && !!onChore;
  const sums = (name) => {
    const t = { job: 0, gen: 0, idle: 0, watch: 0 };
    days.forEach((d) => personDay(data, live, name, d).forEach((it) => {
      if (it.cls === "job" || it.cls === "setup" || it.cls === "site") t.job += it.hours;
      else if (it.cls === "must" || it.cls === "fill") t.gen += it.hours;
      else if (it.cls === "idle") t.idle += it.hours;
      else if (it.cls === "watch") t.watch += it.hours;
    }));
    return [t.job && `پروژه ${faDigits(round1(t.job))}`, t.gen && `عمومی ${faDigits(round1(t.gen))}`, t.watch && `سرکشی ${faDigits(round1(t.watch))}`,
      t.idle && `بی‌کار ${faDigits(round1(t.idle))}`]
      .filter(Boolean).join(" · ");
  };
  const head = (d, short) => {
    const info = dayInfo(data, d);
    const off = info.base + info.overtime <= 0;
    return (
      <th key={d} className={`${d === data.today ? "today" : ""}${off ? " off" : ""}`}>
        {WEEKDAYS[toDate(d).getDay()]} <span>{short ? jShort(d).slice(5) : jShort(d)}</span>
        <small>
          {off ? (info.holiday || "تعطیل") : `${faDigits(info.base)} ساعت${info.overtime ? ` + ${faDigits(info.overtime)} اضافه‌کاری` : ""}`}
          {awayText({ everyone: info.everyone })}
        </small>
      </th>
    );
  };
  const tags = (e) => (
    <>
      {foremen.has(e) ? <small className="pp-tag f">سرکارگر</small> : masters.has(e) ? <small className="pp-tag m">استادکار</small> : null}
      {skilled.has(e) ? <small className="pp-tag g">کار عمومی</small> : null}
    </>
  );
  const cellOf = (e, d, edit) => {
    const info = dayInfo(data, d);
    const off = info.base + info.overtime <= 0;
    const open = edit && canEdit && !off && d >= data.today && !masters.has(e);
    const items = d < data.start && d < data.today ? [] : personDay(data, live, e, d);
    return (
      <td key={d} className={`${d === data.today ? "today" : ""}${off ? " off" : ""}${d < data.today ? " past" : ""}${open ? " pp-can" : ""}`}
        title={open ? "کلیک: کارِ عمومیِ مشخص برای این نفر در این روز" : ""}
        onClick={open ? () => onChore({ employee: e, from: d, to: d }) : undefined}>
        {items.map((it, i) => <Item key={i} it={it} onEdit={edit && canEdit ? (row) => onChore({ row }) : null} />)}
      </td>
    );
  };
  const table = (edit, short) => (
    <table className={`plan-grid pp-grid${short ? " wk" : " print-table"}`}>
      <thead><tr><th>نفر</th>{days.map((d) => head(d, short))}</tr></thead>
      <tbody>
        {people.map((e) => (
          <tr key={e}>
            <th>{e}{tags(e)}<small>{sums(e) ? `${sums(e)} ساعت` : ""}</small></th>
            {days.map((d) => cellOf(e, d, edit))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="card plan-bar no-print">
        <button className="ghost" onClick={() => setFrom(addDays(from, -7))}>هفتهٔ قبل ›</button>
        <b style={{ flex: 1, textAlign: "center" }}>{jShort(days[0])} تا {jShort(days[6])}</b>
        <button className="ghost" onClick={() => setFrom(weekStart(data.today))}>این هفته</button>
        <button className="ghost" onClick={() => setFrom(addDays(from, 7))}>‹ هفتهٔ بعد</button>
        <select className="pp-who" value={who} onChange={(e) => setWho(e.target.value)} title="برنامهٔ یک نفر به‌تنهایی">
          <option value="">همهٔ نفرات</option>
          {data.employees.map((e) => <option key={e}>{e}</option>)}
        </select>
        {canEdit && <button className="ghost" title="کارِ عمومیِ مشخص برای یک نفر یا کلِ کارگاه (وقتِ خالیِ کسی که تیکِ «کار عمومی» دارد خودش کارِ عمومی است)"
          onClick={() => onChore(who && !masters.has(who) ? { employee: who } : {})}>+ کارِ عمومیِ مشخص</button>}
        <button className="submit" onClick={() => setPrinting(true)}>{who ? `چاپ / PDF برنامهٔ ${who}` : "چاپ / PDF برنامهٔ نفرات"}</button>
      </div>
      {printing && <PeoplePlanDoc data={data} days={days} who={who} live={live} table={table} onClose={() => setPrinting(false)} />}
      <div className="card table-scroll" style={{ padding: 0 }}>{table(true, false)}</div>
      <div className="muted sm2 pp-legend">
        <span><i className="pp-key job" /> کارِ پروژه</span>
        <span><i className="pp-key site" /> کار در محلِ پروژه</span>
        <span><i className="pp-key fill" /> کارِ عمومی در وقتِ خالی</span>
        <span><i className="pp-key must" /> کارِ عمومیِ واجب (به‌جای کارِ پروژه)</span>
        <span><i className="pp-key idle" /> بی‌کار</span>
        <span><i className="pp-key watch" /> وقتِ آزادِ سرکارگر (سرکشی)</span>
        <span><i className="pp-key leave" /> مرخصی</span>
        <span>ساعت‌ها پیشنهادِ برنامه‌اند و با هر گزارشِ تازه جابه‌جا می‌شوند؛ اینکه میانِ نفراتِ هم‌مهارت چه کسی سرِ کدام کار برود با سرپرست است.</span>
      </div>
    </>
  );
}

/** برنامهٔ هفتگیِ نفرات برای چاپ یا PDF: همه در یک جدول (A4 افقی)، یا برنامهٔ یک نفر روز به روز تا به خودش داده شود. */
function PeoplePlanDoc({ data, days, who, live, table, onClose }) {
  const range = `${jLong(days[0])} تا ${jLong(days[6])}`;
  useEffect(() => {
    const was = document.title;
    document.title = `${who ? `برنامه-${who.replace(/\s+/g, "-")}` : "برنامه-هفتگی-نفرات"}-${jShort(days[0]).replace(/\//g, "-")}`;
    return () => { document.title = was; };
  }, [days, who]);
  return (
    <PrintableDoc onClose={onClose}>
      <style>{`@media print{@page{size:A4 ${who ? "portrait" : "landscape"};margin:9mm}}`}</style>
      <div className={`doc-sheet wk-sheet${who ? "" : " wide"}`}>
        <DocLetterhead title={who ? `برنامهٔ هفتگیِ ${who}` : "برنامهٔ هفتگیِ نفرات کارگاه"} subtitle={range} />
        {!who ? table(false, true) : (
          <table className="plan-grid wk pp-grid pp-one">
            <thead><tr><th>روز</th><th>کارها</th></tr></thead>
            <tbody>
              {days.map((d) => {
                const info = dayInfo(data, d);
                const off = info.base + info.overtime <= 0;
                const items = off || (d < data.start && d < data.today) ? [] : personDay(data, live, who, d);
                return (
                  <tr key={d}>
                    <th className={off ? "off" : ""}>{WEEKDAYS[toDate(d).getDay()]} <span>{jShort(d).slice(5)}</span>
                      <small>{off ? (info.holiday || "تعطیل") : `${faDigits(info.base)} ساعت${info.overtime ? ` + ${faDigits(info.overtime)} اضافه‌کاری` : ""}`}</small>
                    </th>
                    <td className={off ? "off" : ""}>{items.length ? items.map((it, i) => <Item key={i} it={it} />) : off ? "" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="doc-sign">
          <div>سرپرست کارگاه: ......................................</div>
          <div>{who ? `${who}: ......................................` : "مسئول برنامه‌ریزی: ......................................"}</div>
        </div>
        <div className="doc-foot">
          تولیدشده در Diwaj ERP در {jLong(data.today)} · ساعت‌ها پیشنهادِ برنامهٔ همان لحظه‌اند و با هر گزارشِ تازه جابه‌جا می‌شوند
        </div>
      </div>
    </PrintableDoc>
  );
}

export { choreText, spanText, whoText };
