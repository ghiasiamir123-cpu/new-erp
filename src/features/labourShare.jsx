import { useState, useEffect, useCallback } from "react";
import { financeReportsApi } from "../api.js";
import { DocLetterhead, Empty, JalaliPicker, J_MONTHS, PrintableDoc, faDigits, faRial, isoToJ, jLong, jShort, saveSheet, todayIso, useCan } from "../shared/core.jsx";

/* ============ تسهیم حقوق به پروژه‌ها (برای سند حقوق و دستمزد) ============
   اپراتور حقوق ماهانهٔ هر نیرو را وارد می‌کند و بازهٔ تاریخ می‌دهد؛ حقوقِ هر نفر به نسبتِ ساعت‌هایی که در همان
   بازه روی هر پروژه کار کرده پخش می‌شود. محاسبه در backend/core/labour_share.py. */

const shift = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
/** اول و آخرِ ماهِ شمسی‌ای که این روز در آن است. */
function monthOf(iso) {
  const j = isoToJ(iso);
  const first = shift(iso, 1 - j.jd);
  let last = first;
  for (let i = 0; i < 31 && isoToJ(shift(last, 1)).jm === j.jm; i += 1) last = shift(last, 1);
  return { from: first, to: last, label: `${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}` };
}
const KIND = { project: "پروژه", general: "کار عمومی", loose: "بی‌پروژه" };
const rial = (n) => (n ? faRial(n) : "—");

export function LabourShareReport() {
  const thisMonth = monthOf(todayIso());
  const lastMonth = monthOf(shift(thisMonth.from, -1));
  const [range, setRange] = useState({ from: lastMonth.from, to: lastMonth.to });
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [one, setOne] = useState("");            // کلیدِ نیرویی که برگهٔ جداگانه‌اش باز است
  const canEdit = useCan()("financereports.costs");

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setBusy(true);
    try { setD(await financeReportsApi.labourShare(range.from, range.to)); setErr(""); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const isMonth = (m) => range.from === m.from && range.to === m.to;
  const days = d ? Math.round((new Date(d.to) - new Date(d.from)) / 864e5) + 1 : 0;

  function exportSheet() {
    const cols = d.columns;
    saveSheet("تسهیم-حقوق-به-پروژه‌ها", "تسهیم حقوق", [
      [`تسهیم حقوق به پروژه‌ها — ${jShort(d.from)} تا ${jShort(d.to)}`],
      [],
      ["پروژه", "نوع", "نفر", "ساعت", "سهم از حقوق (ریال)", "درصد"],
      ...cols.map((c) => [c.label, KIND[c.kind], c.people, c.hours, c.amount, c.percent]),
      ["جمع تسهیم‌شده", "", "", d.totals.hours, d.totals.allocated, ""],
      ["تسهیم‌نشده (حقوقِ بدون کارکرد در بازه)", "", "", "", d.totals.unallocated, ""],
      [],
      ["نیرو", "حقوق ماهانه", "ساعت در بازه", ...cols.map((c) => c.label), "تسهیم‌نشده"],
      ...d.workers.map((w) => [w.name, w.salary || "", w.hours, ...cols.map((c) => w.cells[c.key]?.amount || ""), w.unallocated || ""]),
      ["جمع", d.totals.salary, d.totals.hours, ...cols.map((c) => c.amount), d.totals.unallocated],
    ]);
  }

  return (
    <>
      <div className="card">
        <div className="items-hd">تسهیم حقوق به پروژه‌ها — برای سند حقوق و دستمزد</div>
        <div className="muted sm2" style={{ lineHeight: 2 }}>
          حقوق ماهانهٔ هر نیرو را وارد کنید و بازهٔ تاریخ را انتخاب کنید. حقوقِ هر نفر <b>به نسبتِ ساعت‌هایی که در همین بازه روی هر پروژه کار کرده</b> میان
          پروژه‌ها پخش می‌شود (از گزارش‌های کارِ تأییدشده). مبلغی که وارد می‌کنید کامل پخش می‌شود؛ برای سندِ یک ماه، بازه را همان ماه بگذارید.
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", alignItems: "end", gap: 10, marginTop: 8 }}>
          <div className="fld sm" style={{ margin: 0, minWidth: 170 }}><span>از تاریخ</span>
            <JalaliPicker value={range.from} onChange={(v) => v && setRange((r) => ({ from: v, to: r.to < v ? v : r.to }))} /></div>
          <div className="fld sm" style={{ margin: 0, minWidth: 170 }}><span>تا تاریخ</span>
            <JalaliPicker value={range.to} onChange={(v) => v && setRange((r) => ({ from: r.from > v ? v : r.from, to: v }))} /></div>
          <div className="seg-row" style={{ margin: 0 }}>
            <button className={isMonth(lastMonth) ? "seg on" : "seg"} onClick={() => setRange({ from: lastMonth.from, to: lastMonth.to })}>{lastMonth.label}</button>
            <button className={isMonth(thisMonth) ? "seg on" : "seg"} onClick={() => setRange({ from: thisMonth.from, to: thisMonth.to })}>{thisMonth.label}</button>
          </div>
          <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 14px" }} disabled={!d || !d.workers.length} onClick={exportSheet}>خروجی اکسل</button>
          <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 14px" }} disabled={!d || !d.totals.allocated} onClick={() => setPrinting(true)}>چاپ / PDF</button>
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {!d ? (!err && <div className="empty">در حال محاسبه…</div>) : (
        <>
          <div className="stats">
            <div className="stat"><b>{faRial(d.totals.salary)}</b><span>جمع حقوقِ واردشده (ریال)<br />{faDigits(d.workers.filter((w) => w.salary).length)} نفر</span></div>
            <div className="stat"><b>{faRial(d.totals.projects)}</b><span>سهم پروژه‌ها<br />کارهای عمومی و بی‌پروژه: {faRial(d.totals.general)}</span></div>
            <div className={d.totals.unallocated ? "stat warn" : "stat"}><b>{faRial(d.totals.unallocated)}</b><span>تسهیم‌نشده<br />حقوقِ کسانی که در بازه ساعتی ندارند</span></div>
            <div className="stat"><b>{faDigits(d.totals.hours)}</b><span>ساعت کارِ تأییدشده<br />{faDigits(d.reportDays)} روزِ گزارش در {faDigits(days)} روز</span></div>
          </div>

          {d.pendingReports > 0 && (
            <div className="notice warn">{faDigits(d.pendingReports)} گزارش کار در این بازه هنوز تأیید نشده و ساعتش در تسهیم نیامده است. اول آن‌ها را تأیید کنید تا سهم‌ها کامل باشد.</div>
          )}
          {d.issues.noSalary.length > 0 && (
            <div className="notice warn">این نیروها در بازه ساعت کار دارند ولی حقوقشان وارد نشده و سهمی پخش نشده است: {d.issues.noSalary.join("، ")}</div>
          )}
          {d.issues.noHours.length > 0 && (
            <div className="notice warn">این نیروها حقوق دارند ولی در این بازه هیچ ساعتِ تأییدشده‌ای ندارند؛ حقوقشان «تسهیم‌نشده» مانده است: {d.issues.noHours.join("، ")}</div>
          )}

          <div className="card">
            <div className="items-hd">سهم هر پروژه — {jShort(d.from)} تا {jShort(d.to)}</div>
            {d.columns.length === 0 ? <Empty art="finance">در این بازه ساعت کارِ تأییدشده‌ای نیست.</Empty> : (
              <div className="tbl-scroll">
                <table className="print-table">
                  <thead><tr><th>پروژه</th><th>نفر</th><th>ساعت</th><th>سهم از حقوق (ریال)</th><th>درصد</th></tr></thead>
                  <tbody>
                    {d.columns.map((c) => (
                      <tr key={c.key}>
                        <td className="nm">{c.label}{c.kind !== "project" && <span className="pill run" style={{ marginInlineStart: 6 }}>{KIND[c.kind]}</span>}</td>
                        <td>{faDigits(c.people)}</td><td>{faDigits(c.hours)}</td>
                        <td><b>{rial(c.amount)}</b></td>
                        <td>{c.percent != null && c.amount ? `${faDigits(c.percent)}٪` : "—"}</td>
                      </tr>
                    ))}
                    <tr><td className="nm"><b>جمع تسهیم‌شده</b></td><td /><td><b>{faDigits(d.totals.hours)}</b></td><td><b>{faRial(d.totals.allocated)}</b></td><td /></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="items-hd">حقوق ماهانهٔ نیروها</div>
            <div className="muted sm2" style={{ margin: "-2px 0 8px" }}>
              {canEdit ? "عدد را بنویسید و Enter بزنید یا به خانهٔ دیگر بروید؛ همان لحظه ذخیره و سهم‌ها از نو حساب می‌شود. عدد برای دفعهٔ بعد می‌ماند."
                : "برای وارد کردن حقوق، دسترسی «سود مرکز پوشش: اصلاح نرخ و قیمت» لازم است."}
            </div>
            {d.workers.length === 0 ? <Empty art="finance">نیرویی با ساعت کار یا حقوق در این بازه نیست.</Empty> : (
              <div className="tbl-scroll">
                <table className="print-table">
                  <thead><tr><th>نیرو</th><th>حقوق ماهانه (ریال)</th><th>ساعت در بازه</th><th>تسهیم‌شده</th><th>تسهیم‌نشده</th><th>هر ساعت</th><th /></tr></thead>
                  <tbody>
                    {d.workers.map((w) => (
                      <tr key={w.key}>
                        <td className="nm">{w.name}</td>
                        <td>{canEdit ? <SalaryCell w={w} disabled={busy} onSaved={load} /> : rial(w.salary)}</td>
                        <td>{w.hours ? faDigits(w.hours) : <span className="pill bad">بدون ساعت</span>}</td>
                        <td>{rial(w.allocated)}</td>
                        <td>{w.unallocated ? <b style={{ color: "#B02A2A" }}>{faRial(w.unallocated)}</b> : "—"}</td>
                        <td className="muted">{w.salary && w.hours ? faRial(w.salary / w.hours) : "—"}</td>
                        <td><button className="ghost" style={{ padding: "4px 10px" }} disabled={!w.hours} title="گزارش جداگانهٔ همین نیرو، برای دیدن و چاپ"
                          onClick={() => setOne(w.key)}>گزارش این نیرو</button></td>
                      </tr>
                    ))}
                    <tr><td className="nm"><b>جمع</b></td><td><b>{faRial(d.totals.salary)}</b></td><td><b>{faDigits(d.totals.hours)}</b></td>
                      <td><b>{faRial(d.totals.allocated)}</b></td><td><b>{rial(d.totals.unallocated)}</b></td><td /><td /></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {d.columns.length > 0 && (
            <div className="card">
              <div className="items-hd" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span>ریزِ سهم هر نیرو در هر پروژه</span>
                <button className="ghost" style={{ padding: "4px 12px", width: "auto" }} onClick={() => setMatrix(!matrix)}>{matrix ? "بستن" : "نمایش"}</button>
              </div>
              {matrix && <Matrix d={d} />}
            </div>
          )}
        </>
      )}
      {printing && d && <LabourShareDoc d={d} onClose={() => setPrinting(false)} />}
      {one && d && d.workers.some((w) => w.key === one) && <WorkerShareDoc d={d} w={d.workers.find((x) => x.key === one)} onClose={() => setOne("")} />}
    </>
  );
}

/** فقط رقم: رقم فارسی و عربی هم پذیرفته می‌شود و جداکنندهٔ هزارگان و هر چیزِ دیگر کنار می‌رود. */
const digits = (text) => String(text).replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/\D/g, "").replace(/^0+(?=\d)/, "");

function SalaryCell({ w, disabled, onSaved }) {
  const shown = w.salary ? String(w.salary) : "";
  const [v, setV] = useState(shown);
  const [err, setErr] = useState("");
  useEffect(() => { setV(shown); }, [shown]);
  // خانهٔ متنی است، نه عددی: خانهٔ عددی با یک ویرگول یا رقم فارسی «خالی» گزارش می‌شد و حقوق بی‌صدا پاک می‌شد.
  const save = async () => {
    if (v === shown) return;
    try { setErr(""); await financeReportsApi.labourSalary({ employee: w.employeeId, name: w.name, salary: v }); await onSaved(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <>
      <input className="wh-cell wide" style={{ width: 160, direction: "ltr", textAlign: "center" }} type="text" inputMode="numeric" placeholder="ریال" disabled={disabled}
        value={v ? Number(v).toLocaleString("en-US") : ""} maxLength={18}
        onChange={(e) => setV(digits(e.target.value))} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      {err && <div className="err">{err}</div>}
    </>
  );
}

function Matrix({ d, doc }) {
  return (
    <div className={doc ? "" : "tbl-scroll"}>
      <table className={doc ? "doc-table ls-matrix" : "print-table"}>
        <thead><tr><th>نیرو</th><th>حقوق</th>{d.columns.map((c) => <th key={c.key}>{c.label}</th>)}<th>تسهیم‌نشده</th></tr></thead>
        <tbody>
          {d.workers.filter((w) => w.salary || w.hours).map((w) => (
            <tr key={w.key}>
              <td className="nm">{w.name}</td><td>{rial(w.salary)}</td>
              {d.columns.map((c) => {
                const x = w.cells[c.key];
                return <td key={c.key} title={x ? `${faDigits(x.hours)} ساعت` : ""}>{x ? (x.amount ? faRial(x.amount) : `${faDigits(x.hours)} س`) : ""}</td>;
              })}
              <td>{w.unallocated ? faRial(w.unallocated) : ""}</td>
            </tr>
          ))}
          <tr className="tot"><td className="nm"><b>جمع</b></td><td><b>{faRial(d.totals.salary)}</b></td>
            {d.columns.map((c) => <td key={c.key}><b>{rial(c.amount)}</b></td>)}<td><b>{rial(d.totals.unallocated)}</b></td></tr>
        </tbody>
      </table>
      {!doc && <div className="muted sm2" style={{ marginTop: 6 }}>خانه‌ای که به‌جای مبلغ «س» دارد یعنی ساعت کار هست ولی حقوقِ آن نیرو وارد نشده است.</div>}
    </div>
  );
}

/** گزارشِ یک نیرو: حقوقش در این بازه روی کدام پروژه‌ها و هر کدام چقدر نشسته است. */
function WorkerShareDoc({ d, w, onClose }) {
  useEffect(() => {
    const was = document.title;
    document.title = `تسهیم-حقوق-${w.name.replace(/\s+/g, "-")}-${jShort(d.from).replace(/\//g, "-")}-تا-${jShort(d.to).replace(/\//g, "-")}`;
    return () => { document.title = was; };
  }, [d.from, d.to, w.name]);
  const rows = d.columns.filter((c) => w.cells[c.key]).map((c) => ({ ...c, ...w.cells[c.key] })).sort((a, b) => b.hours - a.hours);
  return (
    <PrintableDoc onClose={onClose}>
      <style>{"@media print{@page{size:A4 portrait;margin:12mm}}"}</style>
      <div className="doc-sheet cp-sheet">
        <DocLetterhead title="سهم پروژه‌ها از حقوق یک نیرو" subtitle={`${jLong(d.from)} تا ${jLong(d.to)}`} />
        <div className="doc-info">
          <div><span>نیرو</span><b>{w.name}</b></div>
          <div><span>حقوق ماهانه</span><b>{w.salary ? `${faRial(w.salary)} ریال` : "وارد نشده"}</b></div>
          <div><span>ساعت کار تأییدشده</span><b>{faDigits(w.hours)} ساعت</b></div>
          <div><span>روزهای کار</span><b>{faDigits(w.days)} روز</b></div>
          <div><span>تعداد پروژه</span><b>{faDigits(rows.filter((r) => r.kind === "project").length)}</b></div>
          <div><span>هزینهٔ هر ساعت</span><b>{w.salary && w.hours ? `${faRial(w.salary / w.hours)} ریال` : "—"}</b></div>
        </div>
        {!w.salary && <div className="doc-amend">حقوق این نیرو وارد نشده است؛ ساعت‌ها و درصدِ وقت دیده می‌شود ولی مبلغی پخش نشده.</div>}
        {d.pendingReports > 0 && <div className="doc-amend">{faDigits(d.pendingReports)} گزارش کار در این بازه تأیید نشده و در این برگه نیامده است.</div>}
        <table className="doc-table">
          <thead><tr><th>#</th><th>پروژه</th><th>نوع</th><th>ساعت</th><th>درصد از وقت</th><th>سهم از حقوق (ریال)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}><td>{faDigits(i + 1)}</td><td className="nm">{r.label}</td><td className="nm">{KIND[r.kind]}</td><td>{faDigits(r.hours)}</td>
                <td>{faDigits(Math.round(r.hours / w.hours * 1000) / 10)}٪</td><td className="net">{rial(r.amount)}</td></tr>
            ))}
            <tr className="tot"><td className="nm" colSpan={3}>جمع</td><td>{faDigits(w.hours)}</td><td>{faDigits(100)}٪</td><td className="net">{rial(w.allocated)}</td></tr>
          </tbody>
        </table>
        <div className="doc-sign">
          <div>تهیه‌کننده: ......................................</div>
          <div>مدیر مالی: ......................................</div>
          <div>مدیریت: ......................................</div>
        </div>
        <div className="doc-foot">
          تولیدشده در Diwaj ERP در {jShort(todayIso())} · ارقام به ریال · سهم هر پروژه = حقوق × ساعتِ این نیرو روی آن پروژه ÷ کلِ ساعتِ او در بازه · فقط گزارش‌های کارِ تأییدشده
        </div>
      </div>
    </PrintableDoc>
  );
}

/** برگهٔ چاپی برای پیوستِ سند حقوق: سهم هر پروژه و ریزِ هر نیرو. */
function LabourShareDoc({ d, onClose }) {
  useEffect(() => {
    const was = document.title;
    document.title = `تسهیم-حقوق-به-پروژه‌ها-${jShort(d.from).replace(/\//g, "-")}-تا-${jShort(d.to).replace(/\//g, "-")}`;
    return () => { document.title = was; };
  }, [d.from, d.to]);
  return (
    <PrintableDoc onClose={onClose}>
      <style>{"@media print{@page{size:A4 landscape;margin:10mm}}"}</style>
      <div className="doc-sheet wide cp-sheet">
        <DocLetterhead title="تسهیم حقوق و دستمزد به پروژه‌ها" subtitle={`${jLong(d.from)} تا ${jLong(d.to)}`} />
        <div className="doc-info cp-four">
          <div><span>جمع حقوق</span><b>{faRial(d.totals.salary)}</b></div>
          <div><span>تسهیم‌شده</span><b>{faRial(d.totals.allocated)}</b></div>
          <div><span>سهم پروژه‌ها</span><b>{faRial(d.totals.projects)}</b></div>
          <div><span>کار عمومی و بی‌پروژه</span><b>{faRial(d.totals.general)}</b></div>
          <div><span>تسهیم‌نشده</span><b className={d.totals.unallocated ? "cp-neg" : ""}>{faRial(d.totals.unallocated)}</b></div>
          <div><span>ساعت کار تأییدشده</span><b>{faDigits(d.totals.hours)}</b></div>
          <div><span>نیروهای دارای حقوق</span><b>{faDigits(d.workers.filter((w) => w.salary).length)} نفر</b></div>
          <div><span>تاریخ تهیه</span><b>{jShort(todayIso())}</b></div>
        </div>
        {(d.pendingReports > 0 || d.issues.noSalary.length > 0 || d.issues.noHours.length > 0) && (
          <div className="doc-amend">
            {d.pendingReports > 0 && <div>{faDigits(d.pendingReports)} گزارش کار در این بازه تأیید نشده و در تسهیم نیامده است.</div>}
            {d.issues.noSalary.length > 0 && <div>ساعت دارند ولی حقوقشان وارد نشده: {d.issues.noSalary.join("، ")}</div>}
            {d.issues.noHours.length > 0 && <div>حقوق دارند ولی در بازه ساعتی ندارند (تسهیم‌نشده): {d.issues.noHours.join("، ")}</div>}
          </div>
        )}

        <div className="doc-sec">سهم هر پروژه</div>
        <table className="doc-table">
          <thead><tr><th>#</th><th>پروژه</th><th>نوع</th><th>نفر</th><th>ساعت</th><th>سهم از حقوق (ریال)</th><th>درصد</th></tr></thead>
          <tbody>
            {d.columns.map((c, i) => (
              <tr key={c.key}><td>{faDigits(i + 1)}</td><td className="nm">{c.label}</td><td className="nm">{KIND[c.kind]}</td><td>{faDigits(c.people)}</td>
                <td>{faDigits(c.hours)}</td><td className="net">{rial(c.amount)}</td><td>{c.percent != null && c.amount ? `${faDigits(c.percent)}٪` : "—"}</td></tr>
            ))}
            <tr className="tot"><td className="nm" colSpan={4}>جمع تسهیم‌شده</td><td>{faDigits(d.totals.hours)}</td><td className="net">{faRial(d.totals.allocated)}</td><td /></tr>
          </tbody>
        </table>

        <div className="doc-sec">ریزِ سهم هر نیرو</div>
        <Matrix d={d} doc />

        <div className="doc-sign">
          <div>تهیه‌کننده: ......................................</div>
          <div>مدیر مالی: ......................................</div>
          <div>مدیریت: ......................................</div>
        </div>
        <div className="doc-foot">
          تولیدشده در Diwaj ERP · ارقام به ریال · سهم هر پروژه از حقوقِ یک نفر = حقوق × ساعتِ او روی آن پروژه ÷ کلِ ساعتِ او در بازه · فقط گزارش‌های کارِ تأییدشده
        </div>
      </div>
    </PrintableDoc>
  );
}
