import { useState, useEffect, useCallback } from "react";
import { warehouseApi } from "../../api.js";
import { ItemEditor } from "./itemEditor.jsx";
import { WhyOff, faDigits, jShort } from "../../shared/core.jsx";

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

export function StockReviewPane() {
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
              <WhyOff label="پیش‌نمایش اتصال" busy={busy}
                reasons={[!canLink && (isSite ? "خانوادهٔ انبار انتخاب نشده" : "هیچ بستهٔ سایتی تیک نخورده")]} />
              {preview && (
                <WhyOff label="وصل کن" busy={busy}
                  reasons={[!preview.rows.some((r) => r.items.length) && "در پیش‌نمایش چیزی برای وصل کردن نیست"]} />
              )}
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

export function ConsumableReviewPane() {
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
