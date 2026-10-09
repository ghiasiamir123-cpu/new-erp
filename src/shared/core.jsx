import { createContext, useState, useEffect, useRef, useContext } from "react";
import * as XLSX from "xlsx";
import { auth, workStagesApi } from "../api.js";

/*
  Diwaj ERP (برنامه‌ریزی منابع سازمان)
  مدل داده مطابق سند معماری: DailyReport → چند آیتم کاری (پرسنل × پروژه)
  نقش‌ها: مدیر / کاربر ثبت / ناظر  ·  تاریخ شمسی  ·  مدیریت پروژه

  توسعهٔ تدریجی: لیست‌های STATIONS/SHIFTS/ACTIVITIES/POSITIONS/STATUSES بالای فایل.
  ذخیره‌سازی و احراز هویت: بک‌اند Django/DRF با JWT و رمز عبور هش‌شده (src/api.js).
*/

/* ============ پیکربندی ============ */
export const SHIFTS = ["صبح", "عصر", "شب"];
// مراحل خط تولید — هم برای تعیین محدودهٔ هر پروژه و هم فهرست فعالیت در ثبت گزارش.
// ۱۲ مرحلهٔ خط تولید، به ترتیب. خشک‌کن‌ها و «سایر» کارِ بی‌متراژاند و ته فهرست می‌آیند.
const STAGES = [
  "میخ سنبه و بتونه و رفع ایرادات",
  "پرداخت قبل از استر",
  "پرایمر MDF یا استر دست اول",
  "پرداخت میانی",
  "استر لایه دوم",
  "پرداخت قبل از رنگ",
  "رنگ رویه",
  "بازدید و رفع ایراد جزئی",
  "رنگ نهایی",
  "بسته‌بندی و ارسال",
];

const ACTIVITIES = [...STAGES, "سایر"];
// STAGES/ACTIVITIES فقط پشتیبان‌اند. منبع اصلی فهرست مراحل حالا سرور است (جدول WorkStage)،
// تا بک‌اند و فرانت یک فهرست داشته باشند و املای دوگانه («آستر / پرایمر») دوباره پیش نیاید.
let stageCache = null;

let stageFetch = null;
// بازدید، QC و بسته‌بندی کار روی سطح نیستند، پس متراژ نمی‌گیرند.
const NO_AREA = new Set(["سایر"]);

const FALLBACK_STAGES = ACTIVITIES.map((name) => ({ name, needsArea: !NO_AREA.has(name) }));

export function useWorkStages() {
  const [list, setList] = useState(stageCache);
  useEffect(() => {
    if (stageCache) return undefined;
    stageFetch = stageFetch || workStagesApi.list();
    let alive = true;
    stageFetch
      .then((rows) => {
        stageCache = (rows || []).filter((s) => s.active !== false);
        if (alive && stageCache.length) setList(stageCache);
      })
      .catch(() => { stageFetch = null; });   // نیامد؟ فهرست پشتیبان کار می‌کند
    return () => { alive = false; };
  }, []);
  return list && list.length ? list : FALLBACK_STAGES;
}
// پس از ویرایش مراحل، فهرست کهنه نماند (از فایل‌های دیگر فقط از این راه پاک می‌شود).
export function resetStageCache() { stageCache = null; stageFetch = null; }

export const POSITIONS = ["مدیر کارخانه", "مدیر تولید", "سرپرست", "سرگروه", "استادکار", "کارگر", "کنترل کیفیت", "انبار", "راننده"];

export const UNITS = ["کیلوگرم", "لیتر", "عدد", "بسته", "متر", "سایر"];

export const WORKDAY_HOURS = 8;
// برنامهٔ کارگاه: پنجشنبه‌ها نیم‌روز است (۴ ساعت)، بقیهٔ روزها ۸ ساعت.
export const workdayHours = (iso) => (iso && new Date(`${iso}T00:00:00`).getDay() === 4 ? 4 : WORKDAY_HOURS);

export const ROLES = {
  manager: { label: "مدیر", color: "#0F6E64" },
  data_entry: { label: "کاربر ثبت", color: "#4A7BA6" },
  viewer: { label: "ناظر", color: "#6B7A74" },
  driver: { label: "راننده", color: "#8A5CB8" },
  accountant: { label: "حسابداری", color: "#B9812A" },
};

export const STATUSES = {
  draft: { label: "پیش‌نویس", color: "#6B7A74" },
  waiting: { label: "در انتظار تأیید", color: "#4A7BA6" },
  approved: { label: "تأیید شد", color: "#1E7D46" },
  revision: { label: "نیاز به اصلاح", color: "#B5560B" },
};

const can = {
  createReport: (r) => r === "data_entry" || r === "manager",
  createDriverReport: (r) => r === "data_entry" || r === "manager" || r === "driver",
  review: (r) => r === "manager",
  manageProjects: (r) => r === "manager",
  manageUsers: (r) => r === "manager",
  // حقوق و دستمزد فقط برای مدیر و حسابداری.
  payroll: (r) => r === "manager" || r === "accountant",
  // بک‌آپ کامل شامل فهرست کاربران هم هست، پس محدود می‌ماند.
  exportBackup: (r) => r === "manager" || r === "accountant",
  // گزارش پروژه رقم ریالی ندارد — ساعت‌کار و متراژ و مواد است، همان چیزی که
  // سرپرست خودش ثبت می‌کند؛ پس برای گرفتن گزارش باز است.
  viewCostReport: (r) => r === "manager" || r === "accountant" || r === "data_entry",
  viewFinance: (r) => r === "manager" || r === "accountant",
};
/* ============ دسترسی سربرگ‌ها ============ */
// همان کلیدهای backend/core/access.py. مدیر برای هر کاربر در صفحهٔ کاربران تیک
// می‌زند؛ نقش فقط اختیارهای درون صفحه (ثبت، تأیید) را تعیین می‌کند.
export const ACCESS_TABS = [
  { id: "entry", label: "ثبت گزارش" },
  { id: "reports", label: "گزارش‌ها" },
  { id: "materials", label: "مصرف مواد" },
  { id: "driver", label: "راننده" },
  { id: "dashboard", label: "داشبورد" },
  { id: "warehouse", label: "انبار" },
  { id: "consumables", label: "مواد مصرفی (داخل انبار)", sub: "warehouse" },
  { id: "stockreview", label: "بازبینی انبار (داخل انبار)", sub: "warehouse" },
  { id: "finance", label: "کارتابل مالی" },
  { id: "financereports", label: "گزارش‌های مالی" },
  { id: "accounting", label: "دستیار حسابداری (تنخواهِ خودش را وارد می‌کند)" },
  { id: "chat", label: "گفتگو" },
  { id: "maintenance", label: "کارتابل تعمیر و نگهداری" },
  { id: "production", label: "تولید" },
  { id: "production.stages", label: "ویرایش فهرست مراحل تولید", sub: "production" },
  { id: "production.pricing", label: "قیمت‌گذاری و مبالغ قرارداد", sub: "production" },
  { id: "production.plan", label: "برنامه‌ریزی تولید: ایستگاه‌ها، ترتیب، اضافه‌کاری و مرخصی", sub: "production" },
  { id: "projects", label: "پروژه‌ها" },
  { id: "contract", label: "قرارداد" },
  { id: "payroll", label: "حقوق و دستمزد" },
  { id: "users", label: "کاربران" },
];

export const hasAccess = (s, key) => Boolean(s?.access?.includes(key));
// کارهای درون هر سربرگ — همان ACTIONS در backend/core/access.py، به همان ترتیب.
// کلید سربرگ یعنی دیدنش؛ کلید کار («warehouse.post») یعنی آن کار درون همان سربرگ.
export const ACCESS_ACTIONS = [
  { id: "entry.create", label: "ثبت گزارش کار و افزودن کارگر" },
  { id: "reports.review", label: "تأیید و برگشت برای اصلاح" },
  { id: "reports.edit", label: "ویرایش گزارش دیگران" },
  { id: "reports.delete", label: "حذف گزارش" },
  { id: "materials.create", label: "ثبت مصرف و افزودن ماده" },
  { id: "materials.manage", label: "ویرایش و حذف مواد" },
  { id: "driver.create", label: "ثبت گزارش راننده و افزودن راننده" },
  { id: "driver.manage", label: "فعال/غیرفعال و حذف راننده‌ها" },
  { id: "dashboard.cost", label: "گزارش هزینهٔ پروژه‌ها" },
  { id: "dashboard.backup", label: "خروجی اکسل کامل (بک‌اپ) — فقط نقش مدیر" },
  { id: "dashboard.staff", label: "فعال/غیرفعال و حذف کارگرها" },
  { id: "dashboard.w.summary", label: "ویجت: کارت‌های خلاصه" },
  { id: "dashboard.w.trend", label: "ویجت: ساعت کار روزانه" },
  { id: "dashboard.w.status", label: "ویجت: وضعیت گزارش‌ها" },
  { id: "dashboard.w.queue", label: "ویجت: کارهای منتظر تأیید" },
  { id: "dashboard.w.day", label: "ویجت: کار و زمان خالی یک روز" },
  { id: "dashboard.w.projhours", label: "ویجت: ساعت‌کار به تفکیک پروژه" },
  { id: "dashboard.w.staffhours", label: "ویجت: ساعت‌کار به تفکیک پرسنل" },
  { id: "dashboard.w.projects", label: "ویجت: پروژه‌های در جریان (با «پروژه‌ها» یا «تولید»)" },
  { id: "dashboard.w.pulse", label: "ویجت: نبض تولید (با «تولید»)" },
  { id: "dashboard.w.material", label: "ویجت: مصرف مواد بر هر متر (با «تولید»)" },
  { id: "dashboard.w.expiry", label: "ویجت: بچ‌های رو به انقضا (با «انبار»)" },
  { id: "dashboard.w.stock", label: "ویجت: ارزش موجودی انبار (با «گزارش‌های مالی»)" },
  { id: "dashboard.w.profit", label: "ویجت: گردش مالی دیواژ (با «گزارش‌های مالی»)" },
  { id: "dashboard.w.finance", label: "ویجت: کارتابل مالی (با «کارتابل مالی»)" },
  { id: "dashboard.w.maint", label: "ویجت: اخطارهای تعمیر و نگهداری (با «کارتابل تعمیر»)" },
  { id: "warehouse.voucher", label: "ساخت، ویرایش و حذف حوالهٔ پیش‌نویس" },
  { id: "warehouse.post", label: "ثبت نهایی حواله" },
  { id: "warehouse.amend", label: "ویرایش حوالهٔ ثبت نهایی‌شده (نام و علت زیر حواله می‌ماند)" },
  { id: "warehouse.cost", label: "دیدن قیمت خرید" },
  { id: "warehouse.setup", label: "تعریف انبار و محل، بارگذاری فایل" },
  { id: "warehouse.assets", label: "ثبت و ویرایش اموال، تعمیر و بازرسی" },
  { id: "consumables.edit", label: "تأیید و ادغام مواد" },
  { id: "stockreview.edit", label: "تیک زدن و اتصال به سایت" },
  { id: "finance.approve", label: "قیمت‌گذاری، تأیید و برگشت به انبار" },
  { id: "financereports.refresh", label: "به‌روزرسانی قیمت از سایت" },
  { id: "financereports.costs", label: "گردش مالی مرکز پوشش: اصلاح نرخ و قیمت، ثبت دریافتی کارفرما" },
  { id: "accounting.cash", label: "تنخواه: دیدنِ همه، شارژ تنخواه و تأییدِ خرج‌ها" },
  { id: "accounting.invoice", label: "فاکتور فروش پروژه‌ها: دیدن، ساختن و صادر کردن" },
  { id: "accounting.salary", label: "تسهیم حقوق به پروژه‌ها: دیدن گزارش و وارد کردن حقوق نیروها" },
  { id: "accounting.driver", label: "خروجی گزارش کار راننده" },
  { id: "maintenance.work", label: "ثبت سرویس و تعمیر، بستن اخطار" },
  { id: "projects.create", label: "تعریف پروژه و ویرایش مراحل" },
  { id: "projects.manage", label: "فعال/غیرفعال و حذف پروژه" },
];

export const actionsOf = (tabId) => ACCESS_ACTIONS.filter((a) => a.id.split(".")[0] === tabId);
// ترتیب ذخیره: هر سربرگ و پشتش کارهایش (همان KEYS در access.py).
export const ACCESS_KEYS = ACCESS_TABS.flatMap((t) => [t.id, ...actionsOf(t.id).map((a) => a.id)]);
// نقش فقط پیش‌فرض است؛ اجازه‌ها از فهرست دسترسی خوانده می‌شود.
export const SessionContext = createContext(null);
/** `const can = useCan(); can("warehouse.post")` — برای جاهایی که session به‌عنوان prop نمی‌رسد. */
export const useCan = () => {
  const session = useContext(SessionContext);
  return (key) => hasAccess(session, key);
};
// گروه‌های منوی کناری؛ سربرگی که اینجا نیامده ته گروه آخر می‌نشیند.
export const NAV_GROUPS = [
  { label: "کارهای روزانه", ids: ["entry", "reports", "materials", "driver", "chat", "maintenance"] },
  { label: "انبار و مالی", ids: ["warehouse", "finance", "financereports", "accounting", "payroll"] },
  // «تولید» مجموعهٔ خودش را دارد و بخش‌هایش (PROD_PANES) مستقیم در منو می‌آیند.
  { label: "تولید", ids: ["production"], panes: true },
  // «پروژه‌ها» در گروهِ تولید می‌آید، کنارِ وضعیتِ پروژه‌ها (App.jsx)
  { label: "مدیریت", ids: ["dashboard", "contract", "users"] },
];
/* آیکون‌های خطی ۲۴×۲۴ — درون‌خطی، تا بستهٔ تازه‌ای روی سرور نصب نشود. */
const ICONS = {
  entry: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  reports: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  materials: <path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0Z" />,
  driver: <><path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.3a1 1 0 0 0-.3-.7L18 9h-4v8h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  warehouse: <><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  finance: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></>,
  financereports: <><path d="M3 3v18h18" /><path d="M8 17v-5M13 17V8M18 17V5" /></>,
  projects: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  contract: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="m9 15 2 2 4-4" /></>,
  accounting: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01" /></>,
  cash: <><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></>,
  payroll: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  production: <><path d="M2 20h20V9l-6 4V9l-6 4V3H5l-3 17Z" /><path d="M9 20v-4h4v4" /></>,
  // بخش‌های «تولید» در منوی کناری، هر کدام با نشانهٔ خودش (prod.<شناسهٔ بخش>)
  "prod.board": <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v9M12 7v5M16 7v7" /></>,
  "prod.schedule": <><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M9 6h8M7 11h7M11 16h7" /></>,
  "prod.sim": <><circle cx="12" cy="12" r="9" /><path d="m10 8.5 6 3.5-6 3.5Z" /></>,
  "prod.people": <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  "prod.general": <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h6" /></>,
  "prod.settings": <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  maintenance: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
};

/** نشانهٔ یک ردیفِ منو: بخش‌های تولید نشانهٔ خودشان را دارند؛ اگر بخشی نشانه نداشت، همان نشانهٔ «تولید». */
export const navIcon = (item) => (item.icon && ICONS[item.icon] ? item.icon
  : item.pane && ICONS[`prod.${item.pane}`] ? `prod.${item.pane}` : item.id);

export function Icon({ name, size = 19 }) {
  if (!ICONS[name]) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}
/** آواتار کاربر: اگر عکس دارد، همان را نشان می‌دهد، وگرنه حرف اول اسمش. */
export function Avatar({ user, className = "" }) {
  const label = ((user?.name || user?.username || "؟") + "").trim().charAt(0) || "؟";
  const cls = `avatar ${className}`.trim();
  if (user?.photo) return <img className={`${cls} avatar-img`} src={user.photo} alt="" />;
  return <span className={cls}>{label}</span>;
}
/** پنجرهٔ تنظیمات شخصی: هر کاربر — مستقل از دسترسی «کاربران» — عکس پروفایل خودش را می‌گذارد. */
export function MySettingsDialog({ session, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  async function pickPhoto(file) {
    if (!file || busy) return;
    setBusy(true); setErr("");
    try {
      const photo = await readPhotoFile(file);
      const user = await auth.savePhoto(photo);
      onChanged({ photo: user.photo });
      flash("عکس ذخیره شد ✓");
    } catch (e) { setErr(e.message); } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function clearPhoto() {
    if (busy) return;
    const ok = await askConfirm({ title: "برداشتن عکس", message: "عکس پروفایل شما برداشته شود؟",
      confirmLabel: "بردار", danger: true });
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      const user = await auth.savePhoto("");
      onChanged({ photo: user.photo });
      flash("عکس برداشته شد");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog" role="dialog" aria-labelledby="my-title">
        <div className="user-dialog-hd">
          <Avatar user={session} className="lg" />
          <div className="ud-name">
            <b id="my-title">{session.name}</b>
            <small><span dir="ltr">{session.username}</span> · {ROLES[session.role]?.label}</small>
          </div>
        </div>

        <div className="user-photo" style={{ marginBottom: 0 }}>
          <div className="user-photo-body" style={{ gap: 8 }}>
            <b>عکس پروفایل</b>
            <small>یک عکس مربع یا نزدیک به مربع بگذارید؛ خودش به ۲۵۶×۲۵۶ کوچک می‌شود. حداکثر ۳۰۰ کیلوبایت.</small>
            <div>
              <button className="submit" style={{ width: "auto", margin: 0, padding: "8px 16px" }}
                disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? "…" : session.photo ? "عوض کردن عکس" : "گذاشتن عکس"}
              </button>
              {session.photo && (
                <button className="ghost" disabled={busy} style={{ marginInlineStart: 8, flex: "0 0 auto" }}
                  onClick={clearPhoto}>برداشتن عکس</button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden
                onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </div>
          </div>
        </div>

        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        {msg && <div className="ok-msg" style={{ marginTop: 10 }}>{msg}</div>}

        <div className="muted sm2" style={{ marginTop: 12, lineHeight: 1.9 }}>
          نام، سمت، دسترسی‌ها و رمز از صفحهٔ «کاربران» توسط مدیر تنظیم می‌شود. برای عوض کردن رمز خودتان، از منو «کاربران»
          را باز کنید و اگر دسترسی داشتید، سربرگ «رمز» را بزنید.
        </div>

        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>بستن</button>
        </div>
      </div>
    </div>
  );
}
/** عکس را در بوم مرورگر مربعی و به ۲۵۶×۲۵۶ درمی‌آورد و به شکل JPEG کیفیت ۸۵ برمی‌گرداند. */
export async function readPhotoFile(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("فقط عکس بگذارید.");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("عکس خوانده نشد."));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("عکس معتبر نیست."));
    i.src = data;
  });
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext("2d");
  const s = Math.min(img.width, img.height);
  const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
  g.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}
// سربرگ شروع: گزارش‌ها، راننده یا حقوق اگر باشد، وگرنه اولین سربرگ مجاز.
export const firstTab = (s) => ["reports", "driver", "payroll", ...ACCESS_TABS.filter((t) => !t.sub).map((t) => t.id)]
  .find((key) => hasAccess(s, key));

const canEdit = (report, s) =>
  report.status !== "approved" && (s.username === report.supervisor || hasAccess(s, "reports.edit"));
/* ============ تاریخ شمسی (jalaali) ============ */
const pi = (x) => Math.floor(x);

function g2j(gy, gm, gd) {
  const g = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy;
  if (gy > 1600) { jy = 979; gy -= 1600; } else { jy = 0; gy -= 621; }
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + pi((gy2 + 3) / 4) - pi((gy2 + 99) / 100) + pi((gy2 + 399) / 400) - 80 + gd + g[gm - 1];
  jy += 33 * pi(days / 12053); days %= 12053;
  jy += 4 * pi(days / 1461); days %= 1461;
  if (days > 365) { jy += pi((days - 1) / 365); days = (days - 1) % 365; }
  let jm, jd;
  if (days < 186) { jm = 1 + pi(days / 31); jd = 1 + (days % 31); }
  else { jm = 7 + pi((days - 186) / 30); jd = 1 + ((days - 186) % 30); }
  return { jy, jm, jd };
}

function j2g(jy, jm, jd) {
  let gy;
  if (jy > 979) { gy = 1600; jy -= 979; } else { gy = 621; }
  let days = 365 * jy + pi(jy / 33) * 8 + pi(((jy % 33) + 3) / 4) + 78 + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * pi(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * pi(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * pi(days / 1461); days %= 1461;
  if (days > 365) { gy += pi((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm;
  for (gm = 0; gm < 13; gm++) { const v = sal[gm]; if (gd <= v) break; gd -= v; }
  return { gy, gm, gd };
}

const isLeapJ = (jy) => { const g = j2g(jy, 12, 30); const b = g2j(g.gy, g.gm, g.gd); return b.jy === jy && b.jm === 12 && b.jd === 30; };

const jMonthLen = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isLeapJ(jy) ? 30 : 29);

export const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

const J_WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

export const pad = (n) => String(n).padStart(2, "0");

export const isoToJ = (iso) => { const [y, m, d] = iso.split("-").map(Number); return g2j(y, m, d); };

export const jToIso = ({ jy, jm, jd }) => { const g = j2g(jy, jm, jd); return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; };

export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const faDigits = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

export function jShort(iso) { if (!iso) return ""; const j = isoToJ(iso); return faDigits(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}`); }

export function jLong(iso) {
  if (!iso) return "";
  const j = isoToJ(iso), wd = WEEKDAYS[new Date(iso + "T00:00:00").getDay()];
  return `${wd} ${faDigits(j.jd)} ${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`;
}
/* ============ شناسهٔ موقت سطرهای فرم (پیش از ارسال به سرور) ============ */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* ============ خروجی اکسل (بک‌اپ) ============ */
export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/* ============ انتخاب تاریخ شمسی ============ */
/** گزینه‌های انتخاب پروژه. کار عمومی کارگاه در گروه جدا می‌آید — جایی که ساعت و
 *  مادهٔ مصرفی ثبت می‌شود، ولی نه جایی که متراژ ثبت می‌شود. */
/** نام نمایشی پروژه: «۱۴۰۵-۰۱۲ (مطهری)»؛ بی کد، همان نام کامل. */
export const projectLabel = (p) => (!p ? "" : p.code ? `${p.code} (${(p.shortName || p.name || "").trim()})` : p.name);

export function ProjectOptions({ projects, general }) {
  return (
    <>
      {projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
      {general && general.length > 0 && (
        <optgroup label="کارهای عمومی کارگاه">
          {general.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup>
      )}
    </>
  );
}

export function JalaliPicker({ value, onChange, placeholder = "" }) {
  const [open, setOpen] = useState(false);
  // تاریخ می‌تواند خالی باشد (تاریخ‌های اختیاری)؛ آن‌وقت تقویم روی امروز باز
  // می‌شود ولی هیچ روزی انتخاب‌شده نیست.
  const shown = value || todayIso();
  const j = isoToJ(shown);
  const [view, setView] = useState({ jy: j.jy, jm: j.jm });
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  // تقویم از لبهٔ راستِ دکمه به چپ باز می‌شود؛ اگر دکمه نزدیک لبهٔ چپ صفحه باشد، از چپ باز شود تا بیرون نزند.
  const [flip, setFlip] = useState(false);
  function openCal() {
    const c = isoToJ(shown); setView({ jy: c.jy, jm: c.jm });
    setFlip((ref.current?.getBoundingClientRect().right ?? 999) < 290);
    setOpen(true);
  }
  const len = jMonthLen(view.jy, view.jm);
  const firstDow = new Date(jToIso({ jy: view.jy, jm: view.jm, jd: 1 }) + "T00:00:00").getDay();
  const blanks = (firstDow + 1) % 7;
  const cells = [...Array(blanks).fill(null), ...Array(len).fill(0).map((_, i) => i + 1)];
  const prev = () => setView((v) => (v.jm === 1 ? { jy: v.jy - 1, jm: 12 } : { jy: v.jy, jm: v.jm - 1 }));
  const next = () => setView((v) => (v.jm === 12 ? { jy: v.jy + 1, jm: 1 } : { jy: v.jy, jm: v.jm + 1 }));
  const cur = value ? isoToJ(value) : {};
  return (
    <div className="jp" ref={ref}>
      <button type="button" className={value ? "jp-input" : "jp-input empty"} onClick={openCal}>
        {value ? jLong(value) : (placeholder || "انتخاب تاریخ")}
      </button>
      {open && (
        <div className={flip ? "jp-pop flip" : "jp-pop"}>
          <div className="jp-head">
            <button type="button" onClick={next}>‹</button>
            <span>{J_MONTHS[view.jm - 1]} {faDigits(view.jy)}</span>
            <button type="button" onClick={prev}>›</button>
          </div>
          <div className="jp-week">{J_WEEK.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="jp-grid">
            {cells.map((d, i) => d === null ? <span key={i} /> : (
              <button key={i} type="button"
                className={cur.jy === view.jy && cur.jm === view.jm && cur.jd === d ? "jp-day sel" : "jp-day"}
                onClick={() => { onChange(jToIso({ jy: view.jy, jm: view.jm, jd: d })); setOpen(false); }}>
                {faDigits(d)}
              </button>
            ))}
          </div>
          <div className="jp-foot">
            <button type="button" className="jp-today" onClick={() => { onChange(todayIso()); setOpen(false); }}>امروز</button>
            {placeholder && value && (
              <button type="button" className="jp-today"
                onClick={() => { onChange(""); setOpen(false); }}>پاک کردن</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
/* ---- گزارش‌های مالی ---- */
export const faRial = (n) => faDigits(Math.round(n || 0).toLocaleString("en-US"));
/* ============ مصرف مواد ============ */
// هر ردیف مصرف به یک کالای انبار وصل است؛ نام، کد و واحد از همان‌جا می‌آید.
export const blankUsageLine = (project = "") => ({
  key: uid(), project, sku: "", label: "", code: "", baseUnit: "", altUnit: "",
  unit: "", quantity: "", desc: "", kind: "use", stage: "",
});

export const USAGE_KINDS = [
  { id: "use", label: "مصرف" },
  { id: "waste", label: "ضایعات (دورریز)" },
];
export const WORK_LOCATIONS = [
  { id: "workshop", label: "کارگاه" },
  { id: "onsite", label: "محل پروژه" },
];

export function usageLineFromItem(it) {
  return {
    key: uid(), project: it.project || "", sku: it.sku || "",
    label: it.materialName || "", code: it.materialCode || "",
    baseUnit: it.baseUnit || "", altUnit: it.altUnit || "",
    unit: it.unit || it.baseUnit || "", quantity: String(it.quantity ?? ""), desc: it.desc || "",
    kind: it.kind || "use", stage: it.stage || "",
  };
}

export const usageLineReady = (r) => r.project && r.sku && Number(r.quantity) > 0;

export const usageLinePayload = (r) => ({
  project: r.project, sku: r.sku, unit: r.unit || r.baseUnit || "",
  quantity: Number(r.quantity), desc: r.desc || "", kind: r.kind || "use", stage: r.stage || "",
});
/* ============ حقوق و دستمزد ============ */
/* منطق محاسبه در src/payroll.js است تا جدا از رابط کاربری قابل آزمودن باشد. */

/** نشان دیواژ — همان مربع سبزِ بالای صفحه، به‌صورت SVG تا در چاپ هم بیاید. */
/** نشان دیواژ — شش‌ضلعی با مثلث زرد، همان لوگوی شرکت، به‌صورت SVG تا در چاپ هم تیز بیاید. */
export function DiwajLogo({ size = "100%" }) {
  return (
    <svg width={size} height={size} viewBox="474 456 434 498" aria-hidden="true" style={{ display: "block" }}>
      <polygon points="684,492 560,706 622,812" fill="#F8DD1E" />
      <g fill="none" stroke="#2A2A2A" strokeWidth="15" strokeLinejoin="round" strokeLinecap="round">
        <polygon points="690,470 894,588 894,826 690,940 488,826 488,590" />
        <line x1="488" y1="590" x2="690" y2="940" />
        <line x1="488" y1="826" x2="690" y2="470" />
        <line x1="690" y1="470" x2="626" y2="824" />
      </g>
    </svg>
  );
}

// «چیزی نیست» با تصویر. تصویرها در public/illustrations/ هستند.
export function Empty({ art, children }) {
  return (
    <div className="empty">
      {art && <img className="empty-art" src={`/illustrations/empty-${art}.png`} alt="" loading="lazy" />}
      <div>{children}</div>
    </div>
  );
}

function BrandMark({ size = 46 }) {
  return <span style={{ width: size, height: size, flex: "0 0 auto" }}><DiwajLogo /></span>;
}
/** پوستهٔ برگه‌های چاپی: نوار دکمه‌ها و محدودکردن چاپ به همین برگه. */
export function PrintableDoc({ onClose, children }) {
  // روی گوشی، مرورگر برگه را با پهنای خودِ گوشی می‌چیند و چاپ هم همان را می‌گیرد: جدول‌های پهن از کاغذ بیرون می‌زنند. تا
  // برگه باز است صفحه را به پهنای کاغذ می‌چینیم (افقی ۱۱۰۰، عمودی ۸۰۰ پیکسل)؛ پیش‌نمایش همان شکلِ A4 می‌شود و چاپ هم.
  const fit = useRef(null);
  const [toolbarZoom, setToolbarZoom] = useState(1);
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    if (!fit.current) fit.current = { content: meta.getAttribute("content"), device: window.innerWidth, width: 0 };
    const st = fit.current;
    const want = document.querySelector(".print-area .doc-sheet.wide") ? 1100 : 800;
    if (st.device >= want || st.width === want) return;
    st.width = want;
    meta.setAttribute("content", `width=${want}`);
    // مرورگرِ رومیزی این برچسب را نادیده می‌گیرد؛ فقط اگر صفحه واقعاً پهن شد دکمه‌ها را به اندازهٔ انگشت بزرگ می‌کنیم
    setTimeout(() => { if (Math.abs(window.innerWidth - want) < 3) setToolbarZoom(want / st.device); }, 200);
  });
  useEffect(() => () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta && fit.current && fit.current.width) { meta.setAttribute("content", fit.current.content); fit.current.width = 0; }
  }, []);
  useEffect(() => {
    document.body.classList.add("printing-doc");
    document.documentElement.classList.add("printing-doc-root");
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("printing-doc");
      document.documentElement.classList.remove("printing-doc-root");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="doc-overlay">
      <div className="doc-toolbar no-print" style={toolbarZoom > 1 ? { zoom: toolbarZoom } : undefined}>
        <button className="ghost" onClick={onClose}>بستن</button>
        <button className="submit" style={{ width: "auto", margin: 0 }} onClick={() => window.print()}>
          چاپ / ذخیرهٔ PDF
        </button>
      </div>
      <div className="print-area">{children}</div>
    </div>
  );
}
/** سربرگ مشترک برگه‌های چاپی. */
export function DocLetterhead({ title, subtitle }) {
  return (
    <div className="doc-head">
      <div className="doc-brand">
        <BrandMark />
        <div>
          <div className="doc-co">دیواژ</div>
          <div className="doc-co-sub">نقش ماندگار</div>
        </div>
      </div>
      <div className="doc-title-box">
        <div className="doc-title">{title}</div>
        {subtitle && <div className="doc-sub">{subtitle}</div>}
      </div>
    </div>
  );
}
/* ============ انبار ============ */
// صفحه‌هایی که جدول پهن دارند و در ستون ۶۰۰ پیکسلی موبایل جا نمی‌شوند.
export const WIDE_TABS = new Set(["warehouse", "payroll", "finance", "financereports", "accounting", "maintenance", "chat", "production", "projects"]);

export const MOVE_KINDS = [
  { id: "receipt", label: "ورود کالا", dir: "in" },
  { id: "sale", label: "فروش", dir: "out" },
  { id: "return", label: "مرجوعی", dir: "in" },
  { id: "workshop", label: "مصرف کارگاه", dir: "out" },
  { id: "transfer_out", label: "انتقال به انبار دیگر", dir: "out" },
  { id: "transfer_in", label: "دریافت از انبار دیگر", dir: "in" },
  { id: "count", label: "اصلاح انبارگردانی", dir: "any" },
];
/* جای صفحه در نشانی («#warehouse/vouchers») تا با تازه کردن صفحه همان‌جا بماند، نه برگشت به گزارش‌ها. */
export function readRoute() {
  let raw = window.location.hash.replace(/^#\/?/, "");
  try { raw = decodeURIComponent(raw); } catch { /* نشانی خراب: نادیده */ }
  const [tab = "", sub = ""] = raw.split("/");
  return { tab, sub };
}

export function writeRoute(tab, sub = "") {
  const hash = `#${tab}${sub ? `/${sub}` : ""}`;
  // replaceState: هر کلیک سربرگ یک قدم «بازگشت» مرورگر نمی‌سازد.
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
}
/* ---- خروجی اکسل و کمک‌های گزارش انبار ---- */
/** سطرها (سطر اول سرستون) → فایل اکسل راست‌به‌چپ. */
export function saveSheet(filename, sheetName, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!views"] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`${filename}-${jShort(todayIso()).replace(/\//g, "-")}.xlsx`, new Blob([buf], { type: "application/octet-stream" }));
}
/** چند برگه در یک پروندهٔ اکسل: sheets = [[نام برگه، ردیف‌ها], …]. */
export function saveBook(filename, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!views"] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`${filename}-${jShort(todayIso()).replace(/\//g, "-")}.xlsx`, new Blob([buf], { type: "application/octet-stream" }));
}
/** همهٔ صفحه‌های یک فهرست صفحه‌بندی‌شده، برای خروجی اکسل. */
export async function fetchAllPages(fetchPage, params) {
  const out = [];
  for (let page = 1; page <= 100; page += 1) {
    const d = await fetchPage({ ...params, page, page_size: 500 });
    out.push(...(d.results || []));
    if (!d.next) break;
  }
  return out;
}

export const fq = (n) => faDigits(Number(Number(n || 0).toFixed(3)));

/** بستهٔ باز: ۲٫۸۸۹ حلب (۱ حلب = ۱۸ کیلوگرم) ← «۲ حلب + ۱۶ کیلوگرم».
 *  فقط وقتی واحد فرعی کوچک‌تر از اصلی است (کیلوی حلب، دانهٔ جعبه) و مقدار عدد درست نیست؛ وگرنه "". */
export function openPackText(q, baseUnit, altUnit, altToBase) {
  const per = altToBase > 0 ? 1 / altToBase : 0;   // چند واحد فرعی در یک واحد اصلی
  const n = Number(q) || 0;
  if (!altUnit || !(per > 1.0001) || Math.abs(n - Math.round(n)) < 0.0005) return "";
  const alt = Math.round(Math.abs(n) * per * 100) / 100;
  const whole = Math.floor((alt + 0.005) / per);
  const rest = Math.max(0, Math.round((alt - whole * per) * 100) / 100);
  const parts = [whole ? `${faDigits(whole)} ${baseUnit}` : "", rest ? `${faDigits(rest)} ${altUnit}` : ""].filter(Boolean);
  return (n < 0 ? "−" : "") + (parts.join(" + ") || "۰");
}

/** مقدار موجودی؛ بستهٔ باز شکسته نشان داده می‌شود و عدد اعشاری در راهنمای موس می‌ماند. */
export function PackQty({ q, baseUnit, altUnit, altToBase, showUnit = true }) {
  const open = openPackText(q, baseUnit, altUnit, altToBase);
  if (open) return <span title={`${fq(q)} ${baseUnit || ""}`}>{open}</span>;
  return <>{fq(q)}{showUnit && baseUnit ? <> <small className="wh-unit">{baseUnit}</small></> : null}</>;
}

/** ردِ ویرایش‌های یک حواله پس از ثبت نهایی: با مجوز چه کسی، کِی، چرا و چه چیزی عوض شد. */
export function AmendNotes({ list }) {
  if (!list || !list.length) return null;
  return (
    <div className="doc-amend">
      {list.map((a) => (
        <div key={a.id}>
          <b>با مجوز {a.by} تغییر کرد</b> — {faDateTime(a.at)}{a.reason ? ` — علت: ${a.reason}` : ""}
          <ul>{(a.changes || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

/** علتِ خاموش بودنِ دکمهٔ ثبت، زیرِ همان دکمه. reasons: فهرست متن‌ها؛ false و "" یعنی آن شرط برقرار است.
 *  label وقتی لازم است که چند دکمه کنار هم باشد و باید معلوم شود حرف از کدام است. */
export function WhyOff({ reasons, label, busy }) {
  const list = busy ? [] : (reasons || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="why-off" role="status">
      <b>{label ? `دکمهٔ «${label}» خاموش است چون:` : "دکمه خاموش است چون:"}</b> {list.join(" · ")}
    </div>
  );
}

export const jYearStart = () => { const j = isoToJ(todayIso()); return jToIso({ jy: j.jy, jm: 1, jd: 1 }); };

export function DateRange({ from, to, setFrom, setTo }) {
  return (
    <div className="wh-range">
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
  );
}
/** انتخاب کالا برای افزودن به حواله. */
/* ---- پنجرهٔ تأیید و پیام داخل سامانه، به‌جای confirm/alert مرورگر ---- */
let openConfirm = null;
// ConfirmHost این را می‌گذارد

/** `if (!(await askConfirm({ title, message, confirmLabel, danger }))) return;` */
export function askConfirm(opts) {
  if (!openConfirm) return Promise.resolve(window.confirm([opts.title, opts.message].filter(Boolean).join("\n")));
  return new Promise((resolve) => openConfirm({ ...opts, resolve }));
}

export const showMessage = (opts) => askConfirm({ ...opts, alertOnly: true });

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const close = (value) => { req?.resolve(value); setReq(null); };
  useEffect(() => {
    openConfirm = setReq;
    return () => { openConfirm = null; };
  }, []);
  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { req.resolve(false); setReq(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);
  if (!req) return null;

  const tone = req.danger ? "" : req.alertOnly ? "info" : "post";
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && close(false)}>
      <div className="wh-dialog confirm-dialog" role="alertdialog" aria-labelledby="confirm-title">
        <div className="short-head">
          <span className={`short-icon ${tone}`} aria-hidden="true">{req.danger ? "!" : req.alertOnly ? "i" : "✓"}</span>
          <div>
            <div className="short-title" id="confirm-title">{req.title}</div>
            {req.message && <div className="muted sm2 confirm-msg">{req.message}</div>}
          </div>
        </div>
        <div className="btn-row">
          {req.alertOnly ? (
            <button className="submit" style={{ width: "auto", margin: 0 }} autoFocus onClick={() => close(true)}>باشه</button>
          ) : (
            <>
              <button className="ghost" autoFocus onClick={() => close(false)}>انصراف</button>
              <button className={req.danger ? "confirm-danger" : "submit"} style={{ width: "auto", margin: 0 }}
                onClick={() => close(true)}>
                {req.confirmLabel || "تأیید"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
/* ---- تعریف انبار، کالای کارگاهی و بارگذاری اکسل ---- */
export const BLANK_ITEM = {
  name: "", warehouseName: "", siteName: "", shopPackId: "",
  siteParent: "", siteParentName: "", variantLabel: "", variantCount: 0, extraPacks: [], unitOf: null,
  brand: "", category: "", productCode: "",
  warehouseCode: "", skuCode: "", barcode: "", sepidarItemId: "",
  isAsset: false, assetCode: "", location: "", holder: "", handedOverOn: "",
  assetStatus: "ok", assetSerial: "", assetModel: "", assetSupplier: "", purchaseDate: "", purchasePrice: "",
  warrantyUntil: "", assetNote: "", serviceIntervalDays: "", usefulLifeYears: "", salvageValue: "",
  packSize: "", baseUnit: "", altUnit: "", altPerBase: "",
  costPrice: "", salePrice: "", grit: "", shade: "",
  sellable: false, batchTracked: false, hazardous: false, active: true,
};
/* ---- اموال: وسیله‌ها، محلشان و دست چه کسی‌اند ---- */
/* ---- اموال: فهرست، پرونده، تاریخچه، برگهٔ تحویل و بازرسی ---- */
export const ASSET_STATUS = {
  ok: { label: "سالم", cls: "ok" },
  needs_repair: { label: "نیاز به تعمیر", cls: "warn" },
  in_repair: { label: "در تعمیر", cls: "info" },
  out_of_service: { label: "خارج از سرویس", cls: "off" },
};

export const ASSET_EVENT_CLS = { created: "ok", handover: "info", move: "info", status: "warn", repair: "bad",
  service: "ok", inspection: "info", note: "off" };

export const assetChangeText = (changes = {}) => Object.entries(changes).map(([k, [a, b]]) => {
  const label = { holder: "تحویل‌گیرنده", location: "محل", status: "وضعیت" }[k] || k;
  const val = (x) => (k === "status" ? ASSET_STATUS[x]?.label || x : x) || "—";
  return `${label}: ${val(a)} ← ${val(b)}`;
}).join(" · ");

export const faDateTime = (iso) => (iso ? new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "");
