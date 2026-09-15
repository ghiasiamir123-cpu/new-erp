"""پیش‌فرض‌های ماژول اموال.

  • هر وسیلهٔ موجود وضعیت «سالم» می‌گیرد (تا امروز وضعیتی نداشت).
  • هر کسی که «انبار» را دارد «انبار › ثبت و ویرایش اموال» را هم می‌گیرد، چون تا امروز
    ثبت و ویرایش اموال با خودِ سربرگ انبار بود؛ پس کسی چیزی از دست نمی‌دهد.
برگشت: وضعیت‌ها خالی و آن کلید برداشته می‌شود.
"""
from django.db import migrations

KEY = "warehouse.assets"
AFTER = "warehouse.setup"   # ترتیب ذخیره همان core/access.py: پس از «تعریف انبار»


def forwards(apps, schema_editor):
    Sku = apps.get_model("core", "Sku")
    Sku.objects.filter(is_asset=True, asset_status="").update(asset_status="ok")
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = list(user.access or [])
        if "warehouse" not in keys or KEY in keys:
            continue
        anchor = AFTER if AFTER in keys else "warehouse.post" if "warehouse.post" in keys else \
            "warehouse.cost" if "warehouse.cost" in keys else "warehouse.voucher" if "warehouse.voucher" in keys else "warehouse"
        keys.insert(keys.index(anchor) + 1, KEY)
        user.access = keys
        user.save(update_fields=["access"])


def backwards(apps, schema_editor):
    Sku = apps.get_model("core", "Sku")
    Sku.objects.filter(is_asset=True).update(asset_status="")
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        if KEY in (user.access or []):
            user.access = [k for k in user.access if k != KEY]
            user.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0037_asset_details"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
