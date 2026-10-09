"""کارکرد ثبت شده ولی متراژ نه: همان روز باید در فهرست هشدار بیاید."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import production
from .models import DailyReport, Project, ProjectStage, ReportItem, ReportProgress, User, WorkStage

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


class AreaPendingTests(TestCase):
    """کارهایی که متراژشان مانده: ساعت‌های بعد از آخرین متراژِ همان پروژه/مرحله، و فقط آنچه هنوز درست‌شدنی است."""

    def setUp(self):
        self.user = User.objects.create_user(username="sup2", password="x", name="سرپرست", access=["entry"])
        self.stage = WorkStage.objects.create(name="مرحلهٔ متراژدار آزمایشی", needs_area=True)
        self.other = WorkStage.objects.create(name="مرحلهٔ دومِ آزمایشی", needs_area=True)
        self.free = WorkStage.objects.create(name="کار بی‌متراژ آزمایشی", needs_area=False)
        self.project = Project.objects.create(name="پروژهٔ آزمایش", code="DW05-R901")

    def _report(self, day):
        return DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="سرپرست", status="approved")

    def _hours(self, day, hours=4, project=None, stage=None, employee="علی", **kw):
        project = project or self.project
        ReportItem.objects.create(report=self._report(day), employee=employee, project=project, project_name=project.name,
                                  activity=(stage or self.stage).name, hours=hours, **kw)

    def _area(self, day, area=10, project=None, stage=None):
        project = project or self.project
        ReportProgress.objects.create(report=self._report(day), project=project, project_name=project.name,
                                      stage=(stage or self.stage).name, area=area)

    def test_only_the_hours_after_the_last_area_are_waiting(self):
        d = [DAY + datetime.timedelta(days=i) for i in range(5)]
        self._hours(d[0])                        # متراژش دو روز بعد آمد
        self._hours(d[1], hours=3)
        self._area(d[1])
        self._hours(d[1], hours=1, employee="رضا")   # همان روزِ متراژ
        self._hours(d[3], hours=5)
        self._hours(d[4], hours=2, employee="رضا")
        rows = production.area_pending()
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r["projectCode"], r["stage"], r["hours"], r["days"], r["from"], r["to"], r["lastArea"], r["people"], r["inProject"]),
                         ("DW05-R901", self.stage.name, 7.0, 2, d[3], d[4], d[1], ["رضا", "علی"], True))
        self._area(d[4], area=6)                 # متراژِ روزِ آخر که آمد، فهرست خالی می‌شود
        self.assertEqual(production.area_pending(), [])

    def test_what_cannot_be_fixed_is_left_out(self):
        self._hours(DAY, project=Project.objects.create(name="بسته", closed_at=DAY))
        self._hours(DAY, project=Project.objects.create(name="عمومی", general=True))
        self._hours(DAY, project=Project.objects.create(name="بی‌متراژ", no_area=True))
        self._hours(DAY, stage=self.free)
        self._hours(DAY, rework=True, rework_reason="ضربه")
        done = Project.objects.create(name="تیک‌خورده")
        ProjectStage.objects.create(project=done, name=self.stage.name, area=20, done=True)
        self._hours(DAY, project=done)
        self.assertEqual(production.area_pending(), [])

    def test_a_stage_the_project_does_not_have_is_marked_and_listed_last(self):
        ProjectStage.objects.create(project=self.project, name=self.stage.name, area=20)
        self._hours(DAY, hours=9, stage=self.other)          # این مرحله در پروژه نیست
        self._hours(DAY, hours=2)
        free = Project.objects.create(name="بی فهرستِ مرحله")
        self._hours(DAY, hours=1, project=free, stage=self.other)   # پروژه‌ای که مرحله تعریف نکرده، هر مرحله‌ای می‌گیرد
        rows = production.area_pending()
        self.assertEqual([(r["projectName"], r["stage"], r["inProject"]) for r in rows],
                         [("پروژهٔ آزمایش", self.stage.name, True), ("بی فهرستِ مرحله", self.other.name, True),
                          ("پروژهٔ آزمایش", self.other.name, False)])

    def test_endpoint(self):
        self._hours(DAY)
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.get("/api/reports/area-pending/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([(x["stage"], x["hours"]) for x in r.json()], [(self.stage.name, 4.0)])
