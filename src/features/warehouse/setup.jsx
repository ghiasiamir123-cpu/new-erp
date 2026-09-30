import { useState, useEffect } from "react";
import { warehouseApi } from "../../api.js";
import { DateRange, JalaliPicker, MOVE_KINDS, PackQty, faDigits, fq, jShort, openPackText, saveSheet, todayIso } from "../../shared/core.jsx";

export function WarehouseSetupPane() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  const [whName, setWhName] = useState("");
  const [whCode, setWhCode] = useState("");
  const [whWorkshop, setWhWorkshop] = useState(false);

  const [item, setItem] = useState({ name: "", brand: "", category: "", code: "", packSize: "", batchTracked: false, hazardous: false });

  const [file, setFile] = useState(null);
  const [report, setReport] = useState("");

  async function addWarehouse() {
    if (!whName.trim() || busy) return;
    setBusy(true);
    try {
      await warehouseApi.createWarehouse({ name: whName.trim(), code: whCode.trim(), suppliesWorkshop: whWorkshop });
      setWhName(""); setWhCode(""); setWhWorkshop(false);
      flash("انبار ساخته شد ✓ — همهٔ کالاها در آن ردیف گرفتند.");
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function addItem() {
    if (!item.name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await warehouseApi.createWorkshopItem(item);
      setItem({ name: "", brand: "", category: "", code: "", packSize: "", batchTracked: false, hazardous: false });
      flash(`«${r.name}» اضافه شد ✓ (شناسه ${r.packageId})`);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function runImport(dryRun) {
    if (!file || busy) return;
    setBusy(true); setReport("");
    try {
      const r = await warehouseApi.importCatalog(file, dryRun);
      setReport(r.report || "");
      flash(dryRun ? "بررسی انجام شد — چیزی ذخیره نشد." : "فایل وارد شد ✓");
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className="notice">{msg}</div>}

      <div className="card">
        <div className="board-h">بارگذاری فایل اکسل سایت</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          فایل انبارگردانی سایت را اینجا بدهید. کالای جدید اضافه می‌شود، قیمت‌ها به‌روز می‌شوند،
          و اگر ستون «تعداد موجود» پر باشد موجودی هم تنظیم می‌شود. اگر همان فایل را دوباره بدهید،
          چیزی دوبار حساب نمی‌شود.
        </div>
        <input type="file" accept=".xlsx,.xlsm" className="fld"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setReport(""); }} />
        {file && <div className="muted sm2" style={{ marginTop: 6 }}>فایل انتخاب‌شده: {file.name}</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="ghost" disabled={!file || busy} onClick={() => runImport(true)}>
            اول بررسی کن (بدون ذخیره)
          </button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={!file || busy} onClick={() => runImport(false)}>
            {busy ? "در حال پردازش…" : "وارد کن"}
          </button>
        </div>
        {report && <pre className="import-report">{report}</pre>}
      </div>

      <div className="card">
        <div className="board-h">انبار جدید</div>
        <div className="row2">
          <label className="fld"><span>نام انبار</span>
            <input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="مثلاً: انبار شیراز" />
          </label>
          <label className="fld"><span>کد (اختیاری)</span>
            <input value={whCode} onChange={(e) => setWhCode(e.target.value)} />
          </label>
        </div>
        <label className="wh-check">
          <input type="checkbox" checked={whWorkshop} onChange={(e) => setWhWorkshop(e.target.checked)} />
          کارگاه مواد خود را از این انبار برمی‌دارد
        </label>
        <button className="submit" disabled={!whName.trim() || busy} onClick={addWarehouse}>ساخت انبار</button>
      </div>

      <div className="card">
        <div className="board-h">کالای کارگاهی (غیرفروشی)</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          برای موادی مثل پولچم و والرسا که در سایت فروش نیستند. کالای فروشی را اینجا نسازید —
          از فایل اکسل سایت وارد کنید تا شناسه‌اش با سایت یکی بماند.
        </div>
        <div className="row2">
          <label className="fld"><span>نام کالا</span>
            <input value={item.name} onChange={(e) => setItem((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label className="fld"><span>برند</span>
            <input value={item.brand} onChange={(e) => setItem((p) => ({ ...p, brand: e.target.value }))} />
          </label>
        </div>
        <div className="row3">
          <label className="fld sm"><span>دسته</span>
            <input value={item.category} onChange={(e) => setItem((p) => ({ ...p, category: e.target.value }))} />
          </label>
          <label className="fld sm"><span>کد</span>
            <input value={item.code} onChange={(e) => setItem((p) => ({ ...p, code: e.target.value }))} />
          </label>
          <label className="fld sm"><span>واحد / اندازه</span>
            <input value={item.packSize} onChange={(e) => setItem((p) => ({ ...p, packSize: e.target.value }))} placeholder="کیلوگرم" />
          </label>
        </div>
        <label className="wh-check">
          <input type="checkbox" checked={item.batchTracked}
            onChange={(e) => setItem((p) => ({ ...p, batchTracked: e.target.checked }))} />
          بچ و تاریخ انقضا دارد (رنگ و هاردنر)
        </label>
        <label className="wh-check">
          <input type="checkbox" checked={item.hazardous}
            onChange={(e) => setItem((p) => ({ ...p, hazardous: e.target.checked }))} />
          آتش‌زا (تینر و حلال)
        </label>
        <button className="submit" disabled={!item.name.trim() || busy} onClick={addItem}>افزودن کالا</button>
      </div>
    </>
  );
}
/** ثبت یک گردش انبار برای یک کالا. */
export function StockMoveDialog({ row, warehouses, defaultWarehouse, onClose, onDone }) {
  const [warehouse, setWarehouse] = useState(defaultWarehouse || warehouses[0]?.id || "");
  const [kind, setKind] = useState("receipt");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [date, setDate] = useState(todayIso());
  const [unitCost, setUnitCost] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const info = MOVE_KINDS.find((k) => k.id === kind) || MOVE_KINDS[0];
  const isReceipt = kind === "receipt";
  const here = (row.stock || []).find((s) => s.warehouse === warehouse);
  const valid = warehouse && Number(qty) !== 0 && !Number.isNaN(Number(qty));

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await warehouseApi.addMovement({
        sku: row.id, warehouse, kind,
        qty: Number(qty), unit, date,
        unitCost: Number(unitCost) || 0,
        batch_no: batchNo.trim() || undefined,
        expires_on: expires || undefined,
        note: note.trim(),
      });
      onDone(`${info.label} ثبت شد ✓`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">ثبت گردش انبار</div>
        <div className="wh-dialog-item">
          <b>{row.productName}</b>
          <div className="muted sm2">
            {row.packSize}{[row.grit, row.shade].filter(Boolean).length ? " · " + [row.grit, row.shade].filter(Boolean).join(" / ") : ""}
            {" · "}شناسه {row.packageId}
          </div>
        </div>

        <label className="fld"><span>انبار</span>
          <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            {warehouses.map((w) => {
              const c = (row.stock || []).find((s) => s.warehouse === w.id);
              return <option key={w.id} value={w.id}>{w.name} — موجودی {c ? c.onHand : 0}</option>;
            })}
          </select>
        </label>

        <label className="fld"><span>نوع گردش</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {MOVE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>

        <div className="row3">
          <label className="fld sm"><span>
            مقدار {info.dir === "out" ? "(کم می‌شود)" : info.dir === "in" ? "(اضافه می‌شود)" : ""}
          </span>
            <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="۰" />
          </label>
          <label className="fld sm"><span>واحد</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!row.altUnit}>
              <option value="">{row.baseUnit || "واحد اصلی"}</option>
              {row.altUnit && <option value={row.altUnit}>{row.altUnit}</option>}
            </select>
          </label>
          <label className="fld sm"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
        </div>
        {unit && row.altUnit === unit && row.altToBase ? (
          <div className="unit-hint">
            {faDigits(Number(qty) || 0)} {unit} = {faDigits(((Number(qty) || 0) * row.altToBase).toFixed(3))} {row.baseUnit}
          </div>
        ) : null}

        {isReceipt && (
          <label className="fld"><span>قیمت خرید هر واحد (ریال، اختیاری)</span>
            <input type="number" inputMode="numeric" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </label>
        )}

        {row.batchTracked && isReceipt && (
          <div className="row2">
            <label className="fld"><span>شمارهٔ بچ</span>
              <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="روی حلب نوشته شده" />
            </label>
            <label className="fld"><span>تاریخ انقضا</span>
              {expires
                ? <button className="date-fil on" onClick={() => setExpires("")}>{jShort(expires)} ✕</button>
                : <div className="date-fil-wrap"><JalaliPicker value={todayIso()} onChange={setExpires} /></div>}
            </label>
          </div>
        )}

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً شمارهٔ فاکتور" />
        </label>

        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={!valid || busy} onClick={save}>
            {busy ? "در حال ثبت…" : "ثبت"}
          </button>
        </div>
      </div>
    </div>
  );
}
/** شکستن بسته: یک جعبه به معادل دانه‌اش تبدیل می‌شود.

 *  چون جعبه و دانه در سایت دو کالای جداست، انباری که فقط جعبه دارد بدون این
 *  کار نمی‌تواند سفارش دانه‌ای را جواب دهد. */
export function UnpackDialog({ row, warehouse, onClose, onDone }) {
  const [info, setInfo] = useState(null);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    warehouseApi.canUnpack(row.id)
      .then(setInfo)
      .catch(() => setInfo({ canUnpack: false }));
  }, [row]);

  const here = (row.stock || []).find((s) => s.warehouse === warehouse);
  const onHand = here ? here.onHand : 0;
  const boxes = Number(qty) || 0;
  const valid = info?.canUnpack && boxes > 0 && boxes <= onHand;

  async function run() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await warehouseApi.unpack({ sku: row.id, warehouse, qty: boxes });
      onDone(`${faDigits(r.boxes)} بسته شکسته شد ← ${faDigits(r.pieces)} عدد ✓`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">شکستن بسته</div>
        {info === null ? <div className="empty">…</div>
          : !info.canUnpack ? (
            <>
              <div className="empty">برای این کالا معادل دانه‌ای تعریف نشده است.</div>
              <div className="muted sm2">
                شکستن بسته فقط برای کالایی ممکن است که هم جعبه‌ای و هم تکی در فهرست سایت باشد.
              </div>
            </>
          ) : (
            <>
              <div className="wh-dialog-item">
                <b>{row.productName}</b>
                <div className="muted sm2">
                  {info.boxLabel} · موجودی {faDigits(onHand)} {row.baseUnit}
                </div>
              </div>
              <div className="unit-hint">۱ {row.packSize} = {faDigits(info.factor)} عدد</div>
              <label className="fld"><span>چند بسته باز می‌شود؟</span>
                <input type="number" inputMode="decimal" value={qty}
                  onChange={(e) => setQty(e.target.value)} />
              </label>
              {boxes > onHand && <div className="notice warn">بیشتر از موجودی است.</div>}
              {valid && (
                <div className="unit-hint">
                  {faDigits(boxes)} بسته کم و {faDigits(boxes * info.factor)} عدد اضافه می‌شود.
                </div>
              )}
            </>
          )}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          {info?.canUnpack && (
            <button className="submit" style={{ width: "auto", margin: 0 }}
              disabled={!valid || busy} onClick={run}>{busy ? "…" : "شکستن"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
/** کاردکس: همهٔ گردش‌های یک کالا با ماندهٔ پس از هر ردیف. */
export function KardexDialog({ sku, warehouses, warehouse, from: from0, to: to0, onClose }) {
  const [wh, setWh] = useState(warehouse || "");
  const [from, setFrom] = useState(from0 || "");
  const [to, setTo] = useState(to0 || "");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setData(null);
    warehouseApi.kardex({ sku: sku.id, warehouse: wh, from, to })
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) { setErr(e.message); setData({ rows: [] }); } });
    return () => { live = false; };
  }, [sku.id, wh, from, to]);

  const unit = data?.sku?.baseUnit || sku.baseUnit || "";
  // واحد فرعی تا ماندهٔ بستهٔ باز شکسته دیده شود: «۲ حلب + ۱۶ کیلوگرم».
  const pack = { baseUnit: unit, altUnit: data?.sku?.altUnit ?? sku.altUnit, altToBase: data?.sku?.altToBase ?? sku.altToBase };
  const openText = (q) => openPackText(q, pack.baseUnit, pack.altUnit, pack.altToBase);
  // مقداری که کاربر وارد کرده، اگر به واحد دیگری بوده («۲ کیلوگرم»).
  const entered = (r) => (r.enteredUnit && r.enteredUnit !== unit && r.enteredQty != null ? `${fq(r.enteredQty)} ${r.enteredUnit}` : "");
  function exportXlsx() {
    saveSheet(`کاردکس-${data.sku.code}`, "کاردکس", [
      [`کاردکس ${data.sku.name} (${data.sku.code}) — ${data.warehouse || "همهٔ انبارها"} — واحد: ${unit}`],
      ["تاریخ", "شرح", "شماره", "طرف مقابل", "انبار", "ورود", "خروج", "مقدار ثبت‌شده", "مانده", "ماندهٔ بستهٔ باز", "ثبت‌کننده", "توضیح"],
      [from ? jShort(from) : "", "موجودی اول دوره", "", "", "", "", "", "", data.opening, openText(data.opening), "", ""],
      ...data.rows.map((r) => [jShort(r.date), r.kindLabel, r.number || r.ref || "", r.party || "", r.warehouse,
        r.in || "", r.out || "", entered(r), r.balance, openText(r.balance), r.by, r.note || ""]),
      [to ? jShort(to) : "", "جمع و موجودی پایان دوره", "", "", "", data.in, data.out, "", data.closing, openText(data.closing), "", ""],
    ]);
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide" role="dialog" aria-labelledby="kx-title">
        <div className="board-h" id="kx-title">کاردکس کالا</div>
        <div className="wh-dialog-item">
          <b>{sku.productName || sku.name}</b>
          <div className="muted sm2">
            {[sku.packSize, `شناسه ${sku.packageId || sku.code}`, unit && `واحد: ${unit}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="filters">
          <select value={wh} onChange={(e) => setWh(e.target.value)} aria-label="انبار">
            <option value="">همهٔ انبارها</option>
            {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />

        {err ? <div className="notice warn">{err}</div>
          : data === null ? <div className="empty">در حال بارگذاری…</div> : (
          <>
            <div className="asset-flags" style={{ margin: "12px 2px" }}>
              <span>اول دوره: <b>{fq(data.opening)}</b></span>
              <span>ورود: <b className="diff-pos">{fq(data.in)}</b></span>
              <span>خروج: <b className="diff-neg">{fq(data.out)}</b></span>
              <span>پایان دوره: <b><PackQty q={data.closing} {...pack} /></b></span>
            </div>
            {data.rows.length === 0 ? <div className="empty">در این بازه گردشی ثبت نشده.</div> : (
              <div className="tbl-scroll">
                <table className="print-table wh-table">
                  <thead>
                    <tr><th>تاریخ</th><th>شرح</th>{!wh && <th>انبار</th>}<th>ورود</th><th>خروج</th><th>مانده</th>
                      <th>ثبت‌کننده</th><th>توضیح</th></tr>
                  </thead>
                  <tbody>
                    <tr className="kx-edge">
                      <td>{from ? jShort(from) : "—"}</td>
                      <td colSpan={wh ? 3 : 4}>موجودی اول دوره</td>
                      <td className="wh-qty"><PackQty q={data.opening} {...pack} showUnit={false} /></td>
                      <td colSpan={2} />
                    </tr>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{jShort(r.date)}</td>
                        <td>{r.kindLabel}
                          <div className="wh-sub">
                            {r.number ? <span>{faDigits(r.number)}</span> : r.ref ? <span>{r.ref}</span> : null}
                            {r.party && <span>{r.party}</span>}
                            {r.batchNo && <span>بچ {r.batchNo}</span>}
                          </div>
                        </td>
                        {!wh && <td>{r.warehouse}</td>}
                        <td className="wh-qty diff-pos">{r.in ? fq(r.in) : ""}
                          {r.in && entered(r) ? <div className="wh-sub"><span>{entered(r)}</span></div> : null}</td>
                        <td className="wh-qty diff-neg">{r.out ? fq(r.out) : ""}
                          {r.out && entered(r) ? <div className="wh-sub"><span>{entered(r)}</span></div> : null}</td>
                        <td className={r.balance < 0 ? "wh-qty low" : "wh-qty"}>
                          <PackQty q={r.balance} {...pack} showUnit={false} /></td>
                        <td>{r.by}</td>
                        <td>{r.note || "—"}</td>
                      </tr>
                    ))}
                    <tr className="kx-edge">
                      <td>{to ? jShort(to) : "امروز"}</td>
                      <td colSpan={wh ? 1 : 2}>جمع دوره و موجودی پایان دوره</td>
                      <td className="wh-qty diff-pos">{fq(data.in)}</td>
                      <td className="wh-qty diff-neg">{fq(data.out)}</td>
                      <td className="wh-qty"><PackQty q={data.closing} {...pack} showUnit={false} /></td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {data.truncated && (
              <div className="muted sm2">فقط ۳٬۰۰۰ ردیف اول نشان داده شد؛ بازهٔ تاریخ را کوتاه‌تر کنید. جمع‌ها کامل‌اند.</div>
            )}
          </>
        )}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>بستن</button>
          <button className="ghost" disabled={!data?.rows?.length} onClick={exportXlsx}>خروجی اکسل</button>
        </div>
      </div>
    </div>
  );
}
