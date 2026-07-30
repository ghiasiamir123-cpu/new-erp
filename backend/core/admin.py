from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import DailyReport, Feedback, Project, ReportItem, User


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


admin.site.register(User, CustomUserAdmin)
admin.site.register(Project)
admin.site.register(DailyReport, DailyReportAdmin)
