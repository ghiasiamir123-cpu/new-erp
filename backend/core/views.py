from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
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
    PayrollStaff,
    Product,
    Project,
    ProjectStage,
    StockItem,
    StockMovement,
    Warehouse,
)
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
    """جدول موجودی: هر ردیف یک کالا در یک انبار.

    موجودی از جمع دفتر گردش می‌آید، نه از فیلدی که رویش می‌نویسیم.
    """

    serializer_class = StockRowSerializer
    permission_classes = [CanAccessWarehouse]
    pagination_class = StockPagination
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        on_hand = Subquery(
            StockMovement.objects
            .filter(sku=OuterRef("sku"), warehouse=OuterRef("warehouse"))
            .values("sku")
            .annotate(total=Sum("qty"))
            .values("total")[:1],
            output_field=DecimalField(max_digits=14, decimal_places=2),
        )
        qs = (StockItem.objects
              .select_related("sku__product", "warehouse")
              .annotate(on_hand=Coalesce(on_hand, Value(0, output_field=DecimalField(max_digits=14, decimal_places=2)))))

        p = self.request.query_params
        if p.get("warehouse"):
            qs = qs.filter(warehouse_id=p["warehouse"])
        if p.get("brand"):
            qs = qs.filter(sku__product__brand=p["brand"])
        if p.get("category"):
            qs = qs.filter(sku__product__category=p["category"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(sku__product__name__icontains=q)
                | Q(sku__product__code__icontains=q)
                | Q(sku__site_package_id__icontains=q)
                | Q(sku__grit__icontains=q)
                | Q(sku__shade__icontains=q)
                | Q(shelf_code__icontains=q)
            )
        if p.get("below_min") == "1":
            qs = qs.filter(on_hand__lt=F("min_qty"), min_qty__gt=0)
        if p.get("in_stock") == "1":
            qs = qs.filter(on_hand__gt=0)
        return qs.order_by("sku__product__brand", "sku__product__name", "sku__pack_size")

    def partial_update(self, request, *args, **kwargs):
        """فقط قفسه و حداقل موجودی از این مسیر ویرایش می‌شود."""
        item = self.get_object()
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
        return Response(self.get_serializer(self.get_queryset().get(pk=item.pk)).data)

    @action(detail=False, methods=["get"])
    def meta(self, request):
        """برندها، دسته‌ها و خلاصهٔ وضعیت — برای فیلترهای صفحه."""
        products = Product.objects.filter(active=True)
        qs = self.get_queryset()
        totals = qs.aggregate(
            rows=Count("id"),
            in_stock=Count("id", filter=Q(on_hand__gt=0)),
            below=Count("id", filter=Q(on_hand__lt=F("min_qty"), min_qty__gt=0)),
        )
        return Response({
            "brands": sorted(set(products.values_list("brand", flat=True)) - {""}),
            "categories": sorted(set(products.values_list("category", flat=True)) - {""}),
            "totals": totals,
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
