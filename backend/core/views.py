from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, status, viewsets
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
    MaterialUsage,
    Project,
    ProjectStage,
)
from .permissions import CanCreateDriverReport, CanCreateReport, IsManager
from .serializers import (
    DailyReportSerializer,
    DriverReportSerializer,
    DriverSerializer,
    EmployeeSerializer,
    MaterialSerializer,
    MaterialUsageSerializer,
    ProjectSerializer,
    UserCreateSerializer,
    UserSerializer,
)

User = get_user_model()


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


class MaterialUsageViewSet(viewsets.ModelViewSet):
    serializer_class = MaterialUsageSerializer
    queryset = (
        MaterialUsage.objects.all()
        .select_related("project", "material", "recorded_by")
    )

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("destroy", "review"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """تأیید یا برگشت‌دادن یک ثبت مصرف مواد توسط مدیر."""
        usage = self.get_object()
        new_status = request.data.get("status")
        if new_status not in (MaterialUsage.Status.APPROVED, MaterialUsage.Status.REVISION):
            return Response({"detail": "وضعیت نامعتبر است."}, status=400)
        usage.status = new_status
        usage.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(usage).data)


class DriverViewSet(viewsets.ModelViewSet):
    queryset = Driver.objects.all().order_by("name")
    serializer_class = DriverSerializer

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateDriverReport()]
        if self.action in ("update", "partial_update", "destroy"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class DriverReportViewSet(viewsets.ModelViewSet):
    serializer_class = DriverReportSerializer
    queryset = (
        DriverReport.objects.all()
        .prefetch_related("delays", "tasks")
        .select_related("driver", "recorded_by")
    )

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateDriverReport()]
        if self.action == "destroy":
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class ReportViewSet(viewsets.ModelViewSet):
    serializer_class = DailyReportSerializer
    queryset = (
        DailyReport.objects.all()
        .prefetch_related("items", "progress", "feedback")
        .select_related("supervisor")
    )

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("destroy", "feedback"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]

    def partial_update(self, request, *args, **kwargs):
        """ویرایش بخش‌های گزارش و/یا ارسال آن برای تأیید.

        هر بخش (آیتم‌های کاری، متراژ) می‌تواند جداگانه ذخیره شود؛ فقط بخشی که
        در بدنهٔ درخواست آمده جایگزین می‌شود و بقیه دست‌نخورده می‌مانند.
        """
        report = self.get_object()
        is_owner = request.user.id == report.supervisor_id
        if not (is_owner or request.user.role == "manager"):
            return Response({"detail": "اجازهٔ دسترسی ندارید."}, status=403)

        has_sections = any(k in request.data for k in ("items", "progress", "description", "problems"))
        new_status = request.data.get("status")
        if new_status is None and not has_sections:
            return Response({"detail": "چیزی برای به‌روزرسانی ارسال نشده."}, status=400)

        # گزارش تأییدشده دیگر قابل ویرایش نیست.
        if has_sections and report.status == DailyReport.Status.APPROVED:
            return Response(
                {"detail": "گزارش تأییدشده قابل ویرایش نیست."},
                status=400,
            )

        if has_sections:
            serializer = self.get_serializer(report, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            report.refresh_from_db()

        if new_status is not None:
            if new_status != DailyReport.Status.WAITING:
                return Response(
                    {"detail": "برای تأیید/اصلاح گزارش از مسیر feedback استفاده کنید."},
                    status=400,
                )
            if report.status not in (DailyReport.Status.DRAFT, DailyReport.Status.REVISION):
                return Response(
                    {"detail": "فقط پیش‌نویس یا گزارشِ نیازمند اصلاح قابل ارسال است."},
                    status=400,
                )
            if not (report.items.exists() or report.progress.exists()):
                return Response(
                    {"detail": "گزارش خالی قابل ارسال نیست."},
                    status=400,
                )
            # اگر این گزارش برگشت‌خورده بود، حالا اصلاح‌شده به مدیر اعلام می‌شود.
            was_revision = report.status == DailyReport.Status.REVISION
            report.status = new_status
            report.resubmitted = was_revision
            report.save(update_fields=["status", "resubmitted", "updated_at"])

        report.refresh_from_db()
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManager])
    def feedback(self, request, pk=None):
        report = self.get_object()
        text = (request.data.get("text") or "").strip()
        new_status = request.data.get("status")
        if text:
            report.feedback.create(
                manager_name=request.user.name or request.user.username,
                text=text,
            )
        if new_status in (DailyReport.Status.APPROVED, DailyReport.Status.REVISION):
            report.status = new_status
            report.resubmitted = False
            report.save(update_fields=["status", "resubmitted", "updated_at"])
        elif text:
            report.save(update_fields=["updated_at"])
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)
