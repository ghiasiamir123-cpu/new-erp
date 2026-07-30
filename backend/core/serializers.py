from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import DailyReport, Feedback, Project, ReportItem

User = get_user_model()


def to_ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


class UserSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="username", read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "name", "role", "position"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=4)

    class Meta:
        model = User
        fields = ["username", "name", "role", "position", "password"]

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("این نام کاربری قبلاً وجود دارد.")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class ProjectSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = Project
        fields = ["id", "name", "code", "active"]


class ReportItemSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    project = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    projectName = serializers.CharField(source="project_name", read_only=True)
    hours = serializers.FloatField(required=False)
    percent = serializers.FloatField(required=False)

    class Meta:
        model = ReportItem
        fields = ["id", "employee", "project", "projectName", "activity", "hours", "percent", "desc"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["project"] = str(instance.project_id) if instance.project_id else None
        return data


class FeedbackSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    manager = serializers.CharField(source="manager_name", read_only=True)
    at = serializers.SerializerMethodField()

    class Meta:
        model = Feedback
        fields = ["id", "manager", "text", "at"]

    def get_at(self, obj):
        return to_ms(obj.at)


class DailyReportSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    supervisor = serializers.CharField(source="supervisor.username", read_only=True)
    supervisorName = serializers.CharField(source="supervisor_name", read_only=True)
    items = ReportItemSerializer(many=True)
    feedback = FeedbackSerializer(many=True, read_only=True)
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = DailyReport
        fields = [
            "id", "date", "shift", "supervisor", "supervisorName", "status",
            "description", "problems", "items", "feedback", "createdAt", "updatedAt",
        ]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def get_updatedAt(self, obj):
        return to_ms(obj.updated_at)

    def validate_status(self, value):
        if value not in (DailyReport.Status.DRAFT, DailyReport.Status.WAITING):
            raise serializers.ValidationError("وضعیت اولیهٔ نامعتبر است.")
        return value

    def validate_items(self, value):
        if not any((item.get("employee") or "").strip() for item in value):
            raise serializers.ValidationError("حداقل یک آیتم با نام پرسنل لازم است.")
        return value

    def create(self, validated_data):
        items_data = validated_data.pop("items")
        request = self.context["request"]
        report = DailyReport.objects.create(
            supervisor=request.user,
            supervisor_name=request.user.name or request.user.username,
            **validated_data,
        )
        for item in items_data:
            if not (item.get("employee") or "").strip():
                continue
            project_id = item.pop("project", None) or None
            project = None
            project_name = "—"
            if project_id:
                project = Project.objects.filter(pk=project_id).first()
                if project:
                    project_name = project.name
            ReportItem.objects.create(report=report, project=project, project_name=project_name, **item)
        return report
