"""ویرایش حوالهٔ ثبت نهایی‌شده با مجوز مدیر: موجودی از نو حساب می‌شود و ردِ تغییر زیر حواله می‌ماند."""

import datetime
from decimal import Decimal

from django.db.models import Sum
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (Product, Sku, StockMovement, StockVoucher, StockVoucherAmendment, StockVoucherLine, User,
                     Warehouse)

DAY = "2026-10-03"


class VoucherAmendTests(TestCase):
    def setUp(self):
        self.boss = User.objects.create_user(
            username="boss", password="x", name="امیر غیاثی", role="manager",
            access=["warehouse", "warehouse.voucher", "warehouse.post", "warehouse.amend"])
        self.clerk = User.objects.create_user(
            username="clerk", password="x", name="انباردار", role="data_entry",
            access=["warehouse", "warehouse.voucher", "warehouse.post"])
        self.main = Warehouse.objects.create(name="انبار آزمایش مرکزی")
        self.other = Warehouse.objects.create(name="انبار آزمایش دوم")
        self.sku = Sku.objects.create(product=Product.objects.create(name="Hogun Fresh Base", brand="Hogun"),
                                      warehouse_name="Hogun - Fresh Base 20Kg", site_package_id="T-H1",
                                      base_unit="حلب", alt_unit="کیلوگرم", alt_to_base=Decimal("0.05"))
        self.api = APIClient()
        self.api.force_authenticate(self.boss)
        self.receipt = self._voucher("receipt", 10, counterparty="تأمین‌کننده")
        self.sale = self._voucher("sale", 4, counterparty="کیان کار صفاهان")

    def _body(self, kind, qty, **extra):
        return {"movementKind": kind, "date": DAY, "warehouse": str(self.main.pk),
                "lines": [{"sku": str(self.sku.pk), "qty": qty, "unit": "", "unitCost": 0}], **extra}

    def _voucher(self, kind, qty, **extra):
        r = self.api.post("/api/stock-vouchers/", self._body(kind, qty, **extra), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        p = self.api.post(f"/api/stock-vouchers/{r.json()['id']}/post_voucher/", {}, format="json")
        self.assertEqual(p.status_code, 200, p.content)
        return StockVoucher.objects.get(pk=r.json()["id"])

    def _stock(self, warehouse=None):
        return StockMovement.objects.filter(sku=self.sku, warehouse=warehouse or self.main).aggregate(q=Sum("qty"))["q"]

    def _amend(self, voucher, qty, reason="اشتباه در تعداد", kind=None, **extra):
        return self.api.post(f"/api/stock-vouchers/{voucher.pk}/amend/",
                             {**self._body(kind or voucher.movement_kind, qty, **extra), "reason": reason}, format="json")

    def test_quantity_change_fixes_stock_and_leaves_a_trace(self):
        StockVoucher.objects.filter(pk=self.sale.pk).update(finance_status="approved")
        StockVoucherLine.objects.filter(voucher=self.sale).update(unit_price=Decimal("66000000"), invoice_qty=4)
        self.assertEqual(self._stock(), 6)

        r = self._amend(self.sale, 2, counterparty="کیان کار صفاهان")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self._stock(), 8)
        note = r.json()["amendments"][0]
        self.assertEqual((note["by"], note["reason"]), ("امیر غیاثی", "اشتباه در تعداد"))
        self.assertIn("Hogun - Fresh Base 20Kg: مقدار ۴ حلب ← ۲ حلب", note["changes"])
        # مالی همین مقدار را تأیید کرده بود؛ باید دوباره ببیند، ولی آنچه نوشته بود می‌ماند.
        self.assertEqual(r.json()["financeStatus"], "pending")
        line = StockVoucherLine.objects.get(voucher=self.sale)
        self.assertEqual((line.unit_price, line.invoice_qty), (Decimal("66000000"), Decimal("4")))
        self.assertEqual(StockVoucher.objects.get(pk=self.sale.pk).status, "posted")

    def test_header_change_keeps_the_finance_approval(self):
        StockVoucher.objects.filter(pk=self.sale.pk).update(finance_status="approved")
        r = self._amend(self.sale, 4, counterparty="شرکت کیان کار صفاهان", reason="نام مشتری کامل شد")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["financeStatus"], "approved")
        self.assertEqual(self._stock(), 6)
        self.assertEqual(r.json()["amendments"][0]["changes"], ["طرف مقابل: «کیان کار صفاهان» ← «شرکت کیان کار صفاهان»"])

    def test_change_that_empties_the_warehouse_is_refused_whole(self):
        r = self._amend(self.sale, 20, counterparty="کیان کار صفاهان")
        self.assertEqual(r.status_code, 400, r.content)
        short = r.json()["shortage"]
        self.assertTrue(short["amend"])
        self.assertEqual((short["items"][0]["need"], short["items"][0]["have"]), (16.0, 6.0))
        self.assertEqual(self._stock(), 6)
        self.assertEqual(StockVoucherLine.objects.get(voucher=self.sale).qty, 4)
        self.assertFalse(StockVoucherAmendment.objects.exists())

    def test_shrinking_a_receipt_below_what_was_sold_is_refused(self):
        r = self._amend(self.receipt, 3, counterparty="تأمین‌کننده")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("shortage", r.json())
        self.assertEqual(self._stock(), 6)

    def test_only_the_amend_key_may_do_it_and_a_reason_is_required(self):
        self.api.force_authenticate(self.clerk)
        self.assertEqual(self._amend(self.sale, 2, counterparty="کیان کار صفاهان").status_code, 403)
        self.api.force_authenticate(self.boss)
        self.assertEqual(self._amend(self.sale, 2, reason="  ", counterparty="کیان کار صفاهان").status_code, 400)
        self.assertEqual(self._amend(self.sale, 4, counterparty="کیان کار صفاهان").status_code, 400)   # چیزی عوض نشده
        self.assertEqual(self._amend(self.sale, 2, kind="workshop", counterparty="کیان کار صفاهان").status_code, 400)
        self.assertEqual(self._stock(), 6)
        self.assertFalse(StockVoucherAmendment.objects.exists())

    def test_draft_is_not_amended(self):
        r = self.api.post("/api/stock-vouchers/", self._body("sale", 1, counterparty="x"), format="json")
        draft = StockVoucher.objects.get(pk=r.json()["id"])
        self.assertEqual(self._amend(draft, 2, counterparty="x").status_code, 400)

    def test_transfer_moves_both_sides(self):
        t = self._voucher("transfer_out", 3, toWarehouse=str(self.other.pk))
        self.assertEqual((self._stock(), self._stock(self.other)), (3, 3))
        r = self._amend(t, 5, toWarehouse=str(self.other.pk), reason="دو حلب دیگر هم رفت")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((self._stock(), self._stock(self.other)), (1, 5))
        self.assertEqual(StockMovement.objects.filter(voucher=t).count(), 2)

    def test_date_change_moves_the_movements(self):
        r = self._amend(self.sale, 4, counterparty="کیان کار صفاهان", date="2026-10-01", reason="تاریخ اشتباه بود")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(StockMovement.objects.get(voucher=self.sale).date, datetime.date(2026, 10, 1))
        self.assertEqual(r.json()["amendments"][0]["changes"], ["تاریخ: ۱۴۰۵/۰۷/۱۱ ← ۱۴۰۵/۰۷/۰۹"])
