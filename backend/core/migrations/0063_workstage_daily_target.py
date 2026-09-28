from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0062_employee_hourly_cost'),
    ]

    operations = [
        migrations.AddField(
            model_name='workstage',
            name='daily_target',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=8),
        ),
    ]
