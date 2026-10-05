"""کد پروژه: CC{سال دورقمی}-{حرف نوع کار}{شماره} — مثلاً CC05-D1004.

قالب را کاربر ۱۴۰۵/۰۷/۰۶ انتخاب کرد و ۱۴۰۵/۰۷/۱۳ پیشوند و حرفش را عوض کرد:
  • CC پیشوند مرکز پوشش است (Coating Center)؛ پیش‌تر DW بود ولی هیچ پروژه‌ای با آن کد نگرفت؛
  • سال، سالِ شمسیِ تاریخ شروع پروژه است (۱۴۰۵ ← 05)؛
  • حرف، نوع کار است، تا از خودِ کد معلوم باشد چه چیزی رنگ شده:
        D درب و چهارچوب · K کابینت و کمد · F مبلمان · V روشویی · S پله و نرده ·
        W دیوارکوب، سقف و سطوح · T قرنیز و ابزار · G شیشه و فلز · X ترکیبی یا سایر
  • شماره در هر سال از ۱۰۰۱ شروع می‌شود و بین همهٔ نوع‌ها پشت‌سرهم است (D1012 و بعدش K1013).

کد فقط وقتی ساخته می‌شود که هم تاریخ شروع و هم نوع کار معلوم باشد. اگر بعداً نوع کار عوض شود، فقط حرف
عوض می‌شود و شماره می‌ماند — شناسهٔ پروژه همان شماره است. شمارهٔ فاکتورها از همین کد ساخته می‌شود
(core/invoices.py).
"""
import re

from .jalali import jalali_year
from .models import Project

PREFIX = "CC"
FIRST_NUMBER = 1001              # شمارهٔ اولین پروژهٔ هر سال (خواستِ کاربر: از ۱۰۰۱)
KIND_LETTER = {
    Project.WorkKind.DOOR: "D",
    Project.WorkKind.CABINET: "K",
    Project.WorkKind.FURNITURE: "F",
    Project.WorkKind.VANITY: "V",
    Project.WorkKind.STAIRS: "S",
    Project.WorkKind.SURFACE: "W",
    Project.WorkKind.TRIM: "T",
    Project.WorkKind.GLASS_METAL: "G",
    Project.WorkKind.MIXED: "X",
}
CODE_RX = re.compile(rf"^{PREFIX}(\d{{2}})-([A-Z])(\d{{3,}})$")


def year_part(jyear):
    return f"{int(jyear) % 100:02d}"


def next_code(jyear, work_kind, exclude_pk=None):
    """کد بعدیِ آن سال. شماره از بزرگ‌ترین کدِ همان سال است، نه از تعداد پروژه‌ها؛ پس کدهای
    دستی شمارش را به هم نمی‌ریزند و اگر آخرین پروژه حذف شود، شماره‌اش برمی‌گردد."""
    yy = year_part(jyear)
    used = []
    qs = Project.objects.filter(code__startswith=f"{PREFIX}{yy}-")
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    for code in qs.values_list("code", flat=True):
        m = CODE_RX.match(code or "")
        if m:
            used.append(int(m.group(3)))
    return f"{PREFIX}{yy}-{KIND_LETTER[work_kind]}{(max(used) + 1) if used else FIRST_NUMBER}"


def with_kind(code, work_kind):
    """حرفِ نوع کارِ یک کدِ استاندارد را عوض می‌کند؛ کد دستی (غیراستاندارد) همان می‌ماند."""
    m = CODE_RX.match(code or "")
    if not m or work_kind not in KIND_LETTER:
        return code
    return f"{PREFIX}{m.group(1)}-{KIND_LETTER[work_kind]}{m.group(3)}"


def code_for(code, start_date, work_kind, old_kind=None, exclude_pk=None):
    """کدی که باید ذخیره شود، با توجه به تاریخ شروع و نوع کار."""
    code = (code or "").strip()
    if not code:
        if start_date and work_kind in KIND_LETTER:
            return next_code(jalali_year(start_date), work_kind, exclude_pk)
        return ""
    if old_kind is not None and work_kind != old_kind:
        return with_kind(code, work_kind)
    return code
