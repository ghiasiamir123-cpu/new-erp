from django.db import migrations

# فاکتور فروش و تسهیم حقوق از «گزارش‌های مالی»، و خروجیِ گزارش راننده از داشبورد، به سربرگِ «دستیار حسابداری» رفتند.
MOVES = {
    "financereports.invoice": "accounting.invoice",
    "financereports.salary": "accounting.salary",
    "dashboard.w.driver": "accounting.driver",
}
TAB = "accounting"
CASH = "accounting.cash"


def forward(apps, schema_editor):
    """هر کس یکی از این سه را داشت، همان را در سربرگِ تازه دارد؛ کسی که هیچ‌کدام را نداشت چیزی نمی‌گیرد.

    دیدنِ تنخواهِ همه، شارژ و تأیید (accounting.cash) فقط به نقشِ مدیر داده می‌شود؛ برای بقیه مسئولِ کاربران تیک می‌زند."""
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        moved = [new for old, new in MOVES.items() if old in access]
        if not moved:
            continue
        kept = [k for k in access if k not in MOVES]
        extra = [TAB] + ([CASH] if u.role == "manager" else []) + moved
        u.access = kept + [k for k in extra if k not in kept]
        u.save(update_fields=["access"])


def backward(apps, schema_editor):
    """کلیدهای قبلی برمی‌گردند (اگر سربرگِ خودشان هنوز هست) و سربرگِ تازه برداشته می‌شود."""
    User = apps.get_model("core", "User")
    back = {new: old for old, new in MOVES.items()}
    for u in User.objects.all():
        access = list(u.access or [])
        if not any(k == TAB or k.startswith(TAB + ".") for k in access):
            continue
        kept = [k for k in access if k != TAB and not k.startswith(TAB + ".")]
        restored = [back[k] for k in access if k in back and back[k].split(".")[0] in kept]
        u.access = kept + [k for k in restored if k not in kept]
        u.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0092_petty_cash'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
