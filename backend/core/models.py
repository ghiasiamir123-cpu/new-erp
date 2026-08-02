from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        MANAGER = "manager", "مدیر"
        DATA_ENTRY = "data_entry", "کاربر ثبت"
        VIEWER = "viewer", "ناظر"
        DRIVER = "driver", "راننده"

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


class MaterialUsage(models.Model):
    date = models.DateField()
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    material = models.ForeignKey(Material, on_delete=models.SET_NULL, null=True, blank=True)
    material_name = models.CharField(max_length=200, blank=True)
    material_code = models.CharField(max_length=50, blank=True)
    unit = models.CharField(max_length=30, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    recorded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="material_usages")
    recorded_by_name = models.CharField(max_length=150)
    desc = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class Driver(models.Model):
    name = models.CharField(max_length=150)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class DriverReport(models.Model):
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.driver_name}"


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


class Feedback(models.Model):
    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]
