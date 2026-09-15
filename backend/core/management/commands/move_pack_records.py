"""موجودی و حواله‌ای که روی خودِ بستهٔ سایت مانده به کالای انبارِ زیرمجموعه‌اش منتقل می‌شود.

حواله‌های هوگون پیش از اتصال روی ردیف سایت («میکروسمنت خمیری هوگون ۲۰ کیلوگرم دانه متوسط») زده
شده بودند؛ پس از اتصال، کالای انبارِ زیرمجموعه صفر نشان می‌داد. بسته‌ای که چند زیرمجموعه دارد یا
هر دو طرفش موجودی دارند منتقل نمی‌شود و فهرست می‌شود تا دستی بررسی شود.

    python manage.py move_pack_records --dry-run
    python manage.py move_pack_records
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.linking import LinkError, has_own_records, move_pack_records
from core.models import Sku


class _Rollback(Exception):
    pass


class Command(BaseCommand):
    help = "موجودی و حوالهٔ بستهٔ سایت را به تنها کالای انبارِ زیرمجموعه‌اش منتقل می‌کند."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="فقط نشان بده، ذخیره نکن")

    def handle(self, *args, **opts):
        packs = [p for p in Sku.objects.filter(site_variants__isnull=False).distinct().order_by("pk")
                 if has_own_records(p)]
        moved, skipped = [], []
        try:
            with transaction.atomic():
                for p in packs:
                    try:
                        with transaction.atomic():
                            kid, counts = move_pack_records(p)
                        moved.append((p, kid, counts))
                    except LinkError as exc:
                        skipped.append((p, str(exc)))
                if opts["dry_run"]:
                    raise _Rollback
        except _Rollback:
            pass

        for p, kid, counts in moved:
            nonzero = {k: v for k, v in counts.items() if v}
            self.stdout.write(f"OK  {p.pk} {p.display_name} {p.pack_size} {p.shade} -> {kid.pk} {kid.display_name}  {nonzero}")
        for p, reason in skipped:
            self.stdout.write(f"--  {p.pk} {p.display_name} {p.pack_size}: {reason}")
        self.stdout.write(f"\n{'(آزمایشی — چیزی ذخیره نشد) ' if opts['dry_run'] else ''}"
                          f"منتقل شد: {len(moved)} · دستی: {len(skipped)}")
