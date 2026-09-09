from rest_framework.permissions import BasePermission


class IsManager(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == "manager"
        )


class CanCreateReport(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("manager", "data_entry")
        )


class CanAccessPayroll(BasePermission):
    """حقوق و دستمزد فقط برای مدیر و حسابداری — سرپرست و بقیه دسترسی ندارند."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("manager", "accountant")
        )


class CanCreateDriverReport(BasePermission):
    """Drivers only get write access to the driver log; everyone above them keeps it too."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("manager", "data_entry", "driver")
        )


class CanAccessWarehouse(BasePermission):
    """دیدن انبار فقط با اجازهٔ صریح.

    نقش کافی نیست: انبار موجودی و قیمت خرید را نشان می‌دهد، پس مدیر خودش
    تعیین می‌کند چه کسی ببیند — از همان صفحهٔ کاربران.
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.can_access_warehouse
        )
