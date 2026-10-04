import { useState } from "react";
import { productionApi } from "../api.js";
import { Empty, J_MONTHS, faDigits, isoToJ, jLong, jShort, jToIso } from "../shared/core.jsx";
import { JOB_STATUS, Slip, StatusDot, addDays, dayDiff, dayInfo, num, statusOf, toDate } from "./planutil.jsx";

/* ============ بورد، تقویم و داشبوردِ پروژه‌ها ============
   سه نمای دیگرِ همان برنامه‌ای که planning.jsx از سرور می‌گیرد؛ اینجا چیزی حساب نمی‌شود. */

const jobsOf = (data, keep) => data.projects.flatMap((p) => p.jobs.filter(keep).map((j) => ({ p, j })));

/* ---------- بورد (کانبان): هر ستون یک ایستگاه یا یک وضعیت، هر کارت یک کار ---------- */
export function Kanban({ data, busy, run, onJob }) {
  const { canEdit } = data;
  const [by, setBy] = useState("station");
  const [showDone, setShowDone] = useState(false);
  const [over, setOver] = useState(null);
  const all = jobsOf(data, (j) => showDone || j.remaining > 0);
  const columns = by === "station"
    ? data.stations.filter((s) => s.active).map((s) => ({ id: s.id, title: s.name, sub: `${faDigits(s.crew)} نفر`, items: all.filter((x) => x.j.station === s.id) }))
    : JOB_STATUS.filter((s) => showDone || s.id !== "done").map((s) => ({ id: s.id, title: s.label, color: s.color, items: all.filter((x) => x.j.status === s.id) }));

  // کشیدنِ کارت روی ستونِ یک ایستگاه یعنی «این کار در آن ایستگاه انجام شود».
  const drop = (e, col) => {
    e.preventDefault();
    setOver(null);
    const [pid, stage] = (e.dataTransfer.getData("text/plain") || "").split("|");
    const hit = all.find((x) => x.p.id === pid && x.j.stage === stage);
    if (!hit || hit.j.station === col.id) return;
    run(() => productionApi.planTask({ project: pid, stage, station: col.id }));
  };
  const canDrag = canEdit && by === "station" && !busy;

  return (
    <>
      <div className="card plan-bar no-print">
        <span className="plan-chips" style={{ margin: 0 }}>
          <span className="muted sm2">ستون‌ها:</span>
          <button className={by === "station" ? "chip on" : "chip"} onClick={() => setBy("station")}>ایستگاه‌ها</button>
          <button className={by === "status" ? "chip on" : "chip"} onClick={() => setBy("status")}>وضعیت کار</button>
        </span>
        <label className="chk-line" style={{ margin: 0 }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> کارهای انجام‌شده هم
        </label>
        <span className="muted sm2" style={{ flex: 1, textAlign: "end" }}>
          {canDrag ? "کارت را بگیرید و روی ایستگاه دیگری بیندازید تا آن کار آنجا انجام شود." : ""}
        </span>
      </div>
      <div className="kb">
        {columns.map((c) => {
          const rest = c.items.reduce((a, x) => a + x.j.remaining, 0);
          return (
            <div key={c.id} className={`kb-col${over === c.id ? " over" : ""}`}
              onDragOver={(e) => { if (canDrag) { e.preventDefault(); setOver(c.id); } }}
              onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
              onDrop={(e) => canDrag && drop(e, c)}>
              <div className="kb-hd">
                {c.color && <i className="kb-key" style={{ background: c.color }} />}
                <b title={c.title}>{c.title}</b>
                <small>{faDigits(c.items.length)} کار · {num(rest)} م²{c.sub ? ` · ${c.sub}` : ""}</small>
                <StatusBar items={c.items.map((x) => x.j)} />
              </div>
              {c.items.length === 0 ? <div className="kb-empty">کاری نیست</div> : c.items.map(({ p, j }) => (
                <div key={`${p.id}|${j.stage}`} className={`kb-card${canEdit ? " can" : ""}`} draggable={canDrag && j.remaining > 0}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", `${p.id}|${j.stage}`)}
                  onClick={() => canEdit && j.remaining > 0 && onJob(p, j)}
                  style={{ borderInlineStartColor: statusOf(j.status).color }}>
                  <b>{p.label}</b>
                  {(by === "status" || j.stationName !== j.stage) && <div className="kb-stage">{j.stage}</div>}
                  <div className="meter" title={`${faDigits(j.percent)}٪ انجام شده`}><i style={{ width: `${j.percent}%` }} /></div>
                  <small>
                    {j.remaining > 0 ? <>{num(j.remaining)} م² مانده · {faDigits(j.percent)}٪</> : "انجام شد"}
                    {j.ready > 0 && j.remaining > 0 && <> · {num(j.ready)} م² آمادهٔ کار</>}
                  </small>
                  {j.start && <small>{jShort(j.start)} تا {jShort(j.finish)}{j.days != null ? ` · ${faDigits(j.days)} روز` : ""}</small>}
                  <div className="kb-foot">
                    {by === "station" && <StatusDot status={j.status} />}
                    <Slip days={j.slipDays} />
                    {j.together.length > 0 && <span className="pill">با {j.together.map((m) => m.label).join(" و ")}</span>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** نوارِ سهمِ هر وضعیت از یک دسته کار؛ بین تکه‌ها فاصله است و عددها در راهنما و با نگه‌داشتن موس می‌آیند. */
function StatusBar({ items, tall }) {
  if (!items.length) return null;
  const parts = JOB_STATUS.map((s) => ({ ...s, n: items.filter((j) => j.status === s.id).length })).filter((s) => s.n);
  return (
    <div className={tall ? "st-bar tall" : "st-bar"}>
      {parts.map((s) => (
        <i key={s.id} style={{ flexGrow: s.n, background: s.color }} title={`${s.label}: ${faDigits(s.n)} کار از ${faDigits(items.length)}`} />
      ))}
    </div>
  );
}

function StatusLegend({ items }) {
  return (
    <div className="st-legend">
      {JOB_STATUS.map((s) => {
        const n = items.filter((j) => j.status === s.id).length;
        return <span key={s.id} className="st-dot"><i style={{ background: s.color }} />{s.label} <b>{faDigits(n)}</b></span>;
      })}
    </div>
  );
}

/* ---------- تقویم: هر روزِ ماه، کارهای برنامه‌ریزی‌شده یا انجام‌شده ---------- */
const WEEK = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

export function PlanCalendar({ data }) {
  const [ym, setYm] = useState(() => { const j = isoToJ(data.today); return { jy: j.jy, jm: j.jm }; });
  const first = jToIso({ jy: ym.jy, jm: ym.jm, jd: 1 });
  const next = ym.jm === 12 ? { jy: ym.jy + 1, jm: 1 } : { jy: ym.jy, jm: ym.jm + 1 };
  const prev = ym.jm === 1 ? { jy: ym.jy - 1, jm: 12 } : { jy: ym.jy, jm: ym.jm - 1 };
  const len = dayDiff(first, jToIso({ ...next, jd: 1 }));
  const lead = (toDate(first).getDay() + 1) % 7;                       // چند خانهٔ خالی پیش از روز اول (شنبه = ۰)
  const days = Array.from({ length: len }, (_, i) => addDays(first, i));
  const live = Object.fromEntries(data.days.map((d) => [d.date, d.lines]));
  const done = Object.fromEntries(data.history.map((d) => [d.date, d.lines]));
  const planned = Object.fromEntries(data.past.map((d) => [d.date, d]));
  const colors = Object.fromEntries(data.projects.map((p, i) => [p.id, Math.min(i, 6)]));

  return (
    <>
      <div className="card plan-bar no-print">
        <button className="ghost" onClick={() => setYm(prev)}>ماه قبل ›</button>
        <b style={{ flex: 1, textAlign: "center" }}>{J_MONTHS[ym.jm - 1]} {faDigits(ym.jy)}</b>
        <button className="ghost" onClick={() => { const j = isoToJ(data.today); setYm({ jy: j.jy, jm: j.jm }); }}>این ماه</button>
        <button className="ghost" onClick={() => setYm(next)}>‹ ماه بعد</button>
      </div>
      <div className="card table-scroll" style={{ padding: 0 }}>
        <div className="cal">
          {WEEK.map((w) => <div key={w} className="cal-hd">{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} className="cal-day blank" />)}
          {days.map((d) => {
            const info = dayInfo(data, d);
            const off = info.base + info.overtime <= 0;
            const past = d < data.start;
            const lines = past ? (done[d] || []) : (live[d] || []);
            const plan = past ? planned[d] : null;
            return (
              <div key={d} className={`cal-day${off ? " off" : ""}${d === data.today ? " today" : ""}${past ? " past" : ""}`} title={jLong(d)}>
                <div className="cal-num">
                  <b>{faDigits(isoToJ(d).jd)}</b>
                  <small>
                    {off ? "تعطیل" : info.overtime ? `+${faDigits(info.overtime)} ساعت` : info.base < 8 ? "نیم‌روز" : ""}
                    {info.leave.length > 0 && ` · مرخصی: ${info.leave.join("، ")}`}
                  </small>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className={`cal-ev c${colors[l.projectId] ?? 6}${past ? " done" : ""}`}
                    title={`${l.project} — ${l.stage}: ${num(l.area)} م²${past ? " (انجام‌شده)" : ` · ${faDigits(l.people)} نفر`}`}>
                    <b>{l.project}</b> {l.stage} <span>{num(l.area)} م²</span>
                  </div>
                ))}
                {plan && plan.percent != null && (
                  <div className="cal-plan">برنامه {num(plan.planned)} م² · تحقق {faDigits(plan.percent)}٪</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="st-legend">
        {data.projects.map((p) => <span key={p.id} className="st-dot"><i className={`cal-key c${colors[p.id]}`} />{p.label}</span>)}
        <span className="muted sm2">روزهای گذشته کارِ ثبت‌شده را نشان می‌دهند (کم‌رنگ)؛ روزهای پیشِ رو برنامه را.</span>
      </div>
    </>
  );
}

/* ---------- داشبورد پروژه‌ها: یک نگاه به وضعیت هر پروژه ---------- */
export function ProjectsDash({ data }) {
  const [open, setOpen] = useState(null);
  const all = data.projects.flatMap((p) => p.jobs);
  if (data.projects.length === 0) return <Empty art="production">پروژهٔ بازی که مرحله و متراژ داشته باشد نیست.</Empty>;
  return (
    <>
      <div className="card">
        <div className="board-h">همهٔ کارهای پروژه‌های باز</div>
        <StatusBar items={all} tall />
        <StatusLegend items={all} />
      </div>
      <div className="dash-grid">
        {data.projects.map((p) => {
          const left = p.finish ? dayDiff(data.today, p.finish) : null;
          return (
            <div className="card dash-card" key={p.id}>
              <div className="prod-hd">
                <div className="prod-name"><span className="plan-rank">{faDigits(p.order)}</span><b>{p.label}</b></div>
                <Slip days={p.slipDays} />
              </div>
              {p.owner && <div className="muted sm2">کارفرما: {p.owner}</div>}
              <div className="dash-pct">
                <b>{faDigits(Math.round(p.percent))}٪</b>
                <div className="meter big" title={`پیشرفت ${faDigits(p.percent)}٪`}><i style={{ width: `${Math.min(p.percent, 100)}%` }} /></div>
              </div>
              <div className="dash-nums">
                <div><span>مانده</span><b>{num(p.remaining)} م²</b></div>
                <div><span>کارِ مانده</span><b>{faDigits(Math.round(p.hours))} نفر-ساعت</b></div>
                <div><span>ساعتِ صرف‌شده</span><b>{faDigits(Math.round(p.spentHours))}</b></div>
                <div><span>پایان پیش‌بینی</span><b>{p.finish ? jShort(p.finish) : "—"}</b>{left != null && <small>{faDigits(Math.max(left, 0))} روز دیگر</small>}</div>
                <div><span>قول تحویل</span><b>{p.dueDate ? jShort(p.dueDate) : "وارد نشده"}</b>
                  {p.onTime === true && <small>{faDigits(p.slackDays)} روز زودتر</small>}
                  {p.onTime === false && <small className="bad">{faDigits(-p.slackDays)} روز دیرتر</small>}
                </div>
                <div><span>در برنامهٔ ثبت‌شده</span><b>{p.baselineFinish ? jShort(p.baselineFinish) : "—"}</b></div>
              </div>
              <div className="muted sm2" style={{ marginBottom: 4 }}>وضعیت {faDigits(p.jobs.length)} مرحله</div>
              <StatusBar items={p.jobs} tall />
              <StatusLegend items={p.jobs} />
              <button className="linkish" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "بستن مراحل" : "جدول مراحل"}</button>
              {open === p.id && (
                <div className="table-scroll">
                  <table className="mini-table" style={{ marginTop: 6 }}>
                    <thead><tr><th>مرحله</th><th>وضعیت</th><th>پیشرفت</th><th>مانده (م²)</th><th>تا</th></tr></thead>
                    <tbody>
                      {p.jobs.map((j) => (
                        <tr key={j.stage}>
                          <td>{j.stage}</td>
                          <td><StatusDot status={j.status} /></td>
                          <td><div className="meter" style={{ width: 90 }}><i style={{ width: `${j.percent}%` }} /></div> {faDigits(j.percent)}٪</td>
                          <td>{j.remaining > 0 ? num(j.remaining) : "—"}</td>
                          <td>{j.finish ? jShort(j.finish) : j.actualEnd ? jShort(j.actualEnd) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
