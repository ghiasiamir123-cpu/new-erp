"""اهمیت و ضریب زمانِ هر مرحله، از برگه‌ای که کارگاه پر کرد.

وزن (که پیش‌تر کاشته شد) حاصل‌ضرب همین دو است؛ حالا جزءهایش هم جدا نگه داشته می‌شوند
تا امتیاز عملکرد بتواند اهمیت را از اینجا و زمان را از سابقهٔ واقعی بگیرد.
"""
from decimal import Decimal

from django.db import migrations

# (اهمیت، ضریب زمان) — همان برگه
SHEET = {
    "میخ سنبه و بتونه و رفع ایرادات": ("2", "10"),
    "پرداخت قبل از استر": ("5", "15"),
    "پرایمر MDF یا استر دست اول": ("1", "10"),
    "پرداخت میانی": ("4", "12.5"),
    "استر لایه دوم": ("1", "10"),
    "پرداخت قبل از رنگ": ("3", "12.5"),
    "رنگ رویه": ("2", "10"),
    "بازدید و رفع ایراد جزئی": ("2", "5"),
    "رنگ نهایی": ("2", "10"),
    "بسته‌بندی و ارسال": ("2", "5"),
}


def seed(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    for name, (imp, tw) in SHEET.items():
        WorkStage.objects.filter(name=name).update(
            importance=Decimal(imp), time_weight=Decimal(tw),
            weight=Decimal(imp) * Decimal(tw))
    # «سایر» در پیشرفت نمی‌آید
    WorkStage.objects.filter(name="سایر").update(
        importance=Decimal(0), time_weight=Decimal(0), weight=Decimal(0))


def unseed(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    WorkStage.objects.update(importance=Decimal(1), time_weight=Decimal(1))


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0058_pricing"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
