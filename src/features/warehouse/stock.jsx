import { useState, useEffect, useMemo, useCallback } from "react";
import { warehouseApi } from "../../api.js";
import { KardexDialog, StockMoveDialog, UnpackDialog } from "./setup.jsx";
import { faDigits, fetchAllPages, hasAccess, saveSheet, showMessage } from "../../shared/core.jsx";

export function StockPane({ session }) {
  const [warehouses, setWarehouses] = useState([]);
  const [meta, setMeta] = useState({ brands: [], categories: [], totals: {} });
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [wh, setWh] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [belowMin, setBelowMin] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [uncounted, setUncounted] = useState(false);
  const [moveFor, setMoveFor] = useState(null);   // ردیفی که برایش گردش ثبت می‌شود
  const [historyFor, setHistoryFor] = useState(null);
  const [unpackFor, setUnpackFor] = useState(null);
  const [exporting, setExporting] = useState(false);

  const canSeeCost = hasAccess(session, "warehouse.cost");
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  // جست‌وجو با کمی تأخیر تا با هر حرف یک درخواست نرود.
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [wh, brand, category, qDebounced, belowMin, inStock, uncounted]);

  const params = useMemo(() => ({
    warehouse: wh, brand, category, q: qDebounced,
    below_min: belowMin ? 1 : "", in_stock: inStock ? 1 : "",
    uncounted: uncounted ? 1 : "", page,
  }), [wh, brand, category, qDebounced, belowMin, inStock, uncounted, page]);

  useEffect(() => {
    (async () => {
      try {
        const w = await warehouseApi.list();
        setWarehouses(w);
      } catch (e) { setErr(e.message); }
    })();
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [data, m] = await Promise.all([
        warehouseApi.stock(params),
        warehouseApi.meta({ warehouse: wh, brand, category, q: qDebounced }),
      ]);
      setRows(data.results || []);
      setCount(data.count || 0);
      setMeta(m);
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [params, wh, brand, category, qDebounced]);

  useEffect(() => { reload(); }, [reload]);

  /** قفسه و حداقل موجودی برای یک کالا در یک انبار مشخص ذخیره می‌شود. */
  async function saveCell(row, warehouseId, field, value) {
    try {
      const updated = await warehouseApi.updateStock(row.id, { warehouse: warehouseId, [field]: value });
      setRows((p) => p.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      alert(e.message);
    }
  }

  const totals = meta.totals || {};
  const pageCount = Math.ceil(count / 60) || 1;
  // وقتی یک انبار انتخاب شده فقط همان ستون می‌آید و قفسه/حداقل قابل ویرایش است.
  const shownWarehouses = wh ? warehouses.filter((w) => w.id === wh) : warehouses;
  const oneWarehouse = shownWarehouses.length === 1;

  /** همان چیزی که با فیلترهای الان در جدول است، ولی همهٔ صفحه‌ها. */
  async function exportStock() {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await fetchAllPages(warehouseApi.stock, params);
      const head = ["کالا", "نام سایت", "برند", "دسته", "بسته", "گرید/شید", "شناسه", "واحد",
        ...shownWarehouses.map((w) => w.name)];
      if (shownWarehouses.length > 1) head.push("جمع");
      if (oneWarehouse) head.push("قفسه", "حداقل");
      if (canSeeCost) head.push("قیمت خرید");
      const body = all.map((r) => {
        const cell = (wid) => (r.stock || []).find((s) => s.warehouse === wid);
        const row = [r.productName, r.siteName || "", r.brand, r.category, r.packSize,
          [r.grit, r.shade].filter(Boolean).join(" / "), r.packageId, r.baseUnit,
          ...shownWarehouses.map((w) => { const c = cell(w.id); return c && c.known ? c.onHand : ""; })];
        if (shownWarehouses.length > 1) row.push(r.totalOnHand || 0);
        if (oneWarehouse) { const c = cell(shownWarehouses[0].id); row.push(c?.shelfCode || "", c?.minQty || 0); }
        if (canSeeCost) row.push(r.costPrice || 0);
        return row;
      });
      saveSheet("موجودی-انبار", "موجودی", [head, ...body]);
    } catch (e) {
      showMessage({ title: "خروجی اکسل ساخته نشد", message: e.message });
    } finally {
      setExporting(false);
    }
  }

  if (err && !rows.length) return <div className="notice warn">{err}</div>;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(totals.rows ?? 0)}</b><span>ردیف انبار</span></div>
        <div className="stat"><b>{faDigits(totals.in_stock ?? 0)}</b><span>دارای موجودی</span></div>
        <div className={totals.below ? "stat warn" : "stat"}>
          <b>{faDigits(totals.below ?? 0)}</b><span>زیر حداقل</span>
        </div>
        <div className={totals.uncounted ? "stat warn" : "stat"}>
          <b>{faDigits(totals.uncounted ?? 0)}</b><span>شمارش‌نشده</span>
        </div>
        <div className="stat"><b>{faDigits(warehouses.length)}</b><span>انبار</span></div>
      </div>

      <div className="card">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام کالا، کد، شناسه بسته، گرید، شید یا قفسه…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">همهٔ انبارها</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {(meta.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">همهٔ دسته‌ها</option>
            {(meta.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="wh-toggles">
          <label><input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} /> فقط زیر حداقل موجودی</label>
          <label><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> فقط دارای موجودی</label>
          <label><input type="checkbox" checked={uncounted} onChange={(e) => setUncounted(e.target.checked)} /> فقط شمارش‌نشده‌ها</label>
          <button className="link-btn" disabled={exporting || !count} onClick={exportStock}>
            {exporting ? "در حال ساختن اکسل…" : "📊 خروجی اکسل"}
          </button>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? <div className="empty">کالایی با این فیلترها نیست.</div> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr>
                  <th>کالا</th><th>برند</th><th>بسته</th><th>گرید/شید</th>
                  {/* ستون موجودی برای هر انبار جدا؛ وقتی یک انبار انتخاب شده فقط همان. */}
                  {shownWarehouses.map((w) => <th key={w.id}>{w.name}</th>)}
                  {shownWarehouses.length > 1 && <th>جمع</th>}
                  {oneWarehouse && <><th>قفسه</th><th>حداقل</th></>}
                  {canSeeCost && <th>قیمت خرید</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cell = (wid) => (r.stock || []).find((s) => s.warehouse === wid);
                  const anyLow = (r.stock || []).some((s) => s.minQty > 0 && s.onHand < s.minQty);
                  const only = oneWarehouse ? cell(shownWarehouses[0].id) : null;
                  return (
                    <tr key={r.id} className={anyLow ? "wh-low" : ""}>
                      <td className="wh-name">
                        {r.productName}
                        <div className="wh-sub">
                          {r.code && <span>کد {r.code}</span>}
                          <span>شناسه {r.packageId}</span>
                          {r.hazardous && <span className="wh-flag haz">آتش‌زا</span>}
                          {r.batchTracked && <span className="wh-flag">بچ‌دار</span>}
                        </div>
                      </td>
                      <td>{r.brand}</td>
                      <td>{r.packSize}</td>
                      <td>{[r.grit, r.shade].filter(Boolean).join(" / ") || "—"}</td>
                      {shownWarehouses.map((w) => {
                        const c = cell(w.id);
                        const low = c && c.minQty > 0 && c.onHand < c.minQty;
                        // صفرِ شمرده‌نشده ادعا نیست؛ نباید مثل صفرِ قطعی دیده شود.
                        const unknown = c && !c.known;
                        return (
                          <td key={w.id} className={low ? "wh-qty low" : "wh-qty"}>
                            {!c ? "—" : unknown
                              ? <span className="wh-unknown" title="در فرم انبارگردانی برای این قلم عددی نوشته نشده">شمارش نشده</span>
                              : <>{faDigits(c.onHand)} <small className="wh-unit">{r.baseUnit}</small></>}
                          </td>
                        );
                      })}
                      {shownWarehouses.length > 1 && (
                        <td className="wh-qty total">{faDigits(r.totalOnHand || 0)}</td>
                      )}
                      {oneWarehouse && (
                        <>
                          <td><input className="wh-cell" defaultValue={only?.shelfCode || ""}
                            onBlur={(e) => only && e.target.value !== (only.shelfCode || "")
                              && saveCell(r, only.warehouse, "shelfCode", e.target.value)} /></td>
                          <td><input className="wh-cell narrow" defaultValue={only?.minQty ?? 0}
                            onBlur={(e) => only && Number(e.target.value) !== only.minQty
                              && saveCell(r, only.warehouse, "minQty", Number(e.target.value) || 0)} /></td>
                        </>
                      )}
                      {canSeeCost && <td>{r.costPrice ? faDigits(Math.round(r.costPrice)) : "—"}</td>}
                      <td className="wh-actions">
                        <button className="act edit" onClick={() => setMoveFor(r)}>ثبت گردش</button>
                        {oneWarehouse && (
                          <button className="link-btn" onClick={() => setUnpackFor(r)}>شکستن بسته</button>
                        )}
                        <button className="link-btn" onClick={() => setHistoryFor(r)}>کاردکس</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!oneWarehouse && (
            <div className="muted sm2" style={{ marginTop: 6 }}>
              برای ویرایش قفسه و حداقل موجودی، یک انبار را از فیلتر بالا انتخاب کنید.
            </div>
          )}

          <div className="wh-pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} ردیف</span>
            <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {moveFor && (
        <StockMoveDialog row={moveFor} warehouses={warehouses} defaultWarehouse={wh || warehouses[0]?.id}
          onClose={() => setMoveFor(null)}
          onDone={(label) => { setMoveFor(null); flash(label); reload(); }} />
      )}
      {historyFor && (
        <KardexDialog sku={historyFor} warehouses={warehouses} warehouse={wh} onClose={() => setHistoryFor(null)} />
      )}
      {unpackFor && (
        <UnpackDialog row={unpackFor} warehouse={wh} onClose={() => setUnpackFor(null)}
          onDone={(label) => { setUnpackFor(null); flash(label); reload(); }} />
      )}
    </>
  );
}
