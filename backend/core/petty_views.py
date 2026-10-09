"""تنخواه (core/pettycash.py): هر کس سربرگِ «دستیار حسابداری» را دارد تنخواهِ خودش را می‌بیند و خرج وارد می‌کند؛
دیدنِ همه، شارژ و تأیید با کلیدِ «accounting.cash» است و در خودِ pettycash وارسی می‌شود."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import pettycash
from .permissions import HasAccess


class PettyCashViewSet(viewsets.ViewSet):
    permission_classes = [HasAccess(pettycash.TAB)]

    def list(self, request):
        return Response(pettycash.listing(request.user))

    def create(self, request):
        row = pettycash.save(request.data or {}, request.user)
        return Response(pettycash.to_dict(row), status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        row = pettycash.save(request.data or {}, request.user, pettycash.get(pk, request.user))
        return Response(pettycash.to_dict(row))

    def destroy(self, request, pk=None):
        pettycash.remove(pettycash.get(pk, request.user), request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"])
    def holder(self, request):
        """تعریف، ویرایش یا برداشتنِ یک تنخواه‌دار؛ پاسخ همان فهرستِ تازهٔ صفحه است."""
        pettycash.set_holder(request.data or {}, request.user)
        return Response(pettycash.listing(request.user))

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        d = request.data or {}
        row = pettycash.review(pettycash.get(pk, request.user), d.get("action"), d.get("note"), request.user)
        return Response(pettycash.to_dict(row))

    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        """عکسِ رسید جدا می‌آید تا فهرست سبک بماند."""
        return Response({"receipt": pettycash.get(pk, request.user).receipt})
