import { useState, useEffect, useCallback } from "react";
import { warehouseApi } from "../../api.js";
import { ItemEditor } from "./itemEditor.jsx";
import { Empty, askConfirm, faDigits, showMessage } from "../../shared/core.jsx";

export function ItemsPane() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [brands, setBrands] = useState([]);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [noUnits, setNoUnits] = useState(false);
  const [mine, setMine] = useState(false);
  const [noWhName, setNoWhName] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);   // "new" یا خودِ کالا

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [qDebounced, brand, noUnits, mine, noWhName]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await warehouseApi.items({
        q: qDebounced, brand, page,
        noUnits: noUnits ? 1 : "", mine: mine ? 1 : "", noWarehouseName: noWhName ? 1 : "",
      });
      setRows(d.results || []);
      setCount(d.count || 0);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [qDebounced, brand, page, noUnits, mine, noWhName]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    warehouseApi.meta({}).then((m) => setBrands(m.brands || [])).catch(() => {});
  }, []);

  async function onSaved(saved, isNew) {
    setEditing(null);
    flash(isNew ? `«${saved.name}» تعریف شد ✓` : `«${saved.name}» ذخیره شد ✓`);
    if (isNew) { setPage(1); await reload(); }
    else setRows((p) => p.map((r) => (r.id === saved.id ? saved : r)));
  }

  async function remove(row) {
    const ok = await askConfirm({
      title: `حذف «${row.name}»`,
      message: "این کالا از فهرست کالاها حذف می‌شود.\nاین کار برگشت ندارد.",
      confirmLabel: "حذف کالا", danger: true,
    });
    if (!ok) return;
    try {
      await warehouseApi.removeItem(row.id);
      setRows((p) => p.filter((r) => r.id !== row.id));
      setCount((c) => c - 1);
      flash("حذف شد.");
    } catch (e) { showMessage({ title: "کالا حذف نشد", message: e.message }); }
  }

  const pageCount = Math.max(1, Math.ceil(count / 40));

  if (err && !rows.length) return <div className="notice warn">{err}</div>;

  return (
    <>
      <div className="card">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام کالا، کد انبار، کد SKU، بارکد یا برند…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={noUnits}
              onChange={(e) => setNoUnits(e.target.checked)} /> فقط بدون بسته‌بندی فرعی
          </label>
          <label>
            <input type="checkbox" checked={mine}
              onChange={(e) => setMine(e.target.checked)} /> فقط کالاهای تعریف‌شدهٔ خودمان
          </label>
          <label>
            <input type="checkbox" checked={noWhName}
              onChange={(e) => setNoWhName(e.target.checked)} /> فقط بدون نام انبار
          </label>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
        <button className="submit" onClick={() => setEditing("new")}>+ تعریف کالای جدید</button>
      </div>

      {loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? <Empty art="warehouse">کالایی با این فیلترها نیست.</Empty> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr>
                  <th>کالا</th><th>برند</th><th>کد انبار</th><th>کد SKU</th>
                  <th>بسته‌بندی</th><th>موجودی</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "wh-off"}>
                    <td className="wh-name">
                      {r.name}
                      <div className="wh-sub">
                        {/* برچسب رنگ/اندازه فقط برای انبار است؛ سایت فروش فقط نام خودش را نشان می‌دهد. */}
                        {r.siteParent
                          ? <span>زیرمجموعهٔ بستهٔ سایت «{r.siteParentName}» · {r.variantLabel}</span>
                          : r.siteName && r.siteName !== r.name && <span>سایت: {r.siteName}</span>}
                        {r.variantCount > 0
                          ? <span className="wh-flag">بستهٔ سایت · {faDigits(r.variantCount)} زیرمجموعه در انبار</span>
                          : r.unitOf
                            ? <span className="wh-flag">بستهٔ دیگرِ «{r.unitOf.name}» · هر بسته {faDigits(r.unitOf.perPack)} {r.unitOf.baseUnit}</span>
                            : !r.warehouseName && <span className="wh-flag">بدون نام انبار</span>}
                        {r.barcode && <span>بارکد {r.barcode}</span>}
                        {r.packSize && <span>{r.packSize}</span>}
                        {r.hazardous && <span className="wh-flag haz">آتش‌زا</span>}
                        {r.batchTracked && <span className="wh-flag">بچ‌دار</span>}
                        {!r.active && <span className="wh-flag">غیرفعال</span>}
                      </div>
                    </td>
                    <td>{r.brand || "—"}</td>
                    <td>{r.warehouseCode || "—"}</td>
                    <td>{r.skuCode}</td>
                    <td>
                      {r.baseUnit || "—"}
                      <div className="wh-sub">
                        {r.altUnit
                          ? <span>۱ {r.baseUnit} = {faDigits(r.altPerBase)} {r.altUnit}</span>
                          : <span>بدون واحد فرعی</span>}
                      </div>
                    </td>
                    <td className="wh-qty">{faDigits(r.onHand)}</td>
                    <td className="wh-actions">
                      <button className="act edit" onClick={() => setEditing(r)}>ویرایش</button>
                      {!r.onHand && (
                        <button className="link-btn" onClick={() => remove(r)}>حذف</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="wh-pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} کالا</span>
            <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {editing && (
        <ItemEditor item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </>
  );
}
