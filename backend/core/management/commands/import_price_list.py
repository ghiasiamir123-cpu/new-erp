"""لیست قیمت تأمین‌کننده را روی قیمت تمام‌شدهٔ کالاها می‌نشاند (core/price_lists.py).

    python manage.py import_price_list list.json            # تمرین: در پایان برگردانده می‌شود
    python manage.py import_price_list list.json --apply    # ثبت واقعی

فایل: [{"name": "FC---M021/------41", "price": 558565563}, …] — نام یا کد همان است که در
«نام در لیست قیمت» کالا نوشته شده.
"""

import json

from django.core.management.base import BaseCommand
from django.db import transaction

from core import price_lists


class Rehearsal(Exception):
    pass


class Command(BaseCommand):
    help = "قیمت تمام‌شدهٔ کالاها را از لیست قیمت تأمین‌کننده به‌روز می‌کند."

    def add_arguments(self, parser):
        parser.add_argument("file")
        parser.add_argument("--apply", action="store_true", help="بدون این، فقط تمرین است و چیزی ذخیره نمی‌شود.")

    def handle(self, *args, **opts):
        with open(opts["file"], encoding="utf-8") as f:
            rows = [(r["name"], r["price"]) for r in json.load(f)]
        out = self.stdout.write
        try:
            with transaction.atomic():
                res = price_lists.apply(rows)
                for c in res["changed"]:
                    out(f"  {c['id']} | {c['name']} | {c['old']:,.0f} ← {c['new']:,.0f}")
                out(f"ردیف لیست: {len(rows)} | قیمت عوض شد: {len(res['changed'])} | بی‌تغییر: {res['same']} | "
                    f"ردیفِ بی‌کالا: {len(res['unmatched'])} | ردیف دوقیمته: {len(res['clash'])}")
                for name in res["clash"]:
                    out(f"  دو قیمت در لیست: {name}")
                if not opts["apply"]:
                    raise Rehearsal()
            out("ثبت شد.")
        except Rehearsal:
            out("تمرین بود؛ چیزی ذخیره نشد.")
