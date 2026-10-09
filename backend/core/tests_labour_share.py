"""تسهیم حقوق به پروژه‌ها: حقوقِ هر نفر به نسبتِ ساعتش روی هر پروژه در بازه."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import labour_share
from .models import DailyReport, Employee, Project, ReportItem, User

D = datetime.date


class LabourShareTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fin", password="x", name="مالی", role="manager",
                                             access=["financereports", "accounting", "accounting.salary"])
        self.a = Project.objects.create(name="مطهری", code="DW05-R001")
        self.b = Project.objects.create(name="ونک")
        self.shop = Project.objects.create(name="کارهای عمومی کارگاه", general=True)
        self.ali = Employee.objects.create(name="علی رضایی", monthly_salary=300_000_000)
        Employee.objects.create(name="حسن", monthly_salary=100_000_001)
        Employee.objects.create(name="بی‌کار", monthly_salary=50_000_000)

    def _work(self, day, who, project, hours, status="approved", name=""):
        rep = DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="م", status=status)
        ReportItem.objects.create(report=rep, employee=who, project=project, project_name=name, activity="رنگ", hours=hours)

    def test_a_salary_is_split_by_the_hours_on_each_project_in_the_range(self):
        self._work(D(2026, 9, 23), "علی رضایی", self.a, 60)
        self._work(D(2026, 9, 24), "علی رضایی", self.b, 30)
        self._work(D(2026, 9, 25), "علی رضایی", self.shop, 10)
        self._work(D(2026, 8, 1), "علی رضایی", self.b, 500)                 # بیرون از بازه
        self._work(D(2026, 9, 26), "علی رضایی", self.b, 40, status="submitted")   # تأییدنشده
        d = labour_share.report(D(2026, 9, 23), D(2026, 10, 22))
        cols = {c["label"]: (c["hours"], c["amount"], c["kind"]) for c in d["columns"]}
        self.assertEqual(cols, {"DW05-R001 (مطهری)": (60.0, 180_000_000, "project"), "ونک": (30.0, 90_000_000, "project"),
                                "کارهای عمومی کارگاه": (10.0, 30_000_000, "general")})
        self.assertEqual([c["kind"] for c in d["columns"]], ["project", "project", "general"])
        t = d["totals"]
        self.assertEqual((t["allocated"], t["projects"], t["general"]), (300_000_000, 270_000_000, 30_000_000))
        self.assertEqual((d["pendingReports"], d["reportDays"]), (1, 3))
        self.assertEqual(next(w["days"] for w in d["workers"] if w["name"] == "علی رضایی"), 3)
        # کسی که حقوق دارد و ساعتی ندارد تسهیم‌نشده می‌ماند و اعلام می‌شود
        self.assertEqual(t["unallocated"], 150_000_001)
        self.assertEqual(d["issues"]["noHours"], ["بی‌کار", "حسن"])

    def test_the_shares_of_one_person_add_up_to_the_salary_exactly(self):
        for p in (self.a, self.b, self.shop):
            self._work(D(2026, 9, 23), "حسن", p, 1)                          # سه سهمِ برابر از ۱۰۰٬۰۰۰٬۰۰۱
        d = labour_share.report(D(2026, 9, 23), D(2026, 9, 23))
        hasan = next(w for w in d["workers"] if w["name"] == "حسن")
        amounts = sorted(c["amount"] for c in hasan["cells"].values())
        self.assertEqual(sum(amounts), 100_000_001)
        self.assertEqual(amounts, [33_333_333, 33_333_334, 33_333_334])
        self.assertEqual(hasan["allocated"], hasan["salary"])

    def test_hours_without_a_salary_or_a_project_are_shown_not_guessed(self):
        self._work(D(2026, 9, 23), "غریبه", self.a, 8)
        self._work(D(2026, 9, 23), "علی رضایی", None, 5)
        self._work(D(2026, 9, 23), "علی رضایی", None, 5, name="پروژهٔ قدیمی")
        d = labour_share.report(D(2026, 9, 23), D(2026, 9, 23))
        self.assertEqual(d["issues"]["noSalary"], ["غریبه"])
        cols = {c["label"]: (c["hours"], c["amount"], c["kind"]) for c in d["columns"]}
        self.assertEqual(cols["DW05-R001 (مطهری)"], (8.0, 0, "project"))      # ساعت هست، حقوقی نیست که پخش شود
        self.assertEqual(cols["بدون پروژه"], (5.0, 150_000_000, "loose"))
        self.assertEqual(cols["پروژهٔ قدیمی"], (5.0, 150_000_000, "loose"))

    def test_endpoints_and_who_may_enter_a_salary(self):
        self._work(D(2026, 9, 23), "غریبه", self.a, 8)
        api = APIClient()
        api.force_authenticate(self.user)
        self.assertEqual(api.get("/api/finance-reports/labour-share/").status_code, 400)
        self.assertEqual(api.get("/api/finance-reports/labour-share/?from=2026-09-24&to=2026-09-23").status_code, 400)
        r = api.post("/api/finance-reports/labour-salary/", {"name": "غریبه", "salary": 80_000_000}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        made = Employee.objects.get(name="غریبه")
        self.assertEqual((made.active, int(made.monthly_salary)), (False, 80_000_000))
        d = api.get("/api/finance-reports/labour-share/?from=2026-09-23&to=2026-09-23").json()
        self.assertEqual((d["columns"][0]["amount"], d["issues"]["noSalary"]), (80_000_000, []))
        api.post("/api/finance-reports/labour-salary/", {"employee": self.ali.pk, "salary": ""}, format="json")
        self.assertIsNone(Employee.objects.get(pk=self.ali.pk).monthly_salary)
        self.assertEqual(api.post("/api/finance-reports/labour-salary/", {"employee": self.ali.pk, "salary": -5}, format="json").status_code, 400)
        self.assertEqual(api.post("/api/finance-reports/labour-salary/", {"employee": self.ali.pk, "salary": 310000000310000000}, format="json").status_code, 400)
        self.assertNotIn("monthly_salary", api.get("/api/employees/").content.decode())
        self.assertNotIn("monthlySalary", api.get("/api/employees/").content.decode())
        # حقوق‌ها کلیدِ خودشان را دارند: «گزارش‌های مالی» و حتی «اصلاح نرخ و قیمت» کافی نیست.
        self.user.access = ["financereports", "financereports.costs"]
        self.user.save()
        self.assertEqual(api.post("/api/finance-reports/labour-salary/", {"employee": self.ali.pk, "salary": 1}, format="json").status_code, 403)
        self.assertEqual(api.get("/api/finance-reports/labour-share/?from=2026-09-23&to=2026-09-23").status_code, 403)
        self.assertEqual(api.get("/api/finance-reports/coating-profit/").status_code, 200)
        from . import access
        self.assertIn("accounting.salary", [k for k, _ in access.ACTIONS])
