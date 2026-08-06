/* آزمون محاسبهٔ حقوق — با `node src/payroll.test.mjs` اجرا می‌شود. */
import { calcPayroll, calcTax, hourRateOf } from "./payroll.js";

let pass = 0;
const fails = [];

function eq(label, got, want, tol = 0.5) {
  if (Math.abs(got - want) <= tol) {
    pass += 1;
  } else {
    fails.push(`${label}: انتظار ${want} — نتیجه ${got}`);
  }
}

const SETTINGS = {
  dailyHours: 7.33,
  otMult: 1.4,
  insRate: 7,
  taxExempt: 400000000,
  components: [
    { key: "base", name: "حقوق پایه", dailyRate: 5541850, prorate: true, ins: true, tax: true },
    { key: "house", name: "حق مسکن", dailyRate: 1000000, prorate: true, ins: true, tax: true },
    { key: "bon", name: "بن خواروبار", dailyRate: 22000000 / 30, prorate: true, ins: true, tax: true },
    { key: "marr", name: "حق تأهل", dailyRate: 5000000 / 30, prorate: true, ins: true, tax: true, marriedOnly: true },
    { key: "child", name: "حق اولاد", dailyRate: 554185, prorate: true, ins: false, tax: false, perChild: true },
  ],
  brackets: [
    { upto: 400000000, rate: 10 },
    { upto: 200000000, rate: 15 },
    { upto: 200000000, rate: 20 },
    { upto: 200000000, rate: 25 },
    { upto: null, rate: 30 },
  ],
};

const blank = (o = {}) => ({
  married: false, children: 0, workedDays: 30, otHours: 0, shortHours: 0,
  kpi: 0, seniority: 0, transport: 0, responsibility: 0,
  insuranceManual: 0, advance: 0, reserve: 0, loan: 0, ...o,
});

const HR = hourRateOf(SETTINGS);

/* --- نرخ‌های پایه --- */
eq("نرخ ساعتی", HR, 5541850 / 7.33);
SETTINGS.components.forEach((c) => {
  if (c.key === "bon") eq("معادل ماهانهٔ بن", c.dailyRate * 30, 22000000);
  if (c.key === "marr") eq("معادل ماهانهٔ تأهل", c.dailyRate * 30, 5000000);
});

/* --- مجرد، ماه کامل --- */
{
  const r = calcPayroll(blank(), SETTINGS, HR);
  eq("ناخالص رسمی مجرد", r.grossRasmi, 218255500);
  eq("بیمهٔ خودکار ۷٪", r.insurance, 218255500 * 0.07);
  eq("مالیات زیر معافیت", r.tax, 0);
  eq("خالص رسمی مجرد", r.netRasmi, 202977615);
  eq("خالص کل مجرد", r.netTotal, 202977615);
}

/* --- متأهل با ۲ فرزند، ۱ روز غیبت، اضافه‌کار و کسورات (همان حالتی که در مرورگر دیده شد) --- */
{
  const r = calcPayroll(blank({
    married: true, children: 2, workedDays: 29, otHours: 5, shortHours: 2,
    kpi: 10000000, seniority: 7762020, transport: 5000000, advance: 3000000,
  }), SETTINGS, HR);
  eq("ناخالص رسمی ترکیبی", r.grossRasmi, 247956380);
  eq("بیمه (اولاد بیمه ندارد)", r.insurance, 15106955.5);
  eq("خالص رسمی ترکیبی", r.netRasmi, 232849424.5);
  eq("سنوات تسهیم‌شده", r.senyE, (7762020 / 30) * 29);
  eq("ایاب‌ذهاب تسهیم‌شده", r.transE, (5000000 / 30) * 29);
  eq("اضافه‌کاری", r.otPay, HR * 1.4 * 5);
  eq("کسرکار", r.shortPay, HR * 2);
  eq("ناخالص غیررسمی", r.grossGheyr, 27628972, 0);
  eq("خالص غیررسمی", r.netGheyr, 23116871, 0);
  // هر جزء به ریال گرد می‌شود، پس خالص هم عدد صحیح است.
  eq("خالص کل ترکیبی", r.netTotal, 255966295, 0);
}

/* --- همهٔ ارقام باید عدد صحیح باشند و جمع‌ها دقیقاً بخوانند --- */
{
  const r = calcPayroll(blank({
    married: true, children: 3, workedDays: 27, otHours: 7, shortHours: 3,
    kpi: 12345678, seniority: 9876543, transport: 4321000,
    responsibility: 1111111, advance: 2222222, reserve: 333333, loan: 444444,
  }), SETTINGS, HR);

  const whole = (v) => Number.isInteger(v);
  eq("سطرهای رسمی صحیح‌اند", r.lines.every((l) => whole(l.v)) ? 1 : 0, 1);
  eq("جمع سطرها = ناخالص رسمی", r.lines.reduce((a, l) => a + l.v, 0), r.grossRasmi, 0);
  eq("بیمه صحیح است", whole(r.insurance) ? 1 : 0, 1);
  eq("مالیات صحیح است", whole(r.tax) ? 1 : 0, 1);
  eq("خالص رسمی = ناخالص − بیمه − مالیات",
    r.grossRasmi - r.insurance - r.tax, r.netRasmi, 0);
  eq("خالص غیررسمی = ناخالص − کسورات",
    r.grossGheyr - r.deductGheyr, r.netGheyr, 0);
  eq("خالص کل = خالص رسمی + خالص غیررسمی",
    r.netRasmi + r.netGheyr, r.netTotal, 0);
  eq("خالص کل صحیح است", whole(r.netTotal) ? 1 : 0, 1);
}

/* --- بیمهٔ دستی جای بیمهٔ خودکار را می‌گیرد --- */
{
  const r = calcPayroll(blank({ insuranceManual: 5000000 }), SETTINGS, HR);
  eq("بیمهٔ دستی", r.insurance, 5000000);
  eq("خالص رسمی با بیمهٔ دستی", r.netRasmi, 218255500 - 5000000);
}

/* --- تسهیم بر اساس روز کارکرد --- */
{
  const half = calcPayroll(blank({ workedDays: 15 }), SETTINGS, HR);
  eq("نصف ماه = نصف ناخالص", half.grossRasmi, 218255500 / 2);
}

/* --- حق تأهل فقط برای متأهل، حق اولاد فقط با فرزند --- */
{
  const single = calcPayroll(blank(), SETTINGS, HR);
  const married = calcPayroll(blank({ married: true }), SETTINGS, HR);
  eq("تفاوت تأهل = ۵ میلیون", married.grossRasmi - single.grossRasmi, 5000000);

  const oneKid = calcPayroll(blank({ children: 1 }), SETTINGS, HR);
  eq("یک فرزند = ۱۶,۶۲۵,۵۵۰", oneKid.grossRasmi - single.grossRasmi, 554185 * 30);
  eq("اولاد در پایهٔ بیمه نیست", oneKid.insurance, single.insurance);
}

/* --- پلکان مالیات --- */
{
  eq("زیر معافیت مالیات ندارد", calcTax(300000000, 400000000, SETTINGS.brackets), 0);
  eq("دقیقاً روی معافیت", calcTax(400000000, 400000000, SETTINGS.brackets), 0);
  // مازاد ۱۰۰ میلیون، همه در پلهٔ اول ۱۰٪
  eq("پلهٔ اول", calcTax(500000000, 400000000, SETTINGS.brackets), 10000000);
  // مازاد ۵۰۰ میلیون = ۴۰۰ در ۱۰٪ + ۱۰۰ در ۱۵٪
  eq("دو پله", calcTax(900000000, 400000000, SETTINGS.brackets), 40000000 + 15000000);
  // مازاد ۱۰۰۰ میلیون = ۴۰۰@۱۰ + ۲۰۰@۱۵ + ۲۰۰@۲۰ + ۲۰۰@۲۵
  eq("چهار پله", calcTax(1400000000, 400000000, SETTINGS.brackets), 40e6 + 30e6 + 40e6 + 50e6);
  // مازاد ۱۲۰۰ میلیون = پله‌های بالا + ۲۰۰ در ۳۰٪ (پلهٔ بی‌سقف)
  eq("پلهٔ بی‌سقف", calcTax(1600000000, 400000000, SETTINGS.brackets), 160e6 + 60e6);
}

/* --- کسورات غیررسمی --- */
{
  const r = calcPayroll(blank({ advance: 1000000, reserve: 2000000, loan: 3000000, kpi: 10000000 }), SETTINGS, HR);
  eq("کسورات از غیررسمی کم می‌شود", r.netGheyr, 10000000 - 6000000);
}

console.log(`\n${pass} آزمون موفق`);
if (fails.length) {
  console.log(`${fails.length} آزمون ناموفق:`);
  fails.forEach((f) => console.log("  -", f));
  process.exit(1);
}
console.log("همهٔ محاسبات درست است ✓");
