import { useState, useEffect } from "react";
import { productionApi } from "../api.js";
import { JalaliPicker, WhyOff, faDigits, jLong, jShort } from "../shared/core.jsx";
import { num } from "./planutil.jsx";

/* ============ برنامه‌ریزی تولید — پنجره‌ها و بخش‌های تازه ============
   «اگر … چه می‌شود؟»، خرابیِ ایستگاه، دوباره‌کاری، مهارتِ نفرات، رنگ و تعویض رنگ، تاریخچه و برگرداندن، زنجیرهٔ بحرانی و
   موادِ دو هفتهٔ پیشِ رو. منطق همه در backend/core/planning.py است؛ اینجا فقط نمایش و فرم است. */

export function Overlay({ title, busy, onClose, wide, children }) {
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={wide ? "wh-dialog wide" : "wh-dialog"}>
        <div className="board-h">{title}</div>
        {children}
      </div>
    </div>
  );
}

const moved = (n) => (n > 0 ? <b className="wi-good">{faDigits(n)} روز زودتر</b> : n < 0 ? <b className="wi-bad">{faDigits(-n)} روز دیرتر</b> : <span className="muted">بی‌تغییر</span>);
const chips = (rows) => (rows.length === 0 ? <span className="muted">—</span> : rows.map((g) => (
  <span key={g.id} className={g.gain > 0 ? "wi-chip good" : "wi-chip bad"}>{g.label}: {faDigits(Math.abs(g.gain))} روز {g.gain > 0 ? "زودتر" : "دیرتر"}</span>
)));

/** «اگر … چه می‌شود؟» — سرور برنامه را با چند فرض دوباره می‌چیند (planning.what_if) و پایانِ هر کدام را می‌دهد.
 *  فقط نمایش است؛ تنها چیزی که از همین‌جا اعمال می‌شود «ترتیبِ بهتر» است (و مثل هر تغییر، برگرداندنی). */
export function WhatIfDialog({ canEdit, busy, run, onClose }) {
  const [w, setW] = useState(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ station: "", add: "1", workers: "", hours: "", days: "12", off: "", offDays: "2", who: "", whoDays: "2", clone: "", first: false });
  const [mine, setMine] = useState(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    productionApi.planWhatIf().then(setW).catch((e) => setErr(e.message));
  }, []);

  const end = (o, now) => (o.finish ? <>{jShort(o.finish)} <span className="sm2">({o.endGain == null ? "—" : moved(o.endGain)})</span></> : <span className="wi-bad">خارج از افق برنامه</span>);
  const late = (o, now) => (o.late === now.late ? null : <div className="sm2">{o.late < now.late ? <b className="wi-good">{faDigits(now.late - o.late)} دیرکردِ کمتر</b> : <b className="wi-bad">{faDigits(o.late - now.late)} دیرکردِ بیشتر</b>}</div>);
  // بهترین‌ها بالا: اول آنچه پایانِ برنامه را جلو می‌آورد، بعد آنچه پروژه‌ها را زودتر تمام می‌کند
  const sorted = w ? [...w.options].sort((a, b) => (b.endGain || 0) - (a.endGain || 0) || b.projectDays - a.projectDays) : [];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const body = () => {
    const b = {};
    if (f.station) b.station = { id: f.station, add: Number(f.add) || 1 };
    if (Number(f.workers) > 0) b.workers = Number(f.workers);
    if (Number(f.hours) > 0) b.overtime = { hours: Number(f.hours), days: Number(f.days) || 12 };
    if (f.off) b.off = { station: f.off, days: Number(f.offDays) || 1 };
    if (f.who) b.absent = { employee: f.who, days: Number(f.whoDays) || 1 };
    if (f.clone) b.clone = { project: f.clone, first: f.first };
    return b;
  };
  const empty = Object.keys(body()).length === 0;
  async function ask() {
    setAsking(true);
    try { setMine(await productionApi.planWhatIfCustom(body())); } catch (e) { alert(e.message); }
    setAsking(false);
  }

  return (
    <Overlay title="اگر … چه می‌شود؟" onClose={onClose} busy={busy} wide>
      {err && <div className="notice warn">{err}</div>}
      {!w && !err && <div className="empty">در حال چیدنِ دوبارهٔ برنامه با هر فرض…</div>}
      {w && (
        <>
          <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
            برنامهٔ همین لحظه با هر یک از این فرض‌ها از نو چیده شده و پایانِ واقعی‌اش آمده است. <b>هیچ چیزِ برنامه عوض نمی‌شود.</b>{" "}
            «نفرِ دیگر روی ایستگاه» یعنی یکی از همین {faDigits(w.workers)} کارگر، هر روز که بی‌کار است، کمکِ آن ایستگاه برود؛ کاری که خودتان
            مدت یا نفراتش را گذاشته‌اید دست نمی‌خورد.
          </div>
          <div className="wi-now">
            <span>الان</span>
            <b>{w.now.finish ? `پایان همهٔ کارها ${jLong(w.now.finish)}` : "برنامه در افقِ زمان‌بندی تمام نمی‌شود"}</b>
            <span className="muted sm2">{faDigits(w.now.days)} روز کاری{w.now.late ? ` · ${faDigits(w.now.late)} پروژه دیرتر از تحویل` : ""}</span>
          </div>

          {w.now.projects.length === 0 ? <div className="empty">کاری در برنامه نیست.</div> : (
            <>
              {w.combos.length > 0 ? (
                <div className="wi-best">
                  <div className="board-h" style={{ marginBottom: 6 }}>بهترین جای نفرِ اضافه</div>
                  {w.combos.map((c) => (
                    <div className="wi-combo" key={c.people}>
                      <span className="wi-n">{faDigits(c.people)} نفر</span>
                      <div>
                        <div><b>{c.stations.map((s) => `${s.add > 1 ? faDigits(s.add) + " نفر روی " : ""}«${s.name}»`).join(" + ")}</b></div>
                        <div className="sm2">پایان برنامه {end(c, w.now)}{late(c, w.now)}</div>
                        <div className="wi-chips">{chips(c.projects)}</div>
                      </div>
                    </div>
                  ))}
                  <div className="muted sm2" style={{ marginTop: 6 }}>
                    گاهی کمک به یک ایستگاه به‌تنهایی فقط گلوگاه را به ایستگاهِ بعد می‌برد؛ برای همین ترکیب‌ها هم امتحان شده‌اند.
                    {w.partial ? " (برنامه بزرگ است و همهٔ ترکیب‌ها امتحان نشد.)" : ""}
                  </div>
                </div>
              ) : (
                <div className="notice" style={{ marginBottom: 10, background: "var(--accent2)" }}>
                  با یک، دو یا سه نفرِ بیشتر روی ایستگاه‌ها، برنامه زودتر تمام نمی‌شود — چیزی که جلویش را گرفته نفر نیست (ترتیبِ مرحله‌ها،
                  خشک شدن، یا کاری که مدتش دستی گذاشته شده).
                </div>
              )}

              {w.order && (
                <div className="wi-best" style={{ marginTop: 12 }}>
                  <div className="board-h" style={{ marginBottom: 6 }}>ترتیبِ بهترِ پروژه‌ها</div>
                  <div className="sm2" style={{ lineHeight: 2 }}>{w.order.order.map((name, i) => <span key={i} className="wi-chip good" style={{ marginInlineEnd: 4 }}>{faDigits(i + 1)}. {name}</span>)}</div>
                  <div className="sm2" style={{ marginTop: 6 }}>پایان برنامه {end(w.order, w.now)}{late(w.order, w.now)}</div>
                  <div className="wi-chips">{chips(w.order.projects)}</div>
                  <div className="btn-row" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    {canEdit && (
                      <button className="submit" disabled={busy} style={{ width: "auto", flex: "0 0 auto", margin: 0 }}
                        onClick={async () => { if (await run(() => productionApi.planOrder(w.order.ids))) onClose(); }}>همین ترتیب را بگذار</button>
                    )}
                    <span className="muted sm2">کارِ نیمه‌کاره در هر ترتیبی اول تمام می‌شود. اگر نخواستید، «برگرداندن» هست.</span>
                  </div>
                </div>
              )}

              <div className="board-h" style={{ margin: "14px 0 6px" }}>هر گزینه به‌تنهایی</div>
              <div className="tbl-scroll">
                <table className="print-table wi-table">
                  <thead><tr><th>اگر…</th><th>پایان برنامه</th><th>پروژه‌ها</th></tr></thead>
                  <tbody>
                    {sorted.map((o, i) => (
                      <tr key={i} className={o.better ? "wi-row good" : ""}>
                        <td className="nm">{o.label}</td>
                        <td>{end(o, w.now)}{late(o, w.now)}</td>
                        <td><div className="wi-chips">{chips(o.projects)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="board-h" style={{ margin: "16px 0 6px" }}>فرضِ خودتان</div>
              <div className="wi-form">
                <label className="fld sm"><span>نفرِ بیشتر روی ایستگاه</span>
                  <select value={f.station} onChange={set("station")}><option value="">—</option>{w.choices.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="fld sm"><span>چند نفر</span><input type="number" inputMode="numeric" value={f.add} onChange={set("add")} /></label>
                <label className="fld sm"><span>کارگرِ تازه (چند نفر)</span><input type="number" inputMode="numeric" value={f.workers} placeholder="—" onChange={set("workers")} /></label>
                <label className="fld sm"><span>اضافه‌کاری (ساعت در روز)</span><input type="number" inputMode="decimal" value={f.hours} placeholder="—" onChange={set("hours")} /></label>
                <label className="fld sm"><span>برای چند روزِ کاری</span><input type="number" inputMode="numeric" value={f.days} onChange={set("days")} /></label>
                <label className="fld sm"><span>ایستگاهی که از کار بیفتد</span>
                  <select value={f.off} onChange={set("off")}><option value="">—</option>{w.choices.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="fld sm"><span>چند روز</span><input type="number" inputMode="numeric" value={f.offDays} onChange={set("offDays")} /></label>
                <label className="fld sm"><span>کسی که نباشد</span>
                  <select value={f.who} onChange={set("who")}><option value="">—</option>{w.choices.employees.map((e) => <option key={e}>{e}</option>)}</select></label>
                <label className="fld sm"><span>چند روز</span><input type="number" inputMode="numeric" value={f.whoDays} onChange={set("whoDays")} /></label>
                <label className="fld sm"><span>پروژه‌ای تازه مثلِ</span>
                  <select value={f.clone} onChange={set("clone")}><option value="">—</option>{w.choices.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label className="fld sm wi-check"><input type="checkbox" checked={f.first} onChange={set("first")} /> <span>اولِ صف (فوری)</span></label>
                <button className="submit" style={{ width: "auto", alignSelf: "end" }} disabled={asking || empty} onClick={ask}>{asking ? "…" : "حساب کن"}</button>
              </div>
              {mine && (
                <div className="wi-best" style={{ marginTop: 10 }}>
                  <div><b>{mine.result.label}</b></div>
                  <div className="sm2" style={{ marginTop: 4 }}>پایان برنامه {end(mine.result, mine.now)}{late(mine.result, mine.now)}</div>
                  {mine.result.newProject !== undefined && (
                    <div className="sm2">پروژهٔ تازه: {mine.result.newProject ? `پایان ${jShort(mine.result.newProject)}` : "در افقِ برنامه تمام نمی‌شود"}</div>
                  )}
                  <div className="wi-chips">{chips(mine.result.projects)}</div>
                </div>
              )}
              <div className="muted sm2" style={{ marginTop: 10, lineHeight: 2 }}>
                برای اعمال: نفراتِ ایستگاه را در «ایستگاه‌ها و کارها» زیاد کنید (یا ستون «نفر» همان کار در گانت)؛ اضافه‌کاری از دکمهٔ «اضافه‌کاری».
              </div>
            </>
          )}
        </>
      )}
      <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div>
    </Overlay>
  );
}

/** خرابی، تعمیر یا تعطیلیِ یک ایستگاه در چند روز: همان ایستگاه کار نمی‌کند، بقیه کارشان را می‌کنند. */
export function StationOffDialog({ data, busy, run, onClose }) {
  const stations = data.stations.filter((s) => s.active);
  const [station, setStation] = useState("");
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState(data.today);
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const ok = station && from && to && to >= from && (hours === "" || (Number(hours) > 0 && Number(hours) <= 12));
  const add = async () => {
    if (await run(() => productionApi.planStationOff({ station, from, to, hours: hours === "" ? null : Number(hours), reason }))) { setReason(""); setHours(""); }
  };
  return (
    <Overlay title="خرابی یا تعطیلیِ ایستگاه" busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
        ایستگاهی که خراب است، تعمیر دارد یا چند روز کار نمی‌کند. در این روزها کارهای همان ایستگاه عقب می‌روند و ایستگاه‌های دیگر کارشان را می‌کنند.
      </div>
      {data.stationOff.length === 0 ? <div className="empty">چیزی ثبت نشده.</div> : data.stationOff.map((o) => (
        <div className="it-line" key={o.id}>
          <span className="it-proj">{o.name}</span>
          <span className="it-h">{jShort(o.from)}{o.to !== o.from ? ` تا ${jShort(o.to)}` : ""}{o.hours ? ` · ${faDigits(o.hours)} ساعت در روز` : " · کلِ روز"}{o.reason ? ` · ${o.reason}` : ""}</span>
          <button className="chip-x" disabled={busy} title="حذف" onClick={() => run(() => productionApi.planStationOff({ remove: o.id }))}>×</button>
        </div>
      ))}
      <label className="fld sm" style={{ marginTop: 12 }}><span>ایستگاه</span>
        <select value={station} onChange={(e) => setStation(e.target.value)}><option value="">انتخاب کنید…</option>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="row3" style={{ marginTop: 8 }}>
        <label className="fld sm"><span>از روز</span><JalaliPicker value={from} onChange={(v) => { setFrom(v); if (v > to) setTo(v); }} /></label>
        <label className="fld sm"><span>تا روز</span><JalaliPicker value={to} onChange={setTo} /></label>
        <label className="fld sm"><span>چند ساعت (خالی = کلِ روز)</span>
          <input type="number" inputMode="decimal" value={hours} placeholder="کلِ روز" onChange={(e) => setHours(e.target.value)} /></label>
      </div>
      <label className="fld sm" style={{ marginTop: 8 }}><span>علت</span><input value={reason} placeholder="مثلاً تعمیر کمپرسور" onChange={(e) => setReason(e.target.value)} /></label>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || !ok} onClick={add}>ثبت</button>
      </div>
      <WhyOff busy={busy} reasons={[!station && "ایستگاه انتخاب نشده", to < from && "روز پایان پیش از شروع است", hours !== "" && !(Number(hours) > 0 && Number(hours) <= 12) && "ساعت باید بین ۰ و ۱۲ باشد"]} />
    </Overlay>
  );
}

/** دوباره‌کاری: از این مرحله تا آخرِ خط، این‌قدر متر دوباره. متراژِ همان مرحله‌های پروژه زیاد می‌شود. */
export function ReworkDialog({ data, busy, run, onClose }) {
  const [project, setProject] = useState("");
  const [stage, setStage] = useState("");
  const [area, setArea] = useState("");
  const [reason, setReason] = useState("");
  const p = data.projects.find((x) => x.id === project);
  const ok = project && stage && Number(area) > 0;
  const add = async () => {
    if (await run(() => productionApi.planRework({ project, stage, area: Number(area), reason }))) { setArea(""); setReason(""); }
  };
  return (
    <Overlay title="دوباره‌کاری" busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
        کاری که کنترل کیفیت رد کرده یا آسیب دیده و باید دوباره انجام شود: <b>از مرحله‌ای که می‌گویید تا آخرِ خط</b>، همین متراژ به کارِ ماندهٔ پروژه
        اضافه می‌شود (در درصدِ پیشرفتِ پروژه هم). با حذفِ ردیف، همان متراژ برمی‌گردد.
      </div>
      {data.reworks.length === 0 ? <div className="empty">دوباره‌کاری‌ای ثبت نشده.</div> : data.reworks.map((r) => (
        <div className="it-line" key={r.id}>
          <span className="it-proj">{r.project}</span>
          <span className="it-h">از «{r.stage}» · {num(r.area)} م²{r.reason ? ` · ${r.reason}` : ""}{r.by ? ` · ${r.by}` : ""} · {jShort(String(r.at).slice(0, 10))}</span>
          <button className="chip-x" disabled={busy} title="حذف و برگرداندنِ متراژ"
            onClick={() => window.confirm("این دوباره‌کاری حذف شود و متراژش برگردد؟") && run(() => productionApi.planRework({ remove: r.id }))}>×</button>
        </div>
      ))}
      <label className="fld sm" style={{ marginTop: 12 }}><span>پروژه</span>
        <select value={project} onChange={(e) => { setProject(e.target.value); setStage(""); }}><option value="">انتخاب کنید…</option>{data.projects.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <div className="row3" style={{ marginTop: 8 }}>
        <label className="fld sm"><span>از مرحلهٔ</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">—</option>{(p ? p.jobs : []).map((j) => <option key={j.stage}>{j.stage}</option>)}</select></label>
        <label className="fld sm"><span>چند متر</span><input type="number" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <label className="fld sm"><span>علت</span><input value={reason} placeholder="مثلاً ردِ کنترل کیفیت" onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {p && stage && Number(area) > 0 && (
        <div className="muted sm2" style={{ marginTop: 8 }}>
          {faDigits(p.jobs.length - p.jobs.findIndex((j) => j.stage === stage))} مرحله (از «{stage}» تا «{p.jobs[p.jobs.length - 1].stage}») هر کدام {num(Number(area))} م² بیشتر می‌شوند.
        </div>
      )}
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || !ok} onClick={add}>ثبتِ دوباره‌کاری</button>
      </div>
      <WhyOff busy={busy} reasons={[!project && "پروژه انتخاب نشده", project && !stage && "مرحله انتخاب نشده", !(Number(area) > 0) && "متراژ وارد نشده"]} />
    </Overlay>
  );
}

/** مهارتِ نفرات: چه کسی کدام مرحله‌ها را انجام می‌دهد. ردیفِ بی‌تیک یعنی همه‌کاره. */
export function SkillsDialog({ data, busy, run, onClose }) {
  const [rows, setRows] = useState(() => Object.fromEntries(data.employees.map((e) => [e, new Set(data.skills[e] || [])])));
  const [helpers, setHelpers] = useState(() => new Set(data.helperStages || []));
  const [general, setGeneral] = useState(() => new Set(data.generalPeople || []));
  // سرکارگر فقط یک نفر است؛ قاعده‌اش ثابت است (رنگ رویه با او، و میانِ استادکارها وقتِ آزاد به او می‌رسد)
  const [foreman, setForeman] = useState(() => (data.foremen || [])[0] || "");
  const boss = (who) => setForeman(foreman === who ? "" : who);
  const gen = (who) => {
    const next = new Set(general);
    if (next.has(who)) next.delete(who); else next.add(who);
    setGeneral(next);
  };
  const help = (stage) => {
    const next = new Set(helpers);
    if (next.has(stage)) next.delete(stage); else next.add(stage);
    setHelpers(next);
  };
  const toggle = (who, stage) => {
    const next = new Set(rows[who]);
    if (next.has(stage)) next.delete(stage); else next.add(stage);
    setRows({ ...rows, [who]: next });
  };
  // استادکار: کسی که مرحله‌ای را انجام می‌دهد که کمکی می‌گیرد (مثلِ رنگ)، وقتی همه آن را بلد نیستند. کارِ عمومی نمی‌گیرد.
  const leads = (e, s) => rows[e].size === 0 || rows[e].has(s);
  const master = (e) => [...helpers].some((s) => leads(e, s) && data.employees.some((x) => !leads(x, s)));
  const save = async () => {
    if (await run(() => productionApi.planSkills(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, [...v]])), [...helpers],
      [...general].filter((e) => !master(e)), foreman ? [foreman] : []))) onClose();
  };
  return (
    <Overlay title="مهارتِ نفرات" busy={busy} onClose={onClose} wide>
      <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
        برای هر نفر مرحله‌هایی را تیک بزنید که انجام می‌دهد. <b>ردیفِ بی‌تیک یعنی همه‌کاره.</b> برنامه کاری را به کسی نمی‌دهد که آن مرحله را ندارد، و
        نفرِ همه‌کاره را برای کارهایی نگه می‌دارد که فقط او از پسشان برمی‌آید.
        <br />
        <b>کمکی:</b> اگر در مرحله‌ای (مثلاً رنگ) کنارِ نفرِ اصلی یکی دو نفر قطعه می‌برند و می‌آورند، ردیفِ آخر را برای همان مرحله تیک بزنید. آن‌وقت
        نفراتِ هر کارِ آن مرحله یعنی <b>یک نفرِ اصلی + بقیه کمکی</b> («۲ نفر» = یک نفرِ اصلی با یک کمکی): برنامه برای هر کار فقط یک نفر از
        کسانی که مرحله را بلدند می‌گذارد و نفرِ اصلیِ دیگر را برای مرحلهٔ دیگری نگه می‌دارد؛ کمکی هر کارگری می‌تواند باشد. تعدادِ نفراتِ هر
        مرحله همان است که در «ایستگاه‌ها و کارها» آمده (مرحلهٔ یک‌نفره کمکی نمی‌گیرد؛ اگر کمکی دارد نفراتش را آنجا ۲ یا ۳ کنید).
        <br />
        <b>سرکارگر:</b> فقط یک نفر. رنگ رویه را تا وقتی در کارگاه است خودِ او می‌زند (اگر مرخصی یا سرِ کارِ دیگری باشد، استادکارِ بعدی)؛ آسترپاشی و
        کارهای دیگر اول با استادکارهای دیگر است تا اگر شد سرکارگر آزاد بماند و به کارِ بقیه سرکشی کند.
        <br />
        <b>کار عمومی تخصیص داده شود؟</b> برای هر کارگری که تیک بزنید، وقتِ خالیِ برنامه به او می‌رسد و در همان وقت کارِ عمومیِ کارگاه می‌کند (نظافت،
        تعمیر و نگهداری و مانند آن). کارِ پروژه همیشه جلوتر است. استادکار کارِ عمومی نمی‌گیرد.
      </div>
      <div className="tbl-scroll">
        <table className="print-table sk-table">
          <thead><tr><th>نفر</th>{data.stageNames.map((s) => <th key={s}>{s}</th>)}<th className="sk-fore">سرکارگر</th><th className="sk-gen">کار عمومی تخصیص داده شود؟</th><th></th></tr></thead>
          <tbody>
            {data.employees.map((e) => (
              <tr key={e}>
                <td className="nm">{e}</td>
                {data.stageNames.map((s) => (
                  <td key={s}><input type="checkbox" disabled={!data.canEdit} checked={rows[e].has(s)} onChange={() => toggle(e, s)} /></td>
                ))}
                <td className="sk-fore" title="سرکارگر فقط یک نفر است">
                  <input type="checkbox" disabled={!data.canEdit} checked={foreman === e} onChange={() => boss(e)} />
                </td>
                <td className="sk-gen" title={master(e) ? "استادکار کارِ عمومی نمی‌گیرد" : "وقتِ خالیِ برنامه به او می‌رسد و کارِ عمومی می‌کند"}>
                  <input type="checkbox" disabled={!data.canEdit || master(e)} checked={general.has(e) && !master(e)} onChange={() => gen(e)} />
                </td>
                <td className="muted sm2">{rows[e].size === 0 ? "همه‌کاره" : `${faDigits(rows[e].size)} مرحله`}</td>
              </tr>
            ))}
            <tr className="sk-help">
              <td className="nm"><b>کمکی می‌گیرد؟</b></td>
              {data.stageNames.map((s) => (
                <td key={s}><input type="checkbox" disabled={!data.canEdit} checked={helpers.has(s)} onChange={() => help(s)} /></td>
              ))}
              <td className="sk-fore" />
              <td className="sk-gen" />
              <td className="muted sm2">{helpers.size ? `${faDigits(helpers.size)} مرحله` : "هیچ"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        {data.canEdit && <button className="submit" disabled={busy} onClick={save}>ذخیره</button>}
      </div>
    </Overlay>
  );
}

/** رنگِ هر پروژه و ساعتِ تعویض رنگِ هر مرحله. مرحله‌ای که ساعتِ تعویض دارد، کارهای هم‌رنگ را پشتِ هم می‌چیند. */
export function ColorsDialog({ data, busy, run, onClose }) {
  const hoursOf = (stage) => { for (const p of data.projects) { const j = p.jobs.find((x) => x.stage === stage); if (j) return j.changeoverHours; } return 0; };
  const [stages, setStages] = useState(() => Object.fromEntries(data.stageNames.map((s) => [s, hoursOf(s) ? String(hoursOf(s)) : ""])));
  const [colors, setColors] = useState(() => Object.fromEntries(data.projects.map((p) => [p.id, p.color || ""])));
  const bad = Object.values(stages).some((h) => h !== "" && !(Number(h) >= 0 && Number(h) <= 24));
  const save = async () => {
    const st = Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, v === "" ? 0 : Number(v)]));
    if (await run(() => productionApi.planColors({ projects: colors, stages: st }))) onClose();
  };
  return (
    <Overlay title="رنگ و تعویض رنگ" busy={busy} onClose={onClose} wide>
      <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
        برای مرحله‌ای که رنگ در آن مهم است (مثلاً کابینِ رنگ) بنویسید رفتن از یک رنگ به رنگِ دیگر چند ساعت شست‌وشو و آماده‌سازی می‌خواهد. برنامه همان
        ساعت‌ها را حساب می‌کند و <b>کارهای هم‌رنگ را پشتِ هم می‌چیند</b>. رنگِ هر پروژه را هم همین‌جا بنویسید (هر نام یا کدی؛ یکسان بنویسید).
      </div>
      <div className="board-h" style={{ marginBottom: 6 }}>ساعتِ تعویض رنگ در هر مرحله (خالی = رنگ فرقی نمی‌کند)</div>
      <div className="col-grid">
        {data.stageNames.map((s) => (
          <label className="fld sm" key={s}><span>{s}</span>
            <input type="number" inputMode="decimal" value={stages[s]} placeholder="—" onChange={(e) => setStages({ ...stages, [s]: e.target.value })} /></label>
        ))}
      </div>
      <div className="board-h" style={{ margin: "14px 0 6px" }}>رنگِ پروژه‌ها</div>
      {data.projects.length === 0 ? <div className="empty">پروژه‌ای در برنامه نیست.</div> : (
        <div className="col-grid">
          {data.projects.map((p) => (
            <label className="fld sm" key={p.id}><span>{p.label}</span>
              <input value={colors[p.id]} placeholder="مثلاً سفید ۹۰۱۰" onChange={(e) => setColors({ ...colors, [p.id]: e.target.value })} /></label>
          ))}
        </div>
      )}
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || bad} onClick={save}>ذخیره</button>
      </div>
      <WhyOff busy={busy} reasons={[bad && "ساعتِ تعویض باید بین ۰ و ۲۴ باشد"]} />
    </Overlay>
  );
}

const stamp = (at) => {
  const d = new Date(at);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return `${jShort(local.slice(0, 10))} ${faDigits(local.slice(11, 16))}`;
};

/** تاریخچهٔ تصمیم‌های برنامه‌ریزی: چه کسی، کی، چه چیزی — و برگرداندنِ آخرین تغییر. */
export function PlanHistory({ data, busy, run }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    productionApi.planHistory().then((d) => setRows(d.changes)).catch((e) => setErr(e.message));
  }, [data]);
  if (err) return <div className="notice warn">{err}</div>;
  if (!rows) return <div className="empty">…</div>;
  return (
    <div className="card">
      <div className="board-h">تاریخچهٔ تغییرهای برنامه</div>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        هر تصمیمی که در این صفحه گرفته می‌شود اینجا می‌ماند. آخرین تغییر را می‌شود برگرداند؛ برای برگرداندنِ تغییرِ پیش از آن، دوباره بزنید.
      </div>
      {rows.length === 0 ? <div className="empty">هنوز تغییری ثبت نشده.</div> : (
        <div className="tbl-scroll">
          <table className="print-table">
            <thead><tr><th>کی</th><th>چه کسی</th><th>چه چیزی</th><th>جزئیات</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.undone ? "hist-undone" : ""}>
                  <td>{stamp(c.at)}</td><td>{c.by}</td><td className="nm">{c.action}</td><td className="nm">{c.summary}</td>
                  <td>
                    {c.undone ? <span className="pill idle">برگردانده شد{c.undoneBy ? ` · ${c.undoneBy}` : ""}</span>
                      : c.canUndo && data.canEdit ? (
                        <button className="ghost" style={{ padding: "4px 10px", width: "auto" }} disabled={busy}
                          onClick={() => window.confirm(`این تغییر برگردد؟\n${c.action} — ${c.summary}`) && run(() => productionApi.planUndo())}>برگرداندن</button>
                      ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** ساعتِ بی‌کاریِ هر نفر در روزهای پیشِ رو (همان بازه‌ای که کاشیِ «بهره‌وری برنامه» می‌سنجد)، و آنچه به کارِ عمومی
    سپرده شده: fill = فقط در وقتِ بی‌کاری (از توانِ تولید کم نمی‌کند)، out = کلاً کارِ عمومی (کارِ تولیدش به بقیه رسیده).
    کسانی که مهارتِ «خدمات عمومی» دارند همیشه در فهرست‌اند، حتی اگر بی‌کاری نداشته باشند.
    خروجی: { days, rows: [{ name, cells: {روز: {idle, fill, out, note}}, idle, fill, out }] } */
export function idleTable(data) {
  const days = (data.days || []).slice(0, data.loadDays || 12);
  const by = {};
  const row = (n) => (by[n] = by[n] || { name: n, cells: {}, idle: 0, fill: 0, out: 0 });
  const cell = (r, date) => (r.cells[date] = r.cells[date] || { idle: 0, fill: 0, out: 0, note: "" });
  (data.generalPeople || []).forEach(row);
  days.forEach((x) => {
    (x.away || []).filter((a) => a.kind === "general").forEach((a) => {
      const h = a.hours == null ? x.base : Math.min(a.hours, x.base);
      if (h <= 0) return;
      const r = row(a.name);
      cell(r, x.date).out = h;
      r.out += h;
    });
    const fill = Object.fromEntries((x.fill || []).map((f) => [f.name, f]));
    new Set([...Object.keys(x.free || {}), ...Object.keys(fill)]).forEach((n) => {
      const spare = Math.round((x.free?.[n] || 0) * 8 * 10) / 10;        // ساعتی که کارِ تولید ندارد
      const got = Math.min(fill[n]?.hours || 0, spare);
      const idle = Math.round((spare - got) * 10) / 10;
      if (idle < 0.5 && got < 0.1) return;                               // چند دقیقه بی‌کاری ارزشِ نشان دادن ندارد
      const r = row(n);
      Object.assign(cell(r, x.date), { idle: idle < 0.5 ? 0 : idle, fill: got, note: fill[n]?.note || "" });
      r.idle += idle < 0.5 ? 0 : idle;
      r.fill += got;
    });
  });
  const skilled = new Set(data.generalPeople || []);
  const rows = Object.values(by).sort((a, b) => skilled.has(b.name) - skilled.has(a.name)
    || b.idle + b.fill + b.out - (a.idle + a.fill + a.out) || a.name.localeCompare(b.name, "fa"));
  return { days, rows };
}

export const EVERYONE = "*";                                          // کارِ عمومی برای کلِ کارگاه (همان planning.ALL)
export const whoText = (name) => (name === EVERYONE ? "کلِ کارگاه" : name);
/** «از … تا …» یا «تا اطلاعِ بعدی» برای یک ردیفِ کارِ عمومی. */
export const spanText = (l) => (l.open ? `از ${jShort(l.from)} تا اطلاعِ بعدی` : l.from === l.to ? jLong(l.from) : `${jShort(l.from)} تا ${jShort(l.to)}`);
/** «در وقتِ بی‌کاری · حداکثر ۳ ساعت در روز» یا «به‌جای کارِ پروژه · کلِ روز». */
export const choreText = (l) => (l.kind === "general"
  ? `به‌جای کارِ پروژه · ${l.hours ? `${faDigits(l.hours)} ساعت در روز` : "کلِ روز"}`
  : `در وقتِ خالی · ${l.hours ? `حداکثر ${faDigits(l.hours)} ساعت در روز` : "هر چه وقتِ خالی دارد"}`);

/** نفراتِ بی‌کار: چه کسی در کدام روز کارِ پروژه ندارد. دادنِ کارِ عمومی با یک تیک در «مهارت نفرات» است
    («کار عمومی تخصیص داده شود؟»): وقتِ خالی به همان کارگر می‌رسد و کارِ عمومی می‌شود. */
export function IdleCard({ data, busy, onChore, onSkills }) {
  const [open, setOpen] = useState(false);
  const { days, rows } = idleTable(data);
  if (rows.length === 0) return null;
  const ticked = new Set(data.generalPeople || []);
  const masters = new Set(data.masters || []);
  const foremen = new Set(data.foremen || []);
  // همان عددهای کاشیِ «بهره‌وری برنامه»: نفر-روزِ بی‌کار (پس از آنچه کارِ عمومی شده) و نفر-روزِ کارِ عمومی
  const fill = data.totals.filled || 0;
  const idle = Math.max(Math.round(((data.totals.idle || 0) - fill) * 10) / 10, 0);
  const idlers = rows.filter((r) => r.idle >= 0.5);
  const h1 = (v) => faDigits(Math.round(v * 10) / 10);
  return (
    <div className="card crit-card no-print">
      <div className="crit-head" onClick={() => setOpen(!open)}>
        <span className={idle >= 1 ? "pill run" : "pill ok"}>نفراتِ بی‌کار</span>
        <span>
          {idle > 0
            ? <>در {faDigits(days.length)} روزِ کاریِ پیشِ رو <b>{faDigits(idle)} نفر-روز</b> ({faDigits(Math.round(idle * 8))} ساعت) کسی کارِ تولید ندارد{idlers.length ? `: ${idlers.slice(0, 3).map((r) => r.name).join("، ")}${idlers.length > 3 ? " و…" : ""}` : ""}.</>
            : <>در {faDigits(days.length)} روزِ کاریِ پیشِ رو وقتِ بی‌کاری نمانده.</>}
          {fill > 0 ? <> <b>{faDigits(fill)} نفر-روز</b> کارِ عمومی.</> : null}
        </span>
        <button className="linkish">{open ? "بستن" : "ببینم"}</button>
      </div>
      {open && (
        <>
          <div className="muted sm2" style={{ margin: "8px 0", lineHeight: 2 }}>
            عددِ هر خانه ساعتی است که آن نفر در آن روز کارِ پروژه ندارد. برای دادنِ کارِ عمومی، در «مهارت نفرات» ستونِ
            <b> «کار عمومی تخصیص داده شود؟»</b> را برای آن کارگر تیک بزنید: وقتِ خالیِ برنامه به او می‌رسد و همان وقت کارِ عمومی می‌کند (سبز).
            وقتِ آزادِ سرکارگر برای سرکشی به کارِ بقیه است.
          </div>
          <div className="tbl-scroll">
            <table className="print-table idle-table">
              <thead>
                <tr>
                  <th>نفر</th><th>بی‌کار (ساعت)</th><th>کار عمومی</th>
                  {days.map((x) => <th key={x.date}>{jShort(x.date).slice(5)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td className="nm">{r.name}
                      {ticked.has(r.name) ? <small className="idle-tag">کار عمومی</small>
                        : foremen.has(r.name) ? <small className="idle-tag f">سرکارگر · سرکشی</small>
                          : masters.has(r.name) ? <small className="idle-tag m">استادکار</small> : null}
                    </td>
                    <td><b>{r.idle ? h1(r.idle) : ""}</b></td>
                    <td>
                      {r.out ? <span className="idle-g">{h1(r.out)}</span> : null}
                      {r.fill ? <span className="idle-f">{h1(r.fill)}</span> : null}
                    </td>
                    {days.map((x) => {
                      const c = r.cells[x.date];
                      return (
                        <td key={x.date} title={c?.note || ""}>
                          {c && c.out > 0 ? <span className="idle-g">{h1(c.out)}</span> : null}
                          {c && c.idle > 0 ? <span className="idle-h">{h1(c.idle)}</span> : null}
                          {c && c.fill > 0 ? <span className="idle-f">{h1(c.fill)}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted sm2" style={{ marginTop: 6 }}>
            <span className="idle-h">۳</span> ساعتِ بی‌کار · <span className="idle-f">۳</span> کارِ عمومی در وقتِ خالی ·{" "}
            <span className="idle-g">۸</span> کارِ عمومیِ واجب (به‌جای کارِ پروژه)
          </div>
          {data.canEdit && (
            <div className="btn-row" style={{ justifyContent: "flex-start", marginTop: 10 }}>
              <button className="ghost" style={{ width: "auto", flex: "0 0 auto" }} disabled={busy} onClick={onSkills}>مهارت نفرات (تیکِ کار عمومی)</button>
              <button className="ghost" style={{ width: "auto", flex: "0 0 auto" }} disabled={busy} onClick={() => onChore({})}>کارِ مشخص یا واجب…</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** کارِ عمومیِ مشخص، برای یک نفر یا کلِ کارگاه. کسی که تیکِ «کار عمومی» دارد وقتِ خالی‌اش خودبه‌خود کارِ عمومی است؛
    این پنجره فقط برای وقتی است که کارِ مشخصی در روزِ مشخصی باید انجام شود، یا کاری واجب است و باید «به‌جای کارِ پروژه»
    انجام شود (آن‌وقت پیش از ثبت می‌گوید برنامه عقب می‌افتد یا نه).
    init: { row } برای ویرایشِ همان ردیف، یا { employee, from, to } برای کارِ تازه. */
export function GeneralDialog({ data, busy, run, init, onClose }) {
  const row = init?.row || null;
  const first = data.days[0]?.date || data.today;
  const ticked = new Set(data.generalPeople || []);
  const masters = new Set(data.masters || []);
  const [pick, setPick] = useState(() => (row
    ? { name: row.employee, must: row.kind === "general", from: row.from, to: row.open ? row.from : row.to, open: !!row.open,
      hours: row.hours ? String(row.hours) : "", note: row.note || "" }
    : { name: init?.employee || [...ticked][0] || "", must: false, from: init?.from || first, to: init?.to || init?.from || first,
      open: false, hours: "", note: "" }));
  const [see, setSee] = useState(null);                                  // پیش‌نمایشِ کارِ واجب: { key, result, now } یا { key, error }
  const set = (more) => setPick({ ...pick, ...more });
  const badHours = pick.hours !== "" && !(Number(pick.hours) > 0 && Number(pick.hours) <= 12);
  const noTick = !pick.must && !!pick.name && pick.name !== EVERYONE && !ticked.has(pick.name);
  const nobody = !pick.must && pick.name === EVERYONE && ticked.size === 0;
  const noNote = !pick.note.trim();
  const ok = !!pick.name && !!pick.from && (pick.open || (!!pick.to && pick.to >= pick.from)) && !badHours;
  const key = ok && pick.must ? [pick.name, pick.from, pick.open ? "" : pick.to, pick.hours].join("|") : "";
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const [employee, from, to, hours] = key.split("|");
    const t = setTimeout(() => {
      productionApi.planWhatIfCustom({ general: { employee, from, to, open: !to, hours, replace: row?.id } })
        .then((r) => live && setSee({ key, ...r }))
        .catch((e) => live && setSee({ key, error: e.message }));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key, data.totals.finish, data.totals.area]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (await run(() => productionApi.planLeave({ replace: row?.id, employee: pick.name, from: pick.from, to: pick.to, open: pick.open,
      kind: pick.must ? "general" : "fill", hours: pick.hours, note: pick.note }))) onClose();
  };
  const drop = async () => {
    if (window.confirm("این کارِ عمومی برداشته شود؟") && await run(() => productionApi.planLeave({ remove: row.id }))) onClose();
  };
  const preview = () => {
    if (!ok) return null;
    if (!see || see.key !== key) return <span className="muted">در حالِ حساب…</span>;
    if (see.error) return <span className="wi-bad">{see.error}</span>;
    const r = see.result;
    const later = r.projects.filter((g) => g.gain < 0);
    if (!r.finish) return <b className="wi-bad">با این کار برنامه در افقش تمام نمی‌شود.</b>;
    const endLater = (r.endGain || 0) < 0;
    const newlyLate = r.late > see.now.late;
    if (!endLater && !newlyLate && later.length === 0) {
      return <><b className="wi-good">برنامه عقب نمی‌افتد.</b> بقیه کارها را می‌رسانند و پایانِ برنامه همان {jShort(r.finish)} می‌ماند.</>;
    }
    if (!endLater && !newlyLate) {
      return (
        <>
          <b className="wi-warn">پایانِ برنامه همان {jShort(r.finish)} می‌ماند</b>، ولی {faDigits(later.length)} پروژه کمی دیرتر تمام می‌شود:
          <div className="wi-chips">{chips(later)}</div>
        </>
      );
    }
    return (
      <>
        <b className="wi-bad">برنامه عقب می‌افتد:</b> پایانِ برنامه {jShort(r.finish)} ({moved(r.endGain || 0)})
        {newlyLate ? ` و ${faDigits(r.late - see.now.late)} پروژهٔ دیگر از قولِ تحویل می‌گذرد` : ""}.
        {later.length > 0 && <div className="wi-chips">{chips(later)}</div>}
      </>
    );
  };
  const people = data.employees.filter((e) => !masters.has(e) || e === pick.name);
  return (
    <Overlay title={row ? "ویرایشِ کارِ عمومی" : "کارِ عمومیِ مشخص"} busy={busy} onClose={onClose}>
      {!row && (
        <div className="muted sm2" style={{ marginBottom: 8, lineHeight: 1.9 }}>
          کسی که در «مهارت نفرات» تیکِ «کار عمومی» دارد، وقتِ خالی‌اش خودبه‌خود کارِ عمومی است. اینجا فقط وقتی لازم است که کارِ مشخصی در روزِ
          مشخصی بدهید، یا کاری واجب باشد.
        </div>
      )}
      <div className="row2">
        <label className="fld sm"><span>برای چه کسی</span>
          <select value={pick.name} onChange={(e) => set({ name: e.target.value })}>
            <option value="">— انتخاب کنید —</option>
            <option value={EVERYONE}>کلِ کارگاه</option>
            {people.map((e) => <option key={e} value={e}>{e}{ticked.has(e) ? " — کار عمومی" : ""}</option>)}
          </select>
        </label>
        <label className="fld sm"><span>چه کاری</span>
          <input list="general-works" value={pick.note} placeholder="مثلاً: سرویسِ کمپرسور، نظافتِ کابینِ رنگ" onChange={(e) => set({ note: e.target.value })} />
          <datalist id="general-works">
            {[...(data.generalWorks || []), "تعمیر و نگهداری", "نظافت کارگاه", "مرتب‌کردن انبار"].map((w) => <option key={w} value={w} />)}
          </datalist>
        </label>
      </div>
      <div className="row3">
        <label className="fld sm"><span>از روز</span><JalaliPicker value={pick.from} onChange={(v) => set({ from: v, to: pick.to < v ? v : pick.to })} /></label>
        <div className="fld sm"><span>تا روز</span>
          {pick.open ? <div className="idle-open">تا اطلاعِ بعدی</div> : <JalaliPicker value={pick.to} onChange={(v) => set({ to: v })} />}
          {row?.open && <label className="idle-check"><input type="checkbox" checked={pick.open} onChange={(e) => set({ open: e.target.checked })} /> تا اطلاعِ بعدی</label>}
        </div>
        <label className="fld sm"><span title={pick.must ? "خالی = کلِ روز" : "خالی = هر چه وقتِ خالی دارد"}>ساعت در روز (اختیاری)</span>
          <input type="number" min="0.5" max="12" step="0.5" value={pick.hours} onChange={(e) => set({ hours: e.target.value })} />
        </label>
      </div>
      <label className="idle-mode">
        <input type="checkbox" checked={pick.must} onChange={(e) => set({ must: e.target.checked })} />
        <span>
          <b>واجب است</b> — به‌جای کارِ پروژه انجام شود (بی این تیک، فقط در وقتِ خالیِ او می‌افتد و برنامهٔ تولید دست نمی‌خورد)
          {pick.must && pick.name === EVERYONE && <div className="sm2 muted">همهٔ نفرات (استادکارها هم) در این ساعت‌ها از کارِ پروژه کنار می‌روند.</div>}
          {pick.must && <div className="sm2 idle-see">{preview()}</div>}
        </span>
      </label>
      <div className="btn-row">
        {row && data.canEdit && <button className="ghost" style={{ flex: "0 0 auto", width: "auto", color: "#B02A2A" }} disabled={busy} onClick={drop}>حذف</button>}
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        {data.canEdit && <button className="submit" disabled={busy || !ok || noNote || noTick || nobody} onClick={save}>{row ? "ذخیره" : "ثبت"}</button>}
      </div>
      <WhyOff busy={busy} reasons={[!pick.name && "معلوم نیست کار برای چه کسی است", noNote && "بنویسید چه کاری است",
        !pick.open && pick.to < pick.from && "تاریخ پایان پیش از شروع است", badHours && "ساعت باید بین ۰ و ۱۲ باشد",
        noTick && `«${pick.name}» تیکِ «کار عمومی» ندارد؛ در «مهارت نفرات» برایش تیک بزنید، یا اگر کار واجب است «واجب است» را بزنید`,
        nobody && "هنوز کسی تیکِ «کار عمومی» ندارد؛ در «مهارت نفرات» تیک بزنید"]} />
    </Overlay>
  );
}

/** زنجیرهٔ بحرانی: کارهایی که پایانِ کلِ برنامه را تعیین می‌کنند. کوتاه شدنِ هر کدام، پایان را جلو می‌آورد. */
export function CriticalCard({ data }) {
  const [open, setOpen] = useState(false);
  const chain = data.critical || [];
  if (chain.length === 0) return null;
  const last = chain[chain.length - 1];
  return (
    <div className="card crit-card no-print">
      <div className="crit-head" onClick={() => setOpen(!open)}>
        <span className="pill bad">مسیر بحرانی</span>
        <span>پایانِ برنامه ({jShort(last.finish)}) را <b>{faDigits(chain.length)} کار</b> تعیین می‌کند؛ آخرینش «{last.stage}»ِ {last.project}.</span>
        <button className="linkish">{open ? "بستن" : "ببینم"}</button>
      </div>
      {open && (
        <>
          {chain.map((c, i) => (
            <div className="crit-row" key={i}>
              <span className="crit-n">{faDigits(i + 1)}</span>
              <div>
                <b>{c.project} · {c.stage}</b> <span className="muted sm2">{jShort(c.start)}{c.finish !== c.start ? ` تا ${jShort(c.finish)}` : ""}</span>
                <div className="muted sm2">{c.link ? "چرا زودتر نشد: " : ""}{c.why}</div>
              </div>
            </div>
          ))}
          <div className="muted sm2" style={{ marginTop: 8 }}>
            هر کدام از این کارها زودتر تمام شود (نفرِ بیشتر، اضافه‌کاری، یا جلو انداختنِ کارِ قبلش)، پایانِ برنامه جلو می‌آید. در گانت با خطِ قرمزِ زیرِ نوار
            مشخص‌اند.
          </div>
        </>
      )}
    </div>
  );
}

const STATUS = { ok: ["ok", "کافی است"], tight: ["run", "لب‌به‌لب"], short: ["bad", "کم است"], none: ["idle", "لازم نیست"] };

/** موادِ لازم برای کارهای دو هفتهٔ کاریِ پیشِ رو در برابر موجودیِ انبارِ مصرفی (تخمین، بی توجه به رنگ‌بندی). */
export function MaterialsCard({ stampKey }) {
  const [m, setM] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    productionApi.planMaterials().then(setM).catch(() => setM(null));
  }, [stampKey]);
  if (!m || m.rows.every((r) => r.status === "none")) return null;
  const short = m.rows.filter((r) => r.status === "short");
  return (
    <div className="card crit-card no-print">
      <div className="crit-head" onClick={() => setOpen(!open)}>
        <span className={short.length ? "pill bad" : "pill ok"}>مواد</span>
        <span>
          {short.length
            ? <>برای کارهای {faDigits(m.days)} روزِ کاریِ پیشِ رو، <b>{short.map((r) => r.label).join(" و ")}</b> در انبارِ مصرفی کم است.</>
            : <>موادِ کارهای {faDigits(m.days)} روزِ کاریِ پیشِ رو در انبارِ مصرفی هست.</>}
        </span>
        <button className="linkish">{open ? "بستن" : "ببینم"}</button>
      </div>
      {open && (
        <>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>ماده</th><th>متراژِ دست‌ها تا {m.until ? jShort(m.until) : "—"}</th><th>لازم (کیلو)</th><th>موجودیِ انبارِ مصرفی</th><th></th><th>کلِ برنامه (کیلو)</th></tr></thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.group}>
                    <td className="nm">{r.label}</td><td>{num(r.area)} م²</td>
                    <td>{num(r.need[0])} تا {num(r.need[1])}</td><td><b>{num(r.stock)}</b></td>
                    <td><span className={`pill ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}{r.short ? ` — ${num(r.short)} کیلو` : ""}</span></td>
                    <td>{num(r.needAll[0])} تا {num(r.needAll[1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted sm2" style={{ marginTop: 8, lineHeight: 2 }}>
            تخمین است: متراژِ دست‌های آستر و رنگ در برنامه × مصرفِ استانداردِ هر دست (با هاردنر). موجودی از {m.warehouse ? `«${m.warehouse}»` : "انبارِ مصرفی (تعریف نشده)"} و
            از روی نامِ کالاها گروه شده؛ <b>رنگ‌بندیِ هر پروژه دیده نمی‌شود</b>، فقط جمعِ هر گروه.
            {m.unknownUnits ? ` ${faDigits(m.unknownUnits)} کالا واحدِ وزنی ندارد و حساب نشده.` : ""}
          </div>
        </>
      )}
    </div>
  );
}

/** کار در محلِ پروژه: بخشی (یا همهٔ) متراژِ یک پروژه در محل انجام می‌شود — با تیمِ خودش و از روزی که مسئول می‌گوید. تیم آن
    روزها در کارگاه نیست. پیش از ذخیره، سرور همین تنظیم را می‌چیند (چیزی ذخیره نمی‌شود) و می‌گوید برنامه چه می‌شود. */
export function SiteDialog({ data, project: p, busy, run, onClose }) {
  const site = p.site;
  const stages = (data.stageNames || []).filter((s) => p.jobs.some((j) => j.stage === s) || (site?.jobs || []).some((j) => j.stage === s));
  const masters = new Set(data.masters || []);
  const [f, setF] = useState(() => ({
    all: site ? site.all : p.workSite === "onsite",
    area: site && !site.all && site.area ? String(site.area) : "",
    note: site?.note || "",
    stages: site?.stages?.length ? site.stages : stages,
    lead: site?.master || "",
    crew: site ? site.team.filter((n) => n !== site.master) : [],
    from: site?.from || "",
  }));
  const [see, setSee] = useState(null);                                  // پیش‌نمایش: { key, result, now } یا { key, error }
  const set = (more) => setF({ ...f, ...more });
  const tick = (list, name) => (list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
  const crew = f.crew.filter((n) => n !== f.lead);
  const team = f.lead ? [f.lead, ...crew] : [];
  const picked = stages.filter((s) => f.stages.includes(s));
  const badArea = !f.all && !(Number(f.area) > 0);
  const over = !f.all && p.baseArea > 0 && Number(f.area) > p.baseArea + 0.005;
  const ok = !badArea && !over && picked.length > 0 && team.length <= 4;
  const body = { project: p.id, all: f.all, area: f.all ? "" : f.area, note: f.note,
    stages: picked.length === stages.length ? [] : picked, team, from: f.from };
  const key = ok && team.length && f.from ? JSON.stringify({ ...body, note: "" }) : "";
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const t = setTimeout(() => {
      productionApi.planWhatIfCustom({ site: JSON.parse(key) })
        .then((r) => live && setSee({ key, ...r }))
        .catch((e) => live && setSee({ key, error: e.message }));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key, data.totals.finish, data.totals.area]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => { if (await run(() => productionApi.planSite(body))) onClose(); };
  const drop = async () => {
    if (window.confirm("کارِ محلِ پروژه برداشته شود؟ همهٔ کارِ این پروژه به کارگاه برمی‌گردد.")
      && await run(() => productionApi.planSite({ project: p.id, remove: true }))) onClose();
  };
  const preview = () => {
    if (!ok) return null;
    if (!key) return <span className="muted">تا استادکارِ تیم و روزِ رفتن را نگذارید، کارِ محلِ پروژه در برنامه چیده نمی‌شود (می‌توانید بعداً بگذارید).</span>;
    if (!see || see.key !== key) return <span className="muted">در حالِ حساب…</span>;
    if (see.error) return <span className="wi-bad">{see.error}</span>;
    const r = see.result, s = r.site;
    if (!s || !s.days.length) return <span className="muted">از کارِ محلِ پروژه چیزی نمانده یا در برنامه جا نگرفت.</span>;
    const later = r.projects.filter((g) => g.gain < 0 && g.id !== p.id);
    return (
      <>
        <div>
          تیم <b>{faDigits(s.days.length)} روز</b> در محلِ پروژه است: از {jShort(s.start)} تا {jShort(s.finish)}
          {s.unplanned > 0.05 ? <b className="wi-bad"> — {num(s.unplanned)} م² در افقِ برنامه جا نگرفت</b> : ""}.
          {r.siteProject.finish ? <> پایانِ این پروژه: <b>{jShort(r.siteProject.finish)}</b>.</> : ""}
        </div>
        <div>
          {!r.finish ? <b className="wi-bad">با این کار برنامه در افقش تمام نمی‌شود.</b>
            : (r.endGain || 0) < 0 ? <>پایانِ کلِ برنامه: {jShort(r.finish)} ({moved(r.endGain)})</>
              : <><b className="wi-good">پایانِ کلِ برنامه عقب نمی‌افتد</b> ({jShort(r.finish)})</>}
          {r.late > see.now.late ? <b className="wi-bad"> · {faDigits(r.late - see.now.late)} پروژهٔ دیگر از قولِ تحویل می‌گذرد</b> : ""}
        </div>
        {later.length > 0 && <div className="wi-chips">{chips(later)}</div>}
      </>
    );
  };
  return (
    <Overlay title={`کار در محلِ پروژه — ${p.label}`} busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 8, lineHeight: 1.9 }}>
        کاری که نمی‌شود به کارگاه آورد در محلِ پروژه انجام می‌شود: یک استادکار با یک یا دو کارگر. آن روزها این تیم در کارگاه نیست و
        رنگ رویهٔ محلِ پروژه را هم استادکارِ همین تیم می‌زند.
      </div>
      <div className="site-how">
        <label><input type="radio" checked={!f.all} onChange={() => set({ all: false })} /> بخشی از کار در محلِ پروژه است</label>
        <label><input type="radio" checked={f.all} onChange={() => set({ all: true })} /> همهٔ کار در محلِ پروژه است</label>
      </div>
      <div className="row2">
        {!f.all && (
          <label className="fld sm"><span>متراژِ محلِ پروژه (م²){p.baseArea > 0 ? ` — از ${num(p.baseArea)} متر` : ""}</span>
            <input type="number" min="0" step="0.5" value={f.area} placeholder="مثلاً ۴" onChange={(e) => set({ area: e.target.value })} />
          </label>
        )}
        <label className="fld sm"><span>چه چیزی (اختیاری)</span>
          <input value={f.note} maxLength={200} placeholder="مثلاً: در و چهارچوب" onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>
      <div className="fld sm"><span>کدام مرحله‌ها در محلِ پروژه انجام می‌شود</span>
        <div className="site-ticks">
          {stages.map((s) => (
            <label key={s}><input type="checkbox" checked={f.stages.includes(s)} onChange={() => set({ stages: tick(f.stages, s) })} /> {s}</label>
          ))}
        </div>
        {picked.length < stages.length && picked.length > 0 && (
          <small className="muted">مرحله‌ای که تیک ندارد برای همین قطعه‌ها در کارگاه انجام می‌شود، پیش از رفتنِ تیم.</small>
        )}
      </div>
      <div className="row2">
        <label className="fld sm"><span>استادکارِ تیم</span>
          <select value={f.lead} onChange={(e) => set({ lead: e.target.value })}>
            <option value="">— هنوز معلوم نیست —</option>
            {[...data.employees].sort((a, b) => Number(masters.has(b)) - Number(masters.has(a)))
              .map((e) => <option key={e} value={e}>{e}{masters.has(e) ? " — استادکار" : ""}</option>)}
          </select>
        </label>
        <label className="fld sm"><span>از چه روزی می‌روند</span>
          <JalaliPicker value={f.from} onChange={(v) => set({ from: v })} />
        </label>
      </div>
      {f.lead && (
        <div className="fld sm"><span>همراهِ او (تا سه نفر)</span>
          <div className="site-ticks">
            {data.employees.filter((e) => e !== f.lead).map((e) => (
              <label key={e}><input type="checkbox" checked={crew.includes(e)} disabled={!crew.includes(e) && crew.length >= 3}
                onChange={() => set({ crew: tick(crew, e) })} /> {e}</label>
            ))}
          </div>
        </div>
      )}
      <div className="sm2 idle-see site-see">{preview()}</div>
      <div className="btn-row">
        {data.canEdit && (site || p.workSite === "mixed" || p.workSite === "onsite") && (
          <button className="ghost" style={{ flex: "0 0 auto", width: "auto", color: "#B02A2A" }} disabled={busy} onClick={drop}>کارِ محلِ پروژه ندارد</button>
        )}
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        {data.canEdit && <button className="submit" disabled={busy || !ok || (!!see && see.key === key && !!see.error)} onClick={save}>ذخیره</button>}
      </div>
      <WhyOff busy={busy} reasons={[badArea && "متراژِ محلِ پروژه را بنویسید (یا «همهٔ کار در محلِ پروژه است» را بزنید)",
        over && `متراژِ محلِ پروژه از متراژِ کلِ پروژه (${num(p.baseArea)} م²) بیشتر است`, picked.length === 0 && "دست‌کم یک مرحله را تیک بزنید",
        !!see && see.key === key && !!see.error && see.error]} />
    </Overlay>
  );
}

/* ---------- بهره‌وریِ پرسنل ----------
   «مبنا» فرضِ مدیر است: سرعتی که از سابقهٔ گزارش‌ها درمی‌آید چند درصدِ توانِ واقعیِ کارگاه است. برنامهٔ خط با «هدف» چیده می‌شود
   (تندتر از سابقه) و پایانِ «با سرعتِ فعلی» کنارش می‌ماند تا قول به مشتری از روی آن داده شود. روندِ واقعی از گزارش‌ها می‌آید. */
const pct = (v) => (v == null ? "—" : `${faDigits(Math.round(v * 10) / 10)}٪`);
const TREND = { up: ["رو به بالا ↑", "wi-good"], down: ["رو به پایین ↓", "wi-bad"], flat: ["ثابت →", "muted"] };

export function EfficiencyCard({ data, busy, run }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [see, setSee] = useState(null);
  const e = data.efficiency;
  const want = Number(goal);
  const ok = !!e && goal !== "" && want >= e.base && want <= Math.min(e.base * 2, 100) && want !== e.target;
  useEffect(() => {
    if (!ok) return undefined;
    let live = true;
    const t = setTimeout(() => {
      productionApi.planWhatIfCustom({ efficiency: { target: want } })
        .then((r) => live && setSee({ want, ...r })).catch((err) => live && setSee({ want, error: err.message }));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [goal, e?.target, data.totals.finish]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return null;
  const stretched = Math.abs(e.factor - 1) > 0.001;
  const [word, tone] = TREND[e.trend] || ["هنوز معلوم نیست", "muted"];
  const top = Math.max(e.target, ...e.weeks.map((w) => w.percent || 0), 1);
  const next = Math.min(e.target + e.step, Math.min(e.base * 2, 100));
  const save = async (v) => { if (await run(() => productionApi.planEfficiency({ target: v }))) { setGoal(""); setSee(null); } };
  return (
    <div className="card crit-card no-print">
      <div className="crit-head" onClick={() => setOpen(!open)}>
        <span className={e.trend === "down" ? "pill run" : "pill ok"}>بهره‌وریِ پرسنل</span>
        <span>
          الان <b>{pct(e.now)}</b> <span className={tone}>{word}</span>
          {e.before != null ? <> (چهار هفتهٔ قبل {pct(e.before)})</> : null} · هدفِ برنامه <b>{pct(e.target)}</b>
          {stretched && e.realFinish && e.planFinish
            ? <> · پایان با هدف {jShort(e.planFinish)}، با سرعتِ فعلی <b>{jShort(e.realFinish)}</b></> : null}
        </span>
        <button className="linkish">{open ? "بستن" : "ببینم"}</button>
      </div>
      {open && (
        <>
          <div className="muted sm2" style={{ margin: "8px 0", lineHeight: 2 }}>
            مبنا <b>{pct(e.base)}</b> است: فرض می‌کنیم سرعتی که از گزارش‌ها درمی‌آید {pct(e.base)} توانِ واقعیِ کارگاه است. «الان» از
            کارهایی حساب می‌شود که متراژشان در {faDigits(e.window)} هفتهٔ اخیر ثبت شده: آن متراژ در برابر همهٔ ساعتی که تا ثبتش
            رویش رفته، نسبت به میانگینِ کلِ سابقه.
            {e.pendingHours > 0 ? <> <b>{faDigits(Math.round(e.pendingHours))} ساعت</b> کار هنوز متراژ نخورده و در این عدد نیامده؛ فهرستش پایینِ همین کارت است.</> : null} برنامهٔ خط (گانت، برگهٔ روزانه، برنامهٔ نفرات) با <b>هدف</b> چیده می‌شود؛ قول به مشتری را از روی
            «با سرعتِ فعلی» بدهید.
          </div>
          <div className="eff-bars" title="بهره‌وریِ هر هفته (از گزارش‌ها)">
            {e.weeks.map((w) => (
              <div key={w.start} className="eff-col" title={`هفتهٔ ${jShort(w.start)}: ${w.percent == null ? "متراژی در این هفته ثبت نشده (یا کم است)" : pct(w.percent)} · ${faDigits(w.hours)} ساعت کارِ متراژخورده`}>
                <i className={w.percent == null ? "none" : w.percent >= e.target ? "hit" : ""} style={{ height: `${w.percent == null ? 4 : Math.max(w.percent / top * 100, 6)}%` }} />
                <small>{w.percent == null ? "—" : faDigits(Math.round(w.percent))}</small>
              </div>
            ))}
            <span className="eff-goal" style={{ bottom: `calc(18px + ${e.target / top} * (100% - 18px))` }}>هدف {pct(e.target)}</span>
          </div>
          <div className="sm2" style={{ margin: "10px 0 4px", lineHeight: 2 }}>
            {e.now == null ? <span className="muted">در چهار هفتهٔ اخیر متراژِ کافی ثبت نشده تا روند معلوم شود.</span>
              : e.trend === "up" ? <><b className="wi-good">بهره‌وری بالا رفته است:</b> از {pct(e.before)} به {pct(e.now)}.</>
                : e.trend === "down" ? <><b className="wi-bad">بهره‌وری پایین آمده است:</b> از {pct(e.before)} به {pct(e.now)}.</>
                  : e.trend === "flat" ? <>بهره‌وری تقریباً ثابت مانده است ({pct(e.before)} ← {pct(e.now)}).</>
                    : <>الان {pct(e.now)}؛ برای مقایسه با قبل، گزارشِ چهار هفتهٔ پیش‌تر کافی نیست.</>}
            {" "}
            {e.advice === "raise" ? <b className="wi-good">تحققِ برنامهٔ ده روزِ اخیر {pct(e.met)} است: هدفِ فعلی جا افتاده و وقتِ پلهٔ بعد است.</b>
              : e.advice === "hold" ? <>تحققِ برنامهٔ ده روزِ اخیر {pct(e.met)} است: هدف را فعلاً نگه دارید تا جا بیفتد.</>
                : e.advice === "high" ? <b className="wi-bad">تحققِ برنامهٔ ده روزِ اخیر فقط {pct(e.met)} است: هدف بالاست یا کار عقب افتاده؛ بالاتر نبرید.</b>
                  : <span className="muted">هنوز روزِ کافی از برنامهٔ ثبت‌شده نگذشته تا بگوییم هدف جا افتاده یا نه.</span>}
          </div>
          {(e.missing || []).length > 0 && (
            <>
              <div className="sm2" style={{ margin: "12px 0 4px" }}>
                <b>ساعت هست، متراژ نیست</b> — برای این کارها ساعت گزارش شده ولی پس از آن متراژی ثبت نشده. تا متراژشان در گزارش نیاید، نه در
                بهره‌وری حساب می‌شوند و نه برنامه می‌داند چه مقدارش انجام شده.
              </div>
              <div className="tbl-scroll">
                <table className="mini-table">
                  <thead><tr><th>پروژه</th><th>مرحله</th><th>ساعتِ بی‌متراژ</th><th>از</th><th>تا</th><th>آخرین متراژ</th></tr></thead>
                  <tbody>
                    {e.missing.slice(0, 15).map((m) => (
                      <tr key={`${m.projectId}|${m.stage}`}>
                        <td>{m.project}{m.closed ? <span className="muted"> (بسته)</span> : null}</td><td>{m.stage}</td>
                        <td><b>{faDigits(m.hours)}</b></td><td>{jShort(m.from)}</td><td>{jShort(m.to)}</td>
                        <td>{m.lastArea ? jShort(m.lastArea) : <span className="wi-bad">هیچ‌وقت</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {e.missing.length > 15 && <div className="muted sm2">و {faDigits(e.missing.length - 15)} کارِ دیگر.</div>}
            </>
          )}
          {data.canEdit && (
            <div className="eff-set">
              <label className="fld sm" style={{ margin: 0 }}><span>هدفِ تازه (٪)</span>
                <input type="number" min={e.base} max={Math.min(e.base * 2, 100)} step="1" value={goal} placeholder={String(next)}
                  onChange={(ev) => setGoal(ev.target.value)} style={{ width: 110 }} />
              </label>
              <button className="ghost" disabled={busy || next <= e.target} onClick={() => setGoal(String(next))}>پلهٔ بعد: {pct(next)}</button>
              {stretched && <button className="ghost" disabled={busy} onClick={() => save(e.base)}>برگشت به مبنا ({pct(e.base)})</button>}
              <button className="submit" disabled={busy || !ok || !!(see && see.want === want && see.error)} onClick={() => save(want)}>ثبتِ هدف</button>
              <div className="sm2 idle-see" style={{ flexBasis: "100%" }}>
                {!ok ? (goal !== "" && want !== e.target ? <span className="wi-bad">هدف باید بین {pct(e.base)} و {pct(Math.min(e.base * 2, 100))} باشد.</span> : null)
                  : !see || see.want !== want ? <span className="muted">در حالِ حساب…</span>
                    : see.error ? <span className="wi-bad">{see.error}</span>
                      : <>با هدفِ {pct(want)} پایانِ برنامهٔ خط <b>{see.result.finish ? jShort(see.result.finish) : "خارج از افق"}</b> می‌شود
                        ({see.result.endGain > 0 ? `${faDigits(see.result.endGain)} روز زودتر` : see.result.endGain < 0 ? `${faDigits(-see.result.endGain)} روز دیرتر` : "بی‌تغییر"} از برنامهٔ الان).
                        پایان با سرعتِ فعلی همان {e.realFinish ? jShort(e.realFinish) : "—"} می‌ماند.</>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
