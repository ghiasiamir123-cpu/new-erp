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


def jalali_year(date):
    """سال شمسیِ یک تاریخ میلادی."""
    return gregorian_to_jalali(date.year, date.month, date.day)[0]
