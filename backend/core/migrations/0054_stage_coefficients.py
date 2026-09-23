"""ضریب پیش‌فرض مراحل: همه ۱، جز استر و پرایمر که دو دست خورده می‌شود.

این فقط پیش‌فرضِ پروژه‌های تازه است؛ پروژه‌های موجود ضریب خودشان را دارند و دست
نمی‌خورند. بقیهٔ ضریب‌ها را کارگاه بعداً از صفحهٔ «مراحل و ضریب‌ها» تنظیم می‌کند.
"""
from decimal import Decimal

from django.db import migrations

COEFFICIENTS = {"استر و پرایمر": Decimal("2")}


def apply(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    for name, coef in COEFFICIENTS.items():
        WorkStage.objects.filter(name=name).update(default_coefficient=coef)


def undo(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    WorkStage.objects.filter(name__in=COEFFICIENTS).update(default_coefficient=Decimal(1))


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0053_derive_base_area"),
    ]

    operations = [
        migrations.RunPython(apply, undo),
    ]
