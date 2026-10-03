from django.db import migrations

KEY = "dashboard.w.profit"


def grant(apps, schema_editor):
    """ویجت سود دیواژ برای کسانی که هم داشبورد دارند هم گزارش‌های مالی.

    برخلاف ویجت‌های قبلی به همهٔ دارندگان داشبورد داده نمی‌شود: سود را فقط کسی باید ببیند
    که گزارش‌های مالی را می‌بیند. خودِ API هم بی آن کلید جواب نمی‌دهد.
    """
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        if "dashboard" in access and "financereports" in access and KEY not in access:
            u.access = access + [KEY]
            # کسی که چیدمان خودش را ذخیره کرده ویجت تازه را نمی‌بیند مگر در چیدمانش بیاید.
            layout = dict(u.dashboard or {})
            if isinstance(layout.get("order"), list) and "profit" not in layout["order"]:
                layout["order"] = ["profit"] + layout["order"]
                u.dashboard = layout
            u.save(update_fields=["access", "dashboard"])


def revoke(apps, schema_editor):
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        if KEY in access:
            u.access = [k for k in access if k != KEY]
            u.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0066_stock_qty_six_decimals'),
    ]

    operations = [
        migrations.RunPython(grant, revoke),
    ]
