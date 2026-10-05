import { DocLetterhead, PrintableDoc, faDigits, faRial, jLong, jShort, saveBook, todayIso } from "../shared/core.jsx";
import { fileName, useDocTitle } from "./coatingProfitDocs.jsx";

/* ============ خروجیِ «گردش مالی دیواژ» ============
   همان اعدادِ صفحه (backend/core/discount_profit.py)، یک‌بار به‌شکل برگهٔ چاپی (چاپ / ذخیرهٔ PDF) و یک‌بار اکسلِ چندبرگه.
   اینجا چیزی حساب نمی‌شود جز جمعِ ستون‌ها. */

export const PERIODS = [["month", "این ماه"], ["quarter", "سه ماه"], ["half", "شش ماه"], ["year", "یک سال"], ["all", "از ابتدا"]];
export const SUMMARY_ROWS = [
  ["salesMargin", "سود فروش (قیمت فروش − قیمت خرید − تخفیف مشتری)"],
  ["discountWorkshop", "تخفیف خرید، محقق‌شده با انتقال به مرکز پوشش"],
  ["discountSale", "تخفیف خرید، محقق‌شده با فروش"],
  ["total", "جمع سود دیواژ (ریال)"],
  ["salesRevenue", "فروش به مشتری"],
  ["workshopValue", "انتقال به مرکز پوشش، به قیمت لیست"],
];
const CHANNEL = (e) => (e.channel === "sale" ? "فروش" : "مرکز پوشش");
const rial = (n) => (n == null || n === "" ? "—" : faRial(Math.round(Number(n))));
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const num = (n) => (n == null || n === "" ? "" : Math.round(Number(n)));

export const rangeText = (from, to) => (from || to
  ? `${from ? "از " + jShort(from) : "از ابتدا"} ${to ? "تا " + jShort(to) : "تا امروز"}` : "همهٔ فروش‌ها");

export function exportDiwajTurnover(d, from, to) {
  const r = d.range, t = d.totals;
  saveBook("گردش-مالی-دیواژ", [
    ["خلاصه", [
      ["گردش مالی دیواژ", ...PERIODS.map(([, l]) => l)],
      ...SUMMARY_ROWS.map(([k, l]) => [l, ...PERIODS.map(([p]) => num(d.summary[p][k]))]),
      [],
      [`فروش در بازه: ${rangeText(from, to)}`],
      ["فروش، پس از تخفیف", num(r.salesRevenue)],
      ["قیمت خرید همان کالاها", num(r.salesCost)],
      ["سود فروش", num(r.salesMargin)],
      ["تخفیف مشتری", num(r.customerDiscount)],
      ["تعداد حوالهٔ فروش", r.salesCount],
      [],
      ["تخفیف فاکتور خرید"],
      ["تخفیف محقق‌شده", num(t.realised)],
      ["در انتظار انتقال یا فروش", num(t.pending)],
      ["جمع تخفیف فاکتورها", num(t.discount)],
      ["فاکتور تخفیف‌دار", t.invoices],
    ]],
    ["فروش کالاها", [
      ["کالا", "کد", "برند", "مقدار", "واحد", "میانگین قیمت فروش", "مبلغ فروش", "قیمت خرید", "سود", "تعداد حواله"],
      ...r.items.map((it) => [it.name, it.code || "", it.brand || "", it.qty, it.unit, num(it.avgPrice), num(it.revenue), num(it.cost), num(it.margin), it.vouchers]),
    ]],
    ["حواله‌های فروش", [
      ["حواله", "تاریخ", "مشتری", "فروش", "خرید", "تخفیف مشتری", "سود", "٪"],
      ...r.vouchers.map((v) => [v.number, jShort(v.date), v.customer || "", num(v.revenue), num(v.cost), num(v.discount), num(v.margin), v.percent == null ? "" : v.percent]),
    ]],
    ["فاکتورهای خرید", [
      ["حواله", "تاریخ", "فاکتور", "تأمین‌کننده", "جمع لیست", "تخفیف", "٪", "پرداختی", "محقق‌شده", "در انتظار"],
      ...d.invoices.map((v) => [v.number, jShort(v.date), v.invoiceNo || "", v.supplier || "", num(v.listTotal), num(v.discount), v.percent, num(v.paid), num(v.realised), num(v.pending)]),
    ]],
    ["ردیف فاکتورهای خرید", [
      ["حواله", "کالا", "کد", "قیمت لیست", "خالص دیواژ", "تخفیف", "مقدار", "منتقل‌شده", "واحد", "محقق‌شده", "در انتظار"],
      ...d.invoices.flatMap((v) => v.lines.map((l) => [v.number, l.name, l.code || "", num(l.listCost), num(l.netCost), num(l.discount), l.qty, l.moved, l.unit, num(l.realised), num(l.pending)])),
    ]],
    ["برندها", [
      ["برند", "تخفیف", "محقق‌شده", "در انتظار"],
      ...d.byBrand.map((b) => [b.brand, num(b.discount), num(b.realised), num(b.pending)]),
    ]],
    ["انتقال و فروش", [
      ["تاریخ", "حواله", "نوع", "کالا", "مقدار", "واحد", "سود (ریال)"],
      ...d.events.map((e) => [jShort(e.date), e.voucher || "", CHANNEL(e), e.name, e.qty, e.unit, num(e.profit)]),
    ]],
  ]);
}

export function DiwajTurnoverDoc({ d, from, to, onClose }) {
  useDocTitle(fileName("گردش-مالی-دیواژ"));
  const r = d.range, t = d.totals, all = d.summary.all;
  return (
    <PrintableDoc onClose={onClose}>
      <style>{"@media print{@page{size:A4 landscape;margin:10mm}}"}</style>
      <div className="doc-sheet wide cp-sheet">
        <DocLetterhead title="گردش مالی دیواژ" subtitle={`فروش: ${rangeText(from, to)} · ${jLong(todayIso())}`} />

        <div className="doc-info cp-four">
          <div><span>جمع سود دیواژ (از ابتدا)</span><b>{rial(all.total)}</b></div>
          <div><span>سود فروش</span><b>{rial(all.salesMargin)}</b></div>
          <div><span>تخفیف خرید محقق‌شده</span><b>{rial(t.realised)}</b></div>
          <div><span>تخفیف در انتظار انتقال یا فروش</span><b>{rial(t.pending)}</b></div>
          <div><span>جمع تخفیف فاکتورها</span><b>{rial(t.discount)}</b></div>
          <div><span>فاکتور تخفیف‌دار</span><b>{faDigits(t.invoices)}</b></div>
          <div><span>فروش به مشتری</span><b>{rial(all.salesRevenue)}</b></div>
          <div><span>انتقال به مرکز پوشش (قیمت لیست)</span><b>{rial(all.workshopValue)}</b></div>
        </div>

        {(d.sales.pendingVouchers > 0 || d.sales.unpricedLines > 0 || d.sales.suspicious.length > 0) && (
          <div className="doc-amend">
            {d.sales.pendingVouchers > 0 && <div>{faDigits(d.sales.pendingVouchers)} حوالهٔ فروش هنوز تأیید مالی نشده و در سود نیامده است.</div>}
            {d.sales.unpricedLines > 0 && <div>{faDigits(d.sales.unpricedLines)} ردیف فروش قیمت خرید یا فروش ندارد و در سود حساب نشده.</div>}
            {d.sales.suspicious.map((x) => (
              <div key={x.voucher + x.name}>حوالهٔ {x.voucher} — «{x.name}»: قیمت خرید ردیف {rial(x.lineCost)} ریال است ولی قیمت تمام‌شدهٔ خودِ کالا {rial(x.itemCost)} ریال.</div>
            ))}
          </div>
        )}

        <div className="doc-sec">خلاصه به تفکیک دوره</div>
        <table className="doc-table">
          <thead><tr><th></th>{PERIODS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>
            {SUMMARY_ROWS.map(([k, l]) => (
              <tr key={k} className={k === "total" ? "tot" : ""}>
                <td className="nm">{l}</td>
                {PERIODS.map(([p]) => <td key={p}>{rial(d.summary[p][k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="doc-sec">فروش در بازه — {rangeText(from, to)} (فقط حواله‌های فروشِ تأییدشدهٔ مالی)</div>
        <div className="doc-info cp-four dt-five">
          <div><span>فروش، پس از تخفیف</span><b>{rial(r.salesRevenue)}</b></div>
          <div><span>قیمت خرید همان کالاها</span><b>{rial(r.salesCost)}</b></div>
          <div><span>سود فروش</span><b>{rial(r.salesMargin)}</b></div>
          <div><span>تخفیف مشتری</span><b>{rial(r.customerDiscount)}</b></div>
          <div><span>حوالهٔ فروش</span><b>{faDigits(r.salesCount)}</b></div>
        </div>
        {r.items.length === 0 ? <div className="doc-none">در این بازه فروشِ تأییدشده‌ای نیست.</div> : (
          <table className="doc-table">
            <thead><tr><th>#</th><th>کالا</th><th>برند</th><th>مقدار</th><th>میانگین قیمت فروش</th><th>مبلغ فروش</th><th>قیمت خرید</th><th>سود</th><th>حواله</th></tr></thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={it.name + it.unit}>
                  <td>{faDigits(i + 1)}</td>
                  <td className="nm">{it.name}{it.code ? <div className="cp-code">{it.code}</div> : null}</td>
                  <td>{it.brand || "—"}</td><td>{faDigits(it.qty)} {it.unit}</td><td>{rial(it.avgPrice)}</td>
                  <td>{rial(it.revenue)}</td><td>{rial(it.cost)}</td><td className="net">{rial(it.margin)}</td><td>{faDigits(it.vouchers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {r.vouchers.length > 0 && (
          <>
            <div className="doc-sec">سود فروش به تفکیک حواله</div>
            <table className="doc-table">
              <thead><tr><th>#</th><th>حواله</th><th>تاریخ</th><th>مشتری</th><th>فروش</th><th>خرید</th><th>تخفیف مشتری</th><th>سود</th><th>٪</th></tr></thead>
              <tbody>
                {r.vouchers.map((v, i) => (
                  <tr key={v.id}>
                    <td>{faDigits(i + 1)}</td><td className="nm">{v.number}</td><td>{jShort(v.date)}</td><td className="nm">{v.customer || "—"}</td>
                    <td>{rial(v.revenue)}</td><td>{rial(v.cost)}</td><td>{rial(v.discount)}</td>
                    <td className="net">{rial(v.margin)}</td><td>{v.percent == null ? "—" : `${faDigits(v.percent)}٪`}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td className="nm" colSpan={4}>جمع {faDigits(r.vouchers.length)} حواله</td>
                  <td>{rial(sum(r.vouchers, "revenue"))}</td><td>{rial(sum(r.vouchers, "cost"))}</td><td>{rial(sum(r.vouchers, "discount"))}</td>
                  <td className="net">{rial(sum(r.vouchers, "margin"))}</td><td />
                </tr>
              </tbody>
            </table>
          </>
        )}

        {d.invoices.length > 0 && (
          <>
            <div className="doc-sec">تخفیف فاکتور خرید — به تفکیک فاکتور</div>
            <table className="doc-table">
              <thead><tr><th>#</th><th>حواله</th><th>تاریخ</th><th>فاکتور</th><th>جمع لیست</th><th>تخفیف</th><th>٪</th><th>پرداختی</th><th>محقق‌شده</th><th>در انتظار</th></tr></thead>
              <tbody>
                {d.invoices.map((v, i) => (
                  <tr key={v.id}>
                    <td>{faDigits(i + 1)}</td><td className="nm">{v.number}</td><td>{jShort(v.date)}</td>
                    <td className="nm">{v.invoiceNo || "—"}{v.supplier ? <div className="cp-code" style={{ direction: "rtl" }}>{v.supplier}</div> : null}</td>
                    <td>{rial(v.listTotal)}</td><td>{rial(v.discount)}</td><td>{faDigits(v.percent)}٪</td>
                    <td>{rial(v.paid)}</td><td className="net">{rial(v.realised)}</td><td>{rial(v.pending)}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td className="nm" colSpan={4}>جمع {faDigits(d.invoices.length)} فاکتور</td>
                  <td>{rial(sum(d.invoices, "listTotal"))}</td><td>{rial(sum(d.invoices, "discount"))}</td><td />
                  <td>{rial(sum(d.invoices, "paid"))}</td><td className="net">{rial(sum(d.invoices, "realised"))}</td><td>{rial(sum(d.invoices, "pending"))}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {d.byBrand.length > 0 && (
          <>
            <div className="doc-sec">تخفیف فاکتور خرید — به تفکیک برند</div>
            <table className="doc-table">
              <thead><tr><th>برند</th><th>تخفیف</th><th>محقق‌شده</th><th>در انتظار</th></tr></thead>
              <tbody>
                {d.byBrand.map((b) => (
                  <tr key={b.brand}><td className="nm">{b.brand}</td><td>{rial(b.discount)}</td><td className="net">{rial(b.realised)}</td><td>{rial(b.pending)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {d.events.length > 0 && (
          <>
            <div className="doc-sec">انتقال‌ها و فروش‌هایی که تخفیف را محقق کرده‌اند</div>
            <table className="doc-table">
              <thead><tr><th>#</th><th>تاریخ</th><th>حواله</th><th>نوع</th><th>کالا</th><th>مقدار</th><th>سود (ریال)</th></tr></thead>
              <tbody>
                {d.events.map((e, i) => (
                  <tr key={i}><td>{faDigits(i + 1)}</td><td>{jShort(e.date)}</td><td className="nm">{e.voucher || "—"}</td><td>{CHANNEL(e)}</td>
                    <td className="nm">{e.name}</td><td>{faDigits(e.qty)} {e.unit}</td><td className="net">{rial(e.profit)}</td></tr>
                ))}
                <tr className="tot"><td className="nm" colSpan={6}>جمع</td><td className="net">{rial(sum(d.events, "profit"))}</td></tr>
              </tbody>
            </table>
          </>
        )}

        <div className="doc-sign">
          <div>تهیه‌کننده: ......................................</div>
          <div>مدیر مالی: ......................................</div>
          <div>مدیریت: ......................................</div>
        </div>
        <div className="doc-foot">
          تولیدشده در Diwaj ERP · ارقام به ریال · فقط فاکتورها و حواله‌های تأییدشدهٔ مالی · تخفیف فاکتور خرید با انتقال کالا به مرکز پوشش یا فروش آن محقق می‌شود ·
          مبلغ هر کالا در جدول فروش پیش از تخفیف کل فاکتور است
        </div>
      </div>
    </PrintableDoc>
  );
}
