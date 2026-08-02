from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    DailyReport,
    Driver,
    DriverDelay,
    DriverReport,
    DriverTask,
    Employee,
    Feedback,
    Material,
    MaterialUsage,
    Project,
    ReportItem,
)

User = get_user_model()


def to_ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


class UserSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="username", read_only=True)
    mustChangePassword = serializers.BooleanField(source="must_change_password", read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "name", "role", "position", "mustChangePassword"]


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
        user = User(**validated_data, must_change_password=True)
        user.set_password(password)
        user.save()
        return user


class ProjectSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = Project
        fields = ["id", "name", "code", "active"]


class EmployeeSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = Employee
        fields = ["id", "name", "active"]


class MaterialSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = Material
        fields = ["id", "name", "code", "unit", "active"]


class MaterialUsageSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    project = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    projectName = serializers.CharField(source="project_name", read_only=True)
    material = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    materialName = serializers.CharField(source="material_name", read_only=True)
    materialCode = serializers.CharField(source="material_code", read_only=True)
    unit = serializers.CharField(read_only=True)
    quantity = serializers.FloatField(required=False)
    recordedBy = serializers.CharField(source="recorded_by_name", read_only=True)
    createdAt = serializers.SerializerMethodField()

    class Meta:
        model = MaterialUsage
        fields = [
            "id", "date", "project", "projectName", "material", "materialName",
            "materialCode", "unit", "quantity", "desc", "recordedBy", "createdAt",
        ]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["project"] = str(instance.project_id) if instance.project_id else None
        data["material"] = str(instance.material_id) if instance.material_id else None
        return data

    def create(self, validated_data):
        request = self.context["request"]
        project_id = validated_data.pop("project", None) or None
        material_id = validated_data.pop("material", None) or None

        project = Project.objects.filter(pk=project_id).first() if project_id else None
        material = Material.objects.filter(pk=material_id).first() if material_id else None

        return MaterialUsage.objects.create(
            project=project,
            project_name=project.name if project else "—",
            material=material,
            material_name=material.name if material else "—",
            material_code=material.code if material else "",
            unit=material.unit if material else "",
            recorded_by=request.user,
            recorded_by_name=request.user.name or request.user.username,
            **validated_data,
        )


class DriverSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = Driver
        fields = ["id", "name", "active"]


class DriverDelaySerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = DriverDelay
        fields = ["id", "period", "reason"]


class DriverTaskSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = DriverTask
        fields = ["id", "time", "destination", "description"]


class DriverReportSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    driver = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    driverName = serializers.CharField(source="driver_name", read_only=True)
    morningScheduledTime = serializers.CharField(source="morning_scheduled_time", required=False, allow_blank=True)
    morningArrivalTime = serializers.CharField(source="morning_arrival_time", required=False, allow_blank=True)
    morningPassengers = serializers.CharField(source="morning_passengers", required=False, allow_blank=True)
    eveningScheduledTime = serializers.CharField(source="evening_scheduled_time", required=False, allow_blank=True)
    eveningArrivalTime = serializers.CharField(source="evening_arrival_time", required=False, allow_blank=True)
    eveningPassengers = serializers.CharField(source="evening_passengers", required=False, allow_blank=True)
    odometerStart = serializers.FloatField(source="odometer_start", required=False)
    odometerEnd = serializers.FloatField(source="odometer_end", required=False)
    distanceKm = serializers.SerializerMethodField()
    delays = DriverDelaySerializer(many=True, required=False)
    tasks = DriverTaskSerializer(many=True, required=False)
    recordedBy = serializers.CharField(source="recorded_by_name", read_only=True)
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = DriverReport
        fields = [
            "id", "date", "driver", "driverName",
            "morningScheduledTime", "morningArrivalTime", "morningPassengers",
            "eveningScheduledTime", "eveningArrivalTime", "eveningPassengers",
            "odometerStart", "odometerEnd", "distanceKm",
            "delays", "tasks", "recordedBy", "createdAt", "updatedAt",
        ]

    def get_distanceKm(self, obj):
        return float(obj.odometer_end - obj.odometer_start)

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def get_updatedAt(self, obj):
        return to_ms(obj.updated_at)

    def validate(self, attrs):
        start = attrs.get("odometer_start")
        end = attrs.get("odometer_end")
        if start is not None and end is not None and end and end < start:
            raise serializers.ValidationError(
                {"odometerEnd": "کیلومتر پایان نمی‌تواند از کیلومتر شروع کمتر باشد."}
            )
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["driver"] = str(instance.driver_id) if instance.driver_id else None
        return data

    def create(self, validated_data):
        delays_data = validated_data.pop("delays", [])
        tasks_data = validated_data.pop("tasks", [])
        driver_id = validated_data.pop("driver", None) or None
        request = self.context["request"]

        driver = Driver.objects.filter(pk=driver_id).first() if driver_id else None
        report = DriverReport.objects.create(
            driver=driver,
            driver_name=driver.name if driver else "—",
            recorded_by=request.user,
            recorded_by_name=request.user.name or request.user.username,
            **validated_data,
        )
        for d in delays_data:
            if (d.get("reason") or "").strip():
                DriverDelay.objects.create(report=report, **d)
        for t in tasks_data:
            if (t.get("destination") or "").strip() or (t.get("description") or "").strip():
                DriverTask.objects.create(report=report, **t)
        return report


class ReportItemSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    project = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    projectName = serializers.CharField(source="project_name", read_only=True)
    hours = serializers.FloatField(required=False)
    percent = serializers.FloatField(required=False)
    area = serializers.FloatField(required=False)

    class Meta:
        model = ReportItem
        fields = ["id", "employee", "project", "projectName", "activity", "hours", "percent", "area", "desc"]

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
