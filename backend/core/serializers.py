from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import models, transaction
from rest_framework import serializers

from .jalali import jalali_year
from .units import to_base
from .models import (
    DailyReport,
    Driver,
    DriverDelay,
    DriverFeedback,
    DriverReport,
    DriverTask,
    Employee,
    Feedback,
    Location,
    Material,
    MaterialUsage,
    MaterialUsageFeedback,
    MaterialUsageReport,
    PayrollEntry,
    PayrollMonth,
    PayrollSettings,
    PayrollStaff,
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
    StockVoucherLine,
    Supplier,
    Warehouse,
)

User = get_user_model()


def to_ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


def _as_int(value):
    """شناسهٔ ورودی به عدد، یا None — تا مقدار بی‌ربط به کوئری پستگرس نرسد."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


class UserSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="username", read_only=True)
    mustChangePassword = serializers.BooleanField(source="must_change_password", read_only=True)
    canAccessWarehouse = serializers.BooleanField(source="can_access_warehouse",
                                                  required=False)

    class Meta:
        model = User
        fields = ["id", "username", "name", "role", "position", "mustChangePassword",
                  "canAccessWarehouse"]


class UserWarehouseAccessSerializer(serializers.ModelSerializer):
    """تنها چیزی که مدیر از صفحهٔ کاربران عوض می‌کند: اجازهٔ دیدن انبار."""

    canAccessWarehouse = serializers.BooleanField(source="can_access_warehouse")

    class Meta:
        model = User
        fields = ["canAccessWarehouse"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=4)
    canAccessWarehouse = serializers.BooleanField(source="can_access_warehouse",
                                                  required=False, default=False)

    class Meta:
        model = User
        fields = ["username", "name", "role", "position", "password", "canAccessWarehouse"]

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
    # کالای انبار — فهرست مواد مصرفی همان فهرست انبار است.
    sku = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    # فقط برای ردیف‌هایی که پیش از یکی‌شدن فهرست‌ها با «ماده» فرستاده می‌شوند.
    material = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    materialName = serializers.CharField(source="material_name", read_only=True)
    materialCode = serializers.CharField(source="material_code", read_only=True)
    unit = serializers.CharField(required=False, allow_blank=True)
    quantity = serializers.FloatField(required=False)

    class Meta:
        model = MaterialUsage
        fields = [
            "id", "project", "projectName", "sku", "material", "materialName",
            "materialCode", "unit", "quantity", "desc",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["project"] = str(instance.project_id) if instance.project_id else None
        data["material"] = str(instance.material_id) if instance.material_id else None
        data["sku"] = str(instance.sku_id) if instance.sku_id else None
        # واحدهای کالا تا فرم ویرایش بتواند میان اصلی و فرعی انتخاب بدهد.
        sku = instance.sku
        data["baseUnit"] = sku.base_unit if sku else ""
        data["altUnit"] = sku.alt_unit if sku else ""
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
    affectsStock = serializers.BooleanField(source="affects_stock", read_only=True)
    stockPosted = serializers.SerializerMethodField()
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = MaterialUsageReport
        fields = [
            "id", "date", "recordedBy", "recordedByName", "status", "resubmitted",
            "affectsStock", "stockPosted", "items", "feedback", "createdAt", "updatedAt",
        ]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def get_updatedAt(self, obj):
        return to_ms(obj.updated_at)

    def get_stockPosted(self, obj):
        return obj.stock_movements.exists()

    def validate_status(self, value):
        if value not in (MaterialUsageReport.Status.DRAFT, MaterialUsageReport.Status.WAITING):
            raise serializers.ValidationError("وضعیت اولیهٔ نامعتبر است.")
        return value

    def _build_item(self, raw, strict=True):
        """یک ردیف مصرف. نام و کد عکسِ لحظهٔ ثبت‌اند تا گزارش گذشته با تغییر
        نام کالا عوض نشود.

        strict: گزارشی که از موجودی کم می‌کند باید واحدی داشته باشد که به واحد
        اصلی کالا تبدیل شود. گزارش‌های پیش از اتصال این قید را ندارند.
        """
        project_id = raw.pop("project", None) or None
        sku_id = raw.pop("sku", None) or None
        material_id = raw.pop("material", None) or None
        unit = (raw.pop("unit", "") or "").strip()

        pk = _as_int(project_id)
        project = Project.objects.filter(pk=pk).first() if pk else None
        if project is None:
            raise serializers.ValidationError({"project": "پروژهٔ انتخاب‌شده معتبر نیست."})

        sku, material = None, None
        pk = _as_int(sku_id)
        if pk:
            sku = Sku.objects.select_related("product").filter(pk=pk, is_asset=False).first()
        elif material_id:
            material = (Material.objects.select_related("sku__product")
                        .filter(pk=_as_int(material_id)).first())
            sku = material.sku if material else None
        if sku is None:
            raise serializers.ValidationError({"sku": "کالای انتخاب‌شده در انبار پیدا نشد."})

        unit = unit or sku.base_unit or ""
        if strict:
            allowed = [u for u in (sku.base_unit, sku.alt_unit) if u]
            if allowed and unit not in allowed:
                raise serializers.ValidationError({"unit": (
                    f"واحد «{unit}» برای «{sku.product.name}» تعریف نشده؛ "
                    f"{' یا '.join(allowed)} را انتخاب کنید.")})
            if sku.alt_unit and unit == sku.alt_unit and not sku.alt_to_base:
                raise serializers.ValidationError({"unit": (
                    f"نرخ تبدیل «{unit}» برای «{sku.product.name}» در انبار تعریف نشده.")})

        return dict(
            project=project,
            project_name=project.name[:200],
            sku=sku,
            material=material,
            material_name=sku.product.name[:200],
            material_code=(sku.warehouse_code or sku.product.code or sku.barcode or "")[:50],
            unit=unit[:30],
            **raw,
        )

    @transaction.atomic
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
            built = [self._build_item(raw, strict=instance.affects_stock) for raw in items_data]
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


# ============ حقوق و دستمزد ============

class PayrollSettingsSerializer(serializers.ModelSerializer):
    dailyHours = serializers.FloatField(source="daily_hours", required=False)
    otMult = serializers.FloatField(source="ot_mult", required=False)
    insRate = serializers.FloatField(source="ins_rate", required=False)
    taxExempt = serializers.FloatField(source="tax_exempt", required=False)

    class Meta:
        model = PayrollSettings
        fields = ["dailyHours", "otMult", "insRate", "taxExempt", "components", "brackets"]

    def validate_components(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("فهرست اجزای حقوق نامعتبر است.")
        for row in value:
            if not isinstance(row, dict) or not (row.get("name") or "").strip():
                raise serializers.ValidationError("هر جزء حقوق باید نام داشته باشد.")
        return value

    def validate_brackets(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("پلکان مالیات نامعتبر است.")
        return value


class PayrollStaffSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = PayrollStaff
        fields = ["id", "name", "dept", "position", "married", "children", "active", "order"]

    def validate_name(self, value):
        if not (value or "").strip():
            raise serializers.ValidationError("نام پرسنل لازم است.")
        return value.strip()


class PayrollEntrySerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    staff = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    staffName = serializers.CharField(source="staff_name", required=False, allow_blank=True)
    absentDays = serializers.FloatField(source="absent_days", required=False)
    workedDays = serializers.FloatField(source="worked_days", required=False)
    otHours = serializers.FloatField(source="ot_hours", required=False)
    shortHours = serializers.FloatField(source="short_hours", required=False)
    kpi = serializers.FloatField(required=False)
    seniority = serializers.FloatField(required=False)
    transport = serializers.FloatField(required=False)
    responsibility = serializers.FloatField(required=False)
    insuranceManual = serializers.FloatField(source="insurance_manual", required=False)
    advance = serializers.FloatField(required=False)
    reserve = serializers.FloatField(required=False)
    loan = serializers.FloatField(required=False)

    class Meta:
        model = PayrollEntry
        fields = [
            "id", "staff", "staffName", "dept", "position", "married", "children",
            "absentDays", "workedDays", "otHours", "shortHours",
            "kpi", "seniority", "transport", "responsibility",
            "insuranceManual", "advance", "reserve", "loan",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["staff"] = str(instance.staff_id) if instance.staff_id else None
        return data


class PayrollMonthSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    entries = PayrollEntrySerializer(many=True, required=False)
    createdAt = serializers.SerializerMethodField()
    updatedAt = serializers.SerializerMethodField()

    class Meta:
        model = PayrollMonth
        fields = ["id", "label", "entries", "createdAt", "updatedAt"]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def get_updatedAt(self, obj):
        return to_ms(obj.updated_at)

    def validate_label(self, value):
        if not (value or "").strip():
            raise serializers.ValidationError("برچسب ماه لازم است.")
        return value.strip()

    def _write_entries(self, month, rows):
        """ردیف‌های ماه را جایگزین می‌کند؛ نام و بخش از پرسنل کپی می‌شود تا در گزارش بماند.

        ابتدا همهٔ ردیف‌ها ساخته و بررسی می‌شوند و تنها پس از آن ردیف‌های قبلی حذف
        می‌شوند؛ وگرنه یک ذخیرهٔ ناموفق، ارقام ثبت‌شدهٔ ماه را پاک می‌کرد.
        """
        built = []
        seen = set()
        for raw in rows:
            row = dict(raw)
            staff_id = row.pop("staff", None) or None
            staff = PayrollStaff.objects.filter(pk=staff_id).first() if staff_id else None
            if staff is None:
                raise serializers.ValidationError({"staff": "پرسنل انتخاب‌شده معتبر نیست."})
            if staff.id in seen:
                raise serializers.ValidationError({"staff": f"«{staff.name}» دوبار در این ماه آمده است."})
            seen.add(staff.id)
            for key in ("staff_name", "dept", "position", "married", "children"):
                row.pop(key, None)
            built.append(dict(
                staff=staff, staff_name=staff.name, dept=staff.dept, position=staff.position,
                married=staff.married, children=staff.children, **row,
            ))

        with transaction.atomic():
            month.entries.all().delete()
            for row in built:
                PayrollEntry.objects.create(month=month, **row)

    def create(self, validated_data):
        rows = validated_data.pop("entries", [])
        month = PayrollMonth.objects.create(**validated_data)
        self._write_entries(month, rows)
        return month

    def update(self, instance, validated_data):
        rows = validated_data.pop("entries", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if rows is not None:
            self._write_entries(instance, rows)
        return instance


# ============ انبار ============

class WarehouseSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)

    class Meta:
        model = Warehouse
        fields = ["id", "name", "code", "suppliesWorkshop", "active"]

    suppliesWorkshop = serializers.BooleanField(source="supplies_workshop", read_only=True)


class StockRowSerializer(serializers.ModelSerializer):
    """یک ردیف جدول انبار = یک کالا، با موجودی هر انبار به‌صورت ستون جدا.

    پیش‌تر هر (کالا × انبار) یک ردیف بود و چون ستون انبار در جدول پهن از دید
    خارج می‌شد، کالا تکراری به نظر می‌رسید. حالا هر کالا یک ردیف است.
    """

    id = serializers.CharField(read_only=True)
    packageId = serializers.CharField(source="site_package_id", read_only=True)
    productName = serializers.CharField(source="product.name", read_only=True)
    brand = serializers.CharField(source="product.brand", read_only=True)
    category = serializers.CharField(source="product.category", read_only=True)
    code = serializers.CharField(source="product.code", read_only=True)
    packSize = serializers.CharField(source="pack_size", read_only=True)
    batchTracked = serializers.BooleanField(source="product.batch_tracked", read_only=True)
    hazardous = serializers.BooleanField(source="product.hazardous", read_only=True)
    salePrice = serializers.FloatField(source="sale_price", read_only=True)
    costPrice = serializers.SerializerMethodField()
    sepidarItemId = serializers.CharField(source="sepidar_item_id", read_only=True)
    baseUnit = serializers.CharField(source="base_unit", required=False, allow_blank=True)
    altUnit = serializers.CharField(source="alt_unit", required=False, allow_blank=True)
    altToBase = serializers.FloatField(source="alt_to_base", required=False, allow_null=True)
    stock = serializers.SerializerMethodField()
    totalOnHand = serializers.SerializerMethodField()

    class Meta:
        model = Sku
        fields = [
            "id", "packageId", "productName", "brand", "category", "code",
            "packSize", "grit", "shade", "batchTracked", "hazardous",
            "salePrice", "costPrice", "sepidarItemId", "stock", "totalOnHand",
            "baseUnit", "altUnit", "altToBase",
        ]

    def get_costPrice(self, obj):
        """قیمت خرید فقط برای مدیر و حسابداری."""
        user = self.context["request"].user
        return float(obj.cost_price) if user.role in ("manager", "accountant") else None

    def _rows(self, obj):
        """موجودی و مشخصات این کالا در هر انبار — ویو از قبل آماده کرده."""
        by_sku = self.context.get("stock_by_sku") or {}
        return by_sku.get(obj.id, [])

    def get_stock(self, obj):
        return self._rows(obj)

    def get_totalOnHand(self, obj):
        return sum(r["onHand"] for r in self._rows(obj))


class StockMovementSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    sku = serializers.CharField()
    warehouse = serializers.CharField()
    batchNo = serializers.CharField(source="batch.batch_no", read_only=True)
    packageId = serializers.CharField(source="sku.site_package_id", read_only=True)
    productName = serializers.CharField(source="sku.product.name", read_only=True)
    packSize = serializers.CharField(source="sku.pack_size", read_only=True)
    warehouseName = serializers.CharField(source="warehouse.name", read_only=True)
    kindLabel = serializers.CharField(source="get_kind_display", read_only=True)
    qty = serializers.FloatField()
    unit = serializers.CharField(write_only=True, required=False, allow_blank=True)
    enteredQty = serializers.FloatField(source="entered_qty", read_only=True)
    enteredUnit = serializers.CharField(source="entered_unit", read_only=True)
    baseUnit = serializers.CharField(source="sku.base_unit", read_only=True)
    unitCost = serializers.FloatField(source="unit_cost", required=False)
    createdBy = serializers.CharField(source="created_by_name", read_only=True)
    createdAt = serializers.SerializerMethodField()

    # ورودی‌های اختیاری برای ساخت بچ هنگام ورود کالا
    batch_no = serializers.CharField(write_only=True, required=False, allow_blank=True)
    expires_on = serializers.DateField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = StockMovement
        fields = [
            "id", "sku", "packageId", "productName", "packSize",
            "warehouse", "warehouseName", "kind", "kindLabel", "qty", "unitCost",
            "date", "ref", "note", "batchNo", "batch_no", "expires_on",
            "unit", "enteredQty", "enteredUnit", "baseUnit",
            "createdBy", "createdAt",
        ]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def validate_qty(self, value):
        if value == 0:
            raise serializers.ValidationError("مقدار نمی‌تواند صفر باشد.")
        return value

    def validate(self, attrs):
        sku = Sku.objects.filter(pk=attrs.get("sku")).first()
        if sku is None:
            raise serializers.ValidationError({"sku": "کالای انتخاب‌شده معتبر نیست."})
        warehouse = Warehouse.objects.filter(pk=attrs.get("warehouse")).first()
        if warehouse is None:
            raise serializers.ValidationError({"warehouse": "انبار انتخاب‌شده معتبر نیست."})
        attrs["sku"] = sku
        attrs["warehouse"] = warehouse

        # مقدار به واحد اصلی تبدیل می‌شود؛ آنچه کاربر زده جدا نگه داشته می‌شود.
        entered_unit = (attrs.pop("unit", "") or "").strip()
        entered_qty = attrs.get("qty")
        try:
            attrs["qty"] = float(to_base(sku, entered_qty, entered_unit))
        except ValueError as e:
            raise serializers.ValidationError({"unit": str(e)})
        attrs["entered_qty"] = entered_qty
        attrs["entered_unit"] = entered_unit or sku.base_unit

        kind = attrs.get("kind")
        qty = attrs.get("qty")
        # ورودها باید مثبت و خروج‌ها منفی باشند تا جمعِ دفتر درست دربیاید.
        inbound = kind in (StockMovement.Kind.RECEIPT, StockMovement.Kind.RETURN,
                           StockMovement.Kind.TRANSFER_IN, StockMovement.Kind.UNPACK_IN)
        outbound = kind in (StockMovement.Kind.SALE, StockMovement.Kind.WORKSHOP,
                            StockMovement.Kind.TRANSFER_OUT, StockMovement.Kind.UNPACK_OUT)
        if inbound and qty < 0:
            raise serializers.ValidationError({"qty": "برای ورود کالا مقدار باید مثبت باشد."})
        if outbound and qty > 0:
            attrs["qty"] = -qty  # کاربر عدد مثبت می‌زند؛ خودمان منفی می‌کنیم

        # خروج بیش از موجودی جلوگیری می‌شود.
        if outbound:
            on_hand = (StockMovement.objects
                       .filter(sku=sku, warehouse=warehouse)
                       .aggregate(s=models.Sum("qty"))["s"] or 0)
            if abs(attrs["qty"]) > on_hand:
                raise serializers.ValidationError(
                    {"qty": f"موجودی کافی نیست. موجودی فعلی: {on_hand}"}
                )
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        batch_no = (validated_data.pop("batch_no", "") or "").strip()
        expires_on = validated_data.pop("expires_on", None)

        batch = None
        if batch_no:
            batch, _ = StockBatch.objects.get_or_create(
                sku=validated_data["sku"], batch_no=batch_no,
                defaults={"expires_on": expires_on},
            )
            if expires_on and batch.expires_on != expires_on:
                batch.expires_on = expires_on
                batch.save(update_fields=["expires_on"])

        return StockMovement.objects.create(
            batch=batch,
            created_by=request.user,
            created_by_name=request.user.name or request.user.username,
            **validated_data,
        )


class SupplierSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    leadTimeDays = serializers.IntegerField(source="lead_time_days", required=False)

    class Meta:
        model = Supplier
        fields = ["id", "name", "leadTimeDays", "note", "active"]


class WarehouseWriteSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    suppliesWorkshop = serializers.BooleanField(source="supplies_workshop", required=False)

    class Meta:
        model = Warehouse
        fields = ["id", "name", "code", "suppliesWorkshop", "active"]

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("نام انبار لازم است.")
        return name

    def create(self, validated_data):
        warehouse = super().create(validated_data)
        # کالاهای موجود باید در انبار تازه هم ردیف داشته باشند، وگرنه در جدول دیده نمی‌شوند.
        StockItem.objects.bulk_create(
            [StockItem(sku=sku, warehouse=warehouse) for sku in Sku.objects.all()],
            ignore_conflicts=True,
        )
        return warehouse


class WorkshopItemSerializer(serializers.Serializer):
    """ساخت کالای غیرفروشی (مواد کارگاه) که در سایت فروش نیست."""

    name = serializers.CharField(max_length=300)
    brand = serializers.CharField(max_length=100, required=False, allow_blank=True)
    category = serializers.CharField(max_length=150, required=False, allow_blank=True)
    code = serializers.CharField(max_length=80, required=False, allow_blank=True)
    packSize = serializers.CharField(max_length=60, required=False, allow_blank=True)
    batchTracked = serializers.BooleanField(required=False, default=False)
    hazardous = serializers.BooleanField(required=False, default=False)

    def validate_name(self, value):
        if not (value or "").strip():
            raise serializers.ValidationError("نام کالا لازم است.")
        return value.strip()

    def create(self, validated_data):
        product = Product.objects.create(
            name=validated_data["name"],
            brand=(validated_data.get("brand") or "").strip(),
            category=(validated_data.get("category") or "").strip(),
            code=(validated_data.get("code") or "").strip(),
            sellable=False,
            batch_tracked=validated_data.get("batchTracked", False),
            hazardous=validated_data.get("hazardous", False),
        )
        # شناسهٔ داخلی، چون این کالا در سایت فروش وجود ندارد.
        sku = Sku.objects.create(
            product=product,
            site_package_id=f"W-{product.id}",
            pack_size=(validated_data.get("packSize") or "").strip(),
        )
        StockItem.objects.bulk_create(
            [StockItem(sku=sku, warehouse=w) for w in Warehouse.objects.all()],
            ignore_conflicts=True,
        )
        return sku


class StockVoucherLineSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    sku = serializers.CharField()
    packageId = serializers.CharField(source="sku.site_package_id", read_only=True)
    productName = serializers.CharField(source="sku.product.name", read_only=True)
    packSize = serializers.CharField(source="sku.pack_size", read_only=True)
    grit = serializers.CharField(source="sku.grit", read_only=True)
    shade = serializers.CharField(source="sku.shade", read_only=True)
    batchTracked = serializers.BooleanField(source="sku.product.batch_tracked", read_only=True)
    qty = serializers.FloatField()
    unit = serializers.CharField(required=False, allow_blank=True)
    baseUnit = serializers.CharField(source="sku.base_unit", read_only=True)
    altUnit = serializers.CharField(source="sku.alt_unit", read_only=True)
    unitCost = serializers.FloatField(source="unit_cost", required=False)
    batchNo = serializers.CharField(source="batch_no", required=False, allow_blank=True)
    expiresOn = serializers.DateField(source="expires_on", required=False, allow_null=True)

    class Meta:
        model = StockVoucherLine
        fields = [
            "id", "sku", "packageId", "productName", "packSize", "grit", "shade",
            "batchTracked", "qty", "unit", "baseUnit", "altUnit",
            "unitCost", "batchNo", "expiresOn", "note",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["sku"] = str(instance.sku_id)
        return data


class StockVoucherSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    number = serializers.CharField(read_only=True)
    movementKind = serializers.CharField(source="movement_kind")
    movementKindLabel = serializers.CharField(source="get_movement_kind_display", read_only=True)
    statusLabel = serializers.CharField(source="get_status_display", read_only=True)
    isInbound = serializers.BooleanField(source="is_inbound", read_only=True)
    warehouse = serializers.CharField()
    warehouseName = serializers.CharField(source="warehouse.name", read_only=True)
    toWarehouse = serializers.CharField(source="to_warehouse_id", required=False,
                                        allow_null=True, allow_blank=True)
    toWarehouseName = serializers.CharField(source="to_warehouse.name", read_only=True)
    lines = StockVoucherLineSerializer(many=True, required=False)
    createdBy = serializers.CharField(source="created_by_name", read_only=True)
    createdAt = serializers.SerializerMethodField()
    postedAt = serializers.SerializerMethodField()

    class Meta:
        model = StockVoucher
        fields = [
            "id", "number", "movementKind", "movementKindLabel", "status", "statusLabel",
            "isInbound", "date", "warehouse", "warehouseName",
            "toWarehouse", "toWarehouseName", "counterparty", "ref",
            "note", "lines", "createdBy", "createdAt", "postedAt",
        ]
        read_only_fields = ["status"]

    def get_createdAt(self, obj):
        return to_ms(obj.created_at)

    def get_postedAt(self, obj):
        return to_ms(obj.posted_at)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # شناسه برمی‌گردد نه نام: فرم ویرایش همین مقدار را پس می‌فرستد و اگر
        # نام باشد، جست‌وجوی کلید اصلی روی پستگرس خطای پایگاه داده می‌دهد.
        data["warehouse"] = str(instance.warehouse_id)
        data["toWarehouse"] = str(instance.to_warehouse_id) if instance.to_warehouse_id else None
        return data

    @staticmethod
    def _pk(value):
        """مقدار ورودی را به کلید اصلی تبدیل می‌کند، یا None اگر اصلاً عدد نباشد."""
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return None

    def _warehouse_or_400(self, value, field, label):
        pk = self._pk(value)
        warehouse = Warehouse.objects.filter(pk=pk).first() if pk is not None else None
        if warehouse is None:
            raise serializers.ValidationError({field: f"{label} معتبر نیست."})
        return warehouse

    def validate_movementKind(self, value):
        valid = {k for k, _ in StockMovement.Kind.choices}
        if value not in valid:
            raise serializers.ValidationError("نوع حواله معتبر نیست.")
        if value == StockMovement.Kind.COUNT:
            raise serializers.ValidationError("اصلاح انبارگردانی از مسیر حواله ثبت نمی‌شود.")
        return value

    def validate(self, attrs):
        """انتقال باید مقصد داشته باشد و مقصد نمی‌تواند خود مبدأ باشد."""
        kind = attrs.get("movement_kind", getattr(self.instance, "movement_kind", None))
        src = attrs.get("warehouse", getattr(self.instance, "warehouse_id", None))
        dest = attrs.get("to_warehouse_id", getattr(self.instance, "to_warehouse_id", None))
        if kind == StockMovement.Kind.TRANSFER_OUT:
            if not dest:
                raise serializers.ValidationError({"toWarehouse": "انبار مقصد را انتخاب کنید."})
            if str(dest) == str(src):
                raise serializers.ValidationError({"toWarehouse": "مبدأ و مقصد نمی‌توانند یکی باشند."})
            self._warehouse_or_400(dest, "toWarehouse", "انبار مقصد")
        else:
            attrs["to_warehouse_id"] = None
        return attrs

    def _next_number(self, movement_kind, date):
        """شمارهٔ حواله با سال شمسی: «ورود-۱۴۰۵-۰۰۰۱»."""
        inbound = movement_kind in StockVoucher.INBOUND_KINDS
        prefix = f"{'ورود' if inbound else 'خروج'}-{jalali_year(date)}-"
        used = StockVoucher.objects.filter(number__startswith=prefix).values_list("number", flat=True)
        top = 0
        for n in used:
            tail = n[len(prefix):]
            if tail.isdigit():
                top = max(top, int(tail))
        return f"{prefix}{top + 1:04d}"

    def _write_lines(self, voucher, rows):
        voucher.lines.all().delete()
        for raw in rows:
            pk = self._pk(raw.pop("sku", None))
            sku = Sku.objects.filter(pk=pk).first() if pk is not None else None
            if sku is None:
                raise serializers.ValidationError({"lines": "کالای انتخاب‌شده معتبر نیست."})
            if not raw.get("qty") or raw["qty"] <= 0:
                raise serializers.ValidationError({"lines": "مقدار هر ردیف باید بیشتر از صفر باشد."})
            StockVoucherLine.objects.create(voucher=voucher, sku=sku, **raw)

    def create(self, validated_data):
        lines = validated_data.pop("lines", [])
        request = self.context["request"]
        warehouse = self._warehouse_or_400(
            validated_data.pop("warehouse"), "warehouse", "انبار")

        voucher = StockVoucher.objects.create(
            warehouse=warehouse,
            number=self._next_number(validated_data["movement_kind"], validated_data["date"]),
            created_by=request.user,
            created_by_name=request.user.name or request.user.username,
            **validated_data,
        )
        self._write_lines(voucher, lines)
        return voucher

    def update(self, instance, validated_data):
        if instance.status == StockVoucher.Status.POSTED:
            raise serializers.ValidationError("حوالهٔ ثبت‌شده قابل ویرایش نیست.")
        lines = validated_data.pop("lines", None)
        wh = validated_data.pop("warehouse", None)
        if wh:
            instance.warehouse = self._warehouse_or_400(wh, "warehouse", "انبار")
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines is not None:
            self._write_lines(instance, lines)
        return instance


class ItemSerializer(serializers.ModelSerializer):
    """تعریف و ویرایش کالا — محصول و بستهٔ آن در یک فرم.

    بسته‌بندی به زبان انبار پرسیده می‌شود نه به زبان پایگاه داده: کاربر
    می‌گوید «۱ حلب = ۲۵ کیلوگرم» و ما ۱÷۲۵ را ذخیره می‌کنیم، چون موجودی
    همیشه به واحد اصلی نگهداری می‌شود.
    """

    id = serializers.CharField(read_only=True)
    name = serializers.CharField(source="product.name", max_length=300)
    brand = serializers.CharField(source="product.brand", max_length=100,
                                  required=False, allow_blank=True)
    category = serializers.CharField(source="product.category", max_length=150,
                                     required=False, allow_blank=True)
    productCode = serializers.CharField(source="product.code", max_length=80,
                                        required=False, allow_blank=True)
    sellable = serializers.BooleanField(source="product.sellable", required=False)
    batchTracked = serializers.BooleanField(source="product.batch_tracked", required=False)
    hazardous = serializers.BooleanField(source="product.hazardous", required=False)

    warehouseCode = serializers.CharField(source="warehouse_code", max_length=40,
                                          required=False, allow_blank=True)
    skuCode = serializers.CharField(source="site_package_id", max_length=40,
                                    required=False, allow_blank=True)
    sepidarItemId = serializers.CharField(source="sepidar_item_id", max_length=60,
                                          required=False, allow_blank=True)
    isAsset = serializers.BooleanField(source="is_asset", required=False)
    assetCode = serializers.CharField(source="asset_code", max_length=40,
                                      required=False, allow_blank=True)
    location = serializers.PrimaryKeyRelatedField(
        queryset=Location.objects.all(), required=False, allow_null=True)
    locationName = serializers.CharField(source="location.name", read_only=True)
    holder = serializers.CharField(source="holder_name", max_length=150,
                                   required=False, allow_blank=True)
    handedOverOn = serializers.DateField(source="handed_over_on",
                                         required=False, allow_null=True)
    packSize = serializers.CharField(source="pack_size", max_length=60,
                                     required=False, allow_blank=True)
    baseUnit = serializers.CharField(source="base_unit", max_length=30,
                                     required=False, allow_blank=True)
    altUnit = serializers.CharField(source="alt_unit", max_length=30,
                                    required=False, allow_blank=True)
    # «۱ واحد اصلی چند واحد فرعی است؟» — عکسِ آنچه ذخیره می‌شود.
    altPerBase = serializers.DecimalField(max_digits=14, decimal_places=4,
                                          required=False, allow_null=True)
    salePrice = serializers.DecimalField(source="sale_price", max_digits=16,
                                         decimal_places=2, required=False)
    costPrice = serializers.DecimalField(source="cost_price", max_digits=16,
                                         decimal_places=2, required=False)
    onHand = serializers.SerializerMethodField()

    class Meta:
        model = Sku
        fields = ["id", "name", "brand", "category", "productCode", "sellable",
                  "batchTracked", "hazardous", "warehouseCode", "skuCode",
                  "sepidarItemId", "barcode", "isAsset", "assetCode", "location",
                  "locationName", "holder", "handedOverOn",
                  "packSize", "baseUnit", "altUnit", "altPerBase", "grit", "shade",
                  "salePrice", "costPrice", "active", "onHand"]

    def get_onHand(self, obj):
        total = getattr(obj, "on_hand", None)
        return float(total or 0)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        rate = instance.alt_to_base
        # ۰.۰۴ ذخیره‌شده یعنی «۱ حلب = ۲۵ کیلوگرم»؛ همان ۲۵ را نشان می‌دهیم.
        data["altPerBase"] = (float((Decimal(1) / rate).quantize(Decimal("0.0001")))
                              if rate else None)
        # شناسه‌ها در این برنامه رشته‌اند؛ فرم همین را پس می‌فرستد.
        data["location"] = str(instance.location_id) if instance.location_id else None
        return data

    # ---------- اعتبارسنجی ----------
    def validate_name(self, value):
        if not (value or "").strip():
            raise serializers.ValidationError("نام کالا لازم است.")
        return value.strip()

    def _unique(self, field, key, value, label):
        if not value:
            return
        qs = Sku.objects.filter(**{field: value})
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        clash = qs.select_related("product").first()
        if clash is not None:
            raise serializers.ValidationError(
                {key: f"{label} «{value}» قبلاً برای «{clash.product.name}» ثبت شده."})

    def validate(self, attrs):
        self._unique("site_package_id", "skuCode",
                     (attrs.get("site_package_id") or "").strip(), "کد SKU")
        self._unique("warehouse_code", "warehouseCode",
                     (attrs.get("warehouse_code") or "").strip(), "کد انبار")
        self._unique("asset_code", "assetCode",
                     (attrs.get("asset_code") or "").strip(), "کد اموال")

        cur = self.instance
        is_asset = attrs.get("is_asset", cur.is_asset if cur else False)
        if is_asset:
            # وسیله فروخته نمی‌شود؛ همین‌جا تکلیفش روشن می‌شود تا در سایت نیفتد.
            attrs.setdefault("product", {})["sellable"] = False
        else:
            # مشخصات اموال روی کالای معمولی نمی‌ماند تا فهرست اموال دروغ نگوید.
            attrs["asset_code"] = ""
            attrs["location"] = None
            attrs["holder_name"] = ""
            attrs["handed_over_on"] = None

        cur = self.instance
        base = attrs.get("base_unit", cur.base_unit if cur else "") or ""
        alt = attrs.get("alt_unit", cur.alt_unit if cur else "") or ""
        rate = attrs.get("altPerBase")
        if rate in (None, "") and cur is not None and cur.alt_to_base:
            rate = Decimal(1) / cur.alt_to_base

        if alt.strip():
            if alt.strip() == base.strip():
                raise serializers.ValidationError(
                    {"altUnit": "بسته‌بندی فرعی نمی‌تواند با اصلی یکی باشد."})
            if not rate or Decimal(str(rate)) <= 0:
                raise serializers.ValidationError(
                    {"altPerBase": "بگویید هر یک واحد اصلی چند واحد فرعی است."})
            attrs["altPerBase"] = Decimal(str(rate))
        return attrs

    # ---------- ذخیره ----------
    @staticmethod
    def _rate_to_field(sku, rate):
        """نرخِ «۱ اصلی = n فرعی» را به شکل ذخیره‌شدنی برمی‌گرداند."""
        if not (sku.alt_unit or "").strip():
            sku.alt_to_base = None
        elif rate:
            sku.alt_to_base = (Decimal(1) / Decimal(str(rate))).quantize(Decimal("0.000001"))

    @transaction.atomic
    def create(self, validated_data):
        pdata = validated_data.pop("product", {})
        rate = validated_data.pop("altPerBase", None)
        product = Product.objects.create(
            name=pdata.get("name", ""),
            brand=(pdata.get("brand") or "").strip(),
            category=(pdata.get("category") or "").strip(),
            code=(pdata.get("code") or "").strip(),
            sellable=pdata.get("sellable", False),
            batch_tracked=pdata.get("batch_tracked", False),
            hazardous=pdata.get("hazardous", False),
        )
        sku = Sku(product=product, **validated_data)
        if not (sku.site_package_id or "").strip():
            # شناسهٔ داخلی، چون این کالا از سایت فروش نیامده.
            sku.site_package_id = f"W-{product.id}"
        if not (sku.base_unit or "").strip():
            sku.base_unit = "عدد"
        self._rate_to_field(sku, rate)
        sku.save()
        StockItem.objects.bulk_create(
            [StockItem(sku=sku, warehouse=w) for w in Warehouse.objects.all()],
            ignore_conflicts=True,
        )
        return sku

    @transaction.atomic
    def update(self, instance, validated_data):
        pdata = validated_data.pop("product", {})
        if pdata:
            for attr, value in pdata.items():
                setattr(instance.product, attr, value)
            instance.product.save()
        rate = validated_data.pop("altPerBase", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        self._rate_to_field(instance, rate)
        instance.save()
        return instance


class LocationSerializer(serializers.ModelSerializer):
    """محل استقرار اموال — سالن، دفتر، کارگاه."""

    id = serializers.CharField(read_only=True)
    # بدون اعتبارسنجِ خودکارِ یکتایی، تا پیام تکراری‌بودن فارسی بماند.
    name = serializers.CharField(max_length=100)
    assetCount = serializers.SerializerMethodField()

    class Meta:
        model = Location
        fields = ["id", "name", "note", "active", "assetCount"]

    def get_assetCount(self, obj):
        return obj.assets.filter(is_asset=True).count()

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("نام محل لازم است.")
        qs = Location.objects.filter(name=name)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"محل «{name}» قبلاً ثبت شده.")
        return name


class ConsumableSerializer(serializers.ModelSerializer):
    """کالای انبار آن‌طور که فرم مصرف مواد می‌بیند: نام، کد و واحد.

    بی‌قیمت و بی‌موجودی، چون ثبت‌کنندهٔ مصرف لزوماً اجازهٔ دیدن انبار را ندارد.
    """

    id = serializers.CharField(read_only=True)
    name = serializers.CharField(source="product.name", read_only=True)
    brand = serializers.CharField(source="product.brand", read_only=True)
    code = serializers.SerializerMethodField()
    warehouseCode = serializers.CharField(source="warehouse_code", read_only=True)
    packSize = serializers.CharField(source="pack_size", read_only=True)
    baseUnit = serializers.CharField(source="base_unit", read_only=True)
    altUnit = serializers.CharField(source="alt_unit", read_only=True)
    altPerBase = serializers.SerializerMethodField()

    class Meta:
        model = Sku
        fields = ["id", "name", "brand", "code", "warehouseCode", "packSize",
                  "baseUnit", "altUnit", "altPerBase"]

    def get_code(self, obj):
        return obj.warehouse_code or obj.product.code or obj.barcode or ""

    def get_altPerBase(self, obj):
        rate = obj.alt_to_base
        return float((Decimal(1) / rate).quantize(Decimal("0.0001"))) if rate else None


class ConsumableCreateSerializer(serializers.Serializer):
    """مادهٔ مصرفیِ تازه از دل فرم مصرف مواد — یک کالای غیرفروشی در انبار."""

    name = serializers.CharField(max_length=300)
    code = serializers.CharField(max_length=40, required=False, allow_blank=True)
    unit = serializers.CharField(max_length=30, required=False, allow_blank=True)

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("نام ماده لازم است.")
        return name

    def validate_code(self, value):
        code = (value or "").strip()
        clash = (Sku.objects.select_related("product").filter(warehouse_code=code).first()
                 if code else None)
        if clash is not None:
            raise serializers.ValidationError(
                f"کد انبار «{code}» قبلاً برای «{clash.product.name}» ثبت شده.")
        return code

    @transaction.atomic
    def create(self, validated_data):
        code = validated_data.get("code", "")
        product = Product.objects.create(name=validated_data["name"], code=code, sellable=False)
        return Sku.objects.create(
            product=product,
            site_package_id=f"W-{product.id}",
            warehouse_code=code,
            base_unit=(validated_data.get("unit") or "").strip() or "عدد",
            # سرپرست در میانهٔ ثبت مصرف نام استاندارد را نمی‌داند؛ مدیر بعداً اصلاحش می‌کند.
            needs_review=True,
        )


class ConsumableReviewSerializer(serializers.ModelSerializer):
    """یک مادهٔ مصرفی در فهرست اصلاح: از کجا آمده، کجا و با چه نامی مصرف شده.

    آمار مصرف از context می‌آید (یک کوئری برای همهٔ ردیف‌ها، نه یکی به‌ازای هر ردیف).
    """

    id = serializers.CharField(read_only=True)
    name = serializers.CharField(source="product.name", read_only=True)
    brand = serializers.CharField(source="product.brand", read_only=True)
    warehouseCode = serializers.CharField(source="warehouse_code", read_only=True)
    packSize = serializers.CharField(source="pack_size", read_only=True)
    baseUnit = serializers.CharField(source="base_unit", read_only=True)
    altUnit = serializers.CharField(source="alt_unit", read_only=True)
    needsReview = serializers.BooleanField(source="needs_review", read_only=True)
    source = serializers.SerializerMethodField()
    uses = serializers.SerializerMethodField()
    reports = serializers.SerializerMethodField()
    lastUsed = serializers.SerializerMethodField()
    usedNames = serializers.SerializerMethodField()
    usedUnits = serializers.SerializerMethodField()

    class Meta:
        model = Sku
        fields = ["id", "name", "brand", "warehouseCode", "packSize", "baseUnit", "altUnit",
                  "needsReview", "source", "uses", "reports", "lastUsed", "usedNames", "usedUnits"]

    def _stat(self, obj):
        return self.context.get("stats", {}).get(obj.id, {})

    def get_source(self, obj):
        pid = obj.site_package_id or ""
        if pid.startswith("MAT-"):
            return "migrated"
        if pid.startswith("W-"):
            return "manual"
        if pid.startswith("ACC-"):
            return "stocktake"
        return "site" if pid.isdigit() else "other"

    def get_uses(self, obj):
        return self._stat(obj).get("uses", 0)

    def get_reports(self, obj):
        return len(self._stat(obj).get("reports", ()))

    def get_lastUsed(self, obj):
        last = self._stat(obj).get("last")
        return last.isoformat() if last else None

    def get_usedNames(self, obj):
        # نام‌هایی که گزارش‌ها با آن ثبت شده‌اند و با نام انبار فرق دارند.
        return sorted(n for n in self._stat(obj).get("names", ()) if n and n != obj.product.name)

    def get_usedUnits(self, obj):
        return sorted(u for u in self._stat(obj).get("units", ()) if u)
