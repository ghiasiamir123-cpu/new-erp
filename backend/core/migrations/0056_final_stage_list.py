"""فهرست نهایی مراحل خط تولید، با وزنی که کارگاه تعیین کرده.

مرحله در گزارش‌ها به‌صورت متن ذخیره شده، نه پیوند. پس تغییر نام فهرست به تنهایی
ردیف‌های تاریخی را همراه نمی‌برد؛ متنِ خودِ ردیف‌ها هم عوض می‌شود تا ۳۲۷ ردیف کار و
۴۵ ردیف متراژ و ۲۵ مرحلهٔ پروژه سر جایشان بمانند.

«بازدید و متراژبرداری» و «QC چک» در این فهرست نیستند — قرار است بخش جداگانه‌ای
بگیرند. خشک‌کن هم حذف شده چون کار می‌خوابد و نیرو نمی‌خواهد؛ ۱۰۷٫۵ ساعتِ ثبت‌شده‌اش
به «سایر» می‌رود تا از آمار بیرون نیفتد و شرح هر ردیف بگوید چه بوده.

وزن = اهمیتِ کیفی × سنگینیِ زمانی. سه مرحلهٔ پرداخت با هم ۶۲٪ وزن کارند.
"""
from decimal import Decimal

from django.db import migrations

# نام قدیمی → نام تازه؛ ردیف‌های تاریخی هم با همین جابه‌جا می‌شوند.
RENAMES = {
    "زیرکاری": "میخ سنبه و بتونه و رفع ایرادات",
    "سنباده‌کاری": "پرداخت قبل از استر",
    "استر و پرایمر": "پرایمر MDF یا استر دست اول",
    "سنباده میانی": "پرداخت میانی",
    "خط رنگ": "رنگ رویه",
}

# خشک‌کن دیگر مرحله نیست؛ ساعتش به «سایر» می‌رود.
DRYERS = ["خشک‌کن اولیه", "خشک‌کن میانی", "خشک‌کن ثانویه"]
OTHER = "سایر"

# (نام، ترتیب، متراژ می‌گیرد؟، وزن)
FINAL = [
    ("میخ سنبه و بتونه و رفع ایرادات", 0, True, "20"),
    ("پرداخت قبل از استر", 1, True, "75"),
    ("پرایمر MDF یا استر دست اول", 2, True, "10"),
    ("پرداخت میانی", 3, True, "50"),
    ("استر لایه دوم", 4, True, "10"),
    ("پرداخت قبل از رنگ", 5, True, "37.5"),
    ("رنگ رویه", 6, True, "20"),
    ("بازدید و رفع ایراد جزئی", 7, True, "10"),
    ("رنگ نهایی", 8, True, "20"),
    ("بسته‌بندی و ارسال", 9, True, "10"),
    # کارِ بی‌وزن: در پیشرفت پروژه نمی‌آید، ولی ساعتش ثبت می‌شود.
    (OTHER, 10, False, "0"),
]


def _retext(apps, mapping, stages=True):
    """متنِ مرحله را در هر جایی که ذخیره شده عوض می‌کند.

    stages=False برای وقتی است که ProjectStage جداگانه رسیدگی می‌شود — در ادغام،
    متراژها باید جمع شوند نه اینکه فقط نامشان عوض شود.
    """
    ReportItem = apps.get_model("core", "ReportItem")
    ReportProgress = apps.get_model("core", "ReportProgress")
    ProjectStage = apps.get_model("core", "ProjectStage")
    for old, new in mapping.items():
        ReportItem.objects.filter(activity=old).update(activity=new)
        ReportProgress.objects.filter(stage=old).update(stage=new)
        if stages:
            # تغییر نام ساده امن است: نام تازه پیش‌تر وجود نداشته، پس با
            # یکتاییِ (پروژه، نام) تصادم نمی‌کند.
            ProjectStage.objects.filter(name=old).update(name=new)


def _merge_stage(apps, sources, target):
    """چند مرحله را در یکی ادغام می‌کند.

    ProjectStage روی (پروژه، نام) یکتاست و بعضی پروژه‌ها چند خشک‌کن دارند، پس آنجا
    متراژها جمع می‌شوند تا جمع کلِ پروژه عوض نشود.
    """
    ProjectStage = apps.get_model("core", "ProjectStage")
    _retext(apps, {s: target for s in sources}, stages=False)

    keep_of = {}
    for stage in (ProjectStage.objects.filter(name__in=list(sources) + [target])
                  .order_by("project_id", "order", "id")):
        keep = keep_of.get(stage.project_id)
        if keep is None:
            keep_of[stage.project_id] = stage
            continue
        keep.area = (keep.area or 0) + (stage.area or 0)
        keep.done = keep.done and stage.done
        keep.save(update_fields=["area", "done"])
        stage.delete()
    for stage in keep_of.values():
        if stage.name != target:
            stage.name = target
            stage.save(update_fields=["name"])


def forward(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")

    _retext(apps, RENAMES)
    for old, new in RENAMES.items():
        WorkStage.objects.filter(name=old).update(name=new)
    _merge_stage(apps, DRYERS, OTHER)
    WorkStage.objects.filter(name__in=DRYERS).delete()

    keep = [name for name, *_ in FINAL]
    for name, order, needs_area, weight in FINAL:
        WorkStage.objects.update_or_create(
            name=name,
            defaults={"order": order, "active": True, "needs_area": needs_area,
                      "default_coefficient": Decimal(1), "weight": Decimal(weight)})
    # هر مرحلهٔ دیگری که مانده و ردیفی ندارد، کنار می‌رود.
    ReportItem = apps.get_model("core", "ReportItem")
    for stage in WorkStage.objects.exclude(name__in=keep):
        if not ReportItem.objects.filter(activity=stage.name).exists():
            stage.delete()


def backward(apps, schema_editor):
    WorkStage = apps.get_model("core", "WorkStage")
    back = {v: k for k, v in RENAMES.items()}

    _retext(apps, back)
    for new, old in back.items():
        WorkStage.objects.filter(name=new).update(name=old)

    # ادغام خشک‌کن در «سایر» برگشت‌پذیر نیست: معلوم نیست کدام ردیفِ «سایر» پیش‌تر
    # خشک‌کن بوده. مرحله‌ها دوباره ساخته می‌شوند ولی ردیف‌ها در «سایر» می‌مانند.
    for order, name in enumerate(DRYERS, start=6):
        WorkStage.objects.update_or_create(
            name=name, defaults={"order": order, "active": True, "needs_area": True})
    for name in ("استر لایه دوم", "پرداخت قبل از رنگ", "بازدید و رفع ایراد جزئی",
                 "رنگ نهایی", "بسته‌بندی و ارسال"):
        stage = WorkStage.objects.filter(name=name).first()
        if stage and not ReportItem_has(apps, name):
            stage.delete()
    WorkStage.objects.filter(name="پرایمر MDF یا استر دست اول").update(
        default_coefficient=Decimal(2))
    WorkStage.objects.update(weight=Decimal(0))


def ReportItem_has(apps, activity):
    return apps.get_model("core", "ReportItem").objects.filter(activity=activity).exists()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0055_stage_weight"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
