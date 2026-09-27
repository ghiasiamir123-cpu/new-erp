"""کارانهٔ رانندگان و پول دریافتی از مشتری، به تفکیک ماه شمسی.

کارانهٔ هر راننده در یک ماه:
    کیلومترِ گزارش‌های تأییدشده × مبلغ هر کیلومترِ همان راننده در همان ماه
  + جمع قیمت مسیرهای ثابتی که آن ماه رفته (به قیمت روزِ رفتن)

گزارشی که هنوز تأیید نشده در کارانه نمی‌آید؛ کیلومترش جدا نشان داده می‌شود تا
معلوم باشد چه چیزی منتظر تأیید است. پولی که راننده از مشتری گرفته مال شرکت است و
از کارانه کم یا به آن اضافه نمی‌شود؛ فقط جمعش گزارش می‌شود تا تحویلش پیگیری شود.
"""

from __future__ import annotations

import datetime
import re
from collections import defaultdict
from decimal import Decimal

from rest_framework import permissions, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .jalali import gregorian_to_jalali, jalali_to_gregorian
from .models import Driver, DriverMonthRate, DriverReport, DriverRoute
from .permissions import HasAccess
from .serializers import DriverRouteSerializer

PAY_ACCESS = "driver.manage"
MONTH = re.compile(r"^(1[3-4]\d\d)-(0[1-9]|1[0-2])$")


def month_of(date) -> str:
    jy, jm, _jd = gregorian_to_jalali(date.year, date.month, date.day)
    return f"{jy:04d}-{jm:02d}"


def month_bounds(month: str):
    match = MONTH.match(month or "")
    if not match:
        raise ValidationError({"month": "ماه باید به شکل ۱۴۰۵-۰۷ باشد."})
    jy, jm = int(match.group(1)), int(match.group(2))
    start = jalali_to_gregorian(jy, jm, 1)
    ny, nm = (jy + 1, 1) if jm == 12 else (jy, jm + 1)
    end = jalali_to_gregorian(ny, nm, 1)
    return datetime.date(*start), datetime.date(*end)


def _num(value) -> float:
    return float(value or 0)


def summarize(month: str) -> dict:
    start, end = month_bounds(month)
    reports = (DriverReport.objects.filter(date__gte=start, date__lt=end)
               .select_related("driver").prefetch_related("tasks"))
    rates = {r.driver_id: r for r in DriverMonthRate.objects.filter(month=month)}

    rows = defaultdict(lambda: {
        "days": 0, "km": Decimal(0), "pendingKm": Decimal(0), "trips": 0,
        "routeAmount": Decimal(0), "collected": Decimal(0), "collections": 0,
    })
    names = {}
    for report in reports:
        key = report.driver_id or f"name:{report.driver_name}"
        names[key] = report.driver.name if report.driver else report.driver_name
        row = rows[key]
        distance = max(Decimal(str(report.odometer_end - report.odometer_start)), Decimal(0))
        approved = report.status == "approved"
        for task in report.tasks.all():
            # پول مشتری همیشه شمرده می‌شود — پول دست راننده است، تأیید شده یا نه.
            if task.collected_amount:
                row["collected"] += task.collected_amount
                row["collections"] += 1
            if approved and task.route_id:
                row["trips"] += 1
                row["routeAmount"] += task.route_price
        if approved:
            row["days"] += 1
            row["km"] += distance
        else:
            row["pendingKm"] += distance

    # راننده‌ای که آن ماه نرخ دارد ولی گزارشی نه، هم در جدول می‌آید.
    for driver_id in rates:
        if driver_id not in rows:
            rows[driver_id]
    for driver in Driver.objects.filter(active=True):
        if driver.pk not in rows:
            rows[driver.pk]
        names.setdefault(driver.pk, driver.name)
    for key in rows:
        if key not in names:
            names[key] = Driver.objects.filter(pk=key).values_list("name", flat=True).first() or "—"

    out = []
    for key, row in rows.items():
        rate = rates.get(key).rate_per_km if isinstance(key, int) and key in rates else Decimal(0)
        km_amount = (row["km"] * rate).quantize(Decimal(1))
        out.append({
            "driver": str(key) if isinstance(key, int) else None,
            "driverName": names[key],
            "days": row["days"],
            "km": _num(row["km"]),
            "pendingKm": _num(row["pendingKm"]),
            "ratePerKm": _num(rate),
            "kmAmount": _num(km_amount),
            "trips": row["trips"],
            "routeAmount": _num(row["routeAmount"]),
            "total": _num(km_amount + row["routeAmount"]),
            "collected": _num(row["collected"]),
            "collections": row["collections"],
        })
    out.sort(key=lambda r: (-r["total"], r["driverName"]))
    totals = {k: sum(r[k] for r in out) for k in
              ("km", "pendingKm", "kmAmount", "routeAmount", "total", "collected", "trips", "collections")}
    return {"month": month, "rows": out, "totals": totals}


class DriverRouteViewSet(viewsets.ModelViewSet):
    queryset = DriverRoute.objects.all()
    serializer_class = DriverRouteSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.IsAuthenticated()]
        return [HasAccess(PAY_ACCESS)()]


class DriverPayView(APIView):
    """GET ?month=1405-07 جدول کارانه · POST {driver, month, ratePerKm} نرخ را ذخیره می‌کند."""

    def get_permissions(self):
        return [HasAccess(PAY_ACCESS)()]

    def get(self, request):
        month = request.query_params.get("month") or month_of(datetime.date.today())
        data = summarize(month)
        months = sorted({month_of(d) for d in DriverReport.objects.values_list("date", flat=True)}
                        | {month}, reverse=True)
        data["months"] = months
        return Response(data)

    def post(self, request):
        month = request.data.get("month") or ""
        month_bounds(month)
        driver = Driver.objects.filter(pk=request.data.get("driver")).first()
        if driver is None:
            raise ValidationError({"driver": "راننده پیدا نشد."})
        try:
            rate = Decimal(str(request.data.get("ratePerKm") or 0))
        except Exception:
            raise ValidationError({"ratePerKm": "مبلغ هر کیلومتر باید عدد باشد."})
        if rate < 0:
            raise ValidationError({"ratePerKm": "مبلغ هر کیلومتر نمی‌تواند منفی باشد."})
        DriverMonthRate.objects.update_or_create(
            driver=driver, month=month,
            defaults={"rate_per_km": rate.quantize(Decimal(1)),
                      "updated_by_name": request.user.name or request.user.username})
        return Response(summarize(month))
