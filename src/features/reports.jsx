import { useState, useEffect, useMemo, useRef } from "react";
import { UsageLines } from "./materials.jsx";
import { Empty, JalaliPicker, ProjectOptions, SHIFTS, STATUSES, WORKDAY_HOURS, blankUsageLine, faDigits, fq, hasAccess, jLong, jShort, openPackText, projectLabel, todayIso, uid, usageLineFromItem, usageLinePayload, usageLineReady, useWorkStages } from "../shared/core.jsx";

/* ============ ثبت گزارش ============ */
export function EntryView({ session, projects, reports, employees, onCreateReport, onUpdateReport, onAddProject, onAddEmployee }) {
  // پروژهٔ بسته هم مثل غیرفعال، دیگر در فهرست انتخاب نمی‌آید؛ برای ثبت کار رویش
  // باید اول دوباره بازش کرد. کار عمومی کارگاه جداست و متراژ نمی‌گیرد.
  const activeProjects = projects.filter((p) => p.active !== false && !p.closedAt && !p.general);
  const generalProjects = projects.filter((p) => p.active !== false && p.general);
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
                  <ProjectOptions projects={activeProjects} general={generalProjects} />
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
                    {activeProjects.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
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

// سه بخش جدا، هر کدام با نوار فیلتر خودش؛ عدد کنار نام = گزارش‌های منتظر تأیید.
const REPORT_PANES = [
  { id: "daily", label: "گزارش کار" },
  { id: "material", label: "مصرف مواد" },
  { id: "driver", label: "راننده" },
];
const PANE_KEY = "divaj_reports_pane";

export function ReportsView(props) {
  const lists = { daily: props.reports, material: props.materialUsages, driver: props.driverReports };
  const [pane, setPane] = useState(() => {
    try {
      const saved = localStorage.getItem(PANE_KEY);
      return REPORT_PANES.some((p) => p.id === saved) ? saved : "daily";
    } catch { return "daily"; }
  });
  function pick(id) {
    setPane(id);
    try { localStorage.setItem(PANE_KEY, id); } catch { /* بی حافظهٔ مرورگر هم کار می‌کند */ }
  }
  return (
    <>
      <div className="sub-tabs no-print" role="tablist">
        {REPORT_PANES.map((p) => {
          const waiting = (lists[p.id] || []).filter((r) => r.status === "waiting").length;
          return (
            <button key={p.id} role="tab" aria-selected={pane === p.id}
              className={pane === p.id ? "sub-tab on" : "sub-tab"} onClick={() => pick(p.id)}>
              {p.label}
              {waiting > 0 && <span className="sub-count" title="در انتظار تأیید">{faDigits(waiting)}</span>}
            </button>
          );
        })}
      </div>
      {pane === "daily" && <DailyReportsPane {...props} />}
      {pane === "material" && <UsageReportsPane {...props} />}
      {pane === "driver" && <DriverReportsPane {...props} />}
    </>
  );
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const uniqSorted = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fa"));
const round1 = (n) => Math.round(n * 10) / 10;

function StatusFilter({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="وضعیت">
      <option value="all">همهٔ وضعیت‌ها</option>
      {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
    </select>
  );
}

function ChoiceFilter({ value, onChange, all, options, label }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="all">{all}</option>
      {options.map((o) => (typeof o === "string"
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

function DayFilter({ value, onChange }) {
  return value
    ? <button className="date-fil on" onClick={() => onChange("")}>{jShort(value)} ✕</button>
    : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={onChange} /></div>;
}

/** فهرست یک نوع گزارش: اول کارهای باز، بعد تأییدشده‌ها؛ بالایش خلاصهٔ همین فیلترها. */
function ReportList({ list, art, summary, render }) {
  const open = list.filter((r) => r.status !== "approved");
  const approved = list.filter((r) => r.status === "approved");
  const waiting = list.filter((r) => r.status === "waiting").length;
  if (!list.length) return <Empty art={art}>گزارشی با این فیلترها نیست.</Empty>;
  return (
    <>
      <div className="rep-sum">
        {[`${faDigits(list.length)} گزارش`, waiting ? `${faDigits(waiting)} در انتظار تأیید` : "", summary]
          .filter(Boolean).join(" · ")}
      </div>
      {open.map(render)}
      {approved.length > 0 && (
        <>
          <div className="approved-sep">گزارش‌های تأییدشده</div>
          {approved.map(render)}
        </>
      )}
    </>
  );
}

function DailyReportsPane({ session, reports, projects, employees, onAddFeedback, onResubmit, onUpdateReport, onDelete }) {
  const [fStatus, setFStatus] = useState("all");
  const [fProject, setFProject] = useState("all");
  const [fEmp, setFEmp] = useState("all");
  const [fSup, setFSup] = useState("all");
  const [fDate, setFDate] = useState("");
  const people = useMemo(() => uniqSorted(reports.flatMap((r) => (r.items || []).map((it) => it.employee))), [reports]);
  const sups = useMemo(() => uniqSorted(reports.map((r) => r.supervisorName)), [reports]);

  const list = useMemo(() => reports.filter((r) => {
    if (fDate && r.date !== fDate) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    if (fSup !== "all" && r.supervisorName !== fSup) return false;
    if (fEmp !== "all" && !(r.items || []).some((it) => it.employee === fEmp)) return false;
    if (fProject !== "all" && !(r.items || []).some((it) => it.project === fProject)
      && !(r.progress || []).some((g) => g.project === fProject)) return false;
    return true;
  }).sort(byDateDesc), [reports, fDate, fStatus, fSup, fEmp, fProject]);

  // جمع ساعت فقط برای ردیف‌هایی که با فیلتر نفر و پروژه جورند؛ متراژ مال تیم است، پس با فیلتر نفر نمی‌آید.
  const hours = list.reduce((a, r) => a + (r.items || [])
    .filter((it) => (fEmp === "all" || it.employee === fEmp) && (fProject === "all" || it.project === fProject))
    .reduce((b, it) => b + (it.hours || 0), 0), 0);
  const area = fEmp !== "all" ? 0 : list.reduce((a, r) => a + (r.progress || [])
    .filter((g) => fProject === "all" || g.project === fProject)
    .reduce((b, g) => b + (g.area || 0), 0), 0);
  const summary = [hours ? `${faDigits(round1(hours))} ساعت` : "", area ? `${faDigits(round1(area))} متر مربع` : ""]
    .filter(Boolean).join(" · ");

  return (
    <>
      <div className="filters">
        <StatusFilter value={fStatus} onChange={setFStatus} />
        <ChoiceFilter value={fProject} onChange={setFProject} all="همهٔ پروژه‌ها" label="پروژه"
          options={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))} />
        <ChoiceFilter value={fEmp} onChange={setFEmp} all="همهٔ پرسنل" label="پرسنل" options={people} />
      </div>
      <div className="filters">
        <ChoiceFilter value={fSup} onChange={setFSup} all="همهٔ سرپرست‌ها" label="سرپرست" options={sups} />
        <DayFilter value={fDate} onChange={setFDate} />
      </div>
      <ReportList list={list} art="reports" summary={summary} render={(r) => (
        <ReportCard key={`r${r.id}`} r={r} session={session} projects={projects} employees={employees}
          onAddFeedback={onAddFeedback} onResubmit={onResubmit} onUpdateReport={onUpdateReport} onDelete={onDelete} />
      )} />
    </>
  );
}

function UsageReportsPane({ session, materialUsages, projects, materials, onAddUsageFeedback, onResubmitUsage, onUpdateUsage, onDeleteUsage }) {
  const [fStatus, setFStatus] = useState("all");
  const [fProject, setFProject] = useState("all");
  const [fBy, setFBy] = useState("all");
  const [q, setQ] = useState("");
  const [fDate, setFDate] = useState("");
  const recorders = useMemo(() => uniqSorted(materialUsages.map((r) => r.recordedByName)), [materialUsages]);

  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const hit = (it) => (fProject === "all" || it.project === fProject)
      && (!needle || `${it.materialName || ""} ${it.materialCode || ""}`.toLowerCase().includes(needle));
    return materialUsages.filter((r) => {
      if (fDate && r.date !== fDate) return false;
      if (fStatus !== "all" && r.status !== fStatus) return false;
      if (fBy !== "all" && r.recordedByName !== fBy) return false;
      if ((fProject !== "all" || needle) && !(r.items || []).some(hit)) return false;
      return true;
    }).sort(byDateDesc);
  }, [materialUsages, fDate, fStatus, fBy, fProject, needle]);
  const lines = list.reduce((a, r) => a + (r.items || []).filter((it) => (fProject === "all" || it.project === fProject)
    && (!needle || `${it.materialName || ""} ${it.materialCode || ""}`.toLowerCase().includes(needle))).length, 0);

  return (
    <>
      <div className="filters">
        <StatusFilter value={fStatus} onChange={setFStatus} />
        <ChoiceFilter value={fProject} onChange={setFProject} all="همهٔ پروژه‌ها" label="پروژه"
          options={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))} />
        <ChoiceFilter value={fBy} onChange={setFBy} all="همهٔ ثبت‌کننده‌ها" label="ثبت‌کننده" options={recorders} />
      </div>
      <div className="filters">
        <input className="filter-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی ماده: نام یا کد…" />
        <DayFilter value={fDate} onChange={setFDate} />
      </div>
      <ReportList list={list} art="materials" summary={lines ? `${faDigits(lines)} قلم ماده` : ""} render={(r) => (
        <MaterialUsageCard key={`m${r.id}`} r={r} session={session} projects={projects} materials={materials}
          onAddFeedback={onAddUsageFeedback} onResubmit={onResubmitUsage} onUpdate={onUpdateUsage} onDelete={onDeleteUsage} />
      )} />
    </>
  );
}

function DriverReportsPane({ session, driverReports, drivers, onAddDriverFeedback, onResubmitDriver, onUpdateDriver, onDeleteDriver }) {
  const [fStatus, setFStatus] = useState("all");
  const [fDriver, setFDriver] = useState("all");
  const [fDate, setFDate] = useState("");
  const names = useMemo(() => uniqSorted(driverReports.map((r) => r.driverName)), [driverReports]);

  const list = useMemo(() => driverReports.filter((r) => {
    if (fDate && r.date !== fDate) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    if (fDriver !== "all" && r.driverName !== fDriver) return false;
    return true;
  }).sort(byDateDesc), [driverReports, fDate, fStatus, fDriver]);
  const km = list.reduce((a, r) => a + (Number(r.distanceKm) || 0), 0);

  return (
    <>
      <div className="filters">
        <StatusFilter value={fStatus} onChange={setFStatus} />
        <ChoiceFilter value={fDriver} onChange={setFDriver} all="همهٔ راننده‌ها" label="راننده" options={names} />
        <DayFilter value={fDate} onChange={setFDate} />
      </div>
      <ReportList list={list} art="driver" summary={km ? `${faDigits(round1(km))} کیلومتر پیمایش` : ""} render={(r) => (
        <DriverReportCard key={`d${r.id}`} r={r} session={session} drivers={drivers}
          onAddFeedback={onAddDriverFeedback} onResubmit={onResubmitDriver} onUpdate={onUpdateDriver} onDelete={onDeleteDriver} />
      )} />
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
  const [shortage, setShortage] = useState(null);   // کمبود انبار مصرفی هنگام تأیید گزارش مصرف
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

  async function submitFeedback(withStatus, force = false) {
    if (busy) return;
    setBusy(true);
    try {
      await onAddFeedback(r.id, { text: comment.trim(), status: withStatus, ...(force ? { force: true } : {}) });
      setComment("");
      setShortage(null);
    } catch (e) {
      if (e.data?.stockShortage && withStatus === "approved") setShortage(e.data.stockShortage);
      else alert(e.message);
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
      {shortage && (
        <UsageShortageDialog data={shortage} busy={busy} onClose={() => setShortage(null)}
          onApprove={() => submitFeedback("approved", true)} />
      )}
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

/** هشدار پیش از تأیید گزارش مصرف: انبار مصرفی این کالاها را به اندازه ندارد. */
function UsageShortageDialog({ data, busy, onClose, onApprove }) {
  const qty = (q, it) => openPackText(q, it.baseUnit, it.altUnit, it.altToBase) || `${fq(q)} ${it.baseUnit || ""}`;
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog short-dialog" role="alertdialog" aria-labelledby="usage-short-title">
        <div className="short-head">
          <span className="short-icon" aria-hidden="true">!</span>
          <div>
            <div className="short-title" id="usage-short-title">موجودی «{data.warehouse}» کم است</div>
            <div className="muted sm2">
              این کالاها به اندازهٔ مصرفِ این گزارش در انبار مصرفی نیستند؛ احتمالاً هنوز از انبار مرکزی
              انتقال داده نشده‌اند. اگر تأیید کنید، موجودی انبار مصرفی منفی می‌شود.
            </div>
          </div>
        </div>
        <div className="tbl-scroll">
          <table className="print-table wh-table short-table">
            <thead><tr><th>کالا</th><th>مصرف این گزارش</th><th>موجودی انبار مصرفی</th><th>انبارهای دیگر</th></tr></thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i}>
                  <td className="wh-name" style={{ whiteSpace: "normal", minWidth: 220 }}><span dir="auto">{it.name}</span></td>
                  <td className="wh-qty">{qty(it.need, it)}</td>
                  <td className="wh-qty low">{qty(it.have, it)}</td>
                  <td>
                    {it.elsewhere.length
                      ? it.elsewhere.map((o) => <div key={o.warehouse}>{o.warehouse}: <b>{qty(o.qty, it)}</b></div>)
                      : <span className="wh-flag haz">در هیچ انباری نیست</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="act warn" disabled={busy} onClick={onApprove}>تأیید با وجود کمبود</button>
        </div>
      </div>
    </div>
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
  // باید اول دوباره بازش کرد. کار عمومی کارگاه جداست و متراژ نمی‌گیرد.
  const activeProjects = projects.filter((p) => p.active !== false && !p.closedAt && !p.general);
  const generalProjects = projects.filter((p) => p.active !== false && p.general);
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
                  <ProjectOptions projects={activeProjects} general={generalProjects} />
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
            {/* شرح برای کارهای عمومی کارگاه تنها چیزی است که می‌گوید آن ساعت صرف چه شده،
                پس باید در ویرایش هم قابل نوشتن باشد، نه فقط در ثبت اولیه. */}
            <label className="fld sm"><span>شرح (اختیاری)</span>
              <input value={it.desc} onChange={(e) => setItem(it.key, "desc", e.target.value)}
                placeholder="جزئیات این آیتم" />
            </label>
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
                  {activeProjects.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
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
