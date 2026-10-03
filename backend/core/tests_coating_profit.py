"""سود مرکز پوشش: دستمزد + متریال هر پروژه، ایرادهای قیمت، و سود در برابر دریافتی."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import coating_profit
from .models import (DailyReport, Employee, MaterialUsage, MaterialUsageReport, ProductionSettings, Product,
                     Project, ProjectReceipt, ReportItem, Sku, User)

DAY = datetime.date(2026, 10, 3)


class CoatingProfitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fin", password="x", name="مالی", role="manager",
                                             access=["financereports", "financereports.costs"])
        self.project = Project.objects.create(name="مطهری", code="1405-001", base_area=100, price=50_000_000)
        product = Product.objects.create(name="Topcoat", brand="Renner")
        # حلب ۱۸ کیلویی، قیمت هر حلب ۹٬۰۰۰٬۰۰۰
        self.paint = Sku.objects.create(product=product, warehouse_name="Renner PU", site_package_id="T-1",
                                        base_unit="حلب", alt_unit="کیلوگرم", alt_to_base="0.055556",
                                        cost_price=9_000_000)
        self.tape = Sku.objects.create(product=product, warehouse_name="نوار چسب", site_package_id="T-2",
                                       base_unit="عدد")
        Employee.objects.create(name="علی رضایی", hourly_cost=1_000_000)
        Employee.objects.create(name="حسن")
        self.work = DailyReport.objects.create(date=DAY, shift="صبح", supervisor=self.user,
                                               supervisor_name="مالی", status="approved")
        self.usage = MaterialUsageReport.objects.create(date=DAY, recorded_by=self.user,
                                                        recorded_by_name="مالی", status="approved")

    def _hours(self, who, h, report=None):
        ReportItem.objects.create(report=report or self.work, employee=who, project=self.project,
                                  activity="رنگ", hours=h)

    def _use(self, sku, qty, unit, report=None, name=""):
        MaterialUsage.objects.create(report=report or self.usage, project=self.project, sku=sku,
                                     material_name=name, unit=unit, quantity=qty)

    def test_cost_is_labour_plus_material_and_profit_is_against_receipts(self):
        self._hours("علی رضایی", 10)                 # ۱۰ × ۱٬۰۰۰٬۰۰۰
        self._use(self.paint, 9, "کیلوگرم")          # نیم حلب ≈ ۴٬۵۰۰٬۰۰۰
        ProjectReceipt.objects.create(project=self.project, date=DAY, amount=20_000_000)
        p = coating_profit.report()["projects"][0]
        self.assertEqual(p["labour"], 10_000_000)
        self.assertEqual(p["material"], 4_500_000)
        self.assertEqual(p["cost"], p["labour"] + p["material"])
        self.assertEqual(p["profit"], 20_000_000 - p["cost"])
        self.assertEqual(p["contractProfit"], 50_000_000 - p["cost"])
        self.assertEqual(p["receivable"], 30_000_000)
        self.assertTrue(p["complete"])

    def test_missing_rate_and_price_are_reported_not_counted(self):
        self._hours("حسن", 5)
        self._use(self.tape, 3, "عدد")
        self._use(None, 2, "عدد", name="فوم")
        out = coating_profit.report()
        p = out["projects"][0]
        self.assertEqual((p["labour"], p["material"]), (0, 0))
        self.assertFalse(p["complete"])
        self.assertEqual(p["issues"]["labourMissing"], 1)
        self.assertEqual(p["issues"]["material"], 2)
        self.assertEqual({i["reason"] for i in out["issues"]["material"]}, {"no_price", "no_sku"})
        self.assertEqual(out["issues"]["labour"][0]["severity"], "none")

    def test_workshop_average_covers_a_worker_without_a_rate(self):
        ProductionSettings.objects.update_or_create(pk=1, defaults={"labour_cost_per_hour": 400_000})
        self._hours("حسن", 5)
        p = coating_profit.report()["projects"][0]
        self.assertEqual(p["labour"], 2_000_000)
        self.assertEqual(p["issues"]["labourEstimated"], 1)
        self.assertTrue(p["complete"])

    def test_unapproved_reports_stay_out_of_cost(self):
        draft = DailyReport.objects.create(date=DAY, shift="عصر", supervisor=self.user,
                                           supervisor_name="مالی", status="waiting")
        self._hours("علی رضایی", 4, report=draft)
        self._hours("علی رضایی", 1)
        p = coating_profit.report()["projects"][0]
        self.assertEqual(p["labour"], 1_000_000)
        self.assertEqual(p["issues"]["pendingWork"], 1)

    def test_fixing_from_the_report_updates_the_cost(self):
        c = APIClient()
        c.force_authenticate(self.user)
        self._hours("حسن", 5)
        self._hours("کارگر قدیمی", 2)
        self._use(self.tape, 3, "عدد")
        self._use(self.tape, 2, "بسته")
        hassan = Employee.objects.get(name="حسن")
        self.assertEqual(c.post("/api/finance-reports/coating-rate/",
                                {"employee": hassan.pk, "hourlyCost": 500_000}, format="json").status_code, 200)
        self.assertEqual(c.post("/api/finance-reports/coating-rate/",
                                {"name": "کارگر قدیمی", "hourlyCost": 300_000}, format="json").status_code, 200)
        self.assertFalse(Employee.objects.get(name="کارگر قدیمی").active)
        self.assertEqual(c.post("/api/finance-reports/coating-price/",
                                {"sku": self.tape.pk, "costPrice": 10_000}, format="json").status_code, 200)
        self.assertEqual(c.post("/api/finance-reports/coating-unit/",
                                {"sku": self.tape.pk, "unit": "بسته", "perBase": 0.1}, format="json").status_code, 200)
        r = c.get(f"/api/finance-reports/coating-profit/?project={self.project.pk}")
        p = r.json()["project"]
        self.assertEqual(p["labour"], 2_500_000 + 600_000)
        self.assertEqual(p["material"], 30_000 + 200_000)     # ۲ بسته = ۲۰ عدد
        self.assertTrue(p["complete"])

    def test_receipts_and_contract_are_editable_only_with_the_costs_key(self):
        c = APIClient()
        c.force_authenticate(self.user)
        r = c.post("/api/finance-reports/coating-receipts/",
                   {"project": self.project.pk, "date": "2026-10-03", "amount": 7_000_000, "note": "چک"},
                   format="json")
        self.assertEqual(r.status_code, 201)
        c.post("/api/finance-reports/coating-contract/", {"project": self.project.pk, "price": 60_000_000},
               format="json")
        p = c.get(f"/api/finance-reports/coating-profit/?project={self.project.pk}").json()["project"]
        self.assertEqual((p["received"], p["contract"]), (7_000_000, 60_000_000))
        self.assertEqual(p["receipts"][0]["note"], "چک")
        self.assertEqual(c.delete(f"/api/finance-reports/coating-receipts/{r.json()['id']}/").status_code, 204)

        viewer = User.objects.create_user(username="v", password="x", name="بیننده", access=["financereports"])
        c.force_authenticate(viewer)
        self.assertEqual(c.get("/api/finance-reports/coating-profit/").status_code, 200)
        self.assertEqual(c.post("/api/finance-reports/coating-receipts/",
                                {"project": self.project.pk, "date": "2026-10-03", "amount": 1},
                                format="json").status_code, 403)
