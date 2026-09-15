"""بستهٔ دیگرِ سایت (عدد/جعبه، حلب/لیتر) برای کالاهایی که یک بسته‌شان وصل است.

    python manage.py link_unit_packs --siblings --dry-run
    python manage.py link_unit_packs --siblings

قاعده در core/linking.py (plan_unit_siblings): بسته‌های «عدد» و «جعبه»ی یک جنس در سایت؛ اگر فقط
یک کالای انبار زیر یکی از آن‌هاست، بقیه بستهٔ دیگرِ همان کالا می‌شوند و نسبتشان از واحدهای کالا
خوانده می‌شود (جعبهٔ ۲۰ عددی ← ۲۰ عدد). هر چه نسبتش قطعی نیست گزارش می‌شود و وصل نمی‌شود.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.linking import LinkError, link_unit_pack, plan_unit_siblings


class Command(BaseCommand):
    help = "بستهٔ عدد/جعبهٔ سایت را بستهٔ دیگرِ همان کالای انبار می‌کند"

    def add_arguments(self, parser):
        parser.add_argument("--siblings", action="store_true", help="بسته‌های هم‌جنسِ بسته‌ای که وصل است")
        parser.add_argument("--dry-run", action="store_true", help="انجام و برگرداندن")

    def handle(self, *args, **opts):
        if not opts["siblings"]:
            raise CommandError("--siblings را بدهید.")
        plan, doubt = plan_unit_siblings()
        done, problems = 0, []
        with transaction.atomic():
            for pack, wh, factor in plan:
                try:
                    with transaction.atomic():
                        created, factor = link_unit_pack(pack, wh, factor)
                except LinkError as exc:
                    problems.append((pack, str(exc)))
                    continue
                done += created
                self.stdout.write(f"  ✓ {pack.shop_pack_id:>6} {pack.site_name[:40]:<40} {pack.grit or pack.shade:<8} "
                                  f"{pack.pack_size:<14} = {factor.normalize():f} {wh.base_unit}  ← {wh.barcode}")
            if opts["dry_run"]:
                transaction.set_rollback(True)
        self.stdout.write(f"\nوصل شد: {done} | ایراد: {len(problems)} | مشکوک: {len(doubt)}")
        for pack, why in problems + doubt:
            self.stdout.write(self.style.WARNING(f"  ? {pack.shop_pack_id} {pack.site_name[:40]} {pack.pack_size}: {why}"))
        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))
