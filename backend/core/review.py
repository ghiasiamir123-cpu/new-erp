"""بازبینی انبار: خانواده به خانواده، با ایرادهای هر کالا و اتصال به سایت.

خانواده = کالاهایی که فقط در رنگ، اندازه یا شماره فرق دارند:
  • کالای انبار: متن داخل کروشهٔ نام انبار بدون بخش آخر («Oil Base - Grundier Oil»)، وگرنه
    کل متن داخل کروشه، وگرنه نام بدون بخش آخر — همراه با برند.
  • بستهٔ سایتی که هنوز زیرمجموعه ندارد: همهٔ بسته‌های یک محصول سایت.
  • بستهٔ سایتی که زیرمجموعه دارد خانوادهٔ جدا نیست؛ در خانوادهٔ رنگ‌هایش دیده می‌شود.

تیک یک خانواده با اثر انگشت مشخصات کالاهایش ذخیره می‌شود (نه موجودی)؛ اگر مشخصات عوض شود،
وضعیت «تغییر کرده» می‌شود تا دوباره دیده شود.
"""
import hashlib
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal

from django.db.models import Sum

from . import valresa
from .linking import (SIZE, LinkError, Matcher, apply_variant_plan, brand_key, family_of, norm_code,
                      plan_variants, site_size, tokens, wh_size)
from .models import FamilyReview, SitePackLink, Sku, StockItem, StockMovement, Warehouse

KNOWN_UNITS = {"حلب", "عدد", "رول", "بسته", "تیوب", "کیلوگرم", "لیتر", "متر", "برگ", "مترمربع", "جعبه",
               "کارتن", "گالن", "دبه", "جفت", "گرم", "دستگاه", "میلی‌لیتر", "قوطی", "شیشه", "سطل", "بشکه"}
PAGE_SIZE = 50


def _inner(name):
    if "[" in name and "]" in name:
        return name[name.find("[") + 1:name.rfind("]")].strip()
    return ""


def _norm(text):
    return re.sub(r"[\W_]+", "", (text or "").lower())


def family_of_sku(sku):
    """(کلید، عنوان) خانوادهٔ یک کالا."""
    name = sku.warehouse_name
    if name:
        inner = _inner(name)
        # رنگ‌های ساختنی رنر («[NCS S 4005-Y20R] 1KG 25G»): داخل کروشه فقط کد رنگ است، پس
        # خانواده همان پیش از کروشه است و همهٔ رنگ‌ها یک‌جا بازبینی می‌شوند.
        if re.match(r"(?i)^(NCS|NSC|RAL)\b", inner):
            title = f"{name.split('[')[0].strip(' -')} — رنگ‌های {inner.split()[0].upper()}"
            return f"w:{brand_key(sku.product.brand) or '-'}:{_norm(title)}", title
        title = family_of(name) or inner
        if not title:
            title = name.rsplit(" - ", 1)[0] if name.count(" - ") >= 2 else name
        title = SIZE.sub("", title).strip(" -") or name
        return f"w:{brand_key(sku.product.brand) or '-'}:{_norm(title)}", title
    return f"s:{sku.product_id}", sku.site_name or sku.product.name


class Context:
    """همهٔ کالاها و آنچه برای ایرادها لازم است، یک بار برای هر درخواست."""

    def __init__(self):
        self.skus = list(Sku.objects.filter(is_asset=False).select_related("product", "site_parent").order_by("id"))
        self.on_hand = {sid: (q or Decimal(0)) for sid, q in
                        StockMovement.objects.values("sku_id").annotate(q=Sum("qty")).values_list("sku_id", "q")}
        central = Warehouse.objects.filter(supplies_workshop=False).order_by("id").first()
        self.uncounted = set(StockItem.objects.filter(warehouse=central, counted_at__isnull=True)
                             .values_list("sku_id", flat=True)) if central else set()
        self.variant_count = Counter(s.site_parent_id for s in self.skus if s.site_parent_id)
        # بستهٔ دیگرِ یک کالا (عدد/جعبه): کالا ← بسته‌هایش، و بسته‌هایی که این‌طور وصل‌اند.
        self.unit_packs = defaultdict(list)
        for link in SitePackLink.objects.select_related("site_pack"):
            self.unit_packs[link.sku_id].append(link)
        self.unit_linked = {link.site_pack_id for links in self.unit_packs.values() for link in links}

        spellings = defaultdict(Counter)
        for s in self.skus:
            if s.product.brand:
                spellings[brand_key(s.product.brand)][s.product.brand] += 1
        self.brand_fix = {}
        for group in spellings.values():
            if len(group) > 1:
                best = group.most_common(1)[0][0]
                self.brand_fix.update({b: best for b in group if b != best})
        self.dupes = Counter(self._dupe_key(s) for s in self.skus if s.warehouse_name)

        self.families = {}
        for s in self.skus:
            if (s.pk in self.variant_count or s.pk in self.unit_linked) and not s.warehouse_name:
                continue          # بستهٔ سایتِ وصل‌شده در خانوادهٔ کالاهای انبارش دیده می‌شود
            key, title = family_of_sku(s)
            fam = self.families.get(key)
            if fam is None:
                fam = self.families[key] = {"key": key, "kind": "warehouse" if key.startswith("w:") else "site",
                                            "title": title, "brand": s.product.brand, "items": []}
            fam["items"].append(s)
        self._issues = {}

    @staticmethod
    def _dupe_key(s):
        return _norm("|".join((s.warehouse_name, s.pack_size, s.grit, s.shade)))

    def issues(self, s):
        if s.pk in self._issues:
            return self._issues[s.pk]
        out = []
        if s.warehouse_name:
            if s.base_unit not in KNOWN_UNITS:
                out.append(f"واحد اصلی نامعتبر: «{s.base_unit or '—'}»")
            if self.on_hand.get(s.pk, 0) > 0 and not s.alt_unit:
                out.append("موجود ولی بی واحد فرعی")
            if not (s.barcode or s.product.code or s.warehouse_code):
                out.append("بی کد")
            if s.needs_review:
                out.append("در صف استانداردسازی مواد")
            if valresa.is_tint(s.warehouse_name, s.barcode):
                problem = valresa.check(s.warehouse_name, s.barcode)
                if problem:
                    out.append("رنگ والرسا خارج از فرمول")
            if self.dupes[self._dupe_key(s)] > 1:
                out.append("اسم تکراری با کالای دیگر")
            if s.pk in self.uncounted:
                out.append("شمارش نشده")
        elif s.shop_pack_id and s.pk not in self.variant_count and s.pk not in self.unit_linked:
            out.append("به کالای انبار وصل نیست")
        if not s.product.brand:
            out.append("بی برند")
        elif s.product.brand in self.brand_fix:
            out.append(f"املای برند: «{s.product.brand}» ← «{self.brand_fix[s.product.brand]}»")
        self._issues[s.pk] = out
        return out


def fingerprint(fam):
    rows = sorted([s.pk, s.warehouse_name, s.site_name, s.barcode, s.product.code, s.warehouse_code, s.base_unit,
                   s.alt_unit, str(s.alt_to_base), s.pack_size, s.grit, s.shade, s.site_parent_id, s.variant_label,
                   s.product.brand, s.active] for s in fam["items"])
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, default=str).encode()).hexdigest()


def fully_linked(fam, ctx):
    """همهٔ کالاهای انبارِ خانواده به سایت وصل‌اند (زیرمجموعه یا بستهٔ دیگر)."""
    items = [s for s in fam["items"] if s.warehouse_name]
    return bool(items) and all(s.site_parent_id or ctx.unit_packs.get(s.pk) for s in items)


def _status(fam, review, ctx=None):
    status = "todo" if review is None else (review.status if review.fingerprint == fingerprint(fam) else "stale")
    # خانواده‌ای که کامل و قطعی به سایت وصل شده دیگر در «بررسی نشده» نمی‌ماند (خواست کاربر)؛
    # تیک‌خورده‌ها — حتی «تغییر کرده» — همان می‌مانند تا تغییر دیده شود.
    if status == "todo" and ctx is not None and fam["kind"] == "warehouse" and fully_linked(fam, ctx):
        return "linked"
    return status


def _review_info(review):
    if review is None:
        return None
    return {"status": review.status, "note": review.note, "by": review.reviewed_by_name,
            "at": review.reviewed_at.isoformat()}


def _summary(fam, ctx, review):
    items = fam["items"]
    return {
        "key": fam["key"], "kind": fam["kind"], "title": fam["title"], "brand": fam["brand"],
        "items": len(items),
        "inStock": sum(1 for s in items if ctx.on_hand.get(s.pk, 0) > 0),
        "linked": sum(1 for s in items if s.site_parent_id or s.pk in ctx.variant_count or ctx.unit_packs.get(s.pk)),
        "withIssues": sum(1 for s in items if ctx.issues(s)),
        "status": _status(fam, review, ctx),
        "review": _review_info(review),
    }


def family_list(status="todo", brand="", q="", page=1):
    ctx = Context()
    reviews = {r.key: r for r in FamilyReview.objects.all()}
    rows = [_summary(f, ctx, reviews.get(f["key"])) for f in ctx.families.values()]
    counts = Counter(r["status"] for r in rows)
    brands = defaultdict(lambda: {"total": 0, "ok": 0})
    for r in rows:
        b = brands[r["brand"] or "بی برند"]
        b["total"] += 1
        b["ok"] += r["status"] in ("ok", "linked")

    wanted = {"todo": {"todo", "stale"}, "fix": {"fix"}, "ok": {"ok"}, "linked": {"linked"}}.get(status)
    if wanted:
        rows = [r for r in rows if r["status"] in wanted]
    if brand:
        rows = [r for r in rows if (r["brand"] or "بی برند") == brand]
    words = [w for w in q.lower().split() if w]
    if words:
        def text(r):
            fam = ctx.families[r["key"]]
            return " ".join([r["title"], r["brand"]] + [f"{s.warehouse_name} {s.site_name} {s.barcode} {s.shop_pack_id}"
                                                          for s in fam["items"]]).lower()
        rows = [r for r in rows if all(w in text(r) for w in words)]
    # اول خانواده‌هایی که موجودی دارند، بعد برند به برند.
    rows.sort(key=lambda r: (r["inStock"] == 0, r["brand"] or "~", r["title"].lower()))
    start = (page - 1) * PAGE_SIZE
    return {
        "count": len(rows), "page": page, "pageSize": PAGE_SIZE,
        "results": rows[start:start + PAGE_SIZE],
        "totals": {"families": sum(counts.values()), "ok": counts["ok"], "fix": counts["fix"],
                   "stale": counts["stale"], "todo": counts["todo"], "linked": counts["linked"]},
        "brands": sorted(({"brand": k, **v} for k, v in brands.items()), key=lambda b: -b["total"]),
    }


def _item_row(s, ctx):
    parent = s.site_parent if s.site_parent_id else None
    return {
        "id": str(s.pk), "name": s.display_name, "warehouseName": s.warehouse_name,
        "code": s.barcode or s.warehouse_code or s.product.code or s.site_package_id,
        "pack": s.site_pack, "packSize": s.pack_size, "grit": s.grit, "shade": s.shade,
        "baseUnit": s.base_unit, "altUnit": s.alt_unit,
        "altPerBase": float((Decimal(1) / s.alt_to_base).quantize(Decimal("0.0001"))) if s.alt_to_base else None,
        "onHand": float(ctx.on_hand.get(s.pk, 0)),
        "siteName": s.site_display_name, "variantLabel": s.variant_label,
        "siteParent": {"pack": parent.shop_pack_id, "name": parent.site_name, "packSize": parent.pack_size} if parent else None,
        "variants": ctx.variant_count.get(s.pk, 0),
        "extraPacks": [{"pack": l.site_pack.shop_pack_id, "packSize": l.site_pack.pack_size,
                        "perPack": float(l.per_pack)} for l in ctx.unit_packs.get(s.pk, [])],
        "issues": ctx.issues(s),
    }


def _pack_row(p, ctx, score=None):
    row = {"id": str(p.pk), "pack": p.shop_pack_id, "name": p.site_name or p.product.name, "packSize": p.pack_size,
           "grit": p.grit, "shade": p.shade, "code": p.product.code, "variants": ctx.variant_count.get(p.pk, 0)}
    if score is not None:
        row["score"] = score
    return row


def _site_suggestions(fam, ctx, limit=15):
    """بسته‌های سایتِ هم‌برند که به این خانواده می‌خورند: کد مشابه و کلمه‌های مشترک."""
    items = fam["items"]
    fam_brand = brand_key(fam["brand"])
    words = tokens(fam["title"], *[s.warehouse_name for s in items[:40]])
    codes = {norm_code(c) for s in items for c in (s.barcode, s.product.code)} - {""}
    linked = {s.site_parent_id for s in items if s.site_parent_id}
    sizes = {wh_size(s) for s in items} - {None}
    out = []
    for p in ctx.skus:
        if not p.shop_pack_id or p.warehouse_name or p.pk in linked or brand_key(p.product.brand) != fam_brand:
            continue
        score = 0
        pcode = norm_code(p.product.code)
        if pcode and len(pcode) >= 4 and any(c.startswith(pcode) or (len(c) >= 6 and pcode.startswith(c[:6])) for c in codes):
            score += 50
        score += 8 * len(words & tokens(p.site_name, p.product.code, p.grit, p.shade))
        # نام یک‌کلمه‌ای («ReviewTestOil») با یک کلمهٔ مشترک هم پیشنهاد می‌شود؛ ترتیب امتیاز نویز را پایین نگه می‌دارد.
        if score >= 8:
            if site_size(p) and site_size(p) in sizes:
                score += 4
            out.append((score, p))
    out.sort(key=lambda r: (-r[0], r[1].site_name, r[1].pack_size))
    return [_pack_row(p, ctx, score) for score, p in out[:limit]]


def _family_suggestions(fam, ctx, limit=8):
    """برای خانوادهٔ سایت: خانواده‌های انباری که پیشنهادهای بسته‌هایش در آن‌ها افتاده‌اند."""
    matcher = Matcher()
    scores = Counter()
    for p in fam["items"]:
        suggestions, _ = matcher.suggest(p, limit=5)
        for score, w, _why in suggestions:
            scores[family_of_sku(w)[0]] += max(score, 1)
    out = []
    for key, score in scores.most_common(limit):
        f = ctx.families.get(key)
        if f:
            out.append({"key": key, "title": f["title"], "brand": f["brand"], "items": len(f["items"]), "score": score})
    return out


def family_detail(key):
    ctx = Context()
    fam = ctx.families.get(key)
    if fam is None:
        raise LinkError("این خانواده پیدا نشد؛ شاید مشخصات کالاهایش عوض شده. فهرست را دوباره باز کنید.")
    review = FamilyReview.objects.filter(key=key).first()
    items = sorted(fam["items"], key=lambda s: (s.variant_label or s.display_name).lower())
    parents = {}
    for s in items:
        if s.site_parent_id:
            parents[s.site_parent_id] = s.site_parent
    return {
        **_summary(fam, ctx, review),
        "itemsList": [_item_row(s, ctx) for s in items],
        "linkedPacks": [{**_pack_row(p, ctx), "inFamily": sum(1 for s in items if s.site_parent_id == p.pk)}
                        for p in sorted(parents.values(), key=lambda p: (p.site_name, p.pack_size))],
        "suggestions": _site_suggestions(fam, ctx) if fam["kind"] == "warehouse" else [],
        "familySuggestions": _family_suggestions(fam, ctx) if fam["kind"] == "site" else [],
    }


def mark_family(key, status, note, user):
    note = (note or "").strip()[:500]
    if status == "clear":
        FamilyReview.objects.filter(key=key).delete()
        return {"key": key, "status": "todo"}
    if status not in ("ok", "fix"):
        raise LinkError("وضعیت بازبینی معتبر نیست.")
    if status == "fix" and not note:
        raise LinkError("برای «نیاز به اصلاح» بنویسید چه چیزی باید اصلاح شود.")
    ctx = Context()
    fam = ctx.families.get(key)
    if fam is None:
        raise LinkError("این خانواده پیدا نشد؛ فهرست را دوباره باز کنید.")
    review, _ = FamilyReview.objects.update_or_create(key=key, defaults={
        "title": fam["title"][:300], "brand": (fam["brand"] or "")[:100], "status": status, "note": note,
        "fingerprint": fingerprint(fam), "item_count": len(fam["items"]),
        "reviewed_by": user, "reviewed_by_name": (getattr(user, "name", "") or user.username)[:150],
    })
    return _summary(fam, ctx, review)


def link_family(family_key, packs, by, dry_run):
    """کالاهای یک خانوادهٔ انبار را زیرمجموعهٔ بسته‌های سایتِ انتخاب‌شده می‌کند (با dry_run فقط پیش‌نمایش)."""
    if by not in ("size", "article"):
        raise LinkError("قاعدهٔ اتصال معتبر نیست.")
    if not packs:
        raise LinkError("دست‌کم یک بستهٔ سایت انتخاب کنید.")
    ctx = Context()
    fam = ctx.families.get(family_key)
    if fam is None or fam["kind"] != "warehouse":
        raise LinkError("خانوادهٔ کالای انبار را انتخاب کنید.")
    found = {p.shop_pack_id: p for p in Sku.objects.filter(shop_pack_id__in=packs).select_related("product")}
    missing = [p for p in packs if p not in found]
    if missing:
        raise LinkError(f"این شناسه‌های سایت پیدا نشد: {'، '.join(missing)}")
    parents = [found[p] for p in dict.fromkeys(packs)]
    members = [s for s in fam["items"] if s.warehouse_name]
    plan, skipped, leftover = plan_variants(parents, members, by)
    done, problems = apply_variant_plan(plan, dry_run=dry_run)
    by_parent = defaultdict(list)
    for parent, w, label, fresh in done:
        by_parent[parent.pk].append({"id": str(w.pk), "code": w.barcode or w.site_package_id,
                                     "name": w.warehouse_name, "label": label, "fresh": fresh,
                                     "onHand": float(ctx.on_hand.get(w.pk, 0))})
    return {
        "dryRun": dry_run,
        "rows": [{**_pack_row(p, ctx), "items": sorted(by_parent.get(p.pk, []), key=lambda r: r["label"].lower())}
                 for p in parents],
        "linked": sum(1 for *_, fresh in done if fresh),
        "already": sum(1 for *_, fresh in done if not fresh),
        "skipped": [{"pack": p.shop_pack_id, "name": p.site_name, "packSize": p.pack_size, "reason": why}
                    for p, why in skipped],
        "problems": [{"code": w.barcode or w.site_package_id, "name": w.warehouse_name, "reason": why}
                     for w, why in problems],
        "leftover": [{"code": w.barcode or w.site_package_id, "name": w.warehouse_name} for w in leftover],
    }
