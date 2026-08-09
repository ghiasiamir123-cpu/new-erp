from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        MANAGER = "manager", "مدیر"
        DATA_ENTRY = "data_entry", "کاربر ثبت"
        VIEWER = "viewer", "ناظر"
        DRIVER = "driver", "راننده"
        ACCOUNTANT = "accountant", "حسابداری"

    name = models.CharField(max_length=150)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)
    position = models.CharField(max_length=100, blank=True)
    must_change_password = models.BooleanField(default=False)

    def __str__(self):
        return self.username


class Project(models.Model):
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class ProjectStage(models.Model):
    """مرحله‌ای که یک پروژه شامل آن است: متراژ خودش را دارد و جداگانه تیک انجام می‌خورد."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="stages")
    name = models.CharField(max_length=100)
    area = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    done = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        unique_together = [("project", "name")]

    def __str__(self):
        return f"{self.project.name} · {self.name}"


class Employee(models.Model):
    name = models.CharField(max_length=150)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Material(models.Model):
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True)
    unit = models.CharField(max_length=30, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class MaterialUsageReport(models.Model):
    """گزارش روزانهٔ مصرف مواد یک کاربر — دقیقاً مثل گزارش کار روزانه تأیید می‌شود."""

    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        WAITING = "waiting", "در انتظار تأیید"
        APPROVED = "approved", "تأیید شد"
        REVISION = "revision", "نیاز به اصلاح"

    date = models.DateField()
    recorded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="material_usage_reports")
    recorded_by_name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    resubmitted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.recorded_by_name}"


class MaterialUsageFeedback(models.Model):
    report = models.ForeignKey(MaterialUsageReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]


class MaterialUsage(models.Model):
    report = models.ForeignKey(MaterialUsageReport, on_delete=models.CASCADE, related_name="items")
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    material = models.ForeignKey(Material, on_delete=models.SET_NULL, null=True, blank=True)
    material_name = models.CharField(max_length=200, blank=True)
    material_code = models.CharField(max_length=50, blank=True)
    unit = models.CharField(max_length=30, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    desc = models.CharField(max_length=500, blank=True)


class Driver(models.Model):
    name = models.CharField(max_length=150)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class DriverReport(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        WAITING = "waiting", "در انتظار تأیید"
        APPROVED = "approved", "تأیید شد"
        REVISION = "revision", "نیاز به اصلاح"

    date = models.DateField()
    driver = models.ForeignKey(Driver, on_delete=models.SET_NULL, null=True, blank=True)
    driver_name = models.CharField(max_length=150, blank=True)

    morning_scheduled_time = models.CharField(max_length=20, blank=True)
    morning_arrival_time = models.CharField(max_length=20, blank=True)
    morning_passengers = models.CharField(max_length=300, blank=True)

    evening_scheduled_time = models.CharField(max_length=20, blank=True)
    evening_arrival_time = models.CharField(max_length=20, blank=True)
    evening_passengers = models.CharField(max_length=300, blank=True)

    odometer_start = models.DecimalField(max_digits=10, decimal_places=1, default=0)
    odometer_end = models.DecimalField(max_digits=10, decimal_places=1, default=0)

    recorded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="driver_reports")
    recorded_by_name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    resubmitted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.driver_name}"


class DriverFeedback(models.Model):
    report = models.ForeignKey(DriverReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]


class DriverDelay(models.Model):
    class Period(models.TextChoices):
        MORNING = "morning", "صبح"
        EVENING = "evening", "عصر"

    report = models.ForeignKey(DriverReport, on_delete=models.CASCADE, related_name="delays")
    period = models.CharField(max_length=10, choices=Period.choices, default=Period.MORNING)
    reason = models.CharField(max_length=300)


class DriverTask(models.Model):
    report = models.ForeignKey(DriverReport, on_delete=models.CASCADE, related_name="tasks")
    time = models.CharField(max_length=20, blank=True)
    destination = models.CharField(max_length=300, blank=True)
    description = models.CharField(max_length=500, blank=True)


class DailyReport(models.Model):
    class Shift(models.TextChoices):
        MORNING = "صبح", "صبح"
        EVENING = "عصر", "عصر"
        NIGHT = "شب", "شب"

    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        WAITING = "waiting", "در انتظار تأیید"
        APPROVED = "approved", "تأیید شد"
        REVISION = "revision", "نیاز به اصلاح"

    date = models.DateField()
    shift = models.CharField(max_length=10, choices=Shift.choices)
    supervisor = models.ForeignKey(User, on_delete=models.PROTECT, related_name="reports")
    supervisor_name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    # وقتی گزارشی که نیاز به اصلاح داشته دوباره ارسال می‌شود، تا تصمیم بعدی مدیر true می‌ماند.
    resubmitted = models.BooleanField(default=False)
    description = models.TextField(blank=True)
    problems = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.shift} · {self.supervisor_name}"


class ReportItem(models.Model):
    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="items")
    employee = models.CharField(max_length=150)
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    activity = models.CharField(max_length=100)
    hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    desc = models.CharField(max_length=500, blank=True)


class ReportProgress(models.Model):
    """متراژ کارِ انجام‌شدهٔ هر روز، یک‌بار برای هر پروژه/مرحله — نه به‌ازای هر نفر."""

    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="progress")
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    stage = models.CharField(max_length=100)
    area = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    desc = models.CharField(max_length=500, blank=True)


class Feedback(models.Model):
    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]


# ============ حقوق و دستمزد ============
# ارقام حقوق به ریال است و چون مبالغ بزرگ‌اند، همه‌جا DecimalField با ۲ رقم اعشار
# استفاده شده تا خطای گِردکردن اعشاری پیش نیاید.

DEFAULT_COMPONENTS = [
    {"key": "base", "name": "حقوق پایه", "dailyRate": 5541850,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": False},
    {"key": "house", "name": "حق مسکن", "dailyRate": 1000000,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": False},
    # نرخ روزانه از تقسیم رقم ماهانهٔ بخشنامه بر ۳۰ می‌آید؛ با تمام دقت ذخیره می‌شود
    # تا ضرب دوبارهٔ آن در ۳۰ دقیقاً همان رقم ماهانه شود.
    {"key": "bon", "name": "بن خواروبار", "dailyRate": 22000000 / 30,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": False},
    {"key": "marr", "name": "حق تأهل", "dailyRate": 5000000 / 30,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": True},
    {"key": "child", "name": "حق اولاد (هر فرزند)", "dailyRate": 554185,
     "prorate": True, "ins": False, "tax": False, "perChild": True, "marriedOnly": False},
]

# پله‌های مالیات: اندازهٔ هر پله (مازاد بر معافیت). upto=null یعنی «مازاد بر آن».
DEFAULT_BRACKETS = [
    {"upto": 400000000, "rate": 10},
    {"upto": 200000000, "rate": 15},
    {"upto": 200000000, "rate": 20},
    {"upto": 200000000, "rate": 25},
    {"upto": None, "rate": 30},
]


class PayrollSettings(models.Model):
    """تنظیمات مشترک محاسبهٔ حقوق — همیشه فقط یک ردیف دارد."""

    daily_hours = models.DecimalField(max_digits=5, decimal_places=2, default=7.33)
    ot_mult = models.DecimalField(max_digits=5, decimal_places=2, default=1.4)
    ins_rate = models.DecimalField(max_digits=5, decimal_places=2, default=7)
    tax_exempt = models.DecimalField(max_digits=16, decimal_places=2, default=400000000)
    components = models.JSONField(default=list)
    brackets = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Payroll settings"

    @classmethod
    def load(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create(
                components=list(DEFAULT_COMPONENTS), brackets=list(DEFAULT_BRACKETS)
            )
        return obj


class PayrollStaff(models.Model):
    """پرسنل حقوق‌بگیر — مستقل از لیست کارگرهای گزارش روزانه."""

    name = models.CharField(max_length=150)
    dept = models.CharField(max_length=100, blank=True)
    position = models.CharField(max_length=100, blank=True)
    married = models.BooleanField(default=False)
    children = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.name


class PayrollMonth(models.Model):
    """یک دورهٔ حقوق — مثلاً «مرداد ۱۴۰۵»."""

    label = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.label


class PayrollEntry(models.Model):
    """ارقام متغیر یک نفر در یک ماه."""

    month = models.ForeignKey(PayrollMonth, on_delete=models.CASCADE, related_name="entries")
    staff = models.ForeignKey(PayrollStaff, on_delete=models.SET_NULL, null=True, blank=True)
    staff_name = models.CharField(max_length=150, blank=True)
    dept = models.CharField(max_length=100, blank=True)
    position = models.CharField(max_length=100, blank=True)
    married = models.BooleanField(default=False)
    children = models.PositiveSmallIntegerField(default=0)

    absent_days = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    worked_days = models.DecimalField(max_digits=5, decimal_places=2, default=30)
    ot_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    short_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)

    kpi = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    seniority = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    transport = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    responsibility = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    # صفر یعنی «بیمه خودکار ۷٪»؛ عدد یعنی بیمهٔ دستی.
    insurance_manual = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    advance = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    reserve = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    loan = models.DecimalField(max_digits=16, decimal_places=2, default=0)

    class Meta:
        ordering = ["id"]
        unique_together = [("month", "staff")]
