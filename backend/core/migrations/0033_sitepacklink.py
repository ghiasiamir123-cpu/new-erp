"""بستهٔ دیگر سایت برای همان کالای انبار (عدد و جعبه، حلب و لیتر). فقط یک جدول تازه."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0032_familyreview"),
    ]

    operations = [
        migrations.CreateModel(
            name="SitePackLink",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("per_pack", models.DecimalField(decimal_places=6, max_digits=14)),
                ("site_pack", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                                                related_name="unit_links", to="core.sku")),
                ("sku", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                          related_name="unit_packs", to="core.sku")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("sku", "site_pack"), name="sitepacklink_unique")],
            },
        ),
    ]
