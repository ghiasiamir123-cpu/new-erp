from django.db import migrations

# سربرگِ «حقوق و دستمزد» درونِ «دستیار حسابداری» رفت: کلیدِ سربرگ (payroll) کلیدِ یک بخش از آن شد.
OLD = "payroll"
TAB = "accounting"
NEW = "accounting.payroll"


def forward(apps, schema_editor):
    """هر کس «حقوق و دستمزد» را داشت، همان را درونِ «دستیار حسابداری» دارد؛ بقیه چیزی نمی‌گیرند."""
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        if OLD not in access:
            continue
        kept = [k for k in access if k != OLD]
        u.access = kept + [k for k in (TAB, NEW) if k not in kept]
        u.save(update_fields=["access"])


def backward(apps, schema_editor):
    """کلیدِ قبلی برمی‌گردد. خودِ «دستیار حسابداری» می‌ماند (تنخواهِ او همان‌جاست)."""
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        if NEW not in access:
            continue
        kept = [k for k in access if k != NEW]
        u.access = kept + ([OLD] if OLD not in kept else [])
        u.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0093_accounting_access'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
