import { useState, useMemo, useCallback } from "react";
import { exportApi } from "../api.js";
import { DriverReportExport } from "./driver.jsx";
import { JalaliPicker, WORKDAY_HOURS, download, faDigits, hasAccess, jShort, showMessage, todayIso } from "../shared/core.jsx";

/* ============ داشبورد ============ */
export function Dashboard({ reports, projects, materialUsages, drivers, driverReports, users, session, employees, onToggleEmployee, onDeleteEmployee }) {
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
  // خروجی کامل فقط برای نقش «مدیر» است؛ سرور هم جز به مدیر نمی‌دهد.
  const canBackup = session?.role === "manager";
  const [exporting, setExporting] = useState(false);
  const exportAll = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await exportApi.full();
      download(filename, blob);
    } catch (e) {
      showMessage({ title: "خروجی اکسل ساخته نشد", message: e.message });
    } finally {
      setExporting(false);
    }
  };
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
          <button className="export-btn" onClick={exportAll} disabled={exporting}>
            {exporting ? "در حال ساختن اکسل کامل…" : "⬇ خروجی اکسل کامل Diwaj ERP"}
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
