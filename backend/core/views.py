from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import DailyReport, Material, MaterialUsage, Project
from .permissions import CanCreateReport, IsManager
from .serializers import (
    DailyReportSerializer,
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
    queryset = Project.objects.all().order_by("name")
    serializer_class = ProjectSerializer

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
        if self.action == "destroy":
            return [IsManager()]
        return [permissions.IsAuthenticated()]


class ReportViewSet(viewsets.ModelViewSet):
    serializer_class = DailyReportSerializer
    queryset = (
        DailyReport.objects.all()
        .prefetch_related("items", "feedback")
        .select_related("supervisor")
    )

    def get_permissions(self):
        if self.action == "create":
            return [CanCreateReport()]
        if self.action in ("destroy", "feedback"):
            return [IsManager()]
        return [permissions.IsAuthenticated()]

    def partial_update(self, request, *args, **kwargs):
        report = self.get_object()
        new_status = request.data.get("status")
        if new_status is None:
            return Response({"detail": "چیزی برای به‌روزرسانی ارسال نشده."}, status=400)
        if new_status != DailyReport.Status.WAITING:
            return Response(
                {"detail": "برای تأیید/اصلاح گزارش از مسیر feedback استفاده کنید."},
                status=400,
            )
        is_owner = request.user.id == report.supervisor_id
        if not (is_owner or request.user.role == "manager"):
            return Response({"detail": "اجازهٔ دسترسی ندارید."}, status=403)
        if report.status != DailyReport.Status.REVISION:
            return Response(
                {"detail": "فقط گزارشی که نیاز به اصلاح دارد قابل ارسال مجدد است."},
                status=400,
            )
        report.status = new_status
        report.save(update_fields=["status", "updated_at"])
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
            report.save(update_fields=["status", "updated_at"])
        elif text:
            report.save(update_fields=["updated_at"])
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)
