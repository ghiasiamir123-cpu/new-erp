"""گفتگوی درون‌سازمانی: دونفره، گروهی، خوانده‌نشده، پیوست عکس و فایل.

پیوست به‌صورت data URL در همان دیتابیس می‌ماند (مثل عکس پروفایل)، تا نیاز به تنظیم رسانه یا
پوشهٔ فایل نباشد و همه‌چیز با پشتیبان‌گیری همراه برود. حداکثر ۵۰۰ کیلوبایت برای هر پیوست.
"""
import datetime as dt
import re
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import Conversation, ConversationMember, Message, Project, User

MAX_ATTACHMENT_BYTES = 500 * 1024
DATA_URL = re.compile(r"^data:(?P<mime>[^;]+);base64,")


def user_conversations(user):
    """گفتگوهای فعال یک کاربر: آنهایی که عضو است و ترکش نکرده."""
    return (Conversation.objects
            .filter(members__user=user, members__left_at__isnull=True)
            .distinct())


def _other_direct_member(conv, me):
    """طرف دیگر یک گفتگوی دونفره از دید me."""
    return (User.objects.filter(chat_memberships__conversation=conv)
            .exclude(pk=me.pk).first())


def _title_for(conv, me):
    if conv.kind == Conversation.Kind.GROUP:
        return conv.title
    other = _other_direct_member(conv, me)
    return (other.name or other.username) if other else "گفتگو"


def countdown_for(project):
    """روزشمار تحویل یک پروژه — زنده حساب می‌شود، نه پیامِ ذخیره‌شده."""
    if project is None or not project.due_date:
        return None
    days = (project.due_date - dt.date.today()).days
    return {"dueDate": project.due_date, "days": days,
            "late": days < 0, "soon": 0 <= days <= 7}


def conversation_row(conv, me):
    """یک ردیف فهرست گفتگوها، با خلاصهٔ آخرین پیام و تعداد خوانده‌نشده."""
    last = conv.messages.order_by("-id").first()
    my_member = conv.members.filter(user=me).first()
    last_read = my_member.last_read_at if my_member else None
    unread = (conv.messages.filter(created_at__gt=last_read).exclude(sender=me).count()
              if last_read else conv.messages.exclude(sender=me).count())
    members_qs = (ConversationMember.objects
                  .filter(conversation=conv, left_at__isnull=True)
                  .select_related("user"))
    members = [{"username": m.user.username, "name": m.user.name, "photo": m.user.photo}
               for m in members_qs]
    other = None
    if conv.kind == Conversation.Kind.DIRECT:
        for m in members:
            if m["username"] != me.username:
                other = m
                break
    return {
        "id": str(conv.pk), "kind": conv.kind, "title": _title_for(conv, me),
        "other": other, "members": members, "unread": unread,
        "lastMessageAt": conv.last_message_at,
        "lastMessage": _message_preview(last, me) if last else None,
        "projectId": str(conv.project_id) if conv.project_id else None,
        "countdown": countdown_for(conv.project) if conv.project_id else None,
    }


def _message_preview(msg, me):
    if msg is None:
        return None
    prefix = "شما: " if msg.sender_id == me.pk else ""
    text = msg.text.strip()
    if text:
        return prefix + (text[:80] + ("…" if len(text) > 80 else ""))
    if msg.attachment_kind == "image":
        return prefix + "📷 عکس"
    if msg.attachment_kind == "file":
        return prefix + f"📎 {msg.attachment_name or 'فایل'}"
    return prefix + "…"


def message_row(msg):
    return {
        "id": str(msg.pk), "sender": msg.sender_id and msg.sender.username,
        "senderName": msg.sender_name or (msg.sender.name if msg.sender_id else ""),
        "text": msg.text, "attachment": msg.attachment,
        "attachmentName": msg.attachment_name, "attachmentKind": msg.attachment_kind,
        "createdAt": msg.created_at,
    }


def clean_attachment(raw, name):
    """یک پیوست data URL کوچک — عکس یا فایل — یا هیچ."""
    raw = (raw or "").strip()
    if not raw:
        return "", "", ""
    m = DATA_URL.match(raw)
    if not m:
        raise ValidationError("پیوست معتبر نیست.")
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ValidationError("فایل بزرگ است؛ لطفاً کمتر از ۵۰۰ کیلوبایت.")
    mime = m.group("mime").lower()
    kind = "image" if mime.startswith("image/") else "file"
    return raw, (name or "")[:200], kind


def _require_member(conv, user):
    m = conv.members.filter(user=user).first()
    if m is None or m.left_at is not None:
        raise PermissionDenied("شما عضو این گفتگو نیستید.")
    return m


@transaction.atomic
def send_message(conv, sender, text, attachment_raw, attachment_name):
    _require_member(conv, sender)
    text = (text or "").strip()
    att, name, kind = clean_attachment(attachment_raw, attachment_name)
    if not text and not att:
        raise ValidationError("پیام خالی است.")
    from django.utils import timezone
    msg = Message.objects.create(
        conversation=conv, sender=sender,
        sender_name=(sender.name or sender.username)[:150],
        text=text[:5000], attachment=att, attachment_name=name, attachment_kind=kind,
    )
    conv.last_message_at = msg.created_at
    conv.save(update_fields=["last_message_at"])
    # فرستنده خودش پیام خودش را «خوانده» حساب می‌شود.
    ConversationMember.objects.filter(conversation=conv, user=sender).update(last_read_at=msg.created_at)
    return msg


@transaction.atomic
def mark_read(conv, user):
    from django.utils import timezone
    _require_member(conv, user)
    now = timezone.now()
    ConversationMember.objects.filter(conversation=conv, user=user).update(last_read_at=now)
    return now


@transaction.atomic
def start_direct(me, other_username):
    """گفتگوی دونفره؛ اگر پیش‌تر بوده، همان را برمی‌گرداند."""
    if other_username == me.username:
        raise ValidationError("گفتگو با خودتان معنی ندارد.")
    other = User.objects.filter(username=other_username, is_active=True).first()
    if other is None:
        raise ValidationError("این کاربر پیدا نشد یا غیرفعال است.")
    # گفتگوی دونفرهٔ بین این دو نفر: از میان گفتگوهایی که «me» عضوشان است، آنی که «other» هم عضوش است.
    my_ids = set(Conversation.objects.filter(kind=Conversation.Kind.DIRECT, members__user=me)
                 .values_list("id", flat=True))
    existing = (Conversation.objects
                .filter(id__in=my_ids, members__user=other)
                .first())
    if existing:
        # اگر یکی ترکش کرده بود، دوباره فعال می‌شود
        ConversationMember.objects.filter(conversation=existing, user__in=(me, other)).update(left_at=None)
        return existing
    conv = Conversation.objects.create(kind=Conversation.Kind.DIRECT, created_by=me)
    ConversationMember.objects.bulk_create([
        ConversationMember(conversation=conv, user=me),
        ConversationMember(conversation=conv, user=other),
    ])
    return conv


@transaction.atomic
def start_group(me, title, usernames):
    title = (title or "").strip()
    if not title:
        raise ValidationError("عنوان گروه را بنویسید.")
    usernames = list({(u or "").strip() for u in (usernames or []) if u} | {me.username})
    users = list(User.objects.filter(username__in=usernames, is_active=True))
    if len(users) < 2:
        raise ValidationError("گروه دست‌کم دو عضو می‌خواهد.")
    conv = Conversation.objects.create(kind=Conversation.Kind.GROUP, title=title[:100], created_by=me)
    ConversationMember.objects.bulk_create(
        [ConversationMember(conversation=conv, user=u) for u in users])
    return conv


@transaction.atomic
def project_group(project, creator, usernames=None):
    """گروه گفتگوی یک پروژه؛ اگر پیش‌تر ساخته شده، همان برمی‌گردد.

    اعضا: سازنده به‌علاوهٔ کسانی که گزارش کار ثبت می‌کنند (کلید entry.create) — همان‌هایی
    که هر روز روی این پروژه کار می‌کنند و باید روزشمارش را ببینند.
    """
    existing = Conversation.objects.filter(project=project).first()
    if existing:
        ConversationMember.objects.filter(conversation=existing, user=creator).update(left_at=None)
        return existing, False

    if usernames is None:
        # فیلتر در پایتون، نه در SQL: جست‌وجو درون JSONField روی SQLite پشتیبانی نمی‌شود
        # و تعداد کاربران هم کم است.
        users = [u for u in User.objects.filter(is_active=True)
                 if "entry.create" in (u.access or [])]
    else:
        users = list(User.objects.filter(is_active=True, username__in=list(usernames)))
    if creator not in users:
        users.append(creator)
    if len(users) < 2:
        raise ValidationError("برای ساختن گروه دست‌کم دو نفر لازم است.")

    conv = Conversation.objects.create(
        kind=Conversation.Kind.GROUP, title=project.name[:100],
        project=project, created_by=creator)
    ConversationMember.objects.bulk_create(
        [ConversationMember(conversation=conv, user=u) for u in users])

    # یک پیام افتتاحیه؛ روزشمار خودش زنده در سربرگ گفتگو دیده می‌شود.
    lines = [f"پروژهٔ «{project.name}» شروع شد."]
    if project.due_date:
        left = (project.due_date - dt.date.today()).days
        lines.append(f"تاریخ تحویل: {project.due_date} — {left} روز فرصت.")
    else:
        lines.append("تاریخ تحویل هنوز وارد نشده.")
    area = sum(float(s.area or 0) for s in project.stages.all())
    if area:
        lines.append(f"متراژ کل: {area:g} متر مربع.")
    send_message(conv, creator, "\n".join(lines), "", "")
    return conv, True


def unread_total(user):
    """جمع پیام‌های خوانده‌نشدهٔ همهٔ گفتگوها — برای نشان دادن روی دکمهٔ منو."""
    total = 0
    for conv in user_conversations(user).select_related():
        m = conv.members.filter(user=user).first()
        last_read = m.last_read_at if m else None
        qs = conv.messages.exclude(sender=user)
        if last_read:
            qs = qs.filter(created_at__gt=last_read)
        total += qs.count()
    return total
