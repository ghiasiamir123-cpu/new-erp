import { useState, useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { productionApi } from "../api.js";
import { DocLetterhead, Empty, JalaliPicker, J_MONTHS, PrintableDoc, WhyOff, faDigits, isoToJ, jLong, jShort } from "../shared/core.jsx";
import { Slip, Tile, WD_SHORT, WEEKDAYS, addDays, dayDiff, dayInfo, awayText, num, round1, toDate, weekStart } from "./planutil.jsx";
import { Kanban, PlanCalendar, ProjectsDash } from "./planviews.jsx";
import { ColorsDialog, CriticalCard, MaterialsCard, Overlay, PlanHistory, ReworkDialog, SkillsDialog, StationOffDialog,
  WhatIfDialog } from "./planextras.jsx";

/* ============ برنامه‌ریزی تولید ============
   منطق در backend/core/planning.py است. نرم‌افزار کارِ باقیمانده را روی ایستگاه‌ها می‌چیند و پیشنهاد
   می‌دهد؛ مسئول برنامه‌ریزی مدت، ایستگاه، ترتیب، اضافه‌کاری و مرخصی را عوض می‌کند و برنامه را «ثبت»
   می‌کند تا انحراف از آن سنجیده شود. هر تغییر، کلِ برنامهٔ تازه را از سرور برمی‌گرداند. */

const ZOOMS = [12, 18, 28, 42, 60];   // پهنای هر روز در نمودار گانت (px) در هر پلهٔ بزرگ‌نمایی
const ZOOM_KEY = "divaj_gantt_zoom";
const ROW_H = 58;                 // بلندیِ هر ردیف گانت؛ فلش‌های وابستگی جایشان را از همین می‌گیرند

const VIEWS = [
  { id: "gantt", label: "نمودار زمانی (گانت)" },
  { id: "table", label: "جدول کارها" },
  { id: "kanban", label: "بورد" },
  { id: "calendar", label: "تقویم" },
  { id: "dash", label: "داشبورد پروژه‌ها" },
  { id: "board", label: "برنامهٔ روزانهٔ ایستگاه‌ها" },
  { id: "sheet", label: "برگهٔ روزانه (چاپ)" },
  { id: "stations", label: "ایستگاه‌ها و کارها" },
  { id: "deviation", label: "انحراف از برنامه" },
  { id: "history", label: "تاریخچهٔ تغییرها" },
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
      <div className={view === "sheet" ? "prod-tiles no-print" : "prod-tiles"}>
        <Tile label="پایان همهٔ کارها" tone={t.unfinished ? "bad" : "ok"}
          value={t.finish ? jShort(t.finish) : t.unfinished ? "خارج از افق برنامه" : "—"}
          sub={`${num(t.area)} م² · ${faDigits(Math.round(t.hours))} نفر-ساعت مانده`} />
        <Tile label="نسبت به برنامهٔ ثبت‌شده" tone={t.behind ? "bad" : data.baseline ? "ok" : ""}
          value={!data.baseline ? "ثبت نشده" : t.behind ? `${faDigits(t.behind)} پروژه عقب` : "طبق برنامه"}
          sub={[t.slipMax > 0 ? `بیشترین عقب‌افتادگی ${faDigits(t.slipMax)} روز` : "", t.paused ? `${faDigits(t.paused)} پروژه متوقف` : ""].filter(Boolean).join(" · ")} />
        <Tile label="تحقق برنامهٔ روزانه" tone={dev && dev.avgPercent < 80 ? "bad" : dev ? "ok" : ""}
          value={dev ? `${faDigits(dev.avgPercent)}٪` : "—"}
          sub={dev ? `${faDigits(dev.days)} روز · انحراف معیار ${faDigits(dev.stdPercent)}٪` : "هنوز روزی از برنامهٔ ثبت‌شده نگذشته"} />
        <Tile label="نفرات امروز" value={`${faDigits(s.presentToday)} از ${faDigits(s.crew)}`}
          sub={awayText({ leave: s.leaveToday, away: s.awayToday }).replace(/^ · /, "") || "کسی مرخصی یا کار عمومی ندارد"} />
        {t.utilization != null && (
          <Tile label="بهره‌وری برنامه" tone={t.utilization < 70 ? "bad" : "ok"} value={`${faDigits(t.utilization)}٪`}
            sub={t.idle > 0 ? `${faDigits(t.idle)} نفر-روز بی‌کار در دو هفتهٔ کاریِ پیشِ رو` : "همهٔ توانِ دو هفتهٔ پیشِ رو کار دارد"} />
        )}
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
            <button className="ghost" onClick={() => setDialog({ kind: "general" })}>کار عمومی</button>
            <button className="ghost" onClick={() => setDialog({ kind: "holiday" })}>تعطیلات</button>
            <button className="ghost" title="ایستگاهی که خراب است یا چند روز کار نمی‌کند" onClick={() => setDialog({ kind: "stationoff" })}>خرابی ایستگاه</button>
            <button className="ghost" title="کاری که باید دوباره انجام شود" onClick={() => setDialog({ kind: "rework" })}>دوباره‌کاری</button>
            <button className="ghost" title="چه کسی کدام مرحله را انجام می‌دهد" onClick={() => setDialog({ kind: "skills" })}>مهارت نفرات</button>
            <button className="ghost" title="رنگِ پروژه‌ها و ساعتِ تعویض رنگ" onClick={() => setDialog({ kind: "colors" })}>رنگ</button>
            <button className="ghost" disabled={busy || !data.undo}
              title={data.undo ? `برگرداندنِ آخرین تغییر: ${data.undo.action} — ${data.undo.summary} (${data.undo.by})` : "تغییری برای برگرداندن نیست"}
              onClick={() => window.confirm(`آخرین تغییر برگردد؟\n${data.undo.action} — ${data.undo.summary}`) && run(() => productionApi.planUndo())}>↶ برگرداندن</button>
            <button className="submit" onClick={() => setDialog({ kind: "commit" })}>ثبت برنامه</button>
          </div>
        )}
        <button className="ghost" title="برنامه با نفرِ بیشتر، اضافه‌کاری، خرابیِ ایستگاه یا پروژهٔ تازه دوباره چیده می‌شود؛ چیزی عوض نمی‌شود"
          onClick={() => setDialog({ kind: "whatif" })}>اگر … چه می‌شود؟</button>
        <button className="ghost" onClick={() => window.print()}>چاپ</button>
      </div>

      {data.warnings.map((w, i) => <div className={view === "sheet" ? "notice warn no-print" : "notice warn"} key={i}>{w}</div>)}
      <CriticalCard data={data} />
      <MaterialsCard stampKey={data.totals.area} />

      {(data.paused || []).length > 0 && (
        <div className="card paused-card no-print">
          <div className="board-h">پروژه‌های متوقف — در برنامه چیده نمی‌شوند</div>
          {data.paused.map((x) => (
            <div className="paused-row" key={x.id}>
              <span className="pill idle">{x.upcoming ? `از ${jShort(x.start)}` : `${faDigits(x.days)} روز`}</span>
              <b>{x.label}</b>
              <span className="muted sm2">
                {x.reasonLabel}{x.note ? ` — ${x.note}` : ""} · از {jShort(x.start)} · {num(x.remaining)} م² مانده
                {x.dueDate ? ` · تحویل ${jShort(x.dueDate)}` : ""}{x.by ? ` · ${x.by}` : ""}
              </span>
              {canEdit && (
                <span className="paused-acts">
                  <button className="ghost" disabled={busy} onClick={() => setDialog({ kind: "resume", pause: x })}>ادامهٔ کار</button>
                  <button className="linkish" disabled={busy} title="توقفی که اشتباه ثبت شده"
                    onClick={() => window.confirm("این توقف پاک شود؟ (روزهایش دیگر توقف حساب نمی‌شود)") && run(() => productionApi.planPause({ remove: x.id }))}>پاک کردن</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sub-tabs no-print">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "sub-tab on" : "sub-tab"} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </div>

      {view === "gantt" && <Gantt data={data} busy={busy} run={run} onMove={move} onJob={(project, job) => setDialog({ kind: "job", project, job })}
        onPause={(project) => setDialog({ kind: "pause", project })} />}
      {view === "kanban" && <Kanban data={data} busy={busy} run={run} onJob={(project, job) => setDialog({ kind: "job", project, job })} />}
      {view === "calendar" && <PlanCalendar data={data} />}
      {view === "dash" && <ProjectsDash data={data} />}
      {view === "table" && <JobsTable data={data} busy={busy} run={run} />}
      {view === "board" && <Board data={data} />}
      {view === "sheet" && <DaySheet data={data} />}
      {view === "stations" && <StationsView data={data} busy={busy} run={run} />}
      {view === "deviation" && <Deviation data={data} />}
      {view === "history" && <PlanHistory data={data} busy={busy} run={run} />}

      {dialog?.kind === "job" && (
        <JobDialog data={data} project={dialog.project} job={dialog.job} busy={busy} onClose={() => setDialog(null)}
          onSave={async (body) => { if (await run(() => productionApi.planTask(body))) setDialog(null); }} />
      )}
      {dialog?.kind === "overtime" && <OvertimeDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "leave" || dialog?.kind === "general") && (
        <LeaveDialog data={data} busy={busy} run={run} general={dialog.kind === "general"} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "pause" && <PauseDialog data={data} project={dialog.project} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "resume" && <ResumeDialog data={data} pause={dialog.pause} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "holiday" && <HolidayDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "whatif" && <WhatIfDialog canEdit={canEdit} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "stationoff" && <StationOffDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rework" && <ReworkDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "skills" && <SkillsDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
      {dialog?.kind === "colors" && <ColorsDialog data={data} busy={busy} run={run} onClose={() => setDialog(null)} />}
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
function Gantt({ data, busy, run, onMove, onJob, onPause }) {
  const { canEdit } = data;
  // جای تازهٔ نواری که رها شده، تا جواب سرور برسد: برای یک کار {key, pid, mode, start, end}، برای پروژه {pid, mode, delta}
  const [pend, setPend] = useState(null);
  const dragRef = useRef(null);                  // کشیدنِ در جریان؛ بی رندرِ دوباره، مستقیم روی خودِ نوار
  const tipRef = useRef(null);
  const [note, setNote] = useState("");
  const todayRef = useRef(null);
  // بزرگ‌نمایی: هر روز چند پیکسل پهنا دارد. کوچک که شود ماه‌های بیشتری در یک نگاه دیده می‌شود. روی همین دستگاه می‌ماند.
  const [zoom, setZoom] = useState(() => {
    try { const z = Number(localStorage.getItem(ZOOM_KEY)); return ZOOMS.includes(z) ? z : 28; } catch { return 28; }
  });
  const DAY_W = zoom;
  const zoomBy = (step) => {
    const z = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + step))];
    setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* ذخیره نشد؛ همین بار کار می‌کند */ }
  };
  const toToday = () => todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  // هر ایستگاه هر روز چه کسری از وقتش پر است (جمعِ کارهایی که آن روز در آن ایستگاه‌اند)
  const [showLoad, setShowLoad] = useState(false);
  const stationLoad = useMemo(() => {
    const out = {};
    data.days.forEach((d) => d.lines.forEach((l) => {
      if (!out[l.station]) out[l.station] = {};
      out[l.station][d.date] = (out[l.station][d.date] || 0) + l.share;
    }));
    return out;
  }, [data.days]);

  const range = useMemo(() => {
    const dates = [data.today, data.start];
    let early = data.today;
    data.projects.forEach((p) => {
      [p.start, p.finish, p.baselineFinish, p.dueDate].forEach((d) => d && dates.push(d));
      if (p.baselineStart && p.baselineStart < early) early = p.baselineStart;
      p.jobs.forEach((j) => {
        [j.start, j.finish, j.baselineFinish].forEach((d) => d && dates.push(d));
        if (j.actualStart && j.actualStart < early) early = j.actualStart;
        if (j.baselineStart && j.baselineStart < early) early = j.baselineStart;
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

  useEffect(() => { toToday(); }, [zoom]);


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

  /* --- تقویمِ کاری و قاعدهٔ تقدم، همان‌طور که سرور حساب می‌کند ---
     این‌ها فقط برای این‌اند که نوار پیش از رها شدن نشان بدهد کجا می‌نشیند؛ حرفِ آخر را سرور می‌زند. */
  const isWork = (iso) => { const i = dayInfo(data, iso); return i.base + i.overtime > 0; };
  const factor = (iso) => { const i = dayInfo(data, iso); return (i.base + i.overtime) / 8; };
  /** نزدیک‌ترین روزِ کاری از همین روز به بعد (یا با dir = -1 به قبل). */
  const toWork = (iso, dir = 1) => { let d = iso, g = 0; while (!isWork(d) && g++ < 60) d = addDays(d, dir); return d; };
  /** steps روزِ کاری جلوتر یا عقب‌تر از یک تاریخ؛ جمعه و تعطیلِ بی‌اضافه‌کاری شمرده نمی‌شود. */
  const workShift = (iso, steps) => {
    let d = iso, left = Math.abs(steps), guard = 0;
    while (left > 0 && guard++ < 400) { d = addDays(d, steps > 0 ? 1 : -1); if (isWork(d)) left -= 1; }
    return d;
  };
  /** کاری با این مدت (به روزِ کاریِ کامل؛ پنجشنبه نیم‌روز است) اگر از start شروع شود چه روزی تمام می‌شود. */
  const spanEnd = (start, days) => {
    let d = toWork(start), sum = 0, g = 0;
    while (g++ < 400) { sum += factor(d); if (sum >= days - 0.001) return d; d = toWork(addDays(d, 1)); }
    return d;
  };
  const prevJob = (p, j) => { const i = p.jobs.indexOf(j); return i > 0 ? p.jobs[i - 1] : null; };
  /* تقدمِ مراحل: هر مرحله فقط روی کاری می‌رود که مرحلهٔ قبلِ همان پروژه تا پایانِ روزِ قبل تمام کرده است. پس مرحلهٔ
     بعد می‌تواند یک روزِ کاری پس از شروعِ مرحلهٔ قبل شروع شود (آستر امروز، سنبادهٔ آستر فردا)، ولی زودتر از آن نه؛
     و تا مرحلهٔ قبل تمام نشده، خودش هم تمام نمی‌شود. کارهای «با هم» منتظرِ تمام شدنِ مرحلهٔ قبلِ همه می‌مانند.
     حرفِ مسئول جلوتر از این قاعده است: کاری که زودتر از مرحلهٔ قبلش گذاشته شود همان‌جا می‌نشیند و مرحله‌های قبل
     خودشان زودتر می‌آیند (ripple)؛ تنها حدّش روزِ شروعِ برنامه است، چون هر مرحلهٔ مانده یک روز جا می‌خواهد. */
  const firstDay = toWork(data.start);
  /* کارِ مرحلهٔ prev که روزِ iso انجام شود، فردای آن به مرحلهٔ بعد می‌رسد — و اگر خشک شدن می‌خواهد، چند روز دیرتر
     (روزهای تقویمی: شب و جمعه هم خشک می‌شود). before وارونهٔ همین است: قبلی دست‌کم باید کِی کار کرده باشد. */
  const after = (iso, prev) => toWork(addDays(iso, 1 + (prev.dryDays || 0)));
  const before = (iso, prev) => toWork(addDays(iso, -1 - (prev.dryDays || 0)), -1);
  /** کارِ k تا مرحلهٔ قبلش کاری تحویل ندهد شروع نمی‌شود؟ */
  const needsPrev = (p, k) => k > 0 && !(p.jobs[k].ready > 0) && p.jobs[k - 1].remaining > 0;
  const earliest = (p, j) => {
    let date = firstDay, why = `برنامه از ${jShort(firstDay)} شروع می‌شود`;
    if (!j.together.length) {
      const i = p.jobs.indexOf(j);
      const lo = (k) => (k !== i && p.jobs[k].together.length ? p.jobs[k].start || firstDay
        : needsPrev(p, k) ? after(lo(k - 1), p.jobs[k - 1]) : firstDay);
      let n = 0;
      for (let k = i; needsPrev(p, k); k--) n += 1;
      date = lo(i);
      if (n) why = `پیش از این کار ${faDigits(n)} مرحلهٔ دیگر مانده و هر کدام یک روز جا می‌خواهد؛ زودتر از ${jShort(date)} نمی‌شود`;
      return { date, why };
    }
    if (j.together.length) {
      [{ p, j }, ...j.together.map((m) => {
        const q = data.projects.find((x) => x.id === m.id);
        const k = q?.jobs.find((x) => x.stage === j.stage);
        return q && k ? { p: q, j: k } : null;
      }).filter(Boolean)].forEach((m) => {
        const pv = prevJob(m.p, m.j);
        if (!pv || !(pv.remaining > 0) || !pv.finish) return;
        const d = after(pv.finish, pv);
        if (d > date) { date = d; why = `«${pv.stage}» ${m.p.label} تا ${jShort(pv.finish)} طول می‌کشد و این کارها با هم شروع می‌شوند`; }
      });
    }
    return { date, why };
  };
  const earliestEnd = (p, j) => { const pv = prevJob(p, j); return pv && pv.remaining > 0 && pv.finish ? after(pv.finish, pv) : ""; };
  /** با نشستنِ این کار روی start، خودش تا کِی طول می‌کشد و کدام مرحله‌های همان پروژه با آن جور می‌شوند:
      قبلی‌ها زودتر می‌آیند تا کار به آن برسد، بعدی‌ها اگر جا نداشته باشند دیرتر می‌روند. */
  const ripple = (p, j, start) => {
    const others = {}, i = p.jobs.indexOf(j), key = (x) => `${p.id}|${x.stage}`;
    let prevEnd = i > 0 && p.jobs[i - 1].remaining > 0 ? p.jobs[i - 1].finish : "";     // پایانِ مرحلهٔ قبل
    if (!j.together.length) {
      let need = start;
      for (let k = i; needsPrev(p, k); k--) {
        const pv = p.jobs[k - 1];
        need = before(need, pv);
        if (pv.together.length || !pv.start || pv.start <= need) break;
        others[key(pv)] = { stage: pv.stage, start: need, end: spanEnd(need, pv.days || 1) };
        if (k === i) prevEnd = others[key(pv)].end;
      }
    }
    let end = spanEnd(start, j.days || 1);
    if (prevEnd && end < after(prevEnd, p.jobs[i - 1])) end = after(prevEnd, p.jobs[i - 1]);
    // مرحله‌ای که به قبلی چسبیده (همان روزی شروع می‌شود که کارِ قبلی به آن می‌رسد) همان فاصله را نگه می‌دارد، چه زودتر
    // چه دیرتر؛ مرحله‌ای که فاصله دارد فقط وقتی جا نداشته باشد دیرتر می‌رود.
    let from = start, was = j.start, last = end;
    for (let k = i + 1; k < p.jobs.length; k++) {
      const nx = p.jobs[k], pv = p.jobs[k - 1];
      if (!needsPrev(p, k) || !nx.start || nx.together.length) break;
      const lo = after(from, pv);
      const tight = !!was && nx.start === after(was, pv);
      if (lo === nx.start || (!tight && nx.start > lo)) break;
      let e = spanEnd(lo, nx.days || 1);
      if (e < after(last, pv)) e = after(last, pv);
      others[key(nx)] = { stage: nx.stage, start: lo, end: e };
      from = lo; was = nx.start; last = e;
    }
    return { end, others };
  };
  /** این کار اگر بخواهد روز date شروع شود، واقعاً کجا می‌نشیند، چرا، و چه چیزِ دیگری با آن جابه‌جا می‌شود. */
  const fit = (p, j, date) => {
    let start = toWork(date), why = start !== date ? `${jShort(date)} تعطیل است` : "";
    const lo = earliest(p, j);
    if (start < lo.date) { start = lo.date; why = lo.why; }
    return { start, why, ...ripple(p, j, start) };
  };
  /** جایی که نوار با این مقدار جابه‌جایی (به روز تقویمی) می‌نشیند. */
  const aim = (mode, p, j, raw) => {
    if (mode === "project") {
      let start = toWork(addDays(p.start, raw));
      if (start < data.start) start = data.start;
      const delta = dayDiff(p.start, start);
      return { start, end: addDays(p.finish, delta), delta, why: "" };
    }
    if (mode === "move") return fit(p, j, addDays(j.start, raw));
    if (mode === "end") {
      let end = toWork(addDays(j.finish, raw), -1), why = "";
      if (end < j.start) end = j.start;
      const le = earliestEnd(p, j);
      if (le && end < le) { end = le; why = "مرحلهٔ قبل تا روزِ پیش از این طول می‌کشد؛ پایان زودتر نمی‌شود"; }
      return { start: j.start, end, why };
    }
    let t = fit(p, j, addDays(j.start, raw));                        // لبهٔ شروع: پایان سر جایش می‌ماند
    if (t.start > j.finish) t = fit(p, j, j.finish);
    return { start: t.start, end: j.finish, why: t.why, others: t.others };
  };
  /** نامِ مرحله‌هایی که با این جابه‌جایی خودشان جور می‌شوند، برای برچسبِ کنارِ موس و یادداشت. */
  const alsoMoved = (t) => {
    const names = Object.values(t.others || {}).map((o) => `«${o.stage}»`);
    if (!names.length) return "";
    return `${names.length > 2 ? `${faDigits(names.length)} مرحلهٔ دیگرِ همین پروژه` : names.join(" و ")} هم با آن جابه‌جا می‌شود`;
  };

  /** اگر کار همان‌جا که خواسته شد ننشست، می‌گوییم کجا نشست و چرا. */
  const explain = (d, p, j, want) => {
    const now = d && d.projects.find((x) => x.id === p.id)?.jobs.find((x) => x.stage === j.stage);
    if (!now || !now.start) return;
    if (want.start && now.start !== want.start) {
      setNote(`«${j.stage}» ${p.label} به‌جای ${jShort(want.start)} روی ${jShort(now.start)} نشست: مرحلهٔ قبلش تا پیش از آن روز کاری برایش آماده نمی‌کند.`);
    } else if (want.end && now.finish && now.finish !== want.end) {
      setNote(`پایانِ «${j.stage}» ${p.label} به‌جای ${jShort(want.end)} روی ${jShort(now.finish)} افتاد: مرحلهٔ قبلش هر روز فقط بخشی از کار را آماده می‌کند.`);
    }
  };
  /** این تغییر چه چیزهایی را عقب یا جلو برد: پایانِ پروژه‌ها، و روزهایی که تازه «بیش از توان» شده‌اند. */
  const impact = (was, now) => {
    if (!now || !now.projects) return "";
    const parts = [];
    now.projects.forEach((q) => {
      const old = was.projects.find((x) => x.id === q.id);
      if (!old || !old.finish || !q.finish || old.finish === q.finish) return;
      const n = dayDiff(old.finish, q.finish);
      const broke = q.dueDate && q.finish > q.dueDate && !(old.finish > q.dueDate);
      parts.push(`پایانِ ${q.label} ${faDigits(Math.abs(n))} روز ${n > 0 ? "دیرتر" : "زودتر"} شد (${jShort(q.finish)})${broke ? " و از قول تحویل گذشت" : ""}`);
    });
    const hot = (d) => d.over || d.overStations.length > 0;
    const already = new Set(was.days.filter(hot).map((d) => d.date));
    const fresh = now.days.filter((d) => hot(d) && !already.has(d.date));
    if (fresh.length) parts.push(`${faDigits(fresh.length)} روز بیش از توان شد (از ${jShort(fresh[0].date)})`);
    return parts.length ? `اثرِ این تغییر: ${parts.join("؛ ")}.` : "";
  };
  const tell = (was, now) => { const fx = impact(was, now); if (fx) setNote((n) => [n, fx].filter(Boolean).join(" ")); };
  const save = async (p, j, body, want) => {
    const was = data;
    try {
      const d = await run(() => productionApi.planTask({ project: p.id, stage: j.stage, ...body }));
      explain(d, p, j, want);
      tell(was, d);
    } finally { setPend(null); }
  };
  /** بردنِ یک کار به یک تاریخِ مشخص (از تقویمِ کوچکِ کنارِ نمودار). */
  const moveTo = (p, j, date) => {
    const t = fit(p, j, date);
    setNote(t.why ? `«${j.stage}» ${p.label} روی ${jShort(date)} نمی‌نشیند (${t.why})؛ روی ${jShort(t.start)} گذاشته شد.` : "");
    if (t.start === j.start) return;
    setPend({ key: `${p.id}|${j.stage}`, pid: p.id, mode: "move", start: t.start, end: t.end, others: t.others });
    save(p, j, { notBefore: t.start, pull: true }, { start: t.start });
  };
  const [pick, setPick] = useState(null);       // {p, j, x, y} — تقویمِ بازِ یک کار
  const pickRef = useRef(null);
  useEffect(() => { if (pick) pickRef.current?.querySelector(".jp-input")?.click(); }, [pick]);
  /* دکمه‌های کوچکِ زیرِ نامِ مرحله: نوار همان لحظه جابه‌جا می‌شود و چند کلیکِ پشت‌سرهم یک‌جا فرستاده می‌شود. */
  const nudgeTimer = useRef(null);
  const nudge = (p, j, mode, step) => {
    const key = `${p.id}|${j.stage}`;
    const mine = pend && pend.soft && pend.key === key && pend.mode === mode;
    if (busy || (pend && !mine)) return;
    let steps = (mine ? pend.steps : 0) + step;
    let t, days = j.days || 1, crew = j.crew;
    if (mode === "crew") {
      // همان نفر-ساعت کار با نفراتِ تازه: مدت به همان نسبت کم یا زیاد می‌شود
      crew = Math.max(1, Math.min(50, j.crew + steps));
      steps = crew - j.crew;
      if (j.suggestedDaily) days = Math.max(0.1, round1(j.remaining / (j.suggestedDaily / j.crew * crew)));
      t = { start: j.start, end: spanEnd(j.start, days) };
      setNote("");
    } else if (mode === "move") {
      // «یک روز زودتر/دیرتر» یعنی یک روزِ کاری: از روی جمعه و تعطیلی می‌پرد.
      t = fit(p, j, workShift(j.start, steps));
      if (step < 0 && t.why && mine && t.start === pend.start) { setNote(`«${j.stage}» زودتر از ${jShort(t.start)} نمی‌شود: ${t.why}.`); return; }
      setNote(step < 0 && t.why ? `«${j.stage}» زودتر از ${jShort(t.start)} نمی‌شود: ${t.why}.` : "");
    } else {
      days = round1(days + steps);
      if (days < 0.5) return;
      t = { start: j.start, end: spanEnd(j.start, days) };
      setNote("");
    }
    clearTimeout(nudgeTimer.current);
    setPend({ key, pid: p.id, mode, steps, soft: true, start: t.start, end: t.end, days, crew, others: t.others });
    nudgeTimer.current = setTimeout(() => {
      if (mode === "move") { if (t.start !== j.start) save(p, j, { notBefore: t.start, pull: true }, { start: t.start }); else setPend(null); }
      else if (mode === "crew") { if (crew !== j.crew) save(p, j, { crew }, {}); else setPend(null); }
      else if (days !== j.days) save(p, j, { days }, {});
      else setPend(null);
    }, 550);
  };
  const setDays = async (p, j, n) => {
    if (!(n > 0) || n === j.days) return;
    const was = data;
    setNote("");
    tell(was, await run(() => productionApi.planTask({ project: p.id, stage: j.stage, days: n })));
  };
  const setCrew = async (p, j, n) => {
    if (!(n >= 1) || n === j.crew) return;
    const was = data;
    setNote("");
    tell(was, await run(() => productionApi.planTask({ project: p.id, stage: j.stage, crew: Math.round(n) })));
  };

  /* --- کشیدن نوارها ---
     نوار پیکسل‌به‌پیکسل دنبالِ موس می‌آید و یک «سایه» همان لحظه نشان می‌دهد با رها کردن دقیقاً روی کدام روزها
     می‌نشیند (روزِ تعطیل و زودتر از مرحلهٔ قبل را خودش کنار می‌گذارد). با رها کردن، نوار نرم روی همان سایه می‌رود.
     · همه‌چیز مستقیم روی خودِ نوار انجام می‌شود، نه با رندرِ دوبارهٔ نمودار، و هر قاب یک بار (requestAnimationFrame).
     · شنونده‌ها روی پنجره‌اند: رها کردنِ دکمه هر جای صفحه که باشد کشیدن را تمام می‌کند؛ Esc لغوش می‌کند.
     · نزدیکِ لبهٔ نمودار، خودش به همان سمت پیمایش می‌کند تا بشود نوار را به روزهای دورتر برد.
     · روی صفحهٔ لمسی، کشیدن با نگه داشتنِ انگشت روی نوار شروع می‌شود تا با پیمایشِ نمودار قاطی نشود. */
  const begin = (e, key, pid, mode, p, j) => {
    if (!canEdit || busy || pend || dragRef.current || e.button > 0) return;
    const el = e.currentTarget.closest(".g-bar");
    const gantt = el.closest(".gantt");
    const touch = e.pointerType === "touch";
    if (!touch) e.preventDefault();                                  // نه انتخابِ متن، نه کشیدنِ پیش‌فرضِ مرورگر
    e.stopPropagation();
    const sign = getComputedStyle(el).direction === "rtl" ? -1 : 1;   // در صفحهٔ راست‌به‌چپ، «دیرتر» یعنی به چپ
    const base = j || p;
    const a0 = Math.max(col(base.start), 0), b0 = Math.min(col(base.finish), N - 1);
    const d = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: e.clientX, cy: e.clientY, scroll0: gantt.scrollLeft,
      armed: !touch, active: false, held: false, raf: 0, timer: 0, aim: null, ghost: null,
      width: el.style.width, w0: el.offsetWidth,
      mates: mode === "project" ? [...el.closest(".g-proj").querySelectorAll(".g-bar.job")] : [],
      // مرحله‌های دیگرِ همین پروژه، که اگر لازم شد با این نوار جور می‌شوند
      peers: mode === "move" || mode === "start" ? [...el.closest(".g-proj").querySelectorAll(".g-bar.job")].filter((m) => m !== el)
        .map((m) => ({ el: m, key: m.dataset.key, a: Number(m.dataset.a), width: m.style.width })) : [],
    };
    dragRef.current = d;
    const tip = tipRef.current;
    const shift = (dx) => { const t = dx ? `translate3d(${dx}px,0,0)` : ""; el.style.transform = t; d.mates.forEach((m) => { m.style.transform = t; }); };
    const follow = (others) => d.peers.forEach((m) => {
      const o = others && others[m.key];
      m.el.classList.toggle("peer", !!o);
      m.el.style.transform = o ? `translate3d(${(col(o.start) - m.a) * DAY_W * sign}px,0,0)` : "";
      m.el.style.width = o ? `${(col(o.end) - col(o.start) + 1) * DAY_W - 4}px` : m.width;
    });

    const activate = () => {
      d.active = true;
      el.classList.add("on");
      d.mates.forEach((m) => m.classList.add("on"));
      gantt.classList.add("dragging");
      document.body.classList.add("g-dragging");
      d.ghost = document.createElement("div");
      d.ghost.className = mode === "project" ? "g-ghost project" : "g-ghost";
      el.parentElement.appendChild(d.ghost);
    };
    const frame = () => {
      d.raf = 0;
      // پیمایشِ خودکار نزدیکِ لبه‌ها (ستونِ نام کنار گذاشته می‌شود)
      const r = gantt.getBoundingClientRect();
      const labelW = gantt.querySelector(".g-label")?.offsetWidth || 0;
      const left = sign < 0 ? r.left : r.left + labelW, right = sign < 0 ? r.right - labelW : r.right;
      const edge = 46;
      // هر چه به لبه نزدیک‌تر، تندتر — ولی نه آن‌قدر که روزها از دست در بروند (حدود ده روز در ثانیه)
      const v = d.cx < left + edge ? -Math.min(5, (left + edge - d.cx) / 10 + 1) : d.cx > right - edge ? Math.min(5, (d.cx - right + edge) / 10 + 1) : 0;
      if (v) {
        const was = gantt.scrollLeft;
        gantt.scrollLeft = was + v;
        if (gantt.scrollLeft !== was) d.raf = requestAnimationFrame(frame);
      }
      const dx = (d.cx - d.x0) + (gantt.scrollLeft - d.scroll0);     // جابه‌جاییِ نوار نسبت به خودِ نمودار
      const later = dx * sign;
      const t = aim(mode, p, j, Math.round(later / DAY_W));
      d.aim = t;
      if (mode === "move" || mode === "project") shift(dx);
      else if (mode === "end") el.style.width = `${Math.max(d.w0 + later, DAY_W - 4)}px`;
      else {
        const w = Math.max(d.w0 - later, DAY_W - 4);
        el.style.width = `${w}px`;
        el.style.transform = `translate3d(${sign * (d.w0 - w)}px,0,0)`;
      }
      follow(t.others);
      const a = col(t.start), b = col(t.end);
      d.ghost.style.insetInlineStart = `${a * DAY_W + 2}px`;
      d.ghost.style.width = `${(b - a + 1) * DAY_W - 4}px`;
      d.ghost.classList.toggle("stop", !!t.why);
      if (tip) {
        tip.textContent = (mode === "end" ? `تا ${jShort(t.end)}` : mode === "start" ? `از ${jShort(t.start)}` : `${jShort(t.start)} تا ${jShort(t.end)}`)
          + (t.why ? ` — ${t.why}` : "") + (alsoMoved(t) ? ` — ${alsoMoved(t)}` : "");
        tip.style.display = "block";
        tip.style.left = `${Math.min(d.cx + 14, window.innerWidth - 260)}px`;
        tip.style.top = `${d.cy + 22}px`;                             // زیرِ موس، تا روی خودِ نوار و سایه‌اش نیفتد
      }
    };
    const move = (ev) => {
      if (ev.pointerId !== d.id) return;
      d.cx = ev.clientX; d.cy = ev.clientY;
      if (!d.armed) {                                                // انگشت پیش از «گرفتن» حرکت کرد: پیمایش است، نه کشیدن
        if (Math.hypot(d.cx - d.x0, d.cy - d.y0) > 10) stop(true);
        return;
      }
      if (!d.active) {
        if (Math.abs(d.cx - d.x0) < 4) return;                       // لرزشِ دست، کشیدن نیست
        activate();
      }
      if (!d.raf) d.raf = requestAnimationFrame(frame);
    };
    const noScroll = (ev) => { if (d.armed) ev.preventDefault(); };
    const noMenu = (ev) => ev.preventDefault();
    const stop = (cancelled) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", esc);
      el.removeEventListener("touchmove", noScroll);
      el.removeEventListener("contextmenu", noMenu);
      clearTimeout(d.timer);
      if (d.raf) cancelAnimationFrame(d.raf);
      document.body.classList.remove("g-dragging");
      if (tip) tip.style.display = "none";
      const clean = () => {
        el.style.transition = "";
        el.style.width = d.width;
        shift(0);
        d.mates.forEach((m) => { m.style.transition = ""; m.classList.remove("on"); });
        d.peers.forEach((m) => { m.el.classList.remove("peer"); m.el.style.transform = ""; m.el.style.width = m.width; });
        el.classList.remove("on");
        gantt.classList.remove("dragging");
        d.ghost?.remove();
        dragRef.current = null;
      };
      if (!d.active) {                                               // کشیده نشد
        clean();
        if (!cancelled && !d.held && j) onJob(p, j);                 // کلیک یا ضربهٔ ساده: پنجرهٔ همان کار
        return;
      }
      const t = d.aim;
      const changed = !cancelled && t && (mode === "project" ? t.delta !== 0
        : mode === "move" ? t.start !== j.start : t.start !== j.start || t.end !== j.finish);
      // نوار نرم می‌رود سرِ جای سایه (یا اگر چیزی عوض نشده، سرِ جای خودش)
      const a1 = changed ? col(t.start) : a0, b1 = changed ? col(t.end) : b0;
      if (!changed) follow(null);                                    // هیچ‌چیز عوض نشد: بقیه هم نرم برمی‌گردند
      const glide = "transform .13s ease-out, width .13s ease-out";
      el.style.transition = glide;
      d.mates.forEach((m) => { m.style.transition = glide; });
      if (mode === "move" || mode === "project") shift((a1 - a0) * DAY_W * sign);
      else if (mode === "end") el.style.width = `${(b1 - a0 + 1) * DAY_W - 4}px`;
      else {
        el.style.width = `${(b0 - a1 + 1) * DAY_W - 4}px`;
        el.style.transform = `translate3d(${(a1 - a0) * DAY_W * sign}px,0,0)`;
      }
      setTimeout(() => {
        // جابه‌جاییِ دستی پاک می‌شود و نمودار همان جا را خودش می‌کشد — هر دو در یک لحظه و بی حرکتِ اضافه.
        gantt.classList.add("noanim");
        clean();
        if (changed) {
          flushSync(() => setPend(mode === "project" ? { pid, mode, delta: t.delta } : { key, pid, mode, start: t.start, end: t.end, others: t.others }));
          setNote(t.why ? `«${j.stage}» ${p.label}: ${t.why}؛ روی ${jShort(mode === "end" ? t.end : t.start)} نشست.`
            : mode !== "project" && alsoMoved(t) ? `«${j.stage}» ${p.label} روی ${jShort(t.start)} نشست؛ ${alsoMoved(t)}.` : "");
          if (mode === "project") run(() => productionApi.planShift({ project: p.id, days: t.delta })).then((d) => tell(data, d)).finally(() => setPend(null));
          else if (mode === "move") save(p, j, { notBefore: t.start, pull: true }, { start: t.start });
          else save(p, j, { notBefore: t.start, finish: t.end, pull: true }, { start: t.start, end: t.end });
        }
        requestAnimationFrame(() => requestAnimationFrame(() => gantt.classList.remove("noanim")));
      }, 140);
    };
    const up = (ev) => { if (ev.pointerId === d.id) stop(false); };
    const cancel = (ev) => { if (!ev || ev.pointerId === undefined || ev.pointerId === d.id) stop(true); };
    const esc = (ev) => { if (ev.key === "Escape") stop(true); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", esc);
    if (touch) {
      el.addEventListener("touchmove", noScroll, { passive: false });
      el.addEventListener("contextmenu", noMenu);
      d.timer = setTimeout(() => {                                   // انگشت نگه داشته شد: نوار «گرفته» می‌شود
        d.armed = true; d.held = true;
        d.x0 = d.cx; d.y0 = d.cy; d.scroll0 = gantt.scrollLeft;
        navigator.vibrate?.(12);
        activate();
        d.raf = requestAnimationFrame(frame);
      }, 320);
    }
  };
  /** جای نوار روی نمودار؛ نواری که تازه رها شده تا رسیدنِ جواب سرور سرِ جای تازه‌اش می‌ماند. */
  const place = (start, end, key, pid) => {
    let a = col(start), b = col(end), on = false;
    if (pend && pend.mode === "project" && pend.pid === pid) { a += pend.delta; b += pend.delta; on = true; }
    else if (pend && pend.key === key) { a = col(pend.start); b = col(pend.end); on = true; }
    else if (pend && pend.others && pend.others[key]) { a = col(pend.others[key].start); b = col(pend.others[key].end); on = true; }
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

  /* مثل MSP، زیرِ هر نوار: نوارِ باریکِ برنامهٔ ثبت‌شده (مبنا)، و میانِ پایانِ مبنا و پایانِ امروز، تکه‌ای که انحراف
     را نشان می‌دهد — قرمز اگر دیرتر تمام می‌شود، سبز اگر زودتر. finish پایانِ پیش‌بینی‌شده (یا واقعی برای کارِ تمام‌شده). */
  const baseline = (bStart, bEnd, finish, what) => {
    if (!bStart || !bEnd) return null;
    const b = box(col(bStart), col(bEnd));
    const late = finish && finish > bEnd, early = finish && finish < bEnd;
    const gap = late ? box(col(bEnd) + 1, col(finish)) : early ? box(col(finish) + 1, col(bEnd)) : null;
    const n = finish ? Math.abs(dayDiff(bEnd, finish)) : 0;
    return (
      <>
        {b && <div className="g-base" style={b}
          title={`${what} در برنامهٔ ثبت‌شده: ${jShort(bStart)} تا ${jShort(bEnd)}`} />}
        {gap && <div className={`g-gap ${late ? "late" : "early"}`} style={gap}
          title={late ? `${faDigits(n)} روز دیرتر از برنامهٔ ثبت‌شده` : `${faDigits(n)} روز زودتر از برنامهٔ ثبت‌شده`} />}
      </>
    );
  };
  /* درصدِ پیشرفت، داخلِ خودِ نوار: بخشِ تیره‌ترِ ابتدای نوار */
  const fill = (pct) => (pct > 0 ? <b className="g-fill" style={{ width: `${Math.min(pct, 100)}%` }} /> : null);

  // همهٔ هوک‌ها بالاتر صدا زده شده‌اند؛ خروجِ زودهنگام باید بعد از آن‌ها باشد.
  if (data.projects.length === 0) return <Empty art="production">پروژهٔ بازی که مرحله و متراژ داشته باشد نیست.</Empty>;
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="g-zoom no-print">
        <span>بزرگ‌نمایی</span>
        <button disabled={zoom === ZOOMS[0]} title="کوچک‌تر: روزها جمع‌تر، ماه‌های بیشتری دیده می‌شود" onClick={() => zoomBy(-1)}>−</button>
        <button disabled={zoom === ZOOMS[ZOOMS.length - 1]} title="بزرگ‌تر: روزها بازتر" onClick={() => zoomBy(1)}>+</button>
        <button className="wide" onClick={toToday}>برو به امروز</button>
      </div>
      {canEdit && (
        <div className="g-hint muted sm2 no-print">
          نوارِ هر مرحله را بگیرید و جابه‌جا کنید؛ لبه‌هایش را بکشید تا کوتاه یا بلند شود. نوارِ تیرهٔ پروژه همهٔ مرحله‌هایش را با هم می‌برد.
          هر مرحله را هر جا بگذارید می‌نشیند و مرحله‌های قبل و بعدش خودشان با آن جور می‌شوند. زیرِ نامِ هر مرحله، تعداد نفر را هم می‌شود عوض کرد.
          با یک کلیک روی نوار، پنجرهٔ همان کار باز می‌شود.
        </div>
      )}
      {note && <div className="notice warn" style={{ margin: "0 12px 10px" }}>{note}</div>}
      <em className="g-tip" ref={tipRef} />
      {pick && (
        <>
          <div className="g-pick-back" onClick={() => setPick(null)} />
          <div className="g-pick" ref={pickRef} style={{ left: pick.x, top: pick.y }}>
            <JalaliPicker value={pick.j.start} onChange={(v) => {
              const { p, j } = pick;
              setPick(null);
              if (v && v !== j.start) moveTo(p, j, v);
            }} />
          </div>
        </>
      )}
      <div className={`gantt${zoom <= 18 ? " zs" : ""}${zoom <= 12 ? " zxs" : ""}`} style={{ "--g-day": `${zoom}px` }}>
        <div className="g-row g-head">
          <div className="g-label">پروژه / مرحله</div>
          <div style={{ width }}>
            <div className="g-months">
              {months.map((m) => <span key={m.key} style={{ width: m.n * DAY_W }}>{m.n * DAY_W >= 70 ? m.label : ""}</span>)}
            </div>
            <div className="g-days">
              {range.days.map((d) => (
                <span key={d} ref={d === data.today ? todayRef : null}
                  className={`${isOff(d) ? "fri" : ""}${d === data.today ? " today" : ""}`}
                  title={holidays[d] ? `${jLong(d)} — ${holidays[d]}` : jLong(d)}>
                  <small>{WD_SHORT[toDate(d).getDay()]}</small>
                  {/* خیلی کوچک که شود فقط روزهای ۱، ۵، ۱۰، … نوشته می‌شود تا عددها روی هم نیفتند */}
                  {zoom > 12 || isoToJ(d).jd === 1 || (isoToJ(d).jd % 5 === 0 && isoToJ(d).jd < 30) ? faDigits(isoToJ(d).jd) : ""}
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
                  {/* دو خط: بالا نامِ پروژه با همهٔ پهنای ستون، پایین درصد و وضعیت و دکمهٔ توقف */}
                  <div className="g-ptext">
                    <b title={p.name && p.name !== p.label ? `${p.label} — ${p.name}` : p.label}>{p.label}</b>
                    <div className="g-pmeta">
                      <span className="plan-rank">{faDigits(p.order)}</span>
                      <span className="g-pct" title={`${faDigits(p.percent)}٪ از کارِ پروژه انجام شده`}>
                        <i style={{ width: `${Math.min(p.percent || 0, 100)}%` }} /><small>{faDigits(Math.round(p.percent || 0))}٪</small>
                      </span>
                      <Slip days={p.slipDays} />
                      {p.pauseDays > 0 && <small className="muted" title="روزهایی که پروژه متوقف بود؛ جزوِ عقب‌افتادگیِ کارگاه نیست">+{faDigits(p.pauseDays)} روز توقف</small>}
                      {canEdit && <button className="g-pause no-print" disabled={busy} title="توقفِ این پروژه"
                        onClick={() => onPause(p)}>توقف</button>}
                    </div>
                  </div>
                </div>
                <div className="g-track" style={{ width }}>{cells}
                  {pbox && (
                    <div className={`g-bar project${p.slipDays > 0 ? " late" : ""}${canEdit ? " grab" : ""}${pg.on ? " saving" : ""}`} style={pbox}
                      title={`${p.label}: ${jShort(p.start)} تا ${jShort(p.finish)}`} draggable={false}
                      onPointerDown={(e) => begin(e, pk, p.id, "project", p, null)}>
                      {fill(p.percent)}<span>{`تا ${jShort(p.finish)} · ${faDigits(Math.round(p.percent || 0))}٪`}</span>
                    </div>
                  )}
                  {baseline(p.baselineStart, p.baselineFinish, p.finish, "پروژه")}
                  {mark(p.baselineFinish, "base", `پایان در برنامهٔ ثبت‌شده: ${p.baselineFinish ? jShort(p.baselineFinish) : ""}`)}
                  {mark(p.dueDate, "due", `قول تحویل: ${p.dueDate ? jShort(p.dueDate) : ""}`)}
                </div>
              </div>

              {p.jobs.map((j) => {
                const key = `${p.id}|${j.stage}`;
                const g = j.remaining > 0 && j.start && j.finish ? place(j.start, j.finish, key, p.id) : null;
                const st = g && box(g.a, g.b);
                const cls = `g-bar job${j.slipDays > 0 ? " late" : ""}${j.overdue ? " overdue" : ""}${j.placed || j.manual || j.crewManual ? " manual" : ""}${j.critical ? " critical" : ""}${canEdit ? " grab" : ""}${g?.on ? " saving" : ""}`;
                return (
                  <div className={`g-row g-job${j.remaining > 0 ? "" : " done"}`} key={j.stage}>
                    <div className="g-label">
                      <span className={`g-stage${canEdit && j.remaining > 0 ? " can" : ""}`}
                        title={`${j.stage}${j.stationName !== j.stage ? ` · ${j.stationName}` : ""}${j.together.length ? ` · با ${j.together.map((m) => m.label).join(" و ")}` : ""}${j.why ? ` — چرا اینجاست: ${j.why}` : ""}`}
                        onClick={() => canEdit && j.remaining > 0 && onJob(p, j)}>
                        {j.stage}{j.together.length > 0 ? " ⛓" : ""}
                      </span>
                      {j.remaining <= 0 ? <small className="muted">انجام شده ✓{j.doneSlip ? ` · ${j.doneSlip > 0 ? `${faDigits(j.doneSlip)} روز دیر` : `${faDigits(-j.doneSlip)} روز زود`}` : ""}</small>
                        : canEdit && j.start ? <GanttEdit j={j} locked={busy || (!!pend && !(pend.soft && pend.key === key))}
                          start={pend && pend.key === key ? pend.start : j.start}
                          days={pend && pend.key === key && pend.days != null ? pend.days : j.days}
                          crew={pend && pend.key === key && pend.crew != null ? pend.crew : j.crew}
                          onChange={(mode, step) => nudge(p, j, mode, step)} onDays={(n) => setDays(p, j, n)} onCrew={(n) => setCrew(p, j, n)}
                          onPick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setPick({ p, j, x: Math.max(8, Math.min(r.left - 100, window.innerWidth - 290)), y: Math.min(r.bottom + 2, window.innerHeight - 330) });
                          }} />
                          : <small className="muted">{j.days != null ? `${faDigits(j.days)} روز` : "مدت نامعلوم"} · {faDigits(j.percent)}٪ انجام</small>}
                    </div>
                    <div className="g-track" style={{ width }}>{cells}
                      {still(j.actualStart, j.actualEnd, "actual",
                        `کارِ انجام‌شده: ${j.actualStart ? jShort(j.actualStart) : ""} تا ${j.actualEnd ? jShort(j.actualEnd) : ""} · ${faDigits(j.percent)}٪`, "")}
                      {st && (
                        <div className={cls} style={st} data-key={key} data-a={Math.max(g.a, 0)}
                          title={`${j.stage} — ${num(j.remaining)} م² · ${faDigits(j.percent)}٪ انجام · ${faDigits(j.crew)} نفر · ${jShort(j.start)} تا ${jShort(j.finish)}`
                            + (j.baselineFinish ? ` · برنامهٔ ثبت‌شده تا ${jShort(j.baselineFinish)}` : "")
                            + (j.overdue ? " · عقب‌افتاده؛ پیش از کارهای تازه انجام می‌شود" : "")}
                          draggable={false} onPointerDown={(e) => begin(e, key, p.id, "move", p, j)}>
                          {canEdit && <i className="g-grip s" onPointerDown={(e) => begin(e, key, p.id, "start", p, j)} />}
                          {fill(j.percent)}
                          <span>{num(j.remaining)} م²{j.percent > 0 ? ` · ${faDigits(j.percent)}٪` : ""}</span>
                          {canEdit && <i className="g-grip e" onPointerDown={(e) => begin(e, key, p.id, "end", p, j)} />}
                        </div>
                      )}
                      {st && j.dryDays > 0 && still(addDays(j.finish, 1), addDays(j.finish, j.dryDays), "dry",
                        `خشک شدنِ «${j.stage}»: ${faDigits(j.waitHours)} ساعت — کسی لازم ندارد، ولی مرحلهٔ بعد باید صبر کند`, "")}
                      {baseline(j.baselineStart, j.baselineFinish, j.remaining > 0 ? j.finish : j.actualEnd, `«${j.stage}»`)}
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
          <div className="g-label"><b>نفراتِ لازم هر روز</b><small className="muted">قرمز: بیش از حاضران یا ایستگاهِ شلوغ</small>
            <button className="linkish no-print" onClick={() => setShowLoad(!showLoad)}>{showLoad ? "بستنِ بارِ ایستگاه‌ها ▴" : "بارِ هر ایستگاه ▾"}</button>
          </div>
          <div className="g-track" style={{ width }}>
            {range.days.map((d) => {
              const x = live[d];
              const hot = x && (x.over || x.overStations.length > 0);
              const tip = x ? `${jLong(d)}: ${faDigits(round1(x.used))} نفر لازم، ${faDigits(round1(x.pool))} نفر در دسترس`
                + awayText(x)
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
        {showLoad && data.stations.filter((st) => st.active && stationLoad[st.id]).map((st) => (
          <div className="g-row g-load st" key={st.id}>
            <div className="g-label"><b>{st.name}</b><small className="muted">چند درصدِ هر روزش پر است</small></div>
            <div className="g-track" style={{ width }}>
              {range.days.map((d) => {
                const pct = Math.round((stationLoad[st.id][d] || 0) * 100);
                return (
                  <i key={d} title={pct ? `${st.name} — ${jLong(d)}: ${faDigits(pct)}٪ پر` : ""}
                    className={`g-cell load${isOff(d) ? " fri" : ""}${d === data.today ? " today" : ""}${pct > 100 ? " over" : pct >= 85 ? " hot" : pct > 0 ? " some" : ""}`}>
                    {pct && zoom > 18 ? faDigits(pct) : ""}
                  </i>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="g-legend muted sm2">
        <span><i className="g-key project" /> پروژه</span>
        <span><i className="g-key job" /> مرحله (پیشنهاد نرم‌افزار)</span>
        <span><i className="g-key job manual" /> جا، مدت یا نفراتِ دستیِ مسئول</span>
        <span><i className="g-key actual" /> کارِ انجام‌شده (روزهای واقعی)</span>
        <span><i className="g-key fillk" /> درصدِ پیشرفت، داخلِ نوار</span>
        <span><i className="g-key basek" /> برنامهٔ ثبت‌شده (مبنا)</span>
        <span><i className="g-key gapk late" /> دیرتر از مبنا</span>
        <span><i className="g-key gapk early" /> زودتر از مبنا</span>
        <span><i className="g-key job overdue" /> کارِ عقب‌افتاده — اول انجام می‌شود</span>
        <span><i className="g-key dry" /> انتظارِ خشک شدن</span>
        <span><i className="g-key late" /> عقب‌تر از برنامهٔ ثبت‌شده</span>
        <span><i className="g-mark base still" /> پایان در برنامهٔ ثبت‌شده</span>
        <span><i className="g-mark due still" /> قول تحویل</span>
        <span>فلش‌ها: هر مرحله به مرحلهٔ بعدِ همان پروژه</span>
      </div>
    </div>
  );
}

/** زیرِ نامِ هر مرحله در گانت: روزِ شروع (یک روز زودتر یا دیرتر)، تعداد روز (کم، زیاد یا نوشتنِ عدد) و تعداد نفر. */
function GanttEdit({ j, locked, start, days: daysNow, crew: crewNow, onChange, onDays, onCrew, onPick }) {
  const busy = locked;
  const shown = daysNow != null ? String(round1(daysNow)) : "";
  const [days, setDays] = useState(shown);
  useEffect(() => { setDays(shown); }, [shown]);
  const save = () => { const n = Number(days); if (n > 0 && n !== j.days) onDays(n); else setDays(shown); };
  const [crew, setCrew] = useState(String(crewNow));
  useEffect(() => { setCrew(String(crewNow)); }, [crewNow]);
  const saveCrew = () => { const n = Math.round(Number(crew)); if (n >= 1 && n <= 50 && n !== j.crew) onCrew(n); else setCrew(String(crewNow)); };
  const jd = isoToJ(start);
  return (
    <div className="g-edit no-print">
      <button disabled={busy} title="یک روز زودتر" onClick={() => onChange("move", -1)}>›</button>
      <button className="g-date" disabled={busy} title={`شروع: ${jLong(j.start)} — برای انتخاب از تقویم بزنید`} onClick={onPick}>
        {faDigits(jd.jd)} {J_MONTHS[jd.jm - 1]}
      </button>
      <button disabled={busy} title="یک روز دیرتر" onClick={() => onChange("move", 1)}>‹</button>
      <i />
      <button disabled={busy || !(daysNow > 0.5)} title="یک روز کمتر" onClick={() => onChange("end", -1)}>−</button>
      <input type="number" inputMode="decimal" step="0.5" min="0.5" value={days} disabled={busy} title="تعداد روز"
        onChange={(e) => setDays(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <span>روز</span>
      <button disabled={busy} title="یک روز بیشتر" onClick={() => onChange("end", 1)}>+</button>
      <i />
      <input className={j.crewManual ? "g-crew own" : "g-crew"} type="number" inputMode="numeric" step="1" min="1" max="50" value={crew} disabled={busy}
        title={`چند نفر روی این کار باشند (${faDigits(round1(j.hours))} نفر-ساعت کار مانده؛ نفرِ بیشتر، روزِ کمتر)`}
        onChange={(e) => setCrew(e.target.value)} onBlur={saveCrew} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <span>نفر</span>
    </div>
  );
}

/* ---------- برنامهٔ روزانه: ایستگاه × روزهای هفته ---------- */
function Board({ data }) {
  const [from, setFrom] = useState(() => weekStart(data.today));
  const [printing, setPrinting] = useState(false);
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
        <button className="submit" onClick={() => setPrinting(true)}>چاپ / PDF برنامهٔ هفته</button>
      </div>
      {printing && <WeekPlanDoc data={data} days={days} rows={rows} live={live} past={past} cell={cell} onClose={() => setPrinting(false)} />}
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
                      {awayText(info)}
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

/** برنامهٔ هفتگی کارگاه برای چاپ یا ذخیرهٔ PDF: همان جدولِ ایستگاه × روز، روی یک برگ A4 افقی با سربرگ و جای امضا.
    ایستگاهی که در این هفته هیچ کاری ندارد نمی‌آید تا جدول روی کاغذ جا شود. */
function WeekPlanDoc({ data, days, rows, live, past, cell, onClose }) {
  const range = `${jLong(days[0])} تا ${jLong(days[6])}`;
  useEffect(() => {
    const was = document.title;
    document.title = `برنامه-هفتگی-کارگاه-${jShort(days[0]).replace(/\//g, "-")}`;
    return () => { document.title = was; };
  }, [days]);
  const linesOf = (iso) => (iso < data.start ? past[iso]?.lines : live[iso]?.lines) || [];
  const busy = rows.filter((st) => days.some((d) => linesOf(d).some((l) => l.station === st.id)));
  const total = (iso) => {
    const ls = linesOf(iso);
    if (!ls.length) return null;
    return iso < data.start
      ? `برنامه ${num(round1(ls.reduce((a, l) => a + l.planned, 0)))} · انجام ${num(round1(ls.reduce((a, l) => a + l.actual, 0)))} م²`
      : `${num(round1(ls.reduce((a, l) => a + l.area, 0)))} م² · ${faDigits(Math.ceil((live[iso]?.used || 0) - 0.05))} نفر`;
  };
  return (
    <PrintableDoc onClose={onClose}>
      <style>{"@media print{@page{size:A4 landscape;margin:9mm}}"}</style>
      <div className="doc-sheet wide wk-sheet">
        <DocLetterhead title="برنامهٔ هفتگی کارگاه" subtitle={range} />
        {busy.length === 0 ? <div className="doc-none">برای این هفته کاری در برنامه نیست.</div> : (
          <table className="plan-grid wk">
            <thead>
              <tr>
                <th>ایستگاه</th>
                {days.map((d) => {
                  const info = dayInfo(data, d);
                  const off = info.base + info.overtime <= 0;
                  return (
                    <th key={d} className={off ? "off" : ""}>
                      {WEEKDAYS[toDate(d).getDay()]} <span>{jShort(d).slice(5)}</span>
                      <small>
                        {off ? (info.holiday || "تعطیل") : `${faDigits(info.base)} ساعت${info.overtime ? ` + ${faDigits(info.overtime)} اضافه‌کاری` : ""}`}
                        {awayText(info)}
                      </small>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {busy.map((st) => (
                <tr key={st.id}>
                  <th>{st.name}{st.crew ? <small>{faDigits(st.crew)} نفر</small> : null}</th>
                  {days.map((d) => {
                    const info = dayInfo(data, d);
                    return <td key={d} className={`${info.base + info.overtime <= 0 ? "off" : ""}${d < data.start ? " past" : ""}`}>{cell(st, d)}</td>;
                  })}
                </tr>
              ))}
              <tr className="sum">
                <th>جمع روز</th>
                {days.map((d) => <td key={d}>{total(d) || "—"}</td>)}
              </tr>
            </tbody>
          </table>
        )}
        <div className="doc-sign">
          <div>سرپرست کارگاه: ......................................</div>
          <div>مسئول برنامه‌ریزی: ......................................</div>
          <div>مدیریت: ......................................</div>
        </div>
        <div className="doc-foot">
          تولیدشده در Diwaj ERP در {jLong(data.today)} · روزهای پیشِ رو زمان‌بندیِ همان لحظه‌اند و با هر گزارشِ تازه جابه‌جا می‌شوند
          {days[0] < data.start ? " · روزهای گذشته: برنامهٔ ثبت‌شده در برابر کارِ انجام‌شده" : ""}
        </div>
      </div>
    </PrintableDoc>
  );
}

/* ---------- برگهٔ روزانه: کارِ یک روز، ایستگاه به ایستگاه، برای چاپ و دستِ سرپرست ---------- */
function DaySheet({ data }) {
  const [at, setAt] = useState(0);
  if (!data.days.length) return <Empty art="production">کاری در برنامه نمانده.</Empty>;
  const i = Math.min(at, data.days.length - 1);
  const day = data.days[i];
  const groups = data.stations.filter((st) => st.active)
    .map((st) => ({ st, lines: day.lines.filter((l) => l.station === st.id) })).filter((g) => g.lines.length);
  const total = day.lines.reduce((a, l) => a + l.area, 0);
  return (
    <>
      <div className="card plan-bar no-print">
        <button className="ghost" disabled={i === 0} onClick={() => setAt(i - 1)}>روزِ قبل ›</button>
        <b style={{ flex: 1, textAlign: "center" }}>{jLong(day.date)}{day.date === data.today ? " (امروز)" : ""}</b>
        <button className="ghost" disabled={i >= data.days.length - 1} onClick={() => setAt(i + 1)}>‹ روزِ بعد</button>
        <button className="submit" onClick={() => window.print()}>چاپ</button>
      </div>
      <div className="card day-sheet">
        <div className="ds-head">
          <b>برنامهٔ کارِ {jLong(day.date)}</b>
          <span>
            {faDigits(day.base)} ساعت کار{day.overtime ? ` + ${faDigits(day.overtime)} ساعت اضافه‌کاری` : ""} · {faDigits(day.present)} نفر حاضر
            {awayText(day)}
          </span>
        </div>
        {groups.length === 0 ? <div className="empty">برای این روز کاری در برنامه نیست.</div> : (
          <table className="plan-grid ds print-table">
            <thead>
              <tr><th>ایستگاه</th><th>پروژه</th><th>مرحله</th><th>برنامه (م²)</th><th>نفر</th><th>انجام‌شده (م²)</th><th>توضیح / علتِ کم‌کاری</th></tr>
            </thead>
            <tbody>
              {groups.map((g) => g.lines.map((l, k) => (
                <tr key={`${g.st.id}-${k}`}>
                  {k === 0 && <th rowSpan={g.lines.length}>{g.st.name}</th>}
                  <td>{l.project}</td>
                  <td>{l.stage}</td>
                  <td><b>{num(l.area)}</b></td>
                  <td>{faDigits(l.people)}</td>
                  <td /><td />
                </tr>
              )))}
              <tr><th colSpan={3}>جمع</th><td><b>{num(round1(total))}</b></td><td>{faDigits(Math.ceil(day.used - 0.05))}</td><td /><td /></tr>
            </tbody>
          </table>
        )}
        <div className="ds-foot">
          <span>سرپرست: ……………………………</span>
          <span>امضا: ……………………</span>
        </div>
        <div className="muted sm2 no-print" style={{ marginTop: 8 }}>
          این برگه از برنامهٔ همین لحظه ساخته می‌شود. ستون‌های «انجام‌شده» و «توضیح» خالی است تا سرپرست در کارگاه پر کند و آخرِ روز از رویش گزارش ثبت شود.
        </div>
      </div>
    </>
  );
}

/** روندِ صفِ یک ایستگاه در چهار هفتهٔ گذشته، به شکلِ یک خطِ کوچک. */
function QueueTrend({ rows }) {
  if (!rows || rows.length < 2) return <span className="muted sm2">{rows && rows.length ? "از امروز برداشته می‌شود" : "هنوز داده‌ای نیست"}</span>;
  const max = Math.max(...rows.map((r) => r.ready), 1), w = 110, h = 24;
  // مثل گانت: زمان از راست به چپ جلو می‌رود
  const pts = rows.map((r, i) => `${w - (i / (rows.length - 1)) * w},${h - 2 - (r.ready / max) * (h - 4)}`).join(" ");
  const first = rows[0], last = rows[rows.length - 1];
  return (
    <span className="q-trend" title={`${jShort(first.date)}: ${num(first.ready)} م² ← ${jShort(last.date)}: ${num(last.ready)} م²`}>
      <svg width={w} height={h} style={{ direction: "ltr" }} aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" /></svg>
      <small className="muted">{last.ready > first.ready ? "رو به بزرگ شدن" : last.ready < first.ready ? "رو به کوچک شدن" : "ثابت"}</small>
    </span>
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
    // ایستگاهِ خودکار با شناسهٔ «s:…» می‌رود تا سرور اگر دست نخورده خودکار نگهش دارد.
    id: /^\d+$/.test(r.key) || r.key.startsWith("s:") ? r.key : null, name: r.name.trim(), crew: Number(r.crew) || 1,
    stages: r.stages, people: r.people, active: r.active,
  }))));

  const jobs = data.projects.flatMap((p) => p.jobs.filter((j) => j.remaining > 0).map((j) => ({ p, j })));
  const active = data.stations.filter((s) => s.active);

  const queues = [...(data.queues || [])].sort((a, b) => b.load - a.load || b.ready - a.ready);

  return (
    <>
      <div className="card">
        <div className="board-h">بار و صفِ ایستگاه‌ها — گلوگاه کجاست؟</div>
        <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
          «بار» یعنی در دو هفتهٔ کاریِ پیشِ رو چند درصدِ وقتِ ایستگاه با برنامهٔ فعلی پر است. «صف» یعنی همین حالا چند متر کار
          جلویش آماده مانده و هنوز شروع نشده. گلوگاه ایستگاهی است که هم بارش بالاست هم صفش هفته‌ها بزرگ می‌ماند؛
          روندِ صف هر صبح خودکار برداشته می‌شود.
        </div>
        <div className="table-scroll">
          <table className="mini-table">
            <thead><tr><th>ایستگاه</th><th>نفر</th><th>بارِ دو هفتهٔ پیشِ رو</th><th>کارِ آمادهٔ منتظر</th><th>روندِ صف (۴ هفته)</th></tr></thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.station}>
                  <td>{q.name}{q.bottleneck && <span className="pill bad" style={{ marginInlineStart: 6 }}>گلوگاهِ احتمالی</span>}</td>
                  <td>{faDigits(q.crew)}</td>
                  <td style={{ minWidth: 150 }}>
                    <b className={q.load >= 100 ? "var-hi" : q.load >= 85 ? "var-mid" : ""}>{faDigits(Math.round(q.load))}٪</b>
                    <div className="bar sm" style={{ marginTop: 3 }}><div style={{ width: `${Math.min(q.load, 100)}%` }} /></div>
                  </td>
                  <td>{q.ready ? `${num(q.ready)} م² · ${faDigits(q.jobs)} کار` : <span className="muted">چیزی منتظر نیست</span>}</td>
                  <td><QueueTrend rows={q.trend} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
  const [crew, setCrew] = useState(String(j.crew));
  useEffect(() => { setCrew(String(j.crew)); }, [j.crew]);
  const saveCrew = () => {
    const n = Math.round(Number(crew));
    if (!(n >= 1 && n <= 50) || n === j.crew) { setCrew(String(j.crew)); return; }
    send({ crew: n });
  };
  return (
    <tr>
      <td>{p.label}</td>
      <td>{j.stage}{j.together.length > 0 && <small className="muted"> · با {j.together.map((m) => m.label).join(" و ")}</small>}</td>
      <td>{num(j.remaining)}</td>
      <td style={{ minWidth: 190 }}>
        {canEdit
          ? <JalaliPicker value={j.start || ""} placeholder="زمانی نگرفته" onChange={(v) => v && v !== j.start && send({ notBefore: v, pull: true })} />
          : (j.start ? jShort(j.start) : "—")}
      </td>
      <td>
        {canEdit
          ? <input className="plan-days" type="number" inputMode="decimal" step="0.5" min="0.5" value={days} disabled={busy}
              onChange={(e) => setDays(e.target.value)} onBlur={saveDays} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          : faDigits(j.days ?? "—")}
      </td>
      <td>
        {canEdit
          ? <input className="plan-days" type="number" inputMode="numeric" step="1" min="1" max="50" value={crew} disabled={busy}
              title={`${faDigits(round1(j.hours))} نفر-ساعت کار مانده`}
              onChange={(e) => setCrew(e.target.value)} onBlur={saveCrew} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          : faDigits(j.crew)}
      </td>
      <td>{j.finish ? jShort(j.finish) : "—"}</td>
      <td>{j.placed || j.manual || j.crewManual ? "دستی" : "پیشنهاد نرم‌افزار"}{j.suggestedDays != null && j.manual ? ` (پیشنهاد: ${faDigits(j.suggestedDays)} روز)` : ""}</td>
      <td><Slip days={j.slipDays} /></td>
      <td>
        {canEdit && (j.placed || j.manual || j.crewManual) && (
          <button className="linkish" disabled={busy} onClick={() => send({ days: null, notBefore: null, crew: null })}>برگرد به پیشنهاد</button>
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
      setNote("تاریخ‌ها عوض نشد: زودتر از این جا نیست (هر مرحلهٔ مانده یک روز جا می‌خواهد و برنامه از امروز شروع می‌شود)، یا این کار «با هم» به پروژهٔ دیگری بسته است.");
    }
    return d;
  };
  if (!rows.length) return <Empty art="production">کاری نمانده.</Empty>;
  return (
    <div className="card">
      <div className="board-h">تاریخ شروع و مدتِ هر کار</div>
      <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
        تاریخ شروع را از تقویم انتخاب کنید و تعداد روز یا تعداد نفر را بنویسید (با Enter یا رفتن به خانهٔ دیگر ذخیره می‌شود). همان چیزی است که با کشیدنِ نوارها در گانت عوض می‌شود.
        اگر کاری را زودتر از مرحلهٔ قبلش بگذارید، مرحلهٔ قبل خودش زودتر می‌آید. با عوض کردنِ تعداد نفر، مدت از روی نفر-ساعتِ کار از نو حساب می‌شود.
      </div>
      {note && <div className="notice warn">{note}</div>}
      <div className="table-scroll">
        <table className="mini-table">
          <thead><tr><th>پروژه</th><th>مرحله</th><th>مانده (م²)</th><th>تاریخ شروع</th><th>تعداد روز</th><th>نفر</th><th>پایان</th><th>نوع</th><th>انحراف</th><th /></tr></thead>
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
                  <td><Slip days={p.slipDays} />{p.pauseDays > 0 && <small className="muted"> + {faDigits(p.pauseDays)} روز توقف</small>}</td>
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
        <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
          برنامهٔ هر روز همان است که صبحِ همان روز بود (هر صبح خودکار نگه داشته می‌شود)، نه برنامهٔ چند روز پیش. مبنای هفته هم
          هر شنبه صبح خودکار ثبت می‌شود؛ «چند روز عقب» نسبت به همان مبناست.
        </div>
        {!dev ? <div className="empty">هنوز روزی از برنامهٔ ثبت‌شده نگذشته است.</div> : (
          <>
            <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
              در {faDigits(dev.days)} روز، از {num(dev.planned)} م² برنامه {num(dev.actual)} م² انجام شده؛ میانگین تحقق روزانه {faDigits(dev.avgPercent)}٪
              و انحراف معیار آن {faDigits(dev.stdPercent)}٪ است (هر چه کمتر، روزها یکنواخت‌تر).
            </div>
            <div className="table-scroll">
              <table className="mini-table">
                <thead><tr><th>روز</th><th>برنامه (م²)</th><th>انجام‌شده (م²)</th><th>تحقق</th><th>کارِ خارج از برنامه (م²)</th>
                  <th title="ساعتِ کارِ عمومیِ کارگاه: برنامه‌ریزی‌شده / گزارش‌شده">کار عمومی (ساعت)</th><th /></tr></thead>
                <tbody>
                  {[...data.past].reverse().map((d) => [
                    <tr key={d.date}>
                      <td>{jLong(d.date)}</td>
                      <td>{num(d.planned)}</td>
                      <td>{num(d.actual)}</td>
                      <td>{d.percent == null ? "—" : <span className={`pill ${d.percent >= 90 ? "ok" : "bad"}`}>{faDigits(d.percent)}٪</span>}</td>
                      <td>{d.unplanned ? num(d.unplanned) : ""}</td>
                      <td>{d.generalPlanned || d.generalActual
                        ? <span className={d.generalActual > d.generalPlanned + 0.5 ? "pill bad" : ""}
                          title="برنامه / گزارش‌شده">{faDigits(d.generalPlanned || 0)} / {faDigits(d.generalActual || 0)}</span> : ""}</td>
                      <td><button className="linkish" onClick={() => setOpen(open === d.date ? null : d.date)}>{open === d.date ? "بستن" : "ریز"}</button></td>
                    </tr>,
                    open === d.date && d.lines.map((l, i) => (
                      <tr key={`${d.date}-${i}`} className="muted">
                        <td style={{ paddingInlineStart: 22 }}>{l.stationName || "—"} · {l.project} — {l.stage}</td>
                        <td>{num(l.planned)}</td>
                        <td>{num(l.actual)}</td>
                        <td colSpan={4} />
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
function JobDialog({ data, project, job, busy, onClose, onSave }) {
  const [days, setDays] = useState(job.manual && job.days != null ? String(job.days) : "");
  const [notBefore, setNotBefore] = useState(job.notBefore || "");
  const [station, setStation] = useState(job.stationFixed ? job.station : "");
  const [together, setTogether] = useState(() => job.together.map((m) => m.id));
  const [crew, setCrew] = useState(job.crewManual ? String(job.crew) : "");
  const people = crew === "" ? job.stationCrew : Math.round(Number(crew));
  const crewBad = crew !== "" && !(people >= 1 && people <= 50);
  // همان نفر-ساعت کار با این تعداد نفر چند روز می‌شود (سرعتِ هر نفر از سابقهٔ همین مرحله)
  const perPerson = job.suggestedDaily ? job.suggestedDaily / job.crew : 0;
  const daysWith = perPerson && !crewBad ? round1(job.remaining / (perPerson * people)) : null;
  // پروژه‌های دیگری که از همین مرحله کار مانده دارند؛ می‌شود این کار را با آن‌ها «با هم» کرد.
  const mates = data.projects.filter((p) => p.id !== project.id && p.jobs.some((j) => j.stage === job.stage && j.remaining > 0));
  const n = Number(days);
  const bad = days !== "" && !(n > 0);
  const body = () => ({ project: project.id, stage: job.stage, days: days === "" ? null : n, notBefore: notBefore || null,
    pull: !!notBefore && notBefore !== (job.notBefore || ""), crew: crew === "" ? null : people,
    station: station || null, together });

  return (
    <Overlay title={`${project.label} — ${job.stage}`} busy={busy} onClose={onClose}>
      {(job.why || job.critical) && (
        <div className="why-box">
          <b>چرا اینجاست؟</b> {job.why || "از اولین روزِ ممکن و با توانِ کامل."}
          {job.critical && <div className="wi-bad" style={{ marginTop: 4 }}>این کار روی مسیرِ بحرانی است: هر روز که زودتر تمام شود، پایانِ برنامه جلو می‌آید.</div>}
        </div>
      )}
      <div className="quote-box" style={{ marginTop: 0 }}>
        <div className="quote-row"><span>کارِ مانده</span><b>{num(job.remaining)} م²</b>
          <small>از {num(job.planned)} م²{job.hours ? ` · ${faDigits(round1(job.hours))} نفر-ساعت کار` : ""}</small></div>
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
      <div className="row2">
        <label className="fld sm"><span>چند نفر روی این کار باشند؟</span>
          <input type="number" inputMode="numeric" min="1" max="50" value={crew} placeholder={`${faDigits(job.stationCrew)} (نفراتِ ایستگاه)`}
            onChange={(e) => { setCrew(e.target.value); setDays(""); }} />
        </label>
        <label className="fld sm"><span>چند روز کاری در نظر بگیریم؟</span>
          <input type="number" inputMode="decimal" value={days} placeholder={daysWith != null ? `${faDigits(daysWith)} (از روی نفر-ساعت)` : "تعداد روز"}
            onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      {days === "" && daysWith != null && (
        <div className="hint-remaining">با {faDigits(people)} نفر حدود {faDigits(daysWith)} روز کاری طول می‌کشد. نفرِ بیشتر بدهید، زودتر تمام می‌شود.</div>
      )}
      {days !== "" && n > 0 && (
        <div className="hint-remaining">یعنی روزی {num(job.remaining / n)} م². اگر روزی کمتر از این کار شود، باقیمانده خودش روزهای بعد را عقب می‌برد.</div>
      )}
      <div className="row2">
        <label className="fld sm"><span>روز شروع (مرحله‌های قبل با آن جور می‌شوند)</span>
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
        {(job.manual || job.crewManual || job.notBefore || job.stationFixed || job.together.length > 0) && (
          <button className="ghost" disabled={busy}
            onClick={() => onSave({ project: project.id, stage: job.stage, days: null, crew: null, notBefore: null, station: null, together: [] })}>برگرد به پیشنهاد نرم‌افزار</button>
        )}
        <button className="submit" disabled={busy || bad || crewBad} onClick={() => onSave(body())}>ذخیره</button>
      </div>
      <WhyOff busy={busy} reasons={[bad && "تعداد روز باید بزرگ‌تر از صفر باشد", crewBad && "تعداد نفر باید بین ۱ و ۵۰ باشد"]} />
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

/** مرخصی، یا کارِ عمومیِ کارگاه (نظافت، تعمیر، بارگیری…) — هر دو همان ساعت‌ها را از توانِ پروژه‌ها کم می‌کنند. */
function LeaveDialog({ data, busy, run, general, onClose }) {
  const kind = general ? "general" : "leave";
  const [employee, setEmployee] = useState("");
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState(data.today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const badHours = hours !== "" && !(Number(hours) > 0 && Number(hours) <= 12);
  const ok = employee && from && to && to >= from && !badHours;
  const add = async () => {
    if (await run(() => productionApi.planLeave({ employee, from, to, kind, hours, note }))) { setEmployee(""); setHours(""); setNote(""); }
  };
  const list = data.leaves.filter((l) => (l.kind || "leave") === kind);
  return (
    <Overlay title={general ? "کار عمومی کارگاه" : "مرخصی"} busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        {general
          ? "کسی که کار عمومیِ کارگاه دارد (نظافت، تعمیر، بارگیری و مانند آن) همان ساعت‌ها روی پروژه‌ها حساب نمی‌شود. در «انحراف از برنامه» با ساعتِ کار عمومیِ گزارش‌شده مقایسه می‌شود."
          : "کسی که مرخصی است آن ساعت‌ها در توان کارگاه شمرده نمی‌شود؛ اگر نفرِ ثابتِ ایستگاهی باشد، همان ایستگاه هم کندتر می‌شود."}
        {" "}ساعت را خالی بگذارید یعنی کلِ روز.
      </div>
      {list.length === 0 ? <div className="empty">{general ? "کار عمومی‌ای ثبت نشده." : "مرخصی‌ای ثبت نشده."}</div> : list.map((l) => (
        <div className="it-line" key={l.id}>
          <span className="it-emp">{l.employee}</span>
          <span className="it-h">
            {l.from === l.to ? jLong(l.from) : `${jShort(l.from)} تا ${jShort(l.to)}`}
            {l.hours ? ` · ${faDigits(l.hours)} ساعت` : " · کلِ روز"}{l.note ? ` · ${l.note}` : ""}
          </span>
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
      <div className="row2">
        <label className="fld sm"><span>چند ساعت از هر روز (خالی = کلِ روز)</span>
          <input type="number" min="0.5" max="12" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className="fld sm"><span>{general ? "چه کاری (نظافت، تعمیر…)" : "توضیح"}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
        <button className="submit" disabled={busy || !ok} onClick={add}>{general ? "ثبت کار عمومی" : "ثبت مرخصی"}</button>
      </div>
      <WhyOff busy={busy} reasons={[!employee && "کارگر انتخاب نشده", to < from && "تاریخ پایان پیش از شروع است",
        badHours && "ساعت باید بین ۰ و ۱۲ باشد"]} />
    </Overlay>
  );
}

/** توقفِ یک پروژه: از کِی و چرا. */
function PauseDialog({ data, project, busy, run, onClose }) {
  const [start, setStart] = useState(data.today);
  const [reason, setReason] = useState("client");
  const [note, setNote] = useState("");
  const save = async () => {
    if (await run(() => productionApi.planPause({ project: project.id, start, reason, note }))) onClose();
  };
  return (
    <Overlay title={`توقفِ ${project.label}`} busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        پروژهٔ متوقف در برنامه چیده نمی‌شود و ایستگاه‌ها به پروژه‌های بعدی می‌رسند. روزهای توقف در «انحراف از برنامه» تقصیرِ
        کارگاه حساب نمی‌شود و پس از ادامه، کارهایش «عقب‌افتاده» نمی‌شوند. در فرم گزارش کار همچنان می‌ماند.
      </div>
      <div className="row2">
        <label className="fld sm"><span>از روز</span><JalaliPicker value={start} onChange={setStart} /></label>
        <label className="fld sm"><span>علت</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {(data.pauseReasons || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <label className="fld sm"><span>توضیح</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: تا تأیید رنگ نمونه" /></label>
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        <button className="submit-warn" style={{ width: "auto", margin: 0 }} disabled={busy || !start} onClick={save}>توقف پروژه</button>
      </div>
    </Overlay>
  );
}

/** ادامهٔ پروژهٔ متوقف؛ پیشنهاد می‌دهد تاریخ تحویل به اندازهٔ روزهای توقف جلو برود. */
function ResumeDialog({ data, pause, busy, run, onClose }) {
  const [end, setEnd] = useState(data.today < pause.start ? pause.start : data.today);
  const days = Math.max(dayDiff(pause.start, end), 0);
  const [shiftDue, setShiftDue] = useState(Boolean(pause.dueDate));
  const save = async () => {
    if (await run(() => productionApi.planResume({ project: pause.projectId, end, shiftDue }))) onClose();
  };
  return (
    <Overlay title={`ادامهٔ ${pause.label}`} busy={busy} onClose={onClose}>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        متوقف از {jLong(pause.start)} — {pause.reasonLabel}{pause.note ? ` (${pause.note})` : ""}. کارهای مانده با اولویتِ خودِ پروژه
        دوباره چیده می‌شوند.
      </div>
      <label className="fld sm"><span>ادامه از روز</span><JalaliPicker value={end} onChange={setEnd} /></label>
      {pause.dueDate && (
        <label className="chk" style={{ margin: "8px 0" }}>
          <input type="checkbox" checked={shiftDue} onChange={(e) => setShiftDue(e.target.checked)} />
          {" "}تاریخ تحویل {faDigits(days)} روز جلو برود ({jShort(pause.dueDate)} ← {jShort(addDays(pause.dueDate, days))})
        </label>
      )}
      <div className="btn-row">
        <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
        <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy || end < pause.start} onClick={save}>ادامهٔ کار</button>
      </div>
      <WhyOff busy={busy} reasons={[end < pause.start && "روزِ ادامه پیش از روزِ توقف است"]} />
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
