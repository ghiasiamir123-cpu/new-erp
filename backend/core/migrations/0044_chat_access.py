"""دسترسی «گفتگو» به همهٔ کاربران فعال داده می‌شود؛ هر کسی که سامانه را باز می‌کند باید بشود
با بقیه پیام رد و بدل کند. برگشت: کلید برداشته می‌شود.

ترتیب کلیدها اینجا کپی شده تا مثل مهاجرت‌های قبلی (۰۰۳۶، ۰۰۴۰) به تغییرات آینده وابسته نباشد.
"""
from django.db import migrations

KEY = "chat"
# پس از financereports.refresh و پیش از maintenance می‌نشیند (طبق TABS در access.py).
AFTER = "financereports.refresh"


def add(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = list(user.access or [])
        if KEY in keys:
            continue
        anchor = AFTER if AFTER in keys else "financereports" if "financereports" in keys else None
        if anchor is None:
            keys.append(KEY)
        else:
            keys.insert(keys.index(anchor) + 1, KEY)
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
        ("core", "0043_chat"),
    ]

    operations = [
        migrations.RunPython(add, strip),
    ]
