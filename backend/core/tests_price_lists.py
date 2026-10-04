"""لیست قیمت تأمین‌کننده: قیمت بسته با «نام در لیست قیمت» روی کالاها می‌نشیند."""

from decimal import Decimal

from django.test import TestCase

from . import price_lists
from .models import Product, Sku


class PriceListTests(TestCase):
    def _sku(self, name, key, pkg, cost=0):
        return Sku.objects.create(product=Product.objects.create(name=name), warehouse_name=name, site_package_id=pkg,
                                  base_unit="حلب", alt_unit="کیلوگرم", alt_to_base=Decimal("0.08"),
                                  price_list_name=key, cost_price=cost)

    def test_code_matches_whatever_the_dashes(self):
        a = self._sku("هاردنر", "FC---M021/------41", "T-1")
        res = price_lists.apply([("FC-M021/-41", 558565563)])
        a.refresh_from_db()
        self.assertEqual(a.cost_price, Decimal("558565563"))
        self.assertEqual((len(res["changed"]), res["unmatched"]), (1, []))

    def test_every_colour_of_a_pack_takes_the_one_row(self):
        red = self._sku("روغن قرمز", "Grundier Oil 1LT", "T-2")
        blue = self._sku("روغن آبی", "Grundier Oil 1LT", "T-3", cost=99473185)
        other = self._sku("بی‌نام", "", "T-4", cost=5)
        res = price_lists.apply([("Grundier Oil 1LT", 99473185), ("Tung Oil 1LT", 226673269)])
        for s in (red, blue, other):
            s.refresh_from_db()
        self.assertEqual((red.cost_price, blue.cost_price, other.cost_price),
                         (Decimal("99473185"), Decimal("99473185"), Decimal("5")))
        self.assertEqual((len(res["changed"]), res["same"], res["unmatched"]), (1, 1, ["Tung Oil 1LT"]))

    def test_a_row_given_twice_with_two_prices_is_left_alone(self):
        a = self._sku("تاپ‌کوت", "JO-30C070/------55", "T-5", cost=7)
        res = price_lists.apply([("JO-30C070/------55", 100), ("JO-30C070/-------55", 200)])
        a.refresh_from_db()
        self.assertEqual(a.cost_price, Decimal("7"))
        self.assertEqual(len(res["clash"]), 1)
