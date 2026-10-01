import { useState, useEffect, useCallback } from "react";
import { warehouseApi } from "../../api.js";
import { SkuPicker } from "./vouchers.jsx";
import { DocLetterhead, J_MONTHS, JalaliPicker, PrintableDoc, WhyOff, askConfirm, faDigits, faRial, fq, isoToJ, jLong, jShort, saveSheet, todayIso, useCan } from "../../shared/core.jsx";

/* ---- انبارگردانی: برگهٔ شمارش چندقلمی ---- */
export function CountsPane() {
  const can = useCan();
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(() => warehouseApi.counts()
    .then((d) => { setList(d); setErr(""); })
    .catch((e) => { setErr(e.message); setList((p) => p || []); }), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card">
        <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
          برای شمارش دوره‌ای، برگه‌ای برای یک انبار (یا فقط یک برند یا دسته) بسازید، برگهٔ چاپی را دست انباردار بدهید و
          عدد شمرده‌شدهٔ هر کالا را وارد کنید. کسری و اضافه خودکار حساب می‌شود و با «ثبت نهایی» موجودی همان‌جا اصلاح می‌شود.
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginBottom: 0 }}>
          {can("warehouse.voucher") && (
            <button className="submit" style={{ width: "auto", margin: 0, flex: "0 0 auto" }}
              onClick={() => setCreating(true)}>+ برگهٔ انبارگردانی</button>
          )}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {list === null ? <div className="empty">در حال بارگذاری…</div>
        : list.length === 0 ? <div className="empty">هنوز برگهٔ انبارگردانی ساخته نشده.</div> : (
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead>
              <tr><th>شماره</th><th>عنوان</th><th>تاریخ</th><th>انبار</th><th>محدوده</th>
                <th>شمارش</th><th>نتیجه</th><th>وضعیت</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.status === "draft" ? "vc-draft" : ""}>
                  <td className="vc-num">{faDigits(c.number)}</td>
                  <td className="wh-name">{c.title}</td>
                  <td>{jShort(c.date)}</td>
                  <td>{c.warehouseName}</td>
                  <td>{[c.brand, c.category].filter(Boolean).join(" · ") || "همهٔ کالاها"}</td>
                  <td>{faDigits(c.countedCount)} از {faDigits(c.lineCount)}</td>
                  <td>
                    {c.status !== "posted" ? "—" : (c.shortCount || c.overCount) ? (
                      <>
                        {c.shortCount ? <span className="as-chip bad">{faDigits(c.shortCount)} کسری</span> : null}{" "}
                        {c.overCount ? <span className="as-chip ok">{faDigits(c.overCount)} اضافه</span> : null}
                      </>
                    ) : <span className="as-chip ok">بی‌مغایرت</span>}
                  </td>
                  <td>
                    <span className={c.status === "posted" ? "status-chip vc-posted" : "status-chip vc-open"}>
                      {c.statusLabel}
                    </span>
                  </td>
                  <td className="wh-actions">
                    <button className="link-btn" onClick={() => setOpenId(c.id)}>
                      {c.status === "draft" && can("warehouse.voucher") ? "ادامهٔ شمارش" : "نمایش"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewCountDialog onClose={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false); load(); setOpenId(d.id);
            flash(`برگهٔ ${faDigits(d.number)} با ${faDigits(d.lineCount)} قلم ساخته شد ✓`);
          }} />
      )}
      {openId && (
        <CountSheetDialog id={openId} onClose={() => { setOpenId(null); load(); }}
          onChanged={(t) => { flash(t); load(); }} />
      )}
    </>
  );
}

function NewCountDialog({ onClose, onCreated }) {
  const j = isoToJ(todayIso());
  const [title, setTitle] = useState(`انبارگردانی ${J_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`);
  const [date, setDate] = useState(todayIso());
  const [warehouses, setWarehouses] = useState([]);
  const [meta, setMeta] = useState({ brands: [], categories: [] });
  const [warehouse, setWarehouse] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    warehouseApi.list()
      .then((w) => {
        setWarehouses(w);
        setWarehouse((p) => p || (w.find((x) => !x.suppliesWorkshop) || w[0])?.id || "");
      })
      .catch((e) => setErr(e.message));
    warehouseApi.meta({}).then(setMeta).catch(() => { /* فیلتر اختیاری است */ });
  }, []);

  async function create() {
    if (busy || !title.trim() || !warehouse) return;
    setBusy(true); setErr("");
    try {
      onCreated(await warehouseApi.createCount({ title: title.trim(), date, warehouse, brand, category, includeZero }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog" role="dialog" aria-labelledby="nc-title">
        <div className="board-h" id="nc-title">برگهٔ انبارگردانی جدید</div>
        <label className="fld"><span>عنوان</span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row2">
          <label className="fld"><span>تاریخ شمارش</span><JalaliPicker value={date} onChange={setDate} /></label>
          <label className="fld"><span>انبار</span>
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row2">
          <label className="fld"><span>برند (اختیاری)</span>
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">همهٔ برندها</option>
              {(meta.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="fld"><span>دسته (اختیاری)</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">همهٔ دسته‌ها</option>
              {(meta.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            {" "}کالاهای بدون موجودی هم در برگه بیاید
          </label>
        </div>
        <div className="muted sm2" style={{ lineHeight: 1.9 }}>
          {includeZero
            ? "همهٔ کالاهای این انبار می‌آیند؛ برای برگهٔ کوچک‌تر برند یا دسته را انتخاب کنید."
            : "فقط کالاهایی که در این انبار موجودی دارند می‌آیند. کالای پیدا‌شده‌ای که در برگه نیست را بعداً می‌توانید اضافه کنید."}
          {" "}مغایرت با موجودی دفتر در تاریخ شمارش سنجیده می‌شود.
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={busy || !title.trim() || !warehouse} onClick={create}>{busy ? "…" : "ساختن برگه"}</button>
        </div>
        <WhyOff busy={busy} reasons={[!title.trim() && "عنوان برگه نوشته نشده", !warehouse && "انبار انتخاب نشده"]} />
      </div>
    </div>
  );
}
/** نوشتن شمارش هر قلم، دیدن مغایرت و ثبت نهایی. */
function CountSheetDialog({ id, onClose, onChanged }) {
  const can = useCan();
  const [sheet, setSheet] = useState(null);
  const [vals, setVals] = useState({});          // شناسهٔ ردیف ← { c: شمارش، n: یادداشت }
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(false);
  const [printing, setPrinting] = useState(false);

  const seed = (d) => {
    setSheet(d);
    setVals(Object.fromEntries(d.lines.map((l) => [l.id, {
      c: l.countedQty == null ? "" : String(l.countedQty), n: l.note || "",
    }])));
  };
  useEffect(() => { warehouseApi.count(id).then(seed).catch((e) => setErr(e.message)); }, [id]);

  if (!sheet) {
    return (
      <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wh-dialog">
          {err ? <div className="err" role="alert">{err}</div> : <div className="empty">در حال بارگذاری…</div>}
          <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div>
        </div>
      </div>
    );
  }

  const posted = sheet.status === "posted";
  const editable = !posted && can("warehouse.voucher");
  const withCost = sheet.lines.some((l) => l.unitCost !== undefined);
  const rows = sheet.lines.map((l) => {
    const v = vals[l.id] || { c: "", n: "" };
    const c = v.c === "" ? null : Number(v.c);
    const bad = c != null && (Number.isNaN(c) || c < 0);
    const diff = posted ? l.diff : (c == null || bad ? null : Math.round((c - l.currentQty) * 1000) / 1000);
    const dirty = !posted && (v.c !== (l.countedQty == null ? "" : String(l.countedQty)) || v.n !== (l.note || ""));
    return { ...l, v, c, bad, diff, dirty };
  });
  const dirty = rows.filter((r) => r.dirty);
  const anyBad = rows.some((r) => r.bad);
  const counted = rows.filter((r) => (posted ? r.countedQty != null : r.c != null && !r.bad));
  const short = counted.filter((r) => r.diff < 0);
  const over = counted.filter((r) => r.diff > 0);
  const money = (list) => list.reduce((a, r) => a + Math.abs(r.diff || 0) * (r.unitCost || 0), 0);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    const hit = filter === "all" || (filter === "uncounted"
      ? (posted ? r.countedQty == null : r.c == null)
      : Boolean(r.diff));
    return hit && (!needle || [r.name, r.code, r.brand, r.shelf, r.shade]
      .some((x) => (x || "").toLowerCase().includes(needle)));
  });

  const run = async (fn) => {
    if (busy) return;
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  async function save(quiet) {
    if (anyBad) throw new Error("شمارش باید عدد صفر یا بیشتر باشد؛ خانه‌های قرمز را درست کنید.");
    if (!dirty.length) return;
    const d = await warehouseApi.updateCount(sheet.id, {
      lines: dirty.map((r) => ({ id: r.id, countedQty: r.v.c === "" ? null : Number(r.v.c), note: r.v.n })),
    });
    seed(d);
    if (!quiet) onChanged("شمارش‌ها ذخیره شد ✓");
  }
  async function post() {
    if (anyBad) { setErr("شمارش باید عدد صفر یا بیشتر باشد؛ خانه‌های قرمز را درست کنید."); return; }
    const ok = await askConfirm({
      title: `ثبت نهایی ${faDigits(sheet.number)}`,
      message: `${faDigits(counted.length)} قلم از ${faDigits(rows.length)} قلم شمرده شده: `
        + `${faDigits(short.length)} کسری و ${faDigits(over.length)} اضافه در «${sheet.warehouseName}» اصلاح می‌شود.`
        + (rows.length - counted.length ? `\n${faDigits(rows.length - counted.length)} قلمِ شمرده‌نشده دست نمی‌خورد.` : "")
        + "\nپس از ثبت، برگه دیگر ویرایش نمی‌شود.",
      confirmLabel: "ثبت نهایی",
    });
    if (!ok) return;
    run(async () => {
      await save(true);
      seed(await warehouseApi.postCount(sheet.id));
      onChanged(`${faDigits(sheet.number)} ثبت نهایی شد و موجودی اصلاح شد ✓`);
    });
  }
  async function remove() {
    const ok = await askConfirm({
      title: `پاک کردن ${faDigits(sheet.number)}`,
      message: "برگه و همهٔ شمارش‌های نوشته‌شده پاک می‌شود.\nاین کار برگشت ندارد.",
      confirmLabel: "پاک کن", danger: true,
    });
    if (!ok) return;
    run(async () => { await warehouseApi.removeCount(sheet.id); onChanged("برگهٔ انبارگردانی پاک شد"); onClose(); });
  }
  async function closeDialog() {
    if (dirty.length) {
      const ok = await askConfirm({
        title: "شمارش‌های ذخیره‌نشده",
        message: `${faDigits(dirty.length)} ردیف تغییر کرده و ذخیره نشده است.`,
        confirmLabel: "بستن بدون ذخیره", danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }
  const addSku = (row) => run(async () => {
    await save(true);
    seed(await warehouseApi.addCountLine(sheet.id, row.id));
    onChanged(`«${row.productName}» به برگه اضافه شد`);
  });
  const nextInput = (e, i) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = document.querySelector(`[data-cnt="${i + 1}"]`);
    if (el) el.focus();
  };
  function exportXlsx() {
    const head = ["#", "کالا", "شناسه", "برند", "بسته", "قفسه", "واحد", "موجودی دفتر", "شمارش", "مغایرت",
      ...(withCost ? ["قیمت خرید", "مبلغ مغایرت"] : []), "یادداشت"];
    const body = rows.map((r, i) => [
      i + 1, r.name, r.code, r.brand, r.packSize, r.shelf, r.baseUnit, r.currentQty,
      (posted ? r.countedQty : r.c) ?? "", r.diff ?? "",
      ...(withCost ? [r.unitCost || 0, r.diff ? Math.abs(r.diff) * (r.unitCost || 0) : 0] : []), r.v.n,
    ]);
    saveSheet(sheet.number, "انبارگردانی", [head, ...body]);
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && closeDialog()}>
      <div className="wh-dialog cnt-dialog" role="dialog" aria-labelledby="cnt-title">
        <div className="user-dialog-hd">
          <div className="ud-name">
            <b id="cnt-title">{sheet.title}</b>
            <small>
              {faDigits(sheet.number)} · {jLong(sheet.date)} · {sheet.warehouseName}
              {[sheet.brand, sheet.category].filter(Boolean).length ? ` · ${[sheet.brand, sheet.category].filter(Boolean).join(" · ")}` : ""}
              {" · "}{sheet.createdBy}
            </small>
          </div>
          <span className={posted ? "as-chip ok" : "as-chip info"}>{sheet.statusLabel}</span>
        </div>

        <div className="asset-flags">
          <span>{faDigits(rows.length)} قلم</span>
          <span>شمرده‌شده: <b>{faDigits(counted.length)}</b></span>
          <span>کسری: <b className="diff-neg">{faDigits(short.length)}</b>
            {withCost && short.length ? ` (${faRial(money(short))} ریال)` : ""}</span>
          <span>اضافه: <b className="diff-pos">{faDigits(over.length)}</b>
            {withCost && over.length ? ` (${faRial(money(over))} ریال)` : ""}</span>
          {posted && sheet.postedBy && <span>ثبت نهایی: {sheet.postedBy}</span>}
        </div>
        {editable && (
          <div className="muted sm2" style={{ margin: "-4px 2px 10px", lineHeight: 1.9 }}>
            خانهٔ شمارشِ خالی یعنی آن قلم شمرده نشده و دست نمی‌خورد. با Enter به ردیف بعد بروید.
          </div>
        )}

        <div className="cnt-tools">
          <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجو در برگه: نام، شناسه، برند یا قفسه…" />
          <div className="seg-row" style={{ margin: 0 }} role="tablist">
            {[["all", "همه"], ["uncounted", "شمرده‌نشده"], ["diff", "مغایرت‌دار"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "seg on" : "seg"}
                onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="tbl-scroll cnt-scroll">
          <table className="print-table wh-table cnt-table">
            <thead>
              <tr><th>#</th><th>کالا</th><th>قفسه</th><th>موجودی دفتر</th><th>شمارش</th><th>مغایرت</th>
                {withCost && <th>مبلغ مغایرت</th>}<th>یادداشت</th></tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id} className={r.diff < 0 ? "cnt-short" : r.diff > 0 ? "cnt-over" : ""}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="wh-name">
                    {r.name}
                    <div className="wh-sub">
                      <span>شناسه {r.code}</span>{r.brand && <span>{r.brand}</span>}{r.packSize && <span>{r.packSize}</span>}
                    </div>
                  </td>
                  <td>{r.shelf || "—"}</td>
                  <td className="wh-qty">
                    {fq(r.currentQty)} <small className="wh-unit">{r.baseUnit}</small>
                    {r.moved && <div className="wh-sub"><span>پس از ساخت برگه گردش خورده</span></div>}
                  </td>
                  <td>
                    {editable ? (
                      <input className={r.bad ? "cnt-in bad" : "cnt-in"} type="number" min="0" step="any"
                        inputMode="decimal" data-cnt={i} value={r.v.c} aria-label={`شمارش ${r.name}`}
                        onKeyDown={(e) => nextInput(e, i)}
                        onChange={(e) => setVals((p) => ({ ...p, [r.id]: { ...p[r.id], c: e.target.value } }))} />
                    ) : r.countedQty == null ? <span className="muted">شمرده نشد</span> : <b>{fq(r.countedQty)}</b>}
                  </td>
                  <td className={r.diff < 0 ? "wh-qty diff-neg" : r.diff > 0 ? "wh-qty diff-pos" : "wh-qty"}>
                    {r.diff == null ? "—" : r.diff === 0 ? "✓" : `${r.diff > 0 ? "+" : "−"}${fq(Math.abs(r.diff))}`}
                  </td>
                  {withCost && <td>{r.diff && r.unitCost ? faRial(Math.abs(r.diff) * r.unitCost) : "—"}</td>}
                  <td>
                    {editable ? (
                      <input className="cnt-note" value={r.v.n} aria-label={`یادداشت ${r.name}`}
                        onChange={(e) => setVals((p) => ({ ...p, [r.id]: { ...p[r.id], n: e.target.value } }))} />
                    ) : (r.note || "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <div className="empty">ردیفی با این فیلتر نیست.</div>}
        {editable && <button className="add-row" onClick={() => setPicking(true)}>+ کالایی که در برگه نیست</button>}

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row cnt-foot">
          <button className="ghost" onClick={closeDialog} disabled={busy}>بستن</button>
          <button className="ghost" onClick={() => setPrinting(true)}>چاپ برگه</button>
          <button className="ghost" onClick={exportXlsx}>اکسل</button>
          {editable && <button className="ghost" onClick={remove} disabled={busy}>پاک کردن</button>}
          {editable && (
            <button className="ghost" disabled={busy || !dirty.length} onClick={() => run(() => save(false))}>
              ذخیره{dirty.length ? ` (${faDigits(dirty.length)})` : ""}
            </button>
          )}
          {editable && can("warehouse.post") && (
            <button className="submit" onClick={post} disabled={busy}>{busy ? "…" : "ثبت نهایی"}</button>
          )}
        </div>
        {editable && <WhyOff label="ذخیره" busy={busy} reasons={[!dirty.length && "هنوز شمارشی را عوض نکرده‌اید"]} />}

        {picking && <SkuPicker warehouse={sheet.warehouse} onPick={addSku} onClose={() => setPicking(false)} />}
        {printing && <CountPrintDoc sheet={sheet} onClose={() => setPrinting(false)} />}
      </div>
    </div>
  );
}
/** برگهٔ چاپی: پیش از شمارش بی موجودی دفتر (تا شمارنده تحت تأثیر نباشد)، پس از ثبت با نتیجه. */
function CountPrintDoc({ sheet, onClose }) {
  const posted = sheet.status === "posted";
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet wide">
        <DocLetterhead title={posted ? "نتیجهٔ انبارگردانی" : "برگهٔ شمارش انبار"} subtitle={faDigits(sheet.number)} />
        <div className="doc-info">
          <div><span>عنوان</span><b>{sheet.title}</b></div>
          <div><span>تاریخ شمارش</span><b>{jLong(sheet.date)}</b></div>
          <div><span>انبار</span><b>{sheet.warehouseName}</b></div>
          <div><span>محدوده</span><b>{[sheet.brand, sheet.category].filter(Boolean).join(" · ") || "همهٔ کالاها"}</b></div>
        </div>
        <table className="doc-table">
          <thead>
            <tr>
              <th>#</th><th>کالا</th><th>شناسه</th><th>قفسه</th><th>واحد</th>
              {posted ? <><th>دفتر</th><th>شمارش</th><th>مغایرت</th></> : <th>شمارش</th>}
              <th>یادداشت</th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((l, i) => (
              <tr key={l.id}>
                <td>{faDigits(i + 1)}</td>
                <td className="nm">{l.name}{l.packSize ? ` · ${l.packSize}` : ""}</td>
                <td>{l.code}</td>
                <td className="nm">{l.shelf || ""}</td>
                <td className="nm">{l.baseUnit}</td>
                {posted ? (
                  <>
                    <td className="net">{fq(l.currentQty)}</td>
                    <td className="net">{l.countedQty == null ? "—" : fq(l.countedQty)}</td>
                    <td className="net">
                      {l.diff ? `${l.diff > 0 ? "+" : "−"}${fq(Math.abs(l.diff))}` : l.countedQty == null ? "—" : "✓"}
                    </td>
                  </>
                ) : <td className="cnt-blank" />}
                <td className="nm">{posted ? (l.note || "") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="doc-sign">
          <div>شمارنده: ......................................</div>
          <div>انباردار: ......................................</div>
          <div>تأیید مدیر: ......................................</div>
        </div>
        <div className="doc-foot">
          Diwaj ERP (برنامه‌ریزی منابع سازمان) · {posted ? "ثبت نهایی شده" : "برگهٔ شمارش — موجودی دفتر عمداً چاپ نشده است"}
        </div>
      </div>
    </PrintableDoc>
  );
}
