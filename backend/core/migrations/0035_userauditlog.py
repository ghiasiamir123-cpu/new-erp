"""تاریخچهٔ تغییرات صفحهٔ کاربران. فقط یک جدول تازه."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_shoppricesync"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserAuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("target_username", models.CharField(db_index=True, max_length=150)),
                ("actor_name", models.CharField(blank=True, max_length=150)),
                ("action", models.CharField(choices=[
                    ("created", "ساخت کاربر"), ("profile", "ویرایش مشخصات"), ("access", "تغییر دسترسی"),
                    ("activated", "فعال شد"), ("deactivated", "غیرفعال شد"), ("password_reset", "بازنشانی رمز"),
                ], max_length=20)),
                ("changes", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                            related_name="user_audit_actions", to=settings.AUTH_USER_MODEL)),
                ("target", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                             related_name="user_audit_entries", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]
