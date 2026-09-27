"""کارانهٔ رانندگان: کیلومتر × نرخ + مسیرها، و پول مشتری جدا."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from .jalali import jalali_to_gregorian
from .models import Driver, DriverReport, DriverRoute, User


def jdate(jy, jm, jd):
    return datetime.date(*jalali_to_gregorian(jy, jm, jd))


class DriverPayTests(TestCase):
    def setUp(self):
        self.boss = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["driver", "driver.create", "driver.manage"])
        self.clerk = User.objects.create_user(username="clerk", password="x", name="ثبت", role="data_entry",
                                              access=["driver", "driver.create"])
        self.ali = Driver.objects.create(name="علی")
        self.route = DriverRoute.objects.create(name="کارخانه تا انبار", price=500_000)
        self.api = APIClient()

    def _report(self, date, km, status="approved", tasks=()):
        self.api.force_authenticate(self.clerk)
        created = self.api.post("/api/driver-reports/", {
            "date": date.isoformat(), "driver": str(self.ali.pk), "status": "draft",
            "odometerStart": 1000, "odometerEnd": 1000 + km, "tasks": list(tasks),
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        DriverReport.objects.filter(pk=created.data["id"]).update(status=status)
        return created.data

    def test_pay_is_km_times_rate_plus_routes_and_customer_money_is_separate(self):
        self._report(jdate(1405, 7, 3), 120, tasks=[
            {"destination": "انبار", "route": str(self.route.pk)},
            {"destination": "مشتری", "customerName": "آقای رضایی", "collectedAmount": 7_000_000},
        ])
        self._report(jdate(1405, 7, 9), 80, status="waiting")  # هنوز تأیید نشده
        self._report(jdate(1405, 8, 1), 999)  # ماه بعد

        self.api.force_authenticate(self.boss)
        saved = self.api.post("/api/driver-pay/", {"driver": str(self.ali.pk), "month": "1405-07",
                                                   "ratePerKm": 20_000}, format="json")
        self.assertEqual(saved.status_code, 200, saved.content)
        row = next(r for r in saved.data["rows"] if r["driverName"] == "علی")
        self.assertEqual(row["km"], 120)
        self.assertEqual(row["pendingKm"], 80)
        self.assertEqual(row["kmAmount"], 2_400_000)
        self.assertEqual(row["routeAmount"], 500_000)
        self.assertEqual(row["total"], 2_900_000)
        self.assertEqual(row["collected"], 7_000_000)

    def test_a_later_price_change_does_not_rewrite_past_trips(self):
        self._report(jdate(1405, 7, 3), 10, tasks=[{"destination": "انبار", "route": str(self.route.pk)}])
        self.route.price = 900_000
        self.route.save()
        self.api.force_authenticate(self.boss)
        data = self.api.get("/api/driver-pay/?month=1405-07").data
        row = next(r for r in data["rows"] if r["driverName"] == "علی")
        self.assertEqual(row["routeAmount"], 500_000)

    def test_only_driver_managers_see_pay(self):
        self.api.force_authenticate(self.clerk)
        self.assertEqual(self.api.get("/api/driver-pay/?month=1405-07").status_code, 403)
        self.assertEqual(self.api.post("/api/driver-routes/", {"name": "x", "price": 1}).status_code, 403)
        self.assertEqual(self.api.get("/api/driver-routes/").status_code, 200)
