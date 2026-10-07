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
  // چند ردیف اضافه‌کاریِ یک روز کنار هم‌اند: ساعتِ کارگاه بلندترینشان است، نه جمعشان (همان planning.py).
  const overtime = data.overtime.filter((o) => o.date === iso).reduce((a, o) => Math.max(a, o.hours), 0);
  // «کار عمومی در وقتِ بی‌کاری» (fill) غیبت نیست و از توان کم نمی‌کند؛ ساعتش را فقط خودِ زمان‌بندی می‌داند.
  const all = data.leaves.filter((l) => l.kind !== "fill" && l.from <= iso && iso <= l.to);
  // کارِ عمومیِ واجب برای کلِ کارگاه (employee = "*") روی همه می‌نشیند: null = ندارد، 0 = کلِ روز، وگرنه ساعتش
  const hands = all.filter((l) => l.employee === "*");
  const everyone = !hands.length ? null : hands.some((l) => !l.hours) ? 0 : hands.reduce((a, l) => a + l.hours, 0);
  const rows = all.filter((l) => l.employee !== "*");
  const leave = rows.filter((l) => l.kind !== "general" && !l.hours).map((l) => l.employee);
  const away = rows.map((l) => ({ name: l.employee, hours: l.hours, kind: l.kind || "leave" }));
  const holiday = (data.holidays || []).find((h) => h.date === iso);
  // تعطیل رسمی مثل جمعه است: ساعت عادی ندارد، مگر اضافه‌کاری بخورد.
  const fill = ((data.days || []).find((x) => x.date === iso) || {}).fill || [];
  return { base: holiday ? 0 : baseHours(iso), overtime, leave, away, fill, everyone, holiday: holiday ? holiday.title || "تعطیل رسمی" : "" };
}

/** «· مرخصی: علی · رضا ۴ ساعت مرخصی · کار عمومی: مهدی» — برای سرِ ستونِ هر روز. info: یک روز با leave و away. */
/** نفراتِ یک ردیفِ برنامه: در مرحله‌ای که کمکی می‌گیرد «۱ اصلی + ۱ کمکی» (همان «۲ نفر»ِ ایستگاه)، وگرنه «۲ نفر». */
export function crewText(l) {
  if (!l.lead) return `${faDigits(l.people)} نفر`;
  return l.helpers > 0 ? `${faDigits(l.lead)} اصلی + ${faDigits(l.helpers)} کمکی` : `${faDigits(l.lead)} اصلی، بی‌کمکی`;
}

/** ایستگاهی که مرحله‌اش کمکی می‌گیرد: نفراتش یعنی یک نفرِ اصلی + بقیه کمکی (نه چند نفرِ اصلی). */
export function takesHelpers(data, st) {
  return !(st.people || []).length && Number(st.crew) >= 2 && Object.keys(data.skills || {}).length > 0
    && (st.stages || []).some((s) => (data.helperStages || []).includes(s));
}

/** نفراتِ یک ایستگاه: «۲ نفر»، یا در ایستگاهی که کمکی می‌گیرد «۱ اصلی + ۱ کمکی». */
export function stationCrewText(data, st) {
  return takesHelpers(data, st) ? `${faDigits(1)} اصلی + ${faDigits(Number(st.crew) - 1)} کمکی` : `${faDigits(st.crew)} نفر`;
}

export function awayText(info) {
  const away = info.away || [];
  const parts = [];
  if (info.leave && info.leave.length) parts.push(`مرخصی: ${info.leave.join("، ")}`);
  away.filter((a) => a.kind !== "general" && a.hours).forEach((a) => parts.push(`${a.name} ${faDigits(a.hours)} ساعت مرخصی`));
  // کارِ عمومیِ همهٔ کارگاه یک بار نوشته می‌شود، نه به نامِ تک‌تکِ نفرات
  const everyone = info.everyone == null ? null : info.everyone;
  if (everyone != null) parts.push(`کار عمومی: همهٔ کارگاه (${everyone ? `${faDigits(everyone)} ساعت` : "کلِ روز"})`);
  const gen = away.filter((a) => a.kind === "general" && !(everyone != null && (a.hours || 0) === everyone))
    .map((a) => (a.hours ? `${a.name} (${faDigits(a.hours)} ساعت)` : a.name));
  if (gen.length) parts.push(`کار عمومی: ${gen.join("، ")}`);
  const by = {};                                                        // هر نفر شاید چند کار در وقتِ بی‌کاری داشته باشد
  (info.fill || []).forEach((f) => { by[f.name] = (by[f.name] || 0) + f.hours; });
  const fill = Object.entries(by).map(([n, h]) => `${n} (${faDigits(Math.round(h * 10) / 10)} ساعت)`);
  if (fill.length) parts.push(`کار عمومی در وقتِ بی‌کاری: ${fill.join("، ")}`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
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
