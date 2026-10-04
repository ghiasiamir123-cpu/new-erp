"""کارِ هر صبحِ برنامه‌ریزی تولید: ثبتِ خودکارِ مبنای هفته، برنامهٔ امروز، و صفِ ایستگاه‌ها.

زمان‌بندِ سرور (cron) هر روز پیش از شروعِ کارگاه اجرایش می‌کند. جزئیات در planning.daily است.
"""
from django.core.management.base import BaseCommand

from core import planning


class Command(BaseCommand):
    help = "برنامهٔ امروز را نگه می‌دارد، شنبه‌ها مبنای هفته را ثبت می‌کند، و صفِ ایستگاه‌ها را برمی‌دارد."

    def handle(self, *args, **options):
        self.stdout.write("plan_daily: " + ", ".join(planning.daily()))
