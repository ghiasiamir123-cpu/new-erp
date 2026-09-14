"""رنگ‌های انبار را زیرمجموعهٔ بسته‌های سایت می‌کند — یک جنس در هر اجرا.

    python manage.py link_site_variants --packs 1848,1849,1850,1851 --family "Oil Base - Grundier Oil" --dry-run
    python manage.py link_site_variants --packs 1848,1849,1850,1851 --family "Oil Base - Grundier Oil"

هر بستهٔ سایت (یک اندازه، بی رنگ) همهٔ کالاهای انبارِ همان جنس و همان اندازه را می‌گیرد؛
جنس = متن داخل کروشهٔ نام انبار بدون بخش آخر، و رنگ = بخش آخر. اگر یکی از بسته‌ها اندازه
ندارد، اندازه‌هایی را که بستهٔ هم‌اندازه ندارند می‌گیرد و برچسبشان «رنگ · اندازه» می‌شود.
کالای انباری که هیچ بسته‌ای نمی‌گیرد گزارش می‌شود. چیزی جابه‌جا یا حذف نمی‌شود.

برچسب (رنگ یا اندازه) فقط برای انبار است: «نام سایت (برچسب)» در سامانه نشان می‌دهد کدام رنگ
یا اندازه موجود است؛ به سایت فروش فرستاده نمی‌شود.
"""
import re
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum

from core.linking import (LinkError, brand_key, colour_of, family_of, link_variant, site_size,
                          wh_size)
from core.models import Sku, StockMovement


def fmt_size(size):
    if not size:
        return "?"
    dim, amount = size
    return f"{amount:f}".rstrip("0").rstrip(".") + ("L" if dim == "L" else "KG")


class Command(BaseCommand):
    help = "رنگ‌های انبارِ یک جنس را زیرمجموعهٔ بسته‌های سایتِ هم‌اندازه می‌کند"

    def add_arguments(self, parser):
        parser.add_argument("--packs", required=True, help="شناسه‌های بستهٔ سایت، با ویرگول")
        parser.add_argument("--family", required=True,
                            help="جنس داخل کروشهٔ نام انبار بدون رنگ، مثل «Oil Base - Grundier Oil»")
        parser.add_argument("--dry-run", action="store_true", help="انجام و برگرداندن")

    def handle(self, *args, **opts):
        packs = [p.strip() for p in re.split(r"[,\s]+", opts["packs"]) if p.strip()]
        family = re.sub(r"\s+", " ", opts["family"]).strip().lower()
        parents = {p: Sku.objects.filter(shop_pack_id=p).select_related("product").first() for p in packs}
        missing = [p for p, s in parents.items() if s is None]
        if missing:
            raise CommandError(f"این شناسه‌های سایت پیدا نشد: {', '.join(missing)}")
        brands = {brand_key(s.product.brand) for s in parents.values()}
        # بستهٔ سایتِ بی‌اندازه همهٔ اندازه‌هایی را می‌گیرد که بستهٔ هم‌اندازه ندارند؛ آن‌وقت اندازه هم
        # کنار رنگ داخل پرانتز می‌آید تا در انبار معلوم باشد کدام اندازه موجود است.
        by_size = defaultdict(list)
        for pack, parent in parents.items():
            by_size[site_size(parent)].append(parent)
        clash = {fmt_size(k): [p.shop_pack_id for p in v] for k, v in by_size.items() if len(v) > 1}
        if clash:
            raise CommandError(f"چند بستهٔ سایت هم‌اندازه (یا چند بستهٔ بی‌اندازه) داده شده و معلوم نیست "
                               f"زیرمجموعه‌ها زیر کدام بروند: {clash}")
        unsized = by_size.pop(None, [None])[0]

        members = [s for s in Sku.objects.filter(is_asset=False, shop_pack_id="")
                   .exclude(warehouse_name="").select_related("product", "site_parent")
                   if family_of(s.warehouse_name).lower() == family and brand_key(s.product.brand) in brands]
        if not members:
            raise CommandError(f"هیچ کالای انباری با جنس «{opts['family']}» پیدا نشد.")
        on_hand = dict(StockMovement.objects.filter(sku__in=members).values("sku_id")
                       .annotate(q=Sum("qty")).values_list("sku_id", "q"))

        plan, no_size, problems = defaultdict(list), [], []
        labels = {}
        for s in members:
            size = wh_size(s)
            parent = by_size.get(size, [None])[0]
            colour = colour_of(s.warehouse_name)
            if parent is not None:
                labels[s.pk] = colour
            elif unsized is not None:
                parent = unsized
                labels[s.pk] = " · ".join(b for b in (colour, fmt_size(size) if size else s.pack_size) if b)
            if parent is None:
                no_size.append(s)
            else:
                plan[parent.pk].append(s)

        linked = already = 0
        with transaction.atomic():
            for pack, parent in parents.items():
                rows = sorted(plan.get(parent.pk, []), key=lambda s: labels[s.pk].lower())
                in_stock = [s for s in rows if (on_hand.get(s.id) or 0) > 0]
                self.stdout.write(f"\nبستهٔ سایت {pack} — «{parent.site_name}» {parent.pack_size}: "
                                  f"{len(rows)} زیرمجموعه، {len(in_stock)} موجود")
                for s in rows:
                    label = labels[s.pk]
                    try:
                        fresh = link_variant(parent, s, label)
                    except LinkError as exc:
                        problems.append((s, str(exc)))
                        continue
                    linked += fresh
                    already += not fresh
                    qty = on_hand.get(s.id) or 0
                    if qty > 0:
                        self.stdout.write(f"    موجود: {parent.site_name} ({label})  = {qty:f} {s.base_unit}  [{s.barcode}]")
            if opts["dry_run"]:
                transaction.set_rollback(True)

        self.stdout.write(f"\nوصل شد: {linked} | از قبل وصل بود: {already} | ایراد: {len(problems)} | "
                          f"اندازه‌ای که در سایت نیست: {len(no_size)}")
        for s, why in problems:
            self.stdout.write(self.style.WARNING(f"  ✗ {s.barcode} {s.warehouse_name[:70]}\n      {why}"))
        sizes = defaultdict(int)
        for s in no_size:
            sizes[fmt_size(wh_size(s))] += 1
        if no_size:
            self.stdout.write(self.style.WARNING(f"  بی بستهٔ سایت (بر اساس اندازه): {dict(sizes)}"))
        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))
