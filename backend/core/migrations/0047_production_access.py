"""دسترسی «تولید» را به کسانی می‌دهد که الان با پروژه‌ها کار می‌کنند.

صفحهٔ تولید همان دادهٔ پروژه و گزارش را نشان می‌دهد، پس هر کس پروژه‌ها را می‌بیند باید
وضعیتشان را هم ببیند. ویرایش فهرست مراحل فقط برای کسانی که پروژه را مدیریت می‌کنند.
"""
from django.db import migrations

VIEW = "production"
EDIT = "production.stages"


def add(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = list(user.access or [])
        changed = False
        if "projects" in keys and VIEW not in keys:
            keys.append(VIEW)
            changed = True
        if "projects.manage" in keys and EDIT not in keys:
            keys.append(EDIT)
            changed = True
        if changed:
            user.access = keys
            user.save(update_fields=["access"])


def strip(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = [k for k in (user.access or []) if k not in (VIEW, EDIT)]
        if keys != (user.access or []):
            user.access = keys
            user.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0046_seed_stages"),
    ]

    operations = [
        migrations.RunPython(add, strip),
    ]
