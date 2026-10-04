import { useState, useEffect, useRef } from "react";
import { consumablesApi } from "../api.js";
import { JalaliPicker, ProjectOptions, UNITS, USAGE_KINDS, WhyOff, useWorkStages, blankUsageLine, faDigits, hasAccess, todayIso, usageLineFromItem, usageLinePayload, usageLineReady } from "../shared/core.jsx";

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
            <WhyOff busy={busy} reasons={[!draft.name.trim() && "نام ماده نوشته نشده"]} />
          </>
        )}
      </div>
    </div>
  );
}
/** ردیف‌های مصرف — مشترک میان فرم ثبت و ویرایش گزارش. */
export function UsageLines({ rows, setRows, projects }) {
  // پروژهٔ بسته هم مثل غیرفعال، دیگر در فهرست انتخاب نمی‌آید؛ برای ثبت کار رویش
  // باید اول دوباره بازش کرد. کار عمومی کارگاه جداست و متراژ نمی‌گیرد.
  const activeProjects = projects.filter((p) => p.active !== false && !p.closedAt && !p.general);
  const generalProjects = projects.filter((p) => p.active !== false && p.general);
  const [pickingFor, setPickingFor] = useState(null);
  const stageNames = useWorkStages().map((s) => s.name);
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
                    <ProjectOptions projects={activeProjects} general={generalProjects} />
                  </select>
                </label>
                <div className="fld sm"><span>ماده (از انبار)</span>
                  <button type="button" className={r.sku ? "pick-field" : "pick-field empty"}
                    onClick={() => setPickingFor(r.key)}>
                    {r.sku ? <>{r.label}{r.code ? <small> · {r.code}</small> : null}</> : "انتخاب از فهرست انبار…"}
                  </button>
                </div>
              </div>
              <div className="row2">
                <label className="fld sm"><span>نوع</span>
                  <select value={r.kind || "use"} onChange={(e) => setRow(r.key, { kind: e.target.value })}>
                    {USAGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </label>
                <label className="fld sm"><span>مرحلهٔ مصرف</span>
                  <select value={r.stage || ""} onChange={(e) => setRow(r.key, { stage: e.target.value })}>
                    <option value="">— نامشخص —</option>
                    {stageNames.map((s) => <option key={s} value={s}>{s}</option>)}
                    {r.stage && !stageNames.includes(r.stage) && <option value={r.stage}>{r.stage}</option>}
                  </select>
                </label>
              </div>
              {r.kind === "return" && (
                <div className="hint-remaining">این مقدار به انبار مصرفی برمی‌گردد و از هزینهٔ پروژه کم می‌شود.</div>
              )}
              {r.kind === "waste" && (
                <div className="hint-remaining warn">ضایعات از انبار کم می‌شود و در هزینهٔ پروژه می‌ماند؛ علتش را در شرح بنویسید.</div>
              )}
              <div className="row3">
                <label className="fld sm"><span>{r.kind === "return" ? "مقدار برگشتی" : r.kind === "waste" ? "مقدار ضایعات" : "مقدار مصرفی"}</span>
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

export function MaterialsUsageView({ session, projects, materialUsages, onCreateUsage, onUpdateUsage }) {
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
      <WhyOff busy={busy} reasons={valid ? [] : rows.slice(0, 3).map((r, i) => {
        const miss = [!r.project && "پروژه", !r.sku && "ماده", !(Number(r.quantity) > 0) && "مقدار"].filter(Boolean);
        return miss.length ? `ردیف ${faDigits(i + 1)}: ${miss.join("، ")} وارد نشده` : "";
      })} />
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}
