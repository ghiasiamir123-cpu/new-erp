"""بازبینی انبار: تیک هر خانوادهٔ کالا. فقط یک جدول تازه؛ دادهٔ موجود دست نمی‌خورد."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0031_sku_site_variants"),
    ]

    operations = [
        migrations.CreateModel(
            name="FamilyReview",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.CharField(max_length=300, unique=True)),
                ("title", models.CharField(blank=True, max_length=300)),
                ("brand", models.CharField(blank=True, max_length=100)),
                ("status", models.CharField(choices=[("ok", "درست است"), ("fix", "نیاز به اصلاح")], max_length=10)),
                ("note", models.CharField(blank=True, max_length=500)),
                ("fingerprint", models.CharField(max_length=64)),
                ("item_count", models.PositiveIntegerField(default=0)),
                ("reviewed_by_name", models.CharField(blank=True, max_length=150)),
                ("reviewed_at", models.DateTimeField(auto_now=True)),
                ("reviewed_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                                                  related_name="family_reviews", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-reviewed_at"]},
        ),
    ]
