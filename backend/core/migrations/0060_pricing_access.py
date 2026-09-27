"""کلید «قیمت‌گذاری» به کسانی که پروژه‌ها را مدیریت می‌کنند.

مبلغ قرارداد و هزینهٔ نیرو اطلاعات حساس‌اند؛ هر کس صفحهٔ تولید را می‌بیند لازم نیست
آنها را ببیند. پس فقط به دارندگان «مدیریت پروژه‌ها» داده می‌شود.
"""
from django.db import migrations

KEY = "production.pricing"


def add(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = list(user.access or [])
        if "projects.manage" in keys and KEY not in keys:
            keys.append(KEY)
            user.access = keys
            user.save(update_fields=["access"])


def strip(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        if KEY in (user.access or []):
            user.access = [k for k in user.access if k != KEY]
            user.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0059_seed_importance"),
    ]

    operations = [
        migrations.RunPython(add, strip),
    ]
