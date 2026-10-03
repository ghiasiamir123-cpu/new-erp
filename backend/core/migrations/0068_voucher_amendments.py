import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

KEY = "warehouse.amend"


def grant(apps, schema_editor):
    """ویرایش حوالهٔ ثبت‌شده فقط کار مدیر است: به مدیرهایی داده می‌شود که انبار را دارند.

    مثل «ثبت نهایی» با خودِ سربرگ انبار به همه داده نمی‌شود؛ مسئول کاربران هر وقت خواست به کس دیگری می‌دهد.
    """
    User = apps.get_model("core", "User")
    for u in User.objects.filter(role="manager"):
        access = list(u.access or [])
        if "warehouse" in access and KEY not in access:
            u.access = access + [KEY]
            u.save(update_fields=["access"])


def revoke(apps, schema_editor):
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        if KEY in access:
            u.access = [k for k in access if k != KEY]
            u.save(update_fields=["access"])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0067_profit_widget_access'),
    ]

    operations = [
        migrations.CreateModel(
            name='StockVoucherAmendment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('by_name', models.CharField(max_length=150)),
                ('at', models.DateTimeField(auto_now_add=True)),
                ('reason', models.CharField(max_length=500)),
                ('changes', models.JSONField(default=list)),
                ('before', models.JSONField(default=dict)),
                ('by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='voucher_amendments', to=settings.AUTH_USER_MODEL)),
                ('voucher', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='amendments', to='core.stockvoucher')),
            ],
            options={
                'ordering': ['at', 'id'],
            },
        ),
        migrations.RunPython(grant, revoke),
    ]
