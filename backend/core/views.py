import datetime
import io
import os
from decimal import ROUND_FLOOR, Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.db.models import Count, DecimalField, Exists, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce, NullIf
from rest_framework import generics, permissions, status, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import (
    DailyReport,
    Driver,
    DriverReport,
    Employee,
    Location,
    Material,
    MaterialUsage,
    MaterialUsageReport,
    PayrollEntry,
    PayrollMonth,
    PayrollSettings,
    PackConversion,
    PayrollStaff,
    SitePackLink,
    Product,
    Project,
    ProjectStage,
    ReportItem,
    ReportProgress,
    Sku,
    StockBatch,
    StockItem,
    StockMovement,
    StockVoucher,
    Supplier,
    UserAuditLog,
    Warehouse,
)
from .models import (ASSET_STATUSES, AssetEvent, AssetInspection, AssetInspectionLine,
                     Conversation, MaintenanceAlert, Message, StockCount)
from .models import WorkStage
from .serializers import WorkStageSerializer
from . import assets as asset_logic
from . import chat
from . import maintenance
from . import production
from . import stock_reports
from . import review, valresa
from .linking import LinkError
from .units import to_base
from .permissions import (
    CanAccessPayroll,
    CanAccessWarehouse,
    CanManageUsers,
    CanReviewConsumables,
    CanReviewFinance,
    CanReviewStock,
    CanViewFinanceReports,
    HasAccess,
)
from .serializers import (
    DailyReportSerializer,
    DriverReportSerializer,
    DriverSerializer,
    EmployeeSerializer,
    FinanceVoucherSerializer,
    MaterialSerializer,
    MaterialUsageReportSerializer,
    PayrollMonthSerializer,
    PayrollSettingsSerializer,
    PayrollStaffSerializer,
    ProjectSerializer,
    StockMovementSerializer,
    ConsumableCreateSerializer,
    ConsumableReviewSerializer,
    ConsumableSerializer,
    ItemSerializer,
    LocationSerializer,
    StockRowSerializer,
    StockVoucherSerializer,
    SupplierSerializer,
    WarehouseWriteSerializer,
    WorkshopItemSerializer,
    AssetEventSerializer,
    AssetInspectionSerializer,
    MaintenanceAlertSerializer,
    UserAuditLogSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
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

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        report = self.get_object()
        model = type(report)
        is_owner = request.user.id == getattr(report, self.owner_field)
        if not (is_owner or request.user.has_access("reports.edit")):
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

        self.after_change(report)
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)

    def after_change(self, report):
        """پس از هر ویرایش یا تغییر وضعیت، داخل همان تراکنش. گزارشی که اثری
        بیرون از خودش دارد (مثل کسر از انبار) اینجا آن اثر را هم‌گام می‌کند؛
        اگر نشود، کل تغییر برمی‌گردد."""

    @action(detail=True, methods=["post"], permission_classes=[HasAccess("reports.review")])
    @transaction.atomic
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
        self.after_change(report)
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)


class LoginSerializer(TokenObtainPairSerializer):
    # حساب غیرفعال هم همین پیام را می‌گیرد؛ نمی‌گوییم کدام‌یک، تا نام کاربری‌ها لو نرود.
    default_error_messages = {
        "no_active_account": "نام کاربری یا رمز نادرست است، یا این حساب غیرفعال شده است.",
    }

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


class MyPhotoView(APIView):
    """هر کاربر عکس پروفایل خودش را با PATCH تنظیم می‌کند؛ مدیر برای دیگران از صفحهٔ کاربران."""

    def patch(self, request):
        from .serializers import _clean_photo
        photo = _clean_photo(request.data.get("photo"))
        request.user.photo = photo
        request.user.save(update_fields=["photo"])
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


def log_user_change(target, actor, action, changes=None):
    UserAuditLog.objects.create(
        target=target, target_username=target.username, actor=actor,
        actor_name=((getattr(actor, "name", "") or getattr(actor, "username", "")) or "")[:150],
        action=action, changes=changes or {},
    )


class UserListCreateView(generics.ListCreateAPIView):
    queryset = User.objects.all().order_by("username")
    permission_classes = [CanManageUsers]

    def get_serializer_class(self):
        return UserCreateSerializer if self.request.method == "POST" else UserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user = serializer.save()
            log_user_change(user, request.user, UserAuditLog.Action.CREATED,
                            {"role": user.role, "access": list(user.access or [])})
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class UserUpdateView(generics.UpdateAPIView):
    """مشخصات، نقش، سربرگ‌ها و فعال بودن یک کاربر؛ هر تغییر در تاریخچه ثبت می‌شود."""

    queryset = User.objects.all()
    serializer_class = UserUpdateSerializer
    permission_classes = [CanManageUsers]
    lookup_field = "username"
    http_method_names = ["patch"]
    PROFILE_FIELDS = ("name", "role", "position")

    def update(self, request, *args, **kwargs):
        user = self.get_object()
        serializer = self.get_serializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # کسی که «کاربران» یا حساب خودش را از دست بدهد، دیگر نمی‌تواند برگرداند؛ چون
        # درخواست‌دهنده خودش «کاربران» را دارد، همین جلوی بی‌مدیر ماندن سامانه را هم می‌گیرد.
        if user.pk == request.user.pk:
            if "access" in data and "users" not in data["access"]:
                raise ValidationError("دسترسی «کاربران» را از خودتان نمی‌توانید بردارید.")
            if data.get("is_active") is False:
                raise ValidationError("حساب خودتان را نمی‌توانید غیرفعال کنید.")
            if "role" in data and data["role"] != user.role:
                raise ValidationError("نقش خودتان را نمی‌توانید عوض کنید؛ از کاربر دیگری که «کاربران» را دارد بخواهید.")

        before = {f: getattr(user, f) for f in self.PROFILE_FIELDS}
        was_active, old_access = user.is_active, list(user.access or [])
        with transaction.atomic():
            serializer.save()
            profile = {f: [before[f], getattr(user, f)] for f in self.PROFILE_FIELDS if before[f] != getattr(user, f)}
            if profile:
                log_user_change(user, request.user, UserAuditLog.Action.PROFILE, profile)
            if "access" in data:
                added = [k for k in user.access if k not in old_access]
                removed = [k for k in old_access if k not in user.access]
                if added or removed:
                    log_user_change(user, request.user, UserAuditLog.Action.ACCESS,
                                    {"added": added, "removed": removed})
            if was_active != user.is_active:
                log_user_change(user, request.user, UserAuditLog.Action.ACTIVATED if user.is_active
                                else UserAuditLog.Action.DEACTIVATED)
        return Response(UserSerializer(user).data)


class UserResetPasswordView(APIView):
    """رمز موقت از طرف کسی که «کاربران» را دارد؛ کاربر در ورود بعدی باید رمز خودش را بگذارد."""

    permission_classes = [CanManageUsers]

    def post(self, request, username):
        user = User.objects.filter(username=username).first()
        if user is None:
            return Response({"detail": "کاربر پیدا نشد."}, status=404)
        if user.pk == request.user.pk:
            raise ValidationError("رمز خودتان را از این‌جا نمی‌توانید بازنشانی کنید.")
        new = request.data.get("password") or ""
        if len(new) < 4:
            raise ValidationError("رمز تازه باید حداقل ۴ نویسه باشد.")
        with transaction.atomic():
            user.set_password(new)
            user.must_change_password = True
            user.save(update_fields=["password", "must_change_password"])
            log_user_change(user, request.user, UserAuditLog.Action.PASSWORD_RESET)
        return Response(UserSerializer(user).data)


class UserHistoryView(generics.ListAPIView):
    """تاریخچهٔ تغییرات کاربران — همه، یا فقط یک کاربر. آخرین ۱۰۰ مورد."""

    permission_classes = [CanManageUsers]
    serializer_class = UserAuditLogSerializer
    pagination_class = None

    def get_queryset(self):
        qs = UserAuditLog.objects.all()
        if self.kwargs.get("username"):
            qs = qs.filter(target_username=self.kwargs["username"])
        return qs[:100]


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all().prefetch_related("stages").order_by("name")
    serializer_class = ProjectSerializer

    def get_permissions(self):
        # پروژه از فرم ثبت گزارش هم ساخته می‌شود.
        if self.action in ("create", "stages"):
            return [HasAccess("projects.create", "entry.create")()]
        if self.action in ("update", "partial_update", "destroy", "close", "reopen",
                           "bulk_close", "plan_from_work"):
            return [HasAccess("projects.manage")()]
        return [permissions.IsAuthenticated()]

    @action(detail=True, methods=["put"])
    def stages(self, request, pk=None):
        """جایگزینی کامل مراحل پروژه با لیستی که از فرم می‌آید.

        مرحله باید از فهرست رسمی باشد و متراژش بزرگ‌تر از صفر — بی متراژ، صفحهٔ تولید
        نمی‌تواند بگوید پروژه چقدر پیش رفته و چقدر مانده.
        """
        project = self.get_object()
        payload = request.data.get("stages")
        if not isinstance(payload, list):
            return Response({"detail": "لیست مراحل ارسال نشده."}, status=400)

        official = {s.name: s for s in WorkStage.objects.all()}
        seen, rows = [], []
        for order, raw in enumerate(payload):
            name = (raw.get("name") or "").strip()
            if not name or name in seen:
                continue
            stage = official.get(name)
            if stage is None:
                return Response({"detail": f"مرحلهٔ «{name}» در فهرست رسمی مراحل نیست."}, status=400)
            try:
                area = float(raw.get("area") or 0)
            except (TypeError, ValueError):
                area = 0
            if stage.needs_area and area <= 0:
                return Response({"detail": f"متراژ مرحلهٔ «{name}» را وارد کنید."}, status=400)
            seen.append(name)
            rows.append((order, name, area, bool(raw.get("done"))))

        for order, name, area, done in rows:
            ProjectStage.objects.update_or_create(
                project=project, name=name,
                defaults={"area": area, "done": done, "order": order},
            )
        project.stages.exclude(name__in=seen).delete()
        project.refresh_from_db()
        return Response(ProjectSerializer(project).data)

    def _close_one(self, project, user, reason, note, date=None):
        """بستن یک پروژه. منطقش اینجاست تا بستن تکی و گروهی یکی باشند."""
        if project.is_closed:
            raise ValidationError(f"پروژهٔ «{project.name}» از قبل بسته شده است.")

        row = production.project_status(
            project,
            production._progress_by_project([production.DONE_STATUS]),
            production._progress_by_project(production.PENDING_STATUSES))

        reason = (reason or "").strip()
        if reason not in Project.CloseReason.values:
            # دلیل را خودمان حدس می‌زنیم: بی برنامه یعنی داده‌اش ناقص است، نه اینکه کامل شده.
            reason = (Project.CloseReason.INCOMPLETE_DATA if row["planned"] <= 0
                      else Project.CloseReason.SHORT if row["remaining"] > 0.01
                      else Project.CloseReason.COMPLETED)
        if reason == Project.CloseReason.COMPLETED and row["planned"] <= 0:
            raise ValidationError(
                f"«{project.name}» متراژ برنامه ندارد، پس نمی‌شود گفت تکمیل شده. "
                "یا متراژش را وارد کنید یا با دلیل «دادهٔ ناقص» ببندید.")

        project.closed_at = date or timezone.localdate()
        project.closed_by_name = (user.name or user.username)[:150]
        project.close_note = (note or "").strip()[:500]
        project.close_reason = reason
        project.closed_remaining = Decimal(str(row["remaining"]))
        project.save(update_fields=["closed_at", "closed_by_name", "close_note",
                                    "close_reason", "closed_remaining"])

        # اگر گروه گفتگویی دارد، همان‌جا خبر بدهیم؛ کسانی که رویش کار می‌کردند باید بدانند.
        conv = Conversation.objects.filter(project=project).first()
        if conv is not None:
            lines = [f"پروژهٔ «{project.name}» بسته شد.",
                     project.get_close_reason_display()]
            if reason == Project.CloseReason.SHORT and row["remaining"] > 0:
                lines.append(f"با {row['remaining']:g} متر مربع کسری نسبت به برنامه.")
            elif reason == Project.CloseReason.COMPLETED:
                lines.append("همهٔ متراژ برنامه انجام شد.")
            if project.close_note:
                lines.append(project.close_note)
            try:
                chat.send_message(conv, user, "\n".join(lines), "", "")
            except Exception:
                pass    # بسته‌شدن پروژه نباید به خاطر پیام گفتگو شکست بخورد

        project.refresh_from_db()
        return project

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def close(self, request, pk=None):
        """بستن پروژه: کارش تمام شد.

        بستن با کسری جلو گرفته نمی‌شود — گاهی مشتری کار را کم می‌کند یا بقیه‌اش منتفی
        می‌شود — ولی متراژِ مانده و دلیلِ بستن ثبت می‌شود تا بعداً معلوم باشد.
        """
        d = request.data or {}
        project = self._close_one(self.get_object(), request.user, d.get("reason"),
                                  d.get("note"), _date_or_none(d.get("date")))
        return Response(ProjectSerializer(project).data)

    @action(detail=False, methods=["post"], url_path="bulk-close")
    @transaction.atomic
    def bulk_close(self, request):
        """بستن چند پروژه با یک دلیل — برای جمع کردن پروژه‌های قدیمی."""
        d = request.data or {}
        ids = [_int_or_none(x) for x in (d.get("ids") or [])]
        ids = [i for i in ids if i]
        if not ids:
            raise ValidationError("پروژه‌ای انتخاب نشده.")
        projects = list(Project.objects.filter(pk__in=ids).prefetch_related("stages"))
        if len(projects) != len(set(ids)):
            raise ValidationError("بعضی از پروژه‌های انتخاب‌شده پیدا نشدند.")
        date = _date_or_none(d.get("date"))
        done = [self._close_one(p, request.user, d.get("reason"), d.get("note"), date)
                for p in projects]
        return Response({"closed": len(done),
                         "results": ProjectSerializer(done, many=True).data})

    @action(detail=True, methods=["post"], url_path="plan-from-work")
    @transaction.atomic
    def plan_from_work(self, request, pk=None):
        """متراژ برنامه را برابر کارِ ثبت‌شده می‌گذارد.

        برای پروژه‌های قدیمی که کار رویشان ثبت شده ولی برنامه‌شان هرگز وارد نشده. بعد از
        این، پروژه ۱۰۰٪ می‌شود و جمع «برنامه» با واقعیت می‌خواند.
        """
        project = self.get_object()
        if project.is_closed:
            raise ValidationError("پروژه بسته است؛ اول بازش کنید.")

        rows = (ReportProgress.objects
                .filter(project=project, report__status=production.DONE_STATUS)
                .values("stage").annotate(area=Sum("area")))
        work = {r["stage"]: float(r["area"] or 0) for r in rows if (r["area"] or 0) > 0}
        if not work:
            raise ValidationError("برای این پروژه کاری ثبت نشده که بشود برنامه را از رویش ساخت.")

        official = {s.name: s for s in WorkStage.objects.all()}
        order_of = {name: i for i, name in enumerate(official)}
        unknown = [n for n in work if n not in official]
        if unknown:
            raise ValidationError("این مرحله‌ها در فهرست رسمی نیستند: " + "، ".join(unknown))

        for name, area in work.items():
            ProjectStage.objects.update_or_create(
                project=project, name=name,
                defaults={"area": area, "done": True, "order": order_of.get(name, 0)})
        project.refresh_from_db()
        return Response(ProjectSerializer(project).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """بازکردن دوبارهٔ پروژه‌ای که اشتباه بسته شده یا کارش دوباره راه افتاده."""
        project = self.get_object()
        if not project.is_closed:
            raise ValidationError("این پروژه باز است.")
        project.closed_at = None
        project.closed_by_name = ""
        project.close_note = ""
        project.close_reason = ""
        project.closed_remaining = Decimal(0)
        project.save(update_fields=["closed_at", "closed_by_name", "close_note",
                                    "close_reason", "closed_remaining"])
        return Response(ProjectSerializer(project).data)


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all().order_by("name")
    serializer_class = EmployeeSerializer

    def get_permissions(self):
        if self.action == "create":
            return [HasAccess("entry.create")()]
        if self.action in ("update", "partial_update", "destroy"):
            return [HasAccess("dashboard.staff")()]
        return [permissions.IsAuthenticated()]


class MaterialViewSet(viewsets.ModelViewSet):
    queryset = Material.objects.all().order_by("name")
    serializer_class = MaterialSerializer

    def get_permissions(self):
        if self.action == "create":
            return [HasAccess("materials.create")()]
        if self.action in ("update", "partial_update", "destroy"):
            return [HasAccess("materials.manage")()]
        return [permissions.IsAuthenticated()]


def sync_usage_stock(report, actor):
    """گردش‌های مصرفِ یک گزارش را از روی خودِ گزارش از نو می‌سازد.

    گزارش منبع است و گردش آینه‌اش: فقط گزارشِ تأییدشده از انبار مصرفی کم
    می‌کند، و اگر از تأیید برگردد (برای اصلاح) کسرش هم برمی‌گردد. گزارشی که
    پیش از اتصال به انبار ثبت شده (affects_stock=False) اثری ندارد.
    """
    report.stock_movements.all().delete()
    if not report.affects_stock or report.status != MaterialUsageReport.Status.APPROVED:
        return

    warehouse = (Warehouse.objects.filter(supplies_workshop=True, active=True)
                 .order_by("id").first())
    if warehouse is None:
        raise ValidationError(
            "انبار مصرفی تولید تعریف نشده؛ در تعریف انبار گزینهٔ «کارگاه مواد خود "
            "را از این انبار برمی‌دارد» را روشن کنید.")

    actor_name = actor.name or actor.username
    for item in report.items.select_related("sku__product"):
        if item.sku is None:
            raise ValidationError(
                f"«{item.material_name}» به کالای انبار وصل نیست. گزارش را ویرایش و "
                "ماده را از فهرست انبار انتخاب کنید.")
        try:
            qty = to_base(item.sku, item.quantity, item.unit)
        except ValueError as exc:
            raise ValidationError(f"«{item.material_name}»: {exc}")
        StockItem.objects.get_or_create(sku=item.sku, warehouse=warehouse)
        StockMovement.objects.create(
            sku=item.sku, warehouse=warehouse, kind=StockMovement.Kind.WORKSHOP,
            qty=-qty, entered_qty=item.quantity,
            entered_unit=item.unit or item.sku.base_unit,
            date=report.date, usage_report=report,
            ref=f"مصرف مواد {report.id}",
            note=" — ".join(x for x in (item.project_name, item.desc) if x)[:300],
            created_by=actor, created_by_name=actor_name,
        )


class MaterialUsageReportViewSet(ReviewableReportMixin, viewsets.ModelViewSet):
    serializer_class = MaterialUsageReportSerializer
    section_fields = ("items",)
    queryset = (
        MaterialUsageReport.objects.all()
        .prefetch_related("items__sku", "feedback")
        .select_related("recorded_by")
        .annotate(stock_posted=Exists(StockMovement.objects.filter(usage_report=OuterRef("pk"))))
    )

    def _has_content(self, report):
        return report.items.exists()

    def after_change(self, report):
        sync_usage_stock(report, self.request.user)
        # stock_posted پیش از کسر محاسبه شده بود؛ کهنه است، پس پاسخ از خود دفتر گردش بخواند.
        report.__dict__.pop("stock_posted", None)

    def get_permissions(self):
        if self.action == "create":
            return [HasAccess("materials.create")()]
        if self.action == "destroy":
            return [HasAccess("reports.delete")()]
        if self.action == "feedback":
            return [HasAccess("reports.review")()]
        return [permissions.IsAuthenticated()]


class DriverViewSet(viewsets.ModelViewSet):
    queryset = Driver.objects.all().order_by("name")
    serializer_class = DriverSerializer

    def get_permissions(self):
        if self.action == "create":
            return [HasAccess("driver.create")()]
        if self.action in ("update", "partial_update", "destroy"):
            return [HasAccess("driver.manage")()]
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
            return [HasAccess("driver.create")()]
        if self.action == "destroy":
            return [HasAccess("reports.delete")()]
        if self.action == "feedback":
            return [HasAccess("reports.review")()]
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
            return [HasAccess("entry.create")()]
        if self.action == "destroy":
            return [HasAccess("reports.delete")()]
        if self.action == "feedback":
            return [HasAccess("reports.review")()]
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
                # موجودی معلوم است اگر شمرده شده یا از دفتر گردش پر شده (انتقال، مصرف).
                "known": bool(it.counted_at) or (it.sku_id, it.warehouse_id) in pairs,
            })
        # گردشی که ردیف انبار ندارد (حوالهٔ ورود پیش‌تر ردیف نمی‌ساخت) هم باید دیده شود؛
        # وگرنه موجودی واقعی در جدول صفر نشان داده می‌شد.
        seen = {(it.sku_id, it.warehouse_id) for it in items}
        wanted = set(sku_ids)
        loose = [(s, w) for (s, w) in pairs
                 if s in wanted and (s, w) not in seen and (not warehouse_id or str(w) == str(warehouse_id))]
        if loose:
            names = dict(Warehouse.objects.filter(pk__in={w for _, w in loose}).values_list("id", "name"))
            for s, w in loose:
                out.setdefault(s, []).append({
                    "warehouse": str(w), "warehouseName": names.get(w, ""),
                    "onHand": float(pairs[(s, w)] or 0), "shelfCode": "", "minQty": 0.0,
                    "reservedQty": 0.0, "countedAt": None, "known": True,
                })
        for rows in out.values():
            rows.sort(key=lambda r: r["warehouseName"])
        return out

    def _uncounted_items(self, warehouse_id=None):
        """ردیف‌هایی که موجودیشان نامعلوم است: نه شمرده شده‌اند نه گردشی دارند.

        ردیفی که با انتقال یا مصرف پر شده از دفتر گردش معلوم است و شمردن
        نمی‌خواهد؛ وگرنه انبار مصرفی سراسر «شمارش‌نشده» دیده می‌شد.
        """
        moved = StockMovement.objects.filter(
            sku_id=OuterRef("sku_id"), warehouse_id=OuterRef("warehouse_id"))
        items = StockItem.objects.filter(counted_at__isnull=True).exclude(Exists(moved))
        if warehouse_id:
            items = items.filter(warehouse_id=warehouse_id)
        return items

    def get_queryset(self):
        # اموال موجودیِ شمردنی نیستند؛ سربرگ خودشان را دارند و اینجا فقط
        # جدول را شلوغ می‌کنند.
        qs = (Sku.objects.filter(active=True, is_asset=False).select_related("product", "site_parent")
              # بستهٔ سایتی که کالاهای انبارش زیرمجموعه‌اش‌اند خودش کالای انبار نیست. اگر در جدول و
              # انتخاب کالای حواله می‌آمد، حواله روی آن زده می‌شد و موجودی از ردیف انبار جدا می‌ماند.
              # تا وقتی خودش گردشی دارد دیده می‌شود تا موجودی پنهان نشود.
              .annotate(_has_kids=Exists(Sku.objects.filter(site_parent=OuterRef("pk"))),
                        _has_moves=Exists(StockMovement.objects.filter(sku=OuterRef("pk"))))
              .exclude(_has_kids=True, _has_moves=False))
        p = self.request.query_params
        if p.get("brand"):
            qs = qs.filter(product__brand=p["brand"])
        if p.get("category"):
            qs = qs.filter(product__category=p["category"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(product__name__icontains=q)
                | Q(warehouse_name__icontains=q)
                | Q(site_name__icontains=q)
                # «میکروسمنت خمیری هوگون» باید کالای انبارِ زیرمجموعه را هم پیدا کند.
                | Q(site_parent__site_name__icontains=q)
                | Q(site_parent__product__name__icontains=q)
                | Q(site_parent__shop_pack_id__icontains=q)
                | Q(shop_pack_id__icontains=q)
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

        if p.get("uncounted") == "1":
            # هرگز شمرده نشده: عددِ صفرش ادعا نیست، فقط جای خالی است.
            qs = qs.filter(id__in=self._uncounted_items(wh).values("sku_id"))

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
    def turnover(self, request):
        """گردش کالا در بازه: اول دوره، ورود، خروج و پایان دوره برای هر کالا."""
        p = request.query_params
        wh = Warehouse.objects.filter(pk=_int_or_none(p.get("warehouse"))).first() if p.get("warehouse") else None
        return Response(stock_reports.turnover(
            warehouse=wh, date_from=stock_reports.parse_date(p.get("from"), "از تاریخ"),
            date_to=stock_reports.parse_date(p.get("to"), "تا تاریخ"), brand=p.get("brand") or "",
            category=p.get("category") or "", q=p.get("q") or "", only_moved=p.get("all") != "1",
            with_cost=request.user.has_access("warehouse.cost")))

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
                "rows": Sku.objects.filter(active=True, is_asset=False).count(),
                "in_stock": sum(1 for v in per_sku.values() if v > 0),
                "below": len(below),
                "uncounted": (self._uncounted_items(wh).filter(sku__is_asset=False)
                              .values("sku_id").distinct().count()),
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

    @action(detail=False, methods=["get"])
    def kardex(self, request):
        """کاردکس یک کالا: اول دوره، هر گردش با مانده، پایان دوره."""
        p = request.query_params
        sku = Sku.objects.filter(pk=_int_or_none(p.get("sku"))).first()
        if sku is None:
            raise ValidationError("کالا مشخص نیست.")
        wh = Warehouse.objects.filter(pk=_int_or_none(p.get("warehouse"))).first() if p.get("warehouse") else None
        return Response(stock_reports.kardex(
            sku, wh, stock_reports.parse_date(p.get("from"), "از تاریخ"), stock_reports.parse_date(p.get("to"), "تا تاریخ"),
            with_cost=request.user.has_access("warehouse.cost")))


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
    pagination_class = StockPagination

    def get_permissions(self):
        if self.action == "post_voucher":
            return [HasAccess("warehouse.post")()]
        if self.action in ("create", "update", "partial_update", "destroy", "resubmit_finance"):
            return [HasAccess("warehouse.voucher")()]
        return [CanAccessWarehouse()]

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
            # نام کالا هم: «همهٔ حواله‌هایی که Grundier Oil دارند».
            qs = qs.filter(Q(number__icontains=q) | Q(counterparty__icontains=q) | Q(ref__icontains=q)
                           | Q(lines__sku__warehouse_name__icontains=q) | Q(lines__sku__site_name__icontains=q)
                           | Q(lines__sku__product__name__icontains=q)
                           | Q(lines__sku__site_package_id__icontains=q)).distinct()
        return qs

    def destroy(self, request, *args, **kwargs):
        voucher = self.get_object()
        if voucher.status == StockVoucher.Status.POSTED:
            return Response(
                {"detail": "حوالهٔ ثبت‌شده حذف نمی‌شود. برای اصلاح، حوالهٔ معکوس بزنید."},
                status=400,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def holders(self, request):
        """کالایی که با «تحویل به شخص» دست هر نفر است (تحویل منهای برگشت)."""
        p = request.query_params
        wh = Warehouse.objects.filter(pk=_int_or_none(p.get("warehouse"))).first() if p.get("warehouse") else None
        return Response(stock_reports.holders(q=p.get("q") or "", warehouse=wh, include_all=p.get("all") == "1"))

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def resubmit_finance(self, request, pk=None):
        """پاسخ انبار به برگشت مالی؛ حواله دوباره به کارتابل مالی می‌رود."""
        voucher = self.get_object()
        if voucher.finance_status != StockVoucher.FinanceStatus.RETURNED:
            raise ValidationError("این حواله از مالی برنگشته است.")
        reply = (request.data.get("reply") or "").strip()
        if not reply:
            raise ValidationError("پاسخ به مالی را بنویسید: چه چیزی بررسی یا اصلاح شد.")
        voucher.warehouse_reply = reply[:500]
        voucher.finance_status = StockVoucher.FinanceStatus.PENDING
        voucher.save(update_fields=["warehouse_reply", "finance_status"])
        return Response(self.get_serializer(voucher).data)

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
            short_ids = [sku_id for sku_id, qty in need.items() if have.get(sku_id, Decimal(0)) < qty]
            if short_ids:
                # موجودیِ انبارهای دیگر هم گفته می‌شود: بیشترِ این خطاها از انتخاب انبار اشتباه است.
                elsewhere = {}
                for m in (StockMovement.objects.filter(sku_id__in=short_ids).exclude(warehouse=voucher.warehouse)
                          .values("sku_id", "warehouse__name").annotate(total=Sum("qty"))):
                    if m["total"] and m["total"] > 0:
                        elsewhere.setdefault(m["sku_id"], []).append(
                            {"warehouse": m["warehouse__name"], "qty": float(m["total"])})

                def fmt(d):
                    return f"{Decimal(str(d)).normalize():f}"

                items, text = [], []
                for sku_id in short_ids:
                    sku = next(l.sku for l in lines if l.sku_id == sku_id)
                    other = elsewhere.get(sku_id, [])
                    items.append({
                        "name": sku.display_name,
                        "siteName": sku.site_display_name if (sku.site_parent_id or sku.shop_pack_id) else "",
                        "unit": sku.base_unit, "need": float(need[sku_id]),
                        "have": float(have.get(sku_id, 0)), "elsewhere": other,
                    })
                    where = " · ".join(f"{o['warehouse']}: {fmt(o['qty'])}" for o in other) or "در هیچ انباری نیست"
                    text.append(f"{sku.display_name}: موجودی {fmt(have.get(sku_id, 0))}، لازم {fmt(need[sku_id])} ({where})")
                wrong = bool(elsewhere) and len(elsewhere) == len(short_ids)
                return Response({
                    # متن ساده برای جاهایی که پنجرهٔ مرتب ندارند؛ صفحهٔ حواله از «shortage» جدول می‌سازد.
                    "detail": f"موجودی «{voucher.warehouse.name}» کافی نیست —\n" + "\n".join(text[:6])
                              + ("\n\nانبار حواله را عوض کنید." if wrong else ""),
                    "shortage": {"voucher": voucher.number, "warehouse": voucher.warehouse.name,
                                 "items": items, "wrongWarehouse": wrong},
                }, status=400)

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
                StockItem.objects.get_or_create(sku=ln.sku, warehouse=voucher.warehouse)
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
            # خرید، مرجوعی و فروش پس از ثبت انبار به کارتابل مالی می‌روند.
            if voucher.movement_kind in StockVoucher.FINANCE_KINDS:
                voucher.finance_status = StockVoucher.FinanceStatus.PENDING
            voucher.save(update_fields=["status", "posted_at", "finance_status"])

        voucher.refresh_from_db()
        return Response(self.get_serializer(voucher).data)


class StockCountViewSet(viewsets.GenericViewSet):
    """برگهٔ انبارگردانی — منطقش در core/stock_reports.py.

    ساخت و نوشتن شمارش با «ساخت حواله»، ثبت نهایی با «ثبت نهایی حواله»؛ اجازهٔ تازه‌ای لازم نیست.
    """

    def get_permissions(self):
        if self.action == "post_count":
            return [HasAccess("warehouse.post")()]
        if self.action in ("create", "partial_update", "destroy", "add_line"):
            return [HasAccess("warehouse.voucher")()]
        return [CanAccessWarehouse()]

    def _get(self, pk, lock=False):
        qs = StockCount.objects.select_related("warehouse")
        if lock:
            qs = qs.select_for_update()
        count = qs.filter(pk=_int_or_none(pk)).first()
        if count is None:
            raise ValidationError("برگهٔ انبارگردانی پیدا نشد.")
        return count

    def _out(self, request, count, code=200):
        return Response(stock_reports.count_detail(count, request.user.has_access("warehouse.cost")), status=code)

    def list(self, request):
        return Response([stock_reports.count_row(c) for c in StockCount.objects.select_related("warehouse")[:200]])

    def retrieve(self, request, pk=None):
        return self._out(request, self._get(pk))

    @transaction.atomic
    def create(self, request):
        return self._out(request, stock_reports.create_count(request.data, request.user), status.HTTP_201_CREATED)

    @transaction.atomic
    def partial_update(self, request, pk=None):
        count = self._get(pk, lock=True)
        stock_reports.update_count(count, request.data)
        return self._out(request, count)

    @action(detail=True, methods=["post"], url_path="add-line")
    @transaction.atomic
    def add_line(self, request, pk=None):
        count = self._get(pk, lock=True)
        stock_reports.add_line(count, request.data.get("sku"))
        return self._out(request, count)

    @action(detail=True, methods=["post"], url_path="post")
    @transaction.atomic
    def post_count(self, request, pk=None):
        count = self._get(pk, lock=True)
        stock_reports.post_count(count, request.user)
        return self._out(request, count)

    def destroy(self, request, pk=None):
        count = self._get(pk)
        if count.status != StockCount.Status.DRAFT:
            raise ValidationError("برگهٔ ثبت‌شده پاک نمی‌شود؛ اصلاح‌هایش در دفتر انبار ثبت شده است.")
        count.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
            "boxLabel": f"{conv.box_sku.display_name} · {conv.box_sku.pack_size}",
            "unitSku": str(conv.unit_sku_id),
            "unitLabel": f"{conv.unit_sku.display_name} · {conv.unit_sku.pack_size}",
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
    permission_classes = [HasAccess("warehouse.setup")]


class WorkshopItemView(APIView):
    """ساخت کالای غیرفروشی (مواد کارگاه) که در سایت فروش نیست."""

    permission_classes = [CanAccessWarehouse]

    def post(self, request):
        serializer = WorkshopItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sku = serializer.save()
        return Response(
            {"id": str(sku.id), "packageId": sku.site_package_id, "name": sku.display_name},
            status=status.HTTP_201_CREATED,
        )


class CatalogImportView(APIView):
    """بارگذاری فایل اکسل انبارگردانی — کاتالوگ و موجودی را به‌روز می‌کند."""

    permission_classes = [HasAccess("warehouse.setup")]

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


def match_words(qs, q, fields):
    """هر کلمهٔ جست‌وجو باید در یکی از فیلدها باشد، به هر ترتیبی.

    جست‌وجوی کل عبارت «Grundier oil LM15» نامِ «Bormawachs - Preparation [Oil Base -
    Grundier Oil ...LM15]» را پیدا نمی‌کرد و کاربر کالا را دوباره تعریف می‌کرد.
    """
    for word in (q or "").split():
        cond = Q()
        for field in fields:
            cond |= Q(**{f"{field}__icontains": word})
        qs = qs.filter(cond)
    return qs


class ItemPagination(PageNumberPagination):
    page_size = 40
    page_size_query_param = "page_size"
    max_page_size = 300


class ItemViewSet(viewsets.ModelViewSet):
    """تعریف کالا: ساخت، ویرایش و فهرست — یک ردیف به ازای هر بسته (SKU)."""

    serializer_class = ItemSerializer
    permission_classes = [CanAccessWarehouse]
    pagination_class = ItemPagination

    def get_queryset(self):
        # شمار زیرمجموعه با زیرپرس، نه Count روی join: کنار Sum گردش‌ها، join موجودی را چندبرابر می‌کرد.
        variants = (Sku.objects.filter(site_parent=OuterRef("pk")).order_by()
                    .values("site_parent").annotate(c=Count("id")).values("c"))
        qs = (Sku.objects.select_related("product", "location", "site_parent")
              .prefetch_related("unit_packs__site_pack", "unit_links__sku")
              .annotate(on_hand=Coalesce(
                  Sum("movements__qty"),
                  Value(Decimal(0), output_field=DecimalField(max_digits=14, decimal_places=3)),
              ), variant_count=Coalesce(Subquery(variants), Value(0)))
              .order_by("product__brand", "product__name", "pack_size"))
        p = self.request.query_params
        q = (p.get("q") or "").strip()
        if q:
            qs = match_words(qs, q, (
                "product__name", "warehouse_name", "site_name", "shop_pack_id",
                "variant_label", "site_parent__site_name",
                "product__code", "barcode", "warehouse_code",
                "site_package_id", "product__brand", "asset_code", "holder_name",
                "location__name", "pack_size"))
        brand = (p.get("brand") or "").strip()
        if brand:
            qs = qs.filter(product__brand=brand)
        if (p.get("noUnits") or "") == "1":
            # کالاهایی که بسته‌بندی فرعی ندارند — همان‌هایی که باید تکمیل شوند.
            qs = qs.filter(Q(alt_unit="") | Q(alt_to_base__isnull=True))
        if (p.get("noWarehouseName") or "") == "1":
            # کالای سایتی که هنوز نام انبار (نام مالی) ندارد و رنگی از انبار هم زیرمجموعه‌اش نشده.
            qs = qs.filter(warehouse_name="").exclude(
                Exists(Sku.objects.filter(site_parent=OuterRef("pk")))).exclude(
                Exists(SitePackLink.objects.filter(site_pack=OuterRef("pk"))))
        if (p.get("mine") or "") == "1":
            # فقط کالاهای دست‌ساز، نه آنچه از سایت یا حسابداری آمده.
            qs = qs.filter(Q(site_package_id__startswith="W-")
                           | Q(site_package_id__startswith="MAT-"))
        # کالا و اموال دو فهرست جدا هستند: «کالاها» موجودی می‌شمارد، «اموال»
        # وسیله‌ها را دنبال می‌کند. این تقسیم فقط برای فهرست است — ویرایش و
        # حذفِ یک ردیف نباید به اینکه از کدام سربرگ آمده بند باشد.
        if self.action == "list":
            qs = qs.filter(is_asset=(p.get("assets") or "") == "1")
        if (p.get("assets") or "") == "1" or self.action != "list":
            qs = qs.annotate(last_service_on=asset_logic.last_service_subquery())
        if (p.get("holder") or "").strip():
            qs = qs.filter(holder_name=p["holder"].strip())
        loc = (p.get("location") or "").strip()
        if loc.isdigit():
            qs = qs.filter(location_id=int(loc))
        status_f = (p.get("status") or "").strip()
        if status_f in asset_logic.STATUS_LABELS:
            qs = qs.filter(asset_status=status_f)
        service_f = (p.get("service") or "").strip()
        if service_f in ("overdue", "soon", "due"):
            # «سرویس بعدی» محاسبه‌ای است؛ اموال کم‌شمارند، پس همین‌جا در پایتون جدا می‌شود.
            wanted = {"overdue", "soon"} if service_f == "due" else {service_f}
            ids = [s.pk for s in qs.filter(service_interval_days__isnull=False)
                   if asset_logic.next_service(s)[1] in wanted]
            qs = qs.filter(pk__in=ids)
        return qs

    @action(detail=False, methods=["get"], url_path="assets-summary")
    def assets_summary(self, request):
        """آمار اموال فعال: وضعیت، سرویس، گارانتی، ارزش خرید و دفتری."""
        skus = (Sku.objects.filter(is_asset=True, active=True).select_related("location")
                .annotate(last_service_on=asset_logic.last_service_subquery()))
        return Response(asset_logic.summary(skus))

    # ---------- اموال: اجازه و تاریخچهٔ خودکار ----------
    def _require_assets(self, is_asset):
        if is_asset and not self.request.user.has_access("warehouse.assets"):
            raise PermissionDenied("برای ثبت و ویرایش اموال، «انبار › ثبت و ویرایش اموال» لازم است.")

    def perform_create(self, serializer):
        self._require_assets(serializer.validated_data.get("is_asset", False))
        with transaction.atomic():
            sku = serializer.save()
            if sku.is_asset:
                asset_logic.log_created(sku, self.request.user)
                maintenance.sync()

    def perform_update(self, serializer):
        inst = serializer.instance
        self._require_assets(inst.is_asset or serializer.validated_data.get("is_asset", False))
        before = asset_logic.snapshot(inst) if inst.is_asset else None
        with transaction.atomic():
            sku = serializer.save()
            if sku.is_asset:
                if before is None:
                    asset_logic.log_created(sku, self.request.user)
                else:
                    asset_logic.log_changes(sku, before, self.request.user)
            if sku.is_asset or before is not None:     # وضعیت، دورهٔ سرویس یا گارانتی شاید عوض شده
                maintenance.sync()

    @action(detail=False, methods=["get"], url_path="valresa-formula")
    def valresa_formula(self, request):
        """مقدارهای پیشنهادیِ فرمول رنگ والرسا، از روی رنگ‌های والرسای موجود."""
        names = (Sku.objects.filter(warehouse_name__istartswith="Valresa",
                                    warehouse_name__icontains="[Tint Color")
                 .values_list("warehouse_name", flat=True))
        return Response(valresa.options(names))

    @action(detail=True, methods=["get"])
    def variants(self, request, pk=None):
        """رنگ‌های انبارِ یک بستهٔ سایت با موجودی هر کدام — کدام رنگ موجود است و کدام نه."""
        parent = self.get_object()
        rows = (Sku.objects.filter(site_parent=parent)
                .annotate(on_hand=Coalesce(
                    Sum("movements__qty"),
                    Value(Decimal(0), output_field=DecimalField(max_digits=14, decimal_places=3))))
                .order_by("variant_label", "id"))
        out = [{
            "id": str(s.id), "label": s.variant_label, "name": s.display_name,
            "code": s.barcode or s.warehouse_code or s.site_package_id,
            "siteName": s.site_display_name, "onHand": float(s.on_hand), "inStock": s.on_hand > 0,
            "baseUnit": s.base_unit,
        } for s in rows.select_related("site_parent", "product")]
        # بستهٔ دیگرِ یک کالا (جعبهٔ ۲۰ عددی از کالای عددی): موجودی به تعداد بستهٔ کامل.
        for link in SitePackLink.objects.filter(site_pack=parent).select_related("sku"):
            s = link.sku
            on_hand = s.movements.aggregate(q=Sum("qty"))["q"] or Decimal(0)
            packs = (on_hand / link.per_pack).to_integral_value(rounding=ROUND_FLOOR) if on_hand > 0 else Decimal(0)
            out.append({
                "id": str(s.id), "label": f"{s.display_name} — هر بسته {link.per_pack.normalize():f} {s.base_unit}",
                "name": s.display_name, "code": s.barcode or s.warehouse_code or s.site_package_id,
                "siteName": parent.site_name, "onHand": float(on_hand), "inStock": packs >= 1,
                "baseUnit": s.base_unit, "unit": True, "perPack": float(link.per_pack), "availablePacks": float(packs),
            })
        return Response({"results": out, "inStock": sum(1 for r in out if r["inStock"])})

    def destroy(self, request, *args, **kwargs):
        sku = self.get_object()
        self._require_assets(sku.is_asset)
        if sku.inspection_lines.exists():
            return Response({"detail": "این وسیله در برگهٔ بازرسی آمده و حذف نمی‌شود. به‌جایش «غیرفعال» کنید."},
                            status=400)
        if sku.unit_links.exists():
            return Response({"detail": "این بستهٔ سایت بستهٔ دیگرِ یک کالای انبار است و حذف نمی‌شود."}, status=400)
        if sku.site_variants.exists():
            return Response(
                {"detail": "رنگ‌های انبار زیرمجموعهٔ این بستهٔ سایت‌اند و حذف نمی‌شود."},
                status=400,
            )
        if sku.movements.exists():
            return Response(
                {"detail": "این کالا گردش انبار دارد و حذف نمی‌شود. "
                           "به‌جایش آن را «غیرفعال» کنید."},
                status=400,
            )
        if sku.usages.exists() or sku.legacy_materials.exists():
            return Response(
                {"detail": "این کالا در گزارش مصرف مواد آمده و حذف نمی‌شود. "
                           "به‌جایش آن را «غیرفعال» کنید."},
                status=400,
            )
        with transaction.atomic():
            product = sku.product
            sku.delete()
            # محصولی که دیگر هیچ بسته‌ای ندارد در فهرست‌ها دیده نمی‌شود ولی
            # در پایگاه داده می‌ماند و شمار کالاها را غلط نشان می‌دهد.
            if not product.skus.exists():
                product.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class LocationViewSet(viewsets.ModelViewSet):
    """محل‌های استقرار اموال. دیدن برای اهل انبار، ساخت و ویرایش برای مدیر."""

    queryset = Location.objects.all()
    serializer_class = LocationSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanAccessWarehouse()]
        return [HasAccess("warehouse.setup")()]

    def destroy(self, request, *args, **kwargs):
        location = self.get_object()
        if location.assets.exists():
            return Response(
                {"detail": "این محل اموالی دارد و حذف نمی‌شود. "
                           "به‌جایش آن را «غیرفعال» کنید."},
                status=400,
            )
        return super().destroy(request, *args, **kwargs)


def _int_or_none(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _date_or_none(value):
    """«۱۴۰۵-۰۶-۳۰» میلادیِ ISO از فرانت می‌آید؛ هر چیز دیگری None."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        return None


def _date_or_today(value, label="تاریخ"):
    if value in (None, ""):
        return timezone.localdate()
    try:
        return datetime.date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError(f"{label} معتبر نیست.")


class AssetEventViewSet(viewsets.GenericViewSet):
    """تاریخچهٔ یک وسیله؛ تعمیر، سرویس و یادداشت را کاربر ثبت می‌کند."""

    serializer_class = AssetEventSerializer

    def get_permissions(self):
        if self.action in ("create", "destroy"):
            return [HasAccess("warehouse.assets")()]
        return [CanAccessWarehouse()]

    def list(self, request):
        sku_id = _int_or_none(request.query_params.get("sku"))
        if sku_id is None:
            raise ValidationError("وسیله مشخص نیست.")
        qs = AssetEvent.objects.filter(sku_id=sku_id).select_related("inspection")[:300]
        return Response(self.get_serializer(qs, many=True).data)

    @transaction.atomic
    def create(self, request):
        sku = Sku.objects.select_for_update().filter(pk=_int_or_none(request.data.get("sku")), is_asset=True).first()
        if sku is None:
            raise ValidationError("وسیله پیدا نشد.")
        event = asset_logic.record_event(sku, request.data, request.user)
        maintenance.sync()
        return Response(self.get_serializer(event).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        event = AssetEvent.objects.filter(pk=_int_or_none(pk)).first()
        if event is None:
            return Response({"detail": "رخداد پیدا نشد."}, status=404)
        if event.kind not in AssetEvent.MANUAL_KINDS:
            raise ValidationError("فقط تعمیر، سرویس و یادداشت پاک می‌شود؛ بقیه خودکار ثبت شده‌اند.")
        event.delete()
        maintenance.sync()      # سرویسِ پاک‌شده شاید موعد سرویس را دوباره رسانده باشد
        return Response(status=status.HTTP_204_NO_CONTENT)


class AssetInspectionViewSet(viewsets.GenericViewSet):
    """بازرسی دوره‌ای اموال: ساخت برگه، ثبت نتیجهٔ هر وسیله، بستن."""

    serializer_class = AssetInspectionSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanAccessWarehouse()]
        return [HasAccess("warehouse.assets")()]

    def get_queryset(self):
        return AssetInspection.objects.select_related("location").prefetch_related("lines__sku__product")

    def _get(self, pk):
        ins = self.get_queryset().filter(pk=_int_or_none(pk)).first()
        if ins is None:
            raise ValidationError("برگهٔ بازرسی پیدا نشد.")
        return ins

    def _out(self, ins, status_code=200):
        fresh = self.get_queryset().get(pk=ins.pk)
        return Response(self.get_serializer(fresh, context={"with_lines": True}).data, status=status_code)

    def list(self, request):
        return Response(self.get_serializer(self.get_queryset()[:100], many=True).data)

    def retrieve(self, request, pk=None):
        return self._out(self._get(pk))

    @transaction.atomic
    def create(self, request):
        d = request.data
        title = (d.get("title") or "").strip()
        if not title:
            raise ValidationError("عنوان بازرسی را بنویسید.")
        date = _date_or_today(d.get("date"))
        location = None
        if d.get("location"):
            location = Location.objects.filter(pk=_int_or_none(d.get("location"))).first()
            if location is None:
                raise ValidationError("محل انتخاب‌شده پیدا نشد.")
        ins = AssetInspection.objects.create(
            number=asset_logic.next_inspection_number(date), title=title[:200], date=date, location=location,
            note=(d.get("note") or "").strip()[:500], created_by=request.user,
            created_by_name=(request.user.name or request.user.username)[:150])
        if not asset_logic.start_inspection(ins):
            raise ValidationError("در این محدوده هیچ وسیلهٔ فعالی ثبت نشده.")
        return self._out(ins, status.HTTP_201_CREATED)

    def _apply(self, ins, d):
        if ins.status != AssetInspection.Status.OPEN:
            raise ValidationError("این برگه بسته شده و دیگر ویرایش نمی‌شود.")
        fields = []
        if "title" in d:
            title = (d.get("title") or "").strip()
            if not title:
                raise ValidationError("عنوان بازرسی را خالی نگذارید.")
            ins.title = title[:200]
            fields.append("title")
        if "date" in d:
            ins.date = _date_or_today(d.get("date"))
            fields.append("date")
        if "note" in d:
            ins.note = (d.get("note") or "").strip()[:500]
            fields.append("note")
        if fields:
            ins.save(update_fields=fields)
        rows = d.get("lines")
        if rows is None:
            return
        if not isinstance(rows, list):
            raise ValidationError("ردیف‌های بازرسی معتبر نیست.")
        lines = {str(l.id): l for l in ins.lines.all()}
        actions = {k for k, _ in AssetInspectionLine.Action.choices}
        for row in rows:
            line = lines.get(str((row or {}).get("id")))
            if line is None:
                raise ValidationError("ردیفی که فرستاده شد در این برگه نیست.")
            if "present" in row:
                line.present = bool(row["present"])
            if "status" in row:
                if row["status"] not in asset_logic.STATUS_LABELS:
                    raise ValidationError("وضعیت وسیله معتبر نیست.")
                line.status = row["status"]
            if "needsAction" in row:
                line.needs_action = bool(row["needsAction"])
            if "action" in row:
                if (row["action"] or "") not in actions:
                    raise ValidationError("اقدام پیشنهادی معتبر نیست.")
                line.action = row["action"] or ""
            if "note" in row:
                line.note = (row["note"] or "").strip()[:300]
            if not line.needs_action:
                line.action = ""
            line.save()

    @transaction.atomic
    def partial_update(self, request, pk=None):
        ins = self._get(pk)
        self._apply(ins, request.data)
        return self._out(ins)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def close(self, request, pk=None):
        ins = self._get(pk)
        if request.data:
            self._apply(ins, request.data)
        if ins.status != AssetInspection.Status.OPEN:
            raise ValidationError("این برگه قبلاً بسته شده.")
        asset_logic.close_inspection(ins, request.user)
        maintenance.from_inspection(ins)
        maintenance.sync()
        return self._out(ins)

    def destroy(self, request, pk=None):
        ins = self._get(pk)
        if ins.status != AssetInspection.Status.OPEN:
            raise ValidationError("برگهٔ بسته‌شده پاک نمی‌شود؛ در تاریخچهٔ اموال آمده است.")
        ins.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProductionViewSet(viewsets.GenericViewSet):
    """تولید: وضعیت زندهٔ پروژه‌ها، متراژ هر نفر و توان کارگاه. منطقش در core/production.py."""

    permission_classes = [HasAccess("production")]

    def list(self, request):
        active_only = request.query_params.get("all") not in ("1", "true")
        return Response(production.board(active_only=active_only))

    @action(detail=False, methods=["get"])
    def people(self, request):
        return Response(production.person_areas(request.query_params.get("from") or None,
                                                request.query_params.get("to") or None))

    @action(detail=False, methods=["get"])
    def capacity(self, request):
        return Response(production.capacity(request.query_params.get("from") or None,
                                            request.query_params.get("to") or None))

    @action(detail=False, methods=["get"])
    def forecasts(self, request):
        """پیش‌بینی پایان همهٔ پروژه‌های در جریان."""
        return Response(production.forecasts())

    @action(detail=False, methods=["get"])
    def quote(self, request):
        """کارِ تازه‌ای به اندازهٔ area متر چقدر از کارگاه وقت می‌گیرد؟"""
        try:
            area = float(request.query_params.get("area") or 0)
        except (TypeError, ValueError):
            raise ValidationError("متراژ را عددی وارد کنید.")
        if area <= 0:
            raise ValidationError("متراژ را وارد کنید.")
        return Response(production.forecast(area))


class WorkStageViewSet(viewsets.ModelViewSet):
    """فهرست رسمی مراحل خط تولید — خواندنش برای همه، تغییرش با کلید production.stages."""

    queryset = WorkStage.objects.all()
    serializer_class = WorkStageSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.IsAuthenticated()]
        return [HasAccess("production.stages")()]

    def perform_destroy(self, instance):
        used = (ProjectStage.objects.filter(name=instance.name).exists()
                or ReportProgress.objects.filter(stage=instance.name).exists()
                or ReportItem.objects.filter(activity=instance.name).exists())
        if used:
            raise ValidationError("این مرحله در پروژه یا گزارش استفاده شده؛ به‌جای حذف، غیرفعالش کنید.")
        instance.delete()


class ChatViewSet(viewsets.GenericViewSet):
    """گفتگوی درون‌سازمانی: منطقش در core/chat.py.

    فقط عضو یک گفتگو می‌تواند پیام‌هایش را بخواند یا بفرستد؛ سربرگ «گفتگو» برای دیدن صفحه.
    """

    permission_classes = [HasAccess("chat")]

    def _get(self, request, pk):
        conv = chat.user_conversations(request.user).filter(pk=_int_or_none(pk)).first()
        if conv is None:
            raise ValidationError("گفتگو پیدا نشد.")
        return conv

    def list(self, request):
        rows = [chat.conversation_row(c, request.user)
                for c in chat.user_conversations(request.user).select_related()]
        return Response({"results": rows, "unread": sum(r["unread"] for r in rows)})

    @action(detail=False, methods=["get"])
    def unread(self, request):
        return Response({"unread": chat.unread_total(request.user)})

    @action(detail=False, methods=["get"], url_path="users")
    def known_users(self, request):
        """کاربران فعال که می‌شود با آنها گفتگو شروع کرد."""
        rows = [{"username": u.username, "name": u.name, "photo": u.photo}
                for u in User.objects.filter(is_active=True).exclude(pk=request.user.pk).order_by("name")]
        return Response(rows)

    @transaction.atomic
    def create(self, request):
        d = request.data or {}
        if d.get("kind") == "group":
            conv = chat.start_group(request.user, d.get("title"), d.get("members") or [])
        else:
            username = (d.get("username") or "").strip()
            if not username:
                raise ValidationError("کاربری برای گفتگو انتخاب نشده.")
            conv = chat.start_direct(request.user, username)
        return Response(chat.conversation_row(conv, request.user), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None):
        conv = self._get(request, pk)
        if request.method == "POST":
            msg = chat.send_message(conv, request.user, request.data.get("text"),
                                    request.data.get("attachment"), request.data.get("attachmentName"))
            return Response(chat.message_row(msg), status=status.HTTP_201_CREATED)
        after = _int_or_none(request.query_params.get("after"))
        qs = conv.messages.select_related("sender")
        if after:
            qs = qs.filter(pk__gt=after)
        qs = qs.order_by("id")[:500]
        return Response({"results": [chat.message_row(m) for m in qs]})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        conv = self._get(request, pk)
        chat.mark_read(conv, request.user)
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="project-group")
    def project_group(self, request):
        """گروه گفتگوی یک پروژه — اگر هست همان، وگرنه ساخته می‌شود."""
        pid = _int_or_none((request.data or {}).get("projectId"))
        project = Project.objects.filter(pk=pid).prefetch_related("stages").first() if pid else None
        if project is None:
            raise ValidationError("پروژه پیدا نشد.")
        conv, created = chat.project_group(project, request.user,
                                           (request.data or {}).get("members"))
        data = chat.conversation_row(conv, request.user)
        data["created"] = created
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class MaintenanceAlertViewSet(viewsets.GenericViewSet):
    """کارتابل تعمیر و نگهداری: اخطارهای اموال، ثبت سرویس و تعمیر، و بستن اخطارهای بازرسی.

    مسئول تعمیر لازم نیست به انبار دسترسی داشته باشد؛ هر چه لازم دارد همین‌جا می‌آید.
    """

    serializer_class = MaintenanceAlertSerializer

    def get_permissions(self):
        if self.action in ("record", "close"):
            return [HasAccess("maintenance.work")()]
        return [HasAccess("maintenance")()]

    def get_queryset(self):
        return MaintenanceAlert.objects.select_related("sku__product", "sku__location", "inspection")

    def _get(self, pk):
        alert = self.get_queryset().filter(pk=_int_or_none(pk)).first()
        if alert is None:
            raise ValidationError("اخطار پیدا نشد.")
        return alert

    def list(self, request):
        maintenance.sync()
        qs = self.get_queryset()
        if request.query_params.get("status") == "done":
            rows = list(qs.filter(status=MaintenanceAlert.Status.DONE).order_by("-closed_at", "-id")[:200])
        else:
            rows = sorted(qs.filter(status=MaintenanceAlert.Status.OPEN), key=maintenance.sort_key)
        return Response({"results": self.get_serializer(rows, many=True).data, "counts": maintenance.counts()})

    @action(detail=False, methods=["get"])
    def count(self, request):
        """برای شمارندهٔ منو و خبر اخطار تازه؛ هر دقیقه خوانده می‌شود."""
        maintenance.sync_if_stale()
        return Response(maintenance.counts())

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        alert = self._get(pk)
        events = AssetEvent.objects.filter(sku_id=alert.sku_id).select_related("inspection")[:30]
        return Response(AssetEventSerializer(events, many=True).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def record(self, request, pk=None):
        """سرویس، تعمیر یا یادداشت روی وسیلهٔ این اخطار؛ اخطار بازرسی با همین کار بسته می‌شود."""
        alert = self._get(pk)
        if alert.status != MaintenanceAlert.Status.OPEN:
            raise ValidationError("این اخطار بسته شده است.")
        sku = Sku.objects.select_for_update().get(pk=alert.sku_id)
        event = asset_logic.record_event(sku, request.data, request.user)
        if alert.kind not in MaintenanceAlert.AUTO_KINDS:
            maintenance.close(alert, request.user, f"{event.get_kind_display()}: {event.description}")
        maintenance.sync()
        return Response(self.get_serializer(self._get(pk)).data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        alert = self._get(pk)
        if alert.status != MaintenanceAlert.Status.OPEN:
            raise ValidationError("این اخطار قبلاً بسته شده.")
        if alert.kind in MaintenanceAlert.AUTO_KINDS:
            raise ValidationError("این اخطار با ثبت سرویس یا تعمیر، یا عوض شدن وضعیت وسیله، خودکار بسته می‌شود.")
        note = (request.data.get("note") or "").strip()
        if not note:
            raise ValidationError("بنویسید نتیجهٔ پیگیری چه بود.")
        maintenance.close(alert, request.user, note)
        return Response(self.get_serializer(self._get(pk)).data)


class ConsumableViewSet(viewsets.GenericViewSet):
    """کالاهای انبار برای فرم مصرف مواد.

    برای هر کسی که مصرف ثبت می‌کند باز است، نه فقط اهل انبار؛ پس فقط نام و
    کد و واحد برمی‌گرداند — نه قیمت، نه موجودی.
    """

    # هر کسی که گزارش مصرف یا گزارش کار ثبت یا ویرایش می‌کند.
    permission_classes = [HasAccess("materials.create", "entry.create", "reports.edit")]

    def list(self, request):
        q = (request.query_params.get("q") or "").strip()
        qs = (Sku.objects.filter(active=True, is_asset=False)
              .select_related("product")
              .annotate(uses=Count("usages")))
        if q:
            qs = match_words(qs, q, (
                "product__name", "warehouse_name", "site_name", "warehouse_code",
                "product__code", "barcode", "product__brand", "pack_size"))
        else:
            # بی‌جست‌وجو: آنچه کارگاه واقعاً مصرف می‌کند، پرمصرف‌ها اول.
            qs = qs.filter(Q(uses__gt=0) | Q(site_package_id__startswith="MAT-")
                           | Q(site_package_id__startswith="W-"))
        qs = qs.order_by("-uses", "product__name")[:40]
        return Response(ConsumableSerializer(qs, many=True).data)

    def create(self, request):
        serializer = ConsumableCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sku = serializer.save()
        return Response(ConsumableSerializer(sku).data, status=status.HTTP_201_CREATED)


def refresh_usage_names(sku):
    """نام و کد انبارِ یک کالا را روی ردیف‌های گزارش مصرفش می‌نشاند.

    عکسِ نام در گزارش برای این است که تغییر اتفاقی نام، تاریخچه را عوض نکند؛
    اینجا مدیر عمداً نام را اصلاح می‌کند و می‌خواهد گزارش‌ها هم‌نام شوند.
    """
    return MaterialUsage.objects.filter(sku=sku).update(
        material_name=sku.display_name[:200],
        material_code=(sku.warehouse_code or sku.product.code or sku.barcode or "")[:50],
    )


class ConsumableReviewViewSet(viewsets.GenericViewSet):
    """اصلاح مواد مصرفی با استاندارد انبار: فهرست، تأیید، ادغام."""

    queryset = Sku.objects.filter(is_asset=False).select_related("product")

    def get_permissions(self):
        if self.action in ("confirm", "merge"):
            return [HasAccess("consumables.edit")()]
        return [CanReviewConsumables()]

    def _annotated(self):
        used = MaterialUsage.objects.filter(sku=OuterRef("pk"))
        # همان display_name مدل: نام انبار، و اگر نیست نام سایت، و آخر نام محصول.
        shown = Coalesce(NullIf("warehouse_name", Value("")), NullIf("site_name", Value("")),
                         "product__name")
        renamed = used.exclude(material_name=OuterRef("shown_name"))
        return (self.get_queryset().annotate(shown_name=shown)
                .annotate(is_used=Exists(used), is_renamed=Exists(renamed)))

    def _rows(self, skus):
        stats = {s.id: {"uses": 0, "reports": set(), "last": None, "names": set(), "units": set()}
                 for s in skus}
        for sku_id, report_id, date, name, unit in (
                MaterialUsage.objects.filter(sku_id__in=stats)
                .values_list("sku_id", "report_id", "report__date", "material_name", "unit")):
            st = stats[sku_id]
            st["uses"] += 1
            st["reports"].add(report_id)
            st["names"].add(name)
            st["units"].add(unit)
            if date and (st["last"] is None or date > st["last"]):
                st["last"] = date
        return ConsumableReviewSerializer(skus, many=True, context={"stats": stats}).data

    def list(self, request):
        p = request.query_params
        base = self._annotated().filter(Q(is_used=True) | Q(needs_review=True))
        review = base.filter(Q(needs_review=True) | Q(is_renamed=True))
        done = base.filter(needs_review=False, is_renamed=False)
        state = p.get("status") or "review"
        qs = review if state == "review" else done if state == "done" else base
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(product__name__icontains=q) | Q(warehouse_code__icontains=q)
                           | Q(warehouse_name__icontains=q) | Q(site_name__icontains=q)
                           | Q(product__code__icontains=q)
                           | Q(usages__material_name__icontains=q)).distinct()
        skus = list(qs.order_by("-needs_review", "product__name")[:500])
        return Response({
            "results": self._rows(skus),
            "totals": {"review": review.count(), "done": done.count()},
        })

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def confirm(self, request, pk=None):
        """«درست است»: نام و کد این کالا استاندارد است و روی گزارش‌ها هم می‌نشیند."""
        sku = self.get_object()
        sku.needs_review = False
        sku.save(update_fields=["needs_review"])
        renamed = refresh_usage_names(sku)
        return Response({"renamed": renamed, "row": self._rows([sku])[0]})

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def merge(self, request, pk=None):
        """مادهٔ نااستاندارد را در کالای درستِ انبار ادغام می‌کند و خودش را حذف."""
        source = self.get_object()
        try:
            target_pk = int(str(request.data.get("target")).strip())
        except (TypeError, ValueError):
            target_pk = None
        target = (Sku.objects.select_related("product")
                  .filter(pk=target_pk).first() if target_pk else None)
        if target is None:
            raise ValidationError("کالای مقصد در انبار پیدا نشد.")
        if target.is_asset:
            raise ValidationError(
                f"«{target.display_name}» کالای اموالی (وسیله) است؛ مواد مصرفی فقط در کالای "
                "مصرفی ادغام می‌شوند. «انتخاب دیگر» را بزنید و کالای مصرفیِ همین را انتخاب کنید.")
        if target.pk == source.pk:
            raise ValidationError("کالای مقصد همان کالای مبدأ است.")
        if source.shop_pack_id:
            raise ValidationError(
                f"«{source.display_name}» کالای سایت فروش است و در کالای دیگری ادغام نمی‌شود؛ "
                "اگر درست است، همین را مقصدِ ادغام بگیرید.")
        if source.movements.filter(usage_report__isnull=True).exists() or source.voucher_lines.exists():
            raise ValidationError(
                f"«{source.display_name}» گردش یا حوالهٔ انبار دارد و ادغام نمی‌شود؛ "
                "فقط موادی ادغام می‌شوند که تنها در گزارش مصرف آمده‌اند.")

        # گزارشی که از موجودی کم می‌کند باید واحدش در کالای مقصد باشد، وگرنه کسرش ممکن نیست.
        allowed = {u for u in (target.base_unit, target.alt_unit) if u}
        live = MaterialUsage.objects.filter(sku=source, report__affects_stock=True)
        stray = sorted(set(live.exclude(unit__in=allowed).values_list("unit", flat=True)) - {""})
        if stray:
            raise ValidationError(
                f"گزارش‌هایی که از موجودی کم می‌کنند «{source.display_name}» را با واحد "
                f"{'، '.join(stray)} ثبت کرده‌اند که «{target.display_name}» ندارد. "
                "اول این واحد را برای کالای مقصد تعریف کنید.")
        if target.alt_unit and not target.alt_to_base and live.filter(unit=target.alt_unit).exists():
            raise ValidationError(
                f"نرخ تبدیل «{target.alt_unit}» برای «{target.display_name}» تعریف نشده است.")

        report_ids = set(MaterialUsage.objects.filter(sku=source).values_list("report_id", flat=True))
        moved = MaterialUsage.objects.filter(sku=source).update(sku=target)
        Material.objects.filter(sku=source).update(sku=target)
        refresh_usage_names(target)
        # کسرِ گزارش‌های تأییدشده از روی کالای درست از نو ساخته می‌شود.
        for report in MaterialUsageReport.objects.filter(
                pk__in=report_ids, affects_stock=True, status=MaterialUsageReport.Status.APPROVED):
            sync_usage_stock(report, request.user)
        if source.movements.exists():
            raise ValidationError("پس از انتقال گزارش‌ها هنوز گردشی روی کالای مبدأ مانده؛ ادغام انجام نشد.")

        target.needs_review = False
        target.save(update_fields=["needs_review"])
        product = source.product
        source.delete()
        if not product.skus.exists():
            product.delete()
        return Response({"moved": moved, "row": self._rows([target])[0]})


def _money_input(value, label, allow_null=False):
    """عدد مالیِ ورودی: خالی ← صفر (یا None)، منفی و نامعتبر ← خطا."""
    if value in (None, ""):
        return None if allow_null else Decimal(0)
    try:
        amount = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        raise ValidationError(f"{label} عدد معتبر نیست.")
    if amount < 0:
        raise ValidationError(f"{label} نمی‌تواند منفی باشد.")
    return amount


class StockReviewViewSet(viewsets.ViewSet):
    """بازبینی انبار خانواده به خانواده: فهرست، جزئیات، تیک، و اتصال به سایت (core/review.py)."""

    def get_permissions(self):
        if self.action in ("mark", "link", "link_preview"):
            return [HasAccess("stockreview.edit")()]
        return [CanReviewStock()]

    @staticmethod
    def _run(fn, *args, **kwargs):
        try:
            return Response(fn(*args, **kwargs))
        except LinkError as exc:
            raise ValidationError(str(exc))

    def list(self, request):
        p = request.query_params
        try:
            page = max(1, int(p.get("page") or 1))
        except ValueError:
            page = 1
        return self._run(review.family_list, status=p.get("status") or "todo",
                         brand=(p.get("brand") or "").strip(), q=(p.get("q") or "").strip(), page=page)

    @action(detail=False, methods=["get"])
    def family(self, request):
        return self._run(review.family_detail, (request.query_params.get("key") or "").strip())

    @action(detail=False, methods=["post"])
    def mark(self, request):
        d = request.data
        return self._run(review.mark_family, str(d.get("family") or "").strip(),
                         str(d.get("status") or ""), str(d.get("note") or ""), request.user)

    def _link(self, request, dry_run):
        d = request.data
        packs = d.get("packs") or []
        if not isinstance(packs, list):
            raise ValidationError("فهرست بسته‌های سایت معتبر نیست.")
        return self._run(review.link_family, str(d.get("family") or "").strip(),
                         [str(x).strip() for x in packs if str(x).strip()], str(d.get("by") or "size"), dry_run)

    @action(detail=False, methods=["post"], url_path="link-preview")
    def link_preview(self, request):
        return self._link(request, True)

    @action(detail=False, methods=["post"])
    def link(self, request):
        return self._link(request, False)


class FinanceReportViewSet(viewsets.ViewSet):
    """گزارش‌های مالی (core/finance_reports.py)؛ قیمت‌ها از سایت فروش (core/shop.py)."""

    permission_classes = [CanViewFinanceReports]
    STALE = datetime.timedelta(hours=12)          # قیمت کهنه‌تر از این، با باز شدن گزارش دوباره خوانده می‌شود
    RETRY = datetime.timedelta(hours=1)           # اگر سایت در دسترس نبود، تا یک ساعت دوباره تلاش نمی‌شود

    @action(detail=False, methods=["get"], url_path="stock-value")
    def stock_value(self, request):
        from . import finance_reports, shop
        from .models import ShopPriceSync

        auto = None
        if shop.token_configured():
            now = timezone.now()
            last_ok = ShopPriceSync.objects.filter(ok=True).first()
            last_any = ShopPriceSync.objects.first()
            if (last_ok is None or now - last_ok.started_at > self.STALE) and \
                    (last_any is None or last_any.ok or now - last_any.started_at > self.RETRY):
                auto = shop.sync_prices(request.user, source="auto")
        data = finance_reports.stock_value_report()
        data["autoSync"] = auto
        data["tokenConfigured"] = shop.token_configured()
        return Response(data)

    @action(detail=False, methods=["post"], url_path="refresh-prices",
            permission_classes=[HasAccess("financereports.refresh")])
    def refresh_prices(self, request):
        from . import shop

        if not shop.token_configured():
            raise ValidationError("کلید اتصال به سایت هنوز در تنظیمات سامانه نیست؛ قیمت‌ها از آخرین خواندن‌اند.")
        result = shop.sync_prices(request.user, source="manual")
        if not result["ok"]:
            raise ValidationError(f"قیمت‌ها از سایت خوانده نشد: {result['message']}")
        return Response(result)


class FinancePagination(PageNumberPagination):
    page_size = 50


class FinanceVoucherViewSet(viewsets.GenericViewSet):
    """کارتابل مالی: قیمت‌گذاری، مغایرت‌گیری با فاکتور، تأیید یا برگشت به انبار."""

    serializer_class = FinanceVoucherSerializer

    def get_permissions(self):
        if self.action in ("partial_update", "approve", "send_back"):
            return [HasAccess("finance.approve")()]
        return [CanReviewFinance()]
    pagination_class = FinancePagination

    def get_queryset(self):
        return (StockVoucher.objects
                .filter(status=StockVoucher.Status.POSTED)
                .exclude(finance_status=StockVoucher.FinanceStatus.NONE)
                .select_related("warehouse")
                .prefetch_related("lines__sku__product")
                .order_by("-date", "-id"))

    def _fresh(self, voucher):
        return self.get_queryset().get(pk=voucher.pk)

    def list(self, request):
        p = request.query_params
        base = self.get_queryset()
        qs = base
        state = p.get("status") or "pending"
        if state != "all":
            qs = qs.filter(finance_status=state)
        if p.get("kind"):
            qs = qs.filter(movement_kind=p["kind"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(number__icontains=q) | Q(counterparty__icontains=q)
                           | Q(ref__icontains=q) | Q(invoice_no__icontains=q))
        page = self.paginate_queryset(qs)
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        response.data["totals"] = {
            s: base.filter(finance_status=s).count() for s in ("pending", "returned", "approved")
        }
        return response

    def retrieve(self, request, pk=None):
        return Response(self.get_serializer(self.get_object()).data)

    def _apply_edits(self, voucher, data):
        """فاکتور و قیمت‌ها را می‌نشاند. حوالهٔ تأییدشده قفل است."""
        if voucher.finance_status == StockVoucher.FinanceStatus.APPROVED:
            raise ValidationError("این حواله تأیید مالی شده و دیگر ویرایش نمی‌شود.")
        fields = []
        if "invoiceNo" in data:
            voucher.invoice_no = str(data.get("invoiceNo") or "").strip()[:60]
            fields.append("invoice_no")
        if "invoiceDate" in data:
            raw = data.get("invoiceDate")
            try:
                voucher.invoice_date = datetime.date.fromisoformat(raw) if raw else None
            except (TypeError, ValueError):
                raise ValidationError("تاریخ فاکتور معتبر نیست.")
            fields.append("invoice_date")
        for key, attr, label, nullable in (
                ("invoiceTotal", "invoice_total", "جمع کل فاکتور", True),
                ("invoiceDiscount", "invoice_discount", "تخفیف فاکتور", False),
                ("invoiceTax", "invoice_tax", "مالیات فاکتور", False)):
            if key in data:
                setattr(voucher, attr, _money_input(data.get(key), label, allow_null=nullable))
                fields.append(attr)
        if "financeNote" in data:
            voucher.finance_note = str(data.get("financeNote") or "").strip()[:500]
            fields.append("finance_note")
        if fields:
            voucher.save(update_fields=fields)

        rows = data.get("lines")
        if rows is None:
            return
        lines = {str(ln.id): ln for ln in voucher.lines.select_related("sku__product")}
        for row in rows:
            ln = lines.get(str((row or {}).get("id")))
            if ln is None:
                raise ValidationError("ردیفی که فرستاده شد در این حواله نیست.")
            name = ln.sku.display_name
            if "invoiceQty" in row:
                ln.invoice_qty = _money_input(row.get("invoiceQty"), f"مقدار فاکتورِ «{name}»", allow_null=True)
            if "unitCost" in row:
                ln.unit_cost = _money_input(row.get("unitCost"), f"قیمت خریدِ «{name}»")
            if "unitPrice" in row:
                ln.unit_price = _money_input(row.get("unitPrice"), f"قیمت فروشِ «{name}»")
            ln.save(update_fields=["invoice_qty", "unit_cost", "unit_price"])

    @transaction.atomic
    def partial_update(self, request, pk=None):
        voucher = self.get_object()
        self._apply_edits(voucher, request.data)
        return Response(self.get_serializer(self._fresh(voucher)).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def approve(self, request, pk=None):
        """تأیید مالی. با همان درخواست، آخرین ویرایش‌های فرم هم ذخیره می‌شود."""
        voucher = self.get_object()
        if voucher.finance_status == StockVoucher.FinanceStatus.RETURNED:
            raise ValidationError("این حواله به انبار برگشته و منتظر پاسخ انبار است.")
        if voucher.finance_status != StockVoucher.FinanceStatus.PENDING:
            raise ValidationError("این حواله در کارتابل مالی نیست.")
        if request.data:
            self._apply_edits(voucher, request.data)
        voucher = self._fresh(voucher)
        lines = list(voucher.lines.all())
        from .serializers import finance_summary
        summary = finance_summary(voucher, lines)
        if not voucher.invoice_no.strip():
            raise ValidationError("شمارهٔ فاکتور طرف حساب را وارد کنید.")
        if summary["unpriced"]:
            what = "قیمت خرید" if summary["priceBasis"] == "cost" else "قیمت فروش"
            raise ValidationError(f"{summary['unpriced']} قلم هنوز {what} ندارد.")
        if summary["hasDiscrepancy"] and not voucher.finance_note.strip():
            raise ValidationError(
                "این حواله با فاکتور مغایرت دارد؛ برای تأیید، توضیح مغایرت را در یادداشت مالی بنویسید.")

        # قیمت خرید و فروش، به واحد اصلیِ کالا، روی خود کالا می‌نشیند.
        if voucher.movement_kind == "receipt":
            for ln in lines:
                try:
                    per_unit = to_base(ln.sku, 1, ln.unit)   # چند واحد اصلی در یک واحدِ این ردیف
                except ValueError as exc:
                    raise ValidationError(f"«{ln.sku.display_name}»: {exc}")
                if ln.unit_cost:
                    base_cost = (ln.unit_cost / per_unit).quantize(Decimal("0.01"))
                    Sku.objects.filter(pk=ln.sku_id).update(cost_price=base_cost)
                    StockMovement.objects.filter(voucher=voucher, sku_id=ln.sku_id).update(unit_cost=base_cost)
                # قیمت فروشِ کالای سایت را سایت تعیین می‌کند؛ اینجا فقط کالای خودمان.
                if ln.unit_price and not ln.sku.shop_pack_id:
                    Sku.objects.filter(pk=ln.sku_id).update(
                        sale_price=(ln.unit_price / per_unit).quantize(Decimal("0.01")))

        voucher.finance_status = StockVoucher.FinanceStatus.APPROVED
        voucher.finance_by = request.user
        voucher.finance_by_name = request.user.name or request.user.username
        voucher.finance_at = timezone.now()
        voucher.save(update_fields=["finance_status", "finance_by", "finance_by_name", "finance_at"])
        return Response(self.get_serializer(self._fresh(voucher)).data)

    @action(detail=True, methods=["post"], url_path="reclaim")
    @transaction.atomic
    def reclaim(self, request, pk=None):
        """بازپس‌گیری از انبار: حواله‌ای که با اشتباه به انبار برگشته یا انبار نمی‌تواند اصلاحش کند، دوباره به کارتابل مالی بیاید."""
        voucher = self.get_object()
        if voucher.finance_status != StockVoucher.FinanceStatus.RETURNED:
            raise ValidationError("این حواله در انبار نیست تا بازپس گرفته شود.")
        if request.data:
            self._apply_edits(voucher, request.data)
        voucher.finance_status = StockVoucher.FinanceStatus.PENDING
        voucher.warehouse_reply = ""
        voucher.finance_by = request.user
        voucher.finance_by_name = request.user.name or request.user.username
        voucher.finance_at = timezone.now()
        voucher.save(update_fields=["finance_status", "warehouse_reply", "finance_by",
                                    "finance_by_name", "finance_at"])
        return Response(self.get_serializer(self._fresh(voucher)).data)

    @action(detail=True, methods=["post"], url_path="return")
    @transaction.atomic
    def send_back(self, request, pk=None):
        """برگشت به انبار با دلیل؛ ویرایش‌های فرم هم ذخیره می‌شود."""
        voucher = self.get_object()
        if voucher.finance_status != StockVoucher.FinanceStatus.PENDING:
            raise ValidationError("فقط حوالهٔ داخل کارتابل به انبار برمی‌گردد.")
        if request.data:
            self._apply_edits(voucher, request.data)
        voucher.refresh_from_db()
        if not voucher.finance_note.strip():
            raise ValidationError("دلیل برگشت را در یادداشت مالی بنویسید تا انبار بداند چه چیزی را بررسی کند.")
        voucher.finance_status = StockVoucher.FinanceStatus.RETURNED
        voucher.warehouse_reply = ""
        voucher.finance_by = request.user
        voucher.finance_by_name = request.user.name or request.user.username
        voucher.finance_at = timezone.now()
        voucher.save(update_fields=["finance_status", "warehouse_reply", "finance_by",
                                    "finance_by_name", "finance_at"])
        return Response(self.get_serializer(self._fresh(voucher)).data)
