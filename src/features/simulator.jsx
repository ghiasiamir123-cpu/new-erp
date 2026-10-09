import { useEffect, useMemo, useState } from "react";
import { productionApi } from "../api.js";
import { J_MONTHS, faDigits, isoToJ } from "../shared/core.jsx";
import { Tile, WEEKDAYS, dayDiff, num, toDate } from "./planutil.jsx";
import { Equip, SimDefs, kindOf } from "./simequip.jsx";

/* شبیه‌سازِ کارگاه: همان برنامهٔ تولید، روزبه‌روز روی نمای ایستگاه‌ها پخش می‌شود؛ و با یک «فرض» (نفرِ بیشتر، اضافه‌کاری،
   خرابیِ ایستگاه، سفارشِ تازه…) همان برنامه دوباره چیده و کنارِ برنامهٔ فعلی دیده می‌شود. فقط می‌خواند؛ چیزی ذخیره نمی‌شود. */

const SPEEDS = [["آهسته", 1500], ["عادی", 800], ["تند", 320]];
const DOTS = ["#56d3ba", "#f1bd62", "#8fb8ff", "#f28d9b", "#c9a6f5", "#9bd46a", "#ffb07a", "#7fd6e8", "#e6e08a", "#f5a3d0"];
const CW = 200, CH = 262, MX = 46, MY = 12, PY = 112;      // خانهٔ هر دستگاه، حاشیه، و بلندیِ لوله در خانه
const STATE = { busy: "در حالِ کار", full: "کلِ روز پُر", idle: "بیکار", off: "از کار افتاده" };

const dayName = (iso) => WEEKDAYS[toDate(iso).getDay()];
const jDay = (iso) => { if (!iso) return "—"; const j = isoToJ(iso); return `${faDigits(j.jd)} ${J_MONTHS[j.jm - 1]}`; };
const m2 = (n) => `${num(n)} م²`;

/** هر چه نما لازم دارد، یک بار از برنامهٔ روزبه‌روز حساب می‌شود. */
function digest(tl) {
  const days = tl.days;
  const per = days.map((x) => {
    const st = {};
    let area = 0;
    for (const ln of x.lines) {
      const g = (st[ln.station] ||= { area: 0, share: 0, people: 0, lines: [] });
      g.area += ln.area;
      g.share += ln.share;
      g.people = Math.max(g.people, ln.people || 0);
      g.lines.push(ln);
      area += ln.area;
    }
    return { st, area };
  });
  const backlog = [], left = {};
  for (let d = days.length - 1; d >= 0; d--) {
    for (const [sid, g] of Object.entries(per[d].st)) left[sid] = (left[sid] || 0) + g.area;
    backlog[d] = { ...left };
  }
  const total = {}, first = {}, last = {}, cum = [], acc = {}, load = {};
  let done = 0;
  const doneArea = [];
  days.forEach((x, d) => {
    for (const ln of x.lines) {
      total[ln.projectId] = (total[ln.projectId] || 0) + ln.area;
      if (!(ln.projectId in first)) first[ln.projectId] = d;
      last[ln.projectId] = d;
      acc[ln.projectId] = (acc[ln.projectId] || 0) + ln.area;
    }
    cum.push({ ...acc });
    done += per[d].area;
    doneArea.push(done);
    for (const [sid, g] of Object.entries(per[d].st)) load[sid] = (load[sid] || 0) + Math.min(g.share, 1);
  });
  return { per, backlog, total, first, last, cum, load, doneArea, all: done };
}

/** نمای کارگاه: ورودیِ کار، ایستگاه‌ها به ترتیبِ کار (مارپیچ، ردیفِ اول از راست به چپ) و کامیونِ تحویل؛ لوله‌ها جریانِ کار را نشان می‌دهند. */
function Mimic({ stations, info, day, x, crews, playing, pick, onPick, colorOf, waiting, finished, ended }) {
  const cells = [{ id: "__in", kind: "stack" }, ...stations.map((st) => ({ id: st.id, st, kind: kindOf(st) })), { id: "__out", kind: "truck" }];
  const n = cells.length, cols = n <= 8 ? 4 : n <= 10 ? 5 : 6, rows = Math.ceil(n / cols);
  const VW = MX * 2 + cols * CW, VH = MY * 2 + rows * CH;
  const at = cells.map((c, i) => {
    const row = Math.floor(i / cols), col = i % cols, k = row % 2 === 0 ? col : cols - 1 - col;
    const g = c.st ? info.per[day].st[c.st.id] : null;
    const flows = c.kind === "stack" ? Boolean(info.per[day].st[stations[0]?.id]) : Boolean(g);
    return { ...c, row, x: VW - MX - CW - k * CW, y: MY + row * CH, g, flows };
  });
  const pipe = (p, q) => {
    const yp = p.y + PY, yq = q.y + PY;
    if (p.row === q.row) return p.row % 2 === 0 ? `M${p.x + 22},${yp} H${q.x + CW - 22}` : `M${p.x + CW - 22},${yp} H${q.x + 22}`;
    return p.row % 2 === 0 ? `M${p.x + 22},${yp} H${MX - 26} V${yq} H${q.x + 22}` : `M${p.x + CW - 22},${yp} H${VW - MX + 26} V${yq} H${q.x + CW - 22}`;
  };
  return (
    <svg className={playing ? "sim-svg" : "sim-svg sim-paused"} viewBox={`0 0 ${VW} ${VH}`} role="img"
      aria-label="نمای ایستگاه‌های کارگاه در روزِ انتخاب‌شده">
      <SimDefs />
      {Array.from({ length: rows }, (_, r) => (
        <rect key={r} className="sim-zone" x={MX - 34} y={MY + r * CH + 4} width={VW - 2 * (MX - 34)} height={CH - 12} rx="20" />
      ))}
      {at.slice(0, -1).map((p, i) => <path key={p.id} d={pipe(p, at[i + 1])} className={p.flows ? "sim-pipe sim-flow" : "sim-pipe"} />)}
      {at.map((c, i) => {
        if (!c.st) {
          const isIn = c.kind === "stack";
          const state = isIn ? (waiting ? "busy" : "idle") : ended ? "busy live" : finished ? "busy" : "idle";
          return (
            <g key={c.id} transform={`translate(${c.x},${c.y})`} className={`sim-eq end ${state}`}>
              <text className="sim-name" x={CW / 2} y="20">{isIn ? "ورودیِ کار" : "تحویل"}</text>
              <g transform="translate(12,22) scale(1.1)"><Equip kind={c.kind} /></g>
              <text className="sim-big" x={CW / 2} y="186">{faDigits(isIn ? waiting : finished)}</text>
              <text className="sim-sub" x={CW / 2} y="203">{isIn ? "پروژه در صفِ شروع" : "پروژهٔ تمام‌شده"}</text>
            </g>
          );
        }
        const { st, g } = c;
        const closed = x.closed.includes(st.id);
        const share = g ? Math.min(g.share, 1) : 0;
        const state = closed && !g ? "off" : !g ? "idle" : share >= 0.95 ? "full" : "busy";
        const name = st.name.length > 30 ? `${st.name.slice(0, 29)}…` : st.name;
        const left = info.backlog[day][st.id] || 0;
        const dots = g ? g.lines.slice(0, 8) : [];
        return (
          <g key={c.id} transform={`translate(${c.x},${c.y})`} className={`sim-eq ${state}${g ? " live" : ""}${pick === st.id ? " on" : ""}`}
            role="button" tabIndex={0} aria-label={`ایستگاهِ ${st.name}: ${STATE[state]}`} onClick={() => onPick(st.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(st.id); } }}>
            <rect className="sim-hit" x="6" y="2" width={CW - 12} height={CH - 10} rx="14" />
            <text className={name.length > 22 ? "sim-name sm" : "sim-name"} x={CW / 2} y="20">{name}</text>
            <g transform="translate(12,22) scale(1.1)"><Equip kind={c.kind} /></g>
            <path className="sim-x" d="M62,62 L138,132 M138,62 L62,132" />
            <circle className="sim-badge" cx={CW - 16} cy="36" r="10" />
            <text className="sim-step" x={CW - 16} y="40">{faDigits(i)}</text>
            {dots.map((ln, k) => (
              <circle key={k} className="sim-dot" cx={CW / 2 + (k - (dots.length - 1) / 2) * 13} cy="165" r="4.2" fill={colorOf(ln.projectId)} />
            ))}
            <text className={g ? "sim-big" : "sim-big dim"} x={CW / 2} y="188">{g ? m2(g.area) : "—"}</text>
            <text className="sim-sub" x={CW / 2} y="205">
              {g ? `${num(g.people || crews[st.id] || 1)} نفر · ${faDigits(g.lines.length)} کار` : left > 0.005 ? "منتظرِ نوبت" : "کاری ندارد"}
            </text>
            <rect className="sim-pill" x={CW / 2 - 52} y="213" width="104" height="21" rx="10.5" />
            <circle className="sim-lamp" cx={CW / 2 + 38} cy="223.5" r="3.6" />
            <text className="sim-ptxt" x={CW / 2 - 6} y="227.5">{STATE[state]}</text>
            {left > 0.005 && <text className="sim-left" x={CW / 2} y="249">{`کارِ مانده: ${m2(left)}`}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const BLANK = { station: "", add: 1, workers: 0, otHours: 0, otDays: 12, off: "", offDays: 3, absent: "", absentDays: 3, eff: "", clone: "", first: false };

function toBody(f) {
  const b = {};
  if (f.station) b.station = { id: f.station, add: Number(f.add) || 1 };
  if (Number(f.workers) > 0) b.workers = Number(f.workers);
  if (Number(f.otHours) > 0) b.overtime = { hours: Number(f.otHours), days: Number(f.otDays) || 12 };
  if (f.off) b.off = { station: f.off, days: Number(f.offDays) || 1 };
  if (f.absent) b.absent = { employee: f.absent, days: Number(f.absentDays) || 1 };
  if (f.eff) b.efficiency = { target: Number(f.eff) };
  if (f.clone) b.clone = { project: f.clone, first: Boolean(f.first) };
  return b;
}

export function ProdSimulator() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState("now");
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [custom, setCustom] = useState(false);

  const run = async (body) => {
    setBusy(true);
    try {
      const d = await productionApi.planSim(body && Object.keys(body).length ? body : null);
      setData(d);
      setErr("");
      setSide(d.scenario ? "scenario" : "now");
      setDay(0);
      setPlaying(Boolean(d.scenario));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => { run(null); }, []);

  const tl = data ? (side === "scenario" && data.scenario) || data.now : null;
  const info = useMemo(() => (tl ? digest(tl) : null), [tl]);
  const baseInfo = useMemo(() => (data ? digest(data.now) : null), [data]);
  const last = tl ? tl.days.length - 1 : 0;
  const d = Math.min(day, Math.max(last, 0));

  useEffect(() => {
    if (!playing || !tl) return undefined;
    if (d >= last) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setDay((v) => v + 1), speed);
    return () => clearTimeout(t);
  }, [playing, d, last, speed, tl]);

  if (err && !data) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;
  if (!tl.days.length) return <div className="empty">پروژهٔ بازی در برنامه نیست؛ چیزی برای شبیه‌سازی وجود ندارد.</div>;

  const sc = data.scenario;
  const projects = side === "scenario" && sc ? (sc.extra.length ? [...data.projects, ...sc.extra] : data.projects) : data.projects;
  const colorOf = (pid) => DOTS[Math.max(projects.findIndex((p) => p.id === pid), 0) % DOTS.length];
  const x = tl.days[d];
  const stations = data.stations;
  const busiest = stations.reduce((a, s) => ((baseInfo.load[s.id] || 0) > (baseInfo.load[a?.id] || 0) ? s : a), stations[0]);
  const finished = projects.filter((p) => info.total[p.id] && info.cum[d][p.id] >= info.total[p.id] - 1e-6).length;
  const waiting = projects.filter((p) => info.first[p.id] > d).length;
  const fullness = x.pool > 0 ? Math.round((x.used / x.pool) * 100) : 0;
  const started = projects.filter((p) => info.first[p.id] === d), ended = projects.filter((p) => info.last[p.id] === d);
  const closed = stations.filter((s) => x.closed.includes(s.id) && !info.per[d].st[s.id]);
  const idle = Math.max(x.pool - x.used, 0);
  const picked = stations.find((s) => s.id === pick);
  const eff = data.efficiency;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const presets = [
    busiest && { label: `یک نفرِ بیشتر روی «${busiest.name}»`, body: { station: { id: busiest.id, add: 1 } } },
    { label: "روزی ۲ ساعت اضافه‌کاری، دو هفته", body: { overtime: { hours: 2, days: 12 } } },
    { label: "یک کارگرِ تازه در کارگاه", body: { workers: 1 } },
    busiest && { label: `«${busiest.name}» سه روز از کار بیفتد`, body: { off: { station: busiest.id, days: 3 } } },
    data.projects[0] && { label: `یک سفارشِ تازه مثلِ «${data.projects[0].label}»`, body: { clone: { project: data.projects[0].id } } },
    eff.target + 5 <= eff.max && { label: `بهره‌وری ${faDigits(eff.target + 5)}٪ شود`, body: { efficiency: { target: eff.target + 5 } } },
  ].filter(Boolean);

  const gainText = (g) => (g > 0 ? `${faDigits(g)} روز زودتر` : g < 0 ? `${faDigits(-g)} روز دیرتر` : "بدونِ تغییر");

  return (
    <div className="sim">
      <div className="card sim-top">
        <div className="plan-bar">
          <button className="submit" onClick={() => { if (d >= last) setDay(0); setPlaying((p) => !p); }}>
            {playing ? "❚❚ ایست" : d >= last ? "↻ از اول" : "▶ پخش"}
          </button>
          <button className="ghost" onClick={() => { setPlaying(false); setDay(Math.max(d - 1, 0)); }} disabled={d === 0}>روزِ قبل</button>
          <button className="ghost" onClick={() => { setPlaying(false); setDay(Math.min(d + 1, last)); }} disabled={d >= last}>روزِ بعد</button>
          <div className="seg-row sim-seg" role="group" aria-label="سرعتِ پخش">
            {SPEEDS.map(([label, ms]) => (
              <button key={ms} className={speed === ms ? "seg on" : "seg"} onClick={() => setSpeed(ms)}>{label}</button>
            ))}
          </div>
          <div className="sim-clock" aria-live="off">
            <b>{`روزِ ${faDigits(d + 1)} از ${faDigits(last + 1)}`}</b>
            <span>{`${dayName(x.date)} ${jDay(x.date)}`}</span>
          </div>
        </div>
        <input className="sim-range" type="range" min="0" max={last} value={d} aria-label="روزِ شبیه‌سازی"
          onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }} />
        {sc && (
          <div className="seg-row sim-seg" role="group" aria-label="کدام برنامه پخش شود">
            <button className={side === "now" ? "seg on" : "seg"} onClick={() => { setSide("now"); setDay(0); }}>برنامهٔ فعلی</button>
            <button className={side === "scenario" ? "seg on" : "seg"} onClick={() => { setSide("scenario"); setDay(0); }}>با این فرض</button>
          </div>
        )}
      </div>

      <div className="prod-tiles">
        <Tile label="متراژِ این روز" value={m2(info.per[d].area)} sub={`از ابتدا: ${m2(info.doneArea[d])} از ${m2(info.all)}`} />
        <Tile label="پُر بودنِ کارگاه" value={`${faDigits(fullness)}٪`} tone={fullness >= 85 ? "ok" : fullness < 50 ? "run" : ""}
          sub={`${num(x.used)} از ${num(x.pool)} نفر-روز${x.overtime ? ` · ${num(x.overtime)} ساعت اضافه‌کاری` : ""}`} />
        <Tile label="پروژه‌ها" value={`${faDigits(finished)} از ${faDigits(projects.length)} تمام`} sub={`${faDigits(waiting)} در صفِ شروع`} />
        <Tile label="پایانِ برنامه" value={tl.finish ? jDay(tl.finish) : "ناتمام"} tone={tl.late ? "run" : "ok"}
          sub={tl.late ? `${faDigits(tl.late)} پروژه دیرتر از موعد` : "همه به موعد می‌رسند"} />
        <Tile label="پرکارترین ایستگاه" value={busiest?.name || "—"}
          sub={busiest ? `${faDigits(Math.round((baseInfo.load[busiest.id] || 0) / data.now.days.length * 100))}٪ روزها پُر` : ""} />
      </div>

      {sc && (
        <div className={`sim-result ${sc.endGain > 0 ? "good" : sc.endGain < 0 ? "bad" : ""}`}>
          <b>{`فرض: ${sc.label}`}</b>
          <span>{`پایانِ برنامه: ${jDay(data.now.finish)} ← ${jDay(sc.finish)} (${gainText(sc.endGain ?? 0)})`}
            {sc.late !== data.now.late ? ` · دیرکردها: ${faDigits(data.now.late)} ← ${faDigits(sc.late)}` : ""}</span>
          <button className="ghost" disabled={busy} onClick={() => { setForm(BLANK); run(null); }}>پاک کردنِ فرض</button>
        </div>
      )}

      <div className="sim-mimic">
        <div className="sim-mhead">
          <span>{`حاضر: ${faDigits(x.present)} نفر`}</span>
          <b>{`کارگاه در ${dayName(x.date)} ${jDay(x.date)}`}</b>
          <span>{`ساعتِ کار: ${num(x.hours)}`}</span>
        </div>
        <div className="sim-scroll">
          <Mimic stations={stations} info={info} day={d} x={x} crews={tl.crews} playing={playing} pick={pick} onPick={setPick} colorOf={colorOf}
            waiting={waiting} finished={finished} ended={ended.length} />
        </div>
        <div className="sim-ticker">
          {started.map((p) => <span key={`s${p.id}`} className="go">{`شروع: ${p.label}`}</span>)}
          {ended.map((p) => <span key={`e${p.id}`} className="end">{`پایانِ کار: ${p.label}`}</span>)}
          {closed.map((s) => <span key={`c${s.id}`} className="off">{`«${s.name}» از کار افتاده`}</span>)}
          {idle > 0.3 && <span className="idle">{`${num(idle)} نفر-روز بیکار می‌ماند`}</span>}
          {!started.length && !ended.length && !closed.length && idle <= 0.3 && <span>روزِ کاملِ کاری، بدونِ رویداد</span>}
        </div>
        <div className="sim-legend">
          <span><i className="busy" />در حالِ کار</span><span><i className="full" />کلِ روز پُر</span>
          <span><i className="idle" />بیکار</span><span><i className="off" />از کار افتاده</span>
          <span>هر نقطهٔ رنگی یک پروژه است؛ روی هر دستگاه بزنید تا کارش را ببینید.</span>
        </div>
      </div>

      {picked && (
        <div className="card">
          <div className="sim-fhead">
            <b>{`${picked.name} · ${dayName(x.date)} ${jDay(x.date)}`}</b>
            <button className="ghost" onClick={() => setPick(null)}>بستن</button>
          </div>
          {info.per[d].st[picked.id] ? (
            <ul className="sim-lines">
              {info.per[d].st[picked.id].lines.map((ln, k) => (
                <li key={k}><i style={{ background: colorOf(ln.projectId) }} />
                  <b>{projects.find((p) => p.id === ln.projectId)?.label || "پروژه"}</b>
                  <span>{ln.stage}</span><span>{m2(ln.area)}</span><span>{`${num(ln.people)} نفر`}</span></li>
              ))}
            </ul>
          ) : <p className="sim-note">این ایستگاه در این روز کاری ندارد.</p>}
          <div className="sim-spark" role="group" aria-label="بارِ این ایستگاه در روزهای برنامه">
            {tl.days.map((y, k) => {
              const a = info.per[k].st[picked.id]?.area || 0;
              const top = Math.max(...info.per.map((p) => p.st[picked.id]?.area || 0), 1);
              return <button key={y.date} className={k === d ? "on" : ""} title={`${jDay(y.date)}: ${m2(a)}`} aria-label={`${jDay(y.date)}: ${m2(a)}`}
                onClick={() => { setPlaying(false); setDay(k); }}><i style={{ height: `${Math.round((a / top) * 100)}%` }} /></button>;
            })}
          </div>
          <p className="sim-note">هر ستون یک روزِ برنامه است؛ بلندی = متراژِ این ایستگاه در آن روز.</p>
        </div>
      )}

      <div className="card">
        <h3 className="sim-h">پروژه‌ها در این روز</h3>
        <div className="sim-projects">
          {projects.map((p) => {
            const total = info.total[p.id] || 0, got = info.cum[d][p.id] || 0;
            const pct = total ? Math.round(p.percent + (100 - p.percent) * (got / total)) : 100;
            const fin = tl.finishes[p.id], before = data.now.finishes[p.id];
            const lateBy = p.dueDate && fin ? dayDiff(p.dueDate, fin) : 0;
            const here = [...new Set(tl.days[d].lines.filter((ln) => ln.projectId === p.id).map((ln) => stations.find((s) => s.id === ln.station)?.name || ""))];
            const state = !total || got >= total - 1e-6 ? "تمام شد ✓" : info.first[p.id] > d ? "در صف" : here.length ? `در ${here.join("، ")}` : "در انتظار (خشک‌شدن یا نوبت)";
            const gain = side === "scenario" && sc && before && fin ? dayDiff(fin, before) : 0;
            return (
              <div className="sim-prow" key={p.id}>
                <div className="sim-pname"><i style={{ background: colorOf(p.id) }} /><b>{p.label}</b><span>{state}</span></div>
                <div className="sim-pbar"><i style={{ width: `${pct}%`, background: colorOf(p.id) }} /></div>
                <div className="sim-pend">
                  <span>{`پایان: ${jDay(fin)}`}</span>
                  {p.dueDate && <span>{`موعد: ${jDay(p.dueDate)}`}</span>}
                  {lateBy > 0 && <span className="pill bad">{`${faDigits(lateBy)} روز دیر`}</span>}
                  {gain !== 0 && <span className={gain > 0 ? "pill ok" : "pill bad"}>{gainText(gain)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="sim-h">اگر… (چیزی ذخیره نمی‌شود)</h3>
        <p className="sim-note">یکی را بزنید: برنامه با همان فرض دوباره چیده و روی نمای بالا پخش می‌شود. برنامهٔ واقعی دست نمی‌خورد.</p>
        <div className="seg-pick sim-presets">
          {presets.map((p) => <button key={p.label} disabled={busy} onClick={() => run(p.body)}>{p.label}</button>)}
        </div>
        {err && <div className="notice warn">{err}</div>}
        <button className="ghost sim-more" onClick={() => setCustom((v) => !v)}>{custom ? "بستنِ فرضِ دلخواه" : "فرضِ دلخواه…"}</button>
        {custom && (
          <div className="sim-form">
            <label className="fld"><span>نفرِ بیشتر روی ایستگاه</span>
              <select value={form.station} onChange={set("station")}><option value="">—</option>
                {stations.filter((s) => s.id !== "site").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="fld"><span>چند نفر</span><input type="number" min="1" max="10" value={form.add} onChange={set("add")} /></label>
            <label className="fld"><span>کارگرِ تازه در کارگاه</span><input type="number" min="0" max="20" value={form.workers} onChange={set("workers")} /></label>
            <label className="fld"><span>اضافه‌کاری (ساعت در روز)</span><input type="number" min="0" max="12" step="0.5" value={form.otHours} onChange={set("otHours")} /></label>
            <label className="fld"><span>برای چند روزِ کاری</span><input type="number" min="1" max="120" value={form.otDays} onChange={set("otDays")} /></label>
            <label className="fld"><span>ایستگاهی که از کار می‌افتد</span>
              <select value={form.off} onChange={set("off")}><option value="">—</option>
                {stations.filter((s) => s.id !== "site").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="fld"><span>چند روز</span><input type="number" min="1" max="60" value={form.offDays} onChange={set("offDays")} /></label>
            <label className="fld"><span>کسی که نیست</span>
              <select value={form.absent} onChange={set("absent")}><option value="">—</option>
                {data.employees.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label className="fld"><span>چند روز</span><input type="number" min="1" max="60" value={form.absentDays} onChange={set("absentDays")} /></label>
            <label className="fld"><span>{`هدفِ بهره‌وری (٪، از ${faDigits(eff.base)} تا ${faDigits(eff.max)})`}</span>
              <input type="number" min={eff.base} max={eff.max} step="5" value={form.eff} onChange={set("eff")} placeholder={String(eff.target)} /></label>
            <label className="fld"><span>سفارشِ تازه مثلِ</span>
              <select value={form.clone} onChange={set("clone")}><option value="">—</option>
                {data.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            <label className="fld sim-check"><input type="checkbox" checked={form.first} onChange={set("first")} /><span>سفارشِ تازه اولِ صف برود</span></label>
            <div className="plan-bar sim-go">
              <button className="submit" disabled={busy || !Object.keys(toBody(form)).length} onClick={() => run(toBody(form))}>{busy ? "…" : "اجرا"}</button>
            </div>
          </div>
        )}
      </div>

      <details className="card sim-help">
        <summary>این صفحه را چطور بخوانم؟</summary>
        <ul>
          <li>نمای تیره همان کارگاه است: از «ورودیِ کار» تا کامیونِ «تحویل»، هر دستگاه یک ایستگاه است با متراژِ همان روز، تعدادِ نفر و چراغِ وضعیتش. شمارهٔ کنارِ هر دستگاه ترتیبِ کار را نشان می‌دهد.</li>
          <li>«پخش» را بزنید تا برنامه روزبه‌روز جلو برود؛ یا نوارِ زیرِ آن را بکشید.</li>
          <li>«کارِ مانده» زیرِ هر ایستگاه یعنی از آن روز تا آخرِ برنامه چند متر کار برای آن ایستگاه هست.</li>
          <li>عددها از همان برنامه‌ریزیِ تولید می‌آیند، نه از حدس؛ فرض‌ها هم با همان موتور حساب می‌شوند و هیچ‌چیز ذخیره نمی‌شود.</li>
        </ul>
      </details>
    </div>
  );
}
