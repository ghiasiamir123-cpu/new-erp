import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { auth, materialUsageApi, materialsApi, projectsApi, reportsApi, usersApi } from "./api.js";

/*
  دیواژ | سامانهٔ گزارش کار روزانه
  مدل داده مطابق سند معماری: DailyReport → چند آیتم کاری (پرسنل × پروژه)
  نقش‌ها: مدیر / کاربر ثبت / ناظر  ·  تاریخ شمسی  ·  مدیریت پروژه

  توسعهٔ تدریجی: لیست‌های STATIONS/SHIFTS/ACTIVITIES/POSITIONS/STATUSES بالای فایل.
  ذخیره‌سازی و احراز هویت: بک‌اند Django/DRF با JWT و رمز عبور هش‌شده (src/api.js).
*/

/* ============ پیکربندی ============ */
const SHIFTS = ["صبح", "عصر", "شب"];
const ACTIVITIES = ["زیرکاری", "سنباده‌کاری", "آستر / پرایمر", "کیلر / رویه", "مونتاژ", "بسته‌بندی", "سایر"];
const POSITIONS = ["مدیر کارخانه", "مدیر تولید", "سرپرست", "سرگروه", "استادکار", "کارگر", "کنترل کیفیت", "انبار"];

const ROLES = {
  manager: { label: "مدیر", color: "#0F6E64" },
  data_entry: { label: "کاربر ثبت", color: "#4A7BA6" },
  viewer: { label: "ناظر", color: "#6B7A74" },
};

const STATUSES = {
  draft: { label: "پیش‌نویس", color: "#6B7A74" },
  waiting: { label: "در انتظار تأیید", color: "#4A7BA6" },
  approved: { label: "تأیید شد", color: "#1E7D46" },
  revision: { label: "نیاز به اصلاح", color: "#B5560B" },
};

const can = {
  createReport: (r) => r === "data_entry" || r === "manager",
  review: (r) => r === "manager",
  manageProjects: (r) => r === "manager",
  manageUsers: (r) => r === "manager",
};
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
function exportExcel(reports, projects, users) {
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
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(rows.length ? rows : [{ تاریخ: "" }])), "گزارش‌ها");
  XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet((projects.length ? projects : [{}]).map((p) => ({ نام_پروژه: p.name || "", کد: p.code || "", وضعیت: p.active !== false ? "فعال" : "غیرفعال" })))), "پروژه‌ها");
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

  useEffect(() => {
    if (!session) { setProjects([]); setReports([]); setUsers([]); setMaterials([]); setMaterialUsages([]); return; }
    (async () => {
      try {
        setApiError("");
        const [p, r, m, mu] = await Promise.all([
          projectsApi.list(), reportsApi.list(), materialsApi.list(), materialUsageApi.list(),
        ]);
        setProjects(p); setReports(r); setMaterials(m); setMaterialUsages(mu);
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
  async function deleteMaterialUsage(id) {
    await materialUsageApi.remove(id);
    setMaterialUsages((p) => p.filter((x) => x.id !== id));
  }

  if (!ready) return (<div className="app" dir="rtl"><style>{CSS}</style><div className="center">در حال بارگذاری…</div></div>);
  if (!session) return <Login onLogin={doLogin} />;

  const role = session.role;
  const TABS = [
    can.createReport(role) && { id: "entry", label: "ثبت گزارش" },
    { id: "reports", label: "گزارش‌ها" },
    { id: "materials", label: "مصرف مواد" },
    { id: "dashboard", label: "داشبورد" },
    can.manageProjects(role) && { id: "projects", label: "پروژه‌ها" },
    can.manageUsers(role) && { id: "contract", label: "قرارداد" },
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
          {tab === "entry" && <EntryView session={session} projects={projects} reports={reports} onCreateReport={createReport} onAddProject={createProject} />}
          {tab === "reports" && <ReportsView session={session} reports={reports} projects={projects} onAddFeedback={addFeedback} onResubmit={resubmitReport} onDelete={deleteReport} />}
          {tab === "materials" && <MaterialsUsageView session={session} projects={projects} materials={materials} materialUsages={materialUsages} onCreateUsage={createMaterialUsage} onDeleteUsage={deleteMaterialUsage} onCreateMaterial={createMaterial} onToggleMaterial={toggleMaterial} onDeleteMaterial={deleteMaterial} />}
          {tab === "dashboard" && <Dashboard reports={reports} projects={projects} users={users} session={session} />}
          {tab === "projects" && <ProjectsView projects={projects} onCreate={createProject} onToggle={toggleProject} onDelete={deleteProject} />}
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
          <label className="fld"><span>نام کاربری</span><input value={u} onChange={(e) => { setU(e.target.value); setErr(""); }} placeholder="manager" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          <label className="fld"><span>رمز</span><input type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(""); }} placeholder="••••" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          {err && <div className="err">{err}</div>}
          <button className="submit" disabled={busy} onClick={submit}>{busy ? "در حال ورود…" : "ورود"}</button>
          <div className="demo">
            کاربران نمونه (رمز همه: <b>۱۲۳۴</b>):<br />
            <code>manager</code> مدیر · <code>sarparast</code> کاربر ثبت · <code>viewer</code> ناظر
          </div>
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
function EntryView({ session, projects, reports, onCreateReport, onAddProject }) {
  const activeProjects = projects.filter((p) => p.active !== false);
  const knownEmployees = useMemo(() => {
    const s = new Set(); reports.forEach((r) => r.items?.forEach((it) => it.employee && s.add(it.employee))); return [...s];
  }, [reports]);

  const blankItem = () => ({ id: uid(), employee: "", project: activeProjects[0]?.id || "", activity: ACTIVITIES[0], hours: "", percent: "", desc: "" });
  const [date, setDate] = useState(todayIso());
  const [shift, setShift] = useState(SHIFTS[0]);
  const [items, setItems] = useState([blankItem()]);
  const [description, setDescription] = useState("");
  const [problems, setProblems] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const setItem = (id, k, v) => setItems((p) => p.map((it) => (it.id === id ? { ...it, [k]: v } : it)));
  const addRow = () => setItems((p) => [...p, blankItem()]);
  const delRow = (id) => setItems((p) => (p.length > 1 ? p.filter((it) => it.id !== id) : p));

  async function addProjectInline(id, name) {
    const nm = name.trim(); if (!nm) return;
    try {
      const proj = await onAddProject({ name: nm, code: "", active: true });
      setItem(id, "project", proj.id);
    } catch (e) {
      alert(e.message);
    }
  }

  const valid = items.some((it) => it.employee.trim());
  function build(status) {
    return {
      date, shift, status,
      description: description.trim(), problems: problems.trim(),
      items: items.filter((it) => it.employee.trim()).map((it) => ({
        employee: it.employee.trim(), project: it.project || null, activity: it.activity,
        hours: Number(it.hours) || 0, percent: Number(it.percent) || 0, desc: it.desc || "",
      })),
    };
  }
  async function save(status) {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onCreateReport(build(status));
      setItems([blankItem()]); setDescription(""); setProblems("");
      setMsg(status === "draft" ? "به‌عنوان پیش‌نویس ذخیره شد ✓" : "گزارش برای تأیید ارسال شد ✓");
      setTimeout(() => setMsg(""), 3000);
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
      {items.map((it, idx) => (
        <div className="item-row" key={it.id}>
          <div className="item-num">{faDigits(idx + 1)}</div>
          <div className="item-body">
            <div className="row2">
              <label className="fld sm"><span>پرسنل</span>
                <input list="emp-list" value={it.employee} onChange={(e) => setItem(it.id, "employee", e.target.value)} placeholder="نام پرسنل" />
              </label>
              <label className="fld sm"><span>پروژه</span>
                <select value={it.project} onChange={(e) => {
                  if (e.target.value === "__new") { const nm = window.prompt("نام پروژهٔ جدید:"); if (nm) addProjectInline(it.id, nm); }
                  else setItem(it.id, "project", e.target.value);
                }}>
                  {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__new">+ پروژهٔ جدید…</option>
                </select>
              </label>
            </div>
            <div className="row3">
              <label className="fld sm"><span>فعالیت</span>
                <select value={it.activity} onChange={(e) => setItem(it.id, "activity", e.target.value)}>{ACTIVITIES.map((a) => <option key={a}>{a}</option>)}</select>
              </label>
              <label className="fld sm"><span>ساعت</span><input type="number" inputMode="decimal" value={it.hours} onChange={(e) => setItem(it.id, "hours", e.target.value)} placeholder="۰" /></label>
              <label className="fld sm"><span>درصد زمان</span><input type="number" inputMode="numeric" value={it.percent} onChange={(e) => setItem(it.id, "percent", e.target.value)} placeholder="٪" /></label>
            </div>
            <label className="fld sm"><span>شرح (اختیاری)</span><input value={it.desc} onChange={(e) => setItem(it.id, "desc", e.target.value)} placeholder="جزئیات این آیتم" /></label>
          </div>
          {items.length > 1 && <button className="item-del" onClick={() => delRow(it.id)}>×</button>}
        </div>
      ))}
      <datalist id="emp-list">{knownEmployees.map((e) => <option key={e} value={e} />)}</datalist>
      <button className="add-row" onClick={addRow}>+ افزودن آیتم</button>

      <label className="fld"><span>شرح کلی روز (اختیاری)</span><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="fld"><span>مشکلات / توقفات (اختیاری)</span><textarea rows={2} value={problems} onChange={(e) => setProblems(e.target.value)} placeholder="خرابی، کمبود مواد، انتظار…" /></label>

      <div className="btn-row">
        <button className="ghost" disabled={!valid || busy} onClick={() => save("draft")}>ذخیرهٔ پیش‌نویس</button>
        <button className="submit" disabled={!valid || busy} onClick={() => save("waiting")}>ارسال برای تأیید</button>
      </div>
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}

/* ============ گزارش‌ها ============ */
function ReportsView({ session, reports, projects, onAddFeedback, onResubmit, onDelete }) {
  const [fDate, setFDate] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fProject, setFProject] = useState("all");
  const list = useMemo(() => reports
    .filter((r) => (!fDate || r.date === fDate) && (fStatus === "all" || r.status === fStatus) &&
      (fProject === "all" || r.items?.some((it) => it.project === fProject)))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)),
    [reports, fDate, fStatus, fProject]);
  const [pickDate, setPickDate] = useState(false);

  return (
    <>
      <div className="filters">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="all">همهٔ وضعیت‌ها</option>
          {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="all">همهٔ پروژه‌ها</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {fDate
          ? <button className="date-fil on" onClick={() => setFDate("")}>{jShort(fDate)} ✕</button>
          : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={(d) => setFDate(d)} /></div>}
      </div>
      {list.length === 0 ? <div className="empty">گزارشی با این فیلترها نیست.</div>
        : list.map((r) => <ReportCard key={r.id} r={r} session={session} onAddFeedback={onAddFeedback} onResubmit={onResubmit} onDelete={onDelete} />)}
    </>
  );
}

function ReportCard({ r, session, onAddFeedback, onResubmit, onDelete }) {
  const st = STATUSES[r.status] || STATUSES.draft;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const isManager = can.review(session.role);
  const totalH = (r.items || []).reduce((a, it) => a + (it.hours || 0), 0);

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
    <div className="card report">
      <div className="rep-head">
        <div>
          <div className="rep-date">{jLong(r.date)}</div>
          <div className="rep-meta">شیفت {r.shift} · سرپرست: {r.supervisorName}</div>
        </div>
        <span className="status-chip" style={{ color: st.color, background: st.color + "16" }}>{st.label}</span>
      </div>

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

      {r.problems && <p className="rep-notes"><b>مشکلات:</b> {r.problems}</p>}
      {r.description && <p className="rep-notes">{r.description}</p>}

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
        r.status === "revision" && r.supervisor === session.username && (
          <div className="rep-actions">
            <span className="hint">این گزارش نیاز به اصلاح دارد. پس از ویرایش دوباره ارسال کنید.</span>
            <button className="act ok" disabled={busy} onClick={resubmit}>ارسال مجدد</button>
          </div>
        )
      )}
    </div>
  );
}

/* ============ مصرف مواد ============ */
function MaterialsUsageView({ session, projects, materials, materialUsages, onCreateUsage, onDeleteUsage, onCreateMaterial, onToggleMaterial, onDeleteMaterial }) {
  const canEntry = can.createReport(session.role);
  const isManager = can.manageProjects(session.role);
  const activeMaterials = materials.filter((m) => m.active !== false);
  const activeProjects = projects.filter((p) => p.active !== false);

  const blankRow = () => ({ id: uid(), material: activeMaterials[0]?.id || "", quantity: "" });
  const [date, setDate] = useState(todayIso());
  const [project, setProject] = useState(activeProjects[0]?.id || "");
  const [rows, setRows] = useState([blankRow()]);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setRow = (id, k, v) => setRows((p) => p.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((p) => [...p, blankRow()]);
  const delRow = (id) => setRows((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p));

  async function addMaterialInline(id, name) {
    const nm = name.trim(); if (!nm) return;
    const code = window.prompt("کد ماده (اختیاری):") || "";
    const unit = window.prompt("واحد (مثلاً کیلوگرم، لیتر):") || "";
    try {
      const mat = await onCreateMaterial({ name: nm, code: code.trim(), unit: unit.trim(), active: true });
      setRow(id, "material", mat.id);
    } catch (e) {
      alert(e.message);
    }
  }

  const valid = project && rows.some((r) => r.material && Number(r.quantity) > 0);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const validRows = rows.filter((r) => r.material && Number(r.quantity) > 0);
      for (const r of validRows) {
        await onCreateUsage({ date, project, material: r.material, quantity: Number(r.quantity), desc: desc.trim() });
      }
      setRows([blankRow()]); setDesc("");
      setMsg("ثبت شد ✓");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [fProject, setFProject] = useState("all");
  const [fDate, setFDate] = useState("");
  const list = useMemo(() => materialUsages
    .filter((u) => (fProject === "all" || u.project === fProject) && (!fDate || u.date === fDate))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [materialUsages, fProject, fDate]);

  return (
    <>
      {canEntry && (
        <div className="card form">
          <div className="row2">
            <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
            <label className="fld"><span>پروژه</span>
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>

          <div className="items-hd">مواد مصرفی</div>
          {rows.map((r, idx) => {
            const mat = materials.find((m) => m.id === r.material);
            return (
              <div className="item-row" key={r.id}>
                <div className="item-num">{faDigits(idx + 1)}</div>
                <div className="item-body">
                  <div className="row2">
                    <label className="fld sm"><span>ماده</span>
                      <select value={r.material} onChange={(e) => {
                        if (e.target.value === "__new") { const nm = window.prompt("نام مادهٔ جدید:"); if (nm) addMaterialInline(r.id, nm); }
                        else setRow(r.id, "material", e.target.value);
                      }}>
                        {activeMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ""}</option>)}
                        <option value="__new">+ مادهٔ جدید…</option>
                      </select>
                    </label>
                    <label className="fld sm"><span>مقدار مصرفی{mat?.unit ? ` (${mat.unit})` : ""}</span>
                      <input type="number" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.id, "quantity", e.target.value)} placeholder="۰" />
                    </label>
                  </div>
                </div>
                {rows.length > 1 && <button className="item-del" onClick={() => delRow(r.id)}>×</button>}
              </div>
            );
          })}
          <button className="add-row" onClick={addRow}>+ افزودن ماده</button>

          <label className="fld"><span>شرح (اختیاری)</span><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="توضیح تکمیلی" /></label>

          <button className="submit" disabled={!valid || busy} onClick={save}>ثبت مصرف</button>
          {msg && <div className="ok-msg">{msg}</div>}
        </div>
      )}

      <div className="filters">
        <select value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="all">همهٔ پروژه‌ها</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {fDate
          ? <button className="date-fil on" onClick={() => setFDate("")}>{jShort(fDate)} ✕</button>
          : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={(d) => setFDate(d)} /></div>}
      </div>

      {list.length === 0 ? <div className="empty">مصرفی با این فیلترها ثبت نشده.</div> : list.map((u) => (
        <div className="card" key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{u.materialName}{u.materialCode ? ` (${u.materialCode})` : ""} — {faDigits(u.quantity)}{u.unit ? " " + u.unit : ""}</div>
            <div className="muted sm2">{jLong(u.date)} · {u.projectName} · ثبت‌کننده: {u.recordedBy}</div>
            {u.desc && <div className="muted sm2">{u.desc}</div>}
          </div>
          {isManager && <button className="del" onClick={() => onDeleteUsage(u.id).catch((e) => alert(e.message))}>حذف</button>}
        </div>
      ))}

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

/* ============ داشبورد ============ */
function Dashboard({ reports, projects, users, session }) {
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

  return (
    <>
      {isManager && (
        <button className="export-btn" onClick={() => exportExcel(reports, projects, users)}>
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
    </>
  );
}

/* ============ پروژه‌ها ============ */
function ProjectsView({ projects, onCreate, onToggle, onDelete }) {
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
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
      {projects.map((p) => (
        <div className="card proj" key={p.id}>
          <div><b>{p.name}</b>{p.code ? <span className="proj-code">{p.code}</span> : null}</div>
          <div className="proj-actions">
            <button className={p.active !== false ? "toggle on" : "toggle"} onClick={() => onToggle(p).catch((e) => alert(e.message))}>
              {p.active !== false ? "فعال" : "غیرفعال"}
            </button>
            <button className="del" onClick={() => onDelete(p.id).catch((e) => alert(e.message))}>حذف</button>
          </div>
        </div>
      ))}
    </>
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
.item-row{display:flex;gap:8px;align-items:flex-start;background:#F8FAF9;border:1px solid var(--line);border-radius:12px;padding:11px;margin-bottom:9px}
.item-num{width:22px;height:22px;border-radius:50%;background:var(--accent2);color:var(--accent);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:2px}
.item-body{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.item-del{background:none;border:none;color:#B23A3A;font-size:20px;cursor:pointer;line-height:1;padding:0 2px}
.add-row{width:100%;background:var(--accent2);color:var(--accent);border:1px dashed var(--accent);border-radius:10px;padding:9px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;margin-bottom:14px}
.btn-row{display:flex;gap:9px}
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
.rep-date{font-weight:700;font-size:15px}
.rep-meta{font-size:12px;color:var(--muted);margin-top:1px}
.status-chip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:16px;white-space:nowrap}
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
@media print{.no-print{display:none!important}.app{background:#fff}}
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
