/*
  محاسبهٔ حقوق و دستمزد — منطق خالص و بدون وابستگی به React، تا بشود جداگانه آزمود.

  مبنای محاسبه «نرخ روزانه» است نه ماهانه: هیچ‌جا مبلغ ماهانه بر عددی متغیر تقسیم
  نمی‌شود، پس با تغییر پارامترها نرخ پایه کوچک یا بزرگ نمی‌شود. ماه همیشه ۳۰ روز.
*/

export const MONTH_REF = 30;

export const rial = (n) => Math.round(n || 0).toLocaleString("en-US");
export const money = (s) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;

/** مالیات پلکانی روی مازاد بر معافیت. هر پله «اندازهٔ» آن پله است، نه سقف تجمعی. */
export function calcTax(taxable, exempt, brackets) {
  const over = taxable - exempt;
  if (over <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const b of brackets) {
    const size = b.upto == null ? Infinity : b.upto;
    const ceil = floor + size;
    const slice = Math.min(over, ceil) - floor;
    if (slice > 0) tax += (slice * (b.rate || 0)) / 100;
    if (over <= ceil) break;
    floor = ceil;
  }
  return tax;
}

/** محاسبهٔ حقوق یک نفر بر پایهٔ نرخ‌های روزانه و ارقام متغیر همان ماه. */
export function calcPayroll(e, st, hourRate) {
  let grossRasmi = 0;
  let insBase = 0;
  let taxBase = 0;
  const lines = [];

  (st.components || []).forEach((c) => {
    if (c.marriedOnly && !e.married) return;
    if (c.perChild && !e.children) return;
    const dRate = c.perChild ? c.dailyRate * e.children : c.dailyRate;
    if (!dRate) return;
    const earned = c.prorate ? dRate * e.workedDays : dRate * MONTH_REF;
    grossRasmi += earned;
    if (c.ins) insBase += earned;
    if (c.tax) taxBase += earned;
    lines.push({ name: c.name, v: earned });
  });

  const insAuto = (insBase * st.insRate) / 100;
  const insurance = e.insuranceManual > 0 ? e.insuranceManual : insAuto;
  const tax = calcTax(taxBase, st.taxExempt, st.brackets || []);
  const netRasmi = grossRasmi - insurance - tax;

  // سنوات و ایاب‌ذهاب ماهانه وارد می‌شوند ولی مقسوم‌علیه تسهیمشان هم ثابت ۳۰ است.
  const senyE = (e.seniority / MONTH_REF) * e.workedDays;
  const transE = (e.transport / MONTH_REF) * e.workedDays;
  const otPay = hourRate * st.otMult * e.otHours;
  const shortPay = hourRate * e.shortHours;
  const grossGheyr = senyE + transE + otPay + e.responsibility + e.kpi;
  const deductGheyr = shortPay + e.advance + e.reserve + e.loan;
  const netGheyr = grossGheyr - deductGheyr;

  return {
    lines, grossRasmi, insurance, insAuto, tax, netRasmi,
    senyE, transE, otPay, shortPay, grossGheyr, deductGheyr, netGheyr,
    netTotal: netRasmi + netGheyr,
  };
}

/** نرخ ساعتی از نرخ روزانهٔ حقوق پایه می‌آید، نه از مجموع مزایا. */
export function hourRateOf(settings) {
  const base = (settings.components || []).find((c) => c.key === "base");
  return (base ? base.dailyRate : 0) / (settings.dailyHours || 7.33);
}
