"""کارتابل تعمیر و نگهداری: اخطارها از دادهٔ اموال ساخته و با برطرف شدن دلیلشان بسته می‌شوند.

کار زمان‌بندی‌شده‌ای روی سرور نیست: هر بار کارتابل باز یا شمارندهٔ منو خوانده می‌شود (شمارنده
حداکثر دقیقه‌ای یک بار) و بلافاصله پس از هر تغییر اموال، sync اجرا می‌شود؛ پس سرویسی که امروز
رسیده، بی آنکه کسی کاری بکند اخطار می‌شود.
"""
import datetime
import time

from django.db import IntegrityError, transaction
from django.utils import timezone

from . import assets as asset_logic
from .models import AssetEvent, MaintenanceAlert as Alert, Sku

LEVEL_ORDER = {"high": 0, "medium": 1, "low": 2}
SYNC_EVERY_SECONDS = 60
_last_sync = 0.0


def _conditions(sku, today):
    """(نوع، کلید، سطح، موعد) هر اخطاری که این وسیله امروز لازم دارد."""
    status = sku.asset_status or "ok"
    if status == "out_of_service":
        return
    if status == "needs_repair":
        yield Alert.Kind.NEEDS_REPAIR, f"status:{sku.pk}:needs_repair", Alert.Level.HIGH, None
    elif status == "in_repair":
        yield Alert.Kind.IN_REPAIR, f"status:{sku.pk}:in_repair", Alert.Level.MEDIUM, None
    due_on, due = asset_logic.next_service(sku, today)
    if due and status != "in_repair":          # وسیلهٔ در تعمیر، سرویسش تا برگشت صبر می‌کند
        overdue = due == "overdue"
        # کلید با موعد: «نزدیک» که «عقب‌افتاده» شد همان اخطار است؛ سرویس تازه موعد تازه می‌سازد.
        yield (Alert.Kind.SERVICE_OVERDUE if overdue else Alert.Kind.SERVICE_SOON,
               f"service:{sku.pk}:{due_on or '-'}", Alert.Level.HIGH if overdue else Alert.Level.MEDIUM, due_on)
    if asset_logic.warranty_state(sku, today) == "soon":
        yield (Alert.Kind.WARRANTY_SOON, f"warranty:{sku.pk}:{sku.warranty_until}", Alert.Level.LOW,
               sku.warranty_until)


def _closer(alert):
    """چه کسی و با چه کاری دلیل اخطار را برطرف کرد: آخرین رخداد وسیله پس از ساخته شدن اخطار."""
    ev = AssetEvent.objects.filter(sku_id=alert.sku_id, created_at__gte=alert.created_at).order_by("-id").first()
    if ev is None:
        return "", "دلیل اخطار برطرف شد."
    return ev.created_by_name, (ev.get_kind_display() + (f": {ev.description}" if ev.description else ""))[:500]


def sync(today=None):
    """اخطارهای خودکار را با وضع امروز اموال یکی می‌کند. (ساخته‌شده، بسته‌شده)"""
    global _last_sync
    today = today or timezone.localdate()
    skus = (Sku.objects.filter(is_asset=True, active=True)
            .annotate(last_service_on=asset_logic.last_service_subquery()))
    wanted = {}
    for sku in skus:
        for kind, key, level, due in _conditions(sku, today):
            wanted[key] = (sku, kind, level, due)
    open_auto = {a.key: a for a in Alert.objects.filter(status=Alert.Status.OPEN, kind__in=Alert.AUTO_KINDS)}
    created = closed = 0
    for key, (sku, kind, level, due) in wanted.items():
        alert = open_auto.pop(key, None)
        if alert is None:
            try:
                with transaction.atomic():
                    Alert.objects.create(sku=sku, kind=kind, level=level, key=key, due_date=due)
                created += 1
            except IntegrityError:          # هم‌زمان در درخواست دیگری ساخته شد
                pass
        elif (alert.kind, alert.level, alert.due_date) != (kind, level, due):
            alert.kind, alert.level, alert.due_date = kind, level, due
            alert.save(update_fields=["kind", "level", "due_date"])
    now = timezone.now()
    for alert in open_auto.values():
        alert.closed_by_name, alert.close_note = _closer(alert)
        alert.status, alert.closed_at, alert.auto_closed = Alert.Status.DONE, now, True
        alert.save(update_fields=["status", "closed_at", "closed_by_name", "close_note", "auto_closed"])
        closed += 1
    _last_sync = time.monotonic()
    return created, closed


def sync_if_stale():
    if time.monotonic() - _last_sync >= SYNC_EVERY_SECONDS:
        sync()


def from_inspection(inspection):
    """پس از بستن برگهٔ بازرسی: هر وسیلهٔ پیدا‌نشده و هر «نیاز به اقدام» یک اخطار."""
    for line in inspection.lines.select_related("sku"):
        rows = []
        if not line.present:
            rows.append((Alert.Kind.MISSING, f"insp:{line.pk}:missing", Alert.Level.HIGH, line.note))
        if line.needs_action:
            # «تعمیر» برای وسیله‌ای که وضعیتش خراب ثبت شد، همان اخطار «نیاز به تعمیر» است.
            covered = line.action == "repair" and line.present and line.status in ("needs_repair", "in_repair")
            if not covered:
                level = Alert.Level.HIGH if line.action in ("repair", "replace", "out_of_service") else Alert.Level.MEDIUM
                detail = " — ".join(x for x in [line.get_action_display() if line.action else "", line.note] if x)
                rows.append((Alert.Kind.INSPECTION, f"insp:{line.pk}:action", level, detail))
        for kind, key, level, detail in rows:
            if not Alert.objects.filter(key=key).exists():
                Alert.objects.create(sku=line.sku, kind=kind, level=level, key=key, detail=detail[:500],
                                     inspection=inspection)


def close(alert, user, note):
    alert.status = Alert.Status.DONE
    alert.closed_at = timezone.now()
    alert.closed_by_name = ((getattr(user, "name", "") or getattr(user, "username", "")) or "")[:150]
    alert.close_note = (note or "")[:500]
    alert.auto_closed = False
    alert.save(update_fields=["status", "closed_at", "closed_by_name", "close_note", "auto_closed"])


def sort_key(alert):
    return LEVEL_ORDER.get(alert.level, 9), alert.due_date or datetime.date.max, -alert.id


def counts():
    rows = list(Alert.objects.filter(status=Alert.Status.OPEN).values_list("id", "kind", "level"))
    by_kind = {}
    for _, kind, _ in rows:
        by_kind[kind] = by_kind.get(kind, 0) + 1
    return {"open": len(rows), "high": sum(1 for r in rows if r[2] == Alert.Level.HIGH), "byKind": by_kind,
            "openIds": [str(r[0]) for r in rows]}
