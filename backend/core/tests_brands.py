"""یک برند، یک نام: «پراتا» و «Pratta» یکی‌اند و نام انگلیسی می‌ماند."""

import datetime
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from . import review
from .brands import canonical
from .models import FamilyReview, Product, Sku, StockCount, User, Warehouse
from .serializers import ItemSerializer


class Req:
    def __init__(self, user):
        self.user = user


class BrandTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="w", password="x", name="انبار", role="manager",
                                             access=["warehouse"])

    def _sku(self, code, name, brand):
        return Sku.objects.create(product=Product.objects.create(name=name, brand=brand, code=code),
                                  site_package_id=code, warehouse_name=name, base_unit="حلب")

    def test_known_names_map_to_english_and_others_stay(self):
        self.assertEqual(canonical("پراتا"), "Pratta")
        self.assertEqual(canonical(" pratta "), "Pratta")
        self.assertEqual(canonical("رنر ایتالیا"), "Renner")
        self.assertEqual(canonical("hugon"), "Hogun")
        self.assertEqual(canonical("Sumake"), "Sumake")
        self.assertEqual(canonical("متفرقه"), "متفرقه")
        self.assertEqual(canonical(None), "")

    def test_merge_keeps_one_name_and_review_ticks(self):
        a = self._sku("P-1", "Pratta - Stucco [Antico - Base] 20Kg", "پراتا")
        self._sku("P-2", "Pratta - Stucco [Antico - Base] 5Kg", "pratta")
        self._sku("S-1", "Sumake - Sander [ST-7712]", "Sumake")
        wh = Warehouse.objects.create(name="انبار آزمایش")
        StockCount.objects.create(number="c-1", title="شمارش", date=datetime.date(2026, 10, 1), warehouse=wh,
                                  brand="پراتا", created_by=self.user)
        key, _ = review.family_of_sku(a)
        review.mark_family(key, "ok", "", self.user)
        stamped = FamilyReview.objects.get(key=key).reviewed_at

        out = StringIO()
        call_command("merge_brands", stdout=out)                     # تمرین: چیزی عوض نمی‌شود
        self.assertEqual(Product.objects.filter(brand="پراتا").count(), 1)
        call_command("merge_brands", "--apply", stdout=out)

        self.assertEqual(sorted(Product.objects.values_list("brand", flat=True)), ["Pratta", "Pratta", "Sumake"])
        self.assertEqual(StockCount.objects.get(number="c-1").brand, "Pratta")
        tick = FamilyReview.objects.get(key=key)
        fam = review.Context().families[key]
        self.assertEqual(tick.fingerprint, review.fingerprint(fam))   # هنوز «به‌روز» است
        self.assertEqual((tick.brand, tick.reviewed_at), ("Pratta", stamped))

    def test_item_form_cannot_bring_the_persian_name_back(self):
        ser = ItemSerializer(data={"warehouseName": "Pratta - Stucco [Velluto] 5Kg", "brand": "پراتا"},
                             context={"request": Req(self.user)})
        ser.is_valid(raise_exception=True)
        sku = ser.save()
        self.assertEqual(sku.product.brand, "Pratta")
        ser = ItemSerializer(sku, data={"brand": "میرکا"}, partial=True, context={"request": Req(self.user)})
        ser.is_valid(raise_exception=True)
        self.assertEqual(ser.save().product.brand, "Mirka")
