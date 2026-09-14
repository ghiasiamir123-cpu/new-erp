"""کالاهای انبار را زیرمجموعهٔ بسته‌های سایت می‌کند — یک جنس در هر اجرا.

    python manage.py link_site_variants --packs 1848,1849,1850,1851 --family "Oil Base - Grundier Oil" --dry-run
    python manage.py link_site_variants --packs 2248,2310,2311 --family "Square" --by article --dry-run

--by size (پیش‌فرض): هر بستهٔ سایت (یک اندازه، بی رنگ) همهٔ کالاهای انبارِ همان جنس و همان
اندازه را می‌گیرد؛ جنس = متن داخل کروشهٔ نام انبار بدون بخش آخر، و رنگ = بخش آخر. اگر یکی
از بسته‌ها اندازه ندارد، اندازه‌هایی را که بستهٔ هم‌اندازه ندارند می‌گیرد و برچسبشان
«رنگ · اندازه» می‌شود.

--by article: سایت برای هر طرح و اندازه یک بسته دارد (شابلون‌های مارمورینو)؛ هر بسته با
شمارهٔ Art، و اگر نبود با ابعاد، دقیقاً یک کالای انبار می‌گیرد و برچسبش «ابعاد · Art n» است.

قاعده‌ها در core/linking.py (plan_variants) است و صفحهٔ «بازبینی انبار» هم همان را به کار می‌برد.
چیزی جابه‌جا یا حذف نمی‌شود. برچسب (رنگ، اندازه، طرح) فقط برای انبار است و به سایت فروش
فرستاده نمی‌شود.
"""
import re
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum

from core.linking import (LinkError, apply_variant_plan, brand_key, family_of, plan_variants, size_text,
                          wh_size)
from core.models import Sku, StockMovement


class Command(BaseCommand):
    help = "کالاهای انبارِ یک جنس را زیرمجموعهٔ بسته‌های سایت می‌کند (بر اساس اندازه یا شمارهٔ طرح)"

    def add_arguments(self, parser):
        parser.add_argument("--packs", required=True, help="شناسه‌های بستهٔ سایت، با ویرگول")
        parser.add_argument("--family", required=True,
                            help="جنس داخل کروشهٔ نام انبار بدون بخش آخر، مثل «Oil Base - Grundier Oil» یا «Square»")
        parser.add_argument("--by", choices=("size", "article"), default="size",
                            help="size: همهٔ رنگ‌های هم‌اندازه زیر هر بسته | article: هر بسته یک طرح با شمارهٔ Art")
        parser.add_argument("--dry-run", action="store_true", help="انجام و برگرداندن")

    def handle(self, *args, **opts):
        packs = [p.strip() for p in re.split(r"[,\s]+", opts["packs"]) if p.strip()]
        family = re.sub(r"\s+", " ", opts["family"]).strip().lower()
        parents = {p: Sku.objects.filter(shop_pack_id=p).select_related("product").first() for p in packs}
        missing = [p for p, s in parents.items() if s is None]
        if missing:
            raise CommandError(f"این شناسه‌های سایت پیدا نشد: {', '.join(missing)}")
        brands = {brand_key(s.product.brand) for s in parents.values()}
        members = [s for s in Sku.objects.filter(is_asset=False, shop_pack_id="")
                   .exclude(warehouse_name="").select_related("product", "site_parent")
                   if family_of(s.warehouse_name).lower() == family and brand_key(s.product.brand) in brands]
        if not members:
            raise CommandError(f"هیچ کالای انباری با جنس «{opts['family']}» پیدا نشد.")
        on_hand = dict(StockMovement.objects.filter(sku__in=members).values("sku_id")
                       .annotate(q=Sum("qty")).values_list("sku_id", "q"))

        try:
            plan, skipped, leftover = plan_variants(parents.values(), members, opts["by"])
        except LinkError as exc:
            raise CommandError(str(exc))
        done, problems = apply_variant_plan(plan, dry_run=opts["dry_run"])

        by_parent = defaultdict(list)
        for parent, w, label, fresh in done:
            by_parent[parent.pk].append((w, label))
        for pack, parent in parents.items():
            rows = sorted(by_parent.get(parent.pk, []), key=lambda r: r[1].lower())
            in_stock = [w for w, _ in rows if (on_hand.get(w.id) or 0) > 0]
            self.stdout.write(f"\nبستهٔ سایت {pack} — «{parent.site_name}» {parent.pack_size}: "
                              f"{len(rows)} زیرمجموعه، {len(in_stock)} موجود")
            for w, label in rows:
                qty = on_hand.get(w.id) or 0
                shown = f"= {qty:f} {w.base_unit}" if qty > 0 else "ناموجود"
                if opts["by"] == "article" or qty > 0:
                    self.stdout.write(f"    {parent.site_name} ({label})  {shown}  [{w.barcode}]")

        linked = sum(1 for *_, fresh in done if fresh)
        self.stdout.write(f"\nوصل شد: {linked} | از قبل وصل بود: {len(done) - linked} | "
                          f"ایراد: {len(problems) + len(skipped)} | کالای انبارِ بی‌بستهٔ سایت: {len(leftover)}")
        for p, why in skipped:
            self.stdout.write(self.style.WARNING(f"  ✗ بستهٔ سایت {p.shop_pack_id} «{p.site_name}» {p.pack_size}: {why}"))
        for s, why in problems:
            self.stdout.write(self.style.WARNING(f"  ✗ {s.barcode} {s.warehouse_name[:70]}\n      {why}"))
        if leftover:
            if opts["by"] == "article":
                for s in leftover:
                    self.stdout.write(self.style.WARNING(f"  در سایت نیست: {s.barcode} {s.warehouse_name[:80]}"))
            else:
                sizes = defaultdict(int)
                for s in leftover:
                    sizes[size_text(wh_size(s)) or "?"] += 1
                self.stdout.write(self.style.WARNING(f"  بی بستهٔ سایت (بر اساس اندازه): {dict(sizes)}"))
        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))
