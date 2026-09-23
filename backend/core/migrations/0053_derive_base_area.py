"""متراژ پایه و ضریبِ هر مرحله را از روی متراژهایی که تا حالا دستی وارد شده درمی‌آورد.

هیچ متراژی عوض نمی‌شود — فقط خوانده می‌شود. روی یک متر چوب چند دست کار انجام می‌شود،
پس کوچک‌ترین متراژِ یک پروژه تقریباً همان متراژ چوب است و بقیه ضریبی از آن‌اند. در
پروژه‌های دستی این الگو تمیز درمی‌آید (۱ / ۲ / ۲ / ۲ و مانند آن).

اگر جایی الگو تمیز نباشد، ضریبِ درآمده هم همان بی‌قاعدگی را نشان می‌دهد؛ این پنهان‌کردنی
نیست و باید دیده شود تا دستی اصلاحش کنند.
"""
from decimal import Decimal

from django.db import migrations


def derive(apps, schema_editor):
    Project = apps.get_model("core", "Project")
    for project in Project.objects.prefetch_related("stages"):
        stages = [s for s in project.stages.all() if s.area and s.area > 0]
        if not stages:
            continue
        base = min(s.area for s in stages)
        if base <= 0:
            continue
        project.base_area = base
        project.save(update_fields=["base_area"])
        for stage in project.stages.all():
            stage.coefficient = ((stage.area / base).quantize(Decimal("0.01"))
                                 if stage.area and stage.area > 0 else Decimal(1))
            stage.save(update_fields=["coefficient"])


def undo(apps, schema_editor):
    Project = apps.get_model("core", "Project")
    ProjectStage = apps.get_model("core", "ProjectStage")
    Project.objects.update(base_area=None)
    ProjectStage.objects.update(coefficient=Decimal(1))


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0052_base_area"),
    ]

    operations = [
        migrations.RunPython(derive, undo),
    ]
