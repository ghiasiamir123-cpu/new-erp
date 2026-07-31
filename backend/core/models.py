from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        MANAGER = "manager", "مدیر"
        DATA_ENTRY = "data_entry", "کاربر ثبت"
        VIEWER = "viewer", "ناظر"

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
