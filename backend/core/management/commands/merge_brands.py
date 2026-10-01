"""برندهایی که با دو نام در انبارند («پراتا» و «Pratta») یکی می‌شوند؛ نام انگلیسی می‌ماند.

    python manage.py merge_brands            # تمرین: همه‌چیز انجام و در پایان برگردانده می‌شود
    python manage.py merge_brands --apply    # ثبت واقعی

نام برند در اثر انگشتِ «بازبینی انبار» هم هست؛ پس تیک‌هایی که پیش از تغییر «به‌روز» بوده‌اند پس از آن
دوباره اثر انگشت می‌گیرند تا فقط به‌خاطر عوض شدن نام برند «تغییر کرده» دیده نشوند. تیکی که از قبل
«تغییر کرده» بوده همان می‌ماند.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from core import review
from core.brands import canonical
from core.models import FamilyReview, Product, StockCount


class Rehearsal(Exception):
    pass


class Command(BaseCommand):
    help = "برندهای دونامه را یکی می‌کند (نام انگلیسی می‌ماند)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="بدون این، فقط تمرین است و چیزی ذخیره نمی‌شود.")

    def handle(self, *args, **opts):
        out = self.stdout.write
        try:
            with transaction.atomic():
                self._run(out)
                if not opts["apply"]:
                    raise Rehearsal()
            out("ثبت شد.")
        except Rehearsal:
            out("تمرین بود — همه‌چیز برگردانده شد و چیزی ذخیره نشد.")

    def _run(self, out):
        renames = Counter()
        for brand in Product.objects.exclude(brand="").values_list("brand", flat=True).distinct():
            if canonical(brand) != brand:
                renames[brand] = Product.objects.filter(brand=brand).count()
        if not renames:
            out("برند دونامه‌ای نیست.")
            return

        # تیک‌های بازبینی که الان به‌روزند، با کالاهای خانواده‌شان
        before = review.Context()
        current = {}
        for r in FamilyReview.objects.all():
            fam = before.families.get(r.key)
            if fam is not None and r.fingerprint == review.fingerprint(fam):
                current[r.pk] = frozenset(s.pk for s in fam["items"])

        for brand, n in sorted(renames.items(), key=lambda x: -x[1]):
            new = canonical(brand)
            already = Product.objects.filter(brand=new).count()
            Product.objects.filter(brand=brand).update(brand=new)
            out(f"  «{brand}» ← «{new}»: {n} کالا" + (f" (به {already} کالای «{new}» پیوست)" if already else ""))
        sheets = 0
        for model in (StockCount, FamilyReview):
            for brand in model.objects.exclude(brand="").values_list("brand", flat=True).distinct():
                if canonical(brand) != brand:
                    n = model.objects.filter(brand=brand).update(brand=canonical(brand))
                    sheets += n if model is StockCount else 0
        out(f"  برچسب برند {sheets} برگهٔ انبارگردانی هم اصلاح شد.")

        # همان تیک‌ها با نام تازهٔ برند دوباره اثر انگشت می‌گیرند
        after = review.Context()
        key_of = {s.pk: key for key, fam in after.families.items() for s in fam["items"]}
        kept = moved = lost = 0
        for r in FamilyReview.objects.filter(pk__in=current):
            items = current[r.pk]
            key = key_of.get(next(iter(items))) if items else None
            fam = after.families.get(key) if key else None
            if fam is None or frozenset(s.pk for s in fam["items"]) != items:
                lost += 1          # خانواده با یکی شدن برند بزرگ‌تر شده؛ باید دوباره دیده شود
                continue
            fields = ["fingerprint"]
            r.fingerprint = review.fingerprint(fam)
            if key != r.key:
                if FamilyReview.objects.filter(key=key).exclude(pk=r.pk).exists():
                    lost += 1
                    continue
                r.key = key
                fields.append("key")
                moved += 1
            FamilyReview.objects.filter(pk=r.pk).update(**{f: getattr(r, f) for f in fields})
            kept += 1

        left = sorted(b for b in Product.objects.exclude(brand="").values_list("brand", flat=True).distinct()
                      if any("؀" <= ch <= "ۿ" for ch in b))
        out(f"  تیک‌های بازبینی: {FamilyReview.objects.count()} تا؛ {len(current)} تا به‌روز بود، {kept} تا به‌روز ماند"
            + (f" ({moved} تا با کلید تازه)" if moved else "") + (f"، {lost} تا باید دوباره دیده شود" if lost else "") + ".")
        out(f"  جمع: {sum(renames.values())} کالا در {len(renames)} نام. برند فارسیِ باقی‌مانده: {left or 'ندارد'}")
