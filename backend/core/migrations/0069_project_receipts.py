import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

KEY = "financereports.costs"


def grant(apps, schema_editor):
    """اصلاح نرخ و قیمت و ثبت دریافتی، برای کسانی که «به‌روزرسانی قیمت از سایت» را دارند."""
    User = apps.get_model("core", "User")
    for u in User.objects.all():
        access = list(u.access or [])
        if "financereports.refresh" in access and KEY not in access:
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
        ('core', '0068_voucher_amendments'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectReceipt',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField()),
                ('amount', models.DecimalField(decimal_places=0, max_digits=16)),
                ('note', models.CharField(blank=True, max_length=300)),
                ('recorded_by_name', models.CharField(blank=True, max_length=150)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='receipts', to='core.project')),
                ('recorded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='project_receipts', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-date', '-id'],
            },
        ),
        migrations.RunPython(grant, revoke),
    ]
