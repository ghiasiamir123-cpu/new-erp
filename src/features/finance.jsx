import { useState, useEffect, useCallback } from "react";
import { financeApi, financeReportsApi, warehouseApi } from "../api.js";
import { Empty, JalaliPicker, WhyOff, faDigits, faRial, jShort, useCan } from "../shared/core.jsx";

/* ============ کارتابل مالی ============ */
const FIN_STATUS = {
  pending: "در کارتابل مالی",
  returned: "برگشت به انبار",
  approved: "تأیید مالی",
};

const fmtRial = (n) => (n == null || n === "" || Number.isNaN(Number(n))
  ? "—" : faDigits(Math.round(Number(n)).toLocaleString("en-US")));

export function FinanceReportsView() {
  const [pane, setPane] = useState("stock");
  return (
    <>
      <div className="seg-row">
        <button className={pane === "stock" ? "seg on" : "seg"} onClick={() => setPane("stock")}>ارزش موجودی انبار</button>
        <button className={pane === "discount" ? "seg on" : "seg"} onClick={() => setPane("discount")}>سود دیواژ از تخفیف خرید</button>
      </div>
      {pane === "stock" ? <StockValueReport /> : <DiscountProfitReport />}
    </>
  );
}

/* سود دیواژ از تخفیف فاکتور خرید: مرکز پوشش کالا را به قیمت لیست می‌گیرد و تخفیف فاکتور
   سود دیواژ است؛ با انتقال کالا از انبار مرکزی به مرکز پوشش محقق می‌شود. */
function DiscountProfitReport() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  useEffect(() => { financeReportsApi.discountProfit().then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">در حال محاسبه…</div>;
  const t = d.totals;
  return (
    <>
      <div className="card">
        <div className="items-hd">سود دیواژ از تخفیف فاکتور خرید</div>
        <div className="muted sm2" style={{ lineHeight: 2 }}>
          فاکتور خرید با قیمت لیست ثبت می‌شود و مرکز پوشش کالا را به همان قیمت لیست می‌گیرد؛ «تخفیف فاکتور»
          سود دیواژ است. این سود روز خرید حساب نمی‌شود: هر وقت کالا از انبار مرکزی به مرکز پوشش منتقل شود،
          سهم همان مقدار محقق می‌شود. تخفیف به نسبت مبلغ هر ردیف پخش شده و انتقال‌ها از قدیمی‌ترین خرید
          برمی‌دارند. فقط فاکتورهای تأییدشدهٔ مالی حساب می‌شوند. ارزش موجودی انبار همچنان با قیمت لیست است.
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{fmtRial(t.realised)}</b><span>سود محقق‌شده (ریال)<br />{fmtRial(t.realised / 10)} تومان</span></div>
        <div className={t.pending ? "stat warn" : "stat"}><b>{fmtRial(t.pending)}</b><span>در انتظار انتقال به مرکز پوشش</span></div>
        <div className="stat"><b>{fmtRial(t.discount)}</b><span>جمع تخفیف فاکتورها</span></div>
        <div className="stat"><b>{faDigits(t.invoices)}</b><span>فاکتور تخفیف‌دار</span></div>
      </div>

      {d.invoices.length === 0 ? (
        <Empty art="finance">هنوز فاکتور خریدِ تأییدشده‌ای با تخفیف ثبت نشده.</Empty>
      ) : (
        <div className="card">
          <div className="items-hd">به تفکیک فاکتور</div>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>حواله</th><th>تاریخ</th><th>فاکتور</th><th>جمع لیست</th><th>تخفیف</th><th>٪</th>
                <th>پرداختی</th><th>محقق‌شده</th><th>در انتظار</th><th></th></tr></thead>
              <tbody>
                {d.invoices.map((v) => (
                  <FragmentRows key={v.id} v={v} open={open === v.id}
                    onToggle={() => setOpen(open === v.id ? "" : v.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.byBrand.length > 0 && (
        <div className="card">
          <div className="items-hd">به تفکیک برند</div>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>برند</th><th>تخفیف</th><th>محقق‌شده</th><th>در انتظار</th></tr></thead>
              <tbody>
                {d.byBrand.map((b) => (
                  <tr key={b.brand}><td className="nm">{b.brand}</td><td>{fmtRial(b.discount)}</td>
                    <td>{fmtRial(b.realised)}</td><td>{fmtRial(b.pending)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.events.length > 0 && (
        <div className="card">
          <div className="items-hd">انتقال‌هایی که سود ساخته‌اند</div>
          <div className="tbl-scroll">
            <table className="print-table">
              <thead><tr><th>تاریخ</th><th>حوالهٔ انتقال</th><th>کالا</th><th>مقدار</th><th>سود (ریال)</th></tr></thead>
              <tbody>
                {d.events.map((e, i) => (
                  <tr key={i}><td>{jShort(e.date)}</td><td>{e.voucher || "—"}</td><td className="nm">{e.name}</td>
                    <td>{faDigits(e.qty)} {e.unit}</td><td>{fmtRial(e.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function FragmentRows({ v, open, onToggle }) {
  return (
    <>
      <tr>
        <td className="nm">{v.number}</td><td>{jShort(v.date)}</td>
        <td>{v.invoiceNo || "—"}{v.supplier ? <div className="muted sm2">{v.supplier}</div> : null}</td>
        <td>{fmtRial(v.listTotal)}</td><td>{fmtRial(v.discount)}</td><td>{faDigits(v.percent)}٪</td>
        <td>{fmtRial(v.paid)}</td><td><b>{fmtRial(v.realised)}</b></td><td>{fmtRial(v.pending)}</td>
        <td><button className="ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>{open ? "بستن" : "ردیف‌ها"}</button></td>
      </tr>
      {open && v.lines.map((l) => (
        <tr key={l.name + l.code} style={{ background: "var(--paper)" }}>
          <td colSpan={3} className="nm">{l.name}<div className="muted sm2">{l.code}</div></td>
          <td>لیست: {fmtRial(l.listCost)}<div className="muted sm2">خالص دیواژ: {fmtRial(l.netCost)}</div></td>
          <td>{fmtRial(l.discount)}</td>
          <td colSpan={2}>{faDigits(l.moved)} از {faDigits(l.qty)} {l.unit} منتقل شده</td>
          <td><b>{fmtRial(l.realised)}</b></td><td>{fmtRial(l.pending)}</td><td></td>
        </tr>
      ))}
    </>
  );
}

function StockValueReport() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState("top");
  const [q, setQ] = useState("");
  const canRefresh = useCan()("financereports.refresh");

  const load = useCallback(async () => {
    try { setD(await financeReportsApi.stockValue()); setErr(""); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await financeReportsApi.refreshPrices();
      setMsg(`قیمت‌ها از سایت خوانده شد ✓ — ${faDigits(r.updated)} قیمت تغییر کرد`);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err && !d) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">در حال محاسبهٔ ارزش موجودی…</div>;

  const c = d.counts;
  const last = d.sync?.lastOk;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (r) => words.every((w) => `${r.name} ${r.code} ${r.brand} ${r.sitePack?.name || ""}`.toLowerCase().includes(w));
  const list = (view === "unpriced" ? d.unpriced : view === "all" ? d.priced : d.priced.slice(0, 30)).filter(match);

  return (
    <>
      <div className="card">
        <div className="items-hd">ارزش ریالی موجودی انبار</div>
        <div className="muted sm2" style={{ lineHeight: 2 }}>
          مقدار هر کالا از انبار × قیمت خرده‌فروشی همان کالا در سایت فروش. کالایی که در سایت فروش نیست
          (مثل سومک) با قیمت فروشِ ثبت‌شده در خودِ کالا حساب می‌شود و کنارش «قیمت کالا» نوشته شده.
          کالایی که قیمتش در سایت تعیین نشده (۱ ریال)، یا به سایت وصل نیست و قیمت خودش را هم ندارد، در جمع
          نمی‌آید و جدا فهرست شده است.
        </div>
        <div className="muted sm2" style={{ marginTop: 6 }}>
          {last
            ? <>قیمت‌ها از سایت: {new Date(last.at).toLocaleString("fa-IR")}{last.by ? ` · ${last.by}` : ""}</>
            : "قیمت‌ها هنوز از سایت خوانده نشده‌اند."}
          {d.sync?.lastError && <span className="wh-flag haz" style={{ marginRight: 8 }}>آخرین تلاش ناموفق: {d.sync.lastError.message}</span>}
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap", alignItems: "center" }}>
          {canRefresh && (
            <button className="ghost" style={{ flex: "0 0 auto", padding: "10px 16px" }} disabled={busy || !d.tokenConfigured} onClick={refresh}
              title={d.tokenConfigured ? "" : "کلید اتصال به سایت هنوز تنظیم نشده"}>
              {busy ? "در حال خواندن از سایت…" : "به‌روزرسانی قیمت از سایت"}
            </button>
          )}
          {!d.tokenConfigured && <span className="muted sm2">کلید اتصال به سایت هنوز تنظیم نشده؛ قیمت‌ها از آخرین خواندن‌اند.</span>}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{faRial(d.total)}</b><span>ریال ({faRial(d.total / 10)} تومان)
          {c.itemPriced > 0 && <><br />شامل {faRial(c.itemValue)} از {faDigits(c.itemPriced)} کالای خارج از سایت</>}</span></div>
        <div className="stat"><b>{faDigits(c.priced)}</b><span>کالای قیمت‌دار از {faDigits(c.inStock)} موجود</span></div>
        <div className={c.noPrice ? "stat warn" : "stat"}><b>{faDigits(c.noPrice)}</b><span>بی قیمت در سایت</span></div>
        <div className={c.noLink ? "stat warn" : "stat"}><b>{faDigits(c.noLink)}</b><span>وصل‌نشده به سایت</span></div>
      </div>

      <div className="card">
        <div className="items-hd">به تفکیک انبار</div>
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead><tr><th>انبار</th><th>ارزش (ریال)</th><th>کالای موجود</th><th>بی قیمت</th></tr></thead>
            <tbody>
              {d.byWarehouse.map((w) => (
                <tr key={w.warehouse}><td>{w.warehouse}</td><td className="wh-qty">{faRial(w.value)}</td>
                  <td>{faDigits(w.items)}</td><td>{w.unpriced ? faDigits(w.unpriced) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="items-hd" style={{ marginTop: 12 }}>به تفکیک برند</div>
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead><tr><th>برند</th><th>ارزش (ریال)</th><th>سهم</th><th>کالای موجود</th><th>بی قیمت</th></tr></thead>
            <tbody>
              {d.byBrand.map((b) => (
                <tr key={b.brand}><td>{b.brand}</td><td className="wh-qty">{faRial(b.value)}</td>
                  <td>{d.total ? faDigits(Math.round((100 * b.value) / d.total)) + "٪" : "—"}</td>
                  <td>{faDigits(b.items)}</td><td>{b.unpriced ? faDigits(b.unpriced) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="wh-toggles" style={{ marginTop: 0 }}>
          {[["top", "پرارزش‌ترین ۳۰ کالا"], ["all", "همهٔ کالاهای قیمت‌دار"], ["unpriced", `بی قیمت و وصل‌نشده (${faDigits(d.unpriced.length)})`]].map(([k, l]) => (
            <label key={k}><input type="radio" checked={view === k} onChange={() => setView(k)} /> {l}</label>
          ))}
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو: نام، کد یا برند…" />
      </div>
      {list.length === 0 ? <div className="empty">چیزی پیدا نشد.</div> : (
        <div className="tbl-scroll">
          <table className="print-table wh-table">
            <thead>
              <tr><th>کالا</th><th>کد</th><th>موجودی</th>
                {view === "unpriced" ? <th>دلیل</th> : <><th>قیمت هر واحد (ریال)</th><th>ارزش (ریال)</th></>}</tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="wh-name">
                    <span dir="auto">{r.name}</span>
                    <div className="wh-sub">
                      <span>{r.brand}</span>
                      {r.sitePack && <span dir="auto">سایت: {r.sitePack.name} {r.sitePack.size} {r.sitePack.shade} · {r.sitePack.pack}</span>}
                      {r.priceSource === "item" && <span className="wh-flag">قیمت کالا — در سایت نیست</span>}
                    </div>
                  </td>
                  <td dir="ltr">{r.code}</td>
                  <td className="wh-qty">{faDigits(r.qty)} {r.baseUnit}
                    {Object.keys(r.byWarehouse).length > 1 && (
                      <div className="wh-sub"><span>{Object.entries(r.byWarehouse).map(([w, v]) => `${w}: ${faDigits(v)}`).join(" · ")}</span></div>
                    )}
                  </td>
                  {view === "unpriced"
                    ? <td><span className="wh-flag haz">{r.reason}</span></td>
                    : <><td className="wh-qty">{faRial(r.price)}</td><td className="wh-qty"><b>{faRial(r.value)}</b></td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.negatives.length > 0 && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          {faDigits(d.negatives.length)} کالا در یک انبار موجودی منفی دارد و در ارزش نیامده:{" "}
          {d.negatives.slice(0, 5).map((n) => n.name).join("، ")}
        </div>
      )}
    </>
  );
}

export function FinanceView() {
  const [status, setStatus] = useState("pending");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], count: 0, totals: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState(null);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [status, kind, qDebounced]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await financeApi.vouchers({ status, kind, q: qDebounced, page }));
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [status, kind, qDebounced, page]);
  useEffect(() => { reload(); }, [reload]);

  const totals = data.totals || {};
  const rows = data.results || [];
  const pageCount = Math.max(1, Math.ceil((data.count || 0) / 50));

  return (
    <>
      <div className="stats">
        <div className={totals.pending ? "stat warn" : "stat"}><b>{faDigits(totals.pending ?? 0)}</b><span>در کارتابل</span></div>
        <div className="stat"><b>{faDigits(totals.returned ?? 0)}</b><span>برگشت به انبار</span></div>
        <div className="stat"><b>{faDigits(totals.approved ?? 0)}</b><span>تأیید مالی</span></div>
      </div>

      <div className="card">
        <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
          حواله‌های خرید و مرجوعی پس از ورود به انبار، و حواله‌های فروش پس از ثبت نهایی انبار اینجا می‌آیند.
          قیمت‌ها و فاکتور طرف حساب را وارد کنید؛ مغایرت مقدار و مبلغ خودکار نشان داده می‌شود. سپس تأیید کنید یا با دلیل به انبار برگردانید.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: شمارهٔ حواله، طرف حساب یا شمارهٔ فاکتور…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">همهٔ انواع</option>
            <option value="receipt">ورود کالا (خرید)</option>
            <option value="return">مرجوعی از مشتری</option>
            <option value="sale">فروش</option>
          </select>
        </div>
        <div className="wh-toggles">
          <label><input type="radio" checked={status === "pending"} onChange={() => setStatus("pending")} /> در کارتابل</label>
          <label><input type="radio" checked={status === "returned"} onChange={() => setStatus("returned")} /> برگشت به انبار</label>
          <label><input type="radio" checked={status === "approved"} onChange={() => setStatus("approved")} /> تأیید مالی</label>
          <label><input type="radio" checked={status === "all"} onChange={() => setStatus("all")} /> همه</label>
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && !rows.length ? <div className="notice warn">{err}</div>
        : loading && !rows.length ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <Empty art="finance">{status === "pending" ? "کارتابل خالی است ✓" : "حواله‌ای پیدا نشد."}</Empty>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="print-table wh-table">
                <thead>
                  <tr><th>شماره</th><th>تاریخ</th><th>نوع</th><th>طرف حساب</th><th>فاکتور</th>
                    <th>اقلام</th><th>مبلغ</th><th>مغایرت</th><th>وضعیت</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((v) => {
                    const sm = v.summary || {};
                    const amount = v.invoiceTotal ?? (sm.unpriced ? null : sm.expectedTotal);
                    return (
                      <tr key={v.id}>
                        <td className="vc-num">{v.number}</td>
                        <td>{jShort(v.date)}</td>
                        <td>
                          <span className={v.isInbound ? "vc-dir in" : "vc-dir out"}>{v.isInbound ? "ورود" : "خروج"}</span>{" "}
                          {v.movementKindLabel}
                        </td>
                        <td>{v.counterparty || "—"}</td>
                        <td>{v.invoiceNo || v.ref || <span className="muted">—</span>}</td>
                        <td>{faDigits(v.lines.length)}</td>
                        <td className="num">{fmtRial(amount)}</td>
                        <td>
                          {sm.unpriced ? <span className="wh-flag">بی‌قیمت: {faDigits(sm.unpriced)}</span>
                            : sm.hasDiscrepancy ? <span className="wh-flag haz">دارد</span>
                            : <span className="wh-flag">ندارد</span>}
                        </td>
                        <td><span className={`status-chip fin-${v.financeStatus}`}>{FIN_STATUS[v.financeStatus]}</span></td>
                        <td className="wh-actions">
                          <button className="act edit" onClick={() => setOpenId(v.id)}>
                            {v.financeStatus === "pending" ? "بررسی" : "مشاهده"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="wh-pager">
                <button className="ghost" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>قبلی</button>
                <span>صفحهٔ {faDigits(page)} از {faDigits(pageCount)}</span>
                <button className="ghost" disabled={page >= pageCount} onClick={() => setPage((x) => x + 1)}>بعدی</button>
              </div>
            )}
          </>
        )}

      {openId && (
        <FinanceVoucherDialog id={openId} onClose={() => { setOpenId(null); reload(); }}
          onDone={async (text) => { setOpenId(null); flash(text); await reload(); }} />
      )}
    </>
  );
}
/** بررسی مالی یک حواله: فاکتور طرف حساب، قیمت‌ها و مغایرت. */
function FinanceVoucherDialog({ id, onClose, onDone }) {
  const [v, setV] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const seed = (d) => {
    setV(d);
    setForm({
      invoiceNo: d.invoiceNo || "", invoiceDate: d.invoiceDate || "",
      invoiceTotal: d.invoiceTotal ?? "", invoiceDiscount: d.invoiceDiscount || "",
      invoiceTax: d.invoiceTax || "", financeNote: d.financeNote || "",
      lines: d.lines.map((l) => ({
        id: l.id, invoiceQty: l.invoiceQty ?? "", unitCost: l.unitCost || "", unitPrice: l.unitPrice || "",
      })),
    });
  };
  useEffect(() => { financeApi.voucher(id).then(seed).catch((e) => setErr(e.message)); }, [id]);
  const canApprove = useCan()("finance.approve");

  if (!v || !form) {
    return (
      <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wh-dialog">{err ? <div className="err">{err}</div> : <div className="empty">در حال بارگذاری…</div>}</div>
      </div>
    );
  }

  const locked = v.financeStatus === "approved";
  const pending = v.financeStatus === "pending";
  const basis = v.summary.priceBasis;   // «cost»: خرید؛ «sale»: فروش و مرجوعی
  const setF = (k, val) => setForm((p) => ({ ...p, [k]: val }));
  const setLine = (i, k, val) => setForm((p) => ({
    ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: val } : l)),
  }));
  const num = (x) => (x === "" || x == null ? null : Number(x));

  // محاسبهٔ زنده، با همان قاعدهٔ سرور
  let invValue = 0;
  let unpriced = 0;
  const qtyMismatch = [];
  v.lines.forEach((l, i) => {
    const f = form.lines[i];
    const invQty = num(f.invoiceQty) ?? l.qty;
    const price = num(basis === "cost" ? f.unitCost : f.unitPrice) || 0;
    if (!price) unpriced += 1;
    invValue += invQty * price;
    if (invQty !== l.qty) qtyMismatch.push({ name: l.productName, wh: l.qty, inv: invQty, unit: l.unit });
  });
  const expected = invValue - (num(form.invoiceDiscount) || 0) + (num(form.invoiceTax) || 0);
  const total = num(form.invoiceTotal);
  const totalDiff = total == null ? null : total - expected;
  const totalMismatch = totalDiff != null && Math.abs(totalDiff) >= 1;
  const hasDiscrepancy = qtyMismatch.length > 0 || totalMismatch;
  const ready = Boolean(form.invoiceNo.trim()) && unpriced === 0;

  const payload = () => ({
    invoiceNo: form.invoiceNo.trim(),
    invoiceDate: form.invoiceDate || null,
    invoiceTotal: form.invoiceTotal === "" ? null : Number(form.invoiceTotal),
    invoiceDiscount: Number(form.invoiceDiscount) || 0,
    invoiceTax: Number(form.invoiceTax) || 0,
    financeNote: form.financeNote.trim(),
    lines: form.lines.map((f) => ({
      id: f.id,
      invoiceQty: f.invoiceQty === "" ? null : Number(f.invoiceQty),
      unitCost: Number(f.unitCost) || 0,
      unitPrice: Number(f.unitPrice) || 0,
    })),
  });

  async function run(action) {
    if (busy) return;
    if (action === "back" && !form.financeNote.trim()) {
      setErr("دلیل برگشت را در یادداشت مالی بنویسید تا انبار بداند چه چیزی را بررسی کند.");
      return;
    }
    setBusy(true); setErr(""); setOk("");
    try {
      if (action === "save") {
        seed(await financeApi.save(v.id, payload()));
        setOk("ذخیره شد ✓");
      } else if (action === "approve") {
        await financeApi.approve(v.id, payload());
        onDone(`حوالهٔ ${v.number} تأیید مالی شد ✓`);
      } else if (action === "reclaim") {
        await financeApi.reclaim(v.id, payload());
        onDone(`حوالهٔ ${v.number} به کارتابل مالی برگشت`);
      } else {
        await financeApi.sendBack(v.id, payload());
        onDone(`حوالهٔ ${v.number} با یادداشت به انبار برگشت`);
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const moneyInput = (value, onChange) => (
    <input type="number" min="0" disabled={locked} value={value} onChange={(e) => onChange(e.target.value)} />
  );

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog wide fin-dialog">
        <div className="board-h">{v.movementKindLabel} — حوالهٔ {v.number}</div>
        <div className="fin-head">
          <div><span>تاریخ حواله</span><b>{jShort(v.date)}</b></div>
          <div><span>انبار</span><b>{v.warehouseName}</b></div>
          <div><span>طرف حساب</span><b>{v.counterparty || "—"}</b></div>
          <div><span>شمارهٔ فاکتور (از انبار)</span><b>{v.ref || "—"}</b></div>
          <div><span>ثبت‌کنندهٔ انبار</span><b>{v.createdBy || "—"}</b></div>
          <div><span>وضعیت</span><b>{FIN_STATUS[v.financeStatus]}</b></div>
        </div>
        {v.note && <div className="muted sm2" style={{ marginBottom: 6 }}>یادداشت انبار: {v.note}</div>}
        {v.warehouseReply && <div className="notice">پاسخ انبار به برگشت قبلی: {v.warehouseReply}</div>}
        {locked && <div className="notice">تأیید مالی شده توسط {v.financeBy || "—"}.</div>}
        {v.financeStatus === "returned" && (
          <div className="notice warn">
            این حواله به انبار برگشته و منتظر پاسخ انبار است.
            {canApprove && (
              <> اگر انبار امکان اصلاح ندارد یا اشتباه برگردانده شد، می‌توانید با «بازپس‌گیری از انبار»
              حواله را به کارتابل مالی برگردانید و خودتان با یادداشت مغایرت تأیید کنید.</>
            )}
          </div>
        )}

        <div className="items-hd">فاکتور طرف حساب</div>
        <div className="row3">
          <label className="fld sm"><span>شمارهٔ فاکتور</span>
            <input disabled={locked} value={form.invoiceNo} onChange={(e) => setF("invoiceNo", e.target.value)} />
          </label>
          <div className="fld sm"><span>تاریخ فاکتور</span>
            {locked
              ? <input disabled value={form.invoiceDate ? jShort(form.invoiceDate) : "—"} />
              : <JalaliPicker value={form.invoiceDate} placeholder="— تعیین نشده —" onChange={(d) => setF("invoiceDate", d)} />}
          </div>
          <label className="fld sm"><span>جمع کل فاکتور (ریال)</span>
            {moneyInput(form.invoiceTotal, (x) => setF("invoiceTotal", x))}
          </label>
        </div>
        <div className="row2">
          <label className="fld sm"><span>تخفیف فاکتور (ریال)</span>{moneyInput(form.invoiceDiscount, (x) => setF("invoiceDiscount", x))}</label>
          <label className="fld sm"><span>مالیات و عوارض (ریال)</span>{moneyInput(form.invoiceTax, (x) => setF("invoiceTax", x))}</label>
        </div>

        <div className="items-hd">اقلام — مقدار انبار در برابر فاکتور</div>
        <div className="tbl-scroll">
          <table className="print-table fin-lines">
            <thead>
              <tr>
                <th>کالا</th><th>واحد</th><th>مقدار انبار</th><th>مقدار فاکتور</th>
                <th>{basis === "cost" ? "قیمت خرید (فی) *" : "قیمت خرید"}</th>
                <th>{basis === "sale" ? "قیمت فروش (فی) *" : "قیمت فروش"}</th>
                <th>جمع ردیف</th>
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l, i) => {
                const f = form.lines[i];
                const invQty = num(f.invoiceQty) ?? l.qty;
                const price = num(basis === "cost" ? f.unitCost : f.unitPrice) || 0;
                return (
                  <tr key={l.id} className={invQty !== l.qty ? "fin-mismatch" : ""}>
                    <td className="wh-name">
                      {l.productName}
                      <div className="wh-sub">{l.code && <span>کد {l.code}</span>}{l.packSize && <span>{l.packSize}</span>}</div>
                    </td>
                    <td>{l.unit}</td>
                    <td className="num">{faDigits(l.qty)}</td>
                    <td>
                      <input className="wh-cell" type="number" min="0" disabled={locked} placeholder={String(l.qty)}
                        value={f.invoiceQty} onChange={(e) => setLine(i, "invoiceQty", e.target.value)} />
                    </td>
                    <td>
                      <input className="wh-cell wide" type="number" min="0" disabled={locked}
                        value={f.unitCost} onChange={(e) => setLine(i, "unitCost", e.target.value)} />
                      {l.lastCost ? <div className="wh-sub"><span>قیمت فعلی کالا: {fmtRial(l.lastCost)}{l.baseUnit ? ` / ${l.baseUnit}` : ""}</span></div> : null}
                    </td>
                    <td>
                      <input className="wh-cell wide" type="number" min="0" disabled={locked}
                        value={f.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
                      {l.lastSalePrice ? <div className="wh-sub"><span>قیمت فعلی کالا: {fmtRial(l.lastSalePrice)}{l.baseUnit ? ` / ${l.baseUnit}` : ""}</span></div> : null}
                    </td>
                    <td className="num">{price ? fmtRial(invQty * price) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={totalMismatch ? "fin-summary warn" : "fin-summary"}>
          <div><span>جمع ردیف‌ها (با مقدار فاکتور)</span><b>{fmtRial(invValue)}</b></div>
          <div><span>پس از تخفیف و مالیات</span><b>{fmtRial(expected)}</b></div>
          <div><span>جمع کل فاکتور</span><b>{total == null ? "—" : fmtRial(total)}</b></div>
          <div><span>اختلاف</span><b>{totalDiff == null ? "—" : totalMismatch ? fmtRial(totalDiff) : "ندارد ✓"}</b></div>
        </div>
        {(qtyMismatch.length > 0 || unpriced > 0) && (
          <ul className="merge-notes">
            {unpriced > 0 && <li>{faDigits(unpriced)} قلم هنوز {basis === "cost" ? "قیمت خرید" : "قیمت فروش"} ندارد.</li>}
            {qtyMismatch.map((m) => (
              <li key={m.name} className="fin-warn-li">«{m.name}»: انبار {faDigits(m.wh)} ولی فاکتور {faDigits(m.inv)} {m.unit}</li>
            ))}
          </ul>
        )}

        <label className="fld">
          <span>{hasDiscrepancy && pending ? "یادداشت مالی — توضیح مغایرت (برای تأیید با مغایرت لازم است)" : "یادداشت مالی"}</span>
          <textarea rows={2} disabled={locked} value={form.financeNote} onChange={(e) => setF("financeNote", e.target.value)}
            placeholder={pending ? "توضیح مغایرت، یا دلیل برگشت به انبار" : ""} />
        </label>

        {err && <div className="err">{err}</div>}
        {ok && <div className="ok-msg">{ok}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>بستن</button>
          {!locked && canApprove && <button className="ghost" disabled={busy} onClick={() => run("save")}>ذخیره</button>}
          {v.financeStatus === "returned" && canApprove && (
            <button className="ghost" disabled={busy} onClick={() => run("reclaim")}>بازپس‌گیری از انبار</button>
          )}
          {pending && canApprove && <button className="ghost" disabled={busy} onClick={() => run("back")}>برگشت به انبار</button>}
          {pending && canApprove && (
            <button className={hasDiscrepancy ? "submit-warn" : "submit"} style={{ width: "auto", margin: 0 }}
              disabled={busy || !ready || (hasDiscrepancy && !form.financeNote.trim())} onClick={() => run("approve")}>
              {busy ? "…" : hasDiscrepancy ? "تأیید با مغایرت" : "تأیید مالی"}
            </button>
          )}
        </div>
        {pending && canApprove && (
          <WhyOff busy={busy} label={hasDiscrepancy ? "تأیید با مغایرت" : "تأیید مالی"} reasons={[
            !form.invoiceNo.trim() && "شمارهٔ فاکتور نوشته نشده",
            unpriced > 0 && `${basis === "cost" ? "قیمت خرید" : "قیمت فروش"} ${faDigits(unpriced)} قلم وارد نشده`,
            ready && hasDiscrepancy && !form.financeNote.trim() && "توضیح مغایرت در یادداشت مالی نوشته نشده",
          ]} />
        )}
        {pending && ready && hasDiscrepancy && (
          <div className="muted sm2">
            این حواله با فاکتور مغایرت دارد. برای «تأیید با مغایرت»، توضیح مغایرت را در یادداشت مالی بنویسید و دکمهٔ نارنجی
            «تأیید با مغایرت» را بزنید. اگر تصمیم گرفتید حواله اصلاح شود، «برگشت به انبار» بزنید.
          </div>
        )}
      </div>
    </div>
  );
}
/** پاسخ انبار به حواله‌ای که مالی برگردانده. */
export function FinanceReplyDialog({ voucher, onClose, onDone }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!reply.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      await warehouseApi.resubmitFinance(voucher.id, reply.trim());
      onDone(`حوالهٔ ${voucher.number} دوباره به کارتابل مالی رفت`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">پاسخ به مالی — حوالهٔ {voucher.number}</div>
        <div className="notice warn">مالی: {voucher.financeNote}</div>
        <div className="muted sm2" style={{ margin: "8px 0" }}>
          حوالهٔ ثبت‌شده ویرایش نمی‌شود. اگر مقدار اشتباه بوده، حوالهٔ اصلاحی بزنید و شماره‌اش را در پاسخ بنویسید.
        </div>
        <label className="fld"><span>پاسخ</span>
          <textarea rows={3} autoFocus value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder="چه چیزی بررسی یا اصلاح شد" />
        </label>
        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={!reply.trim() || busy} onClick={send}>
            {busy ? "…" : "ارسال دوباره به مالی"}
          </button>
        </div>
        <WhyOff busy={busy} reasons={[!reply.trim() && "پاسخ نوشته نشده"]} />
      </div>
    </div>
  );
}
