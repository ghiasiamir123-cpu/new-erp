"""سود دیواژ از تخفیف فاکتور خرید.

رویهٔ کارخانه: فاکتور خریدی مثل فاکتور رنر با قیمت لیست ثبت می‌شود (قیمت خرید و فروش
ردیف یکی است) و فقط یک «تخفیف فاکتور» دارد. آن تخفیف سودِ دیواژ است، نه صرفه‌جویی کارگاه:

  · مرکز پوشش (انبار مصرفی تولید) کالا را به همان قیمت لیست می‌گیرد. قیمت تمام‌شدهٔ کالا
    و هزینهٔ مواد پروژه‌ها دست نمی‌خورد.
  · سود وقتی محقق می‌شود که کالا از انبار مرکزی به مرکز پوشش منتقل شود، نه روز خرید.
    تا کالا در انبار مرکزی مانده، سودش «در انتظار انتقال» است.
  · ارزش موجودی انبار مرکزی با همان قیمت لیست حساب می‌شود؛ این گزارش به آن دست نمی‌زند.

تخفیف فاکتور به نسبت مبلغِ هر ردیف بین ردیف‌ها پخش می‌شود. هر انتقال به ترتیب تاریخ از
قدیمی‌ترین خریدِ تخفیف‌دارِ همان کالا برمی‌دارد (FIFO). موجودیِ پیش از اولین فاکتورِ
تخفیف‌دار از آن جدا نیست: انتقالِ بعد از آن فاکتور، از همان فاکتور حساب می‌شود.

چیزی ذخیره نمی‌شود؛ همه از دفتر گردش و حواله‌های تأییدشدهٔ مالی حساب می‌شود، پس با اصلاح
یک حواله عدد هم درست می‌شود.
"""
from collections import defaultdict
from decimal import Decimal

from .models import Sku, StockMovement, StockVoucher, Warehouse

ZERO = Decimal(0)


def _money(x):
    return float(Decimal(x).quantize(Decimal(1)))


def report():
    workshop = set(Warehouse.objects.filter(supplies_workshop=True).values_list("id", flat=True))
    vouchers = list(StockVoucher.objects
                    .filter(movement_kind=StockMovement.Kind.RECEIPT,
                            finance_status=StockVoucher.FinanceStatus.APPROVED, invoice_discount__gt=0)
                    .select_related("supplier", "warehouse").order_by("date", "id"))
    receipts = defaultdict(list)
    for m in (StockMovement.objects
              .filter(kind=StockMovement.Kind.RECEIPT, voucher__in=vouchers).order_by("id")):
        receipts[m.voucher_id].append(m)

    layers = defaultdict(list)          # sku -> خریدهای تخفیف‌دار به ترتیب تاریخ
    rows = {}
    for v in vouchers:
        moves = receipts.get(v.id, [])
        total = sum((m.qty * m.unit_cost for m in moves), ZERO)
        if total <= 0:
            continue
        rate = min(v.invoice_discount / total, Decimal(1))
        row = rows[v.id] = {
            "id": str(v.id), "number": v.number, "date": v.date, "invoiceNo": v.invoice_no,
            "supplier": v.supplier.name if v.supplier_id else v.counterparty,
            "listTotal": total, "discount": v.invoice_discount, "rate": rate,
            "realised": ZERO, "lines": [],
        }
        for m in moves:
            layer = {"voucher": v.id, "sku": m.sku_id, "date": v.date, "qty": m.qty, "left": m.qty,
                     "listCost": m.unit_cost, "perUnit": m.unit_cost * rate, "realised": ZERO}
            # فاکتوری که مستقیم به انبار مرکز پوشش وارد شده همان روز منتقل شده است.
            if m.warehouse_id in workshop:
                layer["realised"] = layer["left"] * layer["perUnit"]
                layer["left"] = ZERO
            layers[m.sku_id].append(layer)
            row["lines"].append(layer)

    events = []
    transfers = (StockMovement.objects
                 .filter(kind=StockMovement.Kind.TRANSFER_IN, warehouse_id__in=workshop,
                         sku_id__in=list(layers)).select_related("voucher").order_by("date", "id"))
    for t in transfers:
        need, gained = t.qty, ZERO
        for layer in layers[t.sku_id]:
            if need <= 0:
                break
            if layer["left"] <= 0 or layer["date"] > t.date:
                continue
            take = min(need, layer["left"])
            layer["left"] -= take
            layer["realised"] += take * layer["perUnit"]
            gained += take * layer["perUnit"]
            need -= take
        if gained > 0:
            events.append({"date": t.date, "sku": t.sku_id, "qty": float(t.qty), "profit": gained,
                           "voucher": t.voucher.number if t.voucher_id else ""})

    names = {s.pk: s for s in Sku.objects.filter(pk__in=list(layers)).select_related("product")}
    out, by_brand = [], defaultdict(lambda: {"discount": ZERO, "realised": ZERO})
    for row in rows.values():
        lines = []
        for layer in row["lines"]:
            sku = names[layer["sku"]]
            share = layer["qty"] * layer["perUnit"]
            row["realised"] += layer["realised"]
            brand = sku.product.brand or "بی برند"
            by_brand[brand]["discount"] += share
            by_brand[brand]["realised"] += layer["realised"]
            lines.append({
                "name": sku.display_name, "code": sku.barcode, "unit": sku.base_unit, "brand": brand,
                "qty": float(layer["qty"]), "moved": float(layer["qty"] - layer["left"]),
                "listCost": _money(layer["listCost"]), "netCost": _money(layer["listCost"] - layer["perUnit"]),
                "discount": _money(share), "realised": _money(layer["realised"]),
                "pending": _money(share - layer["realised"]),
            })
        out.append({
            "id": row["id"], "number": row["number"], "date": row["date"], "invoiceNo": row["invoiceNo"],
            "supplier": row["supplier"], "listTotal": _money(row["listTotal"]),
            "discount": _money(row["discount"]), "paid": _money(row["listTotal"] - row["discount"]),
            "percent": round(float(row["rate"] * 100), 2),
            "realised": _money(row["realised"]), "pending": _money(row["discount"] - row["realised"]),
            "lines": lines,
        })
    out.sort(key=lambda r: (r["date"], r["number"]), reverse=True)

    discount = sum((r["discount"] for r in rows.values()), ZERO)
    realised = sum((r["realised"] for r in rows.values()), ZERO)
    events.sort(key=lambda e: e["date"], reverse=True)
    return {
        "totals": {"discount": _money(discount), "realised": _money(realised),
                   "pending": _money(discount - realised), "invoices": len(out)},
        "invoices": out,
        "byBrand": sorted(({"brand": b, "discount": _money(v["discount"]), "realised": _money(v["realised"]),
                            "pending": _money(v["discount"] - v["realised"])} for b, v in by_brand.items()),
                          key=lambda r: -r["discount"]),
        "events": [{"date": e["date"], "name": names[e["sku"]].display_name, "qty": e["qty"],
                    "unit": names[e["sku"]].base_unit, "profit": _money(e["profit"]), "voucher": e["voucher"]}
                   for e in events[:200]],
    }
