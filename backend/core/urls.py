from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LoginView, MeView, ProjectViewSet, ReportViewSet, UserListCreateView

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("reports", ReportViewSet, basename="report")

urlpatterns = [
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("users/", UserListCreateView.as_view()),
    path("", include(router.urls)),
]
