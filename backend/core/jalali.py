"""تبدیل تاریخ میلادی به شمسی.

سامانه همه‌جا تاریخ شمسی نشان می‌دهد، پس شمارهٔ حواله هم باید سال شمسی داشته
باشد؛ وگرنه «ورود-۲۰۲۶-۰۰۰۱» برای کاربر بی‌معناست.
همان الگوریتم jalaali که سمت فرانت هم استفاده می‌شود.
"""

_G_DAYS_IN_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]


def gregorian_to_jalali(gy, gm, gd):
    """(سال، ماه، روز) میلادی → (سال، ماه، روز) شمسی."""
    if gy > 1600:
        jy = 979
        gy -= 1600
    else:
        jy = 0
        gy -= 621

    gy2 = gy + 1 if gm > 2 else gy
    days = (
        365 * gy
        + (gy2 + 3) // 4
        - (gy2 + 99) // 100
        + (gy2 + 399) // 400
        - 80
        + gd
        + _G_DAYS_IN_MONTH[gm - 1]
    )

    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365

    if days < 186:
        jm = 1 + days // 31
        jd = 1 + days % 31
    else:
        jm = 7 + (days - 186) // 30
        jd = 1 + (days - 186) % 30
    return jy, jm, jd


def jalali_to_gregorian(jy, jm, jd):
    """(سال، ماه، روز) شمسی → (سال، ماه، روز) میلادی.

    برای وقتی تاریخ از بیرون شمسی می‌آید — مثل فایل فروش CRM — و باید در
    پایگاه داده میلادی بنشیند.
    """
    jy += 1595
    days = (-355668 + 365 * jy + (jy // 33) * 8 + ((jy % 33) + 3) // 4 + jd)
    days += (jm - 1) * 31 if jm < 7 else (jm - 7) * 30 + 186

    gy = 400 * (days // 146097)
    days %= 146097
    if days > 36524:
        days -= 1
        gy += 100 * (days // 36524)
        days %= 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        gy += (days - 1) // 365
        days = (days - 1) % 365

    gd = days + 1
    leap = (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0
    months = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 1
    for length in months:
        if gd <= length:
            break
        gd -= length
        gm += 1
    return gy, gm, gd


def parse_jalali(text):
    """«۱۴۰۵/۰۴/۲۸» یا «1405/4/28» → date میلادی. اگر نشد، None."""
    import datetime
    import re

    fa = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
    m = re.match(r"^\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s*$",
                 str(text or "").translate(fa))
    if not m:
        return None
    jy, jm, jd = (int(x) for x in m.groups())
    return datetime.date(*jalali_to_gregorian(jy, jm, jd))


def jalali_year(date):
    """سال شمسیِ یک تاریخ میلادی."""
    return gregorian_to_jalali(date.year, date.month, date.day)[0]
