"""کد پروژه: DW{سال دورقمی}-{حرف نوع}{شماره} — مثلاً DW05-R012.

استاندارد را کاربر ۱۴۰۵/۰۷/۰۶ انتخاب کرد:
  • DW پیشوند دیواژ است؛
  • سال، سالِ شمسیِ تاریخ شروع پروژه است (۱۴۰۵ ← 05)؛
  • حرف، نوع پروژه است: R مسکونی، O اداری، C تجاری، X سایر؛
  • شماره در هر سال از ۰۰۱ شروع می‌شود و بین همهٔ نوع‌ها پشت‌سرهم است (R012 و بعدش C013).

کد فقط وقتی ساخته می‌شود که هم تاریخ شروع و هم نوع پروژه معلوم باشد. اگر بعداً نوع
عوض شود، فقط حرف عوض می‌شود و شماره می‌ماند — شناسهٔ پروژه همان شماره است.
"""
import re

from .jalali import jalali_year
from .models import Project

TYPE_LETTER = {
    Project.ProjectType.RESIDENTIAL: "R",
    Project.ProjectType.OFFICE: "O",
    Project.ProjectType.COMMERCIAL: "C",
    Project.ProjectType.OTHER: "X",
}
CODE_RX = re.compile(r"^DW(\d{2})-([ROCX])(\d{3,})$")


def year_part(jyear):
    return f"{int(jyear) % 100:02d}"


def next_code(jyear, project_type, exclude_pk=None):
    """کد بعدیِ آن سال. شماره از بزرگ‌ترین کدِ همان سال است، نه از تعداد پروژه‌ها؛ پس کدهای
    دستی شمارش را به هم نمی‌ریزند و اگر آخرین پروژه حذف شود، شماره‌اش برمی‌گردد."""
    yy = year_part(jyear)
    used = []
    qs = Project.objects.filter(code__startswith=f"DW{yy}-")
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    for code in qs.values_list("code", flat=True):
        m = CODE_RX.match(code or "")
        if m:
            used.append(int(m.group(3)))
    return f"DW{yy}-{TYPE_LETTER[project_type]}{(max(used) + 1) if used else 1:03d}"


def with_type(code, project_type):
    """حرف نوعِ یک کدِ استاندارد را عوض می‌کند؛ کد دستی (غیراستاندارد) همان می‌ماند."""
    m = CODE_RX.match(code or "")
    if not m or project_type not in TYPE_LETTER:
        return code
    return f"DW{m.group(1)}-{TYPE_LETTER[project_type]}{m.group(3)}"


def code_for(code, start_date, project_type, old_type=None, exclude_pk=None):
    """کدی که باید ذخیره شود، با توجه به تاریخ شروع و نوع."""
    code = (code or "").strip()
    if not code:
        if start_date and project_type in TYPE_LETTER:
            return next_code(jalali_year(start_date), project_type, exclude_pk)
        return ""
    if old_type is not None and project_type != old_type:
        return with_type(code, project_type)
    return code
