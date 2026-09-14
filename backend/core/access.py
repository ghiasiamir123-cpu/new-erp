"""دسترسی سربرگ‌ها.

هر کاربر فهرستی از این کلیدها دارد و مدیر از صفحهٔ کاربران برایشان تیک
می‌زند. نقش فقط دو چیز را تعیین می‌کند: پیش‌فرضِ کاربر تازه، و اختیارهای
درون صفحه‌ها (مثل تأیید گزارش یا ثبت) — دیدنِ خود سربرگ با همین فهرست است.
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
    ("projects", "پروژه‌ها"),
    ("contract", "قرارداد"),
    ("payroll", "حقوق و دستمزد"),
    ("users", "کاربران"),
]
KEYS = [key for key, _ in TABS]

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


def defaults_for(role):
    return list(ROLE_DEFAULTS.get(role, []))


def clean_access(value):
    """فهرست کلیدها به ترتیب سربرگ‌ها و بی‌تکرار؛ کلید ناشناخته یا بی‌پدر خطاست."""
    if not isinstance(value, (list, tuple)):
        raise ValueError("فهرست دسترسی معتبر نیست.")
    unknown = [str(k) for k in value if k not in KEYS]
    if unknown:
        raise ValueError(f"دسترسی ناشناخته: {'، '.join(unknown)}")
    chosen = set(value)
    labels = dict(TABS)
    for child, parent in PARENT.items():
        if child in chosen and parent not in chosen:
            raise ValueError(f"«{labels[child]}» زیرِ «{labels[parent]}» است؛ اول دسترسی «{labels[parent]}» را بدهید.")
    return [k for k in KEYS if k in chosen]
