"""مصرف مواد از فهرست انبار، و کسر از انبار مصرفی تولید.

دادهٔ موجود:
  • هر «ماده» به یک کالای انبار وصل می‌شود — اگر کدش دقیقاً با یک کالای
    موجود بخواند همان، وگرنه کالای غیرفروشیِ تازه با همان نام، کد و واحد.
  • ردیف‌های مصرفِ ثبت‌شده به همان کالا وصل می‌شوند؛ نام و مقدارشان دست
    نمی‌خورد.
  • گزارش‌های موجود روی موجودی اثر نمی‌گذارند (affects_stock=False): آن
    مصرف پیش از انبارگردانی بوده است.
  • «انبار مصرفی تولید (مرکز پوشش)» ساخته و انبارِ کارگاه می‌شود.
"""

import re

import django.db.models.deletion
from django.db import migrations, models

CONSUMABLE_WAREHOUSE = "انبار مصرفی تولید (مرکز پوشش)"


def _squash(value):
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def link_materials(apps, schema_editor):
    Material = apps.get_model("core", "Material")
    MaterialUsage = apps.get_model("core", "MaterialUsage")
    MaterialUsageReport = apps.get_model("core", "MaterialUsageReport")
    Product = apps.get_model("core", "Product")
    Sku = apps.get_model("core", "Sku")
    Warehouse = apps.get_model("core", "Warehouse")

    MaterialUsageReport.objects.update(affects_stock=False)

    # کارگاه دیگر مستقیم از انبار مرکزی برنمی‌دارد؛ انبار مصرفیِ خودش را دارد.
    Warehouse.objects.update(supplies_workshop=False)
    warehouse, _ = Warehouse.objects.get_or_create(
        name=CONSUMABLE_WAREHOUSE, defaults={"code": "PROD"})
    warehouse.supplies_workshop = True
    warehouse.active = True
    warehouse.save(update_fields=["supplies_workshop", "active"])

    # شناسهٔ سایت عمداً در فهرست نیست: عددی است و با کدهای عددیِ مواد
    # (مثل ۵۱۰۱۰۲) به‌اشتباه جفت می‌شود.
    index, used_codes = {}, set()
    for sku in Sku.objects.filter(is_asset=False).select_related("product"):
        if sku.warehouse_code:
            used_codes.add(sku.warehouse_code.strip())
        for key in (sku.warehouse_code, sku.barcode, sku.product.code):
            k = _squash(key)
            if len(k) >= 4:
                index.setdefault(k, {})[sku.pk] = sku

    for material in Material.objects.filter(sku__isnull=True).order_by("pk"):
        code = (material.code or "").strip()[:40]
        key = _squash(code)
        matches = list(index.get(key, {}).values()) if len(key) >= 4 else []
        if len(matches) == 1:
            sku = matches[0]
            if code and not sku.warehouse_code and code not in used_codes:
                sku.warehouse_code = code
                sku.save(update_fields=["warehouse_code"])
                used_codes.add(code)
        else:
            product = Product.objects.create(
                name=material.name, code=code, sellable=False, active=material.active)
            warehouse_code = code if code and code not in used_codes else ""
            sku = Sku.objects.create(
                product=product,
                site_package_id=f"MAT-{material.pk}",
                warehouse_code=warehouse_code,
                base_unit=(material.unit or "").strip() or "عدد",
                active=material.active,
            )
            if warehouse_code:
                used_codes.add(warehouse_code)
        material.sku = sku
        material.save(update_fields=["sku"])

    for usage in (MaterialUsage.objects
                  .filter(sku__isnull=True, material__isnull=False)
                  .select_related("material")):
        usage.sku_id = usage.material.sku_id
        usage.save(update_fields=["sku"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0025_asset_location"),
    ]

    operations = [
        migrations.AddField(
            model_name="material",
            name="sku",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="legacy_materials", to="core.sku"),
        ),
        migrations.AddField(
            model_name="materialusage",
            name="sku",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="usages", to="core.sku"),
        ),
        migrations.AddField(
            model_name="materialusagereport",
            name="affects_stock",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="stockmovement",
            name="usage_report",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="stock_movements", to="core.materialusagereport"),
        ),
        migrations.RunPython(link_materials, migrations.RunPython.noop),
    ]
