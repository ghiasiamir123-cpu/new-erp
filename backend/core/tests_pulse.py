"""داشبورد تولید: متراژ در برابر هدف، گلوگاه مراحل، تعهدها و انقضای بچ‌ها."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import production, stock_reports
from .models import (DailyReport, Product, Project, ProjectStage, ReportProgress, Sku,
                     StockBatch, StockMovement, User, Warehouse, WorkStage)

DAY = datetime.date(2026, 9, 20)


class PulseTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر",
                                             role="manager", access=["production", "warehouse"])
        WorkStage.objects.create(name="پرداخت", order=1, daily_target=40)
        WorkStage.objects.create(name="استر", order=2, default_coefficient=2, daily_target=0)
        self.project = Project.objects.create(name="ویلا", base_area=100,
                                              due_date=DAY + datetime.timedelta(days=30))
        ProjectStage.objects.create(project=self.project, name="پرداخت", area=100, order=1)
        ProjectStage.objects.create(project=self.project, name="استر", area=200, order=2)

    def _report(self, date, stage, area, status="approved"):
        report = DailyReport.objects.create(date=date, shift="صبح", supervisor=self.user,
                                            supervisor_name="مدیر", status=status)
        ReportProgress.objects.create(report=report, project=self.project, project_name="ویلا",
                                      stage=stage, area=area)

    def test_a_day_counts_approved_and_pending_against_the_daily_target(self):
        self._report(DAY, "پرداخت", 25)
        self._report(DAY, "پرداخت", 10, status="waiting")
        row = next(s for s in production.throughput("day", DAY)["stages"] if s["name"] == "پرداخت")
        self.assertEqual((row["done"], row["pending"], row["target"]), (25, 10, 40))
        self.assertEqual(row["percent"], 87.5)
        # مرحلهٔ بی‌هدف درصد نمی‌سازد.
        self.assertIsNone(next(s for s in production.throughput("day", DAY)["stages"]
                               if s["name"] == "استر")["percent"])

    def test_a_week_target_counts_only_days_that_have_reports(self):
        self._report(DAY, "پرداخت", 30)
        self._report(DAY - datetime.timedelta(days=2), "پرداخت", 30)
        week = production.throughput("week", DAY)
        self.assertEqual(week["workingDays"], 2)
        row = next(s for s in week["stages"] if s["name"] == "پرداخت")
        self.assertEqual((row["done"], row["target"]), (60, 80))

    def test_work_finished_upstream_waits_at_the_next_stage(self):
        # پرداخت ۶۰٪ جلو رفته، استر ۲۰٪ ⟵ ۴۰٪ از ۲۰۰ متر استر منتظر است.
        self._report(DAY, "پرداخت", 60)
        self._report(DAY, "استر", 40)
        data = production.board()
        out = production.bottlenecks(data["results"], production.capacity())
        by = {s["name"]: s for s in out["stages"]}
        self.assertEqual(by["پرداخت"]["waiting"], 40)
        self.assertEqual(by["استر"]["waiting"], 80)
        self.assertEqual(by["استر"]["projects"][0]["project"], "ویلا")

    def test_pulse_endpoint_needs_production_access_and_carries_no_prices(self):
        self.project.price = 900_000_000
        self.project.save()
        self._report(DAY, "پرداخت", 60)
        api = APIClient()
        api.force_authenticate(self.user)
        res = api.get("/api/production/pulse/", {"period": "week", "date": DAY.isoformat()})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["throughput"]["period"], "week")
        self.assertEqual(res.data["promises"][0]["dueDate"], self.project.due_date)
        self.assertNotIn("900000000", str(res.data))

        clerk = User.objects.create_user(username="clerk", password="x", name="ثبت",
                                         role="data_entry", access=["dashboard"])
        api.force_authenticate(clerk)
        self.assertEqual(api.get("/api/production/pulse/").status_code, 403)


class ExpiringBatchTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="keeper", password="x", name="انباردار")
        self.wh = Warehouse.objects.create(name="مرکزی")
        product = Product.objects.create(name="هاردنر", batch_tracked=True)
        self.sku = Sku.objects.create(product=product, base_unit="کیلوگرم")

    def _batch(self, no, expires, qty):
        batch = StockBatch.objects.create(sku=self.sku, batch_no=no, expires_on=expires)
        StockMovement.objects.create(sku=self.sku, warehouse=self.wh, batch=batch,
                                     kind="receipt", qty=qty, date=DAY, created_by=self.user)
        return batch

    def test_only_batches_with_stock_near_expiry_are_listed(self):
        self._batch("A", DAY - datetime.timedelta(days=3), 5)     # منقضی
        self._batch("B", DAY + datetime.timedelta(days=20), 2)    # نزدیک
        self._batch("C", DAY + datetime.timedelta(days=200), 9)   # دور
        used = self._batch("D", DAY + datetime.timedelta(days=10), 4)
        StockMovement.objects.create(sku=self.sku, warehouse=self.wh, batch=used,
                                     kind="workshop", qty=-4, date=DAY, created_by=self.user)   # تمام شده
        out = stock_reports.expiring_batches(90, today=DAY)
        self.assertEqual([r["batchNo"] for r in out["results"]], ["A", "B"])
        self.assertEqual((out["expired"], out["soon"]), (1, 1))
        self.assertEqual(out["results"][0]["daysLeft"], -3)

    def test_stock_entered_without_a_batch_is_counted_as_unknown(self):
        StockMovement.objects.create(sku=self.sku, warehouse=self.wh, kind="receipt", qty=3, date=DAY, created_by=self.user)
        self.assertEqual(stock_reports.expiring_batches(90, today=DAY)["untracked"], 1)
