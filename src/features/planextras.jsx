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
  const save = async () => {
    if (await run(() => productionApi.planSkills(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, [...v]])), [...helpers]))) onClose();
  };
  return (
    <Overlay title="مهارتِ نفرات" busy={busy} onClose={onClose} wide>
      <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
        برای هر نفر مرحله‌هایی را تیک بزنید که انجام می‌دهد. <b>ردیفِ بی‌تیک یعنی همه‌کاره.</b> برنامه کاری را به کسی نمی‌دهد که آن مرحله را ندارد، و
        نفرِ همه‌کاره را برای کارهایی نگه می‌دارد که فقط او از پسشان برمی‌آید.
        <br />
        <b>کمکی:</b> اگر در مرحله‌ای (مثلاً رنگ) کنارِ نفرِ ماهر یکی دو نفر قطعه می‌برند و می‌آورند، ردیفِ آخر را برای همان مرحله تیک بزنید. آن‌وقت
        از نفراتِ هر کارِ آن مرحله فقط یک نفر باید ماهر باشد و بقیه هر کارگری می‌تواند باشد. تعدادِ نفراتِ هر مرحله همان است که در «ایستگاه‌ها و
        کارها» آمده (مرحلهٔ یک‌نفره کمکی نمی‌گیرد؛ اگر کمکی دارد نفراتش را آنجا ۲ یا ۳ کنید).
      </div>
      <div className="tbl-scroll">
        <table className="print-table sk-table">
          <thead><tr><th>نفر</th>{data.stageNames.map((s) => <th key={s}>{s}</th>)}<th></th></tr></thead>
          <tbody>
            {data.employees.map((e) => (
              <tr key={e}>
                <td className="nm">{e}</td>
                {data.stageNames.map((s) => (
                  <td key={s}><input type="checkbox" disabled={!data.canEdit} checked={rows[e].has(s)} onChange={() => toggle(e, s)} /></td>
                ))}
                <td className="muted sm2">{rows[e].size === 0 ? "همه‌کاره" : `${faDigits(rows[e].size)} مرحله`}</td>
              </tr>
            ))}
            <tr className="sk-help">
              <td className="nm"><b>کمکی می‌گیرد؟</b></td>
              {data.stageNames.map((s) => (
                <td key={s}><input type="checkbox" disabled={!data.canEdit} checked={helpers.has(s)} onChange={() => help(s)} /></td>
              ))}
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
