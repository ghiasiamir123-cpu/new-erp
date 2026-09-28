import { useState, useEffect } from "react";
import { projectsApi } from "../api.js";
import { money, rial } from "../payroll.js";
import { Empty, JalaliPicker, faDigits, hasAccess, isoToJ, jShort, round2, todayIso, useCan, useWorkStages } from "../shared/core.jsx";

/* ============ پروژه‌ها ============ */
/** مبلغ قرارداد روی کارت پروژه — فقط برای کسی که دسترسی قیمت‌گذاری دارد. */
function PriceLine({ project, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const v = val.trim() === "" ? null : money(val);
    setBusy(true);
    try { await onSave(v); setEditing(false); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="price-edit">
        <input autoFocus value={val ? rial(money(val)) : ""} inputMode="numeric" placeholder="مبلغ به ریال"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />
        <button className="link-btn" disabled={busy} onClick={save}>{busy ? "…" : "ذخیره"}</button>
        <button className="link-btn" onClick={() => setEditing(false)}>انصراف</button>
      </div>
    );
  }
  return (
    <div className="muted sm2 price-line">
      مبلغ قرارداد:{project.price ? <b>{rial(project.price)} ریال</b> : "ثبت نشده"}
      {editable && (
        <button className="link-btn" onClick={() => { setVal(project.price ? String(project.price) : ""); setEditing(true); }}>
          {project.price ? "ویرایش" : "ثبت مبلغ"}
        </button>
      )}
    </div>
  );
}

export function ProjectsView({ projects, session, onCreate, onToggle, onDelete, onSaveStages, onReopen, onSetGeneral, onSetPrice }) {
  const isManager = hasAccess(session, "projects.manage");
  const canPrice = hasAccess(session, "production.pricing");
  // پروژه از فرم ثبت گزارش هم ساخته می‌شود؛ همان اجازه در سرور.
  const canEditStages = hasAccess(session, "projects.create") || hasAccess(session, "entry.create");
  const [pane, setPane] = useState("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [reopening, setReopening] = useState("");
  const [moving, setMoving] = useState("");

  // کار عمومی کارگاه پروژه نیست؛ جایش در سربرگ «تولید» است، نه اینجا.
  const real = projects.filter((p) => !p.general);
  const openOnes = real.filter((p) => !p.closedAt);
  const closedOnes = real.filter((p) => p.closedAt);
  const shown = pane === "closed" ? closedOnes : openOnes;

  async function reopen(p) {
    if (reopening) return;
    if (!window.confirm(`پروژهٔ «${p.name}» از بایگانی برگردد و دوباره باز شود؟`)) return;
    setReopening(p.id);
    try { await onReopen(p.id); setPane("open"); }
    catch (e) { alert(e.message); } finally { setReopening(""); }
  }

  // از فهرست پروژه‌ها بیرون می‌رود و می‌شود «کار عمومی کارگاه». ساعت‌های ثبت‌شده‌اش
  // دست نمی‌خورد؛ فقط از محاسبات پروژه کنار می‌رود.
  async function toGeneral(p) {
    if (moving) return;
    if (!window.confirm(
      `«${p.name}» از فهرست پروژه‌ها بیرون برود و کارِ عمومی کارگاه شود؟\n\n` +
      "دیگر در متراژ، پیش‌بینی و صف کار نمی‌آید، ولی در فرم ثبت گزارش انتخاب‌شدنی می‌ماند " +
      "و ساعت‌های ثبت‌شده‌اش سر جایش است.\n\n" +
      "از سربرگ «تولید ← کارهای عمومی کارگاه» می‌شود برگرداندش.")) return;
    setMoving(p.id);
    try { await onSetGeneral(p.id, true); }
    catch (e) { alert(e.message); } finally { setMoving(""); }
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
        <button className="submit" style={{ marginBottom: 14 }} onClick={() => setCreating(true)}>
          + پروژهٔ جدید
        </button>
      )}
      {creating && <NewProjectDialog projects={projects} onClose={() => setCreating(false)}
        onCreate={onCreate} onDone={() => { setCreating(false); setPane("open"); }} />}
      {shown.length === 0 ? (
        <Empty art="projects">
          {pane === "closed" ? "هنوز پروژهٔ بسته‌شده‌ای نیست." : "پروژهٔ بازی نیست."}
        </Empty>
      ) : shown.map((p) => {
        const stages = p.stages || [];
        const done = stages.filter((s) => s.done).length;
        const isClosed = Boolean(p.closedAt);
        // پروژهٔ بسته کارش تمام است، پس نوارش پر نشان داده می‌شود؛ ولی عددهای واقعی
        // و دلیلِ بستن زیرش می‌مانند تا چیزی پنهان نشود.
        // پیشرفت از گزارش‌های کارِ تأییدشده می‌آید — همان عدد صفحهٔ تولید. تیکِ دستی مراحل
        // فقط وقتی به کار می‌آید که سرور پیشرفتی نفرستاده باشد.
        const prog = p.progress;
        const pct = isClosed ? 100
          : prog ? Math.round(Math.min(prog.percent || 0, 100))
          : (stages.length ? Math.round(done / stages.length * 100) : 0);
        return (
          <div className={isClosed ? "card closed" : "card"} key={p.id}>
            <div className="proj" style={{ padding: 0 }}>
              <div>
                <b>{p.name}</b>{p.code ? <span className="proj-code">{p.code}</span> : null}
                {isClosed && <span className="pill done" style={{ marginInlineStart: 8 }}>بایگانی</span>}
                {p.ownerName && <div className="muted sm2">مالک: {p.ownerName}</div>}
                {canPrice && (
                  <PriceLine project={p} editable={isManager} onSave={(v) => onSetPrice(p.id, v)} />
                )}
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
                  <button className="toggle" disabled={moving === p.id} onClick={() => toGeneral(p)}
                    title="از فهرست پروژه‌ها بیرون می‌رود و در محاسبات پروژه نمی‌آید">
                    {moving === p.id ? "…" : "کار عمومی"}
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

            {(stages.length > 0 || isClosed || (prog && prog.done > 0)) && (
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
                    : prog
                      ? <>
                          {prog.baseArea > 0
                            ? <>{faDigits(round2(prog.baseDone))} از {faDigits(round2(prog.baseArea))} م² چوب از خط گذشته · {faDigits(round2(prog.baseRemaining))} م² مانده</>
                            : <>{faDigits(round2(prog.done))} از {faDigits(round2(prog.planned))} م² کار انجام شده</>}
                          {prog.pending > 0 && <> · <span className="warn-txt">{faDigits(round2(prog.pending))} م² منتظر تأیید</span></>}
                        </>
                      : <>{faDigits(done)} از {faDigits(stages.length)} مرحله انجام شده · متراژ کل: {faDigits(p.totalArea || 0)} م²</>}
                </div>
                {!isClosed && prog && prog.stages.length > 0 && (
                  <div className="stage-prog">
                    {prog.stages.map((st) => (
                      <div className="bar-row sm" key={st.name} title={`${round2(st.done)} از ${round2(st.planned)} م²`}>
                        <span className="bar-lbl">{st.name}</span>
                        <div className={st.over ? "bar over" : "bar"}><div style={{ width: Math.min(st.percent, 100) + "%" }} /></div>
                        <span className="bar-v">{faDigits(Math.round(st.percent))}٪</span>
                      </div>
                    ))}
                  </div>
                )}
                {!isClosed && prog && prog.issues.length > 0 && (
                  <div className="warn-txt sm2" style={{ marginTop: 4 }}>⚠ {prog.issues.join(" · ")}</div>
                )}
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
                onSave={(list, baseArea) => onSaveStages(p.id, list, baseArea)}
                onClose={() => setOpenId(null)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
/** ساخت پروژه: مشخصات، متراژ چوب و مراحل — همه در یک جا، پیش از ذخیره. */
function NewProjectDialog({ projects, onCreate, onClose, onDone }) {
  const can = useCan();
  const stageList = useWorkStages();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [price, setPrice] = useState("");
  const [code, setCode] = useState("");
  const [codeAuto, setCodeAuto] = useState(true);
  const [startDate, setStartDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [general, setGeneral] = useState(false);
  const [noArea, setNoArea] = useState(false);
  const [base, setBase] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const jyear = isoToJ(startDate || todayIso()).jy;

  // کد پیشنهادی از سرور می‌آید تا با پروژه‌های موجود تصادم نکند.
  useEffect(() => {
    if (!codeAuto) return undefined;
    let alive = true;
    projectsApi.nextCode(jyear)
      .then((d) => { if (alive) setCode(d.code); })
      .catch(() => { /* اگر نیامد، کاربر خودش می‌نویسد */ });
    return () => { alive = false; };
  }, [jyear, codeAuto]);

  // مراحل پیش‌فرض: همه تیک‌خورده با ضریب خودشان، چون خط تولید ثابت است.
  useEffect(() => {
    setRows((prev) => stageList.filter((s) => s.needsArea !== false).map((s) => {
      const kept = prev.find((r) => r.name === s.name);
      return kept || { name: s.name, on: true, coef: String(s.coefficient ?? 1), area: "" };
    }));
  }, [stageList]);

  function applyBase(next) {
    setBase(next);
    const b = Number(next);
    if (!(b > 0)) return;
    setRows((p) => p.map((r) => (r.on
      ? { ...r, area: String(round2(b * (Number(r.coef) || 1))) } : r)));
  }
  const setRow = (n, patch) => setRows((p) => p.map((r) => (r.name === n ? { ...r, ...patch } : r)));
  function setCoef(n, coef) {
    const b = Number(base);
    setRow(n, { coef, area: b > 0 ? String(round2(b * (Number(coef) || 1))) : undefined });
  }

  const picked = rows.filter((r) => r.on);
  const totalWork = picked.reduce((a, r) => a + (Number(r.area) || 0), 0);
  const needsStages = !general && !noArea;
  const missing = needsStages ? picked.filter((r) => !(Number(r.area) > 0)) : [];
  const canSave = name.trim() && !busy && !missing.length
    && (!needsStages || (Number(base) > 0 && picked.length));

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr("");
    try {
      const body = { name: name.trim(), code: code.trim(), ownerName: owner.trim(), active: true, general,
          jyear, startDate: general ? null : (startDate || null),
          dueDate: general ? null : (dueDate || null),
          noArea: general ? true : noArea };
      // مبلغ فقط برای کسی که کلید دارد فرستاده می‌شود؛ سرور هم بی کلید ردش می‌کند.
      if (!general && can("production.pricing") && money(price) > 0) body.price = money(price);
      await onCreate(body,
        needsStages ? picked.map((r) => ({ name: r.name, area: Number(r.area) || 0,
          coefficient: Number(r.coef) || 1 })) : null,
        needsStages ? Number(base) : null);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog wide">
        <div className="board-h">{general ? "کار عمومی جدید" : "پروژهٔ جدید"}</div>

        <div className="row2">
          <label className="fld"><span>{general ? "نام کار" : "نام پروژه"}</span>
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              placeholder={general ? "مثلاً: نظافت کارگاه" : "مثلاً: کابینت آشپزخانه"} /></label>
          {!general && (
            <label className="fld"><span>نام مالک / مشتری</span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)}
                placeholder="مثلاً: آقای یزدانی" /></label>
          )}
        </div>

        {!general && (
          <>
            <div className="row2">
              <label className="fld"><span>کد پروژه</span>
                <input value={code} onChange={(e) => { setCode(e.target.value); setCodeAuto(false); }}
                  placeholder="خودکار" /></label>
              <div className="fld"><span>&nbsp;</span>
                <label className="chk-line" style={{ margin: 0 }}>
                  <input type="checkbox" checked={codeAuto}
                    onChange={(e) => setCodeAuto(e.target.checked)} />
                  <span>کد خودکار ({faDigits(jyear)})</span>
                </label>
              </div>
            </div>
            <div className="row2">
              <div className="fld"><span>تاریخ شروع</span>
                <JalaliPicker value={startDate} onChange={setStartDate} /></div>
              <div className="fld"><span>تاریخ تحویل</span>
                <JalaliPicker value={dueDate} onChange={setDueDate} placeholder="هنوز معلوم نیست" /></div>
            </div>
            {can("production.pricing") && (
              <label className="fld"><span>مبلغ قرارداد (ریال) — اختیاری</span>
                <input value={price ? rial(money(price)) : ""} inputMode="numeric"
                  onChange={(e) => setPrice(e.target.value)} placeholder="بعداً هم می‌شود وارد کرد" />
              </label>
            )}
          </>
        )}

        <label className="chk-line">
          <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
          <span>کار عمومی کارگاه است، نه پروژه</span>
        </label>
        {general ? (
          <div className="muted sm2" style={{ marginBottom: 8 }}>
            در فهرست پروژه‌ها نمی‌آید و در هیچ محاسبهٔ پروژه‌ای شرکت نمی‌کند. فقط در فرم
            ثبت گزارش انتخاب‌شدنی است. یک مورد کافی است — شرحِ هر ردیف می‌گوید چه شده.
          </div>
        ) : (
          <label className="chk-line">
            <input type="checkbox" checked={noArea} onChange={(e) => setNoArea(e.target.checked)} />
            <span>پروژهٔ خدماتی است و متراژ ندارد</span>
          </label>
        )}

        {needsStages && (
          <>
            <label className="fld"><span>متراژ چوب (م²)</span>
              <input type="number" inputMode="decimal" value={base}
                className={!(Number(base) > 0) ? "need" : ""}
                onChange={(e) => applyBase(e.target.value)} placeholder="مثلاً ۴۰" />
            </label>
            <div className="items-hd">مراحل کار و ضریب‌ها</div>
            <div className="muted sm2" style={{ marginBottom: 8 }}>
              متراژ هر مرحله از «متراژ چوب × ضریب» می‌آید. مرحله‌ای که این پروژه ندارد را
              تیکش را بردارید، و هر ضریبی را که فرق می‌کند همین‌جا عوض کنید.
            </div>
            <div className="stage-box" style={{ maxHeight: 260, overflowY: "auto" }}>
              {rows.map((r) => (
                <div className={r.on ? "stage-row on" : "stage-row"} key={r.name}>
                  <label className="stage-pick">
                    <input type="checkbox" checked={r.on}
                      onChange={(e) => setRow(r.name, { on: e.target.checked })} />
                    <span>{r.name}</span>
                  </label>
                  {r.on && (
                    <div className="stage-fields">
                      <label className="fld sm" style={{ maxWidth: 80 }}><span>ضریب</span>
                        <input type="number" step="0.25" inputMode="decimal" value={r.coef}
                          onChange={(e) => setCoef(r.name, e.target.value)} /></label>
                      <label className="fld sm"><span>متراژ کار</span>
                        <input type="number" inputMode="decimal" value={r.area}
                          className={!(Number(r.area) > 0) ? "need" : ""}
                          onChange={(e) => setRow(r.name, { area: e.target.value })} /></label>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="stage-total">
              {faDigits(picked.length)} مرحله · متراژ چوب {faDigits(round2(Number(base) || 0))} م²
              {" · "}مجموع کار {faDigits(round2(totalWork))} م²
              {Number(base) > 0 && totalWork > 0 && (
                <> (هر متر چوب {faDigits(round2(totalWork / Number(base)))} متر کار)</>
              )}
            </div>
            {missing.length > 0 && (
              <div className="notice warn">
                متراژ این مرحله‌ها وارد نشده: {missing.map((r) => r.name).join("، ")}
              </div>
            )}
          </>
        )}

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={!canSave} onClick={save}>
            {busy ? "…" : general ? "افزودن کار عمومی" : "ساختن پروژه"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectStagesEditor({ project, readOnly, onSave, onClose }) {
  const existing = project.stages || [];
  const stageList = useWorkStages();
  const [rows, setRows] = useState([]);
  const [base, setBase] = useState(String(project.baseArea ?? ""));
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
        coef: String(cur?.coefficient ?? s.coefficient ?? 1),
        area: cur ? String(cur.area ?? "") : "", done: cur ? !!cur.done : false,
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageList, project.id]);

  // متراژ چوب که عوض شود، متراژ هر مرحله از روی ضریبش دوباره ساخته می‌شود.
  function applyBase(next) {
    setBase(next);
    const b = Number(next);
    if (!(b > 0)) return;
    setRows((p) => p.map((r) => (r.on && r.needsArea
      ? { ...r, area: String(round2(b * (Number(r.coef) || 1))) } : r)));
  }
  function setCoef(name, coef) {
    const b = Number(base);
    setRows((p) => p.map((r) => (r.name === name
      ? { ...r, coef, area: b > 0 && r.needsArea ? String(round2(b * (Number(coef) || 1))) : r.area }
      : r)));
  }

  const setRow = (name, patch) => setRows((p) => p.map((r) => (r.name === name ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.on);
  const totalArea = selected.reduce((a, r) => a + (Number(r.area) || 0), 0);
  // سرور هم همین را می‌گیرد؛ اینجا می‌گوییم تا کاربر پیش از ذخیره ببیند.
  const missing = selected.filter((r) => r.needsArea && !(Number(r.area) > 0));

  async function save() {
    if (busy || missing.length) return;
    setBusy(true); setMsg("");
    try {
      await onSave(selected.map((r) => ({
        name: r.name, area: Number(r.area) || 0,
        coefficient: Number(r.coef) || 1, done: r.done,
      })), Number(base) > 0 ? Number(base) : null);
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
      <label className="fld" style={{ marginBottom: 10 }}>
        <span>متراژ چوب این پروژه (م²)</span>
        <input type="number" inputMode="decimal" value={base} disabled={readOnly}
          onChange={(e) => applyBase(e.target.value)} placeholder="مثلاً ۴۰" />
      </label>
      <div className="muted sm2" style={{ marginBottom: 8 }}>
        مراحلی که این پروژه دارد را تیک بزنید. متراژ هر مرحله از <b>متراژ چوب × ضریب</b>
        {" "}حساب می‌شود — چون روی یک متر چوب چند دست کار انجام می‌شود. هر عددی را
        می‌توانید دستی هم عوض کنید.
      </div>
      {rows.map((r) => (
        <div className={r.on ? "stage-row on" : "stage-row"} key={r.name}>
          <label className="stage-pick">
            <input type="checkbox" disabled={readOnly} checked={r.on}
              onChange={(e) => {
                const on = e.target.checked;
                const b = Number(base);
                // تیک که می‌خورد، متراژش از متراژ چوب × ضریب پر می‌شود.
                setRow(r.name, on && b > 0 && r.needsArea && !(Number(r.area) > 0)
                  ? { on, area: String(round2(b * (Number(r.coef) || 1))) } : { on });
              }} />
            <span>{r.name}</span>
          </label>
          {r.on && (
            <div className="stage-fields">
              {r.needsArea ? (
                <>
                  <label className="fld sm" style={{ maxWidth: 90 }}>
                    <span>ضریب</span>
                    <input type="number" step="0.25" inputMode="decimal" disabled={readOnly}
                      value={r.coef} onChange={(e) => setCoef(r.name, e.target.value)} />
                  </label>
                  <label className="fld sm">
                    <span>متراژ کار (م²)</span>
                    <input type="number" inputMode="decimal" disabled={readOnly} value={r.area}
                      className={!(Number(r.area) > 0) ? "need" : ""}
                      onChange={(e) => setRow(r.name, { area: e.target.value })} placeholder="لازم است" />
                  </label>
                </>
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
        {faDigits(selected.length)} مرحله · متراژ چوب {faDigits(round2(Number(base) || 0))} م²
        {" · "}مجموع کار {faDigits(round2(totalArea))} م²
        {Number(base) > 0 && totalArea > 0 && (
          <> (هر متر چوب {faDigits(round2(totalArea / Number(base)))} متر کار)</>
        )}
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
