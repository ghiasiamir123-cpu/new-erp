"""برنامه‌ریزی تولید: کارِ باقیماندهٔ پروژه‌های باز، روزبه‌روز روی ایستگاه‌های کارگاه چیده می‌شود.

نرم‌افزار پیشنهاد می‌دهد و مسئول برنامه‌ریزی تصمیم می‌گیرد:

  · کار = یک مرحلهٔ یک پروژه. هر مرحله خودش یک ایستگاه است — همان مراحلی که برای هر پروژه از اول تعریف
    می‌شود — مگر چند مرحله در یک ایستگاهِ تعریف‌شده جمع شده باشند (Station.stages) یا مسئول برای همان کار
    ایستگاه دیگری گذاشته باشد (PlanTask.station). ایستگاه‌ها هم‌زمان و هر کدام روی پروژهٔ خودشان کار می‌کنند؛
    قرار نیست یک پروژه تمام شود تا بعدی شروع شود.
  · با هم بردن: کارهای هم‌مرحلهٔ چند پروژه را می‌شود «با هم» کرد (PlanTask.batch)؛ آن‌وقت هیچ‌کدام شروع
    نمی‌شود تا مرحلهٔ قبلِ همه‌شان تمام شود — دو پروژه زیرکار می‌شوند و با هم به اتاق رنگ می‌روند.
  · سرعت = متر در یک روز کاریِ کامل. پیشنهاد سیستم از سابقه است: نفراتِ ایستگاه × ۸ ساعت × سهمِ وقتِ
    مفید ÷ ساعتِ لازم برای هر متر. مسئول می‌تواند «چند روز» بدهد؛ همان لحظه به متر در روز برمی‌گردد.
  · تقدم: هر مرحله فقط روی کاری می‌رود که مرحلهٔ قبلِ همان پروژه تا پایانِ روز قبل تمام کرده است.
  · ترتیب: اولویتی که مسئول چیده (Project.plan_priority)؛ بی آن، تاریخ تحویلِ نزدیک‌تر جلوتر است. ولی کارِ عقب‌افتاده
    (برنامهٔ ثبت‌شده‌اش از پیش از امروز شروع شده بود) و کارِ نیمه‌کاره اول تمام می‌شوند، بعد کارِ تازه؛ کارهای بعدی
    همان‌قدر عقب می‌روند.
  · جای دستی: کاری که مسئول روی نمودار جابه‌جا کرده (PlanTask.not_before) از همان روز شروع می‌شود و ظرفیتِ
    ایستگاه و نفرات جلویش را نمی‌گیرد — همان‌جا می‌ماند که گذاشته شده؛ فقط تقدمِ مراحل می‌تواند عقبش ببرد.
    اگر با این کار نفرِ بیشتری از حاضران لازم شود، همان روز «بیش از توان» علامت می‌خورد تا مسئول ببیند.
  · حرفِ مسئول جلوتر از تقدم است: کاری که زودتر از مرحلهٔ قبلش گذاشته شود سر جایش می‌نشیند و مرحله‌های قبل
    خودشان آن‌قدر زودتر می‌آیند که کار به آن برسد (_make_room). کاری که دیرتر برود، مرحله‌های بعدش را خودِ
    زمان‌بندی دیرتر می‌برد.
  · خشک شدن: بعضی مرحله‌ها (آستر، رنگ) بعد از کار چند ساعت انتظار می‌خواهند (WorkStage.wait_hours). این زمان
    نفر نمی‌گیرد و شبانه‌روزی می‌گذرد — شب و جمعه هم. مرحلهٔ بعد فقط روی متری می‌رود که هم تمام شده هم خشک.
  · هر صبح (daily، با زمان‌بندِ سرور): شنبه‌ها برنامهٔ همان لحظه خودکار «ثبت» می‌شود؛ روزهای دیگر فقط برنامهٔ
    همان روز تازه می‌شود، تا کارِ هر روز با برنامه‌ای سنجیده شود که صبحِ همان روز بود. صفِ جلوی هر ایستگاه هم
    هر صبح نگه داشته می‌شود (PlanQueueSnapshot).
  · نفراتِ هر کار: مسئول می‌تواند برای یک کار نفرِ بیشتر یا کمتری از نفراتِ ایستگاه بگذارد (PlanTask.crew)؛ کار
    همان نفر-ساعت است، پس با نفرِ بیشتر در روزهای کمتری تمام می‌شود.
  · توقف (ProjectPause): پروژهٔ متوقف چیده نمی‌شود؛ روزهای توقف در انحراف از برنامه تقصیرِ کارگاه نیست و عقب‌افتادگی
    دو تکه گزارش می‌شود (از خودِ کارگاه / به‌خاطر توقف)؛ پس از ادامه، کارهایش با اولویتِ خودشان چیده می‌شوند نه «عقب‌افتاده».
  · تقویم: جمعه و تعطیلات رسمی (PlanHoliday) تعطیل، پنجشنبه نیم‌روز. اضافه‌کاری (PlanOvertime) ساعتِ همان روز را زیاد می‌کند — روی
    جمعه یعنی آن جمعه کار می‌شود. مرخصی و کارِ عمومیِ کارگاه (PlanLeave، کلِ روز یا چند ساعت) همان ساعت‌ها را از توان کارگاه و ایستگاهِ خودِ آن نفر
    کم می‌کنند. هیچ کاری — دستی یا نه — نفرِ بیشتری از کسانی که آن روز آزادند نمی‌گیرد.

فقط گزارشِ تأییدشده کارِ انجام‌شده است: پیش‌نویس، «در انتظار تأیید» و «نیاز به اصلاح» هنوز ممکن است عوض شوند.

برنامه هر بار از روی کارِ واقعاً ثبت‌شده از نو حساب می‌شود؛ پس روزی که کمتر از برنامه کار شود، باقیمانده
خودبه‌خود کارهای بعدی را عقب می‌برد. «ثبت برنامه» همین زمان‌بندی را نگه می‌دارد (PlanBaselineLine) تا
انحراف سنجیده شود: هر کار و هر پروژه چند روز از برنامهٔ ثبت‌شده عقب یا جلوست، و هر روزِ گذشته چقدر از
برنامه‌اش انجام شده.
"""
import datetime as dt
import math
from collections import defaultdict
from decimal import ROUND_UP, Decimal

from django.db import transaction
from django.db.models import Max, Min, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import production
from .models import (DailyReport, Employee, PlanBaselineLine, PlanCommit, PlanHoliday, PlanLeave, PlanOvertime,
                     PlanQueueSnapshot, PlanTask, Project, ProjectPause, ReportItem, ReportProgress, Station,
                     WorkStage)

DAY_HOURS = 8.0
THURSDAY_HOURS = 4.0
MAX_WORKING_DAYS = 250           # سقف شبیه‌سازی؛ برنامه‌ای دورتر از این دیگر برنامه نیست
DEFAULT_SHARE = 0.6
OPEN_STATES = ("running", "notstarted")
DUST = 0.05                      # متراژِ کمتر از این خطای گرد کردن است، نه کار
PAST_DAYS = 45                   # انحراف روزانه تا چند روز پیش نشان داده شود
STAGE_ID = "s:"                  # شناسهٔ ایستگاهی که خودِ یک مرحله است: «s:رنگ رویه»
OVERNIGHT_HOURS = 15             # از پایانِ کارِ یک روز تا شروعِ کارِ فردا؛ انتظارِ کوتاه‌تر از این خودبه‌خود گذشته است
LOAD_DAYS = 12                   # بارِ هر ایستگاه در چند روزِ کاریِ پیشِ رو سنجیده شود (دو هفته)
QUEUE_DAYS = 28                  # روندِ صفِ ایستگاه‌ها تا چند روز پیش نشان داده شود
AUTO_NAME = "ثبت خودکار"


def dry_days(hours):
    """انتظارِ پس از یک مرحله چند روزِ تقویمیِ اضافه می‌شود. کاری که امروز تمام شود بی انتظار فردا صبح آماده
    است (شب خودش ۱۵ ساعت است)؛ هر ۲۴ ساعتِ بیشتر، یک روزِ تقویمیِ دیگر."""
    hours = float(hours or 0)
    return max(0, math.ceil((hours - OVERNIGHT_HOURS) / 24)) if hours > OVERNIGHT_HOURS else 0


# سه عددی که از سابقهٔ گزارش‌ها درمی‌آیند (ساعت بر متر، سهم وقت مفید، نفراتِ هر مرحله) با هر کلیک عوض نمی‌شوند؛
# یک دقیقه نگه داشته می‌شوند تا هر جابه‌جاییِ نوار در گانت دوباره همهٔ گزارش‌ها را نخواند.
_HISTORY_TTL = 60
_history = {}


def _cached(key, fn):
    import time
    hit = _history.get(key)
    if hit and time.monotonic() - hit[0] < _HISTORY_TTL:
        return hit[1]
    value = fn()
    _history[key] = (time.monotonic(), value)
    return value


def clear_cache():
    _history.clear()


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


def _label_row(r):
    """برچسبِ پروژه از ردیفِ board."""
    return f"{r['code']} ({r['name']})" if r.get("code") else r["name"]


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
            # چند ردیف اضافه‌کاریِ یک روز یعنی چند گروه که کنار هم می‌مانند: ساعتِ کارگاه بلندترینشان است،
            # نه جمعشان؛ نفر-ساعت (pool) جمعِ همه است.
            self.overtime[o.date][0] = max(self.overtime[o.date][0], float(o.hours))
            self._ot_people.setdefault(o.date, []).append((float(o.hours), o.people))
        self.holidays = {h.date: h.title for h in PlanHoliday.objects.all()}
        # روز -> نام -> [ساعت یا None (کلِ روز)، نوع]. دو ردیفِ یک نفر در یک روز جمع می‌شوند.
        self.away = defaultdict(dict)
        names = set(employees)
        for lv in PlanLeave.objects.all():
            if lv.employee not in names:
                continue
            d = lv.date_from
            while d <= lv.date_to:
                h = float(lv.hours) if lv.hours else None
                was = self.away[d].get(lv.employee)
                if was is None:
                    self.away[d][lv.employee] = [h, lv.kind]
                elif was[0] is not None:
                    was[0] = None if h is None else was[0] + h
                d += dt.timedelta(days=1)

    def day(self, day):
        base = 0.0 if day in self.holidays else day_hours(day)
        extra = self.overtime[day][0] if day in self.overtime else 0.0
        rows = self.away.get(day, {})
        # مرخصیِ کلِ روز یعنی نیست؛ کسی که کلِ روز کارِ عمومی دارد در کارگاه حاضر است ولی وقتش به پروژه‌ها نمی‌رسد.
        gone = {n for n, (h, k) in rows.items() if h is None and k == PlanLeave.Kind.LEAVE}
        present = len(self.employees) - len(gone)
        # چند ساعت از وقتِ عادیِ حاضران به مرخصیِ ساعتی یا کارِ عمومی می‌رود
        lost = sum(base if h is None else min(h, base) for n, (h, _) in rows.items() if n not in gone)
        # نفر-روزِ در دسترس: حاضران در ساعت عادی منهای ساعت‌های رفته، به‌اضافهٔ کسانی که اضافه‌کاری می‌مانند.
        pool = max(present * base - lost, 0.0) / DAY_HOURS
        for hours, people in self._ot_people.get(day, []):
            pool += (min(people, present) if people else present) * hours / DAY_HOURS
        # سهمِ هر کس از روز (۱ = همهٔ روز): برای نفراتِ ثابتِ ایستگاه
        share = {n: (0.0 if h is None else max(base - h, 0.0) / base if base else 0.0) for n, (h, _) in rows.items()}
        return {"base": base, "overtime": extra, "factor": (base + extra) / DAY_HOURS,
                "present": present, "pool": pool, "share": share,
                "leave": sorted(n for n, (h, k) in rows.items() if h is None and k == PlanLeave.Kind.LEAVE),
                "away": sorted(({"name": n, "hours": h, "kind": k} for n, (h, k) in rows.items()),
                               key=lambda x: (x["kind"], x["name"]))}


def stage_crews():
    """چند نفر معمولاً هم‌زمان روی هر مرحله کار می‌کنند — از گزارش‌های تأییدشده."""
    per = defaultdict(lambda: defaultdict(set))
    for day, stage, who in (ReportItem.objects
                            .filter(report__status=DailyReport.Status.APPROVED, hours__gt=0, project__general=False)
                            .values_list("report__date", "activity", "employee")):
        per[stage][day].add(who)
    return {stage: max(1, round(sum(len(v) for v in days.values()) / len(days))) for stage, days in per.items()}


def _stations(order):
    """ایستگاه‌های کارگاه به ترتیب خط. مرحله‌ای که در هیچ ایستگاهِ تعریف‌شده‌ای نیست، خودش یک ایستگاه است،
    با همان تعداد نفری که سابقه نشان می‌دهد معمولاً رویش کار می‌کنند."""
    out, covered = [], set()
    for s in Station.objects.all():
        people = [p for p in (s.people or []) if p]
        out.append({"id": str(s.pk), "name": s.name, "order": s.order, "active": s.active,
                    "stages": list(s.stages or []), "people": people,
                    "crew": len(people) or s.crew or 1, "implicit": False})
        if s.active:
            covered.update(s.stages or [])
    crews = _cached("crews", stage_crews)
    for name in order:
        if name not in covered:
            out.append({"id": STAGE_ID + name, "name": name, "order": 0, "active": True, "stages": [name],
                        "people": [], "crew": crews.get(name, 1), "implicit": True})
    out.sort(key=lambda st: (min((order[x] for x in st["stages"] if x in order), default=10 ** 6), st["order"]))
    return out


def _by_stage(stations):
    out = {}
    for st in stations:
        if st["active"]:
            for name in st["stages"]:
                out.setdefault(name, st["id"])
    return out


def _stage_order():
    """ترتیبِ مراحلِ متراژدار. مرحلهٔ غیرفعال هم می‌آید: کارِ ماندهٔ پروژه‌ها با غیرفعال شدنِ مرحله تمام نمی‌شود."""
    return {s.name: s.order for s in WorkStage.objects.filter(needs_area=True)}


def _tasks(rows, ctx):
    """کار باقیماندهٔ هر پروژه به ترتیب خط، با ایستگاه و سرعتِ هر کار."""
    rates, order, fallback, share, waits = ctx["rates"], ctx["order"], ctx["fallback"], ctx["share"], ctx["waits"]
    by_stage = _by_stage(ctx["stations"])
    station = {st["id"]: st for st in ctx["stations"]}
    overrides = {(str(t.project_id), t.stage): t for t in PlanTask.objects.all()}
    targets = {s.name: float(s.daily_target or 0) for s in WorkStage.objects.all()}

    out, skipped, off = {}, [], []
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
            fixed = bool(ov and ov.station_id and station.get(str(ov.station_id), {}).get("active"))
            if ov and ov.station_id and not fixed:
                gone = station.get(str(ov.station_id), {}).get("name", "")
                off.append(f"{_label_row(r)} · {s['name']}" + (f" (ایستگاه «{gone}»)" if gone else ""))
            sid = str(ov.station_id) if fixed else by_stage[s["name"]]
            own = ov.crew if ov and ov.crew else None             # نفراتی که مسئول برای همین کار گذاشته
            crew = own or station[sid]["crew"]
            # پیشنهاد سیستم: نفراتِ ایستگاه در یک روز کامل، با همان سهمی از وقت که واقعاً صرف کار می‌شود.
            suggested = crew * DAY_HOURS * share / hpm if hpm else (targets.get(s["name"]) or None)
            manual = float(ov.daily_area) if ov and ov.daily_area else None
            reported = s["done"]                               # فقط گزارشِ تأییدشده
            tasks.append({
                "name": s["name"], "planned": s["planned"],
                "frac": 1.0 if s["closed"] or s["planned"] - reported < DUST else reported / s["planned"],
                "hpm": hpm, "measured": bool(rate.get("measured")),
                "station": sid, "stationFixed": fixed, "crew": crew, "crewOwn": own is not None,
                "stationCrew": station[sid]["crew"],
                "suggested": suggested, "daily": manual or suggested, "manual": manual is not None,
                "notBefore": ov.not_before if ov else None, "batch": ov.batch if ov else None,
                "placed": bool(ov and ov.not_before),
                "waitHours": waits.get(s["name"], 0), "dry": dry_days(waits.get(s["name"], 0)),
            })
        # تقدم: مرحله‌ای که بعدی‌اش جلوتر رفته، خودش دست‌کم تا همان‌جا انجام شده است.
        ahead = 0.0
        for t in reversed(tasks):
            ahead = max(ahead, t["frac"])
            t["frac"] = ahead
        out[r["id"]] = tasks
    ctx["offStation"] = off
    return out, skipped


def _today_used(today, cal):
    """چه کسری از توانِ امروز را گزارش‌های تأییدشدهٔ امروز پر کرده‌اند (۰ تا ۱).

    یک شیفت که گزارش شده، بقیهٔ روز هنوز جای کار دارد. گزارشی که ساعت ندارد (فقط متراژ) کلِ روز حساب می‌شود."""
    reports = DailyReport.objects.filter(date=today, status=DailyReport.Status.APPROVED)
    if not reports.exists():
        return 0.0
    hours = production._f(ReportItem.objects.filter(report__in=reports).aggregate(s=Sum("hours"))["s"])
    info = cal.day(today)
    room = info["present"] * (info["base"] + info["overtime"])
    if not hours or not room:
        return 1.0
    return min(hours / room, 1.0)


def _first_day(today, cal=None):
    """برنامه از امروز شروع می‌شود، مگر گزارش‌های تأییدشدهٔ امروز همهٔ توانِ امروز را پر کرده باشند."""
    cal = cal or _Calendar(list(Employee.objects.filter(active=True).values_list("name", flat=True)))
    return today + dt.timedelta(days=1) if _today_used(today, cal) >= 0.95 else today


def _pauses():
    """{شناسهٔ پروژه: [(شروع، روزِ ادامه یا None)]}"""
    out = defaultdict(list)
    for pid, a, b in ProjectPause.objects.values_list("project_id", "start", "end"):
        out[str(pid)].append((a, b))
    return out


def _paused_on(pauses, pid, day):
    return any(a <= day and (b is None or day < b) for a, b in pauses.get(pid, ()))


def _pause_days(pauses, pid, since, until):
    """چند روزِ تقویمی از [since، until) پروژه متوقف بوده است."""
    if not since:
        return 0
    n = 0
    for a, b in pauses.get(pid, ()):
        lo, hi = max(a, since), min(b or until, until)
        n += max((hi - lo).days, 0)
    return n


def schedule(today=None):
    today = today or dt.date.today()
    rows = production.board()["results"]
    rates = _cached("rates", production.stage_time_rates)
    order = _stage_order()
    measured = [r["hoursPerM2"] for r in rates.values() if r.get("measured") and r.get("hoursPerM2")]
    employees = list(Employee.objects.filter(active=True).order_by("name").values_list("name", flat=True))
    auto_share = _cached("share", productive_share)
    ctx = {
        "rates": rates, "order": order, "stations": _stations(order),
        "fallback": round(sum(measured) / len(measured), 4) if measured else 0.0,
        "share": auto_share or DEFAULT_SHARE,
        "waits": dict(WorkStage.objects.filter(wait_hours__gt=0).values_list("name", "wait_hours")),
    }
    stations = {s["id"]: s for s in ctx["stations"]}
    cal = _Calendar(employees)

    tasks, skipped = _tasks(rows, ctx)
    start_day = _first_day(today, cal)
    # پروژه‌ای که از امروز (یا پیش‌تر) متوقف است و روزِ ادامه‌اش معلوم نیست، اصلاً چیده نمی‌شود.
    pauses = _pauses()
    stopped = {pid for pid, ps in pauses.items() if any(b is None and a <= start_day for a, b in ps)}
    tasks = {pid: ts for pid, ts in tasks.items() if pid not in stopped}
    # توقفی که بعداً شروع می‌شود و پایان ندارد: از آن روز به بعد کارِ آن پروژه دیگر «ماندنی» نیست
    stop_from = {pid: min(a for a, b in ps if b is None) for pid, ps in pauses.items()
                 if pid in tasks and any(b is None for a, b in ps)}
    used_today = _today_used(today, cal) if start_day == today else 0.0
    # جای دستی تا روزش نرسیده جای دستی است؛ روزی که گذشت، کار مثل بقیه با اولویتِ پروژه چیده می‌شود.
    for ts in tasks.values():
        for t in ts:
            if t["placed"] and t["notBefore"] < start_day:
                t["placed"], t["notBefore"] = False, None
    # کارِ عقب‌افتاده: برنامهٔ ثبت‌شده‌اش پیش از امروز شروع شده بود و هنوز مانده است؛ کارِ نیمه‌کاره هم همین‌طور.
    # پروژه‌ای که از توقف برگشته: فقط برنامه و کارِ بعد از روزِ ادامه حساب است؛ عقب‌افتادنِ پیش از توقف تقصیرِ کسی نیست
    # که حالا جلوی بقیه را بگیرد.
    resumed = {pid: max(b for a, b in ps if b and b <= start_day) for pid, ps in pauses.items()
               if any(b and b <= start_day for a, b in ps)}
    planned_before = {(str(pid), st) for pid, st, d in
                      PlanBaselineLine.objects.filter(date__lt=start_day).values_list("project_id", "stage", "date")
                      if d >= resumed.get(str(pid), dt.date.min) and not _paused_on(pauses, str(pid), d)}
    touched = {(str(pid), st) for pid, st, d in
               ReportProgress.objects.filter(project_id__in=[int(p) for p in resumed], area__gt=0,
                                             report__status=DailyReport.Status.APPROVED)
               .values_list("project_id", "stage", "report__date")
               if d >= resumed[str(pid)]}
    for pid, ts in tasks.items():
        for t in ts:
            started = 0 < t["frac"] and (pid not in resumed or (pid, t["name"]) in touched)
            t["overdue"] = t["frac"] < 1 and (started or (pid, t["name"]) in planned_before)
    meta = {str(p.pk): p for p in Project.objects.filter(pk__in=[int(k) for k in tasks])}
    far = dt.date.max

    def rank(pid):
        p = meta[pid]
        return (p.plan_priority is None, p.plan_priority or 0, p.due_date or far, p.start_date or far, p.name)

    queue = sorted(tasks, key=rank)

    warnings = []
    if not employees:
        warnings.append("کارگر فعالی تعریف نشده؛ توان کارگاه صفر است.")
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
    inactive = set(WorkStage.objects.filter(active=False).values_list("name", flat=True))
    idle = sorted({t["name"] for ts in tasks.values() for t in ts if t["name"] in inactive and t["frac"] < 1},
                  key=lambda n: order[n])
    if idle:
        warnings.append("این مرحله‌ها غیرفعال‌اند ولی در پروژه‌های باز کار مانده دارند و در برنامه آمده‌اند: "
                        + "، ".join(idle))
    if ctx["offStation"]:
        warnings.append("ایستگاهِ انتخاب‌شدهٔ این کارها غیرفعال یا پاک شده و در ایستگاهِ پیش‌فرض برنامه شده‌اند: "
                        + "، ".join(ctx["offStation"]))

    # ---------- شبیه‌سازی روزبه‌روز ----------
    days, first, last = [], {}, {}
    span = defaultdict(dict)                                  # pid -> stage -> [start, finish]
    cur = {pid: [t["frac"] for t in ts] for pid, ts in tasks.items()}
    rest = lambda pid, i: (1 - cur[pid][i]) * tasks[pid][i]["planned"]  # noqa: E731
    doable = lambda pid, i: tasks[pid][i]["daily"]  # noqa: E731
    left = lambda day: any(rest(pid, i) >= DUST and doable(pid, i) and not (pid in stop_from and day >= stop_from[pid])  # noqa: E731
                           for pid in cur for i in range(len(cur[pid])))
    # کارهایی که باید «با هم» انجام شوند: (مرحله، شمارهٔ دسته) ← کارها
    together = defaultdict(list)
    for pid, ts in tasks.items():
        for i, t in enumerate(ts):
            if t["batch"]:
                together[(t["name"], t["batch"])].append((pid, i))
    # دسته‌ای که فقط یک کارِ باز در آن مانده (هم‌دسته‌اش بسته یا تمام شده) دیگر منتظرِ کسی نیست.
    for key, members in list(together.items()):
        if len(members) < 2:
            for pid, i in members:
                tasks[pid][i]["batch"] = None
            del together[key]

    # پیشرفتِ هر کار در پایانِ هر روزی که رویش کار شده — برای اینکه بدانیم چه مقدارش تا کِی خشک شده است
    base = {pid: list(fs) for pid, fs in cur.items()}
    log = {pid: [[] for _ in fs] for pid, fs in cur.items()}

    def delivered(pid, i, day, start):
        """سهمی از کارِ مرحلهٔ i که صبحِ day هم تمام شده هم خشک: آنچه تا (۱ + روزهای انتظار) روز پیش انجام شده."""
        dry = tasks[pid][i]["dry"]
        if not dry:
            return start[pid][i]
        cutoff = day - dt.timedelta(days=1 + dry)
        for d, frac in reversed(log[pid][i]):
            if d <= cutoff:
                return frac
        return base[pid][i]                                  # کارِ پیش از برنامه خشک فرض می‌شود

    def all_arrived(pid, i, day, start):
        """همهٔ کارهای هم‌دسته به این مرحله رسیده‌اند؟ یعنی مرحلهٔ قبلِ همه‌شان تمام و خشک شده است."""
        t = tasks[pid][i]
        for q, j in together.get((t["name"], t["batch"]), ()) if t["batch"] else ():
            if j and rest(q, j) >= DUST and (1 - delivered(q, j - 1, day, start)) * tasks[q][j - 1]["planned"] >= DUST:
                return False
        return True

    day, worked = start_day, 0
    while left(day) and worked < MAX_WORKING_DAYS:
        info = cal.day(day)
        if day == today and used_today:
            info = {**info, "factor": info["factor"] * (1 - used_today), "pool": info["pool"] * (1 - used_today)}
        if info["factor"] <= 0:
            day += dt.timedelta(days=1)
            continue
        worked += 1
        pool = info["pool"]
        free = {sid: info["factor"] for sid in stations}
        start = {pid: list(fs) for pid, fs in cur.items()}    # مرحلهٔ بعد فقط کارِ تا دیروز را می‌بیند
        lines = []
        # اول کارهایی که مسئول جایشان را دستی گذاشته، بعد کارهای عقب‌افتاده و نیمه‌کاره، بعد بقیه به ترتیب اولویت.
        for pid, i, t in [(pid, i, t) for group in ("placed", "overdue", "rest") for pid in queue
                          for i, t in enumerate(tasks[pid])
                          if (t["placed"] if group == "placed" else
                              not t["placed"] and t["overdue"] if group == "overdue" else
                              not t["placed"] and not t["overdue"])]:
            sid = t["station"]
            if not t["daily"] or (t["notBefore"] and t["notBefore"] > day) or _paused_on(pauses, pid, day):
                continue
            if not t["placed"] and (pool <= 0.001 or free[sid] <= 0.001):
                continue
            ready = ((delivered(pid, i - 1, day, start) if i else 1.0) - cur[pid][i]) * t["planned"]
            if ready < DUST or not all_arrived(pid, i, day, start):
                continue
            # نفراتِ ثابتِ ایستگاه که مرخصی یا کارِ عمومی‌اند، همان روز از سرعتش کم می‌کنند.
            crew = t["crew"]
            st = stations.get(sid)
            if st and st["people"] and not t["crewOwn"]:
                crew = sum(info["share"].get(p, 1.0) for p in st["people"])
            # بیش از کسانی که امروز هنوز آزادند کسی سرِ کار نیست — کارِ دستی هم همین‌طور.
            crew = min(crew, pool / info["factor"])
            if crew < 0.05:
                continue
            daily = t["daily"] * crew / t["crew"]
            if t["placed"]:
                area = min(ready, daily * info["factor"])
            else:
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
                          "area": round(area, 2), "people": round(crew, 1), "share": round(used / info["factor"], 2)})
            first.setdefault(pid, day)
            span[pid].setdefault(t["name"], [day, day])[1] = day
            if all(rest(pid, j) < DUST or not doable(pid, j) for j in range(len(cur[pid]))):
                last[pid] = day
        for pid, fs in cur.items():
            for i, frac in enumerate(fs):
                if frac != start[pid][i]:
                    log[pid][i].append((day, frac))
        days.append({"date": day, "base": info["base"], "overtime": info["overtime"],
                     "present": info["present"], "leave": info["leave"], "away": info["away"],
                     "pool": round(info["pool"], 2), "used": round(info["pool"] - pool, 2),
                     # جای دستیِ کارها نفر یا ایستگاهِ بیشتری از آنچه هست می‌خواهد
                     "over": pool < -0.01, "overStations": [sid for sid, v in free.items() if v < -0.01],
                     "lines": lines})
        day += dt.timedelta(days=1)
    unfinished = left(day)

    return {"today": today, "start": start_day, "ctx": ctx, "stations": ctx["stations"], "employees": employees,
            "tasks": tasks, "queue": queue, "meta": meta, "rows": {r["id"]: r for r in rows}, "together": together,
            "days": days, "first": first, "last": last, "span": span, "unfinished": unfinished,
            "warnings": warnings, "autoShare": auto_share, "calendar": cal, "pauses": pauses}


def _baseline():
    """برنامهٔ ثبت‌شده: [شروع، پایان]ِ هر کار و هر پروژه."""
    job, proj = {}, {}
    for pid, stage, d in PlanBaselineLine.objects.values_list("project_id", "stage", "date"):
        for box, k in ((job, (str(pid), stage)), (proj, str(pid))):
            if k not in box:
                box[k] = [d, d]
            else:
                box[k] = [min(box[k][0], d), max(box[k][1], d)]
    return job, proj


def _general_hours(since, start, cal):
    """کارِ عمومیِ کارگاه در هر روزِ گذشته: ساعتِ برنامه‌ریزی‌شده در برابر ساعتِ گزارش‌شده (تأییدشده)."""
    planned = defaultdict(float)
    d = since
    while d < start:
        info = cal.day(d)
        for a in info["away"]:
            if a["kind"] == PlanLeave.Kind.GENERAL:
                planned[d] += a["hours"] if a["hours"] is not None else info["base"]
        d += dt.timedelta(days=1)
    actual = {day: production._f(h) for day, h in
              ReportItem.objects.filter(report__date__gte=since, report__date__lt=start,
                                        report__status=DailyReport.Status.APPROVED, project__general=True)
              .values_list("report__date").annotate(h=Sum("hours"))}
    return planned, actual


def _past(start, by_stage, cal=None, pauses=None):
    """روزهای گذشتهٔ برنامهٔ ثبت‌شده در برابر کارِ واقعی، و آمارِ تحقق برنامه.

    برنامهٔ پروژه‌ای که آن روز متوقف بود حساب نمی‌شود: کاری که نشد، تقصیرِ کارگاه نبود."""
    since = start - dt.timedelta(days=PAST_DAYS)
    lines = [ln for ln in PlanBaselineLine.objects.filter(date__gte=since, date__lt=start).select_related("project")
             if not _paused_on(pauses or {}, str(ln.project_id), ln.date)]
    if not lines:
        return [], None
    actual = {(d, pid, st): production._f(a) for d, pid, st, a in
              ReportProgress.objects.filter(report__date__gte=since, report__date__lt=start,
                                            report__status=DailyReport.Status.APPROVED)
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
        # ایستگاهِ امروزِ همان مرحله؛ ایستگاهی که آن روز بود شاید دیگر نباشد.
        by_day[ln.date].append({"station": by_stage.get(ln.stage, ""),
                                "stationName": ln.station_name, "projectId": str(ln.project_id),
                                "project": _label(ln.project), "stage": ln.stage,
                                "planned": round(float(ln.area), 2), "actual": round(act, 2)})
    gplan, gact = _general_hours(since, start, cal) if cal else ({}, {})
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
                    "percent": pct, "lines": by_day[d],
                    "generalPlanned": round(gplan.get(d, 0.0), 1), "generalActual": round(gact.get(d, 0.0), 1)})
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

    def own(days, since):
        """عقب‌افتادگیِ خودِ کارگاه: روزهایی که پروژه متوقف بود از آن کم می‌شود."""
        return None if days is None else days - _pause_days(s["pauses"], pid, since, s["today"])

    projects = []
    for n, pid in enumerate(s["queue"], 1):
        p = meta[pid]
        jobs, total_h, total_a = [], 0.0, 0.0
        before = 1.0
        for t in tasks[pid]:
            area = (1 - t["frac"]) * t["planned"]
            if area < DUST:
                area = 0.0
            # کارِ آماده: آنچه مرحلهٔ قبل تمام کرده و این مرحله هنوز رویش نرفته
            ready = max(before - t["frac"], 0.0) * t["planned"]
            ready = round(ready, 2) if ready >= DUST and area else 0.0
            before = t["frac"]
            hrs = area * (t["hpm"] or 0)
            total_h += hrs
            total_a += area
            sp = s["span"][pid].get(t["name"])
            bstart, base = base_job.get((pid, t["name"]), (None, None))
            jobs.append({
                "stage": t["name"], "station": t["station"], "stationFixed": t["stationFixed"],
                "together": [{"id": q, "label": _label(meta[q])}
                             for q, _ in s["together"].get((t["name"], t["batch"]), ()) if q != pid] if t["batch"] else [],
                "stationName": stations[t["station"]]["name"] if t["station"] in stations else "",
                "planned": round(t["planned"], 2), "remaining": round(area, 2), "hours": round(hrs, 1),
                "crew": t["crew"], "crewManual": t["crewOwn"], "stationCrew": t["stationCrew"],
                "measured": t["measured"], "manual": t["manual"],
                "daily": round(t["daily"], 2) if t["daily"] else None,
                "suggestedDaily": round(t["suggested"], 2) if t["suggested"] else None,
                "days": round(area / t["daily"], 1) if t["daily"] and area else (0 if not area else None),
                "suggestedDays": round(area / t["suggested"], 1) if t["suggested"] and area else None,
                "notBefore": t["notBefore"], "placed": t["placed"],
                "waitHours": t["waitHours"], "dryDays": t["dry"],
                "percent": round(t["frac"] * 100),
                "start": sp[0] if sp else None, "finish": sp[1] if sp else None,
                "baselineStart": bstart, "baselineFinish": base,
                "slipDays": own(slip(sp[1] if sp else None, base), bstart) if area else None,
                "pauseDays": _pause_days(s["pauses"], pid, bstart, s["today"]) if area and base else 0,
                "overdue": t.get("overdue", False),
                "ready": ready,
            })
            late = (jobs[-1]["slipDays"] or 0) > 0
            jobs[-1]["status"] = ("done" if not area else "late" if late else
                                  "waiting" if not ready else "doing" if t["frac"] > 0 else "ready")
        finish = s["last"].get(pid)
        bstart, base = base_proj.get(pid, (None, None))
        slack = (p.due_date - finish).days if p.due_date and finish else None
        projects.append({
            "id": pid, "name": p.name, "label": _label(p), "order": n, "pinned": p.plan_priority is not None,
            "dueDate": p.due_date, "state": s["rows"][pid]["state"], "owner": p.owner_name,
            "percent": s["rows"][pid]["percent"], "plannedArea": s["rows"][pid]["planned"],
            "doneArea": round(s["rows"][pid]["done"], 2),
            "remaining": round(total_a, 2), "hours": round(total_h, 1),
            "start": s["first"].get(pid), "finish": finish,
            "baselineStart": bstart, "baselineFinish": base, "slipDays": own(slip(finish, base), bstart),
            "totalSlipDays": slip(finish, base),
            "pauseDays": _pause_days(s["pauses"], pid, bstart, s["today"]) if base else 0,
            "slackDays": slack, "onTime": None if slack is None else slack >= 0,
            "jobs": jobs,
        })

    past, stats = _past(s["start"], _by_stage(s["stations"]), s["calendar"], s["pauses"])
    # کارِ واقعاً انجام‌شدهٔ هر مرحله از چه روزی تا چه روزی بوده — نوارِ خاکستریِ گانت
    actual = {(str(pid), stage): (a, b) for pid, stage, a, b in
              ReportProgress.objects.filter(project_id__in=[int(k) for k in tasks], area__gt=0,
                                            report__status=DailyReport.Status.APPROVED)
              .values_list("project_id", "stage").annotate(a=Min("report__date"), b=Max("report__date"))}
    spent = {str(pid): production._f(h) for pid, h in
             ReportItem.objects.filter(project_id__in=[int(k) for k in tasks],
                                       report__status=DailyReport.Status.APPROVED)
             .values_list("project_id").annotate(h=Sum("hours"))}
    for p in projects:
        p["spentHours"] = round(spent.get(p["id"], 0.0), 1)
        for j in p["jobs"]:
            j["actualStart"], j["actualEnd"] = actual.get((p["id"], j["stage"]), (None, None))
            # کارِ تمام‌شده: چند روز دیرتر (یا زودتر) از برنامهٔ ثبت‌شده تمام شد
            j["doneSlip"] = ((j["actualEnd"] - j["baselineFinish"]).days
                             if not j["remaining"] and j["actualEnd"] and j["baselineFinish"] else None)
    # کارِ ثبت‌شدهٔ روزهای گذشته، برای تقویم
    since = s["today"] - dt.timedelta(days=PAST_DAYS)
    history = defaultdict(list)
    names = {}
    for day, pid, stage, area in (ReportProgress.objects
                                  .filter(report__date__gte=since, report__date__lt=s["start"],
                                          report__status=DailyReport.Status.APPROVED,
                                          project__isnull=False, project__general=False, area__gt=0)
                                  .values_list("report__date", "project_id", "stage").annotate(a=Sum("area"))
                                  .order_by("report__date")):
        if pid not in names:
            names[pid] = _label(meta[str(pid)]) if str(pid) in meta else _label(Project.objects.get(pk=pid))
        history[day].append({"projectId": str(pid), "project": names[pid], "stage": stage,
                             "area": round(production._f(area), 2)})
    commit = PlanCommit.objects.first()
    cal = s["calendar"]
    queues = _queues(s, projects)
    trend = defaultdict(list)
    for q in PlanQueueSnapshot.objects.filter(date__gte=s["today"] - dt.timedelta(days=QUEUE_DAYS)):
        trend[q.station].append({"date": q.date, "ready": float(q.ready_area), "load": float(q.load)})
    for q in queues:
        q["trend"] = trend.get(q["name"], [])
    slips = [p["slipDays"] for p in projects if p["slipDays"] is not None]
    today_info = cal.day(s["today"])
    return {
        "today": s["today"], "start": s["start"],
        "settings": {"crew": len(s["employees"]), "share": round(s["ctx"]["share"], 3), "autoShare": s["autoShare"],
                     "dayHours": DAY_HOURS, "thursdayHours": THURSDAY_HOURS,
                     "presentToday": today_info["present"], "leaveToday": today_info["leave"],
                     "awayToday": today_info["away"]},
        "stations": s["stations"],
        "stageNames": sorted(s["ctx"]["order"], key=s["ctx"]["order"].get),
        "employees": s["employees"],
        "projects": projects,
        "days": s["days"],
        "past": past,
        "history": [{"date": d, "lines": history[d]} for d in sorted(history)],
        "deviation": stats,
        "baseline": {"at": commit.at, "by": commit.by_name, "note": commit.note} if commit else None,
        "queues": queues,
        "overtime": [{"id": str(o.pk), "date": o.date, "hours": float(o.hours), "people": o.people, "note": o.note}
                     for o in PlanOvertime.objects.filter(date__gte=s["today"] - dt.timedelta(days=7))],
        "holidays": [{"id": str(h.pk), "date": h.date, "title": h.title} for h in PlanHoliday.objects.all()],
        "paused": _paused_list(s),
        "pauseReasons": [{"id": k, "label": v} for k, v in ProjectPause.Reason.choices],
        "leaves": [{"id": str(lv.pk), "employee": lv.employee, "from": lv.date_from, "to": lv.date_to, "note": lv.note,
                    "kind": lv.kind, "hours": float(lv.hours) if lv.hours else None}
                   for lv in PlanLeave.objects.filter(date_to__gte=s["today"] - dt.timedelta(days=7))],
        "totals": {"hours": round(sum(p["hours"] for p in projects), 1),
                   "area": round(sum(p["remaining"] for p in projects), 2),
                   "workingDays": len(s["days"]),
                   "finish": s["days"][-1]["date"] if s["days"] and not s["unfinished"] else None,
                   "unfinished": s["unfinished"],
                   "late": sum(1 for p in projects if p["onTime"] is False),
                   "noDueDate": sum(1 for p in projects if not p["dueDate"]),
                   "slipMax": max(slips) if slips else None,
                   "behind": sum(1 for x in slips if x > 0),
                   "paused": ProjectPause.objects.filter(end__isnull=True).count()},
        "warnings": s["warnings"],
    }


def _paused_list(s):
    """پروژه‌هایی که الان متوقف‌اند یا توقفشان در پیش است، با علت و کارِ مانده."""
    out = []
    for pz in (ProjectPause.objects.filter(end__isnull=True, project__closed_at__isnull=True)
               .select_related("project").order_by("start")):
        row = s["rows"].get(str(pz.project_id), {})
        out.append({"id": str(pz.pk), "projectId": str(pz.project_id), "label": _label(pz.project),
                    "start": pz.start, "reason": pz.reason, "reasonLabel": pz.get_reason_display(), "note": pz.note,
                    "by": pz.by_name, "days": max((s["today"] - pz.start).days, 0), "upcoming": pz.start > s["today"],
                    "remaining": row.get("remaining", 0.0), "percent": row.get("percent", 0.0),
                    "dueDate": pz.project.due_date})
    return out


def _queues(s, projects):
    """جلوی هر ایستگاه چند متر کارِ آماده مانده، و در دو هفتهٔ کاریِ پیشِ رو چند درصدِ وقتش پر است.

    گلوگاه ایستگاهی است که هم بارش بالاست هم صفش بزرگ؛ هر کدام به‌تنهایی گمراه می‌کند."""
    ready, count = defaultdict(float), defaultdict(int)
    for p in projects:
        for j in p["jobs"]:
            if j["ready"]:
                ready[j["station"]] += j["ready"]
                count[j["station"]] += 1
    cal, used, room, day, n = s["calendar"], defaultdict(float), 0.0, s["start"], 0
    busy = {d["date"]: d for d in s["days"]}
    for _ in range(400):
        factor = cal.day(day)["factor"]
        if factor > 0:
            n += 1
            room += factor
            for ln in busy.get(day, {}).get("lines", ()):
                used[ln["station"]] += ln["share"] * factor
        if n >= LOAD_DAYS:
            break
        day += dt.timedelta(days=1)
    out = [{"station": st["id"], "name": st["name"], "crew": st["crew"],
            "ready": round(ready[st["id"]], 2), "jobs": count[st["id"]],
            "load": round(used[st["id"]] / room * 100, 1) if room else 0.0}
           for st in s["stations"] if st["active"]]
    # گلوگاهِ احتمالی: پربارترین ایستگاهی که صف هم دارد و بارش از ۸۵٪ گذشته است
    hot = max((q for q in out if q["load"] >= 85 and q["ready"] > 0), key=lambda q: (q["load"], q["ready"]), default=None)
    for q in out:
        q["bottleneck"] = q is hot
    return out


# ---------- تصمیم‌های مسئول برنامه‌ریزی ----------

def _date(value, label):
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        raise ValidationError(f"{label} معتبر نیست.")


@transaction.atomic
def set_order(ids):
    """ترتیب اولویت پروژه‌ها همان می‌شود که آمده؛ پروژه‌ای که در فهرست نیست ترتیب دستی‌اش را از دست می‌دهد."""
    ids = [int(i) for i in ids]
    Project.objects.exclude(pk__in=ids).exclude(plan_priority__isnull=True).update(plan_priority=None)
    for n, pk in enumerate(ids, 1):
        Project.objects.filter(pk=pk).update(plan_priority=n)


@transaction.atomic
def shift_project(data, user, today=None):
    """همهٔ کارهای ماندهٔ یک پروژه را چند روز جلو یا عقب می‌برد (کشیدنِ نوارِ پروژه در گانت)."""
    pk = str(data.get("project") or "")
    try:
        delta = int(data.get("days"))
    except (TypeError, ValueError):
        raise ValidationError("تعداد روز جابه‌جایی عددی نیست.")
    row = next((p for p in plan(today)["projects"] if p["id"] == pk), None)
    if row is None or not delta:
        raise ValidationError("پروژه در برنامه نیست یا جابه‌جایی صفر است.")
    for j in row["jobs"]:
        if not j["remaining"] or not j["start"]:
            continue
        task, _ = PlanTask.objects.get_or_create(project_id=int(pk), stage=j["stage"])
        task.not_before = j["start"] + dt.timedelta(days=delta)
        task.updated_by_name = user.name or user.username
        task.save()


def _station(sid):
    """ایستگاهِ انتخاب‌شده. ایستگاهی که خودِ یک مرحله است با اولین انتخاب ساخته می‌شود."""
    sid = str(sid)
    if sid.isdigit():
        return Station.objects.filter(pk=int(sid), active=True).first()
    name = sid[len(STAGE_ID):] if sid.startswith(STAGE_ID) else ""
    if not name or not WorkStage.objects.filter(name=name).exists():
        return None
    return Station.objects.filter(name=name).first() or Station.objects.create(
        name=name, stages=[name], crew=stage_crews().get(name, 1))


def _tidy(task):
    """ردیفی که چیزی جز پیشنهاد سیستم ندارد لازم نیست."""
    if task.daily_area or task.station_id or task.not_before or task.batch or task.crew:
        task.save()
    elif task.pk:
        task.delete()


def _set_together(task, ids, user):
    """این کار با همین مرحلهٔ پروژه‌های ids با هم انجام می‌شود؛ ids خالی یعنی جدا."""
    mates = [p for p in Project.objects.filter(pk__in=[int(i) for i in ids if str(i).isdigit()])
             if p.pk != task.project_id]
    old = task.batch
    if not mates:
        task.batch = None
    else:
        others = [PlanTask.objects.get_or_create(project=p, stage=task.stage)[0] for p in mates]
        number = old or next((o.batch for o in others if o.batch), None) \
            or (PlanTask.objects.filter(stage=task.stage).order_by("-batch").values_list("batch", flat=True).first() or 0) + 1
        for o in others:
            o.batch = number
            o.updated_by_name = user.name or user.username
            o.save()
        task.batch = number
    # کسانی که دیگر در این دسته نیستند، و دسته‌ای که تک‌نفره مانده
    if old:
        keep = [p.pk for p in mates] if task.batch == old else []
        for o in PlanTask.objects.filter(stage=task.stage, batch=old).exclude(pk=task.pk).exclude(project_id__in=keep):
            o.batch = None
            _tidy(o)
    task.save()
    for number in {old, task.batch} - {None}:
        left = list(PlanTask.objects.filter(stage=task.stage, batch=number))
        if len(left) == 1:
            left[0].batch = None
            if left[0].pk == task.pk:
                task.batch = None
            else:
                _tidy(left[0])


def _remaining(project, stage):
    """متراژِ ماندهٔ یک مرحلهٔ یک پروژه، همان‌طور که برنامه حسابش می‌کند — بی ساختنِ کلِ برنامه."""
    row = production.project_status(project, production._progress_by_project([production.DONE_STATUS]))
    order = _stage_order()
    line = sorted((s for s in row["stages"] if s["inPlan"] and s["planned"] > 0 and s["name"] in order),
                  key=lambda s: order[s["name"]])
    ahead, out = 0.0, 0.0
    for s in reversed(line):
        reported = s["done"]
        frac = 1.0 if s["closed"] or s["planned"] - reported < DUST else reported / s["planned"]
        ahead = max(ahead, frac)
        if s["name"] == stage:
            out = (1 - ahead) * s["planned"]
    return round(out, 2) if out >= DUST else 0.0


def _make_room(project, stage, target, user, today=None):
    """کاری که مسئول روی روزِ target گذاشته آنجا می‌نشیند و مرحله‌های قبلش با آن جور می‌شوند.

    هر مرحله فقط روی کاری می‌رود که مرحلهٔ قبل تا دیروز تمام کرده؛ پس اگر کاری زودتر از آن گذاشته شود، مرحلهٔ
    قبل یک روزِ کاری پیش از آن آورده می‌شود، و قبل‌ترش یک روز پیش از آن، تا جایی که کارِ آماده هست. تنها
    حدّ این کار روزِ شروعِ برنامه است (هر مرحلهٔ مانده دست‌کم یک روز جا می‌خواهد) و کارهای «با هم» که منتظرِ
    پروژه‌های دیگرند. مرحله‌های بعد که چسبیده به این کار بودند هم با همان فاصله دنبالش می‌آیند.
    روزی را برمی‌گرداند که کار واقعاً رویش می‌نشیند.
    """
    row = next((p for p in plan(today)["projects"] if p["id"] == str(project.pk)), None)
    jobs = row["jobs"] if row else []
    i = next((n for n, j in enumerate(jobs) if j["stage"] == stage), None)
    if i is None or not jobs[i]["remaining"] or jobs[i]["together"]:
        return target
    cal = _Calendar(list(Employee.objects.filter(active=True).values_list("name", flat=True)))
    works = lambda d: cal.day(d)["factor"] > 0  # noqa: E731

    def near(day, by):
        """نزدیک‌ترین روزِ کاری از همین روز، رو به جلو (۱) یا عقب (۱-)."""
        for _ in range(400):
            if works(day):
                break
            day += dt.timedelta(days=by)
        return day

    # کارِ مرحلهٔ prev که روزِ day انجام شود، یک روز (و اگر خشک شدن می‌خواهد چند روز) بعد به مرحلهٔ بعد می‌رسد.
    after = lambda day, prev: near(day + dt.timedelta(days=1 + prev["dryDays"]), 1)  # noqa: E731
    before = lambda day, prev: near(day - dt.timedelta(days=1 + prev["dryDays"]), -1)  # noqa: E731
    first = near(_first_day(today or dt.date.today()), 1)

    def needs_previous(k):
        """کارِ k تا مرحلهٔ قبلش کاری تحویل ندهد شروع نمی‌شود؟"""
        return k > 0 and not jobs[k]["ready"] and jobs[k - 1]["remaining"] > 0

    def earliest(k):
        if k != i and jobs[k]["together"]:             # منتظرِ پروژه‌های دیگر است؛ جابه‌جا نمی‌شود
            return jobs[k]["start"] or dt.date(2999, 1, 1)
        return after(earliest(k - 1), jobs[k - 1]) if needs_previous(k) else first

    target = max(near(target, 1), earliest(i))
    need, k = target, i
    while needs_previous(k):
        prev = jobs[k - 1]
        need = before(need, prev)
        if prev["together"] or (prev["start"] and prev["start"] <= need):
            break                                      # همین حالا به‌موقع شروع می‌شود (یا دستِ ما نیست)
        held = PlanTask.objects.get_or_create(project=project, stage=prev["stage"])[0]
        held.not_before = need
        held.updated_by_name = user.name or user.username
        held.save()
        k -= 1
    # مرحله‌های بعد که به این کار چسبیده بودند (یک روزِ کاری پس از شروعِ قبلی) همان فاصله را نگه می‌دارند — چه کار
    # زودتر برود چه دیرتر. کاری که جایش دستی نیست خودِ زمان‌بندی دنبالِ قبلی می‌برد؛ جای دستی را اینجا می‌بریم.
    old, new, k = jobs[i]["start"], target, i + 1
    while old and k < len(jobs) and needs_previous(k) and not jobs[k]["together"] and jobs[k]["start"] == after(old, jobs[k - 1]):
        old, new = jobs[k]["start"], after(new, jobs[k - 1])
        held = PlanTask.objects.filter(project=project, stage=jobs[k]["stage"], not_before__isnull=False).first()
        if held and held.not_before != new:
            held.not_before = new
            held.updated_by_name = user.name or user.username
            held.save()
        k += 1
    return target


@transaction.atomic
def set_task(data, user, today=None):
    """مدت، نفرات، ایستگاه، زودترین شروع و «با هم بودنِ» یک کار. days خالی یعنی «پیشنهاد سیستم»."""
    pk = str(data.get("project") or "")
    project = Project.objects.filter(pk=int(pk)).first() if pk.isdigit() else None
    stage = (data.get("stage") or "").strip()
    if project is None or not WorkStage.objects.filter(name=stage).exists():
        raise ValidationError("پروژه یا مرحله پیدا نشد.")
    task, _ = PlanTask.objects.get_or_create(project=project, stage=stage)

    if "crew" in data:
        crew = data.get("crew")
        if crew in (None, ""):
            crew = None
        else:
            try:
                crew = int(crew)
            except (TypeError, ValueError):
                raise ValidationError("تعداد نفرات عددی نیست.")
            if not 1 <= crew <= 50:
                raise ValidationError("تعداد نفرات باید بین ۱ و ۵۰ باشد.")
        if crew != task.crew and "days" not in data and not data.get("finish"):
            task.daily_area = None                     # مدت از نو از روی نفر-ساعتِ کار و نفراتِ تازه درمی‌آید
        task.crew = crew
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
            remaining = _remaining(project, stage)
            if not remaining:
                raise ValidationError("از این مرحله کاری نمانده که برایش روز تعیین شود.")
            task.daily_area = Decimal(str(round(remaining / days, 2)))
    if "station" in data:
        sid = data.get("station")
        if sid in (None, ""):
            task.station = None
        else:
            task.station = _station(sid)
            if task.station is None:
                raise ValidationError("ایستگاه پیدا نشد.")
    if "notBefore" in data:
        task.not_before = _date(data["notBefore"], "تاریخ شروع") if data.get("notBefore") else None
        if task.not_before and data.get("pull"):
            task.not_before = _make_room(project, stage, task.not_before, user, today)
    if data.get("finish"):
        # «این کار تا این روز تمام شود»: سرعت طوری گذاشته می‌شود که کارِ مانده درست در روزهای کاریِ میانِ شروع و
        # این روز جا شود — پنجشنبهٔ نیم‌روز، تعطیلی و اضافه‌کاری هم حساب می‌شود. نواری که در گانت تا روزی کشیده
        # می‌شود همان‌جا تمام می‌شود، نه یک روز این‌ورتر یا آن‌ورتر.
        end = _date(data["finish"], "تاریخ پایان")
        if task.not_before is None:
            raise ValidationError("برای تعیین روز پایان، روز شروع هم لازم است.")
        start = max(task.not_before, _first_day(today or dt.date.today()))
        if end < start:
            raise ValidationError("روز پایان پیش از روز شروع است.")
        if (end - start).days > 400:
            raise ValidationError("بازهٔ کار بیش از حد بلند است.")
        cal = _Calendar(list(Employee.objects.filter(active=True).values_list("name", flat=True)))
        room = sum(cal.day(start + dt.timedelta(days=i))["factor"] for i in range((end - start).days + 1))
        if room <= 0:
            raise ValidationError("میان این دو تاریخ روز کاری نیست.")
        remaining = _remaining(project, stage)
        if not remaining:
            raise ValidationError("از این مرحله کاری نمانده که برایش زمان تعیین شود.")
        # رو به بالا گرد می‌شود تا خرده‌ای برای یک روزِ اضافه نماند.
        task.daily_area = (Decimal(str(remaining)) / Decimal(str(room))).quantize(Decimal("0.01"), rounding=ROUND_UP)
    task.updated_by_name = user.name or user.username
    if "together" in data:
        _set_together(task, data.get("together") or [], user)
    _tidy(task)


@transaction.atomic
def save_stations(rows):
    """فهرست ایستگاه‌ها همان می‌شود که آمده، به همان ترتیب. هر مرحله فقط در یک ایستگاه می‌ماند.

    ردیفِ ایستگاهِ خودکار (شناسهٔ «s:نام مرحله») اگر دست نخورده باشد خودکار می‌ماند و نفراتش همچنان از سابقه
    درمی‌آید؛ فقط وقتی عوض شده (نام، نفرات، مرحله‌ها) ایستگاهِ واقعی می‌شود. ایستگاهی که کارِ پروژهٔ بازی به آن
    داده شده پاک نمی‌شود تا آن کارها بی‌صدا ایستگاهشان را گم نکنند.
    """
    if not isinstance(rows, list):
        raise ValidationError("فهرست ایستگاه‌ها نامعتبر است.")
    stage_names = set(WorkStage.objects.values_list("name", flat=True))
    employees = set(Employee.objects.values_list("name", flat=True))
    crews = stage_crews()

    def clean(raw):
        name = (raw.get("name") or "").strip()
        stages = [x for x in (raw.get("stages") or []) if x in stage_names]
        people = [x for x in (raw.get("people") or []) if x in employees]
        try:
            crew = int(raw.get("crew") or 1)
        except (TypeError, ValueError):
            crew = 1
        return name, stages, people, crew

    keep = []
    for raw in rows:
        rid = str(raw.get("id") or "")
        if rid.startswith(STAGE_ID):
            stage = rid[len(STAGE_ID):]
            name, stages, people, crew = clean(raw)
            untouched = (name == stage and stages == [stage] and not people
                         and crew == crews.get(stage, 1) and raw.get("active", True) is not False)
            if untouched or not stages:
                continue                                   # همان ایستگاهِ خودکار، یا مرحله‌اش جای دیگری رفته
            raw = {**raw, "id": None}
        keep.append(raw)

    ids = [int(r["id"]) for r in keep if str(r.get("id") or "").isdigit()]
    going = Station.objects.exclude(pk__in=ids)
    busy = (PlanTask.objects.filter(station__in=going, project__closed_at__isnull=True, project__active=True)
            .select_related("station", "project"))
    if busy:
        st = busy[0].station
        raise ValidationError(f"ایستگاه «{st.name}» برای {len(busy)} کارِ پروژه‌های باز انتخاب شده "
                              f"(مثلاً {_label(busy[0].project)} · {busy[0].stage})؛ اول آن کارها را به ایستگاه دیگری ببرید.")
    going.delete()                                       # برنامهٔ ثبت‌شده نامِ ایستگاه را خودش دارد

    names, taken, plan_rows = set(), {}, []
    for order, raw in enumerate(keep):
        name, stages, people, crew = clean(raw)
        if not name:
            raise ValidationError("نام یک ایستگاه خالی است.")
        if name in names:
            raise ValidationError(f"ایستگاه «{name}» دو بار آمده است.")
        names.add(name)
        for x in stages:
            if x in taken:
                raise ValidationError(f"مرحلهٔ «{x}» هم به «{taken[x]}» داده شده هم به «{name}»؛ هر مرحله یک ایستگاه دارد.")
            taken[x] = name
        if crew < 1 or crew > 50:
            raise ValidationError(f"تعداد نفرات «{name}» باید بین ۱ و ۵۰ باشد.")
        st = Station.objects.filter(pk=int(raw["id"])).first() if str(raw.get("id") or "").isdigit() else None
        plan_rows.append((st or Station(), name, order, raw.get("active", True) is not False, stages, people, crew))
    # نام‌ها یکتا هستند؛ اول همه نامِ موقت می‌گیرند تا جابه‌جاییِ نامِ دو ایستگاه به هم نخورد.
    for st, *_ in plan_rows:
        if st.pk:
            Station.objects.filter(pk=st.pk).update(name=f"__{st.pk}__")
    for st, name, order, active, stages, people, crew in plan_rows:
        st.name, st.order, st.active, st.stages, st.people, st.crew = name, order, active, stages, people, crew
        st.save()


@transaction.atomic
def pause_project(data, user, today=None):
    """توقفِ یک پروژه از روزی (پیش‌فرض امروز)، با علت."""
    p = Project.objects.filter(pk=int(data["project"]) if str(data.get("project") or "").isdigit() else 0,
                               general=False).first()
    if p is None:
        raise ValidationError("پروژه پیدا نشد.")
    if p.closed_at:
        raise ValidationError("پروژهٔ بسته را نمی‌شود متوقف کرد.")
    if p.pauses.filter(end__isnull=True).exists():
        raise ValidationError("این پروژه همین حالا متوقف است.")
    start = _date(data["start"], "تاریخ توقف") if data.get("start") else (today or dt.date.today())
    reason = data.get("reason") or ProjectPause.Reason.OTHER
    if reason not in ProjectPause.Reason.values:
        raise ValidationError("علت توقف نامعتبر است.")
    if p.pauses.filter(end__gt=start).exists():
        raise ValidationError("این تاریخ با توقفِ قبلیِ همین پروژه هم‌پوشانی دارد.")
    ProjectPause.objects.create(project=p, start=start, reason=reason, note=(data.get("note") or "").strip()[:300],
                                by_name=user.name or user.username)


@transaction.atomic
def resume_project(data, user, today=None):
    """ادامهٔ پروژهٔ متوقف از روزی (پیش‌فرض امروز). با shiftDue، تاریخ تحویل به اندازهٔ روزهای توقف جلو می‌رود."""
    pz = ProjectPause.objects.filter(project_id=int(data["project"]) if str(data.get("project") or "").isdigit() else 0,
                                     end__isnull=True).select_related("project").first()
    if pz is None:
        raise ValidationError("این پروژه متوقف نیست.")
    end = _date(data["end"], "تاریخ ادامه") if data.get("end") else (today or dt.date.today())
    if end < pz.start:
        raise ValidationError("روزِ ادامه پیش از روزِ توقف است.")
    pz.end, pz.resumed_by_name = end, user.name or user.username
    if data.get("shiftDue") and pz.project.due_date and end > pz.start:
        pz.due_shift = (end - pz.start).days
        pz.project.due_date += dt.timedelta(days=pz.due_shift)
        pz.project.save(update_fields=["due_date"])
    pz.save()


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


def add_holiday(data):
    day = _date(data.get("date"), "تاریخ")
    PlanHoliday.objects.update_or_create(date=day, defaults={"title": (data.get("title") or "").strip()[:200]})


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
    kind = data.get("kind") or PlanLeave.Kind.LEAVE
    if kind not in PlanLeave.Kind.values:
        raise ValidationError("نوع نامعتبر است.")
    hours = data.get("hours")
    if hours in (None, ""):
        hours = None
    else:
        try:
            hours = float(hours)
        except (TypeError, ValueError):
            raise ValidationError("ساعت را عددی وارد کنید.")
        if not 0 < hours <= 12:
            raise ValidationError("ساعت باید بین ۰ و ۱۲ باشد؛ برای کلِ روز خالی بگذارید.")
    PlanLeave.objects.create(employee=name, date_from=start, date_to=end, kind=kind,
                             hours=Decimal(str(hours)) if hours else None,
                             note=(data.get("note") or "").strip()[:200],
                             created_by_name=user.name or user.username)


def _baseline_lines(s, days):
    names = {st["id"]: st["name"] for st in s["stations"]}
    return [PlanBaselineLine(date=d["date"], station_id=int(ln["station"]) if ln["station"].isdigit() else None,
                             station_name=names.get(ln["station"], ""), project_id=int(ln["projectId"]),
                             stage=ln["stage"], area=Decimal(str(ln["area"])), people=Decimal(str(ln["people"])))
            for d in days for ln in d["lines"]]


@transaction.atomic
def commit(user, note="", today=None, by=None):
    """زمان‌بندیِ همین لحظه «برنامهٔ ثبت‌شده» می‌شود. روزهای گذشتهٔ برنامهٔ قبلی دست نمی‌خورد."""
    s = schedule(today)
    PlanBaselineLine.objects.filter(date__gte=s["start"]).delete()
    PlanBaselineLine.objects.bulk_create(_baseline_lines(s, s["days"]))
    PlanCommit.objects.create(by_name=by or user.name or user.username, note=(note or "").strip()[:300])


@transaction.atomic
def daily(today=None):
    """کارِ هر صبح، پیش از شروعِ کارگاه (فرمانِ plan_daily با زمان‌بندِ سرور صدایش می‌زند).

      · اگر از شنبهٔ همین هفته برنامه‌ای ثبت نشده، برنامهٔ همین لحظه خودکار ثبت می‌شود (مبنای هفته).
      · وگرنه فقط برنامهٔ امروز تازه می‌شود: همان که صبحِ امروز است. تحققِ برنامهٔ هر روز این‌طور در برابر چیزی
        سنجیده می‌شود که سرپرست صبح دیده، نه برنامهٔ چند روز پیش که دیگر کسی دنبالش نیست.
      · صف و بارِ هر ایستگاه برای امروز نگه داشته می‌شود.

    دوباره اجرا کردنش در همان روز بی‌ضرر است. می‌گوید چه کرد.
    """
    today = today or dt.date.today()
    s = schedule(today)
    did = []
    if s["calendar"].day(today)["factor"] > 0 and s["start"] == today and s["days"]:
        week = today - dt.timedelta(days=(today.weekday() - 5) % 7)      # شنبهٔ همین هفته
        last = PlanCommit.objects.first()
        if last is None or timezone.localtime(last.at).date() < week:
            commit(None, "مبنای هفته", today=today, by=AUTO_NAME)
            did.append("week")
        elif s["days"][0]["date"] == today:
            PlanBaselineLine.objects.filter(date=today).delete()
            PlanBaselineLine.objects.bulk_create(_baseline_lines(s, s["days"][:1]))
            did.append("today")
    for q in plan(today)["queues"]:
        PlanQueueSnapshot.objects.update_or_create(
            date=today, station=q["name"], defaults={"ready_area": Decimal(str(q["ready"])), "load": Decimal(str(q["load"]))})
    did.append("queues")
    PlanQueueSnapshot.objects.filter(date__lt=today - dt.timedelta(days=400)).delete()
    return did
