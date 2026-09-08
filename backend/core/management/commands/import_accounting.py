"""وارد کردن انبارگردانی حسابداری از پوشهٔ فایل‌های برند.

هر فایل یک برند است و شناسهٔ هر قلم «بارکد» است. برای هر قلم:

  • اگر بارکدش با کد یکی از کالاهای موجود (آمده از سایت) دقیقاً بخواند،
    بارکد روی همان کالا می‌نشیند — کالای تکراری ساخته نمی‌شود.
  • وگرنه کالای تازه‌ای با همان بارکد ساخته می‌شود.

موجودی به‌صورت «اختلاف» ثبت می‌شود (شمرده منهای موجودی فعلی)، پس وارد کردن
دوبارهٔ همان پوشه چیزی را دو برابر نمی‌کند.

    python manage.py import_accounting "…/24.4" --dry-run
    python manage.py import_accounting "…/24.4"
"""

import glob
import os
import re
from decimal import Decimal

import openpyxl
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from core.models import Product, Sku, StockItem, StockMovement, Warehouse

User = get_user_model()

# برند از نام فایل، وقتی ستون برند خالی است.
FILE_BRAND = {
    "bormawachs": "بورما واکس",
    "marmorino": "مارمورینو تولز",
    "pratta": "پراتا",
    "pentrillo": "Pentrilo",
    "pentrilo": "Pentrilo",
}

# پیشوندهایی که حسابداری جلوی کد می‌گذارد — برای تطبیق با کد سایت.
PREFIXES = ("MTART", "PPBO-", "PBO-", "BO-", "PEN", "DB", "MT")

UNIT_FA = {"CAN": "حلب", "PZ": "عدد", "TUBE": "تیوب", "PACK": "بسته",
           "ROLL": "رول", "CARTON": "کارتن", "KARTON": "کارتن", "KG": "کیلوگرم"}

DEFAULT_WAREHOUSE = "انبار دفتر"

# سربرگ چاپی هر ۳۸ سطر تکرار می‌شود و پاصفحهٔ امضا هم هست؛ این‌ها کالا نیستند.
JUNK = {"بارکد", "نام کالا", "کالا", "واحد سنجش", "واحد  سنجش", "ردیف",
        "محل امضاء امور مالی", "برند", "انبار", "شمارش"}


def norm(v):
    return "" if v is None else str(v).replace("\n", " ").strip()


def squash(x):
    return re.sub(r"[^A-Z0-9]", "", (x or "").upper())


def core(barcode):
    """بارکد بدون پیشوند برند."""
    up = squash(barcode)
    for p in PREFIXES:
        ps = squash(p)
        if up.startswith(ps) and len(up) > len(ps):
            return up[len(ps):]
    return up


def num(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v).replace(",", "").strip())
    except Exception:
        return None


class Command(BaseCommand):
    help = "وارد کردن اقلام و موجودی از فایل‌های انبارگردانی حسابداری"

    def add_arguments(self, parser):
        parser.add_argument("folder")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--user", default=None)

    def handle(self, *args, **opts):
        folder = opts["folder"]
        files = sorted(glob.glob(os.path.join(folder, "*.xlsx")))
        if not files:
            raise CommandError(f"فایلی در «{folder}» نیست.")

        actor = (User.objects.filter(username=opts["user"]).first() if opts["user"]
                 else User.objects.filter(role="manager").order_by("id").first())
        if actor is None:
            raise CommandError("کاربری برای ثبت گردش پیدا نشد.")

        rows = []
        for f in files:
            rows.extend(self._read_file(f))
        self.stdout.write(f"ردیف خوانده‌شده: {len(rows)} از {len(files)} فایل")

        # یک بارکد در چند برگه می‌آید و هر برگه بخشی از حقیقت را دارد:
        # «فرم» عدد شمارش دارد ولی ستون انبار ندارد، «فایل اصلی» انبار دارد.
        # پس برای هر بارکد بهترین عدد و بهترین انبار جداگانه برداشته می‌شود.
        items = {}
        for r in rows:
            cur = items.get(r["barcode"])
            if cur is None:
                items[r["barcode"]] = dict(r)
                continue
            # عدد: شمارش بر مقدار و مقدار بر موجودی سیستم ارجح است.
            if r["qty"] is not None and (
                cur["qty"] is None or r["qty_rank"] > cur["qty_rank"]
            ):
                cur["qty"] = r["qty"]
                cur["qty_rank"] = r["qty_rank"]
            if not cur["warehouse"] and r["warehouse"]:
                cur["warehouse"] = r["warehouse"]
            for k in ("name", "brand", "category", "unit"):
                if not cur[k] and r[k]:
                    cur[k] = r[k]

        self.stdout.write(f"بارکد یکتا: {len(items)}")

        # کد کالاهای موجود، برای چسباندن بارکد به‌جای ساختن کالای تکراری.
        existing = {}
        for s in Sku.objects.select_related("product"):
            c = squash(s.product.code)
            if c:
                existing.setdefault(c, s)

        stats = dict(linked=0, created=0, warehouses=0, counted=0,
                     adjusted=0, skipped=0, no_qty=0)
        today = timezone.localdate()

        with transaction.atomic():
            for bc, r in items.items():
                wh_name = r["warehouse"] or DEFAULT_WAREHOUSE
                warehouse, made = Warehouse.objects.get_or_create(name=wh_name)
                if made:
                    stats["warehouses"] += 1

                sku = existing.get(core(bc)) or existing.get(squash(bc))
                if sku is not None:
                    # بارکد را روی کالای موجود می‌نشانیم.
                    if sku.barcode != bc:
                        sku.barcode = bc
                        sku.save(update_fields=["barcode"])
                    stats["linked"] += 1
                else:
                    sku = self._make_sku(r, bc)
                    stats["created"] += 1

                StockItem.objects.get_or_create(sku=sku, warehouse=warehouse)

                if r["qty"] is None:
                    stats["no_qty"] += 1
                    continue
                stats["counted"] += 1
                on_hand = (StockMovement.objects
                           .filter(sku=sku, warehouse=warehouse)
                           .aggregate(s=Sum("qty"))["s"] or Decimal(0))
                delta = r["qty"] - on_hand
                if delta == 0:
                    continue
                stats["adjusted"] += 1
                if not opts["dry_run"]:
                    StockMovement.objects.create(
                        sku=sku, warehouse=warehouse,
                        kind=StockMovement.Kind.COUNT, qty=delta,
                        date=today, ref="انبارگردانی حسابداری",
                        note=f"شمارش {r['qty']} — موجودی پیشین {on_hand}",
                        created_by=actor,
                        created_by_name=actor.name or actor.username,
                    )
                    StockItem.objects.filter(sku=sku, warehouse=warehouse).update(counted_at=today)

            if opts["dry_run"]:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING("\n« اجرای آزمایشی — چیزی ذخیره نشد »"))

        self.stdout.write("")
        for k, label in (
            ("linked", "بارکد روی کالای موجود نشست"),
            ("created", "کالای تازه ساخته شد"),
            ("warehouses", "انبار تازه"),
            ("counted", "ردیف دارای عدد"),
            ("adjusted", "موجودی تنظیم شد"),
            ("no_qty", "بدون عدد"),
            ("skipped", "نادیده گرفته شد"),
        ):
            self.stdout.write(f"  {label}: {stats[k]}")

    # ---------- خواندن یک فایل ----------
    def _read_file(self, path):
        base = os.path.basename(path).lower()
        brand = next((v for k, v in FILE_BRAND.items() if k in base), "")
        wb = openpyxl.load_workbook(path, data_only=True)
        out = []
        for ws in wb.worksheets:
            hr, header = self._header(ws)
            if hr is None:
                continue
            for row in ws.iter_rows(min_row=hr + 1, values_only=True):
                d = dict(zip(header, [norm(c) for c in row]))
                bc = self._get(d, "بارکد")
                if not bc or bc in JUNK:
                    continue
                name = self._get(d, "نام کالا", "کالا")
                unit = self._get(d, "واحد")
                if name in JUNK or unit in JUNK:
                    continue
                # «شمارش» ملاک است چون کاربر گفت دقیق‌ترین عدد همان است؛
                # بعد «مقدار» و در آخر «موجودی سیستم».
                qty, qty_rank = num(self._get(d, "شمارش")), 3
                if qty is None:
                    qty, qty_rank = num(self._get(d, "مقدار")), 2
                if qty is None:
                    qty, qty_rank = num(self._get(d, "موجودی")), 1
                out.append({
                    "barcode": bc,
                    "name": name,
                    "brand": self._get(d, "برند") or brand,
                    "category": self._get(d, "نوع کالا"),
                    "unit": unit,
                    "warehouse": self._get(d, "انبار"),
                    "qty": qty,
                    "qty_rank": qty_rank if qty is not None else 0,
                })
        return out

    def _header(self, ws):
        for r in (1, 2):
            vals = [norm(c.value) for c in ws[r]]
            if any("بارکد" in v for v in vals):
                return r, vals
        return None, []

    def _get(self, d, *names):
        for n in names:
            for k, v in d.items():
                if k and n in k.replace("\n", " "):
                    return v
        return ""

    def _make_sku(self, r, bc):
        product, _ = Product.objects.get_or_create(
            code=bc, name=r["name"] or bc, brand=r["brand"],
            defaults={"category": r["category"], "sellable": False},
        )
        unit = UNIT_FA.get(squash(r["unit"]), r["unit"] or "عدد")
        return Sku.objects.create(
            product=product,
            # پیشوند تا با شناسه‌های عددی سایت قاطی نشود.
            site_package_id=f"ACC-{bc}"[:40],
            barcode=bc,
            pack_size=r["unit"] or "",
            base_unit=unit,
        )
