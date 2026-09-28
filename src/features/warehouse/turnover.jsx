import { useState, useEffect } from "react";
import { warehouseApi } from "../../api.js";
import { KardexDialog } from "./setup.jsx";
import { DateRange, faDigits, faRial, fq, jShort, jYearStart, saveSheet, useCan } from "../../shared/core.jsx";

/* ---- گردش کالا: اول دوره، ورود، خروج و پایان دوره ---- */
export function TurnoverPane() {
  const canCost = useCan()("warehouse.cost");
  const [warehouses, setWarehouses] = useState([]);
  const [meta, setMeta] = useState({ brands: [], categories: [] });
  const [wh, setWh] = useState("");
  const [from, setFrom] = useState(jYearStart);
  const [to, setTo] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [kardexFor, setKardexFor] = useState(null);

  useEffect(() => {
    warehouseApi.list().then(setWarehouses).catch(() => { /* فیلتر انبار اختیاری است */ });
    warehouseApi.meta({}).then(setMeta).catch(() => { /* فیلتر برند اختیاری است */ });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let live = true;
    setData(null);
    warehouseApi.turnover({ warehouse: wh, from, to, brand, category, q: qd, all: all ? 1 : "" })
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) { setErr(e.message); setData({ rows: [], totals: {} }); } });
    return () => { live = false; };
  }, [wh, from, to, brand, category, qd, all]);

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const whName = warehouses.find((w) => w.id === wh)?.name || "همهٔ انبارها";
  const shown = rows.slice(0, 500);

  function exportXlsx() {
    const head = ["کالا", "شناسه", "برند", "دسته", "بسته", "واحد", "اول دوره", "ورود", "خروج", "پایان دوره",
      ...(canCost ? ["قیمت خرید", "ارزش پایان دوره"] : [])];
    saveSheet("گردش-کالا", "گردش کالا", [
      [`گردش کالا — ${whName} — از ${from ? jShort(from) : "ابتدا"} تا ${to ? jShort(to) : "امروز"}`],
      head,
      ...rows.map((r) => [r.name, r.code, r.brand, r.category, r.packSize, r.baseUnit,
        r.opening, r.in, r.out, r.closing, ...(canCost ? [r.cost || 0, r.value || 0] : [])]),
    ]);
  }

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(totals.items ?? 0)}</b><span>کالا در این بازه</span></div>
        <div className="stat"><b>{faDigits(totals.withIn ?? 0)}</b><span>ورود داشته</span></div>
        <div className="stat"><b>{faDigits(totals.withOut ?? 0)}</b><span>خروج داشته</span></div>
        {canCost && <div className="stat"><b>{faRial(totals.value ?? 0)}</b><span>ارزش پایان دوره (ریال)</span></div>}
      </div>

      <div className="card">
        <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
          برای هر کالا در بازهٔ انتخابی: موجودی اول دوره، جمع ورود، جمع خروج و موجودی پایان دوره.
          با «کاردکس» همهٔ گردش‌های آن کالا با ماندهٔ پس از هر ردیف دیده می‌شود.
          {!wh && " وقتی همهٔ انبارها انتخاب است، انتقال بین انبارها هم در ورود و هم در خروج شمرده می‌شود."}
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام کالا، شناسه یا کد…" />
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
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {" "}کالاهای بی‌گردش در این بازه هم بیاید
          </label>
          <button className="link-btn" disabled={!rows.length} onClick={exportXlsx}>📊 خروجی اکسل</button>
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {data === null ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? <div className="empty">در این بازه گردشی ثبت نشده.</div> : (
        <>
          <div className="tbl-scroll">
            <table className="print-table wh-table">
              <thead>
                <tr><th>کالا</th><th>برند</th><th>واحد</th><th>اول دوره</th><th>ورود</th><th>خروج</th><th>پایان دوره</th>
                  {canCost && <th>ارزش پایان دوره</th>}<th></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="wh-name">{r.name}
                      <div className="wh-sub"><span>شناسه {r.code}</span>{r.packSize && <span>{r.packSize}</span>}</div>
                    </td>
                    <td>{r.brand || "—"}</td>
                    <td>{r.baseUnit}</td>
                    <td className="wh-qty">{fq(r.opening)}</td>
                    <td className="wh-qty diff-pos">{r.in ? fq(r.in) : "—"}</td>
                    <td className="wh-qty diff-neg">{r.out ? fq(r.out) : "—"}</td>
                    <td className={r.closing < 0 ? "wh-qty low" : "wh-qty total"}>{fq(r.closing)}</td>
                    {canCost && <td>{r.value ? faRial(r.value) : "—"}</td>}
                    <td className="wh-actions">
                      <button className="link-btn" onClick={() => setKardexFor(r)}>کاردکس</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length && (
            <div className="muted sm2" style={{ marginTop: 6 }}>
              {faDigits(shown.length)} ردیف از {faDigits(rows.length)} ردیف نشان داده شد؛ برای همه خروجی اکسل بگیرید یا فیلتر کنید.
            </div>
          )}
        </>
      )}

      {kardexFor && (
        <KardexDialog sku={kardexFor} warehouses={warehouses} warehouse={wh} from={from} to={to}
          onClose={() => setKardexFor(null)} />
      )}
    </>
  );
}
/* ---- کالای دست اشخاص: تحویل به شخص منهای برگشت ---- */
export function HoldersPane({ onVoucher }) {
  const can = useCan();
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let live = true;
    setData(null);
    warehouseApi.holders({ q: qd, all: all ? 1 : "" })
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => { if (live) { setErr(e.message); setData({ people: [] }); } });
    return () => { live = false; };
  }, [qd, all]);

  const people = data?.people || [];
  function exportXlsx() {
    saveSheet("کالای-دست-اشخاص", "دست اشخاص", [
      ["شخص", "کالا", "شناسه", "واحد", "تحویل", "برگشت", "دست او", "آخرین تحویل"],
      ...people.flatMap((p) => p.items.map((i) => [p.name, i.name, i.code, i.baseUnit,
        i.issued, i.returned, i.holding, i.lastIssued ? jShort(i.lastIssued) : ""])),
    ]);
  }

  return (
    <>
      <div className="card">
        <div className="muted sm2" style={{ lineHeight: 2, marginBottom: 10 }}>
          با حوالهٔ «تحویل به شخص»، کالا (ابزار، لوازم یا مواد) به نام یک نفر یا یک بخش از انبار خارج می‌شود و با
          «برگشت از شخص» برمی‌گردد. اینجا دیده می‌شود همین حالا چه چیزی دست چه کسی است.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام شخص یا نام کالا…" />
        <div className="wh-toggles">
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {" "}کسانی که همه را برگردانده‌اند هم بیاید
          </label>
          {can("warehouse.voucher") && (
            <button className="link-btn" onClick={() => onVoucher({ movementKind: "issue_person" })}>
              + تحویل کالا به شخص
            </button>
          )}
          <button className="link-btn" disabled={!people.length} onClick={exportXlsx}>📊 خروجی اکسل</button>
        </div>
      </div>

      {err && <div className="notice warn">{err}</div>}
      {data === null ? <div className="empty">در حال بارگذاری…</div>
        : people.length === 0 ? (
          <div className="empty">{qd ? "کسی با این جست‌وجو پیدا نشد." : "الان کالایی دست کسی نیست."}</div>
        ) : (
        <div className="holder-list">
          {people.map((p) => {
            const holding = p.items.filter((i) => i.holding > 0);
            return (
              <div className="card holder-card" key={p.name}>
                <div className="holder-hd">
                  <span className="avatar">{p.name.trim().charAt(0)}</span>
                  <div className="ud-name">
                    <b>{p.name}</b>
                    <small>{holding.length ? `${faDigits(holding.length)} قلم دست اوست` : "همه را برگردانده"}</small>
                  </div>
                  {can("warehouse.voucher") && holding.length > 0 && (
                    <button className="ghost" onClick={() => onVoucher({
                      movementKind: "return_person", counterparty: p.name, warehouse: p.warehouse,
                      lines: holding.map((i) => ({
                        sku: i.sku, productName: i.name, packSize: i.packSize, qty: i.holding,
                        unit: "", baseUnit: i.baseUnit, altUnit: i.altUnit,
                      })),
                    })}>برگشت کالا</button>
                  )}
                  {can("warehouse.voucher") && (
                    <button className="link-btn" onClick={() => onVoucher({
                      movementKind: "issue_person", counterparty: p.name, warehouse: p.warehouse,
                    })}>تحویل تازه</button>
                  )}
                </div>
                <div className="tbl-scroll">
                  <table className="print-table wh-table">
                    <thead><tr><th>کالا</th><th>تحویل</th><th>برگشت</th><th>دست او</th><th>آخرین تحویل</th></tr></thead>
                    <tbody>
                      {p.items.map((i) => (
                        <tr key={i.sku}>
                          <td className="wh-name">{i.name}
                            <div className="wh-sub"><span>شناسه {i.code}</span>{i.packSize && <span>{i.packSize}</span>}</div>
                          </td>
                          <td className="wh-qty">{fq(i.issued)}</td>
                          <td className="wh-qty">{i.returned ? fq(i.returned) : "—"}</td>
                          <td className={i.holding > 0 ? "wh-qty total" : "wh-qty"}>
                            <b>{fq(i.holding)}</b> <small className="wh-unit">{i.baseUnit}</small>
                          </td>
                          <td>{i.lastIssued ? jShort(i.lastIssued) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
