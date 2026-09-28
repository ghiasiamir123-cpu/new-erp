"""مصرف مواد در هر دست روی هر متر، در برابر استاندارد رنر."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import material_consumption as mc
from .models import (DailyReport, MaterialUsage, MaterialUsageReport, Product, Project,
                     ProjectStage, ReportProgress, Sku, User, WorkStage)

DAY = datetime.date(2026, 9, 1)


class MaterialConsumptionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["production"])
        for i, n in enumerate(["پرداخت قبل از استر", "پرایمر MDF یا استر دست اول", "رنگ رویه"]):
            WorkStage.objects.get_or_create(name=n, defaults={"order": i})
        self.project = Project.objects.create(name="ویلا", base_area=40)
        for n in ("پرایمر MDF یا استر دست اول", "رنگ رویه"):
            ProjectStage.objects.create(project=self.project, name=n, area=80)
        report = DailyReport.objects.create(date=DAY, shift="صبح", supervisor=self.user,
                                            supervisor_name="مدیر", status="approved")
        # دو دست آستر (۸۰ م²)، یک دست رویه (۴۰ م²)، و پرداخت که نباید آستر حساب شود.
        for stage, area in (("پرایمر MDF یا استر دست اول", 80), ("رنگ رویه", 40), ("پرداخت قبل از استر", 40)):
            ReportProgress.objects.create(report=report, project=self.project, project_name="ویلا",
                                          stage=stage, area=area)
        self.usage = MaterialUsageReport.objects.create(date=DAY, recorded_by=self.user,
                                                        recorded_by_name="مدیر", status="approved")

    def _use(self, name, qty, unit="کیلوگرم", price=0):
        sku = Sku.objects.create(product=Product.objects.create(name=name), warehouse_name=name,
                                 site_package_id=f"T-{Sku.objects.count() + 1}",
                                 base_unit=unit, cost_price=price)
        MaterialUsage.objects.create(report=self.usage, project=self.project, sku=sku,
                                     material_name=name, unit=unit, quantity=qty)

    def test_names_land_in_the_right_group(self):
        self.assertEqual(mc.group_of("هاردنر آستر پولچم"), "primer")
        self.assertEqual(mc.group_of("هاردنر آگزونوبل سورپلاس"), "primer")
        self.assertEqual(mc.group_of("Renner - PU - Hardener [Non-Yellowing PU Hardener For Clear Topcoat]"), "topcoat")
        self.assertEqual(mc.group_of("Bormawachs - Top Coat [Oil Base - Hard Furniture Oil Wax]"), "oil")
        self.assertEqual(mc.group_of("Fateh Fam - Tinner - special [Polyurthane] 20L"), "thinner")
        self.assertEqual(mc.group_of("KB - Roll - Foam [ Abrasive Soft Roll ] P220"), "abrasive")
        self.assertEqual(mc.group_of("فوم بسته بندی"), "other")

    def test_primer_is_compared_per_coat_against_renner(self):
        # ۱۶ کیلو برای ۸۰ م² دست آستر = ۰٫۲ کیلو در هر دست — داخل ۰٫۱۶۸ تا ۰٫۲۱۶ رنر.
        self._use("آستر پولچم", 12)
        self._use("هاردنر آستر پولچم", 4)
        out = mc.consumption()
        primer = out["summary"]["primer"]
        self.assertEqual(primer["perCoatM2"], 0.2)
        self.assertEqual(primer["verdict"], "ok")
        self.assertEqual(primer["sampleM2"], 80)     # پرداخت قبل از استر شمرده نشد

    def test_a_finished_topcoat_with_no_paint_recorded_is_flagged(self):
        self._use("آستر پولچم", 30)                   # ۰٫۳۷۵ کیلو در هر دست ⟵ زیاد
        out = mc.consumption()
        self.assertEqual(out["summary"]["primer"]["verdict"], "high")
        self.assertIn("ویلا", out["summary"]["topcoat"]["notRecorded"])
        self.assertEqual(out["projects"][0]["checks"]["topcoat"]["verdict"], "missing")

    def test_cost_needs_the_pricing_key(self):
        self._use("آستر پولچم", 12, price=1_000_000)
        api = APIClient()
        api.force_authenticate(self.user)
        res = api.get("/api/production/material-consumption/")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("costPerWoodM2", res.data["materials"][0])
        self.user.access = ["production", "production.pricing"]
        self.user.save()
        res = api.get("/api/production/material-consumption/")
        self.assertEqual(res.data["materials"][0]["costPerWoodM2"], 300000)
