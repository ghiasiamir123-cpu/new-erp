from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ChangePasswordView,
    DriverReportViewSet,
    DriverViewSet,
    EmployeeViewSet,
    LoginView,
    MaterialUsageReportViewSet,
    MaterialViewSet,
    MeView,
    PayrollMonthViewSet,
    PayrollSettingsView,
    PayrollStaffViewSet,
    ProjectViewSet,
    ReportViewSet,
    CatalogImportView,
    StockMovementViewSet,
    StockViewSet,
    StockVoucherViewSet,
    SupplierViewSet,
    UnpackView,
    ConsumableReviewViewSet,
    ConsumableViewSet,
    ItemViewSet,
    LocationViewSet,
    UserListCreateView,
    UserUpdateView,
    WarehouseAdminViewSet,
    WarehouseViewSet,
    WorkshopItemView,
)

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("reports", ReportViewSet, basename="report")
router.register("materials", MaterialViewSet, basename="material")
router.register("material-usages", MaterialUsageReportViewSet, basename="material-usage")
router.register("employees", EmployeeViewSet, basename="employee")
router.register("drivers", DriverViewSet, basename="driver")
router.register("driver-reports", DriverReportViewSet, basename="driver-report")
router.register("payroll-staff", PayrollStaffViewSet, basename="payroll-staff")
router.register("payroll-months", PayrollMonthViewSet, basename="payroll-month")
router.register("warehouses", WarehouseViewSet, basename="warehouse")
router.register("stock", StockViewSet, basename="stock")
router.register("stock-movements", StockMovementViewSet, basename="stock-movement")
router.register("stock-vouchers", StockVoucherViewSet, basename="stock-voucher")
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("locations", LocationViewSet, basename="location")
router.register("items", ItemViewSet, basename="item")
router.register("consumables", ConsumableViewSet, basename="consumable")
router.register("consumable-review", ConsumableReviewViewSet, basename="consumable-review")
router.register("manage-warehouses", WarehouseAdminViewSet, basename="manage-warehouse")

urlpatterns = [
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/change-password/", ChangePasswordView.as_view()),
    path("users/", UserListCreateView.as_view()),
    path("users/<str:username>/", UserUpdateView.as_view()),
    path("payroll-settings/", PayrollSettingsView.as_view()),
    path("workshop-items/", WorkshopItemView.as_view()),
    path("catalog-import/", CatalogImportView.as_view()),
    path("unpack/", UnpackView.as_view()),
    path("", include(router.urls)),
]
