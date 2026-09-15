"""گزارش خواندن قیمت‌ها از سایت فروش. فقط یک جدول تازه."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_sitepacklink"),
    ]

    operations = [
        migrations.CreateModel(
            name="ShopPriceSync",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("ok", models.BooleanField(default=False)),
                ("source", models.CharField(default="manual", max_length=20)),
                ("items", models.PositiveIntegerField(default=0)),
                ("updated", models.PositiveIntegerField(default=0)),
                ("message", models.CharField(blank=True, max_length=300)),
                ("triggered_by_name", models.CharField(blank=True, max_length=150)),
                ("triggered_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                   related_name="shop_price_syncs", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-started_at"]},
        ),
    ]
