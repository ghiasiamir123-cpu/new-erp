"""دسترسی ریزِ درون سربرگ‌ها.

هر کاربر دقیقاً همان کارهایی را می‌گیرد که تا امروز نقشش اجازه می‌داد، و فقط برای
سربرگ‌هایی که دارد؛ پس هیچ‌کس چیزی را از دست نمی‌دهد یا تازه به دست نمی‌آورد.
برگشت: کلیدهای کار برداشته می‌شود و سربرگ‌ها می‌مانند.

نگاشت عمداً اینجا کپی شده، نه از core/access.py خوانده: مهاجرت باید همیشه همان کاری
را بکند که روز نوشتنش کرد.
"""
from django.db import migrations

TAB_ORDER = ["entry", "reports", "materials", "driver", "dashboard", "warehouse", "consumables",
             "stockreview", "finance", "financereports", "projects", "contract", "payroll", "users"]
ACTIONS = [
    "entry.create", "reports.review", "reports.edit", "reports.delete", "materials.create",
    "materials.manage", "driver.create", "driver.manage", "dashboard.cost", "dashboard.backup",
    "dashboard.staff", "warehouse.voucher", "warehouse.post", "warehouse.cost", "warehouse.setup",
    "consumables.edit", "stockreview.edit", "finance.approve", "financereports.refresh",
    "projects.create", "projects.manage",
]
ROLE_ACTIONS = {
    "manager": ACTIONS,
    "data_entry": ["entry.create", "materials.create", "driver.create", "dashboard.cost", "projects.create"],
    "viewer": [],
    "driver": ["driver.create"],
    "accountant": ["dashboard.cost", "dashboard.backup", "warehouse.cost"],
}
TAB_WIDE = ["warehouse.voucher", "warehouse.post", "consumables.edit", "stockreview.edit",
            "finance.approve", "financereports.refresh"]
ORDER = [k for tab in TAB_ORDER for k in [tab] + [a for a in ACTIONS if a.split(".")[0] == tab]]


def add_actions(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        tabs = [k for k in (user.access or []) if "." not in k]
        wanted = set(ROLE_ACTIONS.get(user.role, [])) | set(TAB_WIDE)
        keys = set(tabs) | {a for a in ACTIONS if a in wanted and a.split(".")[0] in tabs}
        user.access = [k for k in ORDER if k in keys]
        user.save(update_fields=["access"])


def strip_actions(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        user.access = [k for k in (user.access or []) if "." not in k]
        user.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0035_userauditlog"),
    ]

    operations = [
        migrations.RunPython(add_actions, strip_actions),
    ]
