"""پارامترهای تازهٔ گزارش‌ها: دوباره‌کاری با علت، اضافه‌کاری، محل کار، مرحله و نوعِ مصرف مواد."""

import datetime
from decimal import Decimal

from django.db.models import Sum
from django.test import TestCase
from rest_framework.test import APIClient

from . import production
from .models import (DailyReport, MaterialUsage, MaterialUsageReport, Product, Project, ReportItem, Sku,
                     StockMovement, User, Warehouse, WorkStage)
from .views import sync_usage_stock, usage_shortages

DAY = datetime.date(2026, 10, 3)


class WorkItemParamTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="sup", password="x", name="سرپرست",
                                             access=["entry", "entry.create", "reports"])
        self.stage = WorkStage.objects.create(name="مرحلهٔ آزمایشی", needs_area=True)
        self.project = Project.objects.create(name="پروژهٔ آزمایش")
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def _post(self, **extra):
        return self.api.post("/api/reports/", {
            "date": str(DAY), "shift": "صبح", "status": "draft",
            "items": [{"employee": "علی", "project": str(self.project.pk), "activity": self.stage.name,
                       "hours": 3, **extra}]}, format="json")

    def test_rework_needs_a_reason(self):
        self.assertEqual(self._post(rework=True).status_code, 400)
        self.assertEqual(self._post(rework=True, reworkReason="   ").status_code, 400)
        self.assertFalse(ReportItem.objects.exists())

    def test_fields_are_saved_and_returned(self):
        r = self._post(rework=True, reworkReason="شره کردن رنگ", overtime=True, location="onsite")
        self.assertEqual(r.status_code, 201, r.content)
        it = r.json()["items"][0]
        self.assertEqual((it["rework"], it["reworkReason"], it["overtime"], it["location"]),
                         (True, "شره کردن رنگ", True, "onsite"))

    def test_plain_row_keeps_working_and_drops_a_stray_reason(self):
        r = self._post(reworkReason="بی‌ربط")
        self.assertEqual(r.status_code, 201, r.content)
        it = r.json()["items"][0]
        self.assertEqual((it["rework"], it["reworkReason"], it["overtime"], it["location"]), (False, "", False, ""))

    def test_rework_hours_do_not_ask_for_area(self):
        report = DailyReport.objects.create(date=DAY, shift="صبح", supervisor=self.user, supervisor_name="س")
        ReportItem.objects.create(report=report, employee="علی", project=self.project, activity=self.stage.name,
                                  hours=4, rework=True, rework_reason="خط‌وخش")
        self.assertEqual(production.area_gaps(today=DAY), [])
        ReportItem.objects.create(report=report, employee="رضا", project=self.project, activity=self.stage.name,
                                  hours=4)
        self.assertEqual(production.area_gaps(today=DAY)[0]["rows"][0]["people"], ["رضا"])


class UsageKindTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["warehouse", "materials", "materials.create"])
        self.shop = (Warehouse.objects.filter(supplies_workshop=True, active=True).order_by("id").first()
                     or Warehouse.objects.create(name="انبار مصرفی", supplies_workshop=True))
        self.sku = Sku.objects.create(product=Product.objects.create(name="رویه"), warehouse_name="رویه ۵ کیلویی",
                                      site_package_id="T-9", base_unit="حلب", alt_unit="کیلوگرم",
                                      alt_to_base=Decimal("0.2"))
        StockMovement.objects.create(sku=self.sku, warehouse=self.shop, kind="transfer_in", qty=2, date=DAY,
                                     created_by=self.user)
        self.project = Project.objects.create(name="پروژهٔ آزمایش")
        self.stage = WorkStage.objects.create(name="مرحلهٔ آزمایشی")
        self.report = MaterialUsageReport.objects.create(date=DAY, recorded_by=self.user, recorded_by_name="مدیر",
                                                         status="approved")

    def _line(self, qty, kind="use"):
        return MaterialUsage.objects.create(report=self.report, sku=self.sku, project=self.project,
                                            material_name="رویه", unit="کیلوگرم", quantity=qty, kind=kind)

    def _stock(self):
        return StockMovement.objects.filter(sku=self.sku, warehouse=self.shop).aggregate(q=Sum("qty"))["q"]

    def test_waste_comes_off_and_return_goes_back(self):
        self._line(5)
        self._line(1, "waste")
        self._line(2, "return")
        sync_usage_stock(self.report, self.user)
        # ۲ حلب − (۵ + ۱ − ۲) کیلو × ۰٫۲ = ۱٫۲ حلب
        self.assertEqual(self._stock(), Decimal("1.2"))
        notes = list(StockMovement.objects.filter(usage_report=self.report).order_by("id").values_list("note", flat=True))
        self.assertTrue(notes[1].startswith("ضایعات"))
        self.assertTrue(notes[2].startswith("برگشتی به انبار"))

    def test_a_return_alone_is_never_a_shortage(self):
        StockMovement.objects.filter(sku=self.sku).delete()
        self._line(3, "return")
        self.assertEqual(usage_shortages(self.report)[1], [])

    def test_api_takes_kind_and_stage_and_refuses_an_unknown_stage(self):
        api = APIClient()
        api.force_authenticate(self.user)
        body = lambda **x: {"date": str(DAY), "status": "draft", "items": [  # noqa: E731
            {"project": str(self.project.pk), "sku": str(self.sku.pk), "unit": "کیلوگرم", "quantity": 1, **x}]}
        r = api.post("/api/material-usages/", body(kind="waste", stage=self.stage.name), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        it = r.json()["items"][0]
        self.assertEqual((it["kind"], it["stage"]), ("waste", self.stage.name))
        post = lambda **x: api.post("/api/material-usages/", body(**x), format="json")  # noqa: E731
        self.assertEqual(post(stage="مرحلهٔ ساختگی").status_code, 400)
        self.assertEqual(post(kind="return", stage=self.stage.name).status_code, 400)
        # مرحله برای کار پروژه لازم است، برای مصرف عمومی کارگاه نه.
        self.assertEqual(post().status_code, 400)
        general = Project.objects.create(name="خدمات کارگاه آزمایشی", general=True)
        r = post(project=str(general.pk))
        self.assertEqual((r.status_code, r.json()["items"][0]["kind"], r.json()["items"][0]["stage"]), (201, "use", ""))
