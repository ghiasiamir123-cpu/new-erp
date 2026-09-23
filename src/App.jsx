import { createContext, useState, useEffect, useMemo, useRef, useCallback, useContext } from "react";
import * as XLSX from "xlsx";
import { auth, consumablesApi, driverReportsApi, financeApi, financeReportsApi, chatApi, driversApi, employeesApi, maintenanceApi, materialUsageApi, materialsApi, payrollApi,
  productionApi, workStagesApi, projectsApi, reportsApi, usersApi, warehouseApi } from "./api.js";
import { MONTH_REF, calcPayroll, hourRateOf, money, rial } from "./payroll.js";

/*
  دیواژ | سامانهٔ گزارش کار روزانه
  مدل داده مطابق سند معماری: DailyReport → چند آیتم کاری (پرسنل × پروژه)
  نقش‌ها: مدیر / کاربر ثبت / ناظر  ·  تاریخ شمسی  ·  مدیریت پروژه

  توسعهٔ تدریجی: لیست‌های STATIONS/SHIFTS/ACTIVITIES/POSITIONS/STATUSES بالای فایل.
  ذخیره‌سازی و احراز هویت: بک‌اند Django/DRF با JWT و رمز عبور هش‌شده (src/api.js).
*/

/* ============ پیکربندی ============ */
const SHIFTS = ["صبح", "عصر", "شب"];
// مراحل خط تولید — هم برای تعیین محدودهٔ هر پروژه و هم فهرست فعالیت در ثبت گزارش.
const STAGES = [
  "زیرکاری",
  "سنباده‌کاری",
  "استر و پرایمر",
  "خشک‌کن میانی",
  "سنباده میانی",
  "خط رنگ",
  "خشک‌کن اولیه",
  "خشک‌کن ثانویه",
];
const ACTIVITIES = [...STAGES, "سایر"];
// STAGES/ACTIVITIES فقط پشتیبان‌اند. منبع اصلی فهرست مراحل حالا سرور است (جدول WorkStage)،
// تا بک‌اند و فرانت یک فهرست داشته باشند و املای دوگانه («آستر / پرایمر») دوباره پیش نیاید.
let stageCache = null;
let stageFetch = null;
const FALLBACK_STAGES = [...STAGES.map((name) => ({ name, needsArea: true })),
  { name: "سایر", needsArea: false }];

function useWorkStages() {
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
const POSITIONS = ["مدیر کارخانه", "مدیر تولید", "سرپرست", "سرگروه", "استادکار", "کارگر", "کنترل کیفیت", "انبار", "راننده"];
const UNITS = ["کیلوگرم", "لیتر", "عدد", "بسته", "متر", "سایر"];
const WORKDAY_HOURS = 8;

const ROLES = {
  manager: { label: "مدیر", color: "#0F6E64" },
  data_entry: { label: "کاربر ثبت", color: "#4A7BA6" },
  viewer: { label: "ناظر", color: "#6B7A74" },
  driver: { label: "راننده", color: "#8A5CB8" },
  accountant: { label: "حسابداری", color: "#B9812A" },
};

const STATUSES = {
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
const ACCESS_TABS = [
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
  { id: "chat", label: "گفتگو" },
  { id: "maintenance", label: "کارتابل تعمیر و نگهداری" },
  { id: "production", label: "تولید" },
  { id: "production.stages", label: "ویرایش فهرست مراحل تولید", sub: "production" },
  { id: "projects", label: "پروژه‌ها" },
  { id: "contract", label: "قرارداد" },
  { id: "payroll", label: "حقوق و دستمزد" },
  { id: "users", label: "کاربران" },
];
const hasAccess = (s, key) => Boolean(s?.access?.includes(key));

// کارهای درون هر سربرگ — همان ACTIONS در backend/core/access.py، به همان ترتیب.
// کلید سربرگ یعنی دیدنش؛ کلید کار («warehouse.post») یعنی آن کار درون همان سربرگ.
const ACCESS_ACTIONS = [
  { id: "entry.create", label: "ثبت گزارش کار و افزودن کارگر" },
  { id: "reports.review", label: "تأیید و برگشت برای اصلاح" },
  { id: "reports.edit", label: "ویرایش گزارش دیگران" },
  { id: "reports.delete", label: "حذف گزارش" },
  { id: "materials.create", label: "ثبت مصرف و افزودن ماده" },
  { id: "materials.manage", label: "ویرایش و حذف مواد" },
  { id: "driver.create", label: "ثبت گزارش راننده و افزودن راننده" },
  { id: "driver.manage", label: "فعال/غیرفعال و حذف راننده‌ها" },
  { id: "dashboard.cost", label: "گزارش هزینهٔ پروژه‌ها" },
  { id: "dashboard.backup", label: "خروجی اکسل کامل (بک‌اپ)" },
  { id: "dashboard.staff", label: "فعال/غیرفعال و حذف کارگرها" },
  { id: "warehouse.voucher", label: "ساخت، ویرایش و حذف حوالهٔ پیش‌نویس" },
  { id: "warehouse.post", label: "ثبت نهایی حواله" },
  { id: "warehouse.cost", label: "دیدن قیمت خرید" },
  { id: "warehouse.setup", label: "تعریف انبار و محل، بارگذاری فایل" },
  { id: "warehouse.assets", label: "ثبت و ویرایش اموال، تعمیر و بازرسی" },
  { id: "consumables.edit", label: "تأیید و ادغام مواد" },
  { id: "stockreview.edit", label: "تیک زدن و اتصال به سایت" },
  { id: "finance.approve", label: "قیمت‌گذاری، تأیید و برگشت به انبار" },
  { id: "financereports.refresh", label: "به‌روزرسانی قیمت از سایت" },
  { id: "maintenance.work", label: "ثبت سرویس و تعمیر، بستن اخطار" },
  { id: "projects.create", label: "تعریف پروژه و ویرایش مراحل" },
  { id: "projects.manage", label: "فعال/غیرفعال و حذف پروژه" },
];
const actionsOf = (tabId) => ACCESS_ACTIONS.filter((a) => a.id.split(".")[0] === tabId);
// ترتیب ذخیره: هر سربرگ و پشتش کارهایش (همان KEYS در access.py).
const ACCESS_KEYS = ACCESS_TABS.flatMap((t) => [t.id, ...actionsOf(t.id).map((a) => a.id)]);

// نقش فقط پیش‌فرض است؛ اجازه‌ها از فهرست دسترسی خوانده می‌شود.
const SessionContext = createContext(null);
/** `const can = useCan(); can("warehouse.post")` — برای جاهایی که session به‌عنوان prop نمی‌رسد. */
const useCan = () => {
  const session = useContext(SessionContext);
  return (key) => hasAccess(session, key);
};

// گروه‌های منوی کناری؛ سربرگی که اینجا نیامده ته گروه آخر می‌نشیند.
const NAV_GROUPS = [
  { label: "کارهای روزانه", ids: ["entry", "reports", "materials", "driver", "chat", "maintenance"] },
  { label: "انبار و مالی", ids: ["warehouse", "finance", "financereports", "payroll"] },
  { label: "مدیریت", ids: ["dashboard", "production", "projects", "contract", "users"] },
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
  payroll: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  production: <><path d="M2 20h20V9l-6 4V9l-6 4V3H5l-3 17Z" /><path d="M9 20v-4h4v4" /></>,
  maintenance: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
};

function Icon({ name, size = 19 }) {
  if (!ICONS[name]) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

/** آواتار کاربر: اگر عکس دارد، همان را نشان می‌دهد، وگرنه حرف اول اسمش. */
function Avatar({ user, className = "" }) {
  const label = ((user?.name || user?.username || "؟") + "").trim().charAt(0) || "؟";
  const cls = `avatar ${className}`.trim();
  if (user?.photo) return <img className={`${cls} avatar-img`} src={user.photo} alt="" />;
  return <span className={cls}>{label}</span>;
}

/** پنجرهٔ تنظیمات شخصی: هر کاربر — مستقل از دسترسی «کاربران» — عکس پروفایل خودش را می‌گذارد. */
function MySettingsDialog({ session, onClose, onChanged }) {
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
async function readPhotoFile(file) {
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
const firstTab = (s) => ["reports", "driver", "payroll", ...ACCESS_TABS.filter((t) => !t.sub).map((t) => t.id)]
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
const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const J_WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

const pad = (n) => String(n).padStart(2, "0");
const isoToJ = (iso) => { const [y, m, d] = iso.split("-").map(Number); return g2j(y, m, d); };
const jToIso = ({ jy, jm, jd }) => { const g = j2g(jy, jm, jd); return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const faDigits = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
function jShort(iso) { if (!iso) return ""; const j = isoToJ(iso); return faDigits(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}`); }
function jLong(iso) {
  if (!iso) return "";
  const j = isoToJ(iso), wd = WEEKDAYS[new Date(iso + "T00:00:00").getDay()];
  return `${wd} ${faDigits(j.jd)} ${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`;
}

/* ============ شناسهٔ موقت سطرهای فرم (پیش از ارسال به سرور) ============ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ============ خروجی اکسل (بک‌اپ) ============ */
function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
function exportExcel(reports, projects, users, materialUsages = []) {
  const rtl = (ws) => { ws["!views"] = [{ RTL: true }]; return ws; };
  const rows = [];
  reports.forEach((r) => {
    const fb = (r.feedback || []).map((x) => x.text).join(" | ");
    const base = { تاریخ: jShort(r.date), شیفت: r.shift, سرپرست: r.supervisorName, وضعیت: (STATUSES[r.status] || {}).label || "", مشکلات: r.problems || "", بازخورد_مدیر: fb };
    if (!(r.items || []).length) rows.push(base);
    else r.items.forEach((it) => rows.push({
      تاریخ: base.تاریخ, شیفت: base.شیفت, سرپرست: base.سرپرست,
      پرسنل: it.employee, پروژه: it.projectName, فعالیت: it.activity,
      ساعت: it.hours, درصد_زمان: it.percent, شرح_آیتم: it.desc || "",
      وضعیت: base.وضعیت, مشکلات: base.مشکلات, بازخورد_مدیر: fb,
    }));
  });
  const progressRows = [];
  reports.forEach((r) => (r.progress || []).forEach((g) => progressRows.push({
    تاریخ: jShort(r.date), سرپرست: r.supervisorName, پروژه: g.projectName,
    مرحله: g.stage, متراژ: g.area, شرح: g.desc || "",
  })));
  const materialRows = [];
  materialUsages.forEach((rep) => (rep.items || []).forEach((m) => materialRows.push({
    تاریخ: jShort(rep.date), ثبت_کننده: rep.recordedByName, پروژه: m.projectName,
    ماده: m.materialName, کد: m.materialCode || "", مقدار: m.quantity, واحد: m.unit || "",
    وضعیت: (STATUSES[rep.status] || {}).label || "", شرح: m.desc || "",
  })));
  const stageRows = [];
  projects.forEach((p) => (p.stages || []).forEach((s) => stageRows.push({
    پروژه: p.name, مرحله: s.name, متراژ_مرحله: s.area, انجام_شده: s.done ? "بله" : "خیر",
  })));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(rows.length ? rows : [{ تاریخ: "" }])), "گزارش‌ها");
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(progressRows.length ? progressRows : [{ تاریخ: "" }])), "متراژ روزانه");
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet((projects.length ? projects : [{}]).map((p) => ({ نام_پروژه: p.name || "", کد: p.code || "", وضعیت: p.active !== false ? "فعال" : "غیرفعال", متراژ_کل: p.totalArea || 0 })))), "پروژه‌ها");
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(materialRows.length ? materialRows : [{ تاریخ: "" }])), "مواد مصرفی");
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(stageRows.length ? stageRows : [{ پروژه: "" }])), "مراحل پروژه");
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet((users.length ? users : [{}]).map((u) => ({ نام: u.name || "", نام_کاربری: u.username || "", نقش: (ROLES[u.role] || {}).label || "", سمت: u.position || "", وضعیت: u.isActive === false ? "غیرفعال" : "فعال" })))), "کاربران");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = jShort(todayIso()).replace(/\//g, "-");
  download(`divaj-backup-${stamp}.xlsx`, new Blob([buf], { type: "application/octet-stream" }));
}

/* ============ APP ============ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [reports, setReports] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [materialUsages, setMaterialUsages] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [driverReports, setDriverReports] = useState([]);
  const [apiError, setApiError] = useState("");
  const [tab, setTab] = useState(() => readRoute().tab || "reports");
  const [navOpen, setNavOpen] = useState(false);   // منوی کناری روی موبایل

  useEffect(() => {
    (async () => {
      if (auth.isLoggedIn()) {
        try {
          setSession(await auth.me());
        } catch {
          auth.logout();
        }
      }
      setReady(true);
    })();
  }, []);

  // هر کاربر از سربرگی شروع می‌کند که به آن دسترسی دارد؛ اگر دسترسیِ سربرگِ
  // باز برداشته شود، به اولین سربرگ مجاز می‌رود.
  useEffect(() => {
    if (!session) return;
    setTab((t) => (hasAccess(session, t) ? t : firstTab(session) || t));
  }, [session]);

  // سربرگ در نشانی نوشته می‌شود؛ اگر همان سربرگِ نشانی است، بخش داخلی‌اش (مثل «حواله‌ها») می‌ماند.
  useEffect(() => {
    if (session && readRoute().tab !== tab) writeRoute(tab);
  }, [session, tab]);

  // کارتابل تعمیر و نگهداری: شمارندهٔ منو هر دقیقه، و هر بار که کاربر به صفحه برمی‌گردد.
  const [maint, setMaint] = useState(null);        // { open, high, byKind, openIds }
  const [maintSeen, setMaintSeen] = useState(0);   // بزرگ‌ترین شمارهٔ اخطاری که این کاربر دیده
  const maintNotified = useRef(0);
  const canMaint = hasAccess(session, "maintenance");
  const maintSeenKey = session ? `divaj_maint_seen_${session.username}` : "";
  const refreshMaint = useCallback(async () => {
    try { setMaint(await maintenanceApi.count()); } catch { /* فقط شمارنده است؛ خطایش صفحه را خراب نکند */ }
  }, []);
  useEffect(() => {
    if (!canMaint) { setMaint(null); return undefined; }
    try { setMaintSeen(Number(localStorage.getItem(maintSeenKey)) || 0); } catch { setMaintSeen(0); }
    refreshMaint();
    const timer = setInterval(refreshMaint, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") refreshMaint(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [canMaint, maintSeenKey, refreshMaint]);
  const markMaintSeen = useCallback((ids) => {
    const top = Math.max(0, ...(ids || []).map(Number));
    setMaintSeen((prev) => {
      const next = Math.max(prev, top);
      try { localStorage.setItem(maintSeenKey, String(next)); } catch { /* مرورگر اجازهٔ ذخیره نداد */ }
      return next;
    });
  }, [maintSeenKey]);
  // اعلان مرورگر برای اخطار تازه وقتی سایت پشت پنجره‌های دیگر است — فقط اگر کاربر اجازه داده باشد.
  useEffect(() => {
    if (!maint) return;
    const top = Math.max(0, ...maint.openIds.map(Number));
    const fresh = maint.openIds.filter((id) => Number(id) > Math.max(maintSeen, maintNotified.current)).length;
    if (fresh && maintNotified.current && document.visibilityState !== "visible"
        && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("دیواژ — تعمیر و نگهداری", { body: `${faDigits(fresh)} اخطار تازه در کارتابل`, tag: "divaj-maint" });
      } catch { /* مرورگر اعلان را نپذیرفت */ }
    }
    maintNotified.current = Math.max(maintNotified.current, top);
  }, [maint, maintSeen]);

  // گفتگو: شمارندهٔ خوانده‌نشده روی دکمهٔ منو، هر ۲۰ ثانیه یک بار.
  const [chatUnread, setChatUnread] = useState(0);
  const canChat = hasAccess(session, "chat");
  useEffect(() => {
    if (!canChat) { setChatUnread(0); return undefined; }
    const tick = async () => {
      try { const d = await chatApi.unread(); setChatUnread(d.unread || 0); } catch { /* شمارنده، بی‌مسئله */ }
    };
    tick();
    const timer = setInterval(tick, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [canChat]);

  useEffect(() => {
    if (!session) { setProjects([]); setReports([]); setUsers([]); setMaterials([]); setMaterialUsages([]); setEmployees([]); setDrivers([]); setDriverReports([]); return; }
    (async () => {
      try {
        setApiError("");
        // گزارش‌ها، داشبورد و پروژه‌ها داده‌های مشترک را لازم دارند؛ کسی که فقط
        // صفحهٔ راننده دارد، فقط دادهٔ راننده را می‌گیرد.
        const needsShared = ["entry", "reports", "materials", "dashboard", "projects"].some((k) => hasAccess(session, k));
        if (!needsShared) {
          if (hasAccess(session, "driver")) {
            const [drv, dr] = await Promise.all([driversApi.list(), driverReportsApi.list()]);
            setDrivers(drv); setDriverReports(dr);
          }
          if (hasAccess(session, "users")) setUsers(await usersApi.list());
          return;
        }
        const [p, r, m, mu, emp, drv, dr] = await Promise.all([
          projectsApi.list(), reportsApi.list(), materialsApi.list(), materialUsageApi.list(), employeesApi.list(),
          driversApi.list(), driverReportsApi.list(),
        ]);
        setProjects(p); setReports(r); setMaterials(m); setMaterialUsages(mu); setEmployees(emp);
        setDrivers(drv); setDriverReports(dr);
        if (hasAccess(session, "users")) setUsers(await usersApi.list());
      } catch (e) {
        setApiError(e.message || "خطا در دریافت اطلاعات از سرور.");
      }
    })();
  }, [session]);

  async function doLogin(username, password) {
    const user = await auth.login(username, password);
    setSession(user);
  }
  function doLogout() {
    auth.logout();
    setSession(null);
  }

  async function createReport(payload) {
    const report = await reportsApi.create(payload);
    setReports((p) => [report, ...p]);
    return report;
  }
  async function addFeedback(id, data) {
    const report = await reportsApi.feedback(id, data);
    setReports((p) => p.map((r) => (r.id === report.id ? report : r)));
  }
  async function updateReportSections(id, body) {
    const report = await reportsApi.updateSections(id, body);
    setReports((p) => p.map((r) => (r.id === report.id ? report : r)));
    return report;
  }
  async function resubmitReport(id) {
    const report = await reportsApi.setWaiting(id);
    setReports((p) => p.map((r) => (r.id === report.id ? report : r)));
  }
  async function deleteReport(id) {
    await reportsApi.remove(id);
    setReports((p) => p.filter((r) => r.id !== id));
  }
  async function createProject(data) {
    const project = await projectsApi.create(data);
    setProjects((p) => [...p, project]);
    return project;
  }
  async function toggleProject(project) {
    const updated = await projectsApi.update(project.id, { active: !(project.active !== false) });
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function deleteProject(id) {
    await projectsApi.remove(id);
    setProjects((p) => p.filter((x) => x.id !== id));
  }
  async function saveProjectStages(id, stages) {
    const updated = await projectsApi.saveStages(id, stages);
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function reopenProject(id) {
    const updated = await productionApi.reopen(id);
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function createUser(data) {
    const user = await usersApi.create(data);
    setUsers((p) => [...p, user]);
    return user;
  }
  async function updateUser(username, data) {
    const updated = await usersApi.update(username, data);
    setUsers((p) => p.map((u) => (u.username === updated.username ? updated : u)));
    // اگر مدیر دسترسی یا مشخصات خودش را عوض کند، سربرگ‌ها و نام همان لحظه به‌روز می‌شوند.
    if (updated.username === session.username) setSession((s) => ({ ...s, ...updated }));
    return updated;
  }
  async function resetUserPassword(username, password) {
    const updated = await usersApi.resetPassword(username, password);
    setUsers((p) => p.map((u) => (u.username === updated.username ? updated : u)));
    return updated;
  }
  async function createMaterial(data) {
    const material = await materialsApi.create(data);
    setMaterials((p) => [...p, material]);
    return material;
  }
  async function toggleMaterial(material) {
    const updated = await materialsApi.update(material.id, { active: !(material.active !== false) });
    setMaterials((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function deleteMaterial(id) {
    await materialsApi.remove(id);
    setMaterials((p) => p.filter((x) => x.id !== id));
  }
  async function createMaterialUsage(data) {
    const usage = await materialUsageApi.create(data);
    setMaterialUsages((p) => [usage, ...p]);
    return usage;
  }
  async function updateMaterialUsage(id, body) {
    const updated = await materialUsageApi.updateSections(id, body);
    setMaterialUsages((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function addMaterialUsageFeedback(id, data) {
    const updated = await materialUsageApi.feedback(id, data);
    setMaterialUsages((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function resubmitMaterialUsage(id) {
    const updated = await materialUsageApi.setWaiting(id);
    setMaterialUsages((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function deleteMaterialUsage(id) {
    await materialUsageApi.remove(id);
    setMaterialUsages((p) => p.filter((x) => x.id !== id));
  }
  async function createEmployee(data) {
    const employee = await employeesApi.create(data);
    setEmployees((p) => [...p, employee]);
    return employee;
  }
  async function toggleEmployee(employee) {
    const updated = await employeesApi.update(employee.id, { active: !(employee.active !== false) });
    setEmployees((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function deleteEmployee(id) {
    await employeesApi.remove(id);
    setEmployees((p) => p.filter((x) => x.id !== id));
  }
  async function createDriver(data) {
    const driver = await driversApi.create(data);
    setDrivers((p) => [...p, driver]);
    return driver;
  }
  async function toggleDriver(driver) {
    const updated = await driversApi.update(driver.id, { active: !(driver.active !== false) });
    setDrivers((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function deleteDriver(id) {
    await driversApi.remove(id);
    setDrivers((p) => p.filter((x) => x.id !== id));
  }
  async function createDriverReport(data) {
    const report = await driverReportsApi.create(data);
    setDriverReports((p) => [report, ...p]);
    return report;
  }
  async function updateDriverReport(id, body) {
    const updated = await driverReportsApi.updateSections(id, body);
    setDriverReports((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function addDriverReportFeedback(id, data) {
    const updated = await driverReportsApi.feedback(id, data);
    setDriverReports((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function resubmitDriverReport(id) {
    const updated = await driverReportsApi.setWaiting(id);
    setDriverReports((p) => p.map((x) => (x.id === updated.id ? updated : x)));
  }
  async function deleteDriverReport(id) {
    await driverReportsApi.remove(id);
    setDriverReports((p) => p.filter((x) => x.id !== id));
  }

  // هوک‌ها همیشه پیش از هر return شرطی، وگرنه React خطای «hook count» می‌دهد و صفحه سفید می‌شود.
  const [mySettings, setMySettings] = useState(false);

  if (!ready) return (<div className="app" dir="rtl"><style>{CSS}</style><div className="center">در حال بارگذاری…</div></div>);
  if (!session) return <Login onLogin={doLogin} />;
  if (session.mustChangePassword) {
    return <ForcePasswordChange session={session} onChanged={(u) => setSession(u)} onLogout={doLogout} />;
  }

  const role = session.role;
  const TABS = ACCESS_TABS.filter((t) => !t.sub && hasAccess(session, t.id));

  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.ids));
  const navGroups = NAV_GROUPS
    .map((g, i) => ({
      label: g.label,
      items: [
        ...g.ids.map((id) => TABS.find((t) => t.id === id)).filter(Boolean),
        ...(i === NAV_GROUPS.length - 1 ? TABS.filter((t) => !grouped.has(t.id)) : []),
      ],
    }))
    .filter((g) => g.items.length > 0);
  const tabLabel = ACCESS_TABS.find((t) => t.id === tab)?.label || "";
  const pick = (id) => { setTab(id); setNavOpen(false); };
  const maintNew = maint ? maint.openIds.filter((id) => Number(id) > maintSeen).length : 0;

  return (
    <SessionContext.Provider value={session}>
    <div className={WIDE_TABS.has(tab) ? "app app-wide shell" : "app shell"} dir="rtl">
      <style>{CSS}</style>
      <aside className={navOpen ? "sb open no-print" : "sb no-print"} aria-label="منوی اصلی">
        <div className="sb-brand">
          <span className="mark" />
          <div><b>دیواژ</b><small>سامانهٔ گزارش کار روزانه</small></div>
          <button className="sb-close" onClick={() => setNavOpen(false)} aria-label="بستن منو"><Icon name="close" size={20} /></button>
        </div>
        <nav className="sb-nav">
          {navGroups.map((g) => (
            <div className="sb-group" key={g.label}>
              <span className="sb-label">{g.label}</span>
              {g.items.map((t) => (
                <button key={t.id} className={tab === t.id ? "sb-item on" : "sb-item"}
                  aria-current={tab === t.id ? "page" : undefined} onClick={() => pick(t.id)}>
                  <Icon name={t.id} />
                  <span>{t.label}</span>
                  {t.id === "maintenance" && maint?.open > 0 && (
                    <span className={maint.high ? "sb-badge hot" : "sb-badge"}
                      title={`${faDigits(maint.open)} اخطار باز${maint.high ? `، ${faDigits(maint.high)} فوری` : ""}`}>
                      {faDigits(maint.open)}
                    </span>
                  )}
                  {t.id === "chat" && chatUnread > 0 && (
                    <span className="sb-badge hot" title={`${faDigits(chatUnread)} پیام تازه`}>{faDigits(chatUnread)}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-user">
          <Avatar user={session} />
          <div><b>{session.name}</b><small>{ROLES[role].label}</small></div>
          <button className="sb-logout" onClick={doLogout} title="خروج" aria-label="خروج"><Icon name="logout" size={18} /></button>
        </div>
      </aside>
      {navOpen && <button className="sb-overlay no-print" onClick={() => setNavOpen(false)} aria-label="بستن منو" />}

      <div className="main">
      <header className="topbar no-print">
        <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="باز کردن منو"><Icon name="menu" size={22} /></button>
        <div className="crumb"><span>دیواژ</span><span className="sep">/</span><b>{tabLabel}</b></div>
        <div className="top-user">
          <span className="today">{jLong(todayIso())}</span>
          <button className="top-me" onClick={() => setMySettings(true)} aria-label="تنظیمات پروفایل من">
            <Avatar user={session} className="sm" />
            <div className="top-user-name"><b>{session.name}</b><small>{ROLES[role].label}</small></div>
          </button>
        </div>
      </header>
      {mySettings && (
        <MySettingsDialog session={session} onClose={() => setMySettings(false)}
          onChanged={(u) => setSession((s) => ({ ...s, ...u }))} />
      )}

      {tab === "contract" && hasAccess(session, "contract") ? (
        <ContractGenerator session={session} />
      ) : (
        <main className={WIDE_TABS.has(tab) ? "wrap wide" : "wrap"}>
          {apiError && <div className="notice warn">{apiError}</div>}
          {maintNew > 0 && tab !== "maintenance" && (
            <div className="mt-banner no-print" role="status">
              <span className="mt-banner-ic"><Icon name="maintenance" size={18} /></span>
              <div>
                <b>{faDigits(maintNew)} اخطار تازهٔ تعمیر و نگهداری</b>
                <small>{maint.high ? `${faDigits(maint.high)} مورد فوری در کارتابل است.` : "در کارتابل تعمیر و نگهداری ببینید."}</small>
              </div>
              <button className="submit" onClick={() => pick("maintenance")}>دیدن کارتابل</button>
              <button className="ghost" onClick={() => markMaintSeen(maint.openIds)}>بعداً</button>
            </div>
          )}
          {TABS.length === 0 && <div className="notice warn">هیچ سربرگی برای شما فعال نیست؛ از مدیر بخواهید دسترسی بدهد.</div>}
          {tab === "entry" && hasAccess(session, "entry") && <EntryView session={session} projects={projects} reports={reports} employees={employees} onCreateReport={createReport} onUpdateReport={updateReportSections} onAddProject={createProject} onAddEmployee={createEmployee} />}
          {tab === "reports" && hasAccess(session, "reports") && (
            <ReportsView
              session={session} reports={reports} materialUsages={materialUsages} driverReports={driverReports}
              projects={projects} materials={materials} employees={employees} drivers={drivers}
              onAddFeedback={addFeedback} onResubmit={resubmitReport} onUpdateReport={updateReportSections} onDelete={deleteReport}
              onAddUsageFeedback={addMaterialUsageFeedback} onResubmitUsage={resubmitMaterialUsage} onUpdateUsage={updateMaterialUsage} onDeleteUsage={deleteMaterialUsage}
              onAddDriverFeedback={addDriverReportFeedback} onResubmitDriver={resubmitDriverReport} onUpdateDriver={updateDriverReport} onDeleteDriver={deleteDriverReport}
            />
          )}
          {tab === "materials" && hasAccess(session, "materials") && <MaterialsUsageView session={session} projects={projects} materials={materials} materialUsages={materialUsages} onCreateUsage={createMaterialUsage} onUpdateUsage={updateMaterialUsage} onCreateMaterial={createMaterial} onToggleMaterial={toggleMaterial} onDeleteMaterial={deleteMaterial} />}
          {tab === "driver" && hasAccess(session, "driver") && <DriverView session={session} drivers={drivers} driverReports={driverReports} onCreateReport={createDriverReport} onUpdateReport={updateDriverReport} onCreateDriver={createDriver} onToggleDriver={toggleDriver} onDeleteDriver={deleteDriver} />}
          {tab === "dashboard" && hasAccess(session, "dashboard") && <Dashboard reports={reports} projects={projects} materialUsages={materialUsages} drivers={drivers} driverReports={driverReports} users={users} session={session} employees={employees} onToggleEmployee={toggleEmployee} onDeleteEmployee={deleteEmployee} />}
          {tab === "projects" && hasAccess(session, "projects") && <ProjectsView projects={projects} session={session} onCreate={createProject} onToggle={toggleProject} onDelete={deleteProject} onSaveStages={saveProjectStages} onReopen={reopenProject} />}
          {tab === "warehouse" && hasAccess(session, "warehouse") && <WarehouseView session={session} />}
          {tab === "finance" && hasAccess(session, "finance") && <FinanceView />}
          {tab === "financereports" && hasAccess(session, "financereports") && <FinanceReportsView />}
          {tab === "maintenance" && canMaint && <MaintenanceView onChanged={refreshMaint} onSeen={markMaintSeen} />}
          {tab === "chat" && hasAccess(session, "chat") && <ChatView session={session} onUnread={setChatUnread} />}
          {tab === "production" && hasAccess(session, "production") && <ProductionView />}
          {tab === "payroll" && hasAccess(session, "payroll") && <PayrollView session={session} />}
          {tab === "users" && hasAccess(session, "users") && <UsersView users={users} session={session} onCreate={createUser} onUpdate={updateUser} onResetPassword={resetUserPassword} />}
          {/* آخرِ صفحه تا پنجرهٔ تأیید روی پنجره‌های دیگر (مثل ویرایش کاربر) بیاید */}
          <ConfirmHost />
        </main>
      )}
      <footer className="ft no-print">داده‌ها بین کاربران این اپ مشترک است · نمونهٔ اولیهٔ داخلی</footer>
      </div>
    </div>
    </SessionContext.Provider>
  );
}

/* ============ تولید ============ */
// وضعیت زندهٔ هر پروژه: چقدر برنامه، چقدر انجام شده، چقدر مانده. دادهٔ همان گزارش‌های
// روزانه است — چیزی جدا ثبت نمی‌شود.
// دلیل بستن — بی این، پروژه‌ای که برنامه‌اش هرگز وارد نشده «۱۰۰٪ تکمیل» به نظر می‌رسد.
const CLOSE_REASONS = [
  { id: "completed", label: "کار تکمیل شد",
    hint: "همهٔ متراژ برنامه انجام شده. فقط وقتی می‌شود که برنامه وارد شده باشد." },
  { id: "short", label: "با کسری بسته شد",
    hint: "کار تمام شده ولی کمتر از برنامه — مثلاً مشتری مقداری را حذف کرده." },
  { id: "incomplete_data", label: "دادهٔ ناقص — بسته شد",
    hint: "کار انجام شده ولی گزارش‌هایش کامل ثبت نشده. برای پروژه‌های قدیمی." },
];

const PROD_STATES = {
  nosetup: { label: "متراژ ندارد", cls: "bad" },
  notstarted: { label: "شروع نشده", cls: "idle" },
  running: { label: "در جریان", cls: "run" },
  finished: { label: "متراژ کامل شد", cls: "ok" },
  closed: { label: "بسته شد", cls: "done" },
  service: { label: "خدماتی", cls: "idle" },
  archived: { label: "بایگانی", cls: "idle" },
};

const PROD_PANES = [
  { id: "board", label: "وضعیت پروژه‌ها" },
  { id: "plan", label: "پیش‌بینی و ظرفیت" },
  { id: "people", label: "عملکرد کارگاه و پرسنل" },
];

function ProductionView() {
  const [pane, setPane] = useState("board");
  return (
    <>
      <div className="sub-tabs no-print">
        {PROD_PANES.map((p) => (
          <button key={p.id} className={pane === p.id ? "sub-tab on" : "sub-tab"}
            onClick={() => setPane(p.id)}>{p.label}</button>
        ))}
      </div>
      {pane === "board" && <ProdBoard />}
      {pane === "plan" && <ProdPlan />}
      {pane === "people" && <ProdPeople />}
    </>
  );
}

function ProdBoard() {
  const can = useCan();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [groupBusy, setGroupBusy] = useState("");
  const [closing, setClosing] = useState(null);   // ردیفی که دارد بسته می‌شود
  const [reopenBusy, setReopenBusy] = useState("");
  const [picked, setPicked] = useState(new Set());  // برای بستن گروهی
  const [bulk, setBulk] = useState(false);

  const reload = useCallback(async () => {
    try { setData(await productionApi.board(showAll)); setErr(""); }
    catch (e) { setErr(e.message); }
  }, [showAll]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload]);

  // گروه گفتگوی پروژه: اگر هست بازش می‌کند، وگرنه می‌سازد و پیام افتتاحیه می‌فرستد.
  async function openGroup(row) {
    if (groupBusy) return;
    setGroupBusy(row.id);
    try {
      const conv = await chatApi.projectGroup(row.id);
      window.location.hash = "#chat";
      if (conv.created) alert(`گروه «${conv.title}» ساخته شد.`);
    } catch (e) { alert(e.message); } finally { setGroupBusy(""); }
  }

  async function reopen(row) {
    if (reopenBusy) return;
    if (!window.confirm(`پروژهٔ «${row.name}» دوباره باز شود؟`)) return;
    setReopenBusy(row.id);
    try { await productionApi.reopen(row.id); await reload(); }
    catch (e) { alert(e.message); } finally { setReopenBusy(""); }
  }

  // برنامه را برابر کارِ ثبت‌شده می‌گذارد — برای پروژهٔ قدیمی که برنامه‌اش وارد نشده.
  async function planFromWork(row) {
    if (!window.confirm(
      `متراژ برنامهٔ «${row.name}» برابر ${faDigits(round2(row.done))} م² کارِ ثبت‌شده شود؟`)) return;
    try { await productionApi.planFromWork(row.id); setClosing(null); await reload(); }
    catch (e) { alert(e.message); }
  }

  const togglePick = (id) => setPicked((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  if (err) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;

  const t = data.totals;
  const needSetup = data.results.filter((r) => r.state === "nosetup");
  const withIssues = data.results.filter((r) => r.issues.length && r.state !== "nosetup");
  // پروژهٔ بسته پیش‌فرض پنهان است؛ صفحه دربارهٔ کارِ در جریان است.
  const shown = showClosed ? data.results : data.results.filter((r) => r.state !== "closed");

  return (
    <>
      <div className="prod-tiles">
        <Tile label="متراژ برنامه" value={`${faDigits(round2(t.planned))} م²`} />
        <Tile label="انجام شده" value={`${faDigits(round2(t.done))} م²`} tone="ok" />
        <Tile label="باقیمانده" value={`${faDigits(round2(t.remaining))} م²`} tone="run" />
        <Tile label="پروژه‌ها"
          value={t.closed ? `${faDigits(t.projects - t.closed)} باز · ${faDigits(t.closed)} بسته`
                          : faDigits(t.projects)} />
      </div>

      {needSetup.length > 0 && (
        <div className="notice warn">
          <b>{faDigits(needSetup.length)} پروژه متراژ ندارد.</b> تا مراحل و متراژشان وارد نشود،
          نمی‌شود گفت چقدر پیش رفته‌اند و چقدر مانده. در صفحهٔ «پروژه‌ها» وارد کنید — یا اگر
          کار خدماتی‌اند، تیک «بدون متراژ» را بزنید.
          <div className="chip-row">
            {needSetup.map((r) => <span className="chip bad" key={r.id}>{r.name}</span>)}
          </div>
        </div>
      )}
      {withIssues.length > 0 && (
        <div className="notice warn">
          <b>{faDigits(withIssues.length)} پروژه مغایرت دارد.</b> بیش از برنامه ثبت شده یا
          مرحله‌ای خارج از برنامهٔ پروژه کار خورده.
        </div>
      )}

      <div className="board-h" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ flex: 1 }}>وضعیت پروژه‌ها</span>
        {can("projects.manage") && (
          <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
            onClick={() => { setBulk(!bulk); setPicked(new Set()); }}>
            {bulk ? "لغو انتخاب گروهی" : "بستن گروهی"}
          </button>
        )}
        {t.closed > 0 && (
          <label className="chk-line" style={{ margin: 0 }}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            <span>بسته‌شده‌ها ({faDigits(t.closed)})</span>
          </label>
        )}
        <label className="chk-line" style={{ margin: 0 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <span>غیرفعال‌ها هم</span>
        </label>
      </div>

      {bulk && (
        <div className="bulk-bar">
          <span>{faDigits(picked.size)} پروژه انتخاب شده</span>
          <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
            onClick={() => setPicked(new Set(shown.filter((r) => r.state !== "closed"
              && r.state !== "service").map((r) => r.id)))}>همه</button>
          <button className="submit submit-warn" style={{ width: "auto", margin: 0, padding: "7px 16px" }}
            disabled={picked.size === 0} onClick={() => setClosing({ bulkIds: [...picked] })}>
            بستن {faDigits(picked.size)} پروژه
          </button>
        </div>
      )}

      {shown.length === 0 ? <div className="empty">پروژه‌ای نیست.</div> : shown.map((r) => {
        const st = PROD_STATES[r.state] || PROD_STATES.idle;
        const isClosed = r.state === "closed";
        return (
          <div className={isClosed ? "card closed" : "card"} key={r.id}>
            <div className="prod-hd">
              {bulk && r.state !== "closed" && r.state !== "service" && (
                <input type="checkbox" checked={picked.has(r.id)}
                  onChange={() => togglePick(r.id)} style={{ flex: "0 0 auto" }} />
              )}
              <div className="prod-name">
                <b>{r.name}</b>
                {r.code ? <span className="proj-code">{r.code}</span> : null}
                <span className={`pill ${st.cls}`}>{st.label}</span>
              </div>
              {!isClosed && <Countdown due={r.dueDate} done={r.state === "finished"} />}
              {can("chat") && r.state !== "service" && (
                <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                  disabled={groupBusy === r.id} onClick={() => openGroup(r)}>
                  {groupBusy === r.id ? "…" : "گروه گفتگو"}
                </button>
              )}
              {can("projects.manage") && r.state !== "service" && (isClosed ? (
                <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                  disabled={reopenBusy === r.id} onClick={() => reopen(r)}>
                  {reopenBusy === r.id ? "…" : "بازکردن"}
                </button>
              ) : (
                <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                  onClick={() => setClosing(r)}>بستن پروژه</button>
              ))}
            </div>

            {isClosed && (
              <div className="close-note">
                بسته شد در {jShort(r.closedAt)}
                {r.closedBy ? ` توسط ${r.closedBy}` : ""}
                {r.closeReasonLabel && <> · <b>{r.closeReasonLabel}</b></>}
                {r.closeReason === "short" && r.closedRemaining > 0 && (
                  <> · <span className="warn-txt">{faDigits(round2(r.closedRemaining))} م² کسری</span></>
                )}
                {r.closeReason === "incomplete_data" && (
                  <> · <span className="warn-txt">آمارش کامل نیست</span></>
                )}
                {r.closeNote && <div className="muted sm2" style={{ marginTop: 4 }}>{r.closeNote}</div>}
              </div>
            )}

            {r.planned > 0 && (
              <>
                <div className="bar-row">
                  <span className="bar-lbl">پیشرفت</span>
                  <div className="bar"><div style={{ width: Math.min(r.percent, 100) + "%" }} /></div>
                  <span className="bar-v">{faDigits(r.percent)}٪</span>
                </div>
                <div className="muted sm2">
                  {faDigits(round2(r.done))} از {faDigits(round2(r.planned))} م² انجام شده ·
                  باقیمانده {faDigits(round2(r.remaining))} م²
                  {r.pending > 0 && <> · <span className="warn-txt">{faDigits(round2(r.pending))} م² در انتظار تأیید</span></>}
                </div>
              </>
            )}

            {r.issues.length > 0 && (
              <ul className="prod-issues">
                {r.issues.map((i) => <li key={i}>{i}</li>)}
              </ul>
            )}

            {r.stages.length > 0 && (
              <button className="stage-toggle" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                {openId === r.id ? "بستن مراحل ▲" : `مراحل (${faDigits(r.stages.length)}) ▼`}
              </button>
            )}
            {openId === r.id && (
              <div className="prod-stages">
                {r.stages.map((s) => (
                  <div className={s.over || !s.inPlan ? "prod-stage bad" : "prod-stage"} key={s.name}>
                    <div className="prod-stage-hd">
                      <b>{s.name}</b>
                      {!s.inPlan && <span className="pill bad">خارج از برنامه</span>}
                      {s.over && <span className="pill bad">{faDigits(round2(s.overBy))} م² بیشتر</span>}
                      {s.closed && <span className="pill ok">انجام شد</span>}
                    </div>
                    <div className="bar-row">
                      <div className="bar"><div style={{ width: Math.min(s.percent, 100) + "%" }} /></div>
                      <span className="bar-v">{faDigits(s.percent)}٪</span>
                    </div>
                    <div className="muted sm2">
                      برنامه {faDigits(round2(s.planned))} · انجام {faDigits(round2(s.done))} ·
                      مانده {faDigits(round2(s.remaining))} م²
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {closing && (closing.bulkIds
        ? <BulkCloseDialog rows={data.results.filter((r) => closing.bulkIds.includes(r.id))}
            onClose={() => setClosing(null)}
            onDone={() => { setClosing(null); setBulk(false); setPicked(new Set()); reload(); }} />
        : <CloseProjectDialog row={closing} onClose={() => setClosing(null)}
            onPlanFromWork={planFromWork}
            onDone={() => { setClosing(null); reload(); }} />)}
    </>
  );
}

/** بستن چند پروژه با یک دلیل — برای جمع کردن پروژه‌های قدیمی. */
function BulkCloseDialog({ rows, onClose, onDone }) {
  // اگر حتی یکی از انتخاب‌شده‌ها برنامه نداشته باشد، «تکمیل شد» برای همه ممکن نیست.
  const anyNoPlan = rows.some((r) => !(r.planned > 0));
  const [reason, setReason] = useState(anyNoPlan ? "incomplete_data" : "short");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (busy) return;
    setBusy(true); setErr("");
    try { await productionApi.bulkClose(rows.map((r) => r.id), reason, note.trim()); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">بستن {faDigits(rows.length)} پروژه</div>

        <div className="pick-list" style={{ maxHeight: 200 }}>
          {rows.map((r) => (
            <div className="pick-row" key={r.id}>
              <span className="pick-name">{r.name}</span>
              <span className="pick-sub">
                {r.planned > 0
                  ? `${faDigits(round2(r.done))} از ${faDigits(round2(r.planned))} م²`
                  : r.done > 0 ? `${faDigits(round2(r.done))} م² بی برنامه` : "بی متراژ، بی کار"}
              </span>
            </div>
          ))}
        </div>

        {anyNoPlan && (
          <div className="notice warn">
            بعضی از اینها متراژ برنامه ندارند، پس «تکمیل شد» برایشان معنی ندارد.
            همه با یک دلیل بسته می‌شوند.
          </div>
        )}

        <div className="items-hd">چرا بسته می‌شوند؟</div>
        <div className="reason-list">
          {CLOSE_REASONS.map((r) => {
            const blocked = r.id === "completed" && anyNoPlan;
            return (
              <label key={r.id}
                className={`reason-row${reason === r.id ? " on" : ""}${blocked ? " off" : ""}`}>
                <input type="radio" name="bulkReason" disabled={blocked}
                  checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>
                  <b>{r.label}</b>
                  <small>{blocked ? "چون بعضی برنامه ندارند، ممکن نیست." : r.hint}</small>
                </span>
              </label>
            );
          })}
        </div>

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="مثلاً: پروژه‌های پیش از راه‌اندازی سامانه" />
        </label>

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit submit-warn" style={{ width: "auto", margin: 0 }}
            disabled={busy} onClick={go}>
            {busy ? "…" : `بستن ${faDigits(rows.length)} پروژه`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** بستن پروژه: می‌گوید چقدر مانده، دلیلش را می‌پرسد و می‌گذارد با کسری هم بسته شود. */
function CloseProjectDialog({ row, onClose, onDone, onPlanFromWork }) {
  const noPlan = !(row.planned > 0);
  const short = !noPlan && row.remaining > 0.01;
  const [reason, setReason] = useState(noPlan ? "incomplete_data" : short ? "short" : "completed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // کاری ثبت شده ولی برنامه‌ای نیست ⟵ می‌شود برنامه را از روی همین کار ساخت.
  const canPlanFromWork = noPlan && row.done > 0;

  async function go() {
    if (busy) return;
    setBusy(true); setErr("");
    try { await productionApi.close(row.id, { reason, note: note.trim() }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">بستن پروژهٔ «{row.name}»</div>

        {noPlan ? (
          <div className="notice warn">
            این پروژه متراژ برنامه ندارد
            {row.done > 0
              ? <> ولی <b>{faDigits(round2(row.done))} م²</b> کار رویش ثبت شده.</>
              : <> و هیچ کاری هم رویش ثبت نشده.</>}
            {" "}پس نمی‌شود گفت «تکمیل شد» — فقط با دلیل «دادهٔ ناقص» بسته می‌شود.
          </div>
        ) : (
          <div className="quote-box" style={{ marginTop: 0 }}>
            <div className="quote-row">
              <span>متراژ برنامه</span><b>{faDigits(round2(row.planned))} م²</b>
            </div>
            <div className="quote-row">
              <span>انجام شده</span><b>{faDigits(round2(row.done))} م²</b>
            </div>
            <div className="quote-row main">
              <span>{short ? "کسری" : "باقیمانده"}</span>
              <b style={short ? { color: "#B02A2A" } : undefined}>
                {faDigits(round2(row.remaining))} م²
              </b>
            </div>
          </div>
        )}

        {canPlanFromWork && (
          <div className="notice">
            می‌توانید به‌جای بستن با دادهٔ ناقص، <b>برنامه را برابر همین کارِ ثبت‌شده</b> بگذارید
            تا پروژه ۱۰۰٪ و آمارش درست شود.
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="ghost" disabled={busy}
                onClick={() => onPlanFromWork(row)}>برنامه را از روی کار بساز</button>
            </div>
          </div>
        )}
        {row.pending > 0 && (
          <div className="notice warn">
            {faDigits(round2(row.pending))} م² گزارشِ تأییدنشده دارد. اگر تأیید شود، پس از بستن
            هم در آمار می‌آید ولی روی «کسری ثبت‌شده» اثر نمی‌گذارد.
          </div>
        )}

        <div className="items-hd">چرا بسته می‌شود؟</div>
        <div className="reason-list">
          {CLOSE_REASONS.map((r) => {
            const blocked = r.id === "completed" && noPlan;
            return (
              <label key={r.id}
                className={`reason-row${reason === r.id ? " on" : ""}${blocked ? " off" : ""}`}>
                <input type="radio" name="closeReason" disabled={blocked}
                  checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>
                  <b>{r.label}</b>
                  <small>{blocked ? "برای این پروژه ممکن نیست — متراژ برنامه ندارد." : r.hint}</small>
                </span>
              </label>
            );
          })}
        </div>

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="مثلاً: مشتری ۴۰ متر را حذف کرد" />
        </label>

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className={reason === "completed" ? "submit" : "submit submit-warn"}
            style={{ width: "auto", margin: 0 }} disabled={busy} onClick={go}>
            {busy ? "…" : "بستن پروژه"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** پیش‌بینی: کارِ تازه چقدر طول می‌کشد، و پروژه‌های فعلی کی تمام می‌شوند. */
function ProdPlan() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [area, setArea] = useState("");
  const [quote, setQuote] = useState(null);
  const [qBusy, setQBusy] = useState(false);

  useEffect(() => {
    productionApi.forecasts().then(setData).catch((e) => setErr(e.message));
  }, []);

  async function ask() {
    const n = Number(area);
    if (!(n > 0) || qBusy) return;
    setQBusy(true);
    try { setQuote(await productionApi.quote(n)); }
    catch (e) { alert(e.message); } finally { setQBusy(false); }
  }

  if (err) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;

  const cap = data.capacity;
  const thin = !cap.days || cap.days < 5;

  return (
    <>
      <div className="prod-tiles">
        <Tile label="توان کارگاه" value={`${faDigits(cap.perDay)} م²/روز`} tone="ok" />
        <Tile label="صف کار فعلی" value={`${faDigits(round2(data.backlog))} م²`} tone="run" />
        <Tile label="نفرات" value={faDigits(cap.crewSize)} />
        <Tile label="سابقهٔ محاسبه" value={`${faDigits(cap.days)} روز کاری`} />
      </div>

      {thin && (
        <div className="notice warn">
          سابقهٔ گزارش‌ها هنوز کم است؛ پیش‌بینی‌ها تقریبی‌اند و هر چه گزارش بیشتر تأیید شود دقیق‌تر می‌شوند.
        </div>
      )}

      <div className="card">
        <div className="board-h">کار تازه چقدر وقت می‌گیرد؟</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          متراژ کارِ تازه را بزنید تا با توان امروز کارگاه و صفِ کارهای فعلی حساب شود.
        </div>
        <div className="row2">
          <label className="fld"><span>متراژ کار (م²)</span>
            <input type="number" inputMode="decimal" value={area} placeholder="مثلاً ۳۰۰"
              onChange={(e) => setArea(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
          </label>
          <div className="fld"><span>&nbsp;</span>
            <button className="submit" style={{ margin: 0 }} disabled={!(Number(area) > 0) || qBusy}
              onClick={ask}>{qBusy ? "…" : "حساب کن"}</button>
          </div>
        </div>
        {/* «سابقهٔ کم» جواب را حذف نمی‌کند، فقط کنارش هشدار می‌گذارد؛ نبودِ جواب را
            خودِ alone نشان می‌دهد (وقتی ظرفیت هنوز صفر است). */}
        {quote && (!quote.alone ? (
          <div className="notice warn">{quote.note || "هنوز سابقهٔ کافی برای پیش‌بینی نیست."}</div>
        ) : (
          <div className="quote-box">
            <div className="quote-row">
              <span>اگر فقط روی همین کار کنیم</span>
              <b>{faDigits(quote.alone.workingDays)} روز کاری</b>
              <small>تا {jShort(quote.alone.date)}</small>
            </div>
            <div className="quote-row main">
              <span>با احتساب صفِ {faDigits(round2(quote.queue))} متری کارهای فعلی</span>
              <b>{faDigits(quote.withQueue.workingDays)} روز کاری</b>
              <small>تا {jShort(quote.withQueue.date)}</small>
            </div>
            <div className="muted sm2">
              پایهٔ محاسبه: {faDigits(quote.perDay)} م² در روز، از {faDigits(quote.historyDays)} روز
              گزارشِ تأییدشده. تاریخ تقویمی با نسبت واقعی روزهای کاری
              ({faDigits(Math.round(quote.workingRatio * 100))}٪) حساب شده.
              {!quote.enoughHistory && " این سابقه هنوز کم است، پس عدد تقریبی است."}
            </div>
          </div>
        ))}
      </div>

      <div className="board-h">پروژه‌های در جریان</div>
      {data.results.length === 0 ? <div className="empty">پروژهٔ در جریانی نیست.</div>
        : data.results.map((f) => (
        <div className="card" key={f.projectId}>
          <div className="prod-hd">
            <div className="prod-name">
              <b>{f.projectName}</b>
              <span className="muted sm2">{faDigits(round2(f.remaining))} م² مانده</span>
            </div>
            {f.dueDate && (f.onTime
              ? <span className="pill ok">{faDigits(f.slackDays)} روز فرصت اضافه</span>
              : <span className="pill bad">{faDigits(Math.abs(f.slackDays))} روز دیرتر از قول</span>)}
          </div>
          {f.withQueue ? (
            <div className="muted sm2">
              پیش‌بینی پایان: <b>{jShort(f.withQueue.date)}</b> ({faDigits(f.withQueue.workingDays)} روز کاری)
              {f.dueDate && <> · تاریخ تحویل قول‌داده‌شده: {jShort(f.dueDate)}</>}
              {!f.dueDate && <> · تاریخ تحویل وارد نشده</>}
            </div>
          ) : <div className="muted sm2">{f.note}</div>}
        </div>
      ))}
    </>
  );
}

/** ماه شمسی → بازهٔ تاریخ میلادی، برای گزارش ماهانه. */
function jMonthRange(jy, jm) {
  const from = jToIso({ jy, jm, jd: 1 });
  const ny = jm === 12 ? jy + 1 : jy;
  const nm = jm === 12 ? 1 : jm + 1;
  const d = new Date(jToIso({ jy: ny, jm: nm, jd: 1 }) + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return { from, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}

/** عملکرد کارگاه و پرسنل در یک ماه. */
function ProdPeople() {
  const nowJ = isoToJ(todayIso());
  const [jy, setJy] = useState(nowJ.jy);
  const [jm, setJm] = useState(nowJ.jm);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const { from, to } = jMonthRange(jy, jm);
  useEffect(() => {
    setData(null);
    productionApi.people(from, to).then(setData).catch((e) => setErr(e.message));
  }, [from, to]);

  const step = (d) => {
    let y = jy, m = jm + d;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setJy(y); setJm(m); setErr("");
  };

  if (err) return <div className="notice warn">{err}</div>;

  const top = data?.people?.filter((p) => p.area > 0) || [];
  const best = top.length ? top.reduce((a, b) => (b.perHour > a.perHour ? b : a)) : null;
  const maxArea = top.length ? Math.max(...top.map((p) => p.area)) : 0;

  return (
    <>
      <div className="month-nav">
        <button className="ghost" onClick={() => step(-1)}>‹ ماه قبل</button>
        <b>{J_MONTHS[jm - 1]} {faDigits(jy)}</b>
        <button className="ghost" onClick={() => step(1)}>ماه بعد ›</button>
      </div>

      {!data ? <div className="empty">…</div> : (
        <>
          <div className="prod-tiles">
            <Tile label="متراژ ماه" value={`${faDigits(round2(data.totalArea))} م²`} tone="ok" />
            <Tile label="روز کاری" value={faDigits(data.days)} />
            <Tile label="میانگین روزانه"
              value={`${faDigits(data.days ? round2(data.totalArea / data.days) : 0)} م²`} tone="run" />
            <Tile label="نفرات فعال" value={faDigits(data.people.length)} />
          </div>

          {best && (
            <div className="notice">
              بیشترین بهره‌وری این ماه: <b>{best.name}</b> با {faDigits(best.perHour)} متر در هر
              ساعتِ کارِ متراژی ({faDigits(round2(best.area))} م² در {faDigits(best.areaHours)} ساعت).
            </div>
          )}
          {data.unattributed > 0 && (
            <div className="notice warn">
              {faDigits(round2(data.unattributed))} م² به هیچ نفری نچسبید — آن روز کسی با همان
              فعالیت روی همان پروژه ثبت نشده بود. برای اینکه عملکرد کامل باشد، فعالیت هر نفر
              باید با مرحله‌ای که متراژش ثبت می‌شود یکی باشد.
            </div>
          )}

          <div className="board-h">متراژ هر نفر</div>
          {data.people.length === 0 ? <div className="empty">این ماه گزارشی نیست.</div> : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>نفر</th><th>متراژ</th><th>سهم</th>
                    <th>ساعت متراژی</th><th>ساعت سایر</th><th>روز</th>
                    <th>متر/ساعت</th><th>متر/روز</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td><b>{faDigits(round2(p.area))}</b></td>
                      <td style={{ minWidth: 90 }}>
                        <div className="bar sm">
                          <div style={{ width: (maxArea ? (p.area / maxArea) * 100 : 0) + "%" }} />
                        </div>
                      </td>
                      <td>{faDigits(p.areaHours)}</td>
                      <td className="muted">{faDigits(p.otherHours)}</td>
                      <td>{faDigits(p.days)}</td>
                      <td>{p.areaHours ? faDigits(p.perHour) : "—"}</td>
                      <td>{faDigits(p.perDay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted sm2" style={{ marginTop: 8 }}>
                «متر/ساعت» فقط روی ساعتِ کارِ متراژی حساب می‌شود؛ ساعتِ «سایر» (خدمات کارگاه،
                نظافت و مانند آن) در مخرج نمی‌آید تا مقایسه عادلانه باشد.
              </div>
            </div>
          )}

          {Object.keys(data.byStage || {}).length > 0 && (
            <>
              <div className="board-h">متراژ به تفکیک مرحله</div>
              <div className="card">
                {Object.entries(data.byStage).map(([name, v]) => (
                  <div className="bar-row" key={name}>
                    <span className="bar-lbl">{name}</span>
                    <div className="bar">
                      <div style={{ width: (data.totalArea ? (v / data.totalArea) * 100 : 0) + "%" }} />
                    </div>
                    <span className="bar-v">{faDigits(round2(v))} م²</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className={tone ? `prod-tile ${tone}` : "prod-tile"}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** روزشمار تا تاریخ تحویل — همان چیزی که در گروه گفتگوی پروژه هم می‌آید. */
function Countdown({ due, done }) {
  if (!due) return <span className="muted sm2">تاریخ تحویل ندارد</span>;
  const today = new Date(todayIso() + "T00:00:00");
  const target = new Date(due + "T00:00:00");
  const days = Math.round((target - today) / 86400000);
  if (done) return <span className="pill ok">تحویل {jShort(due)}</span>;
  if (days < 0) return <span className="pill bad">{faDigits(-days)} روز عقب از تحویل</span>;
  if (days === 0) return <span className="pill bad">امروز تحویل است</span>;
  return <span className={days <= 7 ? "pill run" : "pill idle"}>{faDigits(days)} روز تا تحویل</span>;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ============ گفتگوی درون‌سازمانی ============ */
// دو ستون: فهرست گفتگوها در سمت راست، پنجرهٔ چت در سمت چپ. هر ۵ ثانیه پیام‌های تازه گرفته می‌شود.
function ChatView({ session, onUnread }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(null);   // "direct" یا "group"
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    try {
      const d = await chatApi.list();
      setList(d.results || []);
      if (typeof onUnread === "function") onUnread(d.unread || 0);
      setErr("");
    } catch (e) { setErr(e.message); }
  }, [onUnread]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [reload]);

  const opened = list?.find((c) => c.id === openId) || null;

  return (
    <div className="chat-shell">
      <aside className="chat-side">
        <div className="chat-side-hd">
          <b>گفتگوها</b>
          <div className="btn-row" style={{ margin: 0, gap: 6 }}>
            <button className="ghost" style={{ flex: "0 0 auto", padding: "6px 10px" }}
              onClick={() => setCreating("direct")}>+ دونفره</button>
            <button className="ghost" style={{ flex: "0 0 auto", padding: "6px 10px" }}
              onClick={() => setCreating("group")}>+ گروه</button>
          </div>
        </div>
        {err && <div className="notice warn">{err}</div>}
        {list === null ? <div className="empty">…</div>
          : list.length === 0 ? <div className="empty">هنوز گفتگویی نداری. با یکی شروع کن.</div> : (
          <ul className="chat-list">
            {list.map((c) => (
              <li key={c.id}>
                <button className={c.id === openId ? "chat-item on" : "chat-item"} onClick={() => setOpenId(c.id)}>
                  <Avatar user={c.kind === "direct" ? c.other : { name: c.title }} className="sm" />
                  <div className="chat-item-body">
                    <div className="chat-item-hd">
                      <b>{c.title}</b>
                      {c.countdown && <CountChip c={c.countdown} />}
                      {c.lastMessageAt && <small>{shortWhen(c.lastMessageAt)}</small>}
                    </div>
                    <div className="chat-item-sub">
                      <span>{c.lastMessage || (c.kind === "group" ? `${faDigits(c.members?.length || 0)} عضو` : " ")}</span>
                      {c.unread > 0 && <span className="sb-badge hot">{faDigits(c.unread)}</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="chat-pane">
        {opened ? <ChatConversation key={opened.id} conv={opened} session={session} onChanged={reload} />
          : <div className="empty">یک گفتگو را انتخاب کنید یا تازه شروع کنید.</div>}
      </section>

      {creating === "direct" && <NewDirectDialog onClose={() => setCreating(null)}
        onDone={(id) => { setCreating(null); reload(); setOpenId(id); }} />}
      {creating === "group" && <NewGroupDialog onClose={() => setCreating(null)}
        onDone={(id) => { setCreating(null); reload(); setOpenId(id); }} />}
    </div>
  );
}

/** روزشمار تحویل، کنار نام گروهِ پروژه در فهرست گفتگوها. */
function CountChip({ c }) {
  if (c.late) return <span className="chat-count late">{faDigits(-c.days)} روز عقب</span>;
  if (c.days === 0) return <span className="chat-count late">امروز تحویل</span>;
  return <span className={c.soon ? "chat-count soon" : "chat-count"}>{faDigits(c.days)} روز</span>;
}

function shortWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return faDigits(d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }));
  }
  return jShort(d.toISOString().slice(0, 10));
}

function ChatConversation({ conv, session, onChanged }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const lastId = useRef(0);

  const load = useCallback(async (fresh) => {
    try {
      const d = await chatApi.messages(conv.id, fresh ? undefined : lastId.current);
      setMessages((p) => {
        const base = fresh ? [] : (p || []);
        const seen = new Set(base.map((m) => m.id));
        const merged = [...base, ...d.results.filter((m) => !seen.has(m.id))];
        lastId.current = merged.length ? Number(merged[merged.length - 1].id) : lastId.current;
        return merged;
      });
      try { await chatApi.read(conv.id); } catch { /* بی‌مسئله */ }
      if (typeof onChanged === "function") onChanged();
    } catch (e) { setErr(e.message); }
  }, [conv.id, onChanged]);

  useEffect(() => {
    lastId.current = 0;
    setMessages(null);
    load(true);
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, [conv.id, load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function pickFile(f) {
    if (!f) { setFile(null); return; }
    if (f.size > 450 * 1024) { setErr("فایل بزرگ‌تر از ۴۵۰ کیلوبایت است."); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result); r.onerror = reject;
      r.readAsDataURL(f);
    });
    setFile({ name: f.name, kind: f.type.startsWith("image/") ? "image" : "file", data: dataUrl });
    setErr("");
  }
  async function send() {
    if (busy) return;
    if (!text.trim() && !file) return;
    setBusy(true); setErr("");
    try {
      await chatApi.send(conv.id, { text: text.trim(),
        attachment: file?.data || "", attachmentName: file?.name || "" });
      setText(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const groupHead = conv.kind === "group" ? conv.title : conv.other?.name || conv.other?.username || conv.title;

  return (
    <div className="chat-conv">
      <div className="chat-conv-hd">
        <Avatar user={conv.kind === "direct" ? conv.other : { name: conv.title }} />
        <div>
          <b>{groupHead}</b>
          <small>
            {conv.kind === "group"
              ? `${faDigits(conv.members?.length || 0)} عضو: ${conv.members?.map((m) => m.name).join("، ")}`
              : conv.other?.username ? <span dir="ltr">{conv.other.username}</span> : ""}
          </small>
        </div>
      </div>

      <div className="chat-msgs" ref={scrollRef}>
        {messages === null ? <div className="empty">…</div>
          : messages.length === 0 ? <div className="empty">هنوز پیامی نیست. اولین پیام را بنویسید.</div> : (
          messages.map((m) => {
            const mine = m.sender === session.username;
            return (
              <div key={m.id} className={mine ? "chat-msg mine" : "chat-msg"}>
                {!mine && <div className="chat-msg-from">{m.senderName}</div>}
                {m.attachment && m.attachmentKind === "image" && (
                  <a href={m.attachment} target="_blank" rel="noreferrer">
                    <img className="chat-msg-img" src={m.attachment} alt="" />
                  </a>
                )}
                {m.attachment && m.attachmentKind === "file" && (
                  <a href={m.attachment} download={m.attachmentName} className="chat-msg-file">
                    📎 {m.attachmentName || "فایل"}
                  </a>
                )}
                {m.text && <div className="chat-msg-text" dir="auto">{m.text}</div>}
                <small>{shortWhen(m.createdAt)}</small>
              </div>
            );
          })
        )}
      </div>

      {file && (
        <div className="chat-file-pin">
          {file.kind === "image" ? <img src={file.data} alt="" /> : <span>📎 {file.name}</span>}
          <button className="link-btn" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>حذف</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="chat-composer">
        <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 12px" }}
          onClick={() => fileRef.current?.click()} title="پیوست عکس یا فایل">📎</button>
        <input ref={fileRef} type="file" hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
          onChange={(e) => pickFile(e.target.files?.[0])} />
        <textarea rows={1} placeholder="پیام…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="submit" style={{ flex: "0 0 auto", width: "auto", margin: 0, padding: "10px 18px" }}
          disabled={busy || (!text.trim() && !file)} onClick={send}>{busy ? "…" : "ارسال"}</button>
      </div>
    </div>
  );
}

function NewDirectDialog({ onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { chatApi.users().then(setUsers).catch((e) => setErr(e.message)); }, []);
  const needle = q.trim().toLowerCase();
  const shown = users.filter((u) => !needle
    || (u.name || "").toLowerCase().includes(needle) || (u.username || "").toLowerCase().includes(needle));
  async function pick(u) {
    if (busy) return;
    setBusy(true);
    try { const d = await chatApi.startDirect(u.username); onDone(d.id); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">شروع گفتگو</div>
        <input className="wh-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="نام یا نام کاربری…" />
        {err && <div className="err">{err}</div>}
        <div className="pick-list" style={{ maxHeight: 320 }}>
          {shown.length === 0 ? <div className="empty">کسی پیدا نشد.</div> : shown.map((u) => (
            <button key={u.username} className="pick-row" onClick={() => pick(u)} disabled={busy}>
              <Avatar user={u} className="sm" />
              <span className="pick-name">{u.name || u.username}</span>
              <span className="pick-sub"><span dir="ltr">{u.username}</span></span>
            </button>
          ))}
        </div>
        <div className="btn-row"><button className="ghost" onClick={onClose} disabled={busy}>بستن</button></div>
      </div>
    </div>
  );
}

function NewGroupDialog({ onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { chatApi.users().then(setUsers).catch((e) => setErr(e.message)); }, []);
  const toggle = (u) => setPicked((p) => {
    const n = new Set(p); if (n.has(u)) n.delete(u); else n.add(u); return n;
  });
  async function create() {
    if (busy || !title.trim() || picked.size < 1) return;
    setBusy(true); setErr("");
    try { const d = await chatApi.startGroup(title.trim(), [...picked]); onDone(d.id); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">گروه تازه</div>
        <label className="fld"><span>عنوان گروه</span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: مالی و انبار" />
        </label>
        <div className="items-hd">عضوها ({faDigits(picked.size)} انتخاب‌شده)</div>
        {err && <div className="err">{err}</div>}
        <div className="pick-list" style={{ maxHeight: 260 }}>
          {users.map((u) => (
            <label key={u.username} className={picked.has(u.username) ? "pick-row on" : "pick-row"}
              style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(u.username)}
                onChange={() => toggle(u.username)} />
              <Avatar user={u} className="sm" />
              <span className="pick-name">{u.name || u.username}</span>
            </label>
          ))}
        </div>
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>بستن</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy || !title.trim() || picked.size < 1}
            onClick={create}>{busy ? "…" : "ساختن گروه"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============ کارتابل تعمیر و نگهداری ============ */
// اخطارها از «انبار › اموال» ساخته می‌شوند و با ثبت سرویس یا تعمیر خودکار بسته می‌شوند.
const MT_LEVEL_CLS = { high: "bad", medium: "warn", low: "info" };
const MT_GROUP = { service_overdue: "service", service_soon: "service", needs_repair: "repair", in_repair: "repair",
  inspection: "inspection", missing: "inspection", warranty_soon: "warranty" };
// کارهای هر نوع اخطار: [برچسب دکمه، نوع رخداد، وضعیت وسیله پس از کار، نمونهٔ شرح]
const MT_ACTIONS = {
  service_overdue: [["ثبت سرویس", "service", "", "مثلاً: شست‌وشو، تعویض واشر و روغن‌کاری"]],
  service_soon: [["ثبت سرویس", "service", "", "مثلاً: شست‌وشو، تعویض واشر و روغن‌کاری"]],
  needs_repair: [["فرستادن به تعمیر", "repair", "in_repair", "مثلاً: برای تعویض نازل به تعمیرگاه … فرستاده شد"],
    ["تعمیر شد", "repair", "ok", "مثلاً: نازل عوض شد و وسیله سالم است"]],
  in_repair: [["برگشت از تعمیر", "repair", "ok", "مثلاً: از تعمیرگاه برگشت؛ نازل عوض شد"],
    ["خارج از سرویس", "note", "out_of_service", "مثلاً: تعمیرش به‌صرفه نیست؛ کنار گذاشته شد"]],
  warranty_soon: [["ثبت یادداشت", "note", "", "مثلاً: وسیله بررسی شد و ایرادی ندارد"]],
  inspection: [["ثبت سرویس", "service", "", "مثلاً: سرویس کامل انجام شد"],
    ["ثبت تعمیر", "repair", "", "مثلاً: شلنگ هوا عوض شد"]],
  missing: [],
};
const daysFromToday = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayIso()}T00:00:00`)) / 86400000);
const dueText = (iso) => {
  const d = daysFromToday(iso);
  return d < 0 ? `${faDigits(-d)} روز گذشته` : d === 0 ? "امروز" : `${faDigits(d)} روز مانده`;
};
const inspLabel = (a) => (a.inspection ? faDigits(a.inspection.number) : "بازرسی");

function alertText(a) {
  const s = a.asset || {};
  if (a.status !== "open") {
    return [a.dueDate && `موعد ${jShort(a.dueDate)}`, a.inspection && inspLabel(a), a.detail].filter(Boolean).join(" · ");
  }
  switch (a.kind) {
    case "service_overdue":
    case "service_soon":
      return a.dueDate
        ? `موعد سرویس ${jShort(a.dueDate)} (${dueText(a.dueDate)}) · هر ${faDigits(s.serviceIntervalDays)} روز · آخرین سرویس: ${s.lastServiceOn ? jShort(s.lastServiceOn) : "ثبت نشده"}`
        : `دورهٔ سرویس هر ${faDigits(s.serviceIntervalDays)} روز است ولی هنوز هیچ سرویسی ثبت نشده؛ هر چه زودتر سرویس و ثبت کنید.`;
    case "needs_repair": return "وضعیت وسیله «نیاز به تعمیر» است؛ آن را برای تعمیر بفرستید یا پس از تعمیر ثبت کنید.";
    case "in_repair": return "وسیله در تعمیر است؛ وقتی برگشت، تعمیر را با هزینه ثبت کنید تا وضعیتش «سالم» شود.";
    case "warranty_soon": return `گارانتی تا ${jShort(a.dueDate)} (${dueText(a.dueDate)})؛ اگر ایرادی دارد، پیش از پایان گارانتی پیگیری کنید.`;
    case "missing": return `در ${inspLabel(a)} پیدا نشد${a.detail ? ` — ${a.detail}` : ""}. پیگیری کنید و نتیجه را بنویسید.`;
    case "inspection": return `پیشنهاد ${inspLabel(a)}: ${a.detail || "نیاز به اقدام"}`;
    default: return a.detail || "";
  }
}

function MaintenanceView({ onChanged, onSeen }) {
  const canWork = useCan()("maintenance.work");
  const [status, setStatus] = useState("open");
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // اعلان مرورگر فقط روی نشانی امن (https) کار می‌کند.
  const notifySupported = window.isSecureContext && "Notification" in window;
  const [notifyPerm, setNotifyPerm] = useState(() => (notifySupported ? Notification.permission : "unsupported"));

  const load = useCallback(async () => {
    try {
      const d = await maintenanceApi.alerts({ status });
      setData(d); setErr("");
      if (status === "open") onSeen(d.counts?.openIds);
    } catch (e) { setErr(e.message); setData((p) => p || { results: [], counts: {} }); }
  }, [status, onSeen]);
  useEffect(() => {
    setData(null); load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const done = (text) => { setMsg(text); setTimeout(() => setMsg(""), 5000); load(); onChanged(); };

  const c = data?.counts || {};
  const by = c.byKind || {};
  const needle = q.trim().toLowerCase();
  const rows = (data?.results || []).filter((a) => (!group || MT_GROUP[a.kind] === group)
    && (!needle || [a.asset?.name, a.asset?.code, a.asset?.location, a.asset?.holder]
      .some((x) => (x || "").toLowerCase().includes(needle))));

  return (
    <>
      <div className="stats">
        <div className={c.high ? "stat warn" : "stat"}><b>{faDigits(c.high ?? 0)}</b><span>اخطار فوری</span></div>
        <div className="stat"><b>{faDigits((by.service_overdue || 0) + (by.service_soon || 0))}</b><span>سرویس رسیده یا نزدیک</span></div>
        <div className="stat"><b>{faDigits((by.needs_repair || 0) + (by.in_repair || 0))}</b><span>نیاز به تعمیر یا در تعمیر</span></div>
        <div className="stat"><b>{faDigits((by.inspection || 0) + (by.missing || 0))}</b><span>پیگیری بازرسی</span></div>
      </div>

      <div className="card">
        <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
          اخطارها خودکار از «انبار › اموال» ساخته می‌شوند: سرویسی که موعدش رسیده یا تا دو هفته می‌رسد، وسیلهٔ خراب یا در تعمیر،
          گارانتی رو به پایان، و نتیجهٔ بازرسی‌ها. با ثبت سرویس یا تعمیر، اخطار خودش بسته می‌شود و کار در پروندهٔ وسیله هم می‌نشیند.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام وسیله، کد اموال، محل یا تحویل‌گیرنده…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="نوع اخطار">
            <option value="">همهٔ اخطارها</option>
            <option value="service">سرویس دوره‌ای</option>
            <option value="repair">تعمیر</option>
            <option value="inspection">بازرسی</option>
            <option value="warranty">گارانتی</option>
          </select>
        </div>
        <div className="wh-toggles">
          <label><input type="radio" checked={status === "open"} onChange={() => setStatus("open")} /> باز ({faDigits(c.open ?? 0)})</label>
          <label><input type="radio" checked={status === "done"} onChange={() => setStatus("done")} /> انجام‌شده</label>
          {notifyPerm === "default" && (
            <button className="link-btn" onClick={() => Notification.requestPermission().then(setNotifyPerm)}>
              روشن کردن اعلان مرورگر
            </button>
          )}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && !data?.results?.length ? <div className="notice warn">{err}</div>
        : data === null ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">
            {status === "open" && !group && !needle ? "کارتابل خالی است ✓ هیچ وسیله‌ای الان کاری لازم ندارد." : "اخطاری پیدا نشد."}
          </div>
        ) : (
          <ul className="mt-list">
            {rows.map((a) => <MaintenanceCard key={a.id} alert={a} canWork={canWork} onDone={done} />)}
          </ul>
        )}
    </>
  );
}

function MaintenanceCard({ alert: a, canWork, onDone }) {
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = a.asset || {};
  const open = a.status === "open";
  const actions = MT_ACTIONS[a.kind] || [];

  async function toggleHistory() {
    const show = !showHistory;
    setShowHistory(show);
    if (show && history === null) {
      try { setHistory(await maintenanceApi.history(a.id)); } catch (e) { setHistory([]); setErr(e.message); }
    }
  }
  async function submit() {
    if (busy || !form.description.trim()) return;
    setBusy(true); setErr("");
    try {
      if (form.mode === "close") {
        await maintenanceApi.close(a.id, form.description.trim());
        onDone(`اخطار «${s.name}» بسته شد ✓`);
      } else {
        await maintenanceApi.record(a.id, {
          kind: form.kind, status: form.status, date: form.date, description: form.description.trim(),
          cost: form.kind === "note" ? 0 : Number(form.cost) || 0,
        });
        onDone(`«${form.label}» برای «${s.name}» ثبت شد ✓`);
      }
      setForm(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <li className={`mt-card ${open ? a.level : "closed"}`}>
      <div className="mt-hd">
        <span className={`as-chip ${open ? MT_LEVEL_CLS[a.level] || "off" : "off"}`}>{a.kindLabel}</span>
        <div className="mt-title">
          <b>{s.name}</b>
          <small>{[s.code && `کد ${s.code}`, s.location, s.holder && `تحویل ${s.holder}`].filter(Boolean).join(" · ") || "—"}</small>
        </div>
        <AssetStatusChip status={s.status} />
      </div>
      <p className="mt-text">{alertText(a)}</p>
      {!open && (
        <p className="mt-closed">
          ✓ {a.autoClosed ? "خودکار بسته شد" : "بسته شد"}{a.closedBy ? ` · ${a.closedBy}` : ""} · {faDateTime(a.closedAt)}
          {a.closeNote && <><br />{a.closeNote}</>}
        </p>
      )}

      <div className="mt-actions">
        {open && canWork && !form && actions.map(([label, kind, st, hint], i) => (
          <button key={label} className={i === 0 ? "submit" : "ghost"}
            onClick={() => { setErr(""); setForm({ mode: "event", label, kind, status: st, hint, date: todayIso(), cost: "", description: "" }); }}>
            {label}
          </button>
        ))}
        {open && canWork && !form && a.manual && (
          <button className={actions.length ? "ghost" : "submit"}
            onClick={() => {
              setErr("");
              setForm({ mode: "close", label: "بستن اخطار", description: "",
                hint: a.kind === "missing" ? "مثلاً: پیدا شد؛ در انبار مرکزی بود" : "مثلاً: بررسی شد و کاری لازم نبود" });
            }}>
            بستن اخطار
          </button>
        )}
        <span className="mt-meta">از {faDateTime(a.createdAt)}</span>
        <button className="link-btn" onClick={toggleHistory}>{showHistory ? "بستن تاریخچه" : "تاریخچهٔ وسیله"}</button>
      </div>

      {form && (
        <div className="asset-card event-form">
          <div className="items-hd">{form.label} — {s.name}</div>
          {form.mode === "event" && (
            <>
              <div className="row2">
                <label className="fld"><span>تاریخ</span>
                  <JalaliPicker value={form.date} onChange={(v) => setForm((p) => ({ ...p, date: v }))} />
                </label>
                {form.kind !== "note" && (
                  <label className="fld"><span>هزینه (ریال)</span>
                    <input type="number" min="0" inputMode="numeric" value={form.cost}
                      onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
                  </label>
                )}
              </div>
              <label className="fld"><span>وضعیت وسیله پس از این کار</span>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="">بدون تغییر ({(ASSET_STATUS[s.status] || ASSET_STATUS.ok).label})</option>
                  {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
            </>
          )}
          <label className="fld"><span>{form.mode === "close" ? "نتیجهٔ پیگیری" : "شرح کار"}</span>
            <textarea rows={2} value={form.description} autoFocus placeholder={form.hint}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </label>
          <div className="btn-row">
            <button className="ghost" disabled={busy} onClick={() => setForm(null)}>انصراف</button>
            <button className="submit" disabled={busy || !form.description.trim()} onClick={submit}>
              {busy ? "…" : form.mode === "close" ? "بستن اخطار" : "ثبت"}
            </button>
          </div>
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}

      {showHistory && (
        history === null ? <div className="muted sm2">در حال خواندن…</div>
          : history.length === 0 ? <div className="muted sm2">هنوز رخدادی برای این وسیله ثبت نشده.</div>
          : (
            <ul className="event-list">
              {history.map((ev) => (
                <li key={ev.id}>
                  <span className={`as-chip ${ASSET_EVENT_CLS[ev.kind] || "off"}`}>{ev.kindLabel}</span>
                  <div className="event-body">
                    <div>{[ev.description, assetChangeText(ev.changes)].filter(Boolean).join(" — ") || "—"}</div>
                    <small>{jShort(ev.date)}{ev.cost ? ` · هزینه ${faRial(ev.cost)} ریال` : ""}{ev.by ? ` · ${ev.by}` : ""}</small>
                  </div>
                </li>
              ))}
            </ul>
          )
      )}
    </li>
  );
}

/* ============ ورود ============ */
function Login({ onLogin }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy || !u.trim() || !p.trim()) return;
    setBusy(true); setErr("");
    try {
      await onLogin(u.trim(), p.trim());
    } catch (e) {
      setErr(e.message || "نام کاربری یا رمز نادرست است.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app" dir="rtl">
      <style>{CSS}</style>
      <div className="login-wrap">
        <div className="login-card">
          <span className="mark big" />
          <h1>دیواژ</h1>
          <p className="sub">سامانهٔ گزارش کار روزانه</p>
          <label className="fld"><span>نام کاربری</span><input value={u} onChange={(e) => { setU(e.target.value); setErr(""); }} placeholder="نام کاربری" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          <label className="fld"><span>رمز</span><input type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(""); }} placeholder="••••" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          {err && <div className="err">{err}</div>}
          <button className="submit" disabled={busy} onClick={submit}>{busy ? "در حال ورود…" : "ورود"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============ تغییر اجباری رمز عبور ============ */
function ForcePasswordChange({ session, onChanged, onLogout }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const cur = current.trim(), nw = next.trim(), cf = confirm.trim();
    if (!cur) { setErr("لطفاً رمز فعلی را وارد کنید."); return; }
    if (nw.length < 4) { setErr("رمز جدید باید حداقل ۴ کاراکتر باشد."); return; }
    if (nw !== cf) { setErr("رمز جدید و تکرارش یکسان نیستند."); return; }
    setBusy(true); setErr("");
    try {
      const updated = await auth.changePassword(cur, nw);
      onChanged(updated);
    } catch (e) {
      setErr(e.message || "خطا در تغییر رمز.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" dir="rtl">
      <style>{CSS}</style>
      <div className="login-wrap">
        <div className="login-card">
          <span className="mark big" />
          <h1>تغییر رمز عبور</h1>
          <p className="sub">برای ادامه، لطفاً رمز خودتون رو تغییر بدید</p>
          <label className="fld"><span>رمز فعلی</span><input type="password" value={current} onChange={(e) => { setCurrent(e.target.value); setErr(""); }} placeholder="••••" /></label>
          <label className="fld"><span>رمز جدید</span><input type="password" value={next} onChange={(e) => { setNext(e.target.value); setErr(""); }} placeholder="حداقل ۴ کاراکتر" /></label>
          <label className="fld"><span>تکرار رمز جدید</span><input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(""); }} placeholder="••••" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          {err && <div className="err">{err}</div>}
          <button className="submit" disabled={busy} onClick={submit}>{busy ? "در حال ثبت…" : "ثبت رمز جدید"}</button>
          <button className="logout" style={{ marginTop: 10, width: "100%" }} onClick={onLogout}>خروج</button>
        </div>
      </div>
    </div>
  );
}

/* ============ انتخاب تاریخ شمسی ============ */
function JalaliPicker({ value, onChange, placeholder = "" }) {
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
  function openCal() { const c = isoToJ(shown); setView({ jy: c.jy, jm: c.jm }); setOpen(true); }
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
        <div className="jp-pop">
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

/* ============ ثبت گزارش ============ */
function EntryView({ session, projects, reports, employees, onCreateReport, onUpdateReport, onAddProject, onAddEmployee }) {
  // پروژهٔ بسته هم مثل غیرفعال، دیگر در فهرست انتخاب نمی‌آید؛ برای ثبت کار رویش
  // باید اول دوباره بازش کرد.
  const activeProjects = projects.filter((p) => p.active !== false && !p.closedAt);
  const activeEmployees = employees.filter((e) => e.active !== false);

  const stageList = useWorkStages();
  const activityNames = stageList.map((s) => s.name);
  const blankItem = () => ({ id: uid(), employee: "", project: activeProjects[0]?.id || "", activity: activityNames[0], hours: "", percent: "", desc: "" });
  const [date, setDate] = useState(todayIso());
  const [shift, setShift] = useState(SHIFTS[0]);
  const [items, setItems] = useState([blankItem()]);
  const [description, setDescription] = useState("");
  const [problems, setProblems] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // متراژ پیشرفت یک‌بار برای هر پروژه/مرحله ثبت می‌شود، نه به‌ازای هر نفر.
  const blankProgress = () => ({ id: uid(), project: activeProjects[0]?.id || "", stage: "", area: "", desc: "" });
  const [progress, setProgress] = useState([blankProgress()]);
  const setProg = (id, k, v) => setProgress((p) => p.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const addProgRow = () => setProgress((p) => [...p, blankProgress()]);
  const delProgRow = (id) => setProgress((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p));
  // اگر برای پروژه مرحله تعریف شده باشد، فقط همان‌ها انتخاب‌شدنی‌اند.
  const stagesFor = (projectId) => {
    const proj = projects.find((p) => p.id === projectId);
    const defined = (proj?.stages || []).map((s) => s.name);
    return defined.length ? defined : activityNames.filter((n) => n !== "سایر");
  };

  const setItem = (id, k, v) => setItems((p) => p.map((it) => (it.id === id ? { ...it, [k]: v } : it)));
  const setItemFields = (id, fields) => setItems((p) => p.map((it) => (it.id === id ? { ...it, ...fields } : it)));
  const addRow = () => setItems((p) => [...p, blankItem()]);
  const delRow = (id) => setItems((p) => (p.length > 1 ? p.filter((it) => it.id !== id) : p));

  function setHours(id, value) {
    const pct = value !== "" ? Math.round((Number(value) || 0) / WORKDAY_HOURS * 100) : "";
    setItemFields(id, { hours: value, percent: pct === "" ? "" : String(pct) });
  }

  function usedHoursFor(employeeName, excludeItemId) {
    if (!employeeName) return 0;
    let used = 0;
    reports.forEach((r) => {
      if (r.date !== date) return;
      (r.items || []).forEach((it) => { if (it.employee === employeeName) used += Number(it.hours) || 0; });
    });
    items.forEach((it) => { if (it.id !== excludeItemId && it.employee === employeeName) used += Number(it.hours) || 0; });
    return used;
  }

  const [newProjFor, setNewProjFor] = useState(null);
  const [newProjName, setNewProjName] = useState("");
  function openNewProject(id) { setNewProjFor(id); setNewProjName(""); }
  async function confirmNewProject() {
    const nm = newProjName.trim(); if (!nm) return;
    try {
      const proj = await onAddProject({ name: nm, code: "", active: true });
      setItem(newProjFor, "project", proj.id);
      setNewProjFor(null);
    } catch (e) {
      alert(e.message);
    }
  }

  const [newEmpFor, setNewEmpFor] = useState(null);
  const [newEmpName, setNewEmpName] = useState("");
  function openNewEmployee(id) { setNewEmpFor(id); setNewEmpName(""); }
  async function confirmNewEmployee() {
    const nm = newEmpName.trim(); if (!nm) return;
    try {
      const emp = await onAddEmployee({ name: nm, active: true });
      setItem(newEmpFor, "employee", emp.name);
      setNewEmpFor(null);
    } catch (e) {
      alert(e.message);
    }
  }

  const valid = items.some((it) => it.employee.trim());
  const progressValid = progress.some((r) => r.stage && Number(r.area) > 0);
  const buildItems = () => items.filter((it) => it.employee.trim()).map((it) => ({
    employee: it.employee.trim(), project: it.project || null, activity: it.activity,
    hours: Number(it.hours) || 0, percent: Number(it.percent) || 0, desc: it.desc || "",
  }));
  const buildProgress = () => progress.filter((r) => r.stage && Number(r.area) > 0).map((r) => ({
    project: r.project || null, stage: r.stage, area: Number(r.area) || 0, desc: r.desc || "",
  }));

  // شناسهٔ پیش‌نویسِ در حال ویرایش؛ تا وقتی ارسال نشده، همین گزارش به‌روزرسانی می‌شود.
  const [draftId, setDraftId] = useState(null);

  // اگر برای همین تاریخ/شیفت گزارشِ تأییدنشده‌ای از همین کاربر وجود دارد، همان بارگذاری
  // می‌شود تا با برگشتن به این تب یا عوض‌کردن تاریخ، گزارش تکراری ساخته نشود.
  const loadedKey = useRef(null);
  useEffect(() => {
    const key = `${date}|${shift}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    const existing = reports.find(
      (r) => r.date === date && r.shift === shift &&
        r.supervisor === session.username && r.status !== "approved"
    );
    if (existing) {
      setDraftId(existing.id);
      setItems((existing.items || []).length
        ? existing.items.map((it) => ({
            id: uid(), employee: it.employee, project: it.project || "", activity: it.activity,
            hours: String(it.hours ?? ""), percent: String(it.percent ?? ""), desc: it.desc || "",
          }))
        : [blankItem()]);
      setProgress((existing.progress || []).length
        ? existing.progress.map((g) => ({
            id: uid(), project: g.project || "", stage: g.stage,
            area: String(g.area ?? ""), desc: g.desc || "",
          }))
        : [blankProgress()]);
      setDescription(existing.description || "");
      setProblems(existing.problems || "");
    } else {
      setDraftId(null);
      setItems([blankItem()]);
      setProgress([blankProgress()]);
      setDescription("");
      setProblems("");
    }
  }, [date, shift, reports, session.username]);

  const currentDraft = reports.find((r) => r.id === draftId);

  function flash(text) { setMsg(text); setTimeout(() => setMsg(""), 3000); }

  /** یک بخش را ذخیره می‌کند و همان لحظه برای تأیید مدیر می‌فرستد.
   *  هر دو بخشِ یک روز/شیفت در یک گزارش جمع می‌شوند تا یکجا به مدیر برسند. */
  async function saveSection(section, label) {
    if (busy) return;
    const body = section === "items" ? { items: buildItems() } : { progress: buildProgress() };
    setBusy(true);
    try {
      let id = draftId;
      if (id) {
        await onUpdateReport(id, body);
      } else {
        const created = await onCreateReport({
          date, shift, status: "draft",
          description: description.trim(), problems: problems.trim(),
          ...body,
        });
        id = created.id;
        setDraftId(id);
      }
      // پیش‌نویس یا گزارشِ برگشت‌خورده دوباره در صف تأیید مدیر قرار می‌گیرد.
      const status = reports.find((r) => r.id === id)?.status;
      if (!status || status === "draft" || status === "revision") {
        await onUpdateReport(id, { status: "waiting" });
      }
      flash(`${label} ذخیره و برای تأیید ارسال شد ✓`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card form">
      <div className="row2">
        <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
        <label className="fld"><span>شیفت</span><select value={shift} onChange={(e) => setShift(e.target.value)}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      <div className="sup-line">سرپرست: <b>{session.name}</b></div>

      <div className="items-hd">آیتم‌های کاری</div>
      {items.map((it, idx) => {
        const used = usedHoursFor(it.employee, it.id);
        const withThis = used + (Number(it.hours) || 0);
        const remaining = WORKDAY_HOURS - withThis;
        return (
        <div className="item-row" key={it.id}>
          <div className="item-num">{faDigits(idx + 1)}</div>
          <div className="item-body">
            <div className="row2">
              <label className="fld sm"><span>پرسنل</span>
                <select value={it.employee} onChange={(e) => {
                  if (e.target.value === "__new") openNewEmployee(it.id);
                  else setItem(it.id, "employee", e.target.value);
                }}>
                  <option value="">— انتخاب کنید —</option>
                  {activeEmployees.map((emp) => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                  <option value="__new">+ کارگر جدید…</option>
                </select>
              </label>
              <label className="fld sm"><span>پروژه</span>
                <select value={it.project} onChange={(e) => {
                  if (e.target.value === "__new") openNewProject(it.id);
                  else setItem(it.id, "project", e.target.value);
                }}>
                  <option value="">— انتخاب کنید —</option>
                  {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__new">+ پروژهٔ جدید…</option>
                </select>
              </label>
            </div>
            {newEmpFor === it.id && (
              <div className="new-mat-box">
                <label className="fld sm"><span>نام کارگر جدید</span><input value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} placeholder="نام و نام خانوادگی" onKeyDown={(e) => e.key === "Enter" && confirmNewEmployee()} /></label>
                <div className="btn-row">
                  <button className="ghost" onClick={() => setNewEmpFor(null)}>انصراف</button>
                  <button className="submit" disabled={!newEmpName.trim()} onClick={confirmNewEmployee}>افزودن کارگر</button>
                </div>
              </div>
            )}
            {newProjFor === it.id && (
              <div className="new-mat-box">
                <label className="fld sm"><span>نام پروژهٔ جدید</span><input value={newProjName} onChange={(e) => setNewProjName(e.target.value)} placeholder="مثلاً: کابینت آشپزخانه" onKeyDown={(e) => e.key === "Enter" && confirmNewProject()} /></label>
                <div className="btn-row">
                  <button className="ghost" onClick={() => setNewProjFor(null)}>انصراف</button>
                  <button className="submit" disabled={!newProjName.trim()} onClick={confirmNewProject}>افزودن پروژه</button>
                </div>
              </div>
            )}
            <div className="row3">
              <label className="fld sm"><span>فعالیت</span>
                <select value={it.activity} onChange={(e) => setItem(it.id, "activity", e.target.value)}>
                  {activityNames.map((a) => <option key={a}>{a}</option>)}
                  {it.activity && !activityNames.includes(it.activity) && <option>{it.activity}</option>}
                </select>
              </label>
              <label className="fld sm"><span>ساعت</span><input type="number" inputMode="decimal" value={it.hours} onChange={(e) => setHours(it.id, e.target.value)} placeholder="۰" /></label>
              <label className="fld sm"><span>درصد زمان</span><input type="number" inputMode="numeric" value={it.percent} onChange={(e) => setItem(it.id, "percent", e.target.value)} placeholder="٪" /></label>
            </div>
            {it.employee && (
              <div className={remaining < 0 ? "hint-remaining warn" : "hint-remaining"}>
                {remaining >= 0
                  ? `زمان باقی‌ماندهٔ ${it.employee}: ${faDigits(remaining)} از ${faDigits(WORKDAY_HOURS)} ساعت`
                  : `⚠ ${faDigits(Math.abs(remaining))} ساعت بیش از ${faDigits(WORKDAY_HOURS)} ساعت روزانه`}
              </div>
            )}
            <label className="fld sm"><span>شرح (اختیاری)</span><input value={it.desc} onChange={(e) => setItem(it.id, "desc", e.target.value)} placeholder="جزئیات این آیتم" /></label>
          </div>
          {items.length > 1 && <button className="item-del" onClick={() => delRow(it.id)}>×</button>}
        </div>
        );
      })}
      <button className="add-row" onClick={addRow}>+ افزودن آیتم</button>
      <button className="section-save" disabled={!valid || busy} onClick={() => saveSection("items", "آیتم‌های کاری")}>
        ذخیرهٔ آیتم‌های کاری
      </button>

      <div className="items-hd">متراژ کار انجام‌شدهٔ امروز</div>
      <div className="muted sm2" style={{ margin: "-4px 0 10px" }}>
        متراژ هر پروژه/مرحله یک‌بار برای کل تیم ثبت می‌شود، نه برای هر نفر.
      </div>
      {progress.map((r, idx) => {
        const options = stagesFor(r.project);
        return (
          <div className="item-row" key={r.id}>
            <div className="item-num">{faDigits(idx + 1)}</div>
            <div className="item-body">
              <div className="row2">
                <label className="fld sm"><span>پروژه</span>
                  <select value={r.project} onChange={(e) => setProg(r.id, "project", e.target.value)}>
                    <option value="">— انتخاب کنید —</option>
                    {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="fld sm"><span>مرحله</span>
                  <select value={r.stage} onChange={(e) => setProg(r.id, "stage", e.target.value)}>
                    <option value="">— انتخاب کنید —</option>
                    {options.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <div className="row2">
                <label className="fld sm"><span>متراژ امروز (م²)</span>
                  <input type="number" inputMode="decimal" value={r.area} onChange={(e) => setProg(r.id, "area", e.target.value)} placeholder="۰" />
                </label>
                <label className="fld sm"><span>شرح (اختیاری)</span>
                  <input value={r.desc} onChange={(e) => setProg(r.id, "desc", e.target.value)} placeholder="توضیح" />
                </label>
              </div>
            </div>
            {progress.length > 1 && <button className="item-del" onClick={() => delProgRow(r.id)}>×</button>}
          </div>
        );
      })}
      <button className="add-row" onClick={addProgRow}>+ افزودن متراژ</button>
      <button className="section-save" disabled={!progressValid || busy} onClick={() => saveSection("progress", "متراژ")}>
        ذخیرهٔ متراژ
      </button>

      <label className="fld"><span>شرح کلی روز (اختیاری)</span><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="fld"><span>مشکلات / توقفات (اختیاری)</span><textarea rows={2} value={problems} onChange={(e) => setProblems(e.target.value)} placeholder="خرابی، کمبود مواد، انتظار…" /></label>

      {draftId && (
        <div className="draft-note">
          {currentDraft?.status === "revision"
            ? "مدیر این گزارش را برای اصلاح برگردانده است؛ پس از ویرایش، با ذخیرهٔ همان بخش دوباره برای تأیید ارسال می‌شود."
            : "این گزارش برای تأیید مدیر ارسال شده و تا پیش از تأیید قابل ویرایش است."}
        </div>
      )}
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/* ============ گزارش‌ها ============ */
const KINDS = {
  daily: { label: "کارگری و متراژ" },
  material: { label: "مصرف مواد" },
  driver: { label: "راننده" },
};

function ReportsView({
  session, reports, materialUsages, driverReports, projects, materials, employees, drivers,
  onAddFeedback, onResubmit, onUpdateReport, onDelete,
  onAddUsageFeedback, onResubmitUsage, onUpdateUsage, onDeleteUsage,
  onAddDriverFeedback, onResubmitDriver, onUpdateDriver, onDeleteDriver,
}) {
  const [fDate, setFDate] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fProject, setFProject] = useState("all");
  const [fKind, setFKind] = useState("all");

  // هر سه نوع گزارش در یک فهرست واحد و مرتب بر اساس تاریخ کنار هم می‌آیند.
  const all = useMemo(() => [
    ...reports.map((r) => ({ kind: "daily", r })),
    ...materialUsages.map((r) => ({ kind: "material", r })),
    ...driverReports.map((r) => ({ kind: "driver", r })),
  ], [reports, materialUsages, driverReports]);

  const list = useMemo(() => all
    .filter(({ kind, r }) => {
      if (fKind !== "all" && kind !== fKind) return false;
      if (fDate && r.date !== fDate) return false;
      if (fStatus !== "all" && r.status !== fStatus) return false;
      if (fProject !== "all") {
        if (kind === "daily") {
          return (r.items || []).some((it) => it.project === fProject)
            || (r.progress || []).some((g) => g.project === fProject);
        }
        if (kind === "material") return (r.items || []).some((it) => it.project === fProject);
        return false; // گزارش راننده به پروژه وابسته نیست
      }
      return true;
    })
    .sort((a, b) => (a.r.date < b.r.date ? 1 : a.r.date > b.r.date ? -1 : 0)),
    [all, fKind, fDate, fStatus, fProject]);

  const activeList = useMemo(() => list.filter((x) => x.r.status !== "approved"), [list]);
  const approvedList = useMemo(() => list.filter((x) => x.r.status === "approved"), [list]);

  function renderCard({ kind, r }) {
    if (kind === "material") {
      return <MaterialUsageCard key={`m${r.id}`} r={r} session={session} projects={projects} materials={materials}
        onAddFeedback={onAddUsageFeedback} onResubmit={onResubmitUsage} onUpdate={onUpdateUsage} onDelete={onDeleteUsage} />;
    }
    if (kind === "driver") {
      return <DriverReportCard key={`d${r.id}`} r={r} session={session} drivers={drivers}
        onAddFeedback={onAddDriverFeedback} onResubmit={onResubmitDriver} onUpdate={onUpdateDriver} onDelete={onDeleteDriver} />;
    }
    return <ReportCard key={`r${r.id}`} r={r} session={session} projects={projects} employees={employees}
      onAddFeedback={onAddFeedback} onResubmit={onResubmit} onUpdateReport={onUpdateReport} onDelete={onDelete} />;
  }

  return (
    <>
      <div className="filters">
        <select value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="all">همهٔ گزارش‌ها</option>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="all">همهٔ وضعیت‌ها</option>
          {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="all">همهٔ پروژه‌ها</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="filters" style={{ gridTemplateColumns: "1fr" }}>
        {fDate
          ? <button className="date-fil on" onClick={() => setFDate("")}>{jShort(fDate)} ✕</button>
          : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={(d) => setFDate(d)} /></div>}
      </div>
      {list.length === 0 && <div className="empty">گزارشی با این فیلترها نیست.</div>}
      {activeList.map(renderCard)}
      {approvedList.length > 0 && (
        <>
          <div className="approved-sep">گزارش‌های تأییدشده</div>
          {approvedList.map(renderCard)}
        </>
      )}
    </>
  );
}

/** پوستهٔ مشترک هر سه نوع گزارش: وضعیت، جمع‌شدن پس از تأیید، رنگ قرمز/سبز،
 *  بازخورد مدیر و دکمه‌های تأیید/اصلاح/ویرایش. */
function ReportShell({ r, session, kindLabel, title, meta, canEditOwn, onAddFeedback, onResubmit, onDelete, renderEditor, children }) {
  const st = STATUSES[r.status] || STATUSES.draft;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(r.status === "approved");
  const canReview = hasAccess(session, "reports.review");
  const canDelete = hasAccess(session, "reports.delete");
  const isApproved = r.status === "approved";
  // صاحب گزارش همیشه، و کسی که «ویرایش گزارش دیگران» را دارد، تا وقتی تأیید نشده.
  const canEditThis = canEditOwn || (hasAccess(session, "reports.edit") && !isApproved);
  const isRevision = r.status === "revision";
  const isCorrected = r.status === "waiting" && r.resubmitted;
  const hideDetails = isApproved && collapsed;
  const cardClass = ["card", "report", isRevision && "revision", isCorrected && "corrected"].filter(Boolean).join(" ");

  async function submitFeedback(withStatus) {
    if (busy) return;
    setBusy(true);
    try {
      await onAddFeedback(r.id, { text: comment.trim(), status: withStatus });
      setComment("");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function resubmit() {
    if (busy) return;
    setBusy(true);
    try {
      await onResubmit(r.id);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cardClass}>
      {isCorrected && <div className="corrected-badge">اصلاح شده · در انتظار تأیید مجدد مدیر</div>}
      <div
        className={"rep-head" + (isApproved ? " clickable" : "")}
        onClick={isApproved ? () => setCollapsed((v) => !v) : undefined}
      >
        <div>
          <div className="rep-date">{title}</div>
          <div className="rep-meta">{meta}</div>
        </div>
        <div className="rep-head-right">
          <span className="kind-chip">{kindLabel}</span>
          <span className="status-chip" style={{ color: st.color, background: st.color + "16" }}>{st.label}</span>
          {isApproved && <span className="rep-toggle">{collapsed ? "نمایش جزئیات ▾" : "بستن ▴"}</span>}
        </div>
      </div>

      {!hideDetails && (
        <>
          {children}

          {(r.feedback?.length > 0) && (
            <div className="comments">
              {r.feedback.map((c) => (<div className="cmt" key={c.id}><span className="cmt-author">{c.manager}</span><span>{c.text}</span></div>))}
            </div>
          )}

          {canReview && (
            <div className="cmt-add">
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="نظر / بازخورد…" onKeyDown={(e) => e.key === "Enter" && submitFeedback()} />
              <button onClick={() => submitFeedback()} disabled={!comment.trim() || busy}>ثبت نظر</button>
            </div>
          )}
          {(canReview || canDelete || canEditThis) && (
            <div className="rep-actions">
              {canEditOwn && isRevision && !canReview && <span className="hint">این گزارش نیاز به اصلاح دارد.</span>}
              {canReview && (
                <>
                  <button className="act ok" disabled={busy} onClick={() => submitFeedback("approved")}>تأیید</button>
                  <button className="act warn" disabled={busy} onClick={() => submitFeedback("revision")}>نیاز به اصلاح</button>
                </>
              )}
              {canEditThis && (
                <button className="act edit" disabled={busy} onClick={() => setEditing((v) => !v)}>
                  {editing ? "بستن ویرایش" : "ویرایش"}
                </button>
              )}
              {canEditOwn && isRevision && (
                <button className="act ok" disabled={busy} onClick={resubmit}>ارسال مجدد</button>
              )}
              {canDelete && (
                <button className="del" disabled={busy} onClick={() => onDelete(r.id).catch((e) => alert(e.message))}>حذف</button>
              )}
            </div>
          )}

          {editing && canEditThis && renderEditor(() => setEditing(false))}
        </>
      )}
    </div>
  );
}

function ReportCard({ r, session, projects, employees, onAddFeedback, onResubmit, onUpdateReport, onDelete }) {
  const totalH = (r.items || []).reduce((a, it) => a + (it.hours || 0), 0);
  const totalArea = (r.progress || []).reduce((a, g) => a + (g.area || 0), 0);
  const canEditOwn = r.supervisor === session.username && r.status !== "approved";

  return (
    <ReportShell
      r={r} session={session} kindLabel={KINDS.daily.label}
      title={jLong(r.date)} meta={`شیفت ${r.shift} · سرپرست: ${r.supervisorName}`}
      canEditOwn={canEditOwn} onAddFeedback={onAddFeedback} onResubmit={onResubmit} onDelete={onDelete}
      renderEditor={(close) => (
        <ReportEditor report={r} projects={projects} employees={employees}
          onSave={(body) => onUpdateReport(r.id, body)} onClose={close} />
      )}
    >
      <div className="items-table">
        {(r.items || []).map((it) => (
          <div className="it-line" key={it.id}>
            <span className="it-emp">{it.employee}</span>
            <span className="it-proj">{it.projectName}</span>
            <span className="it-act">{it.activity}</span>
            <span className="it-h">{it.hours ? faDigits(it.hours) + " ساعت" : ""}{it.percent ? " · " + faDigits(it.percent) + "٪" : ""}</span>
            {it.desc && <span className="it-desc">{it.desc}</span>}
          </div>
        ))}
      </div>
      <div className="rep-total">مجموع: {faDigits((r.items || []).length)} آیتم · {faDigits(totalH)} ساعت</div>

      {(r.progress || []).length > 0 && (
        <>
          <div className="items-table" style={{ marginTop: 8 }}>
            {r.progress.map((g) => (
              <div className="it-line" key={g.id}>
                <span className="it-proj">{g.projectName}</span>
                <span className="it-act">{g.stage}</span>
                <span className="it-h">{faDigits(g.area)} م²</span>
                {g.desc && <span className="it-desc">{g.desc}</span>}
              </div>
            ))}
          </div>
          <div className="rep-total">متراژ انجام‌شدهٔ امروز: {faDigits(totalArea)} متر مربع</div>
        </>
      )}

      {r.problems && <p className="rep-notes"><b>مشکلات:</b> {r.problems}</p>}
      {r.description && <p className="rep-notes">{r.description}</p>}
    </ReportShell>
  );
}

function MaterialUsageCard({ r, session, projects, materials, onAddFeedback, onResubmit, onUpdate, onDelete }) {
  const canEditOwn = r.recordedBy === session.username && r.status !== "approved";
  return (
    <ReportShell
      r={r} session={session} kindLabel={KINDS.material.label}
      title={jLong(r.date)} meta={`ثبت‌کننده: ${r.recordedByName}`}
      canEditOwn={canEditOwn} onAddFeedback={onAddFeedback} onResubmit={onResubmit} onDelete={onDelete}
      renderEditor={(close) => (
        <MaterialUsageEditor report={r} projects={projects} materials={materials}
          onSave={(body) => onUpdate(r.id, body)} onClose={close} />
      )}
    >
      <div className="items-table">
        {(r.items || []).map((it) => (
          <div className="it-line" key={it.id}>
            <span className="it-emp">{it.materialName}{it.materialCode ? ` (${it.materialCode})` : ""}</span>
            <span className="it-proj">{it.projectName}</span>
            <span className="it-h">{faDigits(it.quantity)}{it.unit ? " " + it.unit : ""}</span>
            {it.desc && <span className="it-desc">{it.desc}</span>}
          </div>
        ))}
      </div>
      <div className="rep-total">مجموع: {faDigits((r.items || []).length)} قلم ماده</div>
    </ReportShell>
  );
}

function DriverReportCard({ r, session, drivers, onAddFeedback, onResubmit, onUpdate, onDelete }) {
  const canEditOwn = r.recordedBy === session.username && r.status !== "approved";
  return (
    <ReportShell
      r={r} session={session} kindLabel={KINDS.driver.label}
      title={jLong(r.date)}
      meta={`راننده: ${r.driverName}${r.distanceKm ? ` · پیمایش: ${faDigits(r.distanceKm)} کیلومتر` : ""}`}
      canEditOwn={canEditOwn} onAddFeedback={onAddFeedback} onResubmit={onResubmit} onDelete={onDelete}
      renderEditor={(close) => (
        <DriverReportEditor report={r} drivers={drivers}
          onSave={(body) => onUpdate(r.id, body)} onClose={close} />
      )}
    >
      {(r.odometerStart > 0 || r.odometerEnd > 0) && (
        <p className="rep-notes"><b>کیلومتر:</b> شروع {faDigits(r.odometerStart)} · پایان {faDigits(r.odometerEnd)} · پیمایش {faDigits(r.distanceKm)}</p>
      )}
      {(r.morningScheduledTime || r.morningArrivalTime || r.morningPassengers) && (
        <p className="rep-notes"><b>سرویس صبح:</b> مقرر {r.morningScheduledTime || "—"} · رسیدن {r.morningArrivalTime || "—"} · نفرات {r.morningPassengers || "—"}</p>
      )}
      {(r.eveningScheduledTime || r.eveningArrivalTime || r.eveningPassengers) && (
        <p className="rep-notes"><b>سرویس عصر:</b> مقرر {r.eveningScheduledTime || "—"} · رسیدن {r.eveningArrivalTime || "—"} · نفرات {r.eveningPassengers || "—"}</p>
      )}
      {r.delays?.length > 0 && (
        <p className="rep-notes"><b>تأخیرات:</b> {r.delays.map((d) => `${d.period === "morning" ? "صبح" : "عصر"}: ${d.reason}`).join(" · ")}</p>
      )}
      {r.tasks?.length > 0 && (
        <div className="items-table">
          {r.tasks.map((t) => (
            <div className="it-line" key={t.id}>
              {t.time && <span className="it-h">{t.time}</span>}
              {t.destination && <span className="it-proj">{t.destination}</span>}
              {t.description && <span className="it-desc">{t.description}</span>}
            </div>
          ))}
        </div>
      )}
    </ReportShell>
  );
}

/** ویرایش گزارشِ ارسال‌شده توسط ثبت‌کننده، پیش از تأیید مدیر. */
function ReportEditor({ report, projects, employees, onSave, onClose }) {
  // پروژهٔ بسته هم مثل غیرفعال، دیگر در فهرست انتخاب نمی‌آید؛ برای ثبت کار رویش
  // باید اول دوباره بازش کرد.
  const activeProjects = projects.filter((p) => p.active !== false && !p.closedAt);
  const activeEmployees = employees.filter((e) => e.active !== false);
  const stageList = useWorkStages();
  const activityNames = stageList.map((s) => s.name);
  const [items, setItems] = useState(() => (report.items || []).map((it) => ({
    key: uid(), employee: it.employee, project: it.project || "", activity: it.activity,
    hours: String(it.hours ?? ""), percent: String(it.percent ?? ""), desc: it.desc || "",
  })));
  const [progress, setProgress] = useState(() => (report.progress || []).map((g) => ({
    key: uid(), project: g.project || "", stage: g.stage, area: String(g.area ?? ""), desc: g.desc || "",
  })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setItem = (key, k, v) => setItems((p) => p.map((r) => (r.key === key ? { ...r, [k]: v } : r)));
  const setProg = (key, k, v) => setProgress((p) => p.map((r) => (r.key === key ? { ...r, [k]: v } : r)));
  const delItem = (key) => setItems((p) => p.filter((r) => r.key !== key));
  const delProg = (key) => setProgress((p) => p.filter((r) => r.key !== key));
  const addItem = () => setItems((p) => [...p, { key: uid(), employee: "", project: activeProjects[0]?.id || "", activity: activityNames[0], hours: "", percent: "", desc: "" }]);
  const addProg = () => setProgress((p) => [...p, { key: uid(), project: "", stage: "", area: "", desc: "" }]);

  const stagesFor = (projectId) => {
    const proj = projects.find((p) => p.id === projectId);
    const defined = (proj?.stages || []).map((s) => s.name);
    return defined.length ? defined : activityNames.filter((n) => n !== "سایر");
  };

  async function save() {
    if (busy) return;
    if (!items.some((it) => it.employee.trim())) { alert("حداقل یک آیتم کاری لازم است."); return; }
    setBusy(true);
    try {
      await onSave({
        items: items.filter((it) => it.employee.trim()).map((it) => ({
          employee: it.employee.trim(), project: it.project || null, activity: it.activity,
          hours: Number(it.hours) || 0, percent: Number(it.percent) || 0, desc: it.desc || "",
        })),
        progress: progress.filter((r) => r.stage && Number(r.area) > 0).map((r) => ({
          project: r.project || null, stage: r.stage, area: Number(r.area) || 0, desc: r.desc || "",
        })),
      });
      setMsg("تغییرات ذخیره شد ✓");
      setTimeout(() => { setMsg(""); onClose(); }, 1200);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edit-box">
      <div className="items-hd">ویرایش آیتم‌های کاری</div>
      {items.map((it) => (
        <div className="item-row" key={it.key}>
          <div className="item-body">
            <div className="row2">
              <label className="fld sm"><span>پرسنل</span>
                <select value={it.employee} onChange={(e) => setItem(it.key, "employee", e.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {activeEmployees.map((emp) => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                  {it.employee && !activeEmployees.some((emp) => emp.name === it.employee) && (
                    <option value={it.employee}>{it.employee}</option>
                  )}
                </select>
              </label>
              <label className="fld sm"><span>پروژه</span>
                <select value={it.project} onChange={(e) => setItem(it.key, "project", e.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <div className="row3">
              <label className="fld sm"><span>فعالیت</span>
                <select value={it.activity} onChange={(e) => setItem(it.key, "activity", e.target.value)}>
                  {activityNames.map((a) => <option key={a}>{a}</option>)}
                  {it.activity && !activityNames.includes(it.activity) && <option>{it.activity}</option>}
                </select>
              </label>
              <label className="fld sm"><span>ساعت</span>
                <input type="number" inputMode="decimal" value={it.hours}
                  onChange={(e) => {
                    const v = e.target.value;
                    const pct = v !== "" ? String(Math.round((Number(v) || 0) / WORKDAY_HOURS * 100)) : "";
                    setItems((p) => p.map((r) => (r.key === it.key ? { ...r, hours: v, percent: pct } : r)));
                  }} />
              </label>
              <label className="fld sm"><span>درصد</span>
                <input type="number" inputMode="numeric" value={it.percent} onChange={(e) => setItem(it.key, "percent", e.target.value)} />
              </label>
            </div>
          </div>
          {items.length > 1 && <button className="item-del" onClick={() => delItem(it.key)}>×</button>}
        </div>
      ))}
      <button className="add-row" onClick={addItem}>+ افزودن آیتم</button>

      <div className="items-hd">ویرایش متراژ</div>
      {progress.length === 0 && <div className="muted sm2" style={{ marginBottom: 8 }}>متراژی ثبت نشده.</div>}
      {progress.map((g) => (
        <div className="item-row" key={g.key}>
          <div className="item-body">
            <div className="row2">
              <label className="fld sm"><span>پروژه</span>
                <select value={g.project} onChange={(e) => setProg(g.key, "project", e.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="fld sm"><span>مرحله</span>
                <select value={g.stage} onChange={(e) => setProg(g.key, "stage", e.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {stagesFor(g.project).map((s) => <option key={s} value={s}>{s}</option>)}
                  {g.stage && !stagesFor(g.project).includes(g.stage) && <option value={g.stage}>{g.stage}</option>}
                </select>
              </label>
            </div>
            <label className="fld sm"><span>متراژ (م²)</span>
              <input type="number" inputMode="decimal" value={g.area} onChange={(e) => setProg(g.key, "area", e.target.value)} />
            </label>
          </div>
          <button className="item-del" onClick={() => delProg(g.key)}>×</button>
        </div>
      ))}
      <button className="add-row" onClick={addProg}>+ افزودن متراژ</button>

      <div className="btn-row">
        <button className="ghost" onClick={onClose}>انصراف</button>
        <button className="submit" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}</button>
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/** ویرایش گزارش مصرف مواد پیش از تأیید مدیر. */
function MaterialUsageEditor({ report, projects, onSave, onClose }) {
  const [rows, setRows] = useState(() => {
    const lines = (report.items || []).map(usageLineFromItem);
    return lines.length ? lines : [blankUsageLine()];
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const addRow = () => setRows((p) => [...p, blankUsageLine()]);

  async function save() {
    if (busy) return;
    const ready = rows.filter(usageLineReady);
    if (!ready.length) { alert("حداقل یک ردیف کامل لازم است."); return; }
    setBusy(true);
    try {
      await onSave({ items: ready.map(usageLinePayload) });
      setMsg("تغییرات ذخیره شد ✓");
      setTimeout(() => { setMsg(""); onClose(); }, 1200);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edit-box">
      <div className="items-hd">ویرایش مواد مصرفی</div>
      <UsageLines rows={rows} setRows={setRows} projects={projects} />
      <button className="add-row" onClick={addRow}>+ افزودن ماده</button>

      <div className="btn-row">
        <button className="ghost" onClick={onClose}>انصراف</button>
        <button className="submit" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}</button>
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/** ویرایش گزارش راننده پیش از تأیید مدیر. */
function DriverReportEditor({ report, drivers, onSave, onClose }) {
  const activeDrivers = drivers.filter((d) => d.active !== false);
  const [driver, setDriver] = useState(report.driver || "");
  const [odoStart, setOdoStart] = useState(String(report.odometerStart ?? ""));
  const [odoEnd, setOdoEnd] = useState(String(report.odometerEnd ?? ""));
  const [morning, setMorning] = useState({
    scheduled: report.morningScheduledTime || "", arrival: report.morningArrivalTime || "", passengers: report.morningPassengers || "",
  });
  const [evening, setEvening] = useState({
    scheduled: report.eveningScheduledTime || "", arrival: report.eveningArrivalTime || "", passengers: report.eveningPassengers || "",
  });
  const [delays, setDelays] = useState(() => (report.delays || []).map((d) => ({ key: uid(), period: d.period, reason: d.reason })));
  const [tasks, setTasks] = useState(() => (report.tasks || []).map((t) => ({
    key: uid(), time: t.time || "", destination: t.destination || "", description: t.description || "",
  })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setDelay = (key, k, v) => setDelays((p) => p.map((d) => (d.key === key ? { ...d, [k]: v } : d)));
  const delDelay = (key) => setDelays((p) => p.filter((d) => d.key !== key));
  const addDelay = () => setDelays((p) => [...p, { key: uid(), period: "morning", reason: "" }]);
  const setTask = (key, k, v) => setTasks((p) => p.map((t) => (t.key === key ? { ...t, [k]: v } : t)));
  const delTask = (key) => setTasks((p) => p.filter((t) => t.key !== key));
  const addTask = () => setTasks((p) => [...p, { key: uid(), time: "", destination: "", description: "" }]);

  const dist = odoStart !== "" && odoEnd !== "" ? Number(odoEnd) - Number(odoStart) : null;
  const odoInvalid = dist !== null && dist < 0;

  async function save() {
    if (busy) return;
    if (!driver) { alert("راننده را انتخاب کنید."); return; }
    if (odoInvalid) { alert("کیلومتر پایان نمی‌تواند از کیلومتر شروع کمتر باشد."); return; }
    setBusy(true);
    try {
      await onSave({
        driver,
        morningScheduledTime: morning.scheduled.trim(), morningArrivalTime: morning.arrival.trim(), morningPassengers: morning.passengers.trim(),
        eveningScheduledTime: evening.scheduled.trim(), eveningArrivalTime: evening.arrival.trim(), eveningPassengers: evening.passengers.trim(),
        odometerStart: Number(odoStart) || 0, odometerEnd: Number(odoEnd) || 0,
        delays: delays.filter((d) => d.reason.trim()).map((d) => ({ period: d.period, reason: d.reason.trim() })),
        tasks: tasks.filter((t) => t.destination.trim() || t.description.trim()).map((t) => ({
          time: t.time.trim(), destination: t.destination.trim(), description: t.description.trim(),
        })),
      });
      setMsg("تغییرات ذخیره شد ✓");
      setTimeout(() => { setMsg(""); onClose(); }, 1200);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edit-box">
      <label className="fld sm"><span>راننده</span>
        <select value={driver} onChange={(e) => setDriver(e.target.value)}>
          <option value="">— انتخاب کنید —</option>
          {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>

      <div className="items-hd">کیلومتر خودرو</div>
      <div className="row2">
        <label className="fld sm"><span>کیلومتر شروع</span><input type="number" inputMode="decimal" value={odoStart} onChange={(e) => setOdoStart(e.target.value)} /></label>
        <label className="fld sm"><span>کیلومتر پایان</span><input type="number" inputMode="decimal" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} /></label>
      </div>
      {dist !== null && (
        <div className={odoInvalid ? "hint-remaining warn" : "hint-remaining"}>
          {odoInvalid ? "⚠ کیلومتر پایان نمی‌تواند از کیلومتر شروع کمتر باشد." : `پیمایش: ${faDigits(dist)} کیلومتر`}
        </div>
      )}

      <div className="items-hd">سرویس صبح</div>
      <div className="row3">
        <label className="fld sm"><span>ساعت مقرر</span><input value={morning.scheduled} onChange={(e) => setMorning((p) => ({ ...p, scheduled: e.target.value }))} /></label>
        <label className="fld sm"><span>ساعت رسیدن</span><input value={morning.arrival} onChange={(e) => setMorning((p) => ({ ...p, arrival: e.target.value }))} /></label>
        <label className="fld sm"><span>تعداد/نفرات</span><input value={morning.passengers} onChange={(e) => setMorning((p) => ({ ...p, passengers: e.target.value }))} /></label>
      </div>

      <div className="items-hd">سرویس عصر</div>
      <div className="row3">
        <label className="fld sm"><span>ساعت مقرر</span><input value={evening.scheduled} onChange={(e) => setEvening((p) => ({ ...p, scheduled: e.target.value }))} /></label>
        <label className="fld sm"><span>ساعت رسیدن</span><input value={evening.arrival} onChange={(e) => setEvening((p) => ({ ...p, arrival: e.target.value }))} /></label>
        <label className="fld sm"><span>تعداد/نفرات</span><input value={evening.passengers} onChange={(e) => setEvening((p) => ({ ...p, passengers: e.target.value }))} /></label>
      </div>

      <div className="items-hd">تأخیرات</div>
      {delays.length === 0 && <div className="muted sm2" style={{ marginBottom: 8 }}>تأخیری ثبت نشده.</div>}
      {delays.map((d) => (
        <div className="item-row" key={d.key}>
          <div className="item-body">
            <div className="row2">
              <label className="fld sm"><span>نوبت</span>
                <select value={d.period} onChange={(e) => setDelay(d.key, "period", e.target.value)}>
                  <option value="morning">صبح</option>
                  <option value="evening">عصر</option>
                </select>
              </label>
              <label className="fld sm"><span>علت</span><input value={d.reason} onChange={(e) => setDelay(d.key, "reason", e.target.value)} /></label>
            </div>
          </div>
          <button className="item-del" onClick={() => delDelay(d.key)}>×</button>
        </div>
      ))}
      <button className="add-row" onClick={addDelay}>+ افزودن تأخیر</button>

      <div className="items-hd">سرویس‌ها و کارهای داخل روز</div>
      {tasks.length === 0 && <div className="muted sm2" style={{ marginBottom: 8 }}>کاری ثبت نشده.</div>}
      {tasks.map((t) => (
        <div className="item-row" key={t.key}>
          <div className="item-body">
            <div className="row2">
              <label className="fld sm"><span>ساعت</span><input value={t.time} onChange={(e) => setTask(t.key, "time", e.target.value)} /></label>
              <label className="fld sm"><span>مقصد / موضوع</span><input value={t.destination} onChange={(e) => setTask(t.key, "destination", e.target.value)} /></label>
            </div>
            <label className="fld sm"><span>شرح کار</span><input value={t.description} onChange={(e) => setTask(t.key, "description", e.target.value)} /></label>
          </div>
          <button className="item-del" onClick={() => delTask(t.key)}>×</button>
        </div>
      ))}
      <button className="add-row" onClick={addTask}>+ افزودن سرویس/کار</button>

      <div className="btn-row">
        <button className="ghost" onClick={onClose}>انصراف</button>
        <button className="submit" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}</button>
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/* ============ کارتابل مالی ============ */
const FIN_STATUS = {
  pending: "در کارتابل مالی",
  returned: "برگشت به انبار",
  approved: "تأیید مالی",
};
const fmtRial = (n) => (n == null || n === "" || Number.isNaN(Number(n))
  ? "—" : faDigits(Math.round(Number(n)).toLocaleString("en-US")));

/* ---- گزارش‌های مالی ---- */
const faRial = (n) => faDigits(Math.round(n || 0).toLocaleString("en-US"));

function FinanceReportsView() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState("top");
  const [q, setQ] = useState("");
  const canRefresh = useCan()("financereports.refresh");

  const load = useCallback(async () => {
    try { setD(await financeReportsApi.stockValue()); setErr(""); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await financeReportsApi.refreshPrices();
      setMsg(`قیمت‌ها از سایت خوانده شد ✓ — ${faDigits(r.updated)} قیمت تغییر کرد`);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err && !d) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">در حال محاسبهٔ ارزش موجودی…</div>;

  const c = d.counts;
  const last = d.sync?.lastOk;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (r) => words.every((w) => `${r.name} ${r.code} ${r.brand} ${r.sitePack?.name || ""}`.toLowerCase().includes(w));
  const list = (view === "unpriced" ? d.unpriced : view === "all" ? d.priced : d.priced.slice(0, 30)).filter(match);

  return (
    <>
      <div className="card">
        <div className="items-hd">ارزش ریالی موجودی انبار</div>
        <div className="muted sm2" style={{ lineHeight: 2 }}>
          مقدار هر کالا از انبار × قیمت خرده‌فروشی همان کالا در سایت فروش. کالایی که قیمتش در سایت تعیین نشده
          (۱ ریال) یا به سایت وصل نیست در جمع نمی‌آید و جدا فهرست شده است.
        </div>
        <div className="muted sm2" style={{ marginTop: 6 }}>
          {last
            ? <>قیمت‌ها از سایت: {new Date(last.at).toLocaleString("fa-IR")}{last.by ? ` · ${last.by}` : ""}</>
            : "قیمت‌ها هنوز از سایت خوانده نشده‌اند."}
          {d.sync?.lastError && <span className="wh-flag haz" style={{ marginRight: 8 }}>آخرین تلاش ناموفق: {d.sync.lastError.message}</span>}
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", alignItems: "center" }}>
          {canRefresh && (
            <button className="ghost" style={{ flex: "0 0 auto", padding: "10px 16px" }} disabled={busy || !d.tokenConfigured} onClick={refresh}
              title={d.tokenConfigured ? "" : "کلید اتصال به سایت هنوز تنظیم نشده"}>
              {busy ? "در حال خواندن از سایت…" : "به‌روزرسانی قیمت از سایت"}
            </button>
          )}
          {!d.tokenConfigured && <span className="muted sm2">کلید اتصال به سایت هنوز تنظیم نشده؛ قیمت‌ها از آخرین خواندن‌اند.</span>}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{faRial(d.total)}</b><span>ریال ({faRial(d.total / 10)} تومان)</span></div>
        <div className="stat"><b>{faDigits(c.priced)}</b><span>کالای قیمت‌دار از {faDigits(c.inStock)} موجود</span></div>
        <div className={c.noPrice ? "stat warn" : "stat"}><b>{faDigits(c.noPrice)}</b><span>بی قیمت در سایت</span></div>
        <div className={c.noLink ? "stat warn" : "stat"}><b>{faDigits(c.noLink)}</b><span>وصل‌نشده به سایت</span></div>
      </div>

      <div className="card">
        <div className="items-hd">به تفکیک انبار</div>
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead><tr><th>انبار</th><th>ارزش (ریال)</th><th>کالای موجود</th><th>بی قیمت</th></tr></thead>
            <tbody>
              {d.byWarehouse.map((w) => (
                <tr key={w.warehouse}><td>{w.warehouse}</td><td className="wh-qty">{faRial(w.value)}</td>
                  <td>{faDigits(w.items)}</td><td>{w.unpriced ? faDigits(w.unpriced) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="items-hd" style={{ marginTop: 12 }}>به تفکیک برند</div>
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead><tr><th>برند</th><th>ارزش (ریال)</th><th>سهم</th><th>کالای موجود</th><th>بی قیمت</th></tr></thead>
            <tbody>
              {d.byBrand.map((b) => (
                <tr key={b.brand}><td>{b.brand}</td><td className="wh-qty">{faRial(b.value)}</td>
                  <td>{d.total ? faDigits(Math.round((100 * b.value) / d.total)) + "٪" : "—"}</td>
                  <td>{faDigits(b.items)}</td><td>{b.unpriced ? faDigits(b.unpriced) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="wh-toggles" style={{ marginTop: 0 }}>
          {[["top", "پرارزش‌ترین ۳۰ کالا"], ["all", "همهٔ کالاهای قیمت‌دار"], ["unpriced", `بی قیمت و وصل‌نشده (${faDigits(d.unpriced.length)})`]].map(([k, l]) => (
            <label key={k}><input type="radio" checked={view === k} onChange={() => setView(k)} /> {l}</label>
          ))}
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو: نام، کد یا برند…" />
      </div>
      {list.length === 0 ? <div className="empty">چیزی پیدا نشد.</div> : (
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead>
              <tr><th>کالا</th><th>کد</th><th>موجودی</th>
                {view === "unpriced" ? <th>دلیل</th> : <><th>قیمت هر واحد (ریال)</th><th>ارزش (ریال)</th></>}</tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="wh-name">
                    <span dir="auto">{r.name}</span>
                    <div className="wh-sub">
                      <span>{r.brand}</span>
                      {r.sitePack && <span dir="auto">سایت: {r.sitePack.name} {r.sitePack.size} {r.sitePack.shade} · {r.sitePack.pack}</span>}
                    </div>
                  </td>
                  <td dir="ltr">{r.code}</td>
                  <td className="wh-qty">{faDigits(r.qty)} {r.baseUnit}
                    {Object.keys(r.byWarehouse).length > 1 && (
                      <div className="wh-sub"><span>{Object.entries(r.byWarehouse).map(([w, v]) => `${w}: ${faDigits(v)}`).join(" · ")}</span></div>
                    )}
                  </td>
                  {view === "unpriced"
                    ? <td><span className="wh-flag haz">{r.reason}</span></td>
                    : <><td className="wh-qty">{faRial(r.price)}</td><td className="wh-qty"><b>{faRial(r.value)}</b></td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.negatives.length > 0 && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          {faDigits(d.negatives.length)} کالا در یک انبار موجودی منفی دارد و در ارزش نیامده:{" "}
          {d.negatives.slice(0, 5).map((n) => n.name).join("، ")}
        </div>
      )}
    </>
  );
}

function FinanceView() {
  const [status, setStatus] = useState("pending");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], count: 0, totals: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState(null);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [status, kind, qDebounced]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await financeApi.vouchers({ status, kind, q: qDebounced, page }));
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [status, kind, qDebounced, page]);
  useEffect(() => { reload(); }, [reload]);

  const totals = data.totals || {};
  const rows = data.results || [];
  const pageCount = Math.max(1, Math.ceil((data.count || 0) / 50));

  return (
    <>
      <div className="stats">
        <div className={totals.pending ? "stat warn" : "stat"}><b>{faDigits(totals.pending ?? 0)}</b><span>در کارتابل</span></div>
        <div className="stat"><b>{faDigits(totals.returned ?? 0)}</b><span>برگشت به انبار</span></div>
        <div className="stat"><b>{faDigits(totals.approved ?? 0)}</b><span>تأیید مالی</span></div>
      </div>

      <div className="card">
        <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
          حواله‌های خرید و مرجوعی پس از ورود به انبار، و حواله‌های فروش پس از ثبت نهایی انبار اینجا می‌آیند.
          قیمت‌ها و فاکتور طرف حساب را وارد کنید؛ مغایرت مقدار و مبلغ خودکار نشان داده می‌شود. سپس تأیید کنید یا با دلیل به انبار برگردانید.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: شمارهٔ حواله، طرف حساب یا شمارهٔ فاکتور…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">همهٔ انواع</option>
            <option value="receipt">ورود کالا (خرید)</option>
            <option value="return">مرجوعی از مشتری</option>
            <option value="sale">فروش</option>
          </select>
        </div>
        <div className="wh-toggles">
          <label><input type="radio" checked={status === "pending"} onChange={() => setStatus("pending")} /> در کارتابل</label>
          <label><input type="radio" checked={status === "returned"} onChange={() => setStatus("returned")} /> برگشت به انبار</label>
          <label><input type="radio" checked={status === "approved"} onChange={() => setStatus("approved")} /> تأیید مالی</label>
          <label><input type="radio" checked={status === "all"} onChange={() => setStatus("all")} /> همه</label>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && !rows.length ? <div className="notice warn">{err}</div>
        : loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">{status === "pending" ? "کارتابل خالی است ✓" : "حواله‌ای پیدا نشد."}</div>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="print-table wh-table">
                <thead>
                  <tr><th>شماره</th><th>تاریخ</th><th>نوع</th><th>طرف حساب</th><th>فاکتور</th>
                    <th>اقلام</th><th>مبلغ</th><th>مغایرت</th><th>وضعیت</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((v) => {
                    const sm = v.summary || {};
                    const amount = v.invoiceTotal ?? (sm.unpriced ? null : sm.expectedTotal);
                    return (
                      <tr key={v.id}>
                        <td className="vc-num">{v.number}</td>
                        <td>{jShort(v.date)}</td>
                        <td>
                          <span className={v.isInbound ? "vc-dir in" : "vc-dir out"}>{v.isInbound ? "ورود" : "خروج"}</span>{" "}
                          {v.movementKindLabel}
                        </td>
                        <td>{v.counterparty || "—"}</td>
                        <td>{v.invoiceNo || v.ref || <span className="muted">—</span>}</td>
                        <td>{faDigits(v.lines.length)}</td>
                        <td className="num">{fmtRial(amount)}</td>
                        <td>
                          {sm.unpriced ? <span className="wh-flag">بی‌قیمت: {faDigits(sm.unpriced)}</span>
                            : sm.hasDiscrepancy ? <span className="wh-flag haz">دارد</span>
                            : <span className="wh-flag">ندارد</span>}
                        </td>
                        <td><span className={`status-chip fin-${v.financeStatus}`}>{FIN_STATUS[v.financeStatus]}</span></td>
                        <td className="wh-actions">
                          <button className="act edit" onClick={() => setOpenId(v.id)}>
                            {v.financeStatus === "pending" ? "بررسی" : "مشاهده"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="wh-pager">
                <button className="ghost" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>قبلی</button>
                <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)}</span>
                <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((x) => x + 1)}>بعدی</button>
              </div>
            )}
          </>
        )}

      {openId && (
        <FinanceVoucherDialog id={openId} onClose={() => { setOpenId(null); reload(); }}
          onDone={async (text) => { setOpenId(null); flash(text); await reload(); }} />
      )}
    </>
  );
}

/** بررسی مالی یک حواله: فاکتور طرف حساب، قیمت‌ها و مغایرت. */
function FinanceVoucherDialog({ id, onClose, onDone }) {
  const [v, setV] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const seed = (d) => {
    setV(d);
    setForm({
      invoiceNo: d.invoiceNo || "", invoiceDate: d.invoiceDate || "",
      invoiceTotal: d.invoiceTotal ?? "", invoiceDiscount: d.invoiceDiscount || "",
      invoiceTax: d.invoiceTax || "", financeNote: d.financeNote || "",
      lines: d.lines.map((l) => ({
        id: l.id, invoiceQty: l.invoiceQty ?? "", unitCost: l.unitCost || "", unitPrice: l.unitPrice || "",
      })),
    });
  };
  useEffect(() => { financeApi.voucher(id).then(seed).catch((e) => setErr(e.message)); }, [id]);
  const canApprove = useCan()("finance.approve");

  if (!v || !form) {
    return (
      <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wh-dialog">{err ? <div className="err">{err}</div> : <div className="empty">در حال بارگذاری…</div>}</div>
      </div>
    );
  }

  const locked = v.financeStatus === "approved";
  const pending = v.financeStatus === "pending";
  const basis = v.summary.priceBasis;   // «cost»: خرید؛ «sale»: فروش و مرجوعی
  const setF = (k, val) => setForm((p) => ({ ...p, [k]: val }));
  const setLine = (i, k, val) => setForm((p) => ({
    ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: val } : l)),
  }));
  const num = (x) => (x === "" || x == null ? null : Number(x));

  // محاسبهٔ زنده، با همان قاعدهٔ سرور
  let invValue = 0;
  let unpriced = 0;
  const qtyMismatch = [];
  v.lines.forEach((l, i) => {
    const f = form.lines[i];
    const invQty = num(f.invoiceQty) ?? l.qty;
    const price = num(basis === "cost" ? f.unitCost : f.unitPrice) || 0;
    if (!price) unpriced += 1;
    invValue += invQty * price;
    if (invQty !== l.qty) qtyMismatch.push({ name: l.productName, wh: l.qty, inv: invQty, unit: l.unit });
  });
  const expected = invValue - (num(form.invoiceDiscount) || 0) + (num(form.invoiceTax) || 0);
  const total = num(form.invoiceTotal);
  const totalDiff = total == null ? null : total - expected;
  const totalMismatch = totalDiff != null && Math.abs(totalDiff) >= 1;
  const hasDiscrepancy = qtyMismatch.length > 0 || totalMismatch;
  const ready = Boolean(form.invoiceNo.trim()) && unpriced === 0;

  const payload = () => ({
    invoiceNo: form.invoiceNo.trim(),
    invoiceDate: form.invoiceDate || null,
    invoiceTotal: form.invoiceTotal === "" ? null : Number(form.invoiceTotal),
    invoiceDiscount: Number(form.invoiceDiscount) || 0,
    invoiceTax: Number(form.invoiceTax) || 0,
    financeNote: form.financeNote.trim(),
    lines: form.lines.map((f) => ({
      id: f.id,
      invoiceQty: f.invoiceQty === "" ? null : Number(f.invoiceQty),
      unitCost: Number(f.unitCost) || 0,
      unitPrice: Number(f.unitPrice) || 0,
    })),
  });

  async function run(action) {
    if (busy) return;
    if (action === "back" && !form.financeNote.trim()) {
      setErr("دلیل برگشت را در یادداشت مالی بنویسید تا انبار بداند چه چیزی را بررسی کند.");
      return;
    }
    setBusy(true); setErr(""); setOk("");
    try {
      if (action === "save") {
        seed(await financeApi.save(v.id, payload()));
        setOk("ذخیره شد ✓");
      } else if (action === "approve") {
        await financeApi.approve(v.id, payload());
        onDone(`حوالهٔ ${v.number} تأیید مالی شد ✓`);
      } else if (action === "reclaim") {
        await financeApi.reclaim(v.id, payload());
        onDone(`حوالهٔ ${v.number} به کارتابل مالی برگشت`);
      } else {
        await financeApi.sendBack(v.id, payload());
        onDone(`حوالهٔ ${v.number} با یادداشت به انبار برگشت`);
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const moneyInput = (value, onChange) => (
    <input type="number" min="0" disabled={locked} value={value} onChange={(e) => onChange(e.target.value)} />
  );

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide fin-dialog">
        <div className="board-h">{v.movementKindLabel} — حوالهٔ {v.number}</div>
        <div className="fin-head">
          <div><span>تاریخ حواله</span><b>{jShort(v.date)}</b></div>
          <div><span>انبار</span><b>{v.warehouseName}</b></div>
          <div><span>طرف حساب</span><b>{v.counterparty || "—"}</b></div>
          <div><span>شمارهٔ فاکتور (از انبار)</span><b>{v.ref || "—"}</b></div>
          <div><span>ثبت‌کنندهٔ انبار</span><b>{v.createdBy || "—"}</b></div>
          <div><span>وضعیت</span><b>{FIN_STATUS[v.financeStatus]}</b></div>
        </div>
        {v.note && <div className="muted sm2" style={{ marginBottom: 6 }}>یادداشت انبار: {v.note}</div>}
        {v.warehouseReply && <div className="notice">پاسخ انبار به برگشت قبلی: {v.warehouseReply}</div>}
        {locked && <div className="notice">تأیید مالی شده توسط {v.financeBy || "—"}.</div>}
        {v.financeStatus === "returned" && (
          <div className="notice warn">
            این حواله به انبار برگشته و منتظر پاسخ انبار است.
            {canApprove && (
              <> اگر انبار امکان اصلاح ندارد یا اشتباه برگردانده شد، می‌توانید با «بازپس‌گیری از انبار»
              حواله را به کارتابل مالی برگردانید و خودتان با یادداشت مغایرت تأیید کنید.</>
            )}
          </div>
        )}

        <div className="items-hd">فاکتور طرف حساب</div>
        <div className="row3">
          <label className="fld sm"><span>شمارهٔ فاکتور</span>
            <input disabled={locked} value={form.invoiceNo} onChange={(e) => setF("invoiceNo", e.target.value)} />
          </label>
          <div className="fld sm"><span>تاریخ فاکتور</span>
            {locked
              ? <input disabled value={form.invoiceDate ? jShort(form.invoiceDate) : "—"} />
              : <JalaliPicker value={form.invoiceDate} placeholder="— تعیین نشده —" onChange={(d) => setF("invoiceDate", d)} />}
          </div>
          <label className="fld sm"><span>جمع کل فاکتور (ریال)</span>
            {moneyInput(form.invoiceTotal, (x) => setF("invoiceTotal", x))}
          </label>
        </div>
        <div className="row2">
          <label className="fld sm"><span>تخفیف فاکتور (ریال)</span>{moneyInput(form.invoiceDiscount, (x) => setF("invoiceDiscount", x))}</label>
          <label className="fld sm"><span>مالیات و عوارض (ریال)</span>{moneyInput(form.invoiceTax, (x) => setF("invoiceTax", x))}</label>
        </div>

        <div className="items-hd">اقلام — مقدار انبار در برابر فاکتور</div>
        <div className="tbl-scroll">
          <table className="print-table fin-lines">
            <thead>
              <tr>
                <th>کالا</th><th>واحد</th><th>مقدار انبار</th><th>مقدار فاکتور</th>
                <th>{basis === "cost" ? "قیمت خرید (فی) *" : "قیمت خرید"}</th>
                <th>{basis === "sale" ? "قیمت فروش (فی) *" : "قیمت فروش"}</th>
                <th>جمع ردیف</th>
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l, i) => {
                const f = form.lines[i];
                const invQty = num(f.invoiceQty) ?? l.qty;
                const price = num(basis === "cost" ? f.unitCost : f.unitPrice) || 0;
                return (
                  <tr key={l.id} className={invQty !== l.qty ? "fin-mismatch" : ""}>
                    <td className="wh-name">
                      {l.productName}
                      <div className="wh-sub">{l.code && <span>کد {l.code}</span>}{l.packSize && <span>{l.packSize}</span>}</div>
                    </td>
                    <td>{l.unit}</td>
                    <td className="num">{faDigits(l.qty)}</td>
                    <td>
                      <input className="wh-cell" type="number" min="0" disabled={locked} placeholder={String(l.qty)}
                        value={f.invoiceQty} onChange={(e) => setLine(i, "invoiceQty", e.target.value)} />
                    </td>
                    <td>
                      <input className="wh-cell wide" type="number" min="0" disabled={locked}
                        value={f.unitCost} onChange={(e) => setLine(i, "unitCost", e.target.value)} />
                      {l.lastCost ? <div className="wh-sub"><span>قیمت فعلی کالا: {fmtRial(l.lastCost)}{l.baseUnit ? ` / ${l.baseUnit}` : ""}</span></div> : null}
                    </td>
                    <td>
                      <input className="wh-cell wide" type="number" min="0" disabled={locked}
                        value={f.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
                      {l.lastSalePrice ? <div className="wh-sub"><span>قیمت فعلی کالا: {fmtRial(l.lastSalePrice)}{l.baseUnit ? ` / ${l.baseUnit}` : ""}</span></div> : null}
                    </td>
                    <td className="num">{price ? fmtRial(invQty * price) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={totalMismatch ? "fin-summary warn" : "fin-summary"}>
          <div><span>جمع ردیف‌ها (با مقدار فاکتور)</span><b>{fmtRial(invValue)}</b></div>
          <div><span>پس از تخفیف و مالیات</span><b>{fmtRial(expected)}</b></div>
          <div><span>جمع کل فاکتور</span><b>{total == null ? "—" : fmtRial(total)}</b></div>
          <div><span>اختلاف</span><b>{totalDiff == null ? "—" : totalMismatch ? fmtRial(totalDiff) : "ندارد ✓"}</b></div>
        </div>
        {(qtyMismatch.length > 0 || unpriced > 0) && (
          <ul className="merge-notes">
            {unpriced > 0 && <li>{faDigits(unpriced)} قلم هنوز {basis === "cost" ? "قیمت خرید" : "قیمت فروش"} ندارد.</li>}
            {qtyMismatch.map((m) => (
              <li key={m.name} className="fin-warn-li">«{m.name}»: انبار {faDigits(m.wh)} ولی فاکتور {faDigits(m.inv)} {m.unit}</li>
            ))}
          </ul>
        )}

        <label className="fld">
          <span>{hasDiscrepancy && pending ? "یادداشت مالی — توضیح مغایرت (برای تأیید با مغایرت لازم است)" : "یادداشت مالی"}</span>
          <textarea rows={2} disabled={locked} value={form.financeNote} onChange={(e) => setF("financeNote", e.target.value)}
            placeholder={pending ? "توضیح مغایرت، یا دلیل برگشت به انبار" : ""} />
        </label>

        {err && <div className="err">{err}</div>}
        {ok && <div className="ok-msg">{ok}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>بستن</button>
          {!locked && canApprove && <button className="ghost" disabled={busy} onClick={() => run("save")}>ذخیره</button>}
          {v.financeStatus === "returned" && canApprove && (
            <button className="ghost" disabled={busy} onClick={() => run("reclaim")}>بازپس‌گیری از انبار</button>
          )}
          {pending && canApprove && <button className="ghost" disabled={busy} onClick={() => run("back")}>برگشت به انبار</button>}
          {pending && canApprove && (
            <button className={hasDiscrepancy ? "submit-warn" : "submit"} style={{ width: "auto", margin: 0 }}
              disabled={busy || !ready || (hasDiscrepancy && !form.financeNote.trim())} onClick={() => run("approve")}>
              {busy ? "…" : hasDiscrepancy ? "تأیید با مغایرت" : "تأیید مالی"}
            </button>
          )}
        </div>
        {pending && !ready && (
          <div className="muted sm2">برای تأیید: شمارهٔ فاکتور و {basis === "cost" ? "قیمت خرید" : "قیمت فروش"} همهٔ اقلام لازم است.</div>
        )}
        {pending && ready && hasDiscrepancy && (
          <div className="muted sm2">
            این حواله با فاکتور مغایرت دارد. برای «تأیید با مغایرت»، توضیح مغایرت را در یادداشت مالی بنویسید و دکمهٔ نارنجی
            «تأیید با مغایرت» را بزنید. اگر تصمیم گرفتید حواله اصلاح شود، «برگشت به انبار» بزنید.
          </div>
        )}
      </div>
    </div>
  );
}

/** پاسخ انبار به حواله‌ای که مالی برگردانده. */
function FinanceReplyDialog({ voucher, onClose, onDone }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!reply.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      await warehouseApi.resubmitFinance(voucher.id, reply.trim());
      onDone(`حوالهٔ ${voucher.number} دوباره به کارتابل مالی رفت`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">پاسخ به مالی — حوالهٔ {voucher.number}</div>
        <div className="notice warn">مالی: {voucher.financeNote}</div>
        <div className="muted sm2" style={{ margin: "8px 0" }}>
          حوالهٔ ثبت‌شده ویرایش نمی‌شود. اگر مقدار اشتباه بوده، حوالهٔ اصلاحی بزنید و شماره‌اش را در پاسخ بنویسید.
        </div>
        <label className="fld"><span>پاسخ</span>
          <textarea rows={3} autoFocus value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder="چه چیزی بررسی یا اصلاح شد" />
        </label>
        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={!reply.trim() || busy} onClick={send}>
            {busy ? "…" : "ارسال دوباره به مالی"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ مصرف مواد ============ */
// هر ردیف مصرف به یک کالای انبار وصل است؛ نام، کد و واحد از همان‌جا می‌آید.
const blankUsageLine = (project = "") => ({
  key: uid(), project, sku: "", label: "", code: "", baseUnit: "", altUnit: "",
  unit: "", quantity: "", desc: "",
});

function usageLineFromItem(it) {
  return {
    key: uid(), project: it.project || "", sku: it.sku || "",
    label: it.materialName || "", code: it.materialCode || "",
    baseUnit: it.baseUnit || "", altUnit: it.altUnit || "",
    unit: it.unit || it.baseUnit || "", quantity: String(it.quantity ?? ""), desc: it.desc || "",
  };
}

const usageLineReady = (r) => r.project && r.sku && Number(r.quantity) > 0;
const usageLinePayload = (r) => ({
  project: r.project, sku: r.sku, unit: r.unit || r.baseUnit || "",
  quantity: Number(r.quantity), desc: r.desc || "",
});

/** انتخاب مادهٔ مصرفی از فهرست انبار، با تعریف مادهٔ تازه در همان پنجره. */
function ConsumablePicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", code: "", unit: UNITS[0] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setRows(await consumablesApi.search(q.trim()));
        setErr("");
      } catch (e) { setErr(e.message); } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function pick(item) { onPick(item); onClose(); }

  async function create() {
    const name = draft.name.trim();
    if (!name || busy) return;
    setBusy(true); setErr("");
    try {
      pick(await consumablesApi.create({ name, code: draft.code.trim(), unit: draft.unit }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">{creating ? "تعریف مادهٔ مصرفی تازه" : "انتخاب مادهٔ مصرفی"}</div>
        {!creating ? (
          <>
            <input className="wh-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="نام، کد انبار یا برند…" />
            {!q.trim() && <div className="muted sm2" style={{ margin: "6px 0" }}>پرمصرف‌ها — برای بقیهٔ کالاهای انبار جست‌وجو کنید.</div>}
            <div className="pick-list">
              {loading && !rows.length ? <div className="empty">…</div>
                : rows.length === 0 ? <div className="empty">در انبار پیدا نشد.</div>
                : rows.map((r) => (
                  <button key={r.id} className="pick-row" onClick={() => pick(r)}>
                    <span className="pick-name">{r.name}</span>
                    <span className="pick-sub">
                      {r.code ? `کد ${r.code}` : "بدون کد"}
                      {r.brand ? ` · ${r.brand}` : ""}
                      {r.packSize ? ` · ${r.packSize}` : ""}
                      {` · ${r.baseUnit || "—"}`}{r.altUnit ? ` / ${r.altUnit}` : ""}
                    </span>
                  </button>
                ))}
            </div>
            {err && <div className="err">{err}</div>}
            <div className="btn-row">
              <button className="ghost" onClick={onClose}>بستن</button>
              <button className="ghost" onClick={() => { setCreating(true); setErr(""); setDraft((d) => ({ ...d, name: q.trim() })); }}>
                + مادهٔ تازه
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="muted sm2" style={{ marginBottom: 10 }}>
              ماده‌ای که در انبار نیست همین‌جا تعریف می‌شود و از این پس در فهرست کالاهای انبار هم هست.
            </div>
            <label className="fld"><span>نام</span>
              <input autoFocus value={draft.name} placeholder="مثلاً تینر پلی‌یورتان"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <div className="row2">
              <label className="fld"><span>کد انبار (اختیاری)</span>
                <input value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
              </label>
              <label className="fld"><span>واحد</span>
                <select value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}>
                  {UNITS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </label>
            </div>
            {err && <div className="err">{err}</div>}
            <div className="btn-row">
              <button className="ghost" onClick={() => { setCreating(false); setErr(""); }}>بازگشت</button>
              <button className="submit" style={{ width: "auto", margin: 0 }}
                disabled={!draft.name.trim() || busy} onClick={create}>
                {busy ? "در حال ثبت…" : "تعریف و انتخاب"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** ردیف‌های مصرف — مشترک میان فرم ثبت و ویرایش گزارش. */
function UsageLines({ rows, setRows, projects }) {
  // پروژهٔ بسته هم مثل غیرفعال، دیگر در فهرست انتخاب نمی‌آید؛ برای ثبت کار رویش
  // باید اول دوباره بازش کرد.
  const activeProjects = projects.filter((p) => p.active !== false && !p.closedAt);
  const [pickingFor, setPickingFor] = useState(null);
  const setRow = (key, patch) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delRow = (key) => setRows((p) => (p.length > 1 ? p.filter((r) => r.key !== key) : p));

  function applyPick(key, item) {
    setRow(key, {
      sku: item.id, label: item.name, code: item.code || "",
      baseUnit: item.baseUnit || "", altUnit: item.altUnit || "", unit: item.baseUnit || "",
    });
  }

  return (
    <>
      {rows.map((r, idx) => {
        const units = [r.baseUnit, r.altUnit].filter(Boolean);
        // ردیف قدیمی شاید با واحدی ثبت شده که کالای انبار ندارد؛ نشانش می‌دهیم تا گم نشود.
        if (r.unit && !units.includes(r.unit)) units.push(r.unit);
        return (
          <div className="item-row" key={r.key}>
            <div className="item-num">{faDigits(idx + 1)}</div>
            <div className="item-body">
              <div className="row2">
                <label className="fld sm"><span>پروژه</span>
                  <select value={r.project} onChange={(e) => setRow(r.key, { project: e.target.value })}>
                    <option value="">— انتخاب کنید —</option>
                    {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <div className="fld sm"><span>ماده (از انبار)</span>
                  <button type="button" className={r.sku ? "pick-field" : "pick-field empty"}
                    onClick={() => setPickingFor(r.key)}>
                    {r.sku ? <>{r.label}{r.code ? <small> · {r.code}</small> : null}</> : "انتخاب از فهرست انبار…"}
                  </button>
                </div>
              </div>
              <div className="row3">
                <label className="fld sm"><span>مقدار مصرفی</span>
                  <input type="number" inputMode="decimal" value={r.quantity} placeholder="۰"
                    onChange={(e) => setRow(r.key, { quantity: e.target.value })} />
                </label>
                <label className="fld sm"><span>واحد</span>
                  {units.length > 1 ? (
                    <select value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })}>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  ) : <input value={units[0] || "—"} disabled />}
                </label>
                <label className="fld sm"><span>شرح (اختیاری)</span>
                  <input value={r.desc} placeholder="توضیح"
                    onChange={(e) => setRow(r.key, { desc: e.target.value })} />
                </label>
              </div>
            </div>
            {rows.length > 1 && <button className="item-del" onClick={() => delRow(r.key)}>×</button>}
          </div>
        );
      })}
      {pickingFor && (
        <ConsumablePicker onClose={() => setPickingFor(null)} onPick={(item) => applyPick(pickingFor, item)} />
      )}
    </>
  );
}

function MaterialsUsageView({ session, projects, materialUsages, onCreateUsage, onUpdateUsage }) {
  const canEntry = hasAccess(session, "materials.create");
  const firstProject = () => projects.find((p) => p.active !== false)?.id || "";

  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState(() => [blankUsageLine(firstProject())]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draftId, setDraftId] = useState(null);
  const addRow = () => setRows((p) => [...p, blankUsageLine(firstProject())]);

  // گزارشِ تأییدنشدهٔ همین روز دوباره بارگذاری می‌شود تا گزارش تکراری ساخته نشود.
  const loadedKey = useRef(null);
  useEffect(() => {
    if (loadedKey.current === date) return;
    loadedKey.current = date;
    const existing = materialUsages.find(
      (u) => u.date === date && u.recordedBy === session.username && u.status !== "approved"
    );
    if (existing) {
      setDraftId(existing.id);
      const lines = (existing.items || []).map(usageLineFromItem);
      setRows(lines.length ? lines : [blankUsageLine(firstProject())]);
    } else {
      setDraftId(null);
      setRows([blankUsageLine(firstProject())]);
    }
  }, [date, materialUsages, session.username]);

  const currentDraft = materialUsages.find((u) => u.id === draftId);
  const valid = rows.some(usageLineReady);

  /** ذخیره می‌کند و همان لحظه برای تأیید مدیر می‌فرستد. */
  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const items = rows.filter(usageLineReady).map(usageLinePayload);
      let id = draftId;
      if (id) {
        await onUpdateUsage(id, { items });
      } else {
        const created = await onCreateUsage({ date, status: "draft", items });
        id = created.id;
        setDraftId(id);
      }
      const status = materialUsages.find((u) => u.id === id)?.status;
      if (!status || status === "draft" || status === "revision") {
        await onUpdateUsage(id, { status: "waiting" });
      }
      setMsg("مصرف مواد ذخیره و برای تأیید ارسال شد ✓");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canEntry) return <div className="empty">ثبت مصرف مواد برای نقش شما فعال نیست.</div>;

  return (
    <div className="card form">
      <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>

      <div className="items-hd">مواد مصرفی</div>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        مواد از فهرست انبار انتخاب می‌شوند. وقتی مدیر گزارش را تأیید کند، مقدارش از
        «انبار مصرفی تولید» کم می‌شود.
      </div>
      <UsageLines rows={rows} setRows={setRows} projects={projects} />
      <button className="add-row" onClick={addRow}>+ افزودن ماده</button>

      {draftId && (
        <div className="draft-note">
          {currentDraft?.status === "revision"
            ? "مدیر این گزارش را برای اصلاح برگردانده است؛ پس از ویرایش، با ذخیره دوباره برای تأیید ارسال می‌شود."
            : "این گزارش برای تأیید مدیر ارسال شده و تا پیش از تأیید قابل ویرایش است."}
        </div>
      )}
      <button className="submit" style={{ width: "100%" }} disabled={!valid || busy} onClick={save}>
        ذخیرهٔ مصرف مواد
      </button>
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/* ============ گزارش رانندگان (داشبورد) ============ */
/** ساعت مقرر → ساعت رسیدن، به‌همراه نفرات؛ برای جدول خلاصه. */
function shuttleText(scheduled, arrival, passengers) {
  if (!scheduled && !arrival && !passengers) return "—";
  const times = arrival ? `${scheduled || "—"} → ${arrival}` : (scheduled || "—");
  return passengers ? `${times} (${passengers})` : times;
}

/** خلاصهٔ گزارش‌های راننده در یک بازهٔ تاریخ، با خروجی چاپی و اکسل. */
function DriverReportExport({ drivers, driverReports }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [driver, setDriver] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [showDoc, setShowDoc] = useState(false);

  const swapped = from && to && from > to;
  const [lo, hi] = swapped ? [to, from] : [from, to];

  const rows = useMemo(() => driverReports
    .filter((r) => (!lo || r.date >= lo) && (!hi || r.date <= hi))
    .filter((r) => driver === "all" || r.driver === driver)
    .filter((r) => fStatus === "all" || r.status === fStatus)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [driverReports, lo, hi, driver, fStatus]);

  const totals = useMemo(() => {
    const perDriver = {};
    let km = 0, delays = 0, tasks = 0;
    rows.forEach((r) => {
      const d = r.distanceKm || 0;
      km += d;
      delays += (r.delays || []).length;
      tasks += (r.tasks || []).length;
      const key = r.driverName || "—";
      if (!perDriver[key]) perDriver[key] = { km: 0, days: 0 };
      perDriver[key].km += d;
      perDriver[key].days += 1;
    });
    const perDriverList = Object.entries(perDriver).sort((a, b) => b[1].km - a[1].km);
    return {
      km, delays, tasks, days: rows.length,
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
      </div>

      {rows.length === 0 ? (
        <div className="empty">در این بازه گزارشی نیست.</div>
      ) : (
        <>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead>
                <tr>
                  <th>تاریخ</th><th>راننده</th><th>پیمایش (کیلومتر)</th>
                  <th>سرویس صبح</th><th>سرویس عصر</th><th>تأخیر</th><th>سرویس داخل روز</th>
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
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={2}>مجموع</td>
                  <td>{faDigits(totals.km)}</td>
                  <td colSpan={2}>—</td>
                  <td>{faDigits(totals.delays)} مورد</td>
                  <td>{faDigits(totals.tasks)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {totals.perDriver.length > 1 && (
            <>
              <div className="board-h" style={{ marginTop: 14 }}>پیمایش به تفکیک راننده</div>
              {totals.perDriver.map(([name, v]) => (
                <div className="bar-row" key={name}>
                  <span className="bar-lbl">{name}</span>
                  <div className="bar emp"><div style={{ width: (v.km / totals.maxKm * 100) + "%" }} /></div>
                  <span className="bar-v">{faDigits(v.km)}</span>
                </div>
              ))}
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
        <div className="doc-foot">سامانهٔ دیواژ · تاریخ تهیه: {jShort(todayIso())}</div>
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
    (r.tasks || []).forEach((t) => detail.push([jShort(r.date), r.driverName || "", "سرویس/کار",
      t.time || "", [t.destination, t.description].filter(Boolean).join(" — ")]));
  });
  const ws2 = rtl(XLSX.utils.aoa_to_sheet(detail.length > 1 ? detail : [["داده‌ای نیست"]]));
  ws2["!cols"] = [{ wch: 13 }, { wch: 16 }, { wch: 11 }, { wch: 12 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, ws2, "جزئیات");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`driver-report-${jShort(todayIso()).replace(/\//g, "-")}.xlsx`,
    new Blob([buf], { type: "application/octet-stream" }));
}

/* ============ راننده ============ */
function DriverView({ session, drivers, driverReports, onCreateReport, onUpdateReport, onCreateDriver, onToggleDriver, onDeleteDriver }) {
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
  const setTask = (id, k, v) => setTasks((p) => p.map((t) => (t.id === id ? { ...t, [k]: v } : t)));
  const delTask = (id) => setTasks((p) => p.filter((t) => t.id !== id));

  function resetForm() {
    setDriver(activeDrivers[0]?.id || "");
    setMorning({ scheduled: "۸:۳۰", arrival: "", passengers: "" });
    setEvening({ scheduled: "", arrival: "", passengers: "" });
    setOdoStart(""); setOdoEnd("");
    setMorningDelays([]); setEveningDelays([]); setTasks([]);
  }

  // گزارشِ تأییدنشدهٔ همین روز دوباره بارگذاری می‌شود تا گزارش تکراری ساخته نشود.
  const loadedKey = useRef(null);
  useEffect(() => {
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
      setTasks((existing.tasks || []).map((t) => ({ id: uid(), time: t.time || "", destination: t.destination || "", description: t.description || "" })));
    } else {
      setDraftId(null);
      resetForm();
    }
  }, [date, driverReports, session.username]);

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
        tasks: tasks
          .filter((t) => t.destination.trim() || t.description.trim())
          .map((t) => ({ time: t.time.trim(), destination: t.destination.trim(), description: t.description.trim() })),
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

          {draftId && (
            <div className="draft-note">
              {currentDraft?.status === "revision"
                ? "مدیر این گزارش را برای اصلاح برگردانده است؛ پس از ویرایش، با ذخیره دوباره برای تأیید ارسال می‌شود."
                : "این گزارش برای تأیید مدیر ارسال شده و تا پیش از تأیید قابل ویرایش است."}
            </div>
          )}
          <button className="submit" disabled={!valid || busy} onClick={save}>ذخیرهٔ گزارش راننده</button>
          {msg && <div className="ok-msg">{msg}</div>}
        </div>
      )}

      {isManager && drivers.length > 0 && (
        <>
          <div className="card"><div className="board-h">مدیریت رانندگان</div><div className="muted sm2">راننده جدید رو از طریق گزینهٔ «+ راننده جدید» توی فرم بالا اضافه کنید.</div></div>
          {drivers.map((d) => (
            <div className="card proj" key={d.id}>
              <div><b>{d.name}</b></div>
              <div className="proj-actions">
                <button className={d.active !== false ? "toggle on" : "toggle"} onClick={() => onToggleDriver(d).catch((e) => alert(e.message))}>
                  {d.active !== false ? "فعال" : "غیرفعال"}
                </button>
                <button className="del" onClick={() => onDeleteDriver(d.id).catch((e) => alert(e.message))}>حذف</button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ============ حقوق و دستمزد ============ */
/* منطق محاسبه در src/payroll.js است تا جدا از رابط کاربری قابل آزمودن باشد. */

/** نشان دیواژ — همان مربع سبزِ بالای صفحه، به‌صورت SVG تا در چاپ هم بیاید. */
function BrandMark({ size = 46 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 46" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <defs>
        <linearGradient id="divajMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0F6E64" />
          <stop offset="1" stopColor="#0B4F48" />
        </linearGradient>
      </defs>
      <rect width="46" height="46" rx="12" fill="url(#divajMark)" />
      <rect x="4.5" y="4.5" width="37" height="37" rx="8.5" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="3" />
    </svg>
  );
}

/** پوستهٔ برگه‌های چاپی: نوار دکمه‌ها و محدودکردن چاپ به همین برگه. */
function PrintableDoc({ onClose, children }) {
  useEffect(() => {
    document.body.classList.add("printing-doc");
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("printing-doc");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="doc-overlay">
      <div className="doc-toolbar no-print">
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
function DocLetterhead({ title, subtitle }) {
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
            این فیش توسط سامانهٔ دیواژ تولید شده است · ارقام به ریال · مبنای محاسبه: قانون کار
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
          <div className="doc-foot">ارقام به ریال · سامانهٔ دیواژ</div>
        </div>
    </PrintableDoc>
  );
}

function PayrollView({ session }) {
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
        <div className="empty">هنوز ماهی باز نشده. از کادر بالا یک ماه بسازید.</div>
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

/* ============ انبار ============ */
// صفحه‌هایی که جدول پهن دارند و در ستون ۶۰۰ پیکسلی موبایل جا نمی‌شوند.
const WIDE_TABS = new Set(["warehouse", "payroll", "finance", "financereports", "maintenance", "chat", "production"]);

const MOVE_KINDS = [
  { id: "receipt", label: "ورود کالا", dir: "in" },
  { id: "sale", label: "فروش", dir: "out" },
  { id: "return", label: "مرجوعی", dir: "in" },
  { id: "workshop", label: "مصرف کارگاه", dir: "out" },
  { id: "transfer_out", label: "انتقال به انبار دیگر", dir: "out" },
  { id: "transfer_in", label: "دریافت از انبار دیگر", dir: "in" },
  { id: "count", label: "اصلاح انبارگردانی", dir: "any" },
];

/* جای صفحه در نشانی («#warehouse/vouchers») تا با تازه کردن صفحه همان‌جا بماند، نه برگشت به گزارش‌ها. */
function readRoute() {
  let raw = window.location.hash.replace(/^#\/?/, "");
  try { raw = decodeURIComponent(raw); } catch { /* نشانی خراب: نادیده */ }
  const [tab = "", sub = ""] = raw.split("/");
  return { tab, sub };
}

function writeRoute(tab, sub = "") {
  const hash = `#${tab}${sub ? `/${sub}` : ""}`;
  // replaceState: هر کلیک سربرگ یک قدم «بازگشت» مرورگر نمی‌سازد.
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
}

/* ---- خروجی اکسل و کمک‌های گزارش انبار ---- */
/** سطرها (سطر اول سرستون) → فایل اکسل راست‌به‌چپ. */
function saveSheet(filename, sheetName, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!views"] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(`${filename}-${jShort(todayIso()).replace(/\//g, "-")}.xlsx`, new Blob([buf], { type: "application/octet-stream" }));
}
/** همهٔ صفحه‌های یک فهرست صفحه‌بندی‌شده، برای خروجی اکسل. */
async function fetchAllPages(fetchPage, params) {
  const out = [];
  for (let page = 1; page <= 100; page += 1) {
    const d = await fetchPage({ ...params, page, page_size: 500 });
    out.push(...(d.results || []));
    if (!d.next) break;
  }
  return out;
}
const fq = (n) => faDigits(Number(Number(n || 0).toFixed(3)));
const jYearStart = () => { const j = isoToJ(todayIso()); return jToIso({ jy: j.jy, jm: 1, jd: 1 }); };

function DateRange({ from, to, setFrom, setTo }) {
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

function WarehouseView({ session }) {
  const [paneWanted, setPaneWanted] = useState(() => {
    const r = readRoute();
    return r.tab === "warehouse" && r.sub ? r.sub : "stock";
  });
  const setPane = (id) => { setPaneWanted(id); writeRoute("warehouse", id); };
  const isManager = hasAccess(session, "warehouse.setup");
  const panes = [
    { id: "stock", label: "موجودی" },
    { id: "vouchers", label: "حواله‌ها" },
    { id: "counts", label: "انبارگردانی" },
    { id: "turnover", label: "گردش کالا" },
    { id: "items", label: "کالاها" },
    { id: "assets", label: "اموال" },
    hasAccess(session, "consumables") && { id: "consumables", label: "مواد مصرفی" },
    hasAccess(session, "stockreview") && { id: "review", label: "بازبینی" },
    isManager && { id: "setup", label: "تعریف و بارگذاری" },
  ].filter(Boolean);
  // بخشی که در نشانی آمده ولی این کاربر به آن دسترسی ندارد → «موجودی».
  const pane = panes.some((p) => p.id === paneWanted) ? paneWanted : "stock";

  return (
    <>
      <div className="sub-tabs no-print">
        {panes.map((p) => (
          <button key={p.id} className={pane === p.id ? "sub-tab on" : "sub-tab"}
            onClick={() => setPane(p.id)}>{p.label}</button>
        ))}
      </div>
      {pane === "stock" && <StockPane session={session} />}
      {pane === "vouchers" && <VoucherPane session={session} />}
      {pane === "counts" && <CountsPane />}
      {pane === "turnover" && <TurnoverPane />}
      {pane === "items" && <ItemsPane />}
      {pane === "assets" && <AssetsPane />}
      {pane === "consumables" && hasAccess(session, "consumables") && <ConsumableReviewPane />}
      {pane === "review" && hasAccess(session, "stockreview") && <StockReviewPane />}
      {pane === "setup" && <WarehouseSetupPane />}
    </>
  );
}

function StockPane({ session }) {
  const [warehouses, setWarehouses] = useState([]);
  const [meta, setMeta] = useState({ brands: [], categories: [], totals: {} });
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [wh, setWh] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [belowMin, setBelowMin] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [uncounted, setUncounted] = useState(false);
  const [moveFor, setMoveFor] = useState(null);   // ردیفی که برایش گردش ثبت می‌شود
  const [historyFor, setHistoryFor] = useState(null);
  const [unpackFor, setUnpackFor] = useState(null);
  const [exporting, setExporting] = useState(false);

  const canSeeCost = hasAccess(session, "warehouse.cost");
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  // جست‌وجو با کمی تأخیر تا با هر حرف یک درخواست نرود.
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [wh, brand, category, qDebounced, belowMin, inStock, uncounted]);

  const params = useMemo(() => ({
    warehouse: wh, brand, category, q: qDebounced,
    below_min: belowMin ? 1 : "", in_stock: inStock ? 1 : "",
    uncounted: uncounted ? 1 : "", page,
  }), [wh, brand, category, qDebounced, belowMin, inStock, uncounted, page]);

  useEffect(() => {
    (async () => {
      try {
        const w = await warehouseApi.list();
        setWarehouses(w);
      } catch (e) { setErr(e.message); }
    })();
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [data, m] = await Promise.all([
        warehouseApi.stock(params),
        warehouseApi.meta({ warehouse: wh, brand, category, q: qDebounced }),
      ]);
      setRows(data.results || []);
      setCount(data.count || 0);
      setMeta(m);
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [params, wh, brand, category, qDebounced]);

  useEffect(() => { reload(); }, [reload]);

  /** قفسه و حداقل موجودی برای یک کالا در یک انبار مشخص ذخیره می‌شود. */
  async function saveCell(row, warehouseId, field, value) {
    try {
      const updated = await warehouseApi.updateStock(row.id, { warehouse: warehouseId, [field]: value });
      setRows((p) => p.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      alert(e.message);
    }
  }

  const totals = meta.totals || {};
  const pageCount = Math.ceil(count / 60) || 1;
  // وقتی یک انبار انتخاب شده فقط همان ستون می‌آید و قفسه/حداقل قابل ویرایش است.
  const shownWarehouses = wh ? warehouses.filter((w) => w.id === wh) : warehouses;
  const oneWarehouse = shownWarehouses.length === 1;

  /** همان چیزی که با فیلترهای الان در جدول است، ولی همهٔ صفحه‌ها. */
  async function exportStock() {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await fetchAllPages(warehouseApi.stock, params);
      const head = ["کالا", "نام سایت", "برند", "دسته", "بسته", "گرید/شید", "شناسه", "واحد",
        ...shownWarehouses.map((w) => w.name)];
      if (shownWarehouses.length > 1) head.push("جمع");
      if (oneWarehouse) head.push("قفسه", "حداقل");
      if (canSeeCost) head.push("قیمت خرید");
      const body = all.map((r) => {
        const cell = (wid) => (r.stock || []).find((s) => s.warehouse === wid);
        const row = [r.productName, r.siteName || "", r.brand, r.category, r.packSize,
          [r.grit, r.shade].filter(Boolean).join(" / "), r.packageId, r.baseUnit,
          ...shownWarehouses.map((w) => { const c = cell(w.id); return c && c.known ? c.onHand : ""; })];
        if (shownWarehouses.length > 1) row.push(r.totalOnHand || 0);
        if (oneWarehouse) { const c = cell(shownWarehouses[0].id); row.push(c?.shelfCode || "", c?.minQty || 0); }
        if (canSeeCost) row.push(r.costPrice || 0);
        return row;
      });
      saveSheet("موجودی-انبار", "موجودی", [head, ...body]);
    } catch (e) {
      showMessage({ title: "خروجی اکسل ساخته نشد", message: e.message });
    } finally {
      setExporting(false);
    }
  }

  if (err && !rows.length) return <div className="notice warn">{err}</div>;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(totals.rows ?? 0)}</b><span>ردیف انبار</span></div>
        <div className="stat"><b>{faDigits(totals.in_stock ?? 0)}</b><span>دارای موجودی</span></div>
        <div className={totals.below ? "stat warn" : "stat"}>
          <b>{faDigits(totals.below ?? 0)}</b><span>زیر حداقل</span>
        </div>
        <div className={totals.uncounted ? "stat warn" : "stat"}>
          <b>{faDigits(totals.uncounted ?? 0)}</b><span>شمارش‌نشده</span>
        </div>
        <div className="stat"><b>{faDigits(warehouses.length)}</b><span>انبار</span></div>
      </div>

      <div className="card">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام کالا، کد، شناسه بسته، گرید، شید یا قفسه…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">همهٔ انبارها</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {(meta.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">همهٔ دسته‌ها</option>
            {(meta.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="wh-toggles">
          <label><input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} /> فقط زیر حداقل موجودی</label>
          <label><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> فقط دارای موجودی</label>
          <label><input type="checkbox" checked={uncounted} onChange={(e) => setUncounted(e.target.checked)} /> فقط شمارش‌نشده‌ها</label>
          <button className="link-btn" disabled={exporting || !count} onClick={exportStock}>
            {exporting ? "در حال ساختن اکسل…" : "📊 خروجی اکسل"}
          </button>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? <div className="empty">کالایی با این فیلترها نیست.</div> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr>
                  <th>کالا</th><th>برند</th><th>بسته</th><th>گرید/شید</th>
                  {/* ستون موجودی برای هر انبار جدا؛ وقتی یک انبار انتخاب شده فقط همان. */}
                  {shownWarehouses.map((w) => <th key={w.id}>{w.name}</th>)}
                  {shownWarehouses.length > 1 && <th>جمع</th>}
                  {oneWarehouse && <><th>قفسه</th><th>حداقل</th></>}
                  {canSeeCost && <th>قیمت خرید</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cell = (wid) => (r.stock || []).find((s) => s.warehouse === wid);
                  const anyLow = (r.stock || []).some((s) => s.minQty > 0 && s.onHand < s.minQty);
                  const only = oneWarehouse ? cell(shownWarehouses[0].id) : null;
                  return (
                    <tr key={r.id} className={anyLow ? "wh-low" : ""}>
                      <td className="wh-name">
                        {r.productName}
                        <div className="wh-sub">
                          {r.code && <span>کد {r.code}</span>}
                          <span>شناسه {r.packageId}</span>
                          {r.hazardous && <span className="wh-flag haz">آتش‌زا</span>}
                          {r.batchTracked && <span className="wh-flag">بچ‌دار</span>}
                        </div>
                      </td>
                      <td>{r.brand}</td>
                      <td>{r.packSize}</td>
                      <td>{[r.grit, r.shade].filter(Boolean).join(" / ") || "—"}</td>
                      {shownWarehouses.map((w) => {
                        const c = cell(w.id);
                        const low = c && c.minQty > 0 && c.onHand < c.minQty;
                        // صفرِ شمرده‌نشده ادعا نیست؛ نباید مثل صفرِ قطعی دیده شود.
                        const unknown = c && !c.known;
                        return (
                          <td key={w.id} className={low ? "wh-qty low" : "wh-qty"}>
                            {!c ? "—" : unknown
                              ? <span className="wh-unknown" title="در فرم انبارگردانی برای این قلم عددی نوشته نشده">شمارش نشده</span>
                              : <>{faDigits(c.onHand)} <small className="wh-unit">{r.baseUnit}</small></>}
                          </td>
                        );
                      })}
                      {shownWarehouses.length > 1 && (
                        <td className="wh-qty total">{faDigits(r.totalOnHand || 0)}</td>
                      )}
                      {oneWarehouse && (
                        <>
                          <td><input className="wh-cell" defaultValue={only?.shelfCode || ""}
                            onBlur={(e) => only && e.target.value !== (only.shelfCode || "")
                              && saveCell(r, only.warehouse, "shelfCode", e.target.value)} /></td>
                          <td><input className="wh-cell narrow" defaultValue={only?.minQty ?? 0}
                            onBlur={(e) => only && Number(e.target.value) !== only.minQty
                              && saveCell(r, only.warehouse, "minQty", Number(e.target.value) || 0)} /></td>
                        </>
                      )}
                      {canSeeCost && <td>{r.costPrice ? faDigits(Math.round(r.costPrice)) : "—"}</td>}
                      <td className="wh-actions">
                        <button className="act edit" onClick={() => setMoveFor(r)}>ثبت گردش</button>
                        {oneWarehouse && (
                          <button className="link-btn" onClick={() => setUnpackFor(r)}>شکستن بسته</button>
                        )}
                        <button className="link-btn" onClick={() => setHistoryFor(r)}>کاردکس</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!oneWarehouse && (
            <div className="muted sm2" style={{ marginTop: 6 }}>
              برای ویرایش قفسه و حداقل موجودی، یک انبار را از فیلتر بالا انتخاب کنید.
            </div>
          )}

          <div className="wh-pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} ردیف</span>
            <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {moveFor && (
        <StockMoveDialog row={moveFor} warehouses={warehouses} defaultWarehouse={wh || warehouses[0]?.id}
          onClose={() => setMoveFor(null)}
          onDone={(label) => { setMoveFor(null); flash(label); reload(); }} />
      )}
      {historyFor && (
        <KardexDialog sku={historyFor} warehouses={warehouses} warehouse={wh} onClose={() => setHistoryFor(null)} />
      )}
      {unpackFor && (
        <UnpackDialog row={unpackFor} warehouse={wh} onClose={() => setUnpackFor(null)}
          onDone={(label) => { setUnpackFor(null); flash(label); reload(); }} />
      )}
    </>
  );
}

/* ---- حواله‌های ورود و خروج ---- */
const VOUCHER_KINDS = [
  { id: "receipt", label: "ورود کالا (خرید)", dir: "in" },
  { id: "return", label: "مرجوعی از مشتری", dir: "in" },
  { id: "transfer_in", label: "دریافت از انبار دیگر", dir: "in" },
  { id: "return_person", label: "برگشت از شخص", dir: "in", person: true },
  { id: "sale", label: "فروش", dir: "out" },
  { id: "workshop", label: "مصرف کارگاه", dir: "out" },
  { id: "transfer_out", label: "انتقال به انبار دیگر", dir: "out" },
  { id: "issue_person", label: "تحویل به شخص", dir: "out", person: true },
];

function VoucherPane({ session }) {
  const [warehouses, setWarehouses] = useState([]);
  const [list, setList] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [fKind, setFKind] = useState("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [section, setSection] = useState("list");   // فهرست حواله‌ها یا کالای دست اشخاص
  const [holdersKey, setHoldersKey] = useState(0);  // پس از ثبت حواله، فهرست دست اشخاص تازه شود
  const [exporting, setExporting] = useState(false);
  const [template, setTemplate] = useState(null);   // حوالهٔ آماده (برگشت کالا از شخص)
  const [editing, setEditing] = useState(null);   // حوالهٔ در حال ویرایش یا "new"
  const [viewing, setViewing] = useState(null);
  const [replying, setReplying] = useState(null);   // حوالهٔ برگشتی از مالی
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [shortage, setShortage] = useState(null);   // کمبود موجودی هنگام ثبت نهایی
  const [confirmPost, setConfirmPost] = useState(null);   // حواله‌ای که تأیید ثبت نهایی‌اش باز است
  const [posting, setPosting] = useState(false);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  useEffect(() => {
    warehouseApi.list().then(setWarehouses).catch((e) => setErr(e.message));
  }, []);

  // جست‌وجو نام کالا را هم می‌گردد و سنگین‌تر است؛ با هر حرف یک درخواست نرود.
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await warehouseApi.vouchers({ status: fStatus, kind: fKind, q: qd, from, to, page });
      setList(d.results || []);
      setCount(d.count || 0);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [fStatus, fKind, qd, from, to, page]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setPage(1); }, [fStatus, fKind, qd, from, to]);

  const openTemplate = (tpl) => { setTemplate(tpl); setEditing("new"); };

  /** همان حواله‌هایی که با فیلترهای الان در فهرست‌اند، یک سطر برای هر قلم کالا. */
  async function exportVouchers() {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await fetchAllPages(warehouseApi.vouchers, { status: fStatus, kind: fKind, q: qd, from, to });
      const cost = hasAccess(session, "warehouse.cost");
      const head = ["شماره", "تاریخ", "نوع", "جهت", "انبار", "طرف مقابل", "شمارهٔ فاکتور", "وضعیت", "وضعیت مالی",
        "کالا", "شناسه", "بسته", "مقدار", "واحد", ...(cost ? ["قیمت واحد", "مبلغ"] : []), "ثبت‌کننده", "توضیح"];
      const body = all.flatMap((v) => (v.lines || []).map((l) => [
        v.number, jShort(v.date), v.movementKindLabel, v.isInbound ? "ورود" : "خروج", v.warehouseName,
        v.toWarehouseName ? `← ${v.toWarehouseName}` : (v.counterparty || ""), v.ref || "", v.statusLabel,
        v.financeStatus && v.financeStatus !== "none" ? v.financeStatusLabel : "",
        l.productName, l.packageId, l.packSize, l.qty, l.unit || l.baseUnit,
        ...(cost ? [l.unitCost || 0, (l.qty || 0) * (l.unitCost || 0)] : []), v.createdBy, v.note || "",
      ]));
      saveSheet("حواله‌های-انبار", "حواله‌ها", [head, ...body]);
    } catch (e) {
      showMessage({ title: "خروجی اکسل ساخته نشد", message: e.message });
    } finally {
      setExporting(false);
    }
  }

  const postVoucher = (v) => setConfirmPost(v);

  async function doPost(v) {
    setPosting(true);
    try {
      await warehouseApi.postVoucher(v.id);
      setConfirmPost(null);
      flash(`حوالهٔ ${v.number} ثبت شد ✓`);
      reload();
    } catch (e) {
      setConfirmPost(null);
      if (e.data?.shortage) setShortage({ ...e.data.shortage, v });
      else alert(e.message);
    } finally {
      setPosting(false);
    }
  }

  async function removeVoucher(v) {
    const n = (v.lines || []).length;
    const ok = await askConfirm({
      title: `حذف حوالهٔ ${faDigits(v.number)}`,
      message: `حوالهٔ ${v.movementKindLabel}${v.counterparty ? ` «${v.counterparty}»` : ""} با ${faDigits(n)} قلم کالا حذف شود؟\nاین کار برگشت ندارد.`,
      confirmLabel: "حذف حواله", danger: true,
    });
    if (!ok) return;
    try {
      await warehouseApi.removeVoucher(v.id);
      flash("حذف شد");
      reload();
    } catch (e) { showMessage({ title: "حواله حذف نشد", message: e.message }); }
  }

  const pageCount = Math.ceil(count / 60) || 1;
  const editorEl = editing && (
    <VoucherEditor voucher={editing === "new" ? null : editing} initial={editing === "new" ? template : null}
      warehouses={warehouses}
      onClose={() => { setEditing(null); setTemplate(null); }}
      onSaved={(label) => {
        setEditing(null); setTemplate(null); flash(label); reload(); setHoldersKey((k) => k + 1);
      }} />
  );
  const segRow = (
    <div className="seg-row" role="tablist">
      {[["list", "فهرست حواله‌ها"], ["holders", "کالای دست اشخاص"]].map(([k, l]) => (
        <button key={k} role="tab" aria-selected={section === k} className={section === k ? "seg on" : "seg"}
          onClick={() => setSection(k)}>{l}</button>
      ))}
    </div>
  );
  if (section === "holders") {
    return (
      <>
        {segRow}
        <HoldersPane key={holdersKey} session={session} onVoucher={openTemplate} />
        {editorEl}
      </>
    );
  }
  if (err && !list.length) return <>{segRow}<div className="notice warn">{err}</div></>;

  return (
    <>
      {segRow}
      {confirmPost && (
        <PostConfirmDialog summary={voucherSummary(confirmPost)} busy={posting}
          onConfirm={() => doPost(confirmPost)} onClose={() => setConfirmPost(null)} />
      )}
      {shortage && (
        <ShortageDialog data={shortage} onClose={() => setShortage(null)}
          onEdit={() => { setEditing(shortage.v); setShortage(null); }} />
      )}
      {replying && (
        <FinanceReplyDialog voucher={replying} onClose={() => setReplying(null)}
          onDone={(text) => { setReplying(null); flash(text); reload(); }} />
      )}
      <div className="card">
        <div className="btn-row" style={{ marginBottom: 10 }}>
          {hasAccess(session, "warehouse.voucher") && (
            <button className="submit" style={{ width: "auto", margin: 0 }}
              onClick={() => setEditing("new")}>+ حوالهٔ جدید</button>
          )}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: شمارهٔ حواله، طرف مقابل، شمارهٔ فاکتور یا نام کالا…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">همهٔ وضعیت‌ها</option>
            <option value="draft">پیش‌نویس</option>
            <option value="posted">ثبت نهایی</option>
          </select>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)}>
            <option value="">همهٔ انواع</option>
            {VOUCHER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="wh-toggles">
          <button className="link-btn" disabled={exporting || !count} onClick={exportVouchers}>
            {exporting ? "در حال ساختن اکسل…" : "📊 خروجی اکسل"}
          </button>
        </div>
      </div>

      {loading && !list.length ? <div className="empty">در حال بارگذاری…</div>
        : list.length === 0 ? <div className="empty">حواله‌ای ثبت نشده.</div> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead>
                <tr>
                  <th>شماره</th><th>تاریخ</th><th>نوع</th><th>انبار</th>
                  <th>طرف مقابل</th><th>اقلام</th><th>وضعیت</th><th>ثبت‌کننده</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.id} className={v.status === "draft" ? "vc-draft" : ""}>
                    <td className="vc-num">{v.number}</td>
                    <td>{jShort(v.date)}</td>
                    <td>
                      <span className={v.isInbound ? "vc-dir in" : "vc-dir out"}>
                        {v.isInbound ? "ورود" : "خروج"}
                      </span> {v.movementKindLabel}
                    </td>
                    <td>{v.warehouseName}</td>
                    <td>{v.toWarehouseName ? `← ${v.toWarehouseName}` : (v.counterparty || "—")}</td>
                    <td>{faDigits((v.lines || []).length)}</td>
                    <td>
                      <span className={v.status === "posted" ? "status-chip vc-posted" : "status-chip vc-open"}>
                        {v.statusLabel}
                      </span>
                      {v.financeStatus && v.financeStatus !== "none" && (
                        <span className={`status-chip fin-${v.financeStatus}`}>{v.financeStatusLabel}</span>
                      )}
                      {v.financeStatus === "returned" && (
                        <div className="fin-return-note">
                          <span><b>مالی:</b> {v.financeNote}</span>
                          {hasAccess(session, "warehouse.voucher") && (
                            <button className="link-btn" onClick={() => setReplying(v)}>پاسخ و ارسال دوباره</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{v.createdBy}</td>
                    <td className="wh-actions">
                      <button className="link-btn" onClick={() => setViewing(v)}>نمایش</button>
                      {v.status === "draft" && (
                        <>
                          {hasAccess(session, "warehouse.voucher") && <button className="act edit" onClick={() => setEditing(v)}>ویرایش</button>}
                          {hasAccess(session, "warehouse.post") && <button className="act ok" onClick={() => postVoucher(v)}>ثبت نهایی</button>}
                          {hasAccess(session, "warehouse.voucher") && <button className="del" onClick={() => removeVoucher(v)}>حذف</button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="wh-pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} حواله</span>
            <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {editorEl}
      {viewing && <VoucherDoc voucher={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** ساخت و ویرایش حواله با چند قلم کالا. */
function VoucherEditor({ voucher, initial, warehouses, onClose, onSaved }) {
  // «initial» حوالهٔ آماده است (مثلاً برگشت کالا از شخص) — هنوز ذخیره نشده، پس پیش‌نویسی هم ندارد.
  const base = voucher || initial || null;
  const [kind, setKind] = useState(base?.movementKind || "receipt");
  const [date, setDate] = useState(base?.date || todayIso());
  // پیش‌فرض، انبارِ اصلی است نه اولین اسم الفبا: با ساختن یک انبار فرعی،
  // حواله‌ها نباید ناخواسته از آن یکی برداشت کنند.
  // انباری که مصرف کارگاه از آن کم می‌شود («انبار مصرفی تولید») انبار اصلی نیست: خرید و فروش از انبار مرکزی است.
  const mainWarehouse = warehouses.find((w) => !w.suppliesWorkshop) || warehouses[0];
  const [warehouse, setWarehouse] = useState(() =>
    (warehouses.some((w) => w.id === base?.warehouse) ? base.warehouse : mainWarehouse?.id) || "");
  const [toWarehouse, setToWarehouse] = useState(base?.toWarehouse || "");
  const [counterparty, setCounterparty] = useState(base?.counterparty || "");
  const [ref, setRef] = useState(base?.ref || "");
  const [note, setNote] = useState(base?.note || "");
  const [people, setPeople] = useState([]);   // نام کسانی که پیش‌تر کالا تحویل گرفته‌اند
  const [lines, setLines] = useState(() => (base?.lines || []).map((l) => ({
    key: uid(), sku: l.sku, label: `${l.productName} · ${l.packSize}`,
    qty: String(l.qty), unit: l.unit || "", unitCost: String(l.unitCost || ""),
    batchNo: l.batchNo || "", expiresOn: l.expiresOn || "", batchTracked: l.batchTracked,
    baseUnit: l.baseUnit, altUnit: l.altUnit,
  })));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(voucher || null);
  const [confirming, setConfirming] = useState(false);
  const canPost = useCan()("warehouse.post");
  const [shortage, setShortage] = useState(null);

  const info = VOUCHER_KINDS.find((k) => k.id === kind) || VOUCHER_KINDS[0];
  const inbound = info.dir === "in";
  const isTransfer = kind === "transfer_out";
  const srcName = warehouses.find((w) => w.id === warehouse)?.name || "";
  const dstName = warehouses.find((w) => w.id === toWarehouse)?.name || "";
  const valid = warehouse && lines.length > 0 && lines.every((l) => Number(l.qty) > 0)
    && (!isTransfer || (toWarehouse && toWarehouse !== warehouse))
    && (!info.person || counterparty.trim());

  // نام‌های پیشین، تا «محمدرضا نیازی» و «محمدرضا  نیازی» دو نفر نشوند.
  useEffect(() => {
    if (!info.person) return;
    warehouseApi.holders({ all: 1 })
      .then((d) => setPeople((d.people || []).map((p) => p.name)))
      .catch(() => { /* پیشنهاد نام است؛ نبودنش مانع ثبت حواله نیست */ });
  }, [info.person]);

  const setLine = (key, k, v) => setLines((p) => p.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  const delLine = (key) => setLines((p) => p.filter((l) => l.key !== key));

  function addPicked(row) {
    setLines((p) => {
      if (p.some((l) => l.sku === row.id)) return p;   // همان کالا دوبار در یک حواله نیاید
      return [...p, {
        key: uid(), sku: row.id,
        label: `${row.productName} · ${row.packSize}${row.grit ? " · " + row.grit : ""}${row.shade ? " · " + row.shade : ""}`,
        qty: "", unit: "", unitCost: "", batchNo: "", expiresOn: "", batchTracked: row.batchTracked,
        baseUnit: row.baseUnit, altUnit: row.altUnit, altToBase: row.altToBase,
      }];
    });
  }

  async function save(thenPost) {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body = {
        movementKind: kind, date, warehouse,
        toWarehouse: isTransfer ? toWarehouse : null,
        counterparty: counterparty.trim(), ref: ref.trim(), note: note.trim(),
        lines: lines.map((l) => ({
          sku: l.sku, qty: Number(l.qty), unit: l.unit || "",
          unitCost: Number(l.unitCost) || 0,
          batchNo: l.batchNo.trim(), expiresOn: l.expiresOn || null,
        })),
      };
      const saved = draft
        ? await warehouseApi.updateVoucher(draft.id, body)
        : await warehouseApi.createVoucher(body);
      // از اینجا هر ذخیرهٔ دوباره همین پیش‌نویس را اصلاح می‌کند، نه حوالهٔ تازه — اگر ثبت نهایی رد شود
      // و کاربر دوباره بزند، حوالهٔ تکراری ساخته نمی‌شود.
      setDraft(saved);
      if (thenPost) {
        try {
          await warehouseApi.postVoucher(saved.id);
        } catch (e) {
          if (e.data?.shortage) { setShortage(e.data.shortage); return; }
          alert(`حوالهٔ ${saved.number} به‌صورت «پیش‌نویس» ذخیره شد ولی ثبت نهایی نشد و روی موجودی اثری ندارد:\n\n${e.message}\n\nانبار یا مقدارها را اصلاح کنید و دوباره «ثبت نهایی» بزنید.`);
          return;
        }
        onSaved(`حوالهٔ ${saved.number} ثبت نهایی شد ✓`);
      } else {
        onSaved(`حوالهٔ ${saved.number} ذخیره شد ✓`);
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide">
        <div className="board-h">{voucher ? `ویرایش حوالهٔ ${voucher.number}` : "حوالهٔ جدید"}</div>

        <div className="row2">
          <label className="fld"><span>نوع حواله</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {VOUCHER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <label className="fld"><span>{isTransfer ? "از انبار (مبدأ)" : "انبار"}</span>
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row2">
          <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
          {isTransfer ? (
            <label className="fld"><span>به انبار (مقصد)</span>
              <select value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)}>
                <option value="">— انتخاب کنید —</option>
                {warehouses.filter((w) => w.id !== warehouse).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="fld">
              <span>{info.person
                ? (inbound ? "برگرداننده (شخص یا بخش)" : "تحویل‌گیرنده (شخص یا بخش)")
                : inbound ? "تأمین‌کننده / فرستنده" : "تحویل‌گیرنده / مقصد"}</span>
              <input value={counterparty} list={info.person ? "vc-people" : undefined}
                placeholder={info.person ? "مثلاً: محمدرضا نیازی — مونتاژ" : ""}
                onChange={(e) => setCounterparty(e.target.value)} />
              {info.person && <datalist id="vc-people">{people.map((n) => <option key={n} value={n} />)}</datalist>}
            </label>
          )}
        </div>
        {isTransfer && (
          <div className="unit-hint">
            {srcName && dstName
              ? <>کالا از <b>{srcName}</b> کم و به <b>{dstName}</b> اضافه می‌شود.</>
              : "یک حواله هر دو طرف را ثبت می‌کند: از مبدأ کم و به مقصد اضافه می‌شود."}
          </div>
        )}
        <label className="fld"><span>شمارهٔ فاکتور یا بارنامه (اختیاری)</span>
          <input value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>

        <div className="items-hd">اقلام حواله</div>
        {lines.length === 0 && <div className="muted sm2" style={{ marginBottom: 8 }}>هنوز کالایی اضافه نشده.</div>}
        {lines.map((l, i) => (
          <div className="item-row" key={l.key}>
            <div className="item-num">{faDigits(i + 1)}</div>
            <div className="item-body">
              <div className="vc-line-name">{l.label}</div>
              <div className="row3">
                <label className="fld sm"><span>مقدار</span>
                  <input type="number" inputMode="decimal" value={l.qty}
                    onChange={(e) => setLine(l.key, "qty", e.target.value)} placeholder="۰" />
                </label>
                <label className="fld sm"><span>واحد</span>
                  <select value={l.unit} onChange={(e) => setLine(l.key, "unit", e.target.value)}
                    disabled={!l.altUnit}>
                    <option value="">{l.baseUnit || "واحد اصلی"}</option>
                    {l.altUnit && <option value={l.altUnit}>{l.altUnit}</option>}
                  </select>
                </label>
                {inbound && !info.person && (
                  <label className="fld sm"><span>قیمت خرید واحد</span>
                    <input type="number" inputMode="numeric" value={l.unitCost}
                      onChange={(e) => setLine(l.key, "unitCost", e.target.value)} />
                  </label>
                )}
                {inbound && l.batchTracked && (
                  <label className="fld sm"><span>شمارهٔ بچ</span>
                    <input value={l.batchNo} onChange={(e) => setLine(l.key, "batchNo", e.target.value)} />
                  </label>
                )}
              </div>
            </div>
            <button className="item-del" onClick={() => delLine(l.key)}>×</button>
          </div>
        ))}
        <button className="add-row" onClick={() => setPicking(true)}>+ افزودن کالا</button>

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="ghost" disabled={!valid || busy} onClick={() => save(false)}>
            ذخیرهٔ پیش‌نویس
          </button>
          {canPost && (
            <button className="submit" style={{ width: "auto", margin: 0 }}
              disabled={!valid || busy} onClick={() => setConfirming(true)}>
              {busy ? "…" : "ذخیره و ثبت نهایی"}
            </button>
          )}
        </div>
        <div className="muted sm2" style={{ marginTop: 6 }}>
          پیش‌نویس روی موجودی اثری ندارد. با «ثبت نهایی» موجودی تغییر می‌کند و حواله قفل می‌شود.
        </div>

        {picking && <SkuPicker warehouse={warehouse} onPick={addPicked} onClose={() => setPicking(false)} />}
        {confirming && (
          <PostConfirmDialog busy={busy}
            summary={{
              number: draft?.number, kind: info.label, inbound, warehouse: srcName,
              toWarehouse: isTransfer ? dstName : "", counterparty: counterparty.trim(), date,
              lines: lines.map((l) => ({ name: l.label, qty: l.qty, unit: l.unit || l.baseUnit })),
            }}
            onConfirm={async () => { await save(true); setConfirming(false); }}
            onClose={() => setConfirming(false)} />
        )}
        {shortage && <ShortageDialog data={shortage} onClose={() => setShortage(null)} />}
      </div>
    </div>
  );
}

/** انتخاب کالا برای افزودن به حواله. */
/* ---- پنجرهٔ تأیید و پیام داخل سامانه، به‌جای confirm/alert مرورگر ---- */
let openConfirm = null;   // ConfirmHost این را می‌گذارد

/** `if (!(await askConfirm({ title, message, confirmLabel, danger }))) return;` */
function askConfirm(opts) {
  if (!openConfirm) return Promise.resolve(window.confirm([opts.title, opts.message].filter(Boolean).join("\n")));
  return new Promise((resolve) => openConfirm({ ...opts, resolve }));
}
const showMessage = (opts) => askConfirm({ ...opts, alertOnly: true });

function ConfirmHost() {
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

/** خلاصهٔ حوالهٔ ذخیره‌شده برای پنجرهٔ تأیید ثبت نهایی. */
const voucherSummary = (v) => ({
  number: v.number, kind: v.movementKindLabel, inbound: v.isInbound, warehouse: v.warehouseName,
  toWarehouse: v.toWarehouseName || "", counterparty: v.counterparty, date: v.date,
  lines: (v.lines || []).map((l) => ({
    name: [l.productName, l.packSize].filter(Boolean).join(" · "), qty: l.qty, unit: l.unit || l.baseUnit,
  })),
});

/** تأیید ثبت نهایی حواله — به‌جای پنجرهٔ confirm مرورگر. انبار درشت دیده می‌شود تا اشتباهش پیش از ثبت پیدا شود. */
function PostConfirmDialog({ summary: s, busy, onConfirm, onClose }) {
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog short-dialog" role="dialog" aria-labelledby="post-title">
        <div className="short-head">
          <span className="short-icon post" aria-hidden="true">✓</span>
          <div>
            <div className="short-title" id="post-title">
              ثبت نهایی {s.number ? `حوالهٔ ${faDigits(s.number)}` : "حواله"}
            </div>
            <div className="muted sm2">پس از ثبت، موجودی انبار تغییر می‌کند و حواله دیگر ویرایش نمی‌شود.</div>
          </div>
        </div>
        <div className="post-facts">
          <div><span>نوع</span><b>{s.kind}</b></div>
          <div className="post-wh"><span>{s.inbound ? "به انبار" : "از انبار"}</span><b>{s.warehouse}</b></div>
          {s.toWarehouse && <div className="post-wh"><span>به انبار</span><b>{s.toWarehouse}</b></div>}
          {s.counterparty && <div><span>طرف مقابل</span><b>{s.counterparty}</b></div>}
          {s.date && <div><span>تاریخ</span><b>{jShort(s.date)}</b></div>}
        </div>
        <div className="tbl-scroll post-lines">
          <table className="print-table wh-table short-table">
            <thead><tr><th>#</th><th>کالا</th><th>مقدار</th></tr></thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="wh-name"><span dir="auto">{l.name}</span></td>
                  <td className="wh-qty">{faDigits(Number(l.qty))} {l.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy} onClick={onConfirm}>
            {busy ? "در حال ثبت…" : "ثبت نهایی"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** «ثبت نهایی نشد»: کمبود هر کالا و موجودی‌اش در انبارهای دیگر — به‌جای پنجرهٔ خام مرورگر. */
function ShortageDialog({ data, onClose, onEdit }) {
  const fmt = (n) => faDigits(Number(Number(n).toFixed(3)));
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog short-dialog" role="alertdialog" aria-labelledby="short-title">
        <div className="short-head">
          <span className="short-icon" aria-hidden="true">!</span>
          <div>
            <div className="short-title" id="short-title">حوالهٔ {faDigits(data.voucher)} ثبت نهایی نشد</div>
            <div className="muted sm2">
              موجودی «{data.warehouse}» برای این کالاها کافی نیست. حواله پیش‌نویس مانده و روی موجودی اثری ندارد.
            </div>
          </div>
        </div>
        {data.wrongWarehouse && (
          <div className="notice warn short-hint">
            همهٔ این کالاها در انبار دیگری موجودند؛ احتمالاً انبار حواله اشتباه انتخاب شده.
            حواله را ویرایش کنید و انبار را عوض کنید.
          </div>
        )}
        <div className="tbl-scroll">
          <table className="print-table wh-table short-table">
            <thead><tr><th>کالا</th><th>لازم</th><th>موجودی این انبار</th><th>انبارهای دیگر</th></tr></thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i}>
                  <td className="wh-name">
                    <span dir="auto">{it.name}</span>
                    {it.siteName && it.siteName !== it.name && <div className="wh-sub"><span dir="auto">{it.siteName}</span></div>}
                  </td>
                  <td className="wh-qty">{fmt(it.need)} {it.unit}</td>
                  <td className="wh-qty low">{fmt(it.have)}</td>
                  <td>
                    {it.elsewhere.length
                      ? it.elsewhere.map((o) => <div key={o.warehouse}>{o.warehouse}: <b>{fmt(o.qty)}</b></div>)
                      : <span className="wh-flag haz">در هیچ انباری نیست</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          {onEdit && <button className="act edit" onClick={onEdit}>ویرایش حواله</button>}
          <button className="ghost" onClick={onClose}>بستن</button>
        </div>
      </div>
    </div>
  );
}

function SkuPicker({ warehouse, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await warehouseApi.stock({ q: q.trim(), warehouse, page_size: 25 });
        setRows(d.results || []);
      } catch { /* پیام خطا لازم نیست؛ فهرست خالی می‌ماند */ } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, warehouse]);

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">انتخاب کالا</div>
        <input className="wh-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="نام، کد، شناسه، گرید یا شید…" />
        <div className="pick-list">
          {loading ? <div className="empty">…</div>
            : rows.length === 0 ? <div className="empty">چیزی پیدا نشد.</div>
            : rows.map((r) => {
              const here = (r.stock || []).find((s) => s.warehouse === warehouse);
              return (
                <button key={r.id} className="pick-row" onClick={() => { onPick(r); onClose(); }}>
                  <span className="pick-name">{r.productName}</span>
                  <span className="pick-sub">
                    {r.siteName && r.siteName !== r.productName ? <span dir="auto">سایت: {r.siteName} · </span> : null}
                    {r.packSize}{r.grit ? " · " + r.grit : ""}{r.shade ? " · " + r.shade : ""}
                    {" · شناسه "}{r.packageId}
                    {here ? ` · موجودی ${here.onHand} ${r.baseUnit}` : ""}
                  </span>
                </button>
              );
            })}
        </div>
        <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div>
      </div>
    </div>
  );
}

/** برگهٔ چاپی حواله. */
function VoucherDoc({ voucher, onClose }) {
  const v = voucher;
  const total = (v.lines || []).reduce((a, l) => a + (l.qty || 0), 0);
  const totalValue = (v.lines || []).reduce((a, l) => a + (l.qty || 0) * (l.unitCost || 0), 0);
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet wide">
        <DocLetterhead title={v.movementKindLabel} subtitle={`شمارهٔ ${v.number}`} />
        <div className="doc-info">
          <div><span>تاریخ</span><b>{jLong(v.date)}</b></div>
          <div><span>انبار</span><b>{v.warehouseName}</b></div>
          <div>
            <span>{v.movementKind === "return_person" ? "برگرداننده" : v.isInbound ? "تأمین‌کننده" : "تحویل‌گیرنده"}</span>
            <b>{v.counterparty || "—"}</b>
          </div>
          <div><span>شمارهٔ فاکتور</span><b>{v.ref || "—"}</b></div>
          <div><span>وضعیت</span><b>{v.statusLabel}</b></div>
          <div><span>ثبت‌کننده</span><b>{v.createdBy}</b></div>
        </div>

        <table className="doc-table">
          <thead>
            <tr>
              <th>#</th><th>کالا</th><th>بسته</th><th>گرید/شید</th><th>شناسه</th>
              <th>مقدار</th>{v.isInbound && <><th>قیمت واحد</th><th>مبلغ</th></>}<th>بچ</th>
            </tr>
          </thead>
          <tbody>
            {(v.lines || []).map((l, i) => (
              <tr key={l.id}>
                <td>{faDigits(i + 1)}</td>
                <td className="nm">{l.productName}</td>
                <td className="nm">{l.packSize}</td>
                <td className="nm">{[l.grit, l.shade].filter(Boolean).join(" / ") || "—"}</td>
                <td>{l.packageId}</td>
                <td className="net">{faDigits(l.qty)}</td>
                {v.isInbound && <>
                  <td>{l.unitCost ? faDigits(Math.round(l.unitCost)) : "—"}</td>
                  <td>{l.unitCost ? faDigits(Math.round(l.qty * l.unitCost)) : "—"}</td>
                </>}
                <td className="nm">{l.batchNo || "—"}</td>
              </tr>
            ))}
            <tr className="tot">
              <td colSpan={5}>جمع — {faDigits((v.lines || []).length)} قلم</td>
              <td className="net">{faDigits(total)}</td>
              {v.isInbound && <><td>—</td><td className="net">{faDigits(Math.round(totalValue))}</td></>}
              <td>—</td>
            </tr>
          </tbody>
        </table>

        {v.note && <p className="rep-notes" style={{ marginTop: 12 }}><b>توضیح:</b> {v.note}</p>}
        <div className="doc-sign">
          <div>تحویل‌دهنده: ......................................</div>
          <div>تحویل‌گیرنده: ......................................</div>
          <div>انباردار: ......................................</div>
        </div>
        <div className="doc-foot">سامانهٔ دیواژ · {v.status === "posted" ? "ثبت نهایی شده" : "پیش‌نویس — روی موجودی اثری ندارد"}</div>
      </div>
    </PrintableDoc>
  );
}

/* ---- انبارگردانی: برگهٔ شمارش چندقلمی ---- */
function CountsPane() {
  const can = useCan();
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(() => warehouseApi.counts()
    .then((d) => { setList(d); setErr(""); })
    .catch((e) => { setErr(e.message); setList((p) => p || []); }), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card">
        <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
          برای شمارش دوره‌ای، برگه‌ای برای یک انبار (یا فقط یک برند یا دسته) بسازید، برگهٔ چاپی را دست انباردار بدهید و
          عدد شمرده‌شدهٔ هر کالا را وارد کنید. کسری و اضافه خودکار حساب می‌شود و با «ثبت نهایی» موجودی همان‌جا اصلاح می‌شود.
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginBottom: 0 }}>
          {can("warehouse.voucher") && (
            <button className="submit" style={{ width: "auto", margin: 0, flex: "0 0 auto" }}
              onClick={() => setCreating(true)}>+ برگهٔ انبارگردانی</button>
          )}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {list === null ? <div className="empty">در حال بارگذاری…</div>
        : list.length === 0 ? <div className="empty">هنوز برگهٔ انبارگردانی ساخته نشده.</div> : (
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead>
              <tr><th>شماره</th><th>عنوان</th><th>تاریخ</th><th>انبار</th><th>محدوده</th>
                <th>شمارش</th><th>نتیجه</th><th>وضعیت</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.status === "draft" ? "vc-draft" : ""}>
                  <td className="vc-num">{faDigits(c.number)}</td>
                  <td className="wh-name">{c.title}</td>
                  <td>{jShort(c.date)}</td>
                  <td>{c.warehouseName}</td>
                  <td>{[c.brand, c.category].filter(Boolean).join(" · ") || "همهٔ کالاها"}</td>
                  <td>{faDigits(c.countedCount)} از {faDigits(c.lineCount)}</td>
                  <td>
                    {c.status !== "posted" ? "—" : (c.shortCount || c.overCount) ? (
                      <>
                        {c.shortCount ? <span className="as-chip bad">{faDigits(c.shortCount)} کسری</span> : null}{" "}
                        {c.overCount ? <span className="as-chip ok">{faDigits(c.overCount)} اضافه</span> : null}
                      </>
                    ) : <span className="as-chip ok">بی‌مغایرت</span>}
                  </td>
                  <td>
                    <span className={c.status === "posted" ? "status-chip vc-posted" : "status-chip vc-open"}>
                      {c.statusLabel}
                    </span>
                  </td>
                  <td className="wh-actions">
                    <button className="link-btn" onClick={() => setOpenId(c.id)}>
                      {c.status === "draft" && can("warehouse.voucher") ? "ادامهٔ شمارش" : "نمایش"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewCountDialog onClose={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false); load(); setOpenId(d.id);
            flash(`برگهٔ ${faDigits(d.number)} با ${faDigits(d.lineCount)} قلم ساخته شد ✓`);
          }} />
      )}
      {openId && (
        <CountSheetDialog id={openId} onClose={() => { setOpenId(null); load(); }}
          onChanged={(t) => { flash(t); load(); }} />
      )}
    </>
  );
}

function NewCountDialog({ onClose, onCreated }) {
  const j = isoToJ(todayIso());
  const [title, setTitle] = useState(`انبارگردانی ${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`);
  const [date, setDate] = useState(todayIso());
  const [warehouses, setWarehouses] = useState([]);
  const [meta, setMeta] = useState({ brands: [], categories: [] });
  const [warehouse, setWarehouse] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    warehouseApi.list()
      .then((w) => {
        setWarehouses(w);
        setWarehouse((p) => p || (w.find((x) => !x.suppliesWorkshop) || w[0])?.id || "");
      })
      .catch((e) => setErr(e.message));
    warehouseApi.meta({}).then(setMeta).catch(() => { /* فیلتر اختیاری است */ });
  }, []);

  async function create() {
    if (busy || !title.trim() || !warehouse) return;
    setBusy(true); setErr("");
    try {
      onCreated(await warehouseApi.createCount({ title: title.trim(), date, warehouse, brand, category, includeZero }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog" role="dialog" aria-labelledby="nc-title">
        <div className="board-h" id="nc-title">برگهٔ انبارگردانی جدید</div>
        <label className="fld"><span>عنوان</span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row2">
          <label className="fld"><span>تاریخ شمارش</span><JalaliPicker value={date} onChange={setDate} /></label>
          <label className="fld"><span>انبار</span>
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row2">
          <label className="fld"><span>برند (اختیاری)</span>
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">همهٔ برندها</option>
              {(meta.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="fld"><span>دسته (اختیاری)</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">همهٔ دسته‌ها</option>
              {(meta.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            {" "}کالاهای بدون موجودی هم در برگه بیاید
          </label>
        </div>
        <div className="muted sm2" style={{ lineHeight: 1.9 }}>
          {includeZero
            ? "همهٔ کالاهای این انبار می‌آیند؛ برای برگهٔ کوچک‌تر برند یا دسته را انتخاب کنید."
            : "فقط کالاهایی که در این انبار موجودی دارند می‌آیند. کالای پیدا‌شده‌ای که در برگه نیست را بعداً می‌توانید اضافه کنید."}
          {" "}مغایرت با موجودی دفتر در تاریخ شمارش سنجیده می‌شود.
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={busy || !title.trim() || !warehouse} onClick={create}>{busy ? "…" : "ساختن برگه"}</button>
        </div>
      </div>
    </div>
  );
}

/** نوشتن شمارش هر قلم، دیدن مغایرت و ثبت نهایی. */
function CountSheetDialog({ id, onClose, onChanged }) {
  const can = useCan();
  const [sheet, setSheet] = useState(null);
  const [vals, setVals] = useState({});          // شناسهٔ ردیف ← { c: شمارش، n: یادداشت }
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(false);
  const [printing, setPrinting] = useState(false);

  const seed = (d) => {
    setSheet(d);
    setVals(Object.fromEntries(d.lines.map((l) => [l.id, {
      c: l.countedQty == null ? "" : String(l.countedQty), n: l.note || "",
    }])));
  };
  useEffect(() => { warehouseApi.count(id).then(seed).catch((e) => setErr(e.message)); }, [id]);

  if (!sheet) {
    return (
      <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wh-dialog">
          {err ? <div className="err" role="alert">{err}</div> : <div className="empty">در حال بارگذاری…</div>}
          <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div>
        </div>
      </div>
    );
  }

  const posted = sheet.status === "posted";
  const editable = !posted && can("warehouse.voucher");
  const withCost = sheet.lines.some((l) => l.unitCost !== undefined);
  const rows = sheet.lines.map((l) => {
    const v = vals[l.id] || { c: "", n: "" };
    const c = v.c === "" ? null : Number(v.c);
    const bad = c != null && (Number.isNaN(c) || c < 0);
    const diff = posted ? l.diff : (c == null || bad ? null : Math.round((c - l.currentQty) * 1000) / 1000);
    const dirty = !posted && (v.c !== (l.countedQty == null ? "" : String(l.countedQty)) || v.n !== (l.note || ""));
    return { ...l, v, c, bad, diff, dirty };
  });
  const dirty = rows.filter((r) => r.dirty);
  const anyBad = rows.some((r) => r.bad);
  const counted = rows.filter((r) => (posted ? r.countedQty != null : r.c != null && !r.bad));
  const short = counted.filter((r) => r.diff < 0);
  const over = counted.filter((r) => r.diff > 0);
  const money = (list) => list.reduce((a, r) => a + Math.abs(r.diff || 0) * (r.unitCost || 0), 0);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    const hit = filter === "all" || (filter === "uncounted"
      ? (posted ? r.countedQty == null : r.c == null)
      : Boolean(r.diff));
    return hit && (!needle || [r.name, r.code, r.brand, r.shelf, r.shade]
      .some((x) => (x || "").toLowerCase().includes(needle)));
  });

  const run = async (fn) => {
    if (busy) return;
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  async function save(quiet) {
    if (anyBad) throw new Error("شمارش باید عدد صفر یا بیشتر باشد؛ خانه‌های قرمز را درست کنید.");
    if (!dirty.length) return;
    const d = await warehouseApi.updateCount(sheet.id, {
      lines: dirty.map((r) => ({ id: r.id, countedQty: r.v.c === "" ? null : Number(r.v.c), note: r.v.n })),
    });
    seed(d);
    if (!quiet) onChanged("شمارش‌ها ذخیره شد ✓");
  }
  async function post() {
    if (anyBad) { setErr("شمارش باید عدد صفر یا بیشتر باشد؛ خانه‌های قرمز را درست کنید."); return; }
    const ok = await askConfirm({
      title: `ثبت نهایی ${faDigits(sheet.number)}`,
      message: `${faDigits(counted.length)} قلم از ${faDigits(rows.length)} قلم شمرده شده: `
        + `${faDigits(short.length)} کسری و ${faDigits(over.length)} اضافه در «${sheet.warehouseName}» اصلاح می‌شود.`
        + (rows.length - counted.length ? `\n${faDigits(rows.length - counted.length)} قلمِ شمرده‌نشده دست نمی‌خورد.` : "")
        + "\nپس از ثبت، برگه دیگر ویرایش نمی‌شود.",
      confirmLabel: "ثبت نهایی",
    });
    if (!ok) return;
    run(async () => {
      await save(true);
      seed(await warehouseApi.postCount(sheet.id));
      onChanged(`${faDigits(sheet.number)} ثبت نهایی شد و موجودی اصلاح شد ✓`);
    });
  }
  async function remove() {
    const ok = await askConfirm({
      title: `پاک کردن ${faDigits(sheet.number)}`,
      message: "برگه و همهٔ شمارش‌های نوشته‌شده پاک می‌شود.\nاین کار برگشت ندارد.",
      confirmLabel: "پاک کن", danger: true,
    });
    if (!ok) return;
    run(async () => { await warehouseApi.removeCount(sheet.id); onChanged("برگهٔ انبارگردانی پاک شد"); onClose(); });
  }
  async function closeDialog() {
    if (dirty.length) {
      const ok = await askConfirm({
        title: "شمارش‌های ذخیره‌نشده",
        message: `${faDigits(dirty.length)} ردیف تغییر کرده و ذخیره نشده است.`,
        confirmLabel: "بستن بدون ذخیره", danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }
  const addSku = (row) => run(async () => {
    await save(true);
    seed(await warehouseApi.addCountLine(sheet.id, row.id));
    onChanged(`«${row.productName}» به برگه اضافه شد`);
  });
  const nextInput = (e, i) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = document.querySelector(`[data-cnt="${i + 1}"]`);
    if (el) el.focus();
  };
  function exportXlsx() {
    const head = ["#", "کالا", "شناسه", "برند", "بسته", "قفسه", "واحد", "موجودی دفتر", "شمارش", "مغایرت",
      ...(withCost ? ["قیمت خرید", "مبلغ مغایرت"] : []), "یادداشت"];
    const body = rows.map((r, i) => [
      i + 1, r.name, r.code, r.brand, r.packSize, r.shelf, r.baseUnit, r.currentQty,
      (posted ? r.countedQty : r.c) ?? "", r.diff ?? "",
      ...(withCost ? [r.unitCost || 0, r.diff ? Math.abs(r.diff) * (r.unitCost || 0) : 0] : []), r.v.n,
    ]);
    saveSheet(sheet.number, "انبارگردانی", [head, ...body]);
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && closeDialog()}>
      <div className="wh-dialog cnt-dialog" role="dialog" aria-labelledby="cnt-title">
        <div className="user-dialog-hd">
          <div className="ud-name">
            <b id="cnt-title">{sheet.title}</b>
            <small>
              {faDigits(sheet.number)} · {jLong(sheet.date)} · {sheet.warehouseName}
              {[sheet.brand, sheet.category].filter(Boolean).length ? ` · ${[sheet.brand, sheet.category].filter(Boolean).join(" · ")}` : ""}
              {" · "}{sheet.createdBy}
            </small>
          </div>
          <span className={posted ? "as-chip ok" : "as-chip info"}>{sheet.statusLabel}</span>
        </div>

        <div className="asset-flags">
          <span>{faDigits(rows.length)} قلم</span>
          <span>شمرده‌شده: <b>{faDigits(counted.length)}</b></span>
          <span>کسری: <b className="diff-neg">{faDigits(short.length)}</b>
            {withCost && short.length ? ` (${faRial(money(short))} ریال)` : ""}</span>
          <span>اضافه: <b className="diff-pos">{faDigits(over.length)}</b>
            {withCost && over.length ? ` (${faRial(money(over))} ریال)` : ""}</span>
          {posted && sheet.postedBy && <span>ثبت نهایی: {sheet.postedBy}</span>}
        </div>
        {editable && (
          <div className="muted sm2" style={{ margin: "-4px 2px 10px", lineHeight: 1.9 }}>
            خانهٔ شمارشِ خالی یعنی آن قلم شمرده نشده و دست نمی‌خورد. با Enter به ردیف بعد بروید.
          </div>
        )}

        <div className="cnt-tools">
          <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجو در برگه: نام، شناسه، برند یا قفسه…" />
          <div className="seg-row" style={{ margin: 0 }} role="tablist">
            {[["all", "همه"], ["uncounted", "شمرده‌نشده"], ["diff", "مغایرت‌دار"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "seg on" : "seg"}
                onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="tbl-scroll cnt-scroll">
          <table className="print-table wh-table cnt-table">
            <thead>
              <tr><th>#</th><th>کالا</th><th>قفسه</th><th>موجودی دفتر</th><th>شمارش</th><th>مغایرت</th>
                {withCost && <th>مبلغ مغایرت</th>}<th>یادداشت</th></tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id} className={r.diff < 0 ? "cnt-short" : r.diff > 0 ? "cnt-over" : ""}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="wh-name">
                    {r.name}
                    <div className="wh-sub">
                      <span>شناسه {r.code}</span>{r.brand && <span>{r.brand}</span>}{r.packSize && <span>{r.packSize}</span>}
                    </div>
                  </td>
                  <td>{r.shelf || "—"}</td>
                  <td className="wh-qty">
                    {fq(r.currentQty)} <small className="wh-unit">{r.baseUnit}</small>
                    {r.moved && <div className="wh-sub"><span>پس از ساخت برگه گردش خورده</span></div>}
                  </td>
                  <td>
                    {editable ? (
                      <input className={r.bad ? "cnt-in bad" : "cnt-in"} type="number" min="0" step="any"
                        inputMode="decimal" data-cnt={i} value={r.v.c} aria-label={`شمارش ${r.name}`}
                        onKeyDown={(e) => nextInput(e, i)}
                        onChange={(e) => setVals((p) => ({ ...p, [r.id]: { ...p[r.id], c: e.target.value } }))} />
                    ) : r.countedQty == null ? <span className="muted">شمرده نشد</span> : <b>{fq(r.countedQty)}</b>}
                  </td>
                  <td className={r.diff < 0 ? "wh-qty diff-neg" : r.diff > 0 ? "wh-qty diff-pos" : "wh-qty"}>
                    {r.diff == null ? "—" : r.diff === 0 ? "✓" : `${r.diff > 0 ? "+" : "−"}${fq(Math.abs(r.diff))}`}
                  </td>
                  {withCost && <td>{r.diff && r.unitCost ? faRial(Math.abs(r.diff) * r.unitCost) : "—"}</td>}
                  <td>
                    {editable ? (
                      <input className="cnt-note" value={r.v.n} aria-label={`یادداشت ${r.name}`}
                        onChange={(e) => setVals((p) => ({ ...p, [r.id]: { ...p[r.id], n: e.target.value } }))} />
                    ) : (r.note || "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <div className="empty">ردیفی با این فیلتر نیست.</div>}
        {editable && <button className="add-row" onClick={() => setPicking(true)}>+ کالایی که در برگه نیست</button>}

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row cnt-foot">
          <button className="ghost" onClick={closeDialog} disabled={busy}>بستن</button>
          <button className="ghost" onClick={() => setPrinting(true)}>چاپ برگه</button>
          <button className="ghost" onClick={exportXlsx}>اکسل</button>
          {editable && <button className="ghost" onClick={remove} disabled={busy}>پاک کردن</button>}
          {editable && (
            <button className="ghost" disabled={busy || !dirty.length} onClick={() => run(() => save(false))}>
              ذخیره{dirty.length ? ` (${faDigits(dirty.length)})` : ""}
            </button>
          )}
          {editable && can("warehouse.post") && (
            <button className="submit" onClick={post} disabled={busy}>{busy ? "…" : "ثبت نهایی"}</button>
          )}
        </div>

        {picking && <SkuPicker warehouse={sheet.warehouse} onPick={addSku} onClose={() => setPicking(false)} />}
        {printing && <CountPrintDoc sheet={sheet} onClose={() => setPrinting(false)} />}
      </div>
    </div>
  );
}

/** برگهٔ چاپی: پیش از شمارش بی موجودی دفتر (تا شمارنده تحت تأثیر نباشد)، پس از ثبت با نتیجه. */
function CountPrintDoc({ sheet, onClose }) {
  const posted = sheet.status === "posted";
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet wide">
        <DocLetterhead title={posted ? "نتیجهٔ انبارگردانی" : "برگهٔ شمارش انبار"} subtitle={faDigits(sheet.number)} />
        <div className="doc-info">
          <div><span>عنوان</span><b>{sheet.title}</b></div>
          <div><span>تاریخ شمارش</span><b>{jLong(sheet.date)}</b></div>
          <div><span>انبار</span><b>{sheet.warehouseName}</b></div>
          <div><span>محدوده</span><b>{[sheet.brand, sheet.category].filter(Boolean).join(" · ") || "همهٔ کالاها"}</b></div>
        </div>
        <table className="doc-table">
          <thead>
            <tr>
              <th>#</th><th>کالا</th><th>شناسه</th><th>قفسه</th><th>واحد</th>
              {posted ? <><th>دفتر</th><th>شمارش</th><th>مغایرت</th></> : <th>شمارش</th>}
              <th>یادداشت</th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((l, i) => (
              <tr key={l.id}>
                <td>{faDigits(i + 1)}</td>
                <td className="nm">{l.name}{l.packSize ? ` · ${l.packSize}` : ""}</td>
                <td>{l.code}</td>
                <td className="nm">{l.shelf || ""}</td>
                <td className="nm">{l.baseUnit}</td>
                {posted ? (
                  <>
                    <td className="net">{fq(l.currentQty)}</td>
                    <td className="net">{l.countedQty == null ? "—" : fq(l.countedQty)}</td>
                    <td className="net">
                      {l.diff ? `${l.diff > 0 ? "+" : "−"}${fq(Math.abs(l.diff))}` : l.countedQty == null ? "—" : "✓"}
                    </td>
                  </>
                ) : <td className="cnt-blank" />}
                <td className="nm">{posted ? (l.note || "") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="doc-sign">
          <div>شمارنده: ......................................</div>
          <div>انباردار: ......................................</div>
          <div>تأیید مدیر: ......................................</div>
        </div>
        <div className="doc-foot">
          سامانهٔ دیواژ · {posted ? "ثبت نهایی شده" : "برگهٔ شمارش — موجودی دفتر عمداً چاپ نشده است"}
        </div>
      </div>
    </PrintableDoc>
  );
}

/* ---- گردش کالا: اول دوره، ورود، خروج و پایان دوره ---- */
function TurnoverPane() {
  const canCost = useCan()("warehouse.cost");
  const [warehouses, setWarehouses] = useState([]);
  const [meta, setMeta] = useState({ brands: [], categories: [] });
  const [wh, setWh] = useState("");
  const [from, setFrom] = useState(jYearStart);
  const [to, setTo] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [kardexFor, setKardexFor] = useState(null);

  useEffect(() => {
    warehouseApi.list().then(setWarehouses).catch(() => { /* فیلتر انبار اختیاری است */ });
    warehouseApi.meta({}).then(setMeta).catch(() => { /* فیلتر برند اختیاری است */ });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let live = true;
    setData(null);
    warehouseApi.turnover({ warehouse: wh, from, to, brand, category, q: qd, all: all ? 1 : "" })
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) { setErr(e.message); setData({ rows: [], totals: {} }); } });
    return () => { live = false; };
  }, [wh, from, to, brand, category, qd, all]);

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const whName = warehouses.find((w) => w.id === wh)?.name || "همهٔ انبارها";
  const shown = rows.slice(0, 500);

  function exportXlsx() {
    const head = ["کالا", "شناسه", "برند", "دسته", "بسته", "واحد", "اول دوره", "ورود", "خروج", "پایان دوره",
      ...(canCost ? ["قیمت خرید", "ارزش پایان دوره"] : [])];
    saveSheet("گردش-کالا", "گردش کالا", [
      [`گردش کالا — ${whName} — از ${from ? jShort(from) : "ابتدا"} تا ${to ? jShort(to) : "امروز"}`],
      head,
      ...rows.map((r) => [r.name, r.code, r.brand, r.category, r.packSize, r.baseUnit,
        r.opening, r.in, r.out, r.closing, ...(canCost ? [r.cost || 0, r.value || 0] : [])]),
    ]);
  }

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(totals.items ?? 0)}</b><span>کالا در این بازه</span></div>
        <div className="stat"><b>{faDigits(totals.withIn ?? 0)}</b><span>ورود داشته</span></div>
        <div className="stat"><b>{faDigits(totals.withOut ?? 0)}</b><span>خروج داشته</span></div>
        {canCost && <div className="stat"><b>{faRial(totals.value ?? 0)}</b><span>ارزش پایان دوره (ریال)</span></div>}
      </div>

      <div className="card">
        <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
          برای هر کالا در بازهٔ انتخابی: موجودی اول دوره، جمع ورود، جمع خروج و موجودی پایان دوره.
          با «کاردکس» همهٔ گردش‌های آن کالا با ماندهٔ پس از هر ردیف دیده می‌شود.
          {!wh && " وقتی همهٔ انبارها انتخاب است، انتقال بین انبارها هم در ورود و هم در خروج شمرده می‌شود."}
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام کالا، شناسه یا کد…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">همهٔ انبارها</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {(meta.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">همهٔ دسته‌ها</option>
            {(meta.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {" "}کالاهای بی‌گردش در این بازه هم بیاید
          </label>
          <button className="link-btn" disabled={!rows.length} onClick={exportXlsx}>📊 خروجی اکسل</button>
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {data === null ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? <div className="empty">در این بازه گردشی ثبت نشده.</div> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr><th>کالا</th><th>برند</th><th>واحد</th><th>اول دوره</th><th>ورود</th><th>خروج</th><th>پایان دوره</th>
                  {canCost && <th>ارزش پایان دوره</th>}<th></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="wh-name">{r.name}
                      <div className="wh-sub"><span>شناسه {r.code}</span>{r.packSize && <span>{r.packSize}</span>}</div>
                    </td>
                    <td>{r.brand || "—"}</td>
                    <td>{r.baseUnit}</td>
                    <td className="wh-qty">{fq(r.opening)}</td>
                    <td className="wh-qty diff-pos">{r.in ? fq(r.in) : "—"}</td>
                    <td className="wh-qty diff-neg">{r.out ? fq(r.out) : "—"}</td>
                    <td className={r.closing < 0 ? "wh-qty low" : "wh-qty total"}>{fq(r.closing)}</td>
                    {canCost && <td>{r.value ? faRial(r.value) : "—"}</td>}
                    <td className="wh-actions">
                      <button className="link-btn" onClick={() => setKardexFor(r)}>کاردکس</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length && (
            <div className="muted sm2" style={{ marginTop: 6 }}>
              {faDigits(shown.length)} ردیف از {faDigits(rows.length)} ردیف نشان داده شد؛ برای همه خروجی اکسل بگیرید یا فیلتر کنید.
            </div>
          )}
        </>
      )}

      {kardexFor && (
        <KardexDialog sku={kardexFor} warehouses={warehouses} warehouse={wh} from={from} to={to}
          onClose={() => setKardexFor(null)} />
      )}
    </>
  );
}

/* ---- کالای دست اشخاص: تحویل به شخص منهای برگشت ---- */
function HoldersPane({ onVoucher }) {
  const can = useCan();
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let live = true;
    setData(null);
    warehouseApi.holders({ q: qd, all: all ? 1 : "" })
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) { setErr(e.message); setData({ people: [] }); } });
    return () => { live = false; };
  }, [qd, all]);

  const people = data?.people || [];
  function exportXlsx() {
    saveSheet("کالای-دست-اشخاص", "دست اشخاص", [
      ["شخص", "کالا", "شناسه", "واحد", "تحویل", "برگشت", "دست او", "آخرین تحویل"],
      ...people.flatMap((p) => p.items.map((i) => [p.name, i.name, i.code, i.baseUnit,
        i.issued, i.returned, i.holding, i.lastIssued ? jShort(i.lastIssued) : ""])),
    ]);
  }

  return (
    <>
      <div className="card">
        <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
          با حوالهٔ «تحویل به شخص»، کالا (ابزار، لوازم یا مواد) به نام یک نفر یا یک بخش از انبار خارج می‌شود و با
          «برگشت از شخص» برمی‌گردد. اینجا دیده می‌شود همین حالا چه چیزی دست چه کسی است.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام شخص یا نام کالا…" />
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {" "}کسانی که همه را برگردانده‌اند هم بیاید
          </label>
          {can("warehouse.voucher") && (
            <button className="link-btn" onClick={() => onVoucher({ movementKind: "issue_person" })}>
              + تحویل کالا به شخص
            </button>
          )}
          <button className="link-btn" disabled={!people.length} onClick={exportXlsx}>📊 خروجی اکسل</button>
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {data === null ? <div className="empty">در حال بارگذاری…</div>
        : people.length === 0 ? (
          <div className="empty">{qd ? "کسی با این جست‌وجو پیدا نشد." : "الان کالایی دست کسی نیست."}</div>
        ) : (
        <div className="holder-list">
          {people.map((p) => {
            const holding = p.items.filter((i) => i.holding > 0);
            return (
              <div className="card holder-card" key={p.name}>
                <div className="holder-hd">
                  <span className="avatar">{p.name.trim().charAt(0)}</span>
                  <div className="ud-name">
                    <b>{p.name}</b>
                    <small>{holding.length ? `${faDigits(holding.length)} قلم دست اوست` : "همه را برگردانده"}</small>
                  </div>
                  {can("warehouse.voucher") && holding.length > 0 && (
                    <button className="ghost" onClick={() => onVoucher({
                      movementKind: "return_person", counterparty: p.name, warehouse: p.warehouse,
                      lines: holding.map((i) => ({
                        sku: i.sku, productName: i.name, packSize: i.packSize, qty: i.holding,
                        unit: "", baseUnit: i.baseUnit, altUnit: i.altUnit,
                      })),
                    })}>برگشت کالا</button>
                  )}
                  {can("warehouse.voucher") && (
                    <button className="link-btn" onClick={() => onVoucher({
                      movementKind: "issue_person", counterparty: p.name, warehouse: p.warehouse,
                    })}>تحویل تازه</button>
                  )}
                </div>
                <div className="tbl-scroll">
                  <table className="print-table wh-table">
                    <thead><tr><th>کالا</th><th>تحویل</th><th>برگشت</th><th>دست او</th><th>آخرین تحویل</th></tr></thead>
                    <tbody>
                      {p.items.map((i) => (
                        <tr key={i.sku}>
                          <td className="wh-name">{i.name}
                            <div className="wh-sub"><span>شناسه {i.code}</span>{i.packSize && <span>{i.packSize}</span>}</div>
                          </td>
                          <td className="wh-qty">{fq(i.issued)}</td>
                          <td className="wh-qty">{i.returned ? fq(i.returned) : "—"}</td>
                          <td className={i.holding > 0 ? "wh-qty total" : "wh-qty"}>
                            <b>{fq(i.holding)}</b> <small className="wh-unit">{i.baseUnit}</small>
                          </td>
                          <td>{i.lastIssued ? jShort(i.lastIssued) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---- تعریف انبار، کالای کارگاهی و بارگذاری اکسل ---- */
const BLANK_ITEM = {
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

function ItemsPane() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [brands, setBrands] = useState([]);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [noUnits, setNoUnits] = useState(false);
  const [mine, setMine] = useState(false);
  const [noWhName, setNoWhName] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);   // "new" یا خودِ کالا

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [qDebounced, brand, noUnits, mine, noWhName]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await warehouseApi.items({
        q: qDebounced, brand, page,
        noUnits: noUnits ? 1 : "", mine: mine ? 1 : "", noWarehouseName: noWhName ? 1 : "",
      });
      setRows(d.results || []);
      setCount(d.count || 0);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [qDebounced, brand, page, noUnits, mine, noWhName]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    warehouseApi.meta({}).then((m) => setBrands(m.brands || [])).catch(() => {});
  }, []);

  async function onSaved(saved, isNew) {
    setEditing(null);
    flash(isNew ? `«${saved.name}» تعریف شد ✓` : `«${saved.name}» ذخیره شد ✓`);
    if (isNew) { setPage(1); await reload(); }
    else setRows((p) => p.map((r) => (r.id === saved.id ? saved : r)));
  }

  async function remove(row) {
    const ok = await askConfirm({
      title: `حذف «${row.name}»`,
      message: "این کالا از فهرست کالاها حذف می‌شود.\nاین کار برگشت ندارد.",
      confirmLabel: "حذف کالا", danger: true,
    });
    if (!ok) return;
    try {
      await warehouseApi.removeItem(row.id);
      setRows((p) => p.filter((r) => r.id !== row.id));
      setCount((c) => c - 1);
      flash("حذف شد.");
    } catch (e) { showMessage({ title: "کالا حذف نشد", message: e.message }); }
  }

  const pageCount = Math.max(1, Math.ceil(count / 40));

  if (err && !rows.length) return <div className="notice warn">{err}</div>;

  return (
    <>
      <div className="card">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام کالا، کد انبار، کد SKU، بارکد یا برند…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={noUnits}
              onChange={(e) => setNoUnits(e.target.checked)} /> فقط بدون بسته‌بندی فرعی
          </label>
          <label>
            <input type="checkbox" checked={mine}
              onChange={(e) => setMine(e.target.checked)} /> فقط کالاهای تعریف‌شدهٔ خودمان
          </label>
          <label>
            <input type="checkbox" checked={noWhName}
              onChange={(e) => setNoWhName(e.target.checked)} /> فقط بدون نام انبار
          </label>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
        <button className="submit" onClick={() => setEditing("new")}>+ تعریف کالای جدید</button>
      </div>

      {loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? <div className="empty">کالایی با این فیلترها نیست.</div> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr>
                  <th>کالا</th><th>برند</th><th>کد انبار</th><th>کد SKU</th>
                  <th>بسته‌بندی</th><th>موجودی</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "wh-off"}>
                    <td className="wh-name">
                      {r.name}
                      <div className="wh-sub">
                        {/* برچسب رنگ/اندازه فقط برای انبار است؛ سایت فروش فقط نام خودش را نشان می‌دهد. */}
                        {r.siteParent
                          ? <span>زیرمجموعهٔ بستهٔ سایت «{r.siteParentName}» · {r.variantLabel}</span>
                          : r.siteName && r.siteName !== r.name && <span>سایت: {r.siteName}</span>}
                        {r.variantCount > 0
                          ? <span className="wh-flag">بستهٔ سایت · {faDigits(r.variantCount)} زیرمجموعه در انبار</span>
                          : r.unitOf
                            ? <span className="wh-flag">بستهٔ دیگرِ «{r.unitOf.name}» · هر بسته {faDigits(r.unitOf.perPack)} {r.unitOf.baseUnit}</span>
                            : !r.warehouseName && <span className="wh-flag">بدون نام انبار</span>}
                        {r.barcode && <span>بارکد {r.barcode}</span>}
                        {r.packSize && <span>{r.packSize}</span>}
                        {r.hazardous && <span className="wh-flag haz">آتش‌زا</span>}
                        {r.batchTracked && <span className="wh-flag">بچ‌دار</span>}
                        {!r.active && <span className="wh-flag">غیرفعال</span>}
                      </div>
                    </td>
                    <td>{r.brand || "—"}</td>
                    <td>{r.warehouseCode || "—"}</td>
                    <td>{r.skuCode}</td>
                    <td>
                      {r.baseUnit || "—"}
                      <div className="wh-sub">
                        {r.altUnit
                          ? <span>۱ {r.baseUnit} = {faDigits(r.altPerBase)} {r.altUnit}</span>
                          : <span>بدون واحد فرعی</span>}
                      </div>
                    </td>
                    <td className="wh-qty">{faDigits(r.onHand)}</td>
                    <td className="wh-actions">
                      <button className="act edit" onClick={() => setEditing(r)}>ویرایش</button>
                      {!r.onHand && (
                        <button className="link-btn" onClick={() => remove(r)}>حذف</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="wh-pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} کالا</span>
            <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {editing && (
        <ItemEditor item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </>
  );
}

/* ---- اموال: وسیله‌ها، محلشان و دست چه کسی‌اند ---- */
/* ---- اموال: فهرست، پرونده، تاریخچه، برگهٔ تحویل و بازرسی ---- */
const ASSET_STATUS = {
  ok: { label: "سالم", cls: "ok" },
  needs_repair: { label: "نیاز به تعمیر", cls: "warn" },
  in_repair: { label: "در تعمیر", cls: "info" },
  out_of_service: { label: "خارج از سرویس", cls: "off" },
};
const ASSET_ACTIONS = [["", "—"], ["expert", "بررسی بیشتر توسط کارشناس"], ["service", "سرویس"],
  ["repair", "تعمیر"], ["replace", "تعویض"], ["out_of_service", "خروج از سرویس"]];
const ASSET_EVENT_CLS = { created: "ok", handover: "info", move: "info", status: "warn", repair: "bad",
  service: "ok", inspection: "info", note: "off" };

function AssetStatusChip({ status }) {
  const s = ASSET_STATUS[status] || ASSET_STATUS.ok;
  return <span className={`as-chip ${s.cls}`}>{s.label}</span>;
}

function DueChip({ due }) {
  if (due === "overdue") return <span className="as-chip bad">عقب‌افتاده</span>;
  if (due === "soon") return <span className="as-chip warn">نزدیک</span>;
  return null;
}

const assetChangeText = (changes = {}) => Object.entries(changes).map(([k, [a, b]]) => {
  const label = { holder: "تحویل‌گیرنده", location: "محل", status: "وضعیت" }[k] || k;
  const val = (x) => (k === "status" ? ASSET_STATUS[x]?.label || x : x) || "—";
  return `${label}: ${val(a)} ← ${val(b)}`;
}).join(" · ");

function AssetsPane() {
  const [section, setSection] = useState("list");
  return (
    <>
      <div className="seg-row" role="tablist">
        {[["list", "فهرست اموال"], ["inspections", "بازرسی‌ها"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={section === k} className={section === k ? "seg on" : "seg"}
            onClick={() => setSection(k)}>{l}</button>
        ))}
      </div>
      {section === "list" ? <AssetList /> : <InspectionsPane />}
    </>
  );
}

function AssetList() {
  const canEdit = useCan()("warehouse.assets");
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [place, setPlace] = useState("");
  const [holder, setHolder] = useState("");
  const [statusF, setStatusF] = useState("");
  const [serviceF, setServiceF] = useState("");
  const [places, setPlaces] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);
  const [opened, setOpened] = useState(null);     // پروندهٔ باز
  const [printing, setPrinting] = useState(null); // برگهٔ تحویل

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [qDebounced, place, holder, statusF, serviceF]);

  const loadPlaces = useCallback(() => {
    warehouseApi.locations()
      .then((r) => setPlaces(r.filter((p) => p.active)))
      .catch(() => {});
  }, []);
  useEffect(() => { loadPlaces(); }, [loadPlaces]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        warehouseApi.items({ assets: 1, q: qDebounced, location: place, holder, status: statusF, service: serviceF, page }),
        warehouseApi.assetsSummary(),
      ]);
      setRows(d.results || []);
      setCount(d.count || 0);
      setSummary(s);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [qDebounced, place, holder, statusF, serviceF, page]);

  useEffect(() => { reload(); }, [reload]);

  // پس از ثبت تعمیر/سرویس، پروندهٔ باز و فهرست هر دو تازه شوند.
  async function refreshOpened(id) {
    try { setOpened(await warehouseApi.item(id)); } catch { /* فهرست هم تازه می‌شود */ }
    reload();
  }

  // فهرست تحویل‌گیرنده‌ها از خود اموال درمی‌آید، نه از فهرست کارکنان: کسی
  // که چیزی دستش نیست در این فیلتر جایی ندارد.
  const [holders, setHolders] = useState([]);
  useEffect(() => {
    warehouseApi.items({ assets: 1, page_size: 300 })
      .then((d) => setHolders(
        [...new Set((d.results || []).map((r) => r.holder).filter(Boolean))].sort()))
      .catch(() => {});
  }, [count]);

  async function onSaved(saved, isNew) {
    setEditing(null);
    flash(isNew ? `«${saved.name}» ثبت شد ✓` : `«${saved.name}» ذخیره شد ✓`);
    loadPlaces();
    if (opened && String(opened.id) === String(saved.id)) setOpened(saved);
    await reload();
  }

  async function remove(row) {
    const ok = await askConfirm({
      title: `حذف «${row.name}» از اموال`,
      message: "این قلم از فهرست اموال حذف می‌شود.\nاین کار برگشت ندارد.",
      confirmLabel: "حذف", danger: true,
    });
    if (!ok) return;
    try {
      await warehouseApi.removeItem(row.id);
      await reload();
      flash("حذف شد.");
    } catch (e) { showMessage({ title: "حذف نشد", message: e.message }); }
  }

  const pageCount = Math.max(1, Math.ceil(count / 40));
  const s = summary || { total: 0, byStatus: {}, serviceOverdue: 0, serviceSoon: 0, warrantySoon: 0,
    noHolder: 0, noLocation: 0, bookTotal: 0, withBookValue: 0 };
  const broken = (s.byStatus.needs_repair || 0) + (s.byStatus.in_repair || 0);
  const filtered = qDebounced || place || holder || statusF || serviceF;

  if (err && !rows.length) return <div className="notice warn">{err}</div>;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(s.total)}</b><span>وسیلهٔ فعال</span></div>
        <div className={broken ? "stat warn" : "stat"}><b>{faDigits(broken)}</b><span>نیاز به تعمیر یا در تعمیر</span></div>
        <div className={s.serviceOverdue ? "stat warn" : "stat"}>
          <b>{faDigits(s.serviceOverdue)}</b>
          <span>سرویس عقب‌افتاده{s.serviceSoon ? ` · ${faDigits(s.serviceSoon)} نزدیک` : ""}</span>
        </div>
        <div className="stat">
          <b>{faRial(s.bookTotal)}</b>
          <span>ارزش دفتری (ریال){s.withBookValue < s.total ? ` · ${faDigits(s.withBookValue)} از ${faDigits(s.total)} وسیله` : ""}</span>
        </div>
      </div>
      {(s.noHolder || s.noLocation || s.warrantySoon || s.byStatus.out_of_service) ? (
        <div className="asset-flags">
          {s.byStatus.out_of_service ? <span>خارج از سرویس: <b>{faDigits(s.byStatus.out_of_service)}</b></span> : null}
          {s.warrantySoon ? <span>گارانتی رو به پایان: <b>{faDigits(s.warrantySoon)}</b></span> : null}
          {s.noHolder ? <span>بی تحویل‌گیرنده: <b>{faDigits(s.noHolder)}</b></span> : null}
          {s.noLocation ? <span>بی محل: <b>{faDigits(s.noLocation)}</b></span> : null}
        </div>
      ) : null}

      <div className="card">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام وسیله، کد اموال، تحویل‌گیرنده یا محل…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={place} onChange={(e) => setPlace(e.target.value)} aria-label="محل">
            <option value="">همهٔ محل‌ها</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="تحویل‌گیرنده">
            <option value="">همهٔ تحویل‌گیرنده‌ها</option>
            {holders.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="وضعیت">
            <option value="">همهٔ وضعیت‌ها</option>
            {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={serviceF} onChange={(e) => setServiceF(e.target.value)} aria-label="سرویس">
            <option value="">سرویس: همه</option>
            <option value="due">عقب‌افتاده یا نزدیک</option>
            <option value="overdue">فقط عقب‌افتاده</option>
          </select>
        </div>
        {msg && <div className="wh-toggles"><span className="ok-msg" style={{ margin: 0 }}>{msg}</span></div>}
        {canEdit && <button className="submit" onClick={() => setEditing("new")}>+ ثبت اموال جدید</button>}
      </div>

      {loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">
            {filtered ? "با این فیلترها چیزی پیدا نشد." : "هنوز اموالی ثبت نشده. با «ثبت اموال جدید» شروع کنید."}
          </div>
        ) : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr>
                  <th>وسیله</th><th>وضعیت</th><th>محل استقرار</th><th>تحویل‌گیرنده</th>
                  <th>سرویس بعدی</th><th>ارزش دفتری (ریال)</th><th><span className="sr-only">کارها</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "wh-off"}>
                    <td className="wh-name">
                      <button className="link-btn asset-open" onClick={() => setOpened(r)}>{r.name}</button>
                      <div className="wh-sub">
                        {r.assetCode && <span>کد {r.assetCode}</span>}
                        {r.assetSerial && <span dir="ltr">S/N {r.assetSerial}</span>}
                        {r.brand && <span>{r.brand}</span>}
                        {!r.active && <span className="wh-flag">غیرفعال</span>}
                      </div>
                    </td>
                    <td><AssetStatusChip status={r.assetStatus} /></td>
                    <td>{r.locationName || <span className="muted">تعیین نشده</span>}</td>
                    <td>
                      {r.holder || <span className="muted">تعیین نشده</span>}
                      {r.handedOverOn && <div className="wh-sub"><span>از {jShort(r.handedOverOn)}</span></div>}
                    </td>
                    <td>
                      {!r.serviceIntervalDays ? <span className="muted">—</span> : (
                        <>{r.nextServiceOn ? jShort(r.nextServiceOn) : "ثبت نشده"} <DueChip due={r.serviceDue} /></>
                      )}
                    </td>
                    <td className="wh-qty">{r.bookValue != null ? faRial(r.bookValue) : <span className="muted">—</span>}</td>
                    <td className="wh-actions">
                      <button className="act edit" onClick={() => setOpened(r)}>پرونده</button>
                      {canEdit && <button className="link-btn" onClick={() => remove(r)}>حذف</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="wh-pager">
              <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
              <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} قلم</span>
              <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
            </div>
          )}
        </>
      )}

      {opened && !editing && !printing && (
        <AssetDialog key={opened.id} asset={opened} canEdit={canEdit} onClose={() => setOpened(null)}
          onEdit={() => setEditing(opened)} onPrint={() => setPrinting(opened)} onChanged={refreshOpened} />
      )}
      {printing && <HandoverDoc asset={printing} onClose={() => setPrinting(null)} />}
      {editing && (
        <ItemEditor item={editing === "new" ? null : editing} assetMode
          onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </>
  );
}

/** پروندهٔ یک وسیله: مشخصات، خرید و گارانتی، نگهداری، استهلاک و تاریخچه. */
function AssetDialog({ asset: a, canEdit, onClose, onEdit, onPrint, onChanged }) {
  const [pane, setPane] = useState("info");
  const [events, setEvents] = useState(null);
  const [form, setForm] = useState(null);   // فرم رخداد تازه
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadEvents = useCallback(() => warehouseApi.assetEvents(a.id).then(setEvents)
    .catch((e) => { setEvents([]); setErr(e.message); }), [a.id]);
  useEffect(() => { if (pane === "history") loadEvents(); }, [pane, loadEvents]);

  const openForm = (kind) => {
    setForm({ kind, date: todayIso(), cost: "", status: "", description: "" });
    setPane("history");
  };
  async function saveEvent() {
    if (busy || !form.description.trim()) return;
    setBusy(true); setErr("");
    try {
      await warehouseApi.createAssetEvent({
        sku: a.id, kind: form.kind, date: form.date, status: form.status, description: form.description.trim(),
        cost: form.kind === "note" ? 0 : Number(form.cost) || 0,
      });
      setForm(null);
      await loadEvents();
      onChanged(a.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function removeEvent(ev) {
    const ok = await askConfirm({
      title: `پاک کردن «${ev.kindLabel}»`, message: `${jShort(ev.date)} — ${ev.description}\nاین کار برگشت ندارد.`,
      confirmLabel: "پاک کن", danger: true,
    });
    if (!ok) return;
    try { await warehouseApi.removeAssetEvent(ev.id); await loadEvents(); onChanged(a.id); } catch (e) { setErr(e.message); }
  }

  const st = ASSET_STATUS[a.assetStatus] || ASSET_STATUS.ok;
  const depPct = a.purchasePrice > 0 && a.bookValue != null ? Math.round(100 * (1 - a.bookValue / a.purchasePrice)) : null;
  const warranty = { expired: ["منقضی شده", "bad"], soon: ["رو به پایان", "warn"], active: ["فعال", "ok"] }[a.warrantyState];
  const spent = (events || []).reduce((sum, ev) => sum + (Number(ev.cost) || 0), 0);

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog asset-dialog" role="dialog" aria-labelledby="as-title">
        <div className="user-dialog-hd">
          <span className="avatar"><Icon name="warehouse" size={18} /></span>
          <div className="ud-name">
            <b id="as-title">{a.name}</b>
            <small>{[a.assetCode && `کد ${a.assetCode}`, a.assetModel, a.brand].filter(Boolean).join(" · ") || "—"}</small>
          </div>
          <AssetStatusChip status={a.assetStatus} />
        </div>

        <div className="sub-tabs" role="tablist">
          {[["info", "مشخصات"], ["history", "تاریخچه"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={pane === k} className={pane === k ? "sub-tab on" : "sub-tab"}
              onClick={() => { setErr(""); setPane(k); }}>{l}</button>
          ))}
        </div>

        {pane === "info" && (
          <>
            <div className="asset-grid">
              <div><span>محل استقرار</span><b>{a.locationName || "—"}</b></div>
              <div><span>تحویل‌گیرنده</span><b>{a.holder || "—"}</b></div>
              <div><span>تاریخ تحویل</span><b>{a.handedOverOn ? jShort(a.handedOverOn) : "—"}</b></div>
              <div><span>شماره سریال</span><b dir="ltr">{a.assetSerial || "—"}</b></div>
              <div><span>فروشنده</span><b>{a.assetSupplier || "—"}</b></div>
              <div><span>وضعیت</span><b>{st.label}</b></div>
            </div>
            <div className="asset-cards">
              <div className="asset-card">
                <div className="items-hd">خرید و گارانتی</div>
                <dl>
                  <dt>تاریخ خرید</dt><dd>{a.purchaseDate ? jShort(a.purchaseDate) : "—"}</dd>
                  <dt>قیمت خرید</dt><dd>{a.purchasePrice ? `${faRial(a.purchasePrice)} ریال` : "—"}</dd>
                  <dt>گارانتی تا</dt>
                  <dd>{a.warrantyUntil ? <>{jShort(a.warrantyUntil)} {warranty && <span className={`as-chip ${warranty[1]}`}>{warranty[0]}</span>}</> : "—"}</dd>
                </dl>
              </div>
              <div className="asset-card">
                <div className="items-hd">نگهداری</div>
                <dl>
                  <dt>دورهٔ سرویس</dt><dd>{a.serviceIntervalDays ? `هر ${faDigits(a.serviceIntervalDays)} روز` : "تعیین نشده"}</dd>
                  <dt>آخرین سرویس</dt><dd>{a.lastServiceOn ? jShort(a.lastServiceOn) : "ثبت نشده"}</dd>
                  <dt>سرویس بعدی</dt>
                  <dd>{!a.serviceIntervalDays ? "—" : <>{a.nextServiceOn ? jShort(a.nextServiceOn) : "هر چه زودتر"} <DueChip due={a.serviceDue} /></>}</dd>
                </dl>
                {canEdit && <button className="link-btn" onClick={() => openForm("service")}>+ ثبت سرویس</button>}
              </div>
              <div className="asset-card">
                <div className="items-hd">استهلاک</div>
                {a.bookValue == null ? (
                  <div className="muted sm2" style={{ lineHeight: 1.9 }}>
                    برای محاسبه، قیمت خرید، تاریخ خرید و عمر مفید را در «ویرایش مشخصات» وارد کنید.
                  </div>
                ) : (
                  <>
                    <dl>
                      <dt>عمر مفید</dt><dd>{faDigits(a.usefulLifeYears)} سال</dd>
                      <dt>ارزش اسقاط</dt><dd>{faRial(a.salvageValue)} ریال</dd>
                      <dt>ارزش دفتری امروز</dt><dd>{faRial(a.bookValue)} ریال</dd>
                    </dl>
                    <div className="dep-bar" role="img" aria-label={`${depPct}٪ مستهلک شده`}>
                      <i style={{ width: `${Math.min(100, Math.max(0, depPct))}%` }} />
                    </div>
                    <div className="muted sm2">{faDigits(depPct)}٪ مستهلک شده</div>
                  </>
                )}
              </div>
            </div>
            {a.assetNote && <div className="notice">{a.assetNote}</div>}
          </>
        )}

        {pane === "history" && (
          <>
            {canEdit && !form && (
              <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
                <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => openForm("service")}>+ سرویس و نگهداری</button>
                <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => openForm("repair")}>+ تعمیر</button>
                <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => openForm("note")}>+ یادداشت</button>
              </div>
            )}
            {form && (
              <div className="asset-card event-form">
                <div className="items-hd">{{ service: "ثبت سرویس و نگهداری", repair: "ثبت تعمیر", note: "یادداشت" }[form.kind]}</div>
                <div className="row2">
                  <label className="fld"><span>تاریخ</span>
                    <JalaliPicker value={form.date} onChange={(v) => setForm((p) => ({ ...p, date: v }))} />
                  </label>
                  {form.kind !== "note" && (
                    <label className="fld"><span>هزینه (ریال)</span>
                      <input type="number" min="0" inputMode="numeric" value={form.cost}
                        onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
                    </label>
                  )}
                </div>
                <label className="fld"><span>وضعیت پس از این کار</span>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="">بدون تغییر ({st.label})</option>
                    {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label className="fld"><span>شرح</span>
                  <textarea rows={2} value={form.description} autoFocus
                    placeholder={{ service: "مثلاً: تعویض فیلتر و روغن‌کاری", repair: "مثلاً: تعویض نازل در تعمیرگاه …", note: "" }[form.kind]}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                </label>
                <div className="btn-row">
                  <button className="ghost" disabled={busy} onClick={() => setForm(null)}>انصراف</button>
                  <button className="submit" disabled={busy || !form.description.trim()} onClick={saveEvent}>{busy ? "…" : "ثبت"}</button>
                </div>
              </div>
            )}
            {events === null ? <div className="muted sm2">در حال خواندن…</div>
              : events.length === 0 ? <div className="empty">هنوز رخدادی برای این وسیله ثبت نشده.</div>
              : (
                <>
                  {spent > 0 && <div className="muted sm2">هزینهٔ تعمیر و سرویس تا امروز: <b>{faRial(spent)} ریال</b></div>}
                  <ul className="event-list">
                    {events.map((ev) => (
                      <li key={ev.id}>
                        <span className={`as-chip ${ASSET_EVENT_CLS[ev.kind] || "off"}`}>{ev.kindLabel}</span>
                        <div className="event-body">
                          <div>{[ev.description, assetChangeText(ev.changes)].filter(Boolean).join(" — ") || "—"}</div>
                          <small>
                            {jShort(ev.date)}{ev.cost ? ` · هزینه ${faRial(ev.cost)} ریال` : ""}{ev.by ? ` · ${ev.by}` : ""}
                          </small>
                        </div>
                        {canEdit && ["repair", "service", "note"].includes(ev.kind) && (
                          <button className="link-btn" onClick={() => removeEvent(ev)}>پاک کردن</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </>
        )}

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>بستن</button>
          <button className="ghost" onClick={onPrint}>برگهٔ تحویل</button>
          {canEdit && <button className="submit" style={{ width: "auto", margin: 0 }} onClick={onEdit}>ویرایش مشخصات</button>}
        </div>
      </div>
    </div>
  );
}

/** برگهٔ تحویل اموال — برای امضای تحویل‌دهنده و تحویل‌گیرنده. */
function HandoverDoc({ asset: a, onClose }) {
  const blank = "..............................";
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet">
        <DocLetterhead title="برگهٔ تحویل اموال" subtitle={a.assetCode ? `کد اموال ${a.assetCode}` : ""} />
        <div className="doc-info">
          <div><span>وسیله</span><b>{a.name}</b></div>
          <div><span>کد اموال</span><b>{a.assetCode || "—"}</b></div>
          <div><span>شماره سریال</span><b dir="ltr">{a.assetSerial || "—"}</b></div>
          <div><span>مدل / برند</span><b>{[a.assetModel, a.brand].filter(Boolean).join(" · ") || "—"}</b></div>
          <div><span>محل استقرار</span><b>{a.locationName || "—"}</b></div>
          <div><span>وضعیت هنگام تحویل</span><b>{(ASSET_STATUS[a.assetStatus] || ASSET_STATUS.ok).label}</b></div>
          <div><span>تحویل‌گیرنده</span><b>{a.holder || blank}</b></div>
          <div><span>تاریخ تحویل</span><b>{a.handedOverOn ? jLong(a.handedOverOn) : blank}</b></div>
        </div>
        {a.assetNote && <p className="rep-notes"><b>توضیح:</b> {a.assetNote}</p>}
        <p className="doc-terms">
          اینجانب وسیلهٔ بالا را سالم و کامل تحویل گرفتم و متعهد می‌شوم در نگهداری و استفادهٔ درست از آن دقت کنم،
          هر خرابی یا مفقودی را فوراً به مسئول اموال گزارش دهم و هنگام جابه‌جایی یا پایان همکاری، آن را تحویل دهم.
        </p>
        <div className="doc-sign">
          <div>تحویل‌دهنده (مسئول اموال): ......................</div>
          <div>تحویل‌گیرنده: ......................</div>
          <div>تأیید مدیر: ......................</div>
        </div>
        <div className="doc-foot">سامانهٔ دیواژ · برگهٔ تحویل اموال</div>
      </div>
    </PrintableDoc>
  );
}

/** بازرسی دوره‌ای: فهرست برگه‌ها. */
function InspectionsPane() {
  const canEdit = useCan()("warehouse.assets");
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };

  const load = useCallback(() => warehouseApi.inspections()
    .then((d) => { setList(d); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card">
        <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: 0 }}>
          <div className="muted sm2" style={{ lineHeight: 1.9, flex: "1 1 260px" }}>
            برگهٔ بازرسی برای همهٔ اموال یا اموال یک محل ساخته می‌شود. برای هر وسیله پیدا شدن، وضعیت و اقدام لازم
            را ثبت کنید؛ با «بستن برگه»، وضعیت وسیله‌ها به‌روز و در پروندهٔ هر کدام ثبت می‌شود.
          </div>
          {canEdit && (
            <button className="submit" style={{ width: "auto", margin: 0, flex: "0 0 auto" }} onClick={() => setCreating(true)}>
              + بازرسی جدید
            </button>
          )}
        </div>
        {msg && <div className="ok-msg" role="status">{msg}</div>}
      </div>
      {err && <div className="notice warn">{err}</div>}
      {list === null ? <div className="empty">در حال بارگذاری…</div>
        : list.length === 0 ? <div className="empty">هنوز بازرسی‌ای ثبت نشده.</div>
        : (
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr><th>شماره</th><th>عنوان</th><th>تاریخ</th><th>محدوده</th><th>وضعیت</th><th>ردیف‌ها</th>
                  <th><span className="sr-only">باز کردن</span></th></tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td className="vc-num">{faDigits(i.number)}</td>
                    <td>{i.title}</td>
                    <td>{jShort(i.date)}</td>
                    <td>{i.locationName || "همهٔ اموال"}</td>
                    <td><span className={`as-chip ${i.status === "open" ? "info" : "ok"}`}>{i.statusLabel}</span></td>
                    <td>
                      {faDigits(i.counts.total)} وسیله
                      {i.counts.needsAction > 0 && <span className="as-chip warn" style={{ marginInlineStart: 6 }}>{faDigits(i.counts.needsAction)} نیاز به اقدام</span>}
                      {i.counts.missing > 0 && <span className="as-chip bad" style={{ marginInlineStart: 6 }}>{faDigits(i.counts.missing)} پیدا نشد</span>}
                    </td>
                    <td><button className="act edit" onClick={() => setOpenId(i.id)}>{i.status === "open" && canEdit ? "ادامه" : "نمایش"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {creating && (
        <NewInspectionDialog onClose={() => setCreating(false)}
          onCreated={(ins) => { setCreating(false); load(); setOpenId(ins.id); }} />
      )}
      {openId && (
        <InspectionDialog key={openId} id={openId} canEdit={canEdit} onClose={() => setOpenId(null)}
          onChanged={(text) => { if (text) flash(text); load(); }} />
      )}
    </>
  );
}

function NewInspectionDialog({ onClose, onCreated }) {
  const [title, setTitle] = useState(`بازرسی اموال ${jShort(todayIso())}`);
  const [date, setDate] = useState(todayIso());
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [places, setPlaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { warehouseApi.locations().then((r) => setPlaces(r.filter((p) => p.active))).catch(() => {}); }, []);

  async function create() {
    if (busy || !title.trim()) return;
    setBusy(true); setErr("");
    try {
      onCreated(await warehouseApi.createInspection({ title: title.trim(), date, location: location || null, note: note.trim() }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog user-dialog" role="dialog" aria-labelledby="ni-title">
        <div className="items-hd" id="ni-title">بازرسی جدید</div>
        <label className="fld"><span>عنوان</span><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
        <div className="row2">
          <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
          <label className="fld"><span>محدوده</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">همهٔ اموال</option>
              {places.map((p) => <option key={p.id} value={p.id}>فقط {p.name}</option>)}
            </select>
          </label>
        </div>
        <label className="fld"><span>توضیح (اختیاری)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit" onClick={create} disabled={busy || !title.trim()}>{busy ? "…" : "ساختن برگه"}</button>
        </div>
      </div>
    </div>
  );
}

function InspectionDialog({ id, canEdit, onClose, onChanged }) {
  const [ins, setIns] = useState(null);
  const [lines, setLines] = useState([]);
  const [saved, setSaved] = useState("[]");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seed = (d) => { setIns(d); setLines(d.lines || []); setSaved(JSON.stringify(d.lines || [])); };
  useEffect(() => { warehouseApi.inspection(id).then(seed).catch((e) => setErr(e.message)); }, [id]);

  if (!ins) {
    return (
      <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wh-dialog">{err ? <div className="err">{err}</div> : <div className="empty">در حال بارگذاری…</div>}</div>
      </div>
    );
  }

  const editable = canEdit && ins.status === "open";
  const dirty = JSON.stringify(lines) !== saved;
  const setLine = (lid, patch) => setLines((p) => p.map((l) => (l.id === lid
    ? { ...l, ...patch, ...(patch.needsAction === false ? { action: "" } : {}) } : l)));
  const payload = () => ({
    lines: lines.map(({ id: lid, present, status, needsAction, action, note }) => ({ id: lid, present, status, needsAction, action, note })),
  });
  const missing = lines.filter((l) => !l.present).length;
  const needs = lines.filter((l) => l.needsAction);

  async function run(fn, done) {
    setBusy(true); setErr("");
    try { const d = await fn(); if (d) seed(d); onChanged(done); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const save = () => run(() => warehouseApi.updateInspection(ins.id, payload()), "برگه ذخیره شد ✓");
  async function closeSheet() {
    const ok = await askConfirm({
      title: `بستن ${faDigits(ins.number)}`,
      message: `وضعیت ${faDigits(lines.length - missing)} وسیلهٔ پیدا‌شده به‌روز و در پروندهٔ هر کدام ثبت می‌شود و برگه دیگر ویرایش نمی‌شود.`
        + (missing ? `\n${faDigits(missing)} وسیله «پیدا نشد» علامت خورده است.` : ""),
      confirmLabel: "بستن برگه",
    });
    if (ok) run(() => warehouseApi.closeInspection(ins.id, payload()), `${faDigits(ins.number)} بسته شد ✓`);
  }
  async function removeSheet() {
    const ok = await askConfirm({ title: `پاک کردن ${faDigits(ins.number)}`, message: "این برگهٔ بازرسی پاک می‌شود.\nاین کار برگشت ندارد.", confirmLabel: "پاک کن", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await warehouseApi.removeInspection(ins.id); onChanged("برگهٔ بازرسی پاک شد"); onClose(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  async function closeDialog() {
    if (dirty && editable) {
      const ok = await askConfirm({ title: "تغییرات ذخیره نشده", message: "نتیجه‌هایی که ذخیره نکرده‌اید از بین می‌رود.", confirmLabel: "بستن بدون ذخیره", danger: true });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && closeDialog()}>
      <div className="wh-dialog wide" role="dialog" aria-labelledby="in-title">
        <div className="user-dialog-hd">
          <div className="ud-name">
            <b id="in-title">{ins.title}</b>
            <small>{faDigits(ins.number)} · {jLong(ins.date)} · {ins.locationName || "همهٔ اموال"} · {ins.createdBy}</small>
          </div>
          <span className={`as-chip ${ins.status === "open" ? "info" : "ok"}`}>{ins.statusLabel}</span>
        </div>

        <div className="asset-flags">
          <span>{faDigits(lines.length)} وسیله</span>
          <span>پیدا نشد: <b>{faDigits(missing)}</b></span>
          <span>نیاز به اقدام: <b>{faDigits(needs.length)}</b></span>
          {Object.entries(ASSET_STATUS).filter(([k]) => k !== "ok").map(([k, v]) => (
            <span key={k}>{v.label}: <b>{faDigits(lines.filter((l) => l.present && l.status === k).length)}</b></span>
          ))}
        </div>
        {ins.status === "closed" && needs.length > 0 && (
          <div className="notice warn">
            <b>اقدام‌های لازم:</b> {needs.map((l) => `${l.name}${l.action ? ` (${ASSET_ACTIONS.find(([k]) => k === l.action)?.[1]})` : ""}`).join("، ")}
          </div>
        )}
        {editable && (
          <div className="btn-row" style={{ justifyContent: "flex-start", marginTop: 0 }}>
            <button className="ghost" style={{ flex: "0 0 auto" }} disabled={busy}
              onClick={() => setLines((p) => p.map((l) => ({ ...l, present: true, status: "ok", needsAction: false, action: "" })))}>
              همه پیدا شد و سالم
            </button>
          </div>
        )}

        <div className="tbl-scroll">
          <table className="print-table wh-table insp-table">
            <thead>
              <tr><th>#</th><th>وسیله</th><th>محل / تحویل‌گیرنده</th><th>پیدا شد</th><th>وضعیت</th>
                <th>نیاز به اقدام</th><th>اقدام پیشنهادی</th><th>یادداشت</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} className={!l.present ? "missing" : l.needsAction ? "action" : ""}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="wh-name">
                    {l.name}
                    <div className="wh-sub">{l.assetCode && <span>کد {l.assetCode}</span>}{l.serial && <span dir="ltr">S/N {l.serial}</span>}</div>
                  </td>
                  <td>{l.location || "—"}<div className="wh-sub"><span>{l.holder || "بی تحویل‌گیرنده"}</span></div></td>
                  <td>
                    <input type="checkbox" checked={l.present} disabled={!editable} aria-label={`${l.name} پیدا شد`}
                      onChange={(e) => setLine(l.id, { present: e.target.checked })} />
                  </td>
                  <td>
                    <select value={l.status} disabled={!editable || !l.present} aria-label={`وضعیت ${l.name}`}
                      onChange={(e) => setLine(l.id, { status: e.target.value })}>
                      {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={l.needsAction} disabled={!editable} aria-label={`${l.name} نیاز به اقدام`}
                      onChange={(e) => setLine(l.id, { needsAction: e.target.checked })} />
                  </td>
                  <td>
                    <select value={l.action} disabled={!editable || !l.needsAction} aria-label={`اقدام ${l.name}`}
                      onChange={(e) => setLine(l.id, { action: e.target.value })}>
                      {ASSET_ACTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="text" value={l.note} disabled={!editable} aria-label={`یادداشت ${l.name}`}
                      onChange={(e) => setLine(l.id, { note: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row insp-foot">
          <button className="ghost" onClick={closeDialog} disabled={busy}>بستن</button>
          {editable && <button className="ghost" onClick={removeSheet} disabled={busy}>پاک کردن برگه</button>}
          {editable && <button className="ghost" onClick={save} disabled={busy || !dirty}>ذخیره</button>}
          {editable && (
            <button className="submit" style={{ width: "auto", margin: 0 }} onClick={closeSheet} disabled={busy}>
              {busy ? "…" : "بستن برگه و ثبت نتیجه"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- اصلاح مواد مصرفی: هم‌نام و هم‌کد کردن با استاندارد انبار ---- */
const CONSUMABLE_SOURCE = {
  migrated: "از فهرست قدیمی مواد", manual: "تعریف‌شده در فرم مصرف",
  site: "کالای سایت", stocktake: "انبارگردانی", other: "انبار",
};
const MERGEABLE = new Set(["migrated", "manual", "other"]);

/* ---- بازبینی انبار: خانواده به خانواده (backend/core/review.py) ---- */
const REVIEW_STATUS = {
  todo: { label: "بررسی نشده", style: {} },
  stale: { label: "تغییر کرده — دوباره ببینید", style: { background: "#fff4e0", color: "#9a5b00" } },
  fix: { label: "نیاز به اصلاح", style: { background: "#fde8e8", color: "#b42318" } },
  ok: { label: "درست است ✓", style: { background: "#e6f4ea", color: "#1e7b34" } },
  linked: { label: "کامل وصل‌شده ✓", style: { background: "#e8f0fe", color: "#1a4fa0" } },
  offsite: { label: "در سایت نیست ✓", style: { background: "#eef0ef", color: "#42524d" } },
};

function ReviewChip({ status }) {
  const s = REVIEW_STATUS[status] || REVIEW_STATUS.todo;
  return <span className="wh-flag" style={s.style}>{s.label}</span>;
}

function StockReviewPane() {
  const [status, setStatus] = useState("todo");
  const [brand, setBrand] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [status, brand, qDebounced]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await warehouseApi.reviewFamilies({ status, brand, q: qDebounced, page }));
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [status, brand, qDebounced, page]);
  useEffect(() => { reload(); }, [reload]);

  const t = data?.totals || {};
  const pct = t.families ? Math.round((100 * ((t.ok || 0) + (t.linked || 0) + (t.offsite || 0))) / t.families) : 0;
  const rows = data?.results || [];
  const pageCount = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(t.families ?? 0)}</b><span>خانواده</span></div>
        <div className="stat"><b>{faDigits(t.ok ?? 0)}</b><span>درست است</span></div>
        <div className="stat"><b>{faDigits(t.linked ?? 0)}</b><span>کامل وصل‌شده</span></div>
        <div className="stat"><b>{faDigits(t.offsite ?? 0)}</b><span>در سایت نیست</span></div>
        <div className={t.fix ? "stat warn" : "stat"}><b>{faDigits(t.fix ?? 0)}</b><span>نیاز به اصلاح</span></div>
        <div className={t.stale ? "stat warn" : "stat"}><b>{faDigits(t.stale ?? 0)}</b><span>تغییر کرده</span></div>
        <div className="stat"><b>{faDigits(t.todo ?? 0)}</b><span>بررسی نشده</span></div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, height: 10, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#1e7b34" }} />
          </div>
          <b>{faDigits(pct)}٪</b>
        </div>
        <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
          کالاها خانواده به خانواده بررسی می‌شوند (مثلاً همهٔ رنگ‌های یک روغن یک خانواده‌اند). روی هر خانواده
          بزنید، کالاها و ایرادهایشان و اتصال به سایت را ببینید، و «درست است» یا «نیاز به اصلاح» را بزنید.
          خانواده‌هایی که موجودی دارند اول می‌آیند. اگر بعد از تیک، کالایی عوض شود، دوباره «تغییر کرده» می‌شود.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام، کد یا شناسهٔ سایت…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {(data?.brands || []).map((b) => (
              <option key={b.brand} value={b.brand}>{b.brand} — {faDigits(b.ok)} از {faDigits(b.total)}</option>
            ))}
          </select>
        </div>
        <div className="wh-toggles">
          {[["todo", "بررسی نشده"], ["fix", "نیاز به اصلاح"], ["ok", "درست است"], ["linked", "کامل وصل‌شده"],
            ["offsite", "در سایت نیست"], ["all", "همه"]].map(([k, l]) => (
            <label key={k}><input type="radio" checked={status === k} onChange={() => setStatus(k)} /> {l}</label>
          ))}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && !rows.length ? <div className="notice warn">{err}</div>
        : loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">{status === "todo" && !qDebounced && !brand ? "همهٔ خانواده‌ها بررسی شده‌اند ✓" : "چیزی پیدا نشد."}</div>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="print-table wh-table">
                <thead>
                  <tr><th>خانواده</th><th>کالا</th><th>موجود</th><th>وصل به سایت</th><th>ایراد</th><th>وضعیت</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ cursor: "pointer" }} onClick={() => setOpen(r.key)}>
                      <td className="wh-name">
                        <span dir="auto">{r.title}</span>
                        <div className="wh-sub">
                          <span>{r.brand || "بی برند"}</span>
                          {r.kind === "site" && <span className="wh-flag">فقط در سایت</span>}
                          {r.review?.note && <span className="wh-flag haz">{r.review.note}</span>}
                        </div>
                      </td>
                      <td>{faDigits(r.items)}</td>
                      <td>{r.inStock ? faDigits(r.inStock) : "—"}</td>
                      <td>{r.linked ? `${faDigits(r.linked)} از ${faDigits(r.items)}` : "—"}</td>
                      <td>{r.withIssues ? <span className="wh-flag haz">{faDigits(r.withIssues)} کالا</span> : "—"}</td>
                      <td><ReviewChip status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="btn-row" style={{ justifyContent: "center" }}>
                <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
                <span className="muted sm2">صفحهٔ {faDigits(page)} از {faDigits(pageCount)} ({faDigits(data.count)} خانواده)</span>
                <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
              </div>
            )}
          </>
        )}

      {open && (
        <ReviewFamilyDialog familyKey={open}
          onClose={() => { setOpen(null); reload(); }}
          onDone={(text) => { setOpen(null); setMsg(text); setTimeout(() => setMsg(""), 4000); reload(); }} />
      )}
    </>
  );
}

function ReviewFamilyDialog({ familyKey, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState([]);
  const [extraPack, setExtraPack] = useState("");
  const [by, setBy] = useState("size");
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState(null);
  const [linkMsg, setLinkMsg] = useState("");
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await warehouseApi.reviewFamily(familyKey);
      setD(r);
      setNote((n) => n || r.review?.note || "");
      setErr("");
    } catch (e) { setErr(e.message); }
  }, [familyKey]);
  useEffect(() => { load(); }, [load]);

  const isSite = d?.kind === "site";
  const togglePack = (pack) => {
    setPreview(null);
    setPicked((p) => (p.includes(pack) ? p.filter((x) => x !== pack) : [...p, pack]));
  };
  const linkBody = () => (isSite
    ? { family: target, packs: d.itemsList.map((i) => i.pack).filter(Boolean), by }
    : { family: familyKey, packs: picked, by });
  const canLink = isSite ? Boolean(target) : picked.length > 0;

  async function mark(status) {
    if (status === "fix" && !note.trim()) { setErr("برای «نیاز به اصلاح» بنویسید چه چیزی باید اصلاح شود."); return; }
    setBusy(true); setErr("");
    try {
      await warehouseApi.reviewMark({ family: familyKey, status, note: note.trim() });
      onDone(status === "ok" ? `«${d.title}» درست است ✓` : status === "fix" ? `«${d.title}» نیاز به اصلاح` : "تیک برداشته شد");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function runLink(dry) {
    setBusy(true); setErr(""); setLinkMsg("");
    try {
      const r = await (dry ? warehouseApi.reviewLinkPreview(linkBody()) : warehouseApi.reviewLink(linkBody()));
      if (dry) setPreview(r);
      else {
        setPreview(null); setPicked([]); setTarget("");
        setLinkMsg(`وصل شد: ${faDigits(r.linked)} کالا${r.already ? ` (${faDigits(r.already)} از قبل وصل بود)` : ""}`);
        await load();
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function openEditor(id) {
    try { setEditing(await warehouseApi.item(id)); } catch (e) { setErr(e.message); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog" style={{ maxWidth: 980, width: "96vw" }}>
        {!d ? <div className="empty">{err || "در حال بارگذاری…"}</div> : (
          <>
            <div className="board-h">
              <span dir="auto">{d.title}</span> <ReviewChip status={d.status} />
            </div>
            <div className="muted sm2" style={{ marginBottom: 8 }}>
              {d.brand || "بی برند"} · {faDigits(d.items)} کالا · {faDigits(d.inStock)} موجود ·
              {" "}{faDigits(d.linked)} وصل به سایت
              {d.review && <> · آخرین بازبینی: {d.review.by} {new Date(d.review.at).toLocaleDateString("fa-IR")}</>}
            </div>
            {d.status === "offsite" && (
              <div className="notice">
                این خانواده در سایت فروش نیست (همهٔ کالاهایش «غیرفروشی»اند)، پس اتصال به سایت لازم ندارد.
                اگر روزی به سایت اضافه شد، در فرم کالا تیک «در سایت فروش دیده می‌شود» را بزنید تا دوباره برای اتصال بیاید.
              </div>
            )}

            <div className="tbl-scroll" style={{ maxHeight: 340, overflowY: "auto" }}>
              <table className="print-table wh-table">
                <thead>
                  <tr>
                    <th>{isSite ? "بستهٔ سایت" : "کالا (نام انبار)"}</th><th>کد</th><th>بسته‌بندی</th>
                    <th>موجودی</th><th>{isSite ? "زیرمجموعه" : "در سایت"}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.itemsList.map((it) => (
                    <tr key={it.id}>
                      <td className="wh-name">
                        <span dir="auto">{it.name}</span>
                        {it.issues.length > 0 && (
                          <div className="wh-sub">{it.issues.map((x) => <span key={x} className="wh-flag haz">{x}</span>)}</div>
                        )}
                      </td>
                      <td dir="ltr">{isSite ? it.pack : it.code}</td>
                      <td>
                        {it.packSize || "—"}{it.grit ? ` · ${it.grit}` : ""}{it.shade ? ` · ${it.shade}` : ""}
                        <div className="wh-sub"><span>
                          {it.baseUnit || "—"}{it.altUnit ? ` · ۱ ${it.baseUnit} = ${faDigits(it.altPerBase)} ${it.altUnit}` : ""}
                        </span></div>
                      </td>
                      <td className="wh-qty">{it.onHand ? faDigits(it.onHand) : "—"}</td>
                      <td>
                        {isSite
                          ? (it.variants ? faDigits(it.variants) : "—")
                          : it.siteParent
                            ? <span dir="auto">{it.siteParent.name} ({it.variantLabel}) <span className="muted sm2">· {it.siteParent.pack}</span></span>
                            : <span className="muted">وصل نیست</span>}
                        {!isSite && it.extraPacks && it.extraPacks.length > 0 && (
                          <div className="wh-sub"><span>+ {it.extraPacks.map((p) => `${p.packSize} (${faDigits(p.perPack)})`).join("، ")}</span></div>
                        )}
                      </td>
                      <td><button className="link-btn" onClick={() => openEditor(it.id)}>ویرایش</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pack-box" style={{ marginTop: 12 }}>
              <div className="items-hd">اتصال به سایت</div>
              {!isSite && d.linkedPacks.length > 0 && (
                <div className="muted sm2" style={{ marginBottom: 8 }}>
                  وصل به: {d.linkedPacks.map((p) => `${p.name} ${p.packSize} (${faDigits(p.inFamily)})`).join("، ")}
                </div>
              )}
              {!isSite ? (
                <>
                  <div className="muted sm2" style={{ marginBottom: 6 }}>بسته‌های سایتی که کالاهای این خانواده زیرشان بروند:</div>
                  <div style={{ maxHeight: 180, overflowY: "auto" }}>
                    {d.suggestions.length === 0 && <div className="muted sm2">پیشنهادی پیدا نشد؛ شناسهٔ بستهٔ سایت را پایین بنویسید.</div>}
                    {d.suggestions.map((s) => (
                      <label key={s.pack} className="wh-check" style={{ margin: "2px 0" }}>
                        <input type="checkbox" checked={picked.includes(s.pack)} onChange={() => togglePack(s.pack)} />
                        <span dir="auto">{s.name}</span> · {s.packSize || "بی‌اندازه"}{s.grit ? ` · ${s.grit}` : ""}{s.shade ? ` · ${s.shade}` : ""}
                        <span className="muted sm2"> · شناسه {s.pack}{s.variants ? ` · ${faDigits(s.variants)} زیرمجموعه` : ""}</span>
                      </label>
                    ))}
                    {picked.filter((p) => !d.suggestions.some((s) => s.pack === p)).map((p) => (
                      <label key={p} className="wh-check" style={{ margin: "2px 0" }}>
                        <input type="checkbox" checked onChange={() => togglePack(p)} /> شناسهٔ سایت {p}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <input value={extraPack} onChange={(e) => setExtraPack(e.target.value)} placeholder="شناسهٔ بستهٔ سایت" dir="ltr" style={{ maxWidth: 180 }} />
                    <button className="ghost" disabled={!extraPack.trim()}
                      onClick={() => { togglePack(extraPack.trim()); setExtraPack(""); }}>افزودن</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="muted sm2" style={{ marginBottom: 6 }}>
                    این بسته‌ها هنوز کالای انبار ندارند. خانوادهٔ انباری که کالاهایش زیر این بسته‌ها بروند:
                  </div>
                  {d.familySuggestions.length === 0 && <div className="muted sm2">پیشنهادی پیدا نشد. اگر در انبار همتا ندارد، «درست است» بزنید و در توضیح بنویسید «فقط در سایت».</div>}
                  {d.familySuggestions.map((f) => (
                    <label key={f.key} className="wh-check" style={{ margin: "2px 0" }}>
                      <input type="radio" checked={target === f.key} onChange={() => { setTarget(f.key); setPreview(null); }} />
                      <span dir="auto">{f.title}</span> <span className="muted sm2">· {f.brand} · {faDigits(f.items)} کالا</span>
                    </label>
                  ))}
                </>
              )}
              <div className="wh-toggles" style={{ marginTop: 8 }}>
                <label><input type="radio" checked={by === "size"} onChange={() => { setBy("size"); setPreview(null); }} /> رنگ‌ها زیر بستهٔ هم‌اندازه</label>
                <label><input type="radio" checked={by === "article"} onChange={() => { setBy("article"); setPreview(null); }} /> هر بسته یک طرح (شمارهٔ Art / ابعاد)</label>
              </div>
              <div className="btn-row">
                <button className="ghost" disabled={busy || !canLink} onClick={() => runLink(true)}>پیش‌نمایش اتصال</button>
                {preview && (
                  <button className="submit" style={{ width: "auto", margin: 0 }}
                    disabled={busy || !preview.rows.some((r) => r.items.length)} onClick={() => runLink(false)}>
                    وصل کن
                  </button>
                )}
                {linkMsg && <span className="ok-msg" style={{ margin: 0 }}>{linkMsg}</span>}
              </div>
              {preview && (
                <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                  {preview.rows.map((r) => (
                    <div key={r.pack} style={{ marginBottom: 6 }}>
                      <b dir="auto">{r.name}</b> {r.packSize} <span className="muted sm2">· {faDigits(r.items.length)} زیرمجموعه</span>
                      <div className="wh-sub" style={{ flexWrap: "wrap" }}>
                        {r.items.map((it) => (
                          <span key={it.id} className="wh-flag" dir="ltr"
                            style={it.onHand > 0 ? REVIEW_STATUS.ok.style : {}}>{it.label}{it.onHand > 0 ? ` = ${faDigits(it.onHand)}` : ""}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {[...preview.skipped.map((s) => `بستهٔ ${s.pack} ${s.packSize}: ${s.reason}`),
                    ...preview.problems.map((p) => `${p.code}: ${p.reason}`)].map((x) => (
                    <div key={x} className="err">{x}</div>
                  ))}
                  {preview.leftover.length > 0 && (
                    <div className="muted sm2">بی بستهٔ سایت: {preview.leftover.map((l) => l.code).join("، ")}</div>
                  )}
                </div>
              )}
            </div>

            <label className="fld" style={{ marginTop: 10 }}><span>توضیح (برای «نیاز به اصلاح» لازم است)</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="مثلاً: واحد اصلی باید عدد باشد" />
            </label>
            {err && <div className="err">{err}</div>}
            <div className="btn-row">
              <button className="ghost" onClick={onClose}>بستن</button>
              {d.review && <button className="link-btn" disabled={busy} onClick={() => mark("clear")}>برداشتن تیک</button>}
              <button className="ghost" disabled={busy} onClick={() => mark("fix")}>نیاز به اصلاح</button>
              <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy} onClick={() => mark("ok")}>درست است ✓</button>
            </div>
          </>
        )}
      </div>
      {editing && (
        <ItemEditor item={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }} />
      )}
    </div>
  );
}

function ConsumableReviewPane() {
  const [status, setStatus] = useState("review");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ review: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);   // کالای کامل، برای ویرایشگر انبار
  const [merging, setMerging] = useState(null);   // ردیفی که ادغام می‌شود
  const [busyId, setBusyId] = useState(null);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await warehouseApi.consumableReview({ status, q: qDebounced });
      setRows(d.results || []);
      setTotals(d.totals || {});
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [status, qDebounced]);

  useEffect(() => { reload(); }, [reload]);

  async function openEditor(row) {
    try { setEditing(await warehouseApi.item(row.id)); } catch (e) { alert(e.message); }
  }

  async function confirm(row) {
    setBusyId(row.id);
    try {
      const r = await warehouseApi.confirmConsumable(row.id);
      flash(`«${row.name}» تأیید شد ✓` + (r.renamed ? ` — نام در ${faDigits(r.renamed)} ردیف گزارش به‌روز شد` : ""));
      await reload();
    } catch (e) { alert(e.message); } finally { setBusyId(null); }
  }

  const needsWork = (r) => r.needsReview || r.usedNames.length > 0;

  return (
    <>
      <div className="stats">
        <div className={totals.review ? "stat warn" : "stat"}>
          <b>{faDigits(totals.review ?? 0)}</b><span>نیاز به اصلاح</span>
        </div>
        <div className="stat"><b>{faDigits(totals.done ?? 0)}</b><span>مطابق انبار</span></div>
      </div>

      <div className="card">
        <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
          موادی که بیرون از روال انبار ثبت شده‌اند — از فهرست قدیمی مواد یا از فرم مصرف — یا در
          گزارش‌ها با نامی جز نام انبار آمده‌اند. برای هر کدام:
          <br />• <b>ادغام در کالای انبار</b>: وقتی کالای درستش در انبار هست (یا همان‌جا تعریفش
          می‌کنید). گزارش‌های قبلی به آن منتقل می‌شوند و این قلم حذف می‌شود.
          <br />• <b>ویرایش</b> و سپس <b>درست است</b>: وقتی خودِ این قلم باید با نام و کد
          استاندارد اصلاح شود. نام تازه روی گزارش‌های قبلی هم می‌نشیند.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام انبار، نام در گزارش‌ها، یا کد…" />
        <div className="wh-toggles">
          <label><input type="radio" checked={status === "review"} onChange={() => setStatus("review")} /> نیاز به اصلاح</label>
          <label><input type="radio" checked={status === "done"} onChange={() => setStatus("done")} /> مطابق انبار</label>
          <label><input type="radio" checked={status === "all"} onChange={() => setStatus("all")} /> همه</label>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && !rows.length ? <div className="notice warn">{err}</div>
        : loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">
            {status === "review" && !qDebounced ? "همهٔ مواد مصرفی با انبار مطابق‌اند ✓" : "چیزی پیدا نشد."}
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr><th>ماده (نام انبار)</th><th>کد انبار</th><th>واحد</th><th>مصرف</th><th>وضعیت</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const strayUnits = r.usedUnits.filter((u) => u !== r.baseUnit && u !== r.altUnit);
                  return (
                    <tr key={r.id}>
                      <td className="wh-name">
                        {r.name}
                        <div className="wh-sub">
                          <span>{CONSUMABLE_SOURCE[r.source] || ""}</span>
                          {r.usedNames.length > 0 && <span className="wh-flag">در گزارش‌ها: {r.usedNames.join("، ")}</span>}
                        </div>
                      </td>
                      <td>{r.warehouseCode || <span className="muted">بدون کد</span>}</td>
                      <td>
                        {r.baseUnit || "—"}{r.altUnit ? ` / ${r.altUnit}` : ""}
                        {strayUnits.length > 0 && (
                          <div className="wh-sub"><span className="wh-flag haz">ثبت‌شده با: {strayUnits.join("، ")}</span></div>
                        )}
                      </td>
                      <td>
                        {r.uses ? `${faDigits(r.uses)} ردیف در ${faDigits(r.reports)} گزارش` : "هنوز مصرف نشده"}
                        {r.lastUsed && <div className="wh-sub"><span>آخرین: {jShort(r.lastUsed)}</span></div>}
                      </td>
                      <td>
                        {needsWork(r)
                          ? <span className="wh-flag haz">نیاز به اصلاح</span>
                          : <span className="wh-flag">مطابق انبار</span>}
                      </td>
                      <td className="wh-actions">
                        {MERGEABLE.has(r.source) && (
                          <button className="act edit" onClick={() => setMerging(r)}>ادغام در کالای انبار</button>
                        )}
                        <button className="link-btn" onClick={() => openEditor(r)}>ویرایش</button>
                        {needsWork(r) && (
                          <button className="link-btn" disabled={busyId === r.id} onClick={() => confirm(r)}>درست است ✓</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {editing && (
        <ItemEditor item={editing} onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null);
            flash(`«${saved.name}» ذخیره شد — اگر حالا درست است، «درست است» را بزنید تا روی گزارش‌ها هم بنشیند.`);
            await reload();
          }} />
      )}
      {merging && (
        <MergeConsumableDialog source={merging} onClose={() => setMerging(null)}
          onMerged={async (text) => { setMerging(null); flash(text); await reload(); }} />
      )}
    </>
  );
}

/** ادغام یک مادهٔ نااستاندارد در کالای درستِ انبار — یا کالای تازه‌ای که همین‌جا تعریف می‌شود. */
function MergeConsumableDialog({ source, onClose, onMerged }) {
  const [q, setQ] = useState(source.name);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await warehouseApi.items({ q: q.trim(), page_size: 30 });
        setRows((d.results || []).filter((r) => r.id !== source.id));
        setErr("");
      } catch (e) { setErr(e.message); } finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, source.id]);

  const targetUnits = target ? [target.baseUnit, target.altUnit].filter(Boolean) : [];
  const strayUnits = target ? source.usedUnits.filter((u) => !targetUnits.includes(u)) : [];

  async function merge() {
    if (!target || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await warehouseApi.mergeConsumable(source.id, target.id);
      onMerged(`«${source.name}» در «${target.name}» ادغام شد ✓ — ${faDigits(r.moved)} ردیف گزارش منتقل شد`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">ادغام «{source.name}» در کالای انبار</div>
        {!target ? (
          <>
            <div className="muted sm2" style={{ marginBottom: 8 }}>
              کالای درستِ انبار را پیدا کنید. اگر در انبار نیست، با نام و کد استاندارد همین‌جا تعریفش کنید.
            </div>
            <input className="wh-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="نام، کد انبار یا برند…" />
            <div className="pick-list">
              {loading && !rows.length ? <div className="empty">…</div>
                : rows.length === 0 ? <div className="empty">در انبار پیدا نشد.</div>
                : rows.map((r) => (
                  <button key={r.id} className="pick-row" onClick={() => setTarget(r)}>
                    <span className="pick-name">{r.name}</span>
                    <span className="pick-sub">
                      {r.warehouseCode ? `کد ${r.warehouseCode}` : "بدون کد انبار"}
                      {r.brand ? ` · ${r.brand}` : ""}
                      {` · ${r.baseUnit || "—"}`}{r.altUnit ? ` / ${r.altUnit}` : ""}
                    </span>
                  </button>
                ))}
            </div>
            {err && <div className="err">{err}</div>}
            <div className="btn-row">
              <button className="ghost" onClick={onClose}>انصراف</button>
              <button className="ghost" onClick={() => setCreating(true)}>+ تعریف کالای تازه در انبار</button>
            </div>
          </>
        ) : (
          <>
            <div className="merge-summary">
              <div>
                <span className="muted sm2">از</span>
                <b>{source.name}</b>
                <small>{source.warehouseCode || "بدون کد"} · {faDigits(source.uses)} ردیف مصرف</small>
              </div>
              <div className="merge-arrow">←</div>
              <div>
                <span className="muted sm2">به</span>
                <b>{target.name}</b>
                <small>{target.warehouseCode || "بدون کد انبار"} · {target.baseUnit || "—"}{target.altUnit ? ` / ${target.altUnit}` : ""}</small>
              </div>
            </div>
            <ul className="merge-notes">
              <li>همهٔ گزارش‌های مصرفِ «{source.name}» به «{target.name}» منتقل می‌شوند و نام و کدشان نام و کد انبار می‌شود.</li>
              <li>مقدارها و واحدهای ثبت‌شده دست نمی‌خورند.</li>
              <li>«{source.name}» از کالاهای انبار حذف می‌شود.</li>
            </ul>
            {strayUnits.length > 0 && (
              <div className="notice warn">
                گزارش‌ها این ماده را با «{strayUnits.join("، ")}» ثبت کرده‌اند که «{target.name}» ندارد. برای
                گزارش‌های قدیمی اشکالی نیست؛ اگر گزارشی که از موجودی کم می‌کند چنین واحدی داشته باشد، ادغام
                انجام نمی‌شود تا اول این واحد را برای کالای مقصد تعریف کنید.
              </div>
            )}
            {err && <div className="err">{err}</div>}
            <div className="btn-row">
              <button className="ghost" onClick={() => { setTarget(null); setErr(""); }}>انتخاب دیگر</button>
              <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy} onClick={merge}>
                {busy ? "در حال ادغام…" : "ادغام کن"}
              </button>
            </div>
          </>
        )}
      </div>
      {creating && (
        <ItemEditor item={null} consumableOnly onClose={() => setCreating(false)}
          onSaved={(saved) => { setCreating(false); setTarget(saved); }} />
      )}
    </div>
  );
}

/* فرمول نام و کد رنگ‌های والرسا تا کد با کد مالی بخواند:
     Valresa - P.U - Topcoat Base [Tint Color - Nova L157] 1Kg (B:973002/H:190046) Mix(2.5+1) 25G
     VT-NL157-25G
   سرور (backend/core/valresa.py) همین قاعده را بررسی می‌کند؛ هر دو باید یکی بمانند. */
const VT_NAME = /^Valresa - ([^[\]]+?) - ([^[\]]+?) \[([^[\]]+?) - ([^[\]]+?)\] (\d+(?:\.\d+)?)(Kg|L) \(B:([^/()]+)\/H:([^()]+)\) Mix\(([^()]*)\) (\S+)$/;
const BLANK_VT = {
  line: "P.U", category: "Topcoat Base", sub: "Tint Color", system: "NCS", color: "", code: "",
  qty: "1", unit: "Kg", gloss: "25G", base: "", hardener: "", mix: "",
};

function vtColor(system, raw) {
  // کد همیشه فشرده است («S0502Y»)، ولی در نام همان‌طور که نوشته‌اید می‌ماند («NCS S 0502Y»)
  // تا نام با نام حسابداری مو‌به‌مو یکی باشد.
  const typed = (raw || "").trim().replace(/\s+/g, " ");
  if (system === "other") return { label: typed, code: "" };
  const squashed = typed.replace(/[\s-]+/g, "").toUpperCase();
  if (system === "NCS") {
    const v = squashed.replace(/^(NCS|NSC)/, "");
    if (!v) return { label: "", code: "" };
    const code = v.startsWith("S") ? v : "S" + v;
    let shown = typed.replace(/^(NCS|NSC)\s*/i, "").toUpperCase();
    if (!shown.startsWith("S")) shown = "S" + shown;
    return { label: `NCS ${shown}`, code };
  }
  const v = squashed.replace(system === "RAL" ? /^RAL/ : /^NOVA/, "");
  if (!v) return { label: "", code: "" };
  const shown = typed.replace(system === "RAL" ? /^RAL\s*/i : /^NOVA\s*/i, "").toUpperCase();
  return system === "RAL" ? { label: `RAL ${shown}`, code: "R" + v } : { label: `Nova ${shown}`, code: "N" + v };
}

/** کد والرسا («VT-S0502Y-HG») → مقدارهای فرمول: رنگ، براقیت و ترکیب رایجِ همان براقیت. */
function vtFromCode(text, opts) {
  const m = /^\s*(?:VT-)?([A-Za-z0-9.+]+)-([A-Za-z0-9.]+)\s*$/.exec(text || "");
  if (!m || !/^\s*VT-/i.test(text || "")) return null;
  const [, part, gloss] = m;
  const up = part.toUpperCase();
  let system = "other";
  let color = part;
  let code = part;
  if (/^S\d/.test(up)) { system = "NCS"; color = up.replace(/^S(\d)/, "S $1"); code = ""; }
  else if (/^R\d/.test(up)) { system = "RAL"; color = up.slice(1); code = ""; }
  else if (/^N[A-Z0-9]/.test(up)) { system = "Nova"; color = up.slice(1); code = ""; }
  const first = (key, fallback) => ((opts && opts[key] && opts[key][0]) || fallback);
  const combo = ((opts && opts.combos && opts.combos[gloss]) || [])[0];
  return {
    ...BLANK_VT, system, color, code, gloss,
    line: first("lines", BLANK_VT.line), category: first("categories", BLANK_VT.category),
    sub: first("subs", BLANK_VT.sub),
    base: combo ? combo.base : "", hardener: combo ? combo.hardener : "", mix: combo ? combo.mix : "",
  };
}

/** فرمول را از آنچه نوشته‌اید می‌سازد: نام کامل، یا فقط کدِ خودتان در نام یا در خانهٔ بارکد. */
function vtSeed(name, barcode, opts) {
  const parsed = vtParse(name, barcode);
  if (parsed) return parsed;
  for (const text of [name, barcode]) {
    const hit = /VT-[A-Za-z0-9.+]+-[A-Za-z0-9.]+/i.exec(text || "");
    const seed = hit && vtFromCode(hit[0], opts);
    if (seed) return seed;
  }
  return null;
}

function vtParse(name, barcode) {
  const m = VT_NAME.exec((name || "").trim());
  if (!m) return null;
  const [, line, category, sub, label, qty, unit, base, hardener, mix, gloss] = m;
  const s = /^(NCS|NSC|RAL|Nova)\s*(.*)$/i.exec(label);
  const system = s ? ({ RAL: "RAL", NOVA: "Nova" }[s[1].toUpperCase()] || "NCS") : "other";
  const tail = "-" + gloss;
  const b = (barcode || "").trim();
  const code = system === "other" && b.startsWith("VT-") && b.endsWith(tail) ? b.slice(3, -tail.length) : "";
  return { line, category, sub, system, color: s ? s[2] : label, code, qty, unit, gloss, base, hardener, mix };
}

function vtBuild(v) {
  const c = vtColor(v.system, v.color);
  const part = v.system === "other" ? (v.code || "").trim() : c.code;
  const gloss = v.gloss.trim();
  return {
    name: `Valresa - ${v.line.trim()} - ${v.category.trim()} [${v.sub.trim()} - ${c.label}] ` +
      `${v.qty}${v.unit} (B:${v.base.trim()}/H:${v.hardener.trim()}) Mix(${v.mix.trim()}) ${gloss}`,
    code: part && gloss ? `VT-${part}-${gloss}` : "",
    complete: Boolean(c.label && part && gloss && Number(v.qty) > 0 && v.line.trim() && v.category.trim()
      && v.sub.trim() && v.base.trim() && v.hardener.trim() && v.mix.trim()),
  };
}

function ItemEditor({ item, assetMode = false, consumableOnly = false, onClose, onSaved }) {
  const isNew = item === null;
  const [f, setF] = useState(() => (isNew ? { ...BLANK_ITEM, isAsset: assetMode } : {
    ...BLANK_ITEM, ...item,
    altPerBase: item.altPerBase ?? "",
    costPrice: item.costPrice ?? "",
    salePrice: item.salePrice ?? "",
    handedOverOn: item.handedOverOn || "",
    assetStatus: item.assetStatus || "ok",
    purchaseDate: item.purchaseDate || "", warrantyUntil: item.warrantyUntil || "",
    purchasePrice: item.purchasePrice || "", salvageValue: item.salvageValue || "",
    serviceIntervalDays: item.serviceIntervalDays ?? "", usefulLifeYears: item.usefulLifeYears ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [people, setPeople] = useState([]);
  const [places, setPlaces] = useState([]);

  // بستهٔ سایت: رنگ‌های انبارِ زیرمجموعه با موجودی هر کدام.
  const [variants, setVariants] = useState(null);
  useEffect(() => {
    if (isNew || (!item.variantCount && !item.unitOf)) return;
    warehouseApi.itemVariants(item.id).then((d) => setVariants(d.results || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // رنگ والرسا: نام و کد از فرمول. کالای موجود فقط وقتی با فرمول باز می‌شود که همین
  // حالا طبق فرمول باشد، تا باز کردنِ یک ردیف قدیمی بی‌صدا نامش را عوض نکند.
  const isValresa = /valresa|والرسا/i.test(f.brand || "");
  const [vt, setVt] = useState(() => {
    const parsed = !isNew && vtParse(item.warehouseName, item.barcode);
    const built = parsed && vtBuild(parsed);
    return built && built.name === item.warehouseName && built.code === item.barcode ? parsed : null;
  });
  const [vtTouched, setVtTouched] = useState(false);
  const [vopts, setVopts] = useState(null);
  const [vtCode, setVtCode] = useState("");        // کدی که کاربر از اکسل خودش می‌آورد
  const [vtCodeErr, setVtCodeErr] = useState("");
  const vtOut = vt ? vtBuild(vt) : null;
  const setV = (k) => (e) => setVt((p) => ({ ...p, [k]: e.target.value }));
  const combos = (vt && vopts && vopts.combos && vopts.combos[vt.gloss.trim()]) || [];

  /** کدِ خودِ کاربر → پر کردن خانه‌های فرمول (برعکسِ ساختن کد از روی خانه‌ها). */
  function fillFromCode() {
    const text = vtCode.trim() || f.warehouseName || f.barcode;
    const seed = vtSeed(text, "", vopts) || vtSeed("", text, vopts);
    if (!seed) {
      setVtCodeErr("کد خوانده نشد. شکل درست: VT-<کد رنگ>-<براقیت> — مثلاً VT-S0502Y-HG یا VT-NL157-25G.");
      return;
    }
    setVtTouched(true);
    setVtCodeErr("");
    setVt(seed);
  }

  useEffect(() => {
    if (isNew && isValresa && !vtTouched && !vt && !f.isAsset) {
      setVt(vtSeed(f.warehouseName, f.barcode, vopts) || { ...BLANK_VT });
    }
    if (isValresa && !vopts) warehouseApi.valresaFormula().then(setVopts).catch(() => {});
  }, [isValresa]); // eslint-disable-line react-hooks/exhaustive-deps

  // تا فرمول کامل نشده، نام و کدی که خودتان نوشته‌اید دست نمی‌خورد.
  useEffect(() => {
    if (!vtOut || !vtOut.complete) return;
    setF((p) => ({
      ...p, warehouseName: vtOut.name, barcode: vtOut.code, productCode: vtOut.code,
      packSize: `${vt.qty}${vt.unit}`, category: `${vt.line.trim()} - ${vt.category.trim()}`,
      baseUnit: p.baseUnit || "کیلوگرم",
    }));
  }, [vtOut && vtOut.name, vtOut && vtOut.code, vtOut && vtOut.complete]); // eslint-disable-line react-hooks/exhaustive-deps

  // فهرست کارکنان فقط برای پیشنهاد است؛ تحویل‌گیرنده می‌تواند بیرون از فهرست باشد.
  useEffect(() => {
    employeesApi.list()
      .then((rows) => setPeople(rows.filter((p) => p.active).map((p) => p.name)))
      .catch(() => {});
    warehouseApi.locations()
      .then((rows) => setPlaces(rows.filter((p) => p.active)))
      .catch(() => {});
  }, []);

  // محل تازه همین‌جا ساخته می‌شود تا برای تعریف یک وسیله مجبور نشوی سربرگ
  // عوض کنی. با فیلد داخل فرم، نه پنجرهٔ prompt — که همه‌جا کار نمی‌کند.
  const [newPlace, setNewPlace] = useState(null);   // null یعنی بسته
  const [placeBusy, setPlaceBusy] = useState(false);

  async function savePlace() {
    const name = (newPlace || "").trim();
    if (!name || placeBusy) return;
    setPlaceBusy(true);
    try {
      const made = await warehouseApi.createLocation({ name });
      setPlaces((p) => [...p, made].sort((a, b) => a.name.localeCompare(b.name, "fa")));
      setF((p) => ({ ...p, location: made.id }));
      setNewPlace(null);
    } catch (e) { alert(e.message); } finally { setPlaceBusy(false); }
  }
  const set = (k) => (e) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const base = (f.baseUnit || "").trim();
  const alt = (f.altUnit || "").trim();
  const rate = Number(f.altPerBase);
  const sameUnit = Boolean(alt) && alt === base;
  const rateOk = !alt || (rate > 0 && !sameUnit);
  // کالای تازه نام انبار می‌خواهد؛ کالایی که از سایت آمده تا نام انبارش وارد شود با نام سایت ذخیره می‌شود.
  const hadWarehouseName = !isNew && Boolean((item.warehouseName || "").trim());
  const nameOk = Boolean(f.warehouseName.trim()) || (!isNew && !hadWarehouseName && Boolean(f.siteName));
  const valid = nameOk && rateOk && (!vtOut || vtOut.complete);

  async function save() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    const body = {
      warehouseName: f.warehouseName.trim(), brand: f.brand.trim(), category: f.category.trim(),
      productCode: f.productCode.trim(), warehouseCode: f.warehouseCode.trim(),
      skuCode: f.skuCode.trim(), barcode: f.barcode.trim(),
      sepidarItemId: f.sepidarItemId.trim(), packSize: f.packSize.trim(),
      isAsset: f.isAsset,
      assetCode: f.isAsset ? f.assetCode.trim() : "",
      location: f.isAsset && f.location ? f.location : null,
      holder: f.isAsset ? f.holder.trim() : "",
      handedOverOn: (f.isAsset && f.handedOverOn) ? f.handedOverOn : null,
      ...(f.isAsset ? {
        assetStatus: f.assetStatus || "ok",
        assetSerial: (f.assetSerial || "").trim(), assetModel: (f.assetModel || "").trim(),
        assetSupplier: (f.assetSupplier || "").trim(), assetNote: (f.assetNote || "").trim(),
        purchaseDate: f.purchaseDate || null, warrantyUntil: f.warrantyUntil || null,
        purchasePrice: f.purchasePrice === "" ? 0 : Number(f.purchasePrice),
        salvageValue: f.salvageValue === "" ? 0 : Number(f.salvageValue),
        serviceIntervalDays: f.serviceIntervalDays === "" ? null : Number(f.serviceIntervalDays),
        usefulLifeYears: f.usefulLifeYears === "" ? null : Number(f.usefulLifeYears),
      } : {}),
      baseUnit: base, altUnit: alt, altPerBase: alt ? rate : null,
      grit: f.grit.trim(), shade: f.shade.trim(),
      costPrice: f.costPrice === "" ? 0 : Number(f.costPrice),
      salePrice: f.salePrice === "" ? 0 : Number(f.salePrice),
      sellable: f.sellable, batchTracked: f.batchTracked,
      hazardous: f.hazardous, active: f.active,
      ...(f.siteParent ? { variantLabel: f.variantLabel.trim() } : {}),
    };
    try {
      const saved = isNew
        ? await warehouseApi.createItem(body)
        : await warehouseApi.updateItem(item.id, body);
      onSaved(saved, isNew);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">
          {f.isAsset
            ? (isNew ? "ثبت اموال جدید" : "ویرایش اموال")
            : (isNew ? "تعریف کالای جدید" : "ویرایش کالا")}
        </div>

        <div className="row2">
          <label className="fld"><span>نام انبار (نام مالی)</span>
            <input value={f.warehouseName} onChange={set("warehouseName")} autoFocus readOnly={Boolean(vt)}
              placeholder={f.siteName ? "هنوز نام انبار ندارد" : ""} />
          </label>
          <label className="fld"><span>برند</span>
            <input value={f.brand} onChange={set("brand")} />
          </label>
        </div>

        {/* نام سایت از سایت فروش می‌آید و اینجا فقط دیده می‌شود. */}
        <div className="fld">
          <span>نام سایت</span>
          <div className="muted sm2" style={{ padding: "6px 0" }}>
            {f.siteParent
              ? <>زیرمجموعهٔ بستهٔ سایت «{f.siteParentName}»{f.shopPackId && <> · شناسهٔ سایت {f.shopPackId}</>}</>
              : f.siteName
                ? <>{f.siteName}{f.shopPackId && <> · شناسهٔ سایت {f.shopPackId}</>}</>
                : "این کالا در سایت فروش نیست."}
          </div>
          {f.extraPacks && f.extraPacks.length > 0 && (
            <div className="muted sm2">
              بستهٔ دیگر در سایت: {f.extraPacks.map((p) => `${p.packSize} (هر بسته = ${faDigits(p.perPack)} ${f.baseUnit}) · شناسه ${p.pack}`).join("، ")}
            </div>
          )}
          {f.unitOf && (
            <div className="muted sm2">
              این بسته در انبار همان «{f.unitOf.name}» است؛ هر بسته = {faDigits(f.unitOf.perPack)} {f.unitOf.baseUnit}
            </div>
          )}
        </div>

        {f.siteParent && (
          <label className="fld"><span>رنگ یا اندازه (فقط برای انبار؛ در سایت فروش نشان داده نمی‌شود)</span>
            <input value={f.variantLabel} onChange={set("variantLabel")} dir="ltr" />
            <div className="muted sm2" style={{ marginTop: 4 }}>
              در انبار: {f.siteParentName}{f.variantLabel.trim() ? ` (${f.variantLabel.trim()})` : ""}
            </div>
          </label>
        )}

        {variants && variants.length > 0 && (
          <div className="pack-box">
            <div className="items-hd">
              زیرمجموعه‌های انبار (رنگ / اندازه) — {faDigits(variants.filter((v) => v.inStock).length)} موجود از {faDigits(variants.length)}
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {variants.map((v) => (
                <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                  <span dir="ltr">{v.label || "—"} <span className="muted sm2">{v.code}</span></span>
                  <b className={v.inStock ? "" : "muted"}>
                    {!v.inStock ? "ناموجود"
                      : v.unit ? `${faDigits(v.availablePacks)} بسته (${faDigits(v.onHand)} ${v.baseUnit})`
                        : `${faDigits(v.onHand)} ${v.baseUnit}`}
                  </b>
                </div>
              ))}
            </div>
          </div>
        )}

        {isValresa && !f.isAsset && (
          <div className="pack-box">
            <label className="wh-check" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={Boolean(vt)}
                onChange={(e) => {
                  setVtTouched(true);
                  setVt(e.target.checked ? (vtSeed(f.warehouseName, f.barcode, vopts) || { ...BLANK_VT }) : null);
                }} />
              رنگ والرسا (Tint Color) — نام و کد با فرمول ساخته شود تا با کد مالی بخواند
            </label>
            {vt && (
              <>
                <div className="vt-seed">
                  <input value={vtCode} dir="ltr" placeholder="VT-S0502Y-HG"
                    onChange={(e) => { setVtCode(e.target.value); setVtCodeErr(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fillFromCode(); } }} />
                  <button type="button" className="ghost" onClick={fillFromCode}>پر کردن از کد</button>
                </div>
                <div className={vtCodeErr ? "err" : "muted sm2"} style={{ margin: "4px 0 8px", lineHeight: 1.9 }}>
                  {vtCodeErr || "کدی را که خودتان ساخته‌اید اینجا بگذارید تا رنگ، براقیت و ترکیب رایج همان براقیت خودکار پر شود؛ بعد اگر لازم بود اصلاحشان کنید."}
                </div>
                <div className="row3" style={{ marginTop: 10 }}>
                  <label className="fld sm"><span>خط</span>
                    <input list="vt-lines" value={vt.line} onChange={setV("line")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>دسته</span>
                    <input list="vt-categories" value={vt.category} onChange={setV("category")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>زیردسته</span>
                    <input list="vt-subs" value={vt.sub} onChange={setV("sub")} dir="ltr" />
                  </label>
                </div>
                <div className="row3">
                  <label className="fld sm"><span>سیستم رنگ</span>
                    <select value={vt.system} onChange={setV("system")}>
                      <option value="NCS">NCS</option>
                      <option value="RAL">RAL</option>
                      <option value="Nova">Nova</option>
                      <option value="other">نام دیگر</option>
                    </select>
                  </label>
                  <label className="fld sm"><span>{vt.system === "other" ? "نام رنگ" : "شمارهٔ رنگ"}</span>
                    <input value={vt.color} onChange={setV("color")} dir="ltr"
                      placeholder={{ NCS: "S 1002-Y50R", RAL: "7023", Nova: "L157", other: "Sedef Beyaz" }[vt.system]} />
                  </label>
                  <label className="fld sm"><span>کد رنگ</span>
                    {vt.system === "other"
                      ? <input value={vt.code} onChange={setV("code")} dir="ltr" placeholder="Sedef" />
                      : <input value={vtColor(vt.system, vt.color).code} readOnly dir="ltr" />}
                  </label>
                </div>
                <div className="row3">
                  <label className="fld sm"><span>براقیت</span>
                    <input list="vt-glosses" value={vt.gloss} onChange={setV("gloss")} dir="ltr" placeholder="25G / HG" />
                  </label>
                  <label className="fld sm"><span>مقدار بسته</span>
                    <input type="number" step="any" min="0" value={vt.qty} onChange={setV("qty")} />
                  </label>
                  <label className="fld sm"><span>واحد</span>
                    <select value={vt.unit} onChange={setV("unit")}>
                      <option value="Kg">Kg</option>
                      <option value="L">L</option>
                    </select>
                  </label>
                </div>
                {combos.length > 0 && (
                  <div className="muted sm2" style={{ margin: "2px 0 8px" }}>
                    ترکیب‌های رایج برای {vt.gloss.trim()}:
                    {combos.slice(0, 4).map((c) => (
                      <button key={`${c.base}|${c.hardener}|${c.mix}`} type="button" className="ghost" dir="ltr"
                        style={{ padding: "2px 8px", margin: "4px 4px 0" }}
                        onClick={() => setVt((p) => ({ ...p, base: c.base, hardener: c.hardener, mix: c.mix }))}>
                        B:{c.base} / H:{c.hardener} / Mix {c.mix} ({faDigits(c.count)})
                      </button>
                    ))}
                  </div>
                )}
                <div className="row3">
                  <label className="fld sm"><span>کد بیس (B)</span>
                    <input list="vt-bases" value={vt.base} onChange={setV("base")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>کد هاردنر (H)</span>
                    <input list="vt-hardeners" value={vt.hardener} onChange={setV("hardener")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>نسبت اختلاط (Mix)</span>
                    <input list="vt-mixes" value={vt.mix} onChange={setV("mix")} dir="ltr" placeholder="2.5+1" />
                  </label>
                </div>
                <div className="muted sm2" dir="ltr" style={{ textAlign: "left", lineHeight: 1.8 }}>
                  <div>{vtOut.name}</div>
                  <b>{vtOut.code || "VT-…"}</b>
                </div>
                {!vtOut.complete && <div className="err">همهٔ خانه‌های فرمول را پر کنید.</div>}
                {[["vt-lines", "lines"], ["vt-categories", "categories"], ["vt-subs", "subs"],
                  ["vt-glosses", "glosses"], ["vt-bases", "bases"], ["vt-hardeners", "hardeners"],
                  ["vt-mixes", "mixes"]].map(([id, key]) => (
                  <datalist key={id} id={id}>
                    {((vopts && vopts[key]) || []).map((v) => <option key={v} value={v} />)}
                  </datalist>
                ))}
              </>
            )}
          </div>
        )}

        <div className="row2">
          <label className="fld"><span>کد انبار</span>
            <input value={f.warehouseCode} onChange={set("warehouseCode")}
              placeholder="کد خودمان — مثلاً ۱۰۰۱" />
          </label>
          <label className="fld"><span>کد SKU</span>
            <input value={f.skuCode} onChange={set("skuCode")}
              placeholder={isNew ? "خالی بگذارید تا خودکار ساخته شود" : ""} />
          </label>
        </div>

        <div className="row2">
          <label className="fld"><span>بارکد</span>
            <input value={f.barcode} onChange={set("barcode")} readOnly={Boolean(vt)} />
          </label>
          <label className="fld"><span>دسته</span>
            <input value={f.category} onChange={set("category")} />
          </label>
        </div>

        {/* یک پیستوله «یک عدد» است؛ بسته‌بندی برای اموال حرفی ندارد. */}
        <div className="pack-box" hidden={f.isAsset}>
          <div className="items-hd">بسته‌بندی</div>
          <div className="muted sm2" style={{ marginBottom: 10 }}>
            موجودی همیشه به <b>بسته‌بندی اصلی</b> شمرده می‌شود. بسته‌بندی فرعی فقط راه
            دیگری برای وارد کردن مقدار است — مثلاً حلبی که گاهی کیلویی تحویل می‌گیرید.
          </div>
          <div className="row2">
            <label className="fld"><span>بسته‌بندی اصلی</span>
              <input value={f.baseUnit} onChange={set("baseUnit")} placeholder="حلب / جعبه / عدد" />
            </label>
            <label className="fld"><span>بسته‌بندی فرعی (اختیاری)</span>
              <input value={f.altUnit} onChange={set("altUnit")} placeholder="کیلوگرم / لیتر / عدد" />
            </label>
          </div>
          {alt && (
            <label className="fld">
              <span>هر ۱ {base || "واحد اصلی"} چند {alt} است؟</span>
              <input type="number" step="any" min="0" value={f.altPerBase}
                onChange={set("altPerBase")} placeholder="مثلاً ۲۵" />
              {sameUnit
                ? <div className="err">فرعی نمی‌تواند با اصلی یکی باشد.</div>
                : rate > 0 && base ? (
                  <div className="muted sm2" style={{ marginTop: 6 }}>
                    یعنی هر {faDigits(rate)} {alt} که تحویل بگیرید، ۱ {base} در انبار ثبت می‌شود.
                  </div>
                ) : null}
            </label>
          )}
          <label className="fld"><span>اندازهٔ بسته (توضیحی)</span>
            <input value={f.packSize} onChange={set("packSize")} placeholder="حلب ۲۵ کیلویی" />
          </label>
        </div>

        <div className="row2">
          <label className="fld"><span>قیمت خرید (ریال)</span>
            <input type="number" min="0" value={f.costPrice} onChange={set("costPrice")} />
          </label>
          <label className="fld"><span>قیمت فروش (ریال)</span>
            <input type="number" min="0" value={f.salePrice} onChange={set("salePrice")} />
          </label>
        </div>

        <details className="more-box">
          <summary>مشخصات بیشتر</summary>
          <div className="row3" style={{ marginTop: 10 }}>
            <label className="fld sm"><span>کد محصول</span>
              <input value={f.productCode} onChange={set("productCode")} readOnly={Boolean(vt)} />
            </label>
            <label className="fld sm"><span>کد سپیدار</span>
              <input value={f.sepidarItemId} onChange={set("sepidarItemId")} />
            </label>
            <label className="fld sm"><span>شماره سنباده</span>
              <input value={f.grit} onChange={set("grit")} />
            </label>
          </div>
          <label className="fld"><span>بیس / شید</span>
            <input value={f.shade} onChange={set("shade")} />
          </label>
        </details>

        <label className="wh-check">
          <input type="checkbox" checked={f.batchTracked} onChange={set("batchTracked")} />
          بچ و تاریخ انقضا دارد (رنگ و هاردنر)
        </label>
        <label className="wh-check">
          <input type="checkbox" checked={f.hazardous} onChange={set("hazardous")} />
          آتش‌زا (تینر و حلال)
        </label>
        {!f.isAsset && (
          <label className="wh-check">
            <input type="checkbox" checked={f.sellable} onChange={set("sellable")} />
            در سایت فروش عرضه می‌شود
          </label>
        )}
        {/* از پنجرهٔ ادغام مواد مصرفی فقط کالای مصرفی ساخته می‌شود؛ وسیله مقصد ادغام نیست. */}
        {!consumableOnly && (
          <label className="wh-check">
            <input type="checkbox" checked={f.isAsset}
              onChange={(e) => setF((p) => ({
                ...p, isAsset: e.target.checked,
                // وسیله فروختنی نیست.
                sellable: e.target.checked ? false : p.sellable,
              }))} />
            کالای اموالی است (کد اموال می‌خورد و دست کسی سپرده می‌شود)
          </label>
        )}

        {f.isAsset && (
          <div className="pack-box">
            <div className="items-hd">اموال</div>
            <div className="muted sm2" style={{ marginBottom: 10 }}>
              هر کد اموال روی یک وسیلهٔ مشخص می‌نشیند؛ دو پیستولهٔ همسان با دو کد،
              دو ردیف جدا هستند.
            </div>
            <div className="row2">
              <label className="fld"><span>کد اموال</span>
                <input value={f.assetCode} onChange={set("assetCode")}
                  placeholder="مثلاً ۱۰۲-۴۵" />
              </label>
              <label className="fld"><span>محل استقرار</span>
                {newPlace === null ? (
                  <div className="pick-row">
                    <select value={f.location || ""} onChange={set("location")}>
                      <option value="">— انتخاب کنید —</option>
                      {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="button" className="ghost"
                      onClick={() => setNewPlace("")}>+ محل تازه</button>
                  </div>
                ) : (
                  <div className="pick-row">
                    <input autoFocus value={newPlace} placeholder="مثلاً سالن ۱"
                      onChange={(e) => setNewPlace(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); savePlace(); }
                        if (e.key === "Escape") setNewPlace(null);
                      }} />
                    <button type="button" className="ghost" disabled={placeBusy}
                      onClick={savePlace}>ثبت</button>
                    <button type="button" className="ghost"
                      onClick={() => setNewPlace(null)}>انصراف</button>
                  </div>
                )}
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>تحویل‌گیرنده</span>
                <input list="divaj-people" value={f.holder} onChange={set("holder")}
                  placeholder="نام تحویل‌گیرنده" />
                <datalist id="divaj-people">
                  {people.map((p) => <option key={p} value={p} />)}
                </datalist>
              </label>
              <label className="fld"><span>تاریخ تحویل</span>
                <JalaliPicker value={f.handedOverOn || ""} placeholder="— تعیین نشده —"
                  onChange={(v) => setF((p) => ({ ...p, handedOverOn: v }))} />
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>وضعیت</span>
                <select value={f.assetStatus || "ok"} onChange={set("assetStatus")}>
                  {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="fld"><span>شماره سریال</span>
                <input value={f.assetSerial} onChange={set("assetSerial")} dir="ltr" />
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>مدل</span>
                <input value={f.assetModel} onChange={set("assetModel")} placeholder="مثلاً SATAjet X 5500" />
              </label>
              <label className="fld"><span>فروشنده</span>
                <input value={f.assetSupplier} onChange={set("assetSupplier")} />
              </label>
            </div>

            <div className="items-hd sub">خرید و گارانتی</div>
            <div className="row2">
              <label className="fld"><span>تاریخ خرید</span>
                <JalaliPicker value={f.purchaseDate || ""} placeholder="— تعیین نشده —"
                  onChange={(v) => setF((p) => ({ ...p, purchaseDate: v }))} />
              </label>
              <label className="fld"><span>قیمت خرید (ریال)</span>
                <input type="number" min="0" inputMode="numeric" value={f.purchasePrice} onChange={set("purchasePrice")} />
                {Number(f.purchasePrice) > 0 && <small className="muted sm2">{faRial(f.purchasePrice)} ریال</small>}
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>پایان گارانتی</span>
                <JalaliPicker value={f.warrantyUntil || ""} placeholder="— ندارد —"
                  onChange={(v) => setF((p) => ({ ...p, warrantyUntil: v }))} />
              </label>
              <label className="fld"><span>هر چند روز سرویس؟</span>
                <input type="number" min="1" inputMode="numeric" value={f.serviceIntervalDays}
                  onChange={set("serviceIntervalDays")} placeholder="مثلاً ۹۰ — خالی یعنی سرویس دوره‌ای ندارد" />
              </label>
            </div>

            <div className="items-hd sub">استهلاک (خطی)</div>
            <div className="row2">
              <label className="fld"><span>عمر مفید (سال)</span>
                <input type="number" min="0.5" step="0.5" inputMode="decimal" value={f.usefulLifeYears}
                  onChange={set("usefulLifeYears")} placeholder="مثلاً ۵" />
              </label>
              <label className="fld"><span>ارزش اسقاط (ریال)</span>
                <input type="number" min="0" inputMode="numeric" value={f.salvageValue} onChange={set("salvageValue")}
                  placeholder="ارزش در پایان عمر مفید" />
              </label>
            </div>
            <label className="fld"><span>یادداشت</span>
              <textarea rows={2} value={f.assetNote} onChange={set("assetNote")} />
            </label>
          </div>
        )}

        {!isNew && (
          <label className="wh-check">
            <input type="checkbox" checked={f.active} onChange={set("active")} />
            فعال
          </label>
        )}

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={!valid || busy} onClick={save}>
            {busy ? "در حال ذخیره…" : isNew ? "تعریف کالا" : "ذخیره"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WarehouseSetupPane() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  const [whName, setWhName] = useState("");
  const [whCode, setWhCode] = useState("");
  const [whWorkshop, setWhWorkshop] = useState(false);

  const [item, setItem] = useState({ name: "", brand: "", category: "", code: "", packSize: "", batchTracked: false, hazardous: false });

  const [file, setFile] = useState(null);
  const [report, setReport] = useState("");

  async function addWarehouse() {
    if (!whName.trim() || busy) return;
    setBusy(true);
    try {
      await warehouseApi.createWarehouse({ name: whName.trim(), code: whCode.trim(), suppliesWorkshop: whWorkshop });
      setWhName(""); setWhCode(""); setWhWorkshop(false);
      flash("انبار ساخته شد ✓ — همهٔ کالاها در آن ردیف گرفتند.");
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function addItem() {
    if (!item.name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await warehouseApi.createWorkshopItem(item);
      setItem({ name: "", brand: "", category: "", code: "", packSize: "", batchTracked: false, hazardous: false });
      flash(`«${r.name}» اضافه شد ✓ (شناسه ${r.packageId})`);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function runImport(dryRun) {
    if (!file || busy) return;
    setBusy(true); setReport("");
    try {
      const r = await warehouseApi.importCatalog(file, dryRun);
      setReport(r.report || "");
      flash(dryRun ? "بررسی انجام شد — چیزی ذخیره نشد." : "فایل وارد شد ✓");
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className="notice">{msg}</div>}

      <div className="card">
        <div className="board-h">بارگذاری فایل اکسل سایت</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          فایل انبارگردانی سایت را اینجا بدهید. کالای جدید اضافه می‌شود، قیمت‌ها به‌روز می‌شوند،
          و اگر ستون «تعداد موجود» پر باشد موجودی هم تنظیم می‌شود. اگر همان فایل را دوباره بدهید،
          چیزی دوبار حساب نمی‌شود.
        </div>
        <input type="file" accept=".xlsx,.xlsm" className="fld"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setReport(""); }} />
        {file && <div className="muted sm2" style={{ marginTop: 6 }}>فایل انتخاب‌شده: {file.name}</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="ghost" disabled={!file || busy} onClick={() => runImport(true)}>
            اول بررسی کن (بدون ذخیره)
          </button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={!file || busy} onClick={() => runImport(false)}>
            {busy ? "در حال پردازش…" : "وارد کن"}
          </button>
        </div>
        {report && <pre className="import-report">{report}</pre>}
      </div>

      <div className="card">
        <div className="board-h">انبار جدید</div>
        <div className="row2">
          <label className="fld"><span>نام انبار</span>
            <input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="مثلاً: انبار شیراز" />
          </label>
          <label className="fld"><span>کد (اختیاری)</span>
            <input value={whCode} onChange={(e) => setWhCode(e.target.value)} />
          </label>
        </div>
        <label className="wh-check">
          <input type="checkbox" checked={whWorkshop} onChange={(e) => setWhWorkshop(e.target.checked)} />
          کارگاه مواد خود را از این انبار برمی‌دارد
        </label>
        <button className="submit" disabled={!whName.trim() || busy} onClick={addWarehouse}>ساخت انبار</button>
      </div>

      <div className="card">
        <div className="board-h">کالای کارگاهی (غیرفروشی)</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          برای موادی مثل پولچم و والرسا که در سایت فروش نیستند. کالای فروشی را اینجا نسازید —
          از فایل اکسل سایت وارد کنید تا شناسه‌اش با سایت یکی بماند.
        </div>
        <div className="row2">
          <label className="fld"><span>نام کالا</span>
            <input value={item.name} onChange={(e) => setItem((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label className="fld"><span>برند</span>
            <input value={item.brand} onChange={(e) => setItem((p) => ({ ...p, brand: e.target.value }))} />
          </label>
        </div>
        <div className="row3">
          <label className="fld sm"><span>دسته</span>
            <input value={item.category} onChange={(e) => setItem((p) => ({ ...p, category: e.target.value }))} />
          </label>
          <label className="fld sm"><span>کد</span>
            <input value={item.code} onChange={(e) => setItem((p) => ({ ...p, code: e.target.value }))} />
          </label>
          <label className="fld sm"><span>واحد / اندازه</span>
            <input value={item.packSize} onChange={(e) => setItem((p) => ({ ...p, packSize: e.target.value }))} placeholder="کیلوگرم" />
          </label>
        </div>
        <label className="wh-check">
          <input type="checkbox" checked={item.batchTracked}
            onChange={(e) => setItem((p) => ({ ...p, batchTracked: e.target.checked }))} />
          بچ و تاریخ انقضا دارد (رنگ و هاردنر)
        </label>
        <label className="wh-check">
          <input type="checkbox" checked={item.hazardous}
            onChange={(e) => setItem((p) => ({ ...p, hazardous: e.target.checked }))} />
          آتش‌زا (تینر و حلال)
        </label>
        <button className="submit" disabled={!item.name.trim() || busy} onClick={addItem}>افزودن کالا</button>
      </div>
    </>
  );
}

/** ثبت یک گردش انبار برای یک کالا. */
function StockMoveDialog({ row, warehouses, defaultWarehouse, onClose, onDone }) {
  const [warehouse, setWarehouse] = useState(defaultWarehouse || warehouses[0]?.id || "");
  const [kind, setKind] = useState("receipt");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [date, setDate] = useState(todayIso());
  const [unitCost, setUnitCost] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const info = MOVE_KINDS.find((k) => k.id === kind) || MOVE_KINDS[0];
  const isReceipt = kind === "receipt";
  const here = (row.stock || []).find((s) => s.warehouse === warehouse);
  const valid = warehouse && Number(qty) !== 0 && !Number.isNaN(Number(qty));

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await warehouseApi.addMovement({
        sku: row.id, warehouse, kind,
        qty: Number(qty), unit, date,
        unitCost: Number(unitCost) || 0,
        batch_no: batchNo.trim() || undefined,
        expires_on: expires || undefined,
        note: note.trim(),
      });
      onDone(`${info.label} ثبت شد ✓`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">ثبت گردش انبار</div>
        <div className="wh-dialog-item">
          <b>{row.productName}</b>
          <div className="muted sm2">
            {row.packSize}{[row.grit, row.shade].filter(Boolean).length ? " · " + [row.grit, row.shade].filter(Boolean).join(" / ") : ""}
            {" · "}شناسه {row.packageId}
          </div>
        </div>

        <label className="fld"><span>انبار</span>
          <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            {warehouses.map((w) => {
              const c = (row.stock || []).find((s) => s.warehouse === w.id);
              return <option key={w.id} value={w.id}>{w.name} — موجودی {c ? c.onHand : 0}</option>;
            })}
          </select>
        </label>

        <label className="fld"><span>نوع گردش</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {MOVE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>

        <div className="row3">
          <label className="fld sm"><span>
            مقدار {info.dir === "out" ? "(کم می‌شود)" : info.dir === "in" ? "(اضافه می‌شود)" : ""}
          </span>
            <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="۰" />
          </label>
          <label className="fld sm"><span>واحد</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!row.altUnit}>
              <option value="">{row.baseUnit || "واحد اصلی"}</option>
              {row.altUnit && <option value={row.altUnit}>{row.altUnit}</option>}
            </select>
          </label>
          <label className="fld sm"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
        </div>
        {unit && row.altUnit === unit && row.altToBase ? (
          <div className="unit-hint">
            {faDigits(Number(qty) || 0)} {unit} = {faDigits(((Number(qty) || 0) * row.altToBase).toFixed(3))} {row.baseUnit}
          </div>
        ) : null}

        {isReceipt && (
          <label className="fld"><span>قیمت خرید هر واحد (ریال، اختیاری)</span>
            <input type="number" inputMode="numeric" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </label>
        )}

        {row.batchTracked && isReceipt && (
          <div className="row2">
            <label className="fld"><span>شمارهٔ بچ</span>
              <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="روی حلب نوشته شده" />
            </label>
            <label className="fld"><span>تاریخ انقضا</span>
              {expires
                ? <button className="date-fil on" onClick={() => setExpires("")}>{jShort(expires)} ✕</button>
                : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={setExpires} /></div>}
            </label>
          </div>
        )}

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً شمارهٔ فاکتور" />
        </label>

        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={!valid || busy} onClick={save}>
            {busy ? "در حال ثبت…" : "ثبت"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** شکستن بسته: یک جعبه به معادل دانه‌اش تبدیل می‌شود.

 *  چون جعبه و دانه در سایت دو کالای جداست، انباری که فقط جعبه دارد بدون این
 *  کار نمی‌تواند سفارش دانه‌ای را جواب دهد. */
function UnpackDialog({ row, warehouse, onClose, onDone }) {
  const [info, setInfo] = useState(null);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    warehouseApi.canUnpack(row.id)
      .then(setInfo)
      .catch(() => setInfo({ canUnpack: false }));
  }, [row]);

  const here = (row.stock || []).find((s) => s.warehouse === warehouse);
  const onHand = here ? here.onHand : 0;
  const boxes = Number(qty) || 0;
  const valid = info?.canUnpack && boxes > 0 && boxes <= onHand;

  async function run() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await warehouseApi.unpack({ sku: row.id, warehouse, qty: boxes });
      onDone(`${faDigits(r.boxes)} بسته شکسته شد ← ${faDigits(r.pieces)} عدد ✓`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">شکستن بسته</div>
        {info === null ? <div className="empty">…</div>
          : !info.canUnpack ? (
            <>
              <div className="empty">برای این کالا معادل دانه‌ای تعریف نشده است.</div>
              <div className="muted sm2">
                شکستن بسته فقط برای کالایی ممکن است که هم جعبه‌ای و هم تکی در فهرست سایت باشد.
              </div>
            </>
          ) : (
            <>
              <div className="wh-dialog-item">
                <b>{row.productName}</b>
                <div className="muted sm2">
                  {info.boxLabel} · موجودی {faDigits(onHand)} {row.baseUnit}
                </div>
              </div>
              <div className="unit-hint">۱ {row.packSize} = {faDigits(info.factor)} عدد</div>
              <label className="fld"><span>چند بسته باز می‌شود؟</span>
                <input type="number" inputMode="decimal" value={qty}
                  onChange={(e) => setQty(e.target.value)} />
              </label>
              {boxes > onHand && <div className="notice warn">بیشتر از موجودی است.</div>}
              {valid && (
                <div className="unit-hint">
                  {faDigits(boxes)} بسته کم و {faDigits(boxes * info.factor)} عدد اضافه می‌شود.
                </div>
              )}
            </>
          )}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          {info?.canUnpack && (
            <button className="submit" style={{ width: "auto", margin: 0 }}
              disabled={!valid || busy} onClick={run}>{busy ? "…" : "شکستن"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** کاردکس: همهٔ گردش‌های یک کالا با ماندهٔ پس از هر ردیف. */
function KardexDialog({ sku, warehouses, warehouse, from: from0, to: to0, onClose }) {
  const [wh, setWh] = useState(warehouse || "");
  const [from, setFrom] = useState(from0 || "");
  const [to, setTo] = useState(to0 || "");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setData(null);
    warehouseApi.kardex({ sku: sku.id, warehouse: wh, from, to })
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) { setErr(e.message); setData({ rows: [] }); } });
    return () => { live = false; };
  }, [sku.id, wh, from, to]);

  const unit = data?.sku?.baseUnit || sku.baseUnit || "";
  function exportXlsx() {
    saveSheet(`کاردکس-${data.sku.code}`, "کاردکس", [
      [`کاردکس ${data.sku.name} (${data.sku.code}) — ${data.warehouse || "همهٔ انبارها"} — واحد: ${unit}`],
      ["تاریخ", "شرح", "شماره", "طرف مقابل", "انبار", "ورود", "خروج", "مانده", "ثبت‌کننده", "توضیح"],
      [from ? jShort(from) : "", "موجودی اول دوره", "", "", "", "", "", data.opening, "", ""],
      ...data.rows.map((r) => [jShort(r.date), r.kindLabel, r.number || r.ref || "", r.party || "", r.warehouse,
        r.in || "", r.out || "", r.balance, r.by, r.note || ""]),
      [to ? jShort(to) : "", "جمع و موجودی پایان دوره", "", "", "", data.in, data.out, data.closing, "", ""],
    ]);
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide" role="dialog" aria-labelledby="kx-title">
        <div className="board-h" id="kx-title">کاردکس کالا</div>
        <div className="wh-dialog-item">
          <b>{sku.productName || sku.name}</b>
          <div className="muted sm2">
            {[sku.packSize, `شناسه ${sku.packageId || sku.code}`, unit && `واحد: ${unit}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="filters">
          <select value={wh} onChange={(e) => setWh(e.target.value)} aria-label="انبار">
            <option value="">همهٔ انبارها</option>
            {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />

        {err ? <div className="notice warn">{err}</div>
          : data === null ? <div className="empty">در حال بارگذاری…</div> : (
          <>
            <div className="asset-flags" style={{ margin: "12px 2px" }}>
              <span>اول دوره: <b>{fq(data.opening)}</b></span>
              <span>ورود: <b className="diff-pos">{fq(data.in)}</b></span>
              <span>خروج: <b className="diff-neg">{fq(data.out)}</b></span>
              <span>پایان دوره: <b>{fq(data.closing)}</b> {unit}</span>
            </div>
            {data.rows.length === 0 ? <div className="empty">در این بازه گردشی ثبت نشده.</div> : (
              <div className="tbl-scroll">
                <table className="print-table wh-table">
                  <thead>
                    <tr><th>تاریخ</th><th>شرح</th>{!wh && <th>انبار</th>}<th>ورود</th><th>خروج</th><th>مانده</th>
                      <th>ثبت‌کننده</th><th>توضیح</th></tr>
                  </thead>
                  <tbody>
                    <tr className="kx-edge">
                      <td>{from ? jShort(from) : "—"}</td>
                      <td colSpan={wh ? 3 : 4}>موجودی اول دوره</td>
                      <td className="wh-qty">{fq(data.opening)}</td>
                      <td colSpan={2} />
                    </tr>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{jShort(r.date)}</td>
                        <td>{r.kindLabel}
                          <div className="wh-sub">
                            {r.number ? <span>{faDigits(r.number)}</span> : r.ref ? <span>{r.ref}</span> : null}
                            {r.party && <span>{r.party}</span>}
                            {r.batchNo && <span>بچ {r.batchNo}</span>}
                          </div>
                        </td>
                        {!wh && <td>{r.warehouse}</td>}
                        <td className="wh-qty diff-pos">{r.in ? fq(r.in) : ""}</td>
                        <td className="wh-qty diff-neg">{r.out ? fq(r.out) : ""}</td>
                        <td className={r.balance < 0 ? "wh-qty low" : "wh-qty"}>{fq(r.balance)}</td>
                        <td>{r.by}</td>
                        <td>{r.note || "—"}</td>
                      </tr>
                    ))}
                    <tr className="kx-edge">
                      <td>{to ? jShort(to) : "امروز"}</td>
                      <td colSpan={wh ? 1 : 2}>جمع دوره و موجودی پایان دوره</td>
                      <td className="wh-qty diff-pos">{fq(data.in)}</td>
                      <td className="wh-qty diff-neg">{fq(data.out)}</td>
                      <td className="wh-qty">{fq(data.closing)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {data.truncated && (
              <div className="muted sm2">فقط ۳٬۰۰۰ ردیف اول نشان داده شد؛ بازهٔ تاریخ را کوتاه‌تر کنید. جمع‌ها کامل‌اند.</div>
            )}
          </>
        )}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>بستن</button>
          <button className="ghost" disabled={!data?.rows?.length} onClick={exportXlsx}>خروجی اکسل</button>
        </div>
      </div>
    </div>
  );
}

/* ============ داشبورد ============ */
function Dashboard({ reports, projects, materialUsages, drivers, driverReports, users, session, employees, onToggleEmployee, onDeleteEmployee }) {
  const stats = useMemo(() => {
    const byStatus = { draft: 0, waiting: 0, approved: 0, revision: 0 };
    let hours = 0; const byProj = {}; const byEmp = {};
    reports.forEach((r) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      (r.items || []).forEach((it) => {
        hours += it.hours || 0;
        byProj[it.projectName] = (byProj[it.projectName] || 0) + (it.hours || 0);
        byEmp[it.employee] = (byEmp[it.employee] || 0) + (it.hours || 0);
      });
    });
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    return { byStatus, hours, count: reports.length, byProj: top(byProj), byEmp: top(byEmp) };
  }, [reports]);
  const maxP = Math.max(1, ...stats.byProj.map((x) => x[1]));
  const maxE = Math.max(1, ...stats.byEmp.map((x) => x[1]));
  const isManager = hasAccess(session, "dashboard.staff");
  const canBackup = hasAccess(session, "dashboard.backup");
  const canCostReport = hasAccess(session, "dashboard.cost");

  const [dayDate, setDayDate] = useState(todayIso());
  const dayStats = useMemo(() => {
    const worked = {};
    reports.forEach((r) => {
      if (r.date !== dayDate) return;
      (r.items || []).forEach((it) => { worked[it.employee] = (worked[it.employee] || 0) + (it.hours || 0); });
    });
    const activeEmployees = employees.filter((e) => e.active !== false);
    const rows = activeEmployees.map((emp) => ({ name: emp.name, worked: worked[emp.name] || 0 }));
    Object.keys(worked).forEach((name) => {
      if (!activeEmployees.some((e) => e.name === name)) rows.push({ name, worked: worked[name] });
    });
    return rows.map((r) => ({ ...r, remaining: WORKDAY_HOURS - r.worked })).sort((a, b) => b.worked - a.worked);
  }, [reports, employees, dayDate]);

  return (
    <>
      <div className="no-print">
        {canBackup && (
          <button className="export-btn" onClick={() => exportExcel(reports, projects, users, materialUsages)}>
            ⬇ خروجی اکسل (بک‌اپ کامل)
          </button>
        )}
        <div className="stats">
          <div className="stat"><b>{faDigits(stats.count)}</b><span>گزارش</span></div>
          <div className="stat"><b>{faDigits(stats.hours)}</b><span>ساعت‌کار</span></div>
          <div className="stat"><b>{faDigits(stats.byStatus.approved || 0)}</b><span>تأییدشده</span></div>
          <div className={stats.byStatus.waiting ? "stat warn" : "stat"}><b>{faDigits(stats.byStatus.waiting || 0)}</b><span>در انتظار</span></div>
        </div>
        <div className="card">
          <div className="board-h">ساعت‌کار به تفکیک پروژه</div>
          {stats.byProj.length === 0 ? <div className="muted">داده‌ای نیست.</div> : stats.byProj.map(([n, h]) => (
            <div className="bar-row" key={n}><span className="bar-lbl">{n}</span><div className="bar"><div style={{ width: (h / maxP * 100) + "%" }} /></div><span className="bar-v">{faDigits(h)}</span></div>
          ))}
        </div>
        <div className="card">
          <div className="board-h">ساعت‌کار به تفکیک پرسنل</div>
          {stats.byEmp.length === 0 ? <div className="muted">داده‌ای نیست.</div> : stats.byEmp.map(([n, h]) => (
            <div className="bar-row" key={n}><span className="bar-lbl">{n}</span><div className="bar emp"><div style={{ width: (h / maxE * 100) + "%" }} /></div><span className="bar-v">{faDigits(h)}</span></div>
          ))}
        </div>

        <div className="card">
          <div className="board-h">زمان کاری / خالی روزانه</div>
          <label className="fld"><span>تاریخ</span><JalaliPicker value={dayDate} onChange={setDayDate} /></label>
          {dayStats.length === 0 ? <div className="muted">کارگری برای این روز ثبت نشده.</div> : dayStats.map((row) => (
            <div className="day-row" key={row.name}>
              <span className="day-name">{row.name}</span>
              <span className="day-h">{faDigits(row.worked)} ساعت کار</span>
              <span className={row.remaining < 0 ? "day-idle over" : "day-idle"}>
                {row.remaining >= 0 ? `${faDigits(row.remaining)} ساعت خالی` : `${faDigits(Math.abs(row.remaining))} ساعت اضافه‌کار`}
              </span>
            </div>
          ))}
        </div>

        <DriverReportExport drivers={drivers} driverReports={driverReports} />

        {isManager && employees.length > 0 && (
          <>
            <div className="card"><div className="board-h">مدیریت کارگرها</div><div className="muted sm2">کارگر جدید رو از طریق گزینهٔ «+ کارگر جدید» توی فرم ثبت گزارش اضافه کنید.</div></div>
            {employees.map((emp) => (
              <div className="card proj" key={emp.id}>
                <div><b>{emp.name}</b></div>
                <div className="proj-actions">
                  <button className={emp.active !== false ? "toggle on" : "toggle"} onClick={() => onToggleEmployee(emp).catch((e) => alert(e.message))}>
                    {emp.active !== false ? "فعال" : "غیرفعال"}
                  </button>
                  <button className="del" onClick={() => onDeleteEmployee(emp.id).catch((e) => alert(e.message))}>حذف</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {canCostReport && <ProjectCostReport projects={projects} reports={reports} materialUsages={materialUsages} />}
    </>
  );
}

/* ============ گزارش پروژه برای مالی (قابل پرینت) ============ */
function ProjectCostReport({ projects, reports, materialUsages }) {
  const [project, setProject] = useState(projects[0]?.id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const proj = projects.find((p) => p.id === project);

  // تاریخ‌ها به شکل YYYY-MM-DD ذخیره می‌شوند، پس مقایسهٔ رشته‌ای همان ترتیب زمانی است.
  const swapped = from && to && from > to;
  const [lo, hi] = swapped ? [to, from] : [from, to];
  const inRange = useCallback(
    (d) => (!lo || d >= lo) && (!hi || d <= hi),
    [lo, hi],
  );

  const empHours = useMemo(() => {
    const m = {};
    reports.forEach((r) => {
      if (!inRange(r.date)) return;
      (r.items || []).forEach((it) => {
        if (it.project !== project) return;
        m[it.employee] = (m[it.employee] || 0) + (it.hours || 0);
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [reports, project, inRange]);

  // متراژ به تفکیک مرحله — از گزارش پیشرفت روزانه، نه از آیتم‌های هر نفر.
  const stageArea = useMemo(() => {
    const m = {};
    reports.forEach((r) => {
      if (!inRange(r.date)) return;
      (r.progress || []).forEach((g) => {
        if (g.project !== project) return;
        m[g.stage] = (m[g.stage] || 0) + (g.area || 0);
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [reports, project, inRange]);

  // فقط مصرفِ گزارش‌های تأییدشده وارد گزارش مالی می‌شود.
  const matQty = useMemo(() => {
    const m = {};
    materialUsages
      .filter((rep) => rep.status === "approved" && inRange(rep.date))
      .forEach((rep) => (rep.items || []).forEach((row) => {
        if (row.project !== project) return;
        const key = row.materialName + (row.unit ? ` (${row.unit})` : "");
        m[key] = (m[key] || 0) + (row.quantity || 0);
      }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [materialUsages, project, inRange]);

  const totalHours = empHours.reduce((a, [, h]) => a + h, 0);
  const totalArea = stageArea.reduce((a, [, v]) => a + v, 0);

  // بازهٔ گزارش روی برگهٔ چاپی نوشته می‌شود؛ گزارش مالی بدون دوره بی‌معناست.
  const rangeLabel = lo && hi ? `از ${jShort(lo)} تا ${jShort(hi)}`
    : lo ? `از ${jShort(lo)} به بعد`
    : hi ? `تا ${jShort(hi)}`
    : "همهٔ تاریخ‌ها";

  return (
    <div className="card">
      <div className="no-print">
        <div className="board-h">گزارش پروژه (برای مالی)</div>
        <label className="fld"><span>پروژه</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

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
        {(from || to) && (
          <div className="range-note">
            بازهٔ گزارش: {rangeLabel}
            {swapped && " — تاریخ شروع بعد از پایان بود، جابه‌جا حساب شد."}
            <button className="link-btn" onClick={() => { setFrom(""); setTo(""); }}>پاک کردن بازه</button>
          </div>
        )}

        <button className="submit" onClick={() => window.print()}>🖨 پرینت گزارش</button>
      </div>

      <div className="print-report">
        <h3 className="print-title">گزارش پروژه: {proj?.name || "—"}</h3>
        <div className="muted sm2">بازهٔ گزارش: {rangeLabel}</div>
        <div className="muted sm2">تاریخ تهیهٔ گزارش: {jShort(todayIso())}</div>

        <div className="board-h">ساعت‌کار به تفکیک پرسنل</div>
        {empHours.length === 0 ? <div className="muted">داده‌ای نیست.</div> : (
          <table className="print-table">
            <thead><tr><th>پرسنل</th><th>ساعت</th></tr></thead>
            <tbody>
              {empHours.map(([name, h]) => <tr key={name}><td>{name}</td><td>{faDigits(h)}</td></tr>)}
              <tr className="total-row"><td>مجموع</td><td>{faDigits(totalHours)}</td></tr>
            </tbody>
          </table>
        )}

        <div className="board-h">متراژ انجام‌شده به تفکیک مرحله</div>
        {stageArea.length === 0 ? <div className="muted">داده‌ای نیست.</div> : (
          <table className="print-table">
            <thead><tr><th>مرحله</th><th>متراژ انجام‌شده (م²)</th><th>متراژ کل مرحله</th></tr></thead>
            <tbody>
              {stageArea.map(([name, v]) => {
                const planned = (proj?.stages || []).find((s) => s.name === name);
                return (
                  <tr key={name}>
                    <td>{name}</td><td>{faDigits(v)}</td>
                    <td>{planned ? faDigits(planned.area) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="total-row">
                <td>مجموع</td><td>{faDigits(totalArea)}</td><td>{faDigits(proj?.totalArea || 0)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="board-h">مصرف مواد</div>
        {matQty.length === 0 ? <div className="muted">داده‌ای نیست.</div> : (
          <table className="print-table">
            <thead><tr><th>ماده</th><th>مقدار</th></tr></thead>
            <tbody>
              {matQty.map(([name, q]) => <tr key={name}><td>{name}</td><td>{faDigits(q)}</td></tr>)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============ پروژه‌ها ============ */
function ProjectsView({ projects, session, onCreate, onToggle, onDelete, onSaveStages, onReopen }) {
  const isManager = hasAccess(session, "projects.manage");
  // پروژه از فرم ثبت گزارش هم ساخته می‌شود؛ همان اجازه در سرور.
  const canEditStages = hasAccess(session, "projects.create") || hasAccess(session, "entry.create");
  const [pane, setPane] = useState("open");
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [noArea, setNoArea] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [reopening, setReopening] = useState("");

  const openOnes = projects.filter((p) => !p.closedAt);
  const closedOnes = projects.filter((p) => p.closedAt);
  const shown = pane === "closed" ? closedOnes : openOnes;

  async function add() {
    const nm = name.trim(); if (!nm || busy) return;
    setBusy(true);
    try {
      await onCreate({ name: nm, code: code.trim(), active: true,
        startDate: startDate || null, dueDate: dueDate || null, noArea });
      setName(""); setCode(""); setStartDate(todayIso()); setDueDate(""); setNoArea(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen(p) {
    if (reopening) return;
    if (!window.confirm(`پروژهٔ «${p.name}» از بایگانی برگردد و دوباره باز شود؟`)) return;
    setReopening(p.id);
    try { await onReopen(p.id); setPane("open"); }
    catch (e) { alert(e.message); } finally { setReopening(""); }
  }

  return (
    <>
      <div className="sub-tabs no-print">
        <button className={pane === "open" ? "sub-tab on" : "sub-tab"} onClick={() => { setPane("open"); setOpenId(null); }}>
          پروژه‌های باز ({faDigits(openOnes.length)})
        </button>
        <button className={pane === "closed" ? "sub-tab on" : "sub-tab"} onClick={() => { setPane("closed"); setOpenId(null); }}>
          بسته‌شده و بایگانی ({faDigits(closedOnes.length)})
        </button>
      </div>

      {pane === "closed" && (
        <div className="muted sm2" style={{ marginBottom: 12 }}>
          کار این پروژه‌ها تمام شده و از صف تولید، پیش‌بینی‌ها و فهرست ثبت گزارش بیرون رفته‌اند.
          آمارشان سر جایش می‌ماند. اگر کاری دوباره راه افتاد، «بازکردن» بزنید.
        </div>
      )}

      {pane === "open" && canEditStages && (
        <div className="card">
          <div className="board-h">پروژهٔ جدید</div>
          <div className="row2">
            <label className="fld"><span>نام پروژه</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: کابینت آشپزخانه" /></label>
            <label className="fld"><span>کد (اختیاری)</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KIT" /></label>
          </div>
          <div className="row2">
            <div className="fld"><span>تاریخ شروع</span>
              <JalaliPicker value={startDate} onChange={setStartDate} /></div>
            <div className="fld"><span>تاریخ تحویل</span>
              <JalaliPicker value={dueDate} onChange={setDueDate} placeholder="هنوز معلوم نیست" /></div>
          </div>
          <label className="chk-line">
            <input type="checkbox" checked={noArea} onChange={(e) => setNoArea(e.target.checked)} />
            <span>پروژهٔ خدماتی است و متراژ ندارد (مثل «خدمات کارگاه»)</span>
          </label>
          {!noArea && (
            <div className="muted sm2" style={{ marginBottom: 8 }}>
              پس از افزودن، حتماً مراحل و متراژ هر مرحله را وارد کنید — بی متراژ، صفحهٔ تولید
              نمی‌تواند بگوید این پروژه چقدر پیش رفته و چقدر مانده.
            </div>
          )}
          <button className="submit" disabled={!name.trim() || busy} onClick={add}>افزودن پروژه</button>
        </div>
      )}
      {shown.length === 0 ? (
        <div className="empty">
          {pane === "closed" ? "هنوز پروژهٔ بسته‌شده‌ای نیست." : "پروژهٔ بازی نیست."}
        </div>
      ) : shown.map((p) => {
        const stages = p.stages || [];
        const done = stages.filter((s) => s.done).length;
        const isClosed = Boolean(p.closedAt);
        // پروژهٔ بسته کارش تمام است، پس نوارش پر نشان داده می‌شود؛ ولی عددهای واقعی
        // و دلیلِ بستن زیرش می‌مانند تا چیزی پنهان نشود.
        const pct = isClosed ? 100 : (stages.length ? Math.round(done / stages.length * 100) : 0);
        return (
          <div className={isClosed ? "card closed" : "card"} key={p.id}>
            <div className="proj" style={{ padding: 0 }}>
              <div>
                <b>{p.name}</b>{p.code ? <span className="proj-code">{p.code}</span> : null}
                {isClosed && <span className="pill done" style={{ marginInlineStart: 8 }}>بایگانی</span>}
              </div>
              {isClosed ? (
                isManager && (
                  <div className="proj-actions">
                    <button className="toggle" disabled={reopening === p.id} onClick={() => reopen(p)}>
                      {reopening === p.id ? "…" : "بازکردن"}
                    </button>
                  </div>
                )
              ) : isManager ? (
                <div className="proj-actions">
                  <button className={p.active !== false ? "toggle on" : "toggle"} onClick={() => onToggle(p).catch((e) => alert(e.message))}>
                    {p.active !== false ? "فعال" : "غیرفعال"}
                  </button>
                  <button className="del" onClick={() => onDelete(p.id).catch((e) => alert(e.message))}>حذف</button>
                </div>
              ) : (
                <span className={p.active !== false ? "day-idle" : "day-idle over"}>{p.active !== false ? "فعال" : "غیرفعال"}</span>
              )}
            </div>

            {isClosed && (
              <div className="close-note">
                بسته شد در {jShort(p.closedAt)}
                {p.closedBy ? ` توسط ${p.closedBy}` : ""}
                {p.closeReasonLabel && <> · <b>{p.closeReasonLabel}</b></>}
                {p.closeReason === "short" && p.closedRemaining > 0 && (
                  <> · <span className="warn-txt">{faDigits(round2(p.closedRemaining))} م² کسری</span></>
                )}
                {p.closeReason === "incomplete_data" && (
                  <> · <span className="warn-txt">آمارش کامل نیست</span></>
                )}
                {p.closeNote && <div className="muted sm2" style={{ marginTop: 4 }}>{p.closeNote}</div>}
              </div>
            )}

            {(stages.length > 0 || isClosed) && (
              <div className="stage-summary">
                <div className="bar-row" style={{ marginBottom: 4 }}>
                  <span className="bar-lbl">پیشرفت</span>
                  <div className={isClosed ? "bar full" : "bar"}><div style={{ width: pct + "%" }} /></div>
                  <span className="bar-v">{faDigits(pct)}٪</span>
                </div>
                <div className="muted sm2">
                  {isClosed
                    ? <>بسته شد · {stages.length > 0
                        ? <>{faDigits(stages.length)} مرحله · متراژ کل: {faDigits(p.totalArea || 0)} م²</>
                        : "متراژی برایش ثبت نشده بود"}</>
                    : <>{faDigits(done)} از {faDigits(stages.length)} مرحله انجام شده · متراژ کل: {faDigits(p.totalArea || 0)} م²</>}
                </div>
              </div>
            )}

            {stages.length > 0 && (
              <button className="stage-toggle" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                {openId === p.id ? "بستن مراحل ▲" : (isClosed ? "مشاهدهٔ مراحل ▼" : "مشاهده و ویرایش مراحل ▼")}
              </button>
            )}
            {!isClosed && stages.length === 0 && (
              <button className="stage-toggle" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                {openId === p.id ? "بستن مراحل ▲" : "تعیین مراحل پروژه ▼"}
              </button>
            )}

            {openId === p.id && (
              <ProjectStagesEditor
                project={p}
                readOnly={!canEditStages || isClosed}
                onSave={(list) => onSaveStages(p.id, list)}
                onClose={() => setOpenId(null)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function ProjectStagesEditor({ project, readOnly, onSave, onClose }) {
  const existing = project.stages || [];
  const stageList = useWorkStages();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // فهرست مراحل با تأخیر از سرور می‌آید؛ ردیف‌ها با آن ساخته می‌شوند و
  // متراژ/تیکی که کاربر زده حفظ می‌شود.
  useEffect(() => {
    setRows((prev) => stageList.map((s) => {
      const kept = prev.find((r) => r.name === s.name);
      if (kept) return { ...kept, needsArea: s.needsArea !== false };
      const cur = existing.find((x) => x.name === s.name);
      return {
        name: s.name, needsArea: s.needsArea !== false, on: !!cur,
        area: cur ? String(cur.area ?? "") : "", done: cur ? !!cur.done : false,
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageList, project.id]);

  const setRow = (name, patch) => setRows((p) => p.map((r) => (r.name === name ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.on);
  const totalArea = selected.reduce((a, r) => a + (Number(r.area) || 0), 0);
  // سرور هم همین را می‌گیرد؛ اینجا می‌گوییم تا کاربر پیش از ذخیره ببیند.
  const missing = selected.filter((r) => r.needsArea && !(Number(r.area) > 0));

  async function save() {
    if (busy || missing.length) return;
    setBusy(true); setMsg("");
    try {
      await onSave(selected.map((r) => ({ name: r.name, area: Number(r.area) || 0, done: r.done })));
      setMsg("مراحل ذخیره شد ✓");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage-box">
      <div className="muted sm2" style={{ marginBottom: 8 }}>
        مراحلی که این پروژه دارد را تیک بزنید و متراژ هر مرحله را وارد کنید.
      </div>
      {rows.map((r) => (
        <div className={r.on ? "stage-row on" : "stage-row"} key={r.name}>
          <label className="stage-pick">
            <input type="checkbox" disabled={readOnly} checked={r.on} onChange={(e) => setRow(r.name, { on: e.target.checked })} />
            <span>{r.name}</span>
          </label>
          {r.on && (
            <div className="stage-fields">
              {r.needsArea ? (
                <label className="fld sm">
                  <span>متراژ (م²)</span>
                  <input type="number" inputMode="decimal" disabled={readOnly} value={r.area}
                    className={!(Number(r.area) > 0) ? "need" : ""}
                    onChange={(e) => setRow(r.name, { area: e.target.value })} placeholder="لازم است" />
                </label>
              ) : <span className="muted sm2">این مرحله متراژ ندارد</span>}
              <button type="button" disabled={readOnly}
                className={r.done ? "toggle on" : "toggle"}
                onClick={() => setRow(r.name, { done: !r.done })}>
                {r.done ? "انجام شد ✓" : "انجام نشده"}
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="stage-total">
        {faDigits(selected.length)} مرحله انتخاب شده · مجموع متراژ: {faDigits(totalArea)} م²
      </div>
      {missing.length > 0 && !readOnly && (
        <div className="notice warn">
          متراژ این مرحله‌ها وارد نشده: {missing.map((r) => r.name).join("، ")}
        </div>
      )}
      {!readOnly && (
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>بستن</button>
          <button className="submit" disabled={busy || missing.length > 0} onClick={save}>
            {busy ? "در حال ذخیره…" : "ذخیرهٔ مراحل"}
          </button>
        </div>
      )}
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/* ============ کاربران ============ */
/* ============ کاربران ============ */
// پیش‌فرض هر نقش — همان ROLE_DEFAULTS، ROLE_ACTIONS و TAB_WIDE_ACTIONS در backend/core/access.py.
const ROLE_TAB_DEFAULTS = {
  manager: ["entry", "reports", "materials", "driver", "dashboard", "projects", "contract", "payroll", "users"],
  data_entry: ["entry", "reports", "materials", "driver", "dashboard", "projects", "contract"],
  viewer: ["reports", "materials", "driver", "dashboard"],
  driver: ["driver"],
  accountant: ["dashboard", "payroll"],
};
const ROLE_ACTION_DEFAULTS = {
  manager: ACCESS_ACTIONS.map((a) => a.id),
  data_entry: ["entry.create", "materials.create", "driver.create", "dashboard.cost", "projects.create"],
  viewer: [],
  driver: ["driver.create"],
  accountant: ["dashboard.cost", "dashboard.backup", "warehouse.cost"],
};
// این کارها پیش‌تر با خودِ سربرگ داده می‌شد، برای هر نقشی.
const TAB_WIDE_ACTIONS = ["warehouse.voucher", "warehouse.post", "warehouse.assets", "consumables.edit",
  "stockreview.edit", "finance.approve", "financereports.refresh", "maintenance.work"];
/** کارهای پیش‌فرض نقش (برای سربرگ‌های داده‌شده) — tabs نیامد یعنی سربرگ‌های پیش‌فرض خود نقش. */
function roleDefaults(role, tabs = ROLE_TAB_DEFAULTS[role] || []) {
  const wanted = new Set([...(ROLE_ACTION_DEFAULTS[role] || []), ...TAB_WIDE_ACTIONS]);
  const have = new Set(tabs);
  return ACCESS_KEYS.filter((k) => (k.includes(".") ? wanted.has(k) && have.has(k.split(".")[0]) : have.has(k)));
}
const AUDIT_LABELS = {
  created: "ساخت کاربر", profile: "ویرایش مشخصات", access: "تغییر دسترسی",
  activated: "فعال شد", deactivated: "غیرفعال شد", password_reset: "بازنشانی رمز",
};
const tabName = (key) => {
  const tab = (id) => (ACCESS_TABS.find((t) => t.id === id)?.label || id).replace(" (داخل انبار)", "");
  if (!key.includes(".")) return tab(key);
  return `${tab(key.split(".")[0])} › ${ACCESS_ACTIONS.find((a) => a.id === key)?.label || key}`;
};
const faDateTime = (iso) => (iso ? new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "");
const isActiveUser = (u) => u.isActive !== false;
const orderAccess = (set) => ACCESS_KEYS.filter((k) => set.has(k));

// گروه‌های تیک دسترسی همان گروه‌های منوی کناری‌اند؛ زیرسربرگ‌ها زیر سربرگ مادر.
function accessGroups() {
  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.ids));
  return NAV_GROUPS.map((g, i) => ({
    label: g.label,
    items: [
      ...g.ids.flatMap((id) => [ACCESS_TABS.find((t) => t.id === id), ...ACCESS_TABS.filter((t) => t.sub === id)]),
      ...(i === NAV_GROUPS.length - 1 ? ACCESS_TABS.filter((t) => !t.sub && !grouped.has(t.id)) : []),
    ].filter(Boolean),
  }));
}

function auditText(e) {
  const c = e.changes || {};
  if (e.action === "access") {
    return [...(c.added || []).map((k) => `+ ${tabName(k)}`), ...(c.removed || []).map((k) => `− ${tabName(k)}`)].join("، ");
  }
  if (e.action === "profile") {
    const label = { name: "نام", role: "نقش", position: "سمت" };
    const val = (f, v) => (f === "role" ? ROLES[v]?.label || v : v || "—");
    return Object.entries(c).map(([f, [a, b]]) => `${label[f] || f}: ${val(f, a)} ← ${val(f, b)}`).join(" · ");
  }
  if (e.action === "created" && c.role) return `با نقش ${ROLES[c.role]?.label || c.role}`;
  return "";
}

function AuditRow({ e, users }) {
  const target = users ? users.find((u) => u.username === e.target)?.name || e.target : null;
  const text = auditText(e);
  return (
    <li>
      <span className={`audit-kind k-${e.action}`}>{AUDIT_LABELS[e.action] || e.action}</span>
      <div className="audit-body">
        <div>{target && <b>{target}</b>}{target && text ? " — " : ""}{text}</div>
        <small>{e.actor || "سامانه"} · {faDateTime(e.at)}</small>
      </div>
    </li>
  );
}

function UsersView({ users, session, onCreate, onUpdate, onResetPassword }) {
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [open, setOpen] = useState(null);   // { username, pane }
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [recent, setRecent] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };

  // هر تغییری در فهرست کاربران یعنی شاید سطر تازه‌ای در تاریخچه آمده باشد.
  useEffect(() => { usersApi.history().then(setRecent).catch(() => setRecent([])); }, [users]);

  const counts = {
    all: users.length,
    active: users.filter(isActiveUser).length,
    inactive: users.filter((u) => !isActiveUser(u)).length,
    pw: users.filter((u) => isActiveUser(u) && u.mustChangePassword).length,
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = users
    .filter((u) => words.every((w) => `${u.name} ${u.username} ${u.position || ""}`.toLowerCase().includes(w)))
    .filter((u) => !roleF || u.role === roleF)
    .filter((u) => !statusF
      || (statusF === "active" && isActiveUser(u))
      || (statusF === "inactive" && !isActiveUser(u))
      || (statusF === "pw" && isActiveUser(u) && u.mustChangePassword))
    .sort((a, b) => Number(!isActiveUser(a)) - Number(!isActiveUser(b)) || (a.name || "").localeCompare(b.name || "", "fa"));
  const current = open && users.find((u) => u.username === open.username);

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(counts.all)}</b><span>کاربر</span></div>
        <div className="stat"><b>{faDigits(counts.active)}</b><span>فعال</span></div>
        <div className={counts.inactive ? "stat warn" : "stat"}><b>{faDigits(counts.inactive)}</b><span>غیرفعال</span></div>
        <div className={counts.pw ? "stat warn" : "stat"}><b>{faDigits(counts.pw)}</b><span>با رمز موقت</span></div>
      </div>

      <div className="card users-toolbar">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام، نام کاربری یا سمت…" aria-label="جست‌وجوی کاربر" />
        <div className="users-filters">
          <select value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label="فیلتر نقش">
            <option value="">همهٔ نقش‌ها</option>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="فیلتر وضعیت">
            <option value="">همهٔ وضعیت‌ها</option>
            <option value="active">فعال</option>
            <option value="inactive">غیرفعال</option>
            <option value="pw">با رمز موقت</option>
          </select>
          <button className="submit users-new" onClick={() => setCreating(true)}>+ کاربر جدید</button>
        </div>
      </div>
      {msg && <div className="ok-msg" role="status">{msg}</div>}

      {list.length === 0 ? <div className="empty">کاربری با این جست‌وجو پیدا نشد.</div> : (
        <div className="tbl-scroll">
          <table className="print-table users-table">
            <thead>
              <tr><th>کاربر</th><th>نقش</th><th>سمت</th><th>وضعیت</th><th>آخرین ورود</th><th>سربرگ‌ها</th>
                <th><span className="sr-only">ویرایش</span></th></tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.username} className={isActiveUser(u) ? "" : "is-off"}>
                  <td>
                    <div className="user-cell">
                      <Avatar user={u} className="sm" />
                      <div><b>{u.name}</b><small dir="ltr">{u.username}</small></div>
                    </div>
                  </td>
                  <td>
                    <span className="role-chip" style={{ color: ROLES[u.role]?.color, background: (ROLES[u.role]?.color || "#6B7A74") + "16" }}>
                      {ROLES[u.role]?.label || u.role}
                    </span>
                  </td>
                  <td>{u.position || "—"}</td>
                  <td>
                    <span className={isActiveUser(u) ? "u-status on" : "u-status off"}>{isActiveUser(u) ? "فعال" : "غیرفعال"}</span>
                    {isActiveUser(u) && u.mustChangePassword && <span className="u-status pw">رمز موقت</span>}
                  </td>
                  <td className="muted sm2">{u.lastLogin ? faDateTime(u.lastLogin) : "هنوز وارد نشده"}</td>
                  <td>{faDigits(ACCESS_TABS.filter((t) => (u.access || []).includes(t.id)).length)} از {faDigits(ACCESS_TABS.length)}</td>
                  <td><button className="act edit" onClick={() => setOpen({ username: u.username, pane: "profile" })}>ویرایش</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="items-hd">آخرین تغییرات کاربران</div>
        {recent === null ? <div className="muted sm2">در حال خواندن…</div>
          : recent.length === 0 ? <div className="muted sm2">هنوز تغییری ثبت نشده؛ از این به بعد هر تغییر اینجا می‌آید.</div>
          : <ul className="audit-list">{recent.slice(0, 8).map((e) => <AuditRow key={e.id} e={e} users={users} />)}</ul>}
      </div>

      {creating && (
        <NewUserDialog onClose={() => setCreating(false)} onCreate={onCreate}
          onCreated={(u) => {
            setCreating(false);
            flash(`«${u.name}» ساخته شد ✓ — دسترسی‌هایش را بررسی کنید.`);
            setOpen({ username: u.username, pane: "access" });
          }} />
      )}
      {current && (
        <UserDialog key={current.username} user={current} users={users} session={session} initialPane={open.pane}
          onClose={() => setOpen(null)} onUpdate={onUpdate} onResetPassword={onResetPassword} flash={flash} />
      )}
    </>
  );
}

function NewUserDialog({ onClose, onCreate, onCreated }) {
  const [f, setF] = useState({ username: "", name: "", role: "data_entry", position: POSITIONS[2], password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.username.trim() && f.name.trim() && f.password.trim().length >= 4;

  async function add() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const u = await onCreate({ username: f.username.trim(), name: f.name.trim(), role: f.role, position: f.position, password: f.password.trim() });
      onCreated(u);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog user-dialog" role="dialog" aria-labelledby="nu-title">
        <div className="items-hd" id="nu-title">کاربر جدید</div>
        <div className="row2">
          <label className="fld"><span>نام و نام خانوادگی</span><input value={f.name} onChange={set("name")} autoFocus /></label>
          <label className="fld"><span>نام کاربری</span><input value={f.username} onChange={set("username")} dir="ltr" autoComplete="off" placeholder="لاتین، بدون فاصله" /></label>
        </div>
        <div className="row2">
          <label className="fld"><span>نقش</span>
            <select value={f.role} onChange={set("role")}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </label>
          <label className="fld"><span>سمت سازمانی</span>
            <select value={f.position} onChange={set("position")}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        </div>
        <label className="fld"><span>رمز اولیه</span>
          <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" placeholder="حداقل ۴ نویسه" />
        </label>
        <div className="muted sm2" style={{ lineHeight: 1.9 }}>
          کاربر با این رمز وارد می‌شود و همان بار اول باید رمز دلخواهش را بگذارد. سربرگ‌ها از پیش‌فرض نقش پر می‌شوند
          و بعد از ساختن، قابل تغییرند.
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit" onClick={add} disabled={!valid || busy}>{busy ? "…" : "ساختن کاربر"}</button>
        </div>
      </div>
    </div>
  );
}

function UserDialog({ user, users, session, initialPane = "profile", onClose, onUpdate, onResetPassword, flash }) {
  const me = user.username === session.username;
  const active = isActiveUser(user);
  const [pane, setPane] = useState(initialPane);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState(user.name || "");
  const [role, setRole] = useState(user.role);
  const [position, setPosition] = useState(user.position || "");
  const [access, setAccess] = useState(() => new Set(user.access || []));
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [history, setHistory] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  async function pickPhoto(file) {
    if (!file || photoBusy) return;
    setPhotoBusy(true); setErr("");
    try {
      const photo = await readPhotoFile(file);
      await onUpdate(user.username, { photo });
      flash(`عکس «${user.name}» ذخیره شد ✓`);
    } catch (e) { setErr(e.message); } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function clearPhoto() {
    if (photoBusy) return;
    const ok = await askConfirm({ title: "برداشتن عکس", message: `عکس پروفایل «${user.name}» برداشته شود؟`,
      confirmLabel: "بردار", danger: true });
    if (!ok) return;
    setPhotoBusy(true); setErr("");
    try {
      await onUpdate(user.username, { photo: "" });
      flash("عکس برداشته شد");
    } catch (e) { setErr(e.message); } finally { setPhotoBusy(false); }
  }

  const profileDirty = name.trim() !== (user.name || "") || role !== user.role || position !== (user.position || "");
  const accessDirty = orderAccess(access).join() !== orderAccess(new Set(user.access || [])).join();

  useEffect(() => {
    if (pane !== "history") return;
    setHistory(null);
    usersApi.history(user.username).then(setHistory).catch((e) => { setHistory([]); setErr(e.message); });
  }, [pane, user.username]);

  async function run(fn, done) {
    setBusy(true); setErr("");
    try { await fn(); if (done) flash(done); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const saveProfile = () => run(() => onUpdate(user.username, { name: name.trim(), role, position }), `مشخصات «${name.trim()}» ذخیره شد ✓`);
  const saveAccess = () => run(() => onUpdate(user.username, { access: orderAccess(access) }), `سربرگ‌های «${user.name}» ذخیره شد ✓`);

  async function toggleActive() {
    const ok = await askConfirm(active
      ? {
        title: `غیرفعال کردن «${user.name}»`,
        message: "این کاربر دیگر نمی‌تواند وارد سامانه شود و اگر الان وارد است، بیرون می‌افتد.\nگزارش‌ها و سوابقش پاک نمی‌شود و هر وقت بخواهید دوباره فعالش می‌کنید.",
        confirmLabel: "غیرفعال کن", danger: true,
      }
      : { title: `فعال کردن «${user.name}»`, message: "این کاربر دوباره با همان نام کاربری و رمز می‌تواند وارد شود.", confirmLabel: "فعال کن" });
    if (ok) run(() => onUpdate(user.username, { isActive: !active }), active ? `«${user.name}» غیرفعال شد` : `«${user.name}» فعال شد ✓`);
  }

  // هر کار درون سربرگش است و هر زیرسربرگ زیر سربرگ مادر: تیک فرزند مادر را هم می‌زند،
  // و برداشتن مادر فرزندها را برمی‌دارد (ACCESS_KEYS مادر را پیش از فرزند دارد).
  const parentOf = (key) => (key.includes(".") ? key.split(".")[0] : ACCESS_TABS.find((t) => t.id === key)?.sub);
  const prune = (n) => {
    ACCESS_KEYS.forEach((k) => { const p = parentOf(k); if (p && !n.has(p)) n.delete(k); });
    if (me) n.add("users");
    return n;
  };
  const addWithParents = (n, key) => { for (let k = key; k; k = parentOf(k)) n.add(k); };
  const toggle = (id, on) => setAccess((prev) => {
    const n = new Set(prev);
    if (on) {
      const fresh = !id.includes(".") && !n.has(id);
      addWithParents(n, id);
      // سربرگی که تازه داده می‌شود، کارهای پیش‌فرضِ نقش را هم می‌گیرد؛ بعد می‌شود تک‌تک برداشت.
      if (fresh) roleDefaults(role, [id]).filter((k) => k.includes(".")).forEach((k) => n.add(k));
    } else {
      n.delete(id);
    }
    return prune(n);
  });
  const setGroup = (items, on) => setAccess((prev) => {
    const n = new Set(prev);
    items.forEach((t) => [t.id, ...actionsOf(t.id).map((a) => a.id)].forEach((k) => (on ? addWithParents(n, k) : n.delete(k))));
    return prune(n);
  });
  const applyList = (keys) => setAccess(prune(new Set(keys)));

  const pwValid = pw.length >= 4 && pw === pw2;
  async function resetPw() {
    const ok = await askConfirm({
      title: `بازنشانی رمز «${user.name}»`,
      message: "رمز قبلی دیگر کار نمی‌کند. رمز تازه را به خود کاربر بدهید؛ در اولین ورود باید رمز دلخواهش را بگذارد.",
      confirmLabel: "بازنشانی رمز", danger: true,
    });
    if (ok) run(async () => { await onResetPassword(user.username, pw); setPw(""); setPw2(""); }, `رمز «${user.name}» بازنشانی شد ✓`);
  }

  async function close() {
    if (profileDirty || accessDirty) {
      const ok = await askConfirm({ title: "تغییرات ذخیره نشده", message: "تغییراتی که ذخیره نکرده‌اید از بین می‌رود.", confirmLabel: "بستن بدون ذخیره", danger: true });
      if (!ok) return;
    }
    onClose();
  }

  const others = users.filter((u) => u.username !== user.username);
  const positions = !position || POSITIONS.includes(position) ? POSITIONS : [position, ...POSITIONS];
  const panes = [["profile", `مشخصات${profileDirty ? " •" : ""}`], ["access", `سربرگ‌ها${accessDirty ? " •" : ""}`], ["password", "رمز"], ["history", "تاریخچه"]];

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="wh-dialog user-dialog" role="dialog" aria-labelledby="ud-title">
        <div className="user-dialog-hd">
          <Avatar user={user} />
          <div className="ud-name">
            <b id="ud-title">{user.name}</b>
            <small><span dir="ltr">{user.username}</span> · {ROLES[user.role]?.label}{me ? " · خودتان" : ""}</small>
          </div>
          <span className={active ? "u-status on" : "u-status off"}>{active ? "فعال" : "غیرفعال"}</span>
        </div>

        <div className="sub-tabs" role="tablist">
          {panes.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={pane === k} className={pane === k ? "sub-tab on" : "sub-tab"}
              onClick={() => { setErr(""); setPane(k); }}>{l}</button>
          ))}
        </div>

        {pane === "profile" && (
          <>
            <div className="user-photo">
              <Avatar user={user} className="lg" />
              <div className="user-photo-body">
                <b>عکس پروفایل</b>
                <small>یک عکس مربع یا نزدیک به مربع بگذارید؛ خودش به ۲۵۶×۲۵۶ کوچک می‌شود. حداکثر ۳۰۰ کیلوبایت.</small>
                <div>
                  <button className="ghost" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                    {photoBusy ? "…" : user.photo ? "عوض کردن عکس" : "گذاشتن عکس"}
                  </button>
                  {user.photo && (
                    <button className="ghost" disabled={photoBusy} style={{ marginInlineStart: 8 }} onClick={clearPhoto}>
                      برداشتن عکس
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" hidden
                    onChange={(e) => pickPhoto(e.target.files?.[0])} />
                </div>
              </div>
            </div>
            <div className="row2">
              <label className="fld"><span>نام و نام خانوادگی</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="fld"><span>نام کاربری</span><input value={user.username} disabled dir="ltr" /></label>
            </div>
            <div className="row2">
              <label className="fld"><span>نقش</span>
                <select value={role} disabled={me} title={me ? "نقش خودتان را نمی‌توانید عوض کنید" : ""} onChange={(e) => setRole(e.target.value)}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="fld"><span>سمت سازمانی</span>
                <select value={position} onChange={(e) => setPosition(e.target.value)}>
                  {!position && <option value="">—</option>}
                  {positions.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
            </div>
            <div className="muted sm2" style={{ lineHeight: 1.9 }}>
              نقش تعیین می‌کند کاربر درون صفحه‌ها چه کاری می‌تواند بکند (ثبت، تأیید)؛ اینکه چه سربرگ‌هایی ببیند با «سربرگ‌ها» است.
            </div>
            <div className="user-danger">
              <div>
                <b>{active ? "غیرفعال کردن حساب" : "فعال کردن حساب"}</b>
                <small>{me ? "حساب خودتان را نمی‌توانید غیرفعال کنید." : active ? "کاربر نمی‌تواند وارد شود؛ سوابقش می‌ماند." : "کاربر دوباره می‌تواند وارد شود."}</small>
              </div>
              <button className={active ? "confirm-danger" : "ghost"} style={{ flex: "0 0 auto" }} disabled={busy || me} onClick={toggleActive}>
                {active ? "غیرفعال کن" : "فعال کن"}
              </button>
            </div>
          </>
        )}

        {pane === "access" && (
          <>
            <div className="access-tools">
              <select value="" aria-label="کپی سربرگ‌ها از کاربر دیگر"
                onChange={(e) => { const o = others.find((u) => u.username === e.target.value); if (o) applyList(o.access || []); }}>
                <option value="">کپی سربرگ‌ها از کاربر دیگر…</option>
                {others.map((o) => <option key={o.username} value={o.username}>{o.name} ({faDigits((o.access || []).length)} سربرگ)</option>)}
              </select>
              <button className="ghost" onClick={() => applyList(roleDefaults(role))}>
                پیش‌فرض نقش «{ROLES[role]?.label}»
              </button>
            </div>
            <div className="muted sm2" style={{ lineHeight: 1.9 }}>
              تیک سربرگ یعنی آن را می‌بیند؛ تیک‌های زیرش کارهایی است که درون همان سربرگ می‌تواند بکند.
              تا «ذخیرهٔ سربرگ‌ها» را نزنید چیزی اعمال نمی‌شود.
            </div>
            {accessGroups().map((g) => {
              const keys = g.items.flatMap((t) => [t.id, ...actionsOf(t.id).map((a) => a.id)]);
              return (
                <fieldset className="access-group" key={g.label}>
                  <legend className="access-group-hd">
                    <span>{g.label}</span>
                    <span className="access-group-actions">
                      <button type="button" className="link-btn" disabled={keys.every((k) => access.has(k))} onClick={() => setGroup(g.items, true)}>همه</button>
                      <button type="button" className="link-btn" disabled={keys.every((k) => !access.has(k) || (me && k === "users"))} onClick={() => setGroup(g.items, false)}>هیچ</button>
                    </span>
                  </legend>
                  <div className="access-tabs">
                    {g.items.map((t) => {
                      const lock = me && t.id === "users";
                      const acts = actionsOf(t.id);
                      const on = access.has(t.id);
                      return (
                        <div key={t.id} className={`access-tab${t.sub ? " sub" : ""}${on ? " on" : ""}`}>
                          <label className="access-item" title={lock ? "دسترسی «کاربران» را از خودتان نمی‌توانید بردارید" : ""}>
                            <input type="checkbox" checked={on} disabled={lock} onChange={(e) => toggle(t.id, e.target.checked)} />
                            {!t.sub && <Icon name={t.id} size={15} />}
                            <span>{t.sub ? `› ${tabName(t.id)}` : t.label}</span>
                            {acts.length > 0 && (
                              <small className="access-count">{faDigits(acts.filter((a) => access.has(a.id)).length)} از {faDigits(acts.length)}</small>
                            )}
                          </label>
                          {acts.length > 0 && (
                            <div className="access-actions">
                              {acts.map((a) => (
                                <label key={a.id} className="access-item action">
                                  <input type="checkbox" checked={access.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                                  <span>{a.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </>
        )}

        {pane === "password" && (me ? (
          <div className="notice warn">رمز خودتان را از این‌جا نمی‌توانید بازنشانی کنید.</div>
        ) : (
          <>
            <div className="muted sm2" style={{ lineHeight: 1.9 }}>
              وقتی کاربری رمزش را فراموش کرده، یک رمز موقت بگذارید و به خودش بدهید؛ در اولین ورود باید رمز دلخواهش را بگذارد.
              {user.mustChangePassword && " این کاربر هنوز رمز موقت قبلی‌اش را عوض نکرده."}
            </div>
            <div className="row2">
              <label className="fld"><span>رمز تازه</span>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="حداقل ۴ نویسه" />
              </label>
              <label className="fld"><span>تکرار رمز تازه</span>
                <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </label>
            </div>
            {pw2 && pw !== pw2 && <div className="err">دو رمز یکی نیستند.</div>}
          </>
        ))}

        {pane === "history" && (
          <>
            <div className="muted sm2" style={{ marginBottom: 6 }}>
              آخرین ورود: {user.lastLogin ? faDateTime(user.lastLogin) : "هنوز وارد نشده"}
            </div>
            {history === null ? <div className="muted sm2">در حال خواندن…</div>
              : history.length === 0 ? <div className="empty">هنوز تغییری برای این کاربر ثبت نشده.</div>
              : <ul className="audit-list">{history.map((e) => <AuditRow key={e.id} e={e} />)}</ul>}
          </>
        )}

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={close} disabled={busy}>بستن</button>
          {pane === "profile" && <button className="submit" disabled={!profileDirty || !name.trim() || busy} onClick={saveProfile}>ذخیرهٔ مشخصات</button>}
          {pane === "access" && <button className="submit" disabled={!accessDirty || busy} onClick={saveAccess}>ذخیرهٔ سربرگ‌ها</button>}
          {pane === "password" && !me && <button className="submit" disabled={!pwValid || busy} onClick={resetPw}>بازنشانی رمز</button>}
        </div>
      </div>
    </div>
  );
}

/* ============ استایل ============ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}
html,body{margin:0;background:#F5F8F7}
.app{--paper:#F5F8F7;--card:#fff;--ink:#172A33;--muted:#5C6B66;--line:#E3EBE8;--accent:#147D70;--accent2:#E0F3EF;
  --shadow:0 4px 14px rgba(24,64,69,.04);
  font-family:'Vazirmatn',system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100vh;line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;padding:14px}
/* ستون ۶۰۰ پیکسلی برای موبایل است؛ روی نمایشگر بزرگ صفحه باز می‌شود. سربرگ و
   نوار تب‌ها هم باید همان عرض را بگیرند وگرنه تب‌ها اسکرول می‌خورند. چون
   قاعده‌هایشان پایین‌تر آمده، اینجا با .app نوشته می‌شوند تا وزن بیشتری
   داشته باشند. */
@media(min-width:900px){
  .app .wrap,.app .hd-top,.app .tabs{max-width:1080px}
  .app .wrap{padding:18px 20px}
  .app .hd-top{padding:12px 20px}
  .app .tabs{padding:0 16px;overflow-x:visible}
  /* انبار و حقوق جدول پهن دارند و تا ته صفحه باز می‌شوند. */
  .app-wide .wrap,.app-wide .hd-top,.app-wide .tabs{max-width:1560px}
}
.center{display:flex;align-items:center;justify-content:center;min-height:60vh;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}.sm2{font-size:12px}

/* header */
.hd{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.hd-top{max-width:600px;margin:0 auto;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#0B4F48);flex:0 0 auto;box-shadow:inset 0 0 0 3px #ffffff26}
.mark.big{width:52px;height:52px;border-radius:14px;margin:0 auto 6px}
.brand h1{margin:0;font-size:19px;font-weight:700;letter-spacing:-.3px}.brand p{margin:0;font-size:11.5px;color:var(--muted)}
.who{display:flex;align-items:center;gap:7px}
.who-name{font-size:13px;font-weight:600}
.role-chip{font-size:11px;font-weight:600;padding:3px 9px;border-radius:14px;white-space:nowrap}
.logout{background:none;border:1px solid var(--line);border-radius:8px;padding:4px 10px;font-family:inherit;font-size:12px;color:var(--muted);cursor:pointer}
.tabs{max-width:600px;margin:0 auto;padding:0 10px;display:flex;gap:4px;overflow-x:auto}
.tab{background:none;border:none;border-bottom:2.5px solid transparent;padding:9px 12px;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.tab.on{color:var(--accent);border-color:var(--accent)}

/* ---- پوسته: منوی کناری تیره و نوار بالا ---- */
.shell{display:flex;min-height:100vh}
.sb{width:248px;flex:0 0 248px;background:#102C35;color:#DBE7E8;padding:22px 14px 16px;display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;overflow-y:auto;z-index:20}
.sb-brand{display:flex;align-items:center;gap:11px;padding:0 8px 20px}
.sb-brand .mark{background:linear-gradient(135deg,#1A8B7D,#0F6E64);box-shadow:0 6px 18px rgba(26,139,125,.3)}
.sb-brand b{display:block;color:#fff;font-size:18px;font-weight:700;line-height:1.3}
.sb-brand small{display:block;color:#8FAEB1;font-size:11px}
.sb-close{display:none;margin-inline-start:auto;background:none;border:0;color:#A8C0C1;cursor:pointer;padding:4px;border-radius:8px}
.sb-nav{display:flex;flex-direction:column;gap:14px}
.sb-group{display:flex;flex-direction:column;gap:3px}
.sb-label{color:#7F9C9F;font-size:11px;margin:0 12px 4px}
.sb-item{display:flex;align-items:center;gap:11px;width:100%;min-height:42px;padding:0 12px;border:0;border-radius:9px;
  background:transparent;color:#B8CBCD;font-family:inherit;font-size:13.5px;font-weight:500;text-align:right;cursor:pointer;
  transition:background .15s,color .15s}
.sb-item:hover{background:#173A43;color:#fff}
.sb-item.on{background:#147D70;color:#fff;font-weight:600;box-shadow:0 7px 17px rgba(7,69,64,.28)}
.sb-item svg{flex:none}
.sb-item:focus-visible,.sb-close:focus-visible,.sb-logout:focus-visible{outline:2px solid #83E1D3;outline-offset:2px}
.sb-user{margin-top:auto;display:flex;align-items:center;gap:10px;border-top:1px solid #26464D;padding:16px 6px 0}
.sb-user>div{flex:1;min-width:0}
.sb-user b{display:block;color:#E2EDEC;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-user small{display:block;color:#8FAEB1;font-size:11px}
.sb-logout{background:none;border:0;color:#8FAEB1;cursor:pointer;padding:7px;border-radius:8px;display:grid;place-items:center}
.sb-logout:hover{color:#fff;background:#173A43}
.avatar{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#E7D2BA;color:#7A5939;
  font-weight:700;font-size:14px;flex:none}
.avatar.sm{width:32px;height:32px;font-size:13px}
.avatar.lg{width:72px;height:72px;font-size:28px;border-radius:14px}
.avatar-img{object-fit:cover;background:#F2ECE5;border:1px solid var(--line)}
.user-photo{display:flex;gap:14px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:12px;
  background:#FBFCFB;margin-bottom:14px}
.user-photo-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.user-photo-body b{font-size:13.5px}
.user-photo-body small{color:var(--muted);font-size:12px;line-height:1.7}
.user-photo-body .ghost{padding:6px 14px;flex:0 0 auto}
.top-me{display:flex;align-items:center;gap:9px;background:transparent;border:0;padding:6px 10px;border-radius:10px;
  cursor:pointer;font-family:inherit;text-align:right}
.top-me:hover{background:#F3F7F6}
.top-me:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.top-me .top-user-name{display:flex;flex-direction:column}
.top-me .top-user-name b{font-size:13.5px;color:var(--ink);line-height:1.4;font-weight:600}
.top-me .top-user-name small{font-size:11.5px;color:var(--muted)}
/* تولید */
.prod-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.prod-tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.prod-tile span{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}
.prod-tile b{font-size:18px;color:var(--ink)}
.prod-tile.ok b{color:#0F7A5A}
.prod-tile.run b{color:#B26A00}
.prod-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.prod-name{flex:1;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prod-name b{font-size:15px}
.pill{font-size:11.5px;padding:2px 9px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.pill.ok{background:#E3F4EE;color:#0F7A5A;border-color:#B7DED1}
.pill.run{background:#FDF2E0;color:#B26A00;border-color:#F3D9AD}
.pill.bad{background:#FCE9E9;color:#B02A2A;border-color:#F0C0C0}
.pill.idle{background:#EEF2F1;color:var(--muted);border-color:var(--line)}
.pill.done{background:#E7ECFA;color:#33478F;border-color:#C2CDEA}
.card.closed{background:#FAFBFC;border-style:dashed}
.card.closed .prod-name b{color:var(--muted)}
.close-note{font-size:12.5px;color:var(--muted);background:#F3F6F9;border:1px solid #E1E8EF;
  border-radius:10px;padding:8px 12px;margin-bottom:8px;line-height:1.9}
.ok-txt{color:#0F7A5A}
.reason-list{display:grid;gap:8px;margin-bottom:12px}
.reason-row{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;cursor:pointer;
  border:1px solid var(--line);border-radius:10px;background:#fff}
.reason-row.on{border-color:var(--accent);background:#F2F9F7}
.reason-row.off{opacity:.45;cursor:not-allowed}
.reason-row b{display:block;font-size:13.5px;margin-bottom:2px}
.reason-row small{color:var(--muted);font-size:12px;line-height:1.7}
.bulk-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;
  background:#FDF7EC;border:1px solid #F3D9AD;border-radius:12px;margin-bottom:12px}
.bulk-bar span{flex:1;font-size:13px;color:#8A4B00}
.prod-issues{margin:8px 0 0;padding-inline-start:18px;color:#B02A2A;font-size:12.5px;line-height:1.9}
.prod-stages{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:10px}
.prod-stage{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#FAFCFB}
.prod-stage.bad{border-color:#F0C0C0;background:#FEF7F7}
.prod-stage-hd{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.prod-stage-hd b{font-size:13px}
.chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:12px;padding:3px 10px;border-radius:999px;background:#EEF2F1;border:1px solid var(--line)}
.chip.bad{background:#FCE9E9;color:#B02A2A;border-color:#F0C0C0}
.chk-line{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;cursor:pointer}
.warn-txt{color:#B26A00}
.fld input.need{border-color:#E8A33D;background:#FFFBF4}
.quote-box{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#FAFCFB;margin-top:10px}
.quote-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:6px 0}
.quote-row span{flex:1;color:var(--muted);font-size:13px}
.quote-row b{font-size:15px;color:var(--ink)}
.quote-row small{color:var(--muted);font-size:12px}
.quote-row.main{border-top:1px solid var(--line);margin-top:4px;padding-top:10px}
.quote-row.main b{color:var(--accent);font-size:17px}
.month-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px}
.month-nav b{font-size:15px;min-width:130px;text-align:center}
.month-nav .ghost{flex:0 0 auto;padding:6px 12px}
.mini-table{width:100%;border-collapse:collapse;font-size:13px}
.mini-table th{text-align:start;color:var(--muted);font-weight:600;font-size:12px;
  padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.mini-table td{padding:7px 8px;border-bottom:1px solid #F1F5F4;white-space:nowrap}
.mini-table tr:last-child td{border-bottom:0}
.bar.sm{height:6px}
.bar.full > div{background:#7C8FC7}
.chat-count{font-size:11px;padding:1px 7px;border-radius:999px;background:#EEF2F1;color:var(--muted);flex:none}
.chat-count.soon{background:#FDF2E0;color:#B26A00}
.chat-count.late{background:#FCE9E9;color:#B02A2A}
@media (max-width:820px){.prod-tiles{grid-template-columns:repeat(2,1fr)}}

/* گفتگو */
.chat-shell{display:grid;grid-template-columns:320px 1fr;gap:14px;height:calc(100vh - 180px);min-height:420px}
.chat-side{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.chat-side-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}
.chat-side-hd b{flex:1}
.chat-list{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1}
.chat-item{display:flex;gap:10px;width:100%;padding:10px 12px;background:transparent;border:0;border-bottom:1px solid #EDF2F0;
  align-items:center;cursor:pointer;font-family:inherit;text-align:right}
.chat-item:hover{background:#F3F7F6}
.chat-item.on{background:#E4F1EF}
.chat-item-body{flex:1;min-width:0}
.chat-item-hd{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
.chat-item-hd b{font-size:13.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-item-hd small{color:var(--muted);font-size:11px;flex:none}
.chat-item-sub{display:flex;justify-content:space-between;gap:6px;align-items:center;color:var(--muted);font-size:12px;margin-top:2px}
.chat-item-sub span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-pane{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.chat-conv{display:flex;flex-direction:column;height:100%}
.chat-conv-hd{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}
.chat-conv-hd b{display:block;font-size:14.5px;line-height:1.4}
.chat-conv-hd small{color:var(--muted);font-size:12px}
.chat-msgs{flex:1;overflow-y:auto;padding:14px 16px;background:#F7FAF9;display:flex;flex-direction:column;gap:10px}
.chat-msg{max-width:75%;background:#fff;border:1px solid var(--line);border-radius:14px 14px 14px 4px;
  padding:8px 12px;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.chat-msg.mine{align-self:flex-end;background:#DFF3EE;border-color:#B7DED1;border-radius:14px 14px 4px 14px}
.chat-msg-from{font-size:11.5px;color:var(--accent);font-weight:600;margin-bottom:2px}
.chat-msg-text{font-size:13.5px;line-height:1.8;word-wrap:break-word;white-space:pre-wrap}
.chat-msg small{display:block;font-size:10.5px;color:var(--muted);margin-top:2px;text-align:end}
.chat-msg-img{max-width:100%;max-height:220px;border-radius:8px;display:block;margin-bottom:4px}
.chat-msg-file{display:inline-flex;gap:6px;align-items:center;color:var(--accent);text-decoration:none;font-weight:600;font-size:13px}
.chat-file-pin{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#FDF7EC;border-top:1px solid #F3D9AD}
.chat-file-pin img{max-height:44px;border-radius:6px}
.chat-file-pin span{flex:1;color:#8A4B00;font-size:13px}
.chat-composer{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line);align-items:flex-end;background:#fff}
.chat-composer textarea{flex:1;font-family:inherit;font-size:13.5px;border:1px solid var(--line);border-radius:10px;
  padding:9px 12px;resize:none;max-height:120px;line-height:1.7}
.pick-row.on{background:#E4F1EF}
@media (max-width:820px){.chat-shell{grid-template-columns:1fr;height:auto}.chat-side,.chat-pane{min-height:380px}}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.main>.wrap{width:100%}
.topbar{height:64px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;
  padding:0 28px;position:sticky;top:0;z-index:10}
.menu-btn{display:none;background:none;border:0;color:var(--accent);cursor:pointer;padding:6px;border-radius:8px}
.menu-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.crumb{display:flex;align-items:center;gap:9px;font-size:13px;color:#8A9C9A;min-width:0}
.crumb b{color:#23454B;font-weight:700;white-space:nowrap}
.crumb .sep{color:#C4CECC}
.top-user{margin-inline-start:auto;display:flex;align-items:center;gap:10px}
.top-user .today{font-size:12px;color:var(--muted);padding-inline-end:14px;border-inline-end:1px solid var(--line);white-space:nowrap}
.top-user-name b{display:block;font-size:12.5px;color:#24454B;line-height:1.4}
.top-user-name small{display:block;font-size:11px;color:#7F918F}
.sb-overlay{display:none}
@media(max-width:900px){
  .sb{position:fixed;top:0;bottom:0;right:-270px;width:256px;height:auto;transition:right .25s ease;box-shadow:-8px 0 30px rgba(12,52,56,.18)}
  .sb.open{right:0}
  .sb-close{display:grid;place-items:center}
  .sb-overlay{display:block;position:fixed;inset:0;background:rgba(13,35,39,.42);border:0;z-index:15;cursor:pointer}
  .menu-btn{display:grid;place-items:center}
  .topbar{padding:0 14px;height:58px}
  .top-user .today,.top-user-name{display:none}
}
@media(prefers-reduced-motion:reduce){.sb,.sb-item,.submit,.ghost{transition:none}}

/* login */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px;width:100%;max-width:340px;text-align:center}
.login-card h1{margin:0;font-size:24px}.login-card .sub{margin:2px 0 18px;color:var(--muted);font-size:13px}
.login-card .fld{text-align:right}
.err{color:#B23A3A;font-size:12.5px;margin:-4px 0 8px}
.demo{margin-top:16px;font-size:11.5px;color:var(--muted);line-height:2}
.demo code{background:#F1F3F1;padding:1px 6px;border-radius:5px;font-family:inherit}

/* fields */
.card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px;margin-bottom:12px;box-shadow:var(--shadow)}
.fld{display:block;margin-bottom:12px}.fld.sm{margin-bottom:0}
.fld>span{display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:500}
.fld input,.fld select,.fld textarea,.filters select{width:100%;font-family:inherit;font-size:14px;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#FBFCFB;outline:none;transition:border-color .15s}
.fld input:focus,.fld select:focus,.fld textarea:focus{border-color:var(--accent);background:#fff}
.fld textarea{resize:vertical}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.sup-line{font-size:12.5px;color:var(--muted);margin:2px 0 14px}

/* items editor */
.items-hd,.board-h{font-size:13.5px;font-weight:700;margin:6px 0 10px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.items-hd.sub{font-size:12px;font-weight:600;color:var(--muted);border-bottom:none;margin:4px 0 6px;padding-bottom:0}
.delay-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.delay-row input{flex:1;font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:#FBFCFB}
.item-row{display:flex;gap:8px;align-items:flex-start;background:#F8FAF9;border:1px solid var(--line);border-radius:12px;padding:11px;margin-bottom:9px}
.item-num{width:22px;height:22px;border-radius:50%;background:var(--accent2);color:var(--accent);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:2px}
.item-body{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.item-del{background:none;border:none;color:#B23A3A;font-size:20px;cursor:pointer;line-height:1;padding:0 2px}
.hint-remaining{font-size:11.5px;color:var(--accent);background:var(--accent2);border-radius:7px;padding:5px 9px;margin-top:-2px}
.hint-remaining.warn{color:#B5560B;background:#FFF4E5}
.new-mat-box{display:flex;flex-direction:column;gap:8px;background:#fff;border:1px dashed var(--accent);border-radius:10px;padding:10px;margin-top:4px}
.add-row{width:100%;background:var(--accent2);color:var(--accent);border:1px dashed var(--accent);border-radius:10px;padding:9px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;margin-bottom:14px}
.btn-row{display:flex;gap:9px}
.section-save{width:100%;background:#fff;color:var(--accent);border:1.5px solid var(--accent);border-radius:10px;padding:9px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;margin-bottom:16px}
.section-save:disabled{opacity:.45;cursor:not-allowed}
.draft-note{font-size:12px;color:var(--accent);background:var(--accent2);border-radius:9px;padding:8px 11px;margin-bottom:10px}
.act.edit{background:#4A7BA6}
.edit-box{margin-top:12px;border-top:1px dashed var(--line);padding-top:12px}
.submit{flex:1;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-family:inherit;font-size:14.5px;font-weight:600;cursor:pointer;
  box-shadow:0 6px 14px rgba(20,125,112,.2);transition:background .15s,box-shadow .15s,transform .15s}
.submit:hover:not(:disabled){background:#0D685E;box-shadow:0 9px 18px rgba(20,125,112,.27);transform:translateY(-1px)}
.submit:disabled{opacity:.45;cursor:not-allowed}
.submit-warn{flex:1;background:#E8A33D;color:#1F2A2C;border:none;border-radius:10px;padding:12px;font-family:inherit;font-size:14.5px;font-weight:600;cursor:pointer;
  box-shadow:0 6px 14px rgba(232,163,61,.3);transition:background .15s,box-shadow .15s,transform .15s}
.submit-warn:hover:not(:disabled){background:#C6871B;box-shadow:0 9px 18px rgba(232,163,61,.35);transform:translateY(-1px)}
.submit-warn:disabled{opacity:.45;cursor:not-allowed}
.ghost{flex:1;background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:10px;padding:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;
  transition:border-color .15s,color .15s}
.ghost:hover:not(:disabled){border-color:#9CC7BF;color:var(--accent)}
.ghost:disabled{opacity:.45}
.ok-msg{text-align:center;color:#1E7D46;font-size:13.5px;margin-top:11px;font-weight:600}

/* jalali picker */
.jp{position:relative}
.jp-input{width:100%;text-align:right;font-family:inherit;font-size:14px;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#FBFCFB;cursor:pointer;color:var(--ink)}
.jp-pop{position:absolute;top:calc(100% + 6px);right:0;left:0;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px #0002;padding:12px;z-index:20}
.jp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;font-size:14px}
.jp-head button{background:#F1F3F1;border:none;width:28px;height:28px;border-radius:8px;font-size:17px;cursor:pointer;color:var(--ink)}
.jp-week{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}
.jp-week span{text-align:center;font-size:11px;color:var(--muted);font-weight:600}
.jp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.jp-day{aspect-ratio:1;border:none;background:none;border-radius:8px;font-family:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
.jp-day:hover{background:var(--accent2)}
.jp-day.sel{background:var(--accent);color:#fff;font-weight:700}
.jp-today{width:100%;margin-top:8px;background:var(--accent2);color:var(--accent);border:none;border-radius:8px;padding:7px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.jp-foot{display:flex;gap:6px}
.pick-row{display:flex;gap:6px;align-items:stretch}
.pick-row select{flex:1;min-width:0}
.pick-row .ghost{white-space:nowrap;font-size:12px;padding:0 10px}
.jp-input.empty{color:var(--muted)}

/* filters */
.filters{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;align-items:start}
.filters select{padding:9px 10px;font-size:13px}
.date-fil{font-family:inherit;font-size:13px;border:1px solid var(--accent);background:var(--accent2);color:var(--accent);border-radius:10px;padding:9px;cursor:pointer;font-weight:600}
.date-fil-wrap .jp-input{font-size:13px;padding:9px 10px}

/* report card */
.report{padding:15px}
.rep-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:11px}
.rep-head.clickable{cursor:pointer}
.rep-head-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.rep-toggle{font-size:11px;color:var(--muted);white-space:nowrap}
.rep-date{font-weight:700;font-size:15px}
.rep-meta{font-size:12px;color:var(--muted);margin-top:1px}
.status-chip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:16px;white-space:nowrap}
.kind-chip{font-size:11px;font-weight:600;color:var(--muted);background:#EEF2F0;padding:4px 10px;border-radius:16px;white-space:nowrap}

/* ---- انبار ---- */
.wh-search{width:100%;font-family:inherit;font-size:14px;border:1px solid var(--line);
  border-radius:10px;padding:10px 12px;background:#fff}
.wh-search:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
.wh-toggles{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12.5px;color:var(--muted)}
.wh-toggles label{display:flex;align-items:center;gap:6px;cursor:pointer}
.wh-toggles input[type=checkbox]{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.wh-table{min-width:1080px}
.wh-table td{vertical-align:middle}
.wh-name{text-align:right;min-width:230px;font-weight:600}
.wh-sub{display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;font-size:10.5px;font-weight:400;color:var(--muted)}
.wh-flag{background:#EEF2F0;border-radius:10px;padding:1px 7px}
/* تعریف کالا: بسته‌بندی جدا کادر می‌شود چون بیشترین اشتباه همان‌جا رخ می‌دهد */
.pack-box{background:#FAFBFA;border:1px solid var(--line);border-radius:12px;padding:12px 12px 2px;margin:4px 0 12px}
.more-box{border-top:1px solid var(--line);padding-top:8px;margin-bottom:10px}
.more-box summary{font-size:12.5px;color:var(--muted);cursor:pointer;padding:2px 0}
.wh-off{opacity:.55}
/* انتخاب ماده در فرم مصرف: دکمه‌ای به شکل فیلد، که پنجرهٔ فهرست انبار را باز می‌کند */
.pick-field{width:100%;min-height:40px;text-align:right;font-family:inherit;font-size:14px;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#FBFCFB;cursor:pointer}
.pick-field small{color:var(--muted);font-size:11.5px}
.pick-field.empty{color:var(--muted)}
/* ادغام ماده: از ← به */
.merge-summary{display:flex;align-items:center;gap:10px;margin:6px 0 12px}
.merge-summary>div:not(.merge-arrow){flex:1;border:1px solid var(--line);border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px;background:#FAFBFA}
.merge-summary small{color:var(--muted);font-size:11.5px}
.merge-arrow{font-size:20px;color:var(--accent)}
/* کارتابل مالی */
.status-chip.fin-pending{background:#FFF4E0;color:#9A5B00;margin-inline-start:4px}
.status-chip.fin-returned{background:#FDECEC;color:#B23A3A;margin-inline-start:4px}
.status-chip.fin-approved{background:#E4F1EF;color:#0F6E64;margin-inline-start:4px}
.fin-return-note{margin-top:6px;font-size:12px;color:#B23A3A;display:flex;flex-direction:column;gap:2px;align-items:flex-start;max-width:260px;white-space:normal}
.wh-dialog.fin-dialog{max-width:1040px}
.fin-head{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0 10px}
.fin-head>div,.fin-summary>div{border:1px solid var(--line);border-radius:10px;padding:7px 10px;display:flex;flex-direction:column;background:#FAFBFA}
.fin-head span,.fin-summary span{font-size:11.5px;color:var(--muted)}
.fin-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.fin-summary.warn>div:last-child{border-color:#E6B3B3;background:#FDF3F3;color:#B23A3A}
.fin-lines .wh-cell{width:90px}
.fin-lines .wh-cell.wide{width:130px}
.fin-mismatch td{background:#FDF6EC}
.fin-warn-li{color:#9A5B00}
.access-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:2px 14px;margin-top:9px;padding-top:9px;border-top:1px solid var(--line)}
.access-item{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink);cursor:pointer;padding:2px 0}
.access-item.sub{color:var(--muted)}
.access-item input{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.access-item input:disabled{cursor:not-allowed}
@media(max-width:700px){.fin-head,.fin-summary{grid-template-columns:1fr 1fr}}
.merge-notes{margin:0 0 12px;padding-right:18px;font-size:12.5px;color:var(--muted);line-height:1.9}
.fld input:disabled{color:var(--muted);background:#F3F6F5}
.wh-flag.haz{background:#FBEFF1;color:#B5560B}
.wh-qty{font-weight:700;font-variant-numeric:tabular-nums}
.wh-qty.low{color:#B5560B}
.wh-qty.total{background:var(--accent2);color:var(--accent)}
.wh-unit{font-size:10px;font-weight:400;color:var(--muted)}
/* «صفرِ شمرده‌نشده» نباید مثل عدد قطعی دیده شود */
.wh-unknown{font-size:11px;font-weight:500;color:#9A7B3F;background:#FBF3E2;
  border-radius:9px;padding:2px 8px;white-space:nowrap;cursor:help}
.wh-entered{font-size:10px;color:var(--muted);font-weight:400;margin-top:2px}
.unit-hint{background:var(--accent2);color:var(--accent);border-radius:8px;padding:7px 11px;
  font-size:12px;margin:-4px 0 10px}
tr.wh-low td{background:#FDF6F0}
.wh-cell{width:74px;font-family:inherit;font-size:12px;text-align:center;border:1px solid transparent;
  border-radius:6px;background:#FCFAF4;padding:4px}
.wh-cell:hover{border-color:var(--line)}
.wh-cell:focus{outline:2px solid var(--accent);border-color:transparent;background:#fff}
.wh-cell.narrow{width:54px}
.wh-actions{white-space:nowrap;display:flex;gap:6px;align-items:center;justify-content:center}
.wh-pager{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px;
  font-size:12.5px;color:var(--muted)}
.wh-pager .ghost{width:auto;margin:0;padding:6px 14px}
.wh-dialog{background:var(--card);border-radius:14px;padding:20px;max-width:520px;width:100%;
  margin:0 auto;box-shadow:0 10px 40px #0004}
.wh-dialog.wide{max-width:820px}
.wh-dialog-item{background:var(--accent2);border-radius:10px;padding:10px 12px;margin-bottom:12px}

/* ---- زیرتب‌ها و حواله ---- */
.sub-tabs{display:flex;gap:6px;background:var(--card);border:1px solid var(--line);
  border-radius:12px;padding:5px;margin-bottom:16px;overflow-x:auto;box-shadow:var(--shadow)}
.sub-tab{flex:1;min-width:96px;background:none;border:none;border-radius:9px;padding:9px 12px;
  font-family:inherit;font-size:13px;color:var(--muted);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.sub-tab:hover:not(.on){background:var(--accent2);color:var(--accent)}
.sub-tab.on{background:var(--accent);color:#fff;font-weight:600;box-shadow:0 6px 14px rgba(20,125,112,.2)}
.vc-num{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.vc-dir{font-size:11px;font-weight:700;border-radius:6px;padding:1px 6px}
.vc-dir.in{background:#E4F1EF;color:#1E7D46}
.vc-dir.out{background:#FBEFF1;color:#B5560B}
.vc-posted{color:#1E7D46;background:#1E7D4616}
.vc-open{color:#B9812A;background:#B9812A16}
tr.vc-draft td{background:#FDFBF5}
.vc-line-name{font-size:12.5px;font-weight:600;margin-bottom:5px}
.pick-list{max-height:340px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;margin:10px 0}
.pick-row{display:block;width:100%;text-align:right;background:none;border:none;
  border-bottom:1px solid #F1F4F2;padding:9px 12px;cursor:pointer;font-family:inherit}
.pick-row:hover{background:var(--accent2)}
.pick-name{display:block;font-size:13px;font-weight:600}
.pick-sub{display:block;font-size:11px;color:var(--muted);margin-top:2px}
.wh-check{display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0;cursor:pointer}
.wh-check input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
.import-report{background:#F7F9F8;border:1px solid var(--line);border-radius:9px;padding:12px;
  margin-top:12px;font-size:12px;line-height:1.9;white-space:pre-wrap;direction:rtl;max-height:280px;overflow:auto}

/* ---- بازهٔ تاریخ گزارش مالی ---- */
.range-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.range-fld{display:flex;flex-direction:column;gap:4px;min-width:0}
.range-fld>span{font-size:12px;color:var(--muted)}
.range-note{font-size:12px;color:var(--accent);background:var(--accent2);border-radius:9px;
  padding:8px 11px;margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.link-btn{margin-inline-start:auto;background:none;border:none;font-family:inherit;font-size:12px;
  color:var(--muted);text-decoration:underline;cursor:pointer;padding:0}
.link-btn:hover{color:var(--ink)}
@media(max-width:520px){.range-row{grid-template-columns:1fr}}

/* ---- حقوق و دستمزد ---- */
.app{--pay-crimson:#A63149;--pay-teal:#146B66;--pay-amber:#B9812A;--pay-calc:#FBF6EB}
.pay-bar{display:flex;gap:18px;flex-wrap:wrap;align-items:center;background:var(--pay-calc);
  border:1px solid #EFE7D5;border-radius:12px;padding:12px 16px;margin-bottom:14px}
.pay-stat span{font-size:11.5px;color:var(--muted);display:block}
.pay-stat b{font-size:16px;color:var(--pay-amber);direction:ltr;display:block;font-variant-numeric:tabular-nums}
.pay-month{margin-inline-start:auto;display:flex;align-items:center;gap:8px}
.pay-month label{font-size:11.5px;color:var(--muted)}
.pay-month select{font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:6px 10px}
.pay-open{display:flex;gap:8px;margin-bottom:6px}
.pay-open input{flex:1;font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff}
.pay-open .submit{width:auto;padding:8px 16px;margin:0}
.pay-toggle{width:100%;text-align:right;background:none;border:none;font-family:inherit;font-size:13.5px;
  font-weight:600;color:var(--accent);cursor:pointer;padding:2px 0}
.pay-settings{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
.pay-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.pay-table{border-collapse:separate;border-spacing:0;min-width:1900px;width:100%;font-size:12px}
.pay-table thead th{position:sticky;top:0;background:#F0EADC;color:var(--ink);font-weight:600;font-size:10.5px;
  padding:7px 5px;border-bottom:2px solid var(--line);white-space:nowrap;text-align:center;z-index:2}
.pay-table thead th.g-r{background:#F4E4E7;color:var(--pay-crimson)}
.pay-table thead th.g-g{background:#E1EFEC;color:var(--pay-teal)}
.pay-table td{padding:3px 4px;border-bottom:1px solid #F1ECDE;text-align:center;white-space:nowrap;
  direction:ltr;font-variant-numeric:tabular-nums}
.pay-table td.stick,.pay-table th.stick{position:sticky;right:0;background:var(--card);z-index:1;
  direction:rtl;text-align:right;min-width:120px;box-shadow:-6px 0 6px -6px rgba(0,0,0,.12)}
.pay-table td.c-r{background:#FBEFF1;font-weight:600}
.pay-table td.c-g{background:#E9F3F1;font-weight:600}
.pay-table td.c-t{background:var(--ink);color:#fff;font-weight:700}
.pay-table input{font-family:inherit;font-size:12px;direction:ltr;text-align:left;border:1px solid transparent;
  border-radius:6px;background:#FCFAF4;padding:4px;width:74px;color:var(--ink)}
.pay-table input:hover{border-color:var(--line)}
.pay-table input:focus{outline:2px solid var(--pay-amber);border-color:transparent;background:#fff}
.pay-table input.w-name{width:104px;text-align:right;direction:rtl}
.pay-table input.w-dept{width:82px;text-align:right;direction:rtl}
.pay-table input.w-xs{width:48px}
.pay-table input[type=checkbox]{width:16px;height:16px;accent-color:var(--pay-crimson);cursor:pointer}
.pay-table tr.pay-grand td{background:var(--ink);color:#fff;font-weight:800;font-size:12.5px}
.pay-x,.pay-rm{border:none;background:none;cursor:pointer;padding:2px 6px;font-size:13px}
.pay-rm{color:var(--pay-crimson)}
.pay-x:hover,.pay-rm:hover{opacity:.6}
.pay-actions{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pay-actions select{font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px 10px}
.pay-actions .submit,.pay-actions .ghost{width:auto;padding:8px 16px;margin:0}
.pay-comp{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px}
.pay-comp th{text-align:center;color:var(--muted);font-weight:600;font-size:11px;padding:6px;border-bottom:1px solid var(--line);white-space:nowrap}
.pay-comp td{padding:6px;border-bottom:1px solid #F1ECDE;text-align:center;direction:ltr}
.pay-comp td.nm{direction:rtl;text-align:right;white-space:nowrap}
.pay-comp td.ref{color:var(--muted);font-size:11.5px}
.pay-comp input{font-family:inherit;font-size:12.5px;direction:ltr;text-align:left;border:1px solid var(--line);
  border-radius:7px;background:#FCFAF4;padding:5px 7px;width:120px}
.pay-comp input[type=checkbox]{width:16px;height:16px;accent-color:var(--pay-crimson);cursor:pointer}
.pay-bracket{display:flex;gap:8px;align-items:center;margin-bottom:6px;font-size:12.5px}
.pay-bracket span{color:var(--muted);white-space:nowrap}
.pay-bracket input{width:130px;font-family:inherit;font-size:12.5px;direction:ltr;border:1px solid var(--line);
  border-radius:7px;background:#FCFAF4;padding:5px 7px}

/* ---- برگه‌های چاپی (فیش حقوقی و لیست حقوق) ---- */
.doc-overlay{position:fixed;inset:0;z-index:40;background:#0006;overflow:auto;padding:16px}
.doc-toolbar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}
.doc-toolbar .ghost{background:#fff;width:auto;margin:0;padding:8px 16px}
.print-area{display:flex;justify-content:center}
.doc-sheet{background:#fff;width:100%;max-width:760px;border-radius:14px;padding:30px 34px;
  box-shadow:0 10px 40px #0003;color:#16211E}
.doc-sheet.wide{max-width:1040px}
.doc-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
  border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:18px}
.doc-brand{display:flex;align-items:center;gap:11px}
.doc-co{font-size:21px;font-weight:800;letter-spacing:-.3px;line-height:1.2}
.doc-co-sub{font-size:11.5px;color:var(--muted)}
.doc-title-box{text-align:left}
.doc-title{font-size:17px;font-weight:800;color:var(--accent)}
.doc-sub{font-size:12.5px;color:var(--muted);margin-top:2px}
.doc-info{display:grid;grid-template-columns:repeat(3,1fr);gap:9px 14px;background:var(--accent2);
  border-radius:10px;padding:13px 15px;margin-bottom:18px}
.doc-info div{display:flex;flex-direction:column;gap:1px}
.doc-info span{font-size:10.5px;color:var(--muted)}
.doc-info b{font-size:13px}
.doc-cols{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;align-items:start}
.doc-col{border:1px solid var(--line);border-radius:11px;overflow:hidden}
.doc-col h3{margin:0;font-size:12.5px;padding:9px 13px;color:#fff}
.doc-col.earn h3{background:#1E7D46}
.doc-col.deduct h3{background:#B5560B}
.doc-group{font-size:10.5px;color:var(--muted);background:#F7F9F8;padding:5px 13px;
  border-bottom:1px solid var(--line);border-top:1px solid var(--line)}
.doc-line{display:flex;justify-content:space-between;gap:10px;align-items:baseline;
  padding:7px 13px;border-bottom:1px solid #F1F4F2;font-size:12.5px}
.doc-line span{color:#3C4A45}
.doc-line b{direction:ltr;font-variant-numeric:tabular-nums;white-space:nowrap}
.doc-line.sub{background:#FAFBFA;font-weight:600}
.doc-line.total{background:#F2F5F3;font-weight:800;border-bottom:none}
.doc-net{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;
  background:var(--accent);color:#fff;border-radius:12px;padding:15px 20px}
.doc-net span{font-size:13.5px;font-weight:600}
.doc-net b{font-size:23px;direction:ltr;font-variant-numeric:tabular-nums}
.doc-net small{font-size:12px;font-weight:500;opacity:.85}
.doc-sign{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:30px;
  padding-top:16px;border-top:1px dashed var(--line);font-size:12px;color:#3C4A45}
.doc-foot{margin-top:16px;text-align:center;font-size:10.5px;color:var(--muted)}
.doc-table{width:100%;border-collapse:collapse;font-size:11.5px}
.doc-table th{background:var(--accent2);color:var(--accent);font-weight:700;font-size:10.5px;
  padding:8px 6px;border:1px solid var(--line);white-space:nowrap}
.doc-table td{padding:6px;border:1px solid var(--line);text-align:center;direction:ltr;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.doc-table td.nm{direction:rtl;text-align:right}
.doc-table td.net{font-weight:700;background:#F2F5F3}
.doc-table tr.tot td{background:var(--accent);color:#fff;font-weight:800}
.doc-table tr.tot td.net{background:#0B4F48;color:#fff}
@media(max-width:640px){
  .doc-sheet{padding:20px 16px}
  .doc-cols{grid-template-columns:1fr}
  .doc-info{grid-template-columns:repeat(2,1fr)}
  .doc-sign{grid-template-columns:1fr}
}
/* هنگام باز بودن برگه، کلاس printing-doc روی body می‌نشیند تا چاپ فقط همان برگه را
   بگیرد. بدون این کلاس، چاپِ بقیهٔ صفحه‌ها (قرارداد، گزارش مالی) دست‌نخورده می‌ماند. */
@media print{
  body.printing-doc *{visibility:hidden!important}
  body.printing-doc .doc-overlay{position:static!important;background:#fff!important;
    padding:0!important;overflow:visible!important}
  body.printing-doc .print-area,body.printing-doc .print-area *{visibility:visible!important}
  body.printing-doc .print-area{position:absolute!important;top:0;right:0;left:0;width:100%}
  body.printing-doc .doc-sheet{max-width:100%!important;box-shadow:none!important;
    border-radius:0!important;padding:0!important}
  body.printing-doc .doc-col,body.printing-doc .doc-net,body.printing-doc .doc-info,
  body.printing-doc .doc-table th,body.printing-doc .doc-table tr.tot td,
  body.printing-doc .doc-table td.net,body.printing-doc .doc-line.total,
  body.printing-doc .doc-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.printing-doc .doc-col{break-inside:avoid}
  body.printing-doc .doc-table tr{break-inside:avoid}
  @page{margin:14mm}
}
.approved-sep{font-size:13px;font-weight:700;color:var(--muted);margin:22px 0 10px;padding-top:16px;border-top:1px solid var(--line)}
.card.report.revision{background:#FBE2DD;border:1.5px solid #C1421F}
.card.report.corrected{background:#E4F5E9;border:1.5px solid #1E7D46}
.corrected-badge{display:inline-block;font-size:12px;font-weight:700;color:#1E7D46;background:#fff;border:1px solid #1E7D46;border-radius:14px;padding:3px 12px;margin-bottom:10px}
.items-table{display:flex;flex-direction:column;gap:6px}
.it-line{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px;padding:8px 10px;background:#F8FAF9;border-radius:9px;align-items:baseline}
.it-emp{font-weight:700}
.it-proj{color:var(--accent);font-weight:600}
.it-act{color:var(--muted)}
.it-h{color:var(--ink);font-size:12px;margin-inline-start:auto}
.it-desc{flex-basis:100%;color:var(--muted);font-size:12px}
.rep-total{font-size:12px;color:var(--muted);margin-top:8px}
.rep-notes{margin:9px 0 0;font-size:13px;color:var(--muted);background:#F7F9F8;padding:8px 10px;border-radius:8px}
.comments{margin-top:11px;display:flex;flex-direction:column;gap:6px}
.cmt{background:var(--accent2);padding:8px 11px;border-radius:9px;font-size:13.5px}
.cmt-author{display:block;font-size:11px;color:var(--accent);font-weight:700;margin-bottom:1px}
.cmt-add{display:flex;gap:7px;margin-top:11px}
.cmt-add input{flex:1;font-family:inherit;font-size:13.5px;border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:#FBFCFB;outline:none}
.cmt-add input:focus{border-color:var(--accent)}
.cmt-add button{font-family:inherit;font-size:13px;font-weight:600;background:var(--accent);color:#fff;border:none;border-radius:9px;padding:0 14px;cursor:pointer}
.cmt-add button:disabled{opacity:.4}
.rep-actions{display:flex;gap:8px;align-items:center;margin-top:11px;border-top:1px solid var(--line);padding-top:11px;flex-wrap:wrap}
.act{font-family:inherit;font-size:13px;font-weight:600;border:none;border-radius:9px;padding:8px 16px;cursor:pointer;color:#fff}
.act.ok{background:#1E7D46}.act.warn{background:#B5560B}
.hint{font-size:12px;color:var(--muted);flex:1}
.del{background:none;border:none;color:#B23A3A;font-family:inherit;font-size:12px;cursor:pointer;opacity:.7;margin-inline-start:auto}
.del:hover{opacity:1}

/* stats + dashboard */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:14px 16px;text-align:right;
  position:relative;overflow:hidden;box-shadow:var(--shadow)}
.stat::after{content:"";position:absolute;width:96px;height:96px;border-radius:50%;left:-38px;bottom:-58px;background:rgba(20,125,112,.05)}
.stat b{display:block;font-size:22px;font-weight:700;color:#183B43;line-height:1.5}.stat span{font-size:11.5px;color:var(--muted)}
.stat.warn b{color:#B5560B}
/* روی گوشی چهار ستون جا نمی‌شود و عدد بریده می‌شد */
@media(max-width:640px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat{padding:12px 13px}.stat b{font-size:19px}}
.short-dialog{max-width:760px}
.short-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;line-height:1.9}
.short-icon{flex:none;width:34px;height:34px;border-radius:50%;background:#FDE8E8;color:#B42318;
  font-weight:800;font-size:18px;display:grid;place-items:center}
.short-title{font-weight:800;font-size:15px}
.short-hint{margin-bottom:10px;line-height:1.9}
.short-table td{vertical-align:top;line-height:1.8}
.short-icon.post{background:#E6F4EA;color:#1E7B34}
.post-facts{display:flex;flex-wrap:wrap;gap:8px 20px;margin:2px 0 12px;font-size:13px}
.post-facts span{color:var(--muted);margin-left:6px}
.post-wh b{background:#FFF4E5;color:#8A4B00;padding:2px 8px;border-radius:6px}
.post-lines{max-height:320px;overflow-y:auto}
.confirm-dialog{max-width:460px}
.confirm-msg{white-space:pre-line}
.short-icon.info{background:#E8F0FE;color:#1A4FA0}
.confirm-danger{background:#B42318;color:#fff;border:0;border-radius:10px;padding:10px 20px;
  font-family:inherit;font-size:14px;font-weight:700;cursor:pointer}
.confirm-danger:hover{background:#912018}
.confirm-danger:focus-visible{outline:2px solid #B42318;outline-offset:2px}
.bar-row{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.bar-lbl{flex:0 0 34%;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{flex:1;height:9px;background:#EEF1F0;border-radius:6px;overflow:hidden}
.bar>div{height:100%;background:var(--accent);border-radius:6px}
.bar.emp>div{background:#4A7BA6}
.bar-v{flex:0 0 auto;font-size:12px;color:var(--muted);min-width:26px;text-align:left}
.day-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--line)}
.day-row:last-child{border-bottom:none}
.day-name{flex:1;font-size:13px;font-weight:600}
.day-h{font-size:12px;color:var(--muted)}
.day-idle{font-size:12px;font-weight:600;color:var(--accent);background:var(--accent2);padding:3px 9px;border-radius:12px}
.day-idle.over{color:#B5560B;background:#FFF4E5}

/* projects & users */
.proj{display:flex;justify-content:space-between;align-items:center;padding:13px 16px}
/* ---- اموال ---- */
.seg-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.seg{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 16px;font-family:inherit;
  font-size:13px;color:var(--muted);cursor:pointer}
.seg.on{background:var(--accent2);border-color:var(--accent);color:var(--accent);font-weight:600}
.seg:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.as-chip{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;white-space:nowrap;vertical-align:middle}
.as-chip.ok{background:#E4F5E9;color:#1E7D46}
.as-chip.warn{background:#FFF4E5;color:#8A4B00}
.as-chip.info{background:#E8F0FE;color:#1A4FA0}
.as-chip.off{background:#EEF0EF;color:#5C6B66}
.as-chip.bad{background:#FDE8E8;color:#B42318}
.asset-flags{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted);margin:-4px 2px 12px}
.asset-flags b{color:var(--ink)}
.asset-open{font-weight:700;font-size:inherit;text-align:right;padding:0;color:var(--ink)}
.asset-open:hover{color:var(--accent)}
.asset-dialog{max-width:760px}
.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 16px;margin:4px 0 12px}
.asset-grid span{display:block;font-size:11.5px;color:var(--muted)}
.asset-grid b{font-weight:600;font-size:13.5px}
.asset-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px}
.asset-card{border:1px solid var(--line);border-radius:11px;padding:10px 12px;background:#FBFCFB}
.asset-card .items-hd{margin-top:0}
.asset-card dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 6px;font-size:13px}
.asset-card dt{color:var(--muted)}
.asset-card dd{margin:0;font-weight:600}
.event-form{margin-bottom:12px;background:#fff}
.dep-bar{height:6px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px}
.dep-bar i{display:block;height:100%;background:var(--accent)}
.event-list{list-style:none;margin:6px 0 0;padding:0}
.event-list li{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #EDF2F0;align-items:flex-start}
.event-list li:last-child{border-bottom:0}
/* کارتابل تعمیر و نگهداری */
.sb-badge{margin-inline-start:auto;min-width:22px;height:20px;padding:0 6px;border-radius:10px;background:#E8A33D;color:#1F2A2C;
  font-size:11px;font-weight:700;display:grid;place-items:center}
.sb-badge.hot{background:#E5484D;color:#fff}
.mt-banner{display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap;background:#FFF4E5;border:1px solid #F3D9AD;
  border-radius:12px;padding:10px 14px;margin-bottom:12px}
.mt-banner>div{flex:1;min-width:170px}
.mt-banner b{display:block;color:#8A4B00;font-size:13.5px}
.mt-banner small{color:#8A4B00;font-size:12px}
.mt-banner .submit{width:auto;margin:0;padding:8px 14px;flex:0 0 auto}
.mt-banner .ghost{flex:0 0 auto}
.mt-banner button{white-space:nowrap}
.mt-banner-ic{width:34px;height:34px;border-radius:10px;background:#fff;color:#B5560B;display:grid;place-items:center;flex:none}
.mt-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.mt-card{background:var(--card);border:1px solid var(--line);border-inline-start:4px solid #C9D3D0;border-radius:12px;padding:12px 14px}
.mt-card.high{border-inline-start-color:#D92D20}
.mt-card.medium{border-inline-start-color:#E8A33D}
.mt-card.low{border-inline-start-color:#5B8DEF}
.mt-hd{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap}
.mt-title{flex:1;min-width:150px}
.mt-title b{display:block;font-size:14.5px;line-height:1.5}
.mt-title small{color:var(--muted);font-size:12px}
.mt-text{margin:8px 0 4px;font-size:13px;line-height:1.9}
.mt-closed{margin:4px 0;font-size:12.5px;line-height:1.8;color:#1E7D46}
.mt-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.mt-actions .submit{width:auto;margin:0;padding:8px 16px;flex:0 0 auto}
.mt-actions .ghost{flex:0 0 auto}
.mt-meta{font-size:11.5px;color:var(--muted);margin-inline-start:auto}
.mt-card .event-form{margin-top:10px}
/* انبارگردانی، کاردکس و کالای دست اشخاص */
.wh-range{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:8px}
.diff-neg{color:#B42318}
.diff-pos{color:#1E7D46}
.cnt-dialog{max-width:1100px}
.cnt-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.cnt-tools .wh-search{flex:1;min-width:190px;margin:0}
.cnt-scroll{max-height:56vh;overflow:auto}
.cnt-scroll thead th{position:sticky;top:0;z-index:1}
.cnt-table td{vertical-align:middle}
.cnt-in{width:96px;font-family:inherit;font-size:13.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;text-align:center}
.cnt-in:focus{outline:2px solid var(--accent);outline-offset:1px}
.cnt-in.bad{border-color:#D92D20;background:#FFF5F4}
.cnt-note{width:100%;min-width:110px;font-family:inherit;font-size:12.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.main .cnt-table tr.cnt-short td{background:#FFF6F5}
.main .cnt-table tr.cnt-over td{background:#F2FAF4}
.cnt-foot{flex-wrap:wrap}
.cnt-foot .submit{width:auto;margin:0;flex:0 0 auto}
.cnt-blank{min-width:90px}
.kx-edge td{background:#F3F7F6;font-weight:600}
.vt-seed{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.vt-seed input{flex:1;min-width:170px;font-family:inherit;font-size:13.5px;padding:8px 10px;border:1px solid var(--line);border-radius:9px}
.vt-seed .ghost{flex:0 0 auto;padding:8px 14px}
.holder-list{display:flex;flex-direction:column;gap:10px}
.holder-card{margin-bottom:0}
.holder-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.holder-hd .ghost{flex:0 0 auto;padding:7px 14px}
@media (max-width:560px){.cnt-foot>button{flex:1 1 40%}.cnt-foot>.submit{flex-basis:100%;order:-1}}
.event-list .as-chip{margin-top:3px}
.event-body{flex:1;min-width:0;font-size:13px;line-height:1.8}
.event-body small{display:block;color:var(--muted);font-size:11.5px}
.doc-terms{font-size:13px;line-height:2.1;margin:14px 0;text-align:justify}
.insp-table td{vertical-align:middle}
@media (max-width:560px){.insp-foot{flex-wrap:wrap}.insp-foot>button{flex:1 1 40%}.insp-foot>.submit{flex-basis:100%;order:-1}}
.insp-table select,.insp-table input[type=text]{font-family:inherit;font-size:12.5px;border:1px solid var(--line);
  border-radius:8px;padding:5px 7px;background:#fff;max-width:180px}
.insp-table input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent)}
.main .insp-table tr.missing td{background:#FFF6F5}
.main .insp-table tr.action td{background:#FFFBF2}

/* ---- کاربران ---- */
.users-toolbar{display:flex;flex-direction:column;gap:10px}
.users-filters{display:flex;gap:8px;flex-wrap:wrap}
.users-filters select,.access-tools select{flex:1;min-width:150px;font-family:inherit;font-size:13.5px;color:var(--ink);
  border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:#FBFCFB}
.users-filters .users-new{flex:0 0 auto;padding:9px 18px}
.users-table td{vertical-align:middle}
.users-table tr.is-off td,.users-table tr.is-off .user-cell b{color:var(--muted)}
.user-cell{display:flex;align-items:center;gap:10px;min-width:170px}
.user-cell b{display:block;font-weight:600;line-height:1.4}
.user-cell small{display:block;color:var(--muted);font-size:11.5px;text-align:right}
.u-status{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;white-space:nowrap;margin-inline-end:4px}
.u-status.on{background:#E4F5E9;color:#1E7D46}
.u-status.off{background:#EEF0EF;color:#5C6B66}
.u-status.pw{background:#FFF4E5;color:#8A4B00}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.user-dialog{max-width:720px}
.user-dialog .sub-tab{min-width:0;padding:8px 6px}
.user-dialog-hd{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.ud-name{flex:1;min-width:0}
.ud-name b{display:block;font-size:16px;font-weight:700;line-height:1.4}
.ud-name small{display:block;color:var(--muted);font-size:12px}
.user-danger{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #F1D5D1;background:#FFF8F7;
  border-radius:11px;padding:12px 14px;margin-top:14px}
.user-danger b{display:block;font-size:13.5px}.user-danger small{display:block;color:var(--muted);font-size:12px}
.access-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.access-tools .ghost{flex:0 0 auto;padding:8px 14px}
.access-group{border:1px solid var(--line);border-radius:11px;padding:2px 12px 10px;margin:10px 0 0;min-width:0}
.access-group-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;float:none;padding:8px 0 0;
  font-size:12.5px;font-weight:700;color:var(--muted)}
.access-group-actions{display:flex;gap:12px}
.access-group .access-grid{border-top:0;margin-top:4px;padding-top:0}
.access-tabs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-top:6px}
.access-tab{border:1px solid var(--line);border-radius:9px;padding:6px 10px;background:#FBFCFB}
.access-tab.on{background:#fff;border-color:#CFE3DF}
.access-tab .access-item{font-weight:600}
.access-tab.sub .access-item{font-weight:500}
.access-count{margin-inline-start:auto;font-size:11px;font-weight:500;color:var(--muted);white-space:nowrap}
.access-actions{margin:2px 0 2px;padding-inline-start:22px;border-inline-start:2px solid var(--line)}
.access-tab.on .access-actions{border-color:var(--accent2)}
.access-item.action{font-weight:400;font-size:12px;color:var(--muted);padding:1px 0}
.access-tab.on .access-item.action{color:var(--ink)}
.access-item svg{color:var(--muted);flex:none}
.audit-list{list-style:none;margin:0;padding:0}
.audit-list li{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #EDF2F0}
.audit-list li:last-child{border-bottom:0}
.audit-kind{flex:none;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--accent2);color:var(--accent);white-space:nowrap;margin-top:2px}
.audit-kind.k-deactivated,.audit-kind.k-password_reset{background:#FFF4E5;color:#8A4B00}
.audit-kind.k-created,.audit-kind.k-activated{background:#E4F5E9;color:#1E7D46}
.audit-body{min-width:0;font-size:13px;line-height:1.8}
.audit-body small{display:block;color:var(--muted);font-size:11.5px}
.wh-access{display:flex;align-items:center;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);cursor:pointer}
.wh-access input{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.proj-code{margin-inline-start:8px;font-size:11px;color:var(--muted);background:#F1F3F1;padding:2px 7px;border-radius:6px}
.proj-actions{display:flex;gap:8px;align-items:center}
.toggle{font-family:inherit;font-size:12px;border:1px solid var(--line);background:#fff;color:var(--muted);border-radius:8px;padding:4px 12px;cursor:pointer}
.toggle.on{border-color:#1E7D46;color:#1E7D46;background:#1E7D4610}

.notice{padding:10px 12px;border-radius:10px;font-size:12.5px;margin:12px 0}
.notice.warn{background:#FFF4E5;color:#8A4B00;border:1px solid #F3D9AD}
.empty{text-align:center;color:var(--muted);padding:40px 0;font-size:14px}
.export-btn{width:100%;background:#1E7D46;color:#fff;border:none;border-radius:11px;padding:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px}
.export-btn:active{opacity:.85}
.ft{text-align:center;font-size:11px;color:var(--muted);padding:16px}

/* گزارش پروژه (پرینت) */
.print-title{margin:0 0 4px;font-size:16px}
/* مراحل پروژه */
.stage-summary{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.stage-toggle{width:100%;margin-top:10px;background:var(--accent2);color:var(--accent);border:1px dashed var(--accent);border-radius:10px;padding:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}
.stage-box{margin-top:10px;border-top:1px solid var(--line);padding-top:10px}
.stage-row{padding:8px 10px;border:1px solid var(--line);border-radius:10px;margin-bottom:7px;background:#FBFCFB}
.stage-row.on{background:var(--accent2);border-color:var(--accent)}
.stage-pick{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;cursor:pointer}
.stage-pick input{width:17px;height:17px;accent-color:var(--accent);cursor:pointer}
.stage-fields{display:flex;gap:8px;align-items:flex-end;margin-top:8px}
.stage-fields .fld{flex:1;margin-bottom:0}
.stage-fields .toggle{white-space:nowrap;padding:9px 12px}
.stage-total{font-size:12.5px;color:var(--muted);margin:10px 0;font-weight:600}
/* position: عنصر absoluteِ درون جدول (مثل برچسب پنهان) باید همین‌جا بریده شود، نه کل صفحه را پهن کند */
.tbl-scroll{position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch}
.tbl-scroll .print-table{min-width:560px}
.tbl-scroll .print-table td,.tbl-scroll .print-table th{white-space:nowrap}
.print-table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px}
.print-table th,.print-table td{border:1px solid var(--line);padding:7px 10px;text-align:right}
.print-table th{background:#F3F6F5;font-weight:700}
.print-table .total-row{font-weight:700;background:#F8FAF9}
/* روی صفحه جدول سبک‌تر (بی خط عمودی، ردیف روشن با ماوس)؛ برگه‌های چاپی همان خط‌کشی کامل را دارند. */
@media screen{
  .main .print-table{border:1px solid var(--line);border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;background:var(--card)}
  .main .print-table th,.main .print-table td{border:0;border-bottom:1px solid #EDF2F0}
  .main .print-table th{background:#FBFCFC;color:#5F7370;font-weight:600;font-size:12px}
  .main .print-table tbody tr:last-child td{border-bottom:0}
  .main .print-table tbody tr:hover td{background:#F7FBFA}
  .main .doc-sheet .print-table{border-radius:0;border-collapse:collapse;overflow:visible}
  .main .doc-sheet .print-table th,.main .doc-sheet .print-table td{border:1px solid var(--line)}
  .main .doc-sheet .print-table tbody tr:hover td{background:none}
}

@media print{
  .no-print{display:none!important}
  .app{background:#fff}
  .shell{display:block}
  .wrap{max-width:100%!important}
  .print-table th,.print-table td{border-color:#999}
}
`;

/* =================== قرارداد‌ساز (ادغام‌شده در اپ) =================== */
const T = {
  ink: "#1b232c", ink2: "#48565f", panel: "#ffffff", line: "#d7dde0",
  steel: "#2f6f72", steelDk: "#255759", amber: "#b9772e", soft: "#f4f7f7", warn: "#9a3b2f",
};
const BLANK = "..............................";
const B = (v, ph = BLANK) => (v && String(v).trim() ? v : ph);

const JOBS = {
  operator_paint: {
    label: "اپراتور رنگ (رنگ‌کار / پیستوله‌کار)", title: "اپراتور رنگ (رنگ‌کار)", unit: "واحد رنگ / خط پوشش", skill: "skilled",
    duties: [
      "آماده‌سازی و تنظیم رنگ، آستر (پرایمر)، سیلر و کیلر مطابق نسبت‌های اعلامی و برگهٔ فنی رنگ رنر (Renner).",
      "پاشش رنگ پلی‌یورتان روی قطعات چوب و ام‌دی‌اف با پیستوله و تنظیم فشار/دبی هوا مطابق استاندارد.",
      "کنترل کیفیت لایه‌های پوشش (ضخامت، یکنواختی، عاری‌بودن از پرتقالی‌شدن و پاشش خشک) در هر گیت.",
      "رعایت مناطق سه‌گانهٔ آلودگی (کثیف/انتقال/تمیز) و بهداشت اتاق پاشش و آبشار خشک.",
      "ثبت اطلاعات فرآیندی روی پاسپورت دیجیتال (NFC) قطعه و کنترل گردش ترولی.",
      "استفادهٔ صحیح از ماسک تنفسی، دستکش و تجهیزات حفاظت فردی و رعایت الزامات HSE.",
    ],
  },
  sanding: {
    label: "متصدی زیرسازی و سنباده‌کاری", title: "متصدی زیرسازی و سنباده", unit: "اتاق سنباده / زیرکاری", skill: "skilled",
    duties: [
      "سنباده‌زنی و زیرسازی سطوح چوب و ام‌دی‌اف پیش و پس از آستر مطابق دستورالعمل هر مرحله.",
      "کار با میز سنباده مکنده‌دار (Downdraft) و رعایت روشن‌بودن سیستم مکش هنگام کار.",
      "کنترل صافی و آماده‌بودن سطح در گیت QC1 پیش از انتقال به واحد آستر/رنگ.",
      "پاک‌سازی گرد و غبار سطح با روش صحیح پیش از تحویل قطعه.",
      "ثبت وضعیت قطعه روی پاسپورت NFC و تحویل با ترولی به ایستگاه بعد.",
      "رعایت کامل الزامات ایمنی، ماسک ضدگردوغبار و بهداشت محیط کار.",
    ],
  },
  qc: {
    label: "متصدی کنترل کیفیت (QC)", title: "متصدی کنترل کیفیت فرآیند", unit: "واحد تضمین کیفیت", skill: "skilled",
    duties: [
      "اجرای بازرسی در چهار گیت رسمی: گیت ورودی، QC1 پیش از آستر، QC2 پیش از کیلر و QC3 نهایی.",
      "تکمیل فرم‌های کنترل کیفیت و ثبت عیوب (پرتقالی‌شدن، شره، حباب، گردوغبار، اختلاف رنگ).",
      "صدور مجوز عبور یا ارجاع قطعه به فرآیند دوباره‌کاری با ثبت علت.",
      "پایش رطوبت هوای فشرده و شرایط محیطی اتاق خشک‌کن و اعلام مغایرت.",
      "به‌روزرسانی وضعیت کیفی روی پاسپورت دیجیتال قطعه و گزارش نرخ دوباره‌کاری.",
      "همکاری در ریشه‌یابی عیوب تکرارشونده و پیشنهاد اقدام اصلاحی.",
    ],
  },
  warehouse: {
    label: "انباردار و تدارکات", title: "انباردار و متصدی تدارکات", unit: "انبار و تدارکات", skill: "skilled",
    duties: [
      "تحویل، شمارش و ثبت ورود/خروج مواد اولیه، رنگ، حلال و قطعات در فرم‌های انبار.",
      "کنترل موجودی، نقطهٔ سفارش و انقضای رنگ و مواد شیمیایی و اعلام کسری به‌موقع.",
      "نگهداری اصولی مواد قابل‌اشتعال مطابق الزامات ایمنی و HSE.",
      "تطبیق اسناد خرید با کالای دریافتی و همکاری در کنترل هزینه.",
      "مدیریت گردش قطعات نیمه‌ساخته و آماده در انبار میان‌مرحله‌ای.",
      "ثبت داده‌ها در سامانه و ارائهٔ گزارش موجودی دوره‌ای.",
    ],
  },
  simple: {
    label: "کارگر ساده تولید", title: "کارگر تولید", unit: "خط تولید / پوشش", skill: "simple",
    duties: [
      "جابه‌جایی قطعات و بارگیری/تخلیهٔ ترولی‌ها میان ایستگاه‌های کاری.",
      "کمک به اپراتورها در آماده‌سازی سطح، ماسکه‌کاری و پاک‌سازی قطعات.",
      "نظافت مستمر محیط کار، اتاق پاشش و منطقهٔ خشک‌کن.",
      "کمک در بارگیری، بسته‌بندی و آماده‌سازی سفارش‌های خروجی.",
      "رعایت کامل نظم کارگاه، ایمنی و استفاده از تجهیزات حفاظت فردی.",
      "انجام سایر امور محوله در محدودهٔ وظایف شغلی توسط سرپرست.",
    ],
  },
  packing: {
    label: "متصدی بسته‌بندی و ارسال", title: "متصدی بسته‌بندی و ارسال", unit: "بسته‌بندی و ارسال", skill: "simple",
    duties: [
      "بازرسی ظاهری نهایی قطعه پس از گیت QC3 پیش از بسته‌بندی.",
      "بسته‌بندی استاندارد قطعات رنگ‌شده برای جلوگیری از آسیب سطح پوشش.",
      "تطبیق قطعات با سفارش، تکمیل فرم بسته‌بندی و برگهٔ ارسال.",
      "بارگیری ایمن و هماهنگی تحویل با واحد حمل.",
      "ثبت خروج قطعه از پاسپورت دیجیتال و بستن پروندهٔ پروژه.",
      "رعایت ایمنی جابه‌جایی و نظافت محیط.",
    ],
  },
  supervisor: {
    label: "سرپرست خط تولید", title: "سرپرست خط تولید و پوشش", unit: "سرپرستی تولید", skill: "skilled",
    duties: [
      "برنامه‌ریزی، تخصیص کار و کنترل گردش پروژه‌ها و ترولی‌ها در ۱۶ مرحلهٔ تولید.",
      "پایش ظرفیت خط، شناسایی گلوگاه (به‌ویژه اتاق خشک‌کن ثانویه) و مدیریت زمان.",
      "نظارت بر اجرای گیت‌های کنترل کیفیت و کاهش نرخ دوباره‌کاری.",
      "مدیریت و آموزش نیروهای تحت سرپرستی و رعایت انضباط کارگاه.",
      "کنترل مصرف رنگ و مواد، همکاری با انبار و واحد مالی در کنترل هزینه.",
      "ارائهٔ گزارش کار روزانه، تحلیل عملکرد و پیشنهاد بهبود فرآیند.",
    ],
  },
  trainee: {
    label: "کمک‌رنگ‌کار / نیروی کارآموز", title: "کارآموز پوشش (کمک‌اپراتور)", unit: "خط پوشش", skill: "simple",
    duties: [
      "آموزش عملی مراحل زیرسازی، آستر و پاشش زیر نظر اپراتور ارشد.",
      "کمک در آماده‌سازی رنگ، ماسکه‌کاری و پاک‌سازی قطعات.",
      "آشنایی با مناطق سه‌گانهٔ آلودگی و اصول ایمنی کار با رنگ.",
      "مشارکت در نظافت و نگهداری ایستگاه کاری.",
      "ثبت اطلاعات پایه در سامانه زیر نظر مربی.",
      "رعایت کامل الزامات ایمنی و استفاده از تجهیزات حفاظت فردی.",
    ],
  },
};

const LEGAL = {
  overtime: "۴۰٪", nightShift: "۳۵٪", holiday: "۴۰٪",
  shift_am_pm: "۱۰٪", shift_am_pm_night: "۱۵٪", shift_am_night: "۲۲٫۵٪",
};

function buildEmployment(s) {
  const skillLabel = s.skill === "skilled" ? "ماهر/دارای تخصص (سقف مجاز دورهٔ آزمایشی: ۳ ماه)" : "ساده/نیمه‌ماهر (سقف مجاز دورهٔ آزمایشی: ۱ ماه)";
  const sec = [];
  sec.push({ type: "h1", text: "قرارداد کار" });
  sec.push({ type: "sub", text: "تنظیم‌شده بر مبنای قانون کار جمهوری اسلامی ایران و مقررات وزارت تعاون، کار و رفاه اجتماعی" });
  sec.push({ type: "para", text: `این قرارداد کار در تاریخ ${B(s.contractDate)} فی‌مابین طرفین ذیل، با استناد به مواد ۷، ۱۰، ۲۱ و ۲۵ قانون کار و آیین‌نامه‌های اجرایی مربوطه، با ارادهٔ آزاد و آگاهی کامل از مفاد و آثار حقوقی آن منعقد گردید و طرفین خود را ملزم به رعایت کلیهٔ شروط آن می‌دانند.` });
  sec.push({ type: "h2", text: "ماده ۱: طرفین قرارداد" });
  sec.push({ type: "c", text: `۱-۱ کارفرما: ${B(s.coName)}${s.coBrand ? " («" + s.coBrand + "»)" : ""} به شناسهٔ ملی ${B(s.coNationalId)} و شمارهٔ ثبت ${B(s.coRegNo)}، دارای کد اقتصادی ${B(s.coEcoCode)} و شناسهٔ کارگاهی ${B(s.coWorkshopId)} نزد سازمان تأمین اجتماعی، با نمایندگی ${B(s.coRepName)} به سمت ${B(s.coRepRole)}، به نشانی ${B(s.coAddress)}، کدپستی ${B(s.coPostal)}، تلفن ${B(s.coPhone)} و ایمیل ${B(s.coEmail)}؛ که از این پس «کارفرما» نامیده می‌شود.` });
  sec.push({ type: "c", text: `۱-۲ کارگر: ${B(s.wName)} فرزند ${B(s.wFather)} به شمارهٔ شناسنامه ${B(s.wIdNo)} و کد ملی ${B(s.wNationalId)} صادره از ${B(s.wIssue)}، متولد ${B(s.wBirth)}، دارای مدرک ${B(s.wDegree)} در رشتهٔ ${B(s.wField)} با ${B(s.wExp)} سابقهٔ کار مرتبط، به نشانی ${B(s.wAddress)}، کدپستی ${B(s.wPostal)}، تلفن همراه ${B(s.wMobile)} و ایمیل ${B(s.wEmail)}؛ که از این پس «کارگر» نامیده می‌شود.` });
  sec.push({ type: "h2", text: "ماده ۲: موضوع قرارداد و شرح وظایف" });
  sec.push({ type: "c", text: `۲-۱ موضوع قرارداد، اشتغال کارگر در سمت «${B(s.jobTitle)}»${s.jobCode ? " با کد شغلی " + s.jobCode : ""} در واحد ${B(s.unit)} تحت سرپرستی مستقیم ${B(s.supervisor, "سرپرست مربوطه")} است.` });
  sec.push({ type: "c", text: "۲-۲ شرح کلی وظایف و مسئولیت‌های کارگر:" });
  (s.duties || []).forEach((d) => sec.push({ type: "li", text: d }));
  sec.push({ type: "c", text: "و سایر اموری که در محدودهٔ وظایف شغلی کارگر بوده و از سوی مقام مافوق محول می‌گردد." });
  sec.push({ type: "c", text: "۲-۳ کارگر متعهد است وظایف محوله را با دقت، امانت‌داری و مطابق استانداردهای فنی و ایمنی مربوطه انجام دهد." });
  sec.push({ type: "h2", text: "ماده ۳: نوع و مدت قرارداد" });
  sec.push({ type: "c", text: `۳-۱ نوع قرارداد: ${B(s.contractKind)}.` });
  sec.push({ type: "c", text: `۳-۲ مدت قرارداد از ${B(s.startDate)} تا ${B(s.endDate)} به مدت ${B(s.duration)} است.` });
  sec.push({ type: "c", text: `۳-۳ دورهٔ آزمایشی: ${B(s.probation)}. نوع شغل: ${skillLabel}. در طول دورهٔ آزمایشی هر یک از طرفین می‌تواند بدون اخطار قبلی، رابطهٔ کاری را قطع کند؛ چنانچه قطع از سوی کارفرما باشد، حقوق تمام دورهٔ آزمایشی به کارگر پرداخت می‌شود (مادهٔ ۱۱ قانون کار).` });
  sec.push({ type: "c", text: `۳-۴ تمدید قرارداد منوط به توافق کتبی طرفین است و حداقل ${B(s.noticeDays, "۳۰")} روز پیش از انقضا اعلام می‌گردد.` });
  sec.push({ type: "note", text: "توجه حقوقی: چنانچه طبیعت کار مستمر باشد، مطابق تبصرهٔ ۲ مادهٔ ۷ قانون کار، ماهیت رابطه ممکن است دائمی تلقی شود؛ تبدیل قرارداد به دائم تابع «ماهیت کار» است، نه صرفِ تعداد دفعات تمدید." });
  sec.push({ type: "h2", text: "ماده ۴: محل انجام کار" });
  sec.push({ type: "c", text: `۴-۱ محل انجام کار: ${B(s.workPlace)} (شهر ${B(s.city, "اصفهان")}).` });
  sec.push({ type: "c", text: "۴-۲ کارفرما می‌تواند در صورت ضرورت محل کار را در همان شهر و با حفظ شأن شغلی کارگر تغییر دهد، مشروط بر اینکه موجب عسر و حرج نگردد. تغییر به شهر دیگر منوط به توافق کتبی است." });
  sec.push({ type: "h2", text: "ماده ۵: ساعات و ایام کار" });
  sec.push({ type: "c", text: `۵-۱ ساعات کار از ${B(s.workStart)} تا ${B(s.workEnd)} در روزهای ${B(s.workDays)}، مجموعاً ${B(s.weeklyHours)} ساعت در هفته (مطابق مادهٔ ۵۱ قانون کار، حداکثر ۴۴ ساعت).` });
  sec.push({ type: "c", text: `۵-۲ اضافه‌کاری با درخواست کتبی کارفرما و موافقت کارگر و با ${LEGAL.overtime} اضافه بر مزد ساعتی (مادهٔ ۵۹) و حداکثر ۴ ساعت در روز محاسبه می‌شود.` });
  sec.push({ type: "c", text: `۵-۳ فوق‌العادهٔ نوبت‌کاری (مادهٔ ۵۶): نوبت صبح و عصر ${LEGAL.shift_am_pm}؛ نوبت صبح، عصر و شب ${LEGAL.shift_am_pm_night}؛ نوبت صبح و شب یا عصر و شب ${LEGAL.shift_am_night} اضافه بر مزد.` });
  sec.push({ type: "c", text: `۵-۴ کار شب (۲۲ تا ۶ بامداد) ${LEGAL.nightShift} و کار در تعطیلات رسمی ${LEGAL.holiday} اضافه بر مزد ساعتی خواهد داشت.` });
  sec.push({ type: "c", text: "۵-۵ کارگر موظف به ثبت ورود و خروج در سامانهٔ حضور و غیاب است؛ عدم ثبت بدون عذر موجه، غیبت تلقی می‌گردد." });
  sec.push({ type: "h2", text: "ماده ۶: حقوق و مزایا" });
  sec.push({ type: "c", text: `۶-۱ حقوق پایهٔ ماهانه: ${B(s.baseSalary)} ریال (کمتر از حداقل مزد مصوب شورای عالی کار نخواهد بود).` });
  sec.push({ type: "c", text: `۶-۲ حق مسکن: ${B(s.housing)} ریال در ماه.` });
  sec.push({ type: "c", text: `۶-۳ کمک‌هزینهٔ اقلام مصرفی (بن خواروبار): ${B(s.food)} ریال در ماه.` });
  sec.push({ type: "c", text: `۶-۴ کمک‌هزینهٔ ایاب و ذهاب: ${B(s.transport)} ریال در ماه.` });
  sec.push({ type: "c", text: "۶-۵ حق اولاد مطابق مقررات جاری (سه برابر حداقل مزد روزانه به ازای هر فرزند مشمول) پرداخت می‌شود." });
  sec.push({ type: "c", text: "۶-۶ عیدی و پاداش سالانه معادل ۶۰ روز آخرین مزد، مشروط بر آنکه از دو برابر حداقل مزد ماهانه کمتر و از سه برابر آن بیشتر نباشد." });
  sec.push({ type: "c", text: "۶-۷ حق سنوات/مزایای پایان کار به ازای هر سال سابقه معادل یک ماه آخرین مزد (شامل مزد و مزایای مستمر) مطابق مادهٔ ۲۴ محاسبه و پرداخت می‌گردد." });
  sec.push({ type: "c", text: "۶-۸ کارفرما مکلف است کارگر را از روز نخست نزد سازمان تأمین اجتماعی بیمه کند و حق بیمه را مطابق قانون بپردازد." });
  sec.push({ type: "note", text: "توجه: مبالغ حق مسکن، بن و حداقل مزد باید مطابق آخرین مصوبهٔ شورای عالی کار در سال جاری تکمیل شود و از مصوبهٔ قانونی کمتر نباشد." });
  sec.push({ type: "h2", text: "ماده ۷: مرخصی‌ها و تعطیلات" });
  sec.push({ type: "c", text: `۷-۱ مرخصی استحقاقی سالانه یک ماه (${B(s.leaveDays, "۲۶")} روز کاری با احتساب جمعه‌ها) با استفاده از حقوق و مزایا؛ ماندهٔ مرخصی به سال بعد منتقل می‌شود (مادهٔ ۶۴).` });
  sec.push({ type: "c", text: "۷-۲ مرخصی استعلاجی با گواهی پزشک؛ بیش از سه روز متوالی، منوط به تأیید پزشک معتمد تأمین اجتماعی و پرداخت مطابق مقررات آن سازمان." });
  sec.push({ type: "c", text: "۷-۳ مرخصی‌های خاص: ازدواج ۳ روز، فوت بستگان درجهٔ یک ۳ روز، زایمان بانوان ۹ ماه و شیردهی روزانه یک ساعت تا ۲۴ماهگی فرزند." });
  sec.push({ type: "c", text: "۷-۴ کارگر از کلیهٔ تعطیلات رسمی با استفاده از حقوق و مزایا برخوردار است." });
  sec.push({ type: "h2", text: "ماده ۸: ایمنی، بهداشت و آموزش (HSE)" });
  sec.push({ type: "c", text: "۸-۱ کارگر ملزم به رعایت اصول ایمنی و بهداشت کار و استفاده از تجهیزات حفاظت فردی (ماسک تنفسی، دستکش، عینک) به‌ویژه در کار با رنگ، حلال و مواد پلی‌یورتان است." });
  sec.push({ type: "c", text: "۸-۲ کارفرما موظف است محیط ایمن و بهداشتی، تهویهٔ مناسب اتاق پاشش و تجهیزات حفاظتی لازم را فراهم و آموزش‌های ایمنی و تخصصی را ارائه کند." });
  sec.push({ type: "c", text: "۸-۳ در صورت بروز حادثهٔ ناشی از کار، کارفرما موظف است مراتب را فوراً به تأمین اجتماعی اطلاع و مساعدت‌های لازم را انجام دهد." });
  sec.push({ type: "h2", text: "ماده ۹: ارزیابی عملکرد" });
  sec.push({ type: "c", text: `۹-۱ عملکرد کارگر به‌صورت ${B(s.evalPeriod, "دوره‌ای")} ارزیابی و نتایج مبنای پاداش، ارتقا و افزایش حقوق قرار می‌گیرد.` });
  sec.push({ type: "c", text: "۹-۲ نتایج ارزیابی به اطلاع کارگر می‌رسد و کارگر حق اعتراض به آن را دارد." });
  sec.push({ type: "h2", text: "ماده ۱۰: تعهدات کارگر" });
  sec.push({ type: "c", text: "۱۰-۱ انجام وظایف با رعایت سلسله‌مراتب و آیین‌نامه‌های داخلی؛ ۱۰-۲ حضور به‌موقع و خودداری از ترک محل کار بدون اذن؛ غیبت غیرموجه موجب کسر حقوق روزانه به‌نسبت است." });
  sec.push({ type: "c", text: "۱۰-۳ حفظ و نگهداری اموال، اسناد و تجهیزات کارفرما؛ در صورت خسارت ناشی از تقصیر یا تعدی و تفریط، کارگر ملزم به جبران است." });
  sec.push({ type: "c", text: `۱۰-۴ رازداری: کارگر متعهد است اطلاعات محرمانهٔ کارفرما (فرمول رنگ، مشتریان، اطلاعات مالی و فرآیندی) را افشا نکند؛ این تعهد تا ${B(s.confYears, "دو")} سال پس از خاتمهٔ قرارداد معتبر است.` });
  sec.push({ type: "c", text: "۱۰-۵ اطلاع فوری هرگونه تغییر نشانی/تماس و رعایت شئونات و پوشش متناسب با محیط کار." });
  sec.push({ type: "h2", text: "ماده ۱۱: تعهدات کارفرما" });
  sec.push({ type: "c", text: "۱۱-۱ پرداخت به‌موقع حقوق و مزایا در پایان هر ماه؛ ۱۱-۲ فراهم‌کردن ابزار و تجهیزات لازم و محیط ایمن؛ ۱۱-۳ بیمهٔ کارگر و ارسال لیست بیمه و مالیات در موعد مقرر." });
  sec.push({ type: "c", text: "۱۱-۴ ارائهٔ گواهی اشتغال در پایان قرارداد و تسویهٔ مرخصی‌های استفاده‌نشده بر اساس آخرین حقوق و مزایا." });
  sec.push({ type: "h2", text: "ماده ۱۲: مالکیت فکری" });
  sec.push({ type: "c", text: "۱۲-۱ هر ابتکار، اختراع یا بهبود فرآیندی که کارگر در راستای وظایف شغلی و با استفاده از امکانات کارفرما پدید آورد، متعلق به کارفرماست و نام کارگر به‌عنوان پدیدآورنده در اسناد مربوط درج می‌شود." });
  sec.push({ type: "c", text: "۱۲-۲ چنانچه ابتکار خارج از وظایف شغلی و بدون استفاده از امکانات کارفرما ایجاد شده باشد، حقوق مادی آن متعلق به کارگر است." });
  sec.push({ type: "h2", text: "ماده ۱۳: شرایط فسخ قرارداد" });
  sec.push({ type: "c", text: "۱۳-۱ موارد خاتمهٔ قرارداد مطابق مادهٔ ۲۱ قانون کار: توافق کتبی طرفین، فوت یا ازکارافتادگی کلی، انقضای مدت، استعفا و بازنشستگی کارگر." });
  sec.push({ type: "c", text: "۱۳-۲ کارفرما تنها در موارد مادهٔ ۲۷ قانون کار (قصور در انجام وظایف پس از دو تذکر کتبی و تأیید شورای اسلامی کار/انجمن صنفی یا مراجع حل اختلاف) می‌تواند قرارداد را فسخ کند." });
  sec.push({ type: "c", text: `۱۳-۳ استعفای کارگر با اعلام کتبی و رعایت مهلت ${B(s.resignNotice, "۱۵")} روز و تسویهٔ اموال و اسناد در اختیار، قطعی می‌شود.` });
  sec.push({ type: "c", text: "۱۳-۴ کارفرما موظف است پس از خاتمه، ظرف مهلت قانونی نسبت به تسویهٔ کامل با کارگر اقدام کند." });
  sec.push({ type: "h2", text: "ماده ۱۴: حل اختلاف و قانون حاکم" });
  sec.push({ type: "c", text: "۱۴-۱ اختلافات ابتدا از طریق مذاکره و در صورت عدم توافق، از طریق هیأت‌های تشخیص و حل اختلاف موضوع قانون کار پیگیری می‌شود." });
  sec.push({ type: "c", text: "۱۴-۲ این قرارداد تابع قانون کار مصوب ۱۳۶۹ و اصلاحات آن، قانون تأمین اجتماعی و مقررات مرتبط است؛ در موارد سکوت، مقررات آمرهٔ قانون کار حاکم است." });
  sec.push({ type: "h2", text: "ماده ۱۵: مفاد پایانی" });
  sec.push({ type: "c", text: `۱۵-۱ این قرارداد در ${B(s.copies, "۲")} نسخهٔ دارای اعتبار یکسان و پیوست‌های آن جزء لاینفک قرارداد تنظیم شد. هرگونه اصلاح صرفاً با توافق کتبی طرفین ممکن است.` });
  return sec;
}

function buildCommission(s) {
  const sec = [];
  sec.push({ type: "h1", text: "قرارداد همکاری بازاریابی و جذب مشتری (پورسانتی)" });
  sec.push({ type: "sub", text: "این قرارداد یک قرارداد تجاری مستقل است و رابطهٔ کارگری/کارفرمایی مشمول قانون کار ایجاد نمی‌کند." });
  sec.push({ type: "para", text: `این قرارداد در تاریخ ${B(s.contractDate)} فی‌مابین ${B(s.coName)}${s.coBrand ? " («" + s.coBrand + "»)" : ""} به نمایندگی ${B(s.coRepName)} («کارفرما») و ${B(s.wName)} به کد ملی ${B(s.wNationalId)} («بازاریاب») با اقرار به اهلیت قانونی منعقد گردید.` });
  sec.push({ type: "h2", text: "ماده ۱: تعاریف" });
  sec.push({ type: "c", text: "مشتری: شخص معرفی‌شده توسط بازاریاب. مشتری مؤثر: مشتری‌ای که حداقل ۳۰٪ مبلغ قرارداد را پرداخت کرده و ظرف ۱۵ روز انصراف نداده باشد. لید: اطلاعات اولیهٔ مشتری بالقوه. فروش خالص: مبلغ فاکتور پس از کسر مالیات، عوارض و تخفیف. حق دنباله: پورسانت خریدهای بعدی مشتری معرفی‌شده." });
  sec.push({ type: "h2", text: "ماده ۲: موضوع و محدوده" });
  sec.push({ type: "c", text: `۲-۱ بازاریابی، معرفی و جذب مشتری برای محصولات و خدمات کارفرما (پوشش پلی‌یورتان چوب و ام‌دی‌اف و رنگ رنر) با رعایت قوانین جاری.` });
  sec.push({ type: "c", text: `۲-۲ محدودهٔ جغرافیایی فعالیت: ${B(s.territory)}. فهرست محصولات و نرخ‌ها در پیوست ۱.` });
  sec.push({ type: "h2", text: "ماده ۳: استقلال رابطه (مهم)" });
  sec.push({ type: "c", text: "۳-۱ بازاریاب به‌صورت مستقل و بدون تابعیت حقوقی و ساعت کاری معیّن فعالیت می‌کند؛ ابزار، مکان و روش کار در اختیار خود اوست و کارفرما حق مدیریت و نظارت مستمر بر نحوهٔ انجام کار را ندارد." });
  sec.push({ type: "c", text: "۳-۲ کارفرما تعهدی به بیمه، حقوق ثابت یا مزایای کارمندی ندارد و مسئولیت مالیات و بیمهٔ بازاریاب بر عهدهٔ خود اوست." });
  sec.push({ type: "note", text: "توجه حقوقی: برای پرهیز از تشخیص «رابطهٔ کارگری» توسط اداره کار/تأمین اجتماعی، از تعیین ساعت حضور اجباری، حقوق ثابت ماهانه و نظارت مستمر بر بازاریاب خودداری کنید. پرداخت باید صرفاً پورسانتی و نتیجه‌محور باشد." });
  sec.push({ type: "h2", text: "ماده ۴: تعهدات بازاریاب" });
  sec.push({ type: "c", text: "معرفی صحیح و بدون اغراق محصولات؛ رعایت اخلاق حرفه‌ای؛ ثبت مشتری در فرم استاندارد (پیوست ۲)؛ ارائهٔ گزارش دوره‌ای عملکرد (تعداد لید، جلسات، نرخ تبدیل)." });
  sec.push({ type: "c", text: "ممنوعیت‌ها: دریافت مستقیم وجه از مشتری؛ انعقاد قرارداد به نمایندگی کارفرما؛ ارائهٔ تضمین یا تخفیف بدون مجوز کتبی؛ ثبت دامنه یا صفحهٔ مجازی با نام کارفرما." });
  sec.push({ type: "h2", text: "ماده ۵: تعهدات کارفرما" });
  sec.push({ type: "c", text: "تأمین کاتالوگ، اطلاعات فنی و قیمت؛ پاسخ به استعلام فنی ظرف ۲۴ ساعت کاری؛ صدور معرفی‌نامهٔ رسمی با ذکر حدود اختیارات؛ اطلاع تغییر قیمت حداقل ۱۰ روز پیش از اجرا." });
  sec.push({ type: "h2", text: "ماده ۶: نظام پورسانت" });
  sec.push({ type: "c", text: `۶-۱ نرخ پورسانت پایه بر مبنای فروش خالص: ${B(s.commissionTable, "طبق جدول پیوست ۱")}.` });
  sec.push({ type: "c", text: "۶-۲ حق دنباله: خرید مجدد تا ۶ ماه ۵۰٪ پورسانت اصلی؛ ۶ تا ۱۲ ماه ۳۰٪؛ پس از ۱۲ ماه بدون پورسانت." });
  sec.push({ type: "c", text: "۶-۳ زمان‌بندی پرداخت: ۵۰٪ پورسانت پس از دریافت پیش‌پرداخت مشتری و ۵۰٪ باقی پس از تسویهٔ کامل، هر یک ظرف ۷ روز کاری، پس از ارائهٔ مستندات (کپی قرارداد مشتری، تأییدیهٔ واحد فروش، رسید وجه)." });
  sec.push({ type: "c", text: "۶-۴ کسورات قانونی (مالیات) اعمال و گواهی پرداخت جهت امور مالیاتی صادر می‌شود." });
  sec.push({ type: "h2", text: "ماده ۷: محرمانگی" });
  sec.push({ type: "c", text: `اطلاعات محرمانه شامل فهرست مشتریان، استراتژی فروش، اسرار فنی و اطلاعات مالی است. این تعهد تا ۳ سال پس از خاتمه معتبر است؛ نقض آن موجب پرداخت ${B(s.penalty)} ریال خسارت مقطوع می‌گردد.` });
  sec.push({ type: "h2", text: "ماده ۸: تضامین" });
  sec.push({ type: "c", text: `بازاریاب یک فقره ${B(s.security, "چک/سفته")} به مبلغ ${B(s.securityAmount)} ریال به‌عنوان تضمین حسن انجام تعهدات ارائه می‌کند که پس از تسویهٔ کامل و رفع تعهدات مسترد می‌شود.` });
  sec.push({ type: "note", text: "توجه: در اخذ چک/سفتهٔ تضمینی، مطابق قانون صدور چک، بابت آن را «تضمین حسن انجام تعهد» قید کنید تا از ابهام حقوقی جلوگیری شود." });
  sec.push({ type: "h2", text: "ماده ۹: فسخ قرارداد" });
  sec.push({ type: "c", text: `۹-۱ هر یک از طرفین با اعلام کتبی و مهلت ${B(s.terminationNotice, "۳۰")} روزه می‌تواند قرارداد را فسخ کند.` });
  sec.push({ type: "c", text: "۹-۲ در صورت نقض جوهری تعهدات (ارائهٔ اطلاعات نادرست، دریافت وجه از مشتری، افشای اطلاعات)، طرف مقابل با اخطار کتبی ۷ روزه حق فسخ فوری دارد." });
  sec.push({ type: "h2", text: "ماده ۱۰: حل اختلاف و قانون حاکم" });
  sec.push({ type: "c", text: "اختلافات ابتدا از طریق مذاکره (۱۵ روز) و سپس داوری یا مراجع قضایی صالح حل می‌شود. این قرارداد تابع قوانین جمهوری اسلامی ایران است و در ۳ نسخهٔ دارای اعتبار یکسان تنظیم گردید." });
  sec.push({ type: "note", text: "توجه: «شرط عدم رقابت پس از پایان قرارداد» در حقوق ایران محل تردید و اغلب غیرقابل‌اجراست (اصل آزادی کار)؛ در صورت درج، آن را محدود، متعارف و همراه با عوض قرار دهید." });
  return sec;
}

function toPlainText(sections) {
  const lines = [];
  sections.forEach((b) => {
    if (b.type === "h1") lines.push("\n" + b.text + "\n");
    else if (b.type === "sub") lines.push("[" + b.text + "]\n");
    else if (b.type === "h2") lines.push("\n" + b.text);
    else if (b.type === "li") lines.push("   • " + b.text);
    else if (b.type === "note") lines.push("(( " + b.text + " ))");
    else lines.push(b.text);
  });
  lines.push("\n\nامضای کارفرما: ..............................   تاریخ: ..............");
  lines.push("امضای طرف مقابل: ..............................   تاریخ: ..............");
  lines.push("شاهد اول: ......................   شاهد دوم: ......................");
  return lines.join("\n");
}

function ContractGenerator({ session }) {
  const [mode, setMode] = useState("employment");
  const [jobKey, setJobKey] = useState("operator_paint");
  const docRef = useRef(null);
  const [f, setF] = useState({
    coName: "شرکت / مرکز پوشش دیواژ", coBrand: "دیواژ",
    coNationalId: "", coRegNo: "", coEcoCode: "", coWorkshopId: "",
    coRepName: session?.role === "manager" ? session.name : "", coRepRole: "مدیرعامل",
    coAddress: "", coPostal: "", coPhone: "", coEmail: "", city: "اصفهان",
    wName: "", wFather: "", wIdNo: "", wNationalId: "", wIssue: "", wBirth: "",
    wDegree: "", wField: "", wExp: "", wAddress: "", wPostal: "", wMobile: "", wEmail: "",
    contractDate: "", jobTitle: JOBS.operator_paint.title, jobCode: "",
    unit: JOBS.operator_paint.unit, supervisor: "سرپرست خط تولید",
    skill: JOBS.operator_paint.skill, duties: JOBS.operator_paint.duties,
    contractKind: "موقت (مدت معیّن)", startDate: "", endDate: "", duration: "یک سال",
    probation: "یک ماه", noticeDays: "۳۰",
    workPlace: "کارگاه/سالن پوشش دیواژ", workStart: "۸:۰۰", workEnd: "۱۶:۰۰",
    workDays: "شنبه تا چهارشنبه", weeklyHours: "۴۴",
    baseSalary: "", housing: "", food: "", transport: "",
    leaveDays: "۲۶", evalPeriod: "شش‌ماهه", confYears: "دو",
    resignNotice: "۱۵", copies: "۲",
    territory: "استان اصفهان", commissionTable: "", penalty: "", security: "چک تضمینی",
    securityAmount: "", terminationNotice: "۳۰",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target?.value ?? e }));
  const applyJob = (k) => { const j = JOBS[k]; setJobKey(k); setF((p) => ({ ...p, jobTitle: j.title, unit: j.unit, skill: j.skill, duties: j.duties })); };
  const sections = useMemo(() => (mode === "employment" ? buildEmployment(f) : buildCommission(f)), [mode, f]);
  const copyText = () => { navigator.clipboard?.writeText(toPlainText(sections)); };
  const printDoc = () => window.print();

  return (
    <div dir="rtl" className="contract-root">
      <style>{`
        .contract-root{font-family:'Vazirmatn',Tahoma,sans-serif;color:${T.ink};padding-bottom:24px}
        .contract-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;max-width:1180px;margin:0 auto;padding:12px 14px 0}
        .cb-title{font-weight:700;font-size:14px;color:${T.steelDk}}
        .cb-actions{display:flex;gap:8px}
        .contract-grid{max-width:1180px;margin:0 auto;padding:14px;display:grid;grid-template-columns:1fr;gap:16px;align-items:start}
        @media(min-width:860px){.contract-grid{grid-template-columns:minmax(320px,420px) 1fr}}
        .field{display:flex;flex-direction:column;gap:4px}
        .field label{font-size:12px;color:${T.ink2};font-weight:500}
        .field input,.field select,.field textarea{font-family:inherit;font-size:13px;padding:8px 10px;border:1px solid ${T.line};border-radius:8px;background:#fff;color:${T.ink};outline:none;width:100%}
        .field input:focus,.field select:focus,.field textarea:focus{border-color:${T.steel};box-shadow:0 0 0 3px ${T.steel}22}
        .grid{display:grid;gap:12px}
        .btn{font-family:inherit;cursor:pointer;border:none;border-radius:9px;padding:9px 16px;font-weight:600;font-size:13px}
        .doc h1{font-size:20px;text-align:center;margin:0 0 4px;letter-spacing:.2px}
        .doc .subline{text-align:center;font-size:12px;color:${T.ink2};margin-bottom:18px}
        .doc h2{font-size:14px;color:${T.steelDk};border-bottom:1px solid ${T.line};padding-bottom:4px;margin:18px 0 8px}
        .doc p.cl{font-size:12.5px;line-height:2;margin:5px 0;text-align:justify}
        .doc li{font-size:12.5px;line-height:2;margin:3px 0}
        .doc .note{font-size:12px;line-height:1.9;background:${T.soft};border-right:3px solid ${T.amber};padding:8px 12px;margin:8px 0;color:${T.ink2};border-radius:6px}
        @media print{.no-print{display:none!important}.doc-wrap{box-shadow:none!important;margin:0!important;max-width:100%!important;border:none!important}}
      `}</style>

      <div className="contract-bar no-print">
        <div className="cb-title">مولد قرارداد — دیواژ</div>
        <div className="cb-actions">
          <button className="btn" onClick={copyText} style={{ background: "#3a4650", color: "#fff" }}>کپی متن</button>
          <button className="btn" onClick={printDoc} style={{ background: T.amber, color: "#fff" }}>چاپ / ذخیره PDF</button>
        </div>
      </div>

      <div className="contract-grid">
        <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 6, background: "#fff", padding: 6, borderRadius: 12, border: `1px solid ${T.line}` }}>
            {[["employment", "قرارداد کار (استخدام)"], ["commission", "قرارداد پورسانتی (بازاریاب)"]].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className="btn" style={{ flex: 1, background: mode === k ? T.steel : "transparent", color: mode === k ? "#fff" : T.ink2 }}>{l}</button>
            ))}
          </div>

          {mode === "employment" && (
            <Panel title="۱) انتخاب شغل">
              <div className="field">
                <label>قالب شغلی مرکز پوشش</label>
                <select value={jobKey} onChange={(e) => applyJob(e.target.value)}>
                  {Object.entries(JOBS).map(([k, j]) => <option key={k} value={k}>{j.label}</option>)}
                </select>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <F label="عنوان دقیق سمت" v={f.jobTitle} on={set("jobTitle")} />
                <F label="کد شغلی (اختیاری)" v={f.jobCode} on={set("jobCode")} />
                <F label="واحد سازمانی" v={f.unit} on={set("unit")} />
                <F label="مقام مافوق" v={f.supervisor} on={set("supervisor")} />
              </div>
              <div className="field">
                <label>شرح وظایف (هر خط یک وظیفه)</label>
                <textarea rows={6} value={(f.duties || []).join("\n")} onChange={(e) => setF((p) => ({ ...p, duties: e.target.value.split("\n").filter(Boolean) }))} />
              </div>
            </Panel>
          )}

          <Panel title="۲) کارفرما (دیواژ)">
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <F label="نام شرکت/مرکز" v={f.coName} on={set("coName")} />
              <F label="نام تجاری" v={f.coBrand} on={set("coBrand")} />
              <F label="شناسهٔ ملی" v={f.coNationalId} on={set("coNationalId")} />
              <F label="شمارهٔ ثبت" v={f.coRegNo} on={set("coRegNo")} />
              <F label="کد اقتصادی" v={f.coEcoCode} on={set("coEcoCode")} />
              <F label="شناسهٔ کارگاهی (بیمه)" v={f.coWorkshopId} on={set("coWorkshopId")} />
              <F label="نمایندهٔ قانونی" v={f.coRepName} on={set("coRepName")} />
              <F label="سمت نماینده" v={f.coRepRole} on={set("coRepRole")} />
            </div>
            <F label="نشانی کارفرما" v={f.coAddress} on={set("coAddress")} />
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <F label="کدپستی" v={f.coPostal} on={set("coPostal")} />
              <F label="تلفن" v={f.coPhone} on={set("coPhone")} />
              <F label="ایمیل" v={f.coEmail} on={set("coEmail")} />
              <F label="شهر" v={f.city} on={set("city")} />
            </div>
          </Panel>

          <Panel title={mode === "employment" ? "۳) کارگر" : "۳) بازاریاب"}>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <F label="نام و نام خانوادگی" v={f.wName} on={set("wName")} />
              <F label="کد ملی" v={f.wNationalId} on={set("wNationalId")} />
              {mode === "employment" && <>
                <F label="نام پدر" v={f.wFather} on={set("wFather")} />
                <F label="شمارهٔ شناسنامه" v={f.wIdNo} on={set("wIdNo")} />
                <F label="محل صدور" v={f.wIssue} on={set("wIssue")} />
                <F label="تاریخ تولد" v={f.wBirth} on={set("wBirth")} />
                <F label="مدرک تحصیلی" v={f.wDegree} on={set("wDegree")} />
                <F label="رشته" v={f.wField} on={set("wField")} />
                <F label="سابقهٔ مرتبط" v={f.wExp} on={set("wExp")} />
              </>}
              <F label="تلفن همراه" v={f.wMobile} on={set("wMobile")} />
            </div>
            <F label="نشانی" v={f.wAddress} on={set("wAddress")} />
          </Panel>

          {mode === "employment" ? (
            <>
              <Panel title="۴) شرایط قرارداد">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="تاریخ تنظیم" v={f.contractDate} on={set("contractDate")} />
                  <SelF label="نوع قرارداد" v={f.contractKind} on={set("contractKind")} opts={["دائم", "موقت (مدت معیّن)", "کار معیّن", "کارآموزی"]} />
                  <F label="تاریخ شروع" v={f.startDate} on={set("startDate")} />
                  <F label="تاریخ پایان" v={f.endDate} on={set("endDate")} />
                  <F label="مدت" v={f.duration} on={set("duration")} />
                  <F label="دورهٔ آزمایشی" v={f.probation} on={set("probation")} />
                </div>
                <SelF label="سطح مهارت (سقف آزمایشی)" v={f.skill} on={set("skill")} opts={[["simple", "ساده/نیمه‌ماهر — سقف ۱ ماه"], ["skilled", "ماهر/متخصص — سقف ۳ ماه"]]} pairs />
                <F label="محل انجام کار" v={f.workPlace} on={set("workPlace")} />
              </Panel>

              <Panel title="۵) ساعات کار">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="شروع" v={f.workStart} on={set("workStart")} />
                  <F label="پایان" v={f.workEnd} on={set("workEnd")} />
                  <F label="روزهای کاری" v={f.workDays} on={set("workDays")} />
                  <F label="ساعت در هفته (حداکثر ۴۴)" v={f.weeklyHours} on={set("weeklyHours")} />
                </div>
              </Panel>

              <Panel title="۶) حقوق و مزایا (ریال)">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="حقوق پایهٔ ماهانه" v={f.baseSalary} on={set("baseSalary")} />
                  <F label="حق مسکن" v={f.housing} on={set("housing")} />
                  <F label="بن خواروبار" v={f.food} on={set("food")} />
                  <F label="ایاب و ذهاب" v={f.transport} on={set("transport")} />
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="روز مرخصی سالانه" v={f.leaveDays} on={set("leaveDays")} />
                  <SelF label="دورهٔ ارزیابی" v={f.evalPeriod} on={set("evalPeriod")} opts={["ماهانه", "فصلی", "شش‌ماهه"]} />
                </div>
                <p style={{ fontSize: 11, color: T.warn, margin: 0 }}>مبالغ را با آخرین مصوبهٔ شورای عالی کار سال جاری تکمیل کنید و از حداقل قانونی کمتر نباشد.</p>
              </Panel>
            </>
          ) : (
            <Panel title="۴) شرایط پورسانت و تضمین">
              <F label="تاریخ تنظیم" v={f.contractDate} on={set("contractDate")} />
              <F label="محدودهٔ جغرافیایی" v={f.territory} on={set("territory")} />
              <F label="جدول/نرخ پورسانت" v={f.commissionTable} on={set("commissionTable")} />
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <F label="نوع تضمین" v={f.security} on={set("security")} />
                <F label="مبلغ تضمین (ریال)" v={f.securityAmount} on={set("securityAmount")} />
                <F label="خسارت نقض محرمانگی (ریال)" v={f.penalty} on={set("penalty")} />
                <F label="مهلت اعلام فسخ (روز)" v={f.terminationNotice} on={set("terminationNotice")} />
              </div>
            </Panel>
          )}
        </div>

        <div className="doc-wrap" ref={docRef} style={{ background: T.panel, borderRadius: 12, boxShadow: "0 1px 3px #0001", padding: "34px 40px", border: `1px solid ${T.line}` }}>
          <div className="doc">
            {sections.map((b, i) => {
              if (b.type === "h1") return <h1 key={i}>{b.text}</h1>;
              if (b.type === "sub") return <div key={i} className="subline">{b.text}</div>;
              if (b.type === "para") return <p key={i} className="cl" style={{ background: T.soft, padding: "10px 12px", borderRadius: 8 }}>{b.text}</p>;
              if (b.type === "h2") return <h2 key={i}>{b.text}</h2>;
              if (b.type === "li") return <li key={i} style={{ listStyle: "none" }}><span style={{ color: T.steel, fontWeight: 700 }}>◆ </span>{b.text}</li>;
              if (b.type === "note") return <div key={i} className="note">⚠ {b.text}</div>;
              return <p key={i} className="cl">{b.text}</p>;
            })}
            <div style={{ marginTop: 26, borderTop: `1px dashed ${T.line}`, paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, fontSize: 12.5, lineHeight: 2.2 }}>
              <div>
                <div style={{ fontWeight: 700 }}>کارفرما</div>
                <div>نام: {B(f.coRepName)}</div>
                <div>سمت: {B(f.coRepRole)}</div>
                <div>تاریخ و امضا/مهر: ....................</div>
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{mode === "employment" ? "کارگر" : "بازاریاب"}</div>
                <div>نام: {B(f.wName)}</div>
                <div>کد ملی: {B(f.wNationalId)}</div>
                <div>تاریخ و امضا: ....................</div>
              </div>
              <div>شاهد اول: ............................... امضا: ..............</div>
              <div>شاهد دوم: ............................... امضا: ..............</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: T.steelDk }}>{title}</div>
      {children}
    </div>
  );
}
function F({ label, v, on }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={v} onChange={on} />
    </div>
  );
}
function SelF({ label, v, on, opts, pairs }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={v} onChange={on}>
        {opts.map((o) => pairs ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
