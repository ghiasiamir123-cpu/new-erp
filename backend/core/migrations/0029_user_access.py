"""دسترسی سربرگی به جای دو پرچم جدا.

هر کاربر دقیقاً همان سربرگ‌هایی را می‌گیرد که پیش از این می‌دید: پیش‌فرضِ
نقشش، به‌علاوهٔ انبار و کارتابل مالی اگر پرچمشان روشن بود. «مواد مصرفی» تا
حالا برای مدیرِ دارای انبار باز بود و همان‌طور می‌ماند.

نگاشت عمداً اینجا کپی شده، نه از core/access.py خوانده: مهاجرت باید همیشه
همان کاری را بکند که روز نوشتنش کرد.
"""

from django.db import migrations, models

ORDER = ["entry", "reports", "materials", "driver", "dashboard", "warehouse",
         "consumables", "finance", "projects", "contract", "payroll", "users"]

ROLE_DEFAULTS = {
    "manager": ["entry", "reports", "materials", "driver", "dashboard",
                "projects", "contract", "payroll", "users"],
    "data_entry": ["entry", "reports", "materials", "driver", "dashboard",
                   "projects", "contract"],
    "viewer": ["reports", "materials", "driver", "dashboard"],
    "driver": ["driver"],
    "accountant": ["dashboard", "payroll"],
}


def flags_to_access(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = set(ROLE_DEFAULTS.get(user.role, []))
        if user.can_access_warehouse:
            keys.add("warehouse")
            if user.role == "manager":
                keys.add("consumables")
        if user.can_review_finance:
            keys.add("finance")
        user.access = [k for k in ORDER if k in keys]
        user.save(update_fields=["access"])


def access_to_flags(apps, schema_editor):
    User = apps.get_model("core", "User")
    for user in User.objects.all():
        keys = set(user.access or [])
        user.can_access_warehouse = "warehouse" in keys
        user.can_review_finance = "finance" in keys
        user.save(update_fields=["can_access_warehouse", "can_review_finance"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0028_finance_review"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="access",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(flags_to_access, access_to_flags),
        migrations.RemoveField(model_name="user", name="can_access_warehouse"),
        migrations.RemoveField(model_name="user", name="can_review_finance"),
    ]
