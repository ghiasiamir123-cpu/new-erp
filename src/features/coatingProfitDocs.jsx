import { useEffect, useState } from "react";
import { financeReportsApi } from "../api.js";
import { DocLetterhead, PrintableDoc, faDigits, faRial, jLong, jShort, todayIso } from "../shared/core.jsx";

/* ============ برگه‌های چاپیِ سود مرکز پوشش ============
   سه خروجی، همه با «چاپ / ذخیرهٔ PDF» مرورگر (مثل فیش حقوقی و حواله‌ها):
     · گزارش کلی — یک جدول از همهٔ پروژه‌ها، کاغذ افقی
     · گزارش یک پروژه — دستمزد، متریال، دریافتی‌ها و سود همان پروژه
     · همهٔ پروژه‌ها با جزئیات — همان برگهٔ پروژه، هر پروژه از سرِ یک صفحهٔ تازه
   اعداد همان‌هایی‌اند که صفحه نشان می‌دهد (backend/core/coating_profit.py)؛ اینجا چیزی حساب نمی‌شود جز جمع. */

const STATE = { active: "در جریان", closed: "بسته", inactive: "غیرفعال" };
const RATE_SOURCE = { own: "نرخ خودش", average: "میانگین کارگاه", none: "بی‌نرخ" };
const rial = (n) => (n == null ? "—" : faRial(n));
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

/** نامِ پرونده‌ای که مرورگر هنگام «ذخیرهٔ PDF» پیشنهاد می‌دهد از عنوان صفحه می‌آید. */
function useDocTitle(title) {
  useEffect(() => {
    const was = document.title;
    document.title = title;
    return () => { document.title = was; };
  }, [title]);
}
const fileName = (text) => `${text}-${isoStamp()}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
const isoStamp = () => jShort(todayIso()).replace(/\//g, "-");

function Notes({ p }) {
  const pending = p.issues.pendingWork + p.issues.pendingUsage;
  if (p.complete && !pending && !p.issues.labourEstimated) return null;
  return (
    <div className="doc-amend">
      {!p.complete && (
        <div>
          <b>قیمت تمام‌شده کمتر از واقع است:</b>{" "}
          {[p.issues.labourMissing > 0 && `${faDigits(p.issues.labourMissing)} کارگر نرخ ندارد`,
            p.issues.material > 0 && `${faDigits(p.issues.material)} ردیف متریال قیمت یا واحد ندارد`].filter(Boolean).join(" و ")}
          {" "}و در هزینه نیامده است.
        </div>
      )}
      {p.issues.labourEstimated > 0 && (
        <div>دستمزد {faDigits(p.issues.labourEstimated)} کارگر با میانگین کارگاه حساب شده، نه نرخ خودش (تخمینی).</div>
      )}
      {pending > 0 && (
        <div>
          {[p.issues.pendingWork > 0 && `${faDigits(p.issues.pendingWork)} گزارش کار`,
            p.issues.pendingUsage > 0 && `${faDigits(p.issues.pendingUsage)} گزارش مصرف مواد`].filter(Boolean).join(" و ")}
          {" "}هنوز تأیید نشده و در هزینه نیامده است.
        </div>
      )}
    </div>
  );
}

/** برگهٔ یک پروژه. p باید ردیف‌های دستمزد، متریال و دریافتی را داشته باشد. */
function ProjectSheet({ p }) {
  const profit = p.profit != null ? p.profit : p.contractProfit;
  return (
    <div className="doc-sheet cp-sheet">
      <style>{"@media print{@page{size:A4 portrait;margin:12mm}}"}</style>
      <DocLetterhead title="قیمت تمام‌شده و سود پروژه" subtitle={`مرکز پوشش · ${jLong(todayIso())}`} />

      <div className="doc-info">
        <div><span>پروژه</span><b>{p.label}</b></div>
        <div><span>کارفرما</span><b>{p.owner || "—"}</b></div>
        <div><span>وضعیت</span><b>{STATE[p.state]}</b></div>
        <div><span>متراژ چوب</span><b>{p.area ? `${faDigits(p.area)} متر مربع` : "—"}</b></div>
        <div><span>ساعت کار تأییدشده</span><b>{faDigits(p.hours)} ساعت</b></div>
        <div><span>قیمت تمام‌شدهٔ هر متر</span><b>{p.perM2 != null ? `${faRial(p.perM2)} ریال` : "—"}</b></div>
      </div>

      <div className="doc-cols cp-cols">
        <section className="doc-col deduct">
          <h3>قیمت تمام‌شده</h3>
          <div className="doc-line"><span>دستمزد</span><b>{rial(p.labour)}</b></div>
          <div className="doc-line"><span>متریال مصرفی</span><b>{rial(p.material)}</b></div>
          <div className="doc-line total"><span>جمع قیمت تمام‌شده</span><b>{rial(p.cost)}</b></div>
        </section>
        <section className="doc-col earn">
          <h3>فروش و دریافتی</h3>
          <div className="doc-line"><span>فروش{p.saleLabel ? ` (${p.saleLabel})` : ""}</span><b>{rial(p.sale)}</b></div>
          <div className="doc-line"><span>دریافتی از کارفرما</span><b>{rial(p.received || null)}</b></div>
          <div className="doc-line total"><span>مانده طلب</span><b>{rial(p.receivable)}</b></div>
        </section>
      </div>

      <div className={profit != null && profit < 0 ? "doc-net loss" : "doc-net"}>
        <span>
          {p.profit != null ? "سود بر دریافتی (دریافتی − قیمت تمام‌شده)" : p.contractProfit != null ? "سود فروش (فروش − قیمت تمام‌شده)" : "سود"}
          {p.profit != null && p.contractProfit != null && (
            <small> · سود فروش: {faRial(p.contractProfit)}{p.margin != null ? ` (${faDigits(p.margin)}٪)` : ""}</small>
          )}
          {p.profit == null && p.margin != null && <small> · حاشیه {faDigits(p.margin)}٪</small>}
        </span>
        <b>{profit == null ? "—" : faRial(profit)} <small>ریال</small></b>
      </div>

      <Notes p={p} />

      <div className="doc-sec">دستمزد</div>
      {p.labourRows.length === 0 ? <div className="doc-none">ساعت کار تأییدشده‌ای ندارد.</div> : (
        <table className="doc-table">
          <thead><tr><th>کارگر</th><th>فعالیت‌ها (ساعت)</th><th>ساعت</th><th>نرخ هر ساعت</th><th>مبنای نرخ</th><th>دستمزد (ریال)</th></tr></thead>
          <tbody>
            {p.labourRows.map((r) => (
              <tr key={r.name}>
                <td className="nm">{r.name}</td>
                <td className="nm">{r.activities.map((a) => `${a.activity} ${faDigits(a.hours)}`).join(" · ")}</td>
                <td>{faDigits(r.hours)}</td>
                <td>{r.rate ? faRial(r.rate) : "—"}</td>
                <td className="nm">{RATE_SOURCE[r.rateSource]}</td>
                <td className="net">{rial(r.cost)}</td>
              </tr>
            ))}
            <tr className="tot"><td className="nm" colSpan={2}>جمع دستمزد</td><td>{faDigits(p.hours)}</td><td /><td /><td className="net">{rial(p.labour)}</td></tr>
          </tbody>
        </table>
      )}

      <div className="doc-sec">متریال مصرفی</div>
      {p.materialRows.length === 0 ? <div className="doc-none">مصرف مواد تأییدشده‌ای ندارد.</div> : (
        <table className="doc-table">
          <thead><tr><th>کالا</th><th>مصرف</th><th>به واحد اصلی</th><th>قیمت هر واحد اصلی</th><th>هزینه (ریال)</th></tr></thead>
          <tbody>
            {p.materialRows.map((r) => (
              <tr key={`${r.skuId || r.name}-${r.unit}`}>
                <td className="nm">{r.name}{r.code ? <div className="cp-code">{r.code}</div> : null}</td>
                <td className="nm">{faDigits(r.qty)} {r.unit}</td>
                <td className="nm">{r.reason === "no_unit" || r.reason === "no_sku" ? "—" : `${faDigits(r.baseQty)} ${r.baseUnit}`}</td>
                <td>{rial(r.unitCost)}</td>
                <td className={r.reason ? "nm cp-miss" : "net"}>{r.reason ? r.reasonLabel : rial(r.cost)}</td>
              </tr>
            ))}
            <tr className="tot"><td className="nm" colSpan={4}>جمع متریال</td><td className="net">{rial(p.material)}</td></tr>
          </tbody>
        </table>
      )}

      <div className="doc-sec">دریافتی از کارفرما</div>
      {p.receipts.length === 0 ? <div className="doc-none">دریافتی‌ای ثبت نشده است.</div> : (
        <table className="doc-table">
          <thead><tr><th>تاریخ</th><th>مبلغ (ریال)</th><th>توضیح</th><th>ثبت‌کننده</th></tr></thead>
          <tbody>
            {p.receipts.map((r) => (
              <tr key={r.id}><td>{jShort(r.date)}</td><td className="net">{faRial(r.amount)}</td><td className="nm">{r.note || "—"}</td><td className="nm">{r.by || "—"}</td></tr>
            ))}
            <tr className="tot"><td className="nm">جمع دریافتی</td><td className="net">{rial(p.received)}</td><td /><td /></tr>
          </tbody>
        </table>
      )}

      <div className="doc-sign">
        <div>تهیه‌کننده: ......................................</div>
        <div>مدیر مالی: ......................................</div>
        <div>مدیریت: ......................................</div>
      </div>
      <div className="doc-foot">
        تولیدشده در Diwaj ERP · ارقام به ریال · فقط گزارش‌های کار و مصرف موادِ تأییدشده در هزینه آمده‌اند · دستمزد = ساعت × نرخ هر کارگر · متریال = مصرف × قیمت تمام‌شدهٔ کالا
      </div>
    </div>
  );
}

/** گزارش یک پروژه. اگر ردیف‌هایش هنوز گرفته نشده، خودش می‌گیرد. */
export function CoatingProjectDoc({ id, project, onClose }) {
  const [p, setP] = useState(project || null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (project) return;
    financeReportsApi.coatingProfit(id).then((x) => setP(x.project)).catch((e) => setErr(e.message));
  }, [id, project]);
  useDocTitle(fileName(`سود-پروژه-${p ? p.label : ""}`));
  return (
    <PrintableDoc onClose={onClose}>
      {p ? <ProjectSheet p={p} /> : <div className="doc-sheet">{err ? <div className="notice warn">{err}</div> : <div className="empty">در حال آماده‌سازی گزارش…</div>}</div>}
    </PrintableDoc>
  );
}

/** همهٔ پروژه‌های فهرست، هر کدام برگهٔ خودش و از سرِ یک صفحهٔ تازه. ids همان پروژه‌هایی است که صفحه نشان می‌دهد. */
export function CoatingAllProjectsDoc({ ids, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    financeReportsApi.coatingProfit(null, true)
      .then((x) => { const want = new Set(ids); setRows(x.projects.filter((p) => want.has(p.id))); })
      .catch((e) => setErr(e.message));
  }, [ids]);
  useDocTitle(fileName("سود-مرکز-پوشش-جزئیات-پروژه‌ها"));
  return (
    <PrintableDoc onClose={onClose}>
      {rows ? (
        <div className="cp-stack">
          {rows.map((p) => <div className="cp-page" key={p.id}><ProjectSheet p={p} /></div>)}
        </div>
      ) : <div className="doc-sheet">{err ? <div className="notice warn">{err}</div> : <div className="empty">در حال آماده‌سازی گزارش همهٔ پروژه‌ها…</div>}</div>}
    </PrintableDoc>
  );
}

/** گزارش کلی: یک ردیف برای هر پروژه و جمعِ همه. list همان فهرستِ فیلترشدهٔ صفحه است. */
export function CoatingSummaryDoc({ list, filter, issueCount, onClose }) {
  useDocTitle(fileName("سود-مرکز-پوشش-گزارش-کلی"));
  const paid = list.filter((p) => p.received);
  const profit = paid.reduce((a, p) => a + p.profit, 0);
  const owed = list.reduce((a, p) => a + Math.max(0, p.receivable || 0), 0);
  const cost = sum(list, "cost"), contract = sum(list, "sale");
  const withContract = list.filter((p) => p.sale);
  const contractProfit = withContract.reduce((a, p) => a + p.contractProfit, 0);
  const incomplete = list.filter((p) => !p.complete).length;
  return (
    <PrintableDoc onClose={onClose}>
      {/* کاغذ افقی فقط برای همین برگه؛ با بسته شدنش برمی‌گردد */}
      <style>{"@media print{@page{size:A4 landscape;margin:10mm}}"}</style>
      <div className="doc-sheet wide cp-sheet">
        <DocLetterhead title="سود مرکز پوشش — گزارش کلی" subtitle={`${filter} · ${jLong(todayIso())}`} />

        <div className="doc-info cp-four">
          <div><span>پروژه‌ها</span><b>{faDigits(list.length)}</b></div>
          <div><span>قیمت تمام‌شده</span><b>{faRial(cost)}</b></div>
          <div><span>دستمزد</span><b>{faRial(sum(list, "labour"))}</b></div>
          <div><span>متریال</span><b>{faRial(sum(list, "material"))}</b></div>
          <div><span>جمع فروش</span><b>{faRial(contract)}</b></div>
          <div><span>دریافتی از کارفرما</span><b>{faRial(sum(list, "received"))}</b></div>
          <div><span>مانده طلب</span><b>{faRial(owed)}</b></div>
          <div><span>سود پروژه‌های دارای دریافتی ({faDigits(paid.length)} پروژه)</span><b className={profit < 0 ? "cp-neg" : ""}>{faRial(profit)}</b></div>
        </div>

        {(incomplete > 0 || issueCount > 0) && (
          <div className="doc-amend">
            <b>قیمت تمام‌شدهٔ {faDigits(incomplete)} پروژه کمتر از واقع است:</b> بعضی کارگرها نرخ و بعضی کالاها قیمت یا واحد ندارند و در هزینه نیامده‌اند
            (ستون «قیمت» در جدول). تا اصلاح نشوند، سودِ همان پروژه‌ها بیش از واقع دیده می‌شود.
          </div>
        )}

        <table className="doc-table cp-wide">
          <thead>
            <tr><th>#</th><th>پروژه</th><th>کارفرما</th><th>وضعیت</th><th>متراژ</th><th>ساعت</th><th>دستمزد</th><th>متریال</th><th>قیمت تمام‌شده</th>
              <th>هر متر</th><th>فروش</th><th>دریافتی</th><th>مانده طلب</th><th>سود بر دریافتی</th><th>سود فروش</th><th>حاشیه</th><th>قیمت</th></tr>
          </thead>
          <tbody>
            {list.map((p, i) => (
              <tr key={p.id}>
                <td>{faDigits(i + 1)}</td>
                <td className="nm">{p.label}</td>
                <td className="nm">{p.owner || "—"}</td>
                <td>{STATE[p.state]}</td>
                <td>{p.area ? faDigits(p.area) : "—"}</td>
                <td>{faDigits(p.hours)}</td>
                <td>{rial(p.labour)}</td>
                <td>{rial(p.material)}</td>
                <td className="net">{rial(p.cost)}</td>
                <td>{rial(p.perM2)}</td>
                <td>{rial(p.sale)}{p.saleSource && p.saleSource !== "invoice" ? <div className="cp-code">{p.saleLabel}</div> : null}</td>
                <td>{rial(p.received || null)}</td>
                <td>{rial(p.receivable)}</td>
                <td className={p.profit != null && p.profit < 0 ? "net cp-neg" : "net"}>{rial(p.profit)}</td>
                <td className={p.contractProfit != null && p.contractProfit < 0 ? "cp-neg" : ""}>{rial(p.contractProfit)}</td>
                <td>{p.margin != null ? `${faDigits(p.margin)}٪` : "—"}</td>
                <td className="nm">{p.complete ? "کامل" : "ناقص"}</td>
              </tr>
            ))}
            <tr className="tot">
              <td className="nm" colSpan={4}>جمع {faDigits(list.length)} پروژه</td>
              <td>{faDigits(Math.round(sum(list, "area") * 100) / 100)}</td>
              <td>{faDigits(Math.round(sum(list, "hours") * 100) / 100)}</td>
              <td>{faRial(sum(list, "labour"))}</td>
              <td>{faRial(sum(list, "material"))}</td>
              <td className="net">{faRial(cost)}</td>
              <td />
              <td>{faRial(contract)}</td>
              <td>{faRial(sum(list, "received"))}</td>
              <td>{faRial(owed)}</td>
              <td className="net">{faRial(profit)}</td>
              <td>{faRial(contractProfit)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>

        <div className="doc-sign">
          <div>تهیه‌کننده: ......................................</div>
          <div>مدیر مالی: ......................................</div>
          <div>مدیریت: ......................................</div>
        </div>
        <div className="doc-foot">
          تولیدشده در Diwaj ERP · ارقام به ریال · «سود بر دریافتی» فقط برای پروژه‌هایی است که دریافتی دارند (دریافتی − قیمت تمام‌شده) · «سود فروش» = فروش − قیمت تمام‌شده؛ فروش از فاکتورهای صادرشده و پیش‌فاکتورهای فاکتورنشده است، و اگر هیچ‌کدام نباشد مبلغ قرارداد
          · «مانده طلب» در جمع، فقط طلب‌های مثبت است · فقط گزارش‌های تأییدشده در هزینه آمده‌اند
        </div>
      </div>
    </PrintableDoc>
  );
}
