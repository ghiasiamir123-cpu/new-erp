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

from .models import (Material, MaterialUsage, PackConversion, SitePackLink, Sku, StockBatch, StockItem,
                     StockMovement, StockVoucherLine)


class LinkError(ValueError):
    pass


def _units(sku):
    return {u for u in (sku.base_unit, sku.alt_unit) if u}


def _merge_stock_items(src, dst):
    """ردیف‌های انبارِ src به dst؛ اگر dst در همان انبار ردیف دارد، یکی می‌شوند."""
    n = 0
    for si in list(src.stock_items.all()):
        other = StockItem.objects.filter(sku=dst, warehouse_id=si.warehouse_id).first()
        if other is None:
            si.sku = dst
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
        n += 1
    return n


def _merge_batches(src, dst):
    n = 0
    for batch in list(src.batches.all()):
        clash = StockBatch.objects.filter(sku=dst, batch_no=batch.batch_no).first()
        if clash is None:
            batch.sku = dst
            batch.save(update_fields=["sku"])
        else:
            StockMovement.objects.filter(batch=batch).update(batch=clash)
            clash.produced_on = clash.produced_on or batch.produced_on
            clash.expires_on = clash.expires_on or batch.expires_on
            clash.save()
            batch.delete()
        n += 1
    return n


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
    if site.unit_links.exists() or wh.unit_packs.exists():
        raise LinkError("یکی از این دو بستهٔ دیگرِ (عدد/جعبه، حلب/لیتر) کالای انبار است و ادغام نمی‌شود.")

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

    counts = {"stock_items": _merge_stock_items(site, wh), "movements": 0, "voucher_lines": 0, "usages": 0}
    _merge_batches(site, wh)

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


ART = re.compile(r"\bArt\.?\s*(\d{3,6})\b", re.I)
FA_DIM = str.maketrans("۰۱۲۳۴۵۶۷۸۹٫×*", "0123456789.xx")


def article_of(warehouse_name):
    """شمارهٔ Art از نام انبار («[Square - Art 98511] 60*60mm» ← 98511)."""
    m = ART.search(warehouse_name or "")
    return m.group(1) if m else ""


def dimensions_of(text):
    """ابعاد به شکل یکسان: «60*60mm» و «60×60 میلی‌متر» هر دو ← {"60x60"}."""
    t = str(text or "").translate(FA_DIM).lower()
    return {re.sub(r"\s+", "", d) for d in re.findall(r"\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)+", t)}


def plan_by_article(parents, members):
    """هر بستهٔ سایتِ هم‌طرح/هم‌اندازه یک کالای انبار می‌گیرد: اول شمارهٔ Art، بعد ابعاد.

    شمارهٔ Art بستهٔ سایت یا صریح در اندازه‌اش آمده («60×60 میلی‌متر — 98511»)، یا بازهٔ
    کد محصولش است («98511-98541») که آن‌وقت ابعاد تعیین می‌کند کدام است.
    برمی‌گرداند: ({بستهٔ سایت: [(کالای انبار، برچسب)]}، [(بستهٔ سایت، دلیل)]).
    """
    by_art = defaultdict(list)
    for w in members:
        by_art[article_of(w.warehouse_name)].append(w)
    plan, problems, claimed = {}, [], defaultdict(list)
    for p in parents:
        text = f"{p.pack_size} {p.barcode}".translate(FA_DIM)
        explicit = {a for a in re.findall(r"\b(\d{5})\b", text) if a in by_art}
        pool = [w for a in explicit for w in by_art[a]]
        if not pool:
            arts = set()
            for a, b in re.findall(r"(\d{5})\s*-\s*(\d{5})", (p.product.code or "").translate(FA_DIM)):
                if 0 <= int(b) - int(a) <= 60:
                    arts |= {str(n) for n in range(int(a), int(b) + 1)}
            arts |= set(re.findall(r"\b(\d{5})\b", (p.product.code or "").translate(FA_DIM)))
            dims = dimensions_of(p.pack_size) | dimensions_of(p.site_name)
            pool = [w for a in arts for w in by_art.get(a, []) if dims & dimensions_of(w.warehouse_name)]
        if len(pool) != 1:
            problems.append((p, "کالای انبارِ این طرح پیدا نشد" if not pool else
                             f"{len(pool)} کالای انبار با این طرح و اندازه: "
                             + "، ".join(w.barcode or w.site_package_id for w in pool)))
            continue
        w = pool[0]
        dims = sorted(dimensions_of(w.warehouse_name)) or sorted(dimensions_of(p.pack_size))
        label = " · ".join(b for b in (dims[0].replace("x", "×") if dims else "",
                                        f"Art {article_of(w.warehouse_name)}" if article_of(w.warehouse_name) else "") if b)
        plan[p] = [(w, label)]
        claimed[w.pk].append(p)
    for pk, ps in claimed.items():
        if len(ps) > 1:
            for p in ps:
                plan.pop(p, None)
                problems.append((p, "کالای انبارش را بستهٔ دیگری از سایت هم خواسته: "
                                 + "، ".join(x.shop_pack_id for x in ps)))
    return plan, problems


def size_text(size):
    """(«L»، 10) ← «10L». صفرِ آخرِ عدد صحیح نمی‌افتد (۱۰ لیتر «1L» نشود)."""
    if not size:
        return ""
    text = f"{size[1]:f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text + ("L" if size[0] == "L" else "KG")


def variant_label_for(sku):
    """برچسبی که یک کالای انبار را درون بستهٔ سایتش جدا می‌کند: رنگ، وگرنه شماره سنباده یا دنبالهٔ نام."""
    colour = colour_of(sku.warehouse_name)
    if colour:
        return colour
    name = sku.warehouse_name or ""
    tail = name.rsplit("]", 1)[1] if "]" in name else ""
    tail = re.sub(r"\([^)]*\)", "", tail)
    tail = SIZE.sub("", tail).strip(" -·")
    return tail or sku.grit or sku.shade or sku.pack_size


def plan_variants(parents, members, by="size"):
    """نقشهٔ زیرمجموعه‌ها، بی نوشتن در پایگاه داده.

    by="size": هر بستهٔ سایت همهٔ کالاهای هم‌اندازه را می‌گیرد (برچسب = رنگ)؛ بستهٔ بی‌اندازه
    اندازه‌های بی‌بسته را می‌گیرد (برچسب = «رنگ · اندازه»).
    by="article": هر بسته دقیقاً یک کالا با شمارهٔ Art یا ابعاد (plan_by_article).
    برمی‌گرداند (نقشه {بستهٔ سایت: [(کالای انبار، برچسب)]}، بسته‌های ردشده [(بسته، دلیل)]، کالاهای بی‌بسته).
    """
    parents = list(parents)
    if by == "article":
        plan, skipped = plan_by_article(parents, members)
    else:
        by_size = defaultdict(list)
        for p in parents:
            by_size[site_size(p)].append(p)
        clash = {k: [p.shop_pack_id for p in v] for k, v in by_size.items() if len(v) > 1}
        if clash:
            raise LinkError("چند بستهٔ سایت هم‌اندازه (یا چند بستهٔ بی‌اندازه) انتخاب شده و معلوم نیست "
                            "زیرمجموعه‌ها زیر کدام بروند: "
                            + "؛ ".join("، ".join(v) for v in clash.values()))
        unsized = by_size.pop(None, [None])[0]
        plan, skipped = defaultdict(list), []
        for s in members:
            size = wh_size(s)
            parent = by_size.get(size, [None])[0]
            label = variant_label_for(s)
            if parent is None and unsized is not None:
                parent = unsized
                label = " · ".join(b for b in (label, size_text(size) if size else s.pack_size) if b)
            if parent is not None:
                plan[parent].append((s, label))
        plan = dict(plan)
    used = {w.pk for rows in plan.values() for w, _ in rows}
    leftover = [s for s in members if s.pk not in used]
    return plan, skipped, leftover


def apply_variant_plan(plan, dry_run=False):
    """نقشه را اجرا می‌کند؛ با dry_run انجام و برگردانده می‌شود. ([(بسته، کالا، برچسب، تازه)]، [(کالا، خطا)])."""
    done, problems = [], []
    with transaction.atomic():
        for parent, rows in plan.items():
            for w, label in rows:
                try:
                    with transaction.atomic():
                        fresh = link_variant(parent, w, label)
                except LinkError as exc:
                    problems.append((w, str(exc)))
                    continue
                done.append((parent, w, label, fresh))
        if dry_run:
            transaction.set_rollback(True)
    return done, problems


@transaction.atomic
def link_variant(parent, wh, label):
    """کالای انبار را زیرمجموعهٔ بستهٔ سایت می‌کند. True اگر تازه وصل شد، False اگر از قبل بود.

    بستهٔ سایت می‌ماند (نام و قیمت سایت روی آن است) و هر رنگ موجودی خودش را دارد. اگر پیش از
    اتصال روی خودِ بستهٔ سایت حواله یا موجودی ثبت شده بود، به همین کالای انبار منتقل می‌شود
    (move_pack_records) — وگرنه آن موجودی در جدول انبار دیده نمی‌شد.
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
    if SitePackLink.objects.filter(site_pack=parent).exists():
        raise LinkError(f"بستهٔ «{parent.site_name} {parent.pack_size}» بستهٔ دیگرِ (عدد/جعبه، حلب/لیتر) یک کالاست "
                        "و زیرمجموعهٔ رنگ/اندازه نمی‌گیرد.")
    if wh.site_parent_id and wh.site_parent_id != parent.pk:
        raise LinkError(f"«{wh.display_name}» از قبل زیرمجموعهٔ بستهٔ دیگری است.")
    if not label:
        raise LinkError(f"رنگِ «{wh.display_name}» معلوم نیست.")
    fresh = wh.site_parent_id != parent.pk
    records = fresh and has_own_records(parent)
    if records and parent.site_variants.exclude(pk=wh.pk).exists():
        raise LinkError(f"«{parent.display_name} {parent.pack_size}» خودش موجودی یا حواله دارد و زیرمجموعهٔ "
                        "دیگری هم دارد؛ معلوم نیست آن موجودی مال کدام کالای انبار است.")
    if fresh or wh.variant_label != label:
        wh.site_parent = parent
        wh.variant_label = label[:100]
        wh.save(update_fields=["site_parent", "variant_label"])
    if records:
        move_pack_records(parent)
    return fresh


def has_own_records(sku):
    """گردش، حواله یا گزارش مصرفی که مستقیم روی این ردیف ثبت شده."""
    return (sku.movements.exists() or sku.voucher_lines.exists()
            or MaterialUsage.objects.filter(sku=sku).exists() or Material.objects.filter(sku=sku).exists())


@transaction.atomic
def move_pack_records(parent):
    """گردش، حواله، گزارش مصرف و ردیف انبارِ خودِ بستهٔ سایت را به تنها کالای انبارِ زیرمجموعه‌اش می‌برد.

    حواله‌ها پیش از اتصال روی ردیف سایت زده شده بودند («میکروسمنت خمیری هوگون ۲۰ کیلوگرم»)؛ پس از
    اتصال جدول انبار کالای انبار را نشان می‌دهد و آن موجودی پنهان می‌ماند. (کالای انبار، شمار منتقل‌شده‌ها)
    را برمی‌گرداند.
    """
    parent = Sku.objects.select_for_update().get(pk=parent.pk)
    kids = list(Sku.objects.select_for_update().filter(site_parent=parent))
    where = f"«{parent.display_name} {parent.pack_size} {parent.shade}»".replace(" »", "»")
    if len(kids) != 1:
        raise LinkError(f"{where} {len(kids)} زیرمجموعه دارد؛ معلوم نیست موجودی و حواله‌اش مال کدام است.")
    kid = kids[0]
    if parent.movements.exists() and kid.movements.exists():
        raise LinkError(f"هم {where} و هم «{kid.display_name}» موجودی دارند؛ شاید یک جنس دو بار شمرده شده — "
                        "باید دستی بررسی شود.")
    if PackConversion.objects.filter(Q(box_sku=parent) | Q(unit_sku=parent)).exists():
        raise LinkError(f"{where} تبدیل بسته (جعبه به عدد) دارد؛ باید دستی منتقل شود.")

    pb, kb = (parent.base_unit or "").strip(), (kid.base_unit or "").strip()
    if pb != kb:
        kid_used = (kid.movements.exists() or kid.voucher_lines.exists()
                    or MaterialUsage.objects.filter(sku=kid).exists())
        if kid_used or (kb and kb not in _units(parent)):
            raise LinkError(f"واحد اصلی {where} «{pb or '—'}» است و «{kid.display_name}» «{kb or '—'}»؛ "
                            "اول واحدها را یکی کنید.")
        # کالای انبار هنوز هیچ سابقه‌ای ندارد؛ واحدهایش همان بستهٔ سایت می‌شود
        # (سطل ۲۰ کیلوگرمی: اصلی «حلب»، فرعی «کیلوگرم») تا عدد حواله‌ها همان بماند.
        kid.base_unit, kid.alt_unit, kid.alt_to_base = parent.base_unit, parent.alt_unit, parent.alt_to_base
        kid.save(update_fields=["base_unit", "alt_unit", "alt_to_base"])
    allowed = _units(kid)
    stray = sorted(set(parent.voucher_lines.exclude(unit="").exclude(unit__in=allowed).values_list("unit", flat=True))
                   | set(MaterialUsage.objects.filter(sku=parent).exclude(unit="").exclude(unit__in=allowed)
                         .values_list("unit", flat=True)))
    if stray:
        raise LinkError(f"حواله یا گزارش {where} واحد «{'، '.join(stray)}» دارد که «{kid.display_name}» ندارد.")

    counts = {
        "stock_items": _merge_stock_items(parent, kid),
        "batches": _merge_batches(parent, kid),
        "movements": StockMovement.objects.filter(sku=parent).update(sku=kid),
        "voucher_lines": StockVoucherLine.objects.filter(sku=parent).update(sku=kid),
        # نام ماده در گزارش‌های گذشته همان می‌ماند که ثبت شده؛ فقط کالای انبارش عوض می‌شود.
        "usages": MaterialUsage.objects.filter(sku=parent).update(sku=kid),
        "materials": Material.objects.filter(sku=parent).update(sku=kid),
    }
    return kid, counts


# ---------------- بستهٔ دیگر در واحد دیگر (عدد/جعبه، حلب/لیتر) ----------------
PIECE_UNITS = {"عدد", "برگ", "جفت", "دستگاه"}
BOX_UNITS = {"جعبه", "کارتن", "بسته"}


def pack_kind(size):
    """«piece» (عدد)، «box» (جعبهٔ n عددی، کارتن)، «measure» (1L، 2.5 کیلوگرم) یا «»."""
    text = str(size or "").translate(FA_DIGITS).strip()
    if re.fullmatch(r"(?i)(عدد|1?\s*pz|pcs?)", text):
        return "piece"
    if re.search(r"(?i)(جعبه|کارتن|بسته|\bbox\b|\bpack\b)", text):
        return "box"
    if size_of(text):
        return "measure"
    return ""


def unit_factor(site_pack, wh):
    """چند واحد اصلیِ کالای انبار در یک بستهٔ سایت، یا None اگر از واحدها قطعی نیست."""
    kind = pack_kind(site_pack.pack_size)
    base, alt, rate = (wh.base_unit or "").strip(), (wh.alt_unit or "").strip(), wh.alt_to_base
    if kind == "piece":
        return Decimal(1) if base in PIECE_UNITS else None
    if kind == "box":
        m = re.search(r"(\d+)", str(site_pack.pack_size).translate(FA_DIGITS))
        n = Decimal(m.group(1)) if m else None
        if base in PIECE_UNITS:
            if n:
                return n if not (alt in BOX_UNITS and rate and rate != n) else None
            return rate if alt in BOX_UNITS and rate else None
        if base in BOX_UNITS and not n:
            return Decimal(1)
        return None
    if kind == "measure":
        dim, amount = size_of(site_pack.pack_size)
        unit = {"L": "لیتر", "KG": "کیلوگرم"}[dim]
        if base == unit:
            return amount
        if alt == unit and rate:
            return (amount * rate).quantize(Decimal("0.000001"))
    return None


@transaction.atomic
def link_unit_pack(site_pack, wh, per_pack=None):
    """بستهٔ سایت را بستهٔ دیگرِ کالای انبار می‌کند. (تازه؟، per_pack) برمی‌گرداند."""
    site_pack = Sku.objects.select_for_update().get(pk=site_pack.pk)
    wh = Sku.objects.select_for_update().get(pk=wh.pk)
    if not site_pack.shop_pack_id or site_pack.warehouse_name:
        raise LinkError(f"«{site_pack.display_name}» بستهٔ سایت نیست.")
    if site_pack.is_asset or wh.is_asset:
        raise LinkError("اموال به بستهٔ سایت وصل نمی‌شود.")
    if not wh.warehouse_name or wh.shop_pack_id:
        raise LinkError(f"«{wh.display_name}» کالای انبار نیست.")
    if site_pack.site_variants.exists():
        raise LinkError(f"بستهٔ «{site_pack.site_name} {site_pack.pack_size}» زیرمجموعهٔ رنگ/اندازه دارد.")
    if wh.site_parent_id == site_pack.pk:
        raise LinkError("این بسته از قبل بستهٔ اصلی همین کالاست.")
    other = SitePackLink.objects.filter(site_pack=site_pack).exclude(sku=wh).select_related("sku").first()
    if other:
        raise LinkError(f"این بستهٔ سایت از قبل بستهٔ دیگرِ «{other.sku.display_name}» است.")
    factor = per_pack if per_pack is not None else unit_factor(site_pack, wh)
    if not factor or factor <= 0:
        raise LinkError(f"معلوم نیست هر «{site_pack.pack_size}» چند «{wh.base_unit or '—'}» از «{wh.display_name}» است.")
    _, created = SitePackLink.objects.update_or_create(sku=wh, site_pack=site_pack, defaults={"per_pack": factor})
    return created, factor


def plan_unit_siblings():
    """بسته‌های «عدد» و «جعبه»ی یک جنس در سایت (هم‌محصول، هم‌شماره، هم‌شید): اگر فقط یکی از آن‌ها
    به یک کالای انبار وصل است، بقیه بستهٔ دیگرِ همان کالا می‌شوند. ([(بسته، کالا، per_pack)]، [(بسته، دلیل)])."""
    kids = defaultdict(list)
    for s in Sku.objects.filter(site_parent__isnull=False):
        kids[s.site_parent_id].append(s)
    taken = set(SitePackLink.objects.values_list("site_pack_id", flat=True))
    groups = defaultdict(list)
    for p in Sku.objects.exclude(shop_pack_id="").filter(warehouse_name="", is_asset=False).select_related("product"):
        groups[(p.product_id, p.grit, p.shade)].append(p)
    plan, doubt = [], []
    for grp in groups.values():
        if not {"piece", "box"} <= {pack_kind(p.pack_size) for p in grp}:
            continue
        owners = {w.pk: w for p in grp for w in kids.get(p.pk, [])}
        if len(owners) != 1:
            if owners:
                doubt.extend((p, f"{len(owners)} کالای انبار زیر بسته‌های این جنس") for p in grp if not kids.get(p.pk))
            continue
        w = next(iter(owners.values()))
        for p in grp:
            if kids.get(p.pk) or p.pk in taken or pack_kind(p.pack_size) not in ("piece", "box"):
                continue
            factor = unit_factor(p, w)
            if factor:
                plan.append((p, w, factor))
            else:
                doubt.append((p, f"نسبت «{p.pack_size}» به «{w.base_unit}» ({w.barcode}) معلوم نیست"))
    return plan, doubt


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
