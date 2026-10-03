"""تخفیف فاکتور خرید سود دیواژ است و با انتقال به مرکز پوشش محقق می‌شود."""

import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from . import discount_profit
from .models import Product, Sku, StockMovement, StockVoucher, StockVoucherLine, User, Warehouse

DAY = datetime.date(2026, 10, 3)


class DiscountProfitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fin", password="x", name="مالی", role="manager",
                                             access=["financereports"])
        self.central = Warehouse.objects.create(name="انبار مرکزی")
        self.workshop = Warehouse.objects.create(name="مرکز پوشش", supplies_workshop=True)
        product = Product.objects.create(name="Topcoat", brand="Renner")
        self.paint = Sku.objects.create(product=product, warehouse_name="Renner PU", site_package_id="T-1",
                                        base_unit="کیلوگرم")
        self.hard = Sku.objects.create(product=product, warehouse_name="Renner Hardener",
                                       site_package_id="T-2", base_unit="کیلوگرم")

    def _move(self, sku, wh, kind, qty, cost=0, voucher=None, date=DAY):
        return StockMovement.objects.create(sku=sku, warehouse=wh, kind=kind, qty=qty, unit_cost=cost,
                                            voucher=voucher, date=date, created_by=self.user)

    def _invoice(self, discount, lines, number="ورود-1", date=DAY, status="approved", wh=None):
        v = StockVoucher.objects.create(number=number, movement_kind="receipt", status="posted", date=date,
                                        warehouse=wh or self.central, created_by=self.user,
                                        finance_status=status, invoice_discount=discount)
        for sku, qty, cost in lines:
            self._move(sku, wh or self.central, "receipt", qty, cost, v, date)
        return v

    def _transfer(self, sku, qty, date=DAY):
        self._move(sku, self.central, "transfer_out", -qty, date=date)
        self._move(sku, self.workshop, "transfer_in", qty, date=date)

    def test_nothing_is_earned_until_the_goods_move_to_the_workshop(self):
        # ۱۰ کیلو × ۱۰۰ + ۵ کیلو × ۲۰۰ = ۲٬۰۰۰ لیست، ۴۰۰ تخفیف (۲۰٪).
        self._invoice(400, [(self.paint, 10, 100), (self.hard, 5, 200)])
        out = discount_profit.report()
        self.assertEqual(out["totals"], {"discount": 400, "realised": 0, "pending": 400, "invoices": 1})
        self.assertEqual(out["invoices"][0]["percent"], 20)
        self.assertEqual(out["invoices"][0]["paid"], 1600)

    def test_a_partial_transfer_earns_its_share_of_the_discount(self):
        self._invoice(400, [(self.paint, 10, 100), (self.hard, 5, 200)])
        self._transfer(self.paint, 4)          # ۴ کیلو × ۲۰ ریال تخفیف هر کیلو
        out = discount_profit.report()
        self.assertEqual(out["totals"]["realised"], 80)
        self.assertEqual(out["totals"]["pending"], 320)
        line = next(l for l in out["invoices"][0]["lines"] if l["name"] == "Renner PU")
        self.assertEqual((line["moved"], line["listCost"], line["netCost"], line["realised"]), (4, 100, 80, 80))
        self.assertEqual(out["events"][0]["profit"], 80)

    def test_transfers_use_the_oldest_discounted_purchase_first_and_never_exceed_it(self):
        self._invoice(100, [(self.paint, 10, 100)], number="ورود-1", date=DAY)                    # ۱۰ ریال هر کیلو
        self._invoice(300, [(self.paint, 10, 100)], number="ورود-2", date=DAY + datetime.timedelta(days=5))  # ۳۰
        self._transfer(self.paint, 12, date=DAY + datetime.timedelta(days=6))
        out = discount_profit.report()
        self.assertEqual(out["totals"]["realised"], 10 * 10 + 2 * 30)
        # بیشتر از آنچه با تخفیف خریده شده سودی ندارد.
        self._transfer(self.paint, 50, date=DAY + datetime.timedelta(days=7))
        self.assertEqual(discount_profit.report()["totals"], {"discount": 400, "realised": 400, "pending": 0,
                                                                "invoices": 2})

    def test_only_finance_approved_invoices_count_and_a_transfer_before_the_purchase_does_not(self):
        self._invoice(400, [(self.paint, 10, 100)], status="pending")
        self.assertEqual(discount_profit.report()["totals"]["invoices"], 0)
        self._invoice(200, [(self.paint, 10, 100)], number="ورود-2", date=DAY)
        self._transfer(self.paint, 5, date=DAY - datetime.timedelta(days=3))
        self.assertEqual(discount_profit.report()["totals"]["realised"], 0)

    def test_the_item_cost_the_workshop_sees_stays_the_list_price(self):
        self.paint.cost_price = Decimal(100)
        self.paint.save()
        self._invoice(200, [(self.paint, 10, 100)])
        self._transfer(self.paint, 10)
        discount_profit.report()
        self.paint.refresh_from_db()
        self.assertEqual(self.paint.cost_price, 100)

    def test_endpoint_needs_the_finance_reports_key(self):
        self._invoice(200, [(self.paint, 10, 100)])
        api = APIClient()
        api.force_authenticate(self.user)
        self.assertEqual(api.get("/api/finance-reports/discount-profit/").data["totals"]["discount"], 200)
        clerk = User.objects.create_user(username="c", password="x", name="ثبت", role="data_entry",
                                         access=["warehouse"])
        api.force_authenticate(clerk)
        self.assertEqual(api.get("/api/finance-reports/discount-profit/").status_code, 403)

    # ---- سود فروش ----
    def _sale(self, lines, discount=0, number="خروج-1", status="approved", date=DAY):
        v = StockVoucher.objects.create(number=number, movement_kind="sale", status="posted", date=date,
                                        warehouse=self.central, created_by=self.user, counterparty="مشتری",
                                        finance_status=status, invoice_discount=discount)
        for sku, qty, cost, price in lines:
            StockVoucherLine.objects.create(voucher=v, sku=sku, qty=qty, unit_cost=cost, unit_price=price)
            self._move(sku, self.central, "sale", -qty, voucher=v, date=date)
        return v

    def test_a_sale_earns_price_minus_cost_less_its_discount(self):
        self._sale([(self.paint, 2, 100, 150), (self.hard, 1, 200, 260)], discount=20)
        out = discount_profit.report()
        self.assertEqual(out["sales"]["vouchers"][0]["margin"], 2 * 50 + 60 - 20)
        self.assertEqual(out["summary"]["all"]["salesMargin"], 140)
        self.assertEqual(out["summary"]["all"]["total"], 140)

    def test_unapproved_sales_and_lines_without_a_price_earn_nothing(self):
        self._sale([(self.paint, 2, 100, 150)], status="pending")
        self._sale([(self.paint, 2, 0, 150), (self.hard, 1, 200, 260)], number="خروج-2")
        out = discount_profit.report()
        self.assertEqual(out["summary"]["all"]["salesMargin"], 60)
        self.assertEqual((out["sales"]["unpricedLines"], out["sales"]["pendingVouchers"]), (1, 1))

    def test_a_line_cost_far_below_the_item_cost_is_flagged(self):
        self.paint.cost_price = Decimal(1200)
        self.paint.save()
        self._sale([(self.paint, 2, 120, 1350)])
        self.assertEqual(discount_profit.report()["sales"]["suspicious"][0]["itemCost"], 1200)

    def test_selling_discounted_stock_earns_its_discount_too_and_the_total_adds_up(self):
        self._invoice(400, [(self.paint, 10, 100), (self.hard, 5, 200)])     # ۲۰ ریال تخفیف هر کیلو رنگ
        self._transfer(self.paint, 4)
        self._sale([(self.paint, 3, 100, 130)])
        s = discount_profit.report()["summary"]["all"]
        self.assertEqual((s["discountWorkshop"], s["discountSale"], s["salesMargin"]), (80, 60, 90))
        self.assertEqual(s["total"], 230)

    def test_the_month_block_leaves_out_older_sales(self):
        self._sale([(self.paint, 2, 100, 150)], date=discount_profit.month_start() - datetime.timedelta(days=3))
        out = discount_profit.report()
        self.assertEqual((out["summary"]["all"]["salesMargin"], out["summary"]["month"]["salesMargin"]), (100, 0))
        # همان فروش در سه‌ماهه و یک‌ساله هست.
        self.assertEqual(out["summary"]["quarter"]["salesMargin"], 100)
        self.assertEqual(out["summary"]["year"]["salesMargin"], 100)

    def test_month_start_steps_back_across_a_jalali_year(self):
        day = datetime.date(2026, 4, 10)                       # ۲۱ فروردین ۱۴۰۵
        self.assertEqual(discount_profit.month_start(day), datetime.date(2026, 3, 21))
        self.assertEqual(discount_profit.month_start(day, back=2), datetime.date(2026, 1, 21))   # ۱ بهمن ۱۴۰۴

    def test_a_date_range_says_what_was_sold_and_how_much(self):
        self._sale([(self.paint, 2, 100, 150), (self.hard, 1, 200, 260)], discount=20, number="خروج-1", date=DAY)
        self._sale([(self.paint, 3, 100, 160)], number="خروج-2", date=DAY + datetime.timedelta(days=2))
        self._sale([(self.paint, 9, 100, 150)], number="خروج-3", date=DAY + datetime.timedelta(days=40))
        out = discount_profit.report(DAY, DAY + datetime.timedelta(days=5))["range"]
        self.assertEqual(len(out["vouchers"]), 2)
        paint = next(i for i in out["items"] if i["name"] == "Renner PU")
        self.assertEqual((paint["qty"], paint["revenue"], paint["cost"], paint["margin"], paint["vouchers"]),
                         (5, 780, 500, 280, 2))
        self.assertEqual(paint["avgPrice"], 156)
        self.assertEqual((out["salesRevenue"], out["customerDiscount"], out["salesMargin"]), (1020, 20, 320))

    def test_the_endpoint_takes_a_date_range(self):
        self._sale([(self.paint, 2, 100, 150)])
        api = APIClient()
        api.force_authenticate(self.user)
        res = api.get("/api/finance-reports/discount-profit/", {"from": "2030-01-01"})
        self.assertEqual(res.data["range"]["items"], [])
        self.assertEqual(api.get("/api/finance-reports/discount-profit/", {"from": "bad"}).status_code, 400)
