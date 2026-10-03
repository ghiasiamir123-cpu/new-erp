"""حواله پس از ثبت نهایی: ساختن گردش‌ها، و ویرایش به دستور مدیر.

حوالهٔ ثبت‌شده قفل است تا موجودی بی‌صدا عوض نشود. مدیر (کلید «warehouse.amend») می‌تواند بازش کند — حتی پس
از تأیید مالی — ولی هر بار نامش، زمان، علت و آنچه عوض شد زیرِ خودِ حواله می‌ماند. گردش‌های حواله از نو
ساخته می‌شوند تا موجودی با حوالهٔ تازه بخواند، و اگر کالا یا مقدارِ حواله‌ای که مالی تأیید کرده عوض شود،
دوباره به کارتابل مالی برمی‌گردد.
"""

from decimal import Decimal

from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from .models import (Sku, StockBatch, StockItem, StockMovement, StockVoucher, StockVoucherAmendment,
                     StockVoucherLine, Warehouse)
from .units import to_base

ZERO = Decimal(0)
FA = str.maketrans("0123456789.", "۰۱۲۳۴۵۶۷۸۹٫")


class Shortage(Exception):
    """تغییر، انباری را منفی می‌کند؛ payload همان شکلی است که صفحهٔ حواله جدولش را می‌سازد."""

    def __init__(self, payload):
        super().__init__(payload["detail"])
        self.payload = payload


def _num(value):
    return f"{Decimal(str(value)).normalize():f}".translate(FA)


def write_movements(voucher, lines, user):
    """گردش‌های یک حوالهٔ ثبت‌شده از روی اقلامش. انتقال هر دو طرف را می‌سازد تا کالا بین دو انبار گم نشود."""
    inbound = voucher.is_inbound
    sign = Decimal(1) if inbound else Decimal(-1)
    is_transfer = voucher.movement_kind == StockMovement.Kind.TRANSFER_OUT
    actor = user.name or user.username
    for ln in lines:
        batch = None
        if ln.batch_no.strip():
            batch, _ = StockBatch.objects.get_or_create(
                sku=ln.sku, batch_no=ln.batch_no.strip(), defaults={"expires_on": ln.expires_on})
        base_qty = to_base(ln.sku, ln.qty, ln.unit)
        StockItem.objects.get_or_create(sku=ln.sku, warehouse=voucher.warehouse)
        common = dict(
            sku=ln.sku, batch=batch, entered_qty=ln.qty, entered_unit=ln.unit or ln.sku.base_unit,
            unit_cost=ln.unit_cost, date=voucher.date, voucher=voucher, ref=voucher.ref,
            note=ln.note or voucher.note, created_by=user, created_by_name=actor,
        )
        StockMovement.objects.create(warehouse=voucher.warehouse, kind=voucher.movement_kind,
                                     qty=sign * base_qty, **common)
        if is_transfer:
            StockMovement.objects.create(warehouse=voucher.to_warehouse, kind=StockMovement.Kind.TRANSFER_IN,
                                         qty=base_qty, **common)
            StockItem.objects.get_or_create(sku=ln.sku, warehouse=voucher.to_warehouse)
        # قیمت خرید کالا از آخرین ورود به‌روز می‌شود.
        if inbound and ln.unit_cost:
            Sku.objects.filter(pk=ln.sku_id).update(cost_price=ln.unit_cost)


# ---------- عکس و تفاوت ----------
def snapshot(voucher):
    return {
        "date": voucher.date.isoformat(), "warehouse": voucher.warehouse_id, "warehouseName": voucher.warehouse.name,
        "toWarehouse": voucher.to_warehouse_id,
        "toWarehouseName": voucher.to_warehouse.name if voucher.to_warehouse_id else "",
        "counterparty": voucher.counterparty, "ref": voucher.ref, "note": voucher.note,
        "financeStatus": voucher.finance_status,
        "lines": [{
            "sku": ln.sku_id, "name": ln.sku.display_name, "qty": str(ln.qty), "unit": ln.unit or ln.sku.base_unit,
            "unitCost": str(ln.unit_cost), "batchNo": ln.batch_no,
            "expiresOn": ln.expires_on.isoformat() if ln.expires_on else None, "note": ln.note,
            "invoiceQty": str(ln.invoice_qty) if ln.invoice_qty is not None else None, "unitPrice": str(ln.unit_price),
        } for ln in voucher.lines.select_related("sku__product").order_by("id")],
    }


def _jalali(iso):
    from .jalali import gregorian_to_jalali
    import datetime
    d = datetime.date.fromisoformat(iso)
    y, m, day = gregorian_to_jalali(d.year, d.month, d.day)
    return f"{y}/{m:02d}/{day:02d}".translate(FA)


def diff(before, after):
    """آنچه عوض شده، به زبان انبار. فهرست خالی یعنی هیچ."""
    out = []
    if before["date"] != after["date"]:
        out.append(f"تاریخ: {_jalali(before['date'])} ← {_jalali(after['date'])}")
    if before["warehouse"] != after["warehouse"]:
        out.append(f"انبار: {before['warehouseName']} ← {after['warehouseName']}")
    if before["toWarehouse"] != after["toWarehouse"]:
        out.append(f"انبار مقصد: {before['toWarehouseName'] or '—'} ← {after['toWarehouseName'] or '—'}")
    for key, label in (("counterparty", "طرف مقابل"), ("ref", "شمارهٔ فاکتور یا بارنامه"), ("note", "توضیح")):
        if (before[key] or "") != (after[key] or ""):
            out.append(f"{label}: «{before[key] or '—'}» ← «{after[key] or '—'}»")

    old = {}
    for ln in before["lines"]:
        old.setdefault(ln["sku"], []).append(ln)
    new = {}
    for ln in after["lines"]:
        new.setdefault(ln["sku"], []).append(ln)
    amount = lambda ln: f"{_num(ln['qty'])} {ln['unit']}"   # noqa: E731
    for sku, rows in old.items():
        if sku not in new:
            out.extend(f"حذف شد: {ln['name']} — {amount(ln)}" for ln in rows)
    for sku, rows in new.items():
        if sku not in old:
            out.extend(f"اضافه شد: {ln['name']} — {amount(ln)}" for ln in rows)
            continue
        for a, b in zip(old[sku], rows):
            bits = []
            if (Decimal(a["qty"]), a["unit"]) != (Decimal(b["qty"]), b["unit"]):
                bits.append(f"مقدار {amount(a)} ← {amount(b)}")
            if Decimal(a["unitCost"]) != Decimal(b["unitCost"]):
                bits.append(f"قیمت واحد {_num(a['unitCost'])} ← {_num(b['unitCost'])}")
            if (a["batchNo"] or "") != (b["batchNo"] or ""):
                bits.append(f"بچ «{a['batchNo'] or '—'}» ← «{b['batchNo'] or '—'}»")
            if bits:
                out.append(f"{b['name']}: " + "، ".join(bits))
    return out


def _material(before, after):
    """آیا چیزی عوض شده که مالی با فاکتور تطبیقش داده: کالا، مقدار، واحد یا قیمت خرید."""
    key = lambda s: sorted((ln["sku"], Decimal(ln["qty"]), ln["unit"], Decimal(ln["unitCost"])) for ln in s["lines"])  # noqa: E731
    return key(before) != key(after)


# ---------- ویرایش حوالهٔ ثبت‌شده ----------
def _stock_check(voucher, old_moves, new_effect):
    """تغییر نباید انباری را منفی کند (یا منفی‌تر از آنچه هست)."""
    old = {}
    for m in old_moves:
        old[(m.sku_id, m.warehouse_id)] = old.get((m.sku_id, m.warehouse_id), ZERO) + m.qty
    keys = set(old) | set(new_effect)
    sku_ids = {k[0] for k in keys}
    cur = {(r["sku_id"], r["warehouse_id"]): r["t"] or ZERO
           for r in StockMovement.objects.filter(sku_id__in=sku_ids).values("sku_id", "warehouse_id").annotate(t=Sum("qty"))}
    short = []
    for k in keys:
        delta = new_effect.get(k, ZERO) - old.get(k, ZERO)
        after = cur.get(k, ZERO) + delta
        if delta < 0 and after < 0:
            short.append((k, -delta, cur.get(k, ZERO)))
    if not short:
        return
    names = dict(Warehouse.objects.values_list("id", "name"))
    skus = {s.pk: s for s in Sku.objects.filter(pk__in={k[0] for k, _, _ in short}).select_related("product", "site_parent")}
    by_wh = {}
    for (sku_id, wh_id), need, have in short:
        by_wh.setdefault(wh_id, []).append((skus[sku_id], need, have))
    wh_id, rows = sorted(by_wh.items(), key=lambda x: -len(x[1]))[0]
    items, text = [], []
    for sku, need, have in rows:
        other = [{"warehouse": names.get(w, ""), "qty": float(q)}
                 for (s, w), q in cur.items() if s == sku.pk and w != wh_id and q > 0]
        items.append({"name": sku.display_name, "siteName": "", "unit": sku.base_unit, "need": float(need),
                      "have": float(have), "elsewhere": other})
        text.append(f"{sku.display_name}: این تغییر {_num(need)} {sku.base_unit} دیگر از انبار کم می‌کند، موجودی {_num(have)}")
    raise Shortage({
        "detail": f"با این تغییر موجودی «{names.get(wh_id, '')}» منفی می‌شود —\n" + "\n".join(text[:6]),
        "shortage": {"voucher": voucher.number, "warehouse": names.get(wh_id, ""), "items": items,
                     "wrongWarehouse": False, "amend": True},
    })


def amend(voucher, serializer, user, reason):
    """حوالهٔ ثبت‌شده را با دادهٔ تأییدشدهٔ serializer عوض می‌کند و ردِ تغییر را می‌گذارد.

    داخل تراکنشِ فراخواننده اجرا می‌شود؛ با Shortage یا ValidationError هیچ چیز نمی‌ماند.
    """
    if voucher.status != StockVoucher.Status.POSTED:
        raise ValidationError("این حواله هنوز پیش‌نویس است؛ با «ویرایش» معمولی عوضش کنید.")
    reason = " ".join((reason or "").split())
    if not reason:
        raise ValidationError({"reason": "علت تغییر را بنویسید؛ زیر حواله ثبت می‌شود."})
    data = dict(serializer.validated_data)
    if data.get("movement_kind", voucher.movement_kind) != voucher.movement_kind:
        raise ValidationError("نوع حوالهٔ ثبت‌شده عوض نمی‌شود؛ حوالهٔ تازه بزنید.")

    before = snapshot(voucher)
    old_lines = {}
    for ln in voucher.lines.all():
        old_lines.setdefault(ln.sku_id, ln)
    old_moves = list(voucher.movements.all())

    # سربرگ حواله
    rows = data.pop("lines", None)
    wh = data.pop("warehouse", None)
    if wh:
        voucher.warehouse = serializer._warehouse_or_400(wh, "warehouse", "انبار")
    data.pop("movement_kind", None)
    for attr, value in data.items():
        setattr(voucher, attr, value)
    voucher.save()
    voucher.refresh_from_db()

    # اقلام: آنچه مالی روی همان کالا نوشته (مقدار فاکتور، قیمت فروش) با عوض شدن مقدار پاک نمی‌شود.
    if rows is not None:
        if not rows:
            raise ValidationError({"lines": "حوالهٔ ثبت‌شده بدون قلم نمی‌ماند."})
        serializer._write_lines(voucher, [dict(r) for r in rows])
        for ln in voucher.lines.all():
            was = old_lines.get(ln.sku_id)
            if was is not None:
                StockVoucherLine.objects.filter(pk=ln.pk).update(invoice_qty=was.invoice_qty, unit_price=was.unit_price)
    lines = list(voucher.lines.select_related("sku__product"))

    # اثر تازه روی هر (کالا، انبار)، پیش از دست زدن به گردش‌ها سنجیده می‌شود.
    sign = Decimal(1) if voucher.is_inbound else Decimal(-1)
    effect = {}
    for ln in lines:
        try:
            base = to_base(ln.sku, ln.qty, ln.unit)
        except ValueError as exc:
            raise ValidationError({"lines": f"«{ln.sku.display_name}»: {exc}"})
        k = (ln.sku_id, voucher.warehouse_id)
        effect[k] = effect.get(k, ZERO) + sign * base
        if voucher.movement_kind == StockMovement.Kind.TRANSFER_OUT:
            k = (ln.sku_id, voucher.to_warehouse_id)
            effect[k] = effect.get(k, ZERO) + base
    _stock_check(voucher, old_moves, effect)

    after = snapshot(voucher)
    changes = diff(before, after)
    if not changes:
        raise ValidationError("چیزی عوض نشده است.")

    StockMovement.objects.filter(voucher=voucher).delete()
    write_movements(voucher, lines, user)

    # مالی کالا و مقدار را با فاکتور تطبیق داده؛ اگر همان‌ها عوض شود باید دوباره ببیند.
    if (voucher.finance_status == StockVoucher.FinanceStatus.APPROVED and _material(before, after)):
        voucher.finance_status = StockVoucher.FinanceStatus.PENDING
        voucher.save(update_fields=["finance_status"])
        changes.append("چون کالا یا مقدار عوض شد، حواله دوباره به کارتابل مالی رفت")

    return StockVoucherAmendment.objects.create(
        voucher=voucher, by=user, by_name=(user.name or user.username)[:150], reason=reason[:500],
        changes=changes, before=before)
