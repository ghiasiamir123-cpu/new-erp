"""کارکرد ثبت شده ولی متراژ نه: همان روز باید در فهرست هشدار بیاید."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import production
from .models import DailyReport, Project, ReportItem, ReportProgress, User, WorkStage

DAY = datetime.date(2026, 10, 3)


class AreaGapTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="sup", password="x", name="سرپرست", access=["entry"])
        self.stage = WorkStage.objects.create(name="مرحلهٔ متراژدار آزمایشی", needs_area=True)
        self.free = WorkStage.objects.create(name="کار بی‌متراژ آزمایشی", needs_area=False)
        self.project = Project.objects.create(name="پروژهٔ آزمایش", code="DW05-R900")
        self.general = Project.objects.create(name="خدمات کارگاه آزمایشی", general=True)
        self.report = DailyReport.objects.create(date=DAY, shift="صبح", supervisor=self.user,
                                                 supervisor_name="سرپرست", status="waiting")

    def _item(self, project, activity, hours=4, employee="علی"):
        ReportItem.objects.create(report=self.report, employee=employee, project=project, project_name=project.name,
                                  activity=activity, hours=hours)

    def _gaps(self):
        return production.area_gaps(today=DAY)

    def test_hours_without_area_are_listed(self):
        self._item(self.project, self.stage.name)
        self._item(self.project, self.stage.name, hours=2, employee="رضا")
        gaps = self._gaps()
        self.assertEqual([g["date"] for g in gaps], ["2026-10-03"])
        row = gaps[0]["rows"][0]
        self.assertEqual((row["projectCode"], row["stage"], row["hours"], row["people"]),
                         ("DW05-R900", self.stage.name, 6.0, ["رضا", "علی"]))

    def test_area_in_another_report_of_the_day_clears_it(self):
        self._item(self.project, self.stage.name)
        other = DailyReport.objects.create(date=DAY, shift="عصر", supervisor=self.user, supervisor_name="سرپرست")
        ReportProgress.objects.create(report=other, project=self.project, project_name=self.project.name,
                                      stage=self.stage.name, area=12)
        self.assertEqual(self._gaps(), [])

    def test_work_that_takes_no_area_is_not_a_gap(self):
        self._item(self.general, self.stage.name)
        self._item(self.project, self.free.name)
        self._item(Project.objects.create(name="بی‌متراژ", no_area=True), self.stage.name)
        self.assertEqual(self._gaps(), [])

    def test_endpoint(self):
        self._item(self.project, self.stage.name)
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.get("/api/reports/area-gaps/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()), 1)
