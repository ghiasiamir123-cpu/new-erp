"""برنامه‌ریزی تولید: کارِ باقیماندهٔ پروژه‌های باز، روزبه‌روز روی ایستگاه‌های کارگاه چیده می‌شود.

نرم‌افزار پیشنهاد می‌دهد و مسئول برنامه‌ریزی تصمیم می‌گیرد:

  · کار = یک مرحلهٔ یک پروژه. ایستگاهش همان است که آن مرحله را انجام می‌دهد (Station.stages)، مگر
    مسئول برای همان کار ایستگاه دیگری بگذارد (PlanTask.station).
  · سرعت = متر در یک روز کاریِ کامل. پیشنهاد سیستم از سابقه است: نفراتِ ایستگاه × ۸ ساعت × سهمِ وقتِ
    مفید ÷ ساعتِ لازم برای هر متر. مسئول می‌تواند «چند روز» بدهد؛ همان لحظه به متر در روز برمی‌گردد.
  · تقدم: هر مرحله فقط روی کاری می‌رود که مرحلهٔ قبلِ همان پروژه تا پایانِ روز قبل تمام کرده است.
  · ترتیب: اولویتی که مسئول چیده (Project.plan_priority)؛ بی آن، تاریخ تحویلِ نزدیک‌تر جلوتر است.
  · تقویم: جمعه تعطیل، پنجشنبه نیم‌روز. اضافه‌کاری (PlanOvertime) ساعتِ همان روز را زیاد می‌کند — روی
    جمعه یعنی آن جمعه کار می‌شود. مرخصی (PlanLeave) همان روز از توان کارگاه و ایستگاهِ خودِ آن نفر کم می‌کند.

برنامه هر بار از روی کارِ واقعاً ثبت‌شده از نو حساب می‌شود؛ پس روزی که کمتر از برنامه کار شود، باقیمانده
خودبه‌خود کارهای بعدی را عقب می‌برد. «ثبت برنامه» همین زمان‌بندی را نگه می‌دارد (PlanBaselineLine) تا
انحراف سنجیده شود: هر کار و هر پروژه چند روز از برنامهٔ ثبت‌شده عقب یا جلوست، و هر روزِ گذشته چقدر از
برنامه‌اش انجام شده.
"""
import datetime as dt
import math
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from . import production
from .models import (DailyReport, Employee, PlanBaselineLine, PlanCommit, PlanLeave, PlanOvertime, PlanTask,
                     Project, ReportItem, ReportProgress, Station, WorkStage)

DAY_HOURS = 8.0
THURSDAY_HOURS = 4.0
MAX_WORKING_DAYS = 250           # سقف شبیه‌سازی؛ برنامه‌ای دورتر از این دیگر برنامه نیست
DEFAULT_SHARE = 0.6
OPEN_STATES = ("running", "notstarted")
DUST = 0.05                      # متراژِ کمتر از این خطای گرد کردن است، نه کار
PAST_DAYS = 45                   # انحراف روزانه تا چند روز پیش نشان داده شود
NO_STATION = "0"                 # کارهایی که ایستگاه ندارند


def day_hours(day):
    """ساعت کاریِ عادیِ کارگاه در یک روز: جمعه تعطیل، پنجشنبه نیم‌روز."""
    wd = day.weekday()             # دوشنبه = ۰
    if wd == 4:
        return 0.0
    return THURSDAY_HOURS if wd == 3 else DAY_HOURS


def productive_share():
    """چه کسری از ساعتِ ثبت‌شده واقعاً روی مرحلهٔ متراژدارِ یک پروژه رفته است (از گزارش‌های تأییدشده)."""
    stages = set(WorkStage.objects.filter(needs_area=True).values_list("name", flat=True))
    qs = ReportItem.objects.filter(report__status=DailyReport.Status.APPROVED)
    total = production._f(qs.aggregate(s=Sum("hours"))["s"])
    if total < 80:                 # کمتر از دو هفتهٔ یک نفر؛ عددِ سابقه هنوز معنی ندارد
        return None
    good = production._f(qs.filter(project__general=False, project__isnull=False, activity__in=stages, rework=False)
                         .aggregate(s=Sum("hours"))["s"])
    return round(good / total, 3)


def _label(p):
    short = (p.short_name or p.name or "").strip()
    return f"{p.code} ({short})" if p.code else p.name


class _Calendar:
    """روزهای کاری، اضافه‌کاری و مرخصی."""

    def __init__(self, employees):
        self.employees = employees
        self.overtime = defaultdict(lambda: [0.0, 0.0])      # روز -> [ساعت، نفر-ساعت]
        self._ot_people = {}
        for o in PlanOvertime.objects.all():
            self.overtime[o.date][0] += float(o.hours)
            self._ot_people.setdefault(o.date, []).append((float(o.hours), o.people))
        self.leave = defaultdict(set)
        names = set(employees)
        for lv in PlanLeave.objects.all():
            if lv.employee not in names:
                continue
            d = lv.date_from
            while d <= lv.date_to:
                self.leave[d].add(lv.employee)
                d += dt.timedelta(days=1)

    def day(self, day):
        base = day_hours(day)
        extra = self.overtime[day][0] if day in self.overtime else 0.0
        away = self.leave.get(day, set())
        present = len(self.employees) - len(away)
        # نفر-روزِ در دسترس: حاضران در ساعت عادی، به‌اضافهٔ کسانی که اضافه‌کاری می‌مانند.
        pool = present * base / DAY_HOURS
        for hours, people in self._ot_people.get(day, []):
            pool += (min(people, present) if people else present) * hours / DAY_HOURS
        return {"base": base, "overtime": extra, "factor": (base + extra) / DAY_HOURS,
                "present": present, "leave": sorted(away), "pool": pool}


def _stations():
    out = []
    for s in Station.objects.all():
        people = [p for p in (s.people or []) if p]
        out.append({"id": str(s.pk), "name": s.name, "order": s.order, "active": s.active,
                    "stages": list(s.stages or []), "people": people,
                    "crew": len(people) or s.crew or 1})
    return out


def _tasks(rows, ctx):
    """کار باقیماندهٔ هر پروژه به ترتیب خط، با ایستگاه و سرعتِ هر کار."""
    rates, order, fallback, share = ctx["rates"], ctx["order"], ctx["fallback"], ctx["share"]
    by_stage = {}
    for st in ctx["stations"]:
        if st["active"]:
            for name in st["stages"]:
                by_stage.setdefault(name, st["id"])
    station = {st["id"]: st for st in ctx["stations"]}
    overrides = {(str(t.project_id), t.stage): t for t in PlanTask.objects.all()}
    targets = {s.name: float(s.daily_target or 0) for s in WorkStage.objects.all()}

    out, skipped = {}, []
    for r in rows:
        if r["state"] not in OPEN_STATES:
            continue
        line = sorted((s for s in r["stages"] if s["inPlan"] and s["planned"] > 0 and s["name"] in order),
                      key=lambda s: order[s["name"]])
        if not line:
            skipped.append(r["name"])
            continue
        tasks = []
        for s in line:
            rate = rates.get(s["name"]) or {}
            hpm = rate.get("hoursPerM2") or fallback
            ov = overrides.get((r["id"], s["name"]))
            sid = str(ov.station_id) if ov and ov.station_id and station.get(str(ov.station_id), {}).get("active") \
                else by_stage.get(s["name"], NO_STATION)
            crew = station[sid]["crew"] if sid in station else ctx["free_crew"]
            # پیشنهاد سیستم: نفراتِ ایستگاه در یک روز کامل، با همان سهمی از وقت که واقعاً صرف کار می‌شود.
            suggested = crew * DAY_HOURS * share / hpm if hpm else (targets.get(s["name"]) or None)
            manual = float(ov.daily_area) if ov and ov.daily_area else None
            reported = s["done"] + s.get("pending", 0.0)       # گزارشِ در انتظار تأیید هم کارِ انجام‌شده است
            tasks.append({
                "name": s["name"], "planned": s["planned"],
                "frac": 1.0 if s["closed"] or s["planned"] - reported < DUST else reported / s["planned"],
                "hpm": hpm, "measured": bool(rate.get("measured")),
                "station": sid, "stationFixed": bool(ov and ov.station_id), "crew": crew,
                "suggested": suggested, "daily": manual or suggested, "manual": manual is not None,
                "notBefore": ov.not_before if ov else None,
            })
        # تقدم: مرحله‌ای که بعدی‌اش جلوتر رفته، خودش دست‌کم تا همان‌جا انجام شده است.
        ahead = 0.0
        for t in reversed(tasks):
            ahead = max(ahead, t["frac"])
            t["frac"] = ahead
        out[r["id"]] = tasks
    return out, skipped


def _first_day(today):
    """برنامه از امروز شروع می‌شود، مگر گزارشِ امروز ثبت شده باشد — آن‌وقت کارِ امروز دیگر «انجام‌شده» است."""
    if DailyReport.objects.filter(date=today).exclude(status=DailyReport.Status.DRAFT).exists():
        return today + dt.timedelta(days=1)
    return today


def schedule(today=None):
    today = today or dt.date.today()
    rows = production.board()["results"]
    rates = production.stage_time_rates()
    order = {s.name: s.order for s in WorkStage.objects.filter(active=True, needs_area=True)}
    measured = [r["hoursPerM2"] for r in rates.values() if r.get("measured") and r.get("hoursPerM2")]
    employees = list(Employee.objects.filter(active=True).order_by("name").values_list("name", flat=True))
    auto_share = productive_share()
    ctx = {
        "rates": rates, "order": order, "stations": _stations(),
        "fallback": round(sum(measured) / len(measured), 4) if measured else 0.0,
        "share": auto_share or DEFAULT_SHARE,
        # کاری که ایستگاه ندارد: اگر هیچ ایستگاهی تعریف نشده، کلِ کارگاه یک ایستگاه است؛ وگرنه یک نفر.
        "free_crew": 1,
    }
    if not any(s["active"] for s in ctx["stations"]):
        ctx["free_crew"] = max(len(employees), 1)
    stations = {s["id"]: s for s in ctx["stations"]}
    cal = _Calendar(employees)

    tasks, skipped = _tasks(rows, ctx)
    meta = {str(p.pk): p for p in Project.objects.filter(pk__in=[int(k) for k in tasks])}
    far = dt.date.max

    def rank(pid):
        p = meta[pid]
        return (p.plan_priority is None, p.plan_priority or 0, p.due_date or far, p.start_date or far, p.name)

    queue = sorted(tasks, key=rank)

    warnings = []
    if not employees:
        warnings.append("کارگر فعالی تعریف نشده؛ توان کارگاه صفر است.")
    if not any(s["active"] for s in ctx["stations"]):
        warnings.append("هنوز ایستگاهی تعریف نشده؛ فعلاً کل کارگاه یک ایستگاه فرض شده است. در «ایستگاه‌ها و کارها» ایستگاه‌ها را بسازید.")
    else:
        orphan = sorted({t["name"] for ts in tasks.values() for t in ts if t["station"] == NO_STATION and t["frac"] < 1},
                        key=lambda n: order[n])
        if orphan:
            warnings.append("این مرحله‌ها به هیچ ایستگاهی داده نشده‌اند: " + "، ".join(orphan))
    guessed = sorted({t["name"] for ts in tasks.values() for t in ts
                      if not t["measured"] and not t["manual"] and t["frac"] < 1}, key=lambda n: order[n])
    if guessed:
        warnings.append("برای این مرحله‌ها سابقهٔ زمان نداریم؛ مدتِ پیشنهادی‌شان تخمینی است: " + "، ".join(guessed))
    stuck = sorted({t["name"] for ts in tasks.values() for t in ts if not t["daily"] and t["frac"] < 1},
                   key=lambda n: order[n])
    if stuck:
        warnings.append("مدتِ این مرحله‌ها قابل برآورد نیست؛ برایشان «چند روز» بدهید: " + "، ".join(stuck))
    if skipped:
        warnings.append("این پروژه‌ها مرحله و متراژ ندارند و در برنامه نیامده‌اند: " + "، ".join(skipped))

    # ---------- شبیه‌سازی روزبه‌روز ----------
    start_day = _first_day(today)
    days, first, last = [], {}, {}
    span = defaultdict(dict)                                  # pid -> stage -> [start, finish]
    cur = {pid: [t["frac"] for t in ts] for pid, ts in tasks.items()}
    rest = lambda pid, i: (1 - cur[pid][i]) * tasks[pid][i]["planned"]  # noqa: E731
    doable = lambda pid, i: tasks[pid][i]["daily"]  # noqa: E731
    left = lambda: any(rest(pid, i) >= DUST and doable(pid, i) for pid in cur for i in range(len(cur[pid])))  # noqa: E731
    day, worked = start_day, 0
    while left() and worked < MAX_WORKING_DAYS:
        info = cal.day(day)
        if info["factor"] <= 0:
            day += dt.timedelta(days=1)
            continue
        worked += 1
        pool = info["pool"]
        free = {sid: info["factor"] for sid in list(stations) + [NO_STATION]}
        start = {pid: list(fs) for pid, fs in cur.items()}    # مرحلهٔ بعد فقط کارِ تا دیروز را می‌بیند
        lines = []
        for pid in queue:
            for i, t in enumerate(tasks[pid]):
                sid = t["station"]
                if pool <= 0.001 or free[sid] <= 0.001 or not t["daily"]:
                    continue
                if t["notBefore"] and t["notBefore"] > day:
                    continue
                ready = ((start[pid][i - 1] if i else 1.0) - cur[pid][i]) * t["planned"]
                if ready < DUST:
                    continue
                # نفراتِ ثابتِ ایستگاه که مرخصی‌اند، همان روز از سرعتش کم می‌کنند.
                crew = t["crew"]
                st = stations.get(sid)
                if st and st["people"]:
                    crew = sum(1 for p in st["people"] if p not in info["leave"])
                    if not crew:
                        continue
                daily = t["daily"] * crew / t["crew"]
                area = min(ready, daily * free[sid], daily * pool / crew)
                if area < DUST:
                    continue
                used = area / daily
                free[sid] -= used
                pool -= crew * used
                cur[pid][i] = min(cur[pid][i] + area / t["planned"], 1.0)
                if rest(pid, i) < DUST:
                    cur[pid][i] = 1.0
                lines.append({"station": sid, "projectId": pid, "project": _label(meta[pid]), "stage": t["name"],
                              "area": round(area, 2), "people": crew, "share": round(used / info["factor"], 2)})
                first.setdefault(pid, day)
                span[pid].setdefault(t["name"], [day, day])[1] = day
                if all(rest(pid, j) < DUST or not doable(pid, j) for j in range(len(cur[pid]))):
                    last[pid] = day
        days.append({"date": day, "base": info["base"], "overtime": info["overtime"],
                     "present": info["present"], "leave": info["leave"],
                     "pool": round(info["pool"], 2), "used": round(info["pool"] - pool, 2), "lines": lines})
        day += dt.timedelta(days=1)
    unfinished = left()

    return {"today": today, "start": start_day, "ctx": ctx, "stations": ctx["stations"], "employees": employees,
            "tasks": tasks, "queue": queue, "meta": meta, "rows": {r["id"]: r for r in rows},
            "days": days, "first": first, "last": last, "span": span, "unfinished": unfinished,
            "warnings": warnings, "autoShare": auto_share, "calendar": cal}


def _baseline():
    """برنامهٔ ثبت‌شده: پایانِ هر کار و هر پروژه."""
    job, proj = {}, {}
    for pid, stage, d in PlanBaselineLine.objects.values_list("project_id", "stage", "date"):
        k = (str(pid), stage)
        if k not in job or d > job[k]:
            job[k] = d
        if str(pid) not in proj or d > proj[str(pid)]:
            proj[str(pid)] = d
    return job, proj


def _past(start, stations):
    """روزهای گذشتهٔ برنامهٔ ثبت‌شده در برابر کارِ واقعی، و آمارِ تحقق برنامه."""
    since = start - dt.timedelta(days=PAST_DAYS)
    lines = list(PlanBaselineLine.objects.filter(date__gte=since, date__lt=start).select_related("project"))
    if not lines:
        return [], None
    actual = {(d, pid, st): production._f(a) for d, pid, st, a in
              ReportProgress.objects.filter(report__date__gte=since, report__date__lt=start)
              .values_list("report__date", "project_id", "stage").annotate(a=Sum("area"))}
    planned = defaultdict(float)
    for ln in lines:
        planned[(ln.date, ln.project_id, ln.stage)] += float(ln.area)
    by_day = defaultdict(list)
    seen = set()
    for ln in lines:
        k = (ln.date, ln.project_id, ln.stage)
        # کارِ واقعی یک بار شمرده می‌شود، حتی اگر همان کار در دو خط برنامه آمده باشد.
        act = 0.0 if k in seen else actual.get(k, 0.0)
        seen.add(k)
        sid = str(ln.station_id) if ln.station_id else NO_STATION
        by_day[ln.date].append({"station": sid if sid in stations or sid == NO_STATION else NO_STATION,
                                "stationName": ln.station_name, "projectId": str(ln.project_id),
                                "project": _label(ln.project), "stage": ln.stage,
                                "planned": round(float(ln.area), 2), "actual": round(act, 2)})
    out, pcts = [], []
    for d in sorted(by_day):
        keys = {k for k in planned if k[0] == d}
        p = sum(planned[k] for k in keys)
        a = sum(actual.get(k, 0.0) for k in keys)
        met = sum(min(actual.get(k, 0.0), planned[k]) for k in keys)
        extra = sum(v for k, v in actual.items() if k[0] == d and k not in keys)
        pct = round(met / p * 100, 1) if p else None
        if pct is not None:
            pcts.append(pct)
        out.append({"date": d, "planned": round(p, 2), "actual": round(a, 2), "unplanned": round(extra, 2),
                    "percent": pct, "lines": by_day[d]})
    stats = None
    if pcts:
        avg = sum(pcts) / len(pcts)
        stats = {"days": len(pcts), "avgPercent": round(avg, 1),
                 "stdPercent": round(math.sqrt(sum((x - avg) ** 2 for x in pcts) / len(pcts)), 1),
                 "planned": round(sum(d["planned"] for d in out), 2), "actual": round(sum(d["actual"] for d in out), 2)}
    return out, stats


def plan(today=None):
    """همه‌چیزِ صفحهٔ برنامه‌ریزی تولید."""
    s = schedule(today)
    tasks, meta, stations = s["tasks"], s["meta"], {st["id"]: st for st in s["stations"]}
    base_job, base_proj = _baseline()

    def slip(now, base):
        return (now - base).days if now and base else None

    projects = []
    for n, pid in enumerate(s["queue"], 1):
        p = meta[pid]
        jobs, total_h, total_a = [], 0.0, 0.0
        for t in tasks[pid]:
            area = (1 - t["frac"]) * t["planned"]
            if area < DUST:
                area = 0.0
            hrs = area * (t["hpm"] or 0)
            total_h += hrs
            total_a += area
            sp = s["span"][pid].get(t["name"])
            base = base_job.get((pid, t["name"]))
            jobs.append({
                "stage": t["name"], "station": t["station"], "stationFixed": t["stationFixed"],
                "stationName": stations[t["station"]]["name"] if t["station"] in stations else "",
                "planned": round(t["planned"], 2), "remaining": round(area, 2), "hours": round(hrs, 1),
                "crew": t["crew"], "measured": t["measured"], "manual": t["manual"],
                "daily": round(t["daily"], 2) if t["daily"] else None,
                "suggestedDaily": round(t["suggested"], 2) if t["suggested"] else None,
                "days": round(area / t["daily"], 1) if t["daily"] and area else (0 if not area else None),
                "suggestedDays": round(area / t["suggested"], 1) if t["suggested"] and area else None,
                "notBefore": t["notBefore"],
                "start": sp[0] if sp else None, "finish": sp[1] if sp else None,
                "baselineFinish": base if area else None,
                "slipDays": slip(sp[1] if sp else None, base) if area else None,
            })
        finish = s["last"].get(pid)
        base = base_proj.get(pid)
        slack = (p.due_date - finish).days if p.due_date and finish else None
        projects.append({
            "id": pid, "name": p.name, "label": _label(p), "order": n, "pinned": p.plan_priority is not None,
            "dueDate": p.due_date, "state": s["rows"][pid]["state"],
            "remaining": round(total_a, 2), "hours": round(total_h, 1),
            "start": s["first"].get(pid), "finish": finish,
            "baselineFinish": base, "slipDays": slip(finish, base),
            "slackDays": slack, "onTime": None if slack is None else slack >= 0,
            "jobs": jobs,
        })

    past, stats = _past(s["start"], stations)
    commit = PlanCommit.objects.first()
    cal = s["calendar"]
    used_free = any(ln["station"] == NO_STATION for d in s["days"] for ln in d["lines"]) \
        or any(ln["station"] == NO_STATION for d in past for ln in d["lines"])
    slips = [p["slipDays"] for p in projects if p["slipDays"] is not None]
    today_info = cal.day(s["today"])
    return {
        "today": s["today"], "start": s["start"],
        "settings": {"crew": len(s["employees"]), "share": round(s["ctx"]["share"], 3), "autoShare": s["autoShare"],
                     "dayHours": DAY_HOURS, "thursdayHours": THURSDAY_HOURS,
                     "presentToday": today_info["present"], "leaveToday": today_info["leave"]},
        "stations": s["stations"], "freeStation": used_free,
        "stageNames": sorted(s["ctx"]["order"], key=s["ctx"]["order"].get),
        "employees": s["employees"],
        "projects": projects,
        "days": s["days"],
        "past": past,
        "deviation": stats,
        "baseline": {"at": commit.at, "by": commit.by_name, "note": commit.note} if commit else None,
        "overtime": [{"id": str(o.pk), "date": o.date, "hours": float(o.hours), "people": o.people, "note": o.note}
                     for o in PlanOvertime.objects.filter(date__gte=s["today"] - dt.timedelta(days=7))],
        "leaves": [{"id": str(lv.pk), "employee": lv.employee, "from": lv.date_from, "to": lv.date_to, "note": lv.note}
                   for lv in PlanLeave.objects.filter(date_to__gte=s["today"] - dt.timedelta(days=7))],
        "totals": {"hours": round(sum(p["hours"] for p in projects), 1),
                   "area": round(sum(p["remaining"] for p in projects), 2),
                   "workingDays": len(s["days"]),
                   "finish": s["days"][-1]["date"] if s["days"] and not s["unfinished"] else None,
                   "unfinished": s["unfinished"],
                   "late": sum(1 for p in projects if p["onTime"] is False),
                   "noDueDate": sum(1 for p in projects if not p["dueDate"]),
                   "slipMax": max(slips) if slips else None,
                   "behind": sum(1 for x in slips if x > 0)},
        "warnings": s["warnings"],
    }


# ---------- تصمیم‌های مسئول برنامه‌ریزی ----------

def _date(value, label):
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        raise ValidationError(f"{label} معتبر نیست.")


def set_order(ids):
    """ترتیب اولویت پروژه‌ها همان می‌شود که آمده؛ پروژه‌ای که در فهرست نیست ترتیب دستی‌اش را از دست می‌دهد."""
    ids = [int(i) for i in ids]
    Project.objects.exclude(pk__in=ids).exclude(plan_priority__isnull=True).update(plan_priority=None)
    for n, pk in enumerate(ids, 1):
        Project.objects.filter(pk=pk).update(plan_priority=n)


def set_task(data, user, today=None):
    """مدت، ایستگاه و زودترین شروعِ یک کار. days خالی یعنی «پیشنهاد سیستم»."""
    pk = str(data.get("project") or "")
    project = Project.objects.filter(pk=int(pk)).first() if pk.isdigit() else None
    stage = (data.get("stage") or "").strip()
    if project is None or not WorkStage.objects.filter(name=stage).exists():
        raise ValidationError("پروژه یا مرحله پیدا نشد.")
    task, _ = PlanTask.objects.get_or_create(project=project, stage=stage)

    if "days" in data:
        days = data.get("days")
        if days in (None, ""):
            task.daily_area = None
        else:
            try:
                days = float(days)
            except (TypeError, ValueError):
                raise ValidationError("تعداد روز عددی نیست.")
            if days <= 0:
                raise ValidationError("تعداد روز باید بزرگ‌تر از صفر باشد.")
            job = next((j for p in plan(today)["projects"] if p["id"] == str(project.pk)
                        for j in p["jobs"] if j["stage"] == stage), None)
            if job is None or not job["remaining"]:
                raise ValidationError("از این مرحله کاری نمانده که برایش روز تعیین شود.")
            task.daily_area = Decimal(str(round(job["remaining"] / days, 2)))
    if "station" in data:
        sid = data.get("station")
        if sid in (None, "", NO_STATION):
            task.station = None
        else:
            task.station = Station.objects.filter(pk=sid if str(sid).isdigit() else 0, active=True).first()
            if task.station is None:
                raise ValidationError("ایستگاه پیدا نشد.")
    if "notBefore" in data:
        task.not_before = _date(data["notBefore"], "تاریخ شروع") if data.get("notBefore") else None
    task.updated_by_name = user.name or user.username
    if not task.daily_area and not task.station_id and not task.not_before:
        task.delete()                                   # چیزی جز پیشنهاد سیستم نمانده
    else:
        task.save()


@transaction.atomic
def save_stations(rows):
    """فهرست ایستگاه‌ها همان می‌شود که آمده، به همان ترتیب. هر مرحله فقط در یک ایستگاه می‌ماند."""
    if not isinstance(rows, list):
        raise ValidationError("فهرست ایستگاه‌ها نامعتبر است.")
    stage_names = set(WorkStage.objects.values_list("name", flat=True))
    employees = set(Employee.objects.values_list("name", flat=True))
    ids = [int(r["id"]) for r in rows if str(r.get("id") or "").isdigit()]
    Station.objects.exclude(pk__in=ids).delete()         # برنامهٔ ثبت‌شده نامِ ایستگاه را خودش دارد
    names, taken = set(), {}
    for order, raw in enumerate(rows):
        name = (raw.get("name") or "").strip()
        if not name:
            raise ValidationError("نام یک ایستگاه خالی است.")
        if name in names:
            raise ValidationError(f"ایستگاه «{name}» دو بار آمده است.")
        names.add(name)
        stages = [s for s in (raw.get("stages") or []) if s in stage_names]
        for s in stages:
            if s in taken:
                raise ValidationError(f"مرحلهٔ «{s}» هم به «{taken[s]}» داده شده هم به «{name}»؛ هر مرحله یک ایستگاه دارد.")
            taken[s] = name
        people = [p for p in (raw.get("people") or []) if p in employees]
        try:
            crew = int(raw.get("crew") or 1)
        except (TypeError, ValueError):
            crew = 1
        if crew < 1 or crew > 50:
            raise ValidationError(f"تعداد نفرات «{name}» باید بین ۱ و ۵۰ باشد.")
        st = Station.objects.filter(pk=int(raw["id"])).first() if str(raw.get("id") or "").isdigit() else None
        st = st or Station()
        if Station.objects.filter(name=name).exclude(pk=st.pk).exists():
            raise ValidationError(f"ایستگاه دیگری با نام «{name}» هست؛ اول نام آن را عوض کنید.")
        st.name, st.order, st.active = name, order, raw.get("active", True) is not False
        st.stages, st.people, st.crew = stages, people, crew
        st.save()


def add_overtime(data, user):
    day = _date(data.get("date"), "تاریخ")
    try:
        hours = float(data.get("hours"))
    except (TypeError, ValueError):
        raise ValidationError("ساعت اضافه‌کاری را عددی وارد کنید.")
    if not 0 < hours <= 12:
        raise ValidationError("ساعت اضافه‌کاری باید بین ۰ و ۱۲ باشد.")
    people = data.get("people")
    if people in (None, ""):
        people = None
    else:
        try:
            people = int(people)
        except (TypeError, ValueError):
            raise ValidationError("تعداد نفرات عددی نیست.")
        if people < 1:
            raise ValidationError("تعداد نفرات باید دست‌کم ۱ باشد.")
    PlanOvertime.objects.create(date=day, hours=Decimal(str(hours)), people=people,
                                note=(data.get("note") or "").strip()[:200],
                                created_by_name=user.name or user.username)


def add_leave(data, user):
    name = (data.get("employee") or "").strip()
    if not Employee.objects.filter(name=name).exists():
        raise ValidationError("کارگر پیدا نشد.")
    start = _date(data.get("from"), "تاریخ شروع")
    end = _date(data.get("to") or data.get("from"), "تاریخ پایان")
    if end < start:
        raise ValidationError("تاریخ پایان پیش از شروع است.")
    if (end - start).days > 60:
        raise ValidationError("مرخصیِ بیش از دو ماه را جدا ثبت کنید.")
    PlanLeave.objects.create(employee=name, date_from=start, date_to=end,
                             note=(data.get("note") or "").strip()[:200],
                             created_by_name=user.name or user.username)


@transaction.atomic
def commit(user, note="", today=None):
    """زمان‌بندیِ همین لحظه «برنامهٔ ثبت‌شده» می‌شود. روزهای گذشتهٔ برنامهٔ قبلی دست نمی‌خورد."""
    s = schedule(today)
    names = {st["id"]: st["name"] for st in s["stations"]}
    PlanBaselineLine.objects.filter(date__gte=s["start"]).delete()
    PlanBaselineLine.objects.bulk_create([
        PlanBaselineLine(date=d["date"], station_id=int(ln["station"]) if ln["station"] in names else None,
                         station_name=names.get(ln["station"], ""), project_id=int(ln["projectId"]),
                         stage=ln["stage"], area=Decimal(str(ln["area"])), people=Decimal(str(ln["people"])))
        for d in s["days"] for ln in d["lines"]])
    PlanCommit.objects.create(by_name=user.name or user.username, note=(note or "").strip()[:300])
