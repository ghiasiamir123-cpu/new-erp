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


class CanCreateDriverReport(BasePermission):
    """Drivers only get write access to the driver log; everyone above them keeps it too."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("manager", "data_entry", "driver")
        )


def HasAccess(*keys):
    """دسترسی به یکی از سربرگ‌ها — همان تیکی که در صفحهٔ کاربران زده می‌شود."""

    class _HasAccess(BasePermission):
        def has_permission(self, request, view):
            user = request.user
            return bool(user and user.is_authenticated
                        and any(user.has_access(key) for key in keys))

    _HasAccess.__name__ = "HasAccess_" + "_".join(keys)
    return _HasAccess


# انبار، کارتابل مالی و بقیه دیگر پرچم جدا ندارند؛ همه از یک فهرست خوانده می‌شوند.
CanAccessWarehouse = HasAccess("warehouse")
CanReviewConsumables = HasAccess("consumables")
CanReviewStock = HasAccess("stockreview")
CanReviewFinance = HasAccess("finance")
CanAccessPayroll = HasAccess("payroll")
CanManageUsers = HasAccess("users")
