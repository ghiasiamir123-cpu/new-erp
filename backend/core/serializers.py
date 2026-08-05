from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    DailyReport,
    Driver,
    DriverDelay,
    DriverFeedback,
    DriverReport,
    DriverTask,
    Employee,
    Feedback,
    Material,
    MaterialUsage,
    MaterialUsageFeedback,
    MaterialUsageReport,
    Project,
    ProjectStage,
    ReportItem,
    ReportProgress,
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


class ProjectStageSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    area = serializers.FloatField(required=False)

    class Meta:
        model = ProjectStage
        fields = ["id", "name", "area", "done", "order"]


class ProjectSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    stages = ProjectStageSerializer(many=True, read_only=True)
    totalArea = serializers.SerializerMethodField()
    doneCount = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "name", "code", "active", "stages", "totalArea", "doneCount"]

    def get_totalArea(self, obj):
        return float(sum(s.area for s in obj.stages.all()))

    def get_doneCount(self, obj):
        return sum(1 for s in obj.stages.all() if s.done)


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

    class Meta:
        model = MaterialUsage
        fields = [
            "id", "project", "projectName", "material", "materialName",
            "materialCode", "unit", "quantity", "desc",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["project"] = str(instance.project_id) if instance.project_id else None
        data["material"] = str(instance.material_id) if instance.material_id else None
        return data


class MaterialUsageFeedbackSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    manager = serializers.CharField(source="manager_name", read_only=True)
    at = serializers.SerializerMethodField()

    class Meta:
        model = MaterialUsageFeedback
        fields = ["id", "manager", "text", "at"]

    def get_at(self, obj):
        return to_ms(obj.at)


class MaterialUsageReportSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    recordedBy = serializers.CharField(source="recorded_by.username", read_only=True)
    recordedByName = serializers.CharField(source="recorded_by_name", read_only=True)
    items = MaterialUsageSerializer(many=True, required=False)
    feedback = MaterialUsageFeedbackSerializer(many=True, read_only=True)
    resubmitted = serializers.BooleanField(read_only=True)
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = MaterialUsageReport
        fields = [
            "id", "date", "recordedBy", "recordedByName", "status", "resubmitted",
            "items", "feedback", "createdAt", "updatedAt",
        ]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def get_updatedAt(self, obj):
        return to_ms(obj.updated_at)

    def validate_status(self, value):
        if value not in (MaterialUsageReport.Status.DRAFT, MaterialUsageReport.Status.WAITING):
            raise serializers.ValidationError("وضعیت اولیهٔ نامعتبر است.")
        return value

    def _build_item(self, raw):
        """یک ردیف مصرف را با نام‌های ثبت‌شده می‌سازد تا با حذف ماده/پروژه گم نشود."""
        project_id = raw.pop("project", None) or None
        material_id = raw.pop("material", None) or None

        material = Material.objects.filter(pk=material_id).first() if material_id else None
        if material is None:
            raise serializers.ValidationError({"material": "مادهٔ انتخاب‌شده معتبر نیست."})

        project = Project.objects.filter(pk=project_id).first() if project_id else None
        if project is None:
            raise serializers.ValidationError({"project": "پروژهٔ انتخاب‌شده معتبر نیست."})

        return dict(
            project=project,
            project_name=project.name,
            material=material,
            material_name=material.name,
            material_code=material.code,
            unit=material.unit,
            **raw,
        )

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        request = self.context["request"]
        report = MaterialUsageReport.objects.create(
            recorded_by=request.user,
            recorded_by_name=request.user.name or request.user.username,
            **validated_data,
        )
        for raw in items_data:
            MaterialUsage.objects.create(report=report, **self._build_item(raw))
        return report

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        validated_data.pop("status", None)  # تغییر وضعیت در ویو انجام می‌شود

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if items_data is not None:
            built = [self._build_item(raw) for raw in items_data]
            instance.items.all().delete()
            for row in built:
                MaterialUsage.objects.create(report=instance, **row)
        return instance


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


class DriverFeedbackSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    manager = serializers.CharField(source="manager_name", read_only=True)
    at = serializers.SerializerMethodField()

    class Meta:
        model = DriverFeedback
        fields = ["id", "manager", "text", "at"]

    def get_at(self, obj):
        return to_ms(obj.at)


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
    feedback = DriverFeedbackSerializer(many=True, read_only=True)
    resubmitted = serializers.BooleanField(read_only=True)
    recordedBy = serializers.CharField(source="recorded_by.username", read_only=True)
    recordedByName = serializers.CharField(source="recorded_by_name", read_only=True)
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = DriverReport
        fields = [
            "id", "date", "driver", "driverName", "status", "resubmitted",
            "morningScheduledTime", "morningArrivalTime", "morningPassengers",
            "eveningScheduledTime", "eveningArrivalTime", "eveningPassengers",
            "odometerStart", "odometerEnd", "distanceKm",
            "delays", "tasks", "feedback", "recordedBy", "recordedByName",
            "createdAt", "updatedAt",
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

    def update(self, instance, validated_data):
        delays_data = validated_data.pop("delays", None)
        tasks_data = validated_data.pop("tasks", None)
        driver_id = validated_data.pop("driver", None) or None
        validated_data.pop("status", None)  # تغییر وضعیت در ویو انجام می‌شود

        if driver_id:
            driver = Driver.objects.filter(pk=driver_id).first()
            instance.driver = driver
            instance.driver_name = driver.name if driver else "—"
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if delays_data is not None:
            instance.delays.all().delete()
            for d in delays_data:
                if (d.get("reason") or "").strip():
                    DriverDelay.objects.create(report=instance, **d)

        if tasks_data is not None:
            instance.tasks.all().delete()
            for t in tasks_data:
                if (t.get("destination") or "").strip() or (t.get("description") or "").strip():
                    DriverTask.objects.create(report=instance, **t)
        return instance


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


class ReportProgressSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    project = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    projectName = serializers.CharField(source="project_name", read_only=True)
    area = serializers.FloatField(required=False)

    class Meta:
        model = ReportProgress
        fields = ["id", "project", "projectName", "stage", "area", "desc"]

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
    items = ReportItemSerializer(many=True, required=False)
    progress = ReportProgressSerializer(many=True, required=False)
    feedback = FeedbackSerializer(many=True, read_only=True)
    resubmitted = serializers.BooleanField(read_only=True)
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = DailyReport
        fields = [
            "id", "date", "shift", "supervisor", "supervisorName", "status", "resubmitted",
            "description", "problems", "items", "progress", "feedback", "createdAt", "updatedAt",
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
        # پیش‌نویس می‌تواند خالی باشد؛ کامل‌بودن هنگام ارسال برای تأیید بررسی می‌شود.
        return value

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        progress_data = validated_data.pop("progress", [])
        request = self.context["request"]
        report = DailyReport.objects.create(
            supervisor=request.user,
            supervisor_name=request.user.name or request.user.username,
            **validated_data,
        )

        def resolve_project(raw):
            project_id = raw.pop("project", None) or None
            if not project_id:
                return None, "—"
            project = Project.objects.filter(pk=project_id).first()
            return project, (project.name if project else "—")

        for item in items_data:
            if not (item.get("employee") or "").strip():
                continue
            project, project_name = resolve_project(item)
            ReportItem.objects.create(report=report, project=project, project_name=project_name, **item)

        for row in progress_data:
            if not (row.get("stage") or "").strip():
                continue
            project, project_name = resolve_project(row)
            ReportProgress.objects.create(report=report, project=project, project_name=project_name, **row)

        return report

    def update(self, instance, validated_data):
        """هر بخشی که در درخواست آمده جایگزین می‌شود؛ بخش‌های نیامده دست‌نخورده می‌مانند."""
        items_data = validated_data.pop("items", None)
        progress_data = validated_data.pop("progress", None)
        validated_data.pop("status", None)  # تغییر وضعیت در ویو انجام می‌شود

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        def resolve_project(raw):
            project_id = raw.pop("project", None) or None
            if not project_id:
                return None, "—"
            project = Project.objects.filter(pk=project_id).first()
            return project, (project.name if project else "—")

        if items_data is not None:
            instance.items.all().delete()
            for item in items_data:
                if not (item.get("employee") or "").strip():
                    continue
                project, project_name = resolve_project(item)
                ReportItem.objects.create(report=instance, project=project, project_name=project_name, **item)

        if progress_data is not None:
            instance.progress.all().delete()
            for row in progress_data:
                if not (row.get("stage") or "").strip():
                    continue
                project, project_name = resolve_project(row)
                ReportProgress.objects.create(report=instance, project=project, project_name=project_name, **row)

        return instance
