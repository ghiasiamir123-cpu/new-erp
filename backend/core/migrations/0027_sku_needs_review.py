"""نشانِ «نیاز به اصلاح» برای کالاهایی که بیرون از روال انبار ساخته شده‌اند.

کالاهایی که 0026 از فهرست قدیمی مواد ساخت (MAT-) نام و کدشان را از همان
فهرست آورده‌اند، نه از استاندارد انبار؛ پس در فهرست اصلاح می‌نشینند.
"""

from django.db import migrations, models


def flag_migrated(apps, schema_editor):
    Sku = apps.get_model("core", "Sku")
    Sku.objects.filter(site_package_id__startswith="MAT-").update(needs_review=True)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0026_usage_from_warehouse"),
    ]

    operations = [
        migrations.AddField(
            model_name="sku",
            name="needs_review",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(flag_migrated, migrations.RunPython.noop),
    ]
