"""پیشرفت پروژه در صفحهٔ پروژه‌ها همان عدد صفحهٔ تولید است، نه تیک دستی."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from .models import DailyReport, Project, ProjectStage, ReportProgress, User


class ProjectProgressTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["projects"])
        self.project = Project.objects.create(name="ویلا", base_area=100)
        ProjectStage.objects.create(project=self.project, name="رنگ", area=100)

    def _report(self, area, status):
        report = DailyReport.objects.create(date=datetime.date(2026, 9, 1), shift="صبح",
                                            supervisor=self.user, supervisor_name="مدیر", status=status)
        ReportProgress.objects.create(report=report, project=self.project, project_name="ویلا",
                                      stage="رنگ", area=area)

    def test_projects_show_progress_from_approved_work_reports(self):
        self._report(40, "approved")
        self._report(25, "waiting")
        api = APIClient()
        api.force_authenticate(self.user)
        row = next(p for p in api.get("/api/projects/").data if p["name"] == "ویلا")
        prog = row["progress"]
        self.assertEqual(prog["done"], 40)
        self.assertEqual(prog["pending"], 25)
        self.assertEqual(prog["stages"][0]["percent"], 40)
        # مرحله تیک «انجام شد» نخورده، ولی پیشرفت از گزارش‌ها می‌آید.
        self.assertEqual(row["doneCount"], 0)
        self.assertGreater(prog["percent"], 0)
