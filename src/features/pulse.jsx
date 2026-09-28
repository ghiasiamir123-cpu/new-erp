import { useState, useEffect } from "react";
import { productionApi, warehouseApi } from "../api.js";
import { JalaliPicker, faDigits, jShort, round2, todayIso } from "../shared/core.jsx";

/* ============ نبض تولید — بالای داشبورد ============
   هر پنج بخش از دادهٔ موجود ساخته می‌شود؛ جایی که داده هنوز وارد نشده (هدف مرحله، تاریخ
   تعهد، شمارهٔ بچ) به‌جای جدول خالی، می‌گوید کجا باید پر شود. */

const tone = (v, ok, mid) => (v == null ? "" : v >= ok ? "var-ok" : v >= mid ? "var-mid" : "var-hi");
const absTone = (v) => (v == null ? "" : Math.abs(v) <= 10 ? "var-ok" : Math.abs(v) <= 25 ? "var-mid" : "var-hi");

export function ProductionPulse() {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setData(null);
    productionApi.pulse(period, date)
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [period, date]);

  if (err) return <div className="notice warn">نبض تولید بارگذاری نشد: {err}</div>;

  return (
    <div className="pulse">
      <div className="card">
        <div className="pulse-head">
          <div className="board-h">متراژ انجام‌شده در برابر هدف</div>
          <div className="seg-row">
            <button className={period === "day" ? "seg on" : "seg"} onClick={() => setPeriod("day")}>روز</button>
            <button className={period === "week" ? "seg on" : "seg"} onClick={() => setPeriod("week")}>۷ روز</button>
            <div className="pulse-date"><JalaliPicker value={date} onChange={(d) => setDate(d || todayIso())} /></div>
          </div>
        </div>
        {!data ? <div className="empty">…</div> : <Throughput t={data.throughput} />}
      </div>

      {data && (
        <>
          <div className="pulse-grid">
            <div className="card"><Promises rows={data.promises} missing={data.withoutDueDate}
              enough={data.enoughHistory} /></div>
            <div className="card"><Bottlenecks b={data.bottlenecks} /></div>
          </div>
          <div className="card"><StageTimes rows={data.stageTimes} /></div>
        </>
      )}
    </div>
  );
}

function Throughput({ t }) {
  const range = t.period === "day" ? jShort(t.to) : `${jShort(t.from)} تا ${jShort(t.to)}`;
  return (
    <>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        {range}{t.period === "week" && ` · ${faDigits(t.workingDays)} روز کاری`} ·
        {" "}نوار پر = تأییدشده، کم‌رنگ = در انتظار تأیید
      </div>
      {!t.hasTargets && (
        <div className="notice" style={{ marginBottom: 10 }}>
          هنوز برای مراحل هدف روزانه تعیین نشده؛ فقط متراژ انجام‌شده دیده می‌شود. هدف را در
          «تولید ← مراحل»، ستون «هدف روزانه» وارد کنید.
        </div>
      )}
      {t.stages.map((s) => {
        const scale = Math.max(s.target || 0, s.total, 1);
        return (
          <div className="bar-row" key={s.name}>
            <div className="bar-lbl" title={s.name}>{s.name}</div>
            <div className="bar pulse-bar">
              <div style={{ width: `${(s.done / scale) * 100}%` }} />
              <div className="pend" style={{ width: `${(s.pending / scale) * 100}%` }} />
              {s.target ? <i style={{ insetInlineStart: `${(s.target / scale) * 100}%` }} /> : null}
            </div>
            <div className="bar-v pulse-v">
              <b>{faDigits(round2(s.total))}</b>
              {s.target ? <> / {faDigits(round2(s.target))} <span className={tone(s.percent, 100, 75)}>
                {faDigits(Math.round(s.percent))}٪</span></> : " م²"}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Promises({ rows, missing, enough }) {
  return (
    <>
      <div className="board-h">پایان پیش‌بینی‌شده در برابر تاریخ تعهد</div>
      {!enough && <div className="muted sm2" style={{ marginBottom: 8 }}>سابقه هنوز کم است؛ تاریخ‌ها تقریبی‌اند.</div>}
      {rows.length === 0 ? <div className="empty">پروژهٔ در جریانی نیست.</div> : (
        <table className="mini-table">
          <thead><tr><th>پروژه</th><th>تعهد</th><th>پیش‌بینی</th><th>فاصله</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.projectId}>
                <td>{r.projectName}</td>
                <td>{r.dueDate ? jShort(r.dueDate) : <span className="muted">ثبت نشده</span>}</td>
                <td>{r.forecastDate ? jShort(r.forecastDate) : "—"}</td>
                <td>
                  {r.slackDays == null ? <span className="muted">—</span>
                    : <span className={r.slackDays >= 7 ? "var-ok" : r.slackDays >= 0 ? "var-mid" : "var-hi"}>
                        {r.slackDays >= 0 ? `${faDigits(r.slackDays)} روز جلو` : `${faDigits(-r.slackDays)} روز عقب`}
                      </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {missing > 0 && (
        <div className="muted sm2" style={{ marginTop: 8 }}>
          {faDigits(missing)} پروژهٔ باز تاریخ تحویل ندارد؛ در «پروژه‌ها» وارد کنید تا اینجا مقایسه شود.
        </div>
      )}
      <div className="muted sm2" style={{ marginTop: 6 }}>
        پیش‌بینی با صف کارهای فعلی است: فرض می‌کند باقی پروژه‌ها هم هم‌زمان جلو می‌روند.
      </div>
    </>
  );
}

function Bottlenecks({ b }) {
  const rows = b.stages.filter((s) => s.waiting > 0 || s.remaining > 0);
  const max = Math.max(1, ...rows.map((s) => s.waiting));
  return (
    <>
      <div className="board-h">گلوگاه مراحل — متراژ منتظر</div>
      {rows.length === 0 ? <div className="empty">کاری پشت هیچ مرحله‌ای نمانده.</div> : rows.map((s) => (
        <div className="bar-row" key={s.name}
          title={s.projects.map((p) => `${p.project}: ${faDigits(p.area)} م²`).join("\n")}>
          <div className="bar-lbl">
            {s.name === b.bottleneck && <span className="pill pulse-hot">گلوگاه</span>} {s.name}
          </div>
          <div className="bar"><div className={s.name === b.bottleneck ? "hot" : ""}
            style={{ width: `${(s.waiting / max) * 100}%` }} /></div>
          <div className="bar-v pulse-v">
            {faDigits(round2(s.waiting))} م²
            {s.daysToClear != null && <span className="muted"> · {faDigits(s.daysToClear)} روز</span>}
          </div>
        </div>
      ))}
      <div className="muted sm2" style={{ marginTop: 6 }}>
        آنچه مرحلهٔ قبل تمام کرده و این مرحله هنوز رویش کار نکرده. «روز» با سرعت واقعی همان مرحله است.
      </div>
    </>
  );
}

function StageTimes({ rows }) {
  return (
    <>
      <div className="board-h">زمان واقعی هر مرحله در برابر ضریب تعریف‌شده</div>
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table">
          <thead>
            <tr><th>مرحله</th><th>ضریب زمان</th><th>واقعی</th><th>اختلاف</th>
              <th>ساعت بر متر</th><th>ضریب دست</th><th>واقعی</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{faDigits(r.timeWeight)}</td>
                <td>{r.actualTimeWeight == null ? <span className="muted">—</span> : faDigits(r.actualTimeWeight)}</td>
                <td className={absTone(r.timeVariance)}>
                  {r.timeVariance == null ? "" : `${r.timeVariance > 0 ? "+" : ""}${faDigits(r.timeVariance)}٪`}</td>
                <td>{r.hoursPerM2 == null ? "—" : faDigits(r.hoursPerM2)}</td>
                <td>{faDigits(r.coefficient)}</td>
                <td className={absTone(r.coefficientVariance)}>
                  {r.actualCoefficient == null ? <span className="muted">—</span> : faDigits(r.actualCoefficient)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted sm2" style={{ marginTop: 6 }}>
        اختلاف تا ۱۰٪ نزدیک، تا ۲۵٪ قابل‌توجه، بیشتر دور. تغییر ضریب‌ها در «تولید ← مراحل».
      </div>
    </>
  );
}

/* ============ انقضای بچ‌ها ============ */
export function ExpiringBatches() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    warehouseApi.expiring(90).then(setData).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="notice warn">انقضای بچ‌ها بارگذاری نشد: {err}</div>;
  if (!data) return null;
  const lbl = { expired: "منقضی", soon: "زیر ۳۰ روز", watch: "زیر ۹۰ روز" };
  return (
    <div className="card">
      <div className="board-h">تاریخ انقضای بچ‌ها (رنگ، هاردنر و …)</div>
      <div className="chip-row" style={{ marginTop: 0, marginBottom: 10 }}>
        <span className="chip var-hi">{faDigits(data.expired)} منقضی</span>
        <span className="chip var-mid">{faDigits(data.soon)} زیر ۳۰ روز</span>
        <span className="chip">{faDigits(data.watch)} زیر ۹۰ روز</span>
      </div>
      {data.results.length === 0 ? (
        <div className="empty" style={{ padding: "16px 0" }}>بچی با موجودی تا ۹۰ روز آینده منقضی نمی‌شود.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="mini-table">
            <thead><tr><th>کالا</th><th>بچ</th><th>انبار</th><th>موجودی</th><th>انقضا</th><th>وضعیت</th></tr></thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={`${r.sku}-${r.batchNo}-${r.warehouse}`}>
                  <td>{r.name}</td><td>{r.batchNo}</td><td>{r.warehouse}</td>
                  <td>{faDigits(round2(r.qty))} {r.unit}</td>
                  <td>{jShort(r.expiresOn)}</td>
                  <td className={r.level === "expired" ? "var-hi" : r.level === "soon" ? "var-mid" : ""}>
                    {r.daysLeft < 0 ? `${faDigits(-r.daysLeft)} روز گذشته` : `${faDigits(r.daysLeft)} روز مانده`}
                    <span className="muted"> · {lbl[r.level]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.untracked > 0 && (
        <div className="muted sm2" style={{ marginTop: 8 }}>
          {faDigits(data.untracked)} کالای بچ‌دار بدون شمارهٔ بچ و تاریخ انقضا وارد انبار شده و در این
          فهرست نمی‌آید. در حوالهٔ ورود، ستون بچ و تاریخ انقضا را پر کنید.
        </div>
      )}
    </div>
  );
}
