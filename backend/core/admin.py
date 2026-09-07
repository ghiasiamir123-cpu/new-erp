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
    PackConversion,
    Product,
    Project,
    ProjectStage,
    ReportItem,
    ReportProgress,
    Sku,
    StockBatch,
    StockItem,
    StockMovement,
    Supplier,
    User,
    Warehouse,
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


# ============ انبار ============

class SkuInline(admin.TabularInline):
    model = Sku
    extra = 0
    fields = ("site_package_id", "pack_size", "grit", "shade", "sale_price", "cost_price", "active")


class ProductAdmin2(admin.ModelAdmin):
    list_display = ("name", "brand", "category", "code", "sellable", "batch_tracked", "hazardous", "active")
    list_filter = ("brand", "sellable", "batch_tracked", "hazardous", "active", "category")
    search_fields = ("name", "code", "brand")
    inlines = [SkuInline]


class SkuAdmin(admin.ModelAdmin):
    list_display = ("site_package_id", "product", "pack_size", "grit", "shade", "sale_price", "active")
    list_filter = ("product__brand", "active")
    search_fields = ("site_package_id", "product__name", "product__code", "grit", "shade")


class StockItemAdmin(admin.ModelAdmin):
    list_display = ("sku", "warehouse", "shelf_code", "min_qty", "reserved_qty", "counted_at")
    list_filter = ("warehouse", "sku__product__brand")
    search_fields = ("sku__site_package_id", "sku__product__name", "shelf_code")


class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("date", "kind", "sku", "warehouse", "qty", "created_by_name", "ref")
    list_filter = ("kind", "warehouse", "date")
    search_fields = ("sku__site_package_id", "sku__product__name", "ref", "note")
    date_hierarchy = "date"


class StockBatchAdmin(admin.ModelAdmin):
    list_display = ("sku", "batch_no", "produced_on", "expires_on")
    list_filter = ("expires_on",)
    search_fields = ("batch_no", "sku__product__name")


admin.site.register(Supplier)
admin.site.register(Warehouse)
admin.site.register(Product, ProductAdmin2)
admin.site.register(Sku, SkuAdmin)
admin.site.register(PackConversion)
admin.site.register(StockBatch, StockBatchAdmin)
admin.site.register(StockItem, StockItemAdmin)
admin.site.register(StockMovement, StockMovementAdmin)
