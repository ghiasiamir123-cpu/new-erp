"""گزارش‌های مالی.

ارزش ریالی موجودی انبار: مقدار هر کالا از انبار × قیمت خرده‌فروشی همان کالا در سایت فروش.
  • کالای انبار که زیرمجموعهٔ یک بستهٔ سایت است (رنگ زیر بستهٔ هم‌اندازه): قیمت همان بسته برای یک واحد
    اصلی کالا — «Grundier Oil 1L (Black 60)» یک حلب = قیمت بستهٔ 1L.
  • اگر بستهٔ اصلی قیمت ندارد ولی بستهٔ دیگری در واحد دیگر دارد (جعبهٔ ۵۰ عددی): قیمت آن ÷ نسبت.
  • ردیف سایتی که خودش موجودی دارد: قیمت خودش.
قیمت ۱ ریال در سایت یعنی «قیمت‌گذاری نشده» و در جمع نمی‌آید؛ آن کالاها و کالاهای وصل‌نشده جدا فهرست
می‌شوند. قیمت‌ها از آخرین خواندن سایت‌اند (ShopPriceSync).
"""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from .models import ShopPriceSync, SitePackLink, Sku, StockMovement, Warehouse

PLACEHOLDER = Decimal(1)
NO_LINK = "به سایت وصل نیست"
NO_PRICE = "قیمت سایت تعیین نشده"


def price_per_base_unit(sku, unit_links):
    """(قیمت هر واحد اصلی، بستهٔ سایت، دلیلِ نبودن قیمت)."""
    candidates = []
    if sku.site_parent_id:
        candidates.append((sku.site_parent.sale_price, Decimal(1), sku.site_parent))
    if sku.shop_pack_id:
        candidates.append((sku.sale_price, Decimal(1), sku))
    for link in unit_links.get(sku.pk, []):
        candidates.append((link.site_pack.sale_price, link.per_pack, link.site_pack))
    if not candidates:
        return None, None, NO_LINK
    for price, per_pack, pack in candidates:
        if price and price > PLACEHOLDER and per_pack:
            return (price / per_pack), pack, ""
    return None, candidates[0][2], NO_PRICE


def _sync_info():
    last_ok = ShopPriceSync.objects.filter(ok=True).first()
    last = ShopPriceSync.objects.first()
    return {
        "lastOk": {"at": last_ok.finished_at.isoformat() if last_ok.finished_at else last_ok.started_at.isoformat(),
                   "source": last_ok.source, "updated": last_ok.updated, "by": last_ok.triggered_by_name} if last_ok else None,
        "lastError": {"at": last.started_at.isoformat(), "message": last.message} if last and not last.ok else None,
    }


def stock_value_report():
    qty = defaultdict(Decimal)                     # (کالا، انبار) ← مقدار به واحد اصلی
    for sku_id, wh_id, q in (StockMovement.objects.values("sku_id", "warehouse_id")
                             .annotate(q=Sum("qty")).values_list("sku_id", "warehouse_id", "q")):
        if q:
            qty[(sku_id, wh_id)] = q
    sku_ids = {sid for (sid, _), q in qty.items()}
    skus = Sku.objects.filter(pk__in=sku_ids).select_related("product", "site_parent").in_bulk()
    unit_links = defaultdict(list)
    for link in SitePackLink.objects.filter(sku_id__in=sku_ids).select_related("site_pack"):
        unit_links[link.sku_id].append(link)
    warehouses = dict(Warehouse.objects.values_list("id", "name"))

    per_sku = defaultdict(dict)
    for (sid, wid), q in qty.items():
        per_sku[sid][wid] = q

    rows, negatives = [], []
    by_warehouse = defaultdict(lambda: {"value": Decimal(0), "items": 0, "unpriced": 0})
    by_brand = defaultdict(lambda: {"value": Decimal(0), "items": 0, "unpriced": 0})
    total = Decimal(0)
    for sid, per_wh in per_sku.items():
        s = skus.get(sid)
        if s is None:
            continue
        if any(q < 0 for q in per_wh.values()):
            negatives.append({"id": str(sid), "name": s.display_name, "code": s.barcode or s.site_package_id,
                              "byWarehouse": {warehouses.get(w, "?"): float(q) for w, q in per_wh.items()}})
        on_hand = sum((q for q in per_wh.values() if q > 0), Decimal(0))
        if on_hand <= 0:
            continue
        price, pack, reason = price_per_base_unit(s, unit_links)
        value = (on_hand * price).quantize(Decimal(1)) if price is not None else None
        brand = s.product.brand or "بی برند"
        rows.append({
            "id": str(sid), "name": s.display_name, "code": s.barcode or s.warehouse_code or s.site_package_id,
            "brand": brand, "baseUnit": s.base_unit, "qty": float(on_hand),
            "byWarehouse": {warehouses.get(w, "?"): float(q) for w, q in per_wh.items() if q > 0},
            "price": float(price.quantize(Decimal(1))) if price is not None else None,
            "value": float(value) if value is not None else None,
            "sitePack": ({"pack": pack.shop_pack_id, "name": pack.site_name, "size": pack.pack_size,
                          "shade": pack.shade} if pack is not None else None),
            "reason": reason,
        })
        b = by_brand[brand]
        b["items"] += 1
        if value is None:
            b["unpriced"] += 1
        else:
            b["value"] += value
            total += value
        for w, q in per_wh.items():
            if q <= 0:
                continue
            bucket = by_warehouse[warehouses.get(w, "?")]
            bucket["items"] += 1
            if price is None:
                bucket["unpriced"] += 1
            else:
                bucket["value"] += (q * price).quantize(Decimal(1))

    priced = [r for r in rows if r["value"] is not None]
    unpriced = [r for r in rows if r["value"] is None]
    priced.sort(key=lambda r: -r["value"])
    unpriced.sort(key=lambda r: (r["reason"], -r["qty"]))
    return {
        "total": float(total),
        "counts": {"inStock": len(rows), "priced": len(priced),
                   "noPrice": sum(1 for r in unpriced if r["reason"] == NO_PRICE),
                   "noLink": sum(1 for r in unpriced if r["reason"] == NO_LINK),
                   "negative": len(negatives)},
        "byWarehouse": sorted(({"warehouse": k, **{x: float(y) if x == "value" else y for x, y in v.items()}}
                               for k, v in by_warehouse.items()), key=lambda r: -r["value"]),
        "byBrand": sorted(({"brand": k, **{x: float(y) if x == "value" else y for x, y in v.items()}}
                           for k, v in by_brand.items()), key=lambda r: -r["value"]),
        "priced": priced,
        "unpriced": unpriced,
        "negatives": negatives,
        "sync": _sync_info(),
    }
