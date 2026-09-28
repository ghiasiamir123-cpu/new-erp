import { useState, useEffect, useCallback } from "react";
import { warehouseApi } from "../../api.js";
import { FinanceReplyDialog } from "../finance.jsx";
import { HoldersPane } from "./turnover.jsx";
import { DateRange, DocLetterhead, Empty, JalaliPicker, PrintableDoc, askConfirm, faDigits, fetchAllPages, hasAccess, jLong, jShort, saveSheet, showMessage, todayIso, uid, useCan } from "../../shared/core.jsx";

/* ---- حواله‌های ورود و خروج ---- */
const VOUCHER_KINDS = [
  { id: "receipt", label: "ورود کالا (خرید)", dir: "in" },
  { id: "return", label: "مرجوعی از مشتری", dir: "in" },
  { id: "transfer_in", label: "دریافت از انبار دیگر", dir: "in" },
  { id: "return_person", label: "برگشت از شخص", dir: "in", person: true },
  { id: "sale", label: "فروش", dir: "out" },
  { id: "workshop", label: "مصرف کارگاه", dir: "out" },
  { id: "transfer_out", label: "انتقال به انبار دیگر", dir: "out" },
  { id: "issue_person", label: "تحویل به شخص", dir: "out", person: true },
];

export function VoucherPane({ session }) {
  const [warehouses, setWarehouses] = useState([]);
  const [list, setList] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [fKind, setFKind] = useState("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [section, setSection] = useState("list");   // فهرست حواله‌ها یا کالای دست اشخاص
  const [holdersKey, setHoldersKey] = useState(0);  // پس از ثبت حواله، فهرست دست اشخاص تازه شود
  const [exporting, setExporting] = useState(false);
  const [template, setTemplate] = useState(null);   // حوالهٔ آماده (برگشت کالا از شخص)
  const [editing, setEditing] = useState(null);   // حوالهٔ در حال ویرایش یا "new"
  const [viewing, setViewing] = useState(null);
  const [replying, setReplying] = useState(null);   // حوالهٔ برگشتی از مالی
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [shortage, setShortage] = useState(null);   // کمبود موجودی هنگام ثبت نهایی
  const [confirmPost, setConfirmPost] = useState(null);   // حواله‌ای که تأیید ثبت نهایی‌اش باز است
  const [posting, setPosting] = useState(false);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  useEffect(() => {
    warehouseApi.list().then(setWarehouses).catch((e) => setErr(e.message));
  }, []);

  // جست‌وجو نام کالا را هم می‌گردد و سنگین‌تر است؛ با هر حرف یک درخواست نرود.
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await warehouseApi.vouchers({ status: fStatus, kind: fKind, q: qd, from, to, page });
      setList(d.results || []);
      setCount(d.count || 0);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [fStatus, fKind, qd, from, to, page]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setPage(1); }, [fStatus, fKind, qd, from, to]);

  const openTemplate = (tpl) => { setTemplate(tpl); setEditing("new"); };

  /** همان حواله‌هایی که با فیلترهای الان در فهرست‌اند، یک سطر برای هر قلم کالا. */
  async function exportVouchers() {
    if (exporting) return;
    setExporting(true);
    try {
      const all = await fetchAllPages(warehouseApi.vouchers, { status: fStatus, kind: fKind, q: qd, from, to });
      const cost = hasAccess(session, "warehouse.cost");
      const head = ["شماره", "تاریخ", "نوع", "جهت", "انبار", "طرف مقابل", "شمارهٔ فاکتور", "وضعیت", "وضعیت مالی",
        "کالا", "شناسه", "بسته", "مقدار", "واحد", ...(cost ? ["قیمت واحد", "مبلغ"] : []), "ثبت‌کننده", "توضیح"];
      const body = all.flatMap((v) => (v.lines || []).map((l) => [
        v.number, jShort(v.date), v.movementKindLabel, v.isInbound ? "ورود" : "خروج", v.warehouseName,
        v.toWarehouseName ? `← ${v.toWarehouseName}` : (v.counterparty || ""), v.ref || "", v.statusLabel,
        v.financeStatus && v.financeStatus !== "none" ? v.financeStatusLabel : "",
        l.productName, l.packageId, l.packSize, l.qty, l.unit || l.baseUnit,
        ...(cost ? [l.unitCost || 0, (l.qty || 0) * (l.unitCost || 0)] : []), v.createdBy, v.note || "",
      ]));
      saveSheet("حواله‌های-انبار", "حواله‌ها", [head, ...body]);
    } catch (e) {
      showMessage({ title: "خروجی اکسل ساخته نشد", message: e.message });
    } finally {
      setExporting(false);
    }
  }

  const postVoucher = (v) => setConfirmPost(v);

  async function doPost(v) {
    setPosting(true);
    try {
      await warehouseApi.postVoucher(v.id);
      setConfirmPost(null);
      flash(`حوالهٔ ${v.number} ثبت شد ✓`);
      reload();
    } catch (e) {
      setConfirmPost(null);
      if (e.data?.shortage) setShortage({ ...e.data.shortage, v });
      else alert(e.message);
    } finally {
      setPosting(false);
    }
  }

  async function removeVoucher(v) {
    const n = (v.lines || []).length;
    const ok = await askConfirm({
      title: `حذف حوالهٔ ${faDigits(v.number)}`,
      message: `حوالهٔ ${v.movementKindLabel}${v.counterparty ? ` «${v.counterparty}»` : ""} با ${faDigits(n)} قلم کالا حذف شود؟\nاین کار برگشت ندارد.`,
      confirmLabel: "حذف حواله", danger: true,
    });
    if (!ok) return;
    try {
      await warehouseApi.removeVoucher(v.id);
      flash("حذف شد");
      reload();
    } catch (e) { showMessage({ title: "حواله حذف نشد", message: e.message }); }
  }

  const pageCount = Math.ceil(count / 60) || 1;
  const editorEl = editing && (
    <VoucherEditor voucher={editing === "new" ? null : editing} initial={editing === "new" ? template : null}
      warehouses={warehouses}
      onClose={() => { setEditing(null); setTemplate(null); }}
      onSaved={(label) => {
        setEditing(null); setTemplate(null); flash(label); reload(); setHoldersKey((k) => k + 1);
      }} />
  );
  const segRow = (
    <div className="seg-row" role="tablist">
      {[["list", "فهرست حواله‌ها"], ["holders", "کالای دست اشخاص"]].map(([k, l]) => (
        <button key={k} role="tab" aria-selected={section === k} className={section === k ? "seg on" : "seg"}
          onClick={() => setSection(k)}>{l}</button>
      ))}
    </div>
  );
  if (section === "holders") {
    return (
      <>
        {segRow}
        <HoldersPane key={holdersKey} session={session} onVoucher={openTemplate} />
        {editorEl}
      </>
    );
  }
  if (err && !list.length) return <>{segRow}<div className="notice warn">{err}</div></>;

  return (
    <>
      {segRow}
      {confirmPost && (
        <PostConfirmDialog summary={voucherSummary(confirmPost)} busy={posting}
          onConfirm={() => doPost(confirmPost)} onClose={() => setConfirmPost(null)} />
      )}
      {shortage && (
        <ShortageDialog data={shortage} onClose={() => setShortage(null)}
          onEdit={() => { setEditing(shortage.v); setShortage(null); }} />
      )}
      {replying && (
        <FinanceReplyDialog voucher={replying} onClose={() => setReplying(null)}
          onDone={(text) => { setReplying(null); flash(text); reload(); }} />
      )}
      <div className="card">
        <div className="btn-row" style={{ marginBottom: 10 }}>
          {hasAccess(session, "warehouse.voucher") && (
            <button className="submit" style={{ width: "auto", margin: 0 }}
              onClick={() => setEditing("new")}>+ حوالهٔ جدید</button>
          )}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: شمارهٔ حواله، طرف مقابل، شمارهٔ فاکتور یا نام کالا…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">همهٔ وضعیت‌ها</option>
            <option value="draft">پیش‌نویس</option>
            <option value="posted">ثبت نهایی</option>
          </select>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)}>
            <option value="">همهٔ انواع</option>
            {VOUCHER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="wh-toggles">
          <button className="link-btn" disabled={exporting || !count} onClick={exportVouchers}>
            {exporting ? "در حال ساختن اکسل…" : "📊 خروجی اکسل"}
          </button>
        </div>
      </div>

      {loading && !list.length ? <div className="empty">در حال بارگذاری…</div>
        : list.length === 0 ? <Empty art="warehouse">حواله‌ای ثبت نشده.</Empty> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead>
                <tr>
                  <th>شماره</th><th>تاریخ</th><th>نوع</th><th>انبار</th>
                  <th>طرف مقابل</th><th>اقلام</th><th>وضعیت</th><th>ثبت‌کننده</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.id} className={v.status === "draft" ? "vc-draft" : ""}>
                    <td className="vc-num">{v.number}</td>
                    <td>{jShort(v.date)}</td>
                    <td>
                      <span className={v.isInbound ? "vc-dir in" : "vc-dir out"}>
                        {v.isInbound ? "ورود" : "خروج"}
                      </span> {v.movementKindLabel}
                    </td>
                    <td>{v.warehouseName}</td>
                    <td>{v.toWarehouseName ? `← ${v.toWarehouseName}` : (v.counterparty || "—")}</td>
                    <td>{faDigits((v.lines || []).length)}</td>
                    <td>
                      <span className={v.status === "posted" ? "status-chip vc-posted" : "status-chip vc-open"}>
                        {v.statusLabel}
                      </span>
                      {v.financeStatus && v.financeStatus !== "none" && (
                        <span className={`status-chip fin-${v.financeStatus}`}>{v.financeStatusLabel}</span>
                      )}
                      {v.financeStatus === "returned" && (
                        <div className="fin-return-note">
                          <span><b>مالی:</b> {v.financeNote}</span>
                          {hasAccess(session, "warehouse.voucher") && (
                            <button className="link-btn" onClick={() => setReplying(v)}>پاسخ و ارسال دوباره</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{v.createdBy}</td>
                    <td className="wh-actions">
                      <button className="link-btn" onClick={() => setViewing(v)}>نمایش</button>
                      {v.status === "draft" && (
                        <>
                          {hasAccess(session, "warehouse.voucher") && <button className="act edit" onClick={() => setEditing(v)}>ویرایش</button>}
                          {hasAccess(session, "warehouse.post") && <button className="act ok" onClick={() => postVoucher(v)}>ثبت نهایی</button>}
                          {hasAccess(session, "warehouse.voucher") && <button className="del" onClick={() => removeVoucher(v)}>حذف</button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="wh-pager">
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} حواله</span>
            <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {editorEl}
      {viewing && <VoucherDoc voucher={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
/** ساخت و ویرایش حواله با چند قلم کالا. */
function VoucherEditor({ voucher, initial, warehouses, onClose, onSaved }) {
  // «initial» حوالهٔ آماده است (مثلاً برگشت کالا از شخص) — هنوز ذخیره نشده، پس پیش‌نویسی هم ندارد.
  const base = voucher || initial || null;
  const [kind, setKind] = useState(base?.movementKind || "receipt");
  const [date, setDate] = useState(base?.date || todayIso());
  // پیش‌فرض، انبارِ اصلی است نه اولین اسم الفبا: با ساختن یک انبار فرعی،
  // حواله‌ها نباید ناخواسته از آن یکی برداشت کنند.
  // انباری که مصرف کارگاه از آن کم می‌شود («انبار مصرفی تولید») انبار اصلی نیست: خرید و فروش از انبار مرکزی است.
  const mainWarehouse = warehouses.find((w) => !w.suppliesWorkshop) || warehouses[0];
  const [warehouse, setWarehouse] = useState(() =>
    (warehouses.some((w) => w.id === base?.warehouse) ? base.warehouse : mainWarehouse?.id) || "");
  const [toWarehouse, setToWarehouse] = useState(base?.toWarehouse || "");
  const [counterparty, setCounterparty] = useState(base?.counterparty || "");
  const [ref, setRef] = useState(base?.ref || "");
  const [note, setNote] = useState(base?.note || "");
  const [people, setPeople] = useState([]);   // نام کسانی که پیش‌تر کالا تحویل گرفته‌اند
  const [lines, setLines] = useState(() => (base?.lines || []).map((l) => ({
    key: uid(), sku: l.sku, label: `${l.productName} · ${l.packSize}`,
    qty: String(l.qty), unit: l.unit || "", unitCost: String(l.unitCost || ""),
    batchNo: l.batchNo || "", expiresOn: l.expiresOn || "", batchTracked: l.batchTracked,
    baseUnit: l.baseUnit, altUnit: l.altUnit,
  })));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(voucher || null);
  const [confirming, setConfirming] = useState(false);
  const canPost = useCan()("warehouse.post");
  const [shortage, setShortage] = useState(null);

  const info = VOUCHER_KINDS.find((k) => k.id === kind) || VOUCHER_KINDS[0];
  const inbound = info.dir === "in";
  const isTransfer = kind === "transfer_out";
  const srcName = warehouses.find((w) => w.id === warehouse)?.name || "";
  const dstName = warehouses.find((w) => w.id === toWarehouse)?.name || "";
  const valid = warehouse && lines.length > 0 && lines.every((l) => Number(l.qty) > 0)
    && (!isTransfer || (toWarehouse && toWarehouse !== warehouse))
    && (!info.person || counterparty.trim());

  // نام‌های پیشین، تا «محمدرضا نیازی» و «محمدرضا  نیازی» دو نفر نشوند.
  useEffect(() => {
    if (!info.person) return;
    warehouseApi.holders({ all: 1 })
      .then((d) => setPeople((d.people || []).map((p) => p.name)))
      .catch(() => { /* پیشنهاد نام است؛ نبودنش مانع ثبت حواله نیست */ });
  }, [info.person]);

  const setLine = (key, k, v) => setLines((p) => p.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  const delLine = (key) => setLines((p) => p.filter((l) => l.key !== key));

  function addPicked(row) {
    setLines((p) => {
      if (p.some((l) => l.sku === row.id)) return p;   // همان کالا دوبار در یک حواله نیاید
      return [...p, {
        key: uid(), sku: row.id,
        label: `${row.productName} · ${row.packSize}${row.grit ? " · " + row.grit : ""}${row.shade ? " · " + row.shade : ""}`,
        qty: "", unit: "", unitCost: "", batchNo: "", expiresOn: "", batchTracked: row.batchTracked,
        baseUnit: row.baseUnit, altUnit: row.altUnit, altToBase: row.altToBase,
      }];
    });
  }

  async function save(thenPost) {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body = {
        movementKind: kind, date, warehouse,
        toWarehouse: isTransfer ? toWarehouse : null,
        counterparty: counterparty.trim(), ref: ref.trim(), note: note.trim(),
        lines: lines.map((l) => ({
          sku: l.sku, qty: Number(l.qty), unit: l.unit || "",
          unitCost: Number(l.unitCost) || 0,
          batchNo: l.batchNo.trim(), expiresOn: l.expiresOn || null,
        })),
      };
      const saved = draft
        ? await warehouseApi.updateVoucher(draft.id, body)
        : await warehouseApi.createVoucher(body);
      // از اینجا هر ذخیرهٔ دوباره همین پیش‌نویس را اصلاح می‌کند، نه حوالهٔ تازه — اگر ثبت نهایی رد شود
      // و کاربر دوباره بزند، حوالهٔ تکراری ساخته نمی‌شود.
      setDraft(saved);
      if (thenPost) {
        try {
          await warehouseApi.postVoucher(saved.id);
        } catch (e) {
          if (e.data?.shortage) { setShortage(e.data.shortage); return; }
          alert(`حوالهٔ ${saved.number} به‌صورت «پیش‌نویس» ذخیره شد ولی ثبت نهایی نشد و روی موجودی اثری ندارد:\n\n${e.message}\n\nانبار یا مقدارها را اصلاح کنید و دوباره «ثبت نهایی» بزنید.`);
          return;
        }
        onSaved(`حوالهٔ ${saved.number} ثبت نهایی شد ✓`);
      } else {
        onSaved(`حوالهٔ ${saved.number} ذخیره شد ✓`);
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide">
        <div className="board-h">{voucher ? `ویرایش حوالهٔ ${voucher.number}` : "حوالهٔ جدید"}</div>

        <div className="row2">
          <label className="fld"><span>نوع حواله</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {VOUCHER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <label className="fld"><span>{isTransfer ? "از انبار (مبدأ)" : "انبار"}</span>
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row2">
          <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
          {isTransfer ? (
            <label className="fld"><span>به انبار (مقصد)</span>
              <select value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)}>
                <option value="">— انتخاب کنید —</option>
                {warehouses.filter((w) => w.id !== warehouse).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="fld">
              <span>{info.person
                ? (inbound ? "برگرداننده (شخص یا بخش)" : "تحویل‌گیرنده (شخص یا بخش)")
                : inbound ? "تأمین‌کننده / فرستنده" : "تحویل‌گیرنده / مقصد"}</span>
              <input value={counterparty} list={info.person ? "vc-people" : undefined}
                placeholder={info.person ? "مثلاً: محمدرضا نیازی — مونتاژ" : ""}
                onChange={(e) => setCounterparty(e.target.value)} />
              {info.person && <datalist id="vc-people">{people.map((n) => <option key={n} value={n} />)}</datalist>}
            </label>
          )}
        </div>
        {isTransfer && (
          <div className="unit-hint">
            {srcName && dstName
              ? <>کالا از <b>{srcName}</b> کم و به <b>{dstName}</b> اضافه می‌شود.</>
              : "یک حواله هر دو طرف را ثبت می‌کند: از مبدأ کم و به مقصد اضافه می‌شود."}
          </div>
        )}
        <label className="fld"><span>شمارهٔ فاکتور یا بارنامه (اختیاری)</span>
          <input value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>

        <div className="items-hd">اقلام حواله</div>
        {lines.length === 0 && <div className="muted sm2" style={{ marginBottom: 8 }}>هنوز کالایی اضافه نشده.</div>}
        {lines.map((l, i) => (
          <div className="item-row" key={l.key}>
            <div className="item-num">{faDigits(i + 1)}</div>
            <div className="item-body">
              <div className="vc-line-name">{l.label}</div>
              <div className="row3">
                <label className="fld sm"><span>مقدار</span>
                  <input type="number" inputMode="decimal" value={l.qty}
                    onChange={(e) => setLine(l.key, "qty", e.target.value)} placeholder="۰" />
                </label>
                <label className="fld sm"><span>واحد</span>
                  <select value={l.unit} onChange={(e) => setLine(l.key, "unit", e.target.value)}
                    disabled={!l.altUnit}>
                    <option value="">{l.baseUnit || "واحد اصلی"}</option>
                    {l.altUnit && <option value={l.altUnit}>{l.altUnit}</option>}
                  </select>
                </label>
                {inbound && !info.person && (
                  <label className="fld sm"><span>قیمت خرید واحد</span>
                    <input type="number" inputMode="numeric" value={l.unitCost}
                      onChange={(e) => setLine(l.key, "unitCost", e.target.value)} />
                  </label>
                )}
                {inbound && l.batchTracked && (
                  <label className="fld sm"><span>شمارهٔ بچ</span>
                    <input value={l.batchNo} onChange={(e) => setLine(l.key, "batchNo", e.target.value)} />
                  </label>
                )}
              </div>
            </div>
            <button className="item-del" onClick={() => delLine(l.key)}>×</button>
          </div>
        ))}
        <button className="add-row" onClick={() => setPicking(true)}>+ افزودن کالا</button>

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="ghost" disabled={!valid || busy} onClick={() => save(false)}>
            ذخیرهٔ پیش‌نویس
          </button>
          {canPost && (
            <button className="submit" style={{ width: "auto", margin: 0 }}
              disabled={!valid || busy} onClick={() => setConfirming(true)}>
              {busy ? "…" : "ذخیره و ثبت نهایی"}
            </button>
          )}
        </div>
        <div className="muted sm2" style={{ marginTop: 6 }}>
          پیش‌نویس روی موجودی اثری ندارد. با «ثبت نهایی» موجودی تغییر می‌کند و حواله قفل می‌شود.
        </div>

        {picking && <SkuPicker warehouse={warehouse} onPick={addPicked} onClose={() => setPicking(false)} />}
        {confirming && (
          <PostConfirmDialog busy={busy}
            summary={{
              number: draft?.number, kind: info.label, inbound, warehouse: srcName,
              toWarehouse: isTransfer ? dstName : "", counterparty: counterparty.trim(), date,
              lines: lines.map((l) => ({ name: l.label, qty: l.qty, unit: l.unit || l.baseUnit })),
            }}
            onConfirm={async () => { await save(true); setConfirming(false); }}
            onClose={() => setConfirming(false)} />
        )}
        {shortage && <ShortageDialog data={shortage} onClose={() => setShortage(null)} />}
      </div>
    </div>
  );
}
/** خلاصهٔ حوالهٔ ذخیره‌شده برای پنجرهٔ تأیید ثبت نهایی. */
const voucherSummary = (v) => ({
  number: v.number, kind: v.movementKindLabel, inbound: v.isInbound, warehouse: v.warehouseName,
  toWarehouse: v.toWarehouseName || "", counterparty: v.counterparty, date: v.date,
  lines: (v.lines || []).map((l) => ({
    name: [l.productName, l.packSize].filter(Boolean).join(" · "), qty: l.qty, unit: l.unit || l.baseUnit,
  })),
});
/** تأیید ثبت نهایی حواله — به‌جای پنجرهٔ confirm مرورگر. انبار درشت دیده می‌شود تا اشتباهش پیش از ثبت پیدا شود. */
function PostConfirmDialog({ summary: s, busy, onConfirm, onClose }) {
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog short-dialog" role="dialog" aria-labelledby="post-title">
        <div className="short-head">
          <span className="short-icon post" aria-hidden="true">✓</span>
          <div>
            <div className="short-title" id="post-title">
              ثبت نهایی {s.number ? `حوالهٔ ${faDigits(s.number)}` : "حواله"}
            </div>
            <div className="muted sm2">پس از ثبت، موجودی انبار تغییر می‌کند و حواله دیگر ویرایش نمی‌شود.</div>
          </div>
        </div>
        <div className="post-facts">
          <div><span>نوع</span><b>{s.kind}</b></div>
          <div className="post-wh"><span>{s.inbound ? "به انبار" : "از انبار"}</span><b>{s.warehouse}</b></div>
          {s.toWarehouse && <div className="post-wh"><span>به انبار</span><b>{s.toWarehouse}</b></div>}
          {s.counterparty && <div><span>طرف مقابل</span><b>{s.counterparty}</b></div>}
          {s.date && <div><span>تاریخ</span><b>{jShort(s.date)}</b></div>}
        </div>
        <div className="tbl-scroll post-lines">
          <table className="print-table wh-table short-table">
            <thead><tr><th>#</th><th>کالا</th><th>مقدار</th></tr></thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="wh-name"><span dir="auto">{l.name}</span></td>
                  <td className="wh-qty">{faDigits(Number(l.qty))} {l.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button className="ghost" disabled={busy} onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy} onClick={onConfirm}>
            {busy ? "در حال ثبت…" : "ثبت نهایی"}
          </button>
        </div>
      </div>
    </div>
  );
}
/** «ثبت نهایی نشد»: کمبود هر کالا و موجودی‌اش در انبارهای دیگر — به‌جای پنجرهٔ خام مرورگر. */
function ShortageDialog({ data, onClose, onEdit }) {
  const fmt = (n) => faDigits(Number(Number(n).toFixed(3)));
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog short-dialog" role="alertdialog" aria-labelledby="short-title">
        <div className="short-head">
          <span className="short-icon" aria-hidden="true">!</span>
          <div>
            <div className="short-title" id="short-title">حوالهٔ {faDigits(data.voucher)} ثبت نهایی نشد</div>
            <div className="muted sm2">
              موجودی «{data.warehouse}» برای این کالاها کافی نیست. حواله پیش‌نویس مانده و روی موجودی اثری ندارد.
            </div>
          </div>
        </div>
        {data.wrongWarehouse && (
          <div className="notice warn short-hint">
            همهٔ این کالاها در انبار دیگری موجودند؛ احتمالاً انبار حواله اشتباه انتخاب شده.
            حواله را ویرایش کنید و انبار را عوض کنید.
          </div>
        )}
        <div className="tbl-scroll">
          <table className="print-table wh-table short-table">
            <thead><tr><th>کالا</th><th>لازم</th><th>موجودی این انبار</th><th>انبارهای دیگر</th></tr></thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i}>
                  <td className="wh-name">
                    <span dir="auto">{it.name}</span>
                    {it.siteName && it.siteName !== it.name && <div className="wh-sub"><span dir="auto">{it.siteName}</span></div>}
                  </td>
                  <td className="wh-qty">{fmt(it.need)} {it.unit}</td>
                  <td className="wh-qty low">{fmt(it.have)}</td>
                  <td>
                    {it.elsewhere.length
                      ? it.elsewhere.map((o) => <div key={o.warehouse}>{o.warehouse}: <b>{fmt(o.qty)}</b></div>)
                      : <span className="wh-flag haz">در هیچ انباری نیست</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          {onEdit && <button className="act edit" onClick={onEdit}>ویرایش حواله</button>}
          <button className="ghost" onClick={onClose}>بستن</button>
        </div>
      </div>
    </div>
  );
}

export function SkuPicker({ warehouse, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await warehouseApi.stock({ q: q.trim(), warehouse, page_size: 25 });
        setRows(d.results || []);
      } catch { /* پیام خطا لازم نیست؛ فهرست خالی می‌ماند */ } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, warehouse]);

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">انتخاب کالا</div>
        <input className="wh-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="نام، کد، شناسه، گرید یا شید…" />
        <div className="pick-list">
          {loading ? <div className="empty">…</div>
            : rows.length === 0 ? <div className="empty">چیزی پیدا نشد.</div>
            : rows.map((r) => {
              const here = (r.stock || []).find((s) => s.warehouse === warehouse);
              return (
                <button key={r.id} className="pick-row" onClick={() => { onPick(r); onClose(); }}>
                  <span className="pick-name">{r.productName}</span>
                  <span className="pick-sub">
                    {r.siteName && r.siteName !== r.productName ? <span dir="auto">سایت: {r.siteName} · </span> : null}
                    {r.packSize}{r.grit ? " · " + r.grit : ""}{r.shade ? " · " + r.shade : ""}
                    {" · شناسه "}{r.packageId}
                    {here ? ` · موجودی ${here.onHand} ${r.baseUnit}` : ""}
                  </span>
                </button>
              );
            })}
        </div>
        <div className="btn-row"><button className="ghost" onClick={onClose}>بستن</button></div>
      </div>
    </div>
  );
}
/** برگهٔ چاپی حواله. */
function VoucherDoc({ voucher, onClose }) {
  const v = voucher;
  const total = (v.lines || []).reduce((a, l) => a + (l.qty || 0), 0);
  const totalValue = (v.lines || []).reduce((a, l) => a + (l.qty || 0) * (l.unitCost || 0), 0);
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet wide">
        <DocLetterhead title={v.movementKindLabel} subtitle={`شمارهٔ ${v.number}`} />
        <div className="doc-info">
          <div><span>تاریخ</span><b>{jLong(v.date)}</b></div>
          <div><span>انبار</span><b>{v.warehouseName}</b></div>
          <div>
            <span>{v.movementKind === "return_person" ? "برگرداننده" : v.isInbound ? "تأمین‌کننده" : "تحویل‌گیرنده"}</span>
            <b>{v.counterparty || "—"}</b>
          </div>
          <div><span>شمارهٔ فاکتور</span><b>{v.ref || "—"}</b></div>
          <div><span>وضعیت</span><b>{v.statusLabel}</b></div>
          <div><span>ثبت‌کننده</span><b>{v.createdBy}</b></div>
        </div>

        <table className="doc-table">
          <thead>
            <tr>
              <th>#</th><th>کالا</th><th>بسته</th><th>گرید/شید</th><th>شناسه</th>
              <th>مقدار</th>{v.isInbound && <><th>قیمت واحد</th><th>مبلغ</th></>}<th>بچ</th>
            </tr>
          </thead>
          <tbody>
            {(v.lines || []).map((l, i) => (
              <tr key={l.id}>
                <td>{faDigits(i + 1)}</td>
                <td className="nm">{l.productName}</td>
                <td className="nm">{l.packSize}</td>
                <td className="nm">{[l.grit, l.shade].filter(Boolean).join(" / ") || "—"}</td>
                <td>{l.packageId}</td>
                <td className="net">{faDigits(l.qty)}</td>
                {v.isInbound && <>
                  <td>{l.unitCost ? faDigits(Math.round(l.unitCost)) : "—"}</td>
                  <td>{l.unitCost ? faDigits(Math.round(l.qty * l.unitCost)) : "—"}</td>
                </>}
                <td className="nm">{l.batchNo || "—"}</td>
              </tr>
            ))}
            <tr className="tot">
              <td colSpan={5}>جمع — {faDigits((v.lines || []).length)} قلم</td>
              <td className="net">{faDigits(total)}</td>
              {v.isInbound && <><td>—</td><td className="net">{faDigits(Math.round(totalValue))}</td></>}
              <td>—</td>
            </tr>
          </tbody>
        </table>

        {v.note && <p className="rep-notes" style={{ marginTop: 12 }}><b>توضیح:</b> {v.note}</p>}
        <div className="doc-sign">
          <div>تحویل‌دهنده: ......................................</div>
          <div>تحویل‌گیرنده: ......................................</div>
          <div>انباردار: ......................................</div>
        </div>
        <div className="doc-foot">Diwaj ERP (برنامه‌ریزی منابع سازمان) · {v.status === "posted" ? "ثبت نهایی شده" : "پیش‌نویس — روی موجودی اثری ندارد"}</div>
      </div>
    </PrintableDoc>
  );
}
