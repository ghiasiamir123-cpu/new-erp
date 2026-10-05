import { useState, useEffect, useCallback } from "react";
import { financeReportsApi } from "../api.js";
import { Empty, JalaliPicker, faDigits, faRial, jShort, saveSheet, todayIso, useCan } from "../shared/core.jsx";
import { CoatingAllProjectsDoc, CoatingProjectDoc, CoatingSummaryDoc } from "./coatingProfitDocs.jsx";

/* ============ گردش مالی مرکز پوشش (سود مرکز پوشش) ============
   قیمت تمام‌شدهٔ هر پروژه = دستمزد (ساعت گزارش کار تأییدشده × نرخ هر کارگر) + متریال (مصرف مواد تأییدشده ×
   قیمت تمام‌شدهٔ کالا). سود = دریافتی از کارفرما − قیمت تمام‌شده. محاسبه در backend/core/coating_profit.py. */

const rial = (n) => (n == null ? "—" : faRial(n));
const STATE = { active: "در جریان", closed: "بسته", inactive: "غیرفعال" };
const RATE_SOURCE = { own: "نرخ خودش", average: "میانگین کارگاه", none: "بی‌نرخ" };

function Money({ n, strong }) {
  const v = n == null ? "—" : faRial(n);
  const neg = n != null && n < 0;
  const style = neg ? { color: "#B02A2A" } : undefined;
  return strong ? <b style={style}>{v}</b> : <span style={style}>{v}</span>;
}

export function CoatingProfitReport() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [state, setState] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");
  // برگهٔ چاپیِ باز: {kind: "summary"} گزارش کلی، {kind: "all"} همهٔ پروژه‌ها با جزئیات، {kind: "project", id, project} یک پروژه
  const [doc, setDoc] = useState(null);
  const canFix = useCan()("financereports.costs");

  const load = useCallback(async () => {
    try { setD(await financeReportsApi.coatingProfit()); setErr(""); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err && !d) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">در حال محاسبهٔ قیمت تمام‌شدهٔ پروژه‌ها…</div>;

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = d.projects
    .filter((p) => state === "all" || p.state === state)
    .filter((p) => words.every((w) => `${p.label} ${p.name} ${p.owner}`.toLowerCase().includes(w)));
  const sum = (k) => list.reduce((a, p) => a + (p[k] || 0), 0);
  const withReceipts = list.filter((p) => p.received);
  const profit = withReceipts.reduce((a, p) => a + p.profit, 0);
  const issueCount = d.issues.labour.length + d.issues.material.length;

  function exportSheet() {
    saveSheet("گردش-مالی-مرکز-پوشش", "گردش مالی مرکز پوشش", [
      ["پروژه", "کارفرما", "وضعیت", "متراژ چوب", "ساعت کار", "دستمزد", "متریال", "قیمت تمام‌شده", "هر متر",
        "فروش", "مبنای فروش", "فاکتور صادرشده", "پیش‌فاکتور", "مبلغ قرارداد", "دریافتی", "مانده طلب", "سود بر دریافتی", "سود فروش", "حاشیه ٪", "ایراد قیمت"],
      ...list.map((p) => [p.label, p.owner, STATE[p.state], p.area, p.hours, p.labour, p.material, p.cost, p.perM2,
        p.sale, p.saleLabel, p.invoiced || "", p.quoted || "", p.contract, p.received, p.receivable, p.profit, p.contractProfit, p.margin,
        p.complete ? "" : "ناقص"]),
    ]);
  }

  return (
    <>
      <div className="card">
        <div className="items-hd">گردش مالی مرکز پوشش — قیمت تمام‌شده و سود هر پروژه</div>
        <div className="muted sm2" style={{ lineHeight: 2 }}>
          <b>دستمزد</b>: ساعت گزارش‌های کار تأییدشده × نرخ هر ساعتِ همان کارگر (کارگر بی‌نرخ با میانگین کارگاه
          {d.labourRate ? ` — ${faRial(d.labourRate)} ریال` : "، که هنوز وارد نشده"}).{" "}
          <b>متریال</b>: مصرف مواد تأییدشده × قیمت تمام‌شدهٔ کالا (قیمت لیست).{" "}
          <b>سود</b> = دریافتی از کارفرما − قیمت تمام‌شده. ردیفی که قیمت یا نرخ ندارد در هزینه نیامده و پایین‌تر
          فهرست شده تا اصلاح شود؛ تا آن‌ها اصلاح نشوند قیمت تمام‌شده کمتر از واقع است.
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{faRial(sum("cost"))}</b><span>قیمت تمام‌شده (ریال)<br />دستمزد {faRial(sum("labour"))} · متریال {faRial(sum("material"))}</span></div>
        <div className="stat"><b>{faRial(sum("received"))}</b><span>دریافتی از کارفرما<br />از {faDigits(withReceipts.length)} پروژه</span></div>
        <div className={profit < 0 ? "stat warn" : "stat"}><b><Money n={profit} /></b><span>سود پروژه‌های دارای دریافتی<br />دریافتی − قیمت تمام‌شدهٔ همان پروژه‌ها</span></div>
        <div className="stat"><b>{faRial(sum("sale"))}</b><span>جمع فروش (فاکتور، پیش‌فاکتور یا قرارداد)<br />مانده طلب {faRial(list.reduce((a, p) => a + Math.max(0, p.receivable || 0), 0))}</span></div>
        <div className={issueCount ? "stat warn" : "stat"}><b>{faDigits(issueCount)}</b><span>ایراد نرخ و قیمت<br />{issueCount ? "پایین صفحه اصلاح کنید" : "همه قیمت دارند ✓"}</span></div>
      </div>

      {issueCount > 0 && <PriceIssues issues={d.issues} canFix={canFix} onFixed={load} />}

      <div className="card">
        <div className="items-hd">پروژه‌ها</div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <div className="seg-row" style={{ margin: 0 }}>
            {[["all", "همه"], ["active", "در جریان"], ["closed", "بسته"]].map(([k, l]) => (
              <button key={k} className={state === k ? "seg on" : "seg"} onClick={() => setState(k)}>{l}</button>
            ))}
          </div>
          <input style={{ flex: "1 1 180px", maxWidth: 280 }} placeholder="جستجوی پروژه یا کارفرما" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 14px" }} onClick={exportSheet} disabled={!list.length}>خروجی اکسل</button>
          <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 14px" }} disabled={!list.length}
            title="یک جدول از همهٔ پروژه‌های همین فهرست، با جمع" onClick={() => setDoc({ kind: "summary" })}>PDF گزارش کلی</button>
          <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 14px" }} disabled={!list.length}
            title="برگهٔ کاملِ هر پروژهٔ همین فهرست، هر کدام در صفحهٔ خودش" onClick={() => setDoc({ kind: "all" })}>PDF همهٔ پروژه‌ها با جزئیات</button>
        </div>
        {list.length === 0 ? <Empty art="finance">پروژه‌ای با هزینه یا دریافتی پیدا نشد.</Empty> : (
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>پروژه</th><th>ساعت</th><th>دستمزد</th><th>متریال</th><th>قیمت تمام‌شده</th><th>هر متر</th>
                <th>فروش</th><th>دریافتی</th><th>سود</th><th>وضعیت قیمت</th><th></th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="nm">{p.label}<div className="muted sm2">{[p.owner, STATE[p.state]].filter(Boolean).join(" · ")}</div></td>
                    <td>{faDigits(p.hours)}</td>
                    <td>{rial(p.labour)}</td><td>{rial(p.material)}</td><td><b>{rial(p.cost)}</b></td>
                    <td>{rial(p.perM2)}</td>
                    <td>{rial(p.sale)}{p.saleLabel && <div className={p.saleSource === "invoice" ? "sm2 ok-txt" : "muted sm2"}>{p.saleLabel}</div>}</td>
                    <td>{rial(p.received || null)}</td>
                    <td><Money n={p.profit} strong />{p.profit == null && p.contractProfit != null && (
                      <div className="muted sm2">سود فروش: <Money n={p.contractProfit} /></div>)}</td>
                    <td>
                      {p.complete
                        ? <span className="pill ok">کامل</span>
                        : <span className="pill bad">{faDigits(p.issues.labourMissing + p.issues.material)} ایراد</span>}
                      {(p.issues.pendingWork > 0 || p.issues.pendingUsage > 0) && (
                        <div className="muted sm2">{faDigits(p.issues.pendingWork + p.issues.pendingUsage)} گزارش تأییدنشده</div>)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => setOpenId(p.id)}>جزئیات</button>{" "}
                      <button className="ghost" style={{ padding: "4px 10px" }} title="گزارش چاپیِ همین پروژه"
                        onClick={() => setDoc({ kind: "project", id: p.id })}>PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && <ProjectCostDialog id={openId} canFix={canFix} onClose={() => setOpenId("")} onChanged={load}
        onPdf={(project) => { setOpenId(""); setDoc({ kind: "project", id: project.id, project }); }} />}
      {doc?.kind === "summary" && (
        <CoatingSummaryDoc list={list} issueCount={issueCount} onClose={() => setDoc(null)}
          filter={[{ all: "همهٔ پروژه‌ها", active: "پروژه‌های در جریان", closed: "پروژه‌های بسته" }[state], q.trim() && `جستجو: «${q.trim()}»`].filter(Boolean).join(" · ")} />
      )}
      {doc?.kind === "all" && <CoatingAllProjectsDoc ids={list.map((p) => p.id)} onClose={() => setDoc(null)} />}
      {doc?.kind === "project" && <CoatingProjectDoc id={doc.id} project={doc.project} onClose={() => setDoc(null)} />}
    </>
  );
}

/* ---- ایرادهای نرخ و قیمت، با اصلاح در همان ردیف ---- */
function PriceIssues({ issues, canFix, onFixed }) {
  return (
    <div className="card">
      <div className="items-hd">ایرادهای نرخ و قیمت — این‌ها را اصلاح کنید</div>
      {!canFix && <div className="muted sm2" style={{ marginBottom: 6 }}>برای اصلاح، دسترسی «گردش مالی مرکز پوشش: اصلاح نرخ و قیمت» لازم است.</div>}
      {issues.labour.length > 0 && (
        <>
          <div className="muted sm2" style={{ margin: "6px 0" }}>کارگرهایی که نرخ هر ساعت ندارند</div>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>کارگر</th><th>ساعت روی پروژه‌ها</th><th>پروژه</th><th>حساب‌شده با</th><th>نرخ هر ساعت (ریال)</th></tr></thead>
              <tbody>
                {issues.labour.map((r) => (
                  <tr key={r.name}>
                    <td className="nm">{r.name}</td><td>{faDigits(r.hours)}</td><td>{faDigits(r.projects)}</td>
                    <td><span className={r.severity === "none" ? "pill bad" : "pill run"}>{r.severity === "none" ? "بی‌هزینه" : "میانگین کارگاه"}</span></td>
                    <td>{canFix ? <FixRate row={r} onFixed={onFixed} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {issues.material.length > 0 && (
        <>
          <div className="muted sm2" style={{ margin: "10px 0 6px" }}>متریالی که در هزینه نیامده</div>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>کالا</th><th>مصرف</th><th>پروژه</th><th>ایراد</th><th>اصلاح</th></tr></thead>
              <tbody>
                {issues.material.map((r) => (
                  <tr key={`${r.skuId || r.name}-${r.unit}`}>
                    <td className="nm">{r.name}{r.code ? <div className="muted sm2">{r.code}</div> : null}</td>
                    <td>{faDigits(r.qty)} {r.unit}</td><td>{faDigits(r.projects)}</td>
                    <td><span className="pill bad">{r.reasonLabel}</span></td>
                    <td>{canFix ? <FixMaterial row={r} onFixed={onFixed} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function useSave(onFixed) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn) => {
    setBusy(true); setErr("");
    try { await fn(); await onFixed(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return { busy, err, run };
}

function FixRate({ row, onFixed }) {
  const [v, setV] = useState("");
  const { busy, err, run } = useSave(onFixed);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input className="wh-cell wide" type="number" min="0" placeholder="ریال" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="ghost" style={{ padding: "4px 10px" }} disabled={busy || !(Number(v) > 0)}
        onClick={() => run(() => financeReportsApi.coatingRate({ employee: row.employeeId, name: row.name, hourlyCost: v }))}>ثبت</button>
      {err && <span className="err">{err}</span>}
    </div>
  );
}

function FixMaterial({ row, onFixed }) {
  const [v, setV] = useState("");
  const { busy, err, run } = useSave(onFixed);
  if (row.reason === "no_sku") {
    return <span className="muted sm2">در «مصرف مواد» کالای انبارِ این ردیف را انتخاب کنید.</span>;
  }
  if (row.reason === "no_unit") {
    if (row.altUnit && row.altUnit !== row.unit) {
      return <span className="muted sm2">واحد ردیف‌ها را در «مصرف مواد» به «{row.baseUnit}» یا «{row.altUnit}» اصلاح کنید.</span>;
    }
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className="sm2">هر ۱ {row.baseUnit || "واحد اصلی"} =</span>
        <input className="wh-cell" type="number" min="0" value={v} onChange={(e) => setV(e.target.value)} />
        <span className="sm2">{row.unit}</span>
        <button className="ghost" style={{ padding: "4px 10px" }} disabled={busy || !(Number(v) > 0)}
          onClick={() => run(() => financeReportsApi.coatingUnit({ sku: row.skuId, unit: row.unit, perBase: v }))}>ثبت</button>
        {err && <span className="err">{err}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input className="wh-cell wide" type="number" min="0" placeholder="ریال" value={v} onChange={(e) => setV(e.target.value)} />
      <span className="sm2">برای هر {row.baseUnit || "واحد"}</span>
      <button className="ghost" style={{ padding: "4px 10px" }} disabled={busy || !(Number(v) > 1)}
        onClick={() => run(() => financeReportsApi.coatingPrice({ sku: row.skuId, costPrice: v }))}>ثبت</button>
      {err && <span className="err">{err}</span>}
    </div>
  );
}

/* ---- جزئیات یک پروژه: دستمزد، متریال، دریافتی‌ها ---- */
function ProjectCostDialog({ id, canFix, onClose, onChanged, onPdf }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [contract, setContract] = useState("");
  const [rc, setRc] = useState({ date: todayIso(), amount: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const x = await financeReportsApi.coatingProfit(id);
      setD(x); setErr(""); setContract(x.project.contract ? String(x.project.contract) : "");
    } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { await load(); onChanged(); };

  async function act(fn) {
    setBusy(true); setErr("");
    try { await fn(); await refresh(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const p = d?.project;
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide fin-dialog">
        {!p ? (<>{err ? <div className="notice warn">{err}</div> : <div className="empty">در حال محاسبه…</div>}
          <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div></>) : (
          <>
            <div className="board-h">قیمت تمام‌شدهٔ {p.label}</div>
            <div className="fin-head">
              <div><span>کارفرما</span><b>{p.owner || "—"}</b></div>
              <div><span>متراژ چوب</span><b>{p.area ? faDigits(p.area) : "—"}</b></div>
              <div><span>دستمزد</span><b>{rial(p.labour)}</b></div>
              <div><span>متریال</span><b>{rial(p.material)}</b></div>
              <div><span>قیمت تمام‌شده</span><b>{rial(p.cost)}</b></div>
              <div><span>هر متر چوب</span><b>{rial(p.perM2)}</b></div>
              <div><span>دریافتی</span><b>{rial(p.received)}</b></div>
              <div><span>سود بر دریافتی</span><b><Money n={p.profit} /></b></div>
              <div><span>فروش ({p.saleLabel || "نامعلوم"})</span><b>{rial(p.sale)}</b></div>
              <div><span>سود فروش</span><b><Money n={p.contractProfit} />{p.margin != null ? ` (${faDigits(p.margin)}٪)` : ""}</b></div>
            </div>
            {!p.complete && <div className="notice warn">بعضی ردیف‌ها نرخ یا قیمت ندارند و در هزینه نیامده‌اند؛ قیمت تمام‌شده کمتر از واقع است. از جدول «ایرادهای نرخ و قیمت» اصلاح کنید.</div>}
            {(p.issues.pendingWork > 0 || p.issues.pendingUsage > 0) && (
              <div className="notice">
                {p.issues.pendingWork > 0 && `${faDigits(p.issues.pendingWork)} گزارش کار `}
                {p.issues.pendingUsage > 0 && `${faDigits(p.issues.pendingUsage)} گزارش مصرف مواد `}
                هنوز تأیید نشده و در هزینه نیامده.
              </div>
            )}

            <div className="items-hd">دستمزد — {faDigits(p.hours)} ساعت</div>
            {p.labourRows.length === 0 ? <div className="empty">ساعت کار تأییدشده‌ای ندارد.</div> : (
              <div className="tbl-scroll">
                <table className="print-table">
                  <thead><tr><th>کارگر</th><th>فعالیت‌ها</th><th>ساعت</th><th>نرخ هر ساعت</th><th>دستمزد</th></tr></thead>
                  <tbody>
                    {p.labourRows.map((r) => (
                      <tr key={r.name}>
                        <td className="nm">{r.name}</td>
                        <td className="sm2">{r.activities.map((a) => `${a.activity} ${faDigits(a.hours)}`).join(" · ")}</td>
                        <td>{faDigits(r.hours)}</td>
                        <td>{r.rate ? faRial(r.rate) : "—"} <span className={r.rateSource === "own" ? "pill ok" : r.rateSource === "average" ? "pill run" : "pill bad"}>{RATE_SOURCE[r.rateSource]}</span></td>
                        <td><b>{rial(r.cost)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="items-hd">متریال مصرفی</div>
            {p.materialRows.length === 0 ? <div className="empty">مصرف مواد تأییدشده‌ای ندارد.</div> : (
              <div className="tbl-scroll">
                <table className="print-table">
                  <thead><tr><th>کالا</th><th>مصرف</th><th>به واحد اصلی</th><th>قیمت هر واحد اصلی</th><th>هزینه</th></tr></thead>
                  <tbody>
                    {p.materialRows.map((r) => (
                      <tr key={`${r.skuId || r.name}-${r.unit}`} className={r.reason ? "fin-mismatch" : ""}>
                        <td className="nm">{r.name}{r.code ? <div className="muted sm2">{r.code}</div> : null}</td>
                        <td>{faDigits(r.qty)} {r.unit}</td>
                        <td>{r.reason === "no_unit" || r.reason === "no_sku" ? "—" : `${faDigits(r.baseQty)} ${r.baseUnit}`}</td>
                        <td>{rial(r.unitCost)}</td>
                        <td>{r.reason ? <span className="pill bad">{r.reasonLabel}</span> : <b>{rial(r.cost)}</b>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="items-hd">فروش و دریافتی از کارفرما</div>
            <div className="muted sm2" style={{ margin: "-2px 0 8px", lineHeight: 1.9 }}>
              مبلغ فروش از «فاکتور فروش» می‌آید: فاکتورهای صادرشده {rial(p.invoiced)} ({faDigits(p.invoices)} سند) و پیش‌فاکتورهایی که هنوز فاکتور نشده‌اند {rial(p.quoted)} ({faDigits(p.proformas)} سند).
              مبلغ قراردادِ پایین فقط وقتی مبناست که پروژه هیچ فاکتور و پیش‌فاکتوری نداشته باشد.
            </div>
            <div className="row2">
              <label className="fld sm"><span>مبلغ قرارداد (ریال)</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" min="0" disabled={!canFix} value={contract} onChange={(e) => setContract(e.target.value)} />
                  {canFix && <button className="ghost" style={{ flex: "0 0 auto", padding: "6px 12px" }}
                    disabled={busy || contract === (p.contract ? String(p.contract) : "")}
                    onClick={() => act(() => financeReportsApi.coatingContract({ project: p.id, price: contract }))}>ثبت</button>}
                </div>
              </label>
              <div className="fld sm"><span>مانده طلب از کارفرما</span><input disabled value={p.receivable == null ? "—" : faRial(p.receivable)} /></div>
            </div>
            {p.receipts.length > 0 && (
              <div className="tbl-scroll">
                <table className="print-table">
                  <thead><tr><th>تاریخ</th><th>مبلغ (ریال)</th><th>توضیح</th><th>ثبت‌کننده</th><th></th></tr></thead>
                  <tbody>
                    {p.receipts.map((r) => (
                      <tr key={r.id}>
                        <td>{jShort(r.date)}</td><td><b>{faRial(r.amount)}</b></td><td className="nm">{r.note || "—"}</td><td>{r.by || "—"}</td>
                        <td>{canFix && <button className="ghost" style={{ padding: "4px 10px" }} disabled={busy}
                          onClick={() => window.confirm("این دریافتی حذف شود؟") && act(() => financeReportsApi.removeReceipt(r.id))}>حذف</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canFix && (
              <div className="row3" style={{ alignItems: "end" }}>
                <div className="fld sm"><span>تاریخ دریافت</span>
                  <JalaliPicker value={rc.date} onChange={(x) => setRc({ ...rc, date: x })} /></div>
                <label className="fld sm"><span>مبلغ (ریال)</span>
                  <input type="number" min="0" value={rc.amount} onChange={(e) => setRc({ ...rc, amount: e.target.value })} /></label>
                <label className="fld sm"><span>توضیح (نقد، چک، شمارهٔ پیگیری…)</span>
                  <input value={rc.note} onChange={(e) => setRc({ ...rc, note: e.target.value })} /></label>
              </div>
            )}
            {err && <div className="err">{err}</div>}
            <div className="btn-row">
              <button className="ghost" onClick={onClose}>بستن</button>
              <button className="ghost" disabled={busy} onClick={() => onPdf(p)}>خروجی PDF این پروژه</button>
              {canFix && (
                <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy || !(Number(rc.amount) > 0) || !rc.date}
                  onClick={() => act(async () => {
                    await financeReportsApi.addReceipt({ project: p.id, ...rc });
                    setRc({ date: todayIso(), amount: "", note: "" });
                  })}>ثبت دریافتی</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
