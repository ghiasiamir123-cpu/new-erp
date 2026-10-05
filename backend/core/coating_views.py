"""سود مرکز پوشش (core/coating_profit.py): گزارش، اصلاح نرخ و قیمت، مبلغ قرارداد و دریافتی کارفرما.

نشانی‌ها زیر همان «finance-reports/» گزارش‌های مالی‌اند.
"""
from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from . import production, stock_reports
from .models import Employee, Project, ProjectReceipt, Sku
from .permissions import CanViewFinanceReports, HasAccess
from .views import _float_or_none, _int_or_none


class CoatingProfitViewSet(viewsets.ViewSet):
    permission_classes = [CanViewFinanceReports]

    @action(detail=False, methods=["get"], url_path="coating-profit")
    def coating_profit(self, request):
        from . import coating_profit
        pid = request.query_params.get("project")
        if pid not in (None, ""):
            pk = _int_or_none(pid)
            if not pk or not Project.objects.filter(pk=pk, general=False).exists():
                raise ValidationError("پروژه پیدا نشد.")
            data = coating_profit.report(pk)
            if not data["projects"]:
                p = Project.objects.get(pk=pk)
                raise ValidationError(f"«{p.name}» هنوز هیچ هزینه، دریافتی یا مبلغ قراردادی ندارد.")
            return Response({**data, "project": data["projects"][0]})
        return Response(coating_profit.report(detail=request.query_params.get("detail") in ("1", "true")))

    @action(detail=False, methods=["post"], url_path="coating-rate",
            permission_classes=[HasAccess("financereports.costs")])
    def coating_rate(self, request):
        """نرخ هر ساعتِ یک کارگر. کارگری که فقط در گزارش‌های قدیمی آمده، غیرفعال ساخته می‌شود."""
        d = request.data or {}
        v = _float_or_none(d.get("hourlyCost"))
        if v is None or v <= 0:
            raise ValidationError("نرخ هر ساعت را به ریال و بزرگ‌تر از صفر وارد کنید.")
        pk = _int_or_none(d.get("employee"))
        if pk:
            e = Employee.objects.filter(pk=pk).first()
            if e is None:
                raise ValidationError("کارگر پیدا نشد.")
        else:
            name = (d.get("name") or "").strip()
            if not name:
                raise ValidationError("کارگر مشخص نیست.")
            key = production.norm_name(name)
            e = next((x for x in Employee.objects.all() if production.norm_name(x.name) == key), None)
            if e is None:
                e = Employee.objects.create(name=name, active=False)
        e.hourly_cost = Decimal(str(round(v)))
        e.save(update_fields=["hourly_cost"])
        return Response({"id": str(e.pk), "name": e.name, "hourlyCost": float(e.hourly_cost)})

    @action(detail=False, methods=["post"], url_path="coating-price",
            permission_classes=[HasAccess("financereports.costs")])
    def coating_price(self, request):
        """قیمت تمام‌شدهٔ هر واحد اصلیِ کالا (قیمت لیست)."""
        d = request.data or {}
        sku = Sku.objects.filter(pk=_int_or_none(d.get("sku"))).first()
        if sku is None:
            raise ValidationError("کالا پیدا نشد.")
        v = _float_or_none(d.get("costPrice"))
        if v is None or v <= 1:
            raise ValidationError(f"قیمت هر «{sku.base_unit or 'واحد'}» را به ریال وارد کنید.")
        sku.cost_price = Decimal(str(round(v, 2)))
        sku.save(update_fields=["cost_price"])
        return Response({"id": str(sku.pk), "costPrice": float(sku.cost_price)})

    @action(detail=False, methods=["post"], url_path="coating-unit",
            permission_classes=[HasAccess("financereports.costs")])
    def coating_unit(self, request):
        """تبدیل واحدِ مصرف به واحد اصلی کالا: «۱ حلب = ۱۸ کیلوگرم»."""
        d = request.data or {}
        sku = Sku.objects.filter(pk=_int_or_none(d.get("sku"))).first()
        if sku is None:
            raise ValidationError("کالا پیدا نشد.")
        unit = (d.get("unit") or "").strip()
        n = _float_or_none(d.get("perBase"))
        if not unit or n is None or n <= 0:
            raise ValidationError("بنویسید هر یک واحد اصلی چند واحدِ مصرف است.")
        if sku.alt_unit and sku.alt_unit.strip() != unit:
            raise ValidationError(
                f"«{sku.display_name}» واحد فرعی «{sku.alt_unit}» را دارد؛ واحد ردیف‌های مصرف را در "
                f"«مصرف مواد» به «{sku.base_unit}» یا «{sku.alt_unit}» اصلاح کنید.")
        sku.alt_unit = unit
        sku.alt_to_base = (Decimal(1) / Decimal(str(n))).quantize(Decimal("0.000001"))
        sku.save(update_fields=["alt_unit", "alt_to_base"])
        return Response({"id": str(sku.pk), "altUnit": sku.alt_unit, "altToBase": float(sku.alt_to_base)})

    @action(detail=False, methods=["post"], url_path="coating-contract",
            permission_classes=[HasAccess("financereports.costs")])
    def coating_contract(self, request):
        """مبلغ قرارداد پروژه؛ خالی یعنی هنوز معلوم نیست."""
        d = request.data or {}
        p = Project.objects.filter(pk=_int_or_none(d.get("project")), general=False).first()
        if p is None:
            raise ValidationError("پروژه پیدا نشد.")
        raw = d.get("price")
        v = None if raw in (None, "") else _float_or_none(raw)
        if raw not in (None, "") and (v is None or v < 0):
            raise ValidationError("مبلغ قرارداد باید عدد نامنفی باشد.")
        p.price = Decimal(str(round(v))) if v else None
        p.save(update_fields=["price"])
        return Response({"id": str(p.pk), "price": float(p.price) if p.price else None})

    @action(detail=False, methods=["post"], url_path="coating-receipts",
            permission_classes=[HasAccess("financereports.costs")])
    def coating_receipt_add(self, request):
        d = request.data or {}
        p = Project.objects.filter(pk=_int_or_none(d.get("project")), general=False).first()
        if p is None:
            raise ValidationError("پروژه پیدا نشد.")
        date = stock_reports.parse_date(d.get("date"), "تاریخ دریافت")
        if date is None:
            raise ValidationError("تاریخ دریافت را وارد کنید.")
        v = _float_or_none(d.get("amount"))
        if v is None or v <= 0:
            raise ValidationError("مبلغ دریافتی را به ریال وارد کنید.")
        r = ProjectReceipt.objects.create(
            project=p, date=date, amount=Decimal(str(round(v))), note=(d.get("note") or "").strip()[:300],
            recorded_by=request.user, recorded_by_name=request.user.name or request.user.username)
        return Response({"id": str(r.pk)}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["delete"], url_path=r"coating-receipts/(?P<rid>\d+)",
            permission_classes=[HasAccess("financereports.costs")])
    def coating_receipt_delete(self, request, rid=None):
        deleted, _ = ProjectReceipt.objects.filter(pk=rid).delete()
        if not deleted:
            raise ValidationError("دریافتی پیدا نشد.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class LabourShareViewSet(viewsets.ViewSet):
    """تسهیم حقوق به پروژه‌ها برای سند حقوق و دستمزد (core/labour_share.py).

    حقوقِ نیروها در این گزارش دیده می‌شود، پس کلیدِ خودش را دارد: داشتنِ «گزارش‌های مالی» کافی نیست."""
    permission_classes = [HasAccess("financereports.salary")]

    @action(detail=False, methods=["get"], url_path="labour-share")
    def labour_share(self, request):
        from . import labour_share
        start = stock_reports.parse_date(request.query_params.get("from"), "تاریخ شروع")
        end = stock_reports.parse_date(request.query_params.get("to"), "تاریخ پایان")
        if start is None or end is None:
            raise ValidationError("بازهٔ تاریخ را کامل وارد کنید.")
        if end < start:
            raise ValidationError("تاریخ پایان پیش از تاریخ شروع است.")
        if (end - start).days > 366:
            raise ValidationError("بازه بیش از یک سال است.")
        return Response(labour_share.report(start, end))

    @action(detail=False, methods=["post"], url_path="labour-salary")
    def labour_salary(self, request):
        """حقوق ماهانهٔ یک نیرو؛ خالی یعنی پاک شود."""
        from . import labour_share
        d = request.data or {}
        raw = d.get("salary")
        v = None if raw in (None, "") else _float_or_none(raw)
        if raw not in (None, "") and (v is None or v < 0):
            raise ValidationError("حقوق را به ریال و نامنفی وارد کنید.")
        if v and v > 100_000_000_000:
            raise ValidationError("این مبلغ برای حقوق ماهانهٔ یک نفر بیش از حد بزرگ است؛ عدد را دوباره نگاه کنید.")
        e = labour_share.set_salary(_int_or_none(d.get("employee")), d.get("name"), Decimal(str(round(v))) if v else None)
        if e is None:
            raise ValidationError("نیرو مشخص نیست.")
        return Response({"id": str(e.pk), "name": e.name, "salary": float(e.monthly_salary) if e.monthly_salary else None})
