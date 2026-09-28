"""مختصات از لینک نقشه — برای مسیریابی تا محل پروژه.

لینک‌های کامل گوگل‌مپ، نشان و بلد مختصات را در خودشان دارند و همین‌جا خوانده می‌شوند.
لینک کوتاه (maps.app.goo.gl، nshn.ir) باید یک بار باز شود تا به لینک کامل برسد؛ فقط همین
میزبان‌های شناخته‌شده باز می‌شوند، نه هر نشانی‌ای که کاربر بدهد.
"""
import re
import urllib.parse
import urllib.request

NUM = r"(-?\d{1,3}(?:\.\d+)?)"
PATTERNS = [
    re.compile(r"@" + NUM + r"," + NUM),                                  # google/neshan: /@35.7,51.4,17z
    re.compile(r"[?&](?:q|query|ll|destination|center)=" + NUM + r"(?:,|%2C)\s*" + NUM, re.I),
    re.compile(r"!3d" + NUM + r"!4d" + NUM),                              # google place data
    re.compile(r"latitude=" + NUM + r".*?longitude=" + NUM, re.I),         # balad
    re.compile(r"^geo:" + NUM + r"," + NUM, re.I),
    re.compile(r"^\s*" + NUM + r"\s*[,،]\s*" + NUM + r"\s*$"),             # «35.7, 51.4»
]
# «۳۵٫۷۲، ۵۱٫۳۳» هم پذیرفته می‌شود
FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٫", "01234567890123456789.")
SHORT_HOSTS = {"maps.app.goo.gl", "goo.gl", "nshn.ir", "balad.ir"}


def _valid(lat, lng):
    return -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0)


def coords_from_text(text):
    """(lat, lng) یا None — بی هیچ درخواست شبکه."""
    s = urllib.parse.unquote(text or "").strip().translate(FA_DIGITS)
    for rx in PATTERNS:
        m = rx.search(s)
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            if _valid(lat, lng):
                return round(lat, 6), round(lng, 6)
    return None


def resolve(url, timeout=5):
    """مختصات لینک؛ اگر لینک کوتاهِ شناخته‌شده بود، یک بار باز می‌شود. خطا یعنی None."""
    found = coords_from_text(url)
    if found:
        return found
    try:
        parts = urllib.parse.urlsplit((url or "").strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or parts.hostname not in SHORT_HOSTS:
        return None
    try:
        req = urllib.request.Request(url.strip(), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            final = r.geturl()
            found = coords_from_text(final)
            if not found:
                found = coords_from_text(r.read(200_000).decode("utf-8", "ignore"))
            return found
    except Exception:  # noqa: BLE001 — لینک در دسترس نبود؛ فقط خودِ لینک می‌ماند
        return None
