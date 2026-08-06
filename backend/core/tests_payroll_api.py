"""تست مسیرهای API حقوق و دستمزد و دسترسی نقش‌ها."""
import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api"
fails = []


def call(path, method="GET", body=None, token=None, expect=None):
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as res:
            code, payload = res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        code, payload = e.code, e.read().decode()
    parsed = json.loads(payload) if payload else None
    if expect is not None and code != expect:
        fails.append(f"{method} {path}: expected {expect}, got {code} — {payload[:200]}")
    return code, parsed


def check(label, cond, detail=""):
    print(("  OK   " if cond else "  FAIL ") + label + ("" if cond else f" {detail}"))
    if not cond:
        fails.append(f"{label} {detail}")


def login(u, p):
    _, d = call("/auth/login/", "POST", {"username": u, "password": p}, expect=200)
    return d["access"]


mgr = login("manager", "1234")
entry = login("sarparast", "testpass123")

print("=== دسترسی ===")
call("/payroll-settings/", token=entry, expect=403)
check("کاربر ثبت به تنظیمات حقوق دسترسی ندارد", True)
call("/payroll-staff/", token=entry, expect=403)
check("کاربر ثبت به لیست پرسنل حقوق دسترسی ندارد", True)
call("/payroll-months/", token=entry, expect=403)
check("کاربر ثبت به ماه‌های حقوق دسترسی ندارد", True)
call("/payroll-settings/", expect=401)
check("بدون ورود دسترسی نیست", True)

print("\n=== تنظیمات ===")
_, st = call("/payroll-settings/", token=mgr, expect=200)
check("تنظیمات خوانده شد", st["dailyHours"] == 7.33, st.get("dailyHours"))
check("۵ جزء حقوق", len(st["components"]) == 5, len(st["components"]))
check("۵ پلهٔ مالیات", len(st["brackets"]) == 5, len(st["brackets"]))
base = next(c for c in st["components"] if c["key"] == "base")
check("نرخ روزانهٔ پایه", base["dailyRate"] == 5541850, base["dailyRate"])
bon = next(c for c in st["components"] if c["key"] == "bon")
check("بن × ۳۰ = ۲۲ میلیون", round(bon["dailyRate"] * 30) == 22000000, round(bon["dailyRate"] * 30))

_, st2 = call("/payroll-settings/", "PUT", {"insRate": 7.5}, token=mgr, expect=200)
check("ویرایش نرخ بیمه", st2["insRate"] == 7.5, st2["insRate"])
call("/payroll-settings/", "PUT", {"insRate": 7}, token=mgr, expect=200)
call("/payroll-settings/", "PUT", {"components": []}, token=mgr, expect=400)
check("اجزای خالی رد شد", True)

print("\n=== پرسنل ===")
_, staff = call("/payroll-staff/", token=mgr, expect=200)
check("پرسنل موجود است", len(staff) >= 7, len(staff))
_, new = call("/payroll-staff/", "POST", {"name": "تست موقت", "dept": "آزمایش"}, token=mgr, expect=201)
sid = new["id"]
call("/payroll-staff/", "POST", {"name": "   "}, token=mgr, expect=400)
check("نام خالی رد شد", True)

print("\n=== باز کردن ماه ===")
_, m1 = call("/payroll-months/open/", "POST", {"label": "تست‌ماه ۱"}, token=mgr, expect=201)
mid1 = m1["id"]
check("ماه ساخته شد", m1["label"] == "تست‌ماه ۱")
check("برای همهٔ پرسنل فعال ردیف ساخت", len(m1["entries"]) == len(staff) + 1, len(m1["entries"]))
check("روز کارکرد پیش‌فرض ۳۰", all(e["workedDays"] == 30 for e in m1["entries"]))

# دوباره باز کردن همان ماه نباید ماه تکراری بسازد
_, again = call("/payroll-months/open/", "POST", {"label": "تست‌ماه ۱"}, token=mgr, expect=200)
check("ماه تکراری ساخته نشد", again["id"] == mid1)
call("/payroll-months/open/", "POST", {"label": "  "}, token=mgr, expect=400)
check("برچسب خالی رد شد", True)

print("\n=== ذخیرهٔ ارقام ===")
rows = []
for e in m1["entries"]:
    rows.append({"staff": e["staff"], "absentDays": 1, "workedDays": 29, "otHours": 5,
                 "shortHours": 2, "kpi": 10000000, "seniority": 7762020,
                 "transport": 5000000, "responsibility": 0, "insuranceManual": 0,
                 "advance": 3000000, "reserve": 0, "loan": 0})
_, saved = call(f"/payroll-months/{mid1}/", "PATCH", {"entries": rows}, token=mgr, expect=200)
check("ارقام ذخیره شد", all(e["workedDays"] == 29 for e in saved["entries"]))
check("سنوات ذخیره شد", all(e["seniority"] == 7762020 for e in saved["entries"]))
check("تعداد ردیف‌ها ثابت ماند", len(saved["entries"]) == len(rows), len(saved["entries"]))

# پرسنل تکراری در یک ماه ممنوع
dup = [rows[0], dict(rows[0])]
call(f"/payroll-months/{mid1}/", "PATCH", {"entries": dup}, token=mgr, expect=400)
check("پرسنل تکراری در یک ماه رد شد", True)
call(f"/payroll-months/{mid1}/", "PATCH",
     {"entries": [{"staff": "999999", "workedDays": 30}]}, token=mgr, expect=400)
check("پرسنل نامعتبر رد شد", True)

# ذخیرهٔ ناموفق نباید ارقام قبلی را پاک کند
_, after = call(f"/payroll-months/{mid1}/", token=mgr, expect=200)
check("ذخیرهٔ ناموفق داده را پاک نکرد", len(after["entries"]) == len(rows), len(after["entries"]))
check("ارقام پس از خطا سالم ماند",
      all(e["seniority"] == 7762020 for e in after["entries"]))

print("\n=== انتقال ارقام ثابت به ماه بعد ===")
_, m2 = call("/payroll-months/open/", "POST", {"label": "تست‌ماه ۲"}, token=mgr, expect=201)
e2 = m2["entries"][0]
check("سنوات از ماه قبل منتقل شد", e2["seniority"] == 7762020, e2["seniority"])
check("ایاب‌ذهاب از ماه قبل منتقل شد", e2["transport"] == 5000000, e2["transport"])
check("غیبت از صفر شروع شد", e2["absentDays"] == 0, e2["absentDays"])
check("اضافه‌کار از صفر شروع شد", e2["otHours"] == 0, e2["otHours"])
check("مساعده از صفر شروع شد", e2["advance"] == 0, e2["advance"])

print("\n=== مشخصات پرسنل روی ردیف ماه می‌نشیند ===")
call(f"/payroll-staff/{sid}/", "PATCH", {"married": True, "children": 2}, token=mgr, expect=200)
_, m3 = call("/payroll-months/open/", "POST", {"label": "تست‌ماه ۳"}, token=mgr, expect=201)
row = next(e for e in m3["entries"] if e["staff"] == sid)
check("تأهل از پرسنل آمد", row["married"] is True)
check("تعداد فرزند از پرسنل آمد", row["children"] == 2, row["children"])

print("\n=== پاک‌سازی ===")
for mid in (mid1, m2["id"], m3["id"]):
    call(f"/payroll-months/{mid}/", "DELETE", token=mgr, expect=204)
call(f"/payroll-staff/{sid}/", "DELETE", token=mgr, expect=204)
print("  حذف شد")

print("\n" + "=" * 40)
if fails:
    print(f"{len(fails)} مورد ناموفق:")
    for f in fails:
        print("  -", f)
    raise SystemExit(1)
print("همهٔ تست‌های API موفق بود ✓")
