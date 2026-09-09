"""کم کردن فروش‌های بستهٔ CRM از موجودی انبار.

فایل خروجی «محصولات در پیش فاکتور» را می‌گیرد و برای هر ردیفِ «با موفقیت
بسته شده» یک گردشِ فروش (منفی) ثبت می‌کند، با تاریخ خودِ فروش.

کد محصولِ CRM با بارکد، کد محصول یا شناسهٔ بستهٔ انبار تطبیق داده می‌شود.
کدی که در انبار نباشد کنار گذاشته و گزارش می‌شود — کالای نداشته را
نمی‌سازیم، چون آن‌وقت فهرست کالا با چیزی پر می‌شود که هرگز شمرده نشده.

هر ردیف با شمارهٔ پیش‌فاکتورش نشان‌دار می‌شود، پس وارد کردن دوبارهٔ همان
فایل چیزی را دو بار کم نمی‌کند.

    python manage.py import_sales فروش.csv --dry-run
    python manage.py import_sales فروش.csv
"""

import csv
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum

from core.jalali import parse_jalali
from core.models import Sku, StockItem, StockMovement, Warehouse

User = get_user_model()

TAG = re.compile(r"<[^>]+>")
WON = "با موفقیت بسته شده"
REF_PREFIX = "فروش CRM"


def clean(v):
    return TAG.sub("", (v or "")).strip()


def num(v):
    try:
        return Decimal(str(v).replace(",", "").strip())
    except (InvalidOperation, TypeError, ValueError):
        return None


def squash(x):
    return re.sub(r"[^A-Z0-9]", "", (x or "").upper())


class Command(BaseCommand):
    help = "کم کردن فروش‌های بسته‌شدهٔ CRM از موجودی"

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--user", default=None)
        parser.add_argument("--warehouse", default=None,
                            help="پیش‌فرض: تنها انبار موجود")

    def handle(self, *args, **opts):
        actor = (User.objects.filter(username=opts["user"]).first() if opts["user"]
                 else User.objects.filter(role="manager").order_by("id").first())
        if actor is None:
            raise CommandError("کاربری برای ثبت گردش پیدا نشد.")

        if opts["warehouse"]:
            warehouse = Warehouse.objects.filter(name=opts["warehouse"]).first()
        else:
            warehouse = Warehouse.objects.order_by("id").first()
        if warehouse is None:
            raise CommandError("انباری تعریف نشده است.")

        rows = self._read(opts["path"])
        self.stdout.write(f"ردیف فروشِ بسته‌شده: {len(rows)}")
        if not rows:
            raise CommandError("هیچ ردیف فروشی در فایل نبود.")

        dates = sorted(r["date"] for r in rows if r["date"])
        self.stdout.write(f"بازه: {dates[0]} تا {dates[-1]}  |  انبار: {warehouse.name}")

        index = self._index()
        stats = defaultdict(int)
        applied, skipped, dupes = [], [], []

        with transaction.atomic():
            for r in rows:
                sku = self._match(r, index)
                if sku is None:
                    skipped.append(r)
                    stats["بدون تطبیق"] += 1
                    continue

                ref = f"{REF_PREFIX} {r['quote']}"
                if StockMovement.objects.filter(sku=sku, warehouse=warehouse,
                                                ref=ref).exists():
                    dupes.append(r)
                    stats["قبلاً ثبت شده"] += 1
                    continue

                stats["ثبت شد"] += 1
                applied.append((r, sku))
                if opts["dry_run"]:
                    continue

                StockItem.objects.get_or_create(sku=sku, warehouse=warehouse)
                StockMovement.objects.create(
                    sku=sku, warehouse=warehouse,
                    kind=StockMovement.Kind.SALE,
                    qty=-r["qty"], entered_qty=r["qty"],
                    entered_unit=sku.base_unit or r["unit"],
                    date=r["date"], ref=ref,
                    note=f"{r['customer']} — پیش‌فاکتور {r['quote']}",
                    created_by=actor,
                    created_by_name=actor.name or actor.username,
                )

            if opts["dry_run"]:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING(
                    "\n« اجرای آزمایشی — چیزی ذخیره نشد »"))

        self.stdout.write("")
        for k in ("ثبت شد", "قبلاً ثبت شده", "بدون تطبیق"):
            self.stdout.write(f"  {k}: {stats[k]}")

        if applied:
            self.stdout.write("\n=== اثر روی موجودی ===")
            on_hand = {m["sku"]: m["s"] for m in StockMovement.objects
                       .filter(warehouse=warehouse).values("sku").annotate(s=Sum("qty"))}
            per_sku = defaultdict(Decimal)
            for r, sku in applied:
                per_sku[sku] += r["qty"]
            for sku, qty in sorted(per_sku.items(), key=lambda x: x[0].product.name):
                now = on_hand.get(sku.id, Decimal(0))
                before = now + qty if not opts["dry_run"] else now
                after = before - qty
                warn = "  ⚠ منفی" if after < 0 else ""
                self.stdout.write(
                    f"  {(sku.barcode or sku.site_package_id):<20} "
                    f"{before:>7} − {qty:>6} = {after:>7}{warn}   "
                    f"{sku.product.name[:40]}")

        if skipped:
            self.stdout.write(self.style.WARNING(
                f"\n=== {len(skipped)} ردیف در انبار نبود ==="))
            seen = set()
            for r in skipped:
                if r["code"] in seen:
                    continue
                seen.add(r["code"])
                self.stdout.write(f"  {r['code']:<22}{r['qty']:>8}  {r['name'][:52]}")

    # ---------- خواندن فایل ----------
    def _read(self, path):
        out = []
        with open(path, encoding="utf-8-sig") as fh:
            for parts in csv.reader(fh):
                if len(parts) < 16 or "AOS_Quotes" not in (parts[0] or ""):
                    continue
                if clean(parts[5]) != WON:
                    continue
                qty, date = num(parts[8]), parse_jalali(clean(parts[15]))
                if not qty or qty <= 0 or date is None:
                    continue
                out.append({
                    "quote": clean(parts[0]), "customer": clean(parts[3]),
                    "code": clean(parts[6]), "name": clean(parts[7]),
                    "qty": qty, "unit": clean(parts[9]), "date": date,
                })
        return out

    # ---------- تطبیق کد ----------
    def _index(self):
        index = defaultdict(dict)
        for s in Sku.objects.select_related("product"):
            for key in (s.barcode, s.product.code, s.site_package_id, s.warehouse_code):
                k = squash(key)
                if k:
                    index[k][s.id] = s
        return index

    def _match(self, row, index):
        cands = list(index.get(squash(row["code"]), {}).values())
        if len(cands) == 1:
            return cands[0]
        if not cands:
            return None
        # چند بسته زیر یک کد: حجمِ داخل نام فروش تکلیف را روشن می‌کند.
        m = re.search(r"([\d.]+\s*(?:ML|L|KG|G)\b)", row["name"], re.I)
        if m:
            want = squash(m.group(1))
            sized = [s for s in cands if squash(s.pack_size) == want]
            if len(sized) == 1:
                return sized[0]
        return None
