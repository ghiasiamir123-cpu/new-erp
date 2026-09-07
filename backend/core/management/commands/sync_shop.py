"""همگام‌سازی کاتالوگ با سایت فروش.

کالاهای سایت را می‌گیرد و قیمت، نام، دسته و وزن را به‌روز می‌کند. کلید اتصال
«شناسهٔ بسته» (pack_id) است که در هر دو سیستم یکی است.

    python manage.py sync_shop --dry-run
    python manage.py sync_shop

آنچه دست نمی‌خورد: قیمت خرید، واحدها، موجودی، قفسه — این‌ها مال ما هستند نه سایت.
"""

from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Product, Sku
from core.shop import ShopError, fetch_items


def dec(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError):
        return None


class Command(BaseCommand):
    help = "گرفتن کاتالوگ از سایت فروش و به‌روزرسانی قیمت و مشخصات"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="فقط گزارش بده، چیزی ذخیره نکن")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        try:
            items = fetch_items()
        except ShopError as e:
            self.stderr.write(self.style.ERROR(str(e)))
            return

        self.stdout.write(f"از سایت گرفته شد: {len(items)} قلم")

        skus = {s.site_package_id: s for s in Sku.objects.select_related("product")}
        stats = {"price": 0, "weight": 0, "name": 0, "category": 0, "missing": 0, "same": 0}
        missing = []

        with transaction.atomic():
            for it in items:
                pid = str(it.get("pack_id") or "")
                sku = skus.get(pid)
                if sku is None:
                    stats["missing"] += 1
                    missing.append((pid, it.get("name", "")[:52]))
                    continue

                changed = []
                price = dec(it.get("price_rial"))
                if price is not None and sku.sale_price != price:
                    sku.sale_price = price
                    changed.append("sale_price")
                    stats["price"] += 1

                weight = dec(it.get("weight_kg"))
                if weight is not None and sku.weight_kg != weight:
                    sku.weight_kg = weight
                    changed.append("weight_kg")
                    stats["weight"] += 1

                if changed:
                    sku.save(update_fields=changed)
                else:
                    stats["same"] += 1

                p = sku.product
                pchanged = []
                name = (it.get("name") or "").strip()
                if name and p.name != name:
                    p.name = name
                    pchanged.append("name")
                    stats["name"] += 1
                cat = (it.get("category") or "").strip()
                if cat and p.category != cat:
                    p.category = cat
                    pchanged.append("category")
                    stats["category"] += 1
                if pchanged:
                    p.save(update_fields=pchanged)

            if dry:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))

        self.stdout.write("")
        for k, label in (
            ("price", "قیمت به‌روز شد"), ("weight", "وزن به‌روز شد"),
            ("name", "نام به‌روز شد"), ("category", "دسته به‌روز شد"),
            ("same", "بدون تغییر"), ("missing", "در سامانه نبود"),
        ):
            self.stdout.write(f"  {label}: {stats[k]}")

        if missing:
            self.stdout.write(self.style.WARNING(
                f"\n{len(missing)} قلم در سایت هست ولی در سامانه نیست — "
                "فایل انبارگردانی سایت را دوباره وارد کنید:"))
            for pid, name in missing[:10]:
                self.stdout.write(f"    شناسه {pid}: {name}")
