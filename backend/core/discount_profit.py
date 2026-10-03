"""سود دیواژ: تخفیف فاکتور خرید و سود فروش.

رویهٔ کارخانه: فاکتور خریدی مثل فاکتور رنر با قیمت لیست ثبت می‌شود (قیمت خرید و فروش
ردیف یکی است) و فقط یک «تخفیف فاکتور» دارد. آن تخفیف سودِ دیواژ است، نه صرفه‌جویی کارگاه:

  · مرکز پوشش (انبار مصرفی تولید) کالا را به همان قیمت لیست می‌گیرد. قیمت تمام‌شدهٔ کالا
    و هزینهٔ مواد پروژه‌ها دست نمی‌خورد.
  · سود وقتی محقق می‌شود که کالا از دست دیواژ بیرون برود: انتقال از انبار مرکزی به مرکز
    پوشش، یا فروش. تا کالا در انبار مرکزی مانده، سودش «در انتظار» است.
  · ارزش موجودی انبار مرکزی با همان قیمت لیست حساب می‌شود؛ این گزارش به آن دست نمی‌زند.

تخفیف فاکتور به نسبت مبلغِ هر ردیف بین ردیف‌ها پخش می‌شود. هر خروج به ترتیب تاریخ از
قدیمی‌ترین خریدِ تخفیف‌دارِ همان کالا برمی‌دارد (FIFO). موجودیِ پیش از اولین فاکتورِ
تخفیف‌دار از آن جدا نیست: خروجِ بعد از آن فاکتور، از همان فاکتور حساب می‌شود.

سود فروش جداست: (قیمت فروش − قیمت خرید) × مقدار، منهای تخفیفی که به مشتری داده شده.

چیزی ذخیره نمی‌شود؛ همه از دفتر گردش و حواله‌های تأییدشدهٔ مالی حساب می‌شود، پس با اصلاح
یک حواله عدد هم درست می‌شود.
"""
import datetime
from collections import defaultdict
from decimal import Decimal

from django.db.models import Q

from .jalali import gregorian_to_jalali, jalali_to_gregorian
from .models import Sku, StockMovement, StockVoucher, Warehouse

ZERO = Decimal(0)


def _money(x):
    return float(Decimal(x).quantize(Decimal(1)))


def month_start(today=None):
    """اول ماه شمسیِ جاری، به تاریخ میلادی."""
    today = today or datetime.date.today()
    jy, jm, _ = gregorian_to_jalali(today.year, today.month, today.day)
    return datetime.date(*jalali_to_gregorian(jy, jm, 1))


def sales_margin():
    """سود فروش هر حوالهٔ فروشِ تأییدشدهٔ مالی.

    ردیفی که قیمت خرید یا فروش ندارد در سود نمی‌آید و شمرده می‌شود؛ وگرنه کل مبلغ فروش
    سود حساب می‌شد. ردیفی که قیمت خریدش کمتر از نصفِ قیمت تمام‌شدهٔ خودِ کالاست علامت
    می‌خورد — معمولاً یک صفرِ جاافتاده است و سود را چند برابر نشان می‌دهد.
    """
    approved = StockVoucher.FinanceStatus.APPROVED
    vouchers = (StockVoucher.objects
                .filter(movement_kind=StockMovement.Kind.SALE, finance_status=approved)
                .prefetch_related("lines__sku__product").order_by("-date", "-id"))
    out, suspicious, unpriced = [], [], 0
    for v in vouchers:
        revenue = cost = ZERO
        for ln in v.lines.all():
            qty = ln.invoice_qty if ln.invoice_qty is not None else ln.qty
            if ln.unit_price <= 0 or ln.unit_cost <= 0:
                unpriced += 1
                continue
            revenue += qty * ln.unit_price
            cost += qty * ln.unit_cost
            item_cost = ln.sku.cost_price or ZERO
            if item_cost and ln.unit_cost < item_cost / 2 and not (ln.unit or "").strip():
                suspicious.append({"voucher": v.number, "name": ln.sku.display_name,
                                   "lineCost": _money(ln.unit_cost), "itemCost": _money(item_cost)})
        if revenue <= 0:
            continue
        net = revenue - (v.invoice_discount or ZERO)
        out.append({"id": str(v.id), "number": v.number, "date": v.date, "customer": v.counterparty,
                    "invoiceNo": v.invoice_no, "revenue": _money(net), "cost": _money(cost),
                    "discount": _money(v.invoice_discount or ZERO), "margin": _money(net - cost),
                    "percent": round(float((net - cost) / net * 100), 1) if net > 0 else None})
    waiting = (StockVoucher.objects
               .filter(movement_kind=StockMovement.Kind.SALE, status=StockVoucher.Status.POSTED)
               .exclude(finance_status=approved).count())
    return {"vouchers": out, "unpricedLines": unpriced, "suspicious": suspicious, "pendingVouchers": waiting}


def workshop_transfers(workshop):
    """ارزشِ آنچه به مرکز پوشش رفته، به قیمت لیست — «فروش دیواژ به مرکز پوشش»."""
    return [{"date": m.date, "value": m.qty * (m.sku.cost_price or ZERO)}
            for m in (StockMovement.objects
                      .filter(kind=StockMovement.Kind.TRANSFER_IN, warehouse_id__in=workshop)
                      .select_related("sku"))]


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
            layers[m.sku_id].append(layer)
            row["lines"].append(layer)

    events = []
    # فاکتوری که مستقیم به انبار مرکز پوشش وارد شده همان روز به مرکز پوشش رسیده است.
    for v in vouchers:
        for m in receipts.get(v.id, []):
            if m.warehouse_id in workshop and v.id in rows:
                layer = next(x for x in rows[v.id]["lines"] if x["sku"] == m.sku_id and x["left"] == m.qty)
                gained = layer["left"] * layer["perUnit"]
                layer["realised"], layer["left"] = gained, ZERO
                events.append({"date": v.date, "sku": m.sku_id, "qty": float(m.qty), "profit": gained,
                               "channel": "workshop", "voucher": v.number})

    # تخفیف با بیرون رفتن کالا از دست دیواژ محقق می‌شود: انتقال به مرکز پوشش، یا فروش.
    leaving = (StockMovement.objects
               .filter(Q(kind=StockMovement.Kind.TRANSFER_IN, warehouse_id__in=workshop)
                       | (Q(kind=StockMovement.Kind.SALE) & ~Q(warehouse_id__in=workshop)),
                       sku_id__in=list(layers)).select_related("voucher").order_by("date", "id"))
    for t in leaving:
        need, gained = abs(t.qty), ZERO
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
            events.append({"date": t.date, "sku": t.sku_id, "qty": float(abs(t.qty)), "profit": gained,
                           "channel": "sale" if t.kind == StockMovement.Kind.SALE else "workshop",
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

    sales = sales_margin()
    moved = workshop_transfers(workshop)
    month = month_start()

    def block(since=None):
        ev = [e for e in events if since is None or e["date"] >= since]
        sv = [v for v in sales["vouchers"] if since is None or v["date"] >= since]
        by_ws = sum((e["profit"] for e in ev if e["channel"] == "workshop"), ZERO)
        by_sale = sum((e["profit"] for e in ev if e["channel"] == "sale"), ZERO)
        margin = sum((Decimal(str(v["margin"])) for v in sv), ZERO)
        return {
            "salesMargin": _money(margin),
            "salesRevenue": _money(sum((Decimal(str(v["revenue"])) for v in sv), ZERO)),
            "salesCount": len(sv),
            "discountWorkshop": _money(by_ws), "discountSale": _money(by_sale),
            "workshopValue": _money(sum((m["value"] for m in moved
                                         if since is None or m["date"] >= since), ZERO)),
            "total": _money(margin + by_ws + by_sale),
        }

    return {
        "summary": {"all": block(), "month": block(month), "monthFrom": month},
        "sales": sales,
        "totals": {"discount": _money(discount), "realised": _money(realised),
                   "pending": _money(discount - realised), "invoices": len(out)},
        "invoices": out,
        "byBrand": sorted(({"brand": b, "discount": _money(v["discount"]), "realised": _money(v["realised"]),
                            "pending": _money(v["discount"] - v["realised"])} for b, v in by_brand.items()),
                          key=lambda r: -r["discount"]),
        "events": [{"date": e["date"], "name": names[e["sku"]].display_name, "qty": e["qty"],
                    "unit": names[e["sku"]].base_unit, "profit": _money(e["profit"]), "voucher": e["voucher"],
                    "channel": e["channel"]}
                   for e in events[:200]],
    }
