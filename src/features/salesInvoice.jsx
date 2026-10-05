import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { financeReportsApi } from "../api.js";
import { Empty, JalaliPicker, PrintableDoc, faDigits, faRial, jShort, todayIso } from "../shared/core.jsx";

/* ============ فاکتور فروش پروژه‌ها ============
   از روی فاکتورهایی که پیش‌تر در اکسل زده می‌شد: پیش‌فاکتور، فاکتور، و فاکتور رسمی با مالیات؛ هر پروژه چند سند
   (متریال و دستمزد جدا، قسمت اول و دوم، نسخهٔ اصلاحی). هر ردیف سه جور قیمت می‌خورد: متری (متراژ × بهای هر متر)،
   دانه‌ای (تعداد × بهای هر دانه)، یا تعداد × متراژِ هر دانه × بهای هر متر؛ روی هر سه ضریب سختی و ضریب حجم/شیار
   و درصد انجام ضرب می‌شود. بعد از جمع،
   افزوده و کسرها (تخفیف، بسته‌بندی، حمل) و مالیات. محاسبهٔ نهایی در backend/core/invoices.py است؛ اینجا همان را
   برای پیش‌نمایشِ زنده تکرار می‌کند. */

const KINDS = { proforma: "پیش‌فاکتور", invoice: "فاکتور", official: "فاکتور رسمی" };
const KIND_TITLE = { proforma: "پیش‌فاکتور", invoice: "فاکتور فروش", official: "فاکتور فروش کالا و خدمات" };
const SCOPES = { "": "کل کار", material: "متریال", labour: "دستمزد" };
const STATUS_PILL = { draft: "pill run", issued: "pill ok", cancelled: "pill bad" };

const toLatin = (t) => String(t ?? "").replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/[٫]/g, ".");
const onlyDigits = (t) => toLatin(t).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
const decimalText = (t) => { const s = toLatin(t).replace(/[^\d.]/g, ""); const i = s.indexOf("."); return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, ""); };
const n = (v) => Number(v) || 0;

/** خانهٔ مبلغ: رقم فارسی هم می‌پذیرد و سه‌رقم‌سه‌رقم جدا نشان می‌دهد. */
function Money({ value, onChange, disabled, placeholder, style }) {
  return (
    <input className="inv-num" type="text" inputMode="numeric" disabled={disabled} placeholder={placeholder} style={style}
      value={value === "" || value == null ? "" : Number(value).toLocaleString("en-US")} onChange={(e) => onChange(onlyDigits(e.target.value))} />
  );
}
function Num({ value, onChange, disabled, placeholder, style }) {
  return <input className="inv-num" type="text" inputMode="decimal" disabled={disabled} placeholder={placeholder} style={style}
    value={value ?? ""} onChange={(e) => onChange(decimalText(e.target.value))} />;
}

/** همان حسابِ سرور، برای پیش‌نمایشِ زنده. */
function compute(lines, adjustments, vatPercent) {
  const vat = n(vatPercent);
  let subtotal = 0, discount = 0, tax = 0;
  const rows = lines.map((r) => {
    const one = (v) => (v === "" || v == null ? 1 : n(v));
    const factor = (r.mode === "both" ? n(r.count) : 1) * n(r.quantity) * one(r.coefficient) * one(r.coefficient2) * (r.percent === "" || r.percent == null ? 100 : n(r.percent)) / 100;
    const gross = Math.round(factor * n(r.unitPrice));
    const net = gross - n(r.discount);
    const t = Math.round(net * vat / 100);
    subtotal += net; discount += n(r.discount); tax += t;
    return { ...r, gross, net, vat: t, total: net + t };
  });
  let running = subtotal;
  const adj = adjustments.map((a) => {
    const amount = a.mode === "percent" ? Math.round(running * n(a.value) / 100) : n(a.value);
    const signed = a.sign * amount;
    const t = a.sign * Math.round(amount * vat / 100);
    running += signed; tax += t;
    return { ...a, amount, signed, vat: t, after: running };
  });
  return { lines: rows, adjustments: adj, gross: subtotal + discount, lineDiscount: discount, subtotal, base: running, vat: tax, total: running + tax };
}

const blankLine = (mode = "area") => ({ mode, description: "", spec: "", count: "", quantity: "", unit: mode === "piece" ? "عدد" : "مترمربع",
  coefficient: "", coefficient2: "", unitPrice: "", percent: "", discount: "" });
const MODES = { area: "متری", piece: "دانه‌ای", both: "تعداد × متراژ" };
const PIECE_UNITS = ["عدد", "لنگه", "دست", "سرویس", "مقطوع"];

export function SalesInvoices() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [edit, setEdit] = useState(null);         // {id} یا {project}
  const [print, setPrint] = useState(null);       // سندِ کامل برای چاپ
  const [pick, setPick] = useState("");

  const load = useCallback(async () => {
    try { setD(await financeReportsApi.invoices()); setErr(""); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err && !d) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">…</div>;

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = d.invoices.filter((x) => kind === "all" || x.kind === kind)
    .filter((x) => words.every((w) => `${x.project} ${x.buyerName} ${x.number} ${x.title}`.toLowerCase().includes(w)));
  const open = d.projects.filter((p) => !p.closed), closed = d.projects.filter((p) => p.closed);
  const issuedTotal = d.invoices.filter((x) => x.status === "issued" && x.kind !== "proforma").reduce((a, x) => a + x.total, 0);

  const openPrint = async (id) => { try { setPrint(await financeReportsApi.invoice(id)); } catch (e) { setErr(e.message); } };

  return (
    <>
      <div className="card">
        <div className="items-hd">فاکتور فروش پروژه‌ها</div>
        <div className="muted sm2" style={{ lineHeight: 2 }}>
          برای هر پروژه هر چند سند که لازم است بسازید: پیش‌فاکتور، فاکتور، یا فاکتور رسمی با مالیات؛ متریال و دستمزد جدا، قسمت اول و دوم، نسخهٔ اصلاحی.
          سند تا «صادر» نشده پیش‌نویس است و ویرایش می‌شود. با «رونوشت» از یک سند، سندِ بعدی را سریع بسازید.
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", alignItems: "end", gap: 8, marginTop: 8 }}>
          <label className="fld sm" style={{ margin: 0, minWidth: 260 }}><span>پروژه</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— پروژه را انتخاب کنید —</option>
              <optgroup label="در جریان">{open.map((p) => <option key={p.id} value={p.id}>{p.label}{p.owner ? ` — ${p.owner}` : ""}</option>)}</optgroup>
              <optgroup label="بسته">{closed.map((p) => <option key={p.id} value={p.id}>{p.label}{p.owner ? ` — ${p.owner}` : ""}</option>)}</optgroup>
            </select>
          </label>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={!pick} onClick={() => setEdit({ project: pick })}>+ فاکتور تازه برای این پروژه</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{faDigits(d.invoices.length)}</b><span>سند<br />{faDigits(d.invoices.filter((x) => x.status === "draft").length)} پیش‌نویس</span></div>
        <div className="stat"><b>{faRial(issuedTotal)}</b><span>جمع فاکتورهای صادرشده (ریال)<br />پیش‌فاکتور و باطل شمرده نمی‌شود</span></div>
      </div>

      <div className="card">
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <div className="seg-row" style={{ margin: 0 }}>
            {[["all", "همه"], ...Object.entries(KINDS)].map(([k, l]) => <button key={k} className={kind === k ? "seg on" : "seg"} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          <input style={{ flex: "1 1 200px", maxWidth: 320 }} placeholder="جستجوی پروژه، خریدار یا شماره" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        {list.length === 0 ? <Empty art="finance">{d.invoices.length ? "سندی با این جستجو نیست." : "هنوز فاکتوری ساخته نشده. پروژه را انتخاب کنید و «فاکتور تازه» را بزنید."}</Empty> : (
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>تاریخ</th><th>شماره</th><th>نوع</th><th>پروژه</th><th>خریدار</th><th>مبلغ (ریال)</th><th>وضعیت</th><th /></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td>{jShort(x.date)}</td>
                    <td><bdi dir="ltr">{x.number || "—"}</bdi></td>
                    <td className="nm">{KINDS[x.kind]}{(x.scopeLabel || x.title) && <div className="muted sm2">{[x.scopeLabel, x.title].filter(Boolean).join(" · ")}</div>}
                      {x.source && (
                        <button className="linkish sm2" title="پیش‌فاکتوری که این سند از رویش ساخته شده" onClick={() => setEdit({ id: x.source.id })}>
                          {x.source.kindLabel} <bdi dir="ltr">{x.source.number}</bdi>
                        </button>
                      )}</td>
                    <td className="nm">{x.project}</td>
                    <td className="nm">{x.buyerName}</td>
                    <td><b>{faRial(x.total)}</b></td>
                    <td><span className={STATUS_PILL[x.status]}>{x.statusLabel}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => setEdit({ id: x.id })}>{x.status === "draft" ? "ویرایش" : "دیدن"}</button>{" "}
                      <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => openPrint(x.id)}>چاپ / PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && <InvoiceEditor key={edit.id || `new-${edit.project}`} target={edit} onClose={() => { setEdit(null); load(); }}
        onPrint={(inv) => { setEdit(null); load(); setPrint(inv); }} onSwitch={(id) => setEdit({ id })} />}
      {print && <InvoiceDoc inv={print} onClose={() => setPrint(null)} />}
    </>
  );
}

/* ---------- ویرایشگر ---------- */
function InvoiceEditor({ target, onClose, onPrint, onSwitch }) {
  const [f, setF] = useState(null);
  const [defs, setDefs] = useState(null);
  const [inv, setInv] = useState(null);           // سندِ ذخیره‌شده (اگر هست)
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);        // مشخصات کاملِ خریدار و فروشنده
  const [note, setNote] = useState("");
  const [cols, setCols] = useState({ coef2: false, pct: false, disc: false });   // ستون‌های اختیاریِ ردیف‌ها

  const fill = (x) => ({
    kind: x.kind, scope: x.scope || "", title: x.title || "", number: x.number || "", date: x.date, seller: { ...x.seller }, buyer: { ...x.buyer },
    lines: x.calc.lines.map((r) => ({ mode: r.mode || "area", description: r.description, spec: r.spec || "", count: r.mode === "both" ? String(r.count) : "",
      quantity: String(r.quantity), unit: r.unit || "", coefficient: r.coefficient === 1 ? "" : String(r.coefficient),
      coefficient2: (r.coefficient2 ?? 1) === 1 ? "" : String(r.coefficient2), unitPrice: String(r.unitPrice), percent: r.percent === 100 ? "" : String(r.percent),
      discount: r.discount ? String(r.discount) : "" })),
    adjustments: x.calc.adjustments.map((a) => ({ label: a.label, sign: a.sign, mode: a.mode, value: String(a.value) })),
    vatPercent: x.vatPercent ? String(x.vatPercent) : "", notes: [...x.notes], showReceipts: x.showReceipts,
  });

  // آخرین حالتِ ذخیره‌شدهٔ فرم، تا پیش از رفتن به سندِ دیگر بدانیم چیزی ذخیره‌نشده مانده یا نه
  const clean = useRef("");
  const put = (x) => { const v = fill(x); clean.current = JSON.stringify(v); setF(v); };
  const start = (v) => { clean.current = JSON.stringify(v); setF(v); };

  useEffect(() => {
    (async () => {
      try {
        if (target.id) {
          const x = await financeReportsApi.invoice(target.id);
          setInv(x); put(x);
          setDefs(await financeReportsApi.invoiceDefaults(x.projectId));
        } else {
          const df = await financeReportsApi.invoiceDefaults(target.project);
          setDefs(df);
          const first = df.sellers[0] || { name: "" };
          start({ kind: "proforma", scope: "", title: "", number: "", date: todayIso(), seller: { ...first }, buyer: { ...df.buyer },
            lines: [blankLine()], adjustments: [], vatPercent: "", notes: [], showReceipts: false });
        }
      } catch (e) { setErr(e.message); }
    })();
  }, [target.id, target.project]);   // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => (f ? compute(f.lines, f.adjustments, f.vatPercent) : null), [f]);
  if (!f || !defs) {
    return <div className="doc-overlay"><div className="wh-dialog wide">{err ? <div className="notice warn">{err}</div> : <div className="empty">…</div>}
      <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div></div></div>;
  }

  const locked = inv && inv.status !== "draft";
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setLine = (i, patch) => setF((x) => ({ ...x, lines: x.lines.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const setAdj = (i, patch) => setF((x) => ({ ...x, adjustments: x.adjustments.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const moveLine = (i, step) => setF((x) => {
    const to = i + step; if (to < 0 || to >= x.lines.length) return x;
    const lines = [...x.lines]; [lines[i], lines[to]] = [lines[to], lines[i]]; return { ...x, lines };
  });
  const body = () => ({
    project: target.project || inv?.projectId, kind: f.kind, scope: f.scope, title: f.title, number: f.number, date: f.date, seller: f.seller, buyer: f.buyer,
    lines: f.lines.filter((r) => r.description.trim() || r.quantity || r.unitPrice), adjustments: f.adjustments, vatPercent: f.vatPercent || 0, notes: f.notes, showReceipts: f.showReceipts,
  });
  const run = async (fn) => { setBusy(true); setErr(""); try { return await fn(); } catch (e) { setErr(e.message); return null; } finally { setBusy(false); } };
  const save = () => run(async () => {
    const x = inv ? await financeReportsApi.invoiceUpdate(inv.id, body()) : await financeReportsApi.invoiceCreate(body());
    setInv(x); put(x); return x;
  });
  const status = (s) => run(async () => { const x = await financeReportsApi.invoiceStatus(inv.id, s); setInv(x); put(x); return x; });
  const pickSeller = (id) => { const s = defs.sellers.find((x) => x.id === id); if (s) set({ seller: { ...s } }); };
  const usesCoef2 = f.lines.some((r) => r.coefficient2 !== ""), usesPct = f.lines.some((r) => r.percent !== ""), usesDisc = f.lines.some((r) => r.discount !== "");
  /** عوض کردنِ جورِ قیمتِ یک ردیف: واحد هم با آن جور می‌شود (دانه‌ای ← عدد، متری ← مترمربع). */
  const setMode = (i, mode) => {
    const r = f.lines[i];
    const unit = mode === "piece" ? (PIECE_UNITS.includes(r.unit) ? r.unit : "عدد") : (PIECE_UNITS.includes(r.unit) || !r.unit ? "مترمربع" : r.unit);
    // از «دانه‌ای» به «تعداد × متراژ»: عددی که نوشته شده تعداد بوده، نه متراژ
    setLine(i, mode === "both" && r.mode === "piece" ? { mode, unit, count: r.quantity, quantity: "" }
      : r.mode === "both" && mode === "piece" ? { mode, unit, quantity: r.count, count: "" } : { mode, unit, count: mode === "both" ? r.count : "" });
  };
  const show = { coef2: cols.coef2 || usesCoef2, pct: cols.pct || usesPct, disc: cols.disc || usesDisc };
  const party = (who, key, label, wide) => (
    <label className="fld sm" style={{ margin: 0, gridColumn: wide ? "span 2" : undefined }}><span>{label}</span>
      <input disabled={locked} value={f[who][key] || ""} onChange={(e) => set({ [who]: { ...f[who], [key]: e.target.value } })} /></label>
  );

  return (
    <div className="doc-overlay">
      <div className="wh-dialog wide inv-dialog">
        <div className="board-h" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span>{inv ? <>{KINDS[f.kind]} <bdi dir="ltr">{f.number}</bdi> — {inv.project}</> : "فاکتور تازه"}</span>
          {inv && <span className={STATUS_PILL[inv.status]}>{inv.statusLabel}</span>}
        </div>
        {inv?.source && (
          <div className="notice">
            این سند از {inv.source.kindLabel} <bdi dir="ltr">{inv.source.number}</bdi> ساخته شده است.{" "}
            <button className="linkish" onClick={() => onSwitch(inv.source.id)}>دیدن همان {inv.source.kindLabel}</button>
          </div>
        )}
        {inv?.derived?.length > 0 && (
          <div className="notice">
            این {KINDS[f.kind]} تبدیل شده و در فهرست جدا نمی‌آید:{" "}
            {inv.derived.map((x) => (
              <button key={x.id} className="linkish" style={{ marginInlineEnd: 10 }} onClick={() => onSwitch(x.id)}>
                {x.kindLabel} <bdi dir="ltr">{x.number}</bdi> ({x.statusLabel})
              </button>
            ))}
          </div>
        )}
        {locked && <div className="notice">این سند {inv.statusLabel} است و ویرایش نمی‌شود. برای تغییر، آن را به پیش‌نویس برگردانید یا از آن رونوشت بگیرید.</div>}
        {(defs.contract || defs.received > 0) && (
          <div className="muted sm2" style={{ marginBottom: 8 }}>
            {defs.contract ? `مبلغ قرارداد پروژه: ${faRial(defs.contract)} ریال` : "مبلغ قرارداد ثبت نشده"} · دریافتی از کارفرما تا امروز: {faRial(defs.received)} ریال
          </div>
        )}

        <div className="inv-grid">
          <div className="fld sm" style={{ margin: 0, gridColumn: "span 2" }}><span>نوع سند</span>
            <div className="seg-row" style={{ margin: 0 }}>
              {Object.entries(KINDS).map(([k, l]) => {
                // سندِ دیگرِ همین زنجیره از این نوع (پیش‌فاکتورِ این فاکتور، یا فاکتورِ این پیش‌فاکتور): دکمه‌اش رنگی است و به همان سند می‌برد
                const other = k === f.kind ? null : inv?.source?.kind === k ? inv.source : inv?.derived?.find((x) => x.kind === k);
                if (other) {
                  return (
                    <button key={k} className="seg linked" disabled={busy} title={`دیدن ${other.kindLabel} ${other.number} — همین کار، سندِ ${other.kindLabel}`}
                      onClick={() => { if (JSON.stringify(f) === clean.current || window.confirm("تغییرهای ذخیره‌نشدهٔ این سند از بین می‌رود. ادامه می‌دهید؟")) onSwitch(other.id); }}>
                      {l} ↗
                    </button>
                  );
                }
                return (
                <button key={k} disabled={locked} className={f.kind === k ? "seg on" : "seg"}
                  onClick={() => set({ kind: k, vatPercent: k === "official" && !f.vatPercent ? "10" : f.vatPercent,
                    // شماره‌ای که از کد پروژه ساخته شده (…-P01 یا …-F01) مالِ همان نوع است؛ با عوض شدنِ نوع، شمارهٔ نوعِ تازه می‌آید
                    number: !f.number || (k !== f.kind && /-[PF]\d+$/.test(f.number)) ? defs.numbers[k] || "" : f.number })}>{l}</button>
                );
              })}
            </div>
          </div>
          <label className="fld sm" style={{ margin: 0 }}><span>موضوع</span>
            <select disabled={locked} value={f.scope} onChange={(e) => set({ scope: e.target.value })}>{Object.entries(SCOPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="fld sm" style={{ margin: 0 }}><span>عنوان (اختیاری)</span>
            <input disabled={locked} placeholder="مثلاً: قسمت دوم، درب‌ها" value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="fld sm" style={{ margin: 0 }}><span>شماره</span>
            <input disabled={locked} placeholder={defs.numbers[f.kind] || "برای صادر کردن لازم است"} value={f.number} onChange={(e) => set({ number: e.target.value })} /></label>
          <div className="fld sm" style={{ margin: 0 }}><span>تاریخ</span>
            {locked ? <input disabled value={jShort(f.date)} /> : <JalaliPicker value={f.date} onChange={(v) => v && set({ date: v })} />}</div>
          <label className="fld sm" style={{ margin: 0, gridColumn: "span 2" }}><span>فروشنده</span>
            <select disabled={locked} value={defs.sellers.find((s) => s.name === f.seller.name)?.id || ""} onChange={(e) => pickSeller(e.target.value)}>
              {!defs.sellers.some((s) => s.name === f.seller.name) && <option value="">{f.seller.name || "— انتخاب کنید —"}</option>}
              {defs.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          {party("buyer", "name", "خریدار", true)}
          {party("buyer", "projectName", "نام پروژه روی فاکتور", true)}
        </div>
        <button className="linkish" style={{ margin: "8px 0" }} onClick={() => setMore(!more)}>{more ? "بستن مشخصات کامل ▴" : "مشخصات کامل خریدار و فروشنده (برای فاکتور رسمی) ▾"}</button>
        {more && (
          <>
            <div className="muted sm2">خریدار</div>
            <div className="inv-grid">
              {party("buyer", "nationalId", "شناسه / کد ملی")}{party("buyer", "economicCode", "شماره اقتصادی")}{party("buyer", "regNo", "شماره ثبت")}
              {party("buyer", "phone", "تلفن")}{party("buyer", "province", "استان")}{party("buyer", "city", "شهر")}{party("buyer", "postalCode", "کد پستی")}
              {party("buyer", "address", "نشانی", true)}
            </div>
            <div className="muted sm2" style={{ marginTop: 8 }}>فروشنده (فقط روی همین سند عوض می‌شود)</div>
            <div className="inv-grid">
              {party("seller", "name", "نام")}{party("seller", "nationalId", "شناسه / کد ملی")}{party("seller", "economicCode", "شماره اقتصادی")}{party("seller", "regNo", "شماره ثبت")}
              {party("seller", "phone", "تلفن")}{party("seller", "province", "استان")}{party("seller", "city", "شهر")}{party("seller", "postalCode", "کد پستی")}
              {party("seller", "address", "نشانی", true)}{party("seller", "bankNote", "شماره حساب برای واریز", true)}
            </div>
          </>
        )}

        <div className="items-hd" style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span>ردیف‌ها</span>
          {!locked && (
            <span className="plan-chips">
              {[["coef2", "ضریب حجم / شیار"], ["pct", "درصد انجام"], ["disc", "تخفیف ردیف"]].map(([k, l]) => (
                <button key={k} className={show[k] ? "chip on" : "chip"} onClick={() => setCols({ ...cols, [k]: !show[k] })}>{l}</button>
              ))}
            </span>
          )}
        </div>
        <datalist id="inv-units">{defs.units.map((u) => <option key={u} value={u} />)}</datalist>
        <datalist id="inv-adj">{defs.adjustments.map((u) => <option key={u} value={u} />)}</datalist>
        <div className="tbl-scroll">
          <table className="print-table inv-lines">
            <thead><tr><th>#</th><th>شرح کالا یا خدمات</th><th>قیمت‌گذاری</th><th>تعداد</th><th>متراژ</th><th>واحد</th><th>ضریب سختی</th>{show.coef2 && <th>ضریب حجم / شیار</th>}<th>بهای واحد (ریال)</th>
              {show.pct && <th>٪ انجام</th>}{show.disc && <th>تخفیف (ریال)</th>}<th>جمع (ریال)</th><th /></tr></thead>
            <tbody>
              {f.lines.map((r, i) => (
                <tr key={i}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="nm" style={{ minWidth: 260 }}>
                    <textarea rows={1} disabled={locked} placeholder="شرح" value={r.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    <input className="inv-spec" disabled={locked} placeholder="مشخصات فنی (اختیاری) — مثلاً: آستر پلی‌اورتان و رنگ رویه سفید مات" value={r.spec} onChange={(e) => setLine(i, { spec: e.target.value })} />
                  </td>
                  <td>
                    <select className="inv-mode" disabled={locked} value={r.mode} onChange={(e) => setMode(i, e.target.value)}
                      title="متری: متراژ × بهای هر متر — دانه‌ای: تعداد × بهای هر دانه — تعداد × متراژ: تعداد × متراژِ هر دانه × بهای هر متر">
                      {Object.entries(MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </td>
                  <td>{r.mode === "area" ? <span className="muted">—</span>
                    : <Num disabled={locked} placeholder="تعداد" value={r.mode === "piece" ? r.quantity : r.count}
                        onChange={(v) => setLine(i, r.mode === "piece" ? { quantity: v } : { count: v })} style={{ width: 62 }} />}</td>
                  <td>{r.mode === "piece" ? <span className="muted">—</span>
                    : <Num disabled={locked} placeholder={r.mode === "both" ? "هر دانه" : "متراژ"} value={r.quantity} onChange={(v) => setLine(i, { quantity: v })} style={{ width: 72 }} />}</td>
                  <td><input className="inv-num" list="inv-units" disabled={locked} value={r.unit} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: 80 }} /></td>
                  <td><Num disabled={locked} placeholder="۱" value={r.coefficient} onChange={(v) => setLine(i, { coefficient: v })} style={{ width: 54 }} /></td>
                  {show.coef2 && <td><Num disabled={locked} placeholder="۱" value={r.coefficient2} onChange={(v) => setLine(i, { coefficient2: v })} style={{ width: 54 }} /></td>}
                  <td><Money disabled={locked} placeholder={r.mode === "piece" ? "هر دانه" : "هر متر"} value={r.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} style={{ width: 124 }} /></td>
                  {show.pct && <td><Num disabled={locked} placeholder="۱۰۰" value={r.percent} onChange={(v) => setLine(i, { percent: v })} style={{ width: 56 }} /></td>}
                  {show.disc && <td><Money disabled={locked} value={r.discount} onChange={(v) => setLine(i, { discount: v })} style={{ width: 110 }} /></td>}
                  <td><b>{faRial(calc.lines[i].net)}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!locked && (<>
                      <button className="inv-x" title="بالا" disabled={i === 0} onClick={() => moveLine(i, -1)}>▲</button>
                      <button className="inv-x" title="پایین" disabled={i === f.lines.length - 1} onClick={() => moveLine(i, 1)}>▼</button>
                      <button className="inv-x" title="رونوشت همین ردیف" onClick={() => setF((x) => ({ ...x, lines: [...x.lines.slice(0, i + 1), { ...r }, ...x.lines.slice(i + 1)] }))}>⧉</button>
                      <button className="inv-x del" title="حذف ردیف" disabled={f.lines.length === 1} onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, k) => k !== i) }))}>×</button>
                    </>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!locked && (
          <div className="inv-add">
            <button className="add-row" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine("area")] }))}>+ ردیف متری</button>
            <button className="add-row" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine("piece")] }))}>+ ردیف دانه‌ای</button>
            <button className="add-row" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine("both")] }))}>+ ردیف تعداد × متراژ</button>
          </div>
        )}
        <div className="muted sm2" style={{ marginTop: 4 }}>
          جمع هر ردیف = تعداد × متراژ × ضریب سختی{show.coef2 ? " × ضریب حجم/شیار" : ""} × بهای واحد{show.pct ? " × درصد انجام" : ""}. ضریبِ ننوشته ۱ است.
        </div>

        <div className="inv-bottom">
          <div>
            <div className="items-hd">افزوده و کسر بعد از جمع</div>
            <div className="muted sm2" style={{ margin: "-2px 0 6px" }}>به ترتیب حساب می‌شود؛ درصد یعنی درصدی از جمعِ تا همان‌جا. مثل: تخفیف ۵٪، بعد بسته‌بندی.</div>
            {f.adjustments.map((a, i) => (
              <div className="inv-adj" key={i}>
                <input list="inv-adj" disabled={locked} placeholder="عنوان" value={a.label} onChange={(e) => setAdj(i, { label: e.target.value })} />
                <select disabled={locked} value={a.sign} onChange={(e) => setAdj(i, { sign: Number(e.target.value) })}><option value={1}>اضافه شود</option><option value={-1}>کم شود</option></select>
                <select disabled={locked} value={a.mode} onChange={(e) => setAdj(i, { mode: e.target.value, value: "" })}><option value="amount">مبلغ</option><option value="percent">درصد</option></select>
                {a.mode === "percent" ? <Num disabled={locked} placeholder="٪" value={a.value} onChange={(v) => setAdj(i, { value: v })} style={{ width: 70 }} />
                  : <Money disabled={locked} placeholder="ریال" value={a.value} onChange={(v) => setAdj(i, { value: v })} style={{ width: 140 }} />}
                {!locked && <button className="inv-x del" onClick={() => setF((x) => ({ ...x, adjustments: x.adjustments.filter((_, k) => k !== i) }))}>×</button>}
              </div>
            ))}
            {!locked && (
              <div className="plan-chips" style={{ marginTop: 6 }}>
                <button className="chip" onClick={() => setF((x) => ({ ...x, adjustments: [...x.adjustments, { label: "تخفیف", sign: -1, mode: "percent", value: "" }] }))}>+ تخفیف</button>
                <button className="chip" onClick={() => setF((x) => ({ ...x, adjustments: [...x.adjustments, { label: "بسته‌بندی", sign: 1, mode: "amount", value: "" }] }))}>+ بسته‌بندی</button>
                <button className="chip" onClick={() => setF((x) => ({ ...x, adjustments: [...x.adjustments, { label: "کاورکاری، بسته‌بندی و حمل", sign: 1, mode: "amount", value: "" }] }))}>+ کاورکاری و حمل</button>
                <button className="chip" onClick={() => setF((x) => ({ ...x, adjustments: [...x.adjustments, { label: "", sign: 1, mode: "amount", value: "" }] }))}>+ مورد دیگر</button>
              </div>
            )}
            <div className="inv-adj" style={{ marginTop: 12 }}>
              <span className="sm2">مالیات بر ارزش افزوده</span>
              <Num disabled={locked} placeholder="۰" value={f.vatPercent} onChange={(v) => set({ vatPercent: v })} style={{ width: 60 }} /><span className="sm2">درصد</span>
              <label className="sm2" style={{ display: "flex", gap: 6, alignItems: "center", marginInlineStart: 14 }}>
                <input type="checkbox" disabled={locked} checked={f.showReceipts} onChange={(e) => set({ showReceipts: e.target.checked })} /> دریافتی‌های پروژه و مانده زیرِ فاکتور بیاید
              </label>
            </div>

            <div className="items-hd" style={{ marginTop: 14 }}>توضیحات زیر فاکتور</div>
            {f.notes.map((t, i) => (
              <div className="inv-note" key={i}><span>{faDigits(i + 1)}.</span>
                <input disabled={locked} value={t} onChange={(e) => set({ notes: f.notes.map((x, k) => (k === i ? e.target.value : x)) })} />
                {!locked && <button className="inv-x del" onClick={() => set({ notes: f.notes.filter((_, k) => k !== i) })}>×</button>}</div>
            ))}
            {!locked && (
              <>
                <div className="inv-note">
                  <input placeholder="توضیح تازه بنویسید و Enter بزنید" value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { set({ notes: [...f.notes, note.trim()] }); setNote(""); } }} />
                </div>
                <details className="inv-common"><summary>توضیح‌های پرتکرار فاکتورهای قبلی</summary>
                  {[...(f.seller.bankNote ? [f.seller.bankNote] : []), ...defs.notes].filter((t) => !f.notes.includes(t)).map((t) => (
                    <button key={t} className="inv-pick" onClick={() => set({ notes: [...f.notes, t] })}>+ {t}</button>
                  ))}
                </details>
              </>
            )}
          </div>

          <div className="inv-totals">
            {calc.lineDiscount > 0 && <div><span>جمع پیش از تخفیف ردیف‌ها</span><b>{faRial(calc.gross)}</b></div>}
            <div><span>جمع کل</span><b>{faRial(calc.subtotal)}</b></div>
            {calc.adjustments.map((a, i) => (
              <div key={i}><span>{a.label || "—"}{a.mode === "percent" ? ` ${faDigits(a.value || 0)}٪` : ""}</span><b style={{ color: a.sign < 0 ? "#B02A2A" : undefined }}>{a.sign < 0 ? "−" : "+"} {faRial(a.amount)}</b></div>
            ))}
            {calc.vat !== 0 && <div><span>مالیات بر ارزش افزوده {faDigits(f.vatPercent)}٪</span><b>+ {faRial(calc.vat)}</b></div>}
            <div className="main"><span>مبلغ قابل پرداخت</span><b>{faRial(calc.total)}</b></div>
            {f.showReceipts && (<>
              <div><span>دریافتی تا امروز</span><b>− {faRial(defs.received)}</b></div>
              <div className="main"><span>مانده</span><b>{faRial(calc.total - defs.received)}</b></div>
            </>)}
          </div>
        </div>

        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <button className="ghost" disabled={busy} onClick={onClose}>بستن</button>
          {inv && inv.status === "draft" && (
            <button className="ghost" disabled={busy} onClick={() => window.confirm("این پیش‌نویس حذف شود؟") && run(async () => { await financeReportsApi.invoiceDelete(inv.id); onClose(); })}>حذف پیش‌نویس</button>
          )}
          {inv && <button className="ghost" disabled={busy} title="یک پیش‌نویس تازه با همین ردیف‌ها: برای قسمت بعد، نسخهٔ اصلاحی، یا تبدیل پیش‌فاکتور به فاکتور"
            onClick={() => run(async () => { const x = await financeReportsApi.invoiceCopy(inv.id); onSwitch(x.id); })}>رونوشت</button>}
          {inv && f.kind === "proforma" && !(inv.derived?.length > 0) && (
            <button className="ghost" disabled={busy} title="یک فاکتورِ پیش‌نویس با همین ردیف‌ها و شمارهٔ فاکتور می‌سازد؛ پیش‌فاکتور داخلِ همان فاکتور دیدنی می‌ماند و در فهرست جدا نمی‌آید"
              onClick={() => run(async () => { const x = await financeReportsApi.invoiceCopy(inv.id, "invoice"); onSwitch(x.id); })}>تبدیل به فاکتور</button>
          )}
          {locked && <button className="ghost" disabled={busy} onClick={() => status("draft")}>برگرداندن به پیش‌نویس</button>}
          {inv && inv.status === "issued" && <button className="ghost" disabled={busy} onClick={() => window.confirm("این فاکتور باطل شود؟") && status("cancelled")}>باطل کردن</button>}
          {!locked && <button className="ghost" disabled={busy} onClick={save}>ذخیرهٔ پیش‌نویس</button>}
          {!locked && <button className="ghost" disabled={busy} onClick={async () => { const x = await save(); if (x) onPrint(x); }}>ذخیره و چاپ / PDF</button>}
          {locked && <button className="ghost" disabled={busy} onClick={() => onPrint(inv)}>چاپ / PDF</button>}
          {!locked && <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy}
            onClick={async () => { const x = await save(); if (x) await run(async () => { const y = await financeReportsApi.invoiceStatus(x.id, "issued"); setInv(y); put(y); }); }}>ذخیره و صادر کردن</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------- برگهٔ چاپی ---------- */
const line = (label, value) => (value ? <span><i>{label}:</i> {value}</span> : null);

function Totals({ inv }) {
  const c = inv.calc;
  return (
    <div className="inv-sum">
      {c.lineDiscount > 0 && <div><span>جمع پیش از تخفیف</span><b>{faRial(c.gross)}</b></div>}
      <div><span>جمع کل</span><b>{faRial(c.subtotal)}</b></div>
      {c.adjustments.map((a, i) => <div key={i}><span>{a.label}{a.mode === "percent" ? ` ${faDigits(a.value)}٪` : ""}</span><b>{a.sign < 0 ? "−" : ""}{faRial(a.amount)}</b></div>)}
      {c.vat !== 0 && <div><span>مالیات بر ارزش افزوده {faDigits(inv.vatPercent)}٪</span><b>{faRial(c.vat)}</b></div>}
      <div className="main"><span>مبلغ قابل پرداخت (ریال)</span><b>{faRial(c.total)}</b></div>
      {inv.showReceipts && (<>
        <div><span>دریافتی تا این تاریخ</span><b>{faRial(inv.received)}</b></div>
        <div className="main"><span>مانده (ریال)</span><b>{faRial(inv.payable)}</b></div>
      </>)}
    </div>
  );
}

function Notes({ inv }) {
  if (!inv.notes.length) return null;
  return (
    <div className="inv-notes">
      <b>توضیحات</b>
      {inv.notes.map((t, i) => <div key={i}>- {t}</div>)}
    </div>
  );
}

export function InvoiceDoc({ inv, onClose }) {
  useEffect(() => {
    const was = document.title;
    document.title = [KIND_TITLE[inv.kind], inv.number || "پیش‌نویس", inv.project, inv.scopeLabel, inv.title].filter(Boolean).join("-").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
    return () => { document.title = was; };
  }, [inv]);
  const official = inv.kind === "official";
  const c = inv.calc, s = inv.seller, b = inv.buyer;
  const heading = `${KIND_TITLE[inv.kind]}${inv.scopeLabel ? ` — ${inv.scopeLabel}` : ""}${inv.title ? ` — ${inv.title}` : ""}`;
  const usesCoef = c.lines.some((r) => r.coefficient !== 1), usesCoef2 = c.lines.some((r) => r.coefficient2 !== 1);
  const usesPct = c.lines.some((r) => r.percent !== 100), usesDisc = c.lineDiscount > 0;
  const usesCount = c.lines.some((r) => r.mode !== "area"), usesArea = c.lines.some((r) => r.mode !== "piece");
  const desc = (r) => (<>{r.description}{r.spec ? <div className="inv-spec-p">[ {r.spec} ]</div> : null}</>);
  return (
    <PrintableDoc onClose={onClose}>
      <style>{`@media print{@page{size:A4 ${official ? "landscape" : "portrait"};margin:${official ? "9mm" : "12mm"}}}`}</style>
      <div className={official ? "doc-sheet wide inv-sheet" : "doc-sheet inv-sheet"}>
        {inv.status !== "issued" && <div className="inv-stamp no-print-bg">{inv.status === "cancelled" ? "باطل" : "پیش‌نویس"}</div>}
        <div className="inv-head">
          <div className="inv-seller-name">{s.name}</div>
          <div className="inv-title">{heading}</div>
          <div className="inv-meta"><span>شماره: <bdi dir="ltr">{inv.number || "—"}</bdi></span><span>تاریخ: {jShort(inv.date)}</span></div>
        </div>

        <div className="inv-party"><h4>مشخصات فروشنده</h4>
          <div>{line("نام", s.name)}{line(official ? "شناسه / کد ملی" : "کد ملی", s.nationalId)}{line("شماره اقتصادی", s.economicCode)}{line("شماره ثبت", s.regNo)}{line("تلفن", s.phone)}</div>
          {(s.address || s.city) && <div>{line("استان", s.province)}{line("شهر", s.city)}{line("کد پستی", s.postalCode)}{line("نشانی", s.address)}</div>}
        </div>
        <div className="inv-party"><h4>مشخصات خریدار</h4>
          <div>{line("نام", b.name)}{line("نام پروژه", b.projectName)}{line("شناسه / کد ملی", b.nationalId)}{line("شماره اقتصادی", b.economicCode)}{line("شماره ثبت", b.regNo)}{line("تلفن", b.phone)}</div>
          {(b.address || b.postalCode) && <div>{line("استان", b.province)}{line("شهر", b.city)}{line("کد پستی", b.postalCode)}{line("نشانی", b.address)}</div>}
        </div>

        {official ? (
          <table className="doc-table inv-table">
            <thead><tr><th>ردیف</th><th>شرح کالا یا خدمات</th><th>تعداد / مقدار</th><th>واحد</th><th>مبلغ واحد (ریال)</th><th>مبلغ کل (ریال)</th><th>مبلغ تخفیف</th>
              <th>مبلغ کل پس از تخفیف (ریال)</th><th>جمع مالیات و عوارض (ریال)</th><th>جمع مبلغ کل به‌علاوهٔ مالیات و عوارض (ریال)</th></tr></thead>
            <tbody>
              {c.lines.map((r, i) => (
                <tr key={i}><td>{faDigits(i + 1)}</td><td className="nm">{desc(r)}</td>
                  <td>{faDigits(r.factor)}</td><td className="nm">{r.unit}</td>
                  <td>{faRial(r.unitPrice)}</td><td>{faRial(r.gross)}</td><td>{faRial(r.discount)}</td><td>{faRial(r.net)}</td><td>{faRial(r.vat)}</td><td className="net">{faRial(r.total)}</td></tr>
              ))}
              {c.adjustments.map((a, i) => (
                <tr key={`a${i}`}><td>{faDigits(c.lines.length + i + 1)}</td><td className="nm">{a.label}{a.mode === "percent" ? ` ${faDigits(a.value)}٪` : ""}</td><td /><td /><td />
                  <td>{a.sign > 0 ? faRial(a.amount) : "۰"}</td><td>{a.sign < 0 ? faRial(a.amount) : "۰"}</td><td>{faRial(a.signed)}</td><td>{faRial(a.vat)}</td><td className="net">{faRial(a.signed + a.vat)}</td></tr>
              ))}
              <tr className="tot"><td className="nm" colSpan={5}>جمع کل</td><td>{faRial(c.gross + c.adjustments.filter((a) => a.sign > 0).reduce((x, a) => x + a.amount, 0))}</td>
                <td>{faRial(c.lineDiscount + c.adjustments.filter((a) => a.sign < 0).reduce((x, a) => x + a.amount, 0))}</td><td>{faRial(c.base)}</td><td>{faRial(c.vat)}</td><td className="net">{faRial(c.total)}</td></tr>
            </tbody>
          </table>
        ) : (
          <table className="doc-table inv-table">
            <thead><tr><th>ردیف</th><th>شرح کالا یا خدمات</th>{usesCount && <th>تعداد</th>}{usesArea && <th>متراژ</th>}<th>واحد</th>{usesCoef && <th>ضریب سختی</th>}{usesCoef2 && <th>ضریب حجم / شیار</th>}
              <th>بهای واحد (ریال)</th>{usesPct && <th>٪ انجام</th>}{usesDisc && <th>تخفیف</th>}<th>بهای کل (ریال)</th></tr></thead>
            <tbody>
              {c.lines.map((r, i) => (
                <tr key={i}><td>{faDigits(i + 1)}</td><td className="nm">{desc(r)}</td>
                  {usesCount && <td>{r.mode === "area" ? "" : faDigits(r.mode === "piece" ? r.quantity : r.count)}</td>}
                  {usesArea && <td>{r.mode === "piece" ? "" : faDigits(r.quantity)}</td>}<td className="nm">{r.unit}</td>
                  {usesCoef && <td>{faDigits(r.coefficient)}</td>}{usesCoef2 && <td>{faDigits(r.coefficient2)}</td>}<td>{faRial(r.unitPrice)}</td>{usesPct && <td>{faDigits(r.percent)}٪</td>}{usesDisc && <td>{faRial(r.discount)}</td>}
                  <td className="net">{faRial(r.net)}</td></tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="inv-foot">
          <div style={{ flex: 1 }}><Notes inv={inv} />{official && s.bankNote && !inv.notes.includes(s.bankNote) && <div className="inv-notes"><div>{s.bankNote}</div></div>}</div>
          {(!official || inv.showReceipts) && <Totals inv={inv} />}
        </div>
        <div className="doc-sign inv-sign"><div>مهر و امضای فروشنده</div><div>مهر و امضای خریدار</div></div>
      </div>
    </PrintableDoc>
  );
}
