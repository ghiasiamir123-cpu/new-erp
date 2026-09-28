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

/* ============ مصرف مواد در برابر استاندارد رنر ============ */
const VERDICT = {
  ok: { label: "درست", cls: "mc-ok" }, low: { label: "کم", cls: "mc-low" }, high: { label: "زیاد", cls: "mc-high" },
  partial: { label: "ثبت ناقص", cls: "mc-miss" }, missing: { label: "ثبت نشده", cls: "mc-miss" },
};
const WHY = {
  primer: {
    ok: "مصرف آستر در محدودهٔ استاندارد رنر است.",
    high: "بیش از استاندارد: پرتِ پیستوله، لایهٔ ضخیم، یا دست دومی که زده شده ولی متراژش در گزارش کار نیامده — اگر این آخری باشد، مصرف واقعی هر دست نصف این عدد است.",
    low: "کمتر از استاندارد: یا لایه نازک زده شده (منافذ MDF خوب پر نمی‌شود) یا بخشی از مصرف ثبت نشده.",
  },
  topcoat: {
    ok: "مصرف رویه در محدودهٔ استاندارد رنر است.",
    high: "بیش از استاندارد: پرتِ پیستوله یا لایهٔ ضخیم‌تر از لازم.",
    low: "کمتر از استاندارد: یا بخشی از رنگ رویه در گزارش مصرف ثبت نشده، یا لایه نازک‌تر از توصیهٔ رنر است — که مقاومت در برابر خط‌وخش و پوشش را کم می‌کند.",
  },
  thinner: {
    ok: "تینر با نسبت رقیق‌سازی رنر همخوان است.",
    high: "بیشتر از نسبت رقیق‌سازی رنر. بخشی از آن شست‌وشوی پیستوله است که در استاندارد نیامده، ولی اختلاف زیاد یعنی رنگ بیش از حد رقیق می‌شود یا شست‌وشو پرمصرف است.",
    low: "کمتر از نسبت رنر؛ رنگِ غلیظ‌تر پاشیده می‌شود یا تینر ثبت نشده.",
  },
};
const g = (kg) => (kg == null ? null : Math.round(kg * 1000));

export function MaterialConsumption() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState(false);
  useEffect(() => { productionApi.materialConsumption().then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="notice warn">مصرف مواد بارگذاری نشد: {err}</div>;
  if (!data) return null;
  const s = data.summary;
  const withCost = data.materials.some((m) => "costPerWoodM2" in m);

  return (
    <div className="card">
      <div className="board-h">مصرف مواد در هر متر — در برابر استاندارد رنر</div>
      <div className="muted sm2" style={{ marginBottom: 12 }}>
        گرم در <b>هر دست روی هر متر مربع</b>، همان واحد دیتاشیت رنر. آستر با متراژ مراحل آستر و رویه
        با متراژ مراحل رنگ سنجیده می‌شود، تا پروژه‌ای که رویه‌اش تمام نشده «کم‌مصرف» دیده نشود.
      </div>

      <div className="mc-gauges">
        {["primer", "topcoat", "thinner"].map((k) => <Gauge key={k} kind={k} row={s[k]} />)}
      </div>

      <div className="board-h" style={{ marginTop: 16 }}>به تفکیک پروژه</div>
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table">
          <thead><tr><th>پروژه</th><th>متراژ چوب</th><th>آستر</th><th>رویه</th><th>تینر</th></tr></thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}<div className="muted sm2">{faDigits(Math.round(p.percent))}٪ پیشرفت</div></td>
                <td>{faDigits(round2(p.wood))} م²</td>
                {["primer", "topcoat", "thinner"].map((k) => <CheckCell key={k} c={p.checks[k]} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mc-notes">
        {["primer", "topcoat"].map((k) => s[k].notRecorded.length > 0 && (
          <div key={k}>⚠ {k === "primer" ? "آستر" : "رنگ رویه"} در این پروژه‌ها کار شده ولی مصرفی برایش ثبت نشده:{" "}
            {s[k].notRecorded.join("، ")}</div>
        ))}
        {data.unpriced > 0 && (
          <div>⚠ از {faDigits(data.materialCount)} کالای مصرف‌شده، {faDigits(data.unpriced)} کالا قیمت خرید ندارد؛
            تا قیمت‌ها وارد نشود هزینهٔ هر متر قابل‌اعتماد نیست.</div>
        )}
      </div>

      <button className="ghost" style={{ marginTop: 10 }} onClick={() => setDetail((v) => !v)}>
        {detail ? "بستن جزئیات کالاها" : `جزئیات ${faDigits(data.materials.length)} کالا`}
      </button>
      {detail && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="mini-table">
            <thead><tr><th>کالا</th><th>گروه</th><th>مصرف کل</th><th>پروژه</th><th>در هر متر چوب</th>
              {withCost && <th>هزینه در هر متر (ریال)</th>}</tr></thead>
            <tbody>
              {data.materials.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td><td className="muted">{m.groupLabel}</td>
                  <td>{faDigits(round2(m.qty))} {m.unit}</td><td>{faDigits(m.projects)}</td>
                  <td>{m.perWoodM2 == null ? "—" : `${faDigits(m.perWoodM2)} ${m.unit}`}</td>
                  {withCost && <td>{m.costPerWoodM2 == null ? <span className="muted">قیمت ندارد</span>
                    : faDigits(m.costPerWoodM2.toLocaleString("en-US"))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Gauge({ kind, row }) {
  const v = VERDICT[row.verdict];
  const actual = g(row.perCoatM2);
  const [lo, hi] = (row.standard || [0, 0]).map(g);
  const top = Math.max(actual || 0, hi) * 1.3 || 1;
  const pct = (x) => `${Math.min(x / top * 100, 100)}%`;
  return (
    <div className="mc-gauge">
      <div className="mc-g-head">
        <b>{row.label}</b>
        {v && <span className={`pill ${v.cls}`}>{v.label}</span>}
      </div>
      <div className="mc-g-num">
        {actual == null ? <span className="muted">دادهٔ کافی نیست</span>
          : <><b>{faDigits(actual)}</b> گرم <span className="muted">· استاندارد {faDigits(lo)}–{faDigits(hi)}</span></>}
      </div>
      <div className="mc-scale">
        <div className="band" style={{ insetInlineStart: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        {actual != null && <i className={v?.cls} style={{ insetInlineStart: pct(actual) }} />}
      </div>
      <p>{WHY[kind][row.verdict] || ""}</p>
      <div className="muted sm2">
        {faDigits(row.projects)} پروژه · {faDigits(round2(row.sampleM2))} م² دست · {row.source}
        {row.partial?.length > 0 && <> · بیرون از میانگین (ثبت ناقص): {row.partial.join("، ")}</>}
      </div>
    </div>
  );
}

function CheckCell({ c }) {
  const v = VERDICT[c.verdict];
  if (!c.coatM2) return <td className="muted">—</td>;
  return (
    <td>
      {c.perCoatM2 ? <b>{faDigits(g(c.perCoatM2))}</b> : null}
      {c.perCoatM2 ? <span className="muted sm2"> گ</span> : null}
      {v && <span className={`pill ${v.cls}`} style={{ marginInlineStart: 6 }}>{v.label}</span>}
      <div className="muted sm2">{faDigits(round2(c.kg))} کیلو / {faDigits(round2(c.coatM2))} م²</div>
    </td>
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
