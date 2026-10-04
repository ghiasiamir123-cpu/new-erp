import { useState, useEffect, useMemo } from "react";
import { productionApi } from "../api.js";
import { Empty, JalaliPicker, J_MONTHS, WhyOff, faDigits, isoToJ, jLong, jShort, pad, round2 } from "../shared/core.jsx";

/* ============ برنامه‌ریزی تولید ============
   منطق در backend/core/planning.py است. نرم‌افزار کارِ باقیمانده را روی ایستگاه‌ها می‌چیند و پیشنهاد
   می‌دهد؛ مسئول برنامه‌ریزی مدت، ایستگاه، ترتیب، اضافه‌کاری و مرخصی را عوض می‌کند و برنامه را «ثبت»
   می‌کند تا انحراف از آن سنجیده شود. هر تغییر، کلِ برنامهٔ تازه را از سرور برمی‌گرداند. */

const NO_STATION = "0";
const DAY_W = 26;                 // پهنای هر روز در نمودار گانت (px)
const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
const WD_SHORT = ["ی", "د", "س", "چ", "پ", "ج", "ش"];

const toDate = (iso) => new Date(`${iso}T12:00:00`);
const iso10 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return iso10(d); };
const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const weekStart = (iso) => addDays(iso, -((toDate(iso).getDay() + 1) % 7));   // شنبهٔ همان هفته
const baseHours = (iso) => { const wd = toDate(iso).getDay(); return wd === 5 ? 0 : wd === 4 ? 4 : 8; };
const num = (n) => faDigits(round2(n));

const VIEWS = [
  { id: "gantt", label: "نمودار زمانی (گانت)" },
  { id: "board", label: "برنامهٔ روزانهٔ ایستگاه‌ها" },
  { id: "stations", label: "ایستگاه‌ها و کارها" },
  { id: "deviation", label: "انحراف از برنامه" },
];

function Tile({ label, value, tone, sub }) {
  return (
    <div className={tone ? `prod-tile ${tone}` : "prod-tile"}>
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function Slip({ days }) {
  if (days == null) return null;
  if (days > 0) return <span className="pill bad">{faDigits(days)} روز عقب</span>;
  if (days < 0) return <span className="pill ok">{faDigits(-days)} روز جلو</span>;
  return <span className="pill ok">طبق برنامه</span>;
}

/** اضافه‌کاری و مرخصیِ یک روز، برای سرستون‌ها (روزهایی که در زمان‌بندی نیستند هم همین را می‌خواهند). */
function dayInfo(data, iso) {
  const overtime = data.overtime.filter((o) => o.date === iso).reduce((a, o) => a + o.hours, 0);
  const leave = data.leaves.filter((l) => l.from <= iso && iso <= l.to).map((l) => l.employee);
  return { base: baseHours(iso), overtime, leave };
}

export function ProdSchedule() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("gantt");
  const [dialog, setDialog] = useState(null);       // {kind, ...}

  useEffect(() => { productionApi.plan().then(setData).catch((e) => setErr(e.message)); }, []);

  /** هر تغییر را می‌فرستد و برنامهٔ تازه را می‌نشاند؛ خطا را به صدازننده برمی‌گرداند. */
  async function run(call) {
    if (busy) return false;
    setBusy(true);
    try { setData(await call()); return true; }
    catch (e) { alert(e.message); return false; }
    finally { setBusy(false); }
  }

  if (err) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;

  const { totals: t, settings: s, deviation: dev, canEdit } = data;
  const move = (index, step) => {
    const ids = data.projects.map((p) => p.id);
    const to = index + step;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    run(() => productionApi.planOrder(ids));
  };

  return (
    <>
      <div className="prod-tiles">
        <Tile label="پایان همهٔ کارها" tone={t.unfinished ? "bad" : "ok"}
          value={t.finish ? jShort(t.finish) : t.unfinished ? "خارج از افق برنامه" : "—"}
          sub={`${num(t.area)} م² · ${faDigits(Math.round(t.hours))} نفر-ساعت مانده`} />
        <Tile label="نسبت به برنامهٔ ثبت‌شده" tone={t.behind ? "bad" : data.baseline ? "ok" : ""}
          value={!data.baseline ? "ثبت نشده" : t.behind ? `${faDigits(t.behind)} پروژه عقب` : "طبق برنامه"}
          sub={t.slipMax > 0 ? `بیشترین عقب‌افتادگی ${faDigits(t.slipMax)} روز` : ""} />
        <Tile label="تحقق برنامهٔ روزانه" tone={dev && dev.avgPercent < 80 ? "bad" : dev ? "ok" : ""}
          value={dev ? `${faDigits(dev.avgPercent)}٪` : "—"}
          sub={dev ? `${faDigits(dev.days)} روز · انحراف معیار ${faDigits(dev.stdPercent)}٪` : "هنوز روزی از برنامهٔ ثبت‌شده نگذشته"} />
        <Tile label="نفرات امروز" value={`${faDigits(s.presentToday)} از ${faDigits(s.crew)}`}
          sub={s.leaveToday.length ? `مرخصی: ${s.leaveToday.join("، ")}` : "کسی مرخصی نیست"} />
      </div>

      <div className="card plan-bar no-print">
        <div className="muted sm2" style={{ flex: 1, minWidth: 220 }}>
          {data.baseline
            ? <>برنامه را <b>{data.baseline.by}</b> در {jShort(String(data.baseline.at).slice(0, 10))} ثبت کرده است{data.baseline.note ? ` — ${data.baseline.note}` : ""}. آنچه می‌بینید زمان‌بندیِ همین لحظه است؛ اختلافش با برنامهٔ ثبت‌شده «انحراف» است.</>
            : <>این زمان‌بندی پیشنهاد نرم‌افزار است. مدت‌ها، ترتیب و ایستگاه‌ها را اصلاح کنید و بعد «ثبت برنامه» را بزنید تا انحراف از آن سنجیده شود.</>}
        </div>
        {canEdit && (
          <div className="dash-acts">
            <button className="ghost" onClick={() => setDialog({ kind: "overtime" })}>اضافه‌کاری</button>
            <button className="ghost" onClick={() => setDialog({ kind: "leave" })}>مرخصی</button>
            <button className="submit" onClick={() => setDialog({ kind: "commit" })}>ثبت برنامه</button>
          </div>
        )}
        <button className="ghost" onClick={() => window.print()}>چاپ</button>
      </div>

      {data.warnings.map((w, i) => <div className="notice warn" key={i}>{w}</div>)}

      <div className="sub-tabs no-print">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "sub-tab on" : "sub-tab"} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </div>

      {view === "gantt" && <Gantt data={data} busy={busy} onMove={move} onJob={(project, job) => setDialog({ kind: "job", project, job })} />}
      {view === "board" && <Board data={data} />}
      {view === "stations" && <StationsView data={data} busy={busy} run={run} />}
      {view === "deviation" && <Deviation data={data} />}

      {dialog?.kind === "job" && (
        <JobDialog data={data} project={dialog.project} job={dialog.job} busy={busy} onClose={() => setDialog(null)}
          onSave={async (body) => { if (await run(() => productionApi.planTask(body))) setDialog(null); }} />
      )}
      {dialog?.kind === "overtime" && <OvertimeDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "leave" && <LeaveDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "commit" && (
        <CommitDialog data={data} busy={busy} onClose={() => setDialog(null)}
          onSave={async (note) => { if (await run(() => productionApi.planCommit(note))) setDialog(null); }} />
      )}
    </>
  );
}

/* ---------- نمودار گانت: هر پروژه و مرحله‌هایش روی تقویم ---------- */
function Gantt({ data, busy, onMove, onJob }) {
  const { canEdit } = data;
  const range = useMemo(() => {
    const dates = [data.today, data.start];
    data.projects.forEach((p) => {
      [p.start, p.finish, p.baselineFinish, p.dueDate].forEach((d) => d && dates.push(d));
      p.jobs.forEach((j) => [j.start, j.finish, j.baselineFinish].forEach((d) => d && dates.push(d)));
    });
    const first = addDays(data.today, -2);
    let last = dates.reduce((a, d) => (d > a ? d : a), data.today);
    if (dayDiff(first, last) > 120) last = addDays(first, 120);      // نمودار بی‌انتها نشود
    const n = dayDiff(first, last) + 3;
    return { first, days: Array.from({ length: n }, (_, i) => addDays(first, i)) };
  }, [data]);

  if (data.projects.length === 0) return <Empty art="production">پروژهٔ بازی که مرحله و متراژ داشته باشد نیست.</Empty>;

  const col = (iso) => dayDiff(range.first, iso);
  const width = range.days.length * DAY_W;
  const months = [];
  range.days.forEach((d) => {
    const j = isoToJ(d);
    const key = `${j.jy}-${j.jm}`;
    if (months.length && months[months.length - 1].key === key) months[months.length - 1].n += 1;
    else months.push({ key, label: `${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`, n: 1 });
  });

  const Track = ({ children }) => (
    <div className="g-track" style={{ width }}>
      {range.days.map((d) => (
        <i key={d} className={`g-cell${toDate(d).getDay() === 5 ? " fri" : ""}${d === data.today ? " today" : ""}`} />
      ))}
      {children}
    </div>
  );
  const bar = (start, finish, cls, title, text) => {
    if (!start || !finish) return null;
    const a = Math.max(col(start), 0), b = Math.min(col(finish), range.days.length - 1);
    if (b < a) return null;
    return (
      <div className={`g-bar ${cls}`} title={title} style={{ insetInlineStart: a * DAY_W + 2, width: (b - a + 1) * DAY_W - 4 }}>
        {text}
      </div>
    );
  };
  const mark = (iso, cls, title) => {
    if (!iso) return null;
    const c = col(iso);
    if (c < 0 || c >= range.days.length) return null;
    return <div className={`g-mark ${cls}`} title={title} style={{ insetInlineStart: c * DAY_W + DAY_W / 2 - 5 }} />;
  };

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="gantt">
        <div className="g-row g-head">
          <div className="g-label">پروژه / مرحله</div>
          <div style={{ width }}>
            <div className="g-months">
              {months.map((m) => <span key={m.key} style={{ width: m.n * DAY_W }}>{m.n >= 3 ? m.label : ""}</span>)}
            </div>
            <div className="g-days">
              {range.days.map((d) => (
                <span key={d} className={`${toDate(d).getDay() === 5 ? "fri" : ""}${d === data.today ? " today" : ""}`}
                  title={jLong(d)}>
                  <small>{WD_SHORT[toDate(d).getDay()]}</small>{faDigits(isoToJ(d).jd)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {data.projects.map((p, i) => (
          <div key={p.id}>
            <div className="g-row g-project">
              <div className="g-label">
                {canEdit && (
                  <span className="plan-arrows no-print">
                    <button disabled={busy || i === 0} onClick={() => onMove(i, -1)} title="اولویت بالاتر">▲</button>
                    <button disabled={busy || i === data.projects.length - 1} onClick={() => onMove(i, 1)} title="اولویت پایین‌تر">▼</button>
                  </span>
                )}
                <span className="plan-rank">{faDigits(p.order)}</span>
                <b title={p.name}>{p.label}</b>
                <Slip days={p.slipDays} />
              </div>
              <Track>
                {bar(p.start, p.finish, `project${p.slipDays > 0 ? " late" : ""}`,
                  `${p.label}: ${p.start ? jShort(p.start) : ""} تا ${p.finish ? jShort(p.finish) : ""}`,
                  p.finish ? `تا ${jShort(p.finish)}` : "")}
                {mark(p.baselineFinish, "base", `پایان در برنامهٔ ثبت‌شده: ${p.baselineFinish ? jShort(p.baselineFinish) : ""}`)}
                {mark(p.dueDate, "due", `قول تحویل: ${p.dueDate ? jShort(p.dueDate) : ""}`)}
              </Track>
            </div>
            {p.jobs.filter((j) => j.remaining > 0).map((j) => (
              <div className={`g-row g-job${canEdit ? " can" : ""}`} key={j.stage} onClick={() => canEdit && onJob(p, j)}>
                <div className="g-label">
                  <span className="g-stage" title={j.stage}>{j.stage}</span>
                  <small className="muted">
                    {j.stationName || "بی‌ایستگاه"} · {j.days != null ? `${faDigits(j.days)} روز` : "مدت نامعلوم"}
                    {j.manual ? " ✎" : ""}
                  </small>
                </div>
                <Track>
                  {bar(j.start, j.finish, `job${j.slipDays > 0 ? " late" : ""}${j.manual ? " manual" : ""}`,
                    `${j.stage} — ${num(j.remaining)} م² · ${j.start ? jShort(j.start) : ""} تا ${j.finish ? jShort(j.finish) : ""}`,
                    `${num(j.remaining)} م²`)}
                  {mark(j.baselineFinish, "base", `پایان در برنامهٔ ثبت‌شده: ${j.baselineFinish ? jShort(j.baselineFinish) : ""}`)}
                </Track>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="g-legend muted sm2">
        <span><i className="g-key project" /> پروژه</span>
        <span><i className="g-key job" /> مرحله (پیشنهاد سیستم)</span>
        <span><i className="g-key job manual" /> مدتِ دستیِ مسئول ✎</span>
        <span><i className="g-key late" /> عقب‌تر از برنامهٔ ثبت‌شده</span>
        <span><i className="g-mark base still" /> پایان در برنامهٔ ثبت‌شده</span>
        <span><i className="g-mark due still" /> قول تحویل</span>
        {canEdit && <span>برای تغییر مدت، ایستگاه یا زمان شروع، روی هر مرحله بزنید.</span>}
      </div>
    </div>
  );
}

/* ---------- برنامهٔ روزانه: ایستگاه × روزهای هفته ---------- */
function Board({ data }) {
  const [from, setFrom] = useState(() => weekStart(data.today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const stations = data.stations.filter((s) => s.active);
  const rows = [...stations, ...(data.freeStation || !stations.length ? [{ id: NO_STATION, name: stations.length ? "بدون ایستگاه" : "کل کارگاه", crew: "" }] : [])];
  const live = Object.fromEntries(data.days.map((d) => [d.date, d]));
  const past = Object.fromEntries(data.past.map((d) => [d.date, d]));

  const cell = (station, iso) => {
    if (iso < data.start) {
      const lines = (past[iso]?.lines || []).filter((l) => l.station === station.id);
      return lines.map((l, i) => (
        <div className={`plan-line ${l.actual + 0.05 >= l.planned ? "done" : "short"}`} key={i}>
          <b>{l.project}</b> {l.stage}
          <small>برنامه {num(l.planned)} م² · انجام {num(l.actual)} م²</small>
        </div>
      ));
    }
    const lines = (live[iso]?.lines || []).filter((l) => l.station === station.id);
    return lines.map((l, i) => (
      <div className="plan-line" key={i}>
        <b>{l.project}</b> {l.stage}
        <small>{num(l.area)} م² · {faDigits(l.people)} نفر{l.share < 0.95 ? ` · ${faDigits(Math.round(l.share * 100))}٪ روز` : ""}</small>
      </div>
    ));
  };

  return (
    <>
      <div className="card plan-bar no-print">
        <button className="ghost" onClick={() => setFrom(addDays(from, -7))}>هفتهٔ قبل ›</button>
        <b style={{ flex: 1, textAlign: "center" }}>{jShort(days[0])} تا {jShort(days[6])}</b>
        <button className="ghost" onClick={() => setFrom(weekStart(data.today))}>این هفته</button>
        <button className="ghost" onClick={() => setFrom(addDays(from, 7))}>‹ هفتهٔ بعد</button>
      </div>
      <div className="card table-scroll" style={{ padding: 0 }}>
        <table className="plan-grid print-table">
          <thead>
            <tr>
              <th>ایستگاه</th>
              {days.map((d) => {
                const info = dayInfo(data, d);
                const off = info.base + info.overtime <= 0;
                return (
                  <th key={d} className={`${d === data.today ? "today" : ""}${off ? " off" : ""}`}>
                    {WEEKDAYS[toDate(d).getDay()]} <span>{jShort(d)}</span>
                    <small>
                      {off ? "تعطیل" : `${faDigits(info.base)} ساعت${info.overtime ? ` + ${faDigits(info.overtime)} اضافه‌کاری` : ""}`}
                      {info.leave.length > 0 && ` · مرخصی: ${info.leave.join("، ")}`}
                    </small>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((st) => (
              <tr key={st.id}>
                <th>{st.name}{st.crew ? <small>{faDigits(st.crew)} نفر</small> : null}</th>
                {days.map((d) => {
                  const info = dayInfo(data, d);
                  return (
                    <td key={d} className={`${d === data.today ? "today" : ""}${info.base + info.overtime <= 0 ? " off" : ""}${d < data.start ? " past" : ""}`}>
                      {cell(st, d)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted sm2">
        روزهای پیشِ رو زمان‌بندیِ همین لحظه‌اند و با هر گزارشِ تازه جابه‌جا می‌شوند. روزهای گذشته برنامهٔ ثبت‌شده را کنار کارِ واقعی نشان می‌دهند
        (سبز: انجام شد، نارنجی: کمتر از برنامه).
      </div>
    </>
  );
}

/* ---------- ایستگاه‌ها و کارها: هر مرحله و هر کار در کدام ایستگاه ---------- */
function StationsView({ data, busy, run }) {
  const { canEdit } = data;
  const fresh = () => data.stations.map((s) => ({ ...s, stages: [...s.stages], people: [...s.people], key: s.id }));
  const [rows, setRows] = useState(fresh);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setRows(fresh()); setDirty(false); }, [data.stations]);   // eslint-disable-line react-hooks/exhaustive-deps

  const change = (fn) => { setRows(fn); setDirty(true); };
  const set = (key, patch) => change((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => change((p) => [...p, { key: `n${Date.now()}`, name: "", crew: 1, stages: [], people: [], active: true }]);
  const swap = (i, step) => change((p) => {
    const q = [...p], to = i + step;
    if (to < 0 || to >= q.length) return p;
    [q[i], q[to]] = [q[to], q[i]];
    return q;
  });
  // هر مرحله فقط در یک ایستگاه: انتخابِ ایستگاه تازه آن را از قبلی برمی‌دارد.
  const assign = (stage, key) => change((p) => p.map((r) => ({
    ...r, stages: r.key === key ? [...r.stages.filter((s) => s !== stage), stage] : r.stages.filter((s) => s !== stage),
  })));
  const stationOf = (stage) => rows.find((r) => r.stages.includes(stage))?.key || "";
  const perStage = () => change(() => data.stageNames.map((s, i) => ({ key: `n${i}`, name: s, crew: 1, stages: [s], people: [], active: true })));

  const nameless = rows.some((r) => !r.name.trim());
  const save = () => run(() => productionApi.planStations(rows.map((r) => ({
    id: /^\d+$/.test(r.key) ? r.key : null, name: r.name.trim(), crew: Number(r.crew) || 1,
    stages: r.stages, people: r.people, active: r.active,
  }))));

  const jobs = data.projects.flatMap((p) => p.jobs.filter((j) => j.remaining > 0).map((j) => ({ p, j })));
  const active = data.stations.filter((s) => s.active);

  return (
    <>
      <div className="card">
        <div className="board-h">ایستگاه‌های کارگاه</div>
        <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
          هر ایستگاه جایی است که کار انجام می‌شود (کابین رنگ، میز پرداخت، …). «نفرات» یعنی چند نفر هم‌زمان در آن کار می‌کنند؛
          اگر نام نفرات ثابتش را انتخاب کنید، مرخصیِ هر کدام همان روز از توان همان ایستگاه کم می‌کند.
        </div>
        {rows.length === 0 && (
          <div className="notice warn">
            هنوز ایستگاهی تعریف نشده و نرم‌افزار کل کارگاه را یک ایستگاه گرفته است.
            {canEdit && <> ایستگاه‌ها را یکی‌یکی بسازید، یا برای شروع <button className="linkish" onClick={perStage}>برای هر مرحله یک ایستگاه بساز</button> و بعد اصلاحشان کنید.</>}
          </div>
        )}
        {rows.map((r, i) => (
          <div className="item-row" key={r.key}>
            <div className="item-num">{faDigits(i + 1)}</div>
            <div className="item-body">
              <div className="row3">
                <label className="fld sm"><span>نام ایستگاه</span>
                  <input value={r.name} disabled={!canEdit} placeholder="مثلاً: کابین رنگ ۱" onChange={(e) => set(r.key, { name: e.target.value })} />
                </label>
                <label className="fld sm"><span>نفرات هم‌زمان</span>
                  <input type="number" inputMode="numeric" min="1" disabled={!canEdit || r.people.length > 0}
                    value={r.people.length || r.crew} onChange={(e) => set(r.key, { crew: e.target.value })} />
                </label>
                <label className="fld sm"><span>وضعیت</span>
                  <select value={r.active ? "1" : "0"} disabled={!canEdit} onChange={(e) => set(r.key, { active: e.target.value === "1" })}>
                    <option value="1">فعال</option><option value="0">غیرفعال</option>
                  </select>
                </label>
              </div>
              <div className="plan-chips">
                <span className="muted sm2">نفرات ثابت (اختیاری):</span>
                {data.employees.map((e) => (
                  <button key={e} disabled={!canEdit} className={r.people.includes(e) ? "chip on" : "chip"}
                    onClick={() => set(r.key, { people: r.people.includes(e) ? r.people.filter((x) => x !== e) : [...r.people, e] })}>{e}</button>
                ))}
              </div>
              <div className="muted sm2">مرحله‌های این ایستگاه: {r.stages.length ? r.stages.join("، ") : "هنوز هیچ"}</div>
            </div>
            {canEdit && (
              <div className="plan-arrows">
                <button disabled={i === 0} onClick={() => swap(i, -1)}>▲</button>
                <button disabled={i === rows.length - 1} onClick={() => swap(i, 1)}>▼</button>
                <button title="حذف ایستگاه" onClick={() => change((p) => p.filter((x) => x.key !== r.key))}>×</button>
              </div>
            )}
          </div>
        ))}
        {canEdit && <button className="add-row" onClick={add}>+ ایستگاه تازه</button>}

        {rows.length > 0 && (
          <>
            <div className="board-h" style={{ marginTop: 16 }}>هر مرحله در کدام ایستگاه انجام می‌شود؟</div>
            <table className="mini-table">
              <thead><tr><th>مرحله</th><th>ایستگاه</th></tr></thead>
              <tbody>
                {data.stageNames.map((stage) => (
                  <tr key={stage}>
                    <td>{stage}</td>
                    <td>
                      <select value={stationOf(stage)} disabled={!canEdit} onChange={(e) => assign(stage, e.target.value)}>
                        <option value="">— هیچ‌کدام —</option>
                        {rows.map((r) => <option key={r.key} value={r.key}>{r.name || "(بی‌نام)"}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {canEdit && (
          <>
            <button className="section-save" disabled={busy || !dirty || nameless} onClick={save}>ذخیرهٔ ایستگاه‌ها</button>
            <WhyOff busy={busy} reasons={[!dirty && "چیزی عوض نشده", nameless && "نام یک ایستگاه خالی است"]} />
          </>
        )}
      </div>

      <div className="card">
        <div className="board-h">کارهای پیشِ رو — ایستگاهِ هر کار</div>
        <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
          هر کار به‌طور پیش‌فرض به ایستگاهِ مرحله‌اش می‌رود. اگر کاری از یک پروژه باید در ایستگاه دیگری انجام شود، همین‌جا عوضش کنید.
        </div>
        {jobs.length === 0 ? <div className="empty">کاری نمانده.</div> : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead><tr><th>پروژه</th><th>مرحله</th><th>مانده (م²)</th><th>ایستگاه</th></tr></thead>
              <tbody>
                {jobs.map(({ p, j }) => (
                  <tr key={`${p.id}|${j.stage}`}>
                    <td>{p.label}</td>
                    <td>{j.stage}</td>
                    <td>{num(j.remaining)}</td>
                    <td>
                      <select disabled={!canEdit || busy || dirty} value={j.stationFixed ? j.station : ""}
                        title={dirty ? "اول ایستگاه‌ها را ذخیره کنید" : ""}
                        onChange={(e) => run(() => productionApi.planTask({ project: p.id, stage: j.stage, station: e.target.value || null }))}>
                        <option value="">طبق مرحله{j.stationFixed ? "" : ` (${j.stationName || "بی‌ایستگاه"})`}</option>
                        {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- انحراف از برنامهٔ ثبت‌شده ---------- */
function Deviation({ data }) {
  const [open, setOpen] = useState(null);
  if (!data.baseline) {
    return (
      <div className="notice warn">
        هنوز برنامه‌ای ثبت نشده است. بعد از «ثبت برنامه»، اینجا می‌بینید هر پروژه چند روز از آن عقب یا جلوست و هر روز چقدر از برنامه‌اش انجام شده.
      </div>
    );
  }
  const dev = data.deviation;
  return (
    <>
      <div className="card">
        <div className="board-h">پروژه‌ها در برابر برنامهٔ ثبت‌شده</div>
        <div className="table-scroll">
          <table className="mini-table">
            <thead><tr><th>پروژه / مرحله</th><th>پایان در برنامه</th><th>پایان با وضع امروز</th><th>انحراف</th></tr></thead>
            <tbody>
              {data.projects.map((p) => [
                <tr key={p.id} className="plan-strong">
                  <td>{p.label}</td>
                  <td>{p.baselineFinish ? jShort(p.baselineFinish) : "در برنامه نبود"}</td>
                  <td>{p.finish ? jShort(p.finish) : "خارج از افق"}</td>
                  <td><Slip days={p.slipDays} /></td>
                </tr>,
                ...p.jobs.filter((j) => j.remaining > 0).map((j) => (
                  <tr key={`${p.id}|${j.stage}`}>
                    <td style={{ paddingInlineStart: 22 }}>{j.stage}</td>
                    <td>{j.baselineFinish ? jShort(j.baselineFinish) : "—"}</td>
                    <td>{j.finish ? jShort(j.finish) : "—"}</td>
                    <td><Slip days={j.slipDays} /></td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="board-h">روزهای گذشته: برنامه در برابر کارِ انجام‌شده</div>
        {!dev ? <div className="empty">هنوز روزی از برنامهٔ ثبت‌شده نگذشته است.</div> : (
          <>
            <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
              در {faDigits(dev.days)} روز، از {num(dev.planned)} م² برنامه {num(dev.actual)} م² انجام شده؛ میانگین تحقق روزانه {faDigits(dev.avgPercent)}٪
              و انحراف معیار آن {faDigits(dev.stdPercent)}٪ است (هر چه کمتر، روزها یکنواخت‌تر).
            </div>
            <div className="table-scroll">
              <table className="mini-table">
                <thead><tr><th>روز</th><th>برنامه (م²)</th><th>انجام‌شده (م²)</th><th>تحقق</th><th>کارِ خارج از برنامه (م²)</th><th /></tr></thead>
                <tbody>
                  {[...data.past].reverse().map((d) => [
                    <tr key={d.date}>
                      <td>{jLong(d.date)}</td>
                      <td>{num(d.planned)}</td>
                      <td>{num(d.actual)}</td>
                      <td>{d.percent == null ? "—" : <span className={`pill ${d.percent >= 90 ? "ok" : "bad"}`}>{faDigits(d.percent)}٪</span>}</td>
                      <td>{d.unplanned ? num(d.unplanned) : ""}</td>
                      <td><button className="linkish" onClick={() => setOpen(open === d.date ? null : d.date)}>{open === d.date ? "بستن" : "ریز"}</button></td>
                    </tr>,
                    open === d.date && d.lines.map((l, i) => (
                      <tr key={`${d.date}-${i}`} className="muted">
                        <td style={{ paddingInlineStart: 22 }}>{l.stationName || "—"} · {l.project} — {l.stage}</td>
                        <td>{num(l.planned)}</td>
                        <td>{num(l.actual)}</td>
                        <td colSpan={3} />
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ---------- پنجره‌ها ---------- */
function Overlay({ title, busy, onClose, wide, children }) {
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={wide ? "wh-dialog wide" : "wh-dialog"}>
        <div className="board-h">{title}</div>
        {children}
      </div>
    </div>
  );
}

function JobDialog({ data, project, job, busy, onClose, onSave }) {
  const [days, setDays] = useState(job.manual && job.days != null ? String(job.days) : "");
  const [notBefore, setNotBefore] = useState(job.notBefore || "");
  const [station, setStation] = useState(job.stationFixed ? job.station : "");
  const n = Number(days);
  const bad = days !== "" && !(n > 0);
  const body = () => ({ project: project.id, stage: job.stage, days: days === "" ? null : n, notBefore: notBefore || null, station: station || null });

  return (
    <Overlay title={`${project.label} — ${job.stage}`} busy={busy} onClose={onClose}>
      <div className="quote-box" style={{ marginTop: 0 }}>
        <div className="quote-row"><span>کارِ مانده</span><b>{num(job.remaining)} م²</b><small>از {num(job.planned)} م²</small></div>
        <div className="quote-row">
          <span>پیشنهاد نرم‌افزار</span>
          <b>{job.suggestedDays != null ? `${faDigits(job.suggestedDays)} روز` : "نامعلوم"}</b>
          <small>
            {job.suggestedDaily ? `${num(job.suggestedDaily)} م² در روز با ${faDigits(job.crew)} نفر` : "سابقه‌ای برای این مرحله نیست"}
            {job.suggestedDaily && !job.measured ? " (تخمینی)" : ""}
          </small>
        </div>
        <div className="quote-row main">
          <span>در برنامهٔ فعلی</span>
          <b>{job.start ? `${jShort(job.start)} تا ${jShort(job.finish)}` : "زمانی نگرفته"}</b>
          <small>{job.baselineFinish ? `برنامهٔ ثبت‌شده: تا ${jShort(job.baselineFinish)}` : ""}</small>
        </div>
      </div>
      <label className="fld"><span>چند روز کاری برای این کار در نظر بگیریم؟</span>
        <input type="number" inputMode="decimal" value={days} placeholder={job.suggestedDays != null ? `${faDigits(job.suggestedDays)} (پیشنهاد نرم‌افزار)` : "تعداد روز"}
          onChange={(e) => setDays(e.target.value)} />
      </label>
      {days !== "" && n > 0 && (
        <div className="hint-remaining">یعنی روزی {num(job.remaining / n)} م². اگر روزی کمتر از این کار شود، باقیمانده خودش روزهای بعد را عقب می‌برد.</div>
      )}
      <div className="row2">
        <label className="fld sm"><span>زودتر از این روز شروع نشود</span>
          <JalaliPicker value={notBefore} onChange={setNotBefore} placeholder="بدون محدودیت" />
        </label>
        <label className="fld sm"><span>ایستگاه</span>
          <select value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="">طبق مرحله{job.stationFixed ? "" : ` (${job.stationName || "بی‌ایستگاه"})`}</option>
            {data.stations.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      {notBefore && <button className="linkish" onClick={() => setNotBefore("")}>برداشتن تاریخِ «زودتر شروع نشود»</button>}
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        {(job.manual || job.notBefore || job.stationFixed) && (
          <button className="ghost" disabled={busy}
            onClick={() => onSave({ project: project.id, stage: job.stage, days: null, notBefore: null, station: null })}>برگرد به پیشنهاد نرم‌افزار</button>
        )}
        <button className="submit" disabled={busy || bad} onClick={() => onSave(body())}>ذخیره</button>
      </div>
      <WhyOff busy={busy} reasons={[bad && "تعداد روز باید بزرگ‌تر از صفر باشد"]} />
    </Overlay>
  );
}

function OvertimeDialog({ data, busy, run, onClose }) {
  const [date, setDate] = useState(data.today);
  const [hours, setHours] = useState("");
  const [people, setPeople] = useState("");
  const ok = date && Number(hours) > 0 && Number(hours) <= 12;
  const add = async () => {
    if (await run(() => productionApi.planOvertime({ date, hours: Number(hours), people: people === "" ? null : Number(people) }))) setHours("");
  };
  return (
    <Overlay title="اضافه‌کاری" busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        ساعتِ اضافهٔ هر روز به توان همان روز افزوده می‌شود. جمعه تعطیل است؛ اگر جمعه‌ای کار می‌شود، برای همان جمعه ساعت بدهید.
      </div>
      {data.overtime.length === 0 ? <div className="empty">اضافه‌کاری‌ای ثبت نشده.</div> : data.overtime.map((o) => (
        <div className="it-line" key={o.id}>
          <span className="it-proj">{jLong(o.date)}</span>
          <span className="it-h">{faDigits(o.hours)} ساعت · {o.people ? `${faDigits(o.people)} نفر` : "همهٔ حاضران"}</span>
          <button className="chip-x" disabled={busy} title="حذف" onClick={() => run(() => productionApi.planOvertime({ remove: o.id }))}>×</button>
        </div>
      ))}
      <div className="row3" style={{ marginTop: 12 }}>
        <label className="fld sm"><span>روز</span><JalaliPicker value={date} onChange={setDate} /></label>
        <label className="fld sm"><span>چند ساعت</span>
          <input type="number" inputMode="decimal" value={hours} placeholder="مثلاً ۲" onChange={(e) => setHours(e.target.value)} /></label>
        <label className="fld sm"><span>چند نفر (خالی = همه)</span>
          <input type="number" inputMode="numeric" value={people} placeholder="همه" onChange={(e) => setPeople(e.target.value)} /></label>
      </div>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || !ok} onClick={add}>افزودن اضافه‌کاری</button>
      </div>
      <WhyOff busy={busy} reasons={[!(Number(hours) > 0) && "ساعت اضافه‌کاری وارد نشده", Number(hours) > 12 && "بیش از ۱۲ ساعت نمی‌شود"]} />
    </Overlay>
  );
}

function LeaveDialog({ data, busy, run, onClose }) {
  const [employee, setEmployee] = useState("");
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState(data.today);
  const ok = employee && from && to && to >= from;
  const add = async () => {
    if (await run(() => productionApi.planLeave({ employee, from, to }))) setEmployee("");
  };
  return (
    <Overlay title="مرخصی" busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        کسی که مرخصی است آن روز در توان کارگاه شمرده نمی‌شود؛ اگر نفرِ ثابتِ ایستگاهی باشد، همان ایستگاه هم آن روز کندتر می‌شود.
      </div>
      {data.leaves.length === 0 ? <div className="empty">مرخصی‌ای ثبت نشده.</div> : data.leaves.map((l) => (
        <div className="it-line" key={l.id}>
          <span className="it-emp">{l.employee}</span>
          <span className="it-h">{l.from === l.to ? jLong(l.from) : `${jShort(l.from)} تا ${jShort(l.to)}`}</span>
          <button className="chip-x" disabled={busy} title="حذف" onClick={() => run(() => productionApi.planLeave({ remove: l.id }))}>×</button>
        </div>
      ))}
      <div className="row3" style={{ marginTop: 12 }}>
        <label className="fld sm"><span>کارگر</span>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {data.employees.map((e) => <option key={e}>{e}</option>)}
          </select>
        </label>
        <label className="fld sm"><span>از روز</span><JalaliPicker value={from} onChange={(v) => { setFrom(v); if (to < v) setTo(v); }} /></label>
        <label className="fld sm"><span>تا روز</span><JalaliPicker value={to} onChange={setTo} /></label>
      </div>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || !ok} onClick={add}>ثبت مرخصی</button>
      </div>
      <WhyOff busy={busy} reasons={[!employee && "کارگر انتخاب نشده", to < from && "تاریخ پایان پیش از شروع است"]} />
    </Overlay>
  );
}

function CommitDialog({ data, busy, onClose, onSave }) {
  const [note, setNote] = useState("");
  return (
    <Overlay title="ثبت برنامه" busy={busy} onClose={onClose}>
      <div className="muted" style={{ fontSize: 13, lineHeight: 2, marginBottom: 10 }}>
        زمان‌بندیِ همین لحظه «برنامهٔ ثبت‌شده» می‌شود و از این به بعد، عقب یا جلو افتادنِ هر کار نسبت به آن سنجیده می‌شود.
        {data.baseline && " برنامهٔ قبلی برای روزهای پیشِ رو جایگزین می‌شود؛ روزهای گذشته‌اش برای مقایسه با کارِ واقعی می‌ماند."}
      </div>
      <label className="fld"><span>یادداشت (اختیاری)</span>
        <input value={note} placeholder="مثلاً: برنامهٔ هفتهٔ سوم مهر" onChange={(e) => setNote(e.target.value)} /></label>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        <button className="submit" disabled={busy} onClick={() => onSave(note.trim())}>{busy ? "…" : "ثبت برنامه"}</button>
      </div>
    </Overlay>
  );
}
