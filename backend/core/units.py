"""حدس‌زدن واحد اصلی و فرعی از روی «اندازهٔ بسته».

سیاست: فقط جایی که ریاضی‌اش قطعی است پر می‌شود. اگر متن مبهم بود، واحد فرعی
خالی می‌ماند تا کاربر خودش تعیین کند — حدسِ اشتباه بدتر از خالی‌گذاشتن است،
چون مستقیم روی موجودی اثر می‌گذارد.
"""

import re
from decimal import Decimal

# «جعبه ۱۰۰ عددی» ، «بسته ۲۵ عددی»
_PACK = re.compile(r"(جعبه|بسته|پک)\s*(\d+(?:[.,]\d+)?)\s*عددی")
# «۲۵ کیلوگرم» ، «24Kg» ، «6 KG»
_WEIGHT = re.compile(r"^(\d+(?:[.,]\d+)?)\s*(?:کیلوگرم|کیلو|kg)$", re.I)
# «1L» ، «0.75 L» ، «۴ لیتر»
_VOLUME = re.compile(r"^(\d+(?:[.,]\d+)?)\s*(?:l|لیتر)$", re.I)
# «125ML» ، «500 ml»
_ML = re.compile(r"^(\d+(?:[.,]\d+)?)\s*ml$", re.I)


def _num(text):
    try:
        return Decimal(str(text).replace(",", "."))
    except Exception:
        return None


def guess_units(pack_size):
    """(واحد اصلی، واحد فرعی، چند واحد اصلی در یک واحد فرعی)"""
    raw = (pack_size or "").strip()
    if not raw:
        return "", "", None

    m = _PACK.search(raw)
    if m:
        n = _num(m.group(2))
        if n and n > 0:
            # موجودی به جعبه شمرده می‌شود؛ «عدد» راه دیگرِ وارد کردن است.
            return "جعبه", "عدد", (Decimal(1) / n).quantize(Decimal("0.000001"))

    m = _WEIGHT.match(raw)
    if m:
        n = _num(m.group(1))
        if n and n > 0:
            return "حلب", "کیلوگرم", (Decimal(1) / n).quantize(Decimal("0.000001"))

    m = _VOLUME.match(raw)
    if m:
        n = _num(m.group(1))
        if n and n > 0:
            return "حلب", "لیتر", (Decimal(1) / n).quantize(Decimal("0.000001"))

    m = _ML.match(raw)
    if m:
        n = _num(m.group(1))
        if n and n > 0:
            litres = n / Decimal(1000)
            return "قوطی", "لیتر", (Decimal(1) / litres).quantize(Decimal("0.000001"))

    if raw in ("عدد", "Pz", "pz"):
        return "عدد", "", None
    if raw in ("کارتن", "کیلوگرم", "متر", "لیتر", "بسته"):
        return raw, "", None

    # چیزی که مطمئن نیستیم: خود متن واحد اصلی می‌شود، فرعی خالی می‌ماند.
    return raw, "", None


def to_base(sku, qty, unit=""):
    """مقدار واردشده را به واحد اصلی کالا برمی‌گرداند.

    unit خالی یا برابر واحد اصلی → بدون تغییر.
    unit برابر واحد فرعی → ضرب در نرخ تبدیل.
    هر چیز دیگر → خطا، تا مقدار اشتباه وارد موجودی نشود.
    """
    value = Decimal(str(qty))
    unit = (unit or "").strip()
    if not unit or unit == (sku.base_unit or "").strip():
        return value
    if sku.alt_unit and unit == sku.alt_unit.strip():
        if not sku.alt_to_base:
            raise ValueError(f"نرخ تبدیل «{unit}» برای این کالا تعیین نشده است.")
        return (value * sku.alt_to_base).quantize(Decimal("0.001"))
    raise ValueError(f"واحد «{unit}» برای این کالا تعریف نشده است.")
