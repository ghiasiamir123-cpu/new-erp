import { useState, useEffect, useMemo, useCallback } from "react";
import { pettyCashApi } from "../api.js";
import { DateRange, Empty, JalaliPicker, askConfirm, faDigits, faRial, jShort, saveSheet, todayIso } from "../shared/core.jsx";

/* ============ تنخواه ============
   هر کس سربرگِ «دستیار حسابداری» را دارد تنخواه‌دار است: دریافتی‌اش را می‌بیند و خرجش را (با مرکز هزینه و عکسِ رسید)
   وارد می‌کند. مالی (کلیدِ accounting.cash) تنخواهِ همه را می‌بیند، شارژ می‌کند و خرج‌ها را تأیید می‌کند یا برای اصلاح
   برمی‌گرداند. حساب و قاعده‌ها در backend/core/pettycash.py است. مبلغ‌ها به ریال. */

const STATUS_PILL = { waiting: "pill run", approved: "pill ok", returned: "pill bad" };
const KIND_TITLE = { expense: "خرج از تنخواه", charge: "شارژ تنخواه", refund: "برگشت به صندوق" };

const toLatin = (t) => String(t ?? "").replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
const onlyDigits = (t) => toLatin(t).replace(/\D/g, "").replace(/^0+(?=\d)/, "");

/** عکسِ رسید پیش از فرستادن کوچک می‌شود تا روی اینترنتِ گوشی سبک بماند و از سقفِ سرور نگذرد. */
async function readReceiptFile(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("فقط عکس بگذارید.");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("عکس خوانده نشد."));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("عکس معتبر نیست."));
    i.src = data;
  });
  let out = "";
  for (const [side, quality] of [[1280, 0.62], [1100, 0.5], [900, 0.45], [700, 0.4]]) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * k));
    canvas.height = Math.max(1, Math.round(img.height * k));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL("image/jpeg", quality);
    if (out.length <= 600000) break;
  }
  return out;
}

const blank = (kind, holder) => ({ id: "", kind, holder, date: todayIso(), amount: "", title: "", category: "other", center: "", project: "", paidTo: "", receipt: undefined, hasReceipt: false });

export function PettyCash() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null);
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [holder, setHolder] = useState("");            // فقط مالی: تنخواهِ یک نفر
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [photo, setPhoto] = useState(null);            // عکسِ رسیدی که باز شده
  const [back, setBack] = useState(null);              // خرجی که مالی دارد برمی‌گرداند: { row, note }
  const [who, setWho] = useState(null);                // تنخواه‌داری که دارد تعریف یا ویرایش می‌شود
  const [whoErr, setWhoErr] = useState("");

  const load = useCallback(() => pettyCashApi.list().then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!d) return [];
    const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
    return d.rows
      .filter((r) => !holder || r.holder === holder)
      .filter((r) => status === "all" || (r.kind === "expense" && r.status === status))
      .filter((r) => (!lo || r.date >= lo) && (!hi || r.date <= hi));
  }, [d, holder, status, from, to]);
  // جمعِ خرج به تفکیکِ مرکز هزینه، برای سندِ حسابداری (خرجِ برگشت‌خورده حساب نمی‌شود)
  const byCenter = useMemo(() => {
    const acc = {};
    rows.filter((r) => r.kind === "expense" && r.status !== "returned").forEach((r) => {
      const key = r.centerLabel || "—";
      acc[key] = acc[key] || { label: key, amount: 0, count: 0 };
      acc[key].amount += r.amount;
      acc[key].count += 1;
    });
    return Object.values(acc).sort((a, b) => b.amount - a.amount);
  }, [rows]);

  if (err && !d) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">در حال خواندن…</div>;

  const review = d.canReview;
  const mine = d.holders.find((h) => h.holder === d.me) || { charged: 0, refunded: 0, approved: 0, waiting: 0, balance: 0, waitingCount: 0, returnedCount: 0 };
  const shown = review ? (holder ? d.holders.filter((h) => h.holder === holder) : d.holders) : [mine];
  const sum = (key) => shown.reduce((a, h) => a + (h[key] || 0), 0);
  const waitingCount = sum("waitingCount"), returnedCount = sum("returnedCount");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // فقط برای تنخواه‌دارِ تعریف‌شده می‌شود ردیف ثبت کرد
  const defined = d.holders.filter((h) => h.defined && h.active);
  const canAdd = review ? defined.length > 0 : d.isHolder;
  const pickHolder = (h) => (defined.some((x) => x.holder === h) ? h : defined[0]?.holder || "");
  const open = (kind, target) => { setFormErr(""); setForm(blank(kind, review ? pickHolder(target || holder || d.me) : d.me)); };
  const openWho = (h) => {
    setWhoErr("");
    setWho(h ? { holder: h.holder, name: h.name, isNew: false, account: h.account || "", bank: h.bank || "", limit: h.limit == null ? "" : String(Math.round(h.limit)), note: h.note || "" }
      : { holder: d.candidates[0]?.username || "", name: "", isNew: true, account: "", bank: "", limit: "", note: "" });
  };
  async function saveWho(extra) {
    if (busy || !who.holder) return;
    setBusy(true); setWhoErr("");
    try {
      setD(await pettyCashApi.setHolder({ holder: who.holder, account: who.account, bank: who.bank, limit: who.limit === "" ? "" : Number(who.limit), note: who.note, ...extra }));
      setWho(null);
    } catch (e) { setWhoErr(e.message); } finally { setBusy(false); }
  }
  async function removeWho() {
    if (!(await askConfirm({ title: `${who.name} از تنخواه‌دارها برداشته شود؟`, message: "سابقهٔ تنخواهش می‌ماند، ولی دیگر «تنخواهِ من» را نمی‌بیند و خرجِ تازه‌ای برایش ثبت نمی‌شود.", confirmLabel: "بردار", danger: true }))) return;
    saveWho({ active: false });
  }
  const acct = (h) => (h && h.account ? <div className="pc-acct">{h.bank ? `${h.bank} — ` : ""}<bdi dir="ltr">{h.account}</bdi>{h.limit != null ? ` · سقف ${faRial(h.limit)} ریال` : ""}</div> : null);
  const edit = (r) => { setFormErr(""); setForm({ ...blank(r.kind, r.holder), id: r.id, date: r.date, amount: String(Math.round(r.amount)), title: r.title, category: r.category || "other", center: r.center, project: r.project, paidTo: r.paidTo, hasReceipt: r.hasReceipt }); };

  async function save() {
    if (busy) return;
    const f = form;
    if (!Number(f.amount)) { setFormErr("مبلغ را به ریال بنویسید."); return; }
    if (f.kind === "expense") {
      if (!f.title.trim()) { setFormErr("شرحِ خرج را بنویسید (برای چه بود)."); return; }
      if (!f.center) { setFormErr("مرکز هزینه را انتخاب کنید."); return; }
      if (f.center === "project" && !f.project) { setFormErr("پروژهٔ این خرج را انتخاب کنید."); return; }
    }
    const body = { kind: f.kind, holder: f.holder, date: f.date, amount: Number(f.amount), title: f.title.trim(), category: f.category, center: f.center, project: f.center === "project" ? f.project : "", paidTo: f.paidTo.trim() };
    if (f.receipt !== undefined) body.receipt = f.receipt;
    setBusy(true); setFormErr("");
    try {
      if (f.id) await pettyCashApi.update(f.id, body); else await pettyCashApi.create(body);
      setForm(null);
      await load();
    } catch (e) { setFormErr(e.message); } finally { setBusy(false); }
  }
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(r) {
    if (!(await askConfirm({ title: "این ردیف حذف شود؟", message: `${r.title || KIND_TITLE[r.kind]} — ${faRial(r.amount)} ریال`, confirmLabel: "حذف", danger: true }))) return;
    act(() => pettyCashApi.remove(r.id));
  }
  async function pickPhoto(file) {
    try { set("receipt", await readReceiptFile(file)); setFormErr(""); } catch (e) { setFormErr(e.message); }
  }
  async function showPhoto(r) {
    setPhoto({ title: r.title, data: "" });
    try { const x = await pettyCashApi.receipt(r.id); setPhoto({ title: r.title, data: x.receipt }); } catch (e) { setPhoto(null); setErr(e.message); }
  }
  function exportExcel() {
    saveSheet("tankhah", "تنخواه", [
      ["تاریخ", "تنخواه‌دار", "نوع", "شرح", "نوع خرج", "مرکز هزینه", "پرداخت به", "دریافت (ریال)", "خرج یا برگشت (ریال)", "وضعیت", "توضیحِ مالی"],
      ...rows.map((r) => [jShort(r.date), r.holderName, d.kinds[r.kind], r.title, r.categoryLabel, r.centerLabel, r.paidTo,
        r.kind === "charge" ? r.amount : "", r.kind === "charge" ? "" : r.amount, r.kind === "expense" ? d.statuses[r.status] : "", r.reviewNote]),
    ]);
  }
  const canTouch = (r) => (r.kind === "expense" ? r.status !== "approved" && (review || r.holder === d.me) : review);
  const nameOf = (u) => d.holders.find((h) => h.holder === u)?.name || u;

  return (
    <>
      {err && <div className="notice warn">{err}</div>}
      <div className="stats">
        <div className="stat pc-main"><b>{faRial(sum("balance"))}</b><span>{review && !holder ? "ماندهٔ تنخواه نزدِ همه (ریال)" : review ? `ماندهٔ تنخواهِ ${nameOf(holder)} (ریال)` : "ماندهٔ تنخواهِ من (ریال)"}</span></div>
        <div className="stat"><b>{faRial(sum("charged") - sum("refunded"))}</b><span>دریافتی (ریال)</span></div>
        <div className="stat"><b>{faRial(sum("approved"))}</b><span>خرجِ تأییدشده</span></div>
        <div className="stat"><b>{faRial(sum("waiting"))}</b><span>خرجِ منتظرِ تأیید{waitingCount ? ` · ${faDigits(waitingCount)} ردیف` : ""}</span></div>
      </div>
      {returnedCount > 0 && (
        <div className="notice warn">
          {faDigits(returnedCount)} خرج برای اصلاح برگشته است{review ? "" : "؛ علتش زیرِ همان ردیف نوشته شده. درستش کنید تا دوباره برای تأیید برود"}.
          {status !== "returned" && <> <button className="linkish" onClick={() => setStatus("returned")}>نشانم بده</button></>}
        </div>
      )}

      {!review && !d.isHolder && (
        <div className="notice">برای شما تنخواهی تعریف نشده است. اگر تنخواه می‌گیرید، از مالی بخواهید شما را تنخواه‌دار کند.</div>
      )}
      {!review && mine.account && <div className="pc-acct"><b>حسابِ تنخواهِ من: </b>{mine.bank ? `${mine.bank} — ` : ""}<bdi dir="ltr">{mine.account}</bdi>{mine.limit != null ? ` · سقف ${faRial(mine.limit)} ریال` : ""}</div>}

      <div className="btn-row pc-actions no-print">
        <button className="submit" disabled={!canAdd} onClick={() => open("expense")}>+ ثبتِ خرج</button>
        {review && <button className="ghost" disabled={!canAdd} onClick={() => open("charge")}>+ شارژ تنخواه</button>}
        {review && <button className="ghost" disabled={!canAdd} onClick={() => open("refund")}>+ برگشت به صندوق</button>}
        <button className="ghost" disabled={!rows.length} onClick={exportExcel}>خروجی اکسل</button>
      </div>

      {review && (
        <div className="card">
          <div className="items-hd pc-hd"><span>تنخواه‌دارها</span>
            <button className="ghost no-print" onClick={() => openWho(null)}>+ تنخواه‌دارِ تازه</button></div>
          {d.holders.length === 0 ? <Empty art="finance">هنوز تنخواه‌داری تعریف نشده. با «+ تنخواه‌دارِ تازه» شروع کنید.</Empty> : (
            <div className="tbl-scroll">
              <table className="print-table">
                <thead><tr><th>تنخواه‌دار</th><th>حسابِ تنخواه</th><th>دریافتی</th><th>خرجِ تأییدشده</th><th>منتظرِ تأیید</th><th>مانده نزدِ او</th><th /></tr></thead>
                <tbody>
                  {d.holders.map((h) => (
                    <tr key={h.holder} className={holder === h.holder ? "pc-on" : ""}>
                      <td className="nm">{h.name}{!h.defined && <span className="pill idle" style={{ marginInlineStart: 6 }}>برداشته‌شده</span>}
                        {h.returnedCount > 0 && <span className="pill bad" style={{ marginInlineStart: 6 }}>{faDigits(h.returnedCount)} برگشتی</span>}</td>
                      <td>{h.account ? <><bdi dir="ltr">{h.account}</bdi>{h.bank && <small className="pc-sub">{h.bank}</small>}</>
                        : h.defined ? <button className="linkish" onClick={() => openWho(h)}>وارد کنید</button> : "—"}</td>
                      <td>{faRial(h.charged - h.refunded)}</td><td>{faRial(h.approved)}</td>
                      <td>{h.waiting ? <b style={{ color: "#B26A00" }}>{faRial(h.waiting)}</b> : "—"}</td>
                      <td><b style={h.limit != null && h.balance > h.limit ? { color: "#B02A2A" } : undefined}>{faRial(h.balance)}</b>
                        {h.limit != null && <small className="pc-sub">سقف {faRial(h.limit)}</small>}</td>
                      <td className="pc-cell-btns">
                        <button className="ghost" onClick={() => setHolder(holder === h.holder ? "" : h.holder)}>{holder === h.holder ? "همه" : "فقط این نفر"}</button>
                        {h.defined && h.active && <button className="ghost" onClick={() => open("charge", h.holder)}>شارژ</button>}
                        {h.defined && <button className="ghost" onClick={() => openWho(h)}>مشخصات</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="muted sm2" style={{ marginTop: 8 }}>تنخواه‌دار که تعریف شود، «تنخواهِ من» در منوی خودش می‌آید و خرجش را همان‌جا وارد می‌کند. برای برداشتنِ یک نفر، «مشخصات» را بزنید.</div>
        </div>
      )}

      <div className="card">
        <div className="items-hd">{review ? (holder ? `ریزِ تنخواهِ ${nameOf(holder)}` : "ریزِ تنخواه") : "ریزِ تنخواهِ من"}</div>
        <div className="pc-filters no-print">
          <div className="seg-row" style={{ margin: 0 }}>
            {[["all", "همه"], ["waiting", "منتظرِ تأیید"], ["returned", "برگشتی"], ["approved", "تأییدشده"]].map(([k, label]) => (
              <button key={k} className={status === k ? "seg on" : "seg"} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </div>
        {rows.length === 0 ? <Empty art="finance">{d.rows.length ? "ردیفی با این شرط‌ها نیست." : review ? "هنوز تنخواهی ثبت نشده. اول تنخواه‌دار را تعریف کنید، بعد «+ شارژ تنخواه» را بزنید." : "هنوز چیزی ثبت نشده. خرجتان را با «+ ثبتِ خرج» وارد کنید."}</Empty> : (
          <div className="pc-list">
            {rows.map((r) => (
              <div key={r.id} className={`pc-row ${r.kind}`}>
                <div className="pc-date">{jShort(r.date)}</div>
                <div className="pc-body">
                  <b>{r.title || KIND_TITLE[r.kind]}</b>
                  <div className="pc-meta">
                    {review && <span>{r.holderName}</span>}
                    {r.kind === "expense" ? <><span>{r.categoryLabel}</span><span className="chip">{r.centerLabel}</span></> : <span>{d.kinds[r.kind]}</span>}
                    {r.paidTo && <span>به: {r.paidTo}</span>}
                    {r.kind === "expense" && <span className={STATUS_PILL[r.status]}>{d.statuses[r.status]}</span>}
                  </div>
                  {r.kind === "expense" && r.status === "returned" && r.reviewNote && <div className="pc-note">علتِ برگشت: {r.reviewNote}</div>}
                </div>
                <div className="pc-amt"><b>{r.kind === "charge" ? "+" : "−"}{faRial(r.amount)}</b><small>ریال</small></div>
                <div className="pc-btns no-print">
                  {r.hasReceipt && <button className="ghost" onClick={() => showPhoto(r)}>رسید</button>}
                  {review && r.kind === "expense" && r.status === "waiting" && <button className="ghost ok" disabled={busy} onClick={() => act(() => pettyCashApi.review(r.id, "approve"))}>تأیید</button>}
                  {review && r.kind === "expense" && r.status !== "returned" && <button className="ghost" disabled={busy} onClick={() => setBack({ row: r, note: "" })}>برگشت</button>}
                  {canTouch(r) && <button className="ghost" onClick={() => edit(r)}>ویرایش</button>}
                  {canTouch(r) && <button className="ghost del" disabled={busy} onClick={() => remove(r)}>حذف</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {review && byCenter.length > 0 && (
          <details className="pc-centers">
            <summary>جمعِ خرج به تفکیکِ مرکز هزینه (همین ردیف‌ها)</summary>
            <table className="print-table">
              <thead><tr><th>مرکز هزینه</th><th>تعداد</th><th>مبلغ (ریال)</th></tr></thead>
              <tbody>{byCenter.map((c) => <tr key={c.label}><td className="nm">{c.label}</td><td>{faDigits(c.count)}</td><td><b>{faRial(c.amount)}</b></td></tr>)}</tbody>
            </table>
          </details>
        )}
      </div>

      {form && (
        <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && setForm(null)}>
          <div className="wh-dialog pc-dialog" role="dialog" aria-label={KIND_TITLE[form.kind]}>
            <div className="items-hd">{form.id ? "ویرایش: " : ""}{KIND_TITLE[form.kind]}</div>
            {review && !form.id && (
              <label className="fld"><span>تنخواه‌دار</span>
                <select value={form.holder} onChange={(e) => set("holder", e.target.value)}>
                  {defined.map((h) => <option key={h.holder} value={h.holder}>{h.name}</option>)}
                </select>
              </label>
            )}
            {review && form.kind === "charge" && acct(d.holders.find((h) => h.holder === form.holder))}
            <div className="row2">
              <label className="fld"><span>تاریخ</span><JalaliPicker value={form.date} onChange={(v) => set("date", v)} /></label>
              <label className="fld"><span>مبلغ (ریال)</span>
                <input type="text" inputMode="numeric" placeholder="۰" value={form.amount === "" ? "" : Number(form.amount).toLocaleString("en-US")}
                  onChange={(e) => set("amount", onlyDigits(e.target.value))} />
                {Number(form.amount) >= 10 && <small className="pc-toman">= {faRial(Number(form.amount) / 10)} تومان</small>}
              </label>
            </div>
            <label className="fld"><span>{form.kind === "expense" ? "شرحِ خرج (برای چه بود)" : "شرح (اختیاری)"}</span>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={300}
                placeholder={form.kind === "expense" ? "مثلاً: بنزین، کرایهٔ وانت تا پروژه، خریدِ سنباده" : form.kind === "charge" ? "مثلاً: شارژ مهرماه، کارت‌به‌کارت" : "مثلاً: تسویهٔ آخرِ ماه"} />
            </label>
            {form.kind === "expense" && (
              <>
                <div className="fld"><span>مرکز هزینه (این خرج به حسابِ کجاست؟)</span>
                  <div className="seg-row" style={{ margin: 0 }}>
                    {d.centers.map((c) => <button type="button" key={c.id} className={form.center === c.id ? "seg on" : "seg"} onClick={() => set("center", c.id)}>{c.label}</button>)}
                  </div>
                </div>
                {form.center === "project" && (
                  <label className="fld"><span>کدام پروژه؟</span>
                    <select value={form.project} onChange={(e) => set("project", e.target.value)}>
                      <option value="">— انتخاب کنید —</option>
                      {d.projects.filter((p) => !p.closed || p.id === form.project).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      {d.projects.some((p) => p.closed && p.id !== form.project) && (
                        <optgroup label="پروژه‌های بسته‌شده">{d.projects.filter((p) => p.closed && p.id !== form.project).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
                      )}
                    </select>
                  </label>
                )}
                <div className="row2">
                  <label className="fld"><span>نوعِ خرج</span>
                    <select value={form.category} onChange={(e) => set("category", e.target.value)}>{d.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                  </label>
                  <label className="fld"><span>پرداخت به (اختیاری)</span><input value={form.paidTo} onChange={(e) => set("paidTo", e.target.value)} maxLength={200} placeholder="فروشگاه یا شخص" /></label>
                </div>
                <div className="fld"><span>عکسِ رسید یا فاکتور (اختیاری)</span>
                  <div className="pc-photo">
                    {form.receipt ? <img src={form.receipt} alt="رسید" /> : form.receipt === undefined && form.hasReceipt ? <span className="chip">عکسِ قبلی سرِ جایش است</span> : null}
                    <label className="ghost pc-pick">{form.receipt || (form.receipt === undefined && form.hasReceipt) ? "عوض کردنِ عکس" : "گرفتن یا انتخابِ عکس"}
                      <input type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                    {(form.receipt || (form.receipt === undefined && form.hasReceipt)) && <button type="button" className="ghost del" onClick={() => setForm((f) => ({ ...f, receipt: "", hasReceipt: false }))}>برداشتنِ عکس</button>}
                  </div>
                </div>
              </>
            )}
            {formErr && <div className="err">{formErr}</div>}
            <div className="btn-row">
              <button className="submit" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : form.kind === "expense" ? "ذخیره و فرستادن برای تأیید" : "ذخیره"}</button>
              <button className="ghost" disabled={busy} onClick={() => setForm(null)}>انصراف</button>
            </div>
          </div>
        </div>
      )}

      {back && (
        <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && setBack(null)}>
          <div className="wh-dialog pc-dialog" role="dialog" aria-label="برگشت برای اصلاح">
            <div className="items-hd">برگشت برای اصلاح</div>
            <div className="muted sm2" style={{ marginBottom: 8 }}>{back.row.holderName} — {back.row.title} — {faRial(back.row.amount)} ریال</div>
            <label className="fld"><span>چرا برمی‌گردد؟ (تنخواه‌دار همین را می‌بیند)</span>
              <textarea rows={3} value={back.note} onChange={(e) => setBack((b) => ({ ...b, note: e.target.value }))} placeholder="مثلاً: عکسِ رسید خوانا نیست؛ مرکز هزینه اشتباه است" />
            </label>
            <div className="btn-row">
              <button className="submit" disabled={busy || !back.note.trim()} onClick={() => { const b = back; setBack(null); act(() => pettyCashApi.review(b.row.id, "return", b.note)); }}>برگردان</button>
              <button className="ghost" onClick={() => setBack(null)}>انصراف</button>
            </div>
          </div>
        </div>
      )}

      {who && (
        <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && setWho(null)}>
          <div className="wh-dialog pc-dialog" role="dialog" aria-label="مشخصاتِ تنخواه‌دار">
            <div className="items-hd">{who.isNew ? "تنخواه‌دارِ تازه" : `مشخصاتِ تنخواهِ ${who.name}`}</div>
            {who.isNew && (d.candidates.length === 0 ? <div className="notice">همهٔ کاربرانِ فعال تنخواه‌دارند. کاربرِ تازه را اول در «کاربران» بسازید.</div> : (
              <label className="fld"><span>چه کسی؟ (از کاربرانِ سامانه)</span>
                <select value={who.holder} onChange={(e) => setWho((w) => ({ ...w, holder: e.target.value }))}>
                  {d.candidates.map((c) => <option key={c.username} value={c.username}>{c.name}</option>)}
                </select>
              </label>
            ))}
            <div className="row2">
              <label className="fld"><span>شماره حساب، کارت یا شبا</span>
                <input dir="ltr" inputMode="text" value={who.account} maxLength={40} placeholder="6104 3377 0000 0000" onChange={(e) => setWho((w) => ({ ...w, account: e.target.value }))} />
              </label>
              <label className="fld"><span>بانک</span><input value={who.bank} maxLength={60} placeholder="مثلاً ملت" onChange={(e) => setWho((w) => ({ ...w, bank: e.target.value }))} /></label>
            </div>
            <label className="fld"><span>سقفِ تنخواه (ریال، اختیاری)</span>
              <input type="text" inputMode="numeric" placeholder="بی سقف" value={who.limit === "" ? "" : Number(who.limit).toLocaleString("en-US")}
                onChange={(e) => setWho((w) => ({ ...w, limit: onlyDigits(e.target.value) }))} />
              {Number(who.limit) >= 10 && <small className="pc-toman">= {faRial(Number(who.limit) / 10)} تومان</small>}
            </label>
            <label className="fld"><span>یادداشت (اختیاری)</span><input value={who.note} maxLength={300} placeholder="مثلاً: تنخواهِ سوخت و عوارض" onChange={(e) => setWho((w) => ({ ...w, note: e.target.value }))} /></label>
            {who.isNew && <div className="muted sm2" style={{ marginBottom: 10 }}>با ذخیره، «تنخواهِ من» در منوی این کاربر می‌آید (بارِ بعد که سامانه را باز کند).</div>}
            {whoErr && <div className="err">{whoErr}</div>}
            <div className="btn-row">
              <button className="submit" disabled={busy || !who.holder} onClick={() => saveWho()}>{busy ? "در حال ذخیره…" : "ذخیره"}</button>
              <button className="ghost" disabled={busy} onClick={() => setWho(null)}>انصراف</button>
            </div>
            {!who.isNew && <button className="linkish pc-remove" disabled={busy} onClick={removeWho}>برداشتن از تنخواه‌دارها</button>}
          </div>
        </div>
      )}

      {photo && (
        <div className="doc-overlay" onClick={() => setPhoto(null)}>
          <div className="wh-dialog pc-dialog pc-photo-view" role="dialog" aria-label="عکسِ رسید">
            <div className="items-hd">رسید — {photo.title}</div>
            {photo.data ? <img src={photo.data} alt="رسید" /> : <div className="empty">در حال آوردنِ عکس…</div>}
            <div className="btn-row"><button className="ghost" onClick={() => setPhoto(null)}>بستن</button></div>
          </div>
        </div>
      )}
    </>
  );
}
