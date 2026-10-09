"""سرویس‌های مشتریِ رانندگان، به تفکیک ماه شمسی.

راننده در گزارشِ روزش «سرویسِ مشتری» ثبت می‌کند: مسیری که رفته و مبلغی که از مشتری گرفته. این پول مالِ شرکت است؛
اینجا ماه به ماه فهرست و جمع زده می‌شود تا تحویلش پیگیری شود. پول دستِ راننده است چه گزارش تأیید شده باشد چه نه،
پس همه شمرده می‌شود و وضعیتِ گزارش کنارش می‌آید.
"""

from __future__ import annotations

import datetime
import re
from collections import defaultdict
from decimal import Decimal

from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .jalali import gregorian_to_jalali, jalali_to_gregorian
from .models import DriverReport, DriverTask
from .permissions import HasAccess

MANAGE = "driver.manage"
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


def summarize(month: str) -> dict:
    start, end = month_bounds(month)
    rows = []
    per = defaultdict(lambda: {"count": 0, "amount": Decimal(0)})
    for t in (DriverTask.objects.filter(customer_service=True, report__date__gte=start, report__date__lt=end)
              .select_related("report", "report__driver").order_by("-report__date", "-id")):
        r = t.report
        name = r.driver.name if r.driver else r.driver_name
        rows.append({"id": str(t.pk), "date": r.date, "driverName": name, "route": t.destination,
                     "customer": t.customer_name, "amount": float(t.collected_amount or 0), "status": r.status})
        per[name]["count"] += 1
        per[name]["amount"] += t.collected_amount or 0
    drivers = sorted(({"driverName": n, "count": v["count"], "amount": float(v["amount"])} for n, v in per.items()),
                     key=lambda x: (-x["amount"], x["driverName"]))
    return {"month": month, "rows": rows, "drivers": drivers,
            "totals": {"count": len(rows), "amount": sum(r["amount"] for r in rows),
                       "pending": sum(r["amount"] for r in rows if r["status"] != "approved")}}


class DriverServicesView(APIView):
    """GET ?month=1405-07 — سرویس‌های مشتریِ آن ماه، با جمعِ مبلغِ اخذشده."""

    def get_permissions(self):
        return [HasAccess(MANAGE)()]

    def get(self, request):
        month = request.query_params.get("month") or month_of(datetime.date.today())
        data = summarize(month)
        data["months"] = sorted({month_of(d) for d in DriverReport.objects.values_list("date", flat=True)} | {month},
                                reverse=True)
        return Response(data)
