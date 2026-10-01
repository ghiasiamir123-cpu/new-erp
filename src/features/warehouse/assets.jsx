import { useState, useEffect, useCallback } from "react";
import { warehouseApi } from "../../api.js";
import { ItemEditor } from "./itemEditor.jsx";
import { ASSET_EVENT_CLS, ASSET_STATUS, DocLetterhead, Icon, JalaliPicker, PrintableDoc, WhyOff, askConfirm, assetChangeText, faDigits, faRial, jLong, jShort, showMessage, todayIso, useCan } from "../../shared/core.jsx";

const ASSET_ACTIONS = [["", "—"], ["expert", "بررسی بیشتر توسط کارشناس"], ["service", "سرویس"],
  ["repair", "تعمیر"], ["replace", "تعویض"], ["out_of_service", "خروج از سرویس"]];

export function AssetStatusChip({ status }) {
  const s = ASSET_STATUS[status] || ASSET_STATUS.ok;
  return <span className={`as-chip ${s.cls}`}>{s.label}</span>;
}

function DueChip({ due }) {
  if (due === "overdue") return <span className="as-chip bad">عقب‌افتاده</span>;
  if (due === "soon") return <span className="as-chip warn">نزدیک</span>;
  return null;
}

export function AssetsPane() {
  const [section, setSection] = useState("list");
  return (
    <>
      <div className="seg-row" role="tablist">
        {[["list", "فهرست اموال"], ["inspections", "بازرسی‌ها"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={section === k} className={section === k ? "seg on" : "seg"}
            onClick={() => setSection(k)}>{l}</button>
        ))}
      </div>
      {section === "list" ? <AssetList /> : <InspectionsPane />}
    </>
  );
}

function AssetList() {
  const canEdit = useCan()("warehouse.assets");
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [place, setPlace] = useState("");
  const [holder, setHolder] = useState("");
  const [statusF, setStatusF] = useState("");
  const [serviceF, setServiceF] = useState("");
  const [places, setPlaces] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);
  const [opened, setOpened] = useState(null);     // پروندهٔ باز
  const [printing, setPrinting] = useState(null); // برگهٔ تحویل

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [qDebounced, place, holder, statusF, serviceF]);

  const loadPlaces = useCallback(() => {
    warehouseApi.locations()
      .then((r) => setPlaces(r.filter((p) => p.active)))
      .catch(() => {});
  }, []);
  useEffect(() => { loadPlaces(); }, [loadPlaces]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        warehouseApi.items({ assets: 1, q: qDebounced, location: place, holder, status: statusF, service: serviceF, page }),
        warehouseApi.assetsSummary(),
      ]);
      setRows(d.results || []);
      setCount(d.count || 0);
      setSummary(s);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [qDebounced, place, holder, statusF, serviceF, page]);

  useEffect(() => { reload(); }, [reload]);

  // پس از ثبت تعمیر/سرویس، پروندهٔ باز و فهرست هر دو تازه شوند.
  async function refreshOpened(id) {
    try { setOpened(await warehouseApi.item(id)); } catch { /* فهرست هم تازه می‌شود */ }
    reload();
  }

  // فهرست تحویل‌گیرنده‌ها از خود اموال درمی‌آید، نه از فهرست کارکنان: کسی
  // که چیزی دستش نیست در این فیلتر جایی ندارد.
  const [holders, setHolders] = useState([]);
  useEffect(() => {
    warehouseApi.items({ assets: 1, page_size: 300 })
      .then((d) => setHolders(
        [...new Set((d.results || []).map((r) => r.holder).filter(Boolean))].sort()))
      .catch(() => {});
  }, [count]);

  async function onSaved(saved, isNew) {
    setEditing(null);
    flash(isNew ? `«${saved.name}» ثبت شد ✓` : `«${saved.name}» ذخیره شد ✓`);
    loadPlaces();
    if (opened && String(opened.id) === String(saved.id)) setOpened(saved);
    await reload();
  }

  async function remove(row) {
    const ok = await askConfirm({
      title: `حذف «${row.name}» از اموال`,
      message: "این قلم از فهرست اموال حذف می‌شود.\nاین کار برگشت ندارد.",
      confirmLabel: "حذف", danger: true,
    });
    if (!ok) return;
    try {
      await warehouseApi.removeItem(row.id);
      await reload();
      flash("حذف شد.");
    } catch (e) { showMessage({ title: "حذف نشد", message: e.message }); }
  }

  const pageCount = Math.max(1, Math.ceil(count / 40));
  const s = summary || { total: 0, byStatus: {}, serviceOverdue: 0, serviceSoon: 0, warrantySoon: 0,
    noHolder: 0, noLocation: 0, bookTotal: 0, withBookValue: 0 };
  const broken = (s.byStatus.needs_repair || 0) + (s.byStatus.in_repair || 0);
  const filtered = qDebounced || place || holder || statusF || serviceF;

  if (err && !rows.length) return <div className="notice warn">{err}</div>;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(s.total)}</b><span>وسیلهٔ فعال</span></div>
        <div className={broken ? "stat warn" : "stat"}><b>{faDigits(broken)}</b><span>نیاز به تعمیر یا در تعمیر</span></div>
        <div className={s.serviceOverdue ? "stat warn" : "stat"}>
          <b>{faDigits(s.serviceOverdue)}</b>
          <span>سرویس عقب‌افتاده{s.serviceSoon ? ` · ${faDigits(s.serviceSoon)} نزدیک` : ""}</span>
        </div>
        <div className="stat">
          <b>{faRial(s.bookTotal)}</b>
          <span>ارزش دفتری (ریال){s.withBookValue < s.total ? ` · ${faDigits(s.withBookValue)} از ${faDigits(s.total)} وسیله` : ""}</span>
        </div>
      </div>
      {(s.noHolder || s.noLocation || s.warrantySoon || s.byStatus.out_of_service) ? (
        <div className="asset-flags">
          {s.byStatus.out_of_service ? <span>خارج از سرویس: <b>{faDigits(s.byStatus.out_of_service)}</b></span> : null}
          {s.warrantySoon ? <span>گارانتی رو به پایان: <b>{faDigits(s.warrantySoon)}</b></span> : null}
          {s.noHolder ? <span>بی تحویل‌گیرنده: <b>{faDigits(s.noHolder)}</b></span> : null}
          {s.noLocation ? <span>بی محل: <b>{faDigits(s.noLocation)}</b></span> : null}
        </div>
      ) : null}

      <div className="card">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام وسیله، کد اموال، تحویل‌گیرنده یا محل…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={place} onChange={(e) => setPlace(e.target.value)} aria-label="محل">
            <option value="">همهٔ محل‌ها</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="تحویل‌گیرنده">
            <option value="">همهٔ تحویل‌گیرنده‌ها</option>
            {holders.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="وضعیت">
            <option value="">همهٔ وضعیت‌ها</option>
            {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={serviceF} onChange={(e) => setServiceF(e.target.value)} aria-label="سرویس">
            <option value="">سرویس: همه</option>
            <option value="due">عقب‌افتاده یا نزدیک</option>
            <option value="overdue">فقط عقب‌افتاده</option>
          </select>
        </div>
        {msg && <div className="wh-toggles"><span className="ok-msg" style={{ margin: 0 }}>{msg}</span></div>}
        {canEdit && <button className="submit" onClick={() => setEditing("new")}>+ ثبت اموال جدید</button>}
      </div>

      {loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">
            {filtered ? "با این فیلترها چیزی پیدا نشد." : "هنوز اموالی ثبت نشده. با «ثبت اموال جدید» شروع کنید."}
          </div>
        ) : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr>
                  <th>وسیله</th><th>وضعیت</th><th>محل استقرار</th><th>تحویل‌گیرنده</th>
                  <th>سرویس بعدی</th><th>ارزش دفتری (ریال)</th><th><span className="sr-only">کارها</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "wh-off"}>
                    <td className="wh-name">
                      <button className="link-btn asset-open" onClick={() => setOpened(r)}>{r.name}</button>
                      <div className="wh-sub">
                        {r.assetCode && <span>کد {r.assetCode}</span>}
                        {r.assetSerial && <span dir="ltr">S/N {r.assetSerial}</span>}
                        {r.brand && <span>{r.brand}</span>}
                        {!r.active && <span className="wh-flag">غیرفعال</span>}
                      </div>
                    </td>
                    <td><AssetStatusChip status={r.assetStatus} /></td>
                    <td>{r.locationName || <span className="muted">تعیین نشده</span>}</td>
                    <td>
                      {r.holder || <span className="muted">تعیین نشده</span>}
                      {r.handedOverOn && <div className="wh-sub"><span>از {jShort(r.handedOverOn)}</span></div>}
                    </td>
                    <td>
                      {!r.serviceIntervalDays ? <span className="muted">—</span> : (
                        <>{r.nextServiceOn ? jShort(r.nextServiceOn) : "ثبت نشده"} <DueChip due={r.serviceDue} /></>
                      )}
                    </td>
                    <td className="wh-qty">{r.bookValue != null ? faRial(r.bookValue) : <span className="muted">—</span>}</td>
                    <td className="wh-actions">
                      <button className="act edit" onClick={() => setOpened(r)}>پرونده</button>
                      {canEdit && <button className="link-btn" onClick={() => remove(r)}>حذف</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="wh-pager">
              <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
              <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)} — {faDigits(count)} قلم</span>
              <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>بعدی</button>
            </div>
          )}
        </>
      )}

      {opened && !editing && !printing && (
        <AssetDialog key={opened.id} asset={opened} canEdit={canEdit} onClose={() => setOpened(null)}
          onEdit={() => setEditing(opened)} onPrint={() => setPrinting(opened)} onChanged={refreshOpened} />
      )}
      {printing && <HandoverDoc asset={printing} onClose={() => setPrinting(null)} />}
      {editing && (
        <ItemEditor item={editing === "new" ? null : editing} assetMode
          onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </>
  );
}
/** پروندهٔ یک وسیله: مشخصات، خرید و گارانتی، نگهداری، استهلاک و تاریخچه. */
function AssetDialog({ asset: a, canEdit, onClose, onEdit, onPrint, onChanged }) {
  const [pane, setPane] = useState("info");
  const [events, setEvents] = useState(null);
  const [form, setForm] = useState(null);   // فرم رخداد تازه
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadEvents = useCallback(() => warehouseApi.assetEvents(a.id).then(setEvents)
    .catch((e) => { setEvents([]); setErr(e.message); }), [a.id]);
  useEffect(() => { if (pane === "history") loadEvents(); }, [pane, loadEvents]);

  const openForm = (kind) => {
    setForm({ kind, date: todayIso(), cost: "", status: "", description: "" });
    setPane("history");
  };
  async function saveEvent() {
    if (busy || !form.description.trim()) return;
    setBusy(true); setErr("");
    try {
      await warehouseApi.createAssetEvent({
        sku: a.id, kind: form.kind, date: form.date, status: form.status, description: form.description.trim(),
        cost: form.kind === "note" ? 0 : Number(form.cost) || 0,
      });
      setForm(null);
      await loadEvents();
      onChanged(a.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function removeEvent(ev) {
    const ok = await askConfirm({
      title: `پاک کردن «${ev.kindLabel}»`, message: `${jShort(ev.date)} — ${ev.description}\nاین کار برگشت ندارد.`,
      confirmLabel: "پاک کن", danger: true,
    });
    if (!ok) return;
    try { await warehouseApi.removeAssetEvent(ev.id); await loadEvents(); onChanged(a.id); } catch (e) { setErr(e.message); }
  }

  const st = ASSET_STATUS[a.assetStatus] || ASSET_STATUS.ok;
  const depPct = a.purchasePrice > 0 && a.bookValue != null ? Math.round(100 * (1 - a.bookValue / a.purchasePrice)) : null;
  const warranty = { expired: ["منقضی شده", "bad"], soon: ["رو به پایان", "warn"], active: ["فعال", "ok"] }[a.warrantyState];
  const spent = (events || []).reduce((sum, ev) => sum + (Number(ev.cost) || 0), 0);

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog asset-dialog" role="dialog" aria-labelledby="as-title">
        <div className="user-dialog-hd">
          <span className="avatar"><Icon name="warehouse" size={18} /></span>
          <div className="ud-name">
            <b id="as-title">{a.name}</b>
            <small>{[a.assetCode && `کد ${a.assetCode}`, a.assetModel, a.brand].filter(Boolean).join(" · ") || "—"}</small>
          </div>
          <AssetStatusChip status={a.assetStatus} />
        </div>

        <div className="sub-tabs" role="tablist">
          {[["info", "مشخصات"], ["history", "تاریخچه"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={pane === k} className={pane === k ? "sub-tab on" : "sub-tab"}
              onClick={() => { setErr(""); setPane(k); }}>{l}</button>
          ))}
        </div>

        {pane === "info" && (
          <>
            <div className="asset-grid">
              <div><span>محل استقرار</span><b>{a.locationName || "—"}</b></div>
              <div><span>تحویل‌گیرنده</span><b>{a.holder || "—"}</b></div>
              <div><span>تاریخ تحویل</span><b>{a.handedOverOn ? jShort(a.handedOverOn) : "—"}</b></div>
              <div><span>شماره سریال</span><b dir="ltr">{a.assetSerial || "—"}</b></div>
              <div><span>فروشنده</span><b>{a.assetSupplier || "—"}</b></div>
              <div><span>وضعیت</span><b>{st.label}</b></div>
            </div>
            <div className="asset-cards">
              <div className="asset-card">
                <div className="items-hd">خرید و گارانتی</div>
                <dl>
                  <dt>تاریخ خرید</dt><dd>{a.purchaseDate ? jShort(a.purchaseDate) : "—"}</dd>
                  <dt>قیمت خرید</dt><dd>{a.purchasePrice ? `${faRial(a.purchasePrice)} ریال` : "—"}</dd>
                  <dt>گارانتی تا</dt>
                  <dd>{a.warrantyUntil ? <>{jShort(a.warrantyUntil)} {warranty && <span className={`as-chip ${warranty[1]}`}>{warranty[0]}</span>}</> : "—"}</dd>
                </dl>
              </div>
              <div className="asset-card">
                <div className="items-hd">نگهداری</div>
                <dl>
                  <dt>دورهٔ سرویس</dt><dd>{a.serviceIntervalDays ? `هر ${faDigits(a.serviceIntervalDays)} روز` : "تعیین نشده"}</dd>
                  <dt>آخرین سرویس</dt><dd>{a.lastServiceOn ? jShort(a.lastServiceOn) : "ثبت نشده"}</dd>
                  <dt>سرویس بعدی</dt>
                  <dd>{!a.serviceIntervalDays ? "—" : <>{a.nextServiceOn ? jShort(a.nextServiceOn) : "هر چه زودتر"} <DueChip due={a.serviceDue} /></>}</dd>
                </dl>
                {canEdit && <button className="link-btn" onClick={() => openForm("service")}>+ ثبت سرویس</button>}
              </div>
              <div className="asset-card">
                <div className="items-hd">استهلاک</div>
                {a.bookValue == null ? (
                  <div className="muted sm2" style={{ lineHeight: 1.9 }}>
                    برای محاسبه، قیمت خرید، تاریخ خرید و عمر مفید را در «ویرایش مشخصات» وارد کنید.
                  </div>
                ) : (
                  <>
                    <dl>
                      <dt>عمر مفید</dt><dd>{faDigits(a.usefulLifeYears)} سال</dd>
                      <dt>ارزش اسقاط</dt><dd>{faRial(a.salvageValue)} ریال</dd>
                      <dt>ارزش دفتری امروز</dt><dd>{faRial(a.bookValue)} ریال</dd>
                    </dl>
                    <div className="dep-bar" role="img" aria-label={`${depPct}٪ مستهلک شده`}>
                      <i style={{ width: `${Math.min(100, Math.max(0, depPct))}%` }} />
                    </div>
                    <div className="muted sm2">{faDigits(depPct)}٪ مستهلک شده</div>
                  </>
                )}
              </div>
            </div>
            {a.assetNote && <div className="notice">{a.assetNote}</div>}
          </>
        )}

        {pane === "history" && (
          <>
            {canEdit && !form && (
              <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
                <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => openForm("service")}>+ سرویس و نگهداری</button>
                <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => openForm("repair")}>+ تعمیر</button>
                <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => openForm("note")}>+ یادداشت</button>
              </div>
            )}
            {form && (
              <div className="asset-card event-form">
                <div className="items-hd">{{ service: "ثبت سرویس و نگهداری", repair: "ثبت تعمیر", note: "یادداشت" }[form.kind]}</div>
                <div className="row2">
                  <label className="fld"><span>تاریخ</span>
                    <JalaliPicker value={form.date} onChange={(v) => setForm((p) => ({ ...p, date: v }))} />
                  </label>
                  {form.kind !== "note" && (
                    <label className="fld"><span>هزینه (ریال)</span>
                      <input type="number" min="0" inputMode="numeric" value={form.cost}
                        onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
                    </label>
                  )}
                </div>
                <label className="fld"><span>وضعیت پس از این کار</span>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="">بدون تغییر ({st.label})</option>
                    {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label className="fld"><span>شرح</span>
                  <textarea rows={2} value={form.description} autoFocus
                    placeholder={{ service: "مثلاً: تعویض فیلتر و روغن‌کاری", repair: "مثلاً: تعویض نازل در تعمیرگاه …", note: "" }[form.kind]}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                </label>
                <div className="btn-row">
                  <button className="ghost" disabled={busy} onClick={() => setForm(null)}>انصراف</button>
                  <button className="submit" disabled={busy || !form.description.trim()} onClick={saveEvent}>{busy ? "…" : "ثبت"}</button>
                </div>
                <WhyOff busy={busy} reasons={[!form.description.trim() && "شرح نوشته نشده"]} />
              </div>
            )}
            {events === null ? <div className="muted sm2">در حال خواندن…</div>
              : events.length === 0 ? <div className="empty">هنوز رخدادی برای این وسیله ثبت نشده.</div>
              : (
                <>
                  {spent > 0 && <div className="muted sm2">هزینهٔ تعمیر و سرویس تا امروز: <b>{faRial(spent)} ریال</b></div>}
                  <ul className="event-list">
                    {events.map((ev) => (
                      <li key={ev.id}>
                        <span className={`as-chip ${ASSET_EVENT_CLS[ev.kind] || "off"}`}>{ev.kindLabel}</span>
                        <div className="event-body">
                          <div>{[ev.description, assetChangeText(ev.changes)].filter(Boolean).join(" — ") || "—"}</div>
                          <small>
                            {jShort(ev.date)}{ev.cost ? ` · هزینه ${faRial(ev.cost)} ریال` : ""}{ev.by ? ` · ${ev.by}` : ""}
                          </small>
                        </div>
                        {canEdit && ["repair", "service", "note"].includes(ev.kind) && (
                          <button className="link-btn" onClick={() => removeEvent(ev)}>پاک کردن</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </>
        )}

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>بستن</button>
          <button className="ghost" onClick={onPrint}>برگهٔ تحویل</button>
          {canEdit && <button className="submit" style={{ width: "auto", margin: 0 }} onClick={onEdit}>ویرایش مشخصات</button>}
        </div>
      </div>
    </div>
  );
}
/** برگهٔ تحویل اموال — برای امضای تحویل‌دهنده و تحویل‌گیرنده. */
function HandoverDoc({ asset: a, onClose }) {
  const blank = "..............................";
  return (
    <PrintableDoc onClose={onClose}>
      <div className="doc-sheet">
        <DocLetterhead title="برگهٔ تحویل اموال" subtitle={a.assetCode ? `کد اموال ${a.assetCode}` : ""} />
        <div className="doc-info">
          <div><span>وسیله</span><b>{a.name}</b></div>
          <div><span>کد اموال</span><b>{a.assetCode || "—"}</b></div>
          <div><span>شماره سریال</span><b dir="ltr">{a.assetSerial || "—"}</b></div>
          <div><span>مدل / برند</span><b>{[a.assetModel, a.brand].filter(Boolean).join(" · ") || "—"}</b></div>
          <div><span>محل استقرار</span><b>{a.locationName || "—"}</b></div>
          <div><span>وضعیت هنگام تحویل</span><b>{(ASSET_STATUS[a.assetStatus] || ASSET_STATUS.ok).label}</b></div>
          <div><span>تحویل‌گیرنده</span><b>{a.holder || blank}</b></div>
          <div><span>تاریخ تحویل</span><b>{a.handedOverOn ? jLong(a.handedOverOn) : blank}</b></div>
        </div>
        {a.assetNote && <p className="rep-notes"><b>توضیح:</b> {a.assetNote}</p>}
        <p className="doc-terms">
          اینجانب وسیلهٔ بالا را سالم و کامل تحویل گرفتم و متعهد می‌شوم در نگهداری و استفادهٔ درست از آن دقت کنم،
          هر خرابی یا مفقودی را فوراً به مسئول اموال گزارش دهم و هنگام جابه‌جایی یا پایان همکاری، آن را تحویل دهم.
        </p>
        <div className="doc-sign">
          <div>تحویل‌دهنده (مسئول اموال): ......................</div>
          <div>تحویل‌گیرنده: ......................</div>
          <div>تأیید مدیر: ......................</div>
        </div>
        <div className="doc-foot">Diwaj ERP (برنامه‌ریزی منابع سازمان) · برگهٔ تحویل اموال</div>
      </div>
    </PrintableDoc>
  );
}
/** بازرسی دوره‌ای: فهرست برگه‌ها. */
function InspectionsPane() {
  const canEdit = useCan()("warehouse.assets");
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };

  const load = useCallback(() => warehouseApi.inspections()
    .then((d) => { setList(d); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card">
        <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: 0 }}>
          <div className="muted sm2" style={{ lineHeight: 1.9, flex: "1 1 260px" }}>
            برگهٔ بازرسی برای همهٔ اموال یا اموال یک محل ساخته می‌شود. برای هر وسیله پیدا شدن، وضعیت و اقدام لازم
            را ثبت کنید؛ با «بستن برگه»، وضعیت وسیله‌ها به‌روز و در پروندهٔ هر کدام ثبت می‌شود.
          </div>
          {canEdit && (
            <button className="submit" style={{ width: "auto", margin: 0, flex: "0 0 auto" }} onClick={() => setCreating(true)}>
              + بازرسی جدید
            </button>
          )}
        </div>
        {msg && <div className="ok-msg" role="status">{msg}</div>}
      </div>
      {err && <div className="notice warn">{err}</div>}
      {list === null ? <div className="empty">در حال بارگذاری…</div>
        : list.length === 0 ? <div className="empty">هنوز بازرسی‌ای ثبت نشده.</div>
        : (
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr><th>شماره</th><th>عنوان</th><th>تاریخ</th><th>محدوده</th><th>وضعیت</th><th>ردیف‌ها</th>
                  <th><span className="sr-only">باز کردن</span></th></tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td className="vc-num">{faDigits(i.number)}</td>
                    <td>{i.title}</td>
                    <td>{jShort(i.date)}</td>
                    <td>{i.locationName || "همهٔ اموال"}</td>
                    <td><span className={`as-chip ${i.status === "open" ? "info" : "ok"}`}>{i.statusLabel}</span></td>
                    <td>
                      {faDigits(i.counts.total)} وسیله
                      {i.counts.needsAction > 0 && <span className="as-chip warn" style={{ marginInlineStart: 6 }}>{faDigits(i.counts.needsAction)} نیاز به اقدام</span>}
                      {i.counts.missing > 0 && <span className="as-chip bad" style={{ marginInlineStart: 6 }}>{faDigits(i.counts.missing)} پیدا نشد</span>}
                    </td>
                    <td><button className="act edit" onClick={() => setOpenId(i.id)}>{i.status === "open" && canEdit ? "ادامه" : "نمایش"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {creating && (
        <NewInspectionDialog onClose={() => setCreating(false)}
          onCreated={(ins) => { setCreating(false); load(); setOpenId(ins.id); }} />
      )}
      {openId && (
        <InspectionDialog key={openId} id={openId} canEdit={canEdit} onClose={() => setOpenId(null)}
          onChanged={(text) => { if (text) flash(text); load(); }} />
      )}
    </>
  );
}

function NewInspectionDialog({ onClose, onCreated }) {
  const [title, setTitle] = useState(`بازرسی اموال ${jShort(todayIso())}`);
  const [date, setDate] = useState(todayIso());
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [places, setPlaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { warehouseApi.locations().then((r) => setPlaces(r.filter((p) => p.active))).catch(() => {}); }, []);

  async function create() {
    if (busy || !title.trim()) return;
    setBusy(true); setErr("");
    try {
      onCreated(await warehouseApi.createInspection({ title: title.trim(), date, location: location || null, note: note.trim() }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog user-dialog" role="dialog" aria-labelledby="ni-title">
        <div className="items-hd" id="ni-title">بازرسی جدید</div>
        <label className="fld"><span>عنوان</span><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
        <div className="row2">
          <label className="fld"><span>تاریخ</span><JalaliPicker value={date} onChange={setDate} /></label>
          <label className="fld"><span>محدوده</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">همهٔ اموال</option>
              {places.map((p) => <option key={p.id} value={p.id}>فقط {p.name}</option>)}
            </select>
          </label>
        </div>
        <label className="fld"><span>توضیح (اختیاری)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit" onClick={create} disabled={busy || !title.trim()}>{busy ? "…" : "ساختن برگه"}</button>
        </div>
        <WhyOff busy={busy} reasons={[!title.trim() && "عنوان برگه نوشته نشده"]} />
      </div>
    </div>
  );
}

function InspectionDialog({ id, canEdit, onClose, onChanged }) {
  const [ins, setIns] = useState(null);
  const [lines, setLines] = useState([]);
  const [saved, setSaved] = useState("[]");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seed = (d) => { setIns(d); setLines(d.lines || []); setSaved(JSON.stringify(d.lines || [])); };
  useEffect(() => { warehouseApi.inspection(id).then(seed).catch((e) => setErr(e.message)); }, [id]);

  if (!ins) {
    return (
      <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wh-dialog">{err ? <div className="err">{err}</div> : <div className="empty">در حال بارگذاری…</div>}</div>
      </div>
    );
  }

  const editable = canEdit && ins.status === "open";
  const dirty = JSON.stringify(lines) !== saved;
  const setLine = (lid, patch) => setLines((p) => p.map((l) => (l.id === lid
    ? { ...l, ...patch, ...(patch.needsAction === false ? { action: "" } : {}) } : l)));
  const payload = () => ({
    lines: lines.map(({ id: lid, present, status, needsAction, action, note }) => ({ id: lid, present, status, needsAction, action, note })),
  });
  const missing = lines.filter((l) => !l.present).length;
  const needs = lines.filter((l) => l.needsAction);

  async function run(fn, done) {
    setBusy(true); setErr("");
    try { const d = await fn(); if (d) seed(d); onChanged(done); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const save = () => run(() => warehouseApi.updateInspection(ins.id, payload()), "برگه ذخیره شد ✓");
  async function closeSheet() {
    const ok = await askConfirm({
      title: `بستن ${faDigits(ins.number)}`,
      message: `وضعیت ${faDigits(lines.length - missing)} وسیلهٔ پیدا‌شده به‌روز و در پروندهٔ هر کدام ثبت می‌شود و برگه دیگر ویرایش نمی‌شود.`
        + (missing ? `\n${faDigits(missing)} وسیله «پیدا نشد» علامت خورده است.` : ""),
      confirmLabel: "بستن برگه",
    });
    if (ok) run(() => warehouseApi.closeInspection(ins.id, payload()), `${faDigits(ins.number)} بسته شد ✓`);
  }
  async function removeSheet() {
    const ok = await askConfirm({ title: `پاک کردن ${faDigits(ins.number)}`, message: "این برگهٔ بازرسی پاک می‌شود.\nاین کار برگشت ندارد.", confirmLabel: "پاک کن", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await warehouseApi.removeInspection(ins.id); onChanged("برگهٔ بازرسی پاک شد"); onClose(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  async function closeDialog() {
    if (dirty && editable) {
      const ok = await askConfirm({ title: "تغییرات ذخیره نشده", message: "نتیجه‌هایی که ذخیره نکرده‌اید از بین می‌رود.", confirmLabel: "بستن بدون ذخیره", danger: true });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && closeDialog()}>
      <div className="wh-dialog wide" role="dialog" aria-labelledby="in-title">
        <div className="user-dialog-hd">
          <div className="ud-name">
            <b id="in-title">{ins.title}</b>
            <small>{faDigits(ins.number)} · {jLong(ins.date)} · {ins.locationName || "همهٔ اموال"} · {ins.createdBy}</small>
          </div>
          <span className={`as-chip ${ins.status === "open" ? "info" : "ok"}`}>{ins.statusLabel}</span>
        </div>

        <div className="asset-flags">
          <span>{faDigits(lines.length)} وسیله</span>
          <span>پیدا نشد: <b>{faDigits(missing)}</b></span>
          <span>نیاز به اقدام: <b>{faDigits(needs.length)}</b></span>
          {Object.entries(ASSET_STATUS).filter(([k]) => k !== "ok").map(([k, v]) => (
            <span key={k}>{v.label}: <b>{faDigits(lines.filter((l) => l.present && l.status === k).length)}</b></span>
          ))}
        </div>
        {ins.status === "closed" && needs.length > 0 && (
          <div className="notice warn">
            <b>اقدام‌های لازم:</b> {needs.map((l) => `${l.name}${l.action ? ` (${ASSET_ACTIONS.find(([k]) => k === l.action)?.[1]})` : ""}`).join("، ")}
          </div>
        )}
        {editable && (
          <div className="btn-row" style={{ justifyContent: "flex-start", marginTop: 0 }}>
            <button className="ghost" style={{ flex: "0 0 auto" }} disabled={busy}
              onClick={() => setLines((p) => p.map((l) => ({ ...l, present: true, status: "ok", needsAction: false, action: "" })))}>
              همه پیدا شد و سالم
            </button>
          </div>
        )}

        <div className="tbl-scroll">
          <table className="print-table wh-table insp-table">
            <thead>
              <tr><th>#</th><th>وسیله</th><th>محل / تحویل‌گیرنده</th><th>پیدا شد</th><th>وضعیت</th>
                <th>نیاز به اقدام</th><th>اقدام پیشنهادی</th><th>یادداشت</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} className={!l.present ? "missing" : l.needsAction ? "action" : ""}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="wh-name">
                    {l.name}
                    <div className="wh-sub">{l.assetCode && <span>کد {l.assetCode}</span>}{l.serial && <span dir="ltr">S/N {l.serial}</span>}</div>
                  </td>
                  <td>{l.location || "—"}<div className="wh-sub"><span>{l.holder || "بی تحویل‌گیرنده"}</span></div></td>
                  <td>
                    <input type="checkbox" checked={l.present} disabled={!editable} aria-label={`${l.name} پیدا شد`}
                      onChange={(e) => setLine(l.id, { present: e.target.checked })} />
                  </td>
                  <td>
                    <select value={l.status} disabled={!editable || !l.present} aria-label={`وضعیت ${l.name}`}
                      onChange={(e) => setLine(l.id, { status: e.target.value })}>
                      {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={l.needsAction} disabled={!editable} aria-label={`${l.name} نیاز به اقدام`}
                      onChange={(e) => setLine(l.id, { needsAction: e.target.checked })} />
                  </td>
                  <td>
                    <select value={l.action} disabled={!editable || !l.needsAction} aria-label={`اقدام ${l.name}`}
                      onChange={(e) => setLine(l.id, { action: e.target.value })}>
                      {ASSET_ACTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="text" value={l.note} disabled={!editable} aria-label={`یادداشت ${l.name}`}
                      onChange={(e) => setLine(l.id, { note: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row insp-foot">
          <button className="ghost" onClick={closeDialog} disabled={busy}>بستن</button>
          {editable && <button className="ghost" onClick={removeSheet} disabled={busy}>پاک کردن برگه</button>}
          {editable && <button className="ghost" onClick={save} disabled={busy || !dirty}>ذخیره</button>}
          {editable && (
            <button className="submit" style={{ width: "auto", margin: 0 }} onClick={closeSheet} disabled={busy}>
              {busy ? "…" : "بستن برگه و ثبت نتیجه"}
            </button>
          )}
        </div>
        {editable && <WhyOff label="ذخیره" busy={busy} reasons={[!dirty && "هنوز چیزی را عوض نکرده‌اید"]} />}
      </div>
    </div>
  );
}
