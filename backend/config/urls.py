"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse, HttpResponseNotFound
from django.urls import include, path


def spa_index(request):
    index_path = settings.REPO_ROOT / 'dist' / 'index.html'
    if not index_path.is_file():
        return HttpResponseNotFound(
            "فرانت‌اند هنوز build نشده. دستور 'npm run build' را در ریشهٔ پروژه اجرا کنید."
        )
    response = HttpResponse(index_path.read_text(encoding='utf-8'))
    # نام فایل جاوااسکریپت داخل همین index.html است و با هر build عوض می‌شود.
    # بدون این هدرها مرورگر نسخهٔ قدیمی را نگه می‌دارد و کاربر بعد از هر استقرار
    # همچنان برنامهٔ قبلی را می‌بیند — فایل‌های assets خودشان هش دارند و کش‌شدنشان
    # مشکلی ندارد، ولی این یکی باید هر بار تازه گرفته شود.
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    return response


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
    path('', spa_index),
]
