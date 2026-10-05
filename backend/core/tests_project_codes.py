"""کد پروژه: CC + سال + حرفِ نوع کار + شمارهٔ سال."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import project_codes
from .models import Project, User

START = datetime.date(2026, 8, 10)        # ۱۹ مرداد ۱۴۰۵


class ProjectCodeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["projects", "projects.create", "projects.manage", "production"])
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_the_letter_is_the_kind_of_work_and_the_number_runs_through_the_year(self):
        self.assertEqual(project_codes.next_code(1405, "door"), "CC05-D1001")
        Project.objects.create(name="الف", code="CC05-D1001")
        Project.objects.create(name="ب", code="CC05-K1007")
        Project.objects.create(name="قدیمی", code="DW05-R900")              # پیشوندِ قبلی شمرده نمی‌شود
        Project.objects.create(name="دستی", code="ویژه")
        self.assertEqual(project_codes.next_code(1405, "furniture"), "CC05-F1008")
        self.assertEqual(project_codes.next_code(1406, "trim"), "CC06-T1001")
        self.assertEqual(project_codes.with_kind("CC05-D1001", "vanity"), "CC05-V1001")
        self.assertEqual(project_codes.with_kind("ویژه", "vanity"), "ویژه")

    def test_a_project_gets_its_code_once_start_and_kind_are_known(self):
        r = self.api.post("/api/projects/", {"name": "کاسیان"}, format="json")
        self.assertEqual((r.status_code, r.json()["code"]), (201, ""))
        pk = r.json()["id"]
        r = self.api.patch(f"/api/projects/{pk}/", {"startDate": START.isoformat()}, format="json")
        self.assertEqual((r.status_code, r.json().get("code")), (200, ""), r.content)   # نوع کار هنوز نیست
        r = self.api.patch(f"/api/projects/{pk}/", {"workKind": "furniture"}, format="json")
        self.assertEqual((r.json()["code"], r.json()["workKindLabel"]), ("CC05-F1001", "مبلمان"))
        r = self.api.patch(f"/api/projects/{pk}/", {"workKind": "cabinet"}, format="json")
        self.assertEqual(r.json()["code"], "CC05-K1001")                      # فقط حرف عوض می‌شود
        r = self.api.post("/api/projects/", {"name": "دوم", "startDate": START.isoformat(), "workKind": "door"}, format="json")
        self.assertEqual(r.json()["code"], "CC05-D1002")
        self.assertEqual(self.api.get(f"/api/projects/next-code/?start={START.isoformat()}&kind=trim").json()["code"], "CC05-T1003")
        self.assertEqual(self.api.get(f"/api/projects/next-code/?start={START.isoformat()}&kind=nothing").status_code, 400)
