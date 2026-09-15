"""دسترسی «کارتابل تعمیر و نگهداری».

مدیرانی که اموال را ثبت و ویرایش می‌کنند سربرگ کارتابل و «ثبت سرویس و تعمیر، بستن اخطار» را
می‌گیرند تا کارتابل از روز اول دیده شود؛ مسئول تعمیر را مدیر از صفحهٔ کاربران تیک می‌زند.
برگشت: هر دو کلید برداشته می‌شود.

ترتیب کلیدها عمداً اینجا کپی شده، نه از core/access.py خوانده (مثل ۰۰۳۶).
"""
from django.db import migrations

NEW_KEYS = ["maintenance", "maintenance.work"]
ORDER = [
    "entry", "entry.create", "reports", "reports.review", "reports.edit", "reports.delete",
    "materials", "materials.create", "materials.manage", "driver", "driver.create", "driver.manage",
    "dashboard", "dashboard.cost", "dashboard.backup", "dashboard.staff",
    "warehouse", "warehouse.voucher", "warehouse.post", "warehouse.cost", "warehouse.setup", "warehouse.assets",
    "consumables", "consumables.edit", "stockreview", "stockreview.edit", "finance", "finance.approve",
    "financereports", "financereports.refresh", "maintenance", "maintenance.work",
    "projects", "projects.create", "projects.manage", "contract", "payroll", "users",
]


def grant(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = list(user.access or [])
        if user.role != "manager" or "warehouse.assets" not in keys:
            continue
        chosen = set(keys) | set(NEW_KEYS)
        user.access = [k for k in ORDER if k in chosen] + [k for k in keys if k not in ORDER]
        user.save(update_fields=["access"])


def revoke(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        if any(k in (user.access or []) for k in NEW_KEYS):
            user.access = [k for k in user.access if k not in NEW_KEYS]
            user.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0039_maintenance_alert"),
    ]

    operations = [
        migrations.RunPython(grant, revoke),
    ]
