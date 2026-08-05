from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

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


class ReportProgressInline(admin.TabularInline):
    model = ReportProgress
    extra = 0


class DailyReportAdmin(admin.ModelAdmin):
    list_display = ("date", "shift", "supervisor_name", "status")
    inlines = [ReportItemInline, ReportProgressInline, FeedbackInline]


class MaterialUsageInline(admin.TabularInline):
    model = MaterialUsage
    extra = 0


class MaterialUsageFeedbackInline(admin.TabularInline):
    model = MaterialUsageFeedback
    extra = 0


class MaterialUsageReportAdmin(admin.ModelAdmin):
    list_display = ("date", "recorded_by_name", "status")
    inlines = [MaterialUsageInline, MaterialUsageFeedbackInline]


class DriverDelayInline(admin.TabularInline):
    model = DriverDelay
    extra = 0


class DriverTaskInline(admin.TabularInline):
    model = DriverTask
    extra = 0


class DriverFeedbackInline(admin.TabularInline):
    model = DriverFeedback
    extra = 0


class DriverReportAdmin(admin.ModelAdmin):
    list_display = ("date", "driver_name", "morning_scheduled_time", "evening_scheduled_time", "recorded_by_name", "status")
    inlines = [DriverDelayInline, DriverTaskInline, DriverFeedbackInline]


class ProjectStageInline(admin.TabularInline):
    model = ProjectStage
    extra = 0


class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "active")
    inlines = [ProjectStageInline]


admin.site.register(User, CustomUserAdmin)
admin.site.register(Project, ProjectAdmin)
admin.site.register(Employee)
admin.site.register(Material)
admin.site.register(MaterialUsageReport, MaterialUsageReportAdmin)
admin.site.register(Driver)
admin.site.register(DriverReport, DriverReportAdmin)
admin.site.register(DailyReport, DailyReportAdmin)
