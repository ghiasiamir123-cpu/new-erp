"""فاکتور فروشِ پروژه‌ها.

از روی فاکتورهایی که تا امروز در اکسل زده می‌شد ساخته شده و همان حالت‌ها را می‌پوشاند:

  · نوع سند: پیش‌فاکتور (برآورد)، فاکتور، و «فاکتور فروش کالا و خدمات» رسمی با ستون‌های تخفیف و مالیات.
  · هر پروژه چند سند دارد: متریال و دستمزد جدا، قسمتِ اول و دوم، نسخهٔ اصلاحی، گزینهٔ یک و دو.
  · هر ردیف یکی از سه جور قیمت می‌خورد (mode):
        area  متری        — متراژ × بهای هر متر
        piece دانه‌ای      — تعداد × بهای هر دانه (درب، روشویی، لنگه)
        both  تعداد × متراژ — تعداد × متراژِ هر دانه × بهای هر متر (۶۲ لنگه درب، هر کدام ۴ متر)
    روی هر سه، «ضریب سختی» (کارِ دستگیر، قوس، سقف: ۱٫۲ تا ۲٫۵) و «ضریب حجم/شیار» (کارِ حجمی و شیاردار) ضرب
    می‌شود، و «درصدِ انجام» برای صورت‌وضعیتِ کارِ نیمه‌تمام. ننوشته‌ها ۱ و ۱۰۰ هستند. هر ردیف تخفیفِ ریالیِ خودش
    و یک خطِ «مشخصات فنی» زیرِ شرح را هم می‌تواند داشته باشد.
  · بعد از جمعِ ردیف‌ها، «افزوده و کسر»ها به ترتیب می‌آیند: تخفیفِ درصدی یا ریالی، بسته‌بندی، کاورکاری، حمل.
    درصدی یعنی درصدی از جمعِ تا همان‌جا.
  · مالیات بر ارزش افزوده یک درصد برای کلِ سند است و ردیف‌به‌ردیف حساب و گرد می‌شود، تا جمعِ ستونِ مالیاتِ
    فاکتورِ رسمی با مالیاتِ کل ریال‌به‌ریال یکی باشد.
  · دریافتی‌های پروژه (ProjectReceipt) را می‌شود زیرِ سند آورد تا «ماندهٔ قابل پرداخت» دیده شود.

فقط پیش‌نویس ویرایش می‌شود؛ سندِ صادرشده را باید اول به پیش‌نویس برگرداند. مشخصاتِ فروشنده روی خودِ سند کپی
می‌شود تا با عوض شدنِ فهرستِ فروشنده‌ها، سندهای قبلی عوض نشوند.
"""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from .models import InvoiceSeller, Project, ProjectReceipt, SalesInvoice

KINDS = {"proforma": "پیش‌فاکتور", "invoice": "فاکتور", "official": "فاکتور فروش کالا و خدمات"}
SCOPES = {"": "", "material": "متریال", "labour": "دستمزد"}
MODES = ("area", "piece", "both")
STATUSES = {"draft": "پیش‌نویس", "issued": "صادر شده", "cancelled": "باطل"}
UNITS = ["مترمربع", "متر طول", "عدد", "لنگه", "دست", "سرویس", "کیلوگرم", "لیتر", "ساعت", "مقطوع"]
# توضیح‌هایی که در فاکتورهای قبلی بیشتر از همه تکرار شده‌اند، تا با یک کلیک اضافه شوند.
COMMON_NOTES = [
    "هزینه کاورکاری، بسته‌بندی و حمل به عهده مشتری می‌باشد",
    "کلیه کسورات قانونی مانند مالیات و بیمه به عهده مشتری بوده و اعداد فوق به صورت خالص قابل پرداخت محاسبه گردیده است",
    "هزینه حمل به عهده کارفرما می‌باشد",
    "رنگ اجراشده شامل آستر پلی‌اورتان و رنگ رویه پلی‌اورتان رنر ایتالیا می‌باشد",
    "به دلیل انتخاب نشدن کد رنگ نهایی، قیمت‌ها علی‌الحساب می‌باشد",
    "واریز وجه به منزله تأیید فاکتور و مفاد مندرج در توضیحات ذیل آن از سوی خریدار می‌باشد",
    "کلیه سطوح حجمی و شیاردار با ضریب سختی محاسبه و متراژ می‌گردد که پس از رؤیت کار ضریب سختی آن تعیین می‌گردد",
    "متراژ نهایی پس از اجرای رنگ محاسبه می‌گردد که ملاک نهایی می‌باشد",
    "متراژها بر اساس نقشه‌ها برآورد گردیده و پس از اجرا متراژ نهایی کنترل می‌گردد که ملاک حساب خواهد بود",
    "قیمت‌ها بر حسب مترمربع تک‌رو می‌باشد",
    "این پیش‌فاکتور بدون در نظر گرفتن هزینه‌های بیمه و ارزش افزوده صادر گردیده و بنا به درخواست کارفرما در فاکتور رسمی اضافه می‌گردد",
    "هزینه اسکان، ایاب و ذهاب پرسنل به عهده کارفرما می‌باشد",
    "هزینه نصب در محل پروژه جداگانه محاسبه می‌گردد",
    "تهیه چسب و لوازم کاورکاری به عهده کارفرما می‌باشد",
]
COMMON_ADJUSTMENTS = ["تخفیف", "بسته‌بندی", "کاورکاری", "کاورکاری، بسته‌بندی و حمل", "حمل"]


def _dec(value, label, default=None):
    if value in (None, ""):
        if default is None:
            raise ValidationError(f"{label} وارد نشده است.")
        return Decimal(str(default))
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError(f"{label} عدد نیست.")
    if not d.is_finite():
        raise ValidationError(f"{label} عدد نیست.")
    return d


def _rial(d):
    return int(Decimal(d).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _num(d):
    """عددِ قابلِ ذخیره در JSON، بی صفرهای اضافه."""
    d = Decimal(d).normalize()
    return int(d) if d == d.to_integral() else float(d)


def clean_lines(raw):
    out = []
    for n, r in enumerate(raw or [], 1):
        desc = (r.get("description") or "").strip()
        if not desc:
            raise ValidationError(f"شرحِ ردیف {n} خالی است.")
        mode = r.get("mode") if r.get("mode") in MODES else "area"
        qty = _dec(r.get("quantity"), f"{'تعدادِ' if mode == 'piece' else 'متراژِ'} ردیف {n}")
        count = _dec(r.get("count"), f"تعدادِ ردیف {n}") if mode == "both" else Decimal(1)
        coef = _dec(r.get("coefficient"), f"ضریب سختیِ ردیف {n}", 1)
        coef2 = _dec(r.get("coefficient2"), f"ضریب حجمِ ردیف {n}", 1)
        price = _dec(r.get("unitPrice"), f"بهای واحدِ ردیف {n}")
        percent = _dec(r.get("percent"), f"درصدِ انجامِ ردیف {n}", 100)
        discount = _dec(r.get("discount"), f"تخفیفِ ردیف {n}", 0)
        if qty <= 0 or count <= 0 or coef <= 0 or coef2 <= 0 or price < 0:
            raise ValidationError(f"تعداد، متراژ و ضریب‌های ردیف {n} باید بزرگ‌تر از صفر باشد و بها منفی نباشد.")
        if not 0 < percent <= 100:
            raise ValidationError(f"درصدِ انجامِ ردیف {n} باید بین ۰ و ۱۰۰ باشد.")
        gross = _rial(count * qty * coef * coef2 * price * percent / 100)
        if discount < 0 or discount > gross:
            raise ValidationError(f"تخفیفِ ردیف {n} نمی‌تواند منفی یا بیشتر از مبلغِ همان ردیف باشد.")
        out.append({"description": desc[:500], "spec": (r.get("spec") or "").strip()[:600],
                    "mode": mode, "unit": (r.get("unit") or "").strip()[:30], "count": _num(count), "quantity": _num(qty),
                    "coefficient": _num(coef), "coefficient2": _num(coef2),
                    "unitPrice": _rial(price), "percent": _num(percent), "discount": _rial(discount)})
    if not out:
        raise ValidationError("فاکتور دست‌کم یک ردیف می‌خواهد.")
    return out


def clean_adjustments(raw):
    out = []
    for n, r in enumerate(raw or [], 1):
        label = (r.get("label") or "").strip()
        if not label:
            raise ValidationError(f"عنوانِ افزوده/کسرِ {n} خالی است.")
        mode = r.get("mode") if r.get("mode") in ("amount", "percent") else "amount"
        value = _dec(r.get("value"), f"مقدارِ «{label}»")
        if value <= 0 or (mode == "percent" and value > 100):
            raise ValidationError(f"مقدارِ «{label}» باید بزرگ‌تر از صفر باشد (و درصد بیش از ۱۰۰ نباشد).")
        out.append({"label": label[:80], "sign": -1 if r.get("sign") in (-1, "-1", "sub") else 1, "mode": mode,
                    "value": _num(value) if mode == "percent" else _rial(value)})
    return out


def compute(lines, adjustments, vat_percent):
    """همهٔ عددهای سند. lines و adjustments باید پاک‌شده (clean_*) باشند."""
    vat = Decimal(str(vat_percent or 0))
    rows, subtotal, discount, tax = [], 0, 0, 0
    for r in lines:
        factor = (Decimal(str(r.get("count", 1))) * Decimal(str(r["quantity"])) * Decimal(str(r["coefficient"]))
                  * Decimal(str(r.get("coefficient2", 1))) * Decimal(str(r["percent"])) / 100)
        gross = _rial(factor * r["unitPrice"])
        net = gross - r["discount"]
        t = _rial(net * vat / 100)
        # factor: مقدارِ مؤثر (تعداد × متراژ × ضریب‌ها × درصد) — همان عددی که در ستونِ «تعداد» فاکتورِ رسمی می‌آید
        rows.append({"mode": "area", "count": 1, "coefficient2": 1, **r, "factor": float(factor.quantize(Decimal("0.001"))),
                     "gross": gross, "net": net, "vat": t, "total": net + t})
        subtotal += net
        discount += r["discount"]
        tax += t
    running, adj = subtotal, []
    for a in adjustments:
        amount = _rial(running * Decimal(str(a["value"])) / 100) if a["mode"] == "percent" else a["value"]
        signed = a["sign"] * amount
        t = a["sign"] * _rial(amount * vat / 100)
        running += signed
        tax += t
        adj.append({**a, "amount": amount, "signed": signed, "vat": t, "after": running})
    if running < 0:
        raise ValidationError("کسرها از جمعِ فاکتور بیشتر شده است.")
    return {"lines": rows, "adjustments": adj, "gross": subtotal + discount, "lineDiscount": discount,
            "subtotal": subtotal, "base": running, "vat": tax, "total": running + tax}


def suggest_number(kind, date):
    """شمارهٔ بعدی به شکلِ فاکتورهای رسمیِ قبلی: «۷۱۱۱-۴۰۴» — شمارهٔ ردیف، خط تیره، سه رقمِ آخرِ سالِ شمسی."""
    from .jalali import gregorian_to_jalali
    year = gregorian_to_jalali(date.year, date.month, date.day)[0] % 1000
    suffix = f"-{year}"
    best = 0
    for num in SalesInvoice.objects.filter(kind=kind, number__endswith=suffix).values_list("number", flat=True):
        head = num[:-len(suffix)]
        if head.isdigit():
            best = max(best, int(head))
    return f"{best + 1}{suffix}" if best else ""


def _party(raw, fields):
    raw = raw or {}
    return {k: str(raw.get(k) or "").strip()[:300] for k in fields}


SELLER_FIELDS = ("name", "nationalId", "regNo", "economicCode", "province", "city", "address", "postalCode", "phone", "bankNote")
BUYER_FIELDS = ("name", "nationalId", "regNo", "economicCode", "province", "city", "address", "postalCode", "phone", "projectName")


def seller_dict(s):
    return {"id": str(s.pk), "name": s.name, "nationalId": s.national_id, "regNo": s.reg_no, "economicCode": s.economic_code,
            "province": s.province, "city": s.city, "address": s.address, "postalCode": s.postal_code, "phone": s.phone,
            "bankNote": s.bank_note, "active": s.active}


def save_seller(data):
    name = (data.get("name") or "").strip()
    if not name:
        raise ValidationError("نام فروشنده خالی است.")
    s = InvoiceSeller.objects.filter(pk=data.get("id")).first() if str(data.get("id") or "").isdigit() else InvoiceSeller()
    if s is None:
        raise ValidationError("فروشنده پیدا نشد.")
    if InvoiceSeller.objects.filter(name=name).exclude(pk=s.pk).exists():
        raise ValidationError(f"فروشنده‌ای با نام «{name}» هست.")
    p = _party(data, SELLER_FIELDS)
    s.name, s.national_id, s.reg_no, s.economic_code = name, p["nationalId"], p["regNo"], p["economicCode"]
    s.province, s.city, s.address, s.postal_code, s.phone, s.bank_note = (p["province"], p["city"], p["address"],
                                                                         p["postalCode"], p["phone"], p["bankNote"])
    s.active = data.get("active", True) is not False
    s.save()
    return s


def received(project_id):
    return int(ProjectReceipt.objects.filter(project_id=project_id).aggregate(s=Sum("amount"))["s"] or 0)


def to_dict(inv, full=True):
    p = inv.project
    out = {
        "id": str(inv.pk), "projectId": str(p.pk), "project": f"{p.code} ({(p.short_name or p.name).strip()})" if p.code else p.name,
        "kind": inv.kind, "kindLabel": KINDS[inv.kind], "scope": inv.scope, "scopeLabel": SCOPES.get(inv.scope, ""),
        "title": inv.title, "number": inv.number, "date": inv.date, "status": inv.status, "statusLabel": STATUSES[inv.status],
        "buyerName": (inv.buyer or {}).get("name", ""), "sellerName": (inv.seller or {}).get("name", ""),
        "subtotal": int(inv.subtotal), "vat": int(inv.vat), "total": int(inv.total),
        "byName": inv.created_by_name, "updatedAt": inv.updated_at,
    }
    if full:
        calc = compute(inv.lines, inv.adjustments, inv.vat_percent)
        got = received(p.pk)
        out.update({"seller": inv.seller, "buyer": inv.buyer, "notes": inv.notes, "vatPercent": float(inv.vat_percent),
                    "showReceipts": inv.show_receipts, "calc": calc, "received": got, "payable": calc["total"] - got})
    return out


def save(data, user, inv=None):
    """ساخت یا ویرایشِ پیش‌نویس."""
    if inv is not None and inv.status != "draft":
        raise ValidationError("فقط پیش‌نویس ویرایش می‌شود؛ اول سند را به پیش‌نویس برگردانید.")
    if inv is None:
        pid = str(data.get("project") or "")
        project = Project.objects.filter(pk=int(pid), general=False).first() if pid.isdigit() else None
        if project is None:
            raise ValidationError("پروژه پیدا نشد.")
        inv = SalesInvoice(project=project, created_by_name=user.name or user.username)
    kind = data.get("kind")
    if kind not in KINDS:
        raise ValidationError("نوع سند مشخص نیست.")
    try:
        date = dt.date.fromisoformat(str(data.get("date"))[:10])
    except (TypeError, ValueError):
        raise ValidationError("تاریخ فاکتور معتبر نیست.")
    vat = _dec(data.get("vatPercent"), "درصد مالیات", 0)
    if not 0 <= vat <= 30:
        raise ValidationError("درصد مالیات باید بین ۰ و ۳۰ باشد.")
    seller = _party(data.get("seller"), SELLER_FIELDS)
    buyer = _party(data.get("buyer"), BUYER_FIELDS)
    if not seller["name"]:
        raise ValidationError("فروشنده را انتخاب کنید.")
    if not buyer["name"]:
        raise ValidationError("نام خریدار خالی است.")
    lines = clean_lines(data.get("lines"))
    adjustments = clean_adjustments(data.get("adjustments"))
    calc = compute(lines, adjustments, vat)
    inv.kind, inv.date, inv.vat_percent = kind, date, vat
    inv.scope = data.get("scope") if data.get("scope") in SCOPES else ""
    inv.title = (data.get("title") or "").strip()[:200]
    inv.number = (data.get("number") or "").strip()[:40]
    inv.seller, inv.buyer, inv.lines, inv.adjustments = seller, buyer, lines, adjustments
    inv.notes = [str(n).strip()[:600] for n in (data.get("notes") or []) if str(n).strip()][:30]
    inv.show_receipts = bool(data.get("showReceipts"))
    inv.subtotal, inv.vat, inv.total = calc["subtotal"], calc["vat"], calc["total"]
    inv.save()
    return inv


def set_status(inv, status):
    if status not in STATUSES:
        raise ValidationError("وضعیت نامعتبر است.")
    if status == "issued":
        if not inv.number:
            raise ValidationError("برای صادر کردن، شمارهٔ فاکتور را بنویسید.")
        clash = SalesInvoice.objects.filter(kind=inv.kind, number=inv.number, status="issued").exclude(pk=inv.pk).first()
        if clash:
            raise ValidationError(f"شمارهٔ «{inv.number}» را سندِ دیگری از همین نوع دارد ({clash.project.name}).")
    inv.status = status
    inv.save(update_fields=["status", "updated_at"])
    return inv


def copy(inv, user):
    """رونوشتِ پیش‌نویس از یک سند: برای قسمتِ بعد، نسخهٔ اصلاحی، یا تبدیلِ پیش‌فاکتور به فاکتور."""
    twin = SalesInvoice.objects.get(pk=inv.pk)
    twin.pk, twin.status, twin.number = None, "draft", ""
    twin.date = dt.date.today()
    twin.created_by_name = user.name or user.username
    twin.save()
    return twin


def defaults(project):
    """آنچه فرمِ فاکتورِ تازه با آن پر می‌شود."""
    return {
        "buyer": {"name": project.owner_name, "projectName": project.name, "address": project.address or "",
                  "province": "اصفهان", "city": "اصفهان"},
        "sellers": [seller_dict(s) for s in InvoiceSeller.objects.filter(active=True)],
        "units": UNITS, "notes": COMMON_NOTES, "adjustments": COMMON_ADJUSTMENTS,
        "numbers": {k: suggest_number(k, dt.date.today()) for k in KINDS},
        "received": received(project.pk),
        "contract": float(project.price) if project.price else None,
    }


def project_summary():
    """جمعِ سندهای صادرشدهٔ هر پروژه (پیش‌فاکتور و باطل شمرده نمی‌شود)، کنارِ قرارداد و دریافتی."""
    out = {}
    for inv in SalesInvoice.objects.filter(status="issued").exclude(kind="proforma").values("project_id", "total"):
        out[inv["project_id"]] = out.get(inv["project_id"], 0) + int(inv["total"])
    return out
