import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { payrollApi } from "../api.js";
import { MONTH_REF, calcPayroll, hourRateOf, money, rial } from "../payroll.js";
import { DocLetterhead, Empty, PrintableDoc, WhyOff, download, faDigits, uid } from "../shared/core.jsx";

/** فیش حقوقی چاپی یک نفر. */
function PayslipDoc({ row, c, monthLabel, onClose }) {
  // هر سطر گرد می‌شود و جمع‌ها از همان سطرهای گردشده به‌دست می‌آید، وگرنه جمعِ
  // روی کاغذ با عددِ خالص یک ریال اختلاف پیدا می‌کرد و شبیه اشتباه به نظر می‌رسید.
  const R = Math.round;
  const rows = (list) => list.map(([n, v]) => [n, R(v)]).filter(([, v]) => v > 0);
  const total = (list) => list.reduce((a, [, v]) => a + v, 0);

  const earnRasmi = c.lines.map((l) => [l.name, R(l.v)]);
  const rasmiTotal = total(earnRasmi);
  const earnGheyr = rows([
    ["پرداخت بر اساس KPI", row.kpi],
    ["پایهٔ سنوات", c.senyE],
    ["ایاب و ذهاب", c.transE],
    [`اضافه‌کاری (${faDigits(row.otHours)} ساعت)`, c.otPay],
    ["مسئولیت / پاداش / مأموریت", row.responsibility],
  ]);
  const gheyrTotal = total(earnGheyr);
  const deductions = rows([
    ["بیمهٔ سهم کارگر", c.insurance],
    ["مالیات حقوق", c.tax],
    [`کسرکار (${faDigits(row.shortHours)} ساعت)`, c.shortPay],
    ["مساعده", row.advance],
    ["ذخیره", row.reserve],
    ["وام", row.loan],
  ]);

  const grossAll = rasmiTotal + gheyrTotal;
  const deductAll = total(deductions);
  const netPay = grossAll - deductAll;

  return (
    <PrintableDoc onClose={onClose}>
        <div className="doc-sheet">
          <DocLetterhead title="فیش حقوقی" subtitle={monthLabel} />

          <div className="doc-info">
            <div><span>نام و نام خانوادگی</span><b>{row.staffName}</b></div>
            <div><span>بخش</span><b>{row.dept || "—"}</b></div>
            <div><span>سمت</span><b>{row.position || "—"}</b></div>
            <div><span>روز کارکرد</span><b>{faDigits(row.workedDays)} روز</b></div>
            <div><span>غیبت</span><b>{faDigits(row.absentDays)} روز</b></div>
            <div><span>وضعیت تأهل</span><b>{row.married ? "متأهل" : "مجرد"}</b></div>
            <div><span>تعداد فرزند</span><b>{faDigits(row.children)}</b></div>
          </div>

          <div className="doc-cols">
            <section className="doc-col earn">
              <h3>دریافتی‌ها</h3>
              <div className="doc-group">حقوق و مزایای رسمی</div>
              {earnRasmi.map(([n, v]) => (
                <div className="doc-line" key={n}><span>{n}</span><b>{rial(v)}</b></div>
              ))}
              <div className="doc-line sub"><span>جمع رسمی</span><b>{rial(rasmiTotal)}</b></div>

              {earnGheyr.length > 0 && (
                <>
                  <div className="doc-group">سایر پرداخت‌ها</div>
                  {earnGheyr.map(([n, v]) => (
                    <div className="doc-line" key={n}><span>{n}</span><b>{rial(v)}</b></div>
                  ))}
                  <div className="doc-line sub"><span>جمع سایر</span><b>{rial(gheyrTotal)}</b></div>
                </>
              )}
              <div className="doc-line total"><span>جمع کل دریافتی</span><b>{rial(grossAll)}</b></div>
            </section>

            <section className="doc-col deduct">
              <h3>کسورات</h3>
              {deductions.length === 0
                ? <div className="doc-line"><span>کسوراتی ثبت نشده</span><b>۰</b></div>
                : deductions.map(([n, v]) => (
                  <div className="doc-line" key={n}><span>{n}</span><b>{rial(v)}</b></div>
                ))}
              <div className="doc-line total"><span>جمع کل کسورات</span><b>{rial(deductAll)}</b></div>
            </section>
          </div>

          <div className="doc-net">
            <span>خالص پرداختی</span>
            <b>{rial(netPay)} <small>ریال</small></b>
          </div>

          <div className="doc-sign">
            <div>تهیه‌کننده: ......................................</div>
            <div>تأیید مدیر: ......................................</div>
            <div>دریافت‌کننده: ......................................</div>
          </div>
          <div className="doc-foot">
            این فیش توسط Diwaj ERP (برنامه‌ریزی منابع سازمان) تولید شده است · ارقام به ریال · مبنای محاسبه: قانون کار
          </div>
        </div>
    </PrintableDoc>
  );
}
/** لیست حقوق ماهانه — نسخهٔ چاپی برای تأیید مدیر. */
function PayrollSheetDoc({ rows, calc, monthLabel, onClose }) {
  const sum = (f) => calc.reduce((a, c) => a + c[f], 0);
  return (
    <PrintableDoc onClose={onClose}>
        <div className="doc-sheet wide">
          <DocLetterhead title="لیست حقوق و دستمزد" subtitle={monthLabel} />
          <table className="doc-table">
            <thead>
              <tr>
                <th>#</th><th>نام و نام خانوادگی</th><th>بخش</th><th>سمت</th><th>روز کارکرد</th>
                <th>ناخالص رسمی</th><th>بیمه</th><th>مالیات</th>
                <th>سایر پرداخت‌ها</th><th>کسورات</th><th>خالص پرداختی</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="nm">{r.staffName}</td>
                  <td className="nm">{r.dept || "—"}</td>
                  <td className="nm">{r.position || "—"}</td>
                  <td>{faDigits(r.workedDays)}</td>
                  <td>{rial(calc[i].grossRasmi)}</td>
                  <td>{rial(calc[i].insurance)}</td>
                  <td>{rial(calc[i].tax)}</td>
                  <td>{rial(calc[i].grossGheyr)}</td>
                  <td>{rial(calc[i].deductGheyr)}</td>
                  <td className="net">{rial(calc[i].netTotal)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={5}>جمع کل — {faDigits(rows.length)} نفر</td>
                <td>{rial(sum("grossRasmi"))}</td>
                <td>{rial(sum("insurance"))}</td>
                <td>{rial(sum("tax"))}</td>
                <td>{rial(sum("grossGheyr"))}</td>
                <td>{rial(sum("deductGheyr"))}</td>
                <td className="net">{rial(sum("netTotal"))}</td>
              </tr>
            </tbody>
          </table>
          <div className="doc-sign">
            <div>تهیه‌کننده: ......................................</div>
            <div>تأیید مدیر: ......................................</div>
            <div>تاریخ: ......................................</div>
          </div>
          <div className="doc-foot">ارقام به ریال · Diwaj ERP (برنامه‌ریزی منابع سازمان)</div>
        </div>
    </PrintableDoc>
  );
}

export function PayrollView({ session }) {
  const [settings, setSettings] = useState(null);
  const [staff, setStaff] = useState([]);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addPick, setAddPick] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [slipFor, setSlipFor] = useState(null);   // اندیس ردیفِ فیش در حال نمایش
  const [showSheet, setShowSheet] = useState(false);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const [s, st, ms] = await Promise.all([
          payrollApi.settings(), payrollApi.listStaff(), payrollApi.listMonths(),
        ]);
        setSettings(s); setStaff(st); setMonths(ms);
        if (ms.length) loadMonth(ms[0]);
      } catch (e) {
        setErr(e.message);
      }
    })();
  }, []);

  function loadMonth(m) {
    setMonth(m);
    setRows((m.entries || []).map((x) => ({ ...x, key: uid() })));
  }

  async function openMonth(label) {
    const name = (label || "").trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const m = await payrollApi.openMonth(name);
      setMonths((p) => (p.some((x) => x.id === m.id) ? p.map((x) => (x.id === m.id ? m : x)) : [m, ...p]));
      loadMonth(m);
      setNewLabel("");
      flash(`ماه «${m.label}» باز شد ✓`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const setRow = (key, k, v) => setRows((p) => p.map((r) => (r.key === key ? { ...r, [k]: v } : r)));

  /** نام/بخش/تأهل/فرزند مشخصهٔ خودِ پرسنل است، نه ارقام ماه؛ پس هر دو جا هم‌زمان
   *  به‌روز می‌شوند و هنگام ذخیره روی رکورد پرسنل می‌نشیند. */
  function setStaffField(staffId, rowField, v) {
    const staffField = rowField === "staffName" ? "name" : rowField;
    setStaff((p) => p.map((s) => (s.id === staffId ? { ...s, [staffField]: v } : s)));
    setRows((p) => p.map((r) => (r.staff === staffId ? { ...r, [rowField]: v } : r)));
  }

  async function addPerson() {
    if (!month) { alert("اول یک ماه باز کنید."); return; }
    if (addPick === "__new") {
      const person = await payrollApi.createStaff({ name: "پرسنل جدید", dept: "", order: staff.length })
        .catch((e) => { alert(e.message); return null; });
      if (!person) return;
      setStaff((p) => [...p, person]);
      setRows((p) => [...p, blankRow(person)]);
    } else if (addPick) {
      const person = staff.find((s) => s.id === addPick);
      if (person) setRows((p) => [...p, blankRow(person)]);
    }
    setAddPick("");
  }

  const blankRow = (person) => ({
    key: uid(), id: null, staff: person.id, staffName: person.name,
    dept: person.dept, position: person.position,
    married: person.married, children: person.children,
    absentDays: 0, workedDays: 30, otHours: 0, shortHours: 0,
    kpi: 0, seniority: 0, transport: 0, responsibility: 0,
    insuranceManual: 0, advance: 0, reserve: 0, loan: 0,
  });

  async function save() {
    if (!month || busy) return;
    setBusy(true);
    try {
      // پرسنلی که مشخصات ثابتشان عوض شده به‌روز می‌شود.
      for (const s of staff) {
        const orig = (month.entries || []).find((e) => e.staff === s.id);
        if (orig && (orig.staffName !== s.name || orig.dept !== s.dept
          || orig.position !== s.position
          || orig.married !== s.married || orig.children !== s.children)) {
          await payrollApi.updateStaff(s.id, {
            name: s.name, dept: s.dept, position: s.position,
            married: s.married, children: s.children,
          });
        }
      }
      const saved = await payrollApi.saveMonth(month.id, {
        entries: rows.map((r) => ({
          staff: r.staff,
          absentDays: r.absentDays, workedDays: r.workedDays,
          otHours: r.otHours, shortHours: r.shortHours,
          kpi: r.kpi, seniority: r.seniority, transport: r.transport,
          responsibility: r.responsibility, insuranceManual: r.insuranceManual,
          advance: r.advance, reserve: r.reserve, loan: r.loan,
        })),
      });
      setMonths((p) => p.map((x) => (x.id === saved.id ? saved : x)));
      loadMonth(saved);
      flash("ذخیره شد ✓");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(next) {
    setSettings(next);
    try {
      await payrollApi.saveSettings(next);
    } catch (e) {
      alert(e.message);
    }
  }

  if (err) return <div className="notice warn">{err}</div>;
  if (!settings) return <div className="empty">در حال بارگذاری…</div>;

  const baseComp = (settings.components || []).find((c) => c.key === "base") || { dailyRate: 0 };
  const hourRate = hourRateOf(settings);
  const calc = rows.map((r) => calcPayroll(r, settings, hourRate));
  const sum = (f) => calc.reduce((a, c) => a + c[f], 0);
  const sumRow = (f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
  const notInMonth = staff.filter((s) => s.active !== false && !rows.some((r) => r.staff === s.id));

  return (
    <>
      <div className="pay-bar">
        <div className="pay-stat"><span>نرخ روزانهٔ حقوق پایه</span><b>{rial(baseComp.dailyRate)}</b></div>
        <div className="pay-stat"><span>نرخ ساعتی</span><b>{rial(hourRate)}</b></div>
        <div className="pay-stat"><span>تعداد پرسنل</span><b>{faDigits(rows.length)}</b></div>
        <div className="pay-month">
          <label>ماه</label>
          <select value={month?.id || ""} onChange={(e) => {
            const m = months.find((x) => x.id === e.target.value);
            if (m) loadMonth(m);
          }}>
            <option value="">— انتخاب ماه —</option>
            {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="board-h">باز کردن ماه جدید</div>
        <div className="pay-open">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="مثلاً: شهریور ۱۴۰۵" onKeyDown={(e) => e.key === "Enter" && openMonth(newLabel)} />
          <button className="submit" disabled={!newLabel.trim() || busy} onClick={() => openMonth(newLabel)}>باز کردن ماه</button>
        </div>
        <WhyOff busy={busy} reasons={[!newLabel.trim() && "نام ماه نوشته نشده"]} />
        <div className="muted sm2">سنوات و ایاب‌ذهاب از ماه قبل منتقل می‌شود؛ غیبت، اضافه‌کار و کسورات از صفر شروع می‌کنند.</div>
      </div>

      <div className="card">
        <button className="pay-toggle" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? "▴ بستن تنظیمات محاسبه" : "▾ تنظیمات محاسبه (نرخ‌ها، اجزای حقوق، پلکان مالیات)"}
        </button>
        {showSettings && (
          <PayrollSettingsEditor settings={settings} onChange={saveSettings} />
        )}
      </div>

      {!month ? (
        <Empty art="payroll">هنوز ماهی باز نشده. از کادر بالا یک ماه بسازید.</Empty>
      ) : (
        <>
          <div className="pay-scroll">
            <table className="pay-table">
              <thead>
                <tr>
                  <th className="stick">نام و نام خانوادگی</th>
                  <th>بخش</th><th>سمت</th><th>غیبت (روز)</th><th>روز کارکرد</th><th>اضافه (ساعت)</th><th>کسرکار (ساعت)</th>
                  <th>متأهل</th><th>فرزند</th>
                  <th className="g-g">KPI</th><th className="g-g">سنوات</th><th className="g-g">ایاب‌ذهاب</th><th className="g-g">مسئولیت/پاداش</th>
                  <th className="g-r">ناخالص رسمی</th><th className="g-r">بیمه</th><th className="g-r">مالیات</th><th className="g-r">خالص رسمی</th>
                  <th className="g-g">ناخالص غیررسمی</th>
                  <th>مساعده</th><th>ذخیره</th><th>وام</th>
                  <th className="g-g">خالص غیررسمی</th><th>خالص کل</th><th>فیش</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = calc[i];
                  return (
                    <tr key={r.key}>
                      <td className="stick"><input className="w-name" value={r.staffName}
                        onChange={(e) => setStaffField(r.staff, "staffName", e.target.value)} /></td>
                      <td><input className="w-dept" value={r.dept || ""}
                        onChange={(e) => setStaffField(r.staff, "dept", e.target.value)} /></td>
                      <td><input className="w-dept" value={r.position || ""}
                        onChange={(e) => setStaffField(r.staff, "position", e.target.value)} /></td>
                      <td><input className="w-xs" value={r.absentDays}
                        onChange={(e) => {
                          const ab = Number(e.target.value) || 0;
                          setRows((p) => p.map((x) => (x.key === r.key
                            ? { ...x, absentDays: ab, workedDays: Math.max(0, MONTH_REF - ab) } : x)));
                        }} /></td>
                      <td><input className="w-xs" value={r.workedDays}
                        onChange={(e) => setRow(r.key, "workedDays", Number(e.target.value) || 0)} /></td>
                      <td><input className="w-xs" value={r.otHours}
                        onChange={(e) => setRow(r.key, "otHours", Number(e.target.value) || 0)} /></td>
                      <td><input className="w-xs" value={r.shortHours}
                        onChange={(e) => setRow(r.key, "shortHours", Number(e.target.value) || 0)} /></td>
                      <td><input type="checkbox" checked={!!r.married}
                        onChange={(e) => setStaffField(r.staff, "married", e.target.checked)} /></td>
                      <td><input className="w-xs" value={r.children}
                        onChange={(e) => setStaffField(r.staff, "children", Number(e.target.value) || 0)} /></td>
                      {["kpi", "seniority", "transport", "responsibility"].map((f) => (
                        <td key={f}><input value={rial(r[f])} onChange={(e) => setRow(r.key, f, money(e.target.value))} /></td>
                      ))}
                      <td className="c-r">{rial(c.grossRasmi)}</td>
                      <td><input value={r.insuranceManual > 0 ? rial(r.insuranceManual) : ""}
                        placeholder={"خودکار " + rial(c.insAuto)} style={{ width: 88 }}
                        onChange={(e) => setRow(r.key, "insuranceManual", money(e.target.value))} /></td>
                      <td className="c-r">{rial(c.tax)}</td>
                      <td className="c-r">{rial(c.netRasmi)}</td>
                      <td className="c-g">{rial(c.grossGheyr)}</td>
                      {["advance", "reserve", "loan"].map((f) => (
                        <td key={f}><input value={rial(r[f])} onChange={(e) => setRow(r.key, f, money(e.target.value))} /></td>
                      ))}
                      <td className="c-g">{rial(c.netGheyr)}</td>
                      <td className="c-t">{rial(c.netTotal)}</td>
                      <td><button className="pay-x" title="فیش حقوقی این فرد"
                        onClick={() => setSlipFor(i)}>📄</button></td>
                      <td><button className="pay-rm" title="حذف از این ماه"
                        onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}>✕</button></td>
                    </tr>
                  );
                })}
                <tr className="pay-grand">
                  <td className="stick">جمع کل</td>
                  <td colSpan={8}></td>
                  <td>{rial(sumRow("kpi"))}</td><td>{rial(sumRow("seniority"))}</td>
                  <td>{rial(sumRow("transport"))}</td><td>{rial(sumRow("responsibility"))}</td>
                  <td>{rial(sum("grossRasmi"))}</td><td>{rial(sum("insurance"))}</td>
                  <td>{rial(sum("tax"))}</td><td>{rial(sum("netRasmi"))}</td>
                  <td>{rial(sum("grossGheyr"))}</td>
                  <td>{rial(sumRow("advance"))}</td><td>{rial(sumRow("reserve"))}</td><td>{rial(sumRow("loan"))}</td>
                  <td>{rial(sum("netGheyr"))}</td><td>{rial(sum("netTotal"))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="pay-actions">
            <select value={addPick} onChange={(e) => setAddPick(e.target.value)}>
              <option value="">+ افزودن پرسنل…</option>
              {notInMonth.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__new">+ پرسنل جدید…</option>
            </select>
            <button className="ghost" disabled={!addPick} onClick={addPerson}>افزودن</button>
            <button className="submit" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیرهٔ ماه"}</button>
            <button className="ghost" onClick={() => setShowSheet(true)}>🖨 لیست حقوق (چاپ / PDF)</button>
            <button className="ghost" onClick={() => exportMonthlyPayroll(rows, calc, month.label)}>📊 خروجی اکسل</button>
            {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
          </div>
          <div className="muted sm2" style={{ marginTop: 6 }}>
            ستون بیمه را خالی بگذارید تا خودکار {faDigits(settings.insRate)}٪ حساب شود؛ عدد بزنید یعنی بیمهٔ دستی.
            برای فیش هر نفر، روی 📄 همان ردیف بزنید.
          </div>

          {slipFor !== null && rows[slipFor] && (
            <PayslipDoc row={rows[slipFor]} c={calc[slipFor]} monthLabel={month.label}
              onClose={() => setSlipFor(null)} />
          )}
          {showSheet && (
            <PayrollSheetDoc rows={rows} calc={calc} monthLabel={month.label}
              onClose={() => setShowSheet(false)} />
          )}
        </>
      )}
    </>
  );
}

function PayrollSettingsEditor({ settings, onChange }) {
  const set = (k, v) => onChange({ ...settings, [k]: v });
  const setComp = (i, k, v) => onChange({
    ...settings,
    components: settings.components.map((c, j) => (j === i ? { ...c, [k]: v } : c)),
  });
  const setBracket = (i, k, v) => onChange({
    ...settings,
    brackets: settings.brackets.map((b, j) => (j === i ? { ...b, [k]: v } : b)),
  });

  return (
    <div className="pay-settings">
      <div className="row2">
        <label className="fld sm"><span>ساعت کار روزانه (مبنای نرخ ساعتی)</span>
          <input value={settings.dailyHours} onChange={(e) => set("dailyHours", Number(e.target.value) || 0)} /></label>
        <label className="fld sm"><span>ضریب اضافه‌کاری</span>
          <input value={settings.otMult} onChange={(e) => set("otMult", Number(e.target.value) || 0)} /></label>
      </div>
      <div className="row2">
        <label className="fld sm"><span>بیمه سهم کارگر (٪)</span>
          <input value={settings.insRate} onChange={(e) => set("insRate", Number(e.target.value) || 0)} /></label>
        <label className="fld sm"><span>سقف معافیت مالیات ماهانه</span>
          <input value={rial(settings.taxExempt)} onChange={(e) => set("taxExempt", money(e.target.value))} /></label>
      </div>
      <div className="muted sm2">مبنای ماه همیشه ۳۰ روز است تا نرخ روزانه هرگز جابه‌جا نشود.</div>

      <div className="items-hd">اجزای حقوق رسمی</div>
      <div className="pay-scroll">
        <table className="pay-comp">
          <thead><tr><th>جزء</th><th>نرخ روزانه</th><th>معادل ماهانه</th><th>تسهیم</th><th>بیمه</th><th>مالیات</th></tr></thead>
          <tbody>
            {settings.components.map((c, i) => (
              <tr key={c.key || i}>
                <td className="nm">{c.name}{c.marriedOnly ? " (فقط متأهل)" : ""}</td>
                <td><input value={rial(c.dailyRate)} onChange={(e) => setComp(i, "dailyRate", money(e.target.value))} /></td>
                <td className="ref">{rial(c.dailyRate * MONTH_REF)}</td>
                <td><input type="checkbox" checked={!!c.prorate} onChange={(e) => setComp(i, "prorate", e.target.checked)} /></td>
                <td><input type="checkbox" checked={!!c.ins} onChange={(e) => setComp(i, "ins", e.target.checked)} /></td>
                <td><input type="checkbox" checked={!!c.tax} onChange={(e) => setComp(i, "tax", e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="items-hd">پلکان مالیات (مازاد بر معافیت)</div>
      {settings.brackets.map((b, i) => (
        <div className="pay-bracket" key={i}>
          {b.upto == null
            ? <span>مازاد بر آن</span>
            : <><span>اندازهٔ پله</span><input value={rial(b.upto)} onChange={(e) => setBracket(i, "upto", money(e.target.value))} /></>}
          <span>نرخ</span>
          <input style={{ width: 70 }} value={b.rate} onChange={(e) => setBracket(i, "rate", Number(e.target.value) || 0)} />
          <span>٪</span>
        </div>
      ))}
    </div>
  );
}

function payrollSheet(ws) {
  ws["!views"] = [{ RTL: true }];
  return ws;
}

function exportMonthlyPayroll(rows, calc, monthLabel) {
  const header = ["نام و نام خانوادگی", "بخش", "سمت", "غیبت(روز)", "روز کارکرد", "اضافه(ساعت)", "کسرکار(ساعت)",
    "ناخالص رسمی", "بیمه", "مالیات", "خالص رسمی",
    "KPI", "سنوات", "ایاب‌ذهاب", "اضافه‌کاری", "مسئولیت/پاداش", "ناخالص غیررسمی",
    "مساعده", "ذخیره", "وام", "خالص غیررسمی", "خالص کل پرداختی"];
  const out = [[`لیست حقوق و دستمزد — دیواژ نقش ماندگار — ${monthLabel}`], [`تعداد پرسنل: ${rows.length}`], [], header];
  const totals = new Array(header.length - 3).fill(0);
  rows.forEach((r, i) => {
    const c = calc[i];
    const row = [r.staffName, r.dept || "", r.position || "", r.absentDays, r.workedDays, r.otHours, r.shortHours,
      Math.round(c.grossRasmi), Math.round(c.insurance), Math.round(c.tax), Math.round(c.netRasmi),
      Math.round(r.kpi), Math.round(c.senyE), Math.round(c.transE), Math.round(c.otPay),
      Math.round(r.responsibility), Math.round(c.grossGheyr),
      Math.round(r.advance), Math.round(r.reserve), Math.round(r.loan),
      Math.round(c.netGheyr), Math.round(c.netTotal)];
    out.push(row);
    for (let k = 3; k < row.length; k++) totals[k - 3] += typeof row[k] === "number" ? row[k] : 0;
  });
  out.push(["جمع کل", "", "", ...totals]);
  out.push([]);
  out.push(["تهیه‌شده توسط:", "", "", "", "", "تأیید مدیر:", "", "", "", "", "", "", "", "", "", "", "", "تاریخ:"]);

  const ws = payrollSheet(XLSX.utils.aoa_to_sheet(out));
  ws["!cols"] = header.map((h, i) => (i === 0 ? { wch: 20 } : i === 1 ? { wch: 16 } : { wch: 13 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "حقوق ماهانه");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`payroll-${monthLabel}.xlsx`, new Blob([buf], { type: "application/octet-stream" }));
}
