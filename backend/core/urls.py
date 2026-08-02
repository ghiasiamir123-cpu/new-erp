from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ChangePasswordView,
    DriverReportViewSet,
    DriverViewSet,
    EmployeeViewSet,
    LoginView,
    MaterialUsageViewSet,
    MaterialViewSet,
    MeView,
    ProjectViewSet,
    ReportViewSet,
    UserListCreateView,
)

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("reports", ReportViewSet, basename="report")
router.register("materials", MaterialViewSet, basename="material")
router.register("material-usages", MaterialUsageViewSet, basename="material-usage")
router.register("employees", EmployeeViewSet, basename="employee")
router.register("drivers", DriverViewSet, basename="driver")
router.register("driver-reports", DriverReportViewSet, basename="driver-report")

urlpatterns = [
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/change-password/", ChangePasswordView.as_view()),
    path("users/", UserListCreateView.as_view()),
    path("", include(router.urls)),
]
