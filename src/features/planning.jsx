import { useState, useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { productionApi } from "../api.js";
import { Empty, JalaliPicker, J_MONTHS, WhyOff, faDigits, isoToJ, jLong, jShort } from "../shared/core.jsx";
import { Slip, Tile, WD_SHORT, WEEKDAYS, addDays, dayDiff, dayInfo, num, round1, toDate, weekStart } from "./planutil.jsx";
import { Kanban, PlanCalendar, ProjectsDash } from "./planviews.jsx";

/* ============ برنامه‌ریزی تولید ============
   منطق در backend/core/planning.py است. نرم‌افزار کارِ باقیمانده را روی ایستگاه‌ها می‌چیند و پیشنهاد
   می‌دهد؛ مسئول برنامه‌ریزی مدت، ایستگاه، ترتیب، اضافه‌کاری و مرخصی را عوض می‌کند و برنامه را «ثبت»
   می‌کند تا انحراف از آن سنجیده شود. هر تغییر، کلِ برنامهٔ تازه را از سرور برمی‌گرداند. */

const DAY_W = 28;                 // پهنای هر روز در نمودار گانت (px)
const ROW_H = 46;                 // بلندیِ هر ردیف گانت؛ فلش‌های وابستگی جایشان را از همین می‌گیرند

const VIEWS = [
  { id: "gantt", label: "نمودار زمانی (گانت)" },
  { id: "table", label: "جدول کارها" },
  { id: "kanban", label: "بورد" },
  { id: "calendar", label: "تقویم" },
  { id: "dash", label: "داشبورد پروژه‌ها" },
  { id: "board", label: "برنامهٔ روزانهٔ ایستگاه‌ها" },
  { id: "stations", label: "ایستگاه‌ها و کارها" },
  { id: "deviation", label: "انحراف از برنامه" },
];

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
    try { const d = await call(); setData(d); return d; }
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
            <button className="ghost" onClick={() => setDialog({ kind: "holiday" })}>تعطیلات</button>
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

      {view === "gantt" && <Gantt data={data} busy={busy} run={run} onMove={move} onJob={(project, job) => setDialog({ kind: "job", project, job })} />}
      {view === "kanban" && <Kanban data={data} busy={busy} run={run} onJob={(project, job) => setDialog({ kind: "job", project, job })} />}
      {view === "calendar" && <PlanCalendar data={data} />}
      {view === "dash" && <ProjectsDash data={data} />}
      {view === "table" && <JobsTable data={data} busy={busy} run={run} />}
      {view === "board" && <Board data={data} />}
      {view === "stations" && <StationsView data={data} busy={busy} run={run} />}
      {view === "deviation" && <Deviation data={data} />}

      {dialog?.kind === "job" && (
        <JobDialog data={data} project={dialog.project} job={dialog.job} busy={busy} onClose={() => setDialog(null)}
          onSave={async (body) => { if (await run(() => productionApi.planTask(body))) setDialog(null); }} />
      )}
      {dialog?.kind === "overtime" && <OvertimeDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "leave" && <LeaveDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "holiday" && <HolidayDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "commit" && (
        <CommitDialog data={data} busy={busy} onClose={() => setDialog(null)}
          onSave={async (note) => { if (await run(() => productionApi.planCommit(note))) setDialog(null); }} />
      )}
    </>
  );
}

/* ---------- نمودار گانت ----------
   هر پروژه و مرحله‌هایش روی تقویم. نوارِ هر مرحله را می‌شود گرفت و جابه‌جا کرد (روز شروع)، لبه‌هایش را کشید
   (مدت)، و نوارِ پروژه را کشید تا همهٔ مرحله‌هایش با هم بروند. کارِ انجام‌شده خاکستری است. */
function Gantt({ data, busy, run, onMove, onJob }) {
  const { canEdit } = data;
  // جای تازهٔ نواری که رها شده، تا جواب سرور برسد: {key, pid, mode, delta}
  const [pend, setPend] = useState(null);
  const dragRef = useRef(null);                  // کشیدنِ در جریان؛ بی رندرِ دوباره، مستقیم روی خودِ نوار
  const tipRef = useRef(null);
  const [note, setNote] = useState("");
  const todayRef = useRef(null);

  const range = useMemo(() => {
    const dates = [data.today, data.start];
    let early = data.today;
    data.projects.forEach((p) => {
      [p.start, p.finish, p.baselineFinish, p.dueDate].forEach((d) => d && dates.push(d));
      p.jobs.forEach((j) => {
        [j.start, j.finish, j.baselineFinish].forEach((d) => d && dates.push(d));
        if (j.actualStart && j.actualStart < early) early = j.actualStart;
      });
    });
    const floor = addDays(data.today, -30);                          // گذشتهٔ دورتر از یک ماه دیده نمی‌شود
    const first = addDays(early < floor ? floor : early, -2);
    let last = dates.reduce((x, d) => (d > x ? d : x), data.today);
    if (dayDiff(first, last) > 150) last = addDays(first, 150);      // نمودار بی‌انتها نشود
    const n = dayDiff(first, last) + 6;
    return { first, days: Array.from({ length: n }, (_, i) => addDays(first, i)) };
  }, [data]);

  const holidays = useMemo(() => Object.fromEntries((data.holidays || []).map((h) => [h.date, h.title || "تعطیل رسمی"])), [data.holidays]);
  const isOff = (d) => toDate(d).getDay() === 5 || d in holidays;
  // خانه‌های پس‌زمینهٔ هر ردیف. جدا و ثابت نگه داشته می‌شود تا با هر حرکتِ موس، نوارِ در حالِ کشیدن از نو ساخته نشود.
  const cells = useMemo(() => range.days.map((d) => (
    <i key={d} className={`g-cell${isOff(d) ? " fri" : ""}${d === data.today ? " today" : ""}`} />
  )), [range, data.today, holidays]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" }); }, []);

  if (data.projects.length === 0) return <Empty art="production">پروژهٔ بازی که مرحله و متراژ داشته باشد نیست.</Empty>;

  const N = range.days.length;
  const col = (iso) => dayDiff(range.first, iso);
  const width = N * DAY_W;
  const live = Object.fromEntries(data.days.map((d) => [d.date, d]));
  const stationName = Object.fromEntries(data.stations.map((st) => [st.id, st.name]));
  const months = [];
  range.days.forEach((d) => {
    const j = isoToJ(d);
    const key = `${j.jy}-${j.jm}`;
    if (months.length && months[months.length - 1].key === key) months[months.length - 1].n += 1;
    else months.push({ key, label: `${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`, n: 1 });
  });

  /* --- کشیدن نوارها ---
     تا موس پایین است، نوار مستقیم و پیکسل‌به‌پیکسل دنبالِ موس می‌رود (بدون رندرِ دوبارهٔ نمودار، تا روان باشد).
     شنونده‌ها روی خودِ پنجره‌اند، پس رها کردنِ دکمه هر جای صفحه که باشد کشیدن را تمام می‌کند. با رها کردن،
     نوار روی نزدیک‌ترین روز می‌نشیند و همان‌جا می‌ماند تا جواب سرور برسد. Esc کشیدن را لغو می‌کند. */
  const commit = async ({ p, j, mode, delta }) => {
    try {
      if (mode === "project") { await run(() => productionApi.planShift({ project: p.id, days: delta })); return; }
      const body = { project: p.id, stage: j.stage };
      if (mode !== "end") body.notBefore = addDays(j.start, delta);
      if (mode === "end") body.days = Math.max(0.5, round1((j.days || 1) + delta));
      if (mode === "start") body.days = Math.max(0.5, round1((j.days || 1) - delta));
      const d = await run(() => productionApi.planTask(body));
      const now = d && d.projects.find((x) => x.id === p.id)?.jobs.find((x) => x.stage === j.stage);
      if (now && body.notBefore && now.start && now.start > body.notBefore) {
        setNote(body.notBefore < d.start
          ? `برنامه از ${jShort(d.start)} شروع می‌شود؛ «${j.stage}» زودتر از آن جا نمی‌گیرد.`
          : `«${j.stage}» ${p.label} زودتر از ${jShort(now.start)} شدنی نیست: مرحلهٔ قبلش تا پیش از آن روز کاری برایش آماده نمی‌کند.`);
      }
    } finally { setPend(null); }
  };
  const setDays = async (p, j, n) => {
    if (!(n > 0) || n === j.days) return;
    await run(() => productionApi.planTask({ project: p.id, stage: j.stage, days: n }));
  };
  const begin = (e, key, pid, mode, p, j) => {
    if (!canEdit || busy || pend || dragRef.current || e.button > 0) return;
    e.preventDefault();                                              // نه انتخابِ متن، نه کشیدنِ پیش‌فرضِ مرورگر
    e.stopPropagation();
    const el = e.currentTarget.closest(".g-bar");
    const d = {
      el, key, pid, mode, p, j, x0: e.clientX, delta: 0, moved: false,
      rtl: getComputedStyle(el).direction === "rtl", width: el.style.width, w0: el.offsetWidth,
      mates: mode === "project" ? [...el.closest(".g-proj").querySelectorAll(".g-bar.job")] : [],
    };
    dragRef.current = d;
    const tip = tipRef.current;
    const hint = () => (mode === "end" ? `${faDigits(Math.max(0.5, round1((j.days || 1) + d.delta)))} روز`
      : mode === "start" ? `از ${jShort(addDays(j.start, d.delta))} · ${faDigits(Math.max(0.5, round1((j.days || 1) - d.delta)))} روز`
        : `از ${jShort(addDays((j || p).start, d.delta))}`);
    const move = (ev) => {
      const dx = ev.clientX - d.x0;
      if (!d.moved) {
        if (Math.abs(dx) < 4) return;                                // لرزشِ دست، کشیدن نیست
        d.moved = true;
        el.classList.add("on");
        document.body.classList.add("g-dragging");
        setNote("");
      }
      const later = d.rtl ? -dx : dx;                                // در صفحهٔ راست‌به‌چپ، «دیرتر» یعنی به چپ
      d.delta = Math.round(later / DAY_W);
      if (mode === "move" || mode === "project") {
        el.style.transform = `translateX(${dx}px)`;
        d.mates.forEach((m) => { m.style.transform = `translateX(${dx}px)`; });
      } else if (mode === "end") {
        el.style.width = `${Math.max(d.w0 + later, DAY_W - 4)}px`;
      } else {
        const w = Math.max(d.w0 - later, DAY_W - 4);
        el.style.width = `${w}px`;
        el.style.transform = `translateX(${(d.rtl ? -1 : 1) * (d.w0 - w)}px)`;
      }
      if (tip) {
        tip.textContent = hint();
        tip.style.display = "block";
        tip.style.left = `${ev.clientX + 14}px`;
        tip.style.top = `${ev.clientY - 34}px`;
      }
    };
    const stop = (cancelled) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", esc);
      dragRef.current = null;
      document.body.classList.remove("g-dragging");
      if (tip) tip.style.display = "none";
      // نمودار جای تازه را خودش می‌کشد؛ پیش از آن، دست‌کاریِ مستقیم روی نوار پاک می‌شود — هر دو در یک لحظه، بی پرش.
      const settle = !cancelled && d.moved && d.delta !== 0;
      el.classList.remove("on");
      el.style.transform = "";
      el.style.width = d.width;
      d.mates.forEach((m) => { m.style.transform = ""; });
      if (settle) {
        flushSync(() => setPend({ key, pid, mode, delta: d.delta }));
        commit(d);
      } else if (!cancelled && !d.moved && j) {
        onJob(p, j);                                                 // کلیکِ ساده: پنجرهٔ همان کار
      }
    };
    const up = () => stop(false);
    const cancel = () => stop(true);
    const esc = (ev) => { if (ev.key === "Escape") stop(true); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", esc);
  };
  /** جای نوار روی نمودار؛ نواری که تازه رها شده تا رسیدنِ جواب سرور سرِ جای تازه‌اش می‌ماند. */
  const place = (start, end, key, pid) => {
    let a = col(start), b = col(end);
    const on = !!pend && (pend.key === key || (pend.mode === "project" && pend.pid === pid));
    if (on) {
      if (pend.mode === "move" || pend.mode === "project") { a += pend.delta; b += pend.delta; }
      if (pend.mode === "end") b = Math.max(a, b + pend.delta);
      if (pend.mode === "start") a = Math.min(b, a + pend.delta);
    }
    return { a, b, on };
  };
  const box = (a, b) => {
    const x = Math.max(a, 0), y = Math.min(b, N - 1);
    return y < x ? null : { insetInlineStart: x * DAY_W + 2, width: (y - x + 1) * DAY_W - 4 };
  };

  /* فلشِ وابستگی: از هر مرحله به مرحلهٔ بعدِ همان پروژه. اگر بعدی وقتی شروع می‌شود که قبلی هنوز در جریان است،
     فلش از زیرِ نوارِ قبلی، همان روز، پایین می‌آید؛ وگرنه از پایانِ قبلی تا شروعِ بعدی می‌رود. */
  const rtl = typeof document === "undefined" || getComputedStyle(document.documentElement).direction !== "ltr";
  const xAt = (c, frac) => { const v = (c + frac) * DAY_W; return rtl ? width - v : v; };   // frac: جای درونِ روز (۰ = لبهٔ شروع)
  const rowOf = {};
  let rows = 0;
  data.projects.forEach((p) => { rows += 1; p.jobs.forEach((j) => { rowOf[`${p.id}|${j.stage}`] = rows; rows += 1; }); });
  const links = [];
  data.projects.forEach((p) => {
    const live = p.jobs.filter((j) => j.remaining > 0 && j.start && j.finish);
    live.forEach((to, k) => {
      const from = live[k - 1];
      if (!from) return;
      const f = place(from.start, from.finish, `${p.id}|${from.stage}`, p.id);
      const t = place(to.start, to.finish, `${p.id}|${to.stage}`, p.id);
      if (t.a < 0 || t.a >= N || f.a >= N) return;
      const y1 = rowOf[`${p.id}|${from.stage}`] * ROW_H + ROW_H / 2, y2 = rowOf[`${p.id}|${to.stage}`] * ROW_H + ROW_H / 2;
      const overlap = t.a <= f.b;
      const x2 = xAt(t.a, 0), tip = rtl ? 5 : -5;
      const d = overlap
        ? `M ${xAt(t.a, 0.5)} ${y1 + 10} V ${y2 - 12}`
        : `M ${xAt(f.b, 1)} ${y1} H ${xAt(f.b, 1.45)} V ${y2} H ${x2 + tip}`;
      const head = overlap
        ? `M ${xAt(t.a, 0.5) - 4} ${y2 - 15} L ${xAt(t.a, 0.5)} ${y2 - 9} L ${xAt(t.a, 0.5) + 4} ${y2 - 15} Z`
        : `M ${x2 + tip * 1.6} ${y2 - 4} L ${x2 + tip * 0.2} ${y2} L ${x2 + tip * 1.6} ${y2 + 4} Z`;
      links.push({ key: `${p.id}|${to.stage}`, d, head, late: to.slipDays > 0 });
    });
  });

  const mark = (iso, cls, title) => {
    if (!iso) return null;
    const c = col(iso);
    if (c < 0 || c >= N) return null;
    return <div className={`g-mark ${cls}`} title={title} style={{ insetInlineStart: c * DAY_W + DAY_W / 2 - 5 }} />;
  };
  const still = (start, end, cls, title, text) => {
    if (!start || !end) return null;
    const st = box(col(start), col(end));
    return st && <div className={`g-bar ${cls}`} title={title} style={st}>{text}</div>;
  };

  return (
    <div className="card" style={{ padding: 0 }}>
      {canEdit && (
        <div className="g-hint muted sm2 no-print">
          نوارِ هر مرحله را بگیرید و جابه‌جا کنید؛ لبه‌هایش را بکشید تا کوتاه یا بلند شود. نوارِ تیرهٔ پروژه همهٔ مرحله‌هایش را با هم می‌برد.
          با یک کلیک روی نوار، پنجرهٔ همان کار باز می‌شود.
        </div>
      )}
      {note && <div className="notice warn" style={{ margin: "0 12px 10px" }}>{note}</div>}
      <em className="g-tip" ref={tipRef} />
      <div className="gantt">
        <div className="g-row g-head">
          <div className="g-label">پروژه / مرحله</div>
          <div style={{ width }}>
            <div className="g-months">
              {months.map((m) => <span key={m.key} style={{ width: m.n * DAY_W }}>{m.n >= 3 ? m.label : ""}</span>)}
            </div>
            <div className="g-days">
              {range.days.map((d) => (
                <span key={d} ref={d === data.today ? todayRef : null}
                  className={`${isOff(d) ? "fri" : ""}${d === data.today ? " today" : ""}`}
                  title={holidays[d] ? `${jLong(d)} — ${holidays[d]}` : jLong(d)}>
                  <small>{WD_SHORT[toDate(d).getDay()]}</small>{faDigits(isoToJ(d).jd)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="g-body">
        <svg className="g-links" width={width} height={rows * ROW_H} style={{ insetInlineStart: "var(--g-label)" }} aria-hidden="true">
          {links.map((l) => (
            <g key={l.key} className={l.late ? "late" : ""}>
              <path d={l.d} fill="none" />
              <path d={l.head} className="head" />
            </g>
          ))}
        </svg>
        {data.projects.map((p, i) => {
          const pk = `P${p.id}`;
          const pg = p.start && p.finish ? place(p.start, p.finish, pk, p.id) : null;
          const pbox = pg && box(pg.a, pg.b);
          return (
            <div key={p.id} className="g-proj">
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
                <div className="g-track" style={{ width }}>{cells}
                  {pbox && (
                    <div className={`g-bar project${p.slipDays > 0 ? " late" : ""}${canEdit ? " grab" : ""}${pg.on ? " saving" : ""}`} style={pbox}
                      title={`${p.label}: ${jShort(p.start)} تا ${jShort(p.finish)}`} draggable={false}
                      onPointerDown={(e) => begin(e, pk, p.id, "project", p, null)}>
                      {`تا ${jShort(p.finish)}`}
                    </div>
                  )}
                  {mark(p.baselineFinish, "base", `پایان در برنامهٔ ثبت‌شده: ${p.baselineFinish ? jShort(p.baselineFinish) : ""}`)}
                  {mark(p.dueDate, "due", `قول تحویل: ${p.dueDate ? jShort(p.dueDate) : ""}`)}
                </div>
              </div>

              {p.jobs.map((j) => {
                const key = `${p.id}|${j.stage}`;
                const g = j.remaining > 0 && j.start && j.finish ? place(j.start, j.finish, key, p.id) : null;
                const st = g && box(g.a, g.b);
                const cls = `g-bar job${j.slipDays > 0 ? " late" : ""}${j.placed || j.manual ? " manual" : ""}${canEdit ? " grab" : ""}${g?.on ? " saving" : ""}`;
                return (
                  <div className={`g-row g-job${j.remaining > 0 ? "" : " done"}`} key={j.stage}>
                    <div className="g-label">
                      <span className={`g-stage${canEdit && j.remaining > 0 ? " can" : ""}`}
                        title={`${j.stage}${j.stationName !== j.stage ? ` · ${j.stationName}` : ""}${j.together.length ? ` · با ${j.together.map((m) => m.label).join(" و ")}` : ""}`}
                        onClick={() => canEdit && j.remaining > 0 && onJob(p, j)}>
                        {j.stage}{j.together.length > 0 ? " ⛓" : ""}
                      </span>
                      {j.remaining <= 0 ? <small className="muted">انجام شده ✓</small>
                        : canEdit && j.start ? <GanttEdit j={j} busy={busy || !!pend} onChange={(mode, delta) => commit({ p, j, mode, delta })} onDays={(n) => setDays(p, j, n)} />
                          : <small className="muted">{j.days != null ? `${faDigits(j.days)} روز` : "مدت نامعلوم"} · {faDigits(j.percent)}٪ انجام</small>}
                    </div>
                    <div className="g-track" style={{ width }}>{cells}
                      {still(j.actualStart, j.actualEnd, "actual",
                        `کارِ انجام‌شده: ${j.actualStart ? jShort(j.actualStart) : ""} تا ${j.actualEnd ? jShort(j.actualEnd) : ""} · ${faDigits(j.percent)}٪`, "")}
                      {st && (
                        <div className={cls} style={st}
                          title={`${j.stage} — ${num(j.remaining)} م² · ${jShort(j.start)} تا ${jShort(j.finish)}`}
                          draggable={false} onPointerDown={(e) => begin(e, key, p.id, "move", p, j)}>
                          {canEdit && <i className="g-grip s" onPointerDown={(e) => begin(e, key, p.id, "start", p, j)} />}
                          <span>{num(j.remaining)} م²</span>
                          {canEdit && <i className="g-grip e" onPointerDown={(e) => begin(e, key, p.id, "end", p, j)} />}
                        </div>
                      )}
                      {j.remaining > 0 && mark(j.baselineFinish, "base", `پایان در برنامهٔ ثبت‌شده: ${j.baselineFinish ? jShort(j.baselineFinish) : ""}`)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        </div>

        <div className="g-row g-load">
          <div className="g-label"><b>نفراتِ لازم هر روز</b><small className="muted">قرمز: بیش از حاضران یا ایستگاهِ شلوغ</small></div>
          <div className="g-track" style={{ width }}>
            {range.days.map((d) => {
              const x = live[d];
              const hot = x && (x.over || x.overStations.length > 0);
              const tip = x ? `${jLong(d)}: ${faDigits(round1(x.used))} نفر لازم، ${faDigits(round1(x.pool))} نفر در دسترس`
                + (x.leave.length ? ` · مرخصی: ${x.leave.join("، ")}` : "")
                + (x.overStations.length ? ` · ایستگاهِ شلوغ: ${x.overStations.map((id) => stationName[id] || "").join("، ")}` : "") : "";
              return (
                <i key={d} title={tip}
                  className={`g-cell load${isOff(d) ? " fri" : ""}${d === data.today ? " today" : ""}${hot ? " over" : ""}`}>
                  {x ? faDigits(Math.ceil(x.used - 0.05)) : ""}
                </i>
              );
            })}
          </div>
        </div>
      </div>
      <div className="g-legend muted sm2">
        <span><i className="g-key project" /> پروژه</span>
        <span><i className="g-key job" /> مرحله (پیشنهاد نرم‌افزار)</span>
        <span><i className="g-key job manual" /> جا یا مدتِ دستیِ مسئول</span>
        <span><i className="g-key actual" /> کارِ انجام‌شده</span>
        <span><i className="g-key late" /> عقب‌تر از برنامهٔ ثبت‌شده</span>
        <span><i className="g-mark base still" /> پایان در برنامهٔ ثبت‌شده</span>
        <span><i className="g-mark due still" /> قول تحویل</span>
        <span>فلش‌ها: هر مرحله به مرحلهٔ بعدِ همان پروژه</span>
      </div>
    </div>
  );
}

/** زیرِ نامِ هر مرحله در گانت: روزِ شروع (یک روز زودتر یا دیرتر) و تعداد روز (کم، زیاد یا نوشتنِ عدد). */
function GanttEdit({ j, busy, onChange, onDays }) {
  const [days, setDays] = useState(j.days != null ? String(j.days) : "");
  useEffect(() => { setDays(j.days != null ? String(j.days) : ""); }, [j.days]);
  const save = () => { const n = Number(days); if (n > 0 && n !== j.days) onDays(n); else setDays(j.days != null ? String(j.days) : ""); };
  const jd = isoToJ(j.start);
  return (
    <div className="g-edit no-print">
      <button disabled={busy} title="یک روز زودتر" onClick={() => onChange("move", -1)}>›</button>
      <span title={`شروع: ${jLong(j.start)}`}>{faDigits(jd.jd)} {J_MONTHS[jd.jm - 1]}</span>
      <button disabled={busy} title="یک روز دیرتر" onClick={() => onChange("move", 1)}>‹</button>
      <i />
      <button disabled={busy || !(j.days > 0.5)} title="یک روز کمتر" onClick={() => onChange("end", -1)}>−</button>
      <input type="number" inputMode="decimal" step="0.5" min="0.5" value={days} disabled={busy} title="تعداد روز"
        onChange={(e) => setDays(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <span>روز</span>
      <button disabled={busy} title="یک روز بیشتر" onClick={() => onChange("end", 1)}>+</button>
    </div>
  );
}

/* ---------- برنامهٔ روزانه: ایستگاه × روزهای هفته ---------- */
function Board({ data }) {
  const [from, setFrom] = useState(() => weekStart(data.today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const rows = data.stations.filter((s) => s.active);
  const live = Object.fromEntries(data.days.map((d) => [d.date, d]));
  const past = Object.fromEntries(data.past.map((d) => [d.date, d]));

  const cell = (station, iso) => {
    if (iso < data.start) {
      const lines = (past[iso]?.lines || []).filter((l) => l.station === station.id);
      return lines.map((l, i) => (
        <div className={`plan-line ${l.actual + 0.05 >= l.planned ? "done" : "short"}`} key={i}>
          <b>{l.project}</b>{l.stage !== station.name ? ` ${l.stage}` : ""}
          <small>برنامه {num(l.planned)} م² · انجام {num(l.actual)} م²</small>
        </div>
      ));
    }
    const lines = (live[iso]?.lines || []).filter((l) => l.station === station.id);
    return lines.map((l, i) => (
      <div className="plan-line" key={i}>
        <b>{l.project}</b>{l.stage !== station.name ? ` ${l.stage}` : ""}
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
                      {off ? (info.holiday || "تعطیل") : `${faDigits(info.base)} ساعت${info.overtime ? ` + ${faDigits(info.overtime)} اضافه‌کاری` : ""}`}
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
  // هر مرحله فقط در یک ایستگاه: انتخابِ ایستگاه تازه آن را از قبلی برمی‌دارد.
  const assign = (stage, key) => change((p) => p.map((r) => ({
    ...r, stages: r.key === key ? [...r.stages.filter((s) => s !== stage), stage] : r.stages.filter((s) => s !== stage),
  })));
  const stationOf = (stage) => rows.find((r) => r.stages.includes(stage))?.key || "";

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
          ایستگاه‌ها همان مراحلِ کارند و خودشان از فهرست مراحل ساخته شده‌اند؛ «نفرات» را نرم‌افزار از سابقهٔ گزارش‌ها برداشته
          (معمولاً چند نفر هم‌زمان روی آن مرحله کار می‌کنند) و می‌توانید عوضش کنید. اگر چند مرحله در یک جا انجام می‌شود
          (مثلاً همهٔ پاشش‌ها در اتاق رنگ)، یک ایستگاه بسازید و آن مرحله‌ها را در جدول پایین به آن بدهید.
          اگر نام نفرات ثابتِ ایستگاه را انتخاب کنید، مرخصیِ هر کدام همان روز از توان همان ایستگاه کم می‌کند.
        </div>
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
            {canEdit && !r.implicit && (
              <button className="item-del" title="حذف ایستگاه (مرحله‌هایش دوباره هر کدام ایستگاه خودشان می‌شوند)"
                onClick={() => change((p) => p.filter((x) => x.key !== r.key))}>×</button>
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
          برای اینکه چند پروژه با هم به یک ایستگاه بروند (مثلاً با هم به اتاق رنگ)، در نمودار گانت روی آن مرحله بزنید.
        </div>
        {jobs.length === 0 ? <div className="empty">کاری نمانده.</div> : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead><tr><th>پروژه</th><th>مرحله</th><th>مانده (م²)</th><th>ایستگاه</th><th>با هم با</th></tr></thead>
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
                        <option value="">طبق مرحله{j.stationFixed ? "" : ` (${j.stationName})`}</option>
                        {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td>{j.together.map((m) => m.label).join("، ")}</td>
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

/* ---------- جدول کارها: تاریخ شروع و تعداد روزِ هر کار، بی دست زدن به نمودار ---------- */
function JobRow({ p, j, busy, canEdit, run }) {
  const [days, setDays] = useState(j.days != null ? String(j.days) : "");
  useEffect(() => { setDays(j.days != null ? String(j.days) : ""); }, [j.days]);
  const send = (body) => run(() => productionApi.planTask({ project: p.id, stage: j.stage, ...body }));
  const saveDays = () => {
    const n = Number(days);
    if (days === "" || !(n > 0) || n === j.days) { setDays(j.days != null ? String(j.days) : ""); return; }
    send({ days: n });
  };
  return (
    <tr>
      <td>{p.label}</td>
      <td>{j.stage}{j.together.length > 0 && <small className="muted"> · با {j.together.map((m) => m.label).join(" و ")}</small>}</td>
      <td>{num(j.remaining)}</td>
      <td style={{ minWidth: 190 }}>
        {canEdit
          ? <JalaliPicker value={j.start || ""} placeholder="زمانی نگرفته" onChange={(v) => v && v !== j.start && send({ notBefore: v })} />
          : (j.start ? jShort(j.start) : "—")}
      </td>
      <td>
        {canEdit
          ? <input className="plan-days" type="number" inputMode="decimal" step="0.5" min="0.5" value={days} disabled={busy}
              onChange={(e) => setDays(e.target.value)} onBlur={saveDays} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          : faDigits(j.days ?? "—")}
      </td>
      <td>{j.finish ? jShort(j.finish) : "—"}</td>
      <td>{j.placed || j.manual ? "دستی" : "پیشنهاد نرم‌افزار"}{j.suggestedDays != null && j.manual ? ` (پیشنهاد: ${faDigits(j.suggestedDays)} روز)` : ""}</td>
      <td><Slip days={j.slipDays} /></td>
      <td>
        {canEdit && (j.placed || j.manual) && (
          <button className="linkish" disabled={busy} onClick={() => send({ days: null, notBefore: null })}>برگرد به پیشنهاد</button>
        )}
      </td>
    </tr>
  );
}

function JobsTable({ data, busy, run }) {
  const rows = data.projects.flatMap((p) => p.jobs.filter((j) => j.remaining > 0).map((j) => ({ p, j })));
  const [note, setNote] = useState("");
  // اگر تاریخی که داده شد شدنی نبود، سرور نزدیک‌ترین روزِ شدنی را می‌نشاند؛ همین را می‌گوییم.
  const guarded = async (call) => {
    setNote("");
    const before = JSON.stringify(rows.map((r) => r.j.start));
    const d = await run(call);
    if (d && JSON.stringify(d.projects.flatMap((p) => p.jobs.filter((j) => j.remaining > 0).map((j) => j.start))) === before) {
      setNote("تاریخ‌ها عوض نشد: مرحله زودتر از وقتی که مرحلهٔ قبلش کاری آماده کند شروع نمی‌شود.");
    }
    return d;
  };
  if (!rows.length) return <Empty art="production">کاری نمانده.</Empty>;
  return (
    <div className="card">
      <div className="board-h">تاریخ شروع و مدتِ هر کار</div>
      <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
        تاریخ شروع را از تقویم انتخاب کنید و تعداد روز را بنویسید (با Enter یا رفتن به خانهٔ دیگر ذخیره می‌شود). همان چیزی است که با کشیدنِ نوارها در گانت عوض می‌شود.
      </div>
      {note && <div className="notice warn">{note}</div>}
      <div className="table-scroll">
        <table className="mini-table">
          <thead><tr><th>پروژه</th><th>مرحله</th><th>مانده (م²)</th><th>تاریخ شروع</th><th>تعداد روز</th><th>پایان</th><th>نوع</th><th>انحراف</th><th /></tr></thead>
          <tbody>
            {rows.map(({ p, j }) => <JobRow key={`${p.id}|${j.stage}`} p={p} j={j} busy={busy} canEdit={data.canEdit} run={guarded} />)}
          </tbody>
        </table>
      </div>
    </div>
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
  const [together, setTogether] = useState(() => job.together.map((m) => m.id));
  // پروژه‌های دیگری که از همین مرحله کار مانده دارند؛ می‌شود این کار را با آن‌ها «با هم» کرد.
  const mates = data.projects.filter((p) => p.id !== project.id && p.jobs.some((j) => j.stage === job.stage && j.remaining > 0));
  const n = Number(days);
  const bad = days !== "" && !(n > 0);
  const body = () => ({ project: project.id, stage: job.stage, days: days === "" ? null : n, notBefore: notBefore || null,
    station: station || null, together });

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
            <option value="">طبق مرحله{job.stationFixed ? "" : ` (${job.stationName})`}</option>
            {data.stations.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      {notBefore && <button className="linkish" onClick={() => setNotBefore("")}>برداشتن تاریخِ «زودتر شروع نشود»</button>}
      {mates.length > 0 && (
        <div className="fld" style={{ marginTop: 10 }}>
          <span>با «{job.stage}» این پروژه‌ها با هم انجام شود</span>
          <div className="plan-chips">
            {mates.map((p) => (
              <button key={p.id} type="button" className={together.includes(p.id) ? "chip on" : "chip"}
                onClick={() => setTogether(together.includes(p.id) ? together.filter((x) => x !== p.id) : [...together, p.id])}>{p.label}</button>
            ))}
          </div>
          {together.length > 0 && (
            <div className="hint-remaining">تا مرحلهٔ قبلِ همهٔ این پروژه‌ها تمام نشود، این کار برای هیچ‌کدام شروع نمی‌شود؛ بعد پشت سر هم انجام می‌شوند.</div>
          )}
        </div>
      )}
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        {(job.manual || job.notBefore || job.stationFixed || job.together.length > 0) && (
          <button className="ghost" disabled={busy}
            onClick={() => onSave({ project: project.id, stage: job.stage, days: null, notBefore: null, station: null, together: [] })}>برگرد به پیشنهاد نرم‌افزار</button>
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

function HolidayDialog({ data, busy, run, onClose }) {
  const [date, setDate] = useState(data.today);
  const [title, setTitle] = useState("");
  const list = data.holidays.filter((h) => h.date >= addDays(data.today, -7));
  const add = async () => {
    if (await run(() => productionApi.planHoliday({ date, title: title.trim() }))) setTitle("");
  };
  return (
    <Overlay title="تعطیلات" busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        تعطیلات رسمی سال ۱۴۰۵ از تقویم رسمی وارد شده‌اند. تعطیلات مذهبی گاهی یک روز جابه‌جا اعلام می‌شوند؛ اگر چنین شد همین‌جا
        حذف و اضافه کنید. تعطیلیِ خودِ کارگاه را هم می‌توانید اضافه کنید. روزِ تعطیل در برنامه کار ندارد، مگر برایش اضافه‌کاری بگذارید.
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {list.length === 0 ? <div className="muted sm2">تعطیلیِ پیشِ رویی ثبت نشده.</div> : list.map((h) => (
          <div className="it-line" key={h.id}>
            <span className="it-proj">{jLong(h.date)}</span>
            <span className="it-h">{h.title}</span>
            <button className="chip-x" disabled={busy} title="حذف" onClick={() => run(() => productionApi.planHoliday({ remove: h.id }))}>×</button>
          </div>
        ))}
      </div>
      <div className="row2" style={{ marginTop: 12 }}>
        <label className="fld sm"><span>روز</span><JalaliPicker value={date} onChange={setDate} /></label>
        <label className="fld sm"><span>مناسبت</span>
          <input value={title} placeholder="مثلاً: تعطیلی کارگاه" onChange={(e) => setTitle(e.target.value)} /></label>
      </div>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || !date} onClick={add}>افزودن تعطیلی</button>
      </div>
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
