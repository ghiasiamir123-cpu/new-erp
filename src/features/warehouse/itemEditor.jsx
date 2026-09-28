import { useState, useEffect } from "react";
import { employeesApi, warehouseApi } from "../../api.js";
import { ASSET_STATUS, BLANK_ITEM, JalaliPicker, faDigits, faRial } from "../../shared/core.jsx";

/* فرمول نام و کد رنگ‌های والرسا تا کد با کد مالی بخواند:
     Valresa - P.U - Topcoat Base [Tint Color - Nova L157] 1Kg (B:973002/H:190046) Mix(2.5+1) 25G
     VT-NL157-25G
   سرور (backend/core/valresa.py) همین قاعده را بررسی می‌کند؛ هر دو باید یکی بمانند. */
const VT_NAME = /^Valresa - ([^[\]]+?) - ([^[\]]+?) \[([^[\]]+?) - ([^[\]]+?)\] (\d+(?:\.\d+)?)(Kg|L) \(B:([^/()]+)\/H:([^()]+)\) Mix\(([^()]*)\) (\S+)$/;

const BLANK_VT = {
  line: "P.U", category: "Topcoat Base", sub: "Tint Color", system: "NCS", color: "", code: "",
  qty: "1", unit: "Kg", gloss: "25G", base: "", hardener: "", mix: "",
};

function vtColor(system, raw) {
  // کد همیشه فشرده است («S0502Y»)، ولی در نام همان‌طور که نوشته‌اید می‌ماند («NCS S 0502Y»)
  // تا نام با نام حسابداری مو‌به‌مو یکی باشد.
  const typed = (raw || "").trim().replace(/\s+/g, " ");
  if (system === "other") return { label: typed, code: "" };
  const squashed = typed.replace(/[\s-]+/g, "").toUpperCase();
  if (system === "NCS") {
    const v = squashed.replace(/^(NCS|NSC)/, "");
    if (!v) return { label: "", code: "" };
    const code = v.startsWith("S") ? v : "S" + v;
    let shown = typed.replace(/^(NCS|NSC)\s*/i, "").toUpperCase();
    if (!shown.startsWith("S")) shown = "S" + shown;
    return { label: `NCS ${shown}`, code };
  }
  const v = squashed.replace(system === "RAL" ? /^RAL/ : /^NOVA/, "");
  if (!v) return { label: "", code: "" };
  const shown = typed.replace(system === "RAL" ? /^RAL\s*/i : /^NOVA\s*/i, "").toUpperCase();
  return system === "RAL" ? { label: `RAL ${shown}`, code: "R" + v } : { label: `Nova ${shown}`, code: "N" + v };
}
/** کد والرسا («VT-S0502Y-HG») → مقدارهای فرمول: رنگ، براقیت و ترکیب رایجِ همان براقیت. */
function vtFromCode(text, opts) {
  const m = /^\s*(?:VT-)?([A-Za-z0-9.+]+)-([A-Za-z0-9.]+)\s*$/.exec(text || "");
  if (!m || !/^\s*VT-/i.test(text || "")) return null;
  const [, part, gloss] = m;
  const up = part.toUpperCase();
  let system = "other";
  let color = part;
  let code = part;
  if (/^S\d/.test(up)) { system = "NCS"; color = up.replace(/^S(\d)/, "S $1"); code = ""; }
  else if (/^R\d/.test(up)) { system = "RAL"; color = up.slice(1); code = ""; }
  else if (/^N[A-Z0-9]/.test(up)) { system = "Nova"; color = up.slice(1); code = ""; }
  const first = (key, fallback) => ((opts && opts[key] && opts[key][0]) || fallback);
  const combo = ((opts && opts.combos && opts.combos[gloss]) || [])[0];
  return {
    ...BLANK_VT, system, color, code, gloss,
    line: first("lines", BLANK_VT.line), category: first("categories", BLANK_VT.category),
    sub: first("subs", BLANK_VT.sub),
    base: combo ? combo.base : "", hardener: combo ? combo.hardener : "", mix: combo ? combo.mix : "",
  };
}
/** فرمول را از آنچه نوشته‌اید می‌سازد: نام کامل، یا فقط کدِ خودتان در نام یا در خانهٔ بارکد. */
function vtSeed(name, barcode, opts) {
  const parsed = vtParse(name, barcode);
  if (parsed) return parsed;
  for (const text of [name, barcode]) {
    const hit = /VT-[A-Za-z0-9.+]+-[A-Za-z0-9.]+/i.exec(text || "");
    const seed = hit && vtFromCode(hit[0], opts);
    if (seed) return seed;
  }
  return null;
}

function vtParse(name, barcode) {
  const m = VT_NAME.exec((name || "").trim());
  if (!m) return null;
  const [, line, category, sub, label, qty, unit, base, hardener, mix, gloss] = m;
  const s = /^(NCS|NSC|RAL|Nova)\s*(.*)$/i.exec(label);
  const system = s ? ({ RAL: "RAL", NOVA: "Nova" }[s[1].toUpperCase()] || "NCS") : "other";
  const tail = "-" + gloss;
  const b = (barcode || "").trim();
  const code = system === "other" && b.startsWith("VT-") && b.endsWith(tail) ? b.slice(3, -tail.length) : "";
  return { line, category, sub, system, color: s ? s[2] : label, code, qty, unit, gloss, base, hardener, mix };
}

function vtBuild(v) {
  const c = vtColor(v.system, v.color);
  const part = v.system === "other" ? (v.code || "").trim() : c.code;
  const gloss = v.gloss.trim();
  return {
    name: `Valresa - ${v.line.trim()} - ${v.category.trim()} [${v.sub.trim()} - ${c.label}] ` +
      `${v.qty}${v.unit} (B:${v.base.trim()}/H:${v.hardener.trim()}) Mix(${v.mix.trim()}) ${gloss}`,
    code: part && gloss ? `VT-${part}-${gloss}` : "",
    complete: Boolean(c.label && part && gloss && Number(v.qty) > 0 && v.line.trim() && v.category.trim()
      && v.sub.trim() && v.base.trim() && v.hardener.trim() && v.mix.trim()),
  };
}

export function ItemEditor({ item, assetMode = false, consumableOnly = false, onClose, onSaved }) {
  const isNew = item === null;
  const [f, setF] = useState(() => (isNew ? { ...BLANK_ITEM, isAsset: assetMode } : {
    ...BLANK_ITEM, ...item,
    altPerBase: item.altPerBase ?? "",
    costPrice: item.costPrice ?? "",
    salePrice: item.salePrice ?? "",
    handedOverOn: item.handedOverOn || "",
    assetStatus: item.assetStatus || "ok",
    purchaseDate: item.purchaseDate || "", warrantyUntil: item.warrantyUntil || "",
    purchasePrice: item.purchasePrice || "", salvageValue: item.salvageValue || "",
    serviceIntervalDays: item.serviceIntervalDays ?? "", usefulLifeYears: item.usefulLifeYears ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [people, setPeople] = useState([]);
  const [places, setPlaces] = useState([]);

  // بستهٔ سایت: رنگ‌های انبارِ زیرمجموعه با موجودی هر کدام.
  const [variants, setVariants] = useState(null);
  useEffect(() => {
    if (isNew || (!item.variantCount && !item.unitOf)) return;
    warehouseApi.itemVariants(item.id).then((d) => setVariants(d.results || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // رنگ والرسا: نام و کد از فرمول. کالای موجود فقط وقتی با فرمول باز می‌شود که همین
  // حالا طبق فرمول باشد، تا باز کردنِ یک ردیف قدیمی بی‌صدا نامش را عوض نکند.
  const isValresa = /valresa|والرسا/i.test(f.brand || "");
  const [vt, setVt] = useState(() => {
    const parsed = !isNew && vtParse(item.warehouseName, item.barcode);
    const built = parsed && vtBuild(parsed);
    return built && built.name === item.warehouseName && built.code === item.barcode ? parsed : null;
  });
  const [vtTouched, setVtTouched] = useState(false);
  const [vopts, setVopts] = useState(null);
  const [vtCode, setVtCode] = useState("");        // کدی که کاربر از اکسل خودش می‌آورد
  const [vtCodeErr, setVtCodeErr] = useState("");
  const vtOut = vt ? vtBuild(vt) : null;
  const setV = (k) => (e) => setVt((p) => ({ ...p, [k]: e.target.value }));
  const combos = (vt && vopts && vopts.combos && vopts.combos[vt.gloss.trim()]) || [];

  /** کدِ خودِ کاربر → پر کردن خانه‌های فرمول (برعکسِ ساختن کد از روی خانه‌ها). */
  function fillFromCode() {
    const text = vtCode.trim() || f.warehouseName || f.barcode;
    const seed = vtSeed(text, "", vopts) || vtSeed("", text, vopts);
    if (!seed) {
      setVtCodeErr("کد خوانده نشد. شکل درست: VT-<کد رنگ>-<براقیت> — مثلاً VT-S0502Y-HG یا VT-NL157-25G.");
      return;
    }
    setVtTouched(true);
    setVtCodeErr("");
    setVt(seed);
  }

  useEffect(() => {
    if (isNew && isValresa && !vtTouched && !vt && !f.isAsset) {
      setVt(vtSeed(f.warehouseName, f.barcode, vopts) || { ...BLANK_VT });
    }
    if (isValresa && !vopts) warehouseApi.valresaFormula().then(setVopts).catch(() => {});
  }, [isValresa]); // eslint-disable-line react-hooks/exhaustive-deps

  // تا فرمول کامل نشده، نام و کدی که خودتان نوشته‌اید دست نمی‌خورد.
  useEffect(() => {
    if (!vtOut || !vtOut.complete) return;
    setF((p) => ({
      ...p, warehouseName: vtOut.name, barcode: vtOut.code, productCode: vtOut.code,
      packSize: `${vt.qty}${vt.unit}`, category: `${vt.line.trim()} - ${vt.category.trim()}`,
      baseUnit: p.baseUnit || "کیلوگرم",
    }));
  }, [vtOut && vtOut.name, vtOut && vtOut.code, vtOut && vtOut.complete]); // eslint-disable-line react-hooks/exhaustive-deps

  // فهرست کارکنان فقط برای پیشنهاد است؛ تحویل‌گیرنده می‌تواند بیرون از فهرست باشد.
  useEffect(() => {
    employeesApi.list()
      .then((rows) => setPeople(rows.filter((p) => p.active).map((p) => p.name)))
      .catch(() => {});
    warehouseApi.locations()
      .then((rows) => setPlaces(rows.filter((p) => p.active)))
      .catch(() => {});
  }, []);

  // محل تازه همین‌جا ساخته می‌شود تا برای تعریف یک وسیله مجبور نشوی سربرگ
  // عوض کنی. با فیلد داخل فرم، نه پنجرهٔ prompt — که همه‌جا کار نمی‌کند.
  const [newPlace, setNewPlace] = useState(null);   // null یعنی بسته
  const [placeBusy, setPlaceBusy] = useState(false);

  async function savePlace() {
    const name = (newPlace || "").trim();
    if (!name || placeBusy) return;
    setPlaceBusy(true);
    try {
      const made = await warehouseApi.createLocation({ name });
      setPlaces((p) => [...p, made].sort((a, b) => a.name.localeCompare(b.name, "fa")));
      setF((p) => ({ ...p, location: made.id }));
      setNewPlace(null);
    } catch (e) { alert(e.message); } finally { setPlaceBusy(false); }
  }
  const set = (k) => (e) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const base = (f.baseUnit || "").trim();
  const alt = (f.altUnit || "").trim();
  const rate = Number(f.altPerBase);
  const sameUnit = Boolean(alt) && alt === base;
  const rateOk = !alt || (rate > 0 && !sameUnit);
  // کالای تازه نام انبار می‌خواهد؛ کالایی که از سایت آمده تا نام انبارش وارد شود با نام سایت ذخیره می‌شود.
  const hadWarehouseName = !isNew && Boolean((item.warehouseName || "").trim());
  const nameOk = Boolean(f.warehouseName.trim()) || (!isNew && !hadWarehouseName && Boolean(f.siteName));
  const valid = nameOk && rateOk && (!vtOut || vtOut.complete);

  async function save() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    const body = {
      warehouseName: f.warehouseName.trim(), brand: f.brand.trim(), category: f.category.trim(),
      productCode: f.productCode.trim(), warehouseCode: f.warehouseCode.trim(),
      skuCode: f.skuCode.trim(), barcode: f.barcode.trim(),
      sepidarItemId: f.sepidarItemId.trim(), packSize: f.packSize.trim(),
      isAsset: f.isAsset,
      assetCode: f.isAsset ? f.assetCode.trim() : "",
      location: f.isAsset && f.location ? f.location : null,
      holder: f.isAsset ? f.holder.trim() : "",
      handedOverOn: (f.isAsset && f.handedOverOn) ? f.handedOverOn : null,
      ...(f.isAsset ? {
        assetStatus: f.assetStatus || "ok",
        assetSerial: (f.assetSerial || "").trim(), assetModel: (f.assetModel || "").trim(),
        assetSupplier: (f.assetSupplier || "").trim(), assetNote: (f.assetNote || "").trim(),
        purchaseDate: f.purchaseDate || null, warrantyUntil: f.warrantyUntil || null,
        purchasePrice: f.purchasePrice === "" ? 0 : Number(f.purchasePrice),
        salvageValue: f.salvageValue === "" ? 0 : Number(f.salvageValue),
        serviceIntervalDays: f.serviceIntervalDays === "" ? null : Number(f.serviceIntervalDays),
        usefulLifeYears: f.usefulLifeYears === "" ? null : Number(f.usefulLifeYears),
      } : {}),
      baseUnit: base, altUnit: alt, altPerBase: alt ? rate : null,
      grit: f.grit.trim(), shade: f.shade.trim(),
      costPrice: f.costPrice === "" ? 0 : Number(f.costPrice),
      salePrice: f.salePrice === "" ? 0 : Number(f.salePrice),
      sellable: f.sellable, batchTracked: f.batchTracked,
      hazardous: f.hazardous, active: f.active,
      ...(f.siteParent ? { variantLabel: f.variantLabel.trim() } : {}),
    };
    try {
      const saved = isNew
        ? await warehouseApi.createItem(body)
        : await warehouseApi.updateItem(item.id, body);
      onSaved(saved, isNew);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">
          {f.isAsset
            ? (isNew ? "ثبت اموال جدید" : "ویرایش اموال")
            : (isNew ? "تعریف کالای جدید" : "ویرایش کالا")}
        </div>

        <div className="row2">
          <label className="fld"><span>نام انبار (نام مالی)</span>
            <input value={f.warehouseName} onChange={set("warehouseName")} autoFocus readOnly={Boolean(vt)}
              placeholder={f.siteName ? "هنوز نام انبار ندارد" : ""} />
          </label>
          <label className="fld"><span>برند</span>
            <input value={f.brand} onChange={set("brand")} />
          </label>
        </div>

        {/* نام سایت از سایت فروش می‌آید و اینجا فقط دیده می‌شود. */}
        <div className="fld">
          <span>نام سایت</span>
          <div className="muted sm2" style={{ padding: "6px 0" }}>
            {f.siteParent
              ? <>زیرمجموعهٔ بستهٔ سایت «{f.siteParentName}»{f.shopPackId && <> · شناسهٔ سایت {f.shopPackId}</>}</>
              : f.siteName
                ? <>{f.siteName}{f.shopPackId && <> · شناسهٔ سایت {f.shopPackId}</>}</>
                : "این کالا در سایت فروش نیست."}
          </div>
          {f.extraPacks && f.extraPacks.length > 0 && (
            <div className="muted sm2">
              بستهٔ دیگر در سایت: {f.extraPacks.map((p) => `${p.packSize} (هر بسته = ${faDigits(p.perPack)} ${f.baseUnit}) · شناسه ${p.pack}`).join("، ")}
            </div>
          )}
          {f.unitOf && (
            <div className="muted sm2">
              این بسته در انبار همان «{f.unitOf.name}» است؛ هر بسته = {faDigits(f.unitOf.perPack)} {f.unitOf.baseUnit}
            </div>
          )}
        </div>

        {f.siteParent && (
          <label className="fld"><span>رنگ یا اندازه (فقط برای انبار؛ در سایت فروش نشان داده نمی‌شود)</span>
            <input value={f.variantLabel} onChange={set("variantLabel")} dir="ltr" />
            <div className="muted sm2" style={{ marginTop: 4 }}>
              در انبار: {f.siteParentName}{f.variantLabel.trim() ? ` (${f.variantLabel.trim()})` : ""}
            </div>
          </label>
        )}

        {variants && variants.length > 0 && (
          <div className="pack-box">
            <div className="items-hd">
              زیرمجموعه‌های انبار (رنگ / اندازه) — {faDigits(variants.filter((v) => v.inStock).length)} موجود از {faDigits(variants.length)}
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {variants.map((v) => (
                <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                  <span dir="ltr">{v.label || "—"} <span className="muted sm2">{v.code}</span></span>
                  <b className={v.inStock ? "" : "muted"}>
                    {!v.inStock ? "ناموجود"
                      : v.unit ? `${faDigits(v.availablePacks)} بسته (${faDigits(v.onHand)} ${v.baseUnit})`
                        : `${faDigits(v.onHand)} ${v.baseUnit}`}
                  </b>
                </div>
              ))}
            </div>
          </div>
        )}

        {isValresa && !f.isAsset && (
          <div className="pack-box">
            <label className="wh-check" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={Boolean(vt)}
                onChange={(e) => {
                  setVtTouched(true);
                  setVt(e.target.checked ? (vtSeed(f.warehouseName, f.barcode, vopts) || { ...BLANK_VT }) : null);
                }} />
              رنگ والرسا (Tint Color) — نام و کد با فرمول ساخته شود تا با کد مالی بخواند
            </label>
            {vt && (
              <>
                <div className="vt-seed">
                  <input value={vtCode} dir="ltr" placeholder="VT-S0502Y-HG"
                    onChange={(e) => { setVtCode(e.target.value); setVtCodeErr(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fillFromCode(); } }} />
                  <button type="button" className="ghost" onClick={fillFromCode}>پر کردن از کد</button>
                </div>
                <div className={vtCodeErr ? "err" : "muted sm2"} style={{ margin: "4px 0 8px", lineHeight: 1.9 }}>
                  {vtCodeErr || "کدی را که خودتان ساخته‌اید اینجا بگذارید تا رنگ، براقیت و ترکیب رایج همان براقیت خودکار پر شود؛ بعد اگر لازم بود اصلاحشان کنید."}
                </div>
                <div className="row3" style={{ marginTop: 10 }}>
                  <label className="fld sm"><span>خط</span>
                    <input list="vt-lines" value={vt.line} onChange={setV("line")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>دسته</span>
                    <input list="vt-categories" value={vt.category} onChange={setV("category")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>زیردسته</span>
                    <input list="vt-subs" value={vt.sub} onChange={setV("sub")} dir="ltr" />
                  </label>
                </div>
                <div className="row3">
                  <label className="fld sm"><span>سیستم رنگ</span>
                    <select value={vt.system} onChange={setV("system")}>
                      <option value="NCS">NCS</option>
                      <option value="RAL">RAL</option>
                      <option value="Nova">Nova</option>
                      <option value="other">نام دیگر</option>
                    </select>
                  </label>
                  <label className="fld sm"><span>{vt.system === "other" ? "نام رنگ" : "شمارهٔ رنگ"}</span>
                    <input value={vt.color} onChange={setV("color")} dir="ltr"
                      placeholder={{ NCS: "S 1002-Y50R", RAL: "7023", Nova: "L157", other: "Sedef Beyaz" }[vt.system]} />
                  </label>
                  <label className="fld sm"><span>کد رنگ</span>
                    {vt.system === "other"
                      ? <input value={vt.code} onChange={setV("code")} dir="ltr" placeholder="Sedef" />
                      : <input value={vtColor(vt.system, vt.color).code} readOnly dir="ltr" />}
                  </label>
                </div>
                <div className="row3">
                  <label className="fld sm"><span>براقیت</span>
                    <input list="vt-glosses" value={vt.gloss} onChange={setV("gloss")} dir="ltr" placeholder="25G / HG" />
                  </label>
                  <label className="fld sm"><span>مقدار بسته</span>
                    <input type="number" step="any" min="0" value={vt.qty} onChange={setV("qty")} />
                  </label>
                  <label className="fld sm"><span>واحد</span>
                    <select value={vt.unit} onChange={setV("unit")}>
                      <option value="Kg">Kg</option>
                      <option value="L">L</option>
                    </select>
                  </label>
                </div>
                {combos.length > 0 && (
                  <div className="muted sm2" style={{ margin: "2px 0 8px" }}>
                    ترکیب‌های رایج برای {vt.gloss.trim()}:
                    {combos.slice(0, 4).map((c) => (
                      <button key={`${c.base}|${c.hardener}|${c.mix}`} type="button" className="ghost" dir="ltr"
                        style={{ padding: "2px 8px", margin: "4px 4px 0" }}
                        onClick={() => setVt((p) => ({ ...p, base: c.base, hardener: c.hardener, mix: c.mix }))}>
                        B:{c.base} / H:{c.hardener} / Mix {c.mix} ({faDigits(c.count)})
                      </button>
                    ))}
                  </div>
                )}
                <div className="row3">
                  <label className="fld sm"><span>کد بیس (B)</span>
                    <input list="vt-bases" value={vt.base} onChange={setV("base")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>کد هاردنر (H)</span>
                    <input list="vt-hardeners" value={vt.hardener} onChange={setV("hardener")} dir="ltr" />
                  </label>
                  <label className="fld sm"><span>نسبت اختلاط (Mix)</span>
                    <input list="vt-mixes" value={vt.mix} onChange={setV("mix")} dir="ltr" placeholder="2.5+1" />
                  </label>
                </div>
                <div className="muted sm2" dir="ltr" style={{ textAlign: "left", lineHeight: 1.8 }}>
                  <div>{vtOut.name}</div>
                  <b>{vtOut.code || "VT-…"}</b>
                </div>
                {!vtOut.complete && <div className="err">همهٔ خانه‌های فرمول را پر کنید.</div>}
                {[["vt-lines", "lines"], ["vt-categories", "categories"], ["vt-subs", "subs"],
                  ["vt-glosses", "glosses"], ["vt-bases", "bases"], ["vt-hardeners", "hardeners"],
                  ["vt-mixes", "mixes"]].map(([id, key]) => (
                  <datalist key={id} id={id}>
                    {((vopts && vopts[key]) || []).map((v) => <option key={v} value={v} />)}
                  </datalist>
                ))}
              </>
            )}
          </div>
        )}

        <div className="row2">
          <label className="fld"><span>کد انبار</span>
            <input value={f.warehouseCode} onChange={set("warehouseCode")}
              placeholder="کد خودمان — مثلاً ۱۰۰۱" />
          </label>
          <label className="fld"><span>کد SKU</span>
            <input value={f.skuCode} onChange={set("skuCode")}
              placeholder={isNew ? "خالی بگذارید تا خودکار ساخته شود" : ""} />
          </label>
        </div>

        <div className="row2">
          <label className="fld"><span>بارکد</span>
            <input value={f.barcode} onChange={set("barcode")} readOnly={Boolean(vt)} />
          </label>
          <label className="fld"><span>دسته</span>
            <input value={f.category} onChange={set("category")} />
          </label>
        </div>

        {/* یک پیستوله «یک عدد» است؛ بسته‌بندی برای اموال حرفی ندارد. */}
        <div className="pack-box" hidden={f.isAsset}>
          <div className="items-hd">بسته‌بندی</div>
          <div className="muted sm2" style={{ marginBottom: 10 }}>
            موجودی همیشه به <b>بسته‌بندی اصلی</b> شمرده می‌شود. بسته‌بندی فرعی فقط راه
            دیگری برای وارد کردن مقدار است — مثلاً حلبی که گاهی کیلویی تحویل می‌گیرید.
          </div>
          <div className="row2">
            <label className="fld"><span>بسته‌بندی اصلی</span>
              <input value={f.baseUnit} onChange={set("baseUnit")} placeholder="حلب / جعبه / عدد" />
            </label>
            <label className="fld"><span>بسته‌بندی فرعی (اختیاری)</span>
              <input value={f.altUnit} onChange={set("altUnit")} placeholder="کیلوگرم / لیتر / عدد" />
            </label>
          </div>
          {alt && (
            <label className="fld">
              <span>هر ۱ {base || "واحد اصلی"} چند {alt} است؟</span>
              <input type="number" step="any" min="0" value={f.altPerBase}
                onChange={set("altPerBase")} placeholder="مثلاً ۲۵" />
              {sameUnit
                ? <div className="err">فرعی نمی‌تواند با اصلی یکی باشد.</div>
                : rate > 0 && base ? (
                  <div className="muted sm2" style={{ marginTop: 6 }}>
                    یعنی هر {faDigits(rate)} {alt} که تحویل بگیرید، ۱ {base} در انبار ثبت می‌شود.
                  </div>
                ) : null}
            </label>
          )}
          <label className="fld"><span>اندازهٔ بسته (توضیحی)</span>
            <input value={f.packSize} onChange={set("packSize")} placeholder="حلب ۲۵ کیلویی" />
          </label>
        </div>

        <div className="row2">
          <label className="fld"><span>قیمت خرید (ریال)</span>
            <input type="number" min="0" value={f.costPrice} onChange={set("costPrice")} />
          </label>
          <label className="fld"><span>قیمت فروش (ریال)</span>
            <input type="number" min="0" value={f.salePrice} onChange={set("salePrice")} />
          </label>
        </div>

        <details className="more-box">
          <summary>مشخصات بیشتر</summary>
          <div className="row3" style={{ marginTop: 10 }}>
            <label className="fld sm"><span>کد محصول</span>
              <input value={f.productCode} onChange={set("productCode")} readOnly={Boolean(vt)} />
            </label>
            <label className="fld sm"><span>کد سپیدار</span>
              <input value={f.sepidarItemId} onChange={set("sepidarItemId")} />
            </label>
            <label className="fld sm"><span>شماره سنباده</span>
              <input value={f.grit} onChange={set("grit")} />
            </label>
          </div>
          <label className="fld"><span>بیس / شید</span>
            <input value={f.shade} onChange={set("shade")} />
          </label>
        </details>

        <label className="wh-check">
          <input type="checkbox" checked={f.batchTracked} onChange={set("batchTracked")} />
          بچ و تاریخ انقضا دارد (رنگ و هاردنر)
        </label>
        <label className="wh-check">
          <input type="checkbox" checked={f.hazardous} onChange={set("hazardous")} />
          آتش‌زا (تینر و حلال)
        </label>
        {!f.isAsset && (
          <label className="wh-check">
            <input type="checkbox" checked={f.sellable} onChange={set("sellable")} />
            در سایت فروش عرضه می‌شود
          </label>
        )}
        {/* از پنجرهٔ ادغام مواد مصرفی فقط کالای مصرفی ساخته می‌شود؛ وسیله مقصد ادغام نیست. */}
        {!consumableOnly && (
          <label className="wh-check">
            <input type="checkbox" checked={f.isAsset}
              onChange={(e) => setF((p) => ({
                ...p, isAsset: e.target.checked,
                // وسیله فروختنی نیست.
                sellable: e.target.checked ? false : p.sellable,
              }))} />
            کالای اموالی است (کد اموال می‌خورد و دست کسی سپرده می‌شود)
          </label>
        )}

        {f.isAsset && (
          <div className="pack-box">
            <div className="items-hd">اموال</div>
            <div className="muted sm2" style={{ marginBottom: 10 }}>
              هر کد اموال روی یک وسیلهٔ مشخص می‌نشیند؛ دو پیستولهٔ همسان با دو کد،
              دو ردیف جدا هستند.
            </div>
            <div className="row2">
              <label className="fld"><span>کد اموال</span>
                <input value={f.assetCode} onChange={set("assetCode")}
                  placeholder="مثلاً ۱۰۲-۴۵" />
              </label>
              <label className="fld"><span>محل استقرار</span>
                {newPlace === null ? (
                  <div className="pick-row">
                    <select value={f.location || ""} onChange={set("location")}>
                      <option value="">— انتخاب کنید —</option>
                      {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="button" className="ghost"
                      onClick={() => setNewPlace("")}>+ محل تازه</button>
                  </div>
                ) : (
                  <div className="pick-row">
                    <input autoFocus value={newPlace} placeholder="مثلاً سالن ۱"
                      onChange={(e) => setNewPlace(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); savePlace(); }
                        if (e.key === "Escape") setNewPlace(null);
                      }} />
                    <button type="button" className="ghost" disabled={placeBusy}
                      onClick={savePlace}>ثبت</button>
                    <button type="button" className="ghost"
                      onClick={() => setNewPlace(null)}>انصراف</button>
                  </div>
                )}
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>تحویل‌گیرنده</span>
                <input list="divaj-people" value={f.holder} onChange={set("holder")}
                  placeholder="نام تحویل‌گیرنده" />
                <datalist id="divaj-people">
                  {people.map((p) => <option key={p} value={p} />)}
                </datalist>
              </label>
              <label className="fld"><span>تاریخ تحویل</span>
                <JalaliPicker value={f.handedOverOn || ""} placeholder="— تعیین نشده —"
                  onChange={(v) => setF((p) => ({ ...p, handedOverOn: v }))} />
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>وضعیت</span>
                <select value={f.assetStatus || "ok"} onChange={set("assetStatus")}>
                  {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="fld"><span>شماره سریال</span>
                <input value={f.assetSerial} onChange={set("assetSerial")} dir="ltr" />
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>مدل</span>
                <input value={f.assetModel} onChange={set("assetModel")} placeholder="مثلاً SATAjet X 5500" />
              </label>
              <label className="fld"><span>فروشنده</span>
                <input value={f.assetSupplier} onChange={set("assetSupplier")} />
              </label>
            </div>

            <div className="items-hd sub">خرید و گارانتی</div>
            <div className="row2">
              <label className="fld"><span>تاریخ خرید</span>
                <JalaliPicker value={f.purchaseDate || ""} placeholder="— تعیین نشده —"
                  onChange={(v) => setF((p) => ({ ...p, purchaseDate: v }))} />
              </label>
              <label className="fld"><span>قیمت خرید (ریال)</span>
                <input type="number" min="0" inputMode="numeric" value={f.purchasePrice} onChange={set("purchasePrice")} />
                {Number(f.purchasePrice) > 0 && <small className="muted sm2">{faRial(f.purchasePrice)} ریال</small>}
              </label>
            </div>
            <div className="row2">
              <label className="fld"><span>پایان گارانتی</span>
                <JalaliPicker value={f.warrantyUntil || ""} placeholder="— ندارد —"
                  onChange={(v) => setF((p) => ({ ...p, warrantyUntil: v }))} />
              </label>
              <label className="fld"><span>هر چند روز سرویس؟</span>
                <input type="number" min="1" inputMode="numeric" value={f.serviceIntervalDays}
                  onChange={set("serviceIntervalDays")} placeholder="مثلاً ۹۰ — خالی یعنی سرویس دوره‌ای ندارد" />
              </label>
            </div>

            <div className="items-hd sub">استهلاک (خطی)</div>
            <div className="row2">
              <label className="fld"><span>عمر مفید (سال)</span>
                <input type="number" min="0.5" step="0.5" inputMode="decimal" value={f.usefulLifeYears}
                  onChange={set("usefulLifeYears")} placeholder="مثلاً ۵" />
              </label>
              <label className="fld"><span>ارزش اسقاط (ریال)</span>
                <input type="number" min="0" inputMode="numeric" value={f.salvageValue} onChange={set("salvageValue")}
                  placeholder="ارزش در پایان عمر مفید" />
              </label>
            </div>
            <label className="fld"><span>یادداشت</span>
              <textarea rows={2} value={f.assetNote} onChange={set("assetNote")} />
            </label>
          </div>
        )}

        {!isNew && (
          <label className="wh-check">
            <input type="checkbox" checked={f.active} onChange={set("active")} />
            فعال
          </label>
        )}

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose}>انصراف</button>
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={!valid || busy} onClick={save}>
            {busy ? "در حال ذخیره…" : isNew ? "تعریف کالا" : "ذخیره"}
          </button>
        </div>
      </div>
    </div>
  );
}
