"""انبار: کاردکس، گردش کالا، کالای دست اشخاص و برگهٔ انبارگردانی.

همه از دفتر گردش (StockMovement) خوانده می‌شوند؛ موجودی هیچ‌جا جدا ذخیره نمی‌شود.
"""
import datetime
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .jalali import jalali_year
from .models import Sku, StockCount, StockCountLine, StockItem, StockMovement, StockVoucher, Warehouse

ZERO = Decimal(0)
MAX_KARDEX_ROWS = 3000
MAX_COUNT_LINES = 3000


def parse_date(value, label="تاریخ"):
    if value in (None, ""):
        return None
    try:
        return datetime.date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError(f"{label} معتبر نیست.")


def _pk(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _f(value):
    return float(value or 0)


# ---------- کاردکس ----------
def kardex(sku, warehouse=None, date_from=None, date_to=None, with_cost=False):
    """گردش‌های یک کالا به ترتیب تاریخ با ماندهٔ پس از هر ردیف؛ اول دوره = جمع گردش‌های پیش از «از تاریخ»."""
    moves = StockMovement.objects.filter(sku=sku)
    if warehouse is not None:
        moves = moves.filter(warehouse=warehouse)
    opening = (moves.filter(date__lt=date_from).aggregate(s=Sum("qty"))["s"] or ZERO) if date_from else ZERO
    period = moves
    if date_from:
        period = period.filter(date__gte=date_from)
    if date_to:
        period = period.filter(date__lte=date_to)
    sums = period.aggregate(qin=Sum("qty", filter=Q(qty__gt=0)), qout=Sum("qty", filter=Q(qty__lt=0)), n=Count("id"))
    qin, qout = sums["qin"] or ZERO, -(sums["qout"] or ZERO)

    balance, rows = opening, []
    for m in (period.select_related("warehouse", "voucher__warehouse", "voucher__to_warehouse", "batch")
              .order_by("date", "id")[:MAX_KARDEX_ROWS]):
        balance += m.qty
        v = m.voucher
        if v is None:
            party = ""
        elif v.to_warehouse_id:
            party = f"به {v.to_warehouse.name}" if m.qty < 0 else f"از {v.warehouse.name}"
        else:
            party = v.counterparty
        row = {
            "id": str(m.pk), "date": m.date, "kind": m.kind, "kindLabel": m.get_kind_display(),
            "warehouse": m.warehouse.name, "in": _f(m.qty) if m.qty > 0 else 0, "out": _f(-m.qty) if m.qty < 0 else 0,
            "balance": _f(balance), "number": v.number if v else "", "ref": m.ref, "party": party,
            "batchNo": m.batch.batch_no if m.batch_id else "", "note": m.note, "by": m.created_by_name,
        }
        if with_cost:
            row["unitCost"] = _f(m.unit_cost)
        rows.append(row)
    return {
        "sku": {"id": str(sku.pk), "name": sku.display_name, "code": sku.site_package_id,
                "packSize": sku.pack_size, "baseUnit": sku.base_unit},
        "warehouse": warehouse.name if warehouse is not None else "",
        "from": date_from, "to": date_to,
        "opening": _f(opening), "in": _f(qin), "out": _f(qout), "closing": _f(opening + qin - qout),
        "rows": rows, "truncated": sums["n"] > MAX_KARDEX_ROWS,
    }


# ---------- گردش کالا ----------
def turnover(warehouse=None, date_from=None, date_to=None, brand="", category="", q="", only_moved=True,
             with_cost=False):
    """برای هر کالا: اول دوره، ورود، خروج و پایان دوره در بازه. بی انبار، انتقال هم ورود است هم خروج."""
    moves = StockMovement.objects.all()
    if warehouse is not None:
        moves = moves.filter(warehouse=warehouse)
    if date_to:
        moves = moves.filter(date__lte=date_to)
    period = moves.filter(date__gte=date_from) if date_from else moves
    flows = {r["sku_id"]: r for r in period.values("sku_id").annotate(
        qin=Sum("qty", filter=Q(qty__gt=0)), qout=Sum("qty", filter=Q(qty__lt=0)))}
    openings = ({r["sku_id"]: r["s"] for r in moves.filter(date__lt=date_from).values("sku_id").annotate(s=Sum("qty"))}
                if date_from else {})
    ids = {k for k, r in flows.items() if r["qin"] or r["qout"]}
    if not only_moved:
        ids |= set(flows) | {k for k, v in openings.items() if v}

    skus = Sku.objects.filter(pk__in=ids).select_related("product")
    if brand:
        skus = skus.filter(product__brand=brand)
    if category:
        skus = skus.filter(product__category=category)
    q = (q or "").strip()
    if q:
        skus = skus.filter(Q(warehouse_name__icontains=q) | Q(product__name__icontains=q) | Q(site_name__icontains=q)
                           | Q(site_package_id__icontains=q) | Q(product__code__icontains=q))

    rows, value_total = [], ZERO
    for s in skus.order_by("product__brand", "product__name", "pack_size"):
        opening = openings.get(s.pk) or ZERO
        f = flows.get(s.pk) or {}
        qin, qout = f.get("qin") or ZERO, -(f.get("qout") or ZERO)
        closing = opening + qin - qout
        row = {"id": str(s.pk), "name": s.display_name, "code": s.site_package_id, "brand": s.product.brand,
               "category": s.product.category, "packSize": s.pack_size, "baseUnit": s.base_unit,
               "opening": _f(opening), "in": _f(qin), "out": _f(qout), "closing": _f(closing)}
        if with_cost:
            value = (closing * (s.cost_price or ZERO)).quantize(Decimal(1)) if closing > 0 else ZERO
            row.update(cost=_f(s.cost_price), value=_f(value))
            value_total += value
        rows.append(row)
    totals = {"items": len(rows), "withIn": sum(1 for r in rows if r["in"]), "withOut": sum(1 for r in rows if r["out"])}
    if with_cost:
        totals["value"] = _f(value_total)
    return {"rows": rows, "totals": totals}


# ---------- کالای دست اشخاص ----------
def _person(name):
    return " ".join((name or "").split())


def holders(q="", warehouse=None, include_all=False):
    """تحویل به شخص منهای برگشت از شخص، برای هر (شخص، کالا)."""
    moves = StockMovement.objects.filter(kind__in=StockVoucher.PERSON_KINDS, voucher__isnull=False)
    if warehouse is not None:
        moves = moves.filter(warehouse=warehouse)
    agg = defaultdict(lambda: {"issued": ZERO, "returned": ZERO, "last": None})
    last_warehouse = {}
    for person, sku_id, kind, qty, date, wh_id in (moves.order_by("date", "id").values_list(
            "voucher__counterparty", "sku_id", "kind", "qty", "date", "warehouse_id")):
        key = (_person(person), sku_id)
        if kind == StockMovement.Kind.ISSUE_PERSON:
            agg[key]["issued"] += -qty
            agg[key]["last"] = date
            last_warehouse[key[0]] = wh_id
        else:
            agg[key]["returned"] += qty

    skus = Sku.objects.filter(pk__in={k[1] for k in agg}).select_related("product").in_bulk()
    people = defaultdict(list)
    for (person, sku_id), a in agg.items():
        s = skus.get(sku_id)
        if s is None:
            continue
        people[person].append({
            "sku": str(sku_id), "name": s.display_name, "code": s.site_package_id, "packSize": s.pack_size,
            "baseUnit": s.base_unit, "altUnit": s.alt_unit, "issued": _f(a["issued"]), "returned": _f(a["returned"]),
            "holding": _f(a["issued"] - a["returned"]), "lastIssued": a["last"],
        })
    needle = (q or "").strip().lower()
    out = []
    for person, items in people.items():
        if needle and needle not in person.lower() and not any(
                needle in i["name"].lower() or needle in i["code"].lower() for i in items):
            continue
        holding = [i for i in items if i["holding"] > 0]
        if not include_all and not holding:
            continue
        items.sort(key=lambda i: (i["holding"] <= 0, i["name"]))
        wh = last_warehouse.get(person)
        out.append({"name": person, "warehouse": str(wh) if wh else None, "holdingItems": len(holding),
                    "items": items if include_all else holding})
    out.sort(key=lambda p: p["name"])
    return {"people": out}


# ---------- برگهٔ انبارگردانی ----------
def next_count_number(date):
    prefix = f"انبارگردانی-{jalali_year(date)}-"
    used = StockCount.objects.filter(number__startswith=prefix).values_list("number", flat=True)
    top = max([int(n[len(prefix):]) for n in used if n[len(prefix):].isdigit()] or [0])
    return f"{prefix}{top + 1:04d}"


def on_hand_map(warehouse, sku_ids=None, as_of=None):
    """موجودی دفتر هر کالا در یک انبار؛ با as_of تا پایان همان روز."""
    moves = StockMovement.objects.filter(warehouse=warehouse)
    if sku_ids is not None:
        moves = moves.filter(sku_id__in=sku_ids)
    if as_of is not None:
        moves = moves.filter(date__lte=as_of)
    return {r["sku_id"]: r["s"] or ZERO for r in moves.values("sku_id").annotate(s=Sum("qty"))}


def create_count(data, user):
    title = (data.get("title") or "").strip()
    if not title:
        raise ValidationError("عنوان برگه را بنویسید؛ مثلاً «انبارگردانی شهریور ۱۴۰۵».")
    date = parse_date(data.get("date"), "تاریخ شمارش") or timezone.localdate()
    warehouse = Warehouse.objects.filter(pk=_pk(data.get("warehouse"))).first()
    if warehouse is None:
        raise ValidationError("انبار را انتخاب کنید.")
    brand = (data.get("brand") or "").strip()
    category = (data.get("category") or "").strip()

    stock = on_hand_map(warehouse, as_of=date)
    # بستهٔ سایتی که کالاهای انبارش زیرمجموعه‌اند خودش شمردنی نیست، مگر خودش موجودی داشته باشد.
    parents = set(Sku.objects.filter(site_parent__isnull=False).values_list("site_parent_id", flat=True))
    skus = Sku.objects.filter(active=True, is_asset=False).select_related("product")
    if brand:
        skus = skus.filter(product__brand=brand)
    if category:
        skus = skus.filter(product__category=category)
    if data.get("includeZero"):
        skus = skus.filter(Q(stock_items__warehouse=warehouse) | Q(pk__in=list(stock))).distinct()
    else:
        skus = skus.filter(pk__in=[k for k, v in stock.items() if v])
    picked = [s for s in skus.order_by("product__brand", "product__name", "pack_size")
              if s.pk not in parents or stock.get(s.pk)]
    if not picked:
        raise ValidationError("در این انبار با این فیلترها کالایی برای شمارش نیست.")
    if len(picked) > MAX_COUNT_LINES:
        raise ValidationError(f"این برگه {len(picked)} قلم می‌شود؛ با انتخاب برند یا دسته کوچک‌ترش کنید "
                              f"(حداکثر {MAX_COUNT_LINES} قلم).")
    count = StockCount.objects.create(
        number=next_count_number(date), title=title[:200], date=date, warehouse=warehouse,
        brand=brand[:100], category=category[:150], note=(data.get("note") or "").strip()[:500],
        created_by=user, created_by_name=(user.name or user.username)[:150])
    StockCountLine.objects.bulk_create(
        [StockCountLine(count=count, sku=s, system_qty=stock.get(s.pk, ZERO)) for s in picked])
    return count


def count_stats(count):
    a = count.lines.aggregate(
        total=Count("id"), counted=Count("id", filter=Q(counted_qty__isnull=False)),
        short=Count("id", filter=Q(posted_diff__lt=0)), over=Count("id", filter=Q(posted_diff__gt=0)))
    return {"lineCount": a["total"], "countedCount": a["counted"], "shortCount": a["short"], "overCount": a["over"]}


def count_row(count):
    return {
        "id": str(count.pk), "number": count.number, "title": count.title, "date": count.date,
        "warehouse": str(count.warehouse_id), "warehouseName": count.warehouse.name,
        "brand": count.brand, "category": count.category, "note": count.note,
        "status": count.status, "statusLabel": count.get_status_display(),
        "createdBy": count.created_by_name, "postedBy": count.posted_by_name, "postedAt": count.posted_at,
        **count_stats(count),
    }


def count_detail(count, with_cost=False):
    lines = list(count.lines.select_related("sku__product").order_by("id"))
    posted = count.status == StockCount.Status.POSTED
    ids = [l.sku_id for l in lines]
    current = {} if posted else on_hand_map(count.warehouse, ids, as_of=count.date)
    shelves = dict(StockItem.objects.filter(warehouse=count.warehouse, sku_id__in=ids)
                   .values_list("sku_id", "shelf_code"))
    rows = []
    for l in lines:
        s = l.sku
        if posted:
            diff = l.posted_diff
            base = l.counted_qty - diff if l.counted_qty is not None and diff is not None else l.system_qty
        else:
            base = current.get(l.sku_id, ZERO)
            diff = l.counted_qty - base if l.counted_qty is not None else None
        row = {
            "id": str(l.pk), "sku": str(s.pk), "name": s.display_name, "code": s.site_package_id,
            "brand": s.product.brand, "packSize": s.pack_size, "shade": s.shade, "baseUnit": s.base_unit,
            "shelf": shelves.get(l.sku_id) or "",
            "systemQty": _f(l.system_qty), "currentQty": _f(base), "moved": (not posted) and base != l.system_qty,
            "countedQty": _f(l.counted_qty) if l.counted_qty is not None else None,
            "diff": _f(diff) if diff is not None else None, "note": l.note,
        }
        if with_cost:
            row["unitCost"] = _f(s.cost_price)
        rows.append(row)
    return {**count_row(count), "lines": rows}


def _require_draft(count):
    if count.status != StockCount.Status.DRAFT:
        raise ValidationError("این برگه ثبت نهایی شده و دیگر ویرایش نمی‌شود.")


def update_count(count, data):
    _require_draft(count)
    fields = []
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            raise ValidationError("عنوان برگه را خالی نگذارید.")
        count.title = title[:200]
        fields.append("title")
    if "date" in data:
        count.date = parse_date(data.get("date"), "تاریخ شمارش") or count.date
        fields.append("date")
    if "note" in data:
        count.note = (data.get("note") or "").strip()[:500]
        fields.append("note")
    if fields:
        count.save(update_fields=fields)
    rows = data.get("lines")
    if rows is None:
        return
    if not isinstance(rows, list):
        raise ValidationError("ردیف‌های برگه معتبر نیست.")
    lines = {str(l.pk): l for l in count.lines.select_related("sku")}
    for row in rows:
        line = lines.get(str((row or {}).get("id")))
        if line is None:
            raise ValidationError("ردیفی که فرستاده شد در این برگه نیست.")
        if "countedQty" in row:
            raw = row["countedQty"]
            if raw in (None, ""):
                line.counted_qty = None
            else:
                try:
                    value = Decimal(str(raw)).quantize(Decimal("0.001"))
                except (InvalidOperation, ValueError):
                    raise ValidationError(f"شمارش «{line.sku.display_name}» عدد نیست.")
                if value < 0:
                    raise ValidationError(f"شمارش «{line.sku.display_name}» نمی‌تواند منفی باشد.")
                line.counted_qty = value
        if "note" in row:
            line.note = (row["note"] or "").strip()[:300]
        line.save(update_fields=["counted_qty", "note"])


def add_line(count, sku_id):
    """کالایی که روی قفسه پیدا شد ولی در برگه نیست."""
    _require_draft(count)
    sku = Sku.objects.filter(pk=_pk(sku_id), is_asset=False).first()
    if sku is None:
        raise ValidationError("کالا پیدا نشد.")
    if count.lines.filter(sku=sku).exists():
        raise ValidationError(f"«{sku.display_name}» در همین برگه هست؛ آن را جست‌وجو کنید.")
    StockCountLine.objects.create(
        count=count, sku=sku, system_qty=on_hand_map(count.warehouse, [sku.pk], as_of=count.date).get(sku.pk, ZERO))


def post_count(count, user):
    """برای هر قلمِ شمرده‌شده، مغایرت با موجودی دفتر در تاریخ برگه یک گردش «اصلاح انبارگردانی» می‌شود."""
    if count.status != StockCount.Status.DRAFT:
        raise ValidationError("این برگه قبلاً ثبت نهایی شده.")
    lines = list(count.lines.select_related("sku").filter(counted_qty__isnull=False))
    if not lines:
        raise ValidationError("هنوز هیچ قلمی شمرده نشده؛ دست‌کم یک شمارش بنویسید.")
    current = on_hand_map(count.warehouse, [l.sku_id for l in lines], as_of=count.date)
    actor = (user.name or user.username)[:150]
    changed = 0
    for l in lines:
        diff = l.counted_qty - current.get(l.sku_id, ZERO)
        if diff:
            StockMovement.objects.create(
                sku=l.sku, warehouse=count.warehouse, kind=StockMovement.Kind.COUNT, qty=diff,
                entered_qty=l.counted_qty, entered_unit=l.sku.base_unit, unit_cost=l.sku.cost_price or 0,
                date=count.date, ref=count.number, note=(l.note or f"انبارگردانی {count.number}")[:300],
                created_by=user, created_by_name=actor)
            changed += 1
        item, _ = StockItem.objects.get_or_create(sku=l.sku, warehouse=count.warehouse)
        if item.counted_at is None or item.counted_at < count.date:
            item.counted_at = count.date
            item.save(update_fields=["counted_at"])
        l.posted_diff = diff
        l.save(update_fields=["posted_diff"])
    count.status = StockCount.Status.POSTED
    count.posted_at = timezone.now()
    count.posted_by_name = actor
    count.save(update_fields=["status", "posted_at", "posted_by_name"])
    return changed
