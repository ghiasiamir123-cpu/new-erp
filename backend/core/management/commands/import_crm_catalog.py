"""ساختن کالاهای فهرست محصولات CRM که در انبار نیستند.

فایل «گزارش محصولات» CRM (نام، کد، وضعیت، واحد اصلی، واحد ثانویه، تاریخ) را
می‌خواند و فقط قلم‌هایی را می‌سازد که کدشان در انبار نیست. کالایی که هست دست
نمی‌خورد، پس اجرای دوباره چیزی نمی‌سازد.

تطبیق: اول کدِ عیناً یکسان (بارکد، کد محصول، کد انبار، کد سپیدار، شناسهٔ
پیشونددار)، بعد همان کد بی نشانه. «BO-CDO7002O-F.1» و «BO-CDO7002OF.1» دو کالای
جدا هستند؛ فقط کدِ عین یکدیگر یکی شمرده می‌شوند.

واحد فرعی فقط وقتی تعریف می‌شود که نرخش از نام قطعی باشد — «20Kg» برای
حلب/کیلوگرم، «(100 Pz/Box)» برای عدد/جعبه، «x 50 M» برای رول/متر. نرخِ حدسی
موجودی را خراب می‌کند؛ جای خالی را بعداً از «کالاها» پر می‌کنند.

    python manage.py import_crm_catalog فهرست.csv --dry-run
    python manage.py import_crm_catalog فهرست.csv
"""

import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Product, Sku, StockItem, Warehouse

# ردیف داده: پنج ستونِ آخر همیشه درست نقل‌قول شده‌اند، ولی نام گاهی علامت اینچ
# دارد («1/2" Air Filter») که خوانندهٔ CSV را به هم می‌ریزد؛ پس از انتها لنگر می‌اندازیم.
LINE = re.compile(r'^"(?P<name>.*)","(?P<code>[^"]*)","(?P<status>[^"]*)",'
                  r'"(?P<unit1>[^"]*)","(?P<unit2>[^"]*)","(?P<created>[^"]*)"\s*$')
ACTIVE = "فعال"
FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")

# واحد CRM ← (نام واحد در انبار، نوع، ضریب به کیلوگرم/لیتر/متر)
UNITS = {
    "CAN": ("حلب", "container", None), "TUBE": ("تیوب", "container", None),
    "GALLON": ("گالن", "container", None),
    "PZ": ("عدد", "piece", None), "عدد": ("عدد", "piece", None), "DISC": ("عدد", "piece", None),
    "BLOCK": ("عدد", "piece", None), "SPONGE": ("عدد", "piece", None),
    "دستگاه": ("دستگاه", "piece", None), "PAIR": ("جفت", "piece", None),
    "برگ": ("برگ", "piece", None), "SHEET": ("برگ", "piece", None),
    "PACK": ("بسته", "pack", None), "BOX": ("جعبه", "pack", None),
    "ROLL": ("رول", "roll", None), "رول": ("رول", "roll", None),
    "KG": ("کیلوگرم", "mass", Decimal("1")), "کیلوگرم": ("کیلوگرم", "mass", Decimal("1")),
    "GR": ("گرم", "mass", Decimal("0.001")),
    "LITR": ("لیتر", "vol", Decimal("1")), "لیتر": ("لیتر", "vol", Decimal("1")),
    "ML": ("میلی‌لیتر", "vol", Decimal("0.001")),
    "M": ("متر", "length", Decimal("1")), "متر": ("متر", "length", Decimal("1")),
    "SQM": ("مترمربع", "area", Decimal("1")), "مترمربع": ("مترمربع", "area", Decimal("1")),
}
# اندازهٔ داخل نام ← (بُعد، ضریب به کیلوگرم یا لیتر)
SIZE_UNITS = {"ML": ("vol", Decimal("0.001")), "L": ("vol", Decimal("1")), "LT": ("vol", Decimal("1")),
              "LITR": ("vol", Decimal("1")), "G": ("mass", Decimal("0.001")), "GR": ("mass", Decimal("0.001")),
              "KG": ("mass", Decimal("1")), "KGS": ("mass", Decimal("1"))}
NUM = r"(\d+(?:[.,]\d+)?)"
# عدد چسبیده به «حرف-» یا به حرف و رقم، اندازه نیست: «ST-7712G» مدل است و «B50G» کد رنگ.
SIZE = re.compile(r"(?<![\w.,/])(?<![A-Za-z]-)" + NUM + r"\s*(ML|LITR|LT|L|KGS|KG|GR|G)\b", re.I)
PER_BOX = re.compile(NUM + r"\s*(?:Pz|Pcs|Sh)\s*/\s*(?:Box|Pack)\b", re.I)
PER_PACK = re.compile(NUM + r"\s*Pz\s*/\s*Pack\b", re.I)
PER_ROLL = re.compile(NUM + r"\s*Pz\s*/\s*Roll\b", re.I)
ROLL_LEN = re.compile(r"(?:\bx|\*)\s*" + NUM + r"\s*M\b|\(" + NUM + r"\s*M(?:\s*/\s*Box)?\)", re.I)

# برند: همان نامی که انبار از قبل به کار می‌برد، تا یک برند دو تا نشود.
BRANDS = {"bormawachs": "بورما واکس", "marmorino tools": "مارمورینو تولز", "pratta": "پراتا",
          "mirka": "میرکا", "renner": "رنر ایتالیا", "hogun": "هوگون", "pentrello": "Pentrilo",
          "pentrilo": "Pentrilo", "klingspor": "Klingspor"}
NO_BRAND = {"none brand", "noname", "no name", "etc", ""}


def exact(value):
    return re.sub(r"\s+", "", str(value or "")).upper()


def squash(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").translate(FA_DIGITS).upper())


def dec(text):
    try:
        return Decimal(str(text).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


def unit_of(token):
    raw = str(token or "").strip()
    return UNITS.get(raw.upper()) or UNITS.get(raw)


def size_in_name(name):
    """(بُعد، مقدار به کیلوگرم یا لیتر، متن) از اندازهٔ بسته در نام.

    فقط دنبالهٔ بعد از «]» خوانده می‌شود، چون داخل کروشه کد رنگ است («NCS S 2050-B50G»،
    «Hardwax ... 1030G»). اگر کیلو یا لیتر آمده، «25G» کنارش براقیت است نه گرم. اندازه
    باید یکی باشد؛ دو اندازهٔ ناهمجنس یعنی نام قطعی نیست.
    """
    name = name or ""
    tail = name.rsplit("]", 1)[1] if "]" in name else name
    found = list(SIZE.finditer(tail))
    found = [m for m in found if m.group(2).upper() not in ("G", "GR")] or found
    if len(found) != 1:
        return None
    m = found[0]
    amount = dec(m.group(1))
    dim, factor = SIZE_UNITS[m.group(2).upper()]
    return (dim, amount * factor, m.group(0).replace(" ", "")) if amount else None


def alt_rate(unit1, unit2, name):
    """چند واحد اصلی در یک واحد فرعی (alt_to_base)، یا None اگر از نام قطعی نیست."""
    base, alt = unit_of(unit1), unit_of(unit2)
    if not base or not alt or base[0] == alt[0]:
        return None
    b_kind, a_kind = base[1], alt[1]
    q = lambda v: v.quantize(Decimal("0.000001")) if v and v > 0 else None  # noqa: E731
    if b_kind in ("container", "pack", "piece") and a_kind in ("mass", "vol"):
        size = size_in_name(name)
        if size and size[0] == a_kind:
            return q(alt[2] / size[1])                 # ۱ کیلوگرم = ۱/۲۰ حلب
    if b_kind in ("mass", "vol") and a_kind in ("container", "pack"):
        size = size_in_name(name)
        if size and size[0] == b_kind:
            return q(size[1] / base[2])                # ۱ حلب = ۱۷٫۷ کیلوگرم
    if b_kind == "piece" and a_kind == "pack":
        m = PER_BOX.search(name or "")
        if m:
            return q(dec(m.group(1)))                  # ۱ جعبه = ۱۰۰ عدد
    if b_kind == "pack" and a_kind == "piece":
        m = PER_PACK.search(name or "")
        if m:
            return q(Decimal(1) / dec(m.group(1)))     # ۱ عدد = ۱/۵ بسته
    if b_kind == "roll" and a_kind == "length":
        m = ROLL_LEN.search(name or "")
        length = dec(m.group(1) or m.group(2)) if m else None
        if length:
            return q(Decimal(1) / length)              # ۱ متر = ۱/۵۰ رول
    if b_kind == "roll" and a_kind == "piece":
        m = PER_ROLL.search(name or "")
        if m:
            return q(Decimal(1) / dec(m.group(1)))
    return None


# «Sumake -Accessories» هم برند را از دسته جدا می‌کند، ولی «0.8-2» نه.
BRAND_SPLIT = re.compile(r"\s+-\s*|\s*-\s+")


def brand_and_category(name, known=None):
    """برند و دسته از «برند - دسته [جزئیات]».

    known: املای برندهای موجود به‌صورت بی‌حساسیت به حروف، تا «SIa» همان «Sia» شود.
    """
    parts = [p.strip() for p in BRAND_SPLIT.split(name or "") if p.strip()]
    if len(parts) < 2:
        return "", ""
    brand = parts[0]
    # «Sand paper / A 15cm» وصفِ کالاست، نه برند.
    if brand.lower() in NO_BRAND or "/" in brand or re.search(r"\d", brand) or len(brand) > 25:
        brand = ""
    else:
        brand = BRANDS.get(brand.lower(), brand)
        if known is not None:
            brand = known.setdefault(brand.lower(), brand)
    rest = " - ".join(parts[1:])
    category = rest.split("[")[0].strip(" -") if "[" in rest else parts[1]
    return brand, category[:150]


class Command(BaseCommand):
    help = "ساختن کالاهای فهرست محصولات CRM که در انبار نیستند"

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--warehouse", default="انبار مرکزی",
                            help="انباری که کالای تازه در آن «شمارش نشده» دیده می‌شود")

    def handle(self, *args, **opts):
        rows, unparsed = self._read(opts["path"])
        stats = Counter(read=len(rows), unparsed=len(unparsed))
        if not rows:
            raise CommandError("هیچ ردیف محصولی در فایل پیدا نشد.")
        warehouse = Warehouse.objects.filter(name=opts["warehouse"]).first()
        if warehouse is None:
            raise CommandError(f"انبار «{opts['warehouse']}» پیدا نشد.")

        exact_idx, squash_idx = defaultdict(set), defaultdict(set)
        for sku in Sku.objects.select_related("product"):
            keys = [sku.barcode, sku.product.code, sku.warehouse_code, sku.sepidar_item_id]
            # شناسهٔ عددیِ سایت شماره است، نه کد کالا؛ فقط شناسه‌های پیشونددار کدند.
            if sku.site_package_id and not sku.site_package_id.isdigit():
                keys.append(sku.site_package_id.split("-", 1)[-1])
            for key in keys:
                if exact(key):
                    exact_idx[exact(key)].add(sku.id)
                if len(squash(key)) >= 3:
                    squash_idx[squash(key)].add(sku.id)

        seen, created, squash_only, by_brand, no_alt = set(), [], [], Counter(), Counter()
        known_brands = {b.lower(): b for b in Product.objects.exclude(brand="")
                        .values_list("brand", flat=True).distinct()}
        with transaction.atomic():
            for row in rows:
                code = row["code"]
                if row["status"] != ACTIVE:
                    stats["inactive"] += 1
                    continue
                if not exact(code):
                    stats["no_code"] += 1
                    continue
                if exact(code) in seen:
                    stats["duplicate_in_file"] += 1
                    continue
                seen.add(exact(code))
                if exact_idx.get(exact(code)):
                    stats["exists"] += 1
                    continue
                if squash_idx.get(squash(code)):
                    stats["exists_similar_code"] += 1
                    squash_only.append(row)
                    continue

                base = unit_of(row["unit1"])
                alt = unit_of(row["unit2"])
                rate = alt_rate(row["unit1"], row["unit2"], row["name"])
                if row["unit2"] and rate is None:
                    no_alt[f"{row['unit1']}/{row['unit2']}"] += 1
                brand, category = brand_and_category(row["name"], known_brands)
                size = size_in_name(row["name"])
                stats["created"] += 1
                by_brand[brand or "—"] += 1
                created.append((row, base, alt if rate else None, rate))
                if opts["dry_run"]:
                    continue
                product = Product.objects.create(
                    code=code[:80], name=row["name"][:300], brand=brand[:100], category=category,
                    sellable=False)
                sku = Sku.objects.create(
                    product=product, site_package_id=f"CRM-{code}"[:40], barcode=code[:60],
                    warehouse_name=row["name"][:300],
                    pack_size=(size[2] if size else "")[:60],
                    base_unit=(base[0] if base else row["unit1"])[:30],
                    alt_unit=(alt[0] if (alt and rate) else "")[:30],
                    alt_to_base=rate)
                # بی گردش و بی تاریخ شمارش، پس در جدول «شمارش نشده» دیده می‌شود.
                StockItem.objects.get_or_create(sku=sku, warehouse=warehouse)

            if opts["dry_run"]:
                transaction.set_rollback(True)

        self._report(opts, stats, unparsed, squash_only, created, by_brand, no_alt)

    def _read(self, path):
        rows, unparsed, header = [], [], False
        with open(path, encoding="utf-8-sig") as fh:
            for raw in fh:
                line = raw.strip().lstrip("﻿")
                if not header:
                    header = line.startswith("نام محصول,")
                    continue
                if not line:
                    continue
                m = LINE.match(line)
                if not m:
                    unparsed.append(line)
                    continue
                row = {k: v.replace('""', '"').strip() for k, v in m.groupdict().items()}
                rows.append(row)
        return rows, unparsed

    def _report(self, opts, stats, unparsed, squash_only, created, by_brand, no_alt):
        out = self.stdout.write
        if opts["dry_run"]:
            out(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))
        labels = [("read", "ردیف خوانده‌شده"), ("unparsed", "ردیفِ ناخوانا"), ("inactive", "غیرفعال"),
                  ("no_code", "بی کد"), ("duplicate_in_file", "تکراری در خود فایل"),
                  ("exists", "از قبل در انبار"), ("exists_similar_code", "کد مشابه در انبار — ساخته نشد"),
                  ("created", "ساخته شد")]
        for key, label in labels:
            out(f"  {label}: {stats[key]}")
        with_alt = sum(1 for _, _, alt, _ in created if alt)
        out(f"  از ساخته‌ها با واحد فرعی قطعی: {with_alt}")
        if by_brand:
            out("  به تفکیک برند: " + "، ".join(f"{b} {n}" for b, n in by_brand.most_common()))
        if no_alt:
            out("  واحد فرعیِ بی نرخ قطعی (خالی ماند): " + "، ".join(f"{k} ×{n}" for k, n in no_alt.most_common()))
        for line in unparsed[:5]:
            out(self.style.WARNING(f"  ! ناخوانا: {line[:100]}"))
        for row in squash_only[:10]:
            out(self.style.WARNING(f"  ! کد مشابه: {row['code']} — {row['name'][:60]}"))
