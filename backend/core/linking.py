"""یکی کردن کالای سایت فروش با کالای انبار.

کالای سایت («بورما روغن هاردفرنیچر — 1L»، شناسهٔ بستهٔ ۱۵۴۱) و کالای انبار
(«Bormawachs - Top Coat [...] 1L»، کد BO-4902) یک جنس‌اند ولی دو ردیف بودند. اتصال
شناسه و نام سایت را روی ردیف انبار می‌نشاند، گردش و حواله و گزارش و ردیف انبارِ
کالای سایت را به آن منتقل می‌کند و ردیف اضافه را برمی‌دارد.

پیشنهاد (suggest) فقط پیشنهاد است؛ «مطمئن» یعنی کد و اندازه هر دو فقط یک کالا را نشان
می‌دهند و آن کالا را کالای سایتِ دیگری نخواسته است.
"""
import re
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from .models import (Material, MaterialUsage, PackConversion, Sku, StockBatch, StockItem,
                     StockMovement, StockVoucherLine)


class LinkError(ValueError):
    pass


def _units(sku):
    return {u for u in (sku.base_unit, sku.alt_unit) if u}


@transaction.atomic
def link_site_sku(site, wh):
    """کالای سایت را در کالای انبار ادغام می‌کند. شمار ردیف‌های منتقل‌شده را برمی‌گرداند."""
    site = Sku.objects.select_for_update().select_related("product").get(pk=site.pk)
    wh = Sku.objects.select_for_update().select_related("product").get(pk=wh.pk)
    if site.pk == wh.pk:
        raise LinkError("کالای سایت و کالای انبار یکی‌اند.")
    if not site.shop_pack_id:
        raise LinkError(f"«{site.display_name}» کالای سایت نیست.")
    if wh.shop_pack_id:
        raise LinkError(f"«{wh.display_name}» از قبل به بستهٔ {wh.shop_pack_id} سایت وصل است.")
    if site.is_asset or wh.is_asset:
        raise LinkError("اموال به کالای سایت وصل نمی‌شود.")
    if not wh.warehouse_name:
        raise LinkError(f"«{wh.display_name}» نام انبار ندارد، پس کالای انبار نیست.")
    if site.site_variants.exists():
        raise LinkError(f"«{site.display_name}» رنگ‌های انبار زیرمجموعه‌اش هستند و در کالای دیگری ادغام نمی‌شود.")
    if wh.site_parent_id:
        raise LinkError(f"«{wh.display_name}» زیرمجموعهٔ بستهٔ دیگری از سایت است.")

    # مقدارهای گردش و حواله به واحد اصلی‌اند؛ با دو واحد اصلی متفاوت جابه‌جا کردنشان عدد را غلط می‌کند.
    if ((site.movements.exists() or site.voucher_lines.exists())
            and (site.base_unit or "").strip() != (wh.base_unit or "").strip()):
        raise LinkError(
            f"«{site.display_name}» گردش یا حواله دارد با واحد اصلی «{site.base_unit or '—'}» ولی "
            f"واحد اصلی «{wh.display_name}» «{wh.base_unit or '—'}» است؛ اول واحدها را یکی کنید.")
    allowed = _units(wh)
    stray = sorted(set(site.voucher_lines.exclude(unit="").exclude(unit__in=allowed)
                       .values_list("unit", flat=True))
                   | set(MaterialUsage.objects.filter(sku=site, report__affects_stock=True)
                         .exclude(unit="").exclude(unit__in=allowed).values_list("unit", flat=True)))
    if stray:
        raise LinkError(f"حواله یا گزارش «{site.display_name}» واحد «{'، '.join(stray)}» دارد که "
                        f"«{wh.display_name}» ندارد.")

    # شناسهٔ سایت یکتاست؛ اول از ردیف سایت برداشته می‌شود.
    pack_id = site.shop_pack_id
    Sku.objects.filter(pk=site.pk).update(shop_pack_id="")
    wh.shop_pack_id = pack_id
    wh.site_name = site.site_name or site.product.name
    if site.sale_price:                       # قیمت فروش مرجعش سایت است
        wh.sale_price = site.sale_price
    if not wh.cost_price and site.cost_price:
        wh.cost_price = site.cost_price
    if wh.weight_kg is None:
        wh.weight_kg = site.weight_kg
    for field in ("grit", "shade", "barcode", "sepidar_item_id", "warehouse_code"):
        if not getattr(wh, field) and getattr(site, field):
            setattr(wh, field, getattr(site, field))
    wh.active = wh.active or site.active
    wh.save()

    counts = {"stock_items": 0, "movements": 0, "voucher_lines": 0, "usages": 0}
    for si in list(site.stock_items.all()):
        other = StockItem.objects.filter(sku=wh, warehouse_id=si.warehouse_id).first()
        if other is None:
            si.sku = wh
            si.save(update_fields=["sku"])
        else:
            if not other.shelf_code:
                other.shelf_code = si.shelf_code
            other.min_qty = max(other.min_qty, si.min_qty)
            other.reserved_qty += si.reserved_qty
            if si.counted_at and (other.counted_at is None or si.counted_at > other.counted_at):
                other.counted_at = si.counted_at
            other.save()
            si.delete()
        counts["stock_items"] += 1

    for batch in list(site.batches.all()):
        clash = StockBatch.objects.filter(sku=wh, batch_no=batch.batch_no).first()
        if clash is None:
            batch.sku = wh
            batch.save(update_fields=["sku"])
        else:
            StockMovement.objects.filter(batch=batch).update(batch=clash)
            clash.produced_on = clash.produced_on or batch.produced_on
            clash.expires_on = clash.expires_on or batch.expires_on
            clash.save()
            batch.delete()

    for conv in list(PackConversion.objects.filter(Q(box_sku=site) | Q(unit_sku=site))):
        box = wh if conv.box_sku_id == site.pk else conv.box_sku
        unit = wh if conv.unit_sku_id == site.pk else conv.unit_sku
        if box.pk == unit.pk or PackConversion.objects.filter(
                box_sku=box, unit_sku=unit).exclude(pk=conv.pk).exists():
            conv.delete()
        else:
            conv.box_sku, conv.unit_sku = box, unit
            conv.save()

    counts["movements"] = StockMovement.objects.filter(sku=site).update(sku=wh)
    counts["voucher_lines"] = StockVoucherLine.objects.filter(sku=site).update(sku=wh)
    counts["usages"] = MaterialUsage.objects.filter(sku=site).update(
        sku=wh, material_name=wh.display_name[:200],
        material_code=(wh.warehouse_code or wh.product.code or wh.barcode or "")[:50])
    Material.objects.filter(sku=site).update(sku=wh)

    product = site.product
    site.delete()
    if not product.skus.exists():
        product.delete()
    return counts


# ---------------- زیرمجموعه (رنگ‌های یک بستهٔ سایت) ----------------
def colour_of(warehouse_name):
    """رنگ از نام انبار: آخرین بخش داخل کروشه.

    «Bormawachs - Preparation [Oil Base - Grundier Oil - White 50] 125ML» ← «White 50»
    """
    name = warehouse_name or ""
    if "[" not in name or "]" not in name:
        return ""
    inner = name[name.find("[") + 1:name.rfind("]")]
    parts = [p.strip() for p in re.split(r"\s+-\s+", inner) if p.strip()]
    return parts[-1] if len(parts) >= 2 else ""


def family_of(warehouse_name):
    """جنس بی رنگ: داخل کروشه بدون بخش آخر («Oil Base - Grundier Oil»)."""
    name = warehouse_name or ""
    if "[" not in name or "]" not in name:
        return ""
    inner = name[name.find("[") + 1:name.rfind("]")]
    parts = [p.strip() for p in re.split(r"\s+-\s+", inner) if p.strip()]
    return " - ".join(parts[:-1]) if len(parts) >= 2 else ""


@transaction.atomic
def link_variant(parent, wh, label):
    """کالای انبار را زیرمجموعهٔ بستهٔ سایت می‌کند. True اگر تازه وصل شد، False اگر از قبل بود.

    چیزی جابه‌جا یا حذف نمی‌شود: بستهٔ سایت می‌ماند (نام و قیمت سایت روی آن است) و هر رنگ
    موجودی خودش را دارد.
    """
    parent = Sku.objects.select_for_update().get(pk=parent.pk)
    wh = Sku.objects.select_for_update().get(pk=wh.pk)
    label = (label or "").strip()
    if parent.pk == wh.pk:
        raise LinkError("کالا زیرمجموعهٔ خودش نمی‌شود.")
    if not parent.shop_pack_id or parent.warehouse_name:
        raise LinkError(f"«{parent.display_name}» بستهٔ سایت نیست.")
    if parent.site_parent_id:
        raise LinkError(f"«{parent.display_name}» خودش زیرمجموعه است.")
    if parent.is_asset or wh.is_asset:
        raise LinkError("اموال زیرمجموعهٔ سایت نمی‌شود.")
    if not wh.warehouse_name:
        raise LinkError(f"«{wh.display_name}» نام انبار ندارد.")
    if wh.shop_pack_id:
        raise LinkError(f"«{wh.display_name}» خودش بستهٔ {wh.shop_pack_id} سایت است.")
    if wh.site_variants.exists():
        raise LinkError(f"«{wh.display_name}» خودش زیرمجموعه دارد.")
    if wh.site_parent_id and wh.site_parent_id != parent.pk:
        raise LinkError(f"«{wh.display_name}» از قبل زیرمجموعهٔ بستهٔ دیگری است.")
    if not label:
        raise LinkError(f"رنگِ «{wh.display_name}» معلوم نیست.")
    fresh = wh.site_parent_id != parent.pk
    if fresh or wh.variant_label != label:
        wh.site_parent = parent
        wh.variant_label = label[:100]
        wh.save(update_fields=["site_parent", "variant_label"])
    return fresh


# ---------------- پیشنهاد ----------------
SIZE = re.compile(r"(?<![\w.,/])(?<![A-Za-z]-)(\d+(?:[.,]\d+)?)\s*(ML|LITR|LTR|LT|L|KGS|KG|GR|G)(?![\w])", re.I)
FACTOR = {"ML": Decimal("0.001"), "L": Decimal(1), "LT": Decimal(1), "LTR": Decimal(1), "LITR": Decimal(1),
          "G": Decimal("0.001"), "GR": Decimal("0.001"), "KG": Decimal(1), "KGS": Decimal(1)}
DIM = {"ML": "L", "L": "L", "LT": "L", "LTR": "L", "LITR": "L", "G": "KG", "GR": "KG", "KG": "KG", "KGS": "KG"}
PERSIAN_UNITS = (("میلی‌لیتر", "ML"), ("میلی لیتر", "ML"), ("لیتری", "L"), ("لیتر", "L"),
                 ("کیلوگرمی", "KG"), ("کیلوگرم", "KG"), ("کیلویی", "KG"), ("کیلو", "KG"), ("گرمی", "G"), ("گرم", "G"))
FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٫", "0123456789.")
BRANDS = {"bormawachs": "borma", "بورما واکس": "borma", "mirka": "mirka", "میرکا": "mirka",
          "pratta": "pratta", "پراتا": "pratta", "renner": "renner", "رنر ایتالیا": "renner",
          "hogun": "hogun", "hugon": "hogun", "هوگون": "hogun", "marmorino tools": "marmorino",
          "مارمورینو تولز": "marmorino", "pentrello": "pentrilo", "pentrilo": "pentrilo"}
STOP = {"grip", "mm", "base", "the", "and", "for", "with", "type", "n", "i", "e", "cm", "m", "l", "kg"}


def norm_code(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").translate(FA_DIGITS).upper())


def size_of(text, after_bracket=False):
    """(بُعد، مقدار به لیتر یا کیلوگرم) اگر اندازه یکی و روشن باشد."""
    text = str(text or "").translate(FA_DIGITS)
    for fa, en in PERSIAN_UNITS:
        text = text.replace(fa, en)
    if after_bracket and "]" in text:
        text = text.rsplit("]", 1)[1]
    found = SIZE.findall(text)
    found = [f for f in found if f[1].upper() not in ("G", "GR")] or found
    if len(found) != 1:
        return None
    amount, unit = found[0]
    return DIM[unit.upper()], (Decimal(amount.replace(",", ".")) * FACTOR[unit.upper()]).normalize()


def brand_key(brand):
    b = (brand or "").strip()
    return BRANDS.get(b.lower(), BRANDS.get(b, b.lower()))


def tokens(*texts):
    words = set()
    for t in texts:
        words |= {w for w in re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", str(t or "").translate(FA_DIGITS).lower())
                  if len(w) >= 2 and w not in STOP}
    return words


def variant_key(sku):
    """جنسِ کالای انبار بی اندازه: متن داخل کروشه («Antico Velluto - Cool/Silver Base»)."""
    name = sku.warehouse_name or ""
    inner = name[name.find("[") + 1:name.rfind("]")] if "[" in name and "]" in name else name
    inner = SIZE.sub("", inner.translate(FA_DIGITS))
    return re.sub(r"[\W_]+", "", inner.lower())


def site_size(sku):
    return size_of(sku.pack_size) or size_of(sku.site_name)


def wh_size(sku):
    return size_of(sku.warehouse_name, after_bracket=True) or size_of(sku.pack_size)


class Matcher:
    """کالاهای انبارِ آزاد (بی شناسهٔ سایت) را یک بار نمایه می‌کند و برای هر کالای سایت پیشنهاد می‌دهد."""

    def __init__(self, pool=None):
        pool = pool if pool is not None else (
            Sku.objects.filter(is_asset=False, shop_pack_id="", site_parent__isnull=True)
            .exclude(warehouse_name="").select_related("product"))
        self.pool = list(pool)
        self.by_code = defaultdict(list)
        self.by_brand = defaultdict(list)
        self.info = {}
        for w in self.pool:
            for code in {norm_code(w.barcode), norm_code(w.product.code)} - {""}:
                self.by_code[code].append(w)
            self.by_brand[brand_key(w.product.brand)].append(w)
            self.info[w.pk] = (wh_size(w), tokens(w.warehouse_name, w.grit, w.shade))

    def suggest(self, site, limit=5):
        """[(امتیاز، کالای انبار، دلیل)] به ترتیب امتیاز، و اینکه اولی مطمئن است یا نه."""
        size = site_size(site)
        codes = {norm_code(site.product.code), norm_code(site.barcode)} - {""}
        exact = {w.pk: w for c in codes for w in self.by_code.get(c, [])}
        prefix = {}
        if not exact:
            for c in codes:
                if len(c) >= 4:
                    for key, ws in self.by_code.items():
                        if key.startswith(c):
                            prefix.update({w.pk: w for w in ws})
        site_words = tokens(site.site_name, site.grit, site.shade)
        scored = []
        pool = exact or prefix
        if pool:
            for w in pool.values():
                wsize, words = self.info[w.pk]
                score, why = (100, "کد یکسان") if w.pk in exact else (80, "کد مشابه")
                if size and wsize:
                    if size == wsize:
                        score, why = score + 20, why + " و اندازهٔ یکسان"
                    else:
                        score, why = score - 50, why + "، اندازهٔ متفاوت"
                score += 5 * len(site_words & words)
                scored.append((score, w, why))
        else:
            key = brand_key(site.product.brand)
            for w in self.by_brand.get(key, []) if key else []:
                wsize, words = self.info[w.pk]
                common = site_words & words
                if not common:
                    continue
                score = int(60 * len(common) / max(1, len(site_words | words)))
                why = "نام مشابه"
                if size and wsize:
                    score += 20 if size == wsize else -30
                if site.grit and norm_code(site.grit).lower() in words:
                    score += 15
                if score >= 15:
                    scored.append((score, w, why))
        scored.sort(key=lambda r: (-r[0], r[1].pk))
        confident = False
        if exact and len(exact) == 1:
            w = next(iter(exact.values()))
            wsize = self.info[w.pk][0]
            confident = not (size and wsize and size != wsize)
        elif pool and size:
            same_size = [w for w in pool.values() if self.info[w.pk][0] == size]
            # کد مشابه + اندازهٔ یکتا فقط وقتی مطمئن است که همهٔ نامزدها یک جنس‌اند و فقط اندازه
            # فرقشان است. «پارکت وکس 1L» سایت رنگ ندارد؛ اگر انبار «30 Gloss» و «90 Gloss» دارد و
            # فقط یکی ۱ لیتری است، باز معلوم نیست کدام است.
            confident = len(same_size) == 1 and len({variant_key(w) for w in pool.values()}) == 1
            if len(same_size) == 1:
                scored.sort(key=lambda r: (r[1].pk != same_size[0].pk, -r[0]))
        return scored[:limit], confident


def plan_auto_links(site_skus, matcher=None):
    """کالاهای سایتی که مطمئن وصل می‌شوند: [(سایت، انبار)] و بقیه با پیشنهادهایشان."""
    matcher = matcher or Matcher()
    sure, rest = [], []
    for site in site_skus:
        suggestions, confident = matcher.suggest(site)
        if confident and suggestions:
            sure.append((site, suggestions[0][1], suggestions))
        else:
            rest.append((site, suggestions))
    # یک کالای انبار فقط یک بستهٔ سایت می‌گیرد؛ اگر دو بستهٔ سایت آن را خواستند، هیچ‌کدام خودکار نیست.
    wanted = defaultdict(list)
    for site, wh, suggestions in sure:
        wanted[wh.pk].append((site, wh, suggestions))
    final = []
    for group in wanted.values():
        if len(group) == 1:
            final.append(group[0][:2])
        else:
            rest.extend((site, suggestions) for site, _, suggestions in group)
    return final, rest
