import io
import os
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.db.models import Count, DecimalField, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import generics, permissions, status, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import (
    DailyReport,
    Driver,
    DriverReport,
    Employee,
    Material,
    MaterialUsageReport,
    PayrollEntry,
    PayrollMonth,
    PayrollSettings,
    PackConversion,
    PayrollStaff,
    Product,
    Project,
    ProjectStage,
    Sku,
    StockBatch,
    StockItem,
    StockMovement,
    StockVoucher,
    Supplier,
    Warehouse,
)
from .units import to_base
from .permissions import (
    CanAccessPayroll,
    CanAccessWarehouse,
    CanCreateDriverReport,
    CanCreateReport,
    IsManager,
)
from .serializers import (
    DailyReportSerializer,
    DriverReportSerializer,
    DriverSerializer,
    EmployeeSerializer,
    MaterialSerializer,
    MaterialUsageReportSerializer,
    PayrollMonthSerializer,
    PayrollSettingsSerializer,
    PayrollStaffSerializer,
    ProjectSerializer,
    StockMovementSerializer,
    StockRowSerializer,
    StockVoucherSerializer,
    SupplierSerializer,
    WarehouseWriteSerializer,
    WorkshopItemSerializer,
    UserCreateSerializer,
    UserSerializer,
    WarehouseSerializer,
)

User = get_user_model()


class ReviewableReportMixin:
    """روال مشترک ویرایش/ارسال/تأیید برای هر سه نوع گزارش روزانه.

    زیرکلاس‌ها owner_field (نام فیلد کاربرِ ثبت‌کننده) و section_fields
    (کلیدهایی که ویرایش محتوا حساب می‌شوند) را مشخص می‌کنند.
    """

    owner_field = "recorded_by_id"
    section_fields = ()

    def _has_content(self, report):
        """آیا گزارش چیزی برای ارسال دارد؟ زیرکلاس در صورت نیاز بازنویسی می‌کند."""
        return True

    def partial_update(self, request, *args, **kwargs):
        report = self.get_object()
        model = type(report)
        is_owner = request.user.id == getattr(report, self.owner_field)
        if not (is_owner or request.user.role == "manager"):
            return Response({"detail": "اجازهٔ دسترسی ندارید."}, status=403)

        has_sections = any(k in request.data for k in self.section_fields)
        new_status = request.data.get("status")
        if new_status is None and not has_sections:
            return Response({"detail": "چیزی برای به‌روزرسانی ارسال نشده."}, status=400)

        if has_sections and report.status == model.Status.APPROVED:
            return Response({"detail": "گزارش تأییدشده قابل ویرایش نیست."}, status=400)

        if has_sections:
            serializer = self.get_serializer(report, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            report.refresh_from_db()

        if new_status is not None:
            if new_status != model.Status.WAITING:
                return Response(
                    {"detail": "برای تأیید/اصلاح گزارش از مسیر feedback استفاده کنید."},
                    status=400,
                )
            if report.status not in (model.Status.DRAFT, model.Status.REVISION):
                return Response(
                    {"detail": "فقط پیش‌نویس یا گزارشِ نیازمند اصلاح قابل ارسال است."},
                    status=400,
                )
            if not self._has_content(report):
                return Response({"detail": "گزارش خالی قابل ارسال نیست."}, status=400)
            was_revision = report.status == model.Status.REVISION
            report.status = new_status
            report.resubmitted = was_revision
            report.save(update_fields=["status", "resubmitted", "updated_at"])

        report.refresh_from_db()
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManager])
    def feedback(self, request, pk=None):
        report = self.get_object()
        model = type(report)
        text = (request.data.get("text") or "").strip()
        new_status = request.data.get("status")
        if text:
            report.feedback.create(
                manager_name=request.user.name or request.user.username,
                text=text,
            )
        if new_status in (model.Status.APPROVED, model.Status.REVISION):
            report.status = new_status
            report.resubmitted = False
            report.save(update_fields=["status", "resubmitted", "updated_at"])
        elif text:
            report.save(update_fields=["updated_at"])
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)


class LoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    permission_classes = [permissions.AllowAny]


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    def post(self, request):
        current = request.data.get("current_password") or ""
        new = request.data.get("new_password") or ""
        if not request.user.check_password(current):
            return Response({"detail": "رمز فعلی نادرست است."}, status=400)
        if len(new) < 4:
            return Response({"detail": "رمز جدید باید حداقل ۴ کاراکتر باشد."}, status=400)
        request.user.set_password(new)
        request.user.must_change_password = False
        request.user.save(update_fields=["password", "must_change_password"])
        return Response(UserSerializer(request.user).data)


class UserListCreateView(generics.ListCreateAPIView):
    queryset = User.objects.all().order_by("username")
    permission_classes = [IsManager]

    def get_serializer_class(self):
        return UserCreateSerializer if self.request.method == "POST" else UserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all().prefetch_related("stages").order_by("name")
    serializer_class = ProjectSerializer

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action == "stages":
            return [CanCreateReport()]
        if self.action in ("update", "partial_update", "destroy"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]

    @action(detail=True, methods=["put"])
    def stages(self, request, pk=None):
        """جایگزینی کامل مراحل پروژه با لیستی که از فرم می‌آید."""
        project = self.get_object()
        payload = request.data.get("stages")
        if not isinstance(payload, list):
            return Response({"detail": "لیست مراحل ارسال نشده."}, status=400)

        seen = []
        for order, raw in enumerate(payload):
            name = (raw.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.append(name)
            try:
                area = float(raw.get("area") or 0)
            except (TypeError, ValueError):
                area = 0
            ProjectStage.objects.update_or_create(
                project=project,
                name=name,
                defaults={"area": area, "done": bool(raw.get("done")), "order": order},
            )
        project.stages.exclude(name__in=seen).delete()
        project.refresh_from_db()
        return Response(ProjectSerializer(project).data)


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all().order_by("name")
    serializer_class = EmployeeSerializer

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("update", "partial_update", "destroy"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class MaterialViewSet(viewsets.ModelViewSet):
    queryset = Material.objects.all().order_by("name")
    serializer_class = MaterialSerializer

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("update", "partial_update", "destroy"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class MaterialUsageReportViewSet(ReviewableReportMixin, viewsets.ModelViewSet):
    serializer_class = MaterialUsageReportSerializer
    section_fields = ("items",)
    queryset = (
        MaterialUsageReport.objects.all()
        .prefetch_related("items", "feedback")
        .select_related("recorded_by")
    )

    def _has_content(self, report):
        return report.items.exists()

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("destroy", "feedback"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class DriverViewSet(viewsets.ModelViewSet):
    queryset = Driver.objects.all().order_by("name")
    serializer_class = DriverSerializer

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateDriverReport()]
        if self.action in ("update", "partial_update", "destroy"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class DriverReportViewSet(ReviewableReportMixin, viewsets.ModelViewSet):
    serializer_class = DriverReportSerializer
    section_fields = (
        "driver", "delays", "tasks",
        "morningScheduledTime", "morningArrivalTime", "morningPassengers",
        "eveningScheduledTime", "eveningArrivalTime", "eveningPassengers",
        "odometerStart", "odometerEnd",
    )
    queryset = (
        DriverReport.objects.all()
        .prefetch_related("delays", "tasks", "feedback")
        .select_related("driver", "recorded_by")
    )

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateDriverReport()]
        if self.action in ("destroy", "feedback"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class ReportViewSet(ReviewableReportMixin, viewsets.ModelViewSet):
    serializer_class = DailyReportSerializer
    owner_field = "supervisor_id"
    section_fields = ("items", "progress", "description", "problems")
    queryset = (
        DailyReport.objects.all()
        .prefetch_related("items", "progress", "feedback")
        .select_related("supervisor")
    )

    def _has_content(self, report):
        return report.items.exists() or report.progress.exists()

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("destroy", "feedback"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


# ============ حقوق و دستمزد ============
# دادهٔ حقوق حساس است، پس همهٔ این مسیرها فقط برای مدیر باز است.

class PayrollSettingsView(APIView):
    permission_classes = [CanAccessPayroll]

    def get(self, request):
        return Response(PayrollSettingsSerializer(PayrollSettings.load()).data)

    def put(self, request):
        settings_obj = PayrollSettings.load()
        serializer = PayrollSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PayrollStaffViewSet(viewsets.ModelViewSet):
    queryset = PayrollStaff.objects.all()
    serializer_class = PayrollStaffSerializer
    permission_classes = [CanAccessPayroll]


class PayrollMonthViewSet(viewsets.ModelViewSet):
    queryset = PayrollMonth.objects.all().prefetch_related("entries__staff")
    serializer_class = PayrollMonthSerializer
    permission_classes = [CanAccessPayroll]

    @action(detail=False, methods=["post"])
    def open(self, request):
        """ماه را باز می‌کند؛ اگر تازه باشد، ارقام ثابت را از آخرین ماه قبل می‌آورد."""
        label = (request.data.get("label") or "").strip()
        if not label:
            return Response({"detail": "برچسب ماه لازم است."}, status=400)

        month = PayrollMonth.objects.filter(label=label).first()
        if month:
            return Response(self.get_serializer(month).data)

        previous = PayrollMonth.objects.order_by("-created_at").first()
        carried = {}
        if previous:
            for e in previous.entries.all():
                if e.staff_id:
                    carried[e.staff_id] = e

        month = PayrollMonth.objects.create(label=label)
        for staff in PayrollStaff.objects.filter(active=True):
            prev = carried.get(staff.id)
            PayrollEntry.objects.create(
                month=month, staff=staff, staff_name=staff.name, dept=staff.dept, position=staff.position,
                married=staff.married, children=staff.children,
                # سنوات و ایاب‌ذهاب ماه‌به‌ماه تقریباً ثابت‌اند، پس منتقل می‌شوند؛
                # غیبت و اضافه‌کار و کسورات هر ماه از صفر شروع می‌شود.
                seniority=prev.seniority if prev else 0,
                transport=prev.transport if prev else 0,
            )
        month.refresh_from_db()
        return Response(self.get_serializer(month).data, status=status.HTTP_201_CREATED)


# ============ انبار ============

class StockPagination(PageNumberPagination):
    page_size = 60
    page_size_query_param = "page_size"
    max_page_size = 500


class WarehouseViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Warehouse.objects.filter(active=True)
    serializer_class = WarehouseSerializer
    permission_classes = [CanAccessWarehouse]


class StockViewSet(viewsets.ModelViewSet):
    """جدول انبار: هر ردیف یک کالا، با موجودی هر انبار به‌صورت ستون جدا.

    پیش‌تر هر (کالا × انبار) یک ردیف بود؛ در جدول پهن ستون انبار از دید خارج
    می‌شد و کالا تکراری به نظر می‌رسید. موجودی از جمع دفتر گردش می‌آید.
    """

    serializer_class = StockRowSerializer
    permission_classes = [CanAccessWarehouse]
    pagination_class = StockPagination
    http_method_names = ["get", "patch", "head", "options"]

    def _pair_totals(self, warehouse_id=None):
        """موجودی هر (کالا، انبار) با یک کوئری — نه یکی به‌ازای هر ردیف."""
        if getattr(self, "_pairs", None) is None:
            moves = StockMovement.objects.values("sku_id", "warehouse_id").annotate(total=Sum("qty"))
            self._pairs = {(m["sku_id"], m["warehouse_id"]): (m["total"] or Decimal(0)) for m in moves}
        if warehouse_id:
            return {k: v for k, v in self._pairs.items() if str(k[1]) == str(warehouse_id)}
        return self._pairs

    def _stock_by_sku(self, skus, warehouse_id=None):
        sku_ids = [s.id for s in skus]
        pairs = self._pair_totals()
        items = StockItem.objects.filter(sku_id__in=sku_ids).select_related("warehouse")
        if warehouse_id:
            items = items.filter(warehouse_id=warehouse_id)

        out = {}
        for it in items:
            out.setdefault(it.sku_id, []).append({
                "warehouse": str(it.warehouse_id),
                "warehouseName": it.warehouse.name,
                "onHand": float(pairs.get((it.sku_id, it.warehouse_id), 0) or 0),
                "shelfCode": it.shelf_code,
                "minQty": float(it.min_qty),
                "reservedQty": float(it.reserved_qty),
                "countedAt": it.counted_at,
            })
        for rows in out.values():
            rows.sort(key=lambda r: r["warehouseName"])
        return out

    def get_queryset(self):
        qs = Sku.objects.filter(active=True).select_related("product")
        p = self.request.query_params
        if p.get("brand"):
            qs = qs.filter(product__brand=p["brand"])
        if p.get("category"):
            qs = qs.filter(product__category=p["category"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(product__name__icontains=q)
                | Q(product__code__icontains=q)
                | Q(site_package_id__icontains=q)
                | Q(grit__icontains=q)
                | Q(shade__icontains=q)
                | Q(stock_items__shelf_code__icontains=q)
            ).distinct()

        wh = p.get("warehouse") or None
        if p.get("in_stock") == "1":
            pairs = self._pair_totals(wh)
            per_sku = {}
            for (sku_id, _), v in pairs.items():
                per_sku[sku_id] = per_sku.get(sku_id, Decimal(0)) + v
            qs = qs.filter(id__in={k for k, v in per_sku.items() if v > 0})

        if p.get("below_min") == "1":
            pairs = self._pair_totals()
            items = StockItem.objects.filter(min_qty__gt=0)
            if wh:
                items = items.filter(warehouse_id=wh)
            low = {it["sku_id"] for it in items.values("sku_id", "warehouse_id", "min_qty")
                   if pairs.get((it["sku_id"], it["warehouse_id"]), Decimal(0)) < it["min_qty"]}
            qs = qs.filter(id__in=low)

        return qs.order_by("product__brand", "product__name", "pack_size")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        wh = request.query_params.get("warehouse") or None
        ctx = self.get_serializer_context()
        ctx["stock_by_sku"] = self._stock_by_sku(page, wh)
        return self.get_paginated_response(
            self.get_serializer(page, many=True, context=ctx).data
        )

    def partial_update(self, request, *args, **kwargs):
        """قفسه و حداقل موجودی، برای یک کالا در یک انبار مشخص."""
        sku = self.get_object()
        item = StockItem.objects.filter(sku=sku, warehouse_id=request.data.get("warehouse")).first()
        if item is None:
            return Response({"detail": "این کالا در انبار انتخاب‌شده تعریف نشده."}, status=400)

        allowed = {}
        if "shelfCode" in request.data:
            allowed["shelf_code"] = (request.data.get("shelfCode") or "").strip()
        if "minQty" in request.data:
            try:
                allowed["min_qty"] = Decimal(str(request.data.get("minQty") or 0))
            except (InvalidOperation, TypeError):
                return Response({"detail": "حداقل موجودی نامعتبر است."}, status=400)
        if not allowed:
            return Response({"detail": "چیزی برای به‌روزرسانی ارسال نشده."}, status=400)

        for k, v in allowed.items():
            setattr(item, k, v)
        item.save(update_fields=list(allowed))

        self._pairs = None
        ctx = self.get_serializer_context()
        ctx["stock_by_sku"] = self._stock_by_sku([sku], None)
        return Response(self.get_serializer(sku, context=ctx).data)

    @action(detail=False, methods=["get"])
    def meta(self, request):
        """برندها، دسته‌ها و خلاصهٔ وضعیت — برای فیلترهای صفحه."""
        products = Product.objects.filter(active=True)
        wh = request.query_params.get("warehouse") or None
        pairs = self._pair_totals()

        per_sku = {}
        for (sku_id, warehouse_id), v in pairs.items():
            if wh and str(warehouse_id) != str(wh):
                continue
            per_sku[sku_id] = per_sku.get(sku_id, Decimal(0)) + v

        items = StockItem.objects.filter(min_qty__gt=0)
        if wh:
            items = items.filter(warehouse_id=wh)
        below = {it["sku_id"] for it in items.values("sku_id", "warehouse_id", "min_qty")
                 if pairs.get((it["sku_id"], it["warehouse_id"]), Decimal(0)) < it["min_qty"]}

        return Response({
            "brands": sorted(set(products.values_list("brand", flat=True)) - {""}),
            "categories": sorted(set(products.values_list("category", flat=True)) - {""}),
            "totals": {
                "rows": Sku.objects.filter(active=True).count(),
                "in_stock": sum(1 for v in per_sku.values() if v > 0),
                "below": len(below),
            },
        })


class StockMovementViewSet(viewsets.ModelViewSet):
    serializer_class = StockMovementSerializer
    permission_classes = [CanAccessWarehouse]
    pagination_class = StockPagination
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = StockMovement.objects.select_related("sku__product", "warehouse", "batch")
        p = self.request.query_params
        if p.get("sku"):
            qs = qs.filter(sku_id=p["sku"])
        if p.get("warehouse"):
            qs = qs.filter(warehouse_id=p["warehouse"])
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return qs


class SupplierViewSet(viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [CanAccessWarehouse]


class StockVoucherViewSet(viewsets.ModelViewSet):
    """حوالهٔ ورود/خروج انبار.

    پیش‌نویس روی موجودی اثر ندارد؛ «ثبت نهایی» گردش‌ها را می‌سازد و برگه را
    قفل می‌کند. اصلاح یک حوالهٔ ثبت‌شده با حوالهٔ معکوس انجام می‌شود.
    """

    serializer_class = StockVoucherSerializer
    permission_classes = [CanAccessWarehouse]
    pagination_class = StockPagination

    def get_queryset(self):
        qs = (StockVoucher.objects
              .select_related("warehouse", "supplier")
              .prefetch_related("lines__sku__product"))
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("warehouse"):
            qs = qs.filter(warehouse_id=p["warehouse"])
        if p.get("kind"):
            qs = qs.filter(movement_kind=p["kind"])
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(number__icontains=q) | Q(counterparty__icontains=q) | Q(ref__icontains=q))
        return qs

    def destroy(self, request, *args, **kwargs):
        voucher = self.get_object()
        if voucher.status == StockVoucher.Status.POSTED:
            return Response(
                {"detail": "حوالهٔ ثبت‌شده حذف نمی‌شود. برای اصلاح، حوالهٔ معکوس بزنید."},
                status=400,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def post_voucher(self, request, pk=None):
        """ثبت نهایی: گردش‌ها ساخته می‌شوند و حواله قفل می‌شود."""
        voucher = self.get_object()
        if voucher.status == StockVoucher.Status.POSTED:
            return Response({"detail": "این حواله قبلاً ثبت شده."}, status=400)

        lines = list(voucher.lines.select_related("sku__product"))
        if not lines:
            return Response({"detail": "حوالهٔ بدون قلم قابل ثبت نیست."}, status=400)

        inbound = voucher.is_inbound
        sign = Decimal(1) if inbound else Decimal(-1)

        # برای خروج، اول کفایت موجودی همهٔ ردیف‌ها بررسی می‌شود تا حواله نیمه‌ثبت نشود.
        if not inbound:
            need = {}
            for ln in lines:
                need[ln.sku_id] = need.get(ln.sku_id, Decimal(0)) + to_base(ln.sku, ln.qty, ln.unit)
            have = {
                m["sku_id"]: (m["total"] or Decimal(0))
                for m in StockMovement.objects
                .filter(sku_id__in=need, warehouse=voucher.warehouse)
                .values("sku_id").annotate(total=Sum("qty"))
            }
            short = []
            for sku_id, qty in need.items():
                if have.get(sku_id, Decimal(0)) < qty:
                    sku = next(l.sku for l in lines if l.sku_id == sku_id)
                    short.append(f"{sku.product.name} ({sku.pack_size}): موجودی {have.get(sku_id, 0)}، لازم {qty}")
            if short:
                return Response({"detail": "موجودی کافی نیست — " + " · ".join(short[:4])}, status=400)

        is_transfer = voucher.movement_kind == StockMovement.Kind.TRANSFER_OUT
        actor = request.user.name or request.user.username

        with transaction.atomic():
            for ln in lines:
                batch = None
                if ln.batch_no.strip():
                    batch, _ = StockBatch.objects.get_or_create(
                        sku=ln.sku, batch_no=ln.batch_no.strip(),
                        defaults={"expires_on": ln.expires_on},
                    )
                base_qty = to_base(ln.sku, ln.qty, ln.unit)
                common = dict(
                    sku=ln.sku, batch=batch, entered_qty=ln.qty,
                    entered_unit=ln.unit or ln.sku.base_unit,
                    unit_cost=ln.unit_cost, date=voucher.date,
                    voucher=voucher, ref=voucher.ref,
                    note=ln.note or voucher.note,
                    created_by=request.user, created_by_name=actor,
                )
                StockMovement.objects.create(
                    warehouse=voucher.warehouse, kind=voucher.movement_kind,
                    qty=sign * base_qty, **common,
                )
                # انتقال هر دو طرف را با هم می‌سازد تا کالا بین دو انبار گم نشود.
                if is_transfer:
                    StockMovement.objects.create(
                        warehouse=voucher.to_warehouse,
                        kind=StockMovement.Kind.TRANSFER_IN,
                        qty=base_qty, **common,
                    )
                    StockItem.objects.get_or_create(sku=ln.sku, warehouse=voucher.to_warehouse)
                # قیمت خرید کالا از آخرین ورود به‌روز می‌شود.
                if inbound and ln.unit_cost:
                    Sku.objects.filter(pk=ln.sku_id).update(cost_price=ln.unit_cost)

            voucher.status = StockVoucher.Status.POSTED
            voucher.posted_at = timezone.now()
            voucher.save(update_fields=["status", "posted_at"])

        voucher.refresh_from_db()
        return Response(self.get_serializer(voucher).data)


class UnpackView(APIView):
    """شکستن بسته: یک جعبه از موجودی کم و معادل دانه‌اش اضافه می‌شود.

    چون جعبه و دانه در سایت دو کالای جدا هستند، بدون این کار انباری که فقط
    جعبه دارد نمی‌تواند سفارش دانه‌ای را جواب دهد.
    """

    permission_classes = [CanAccessWarehouse]

    def get(self, request):
        """آیا این کالا قابل شکستن است؟"""
        sku_id = request.query_params.get("sku")
        conv = (PackConversion.objects
                .select_related("box_sku__product", "unit_sku__product")
                .filter(box_sku_id=sku_id).first())
        if conv is None:
            return Response({"canUnpack": False})
        return Response({
            "canUnpack": True,
            "boxSku": str(conv.box_sku_id),
            "boxLabel": f"{conv.box_sku.product.name} · {conv.box_sku.pack_size}",
            "unitSku": str(conv.unit_sku_id),
            "unitLabel": f"{conv.unit_sku.product.name} · {conv.unit_sku.pack_size}",
            "factor": conv.factor,
        })

    def post(self, request):
        sku_id = request.data.get("sku")
        warehouse_id = request.data.get("warehouse")
        try:
            boxes = Decimal(str(request.data.get("qty") or 0))
        except (InvalidOperation, TypeError):
            return Response({"detail": "مقدار نامعتبر است."}, status=400)
        if boxes <= 0:
            return Response({"detail": "تعداد بسته باید بیشتر از صفر باشد."}, status=400)

        conv = PackConversion.objects.select_related("box_sku", "unit_sku").filter(box_sku_id=sku_id).first()
        if conv is None:
            return Response({"detail": "برای این کالا معادل دانه‌ای تعریف نشده است."}, status=400)
        warehouse = Warehouse.objects.filter(pk=warehouse_id).first()
        if warehouse is None:
            return Response({"detail": "انبار معتبر نیست."}, status=400)

        on_hand = (StockMovement.objects
                   .filter(sku=conv.box_sku, warehouse=warehouse)
                   .aggregate(s=Sum("qty"))["s"] or Decimal(0))
        if boxes > on_hand:
            return Response(
                {"detail": f"موجودی کافی نیست. موجودی فعلی: {on_hand}"}, status=400)

        pieces = boxes * conv.factor
        actor = request.user.name or request.user.username
        note = f"شکستن {boxes} × {conv.box_sku.pack_size} → {pieces} {conv.unit_sku.pack_size}"

        with transaction.atomic():
            StockMovement.objects.create(
                sku=conv.box_sku, warehouse=warehouse,
                kind=StockMovement.Kind.UNPACK_OUT, qty=-boxes,
                date=timezone.localdate(), note=note,
                created_by=request.user, created_by_name=actor,
            )
            StockMovement.objects.create(
                sku=conv.unit_sku, warehouse=warehouse,
                kind=StockMovement.Kind.UNPACK_IN, qty=pieces,
                date=timezone.localdate(), note=note,
                created_by=request.user, created_by_name=actor,
            )
            StockItem.objects.get_or_create(sku=conv.unit_sku, warehouse=warehouse)

        return Response({"boxes": float(boxes), "pieces": float(pieces), "note": note})


class WarehouseAdminViewSet(viewsets.ModelViewSet):
    """ساخت و ویرایش انبار — جدا از فهرست فقط‌خواندنی."""

    queryset = Warehouse.objects.all()
    serializer_class = WarehouseWriteSerializer
    permission_classes = [IsManager]


class WorkshopItemView(APIView):
    """ساخت کالای غیرفروشی (مواد کارگاه) که در سایت فروش نیست."""

    permission_classes = [CanAccessWarehouse]

    def post(self, request):
        serializer = WorkshopItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sku = serializer.save()
        return Response(
            {"id": str(sku.id), "packageId": sku.site_package_id, "name": sku.product.name},
            status=status.HTTP_201_CREATED,
        )


class CatalogImportView(APIView):
    """بارگذاری فایل اکسل انبارگردانی — کاتالوگ و موجودی را به‌روز می‌کند."""

    permission_classes = [IsManager]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "فایلی ارسال نشده."}, status=400)
        if not upload.name.lower().endswith((".xlsx", ".xlsm")):
            return Response({"detail": "فقط فایل اکسل (xlsx) پذیرفته می‌شود."}, status=400)

        import tempfile
        from django.core.management import call_command

        dry = str(request.data.get("dryRun", "")).lower() in ("1", "true", "yes")
        out = io.StringIO()
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            for chunk in upload.chunks():
                tmp.write(chunk)
            path = tmp.name
        try:
            args = [path]
            if dry:
                args.append("--dry-run")
            call_command("import_catalog", *args, stdout=out, user=request.user.username)
        except Exception as e:  # خطای فایل نامعتبر به کاربر برگردانده می‌شود
            return Response({"detail": f"خواندن فایل ممکن نشد: {e}"}, status=400)
        finally:
            os.unlink(path)

        return Response({"report": out.getvalue(), "dryRun": dry})
