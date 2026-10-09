import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { driverServicesApi } from "../api.js";
import { money, rial } from "../payroll.js";
import { DocLetterhead, Empty, J_MONTHS, JalaliPicker, PrintableDoc, STATUSES, WhyOff, download, faDigits, hasAccess, isoToJ, jShort, pad, todayIso, uid } from "../shared/core.jsx";

/* ============ گزارش رانندگان (داشبورد) ============ */
/** ساعت مقرر → ساعت رسیدن، به‌همراه نفرات؛ برای جدول خلاصه. */
function shuttleText(scheduled, arrival, passengers) {
  if (!scheduled && !arrival && !passengers) return "—";
  const times = arrival ? `${scheduled || "—"} → ${arrival}` : (scheduled || "—");
  return passengers ? `${times} (${passengers})` : times;
}
/** خلاصهٔ گزارش‌های راننده در یک بازهٔ تاریخ، با خروجی چاپی و اکسل. */
export function DriverReportExport({ drivers, driverReports }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [driver, setDriver] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fMonth, setFMonth] = useState("all");
  const [showDoc, setShowDoc] = useState(false);
  const monthsInData = useMemo(
    () => [...new Set(driverReports.map((r) => monthOfIso(r.date)))].sort().reverse(),
    [driverReports]);

  const swapped = from && to && from > to;
  const [lo, hi] = swapped ? [to, from] : [from, to];

  const rows = useMemo(() => driverReports
    .filter((r) => (!lo || r.date >= lo) && (!hi || r.date <= hi))
    .filter((r) => driver === "all" || r.driver === driver)
    .filter((r) => fStatus === "all" || r.status === fStatus)
    .filter((r) => fMonth === "all" || monthOfIso(r.date) === fMonth)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [driverReports, lo, hi, driver, fStatus, fMonth]);

  const totals = useMemo(() => {
    const perDriver = {};
    let km = 0, delays = 0, tasks = 0, collected = 0;
    rows.forEach((r) => {
      const d = r.distanceKm || 0;
      km += d;
      collected += (r.tasks || []).reduce((sum, t) => sum + (Number(t.collectedAmount) || 0), 0);
      delays += (r.delays || []).length;
      tasks += (r.tasks || []).length;
      const key = r.driverName || "—";
      if (!perDriver[key]) perDriver[key] = { km: 0, days: 0 };
      perDriver[key].km += d;
      perDriver[key].days += 1;
    });
    const perDriverList = Object.entries(perDriver).sort((a, b) => b[1].km - a[1].km);
    return {
      km, delays, tasks, collected, days: rows.length,
      perDriver: perDriverList,
      maxKm: Math.max(1, ...perDriverList.map(([, v]) => v.km)),
    };
  }, [rows]);

  const rangeLabel = lo && hi ? `از ${jShort(lo)} تا ${jShort(hi)}`
    : lo ? `از ${jShort(lo)} به بعد`
    : hi ? `تا ${jShort(hi)}`
    : "همهٔ تاریخ‌ها";

  const driverLabel = driver === "all" ? "همهٔ رانندگان"
    : (drivers.find((d) => d.id === driver)?.name || "—");

  return (
    <div className="card">
      <div className="board-h">گزارش رانندگان</div>

      <div className="range-row">
        <div className="range-fld">
          <span>از تاریخ</span>
          {from
            ? <button className="date-fil on" onClick={() => setFrom("")}>{jShort(from)} ✕</button>
            : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={setFrom} /></div>}
        </div>
        <div className="range-fld">
          <span>تا تاریخ</span>
          {to
            ? <button className="date-fil on" onClick={() => setTo("")}>{jShort(to)} ✕</button>
            : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={setTo} /></div>}
        </div>
      </div>

      <div className="range-row">
        <label className="fld sm"><span>راننده</span>
          <select value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="all">همهٔ رانندگان</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="fld sm"><span>وضعیت</span>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="all">همهٔ وضعیت‌ها</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="fld sm"><span>ماه</span>
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
            <option value="all">همهٔ ماه‌ها</option>
            {monthsInData.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {(from || to) && (
        <div className="range-note">
          بازهٔ گزارش: {rangeLabel}
          {swapped && " — تاریخ شروع بعد از پایان بود، جابه‌جا حساب شد."}
          <button className="link-btn" onClick={() => { setFrom(""); setTo(""); }}>پاک کردن بازه</button>
        </div>
      )}

      <div className="stats">
        <div className="stat"><b>{faDigits(totals.days)}</b><span>روز گزارش</span></div>
        <div className="stat"><b>{faDigits(totals.km)}</b><span>کیلومتر</span></div>
        <div className={totals.delays ? "stat warn" : "stat"}><b>{faDigits(totals.delays)}</b><span>تأخیر</span></div>
        <div className="stat"><b>{faDigits(totals.tasks)}</b><span>سرویس داخل روز</span></div>
        <div className="stat"><b>{faDigits(rial(totals.collected))}</b><span>دریافتی از مشتری (ریال)</span></div>
      </div>

      {rows.length === 0 ? (
        <Empty art="driver">در این بازه گزارشی نیست.</Empty>
      ) : (
        <>
          <div className="tbl-scroll tall">
            <table className="print-table">
              <thead>
                <tr>
                  <th>تاریخ</th><th>راننده</th><th>پیمایش (کیلومتر)</th>
                  <th>سرویس صبح</th><th>سرویس عصر</th><th>تأخیر</th><th>سرویس داخل روز</th>
                  <th>دریافتی از مشتری</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{jShort(r.date)}</td>
                    <td>{r.driverName || "—"}</td>
                    <td>{faDigits(r.distanceKm || 0)}</td>
                    <td>{shuttleText(r.morningScheduledTime, r.morningArrivalTime, r.morningPassengers)}</td>
                    <td>{shuttleText(r.eveningScheduledTime, r.eveningArrivalTime, r.eveningPassengers)}</td>
                    <td>{(r.delays || []).length
                      ? <span className="day-idle over">{faDigits(r.delays.length)} مورد</span> : "—"}</td>
                    <td>{(r.tasks || []).length ? faDigits(r.tasks.length) : "—"}</td>
                    <td>{(() => {
                      const got = (r.tasks || []).reduce((sum, t) => sum + (Number(t.collectedAmount) || 0), 0);
                      return got ? faDigits(rial(got)) : "—";
                    })()}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={2}>مجموع</td>
                  <td>{faDigits(totals.km)}</td>
                  <td colSpan={2}>—</td>
                  <td>{faDigits(totals.delays)} مورد</td>
                  <td>{faDigits(totals.tasks)}</td>
                  <td>{faDigits(rial(totals.collected))}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {totals.perDriver.length > 1 && (
            <>
              <div className="board-h" style={{ marginTop: 14 }}>پیمایش به تفکیک راننده</div>
              <div className="scroll-box">
                {totals.perDriver.map(([name, v]) => (
                  <div className="bar-row" key={name}>
                    <span className="bar-lbl">{name}</span>
                    <div className="bar emp"><div style={{ width: (v.km / totals.maxKm * 100) + "%" }} /></div>
                    <span className="bar-v">{faDigits(v.km)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => setShowDoc(true)}>🖨 چاپ / ذخیرهٔ PDF</button>
            <button className="submit" style={{ width: "auto", margin: 0 }}
              onClick={() => exportDriverExcel(rows, totals, rangeLabel, driverLabel)}>📊 خروجی اکسل</button>
          </div>
        </>
      )}

      {showDoc && (
        <DriverSheetDoc rows={rows} totals={totals} rangeLabel={rangeLabel}
          driverLabel={driverLabel} onClose={() => setShowDoc(false)} />
      )}
    </div>
  );
}
/** برگهٔ چاپی گزارش راننده. */
function DriverSheetDoc({ rows, totals, rangeLabel, driverLabel, onClose }) {
  const shuttle = (sch, arr) => (sch || arr) ? `${sch || "—"} → ${arr || "—"}` : "—";
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet wide">
        <DocLetterhead title="گزارش عملکرد راننده" subtitle={rangeLabel} />

        <div className="doc-info">
          <div><span>راننده</span><b>{driverLabel}</b></div>
          <div><span>تعداد روز</span><b>{faDigits(totals.days)} روز</b></div>
          <div><span>مجموع پیمایش</span><b>{faDigits(totals.km)} کیلومتر</b></div>
          <div><span>مجموع تأخیر</span><b>{faDigits(totals.delays)} مورد</b></div>
          <div><span>سرویس داخل روز</span><b>{faDigits(totals.tasks)} مورد</b></div>
          <div><span>میانگین روزانه</span><b>{faDigits(totals.days ? Math.round(totals.km / totals.days) : 0)} کیلومتر</b></div>
        </div>

        <table className="doc-table">
          <thead>
            <tr>
              <th>#</th><th>تاریخ</th><th>راننده</th>
              <th>کیلومتر شروع</th><th>کیلومتر پایان</th><th>پیمایش</th>
              <th>سرویس صبح</th><th>سرویس عصر</th><th>تأخیر</th><th>سرویس داخل روز</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{faDigits(i + 1)}</td>
                <td className="nm">{jShort(r.date)}</td>
                <td className="nm">{r.driverName || "—"}</td>
                <td>{faDigits(r.odometerStart || 0)}</td>
                <td>{faDigits(r.odometerEnd || 0)}</td>
                <td className="net">{faDigits(r.distanceKm || 0)}</td>
                <td className="nm">{shuttle(r.morningScheduledTime, r.morningArrivalTime)}</td>
                <td className="nm">{shuttle(r.eveningScheduledTime, r.eveningArrivalTime)}</td>
                <td>{(r.delays || []).length ? faDigits(r.delays.length) : "—"}</td>
                <td>{(r.tasks || []).length ? faDigits(r.tasks.length) : "—"}</td>
              </tr>
            ))}
            <tr className="tot">
              <td colSpan={5}>جمع کل — {faDigits(totals.days)} روز</td>
              <td className="net">{faDigits(totals.km)}</td>
              <td colSpan={2}>—</td>
              <td>{faDigits(totals.delays)}</td>
              <td>{faDigits(totals.tasks)}</td>
            </tr>
          </tbody>
        </table>

        {totals.perDriver.length > 1 && (
          <>
            <div className="board-h" style={{ marginTop: 16 }}>به تفکیک راننده</div>
            <table className="doc-table">
              <thead><tr><th>راننده</th><th>تعداد روز</th><th>پیمایش (کیلومتر)</th></tr></thead>
              <tbody>
                {totals.perDriver.map(([name, v]) => (
                  <tr key={name}>
                    <td className="nm">{name}</td><td>{faDigits(v.days)}</td><td className="net">{faDigits(v.km)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* علت تأخیرها روی برگه بیاید، چون همان چیزی است که معمولاً پیگیری می‌شود */}
        {rows.some((r) => (r.delays || []).length) && (
          <>
            <div className="board-h" style={{ marginTop: 16 }}>علت تأخیرها</div>
            <table className="doc-table">
              <thead><tr><th>تاریخ</th><th>نوبت</th><th>علت</th></tr></thead>
              <tbody>
                {rows.flatMap((r) => (r.delays || []).map((d) => (
                  <tr key={r.id + "-" + d.id}>
                    <td className="nm">{jShort(r.date)}</td>
                    <td className="nm">{d.period === "morning" ? "صبح" : "عصر"}</td>
                    <td className="nm">{d.reason}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </>
        )}

        <div className="doc-sign">
          <div>تهیه‌کننده: ......................................</div>
          <div>تأیید مدیر: ......................................</div>
          <div>تاریخ: ......................................</div>
        </div>
        <div className="doc-foot">Diwaj ERP (برنامه‌ریزی منابع سازمان) · تاریخ تهیه: {jShort(todayIso())}</div>
      </div>
    </PrintableDoc>
  );
}

function exportDriverExcel(rows, totals, rangeLabel, driverLabel) {
  const rtl = (ws) => { ws["!views"] = [{ RTL: true }]; return ws; };
  const header = ["#", "تاریخ", "راننده", "وضعیت", "کیلومتر شروع", "کیلومتر پایان", "پیمایش",
    "سرویس صبح مقرر", "سرویس صبح رسیدن", "نفرات صبح",
    "سرویس عصر مقرر", "سرویس عصر رسیدن", "نفرات عصر",
    "تعداد تأخیر", "سرویس داخل روز"];
  const out = [
    [`گزارش عملکرد راننده — دیواژ`],
    [`راننده: ${driverLabel}`],
    [`بازه: ${rangeLabel}`],
    [],
    header,
  ];
  rows.forEach((r, i) => out.push([
    i + 1, jShort(r.date), r.driverName || "", (STATUSES[r.status] || {}).label || "",
    r.odometerStart || 0, r.odometerEnd || 0, r.distanceKm || 0,
    r.morningScheduledTime || "", r.morningArrivalTime || "", r.morningPassengers || "",
    r.eveningScheduledTime || "", r.eveningArrivalTime || "", r.eveningPassengers || "",
    (r.delays || []).length, (r.tasks || []).length,
  ]));
  out.push(["جمع کل", "", "", "", "", "", totals.km, "", "", "", "", "", "", totals.delays, totals.tasks]);

  const wb = XLSX.utils.book_new();
  const ws = rtl(XLSX.utils.aoa_to_sheet(out));
  ws["!cols"] = header.map((h, i) => (i === 0 ? { wch: 5 } : i <= 3 ? { wch: 16 } : { wch: 13 }));
  XLSX.utils.book_append_sheet(wb, ws, "گزارش راننده");

  // برگهٔ دوم: علت تأخیرها و کارهای داخل روز، چون در جدول اصلی فقط شمارش آمده
  const detail = [["تاریخ", "راننده", "نوع", "نوبت/ساعت", "شرح"]];
  rows.forEach((r) => {
    (r.delays || []).forEach((d) => detail.push([jShort(r.date), r.driverName || "", "تأخیر",
      d.period === "morning" ? "صبح" : "عصر", d.reason || ""]));
    (r.tasks || []).forEach((t) => detail.push(t.customerService
      ? [jShort(r.date), r.driverName || "", "سرویس مشتری", "",
        [t.destination, t.customerName, t.collectedAmount ? `${rial(t.collectedAmount)} ریال` : ""].filter(Boolean).join(" — ")]
      : [jShort(r.date), r.driverName || "", "سرویس/کار", t.time || "", [t.destination, t.description].filter(Boolean).join(" — ")]));
  });
  const ws2 = rtl(XLSX.utils.aoa_to_sheet(detail.length > 1 ? detail : [["داده‌ای نیست"]]));
  ws2["!cols"] = [{ wch: 13 }, { wch: 16 }, { wch: 11 }, { wch: 12 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, ws2, "جزئیات");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`driver-report-${jShort(todayIso()).replace(/\//g, "-")}.xlsx`,
    new Blob([buf], { type: "application/octet-stream" }));
}
/* ============ راننده ============ */
export function DriverView({ session, loaded = true, drivers, driverReports, onCreateReport, onUpdateReport, onCreateDriver, onToggleDriver, onDeleteDriver }) {
  const canEntry = hasAccess(session, "driver.create");
  const isManager = hasAccess(session, "driver.manage");
  const activeDrivers = drivers.filter((d) => d.active !== false);

  const [date, setDate] = useState(todayIso());
  const [driver, setDriver] = useState(activeDrivers[0]?.id || "");
  const [morning, setMorning] = useState({ scheduled: "۸:۳۰", arrival: "", passengers: "" });
  const [evening, setEvening] = useState({ scheduled: "", arrival: "", passengers: "" });
  const [odoStart, setOdoStart] = useState("");
  const [odoEnd, setOdoEnd] = useState("");
  const [morningDelays, setMorningDelays] = useState([]);
  const [eveningDelays, setEveningDelays] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draftId, setDraftId] = useState(null);

  const [newDrvOpen, setNewDrvOpen] = useState(false);
  const [newDrvName, setNewDrvName] = useState("");
  async function confirmNewDriver() {
    const nm = newDrvName.trim(); if (!nm) return;
    try {
      const drv = await onCreateDriver({ name: nm, active: true });
      setDriver(drv.id);
      setNewDrvOpen(false);
    } catch (e) {
      alert(e.message);
    }
  }

  const addMorningDelay = () => setMorningDelays((p) => [...p, { id: uid(), reason: "" }]);
  const setMorningDelay = (id, v) => setMorningDelays((p) => p.map((d) => (d.id === id ? { ...d, reason: v } : d)));
  const delMorningDelay = (id) => setMorningDelays((p) => p.filter((d) => d.id !== id));

  const addEveningDelay = () => setEveningDelays((p) => [...p, { id: uid(), reason: "" }]);
  const setEveningDelay = (id, v) => setEveningDelays((p) => p.map((d) => (d.id === id ? { ...d, reason: v } : d)));
  const delEveningDelay = (id) => setEveningDelays((p) => p.filter((d) => d.id !== id));

  const addTask = () => setTasks((p) => [...p, { id: uid(), time: "", destination: "", description: "" }]);
  // سرویسِ مشتری: مسیری که رفته و مبلغی که از مشتری گرفته. این پول مالِ شرکت است و ماهانه جمع زده می‌شود.
  const [services, setServices] = useState([]);
  const addService = () => setServices((p) => [...p, { id: uid(), route: "", customerName: "", amount: "" }]);
  const setService = (id, k, v) => setServices((p) => p.map((s) => (s.id === id ? { ...s, [k]: v } : s)));
  const delService = (id) => setServices((p) => p.filter((s) => s.id !== id));
  const setTask = (id, k, v) => setTasks((p) => p.map((t) => (t.id === id ? { ...t, [k]: v } : t)));
  const delTask = (id) => setTasks((p) => p.filter((t) => t.id !== id));

  function resetForm() {
    setDriver(activeDrivers[0]?.id || "");
    setMorning({ scheduled: "۸:۳۰", arrival: "", passengers: "" });
    setEvening({ scheduled: "", arrival: "", passengers: "" });
    setOdoStart(""); setOdoEnd("");
    setMorningDelays([]); setEveningDelays([]); setTasks([]); setServices([]);
  }

  // گزارشِ تأییدنشدهٔ همین روز دوباره بارگذاری می‌شود تا گزارش تکراری ساخته نشود.
  const loadedKey = useRef(null);
  useEffect(() => {
    if (!loaded) return;                                 // تا گزارش‌ها از سرور نرسیده، گزارشِ همین روز پیدا نمی‌شود
    if (loadedKey.current === date) return;
    loadedKey.current = date;
    const existing = driverReports.find(
      (r) => r.date === date && r.recordedBy === session.username && r.status !== "approved"
    );
    if (existing) {
      setDraftId(existing.id);
      setDriver(existing.driver || "");
      setOdoStart(String(existing.odometerStart ?? ""));
      setOdoEnd(String(existing.odometerEnd ?? ""));
      setMorning({ scheduled: existing.morningScheduledTime || "", arrival: existing.morningArrivalTime || "", passengers: existing.morningPassengers || "" });
      setEvening({ scheduled: existing.eveningScheduledTime || "", arrival: existing.eveningArrivalTime || "", passengers: existing.eveningPassengers || "" });
      setMorningDelays((existing.delays || []).filter((d) => d.period === "morning").map((d) => ({ id: uid(), reason: d.reason })));
      setEveningDelays((existing.delays || []).filter((d) => d.period === "evening").map((d) => ({ id: uid(), reason: d.reason })));
      setTasks((existing.tasks || []).filter((t) => !t.customerService).map((t) => ({ id: uid(), time: t.time || "", destination: t.destination || "", description: t.description || "" })));
      setServices((existing.tasks || []).filter((t) => t.customerService).map((t) => ({ id: uid(), route: t.destination || "", customerName: t.customerName || "", amount: t.collectedAmount ? String(t.collectedAmount) : "" })));
    } else {
      setDraftId(null);
      resetForm();
    }
  }, [date, driverReports, session.username, loaded]);

  const currentDraft = driverReports.find((r) => r.id === draftId);

  const hasBothOdo = odoStart !== "" && odoEnd !== "";
  const dailyDistance = hasBothOdo ? Number(odoEnd) - Number(odoStart) : null;
  const odoInvalid = dailyDistance !== null && dailyDistance < 0;
  const valid = !!driver && !odoInvalid;

  /** ذخیره می‌کند و همان لحظه برای تأیید مدیر می‌فرستد. */
  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body = {
        driver,
        morningScheduledTime: morning.scheduled.trim(), morningArrivalTime: morning.arrival.trim(), morningPassengers: morning.passengers.trim(),
        eveningScheduledTime: evening.scheduled.trim(), eveningArrivalTime: evening.arrival.trim(), eveningPassengers: evening.passengers.trim(),
        odometerStart: Number(odoStart) || 0, odometerEnd: Number(odoEnd) || 0,
        delays: [
          ...morningDelays.filter((d) => d.reason.trim()).map((d) => ({ period: "morning", reason: d.reason.trim() })),
          ...eveningDelays.filter((d) => d.reason.trim()).map((d) => ({ period: "evening", reason: d.reason.trim() })),
        ],
        tasks: [
          ...tasks.filter((t) => t.destination.trim() || t.description.trim())
            .map((t) => ({ time: t.time.trim(), destination: t.destination.trim(), description: t.description.trim() })),
          ...services.filter((s) => s.route.trim() || s.customerName.trim() || money(s.amount))
            .map((s) => ({ customerService: true, destination: s.route.trim(), customerName: s.customerName.trim(), collectedAmount: money(s.amount) })),
        ],
      };
      let id = draftId;
      if (id) {
        await onUpdateReport(id, body);
      } else {
        const created = await onCreateReport({ date, status: "draft", ...body });
        id = created.id;
        setDraftId(id);
      }
      const status = driverReports.find((r) => r.id === id)?.status;
      if (!status || status === "draft" || status === "revision") {
        await onUpdateReport(id, { status: "waiting" });
      }
      setMsg("گزارش راننده ذخیره و برای تأیید ارسال شد ✓");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canEntry && (
        <div className="card form">
          <div className="row2">
            <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
            <label className="fld"><span>نام راننده</span>
              <select value={driver} onChange={(e) => {
                if (e.target.value === "__new") { setNewDrvOpen(true); setNewDrvName(""); }
                else setDriver(e.target.value);
              }}>
                <option value="">— انتخاب کنید —</option>
                {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                <option value="__new">+ راننده جدید…</option>
              </select>
            </label>
          </div>
          {newDrvOpen && (
            <div className="new-mat-box">
              <label className="fld sm"><span>نام راننده جدید</span><input value={newDrvName} onChange={(e) => setNewDrvName(e.target.value)} placeholder="نام و نام خانوادگی" onKeyDown={(e) => e.key === "Enter" && confirmNewDriver()} /></label>
              <div className="btn-row">
                <button className="ghost" onClick={() => setNewDrvOpen(false)}>انصراف</button>
                <button className="submit" disabled={!newDrvName.trim()} onClick={confirmNewDriver}>افزودن راننده</button>
              </div>
              <WhyOff reasons={[!newDrvName.trim() && "نام راننده نوشته نشده"]} />
            </div>
          )}

          <div className="items-hd">کیلومتر خودرو</div>
          <div className="row2">
            <label className="fld sm"><span>کیلومتر شروع کار (صبح)</span><input type="number" inputMode="decimal" value={odoStart} onChange={(e) => setOdoStart(e.target.value)} placeholder="۰" /></label>
            <label className="fld sm"><span>کیلومتر پایان کار</span><input type="number" inputMode="decimal" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} placeholder="۰" /></label>
          </div>
          {dailyDistance !== null && (
            <div className={odoInvalid ? "hint-remaining warn" : "hint-remaining"}>
              {odoInvalid
                ? "⚠ کیلومتر پایان نمی‌تواند از کیلومتر شروع کمتر باشد."
                : `پیمایش روزانه: ${faDigits(dailyDistance)} کیلومتر`}
            </div>
          )}

          <div className="items-hd">سرویس صبح (رساندن نفرات)</div>
          <div className="row3">
            <label className="fld sm"><span>ساعت مقرر</span><input value={morning.scheduled} onChange={(e) => setMorning((p) => ({ ...p, scheduled: e.target.value }))} placeholder="۸:۳۰" /></label>
            <label className="fld sm"><span>ساعت رسیدن</span><input value={morning.arrival} onChange={(e) => setMorning((p) => ({ ...p, arrival: e.target.value }))} placeholder="مثلاً ۸:۴۵" /></label>
            <label className="fld sm"><span>تعداد/نفرات</span><input value={morning.passengers} onChange={(e) => setMorning((p) => ({ ...p, passengers: e.target.value }))} placeholder="تعداد یا نام‌ها" /></label>
          </div>
          <div className="items-hd sub">تأخیرات و علت</div>
          {morningDelays.length === 0 && <div className="muted sm2">تأخیری ثبت نشده.</div>}
          {morningDelays.map((d) => (
            <div className="delay-row" key={d.id}>
              <input value={d.reason} onChange={(e) => setMorningDelay(d.id, e.target.value)} placeholder="علت تأخیر" />
              <button className="item-del" onClick={() => delMorningDelay(d.id)}>×</button>
            </div>
          ))}
          <button className="add-row" onClick={addMorningDelay}>+ افزودن تأخیر</button>

          <div className="items-hd">سرویس عصر (رساندن نفرات)</div>
          <div className="row3">
            <label className="fld sm"><span>ساعت مقرر</span><input value={evening.scheduled} onChange={(e) => setEvening((p) => ({ ...p, scheduled: e.target.value }))} placeholder="۱۶:۳۰" /></label>
            <label className="fld sm"><span>ساعت رسیدن</span><input value={evening.arrival} onChange={(e) => setEvening((p) => ({ ...p, arrival: e.target.value }))} placeholder="مثلاً ۱۶:۴۵" /></label>
            <label className="fld sm"><span>تعداد/نفرات</span><input value={evening.passengers} onChange={(e) => setEvening((p) => ({ ...p, passengers: e.target.value }))} placeholder="تعداد یا نام‌ها" /></label>
          </div>
          <div className="items-hd sub">تأخیرات و علت</div>
          {eveningDelays.length === 0 && <div className="muted sm2">تأخیری ثبت نشده.</div>}
          {eveningDelays.map((d) => (
            <div className="delay-row" key={d.id}>
              <input value={d.reason} onChange={(e) => setEveningDelay(d.id, e.target.value)} placeholder="علت تأخیر" />
              <button className="item-del" onClick={() => delEveningDelay(d.id)}>×</button>
            </div>
          ))}
          <button className="add-row" onClick={addEveningDelay}>+ افزودن تأخیر</button>

          <div className="items-hd">سرویس‌ها و کارهای داخل روز</div>
          {tasks.length === 0 && <div className="muted sm2">کاری ثبت نشده.</div>}
          {tasks.map((t, idx) => (
            <div className="item-row" key={t.id}>
              <div className="item-num">{faDigits(idx + 1)}</div>
              <div className="item-body">
                <div className="row2">
                  <label className="fld sm"><span>ساعت</span><input value={t.time} onChange={(e) => setTask(t.id, "time", e.target.value)} placeholder="مثلاً ۱۰:۳۰" /></label>
                  <label className="fld sm"><span>مقصد / موضوع</span><input value={t.destination} onChange={(e) => setTask(t.id, "destination", e.target.value)} placeholder="خرید مواد، بانک، تحویل بار…" /></label>
                </div>
                <label className="fld sm"><span>شرح کار</span><input value={t.description} onChange={(e) => setTask(t.id, "description", e.target.value)} placeholder="چه کاری انجام شد؟" /></label>
              </div>
              <button className="item-del" onClick={() => delTask(t.id)}>×</button>
            </div>
          ))}
          <button className="add-row" onClick={addTask}>+ افزودن سرویس/کار</button>

          <div className="items-hd">سرویس‌های مشتری</div>
          <div className="muted sm2" style={{ margin: "-4px 0 8px" }}>هر بار که برای مشتری سرویس رفتید: مسیری که رفتید و مبلغی که از مشتری گرفتید.</div>
          {services.length === 0 && <div className="muted sm2">سرویسِ مشتری ثبت نشده.</div>}
          {services.map((s, idx) => (
            <div className="item-row" key={s.id}>
              <div className="item-num">{faDigits(idx + 1)}</div>
              <div className="item-body">
                <label className="fld sm"><span>مسیرِ رفته‌شده</span><input value={s.route} onChange={(e) => setService(s.id, "route", e.target.value)} placeholder="مثلاً کارگاه تا سعادت‌آباد" /></label>
                <div className="row2">
                  <label className="fld sm"><span>مشتری</span><input value={s.customerName} onChange={(e) => setService(s.id, "customerName", e.target.value)} placeholder="نام مشتری" /></label>
                  <label className="fld sm"><span>مبلغ اخذشده از مشتری (ریال)</span>
                    <input inputMode="numeric" value={s.amount} onChange={(e) => setService(s.id, "amount", e.target.value)} placeholder="۰" />
                    {money(s.amount) >= 10 && <small className="pc-toman">= {faDigits(rial(money(s.amount) / 10))} تومان</small>}
                  </label>
                </div>
              </div>
              <button className="item-del" onClick={() => delService(s.id)}>×</button>
            </div>
          ))}
          <button className="add-row" onClick={addService}>+ افزودن سرویسِ مشتری</button>

          {draftId && (
            <div className="draft-note">
              {currentDraft?.status === "revision"
                ? "مدیر این گزارش را برای اصلاح برگردانده است؛ پس از ویرایش، با ذخیره دوباره برای تأیید ارسال می‌شود."
                : "این گزارش برای تأیید مدیر ارسال شده و تا پیش از تأیید قابل ویرایش است."}
            </div>
          )}
          <button className="submit" disabled={!valid || busy} onClick={save}>ذخیرهٔ گزارش راننده</button>
          <WhyOff busy={busy} reasons={[!driver && "راننده انتخاب نشده", odoInvalid && "کیلومتر پایان از کیلومتر شروع کمتر است"]} />
          {msg && <div className="ok-msg">{msg}</div>}
        </div>
      )}

      {isManager && <CustomerServicesPanel refresh={driverReports} />}

      {isManager && drivers.length > 0 && (
        <div className="card">
          <div className="board-h">مدیریت رانندگان</div>
          <div className="muted sm2">راننده جدید رو از طریق گزینهٔ «+ راننده جدید» توی فرم بالا اضافه کنید.</div>
          <div className="scroll-box">
            {drivers.map((d) => (
              <div className="mini-row" key={d.id}>
                <b>{d.name}</b>
                <div className="proj-actions">
                  <button className={d.active !== false ? "toggle on" : "toggle"} onClick={() => onToggleDriver(d).catch((e) => alert(e.message))}>
                    {d.active !== false ? "فعال" : "غیرفعال"}
                  </button>
                  <button className="del" onClick={() => onDeleteDriver(d.id).catch((e) => alert(e.message))}>حذف</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const monthLabel = (m) => {
  const [y, mo] = (m || "").split("-").map(Number);
  return y ? `${J_MONTHS[mo - 1]} ${faDigits(y)}` : "";
};

const monthOfIso = (iso) => { const j = isoToJ(iso); return `${j.jy}-${pad(j.jm)}`; };
/** سرویس‌های مشتریِ یک ماه: مسیرِ رفته‌شده، مشتری و مبلغِ اخذشده — تا تحویلِ پول پیگیری شود. */
function CustomerServicesPanel({ refresh }) {
  const [month, setMonth] = useState(() => monthOfIso(todayIso()));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async (m) => {
    try { setData(await driverServicesApi.month(m)); setErr(""); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(month); }, [month, load, refresh]);

  const months = data?.months || [month];
  const t = data?.totals;
  return (
    <div className="card">
      <div className="board-h">سرویس‌های مشتری</div>
      <div className="range-row">
        <label className="fld sm"><span>ماه</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>
      {err && <div className="err">{err}</div>}
      {t && (
        <div className="stats">
          <div className="stat"><b>{faDigits(t.count)}</b><span>سرویسِ مشتری</span></div>
          <div className="stat"><b>{faDigits(rial(t.amount))}</b><span>مبلغِ اخذشده از مشتری (ریال)</span></div>
          <div className={t.pending ? "stat warn" : "stat"}><b>{faDigits(rial(t.pending))}</b><span>در گزارش‌های تأییدنشده</span></div>
          <div className="stat"><b>{faDigits(data.drivers.length)}</b><span>راننده</span></div>
        </div>
      )}
      {data && (data.rows.length === 0 ? <Empty art="driver">در این ماه سرویسِ مشتری ثبت نشده.</Empty> : (
        <div className="tbl-scroll tall">
          <table className="print-table">
            <thead><tr><th>تاریخ</th><th>راننده</th><th>مسیرِ رفته‌شده</th><th>مشتری</th><th>مبلغِ اخذشده (ریال)</th><th>وضعیتِ گزارش</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{jShort(r.date)}</td><td>{r.driverName}</td><td className="nm">{r.route || "—"}</td><td>{r.customer || "—"}</td>
                  <td><b>{r.amount ? faDigits(rial(r.amount)) : "—"}</b></td>
                  <td><span className={r.status === "approved" ? "pill ok" : "pill run"}>{(STATUSES[r.status] || {}).label || r.status}</span></td>
                </tr>
              ))}
              <tr className="total-row"><td>جمع</td><td>—</td><td>{faDigits(t.count)} سرویس</td><td>—</td><td>{faDigits(rial(t.amount))}</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
      ))}
      {data && data.drivers.length > 1 && (
        <div className="muted sm2" style={{ marginTop: 8 }}>
          به تفکیکِ راننده: {data.drivers.map((d) => `${d.driverName} ${faDigits(rial(d.amount))} ریال (${faDigits(d.count)} سرویس)`).join(" · ")}
        </div>
      )}
      <div className="muted sm2" style={{ marginTop: 6 }}>پولی که راننده از مشتری می‌گیرد مالِ شرکت است؛ این جدول برای پیگیریِ تحویلِ آن است.</div>
    </div>
  );
}
