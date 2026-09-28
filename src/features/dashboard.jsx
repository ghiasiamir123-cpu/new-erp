import { useState, useMemo, useCallback, useEffect } from "react";
import { auth, exportApi, financeApi, financeReportsApi, maintenanceApi } from "../api.js";
import { DriverReportExport } from "./driver.jsx";
import { ExpiringBatches, MaterialConsumption, ProductionPulse } from "./pulse.jsx";
import { JalaliPicker, WORKDAY_HOURS, download, faDigits, hasAccess, jLong, jShort, showMessage, todayIso } from "../shared/core.jsx";
import { BarList, Donut, Sparkline, TrendChart } from "../shared/charts.jsx";
import { Widget, WidgetCatalog, useDashboardLayout } from "../shared/widgets.jsx";

/* ============ داشبورد ============ */
const DAYS = 30;
const STATUS_PARTS = [
  ["approved", "تأییدشده", "#147D70"], ["waiting", "در انتظار تأیید", "#C98A2B"],
  ["revision", "نیاز به اصلاح", "#C0453A"], ["draft", "پیش‌نویس", "#9AAAA5"],
];
const G_WORK = "گزارش کار", G_PROD = "تولید و پروژه‌ها", G_STOCK = "انبار، مالی و نگهداری", G_TOOLS = "ابزارها";
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
// مبلغ‌های بزرگ ریالی خواناتر: «۱۲٫۳ میلیارد»
const bigRial = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1e9) return `${faDigits((n / 1e9).toFixed(1))} میلیارد`;
  if (v >= 1e6) return `${faDigits(Math.round(n / 1e6))} میلیون`;
  return faDigits(Math.round(n || 0).toLocaleString("en-US"));
};

export function Dashboard({ reports, projects, materialUsages, drivers, driverReports, users, session, employees, onToggleEmployee, onDeleteEmployee, onNavigate, onLayoutSaved }) {
  const today = todayIso();
  const can = (k) => hasAccess(session, k);
  const stats = useMemo(() => {
    const byStatus = { draft: 0, waiting: 0, approved: 0, revision: 0 };
    let hours = 0; const byProj = {}; const byEmp = {}; const byDay = {};
    reports.forEach((r) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      (r.items || []).forEach((it) => {
        const h = it.hours || 0;
        hours += h;
        byProj[it.projectName] = (byProj[it.projectName] || 0) + h;
        byEmp[it.employee] = (byEmp[it.employee] || 0) + h;
        byDay[r.date] = (byDay[r.date] || 0) + h;
      });
    });
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    const days = [];                                   // ۳۰ روز اخیر، قدیمی‌ترین اول
    const d0 = new Date(today + "T00:00:00");
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(d0); d.setDate(d.getDate() - i);
      days.push({ date: isoOf(d), value: byDay[isoOf(d)] || 0 });
    }
    return { byStatus, hours, count: reports.length, byProj: top(byProj), byEmp: top(byEmp), days };
  }, [reports, today]);

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

  const [dayDate, setDayDate] = useState(today);
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

  // همهٔ ویجت‌ها. «key» اجازه‌ای است که مسئول کاربران برای هر نفر تیک می‌زند؛ «needs» سربرگی
  // که داده‌اش از آن می‌آید. «on: false» یعنی در چیدمان پیش‌فرض نیست ولی در فهرست ویرایش هست.
  const ALL = [
    { id: "summary", group: G_WORK, title: "کارت‌های خلاصه", size: "full", hint: "گزارش‌ها، ساعت کار، تأییدشده، در انتظار" },
    { id: "trend", group: G_WORK, title: "ساعت کار روزانه", size: "full", hint: "نمودار ۳۰ روز اخیر" },
    { id: "status", group: G_WORK, title: "وضعیت گزارش‌ها", hint: "سهم تأییدشده، در انتظار، اصلاح و پیش‌نویس" },
    { id: "queue", group: G_WORK, title: "کارهای منتظر تأیید", hint: "گزارش کار، مصرف مواد و راننده" },
    { id: "day", group: G_WORK, title: "کار و زمان خالی یک روز", hint: "هر نفر از ۸ ساعت روز" },
    { id: "projhours", group: G_WORK, title: "ساعت‌کار به تفکیک پروژه" },
    { id: "staffhours", group: G_WORK, title: "ساعت‌کار به تفکیک پرسنل" },
    { id: "projects", group: G_PROD, title: "پروژه‌های در جریان", needs: ["projects", "production"], hint: "پیشرفت و روزهای مانده تا تحویل" },
    { id: "pulse", group: G_PROD, title: "نبض تولید", size: "full", needs: ["production"] },
    { id: "material", group: G_PROD, title: "مصرف مواد بر هر متر", size: "full", needs: ["production"] },
    { id: "stock", group: G_STOCK, title: "ارزش موجودی انبار", needs: ["financereports"], hint: "به قیمت فروش؛ به تفکیک برند" },
    { id: "finance", group: G_STOCK, title: "کارتابل مالی", needs: ["finance"], hint: "حواله‌های منتظر قیمت‌گذاری و تأیید" },
    { id: "maint", group: G_STOCK, title: "اخطارهای تعمیر و نگهداری", needs: ["maintenance"] },
    { id: "expiry", group: G_STOCK, title: "بچ‌های رو به انقضا", needs: ["warehouse"] },
    { id: "driver", group: G_TOOLS, title: "خروجی گزارش راننده", on: false },
    { id: "staff", group: G_TOOLS, title: "مدیریت کارگرها", key: "dashboard.staff", on: false, hint: "فعال/غیرفعال و حذف کارگر" },
    { id: "cost", group: G_TOOLS, title: "گزارش پروژه برای مالی", key: "dashboard.cost", size: "full", on: false, hint: "برگهٔ چاپی ساعت، متراژ و مصرف" },
  ];
  const defs = ALL.filter((w) => can(w.key || `dashboard.w.${w.id}`) && (!w.needs || w.needs.some(can)))
    .filter((w) => w.id !== "staff" || employees.length > 0);
  const titles = Object.fromEntries(defs.map((d) => [d.id, d.title]));
  const ctl = useDashboardLayout(session?.dashboard && Object.keys(session.dashboard).length ? session.dashboard : null, defs,
    async (layout) => { const u = await auth.saveDashboard(layout); onLayoutSaved?.(u); });

  const last7 = stats.days.slice(-7).reduce((a, p) => a + p.value, 0);
  const prev7 = stats.days.slice(-14, -7).reduce((a, p) => a + p.value, 0);
  const delta = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null;
  const waiting = stats.byStatus.waiting || 0;
  const maxDay = Math.max(WORKDAY_HOURS, ...dayStats.map((r) => r.worked));

  const body = {
    summary: (
      <div className="kpis">
        <div className="kpi"><span>گزارش‌ها</span><b>{faDigits(stats.count)}</b><small>همهٔ گزارش‌های ثبت‌شده</small></div>
        <div className="kpi">
          <span>ساعت کار</span><b>{faDigits(Math.round(stats.hours))}</b>
          <small>
            ۷ روز اخیر {faDigits(Math.round(last7))}
            {delta !== null && <em className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "▲" : "▼"} {faDigits(Math.abs(delta))}٪</em>}
          </small>
          <Sparkline values={stats.days.slice(-14).map((p) => p.value)} />
        </div>
        <div className="kpi"><span>تأییدشده</span><b>{faDigits(stats.byStatus.approved || 0)}</b>
          <small>{stats.count ? faDigits(Math.round(((stats.byStatus.approved || 0) / stats.count) * 100)) : "۰"}٪ از گزارش‌ها</small></div>
        <div className={waiting ? "kpi warn" : "kpi"}><span>در انتظار تأیید</span><b>{faDigits(waiting)}</b>
          <small>{waiting ? "منتظر بررسی مدیر" : "چیزی در صف نیست"}</small></div>
      </div>
    ),
    trend: <TrendChart points={stats.days} highlight={today} />,
    status: (
      <Donut center={faDigits(stats.count)} sub="گزارش"
        parts={STATUS_PARTS.map(([k, label, color]) => ({ label, color, value: stats.byStatus[k] || 0 }))} />
    ),
    queue: <ApprovalQueue reports={reports} materialUsages={materialUsages} driverReports={driverReports} today={today} onNavigate={onNavigate} session={session} />,
    day: (
      <>
        <label className="fld"><span>تاریخ</span><JalaliPicker value={dayDate} onChange={setDayDate} /></label>
        {dayStats.length === 0 ? <div className="muted">کارگری برای این روز ثبت نشده.</div> : (
          <div className="ut">
            {dayStats.map((row) => (
              <div className="ut-row" key={row.name}>
                <span className="ut-n">{row.name}</span>
                <div className="ut-bar" title={`${faDigits(row.worked)} ساعت کار`}>
                  <i className="w" style={{ width: `${(Math.min(row.worked, WORKDAY_HOURS) / maxDay) * 100}%` }} />
                  {row.remaining > 0 && <i className="f" style={{ width: `${(row.remaining / maxDay) * 100}%` }} />}
                  {row.remaining < 0 && <i className="o" style={{ width: `${(-row.remaining / maxDay) * 100}%` }} />}
                </div>
                <span className={row.remaining < 0 ? "ut-v over" : row.worked ? "ut-v" : "ut-v idle"}>
                  {row.remaining < 0 ? `+${faDigits(-row.remaining)} اضافه` : row.worked ? `${faDigits(row.worked)} از ${faDigits(WORKDAY_HOURS)}` : "بی‌کار"}
                </span>
              </div>
            ))}
            <div className="ut-leg"><span><i className="w" />کار</span><span><i className="f" />خالی</span><span><i className="o" />اضافه‌کار</span></div>
          </div>
        )}
      </>
    ),
    projhours: <BarList rows={stats.byProj} unit="ساعت" />,
    staffhours: <BarList rows={stats.byEmp} unit="ساعت" tone="alt" />,
    projects: <ProjectsInProgress projects={projects} today={today} onNavigate={onNavigate} session={session} />,
    pulse: <ProductionPulse />,
    material: <div className="pulse"><MaterialConsumption /></div>,
    stock: <StockValueWidget onNavigate={onNavigate} />,
    finance: <FinanceInboxWidget onNavigate={onNavigate} />,
    maint: <MaintenanceWidget onNavigate={onNavigate} today={today} />,
    expiry: <div className="pulse"><ExpiringBatches /></div>,
    driver: <DriverReportExport drivers={drivers} driverReports={driverReports} />,
    staff: (
      <>
        <div className="muted sm2" style={{ marginBottom: 8 }}>کارگر جدید را از «+ کارگر جدید» در فرم ثبت گزارش اضافه کنید.</div>
        <div className="staff-list">
          {employees.map((emp) => (
            <div className="staff-row" key={emp.id}>
              <b>{emp.name}</b>
              <div className="proj-actions">
                <button className={emp.active !== false ? "toggle on" : "toggle"} onClick={() => onToggleEmployee(emp).catch((e) => alert(e.message))}>
                  {emp.active !== false ? "فعال" : "غیرفعال"}
                </button>
                <button className="del" onClick={() => onDeleteEmployee(emp.id).catch((e) => alert(e.message))}>حذف</button>
              </div>
            </div>
          ))}
        </div>
      </>
    ),
    cost: <ProjectCostReport projects={projects} reports={reports} materialUsages={materialUsages} />,
  };
  const subs = {
    trend: `${faDigits(DAYS)} روز اخیر · امروز سمت چپ`,
    projhours: `${faDigits(stats.byProj.length)} پروژه`,
    staffhours: `${faDigits(stats.byEmp.length)} نفر`,
  };

  return (
    <>
      <div className="dash-banner no-print">
        <div><b>Diwaj ERP</b><span>برنامه‌ریزی منابع سازمان</span></div>
      </div>

      <div className="dash-bar no-print">
        <h2>داشبورد <span>{jLong(today)}</span></h2>
        <div className="dash-acts">
          {!ctl.editing && defs.length > 0 && (
            <button className="ghost dash-export" onClick={ctl.startEdit}>✎ ویرایش داشبورد</button>
          )}
          {canBackup && !ctl.editing && (
            <button className="ghost dash-export" onClick={exportAll} disabled={exporting}>
              {exporting ? "در حال ساختن اکسل…" : "⬇ خروجی اکسل کامل"}
            </button>
          )}
        </div>
      </div>

      {ctl.editing && <WidgetCatalog ctl={ctl} defs={defs} />}
      {!ctl.editing && ctl.err && <div className="notice warn no-print">{ctl.err}</div>}

      {defs.length === 0 ? (
        <div className="empty">برای شما هنوز ویجتی روی داشبورد فعال نشده است. از مسئول کاربران بخواهید.</div>
      ) : ctl.visible.length === 0 ? (
        <div className="empty">
          داشبورد خالی است. {!ctl.editing && <button className="link-btn" onClick={ctl.startEdit}>ویجت اضافه کنید</button>}
        </div>
      ) : (
        <div className={ctl.editing ? "wg-grid editing" : "wg-grid"}>
          {ctl.visible.map((id, i) => (
            <Widget key={id} id={id} title={titles[id]} sub={subs[id]} ctl={ctl}
              first={i === 0} last={i === ctl.visible.length - 1}>
              {body[id]}
            </Widget>
          ))}
        </div>
      )}
    </>
  );
}

/* ---- ویجت: کارهای منتظر تأیید ---- */
function ApprovalQueue({ reports, materialUsages, driverReports, today, onNavigate, session }) {
  const kinds = [
    { tab: "reports", label: "گزارش کار", rows: reports, who: (r) => r.supervisorName },
    { tab: "materials", label: "مصرف مواد", rows: materialUsages, who: (r) => r.recordedByName },
    { tab: "driver", label: "گزارش راننده", rows: driverReports, who: (r) => r.driverName },
  ].filter((k) => hasAccess(session, k.tab));
  const waiting = kinds.flatMap((k) => k.rows.filter((r) => r.status === "waiting").map((r) => ({ ...k, r })))
    .sort((a, b) => (a.r.date || "").localeCompare(b.r.date || ""));
  const revision = kinds.reduce((a, k) => a + k.rows.filter((r) => r.status === "revision").length, 0);
  return (
    <div className="aq">
      <div className="aq-counts">
        {kinds.map((k) => {
          const n = k.rows.filter((r) => r.status === "waiting").length;
          return (
            <button key={k.tab} className={n ? "aq-c hot" : "aq-c"} onClick={() => onNavigate?.(k.tab)}>
              <b>{faDigits(n)}</b><span>{k.label}</span>
            </button>
          );
        })}
      </div>
      {revision > 0 && <div className="muted sm2">{faDigits(revision)} گزارش برای اصلاح برگشت خورده و منتظر ثبت‌کننده است.</div>}
      {waiting.length === 0 ? <div className="aq-ok">✓ چیزی منتظر تأیید نیست.</div> : (
        <ul className="aq-list">
          {waiting.slice(0, 6).map(({ tab, label, who, r }) => {
            const age = r.date ? daysBetween(r.date, today) : 0;
            return (
              <li key={tab + r.id}>
                <button onClick={() => onNavigate?.(tab)}>
                  <span className="aq-k">{label}</span>
                  <span className="aq-w">{who(r) || "—"}</span>
                  <span className="aq-d">{jShort(r.date)}</span>
                  <span className={age > 2 ? "aq-age late" : "aq-age"}>{age > 0 ? `${faDigits(age)} روز` : "امروز"}</span>
                </button>
              </li>
            );
          })}
          {waiting.length > 6 && <li className="muted sm2">و {faDigits(waiting.length - 6)} مورد دیگر…</li>}
        </ul>
      )}
    </div>
  );
}

/* ---- ویجت: پروژه‌های در جریان ---- */
function ProjectsInProgress({ projects, today, onNavigate, session }) {
  const open = projects.filter((p) => !p.general && !p.closedAt && p.active !== false);
  const rows = open.map((p) => ({ p, pct: Math.round(p.progress?.percent || 0), left: p.dueDate ? daysBetween(today, p.dueDate) : null }))
    .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9) || b.pct - a.pct);
  const late = rows.filter((r) => r.left !== null && r.left < 0 && r.pct < 100).length;
  const target = hasAccess(session, "production") ? "production" : "projects";
  if (!rows.length) return <div className="muted">پروژهٔ بازی نیست.</div>;
  return (
    <div className="pp">
      <div className="muted sm2">{faDigits(rows.length)} پروژهٔ باز{late ? <> · <b className="warn-txt">{faDigits(late)} پروژه از موعد تحویل گذشته</b></> : ""}</div>
      {rows.slice(0, 8).map(({ p, pct, left }) => (
        <button key={p.id} className="pp-row" onClick={() => onNavigate?.(target)}>
          <span className="pp-n">{p.name}{p.code ? <small>{p.code}</small> : null}</span>
          <div className="bl-track"><div className={`bl-fill ${pct >= 100 ? "alt" : "accent"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          <span className="pp-p">{faDigits(pct)}٪</span>
          <span className={left === null ? "pp-d none" : left < 0 && pct < 100 ? "pp-d late" : left <= 7 ? "pp-d soon" : "pp-d"}>
            {left === null ? "بی‌تاریخ" : left < 0 ? `${faDigits(-left)} روز دیر` : left === 0 ? "امروز" : `${faDigits(left)} روز`}
          </span>
        </button>
      ))}
      {rows.length > 8 && <button className="link-btn" onClick={() => onNavigate?.(target)}>همهٔ {faDigits(rows.length)} پروژه</button>}
    </div>
  );
}

/* ---- ویجت‌هایی که دادهٔ خودشان را می‌خوانند ---- */
function useLoad(fn) {
  const [s, setS] = useState({ data: null, err: "" });
  useEffect(() => {
    let alive = true;
    fn().then((data) => alive && setS({ data, err: "" })).catch((e) => alive && setS({ data: null, err: e.message }));
    return () => { alive = false; };
  }, []);
  return s;
}

function StockValueWidget({ onNavigate }) {
  const { data, err } = useLoad(() => financeReportsApi.stockValue());
  if (err) return <div className="muted">{err}</div>;
  if (!data) return <div className="muted">در حال محاسبه…</div>;
  const c = data.counts || {};
  return (
    <div>
      <div className="big-num"><b>{bigRial(data.total)}</b> <span>ریال</span></div>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        {faDigits(c.priced || 0)} کالای قیمت‌دار از {faDigits(c.inStock || 0)} کالای موجود
        {(c.noPrice || 0) + (c.noLink || 0) > 0 && <> · <span className="warn-txt">{faDigits((c.noPrice || 0) + (c.noLink || 0))} بی‌قیمت</span></>}
      </div>
      <BarList rows={(data.byBrand || []).filter((b) => b.value > 0).map((b) => [b.brand, b.value / 1e6])} unit="میلیون ریال" limit={6} />
      <button className="link-btn" style={{ marginTop: 8 }} onClick={() => onNavigate?.("financereports")}>گزارش کامل</button>
    </div>
  );
}

function FinanceInboxWidget({ onNavigate }) {
  const { data, err } = useLoad(() => financeApi.vouchers({ status: "pending" }));
  if (err) return <div className="muted">{err}</div>;
  if (!data) return <div className="muted">…</div>;
  const t = data.totals || {};
  const rows = data.results || [];
  return (
    <div className="aq">
      <div className="aq-counts">
        <button className={t.pending ? "aq-c hot" : "aq-c"} onClick={() => onNavigate?.("finance")}><b>{faDigits(t.pending || 0)}</b><span>منتظر مالی</span></button>
        <button className="aq-c" onClick={() => onNavigate?.("finance")}><b>{faDigits(t.returned || 0)}</b><span>برگشت به انبار</span></button>
        <button className="aq-c" onClick={() => onNavigate?.("finance")}><b>{faDigits(t.approved || 0)}</b><span>تأییدشده</span></button>
      </div>
      {rows.length === 0 ? <div className="aq-ok">✓ حواله‌ای منتظر مالی نیست.</div> : (
        <ul className="aq-list">
          {rows.slice(0, 5).map((v) => (
            <li key={v.id}>
              <button onClick={() => onNavigate?.("finance")}>
                <span className="aq-k">{v.number}</span>
                <span className="aq-w">{v.movementKindLabel} · {v.createdBy || "—"}</span>
                <span className="aq-d">{jShort(v.date)}</span>
                <span className="aq-age">{v.invoiceTotal ? `${bigRial(v.invoiceTotal)} ریال` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaintenanceWidget({ onNavigate, today }) {
  const { data, err } = useLoad(() => maintenanceApi.alerts());
  if (err) return <div className="muted">{err}</div>;
  if (!data) return <div className="muted">…</div>;
  const c = data.counts || {};
  const rows = data.results || [];
  return (
    <div className="aq">
      <div className="aq-counts">
        <button className={c.open ? "aq-c hot" : "aq-c"} onClick={() => onNavigate?.("maintenance")}><b>{faDigits(c.open || 0)}</b><span>اخطار باز</span></button>
        <button className={c.high ? "aq-c danger" : "aq-c"} onClick={() => onNavigate?.("maintenance")}><b>{faDigits(c.high || 0)}</b><span>فوری</span></button>
      </div>
      {rows.length === 0 ? <div className="aq-ok">✓ اخطار بازی نیست.</div> : (
        <ul className="aq-list">
          {rows.slice(0, 5).map((a) => {
            const left = a.dueDate ? daysBetween(today, a.dueDate) : null;
            return (
              <li key={a.id}>
                <button onClick={() => onNavigate?.("maintenance")}>
                  <span className={a.level === "high" ? "aq-k danger" : "aq-k"}>{a.kindLabel}</span>
                  <span className="aq-w">{a.asset?.name || a.detail || "—"}</span>
                  <span className="aq-d">{a.dueDate ? jShort(a.dueDate) : ""}</span>
                  <span className={left !== null && left < 0 ? "aq-age late" : "aq-age"}>
                    {left === null ? "" : left < 0 ? `${faDigits(-left)} روز گذشته` : left === 0 ? "امروز" : `${faDigits(left)} روز`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
