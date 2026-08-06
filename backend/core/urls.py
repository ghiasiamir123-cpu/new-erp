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
    UserListCreateView,
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

urlpatterns = [
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/change-password/", ChangePasswordView.as_view()),
    path("users/", UserListCreateView.as_view()),
    path("payroll-settings/", PayrollSettingsView.as_view()),
    path("", include(router.urls)),
]
