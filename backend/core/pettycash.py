"""تنخواه: پولی که به یک نفر داده می‌شود، خرج‌هایی که از آن می‌کند، و آنچه به صندوق برمی‌گرداند.

تنخواه‌دار را مالی تعریف می‌کند (PettyCashHolder: حساب، بانک، سقف)؛ او خرجِ خودش را وارد می‌کند و خرج تا مالی
تأییدش نکند «منتظر تأیید» می‌ماند. کسی که کلیدِ «accounting.cash» دارد همه را می‌بیند، تنخواه‌دار تعریف می‌کند و
برمی‌دارد، تنخواه شارژ می‌کند و خرج‌ها را تأیید می‌کند یا برای اصلاح برمی‌گرداند. هر خرج مرکز هزینه دارد: یک
پروژه، کارهای عمومی کارگاه، یا اداری. مبلغ‌ها به ریال‌اند."""

import datetime
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import PettyCash, PettyCashHolder, Project, User, UserAuditLog

TAB = "accounting"
REVIEW = "accounting.cash"

KINDS = {"charge": "دریافت تنخواه", "expense": "خرج", "refund": "برگشت به صندوق"}
STATUSES = {"waiting": "منتظر تأیید", "approved": "تأیید شد", "returned": "برگشت برای اصلاح"}
# مرکز هزینه: خرج به حسابِ کجا می‌رود
CENTERS = [("project", "پروژه"), ("general", "کارهای عمومی کارگاه"), ("admin", "اداری")]
CATEGORIES = [("fuel", "سوخت"), ("transport", "کرایه، حمل و عوارض"), ("material", "خرید مواد و ابزار"),
              ("repair", "تعمیر و سرویس"), ("food", "پذیرایی و غذا"), ("office", "ملزومات اداری"), ("other", "سایر")]
MAX_AMOUNT = Decimal("100000000000")          # صد میلیارد ریال: بیش از این یعنی عدد اشتباه خورده
MAX_RECEIPT = 700_000                         # درازای data URL عکسِ رسید؛ مرورگر پیش از فرستادن کوچکش می‌کند


def can_review(user):
    return user.has_access(REVIEW)


def is_holder(user):
    return PettyCashHolder.objects.filter(user=user, active=True).exists()


def _label(p):
    return f"{p.code} ({(p.short_name or p.name).strip()})" if p.code else p.name


def center_label(row):
    if row.center == "project":
        return row.project_name or "پروژه"
    return dict(CENTERS).get(row.center, "")


def to_dict(row):
    return {
        "id": str(row.pk), "holder": row.holder.username, "holderName": row.holder_name, "kind": row.kind,
        "date": row.date, "amount": float(row.amount), "title": row.title, "category": row.category,
        "categoryLabel": dict(CATEGORIES).get(row.category, ""), "center": row.center, "centerLabel": center_label(row),
        "project": str(row.project_id) if row.project_id else "", "paidTo": row.paid_to, "hasReceipt": row.has_receipt,
        "status": row.status, "reviewNote": row.review_note, "reviewedBy": row.reviewed_by_name,
        "createdBy": row.created_by_name,
    }


def _amount(raw):
    try:
        v = Decimal(str(raw).replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        raise ValidationError("مبلغ را به ریال و با عدد وارد کنید.")
    if not v.is_finite() or v != v.to_integral_value() or v <= 0:
        raise ValidationError("مبلغ باید عددِ صحیح و بیشتر از صفر باشد (به ریال).")
    if v > MAX_AMOUNT:
        raise ValidationError("این مبلغ بیش از حد بزرگ است؛ عدد را دوباره نگاه کنید (به ریال).")
    return v


def _date(raw):
    try:
        d = datetime.date.fromisoformat(str(raw or ""))
    except ValueError:
        raise ValidationError("تاریخ نامعتبر است.")
    if d > datetime.date.today() + datetime.timedelta(days=1):
        raise ValidationError("تاریخِ آینده را نمی‌شود ثبت کرد.")
    return d


def _holder(raw, user):
    """تنخواه‌دارِ ردیف: خودِ کاربر، مگر مالی برای کسِ دیگری ثبت کند. فقط برای تنخواه‌دارِ تعریف‌شده."""
    if not raw or raw == user.username:
        if not is_holder(user):
            raise ValidationError("برای شما تنخواهی تعریف نشده است؛ مالی باید اول شما را تنخواه‌دار کند.")
        return user
    if not can_review(user):
        raise PermissionDenied("فقط تنخواهِ خودتان را می‌توانید ثبت کنید.")
    holder = User.objects.filter(username=raw, is_active=True).first()
    if holder is None or not is_holder(holder):
        raise ValidationError("این کاربر تنخواه‌دار نیست؛ اول با «+ تنخواه‌دارِ تازه» تعریفش کنید.")
    return holder


_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _account(raw):
    """شماره حساب، کارت یا شبا: بی فاصله و خط‌تیره نگه داشته می‌شود. خالی هم می‌شود."""
    s = re.sub(r"[\s\-]", "", str(raw or "").translate(_FA_DIGITS)).upper()
    if s and not re.fullmatch(r"(IR)?\d{8,26}", s):
        raise ValidationError("شماره حساب، کارت یا شبا را درست وارد کنید (فقط رقم؛ شبا با IR شروع می‌شود).")
    return s


def _log_access(target, actor, added=(), removed=()):
    UserAuditLog.objects.create(target=target, target_username=target.username, actor=actor,
                                actor_name=(actor.name or actor.username or "")[:150],
                                action=UserAuditLog.Action.ACCESS, changes={"added": list(added), "removed": list(removed)})


def set_holder(data, actor):
    """تعریف یا ویرایشِ یک تنخواه‌دار، یا برداشتنش (active=False). فقط مالی.

    تعریف، سربرگِ «دستیار حسابداری» را هم به کاربر می‌دهد تا «تنخواهِ من» را ببیند؛ برداشتن آن را پس می‌گیرد، مگر
    کاربر بخشِ دیگری از آن سربرگ را هم داشته باشد. تنخواه‌داری که مانده یا خرجِ منتظر دارد برداشته نمی‌شود."""
    if not can_review(actor):
        raise PermissionDenied("تعریفِ تنخواه‌دار با مالی است.")
    target = User.objects.filter(username=str(data.get("holder") or "")).first()
    if target is None:
        raise ValidationError("کاربر را انتخاب کنید.")
    profile = PettyCashHolder.objects.filter(user=target).first()
    access = list(target.access or [])
    if data.get("active") is False:
        if profile is None or not profile.active:
            raise ValidationError("این کاربر تنخواه‌دار نیست.")
        s = summary(PettyCash.objects.filter(holder=target).defer("receipt"), [target], {})[0]
        if s["waitingCount"]:
            raise ValidationError(f"{s['waitingCount']} خرجِ او هنوز منتظرِ تأیید است؛ اول تکلیفِ آن‌ها را روشن کنید.")
        if s["balance"]:
            raise ValidationError(f"ماندهٔ تنخواهِ او {int(s['balance']):,} ریال است؛ اول تسویه کنید (برگشت به صندوق یا شارژ).")
        profile.active = False
        profile.updated_by_name = actor.name or actor.username
        profile.save()
        if TAB in access and not any(k.startswith(TAB + ".") for k in access):
            target.access = [k for k in access if k != TAB]
            target.save(update_fields=["access"])
            _log_access(target, actor, removed=[TAB])
        return profile
    if not target.is_active:
        raise ValidationError("این کاربر غیرفعال است.")
    limit = None if data.get("limit") in (None, "") else _amount(data.get("limit"))
    fields = {"active": True, "account": _account(data.get("account")), "bank": str(data.get("bank") or "").strip()[:60],
              "limit": limit, "note": str(data.get("note") or "").strip()[:300], "updated_by_name": actor.name or actor.username}
    if profile is None:
        profile = PettyCashHolder.objects.create(user=target, **fields)
    else:
        for k, v in fields.items():
            setattr(profile, k, v)
        profile.save()
    if TAB not in access:
        target.access = access + [TAB]
        target.save(update_fields=["access"])
        _log_access(target, actor, added=[TAB])
    return profile


def _receipt(raw):
    raw = raw or ""
    if raw and not (isinstance(raw, str) and raw.startswith("data:image/")):
        raise ValidationError("رسید باید عکس باشد.")
    if len(raw) > MAX_RECEIPT:
        raise ValidationError("عکسِ رسید بزرگ است؛ عکسِ کوچک‌تری بگذارید.")
    return raw


def save(data, user, row=None):
    """یک ردیفِ تازه، یا ویرایشِ ردیفی که هنوز تأیید نشده."""
    kind = row.kind if row else (data.get("kind") or "expense")
    if kind not in KINDS:
        raise ValidationError("نوعِ ردیف نامعتبر است.")
    if kind != "expense" and not can_review(user):
        raise PermissionDenied("شارژ تنخواه و برگشت به صندوق را فقط مالی ثبت می‌کند.")
    if row is not None:
        if row.holder_id != user.pk and not can_review(user):
            raise PermissionDenied("این ردیف مالِ شما نیست.")
        if kind == "expense" and row.status == "approved":
            raise ValidationError("این خرج تأیید شده و دیگر عوض نمی‌شود؛ اگر اشتباه است مالی باید برش گرداند.")
    holder = row.holder if row else _holder(data.get("holder"), user)
    fields = {"date": _date(data.get("date")), "amount": _amount(data.get("amount")),
              "title": str(data.get("title") or "").strip()[:300], "paid_to": str(data.get("paidTo") or "").strip()[:200]}
    if kind == "expense":
        if not fields["title"]:
            raise ValidationError("شرحِ خرج را بنویسید (برای چه بود).")
        center = data.get("center") or ""
        if center not in dict(CENTERS):
            raise ValidationError("مرکز هزینه را انتخاب کنید: پروژه، کارهای عمومی کارگاه، یا اداری.")
        project = None
        if center == "project":
            project = Project.objects.filter(pk=_pk(data.get("project")), general=False).first()
            if project is None:
                raise ValidationError("پروژهٔ این خرج را انتخاب کنید.")
        category = data.get("category") or "other"
        if category not in dict(CATEGORIES):
            raise ValidationError("نوعِ خرج نامعتبر است.")
        fields.update(center=center, project=project, project_name=_label(project) if project else "", category=category,
                      status="waiting")             # خرجِ ویرایش‌شده دوباره منتظرِ تأیید می‌شود
    else:
        fields.update(center="", project=None, project_name="", category="", status="approved",
                      reviewed_by_name=user.name or user.username, reviewed_at=timezone.now())
    if "receipt" in data or row is None:
        fields["receipt"] = _receipt(data.get("receipt"))
        fields["has_receipt"] = bool(fields["receipt"])
    if row is None:
        return PettyCash.objects.create(holder=holder, holder_name=holder.name or holder.username, kind=kind,
                                        created_by=user, created_by_name=user.name or user.username, **fields)
    for k, v in fields.items():
        setattr(row, k, v)
    row.save()
    return row


def _pk(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def get(pk, user):
    row = PettyCash.objects.select_related("holder").filter(pk=_pk(pk)).first()
    if row is None or (row.holder_id != user.pk and not can_review(user)):
        raise ValidationError("ردیفِ تنخواه پیدا نشد.")
    return row


def remove(row, user):
    if row.kind != "expense":
        if not can_review(user):
            raise PermissionDenied("شارژ تنخواه را فقط مالی حذف می‌کند.")
    elif row.status == "approved":
        raise ValidationError("خرجِ تأییدشده حذف نمی‌شود؛ اگر اشتباه است مالی باید اول برش گرداند.")
    row.delete()


def review(row, action, note, user):
    """تأییدِ خرج، یا برگرداندنش برای اصلاح (با نوشتنِ علت)."""
    if not can_review(user):
        raise PermissionDenied("تأییدِ خرجِ تنخواه با مالی است.")
    if row.kind != "expense":
        raise ValidationError("فقط خرج تأیید می‌شود.")
    note = str(note or "").strip()[:500]
    if action == "approve":
        row.status = "approved"
    elif action == "return":
        if not note:
            raise ValidationError("بنویسید چرا برمی‌گردانید تا تنخواه‌دار بداند چه را درست کند.")
        row.status = "returned"
    else:
        raise ValidationError("کارِ نامعتبر.")
    row.review_note = note
    row.reviewed_by_name = user.name or user.username
    row.reviewed_at = timezone.now()
    row.save()
    return row


def summary(rows, holders, profiles):
    """برای هر تنخواه‌دار: دریافتی، خرجِ تأییدشده و منتظر، و مانده. خرجِ برگشت‌خورده تا اصلاح نشود حساب نمی‌شود."""
    acc = defaultdict(lambda: defaultdict(Decimal))
    count = defaultdict(lambda: defaultdict(int))
    for r in rows:
        key = r.kind if r.kind != "expense" else r.status
        acc[r.holder_id][key] += r.amount
        count[r.holder_id][key] += 1
    out = []
    for h in holders:
        a, c = acc[h.pk], count[h.pk]
        received = a["charge"] - a["refund"]
        p = profiles.get(h.pk)
        out.append({"holder": h.username, "name": h.name or h.username, "active": h.is_active,
                    "defined": bool(p and p.active), "account": p.account if p else "", "bank": p.bank if p else "",
                    "limit": float(p.limit) if p and p.limit is not None else None, "note": p.note if p else "",
                    "charged": float(a["charge"]), "refunded": float(a["refund"]), "approved": float(a["approved"]),
                    "waiting": float(a["waiting"]), "waitingCount": c["waiting"], "returnedCount": c["returned"],
                    "returned": float(a["returned"]), "balance": float(received - a["approved"] - a["waiting"])})
    return sorted(out, key=lambda x: (not x["defined"], x["name"]))


def listing(user):
    """همهٔ آنچه صفحهٔ تنخواه می‌خواهد. کاربرِ عادی فقط تنخواهِ خودش را می‌بیند."""
    review_all = can_review(user)
    qs = PettyCash.objects.select_related("holder").defer("receipt")
    if not review_all:
        qs = qs.filter(holder=user)
    rows = list(qs)
    profiles = {p.user_id: p for p in PettyCashHolder.objects.all()}
    defined = {uid for uid, p in profiles.items() if p.active}
    candidates = []
    if review_all:
        # تنخواه‌دارهای تعریف‌شده، و هر کس پیش‌تر ردیفی داشته (برداشته‌شده‌ها هم سابقه‌شان می‌ماند)
        holders = list(User.objects.filter(pk__in=defined | {r.holder_id for r in rows}))
        candidates = [{"username": u.username, "name": u.name or u.username}
                      for u in User.objects.filter(is_active=True).exclude(pk__in=defined).order_by("name", "username")]
    else:
        holders = [user]
    projects = [{"id": str(p.pk), "label": _label(p), "closed": bool(p.closed_at)}
                for p in sorted(Project.objects.filter(general=False, active=True),
                                key=lambda p: (bool(p.closed_at), p.code or "", p.name))]
    return {"me": user.username, "canReview": review_all, "isHolder": user.pk in defined, "candidates": candidates,
            "holders": summary(rows, holders, profiles),
            "rows": [to_dict(r) for r in rows], "projects": projects,
            "kinds": KINDS, "statuses": STATUSES,
            "centers": [{"id": k, "label": v} for k, v in CENTERS],
            "categories": [{"id": k, "label": v} for k, v in CATEGORIES]}
