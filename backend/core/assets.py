"""اموال: وضعیت، سرویس بعدی، گارانتی، ارزش دفتری، تاریخچه و بازرسی.

محاسبه‌ها ذخیره نمی‌شوند و هر بار از روی خودِ وسیله و تاریخچه‌اش ساخته می‌شوند تا با گذشت
زمان کهنه نشوند: سرویس بعدی = آخرین «سرویس» یا «تعمیر» (وگرنه تاریخ خرید یا تحویل) + دورهٔ
سرویس؛ ارزش دفتری = استهلاک خطی از تاریخ خرید تا امروز روی عمر مفید.
"""
import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import OuterRef, Subquery
from django.utils import timezone

from .jalali import jalali_year
from .models import ASSET_STATUSES, AssetEvent, AssetInspection, AssetInspectionLine, Sku

STATUS_LABELS = dict(ASSET_STATUSES)
SERVICE_SOON_DAYS = 14
WARRANTY_SOON_DAYS = 30


def last_service_subquery():
    """برای فهرست: تاریخ آخرین سرویس یا تعمیر هر وسیله، در همان کوئری."""
    return Subquery(AssetEvent.objects.filter(sku=OuterRef("pk"), kind__in=AssetEvent.SERVICE_KINDS)
                    .order_by("-date", "-id").values("date")[:1])


def last_service_on(sku):
    if hasattr(sku, "last_service_on"):          # از annotate فهرست
        return sku.last_service_on
    ev = sku.asset_events.filter(kind__in=AssetEvent.SERVICE_KINDS).order_by("-date", "-id").first()
    return ev.date if ev else None


def next_service(sku, today=None):
    """(تاریخ سرویس بعدی، «overdue» | «soon» | «»). بی دورهٔ سرویس: (None, «»).

    وسیله‌ای که دوره دارد ولی هیچ مبنایی ندارد (نه سرویس، نه تاریخ خرید یا تحویل) سرویسش
    عقب‌افتاده حساب می‌شود تا از چشم نیفتد.
    """
    if not sku.service_interval_days:
        return None, ""
    today = today or timezone.localdate()
    base = last_service_on(sku) or sku.purchase_date or sku.handed_over_on
    if base is None:
        return None, "overdue"
    nxt = base + datetime.timedelta(days=sku.service_interval_days)
    if nxt < today:
        return nxt, "overdue"
    if (nxt - today).days <= SERVICE_SOON_DAYS:
        return nxt, "soon"
    return nxt, ""


def warranty_state(sku, today=None):
    if not sku.warranty_until:
        return ""
    today = today or timezone.localdate()
    if sku.warranty_until < today:
        return "expired"
    if (sku.warranty_until - today).days <= WARRANTY_SOON_DAYS:
        return "soon"
    return "active"


def book_value(sku, today=None):
    """ارزش دفتری با استهلاک خطی، یا None اگر قیمت خرید، تاریخ خرید یا عمر مفید نیست."""
    price = Decimal(sku.purchase_price or 0)
    life = sku.useful_life_years
    if price <= 0 or not life or life <= 0 or not sku.purchase_date:
        return None
    today = today or timezone.localdate()
    years = Decimal(max(0, (today - sku.purchase_date).days)) / Decimal("365.25")
    salvage = min(Decimal(sku.salvage_value or 0), price)
    ratio = min(Decimal(1), years / Decimal(life))
    return (price - (price - salvage) * ratio).quantize(Decimal(1), rounding=ROUND_HALF_UP)


# ---------- تاریخچه ----------
def log(sku, kind, user, date=None, changes=None, description="", cost=0, inspection=None):
    who = user if getattr(user, "is_authenticated", False) else None
    return AssetEvent.objects.create(
        sku=sku, kind=kind, date=date or timezone.localdate(), changes=changes or {},
        description=(description or "")[:500], cost=cost or 0, inspection=inspection,
        created_by=who, created_by_name=((getattr(who, "name", "") or getattr(who, "username", "")) if who else "")[:150],
    )


def snapshot(sku):
    return {
        "holder": sku.holder_name or "",
        "location": sku.location.name if sku.location_id else "",
        "status": sku.asset_status or "",
    }


def log_created(sku, user):
    snap = snapshot(sku)
    log(sku, AssetEvent.Kind.CREATED, user, date=sku.purchase_date or sku.handed_over_on,
        changes={k: ["", v] for k, v in snap.items() if v})


def log_changes(sku, before, user):
    """تحویل، جابه‌جایی و تغییر وضعیت را از مقایسهٔ پیش و پس از ذخیره می‌نویسد."""
    after = snapshot(sku)
    if before["holder"] != after["holder"]:
        log(sku, AssetEvent.Kind.HANDOVER, user, date=sku.handed_over_on,
            changes={"holder": [before["holder"], after["holder"]]})
    if before["location"] != after["location"]:
        log(sku, AssetEvent.Kind.MOVE, user, changes={"location": [before["location"], after["location"]]})
    if before["status"] != after["status"]:
        log(sku, AssetEvent.Kind.STATUS, user, changes={"status": [before["status"], after["status"]]})


# ---------- آمار ----------
def summary(skus, today=None):
    today = today or timezone.localdate()
    out = {"total": 0, "byStatus": {k: 0 for k, _ in ASSET_STATUSES}, "serviceOverdue": 0, "serviceSoon": 0,
           "warrantySoon": 0, "noHolder": 0, "noLocation": 0, "purchaseTotal": 0, "bookTotal": 0,
           "withBookValue": 0}
    for s in skus:
        out["total"] += 1
        status = s.asset_status or "ok"
        out["byStatus"][status] = out["byStatus"].get(status, 0) + 1
        due = next_service(s, today)[1]
        if due == "overdue":
            out["serviceOverdue"] += 1
        elif due == "soon":
            out["serviceSoon"] += 1
        if warranty_state(s, today) == "soon":
            out["warrantySoon"] += 1
        out["noHolder"] += not s.holder_name
        out["noLocation"] += not s.location_id
        out["purchaseTotal"] += int(s.purchase_price or 0)
        value = book_value(s, today)
        if value is not None:
            out["bookTotal"] += int(value)
            out["withBookValue"] += 1
    return out


# ---------- بازرسی ----------
def next_inspection_number(date):
    prefix = f"بازرسی-{jalali_year(date)}-"
    used = AssetInspection.objects.filter(number__startswith=prefix).values_list("number", flat=True)
    top = max([int(n[len(prefix):]) for n in used if n[len(prefix):].isdigit()] or [0])
    return f"{prefix}{top + 1:04d}"


def start_inspection(inspection):
    """ردیف‌های برگه: همهٔ اموال فعال، یا فقط اموال همان محل."""
    qs = Sku.objects.filter(is_asset=True, active=True).select_related("location", "product")
    if inspection.location_id:
        qs = qs.filter(location_id=inspection.location_id)
    lines = [AssetInspectionLine(inspection=inspection, sku=s, holder_name=s.holder_name,
                                 location_name=s.location.name if s.location_id else "",
                                 status=s.asset_status or "ok")
             for s in qs.order_by("location__name", "product__name")]
    AssetInspectionLine.objects.bulk_create(lines)
    return len(lines)


def close_inspection(inspection, user):
    """وضعیت هر وسیلهٔ پیدا‌شده به‌روز می‌شود و هر ردیف در تاریخچهٔ وسیله‌اش می‌نشیند."""
    for line in inspection.lines.select_related("sku"):
        sku = line.sku
        bits = [STATUS_LABELS.get(line.status, line.status) if line.present else "پیدا نشد"]
        if line.needs_action:
            bits.append("نیاز به اقدام" + (f": {line.get_action_display()}" if line.action else ""))
        if line.note:
            bits.append(line.note)
        changes = {}
        if line.present and (sku.asset_status or "") != line.status:
            changes["status"] = [sku.asset_status or "", line.status]
            sku.asset_status = line.status
            sku.save(update_fields=["asset_status"])
        log(sku, AssetEvent.Kind.INSPECTION, user, date=inspection.date, changes=changes,
            description=f"{inspection.number} — " + " · ".join(bits), inspection=inspection)
    inspection.status = AssetInspection.Status.CLOSED
    inspection.closed_by_name = ((getattr(user, "name", "") or getattr(user, "username", "")) or "")[:150]
    inspection.closed_at = timezone.now()
    inspection.save(update_fields=["status", "closed_by_name", "closed_at"])
