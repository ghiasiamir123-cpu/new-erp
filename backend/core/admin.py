from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

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
    User,
)


class CustomUserAdmin(UserAdmin):
    list_display = ("username", "name", "role", "position", "is_staff")
    fieldsets = UserAdmin.fieldsets + (
        (None, {"fields": ("name", "role", "position")}),
    )


class ReportItemInline(admin.TabularInline):
    model = ReportItem
    extra = 0


class FeedbackInline(admin.TabularInline):
    model = Feedback
    extra = 0


class DailyReportAdmin(admin.ModelAdmin):
    list_display = ("date", "shift", "supervisor_name", "status")
    inlines = [ReportItemInline, FeedbackInline]


class MaterialUsageAdmin(admin.ModelAdmin):
    list_display = ("date", "project_name", "material_name", "quantity", "unit", "recorded_by_name")


class DriverDelayInline(admin.TabularInline):
    model = DriverDelay
    extra = 0


class DriverTaskInline(admin.TabularInline):
    model = DriverTask
    extra = 0


class DriverReportAdmin(admin.ModelAdmin):
    list_display = ("date", "driver_name", "morning_scheduled_time", "evening_scheduled_time", "recorded_by_name")
    inlines = [DriverDelayInline, DriverTaskInline]


admin.site.register(User, CustomUserAdmin)
admin.site.register(Project)
admin.site.register(Employee)
admin.site.register(Material)
admin.site.register(MaterialUsage, MaterialUsageAdmin)
admin.site.register(Driver)
admin.site.register(DriverReport, DriverReportAdmin)
admin.site.register(DailyReport, DailyReportAdmin)
