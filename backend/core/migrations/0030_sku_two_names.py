"""هر کالا دو نام: نام انبار و نام سایت، و شناسهٔ بستهٔ سایت جدا از کد داخلی.

تا اینجا نام فقط روی محصول بود و کالای سایت و کالای انبار دو ردیف جدا بودند.
داده این‌طور تقسیم می‌شود:
  • ردیف‌هایی که کدشان عدد است از سایت آمده‌اند: شناسهٔ سایت و نام سایت می‌گیرند، نام انبار خالی.
  • بقیه (انبارگردانی حسابداری، CRM، تعریف دستی): نام محصول نام انبارشان می‌شود.
نام محصول دست نمی‌خورد، پس برگشت این مهاجرت فقط حذف سه ستون است.
"""
from django.db import migrations, models


def split_names(apps, schema_editor):
    Sku = apps.get_model("core", "Sku")
    batch = []
    for sku in Sku.objects.select_related("product").iterator(chunk_size=500):
        pid = (sku.site_package_id or "").strip()
        if pid.isdigit():
            sku.shop_pack_id = pid
            sku.site_name = sku.product.name
        else:
            sku.warehouse_name = sku.product.name
        batch.append(sku)
        if len(batch) >= 500:
            Sku.objects.bulk_update(batch, ["shop_pack_id", "site_name", "warehouse_name"])
            batch = []
    if batch:
        Sku.objects.bulk_update(batch, ["shop_pack_id", "site_name", "warehouse_name"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0029_user_access"),
    ]

    operations = [
        migrations.AddField(
            model_name="sku",
            name="warehouse_name",
            field=models.CharField(blank=True, db_index=True, max_length=300),
        ),
        migrations.AddField(
            model_name="sku",
            name="site_name",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="sku",
            name="shop_pack_id",
            field=models.CharField(blank=True, db_index=True, max_length=40),
        ),
        migrations.RunPython(split_names, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="sku",
            constraint=models.UniqueConstraint(
                condition=models.Q(("shop_pack_id", ""), _negated=True),
                fields=("shop_pack_id",),
                name="sku_shop_pack_id_unique",
            ),
        ),
    ]
