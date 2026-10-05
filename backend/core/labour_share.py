"""تسهیم حقوق به پروژه‌ها — برای سند حقوق و دستمزد.

اپراتور حقوق ماهانهٔ هر نیرو را وارد می‌کند (Employee.monthly_salary) و یک بازهٔ تاریخ می‌دهد. حقوقِ هر نفر
به نسبتِ ساعت‌هایی که در همان بازه روی هر پروژه کار کرده میانِ پروژه‌ها پخش می‌شود:

    سهم پروژه از حقوقِ یک نفر = حقوق × ساعتِ او روی آن پروژه ÷ کلِ ساعتِ او در بازه

  · فقط گزارش‌های کارِ تأییدشده شمرده می‌شوند؛ تأییدنشده‌ها جدا شمرده و اعلام می‌شوند.
  · «کارهای عمومی کارگاه» و هر پروژهٔ عمومیِ دیگر ستونِ خودش را دارد؛ ساعتی که پروژه ندارد «بدون پروژه» است.
  · مبلغِ واردشده کامل پخش می‌شود (به طولِ بازه کم و زیاد نمی‌شود)؛ برای سندِ یک ماه، بازه همان ماه است.
  · جمعِ سهم‌های هر نفر دقیقاً برابرِ حقوقِ اوست: خردهٔ گرد کردن روی بزرگ‌ترین سهمش می‌نشیند.
  · کسی که حقوق دارد ولی در بازه ساعتی ندارد «تسهیم‌نشده» می‌ماند؛ کسی که ساعت دارد و حقوق ندارد اعلام می‌شود.

چیزی جز خودِ حقوق ذخیره نمی‌شود؛ گزارش هر بار از گزارش‌های کار ساخته می‌شود.
"""
from collections import defaultdict

from .coating_profit import _employees, _label
from .models import DailyReport, Employee, Project, ReportItem
from .production import _f, norm_name

APPROVED = DailyReport.Status.APPROVED
NO_PROJECT = "none"


def _split(salary, hours):
    """حقوق را به نسبتِ ساعت‌ها پخش می‌کند، به ریال، با جمعِ دقیقاً برابرِ حقوق."""
    total = sum(hours.values())
    if not total or not salary:
        return {}
    out = {k: round(salary * h / total) for k, h in hours.items()}
    biggest = max(out, key=lambda k: (hours[k], str(k)))
    out[biggest] += round(salary) - sum(out.values())
    return out


def report(date_from, date_to):
    in_range = ReportItem.objects.filter(report__date__gte=date_from, report__date__lte=date_to)
    per = defaultdict(lambda: defaultdict(float))                 # نیرو -> ستون -> ساعت
    names, loose, worked = {}, {}, defaultdict(set)           # worked: نیرو -> روزهایی که ساعت دارد
    for it in in_range.filter(report__status=APPROVED).values("employee", "project_id", "project_name", "hours", "report__date"):
        h = _f(it["hours"])
        if not h:
            continue
        who = norm_name(it["employee"])
        names.setdefault(who, it["employee"].strip())
        worked[who].add(it["report__date"])
        if it["project_id"]:
            col = f"p{it['project_id']}"
        else:
            title = (it["project_name"] or "").strip()
            col = f"n:{title}" if title else NO_PROJECT
            loose[col] = title or "بدون پروژه"
        per[who][col] += h

    projects = Project.objects.in_bulk([int(c[1:]) for cols in per.values() for c in cols if c[0] == "p"])
    staff = _employees()
    keys = set(per) | {k for k, e in staff.items() if e.monthly_salary and e.active}

    workers, col_hours, col_amount = [], defaultdict(float), defaultdict(float)
    no_salary, no_hours = [], []
    for who in keys:
        e = staff.get(who)
        salary = _f(e.monthly_salary) if e and e.monthly_salary else 0.0
        hours = dict(per.get(who, {}))
        total = sum(hours.values())
        shares = _split(salary, hours)
        name = names.get(who) or (e.name if e else who)
        if total and not salary:
            no_salary.append(name)
        if salary and not total:
            no_hours.append(name)
        for col, h in hours.items():
            col_hours[col] += h
            col_amount[col] += shares.get(col, 0)
        workers.append({
            "key": who, "name": name, "employeeId": str(e.pk) if e else None,
            "salary": round(salary) if salary else None, "hours": round(total, 2), "days": len(worked.get(who, ())),
            "allocated": sum(shares.values()), "unallocated": round(salary) if salary and not total else 0,
            "cells": {col: {"hours": round(h, 2), "amount": shares.get(col, 0)} for col, h in hours.items()},
        })
    workers.sort(key=lambda w: (-(w["salary"] or 0), -w["hours"], w["name"]))

    allocated = sum(col_amount.values())
    columns = []
    for col in col_hours:
        p = projects.get(int(col[1:])) if col[0] == "p" else None
        columns.append({
            "key": col, "label": _label(p) if p else loose.get(col, "پروژهٔ حذف‌شده"),
            "general": bool(p.general) if p else True, "kind": "project" if p and not p.general else "general" if p else "loose",
            "hours": round(col_hours[col], 2), "amount": round(col_amount[col]),
            "percent": round(col_amount[col] / allocated * 100, 1) if allocated else None,
            "people": sum(1 for w in workers if col in w["cells"]),
        })
    order = {"project": 0, "general": 1, "loose": 2}
    columns.sort(key=lambda c: (order[c["kind"]], -c["amount"], -c["hours"], c["label"]))

    salary_total = sum(w["salary"] or 0 for w in workers)
    return {
        "from": date_from, "to": date_to,
        "columns": columns, "workers": workers,
        "totals": {"salary": salary_total, "allocated": allocated, "unallocated": salary_total - allocated,
                   "hours": round(sum(col_hours.values()), 2),
                   "projects": round(sum(c["amount"] for c in columns if c["kind"] == "project")),
                   "general": round(sum(c["amount"] for c in columns if c["kind"] != "project"))},
        "reportDays": in_range.filter(report__status=APPROVED).values("report__date").distinct().count(),
        "pendingReports": in_range.exclude(report__status=APPROVED).values("report").distinct().count(),
        "issues": {"noSalary": sorted(no_salary), "noHours": sorted(no_hours)},
    }


def set_salary(employee_id, name, salary):
    """حقوق ماهانهٔ یک نیرو؛ خالی یعنی پاک شود. نیرویی که فقط در گزارش‌ها آمده، غیرفعال ساخته می‌شود."""
    e = Employee.objects.filter(pk=employee_id).first() if employee_id else None
    if e is None:
        key = norm_name(name or "")
        if not key:
            return None
        e = _employees().get(key) or Employee.objects.create(name=name.strip(), active=False)
    e.monthly_salary = salary
    e.save(update_fields=["monthly_salary"])
    return e
