import { faDigits, pad, round2 } from "../shared/core.jsx";

/* کمک‌تابع‌های مشترکِ صفحه‌های برنامه‌ریزی تولید (planning.jsx و planviews.jsx). */

export const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
export const WD_SHORT = ["ی", "د", "س", "چ", "پ", "ج", "ش"];

export const toDate = (iso) => new Date(`${iso}T12:00:00`);
export const iso10 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return iso10(d); };
export const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
export const weekStart = (iso) => addDays(iso, -((toDate(iso).getDay() + 1) % 7));   // شنبهٔ همان هفته
export const baseHours = (iso) => { const wd = toDate(iso).getDay(); return wd === 5 ? 0 : wd === 4 ? 4 : 8; };
export const num = (n) => faDigits(round2(n));
export const round1 = (n) => Math.round(n * 10) / 10;

/** اضافه‌کاری و مرخصیِ یک روز (روزهایی که در زمان‌بندی نیستند هم همین را می‌خواهند). */
export function dayInfo(data, iso) {
  const overtime = data.overtime.filter((o) => o.date === iso).reduce((a, o) => a + o.hours, 0);
  const leave = data.leaves.filter((l) => l.from <= iso && iso <= l.to).map((l) => l.employee);
  return { base: baseHours(iso), overtime, leave };
}

/* وضعیتِ هر کار — همان پنج حالتی که سرور می‌دهد. رنگ‌ها با هم و برای کوررنگی سنجیده شده‌اند؛ «منتظر» خاکستری است
   چون هنوز نوبتش نرسیده. متن هیچ‌وقت رنگِ وضعیت را نمی‌گیرد؛ همیشه یک نشانهٔ رنگی کنارش می‌آید. */
export const JOB_STATUS = [
  { id: "done", label: "انجام‌شده", color: "#008300" },
  { id: "doing", label: "در حال انجام", color: "#2a78d6" },
  { id: "ready", label: "آمادهٔ شروع", color: "#eda100" },
  { id: "late", label: "عقب از برنامه", color: "#e34948" },
  { id: "waiting", label: "منتظر مرحلهٔ قبل", color: "#b4bbb9" },
];
export const statusOf = (id) => JOB_STATUS.find((s) => s.id === id) || JOB_STATUS[4];

export function StatusDot({ status }) {
  const s = statusOf(status);
  return <span className="st-dot" title={s.label}><i style={{ background: s.color }} />{s.label}</span>;
}

export function Tile({ label, value, tone, sub }) {
  return (
    <div className={tone ? `prod-tile ${tone}` : "prod-tile"}>
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export function Slip({ days }) {
  if (days == null) return null;
  if (days > 0) return <span className="pill bad">{faDigits(days)} روز عقب</span>;
  if (days < 0) return <span className="pill ok">{faDigits(-days)} روز جلو</span>;
  return <span className="pill ok">طبق برنامه</span>;
}
