"""وارد کردن انبارگردانی حسابداری از پوشهٔ فایل‌های برند.

هر فایل یک برند است و شناسهٔ هر قلم «بارکد».

انبارِ هر سطر:
    ستون «انبار» اگر پر باشد، وگرنه انباری که در عنوان بالای برگه آمده
    («انبارگردانی … - انبار فروشگاه سیتی‌سنتر»).

عدد هر سطر:
    ستون «شمارش». خانهٔ خالی یعنی «شمرده نشده»، نه صفر — در این فرم‌ها
    شمارشگر هیچ‌جا صفر ننوشته، فقط جایی که چیزی بوده عدد گذاشته. پس برای
    سطر خالی نه گردشی ثبت می‌شود نه «تاریخ شمارش» می‌خورد، و آن قلم در
    سامانه «شمارش‌نشده» می‌ماند نه «صفر».

    اگر هیچ برگه‌ای از یک فایل ستون شمارش نداشته باشد (یعنی آن برند اصلاً
    شمرده نشده) «موجودی سیستم» ملاک می‌شود؛ آنجا صفرِ نوشته‌شده صفرِ واقعی
    است. برگه‌های بی‌شمارشِ فایل‌های شمرده‌شده کنار گذاشته می‌شوند.

یک بارکد می‌تواند در چند انبار موجودی داشته باشد؛ کلید (بارکد، انبار) است.

موجودی به‌صورت «اختلاف» ثبت می‌شود (شمرده منهای موجودی فعلی)، پس وارد کردن
دوبارهٔ همان پوشه چیزی را دو برابر نمی‌کند.

    python manage.py import_accounting "D:/New folder" --dry-run
    python manage.py import_accounting "D:/New folder"
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

PERSIAN = re.compile(r"[\u0600-\u06FF]")
DATE_FA = re.compile(r"\d{4}/\d{1,2}/\d{1,2}")


def norm(v):
    return "" if v is None else str(v).replace("\n", " ").strip()


def clean_wh(name):
    """نیم‌فاصله و فاصله‌های تکراری را یکدست می‌کند تا «سیتی‌سنتر» و
    «سیتی سنتر» یک انبار شمرده شوند."""
    return re.sub(r"\s+", " ", (name or "").replace("\u200c", " ")).strip()


def is_barcode(v, brand_title=""):
    """سربرگ چاپی هر ۳۸ سطر تکرار می‌شود: در ستون بارکد یا واژهٔ فارسی
    می‌نشیند یا نام برند. بارکد واقعی هیچ‌کدام نیست."""
    if not v or PERSIAN.search(v):
        return False
    return squash(v) != squash(brand_title)


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


SIZE = re.compile(r"([\d.]+)\s*(ML|LT|L|KG|GR|G|CM|MM|M)\b", re.I)


def size_of(text):
    """حجم/اندازه از داخل نام یا بسته‌بندی — «0.75L»، «4Kg»، «22cm»."""
    m = SIZE.search(text or "")
    if not m:
        return ""
    n, u = m.group(1), m.group(2).upper()
    u = {"LT": "L", "GR": "G"}.get(u, u)
    try:
        n = f"{float(n):g}"
    except ValueError:
        pass
    return f"{n}{u}"


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
        parser.add_argument("--warehouse", default=None,
                            help="همه را در همین یک انبار بگذار و ستون انبار "
                                 "فایل‌ها را نادیده بگیر")

    def handle(self, *args, **opts):
        folder = opts["folder"]
        # «~$…» فایل قفلِ اکسل است، نه داده.
        files = sorted(f for f in glob.glob(os.path.join(folder, "*.xlsx"))
                       if not os.path.basename(f).startswith("~$"))
        if not files:
            raise CommandError(f"فایلی در «{folder}» نیست.")

        actor = (User.objects.filter(username=opts["user"]).first() if opts["user"]
                 else User.objects.filter(role="manager").order_by("id").first())
        if actor is None:
            raise CommandError("کاربری برای ثبت گردش پیدا نشد.")

        # یک انبار مرکزی: ستون انبارِ فایل‌ها فقط می‌گوید کالا کجا شمرده
        # شده، نه اینکه انبار جدایی وجود دارد.
        self.only_wh = clean_wh(opts["warehouse"]) or None

        rows, self.warnings = [], []
        for f in files:
            got = self._read_file(f)
            rows.extend(got)
            self.stdout.write(f"  {os.path.basename(f)}: {len(got)} سطر")
        self.stdout.write(f"مجموع سطر: {len(rows)} از {len(files)} فایل")

        # کلید (بارکد، انبار) — یک قلم می‌تواند در چند انبار باشد.
        cells = {}
        for r in rows:
            key = (r["barcode"], r["warehouse"])
            cur = cells.get(key)
            if cur is None:
                cells[key] = dict(r)
                continue
            if cur["qty"] is None:
                cur["qty"] = r["qty"]
            elif r["qty"] is not None:
                cur["qty"] += r["qty"]
            for k in ("name", "brand", "category", "unit", "shelf"):
                if not cur[k] and r[k]:
                    cur[k] = r[k]

        barcodes = {k[0] for k in cells}
        self.stdout.write(f"بارکد یکتا: {len(barcodes)} | خانهٔ (بارکد×انبار): {len(cells)}")

        # چسباندن بارکد به کالای موجود به‌جای ساختن کالای تکراری. ترتیب
        # جست‌وجو ثابت است تا اجرای دوباره چیزی را جابه‌جا نکند.
        by_barcode, by_acc, site = {}, {}, {}
        for s in Sku.objects.select_related("product"):
            if s.barcode:
                by_barcode.setdefault(s.barcode, s)
            if s.site_package_id.startswith("ACC-"):
                by_acc[s.site_package_id] = s
            elif squash(s.product.code):
                site.setdefault(squash(s.product.code), []).append(s)
        claimed = set()

        sku_of = {}
        stats = dict(linked=0, created=0, warehouses=0, counted=0,
                     adjusted=0, no_qty=0, ambiguous=0)
        today = timezone.localdate()

        with transaction.atomic():
            for bc in sorted(barcodes):
                sample = next(v for k, v in cells.items() if k[0] == bc)
                sku = by_barcode.get(bc) or by_acc.get(f"ACC-{bc}"[:40])
                if sku is None:
                    sku, why = self._claim(bc, sample, site, claimed)
                    if why == "ambiguous":
                        stats["ambiguous"] += 1
                    if sku is not None:
                        claimed.add(sku.pk)
                        sku.barcode = bc
                        sku.save(update_fields=["barcode"])
                        stats["linked"] += 1
                    else:
                        sku = self._make_sku(sample, bc)
                        stats["created"] += 1
                sku_of[bc] = sku

            for (bc, wh_name), r in cells.items():
                warehouse, made = Warehouse.objects.get_or_create(
                    name=wh_name,
                    # تنها انبار، همان انباری است که کارگاه از آن برمی‌دارد.
                    defaults={"supplies_workshop": bool(self.only_wh)},
                )
                if made:
                    stats["warehouses"] += 1
                sku = sku_of[bc]

                item, _ = StockItem.objects.get_or_create(sku=sku, warehouse=warehouse)
                if r["shelf"] and item.shelf_code != r["shelf"]:
                    item.shelf_code = r["shelf"]
                    item.save(update_fields=["shelf_code"])

                if r["qty"] is None:
                    stats["no_qty"] += 1
                    continue
                stats["counted"] += 1
                on_hand = (StockMovement.objects
                           .filter(sku=sku, warehouse=warehouse)
                           .aggregate(s=Sum("qty"))["s"] or Decimal(0))
                delta = r["qty"] - on_hand
                if delta:
                    stats["adjusted"] += 1
                    if not opts["dry_run"]:
                        StockMovement.objects.create(
                            sku=sku, warehouse=warehouse,
                            kind=StockMovement.Kind.COUNT, qty=delta,
                            date=today, ref="انبارگردانی حسابداری",
                            note=f"{r['source']} {r['qty']} — موجودی پیشین {on_hand}",
                            created_by=actor,
                            created_by_name=actor.name or actor.username,
                        )
                if not opts["dry_run"]:
                    StockItem.objects.filter(pk=item.pk).update(counted_at=today)

            if opts["dry_run"]:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING("\n« اجرای آزمایشی — چیزی ذخیره نشد »"))

        self.stdout.write("")
        for k, label in (
            ("linked", "بارکد روی کالای موجود نشست"),
            ("created", "کالای تازه ساخته شد"),
            ("warehouses", "انبار تازه"),
            ("counted", "خانهٔ دارای عدد"),
            ("adjusted", "موجودی تنظیم شد"),
            ("no_qty", "بدون عدد"),
            ("ambiguous", "کد مشترک، حجم نامشخص — جدا ماند"),
        ):
            self.stdout.write(f"  {label}: {stats[k]}")

        for w in self.warnings:
            self.stdout.write(self.style.WARNING(f"  ! {w}"))

    # ---------- خواندن یک فایل ----------
    def _read_file(self, path):
        base = os.path.basename(path).lower()
        brand = next((v for k, v in FILE_BRAND.items() if k in base), "")
        wb = openpyxl.load_workbook(path, data_only=True)

        sheets = []
        for ws in wb.worksheets:
            hr, header = self._header(ws)
            if hr is None:
                continue
            cols = self._columns(header)
            sheets.append((ws, hr, cols))

        # برگه‌ای که ستون شمارش دارد و در آن عددی نوشته شده، یعنی واقعاً
        # شمرده شده. برگه‌ای که ستون شمارشش سرتاسر خالی است عکسِ پیش از
        # شمارش است، نه نتیجهٔ آن — کنار گذاشته می‌شود مگر هیچ برگهٔ
        # شمرده‌شده‌ای در فایل نباشد (آن برند اصلاً شمارش نشده).
        counted = [s for s in sheets if self._has_counts(*s)]
        use = counted or sheets
        for ws, _, _ in sheets:
            if counted and all(ws is not w for w, _, _ in counted):
                self.warnings.append(
                    f"{os.path.basename(path)}: برگهٔ «{ws.title}» شمارش ندارد — "
                    "کنار گذاشته شد")

        out = []
        for ws, hr, cols in use:
            counted_sheet = self._has_counts(ws, hr, cols)
            source = "شمارش" if counted_sheet else "موجودی سیستم"
            qcol = cols["count"] if counted_sheet else cols.get("sys", cols.get("amount"))
            if qcol is None:
                continue
            sheet_wh = self._sheet_warehouse(ws)
            brand_title = norm(ws.cell(1, 2).value)
            for i, row in enumerate(ws.iter_rows(min_row=hr + 1, values_only=True),
                                    start=hr + 1):
                v = [norm(c) for c in row]

                def cell(key):
                    j = cols.get(key)
                    return v[j] if j is not None and j < len(v) else ""

                bc = cell("barcode")
                if not is_barcode(bc, brand_title):
                    continue
                raw = v[qcol] if qcol < len(v) else ""
                qty = num(raw)
                if qty is None and raw:
                    self.warnings.append(
                        f"{os.path.basename(path)} «{ws.title}» سطر {i}: "
                        f"عدد «{raw[:24]}» خوانده نشد — صفر گرفته شد")
                # خانهٔ خالی یعنی «چیزی نوشته نشده»، نه «صفر». در این فرم‌ها
                # شمارشگر هیچ‌جا صفر ننوشته — پس خالی را صفر گرفتن، نداشتنِ
                # عدد را به ادعای «شمردم و نبود» تبدیل می‌کند.
                shelf = ""
                j = cols.get("shelf")
                if j is not None and j < len(v) and not num(v[j]):
                    shelf = v[j]

                out.append({
                    "barcode": bc,
                    "name": cell("name"),
                    # نام فارسیِ برند، همان که کاتالوگ سایت به کار می‌برد،
                    # بر نام لاتینِ ستون برند مقدم است تا یک برند دو تا نشود.
                    "brand": brand or cell("brand"),
                    "category": cell("category"),
                    "unit": cell("unit"),
                    "warehouse": (self.only_wh or clean_wh(cell("warehouse"))
                                  or sheet_wh or DEFAULT_WAREHOUSE),
                    "shelf": shelf,
                    "qty": qty,
                    "source": source,
                })
        return out

    def _has_counts(self, ws, hr, cols):
        """آیا در ستون شمارشِ این برگه اصلاً عددی نوشته شده؟"""
        c = cols.get("count")
        if c is None:
            return False
        for row in ws.iter_rows(min_row=hr + 1, min_col=c + 1, max_col=c + 1,
                                values_only=True):
            if num(norm(row[0])) is not None:
                return True
        return False

    def _header(self, ws):
        for r in (1, 2, 3):
            if r > ws.max_row:
                break
            vals = [norm(c.value) for c in ws[r]]
            if any("بارکد" in x for x in vals):
                return r, vals
        return None, []

    def _columns(self, header):
        """شمارهٔ ستون‌ها. ستون بی‌نامِ بعد از «شمارش» کد قفسه است."""
        cols = {}

        def put(key, *names, exact=False):
            for i, h in enumerate(header):
                t = h.replace("\n", " ").strip()
                for n in names:
                    if (t == n) if exact else (n in t):
                        cols.setdefault(key, i)
                        return

        put("barcode", "بارکد")
        put("name", "نام کالا", "کالا")
        put("unit", "واحد سنجش", "واحد  سنجش", "واحد")
        put("brand", "برند")
        put("category", "نوع کالا")
        put("warehouse", "انبار")
        put("count", "شمارش")
        put("sys", "موجودی")
        put("amount", "مقدار")

        c = cols.get("count")
        if c is not None and c + 1 < len(header) and not header[c + 1].strip():
            cols["shelf"] = c + 1
        return cols

    def _sheet_warehouse(self, ws):
        """انبار از تیتر بالای برگه: «انبارگردانی … - انبار فروشگاه سیتی‌سنتر»."""
        for col in (3, 2, 1):
            t = norm(ws.cell(1, col).value)
            if "انبار" in t and " - " in t:
                tail = DATE_FA.sub("", t.split(" - ")[-1])
                name = clean_wh(tail)
                if name.startswith("انبار"):
                    return name
        return ""

    def _claim(self, bc, r, site, claimed):
        """کالای سایتی که این بارکد به آن می‌خورد — یا هیچ.

        یک کد در سایت می‌تواند چند قلم باشد (۰.۷۵ لیتر، ۴ لیتر، …). در آن
        صورت فقط اگر حجمِ نامِ حسابداری با یکی بخواند می‌چسبد؛ وگرنه قلم
        جدا ساخته می‌شود تا موجودی روی قلم اشتباه ننشیند.
        """
        cands = site.get(core(bc)) or site.get(squash(bc)) or []
        cands = [s for s in cands if s.pk not in claimed and not s.barcode]
        if not cands:
            return None, "none"
        if len(cands) == 1:
            return cands[0], "one"
        want = size_of(r["name"])
        if want:
            sized = [s for s in cands if size_of(s.pack_size) == want]
            if len(sized) == 1:
                return sized[0], "one"
        return None, "ambiguous"

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
