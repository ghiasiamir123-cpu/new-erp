from rest_framework.permissions import BasePermission


def HasAccess(*keys):
    """یکی از کلیدهای دسترسی — سربرگ («warehouse») یا کار درون آن («warehouse.post»).

    همان تیکی که در صفحهٔ کاربران زده می‌شود؛ نقش در هیچ اجازه‌ای دخالت ندارد.
    """

    class _HasAccess(BasePermission):
        message = "برای این کار دسترسی ندارید؛ از مسئول «کاربران» بخواهید تیکش را بزند."

        def has_permission(self, request, view):
            user = request.user
            return bool(user and user.is_authenticated
                        and any(user.has_access(key) for key in keys))

    _HasAccess.__name__ = "HasAccess_" + "_".join(k.replace(".", "_") for k in keys)
    return _HasAccess


CanAccessWarehouse = HasAccess("warehouse")
CanReviewConsumables = HasAccess("consumables")
CanReviewStock = HasAccess("stockreview")
CanReviewFinance = HasAccess("finance")
CanViewFinanceReports = HasAccess("financereports")
CanAccessPayroll = HasAccess("payroll")
CanManageUsers = HasAccess("users")
