"""زیرمجموعهٔ سایت: رنگ‌های انبار زیر یک بستهٔ سایت.

سایت «آماده‌سازی بورما Grundier Oil — 1L» را یک بسته می‌فروشد و رنگ را مشتری انتخاب
می‌کند؛ انبار ۴۹ رنگ ۱ لیتری را جدا می‌شمارد. هر رنگ به بستهٔ سایت وصل می‌شود و در
سایت «نام سایت (رنگ)» دیده می‌شود. فقط دو ستون اضافه می‌شود و داده‌ای تغییر نمی‌کند.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0030_sku_two_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="sku",
            name="site_parent",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="site_variants", to="core.sku"),
        ),
        migrations.AddField(
            model_name="sku",
            name="variant_label",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]
