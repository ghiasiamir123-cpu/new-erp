"""کارتابل مالی: قیمت‌گذاری و مغایرت‌گیری حواله‌ها با فاکتور طرف حساب.

حواله‌های خرید، مرجوعی و فروشی که پیش از این ثبت نهایی شده‌اند مستقیم به
کارتابل می‌روند؛ هیچ‌کدامشان هنوز قیمت ندارد.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

FINANCE_KINDS = ("receipt", "return", "sale")


def queue_posted(apps, schema_editor):
    StockVoucher = apps.get_model("core", "StockVoucher")
    (StockVoucher.objects
     .filter(status="posted", movement_kind__in=FINANCE_KINDS)
     .update(finance_status="pending"))


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0027_sku_needs_review"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="can_review_finance",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="finance_status",
            field=models.CharField(
                choices=[("none", "بی‌نیاز"), ("pending", "در کارتابل مالی"),
                         ("returned", "برگشت به انبار"), ("approved", "تأیید مالی")],
                db_index=True, default="none", max_length=20),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="invoice_no",
            field=models.CharField(blank=True, max_length=60),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="invoice_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="invoice_total",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=18, null=True),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="invoice_discount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=18),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="invoice_tax",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=18),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="finance_note",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="warehouse_reply",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="finance_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="finance_reviewed_vouchers", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="finance_by_name",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="stockvoucher",
            name="finance_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="stockvoucherline",
            name="invoice_qty",
            field=models.DecimalField(blank=True, decimal_places=3, max_digits=14, null=True),
        ),
        migrations.AddField(
            model_name="stockvoucherline",
            name="unit_price",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=16),
        ),
        migrations.RunPython(queue_posted, migrations.RunPython.noop),
    ]
