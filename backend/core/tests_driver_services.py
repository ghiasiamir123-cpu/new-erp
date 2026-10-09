"""سرویس‌های مشتریِ راننده: مسیرِ رفته‌شده و مبلغِ اخذشده، و جمعِ ماهانه‌اش."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from .jalali import jalali_to_gregorian
from .models import Driver, DriverReport, DriverTask, User


def jdate(jy, jm, jd):
    return datetime.date(*jalali_to_gregorian(jy, jm, jd))


class DriverServicesTests(TestCase):
    def setUp(self):
        self.boss = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["driver", "driver.create", "driver.manage"])
        self.clerk = User.objects.create_user(username="clerk", password="x", name="ثبت", role="data_entry",
                                              access=["driver", "driver.create"])
        self.ali = Driver.objects.create(name="علی")
        self.api = APIClient()

    def _report(self, date, status="approved", tasks=()):
        self.api.force_authenticate(self.clerk)
        created = self.api.post("/api/driver-reports/", {
            "date": date.isoformat(), "driver": str(self.ali.pk), "status": "draft",
            "odometerStart": 1000, "odometerEnd": 1100, "tasks": list(tasks),
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        DriverReport.objects.filter(pk=created.data["id"]).update(status=status)
        return created.data

    def test_the_route_and_the_money_taken_from_the_customer_are_recorded(self):
        r = self._report(jdate(1405, 7, 3), tasks=[
            {"time": "۱۰:۳۰", "destination": "بانک", "description": "واریز چک"},
            {"customerService": True, "destination": "کارگاه تا سعادت‌آباد", "customerName": "آقای رضایی", "collectedAmount": 7_000_000},
            {"customerService": True, "destination": "کارگاه تا کرج"},                       # سرویسِ بی‌پول هم سرویسِ مشتری است
            {"customerService": True},                                                          # ردیفِ خالی نگه داشته نمی‌شود
        ])
        self.assertEqual([(t["destination"], t["customerService"], t["collectedAmount"]) for t in r["tasks"]],
                         [("بانک", False, 0), ("کارگاه تا سعادت‌آباد", True, 7_000_000), ("کارگاه تا کرج", True, 0)])
        self.assertNotIn("route", r["tasks"][0])
        self._report(jdate(1405, 7, 9), status="waiting", tasks=[
            # نسخهٔ قدیمیِ صفحه نشان نمی‌فرستد: مشتری یا مبلغ یعنی سرویسِ مشتری
            {"destination": "تحویلِ درب", "customerName": "خانم احمدی", "collectedAmount": 2_500_000},
        ])
        self._report(jdate(1405, 8, 1), tasks=[{"customerService": True, "destination": "ماهِ بعد", "collectedAmount": 9}])

        self.api.force_authenticate(self.boss)
        d = self.api.get("/api/driver-services/?month=1405-07")
        self.assertEqual(d.status_code, 200, d.content)
        self.assertEqual([(x["route"], x["customer"], x["amount"], x["status"]) for x in d.data["rows"]],
                         [("تحویلِ درب", "خانم احمدی", 2_500_000.0, "waiting"), ("کارگاه تا کرج", "", 0.0, "approved"),
                          ("کارگاه تا سعادت‌آباد", "آقای رضایی", 7_000_000.0, "approved")])
        self.assertEqual(d.data["totals"], {"count": 3, "amount": 9_500_000.0, "pending": 2_500_000.0})
        self.assertEqual(d.data["drivers"], [{"driverName": "علی", "count": 3, "amount": 9_500_000.0}])
        self.assertEqual(d.data["months"][:2], ["1405-08", "1405-07"])

    def test_editing_a_report_keeps_its_customer_services(self):
        r = self._report(jdate(1405, 7, 3), status="waiting", tasks=[
            {"destination": "بانک"},
            {"customerService": True, "destination": "کارگاه تا ونک", "customerName": "آقای کریمی", "collectedAmount": 4_000_000},
        ])
        sent = [{"time": "", "destination": "بانک ملت", "description": ""},
                {"customerService": True, "destination": "کارگاه تا ونک", "customerName": "آقای کریمی", "collectedAmount": 4_500_000}]
        u = self.api.patch(f"/api/driver-reports/{r['id']}/", {"tasks": sent}, format="json")      # خودِ ثبت‌کننده، پیش از تأیید
        self.assertEqual(u.status_code, 200, u.content)
        self.assertEqual(sorted((t.destination, t.customer_service, int(t.collected_amount)) for t in DriverTask.objects.all()),
                         [("بانک ملت", False, 0), ("کارگاه تا ونک", True, 4_500_000)])

    def test_only_the_driver_manager_sees_the_month(self):
        self.api.force_authenticate(self.clerk)
        self.assertEqual(self.api.get("/api/driver-services/").status_code, 403)
        self.api.force_authenticate(self.boss)
        self.assertEqual(self.api.get("/api/driver-services/").status_code, 200)
        self.assertEqual(self.api.get("/api/driver-services/?month=نه").status_code, 400)
        # مسیرهای ثابت و نرخِ هر کیلومتر دیگر نیستند
        self.assertEqual(self.api.get("/api/driver-pay/").status_code, 404)
        self.assertEqual(self.api.get("/api/driver-routes/").status_code, 404)
