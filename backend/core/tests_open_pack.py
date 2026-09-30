"""حلبِ باز در انبار مصرفی: مصرفِ کیلویی از حلب کم می‌شود و کاردکس مقدارِ واردشده را نشان می‌دهد."""

import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from .models import MaterialUsage, MaterialUsageReport, Product, Sku, StockMovement, User, Warehouse
from .views import sync_usage_stock

DAY = datetime.date(2026, 9, 30)


class OpenPackTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["warehouse", "materials"])
        # یک مهاجرت انبار مصرفیِ تولید را از پیش می‌سازد؛ مصرف همیشه از همان کم می‌شود.
        self.shop = (Warehouse.objects.filter(supplies_workshop=True, active=True).order_by("id").first()
                     or Warehouse.objects.create(name="انبار مصرفی", supplies_workshop=True))
        self.sku = Sku.objects.create(product=Product.objects.create(name="آستر"), warehouse_name="آستر ۱۸ کیلویی",
                                      site_package_id="T-1", pack_size="18KG", base_unit="حلب",
                                      alt_unit="کیلوگرم", alt_to_base=Decimal("0.055556"))
        StockMovement.objects.create(sku=self.sku, warehouse=self.shop, kind="transfer_in", qty=1, date=DAY,
                                     created_by=self.user)
        self.report = MaterialUsageReport.objects.create(date=DAY, recorded_by=self.user, recorded_by_name="مدیر",
                                                         status="approved")
        MaterialUsage.objects.create(report=self.report, sku=self.sku, material_name="آستر", unit="کیلوگرم",
                                     quantity=2)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def kardex(self):
        r = self.client.get("/api/stock-movements/kardex/", {"sku": self.sku.pk, "warehouse": self.shop.pk})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_two_kilos_come_off_the_tin_and_show_in_the_kardex(self):
        sync_usage_stock(self.report, self.user)
        d = self.kardex()
        self.assertEqual(d["sku"]["altUnit"], "کیلوگرم")
        self.assertAlmostEqual(d["sku"]["altToBase"], 0.055556)
        use = d["rows"][-1]
        self.assertEqual(use["kind"], "workshop")
        self.assertEqual((use["enteredQty"], use["enteredUnit"]), (2.0, "کیلوگرم"))
        self.assertAlmostEqual(use["out"], 0.111)
        # ۱ حلب ۱۸ کیلویی منهای ۲ کیلو = ۱۶ کیلو در حلبِ باز.
        self.assertAlmostEqual(d["closing"], 0.889)
        self.assertAlmostEqual(d["closing"] * 18, 16, places=1)

    def test_revision_puts_the_kilos_back(self):
        sync_usage_stock(self.report, self.user)
        self.report.status = MaterialUsageReport.Status.REVISION
        self.report.save()
        sync_usage_stock(self.report, self.user)
        d = self.kardex()
        self.assertAlmostEqual(d["closing"], 1.0)
        self.assertEqual([r["kind"] for r in d["rows"]], ["transfer_in"])
        self.assertIsNone(d["rows"][0]["enteredQty"])


class ApprovalShortageTests(TestCase):
    """تأیید گزارش مصرف وقتی انبار مصرفی کم دارد: اول هشدار، با force تأیید."""

    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["warehouse", "materials", "reports", "reports.review"])
        self.shop = (Warehouse.objects.filter(supplies_workshop=True, active=True).order_by("id").first()
                     or Warehouse.objects.create(name="انبار مصرفی", supplies_workshop=True))
        self.central = Warehouse.objects.exclude(pk=self.shop.pk).first() or Warehouse.objects.create(name="مرکزی")
        self.sku = Sku.objects.create(product=Product.objects.create(name="رویه"), warehouse_name="رویه ۵ کیلویی",
                                      site_package_id="T-2", pack_size="5KG", base_unit="حلب",
                                      alt_unit="کیلوگرم", alt_to_base=Decimal("0.2"))
        StockMovement.objects.create(sku=self.sku, warehouse=self.central, kind="receipt", qty=3, date=DAY,
                                     created_by=self.user)
        self.report = MaterialUsageReport.objects.create(date=DAY, recorded_by=self.user, recorded_by_name="مدیر",
                                                         status="waiting")
        MaterialUsage.objects.create(report=self.report, sku=self.sku, material_name="رویه", unit="کیلوگرم",
                                     quantity=2)
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def approve(self, **extra):
        return self.api.post(f"/api/material-usages/{self.report.pk}/feedback/",
                             {"status": "approved", "text": "خوب", **extra}, format="json")

    def test_short_stock_warns_and_changes_nothing(self):
        r = self.approve()
        self.assertEqual(r.status_code, 409, r.content)
        item = r.json()["stockShortage"]["items"][0]
        self.assertEqual((item["need"], item["have"], item["altUnit"]), (0.4, 0.0, "کیلوگرم"))
        self.assertEqual(item["elsewhere"][0]["qty"], 3.0)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, "waiting")
        self.assertFalse(self.report.feedback.exists())
        self.assertFalse(StockMovement.objects.filter(kind="workshop").exists())

    def test_force_approves_anyway(self):
        r = self.approve(force=True)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "approved")
        m = StockMovement.objects.get(kind="workshop")
        self.assertEqual((m.qty, m.warehouse_id), (Decimal("-0.400"), self.shop.pk))

    def test_enough_stock_approves_without_asking(self):
        StockMovement.objects.create(sku=self.sku, warehouse=self.shop, kind="transfer_in", qty=1, date=DAY,
                                     created_by=self.user)
        r = self.approve()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "approved")
