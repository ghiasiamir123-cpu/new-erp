"""فهرست رسمی مراحل را می‌کارد و املای دوگانه را یکی می‌کند.

ترتیب همان ترتیبی است که تا امروز در فرانت‌اند بود، تا چیزی برای کاربر جابه‌جا نشود؛
اگر خط تولید ترتیب دیگری دارد، از صفحهٔ تولید قابل تغییر است.

«آستر / پرایمر» املای دیگری از «استر و پرایمر» است و در گزارش‌های مرداد ثبت شده. چون دو
املا گزارش‌ها را تکه‌تکه می‌کند، ردیف‌ها به املای رسمی برمی‌گردند. برگشت‌پذیر نیست (نمی‌دانیم
کدام ردیف پیش‌تر کدام املا داشته)، ولی متراژ و نفر و تاریخ هیچ‌کدام دست نمی‌خورند.
"""
from django.db import migrations

# (نام، آیا متراژ دارد)
STAGES = [
    ("زیرکاری", True),
    ("سنباده‌کاری", True),
    ("استر و پرایمر", True),
    ("خشک‌کن میانی", True),
    ("سنباده میانی", True),
    ("خط رنگ", True),
    ("خشک‌کن اولیه", True),
    ("خشک‌کن ثانویه", True),
    ("سایر", False),          # کار بی‌متراژ: خدمات کارگاه، نظافت، …
]

# املای غلط → املای رسمی
ALIASES = {"آستر / پرایمر": "استر و پرایمر"}


def seed(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    for order, (name, needs_area) in enumerate(STAGES):
        WorkStage.objects.update_or_create(
            name=name, defaults={"order": order, "active": True, "needs_area": needs_area})

    ReportProgress = apps.get_model("core", "ReportProgress")
    ReportItem = apps.get_model("core", "ReportItem")
    ProjectStage = apps.get_model("core", "ProjectStage")
    for wrong, right in ALIASES.items():
        ReportProgress.objects.filter(stage=wrong).update(stage=right)
        ReportItem.objects.filter(activity=wrong).update(activity=right)
        # اگر پروژه‌ای هر دو املا را داشته باشد، یکی‌کردن به unique_together می‌خورد؛
        # پس فقط آنهایی که املای رسمی را ندارند تغییر می‌کنند و بقیه پاک می‌شوند.
        for st in ProjectStage.objects.filter(name=wrong):
            if ProjectStage.objects.filter(project_id=st.project_id, name=right).exists():
                st.delete()
            else:
                st.name = right
                st.save(update_fields=["name"])


def unseed(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    WorkStage.objects.filter(name__in=[n for n, _ in STAGES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0045_production_base"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
