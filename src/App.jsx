import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { auth, driverReportsApi, driversApi, employeesApi, materialUsageApi, materialsApi, payrollApi, projectsApi, reportsApi, usersApi } from "./api.js";
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
const POSITIONS = ["مدیر کارخانه", "مدیر تولید", "سرپرست", "سرگروه", "استادکار", "کارگر", "کنترل کیفیت", "انبار", "راننده"];
const UNITS = ["کیلوگرم", "لیتر", "عدد", "بسته", "متر", "سایر"];
const WORKDAY_HOURS = 8;

const ROLES = {
  manager: { label: "مدیر", color: "#0F6E64" },
  data_entry: { label: "کاربر ثبت", color: "#4A7BA6" },
  viewer: { label: "ناظر", color: "#6B7A74" },
  driver: { label: "راننده", color: "#8A5CB8" },
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
};
// رانندهٔ خالص فقط به صفحهٔ راننده دسترسی دارد.
const isDriverOnly = (r) => r === "driver";
const canEdit = (report, s) =>
  report.status !== "approved" && (s.username === report.supervisor || s.role === "manager");

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
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet((users.length ? users : [{}]).map((u) => ({ نام: u.name || "", نام_کاربری: u.username || "", نقش: (ROLES[u.role] || {}).label || "", سمت: u.position || "" })))), "کاربران");
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
  const [tab, setTab] = useState("reports");

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

  // رانندهٔ خالص فقط تب راننده را دارد، پس همان‌جا شروع می‌کند.
  useEffect(() => {
    if (session && isDriverOnly(session.role)) setTab("driver");
  }, [session]);

  useEffect(() => {
    if (!session) { setProjects([]); setReports([]); setUsers([]); setMaterials([]); setMaterialUsages([]); setEmployees([]); setDrivers([]); setDriverReports([]); return; }
    (async () => {
      try {
        setApiError("");
        // رانندهٔ خالص فقط دادهٔ صفحهٔ راننده را لازم دارد.
        if (isDriverOnly(session.role)) {
          const [drv, dr] = await Promise.all([driversApi.list(), driverReportsApi.list()]);
          setDrivers(drv); setDriverReports(dr);
          return;
        }
        const [p, r, m, mu, emp, drv, dr] = await Promise.all([
          projectsApi.list(), reportsApi.list(), materialsApi.list(), materialUsageApi.list(), employeesApi.list(),
          driversApi.list(), driverReportsApi.list(),
        ]);
        setProjects(p); setReports(r); setMaterials(m); setMaterialUsages(mu); setEmployees(emp);
        setDrivers(drv); setDriverReports(dr);
        if (session.role === "manager") setUsers(await usersApi.list());
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
  async function createUser(data) {
    const user = await usersApi.create(data);
    setUsers((p) => [...p, user]);
    return user;
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

  if (!ready) return (<div className="app" dir="rtl"><style>{CSS}</style><div className="center">در حال بارگذاری…</div></div>);
  if (!session) return <Login onLogin={doLogin} />;
  if (session.mustChangePassword) {
    return <ForcePasswordChange session={session} onChanged={(u) => setSession(u)} onLogout={doLogout} />;
  }

  const role = session.role;
  const driverOnly = isDriverOnly(role);
  const TABS = [
    can.createReport(role) && { id: "entry", label: "ثبت گزارش" },
    !driverOnly && { id: "reports", label: "گزارش‌ها" },
    !driverOnly && { id: "materials", label: "مصرف مواد" },
    { id: "driver", label: "راننده" },
    !driverOnly && { id: "dashboard", label: "داشبورد" },
    can.createReport(role) && { id: "projects", label: "پروژه‌ها" },
    can.createReport(role) && { id: "contract", label: "قرارداد" },
    can.manageUsers(role) && { id: "payroll", label: "حقوق و دستمزد" },
    can.manageUsers(role) && { id: "users", label: "کاربران" },
  ].filter(Boolean);

  return (
    <div className="app" dir="rtl">
      <style>{CSS}</style>
      <header className="hd no-print">
        <div className="hd-top">
          <div className="brand">
            <span className="mark" />
            <div><h1>دیواژ</h1><p>سامانهٔ گزارش کار روزانه</p></div>
          </div>
          <div className="who">
            <span className="who-name">{session.name}</span>
            <span className="role-chip" style={{ color: ROLES[role].color, background: ROLES[role].color + "16" }}>{ROLES[role].label}</span>
            <button className="logout" onClick={doLogout}>خروج</button>
          </div>
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "tab on" : "tab"} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </header>

      {tab === "contract" ? (
        <ContractGenerator session={session} />
      ) : (
        <main className="wrap">
          {apiError && <div className="notice warn">{apiError}</div>}
          {tab === "entry" && <EntryView session={session} projects={projects} reports={reports} employees={employees} onCreateReport={createReport} onUpdateReport={updateReportSections} onAddProject={createProject} onAddEmployee={createEmployee} />}
          {tab === "reports" && (
            <ReportsView
              session={session} reports={reports} materialUsages={materialUsages} driverReports={driverReports}
              projects={projects} materials={materials} employees={employees} drivers={drivers}
              onAddFeedback={addFeedback} onResubmit={resubmitReport} onUpdateReport={updateReportSections} onDelete={deleteReport}
              onAddUsageFeedback={addMaterialUsageFeedback} onResubmitUsage={resubmitMaterialUsage} onUpdateUsage={updateMaterialUsage} onDeleteUsage={deleteMaterialUsage}
              onAddDriverFeedback={addDriverReportFeedback} onResubmitDriver={resubmitDriverReport} onUpdateDriver={updateDriverReport} onDeleteDriver={deleteDriverReport}
            />
          )}
          {tab === "materials" && <MaterialsUsageView session={session} projects={projects} materials={materials} materialUsages={materialUsages} onCreateUsage={createMaterialUsage} onUpdateUsage={updateMaterialUsage} onCreateMaterial={createMaterial} onToggleMaterial={toggleMaterial} onDeleteMaterial={deleteMaterial} />}
          {tab === "driver" && <DriverView session={session} drivers={drivers} driverReports={driverReports} onCreateReport={createDriverReport} onUpdateReport={updateDriverReport} onCreateDriver={createDriver} onToggleDriver={toggleDriver} onDeleteDriver={deleteDriver} />}
          {tab === "dashboard" && <Dashboard reports={reports} projects={projects} materialUsages={materialUsages} driverReports={driverReports} users={users} session={session} employees={employees} onToggleEmployee={toggleEmployee} onDeleteEmployee={deleteEmployee} />}
          {tab === "projects" && <ProjectsView projects={projects} session={session} onCreate={createProject} onToggle={toggleProject} onDelete={deleteProject} onSaveStages={saveProjectStages} />}
          {tab === "payroll" && <PayrollView session={session} />}
          {tab === "users" && <UsersView users={users} onCreate={createUser} />}
        </main>
      )}
      <footer className="ft no-print">داده‌ها بین کاربران این اپ مشترک است · نمونهٔ اولیهٔ داخلی</footer>
    </div>
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
function JalaliPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const j = isoToJ(value);
  const [view, setView] = useState({ jy: j.jy, jm: j.jm });
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  function openCal() { const c = isoToJ(value); setView({ jy: c.jy, jm: c.jm }); setOpen(true); }
  const len = jMonthLen(view.jy, view.jm);
  const firstDow = new Date(jToIso({ jy: view.jy, jm: view.jm, jd: 1 }) + "T00:00:00").getDay();
  const blanks = (firstDow + 1) % 7;
  const cells = [...Array(blanks).fill(null), ...Array(len).fill(0).map((_, i) => i + 1)];
  const prev = () => setView((v) => (v.jm === 1 ? { jy: v.jy - 1, jm: 12 } : { jy: v.jy, jm: v.jm - 1 }));
  const next = () => setView((v) => (v.jm === 12 ? { jy: v.jy + 1, jm: 1 } : { jy: v.jy, jm: v.jm + 1 }));
  const cur = isoToJ(value);
  return (
    <div className="jp" ref={ref}>
      <button type="button" className="jp-input" onClick={openCal}>{jLong(value)}</button>
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
          <button type="button" className="jp-today" onClick={() => { onChange(todayIso()); setOpen(false); }}>امروز</button>
        </div>
      )}
    </div>
  );
}

/* ============ ثبت گزارش ============ */
function EntryView({ session, projects, reports, employees, onCreateReport, onUpdateReport, onAddProject, onAddEmployee }) {
  const activeProjects = projects.filter((p) => p.active !== false);
  const activeEmployees = employees.filter((e) => e.active !== false);

  const blankItem = () => ({ id: uid(), employee: "", project: activeProjects[0]?.id || "", activity: ACTIVITIES[0], hours: "", percent: "", desc: "" });
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
    return defined.length ? defined : STAGES;
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
                <select value={it.activity} onChange={(e) => setItem(it.id, "activity", e.target.value)}>{ACTIVITIES.map((a) => <option key={a}>{a}</option>)}</select>
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
  const isManager = can.review(session.role);
  const isApproved = r.status === "approved";
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

          {isManager ? (
            <>
              <div className="cmt-add">
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="نظر / بازخورد…" onKeyDown={(e) => e.key === "Enter" && submitFeedback()} />
                <button onClick={() => submitFeedback()} disabled={!comment.trim() || busy}>ثبت نظر</button>
              </div>
              <div className="rep-actions">
                <button className="act ok" disabled={busy} onClick={() => submitFeedback("approved")}>تأیید</button>
                <button className="act warn" disabled={busy} onClick={() => submitFeedback("revision")}>نیاز به اصلاح</button>
                <button className="del" disabled={busy} onClick={() => onDelete(r.id).catch((e) => alert(e.message))}>حذف</button>
              </div>
            </>
          ) : (
            canEditOwn && (
              <div className="rep-actions">
                {isRevision && <span className="hint">این گزارش نیاز به اصلاح دارد.</span>}
                <button className="act edit" disabled={busy} onClick={() => setEditing((v) => !v)}>
                  {editing ? "بستن ویرایش" : "ویرایش"}
                </button>
                {isRevision && (
                  <button className="act ok" disabled={busy} onClick={resubmit}>ارسال مجدد</button>
                )}
              </div>
            )
          )}

          {editing && canEditOwn && renderEditor(() => setEditing(false))}
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
  const activeProjects = projects.filter((p) => p.active !== false);
  const activeEmployees = employees.filter((e) => e.active !== false);
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
  const addItem = () => setItems((p) => [...p, { key: uid(), employee: "", project: activeProjects[0]?.id || "", activity: ACTIVITIES[0], hours: "", percent: "", desc: "" }]);
  const addProg = () => setProgress((p) => [...p, { key: uid(), project: "", stage: "", area: "", desc: "" }]);

  const stagesFor = (projectId) => {
    const proj = projects.find((p) => p.id === projectId);
    const defined = (proj?.stages || []).map((s) => s.name);
    return defined.length ? defined : STAGES;
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
                  {ACTIVITIES.map((a) => <option key={a}>{a}</option>)}
                  {it.activity && !ACTIVITIES.includes(it.activity) && <option>{it.activity}</option>}
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
function MaterialUsageEditor({ report, projects, materials, onSave, onClose }) {
  const activeProjects = projects.filter((p) => p.active !== false);
  const activeMaterials = materials.filter((m) => m.active !== false);
  const [rows, setRows] = useState(() => (report.items || []).map((it) => ({
    key: uid(), project: it.project || "", material: it.material || "",
    quantity: String(it.quantity ?? ""), desc: it.desc || "",
  })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setRow = (key, k, v) => setRows((p) => p.map((r) => (r.key === key ? { ...r, [k]: v } : r)));
  const delRow = (key) => setRows((p) => p.filter((r) => r.key !== key));
  const addRow = () => setRows((p) => [...p, { key: uid(), project: "", material: "", quantity: "", desc: "" }]);

  async function save() {
    if (busy) return;
    const valid = rows.filter((r) => r.project && r.material && Number(r.quantity) > 0);
    if (!valid.length) { alert("حداقل یک ردیف کامل لازم است."); return; }
    setBusy(true);
    try {
      await onSave({
        items: valid.map((r) => ({
          project: r.project, material: r.material, quantity: Number(r.quantity), desc: r.desc || "",
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
      <div className="items-hd">ویرایش مواد مصرفی</div>
      {rows.map((r) => {
        const mat = materials.find((m) => m.id === r.material);
        return (
          <div className="item-row" key={r.key}>
            <div className="item-body">
              <div className="row2">
                <label className="fld sm"><span>پروژه</span>
                  <select value={r.project} onChange={(e) => setRow(r.key, "project", e.target.value)}>
                    <option value="">— انتخاب کنید —</option>
                    {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="fld sm"><span>ماده</span>
                  <select value={r.material} onChange={(e) => setRow(r.key, "material", e.target.value)}>
                    <option value="">— انتخاب کنید —</option>
                    {activeMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ""}</option>)}
                  </select>
                </label>
              </div>
              <div className="row2">
                <label className="fld sm"><span>مقدار{mat?.unit ? ` (${mat.unit})` : ""}</span>
                  <input type="number" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.key, "quantity", e.target.value)} />
                </label>
                <label className="fld sm"><span>شرح (اختیاری)</span>
                  <input value={r.desc} onChange={(e) => setRow(r.key, "desc", e.target.value)} />
                </label>
              </div>
            </div>
            {rows.length > 1 && <button className="item-del" onClick={() => delRow(r.key)}>×</button>}
          </div>
        );
      })}
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

/* ============ مصرف مواد ============ */
function MaterialsUsageView({ session, projects, materials, materialUsages, onCreateUsage, onUpdateUsage, onCreateMaterial, onToggleMaterial, onDeleteMaterial }) {
  const canEntry = can.createReport(session.role);
  const isManager = can.manageProjects(session.role);
  const activeMaterials = materials.filter((m) => m.active !== false);
  const activeProjects = projects.filter((p) => p.active !== false);

  const blankRow = () => ({ id: uid(), project: activeProjects[0]?.id || "", material: "", quantity: "", desc: "" });
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState([blankRow()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draftId, setDraftId] = useState(null);

  const setRow = (id, k, v) => setRows((p) => p.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((p) => [...p, blankRow()]);
  const delRow = (id) => setRows((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p));

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
      setRows((existing.items || []).length
        ? existing.items.map((it) => ({
            id: uid(), project: it.project || "", material: it.material || "",
            quantity: String(it.quantity ?? ""), desc: it.desc || "",
          }))
        : [blankRow()]);
    } else {
      setDraftId(null);
      setRows([blankRow()]);
    }
  }, [date, materialUsages, session.username]);

  const currentDraft = materialUsages.find((u) => u.id === draftId);

  const [newMatFor, setNewMatFor] = useState(null);
  const [newMat, setNewMat] = useState({ name: "", code: "", unit: UNITS[0] });
  function openNewMaterial(rowId) { setNewMatFor(rowId); setNewMat({ name: "", code: "", unit: UNITS[0] }); }
  async function confirmNewMaterial() {
    const nm = newMat.name.trim(); if (!nm) return;
    try {
      const mat = await onCreateMaterial({ name: nm, code: newMat.code.trim(), unit: newMat.unit, active: true });
      setRow(newMatFor, "material", mat.id);
      setNewMatFor(null);
    } catch (e) {
      alert(e.message);
    }
  }

  const valid = rows.some((r) => r.project && r.material && Number(r.quantity) > 0);

  /** ذخیره می‌کند و همان لحظه برای تأیید مدیر می‌فرستد. */
  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const items = rows
        .filter((r) => r.project && r.material && Number(r.quantity) > 0)
        .map((r) => ({ project: r.project, material: r.material, quantity: Number(r.quantity), desc: r.desc || "" }));
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

  return (
    <>
      {canEntry && (
        <div className="card form">
          <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>

          <div className="items-hd">مواد مصرفی</div>
          {rows.map((r, idx) => {
            const mat = materials.find((m) => m.id === r.material);
            return (
              <div className="item-row" key={r.id}>
                <div className="item-num">{faDigits(idx + 1)}</div>
                <div className="item-body">
                  <div className="row2">
                    <label className="fld sm"><span>پروژه</span>
                      <select value={r.project} onChange={(e) => setRow(r.id, "project", e.target.value)}>
                        <option value="">— انتخاب کنید —</option>
                        {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    <label className="fld sm"><span>ماده</span>
                      <select value={r.material} onChange={(e) => {
                        if (e.target.value === "__new") openNewMaterial(r.id);
                        else setRow(r.id, "material", e.target.value);
                      }}>
                        <option value="">— انتخاب کنید —</option>
                        {activeMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ""}</option>)}
                        <option value="__new">+ مادهٔ جدید…</option>
                      </select>
                    </label>
                  </div>
                  <div className="row2">
                    <label className="fld sm"><span>مقدار مصرفی{mat?.unit ? ` (${mat.unit})` : ""}</span>
                      <input type="number" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.id, "quantity", e.target.value)} placeholder="۰" />
                    </label>
                    <label className="fld sm"><span>شرح (اختیاری)</span>
                      <input value={r.desc} onChange={(e) => setRow(r.id, "desc", e.target.value)} placeholder="توضیح" />
                    </label>
                  </div>
                  {newMatFor === r.id && (
                    <div className="new-mat-box">
                      <label className="fld sm"><span>نام مادهٔ جدید</span><input value={newMat.name} onChange={(e) => setNewMat((p) => ({ ...p, name: e.target.value }))} placeholder="مثلاً: تینر" /></label>
                      <div className="row2">
                        <label className="fld sm"><span>کد (اختیاری)</span><input value={newMat.code} onChange={(e) => setNewMat((p) => ({ ...p, code: e.target.value }))} /></label>
                        <label className="fld sm"><span>واحد</span>
                          <select value={newMat.unit} onChange={(e) => setNewMat((p) => ({ ...p, unit: e.target.value }))}>
                            {UNITS.map((u) => <option key={u}>{u}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="btn-row">
                        <button className="ghost" onClick={() => setNewMatFor(null)}>انصراف</button>
                        <button className="submit" disabled={!newMat.name.trim()} onClick={confirmNewMaterial}>افزودن ماده</button>
                      </div>
                    </div>
                  )}
                </div>
                {rows.length > 1 && <button className="item-del" onClick={() => delRow(r.id)}>×</button>}
              </div>
            );
          })}
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
      )}

      {isManager && materials.length > 0 && (
        <>
          <div className="card"><div className="board-h">مدیریت مواد</div><div className="muted sm2">مواد جدید رو از طریق گزینهٔ «+ مادهٔ جدید» توی فرم بالا اضافه کنید.</div></div>
          {materials.map((m) => (
            <div className="card proj" key={m.id}>
              <div><b>{m.name}</b>{m.code ? <span className="proj-code">{m.code}</span> : null}{m.unit ? <span className="muted sm2"> · {m.unit}</span> : null}</div>
              <div className="proj-actions">
                <button className={m.active !== false ? "toggle on" : "toggle"} onClick={() => onToggleMaterial(m).catch((e) => alert(e.message))}>
                  {m.active !== false ? "فعال" : "غیرفعال"}
                </button>
                <button className="del" onClick={() => onDeleteMaterial(m.id).catch((e) => alert(e.message))}>حذف</button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ============ راننده ============ */
function DriverView({ session, drivers, driverReports, onCreateReport, onUpdateReport, onCreateDriver, onToggleDriver, onDeleteDriver }) {
  const canEntry = can.createDriverReport(session.role);
  const isManager = can.manageProjects(session.role);
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

/* ============ داشبورد ============ */
function Dashboard({ reports, projects, materialUsages, driverReports, users, session, employees, onToggleEmployee, onDeleteEmployee }) {
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
  const isManager = session && can.manageUsers(session.role);

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

  const driverSummary = useMemo(() => {
    const shuttle = (scheduled, arrival, passengers) => {
      if (!scheduled && !arrival && !passengers) return "—";
      const times = arrival ? `${scheduled || "—"} → ${arrival}` : (scheduled || "—");
      return passengers ? `${times} (${passengers})` : times;
    };
    const rows = [...(driverReports || [])]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((r) => ({
        id: r.id,
        date: r.date,
        driverName: r.driverName || "—",
        distanceKm: r.distanceKm || 0,
        morning: shuttle(r.morningScheduledTime, r.morningArrivalTime, r.morningPassengers),
        evening: shuttle(r.eveningScheduledTime, r.eveningArrivalTime, r.eveningPassengers),
        delayCount: (r.delays || []).length,
        taskCount: (r.tasks || []).length,
      }));
    const byDriver = {};
    rows.forEach((r) => { byDriver[r.driverName] = (byDriver[r.driverName] || 0) + r.distanceKm; });
    const perDriver = Object.entries(byDriver).sort((a, b) => b[1] - a[1]);
    return {
      rows,
      perDriver,
      maxKm: Math.max(1, ...perDriver.map((x) => x[1])),
      totalKm: rows.reduce((a, r) => a + r.distanceKm, 0),
      totalDelays: rows.reduce((a, r) => a + r.delayCount, 0),
      totalTasks: rows.reduce((a, r) => a + r.taskCount, 0),
    };
  }, [driverReports]);

  return (
    <>
      <div className="no-print">
        {isManager && (
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

        <div className="card">
          <div className="board-h">خلاصهٔ گزارش رانندگان</div>
          {driverSummary.rows.length === 0 ? <div className="muted">گزارش رانندگی ثبت نشده.</div> : (
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
                    {driverSummary.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{jShort(r.date)}</td>
                        <td>{r.driverName}</td>
                        <td>{faDigits(r.distanceKm)}</td>
                        <td>{r.morning}</td>
                        <td>{r.evening}</td>
                        <td>{r.delayCount ? <span className="day-idle over">{faDigits(r.delayCount)} مورد</span> : "—"}</td>
                        <td>{r.taskCount ? faDigits(r.taskCount) : "—"}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td colSpan={2}>مجموع</td>
                      <td>{faDigits(driverSummary.totalKm)}</td>
                      <td colSpan={2}>—</td>
                      <td>{faDigits(driverSummary.totalDelays)} مورد</td>
                      <td>{faDigits(driverSummary.totalTasks)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {driverSummary.perDriver.length > 1 && (
                <>
                  <div className="board-h" style={{ marginTop: 14 }}>پیمایش به تفکیک راننده</div>
                  {driverSummary.perDriver.map(([name, km]) => (
                    <div className="bar-row" key={name}>
                      <span className="bar-lbl">{name}</span>
                      <div className="bar emp"><div style={{ width: (km / driverSummary.maxKm * 100) + "%" }} /></div>
                      <span className="bar-v">{faDigits(km)}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

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

      {isManager && <ProjectCostReport projects={projects} reports={reports} materialUsages={materialUsages} />}
    </>
  );
}

/* ============ گزارش پروژه برای مالی (قابل پرینت) ============ */
function ProjectCostReport({ projects, reports, materialUsages }) {
  const [project, setProject] = useState(projects[0]?.id || "");
  const proj = projects.find((p) => p.id === project);

  const empHours = useMemo(() => {
    const m = {};
    reports.forEach((r) => (r.items || []).forEach((it) => {
      if (it.project !== project) return;
      m[it.employee] = (m[it.employee] || 0) + (it.hours || 0);
    }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [reports, project]);

  // متراژ به تفکیک مرحله — از گزارش پیشرفت روزانه، نه از آیتم‌های هر نفر.
  const stageArea = useMemo(() => {
    const m = {};
    reports.forEach((r) => (r.progress || []).forEach((g) => {
      if (g.project !== project) return;
      m[g.stage] = (m[g.stage] || 0) + (g.area || 0);
    }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [reports, project]);

  // فقط مصرفِ گزارش‌های تأییدشده وارد گزارش مالی می‌شود.
  const matQty = useMemo(() => {
    const m = {};
    materialUsages
      .filter((rep) => rep.status === "approved")
      .forEach((rep) => (rep.items || []).forEach((row) => {
        if (row.project !== project) return;
        const key = row.materialName + (row.unit ? ` (${row.unit})` : "");
        m[key] = (m[key] || 0) + (row.quantity || 0);
      }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [materialUsages, project]);

  const totalHours = empHours.reduce((a, [, h]) => a + h, 0);
  const totalArea = stageArea.reduce((a, [, v]) => a + v, 0);

  return (
    <div className="card">
      <div className="no-print">
        <div className="board-h">گزارش پروژه (برای مالی)</div>
        <label className="fld"><span>پروژه</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="submit" onClick={() => window.print()}>🖨 پرینت گزارش</button>
      </div>

      <div className="print-report">
        <h3 className="print-title">گزارش پروژه: {proj?.name || "—"}</h3>
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
function ProjectsView({ projects, session, onCreate, onToggle, onDelete, onSaveStages }) {
  const isManager = can.manageUsers(session.role);
  const canEditStages = can.createReport(session.role);
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);

  async function add() {
    const nm = name.trim(); if (!nm || busy) return;
    setBusy(true);
    try {
      await onCreate({ name: nm, code: code.trim(), active: true });
      setName(""); setCode("");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="card">
        <div className="board-h">پروژهٔ جدید</div>
        <div className="row2">
          <label className="fld"><span>نام پروژه</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: کابینت آشپزخانه" /></label>
          <label className="fld"><span>کد (اختیاری)</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KIT" /></label>
        </div>
        <button className="submit" disabled={!name.trim() || busy} onClick={add}>افزودن پروژه</button>
      </div>
      {projects.map((p) => {
        const stages = p.stages || [];
        const done = stages.filter((s) => s.done).length;
        const pct = stages.length ? Math.round(done / stages.length * 100) : 0;
        return (
          <div className="card" key={p.id}>
            <div className="proj" style={{ padding: 0 }}>
              <div><b>{p.name}</b>{p.code ? <span className="proj-code">{p.code}</span> : null}</div>
              {isManager ? (
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

            {stages.length > 0 && (
              <div className="stage-summary">
                <div className="bar-row" style={{ marginBottom: 4 }}>
                  <span className="bar-lbl">پیشرفت</span>
                  <div className="bar"><div style={{ width: pct + "%" }} /></div>
                  <span className="bar-v">{faDigits(pct)}٪</span>
                </div>
                <div className="muted sm2">
                  {faDigits(done)} از {faDigits(stages.length)} مرحله انجام شده · متراژ کل: {faDigits(p.totalArea || 0)} م²
                </div>
              </div>
            )}

            <button className="stage-toggle" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
              {openId === p.id ? "بستن مراحل ▲" : (stages.length ? "مشاهده و ویرایش مراحل ▼" : "تعیین مراحل پروژه ▼")}
            </button>

            {openId === p.id && (
              <ProjectStagesEditor
                project={p}
                readOnly={!canEditStages}
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
  const [rows, setRows] = useState(() =>
    STAGES.map((name) => {
      const cur = existing.find((s) => s.name === name);
      return { name, on: !!cur, area: cur ? String(cur.area ?? "") : "", done: cur ? !!cur.done : false };
    })
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setRow = (name, patch) => setRows((p) => p.map((r) => (r.name === name ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.on);
  const totalArea = selected.reduce((a, r) => a + (Number(r.area) || 0), 0);

  async function save() {
    if (busy) return;
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
              <label className="fld sm">
                <span>متراژ (م²)</span>
                <input type="number" inputMode="decimal" disabled={readOnly} value={r.area}
                  onChange={(e) => setRow(r.name, { area: e.target.value })} placeholder="۰" />
              </label>
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
      {!readOnly && (
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>بستن</button>
          <button className="submit" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیرهٔ مراحل"}</button>
        </div>
      )}
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/* ============ کاربران ============ */
function UsersView({ users, onCreate }) {
  const [f, setF] = useState({ username: "", name: "", role: "data_entry", position: POSITIONS[2], password: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.username.trim() && f.name.trim() && f.password.trim();
  async function add() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onCreate({ username: f.username.trim(), name: f.name.trim(), role: f.role, position: f.position, password: f.password.trim() });
      setF({ username: "", name: "", role: "data_entry", position: POSITIONS[2], password: "" });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="card">
        <div className="board-h">کاربر جدید</div>
        <div className="row2">
          <label className="fld"><span>نام کاربری</span><input value={f.username} onChange={set("username")} placeholder="لاتین، بدون فاصله" /></label>
          <label className="fld"><span>نام و نام خانوادگی</span><input value={f.name} onChange={set("name")} /></label>
        </div>
        <div className="row2">
          <label className="fld"><span>نقش (سطح دسترسی)</span><select value={f.role} onChange={set("role")}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label className="fld"><span>سمت سازمانی</span><select value={f.position} onChange={set("position")}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select></label>
        </div>
        <label className="fld"><span>رمز</span><input type="password" value={f.password} onChange={set("password")} placeholder="رمز اولیه" /></label>
        <button className="submit" disabled={!valid || busy} onClick={add}>افزودن کاربر</button>
      </div>
      {users.map((u) => (
        <div className="card proj" key={u.username}>
          <div><b>{u.name}</b> <span className="muted sm2">{u.position}</span></div>
          <span className="role-chip" style={{ color: ROLES[u.role].color, background: ROLES[u.role].color + "16" }}>{ROLES[u.role].label}</span>
        </div>
      ))}
    </>
  );
}

/* ============ استایل ============ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}
.app{--paper:#F1F3F1;--card:#fff;--ink:#16211E;--muted:#5C6B66;--line:#E1E6E2;--accent:#0F6E64;--accent2:#E4F1EF;
  font-family:'Vazirmatn',system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100vh;line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;padding:14px}
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

/* login */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px;width:100%;max-width:340px;text-align:center}
.login-card h1{margin:0;font-size:24px}.login-card .sub{margin:2px 0 18px;color:var(--muted);font-size:13px}
.login-card .fld{text-align:right}
.err{color:#B23A3A;font-size:12.5px;margin:-4px 0 8px}
.demo{margin-top:16px;font-size:11.5px;color:var(--muted);line-height:2}
.demo code{background:#F1F3F1;padding:1px 6px;border-radius:5px;font-family:inherit}

/* fields */
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
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
.submit{flex:1;background:var(--accent);color:#fff;border:none;border-radius:11px;padding:12px;font-family:inherit;font-size:14.5px;font-weight:600;cursor:pointer}
.submit:disabled{opacity:.45;cursor:not-allowed}
.ghost{flex:1;background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:11px;padding:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
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
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 6px;text-align:center}
.stat b{display:block;font-size:21px;font-weight:700}.stat span{font-size:11px;color:var(--muted)}
.stat.warn b{color:#B5560B}
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
.tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tbl-scroll .print-table{min-width:560px}
.tbl-scroll .print-table td,.tbl-scroll .print-table th{white-space:nowrap}
.print-table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px}
.print-table th,.print-table td{border:1px solid var(--line);padding:7px 10px;text-align:right}
.print-table th{background:#F3F6F5;font-weight:700}
.print-table .total-row{font-weight:700;background:#F8FAF9}

@media print{
  .no-print{display:none!important}
  .app{background:#fff}
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
