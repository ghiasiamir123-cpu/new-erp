import { useState, useEffect, useRef, useCallback } from "react";
import { auth, driverReportsApi, chatApi, driversApi, employeesApi, maintenanceApi, materialUsageApi, materialsApi, productionApi, projectsApi, reportsApi, usersApi } from "./api.js";
import { ForcePasswordChange, Login } from "./features/auth.jsx";
import { InstallApp } from "./shared/install.jsx";
import { ChatView } from "./features/chat.jsx";
import { ContractGenerator } from "./features/contract.jsx";
import { Dashboard } from "./features/dashboard.jsx";
import { DriverView } from "./features/driver.jsx";
import { FinanceReportsView, FinanceView } from "./features/finance.jsx";
import { AccountingView, accountingPanes } from "./features/accounting.jsx";
import { MaintenanceView } from "./features/maintenance.jsx";
import { MaterialsUsageView } from "./features/materials.jsx";
import { PayrollView } from "./features/payroll.jsx";
import { PROD_PANES, ProductionView } from "./features/production.jsx";
import { ProjectsView } from "./features/projects.jsx";
import { EntryView, ReportsView } from "./features/reports.jsx";
import { UsersView } from "./features/users.jsx";
import { WarehouseView } from "./features/warehouse/index.jsx";
import { ACCESS_TABS, Avatar, ConfirmHost, DiwajLogo, Icon, MySettingsDialog, NAV_GROUPS, ROLES, SessionContext, WIDE_TABS, faDigits, firstTab, hasAccess, jLong, navIcon, readRoute, todayIso, writeRoute } from "./shared/core.jsx";
import { CSS } from "./styles.js";


/* ============ APP ============ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [reports, setReports] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);   // دادهٔ مشترک (پروژه‌ها، گزارش‌ها، …) از سرور رسیده است
  const [materials, setMaterials] = useState([]);
  const [materialUsages, setMaterialUsages] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [driverReports, setDriverReports] = useState([]);
  const [apiError, setApiError] = useState("");
  const [tab, setTab] = useState(() => readRoute().tab || "reports");
  // بخشِ بازِ «تولید»؛ در نشانی کنار سربرگ نوشته می‌شود (#production/schedule).
  const [prodPane, setProdPane] = useState(() => {
    const r = readRoute();
    if (r.tab === "production" && r.sub === "plan") return "schedule";     // «پیش‌بینی و ظرفیت» حالا درونِ برنامه‌ریزی است
    if (r.tab === "production" && (r.sub === "stages" || r.sub === "pricing")) return "settings";   // هر دو در «تنظیمات تولید»اند
    return r.tab === "production" && PROD_PANES.some((p) => p.id === r.sub) ? r.sub : "board";
  });
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
    if (!session) return;
    if (tab === "production") writeRoute(tab, prodPane);
    else if (readRoute().tab !== tab) writeRoute(tab);
  }, [session, tab, prodPane]);

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

  // داده فقط وقتی دوباره خوانده می‌شود که کاربر یا دسترسی‌اش عوض شود — نه با ذخیرهٔ چیدمان
  // داشبورد یا عکس، که آن‌ها هم session را تازه می‌کنند.
  const dataKey = session ? `${session.username}|${(session.access || []).join(",")}` : "";
  useEffect(() => {
    setDataLoaded(false);
    if (!session) { setProjects([]); setReports([]); setUsers([]); setMaterials([]); setMaterialUsages([]); setEmployees([]); setDrivers([]); setDriverReports([]); return; }
    (async () => {
      try {
        setApiError("");
        // گزارش‌ها، داشبورد و پروژه‌ها داده‌های مشترک را لازم دارند؛ کسی که فقط
        // صفحهٔ راننده دارد، فقط دادهٔ راننده را می‌گیرد.
        const needsShared = ["entry", "reports", "materials", "dashboard", "projects"].some((k) => hasAccess(session, k));
        if (!needsShared) {
          if (hasAccess(session, "driver") || hasAccess(session, "accounting.driver")) {
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
        setDataLoaded(true);
        if (hasAccess(session, "users")) setUsers(await usersApi.list());
      } catch (e) {
        setApiError(e.message || "خطا در دریافت اطلاعات از سرور.");
      }
    })();
  }, [dataKey]);

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
  async function createProject(data, stages, baseArea) {
    let project = await projectsApi.create(data);
    // مراحل با یک درخواست جدا ذخیره می‌شوند، چون سرور همان‌جا ضریب و متراژ را می‌سنجد.
    if (stages && stages.length) {
      project = await projectsApi.saveStages(project.id, stages, baseArea);
    }
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
  async function saveProjectStages(id, stages, baseArea) {
    const updated = await projectsApi.saveStages(id, stages, baseArea);
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function reopenProject(id) {
    const updated = await productionApi.reopen(id);
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function setProjectGeneral(id, general) {
    const updated = await projectsApi.update(id, { general });
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function updateProject(id, patch) {
    const updated = await projectsApi.update(id, patch);
    setProjects((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    return updated;
  }
  async function setProjectPrice(id, price) {
    const updated = await projectsApi.update(id, { price });
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

  // «پروژه‌ها» یک ردیف در منوست: وضعیتِ پروژه‌ها (سربرگِ تولید) و تعریف و ویرایش (سربرگِ پروژه‌ها) دو زبانهٔ همان صفحه‌اند.
  // هر کس فقط زبانه‌ای را می‌بیند که سربرگش را دارد؛ دسترسی‌ها همان است که بود.
  const canProd = hasAccess(session, "production"), canProj = hasAccess(session, "projects");
  const grouped = new Set([...NAV_GROUPS.flatMap((g) => g.ids), "projects"]);
  // «دستیار حسابداری» برای کسی که فقط تنخواهِ خودش را وارد می‌کند (مثلاً راننده) همان «تنخواهِ من» است.
  const onlyMyCash = accountingPanes(session).length === 1;
  const accountingNav = { id: "accounting", label: onlyMyCash ? "تنخواهِ من" : "دستیار حسابداری", icon: onlyMyCash ? "cash" : "accounting" };
  const navGroups = NAV_GROUPS
    .map((g, i) => ({
      label: g.label,
      items: g.panes
        ? [
          ...(canProd ? [{ id: "production", pane: "board", label: "پروژه‌ها", icon: "projects", also: canProj ? "projects" : "" }]
            : canProj ? [{ id: "projects", label: "پروژه‌ها" }] : []),
          ...(canProd ? PROD_PANES.filter((p) => p.id !== "board" && (!p.key || hasAccess(session, p.key)))
            .map((p) => ({ id: "production", pane: p.id, label: p.label })) : []),
        ]
        : [
          ...g.ids.map((id) => TABS.find((t) => t.id === id)).filter(Boolean).map((t) => (t.id === "accounting" ? accountingNav : t)),
          ...(i === NAV_GROUPS.length - 1 ? TABS.filter((t) => !grouped.has(t.id)) : []),
        ],
    }))
    .filter((g) => g.items.length > 0);
  const paneNow = PROD_PANES.find((p) => p.id === prodPane && (!p.key || hasAccess(session, p.key)))?.id || "board";
  const onProjects = (tab === "production" && paneNow === "board") || tab === "projects";
  const tabLabel = onProjects ? `پروژه‌ها › ${tab === "projects" ? "تعریف و ویرایش" : "وضعیت"}`
    : tab === "production" ? `تولید › ${PROD_PANES.find((p) => p.id === paneNow)?.label || ""}`
      : tab === "accounting" ? accountingNav.label : ACCESS_TABS.find((t) => t.id === tab)?.label || "";
  const pick = (id, pane) => { setTab(id); if (pane) setProdPane(pane); setNavOpen(false); };
  const maintNew = maint ? maint.openIds.filter((id) => Number(id) > maintSeen).length : 0;

  return (
    <SessionContext.Provider value={session}>
    <div className={WIDE_TABS.has(tab) ? "app app-wide shell" : "app shell"} dir="rtl">
      <style>{CSS}</style>
      <aside className={navOpen ? "sb open no-print" : "sb no-print"} aria-label="منوی اصلی">
        <div className="sb-brand">
          <span className="mark"><DiwajLogo /></span>
          <div><b>Diwaj ERP</b><small>برنامه‌ریزی منابع سازمان</small></div>
          <button className="sb-close" onClick={() => setNavOpen(false)} aria-label="بستن منو"><Icon name="close" size={20} /></button>
        </div>
        <nav className="sb-nav">
          {navGroups.map((g) => (
            <div className="sb-group" key={g.label}>
              <span className="sb-label">{g.label}</span>
              {g.items.map((t) => (
                <button key={t.pane ? `${t.id}:${t.pane}` : t.id}
                  className={(tab === t.id && (!t.pane || t.pane === paneNow)) || (t.also && tab === t.also) ? "sb-item on" : "sb-item"}
                  aria-current={(tab === t.id && (!t.pane || t.pane === paneNow)) || (t.also && tab === t.also) ? "page" : undefined}
                  onClick={() => pick(t.id, t.pane)}>
                  <Icon name={navIcon(t)} />
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
        <InstallApp />
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
        <div className="crumb"><span>Diwaj ERP</span><span className="sep">/</span><b>{tabLabel}</b></div>
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
          {onProjects && canProd && canProj && (
            <div className="seg-row no-print" role="tablist" aria-label="پروژه‌ها">
              <button role="tab" aria-selected={tab === "production"} className={tab === "production" ? "seg on" : "seg"}
                onClick={() => pick("production", "board")}>وضعیت پروژه‌ها</button>
              <button role="tab" aria-selected={tab === "projects"} className={tab === "projects" ? "seg on" : "seg"}
                onClick={() => pick("projects")}>تعریف و ویرایش</button>
            </div>
          )}
          {tab === "entry" && hasAccess(session, "entry") && <EntryView session={session} loaded={dataLoaded} projects={projects} reports={reports} employees={employees} onCreateReport={createReport} onUpdateReport={updateReportSections} onAddProject={createProject} onAddEmployee={createEmployee} />}
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
          {tab === "dashboard" && hasAccess(session, "dashboard") && <Dashboard reports={reports} projects={projects} materialUsages={materialUsages} drivers={drivers} driverReports={driverReports} users={users} session={session} employees={employees} onToggleEmployee={toggleEmployee} onDeleteEmployee={deleteEmployee} onNavigate={(t) => hasAccess(session, t) && setTab(t)} onLayoutSaved={(u) => setSession((s) => ({ ...s, dashboard: u.dashboard }))} />}
          {tab === "projects" && hasAccess(session, "projects") && <ProjectsView projects={projects} session={session} onCreate={createProject} onToggle={toggleProject} onDelete={deleteProject} onSaveStages={saveProjectStages} onReopen={reopenProject} onSetGeneral={setProjectGeneral} onSetPrice={setProjectPrice} onUpdate={updateProject} />}
          {tab === "warehouse" && hasAccess(session, "warehouse") && <WarehouseView session={session} />}
          {tab === "finance" && hasAccess(session, "finance") && <FinanceView />}
          {tab === "financereports" && hasAccess(session, "financereports") && <FinanceReportsView />}
          {tab === "accounting" && hasAccess(session, "accounting") && <AccountingView session={session} drivers={drivers} driverReports={driverReports} />}
          {tab === "maintenance" && canMaint && <MaintenanceView onChanged={refreshMaint} onSeen={markMaintSeen} />}
          {tab === "chat" && hasAccess(session, "chat") && <ChatView session={session} onUnread={setChatUnread} />}
          {tab === "production" && hasAccess(session, "production") && <ProductionView pane={paneNow} />}
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
