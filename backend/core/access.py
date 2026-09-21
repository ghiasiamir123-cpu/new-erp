"""دسترسی سربرگ‌ها و کارهای درون هر سربرگ.

هر کاربر فهرستی از کلیدها دارد و مسئول کاربران برایشان تیک می‌زند:
  • کلید سربرگ («warehouse») یعنی آن سربرگ را می‌بیند؛
  • کلید کار («warehouse.post») یعنی آن کار را درون همان سربرگ می‌تواند بکند.
نقش فقط برچسب است و پیش‌فرضِ کاربر تازه؛ همهٔ اجازه‌ها از همین فهرست خوانده می‌شود.
"""

TABS = [
    ("entry", "ثبت گزارش"),
    ("reports", "گزارش‌ها"),
    ("materials", "مصرف مواد"),
    ("driver", "راننده"),
    ("dashboard", "داشبورد"),
    ("warehouse", "انبار"),
    ("consumables", "انبار › مواد مصرفی"),
    ("stockreview", "انبار › بازبینی"),
    ("finance", "کارتابل مالی"),
    ("financereports", "گزارش‌های مالی"),
    ("chat", "گفتگو"),
    ("production", "تولید"),
    ("production.stages", "ویرایش فهرست مراحل تولید"),
    ("maintenance", "کارتابل تعمیر و نگهداری"),
    ("projects", "پروژه‌ها"),
    ("contract", "قرارداد"),
    ("payroll", "حقوق و دستمزد"),
    ("users", "کاربران"),
]
TAB_KEYS = [key for key, _ in TABS]

# کار درون هر سربرگ — پیشوند کلید، سربرگش است و بی آن سربرگ معنا ندارد.
ACTIONS = [
    ("entry.create", "ثبت گزارش کار و افزودن کارگر"),
    ("reports.review", "تأیید و برگشت برای اصلاح"),
    ("reports.edit", "ویرایش گزارش دیگران"),
    ("reports.delete", "حذف گزارش"),
    ("materials.create", "ثبت مصرف و افزودن ماده"),
    ("materials.manage", "ویرایش و حذف مواد"),
    ("driver.create", "ثبت گزارش راننده و افزودن راننده"),
    ("driver.manage", "فعال/غیرفعال و حذف راننده‌ها"),
    ("dashboard.cost", "گزارش هزینهٔ پروژه‌ها"),
    ("dashboard.backup", "خروجی اکسل کامل (بک‌اپ)"),
    ("dashboard.staff", "فعال/غیرفعال و حذف کارگرها"),
    ("warehouse.voucher", "ساخت، ویرایش و حذف حوالهٔ پیش‌نویس"),
    ("warehouse.post", "ثبت نهایی حواله"),
    ("warehouse.cost", "دیدن قیمت خرید"),
    ("warehouse.setup", "تعریف انبار و محل، بارگذاری فایل"),
    ("warehouse.assets", "ثبت و ویرایش اموال، تعمیر و بازرسی"),
    ("consumables.edit", "تأیید و ادغام مواد"),
    ("stockreview.edit", "تیک زدن و اتصال به سایت"),
    ("finance.approve", "قیمت‌گذاری، تأیید و برگشت به انبار"),
    ("financereports.refresh", "به‌روزرسانی قیمت از سایت"),
    ("maintenance.work", "ثبت سرویس و تعمیر، بستن اخطار"),
    ("projects.create", "تعریف پروژه و ویرایش مراحل"),
    ("projects.manage", "فعال/غیرفعال و حذف پروژه"),
]
ACTION_LABELS = dict(ACTIONS)

# ترتیب ذخیره: هر سربرگ و پشتش کارهایش.
KEYS = [k for tab in TAB_KEYS for k in [tab] + [a for a, _ in ACTIONS if a.split(".")[0] == tab]]

# سربرگی که زیرِ سربرگ دیگری است و بی آن دیده نمی‌شود.
PARENT = {"consumables": "warehouse", "stockreview": "warehouse"}

# کاربر تازه همان را می‌بیند که نقشش پیش از دسترسیِ سربرگی می‌دید. انبار، مواد
# مصرفی و کارتابل مالی هیچ‌وقت خودکار داده نمی‌شوند.
ROLE_DEFAULTS = {
    "manager": ["entry", "reports", "materials", "driver", "dashboard",
                "projects", "contract", "payroll", "users"],
    "data_entry": ["entry", "reports", "materials", "driver", "dashboard",
                   "projects", "contract"],
    "viewer": ["reports", "materials", "driver", "dashboard"],
    "driver": ["driver"],
    "accountant": ["dashboard", "payroll"],
}

# کارهایی که هر نقش پیش از دسترسی ریز داشت (مهاجرت 0036 همین را به کاربران موجود داد).
ROLE_ACTIONS = {
    "manager": [a for a, _ in ACTIONS],
    "data_entry": ["entry.create", "materials.create", "driver.create", "dashboard.cost", "projects.create"],
    "viewer": [],
    "driver": ["driver.create"],
    "accountant": ["dashboard.cost", "dashboard.backup", "warehouse.cost"],
}
# این کارها پیش‌تر با خودِ سربرگ داده می‌شد، برای هر نقشی.
TAB_WIDE_ACTIONS = ["warehouse.voucher", "warehouse.post", "warehouse.assets", "consumables.edit",
                    "stockreview.edit", "finance.approve", "financereports.refresh", "maintenance.work"]


def parent_of(key):
    return key.split(".", 1)[0] if "." in key else PARENT.get(key)


def label_of(key):
    tabs = dict(TABS)
    if "." in key:
        return f"{tabs.get(parent_of(key), parent_of(key))} › {ACTION_LABELS.get(key, key)}"
    return tabs.get(key, key)


def actions_for(role, tabs):
    """کارهای پیش‌فرضِ نقش، فقط برای سربرگ‌هایی که کاربر دارد."""
    tabs = set(tabs)
    wanted = set(ROLE_ACTIONS.get(role, [])) | set(TAB_WIDE_ACTIONS)
    return [a for a, _ in ACTIONS if a in wanted and a.split(".")[0] in tabs]


def defaults_for(role):
    tabs = list(ROLE_DEFAULTS.get(role, []))
    return clean_access(tabs + actions_for(role, tabs))


def clean_access(value):
    """فهرست کلیدها به ترتیب KEYS و بی‌تکرار؛ کلید ناشناخته، یا کاری/زیرسربرگی بی سربرگش، خطاست."""
    if not isinstance(value, (list, tuple)):
        raise ValueError("فهرست دسترسی معتبر نیست.")
    unknown = [str(k) for k in value if k not in KEYS]
    if unknown:
        raise ValueError(f"دسترسی ناشناخته: {'، '.join(unknown)}")
    chosen = set(value)
    for key in KEYS:
        parent = parent_of(key)
        if key in chosen and parent and parent not in chosen:
            if "." in key:
                raise ValueError(f"«{ACTION_LABELS[key]}» درون «{label_of(parent)}» است؛ "
                                 f"اول دسترسی «{label_of(parent)}» را بدهید.")
            raise ValueError(f"«{label_of(key)}» زیرِ «{label_of(parent)}» است؛ "
                             f"اول دسترسی «{label_of(parent)}» را بدهید.")
    return [k for k in KEYS if k in chosen]
