"""نام یکتای هر برند.

یک برند نباید با دو نام در انبار باشد («پراتا» و «Pratta»): فهرست برندها، ارزش موجودی به تفکیک برند و
برگه‌های انبارگردانی دو تکه می‌شوند. نام درست همان انگلیسی است که اولِ نام مالی کالا می‌آید
(«Pratta - Stucco […]») — خواست کاربر، ۱۴۰۵/۰۷/۰۹. سایت فروش نام فارسی می‌دهد و فهرست مالی انگلیسی؛
هر جا برند از بیرون می‌آید (فایل سایت، فایل مالی، فرم تعریف کالا) از canonical() می‌گذرد.
"""

CANONICAL = {
    "بورما واکس": "Bormawachs", "bormawachs": "Bormawachs",
    "پراتا": "Pratta", "pratta": "Pratta",
    "رنر ایتالیا": "Renner", "رنر": "Renner", "renner": "Renner",
    "مارمورینو تولز": "Marmorino Tools", "marmorino tools": "Marmorino Tools", "marmorino": "Marmorino Tools",
    "میرکا": "Mirka", "mirka": "Mirka",
    "هوگون": "Hogun", "hogun": "Hogun", "hugon": "Hogun",
    "والرسا": "Valresa", "valresa": "Valresa",
    "pentrello": "Pentrilo", "pentrillo": "Pentrilo", "pentrilo": "Pentrilo",
    "klingspor": "Klingspor",
}


def canonical(brand):
    """نام یکتای برند؛ برندی که در فهرست نیست همان‌طور که نوشته شده می‌ماند."""
    b = " ".join((brand or "").split())
    return CANONICAL.get(b.lower(), b)
