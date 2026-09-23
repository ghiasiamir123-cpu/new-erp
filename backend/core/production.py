"""تولید: وضعیت زندهٔ هر پروژه، توان کارگاه و متراژ هر نفر.

هیچ جدول تازه‌ای برای «کارِ انجام‌شده» لازم نیست — گزارش کار روزانه از قبل همه‌چیز را دارد:

  · ProjectStage  → متراژ برنامه‌ریزی‌شدهٔ هر مرحله از هر پروژه
  · ReportProgress → متراژ انجام‌شدهٔ هر روز، یک ردیف برای هر پروژه/مرحله
  · ReportItem     → چه کسی، روی کدام پروژه، با چه فعالیتی، چند ساعت

انتساب متراژ به نفر: در یک گزارش، متراژِ یک مرحله بین کسانی پخش می‌شود که همان روز روی
همان پروژه با همان فعالیت کار کرده‌اند، به نسبت ساعت کارشان. مثال ۱۵ شهریور:
«خدادادی / زیرکاری = ۳۰ متر» و دو نفر هر کدام ۸ ساعت ⟵ ۱۵ متر برای هر نفر.
"""
import datetime as dt
from collections import defaultdict

from django.db.models import Sum

from .models import DailyReport, Project, ProjectStage, ReportItem, ReportProgress, WorkStage

# فقط گزارش تأییدشده «انجام‌شده» حساب می‌شود؛ بقیه جداگانه به‌عنوان «در انتظار» نشان داده می‌شوند.
DONE_STATUS = DailyReport.Status.APPROVED
PENDING_STATUSES = (DailyReport.Status.WAITING, DailyReport.Status.DRAFT,
                    DailyReport.Status.REVISION)


def stage_names(active_only=True):
    qs = WorkStage.objects.all()
    if active_only:
        qs = qs.filter(active=True)
    return list(qs.values_list("name", flat=True))


def area_stage_names():
    """مراحلی که متراژ دارند — «سایر» کنار گذاشته می‌شود."""
    return list(WorkStage.objects.filter(active=True, needs_area=True)
                .values_list("name", flat=True))


def stage_weights():
    """وزنِ هر مرحله: اهمیتِ کیفی × سنگینیِ زمانی.

    متراژ می‌گوید چقدر از یک مرحله انجام شده؛ وزن می‌گوید آن مرحله چقدر از کلِ کار است.
    بی وزن، پروژه‌ای که پرداختش تمام شده با پروژه‌ای که فقط پرایمر خورده یکسان دیده
    می‌شود، در حالی که سه مرحلهٔ پرداخت ۶۲٪ کارند.
    """
    return {s.name: float(s.weight or 0)
            for s in WorkStage.objects.filter(active=True) if (s.weight or 0) > 0}


def _f(x):
    return float(x or 0)


def _progress_by_project(statuses):
    """{project_id: {stage: متراژ}} از گزارش‌هایی که وضعیتشان در statuses است."""
    out = defaultdict(lambda: defaultdict(float))
    rows = (ReportProgress.objects
            .filter(report__status__in=statuses, project__isnull=False, project__general=False)
            .values("project_id", "stage")
            .annotate(area=Sum("area")))
    for r in rows:
        out[r["project_id"]][r["stage"]] += _f(r["area"])
    return out


def project_status(project, done_map=None, pending_map=None, weights=None):
    """وضعیت یک پروژه: هر مرحله چقدر برنامه، چقدر انجام، چقدر مانده.

    مرحله‌ای که کار رویش ثبت شده ولی در برنامهٔ پروژه نیست، با planned=0 می‌آید و
    over=True می‌گیرد — همان چیزی که باید قرمز دیده شود.
    """
    done = (done_map or {}).get(project.pk, {})
    pending = (pending_map or {}).get(project.pk, {})

    planned_rows = {s.name: s for s in project.stages.all()}
    names = list(planned_rows) + [n for n in set(done) | set(pending) if n not in planned_rows]

    stages, tot_plan, tot_done, tot_pending = [], 0.0, 0.0, 0.0
    for name in names:
        st = planned_rows.get(name)
        plan = _f(st.area) if st else 0.0
        d = done.get(name, 0.0)
        p = pending.get(name, 0.0)
        remaining = max(plan - d, 0.0)
        stages.append({
            "name": name,
            "planned": round(plan, 2),
            "done": round(d, 2),
            "pending": round(p, 2),
            "remaining": round(remaining, 2),
            "percent": round(d / plan * 100, 1) if plan else (100.0 if d else 0.0),
            "inPlan": st is not None,
            "over": d > plan + 0.01,              # بیش از برنامه ثبت شده
            "overBy": round(max(d - plan, 0.0), 2),
            "closed": bool(st and st.done),
        })
        tot_plan += plan
        tot_done += d
        tot_pending += p

    # پیشرفت وزنی: هر مرحله به اندازهٔ وزنِ خودش جلو می‌برد، نه به نسبت مترش. پرداخت
    # میانی که تمام شود ۱۹٪ پروژه جلو می‌رود، حتی اگر مترش کم باشد.
    weights = weights if weights is not None else stage_weights()
    got = total_w = 0.0
    for s in stages:
        w = weights.get(s["name"], 0.0)
        if w <= 0:
            continue
        total_w += w
        got += w * (min(s["done"] / s["planned"], 1.0) if s["planned"] > 0
                    else (1.0 if s["done"] > 0 else 0.0))
    weighted = round(got / total_w * 100, 1) if total_w else None

    by_area = round(tot_done / tot_plan * 100, 1) if tot_plan else (100.0 if tot_done else 0.0)
    percent = weighted if weighted is not None else by_area
    # همان درصد، ولی بر حسب متراژ چوب: «چقدر از این کار از خط گذشته». اعداد کار
    # (پاس‌ها) برای زمان و ظرفیت لازم‌اند، ولی اندازهٔ واقعی کار همین است.
    base = float(project.base_area or 0)
    base_done = round(base * min(percent, 100.0) / 100, 2)
    issues = []
    if not project.no_area and not planned_rows:
        issues.append("متراژ و مراحل این پروژه وارد نشده")
    over = [s for s in stages if s["over"]]
    if over:
        issues.append("بیش از برنامه ثبت شده: " + "، ".join(s["name"] for s in over))
    off_plan = [s for s in stages if not s["inPlan"] and (s["done"] or s["pending"])]
    if off_plan:
        issues.append("مرحلهٔ خارج از برنامه: " + "، ".join(s["name"] for s in off_plan))

    # پروژهٔ بسته دیگر «ناقص» نیست؛ ایرادهایش تاریخچه‌اند نه کارِ مانده.
    if project.is_closed:
        issues = []

    return {
        "id": str(project.pk), "name": project.name, "code": project.code,
        "active": project.active, "noArea": project.no_area,
        "startDate": project.start_date, "dueDate": project.due_date,
        # متراژ چوب: اندازهٔ واقعی کار. «planned» جمع پاس‌هاست و روی یک متر چوب
        # چند بار شمرده می‌شود، پس این دو عدد را نباید به جای هم گرفت.
        "baseArea": round(base, 2),
        "baseDone": base_done,
        "baseRemaining": round(max(base - base_done, 0.0), 2),
        "planned": round(tot_plan, 2), "done": round(tot_done, 2),
        "pending": round(tot_pending, 2), "remaining": round(max(tot_plan - tot_done, 0.0), 2),
        "percent": percent,
        # هر دو نگه داشته می‌شوند: وزنی برای «چقدر از کار جلو رفته»، متراژی برای
        # «چقدر از سطح پوشیده شده». اگر هیچ مرحلهٔ وزن‌داری نباشد، وزنی خالی است.
        "percentWeighted": weighted, "percentByArea": by_area,
        "state": _state(project, tot_plan, tot_done),
        "closedAt": project.closed_at, "closedBy": project.closed_by_name,
        "closeNote": project.close_note,
        "closeReason": project.close_reason,
        "closeReasonLabel": (project.get_close_reason_display()
                             if project.close_reason else ""),
        "closedRemaining": float(project.closed_remaining or 0),
        "stages": stages, "issues": issues,
    }


def _state(project, planned, done):
    # بسته‌بودن بر همه‌چیز مقدم است: کارش تمام شده، هر چه هم که متراژش بگوید.
    if project.is_closed:
        return "closed"
    if not project.active:
        return "archived"
    if project.no_area:
        return "service"
    if not planned:
        return "nosetup"          # متراژ ندارد — باید پر شود
    if done <= 0:
        return "notstarted"
    if done + 0.01 >= planned:
        return "finished"
    return "running"


def board(active_only=False):
    """وضعیت همهٔ پروژه‌ها — صفحهٔ تولید.

    پروژهٔ غیرفعال هم نشان داده می‌شود. پیش‌تر پنهان می‌شد و همین باعث شد پروژه‌ای که
    کسی تیک «غیرفعال» را رویش زده بود، بی هیچ نشانه‌ای از صفحه غیب شود. «غیرفعال» یعنی
    در فهرست انتخابِ فرم گزارش نیاید؛ راهِ کنار گذاشتنِ پروژه «بستن» است، نه این.
    کارِ باقیماندهٔ پروژهٔ غیرفعال در صف کار و پیش‌بینی نمی‌آید (وضعیتش archived است).

    «کار عمومی کارگاه» پروژه نیست و در هیچ‌کدام از این حساب‌ها نمی‌آید؛ آمارش جداگانه
    در general_work() است.
    """
    qs = Project.objects.filter(general=False).prefetch_related("stages").order_by("name")
    hidden = 0
    if active_only:
        hidden = qs.filter(active=False).count()
        qs = qs.filter(active=True)
    done_map = _progress_by_project([DONE_STATUS])
    pending_map = _progress_by_project(PENDING_STATUSES)
    weights = stage_weights()
    rows = [project_status(p, done_map, pending_map, weights) for p in qs]

    # «باقیمانده» یعنی کارِ پیشِ رو، پس پروژهٔ بسته در آن نمی‌آید.
    open_rows = [r for r in rows if r["state"] not in ("closed", "archived")]
    totals = {
        # متراژ چوب — اندازهٔ واقعی کارها
        "baseArea": round(sum(r["baseArea"] for r in rows), 2),
        "baseDone": round(sum(r["baseDone"] for r in rows), 2),
        "baseRemaining": round(sum(r["baseRemaining"] for r in open_rows), 2),
        # متراژ کار (جمع پاس‌ها) — پایهٔ زمان و ظرفیت
        "planned": round(sum(r["planned"] for r in rows), 2),
        "done": round(sum(r["done"] for r in rows), 2),
        "remaining": round(sum(r["remaining"] for r in open_rows), 2),
        "projects": len(rows),
        "closed": sum(1 for r in rows if r["state"] == "closed"),
        "needSetup": sum(1 for r in rows if r["state"] == "nosetup"),
        "withIssues": sum(1 for r in rows if r["issues"]),
        # پروژهٔ غیرفعال از صفحه پنهان است؛ بی این عدد، کاربر فکر می‌کند گم شده.
        "hiddenInactive": hidden,
    }
    return {"results": rows, "totals": totals}


# ============ کارهای عمومی کارگاه ============

def general_work(start=None, end=None, statuses=(DONE_STATUS,)):
    """ساعتِ صرف‌شدهٔ کارهای عمومی کارگاه، و اینکه در هر ردیف چه کرده‌اند.

    اینها پروژه نیستند و متراژ ندارند، ولی ساعتشان بخش واقعی‌ای از وقت کارگاه است و
    باید دیده شود؛ وگرنه کسی که کارش خدمات است در آمار «بی‌کار» به نظر می‌رسد.

    دسته‌بندی نمی‌کنیم: تنوع کار زیاد است و هر دسته‌بندی‌ای یا ناقص می‌ماند یا سر راه
    می‌آید. به‌جایش خودِ توضیحِ هر ردیف گفته می‌شود.
    """
    items = ReportItem.objects.filter(report__status__in=statuses, project__general=True)
    if start:
        items = items.filter(report__date__gte=start)
    if end:
        items = items.filter(report__date__lte=end)
    items = items.select_related("project", "report").order_by("-report__date", "-id")

    by_kind, by_person, days = defaultdict(float), defaultdict(float), set()
    total = 0.0
    entries, no_desc = [], 0
    for it in items:
        hours = _f(it.hours)
        total += hours
        by_kind[it.project.name] += hours
        name = (it.employee or "").strip()
        if name:
            by_person[name] += hours
        days.add(it.report.date)
        desc = (it.desc or "").strip()
        if not desc:
            no_desc += 1
        if len(entries) < 500:
            entries.append({"date": it.report.date, "person": name, "hours": round(hours, 2),
                            "desc": desc, "kind": it.project.name})

    # ساعتِ کارِ پروژه‌ای در همان بازه، تا بشود سهم کار عمومی را فهمید.
    project_items = ReportItem.objects.filter(report__status__in=statuses, project__general=False)
    if start:
        project_items = project_items.filter(report__date__gte=start)
    if end:
        project_items = project_items.filter(report__date__lte=end)
    project_hours = sum(_f(i.hours) for i in project_items)
    all_hours = total + project_hours

    return {
        "totalHours": round(total, 2),
        "projectHours": round(project_hours, 2),
        "share": round(total / all_hours * 100, 1) if all_hours else 0.0,
        "days": len(days),
        "entries": entries,
        # ردیف بی توضیح یعنی نمی‌دانیم آن ساعت صرف چه شده — همان چیزی که باید کم شود.
        "noDesc": no_desc,
        "byKind": [{"name": k, "hours": round(v, 2)}
                   for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1])],
        "byPerson": [{"name": k, "hours": round(v, 2)}
                     for k, v in sorted(by_person.items(), key=lambda kv: -kv[1])],
        "kinds": [{"id": str(p.pk), "name": p.name, "active": p.active}
                  for p in Project.objects.filter(general=True).order_by("name")],
    }


# ============ متراژ هر نفر ============

def person_areas(start=None, end=None, statuses=(DONE_STATUS,)):
    """متراژ انجام‌شدهٔ هر نفر در یک بازه، با ساعت کار و بهره‌وری.

    برمی‌گرداند: {people: [...], unattributed: متراژی که به کسی نچسبید, days: تعداد روز کاری}
    """
    reports = DailyReport.objects.filter(status__in=statuses)
    if start:
        reports = reports.filter(date__gte=start)
    if end:
        reports = reports.filter(date__lte=end)
    reports = reports.prefetch_related("items", "progress")

    area_by_person = defaultdict(float)
    hours_by_person = defaultdict(float)
    area_hours_by_person = defaultdict(float)      # ساعتِ کارِ متراژی
    days_by_person = defaultdict(set)
    stage_by_person = defaultdict(lambda: defaultdict(float))
    area_by_stage = defaultdict(float)
    unattributed = 0.0
    days = set()

    # «سایر» و هر مرحلهٔ بی‌متراژ، ساعتش نباید در مخرج بهره‌وری بیاید؛ وگرنه کسی که
    # کارش خدمات کارگاه است بی‌دلیل کم‌بازده به نظر می‌رسد.
    area_stages = set(WorkStage.objects.filter(needs_area=True).values_list("name", flat=True))
    general_ids = set(Project.objects.filter(general=True).values_list("id", flat=True))

    # تطبیق بر اساس «روز» انجام می‌شود، نه «گزارش». در عمل متراژ و نفرات اغلب در دو
    # گزارشِ جدا از همان روز ثبت می‌شوند؛ اگر داخل یک گزارش بگردیم، متراژِ گزارشی که
    # نفر ندارد به هیچ‌کس نمی‌چسبد.
    items_of_day, progress_of_day = defaultdict(list), defaultdict(list)
    for rep in reports:
        days.add(rep.date)
        items_of_day[rep.date].extend(rep.items.all())
        progress_of_day[rep.date].extend(rep.progress.all())

    for day, items in items_of_day.items():
        for it in items:
            name = (it.employee or "").strip()
            if not name:
                continue
            hours = _f(it.hours)
            hours_by_person[name] += hours
            # ساعتِ کارِ عمومی کارگاه هیچ‌وقت در مخرج بهره‌وری نمی‌آید، حتی اگر فعالیتش
            # اسم یک مرحلهٔ متراژی را داشته باشد — چون متراژی از آن درنمی‌آید.
            if (it.activity or "").strip() in area_stages and it.project_id not in general_ids:
                area_hours_by_person[name] += hours
            days_by_person[name].add(day)

    exact_area = fallback_area = 0.0
    for day, progress in progress_of_day.items():
        items = items_of_day.get(day, [])
        for pr in progress:
            area = _f(pr.area)
            if area <= 0:
                continue
            area_by_stage[pr.stage] += area
            on_project = [it for it in items
                          if it.project_id == pr.project_id and (it.employee or "").strip()]
            # اول: همان فعالیت. این دقیق‌ترین انتساب است.
            crew = [it for it in on_project
                    if (it.activity or "").strip() == (pr.stage or "").strip()]
            exact = bool(crew) and sum(_f(it.hours) for it in crew) > 0
            if not exact:
                # وگرنه: هر کسی که آن روز روی همین پروژه بوده، با هر فعالیتی. دقیق نیست
                # ولی از دور ریختنِ متراژ بهتر است — کار بالاخره دست کسی انجام شده.
                crew = on_project
            total_hours = sum(_f(it.hours) for it in crew)
            if not crew or total_hours <= 0:
                unattributed += area
                continue
            if exact:
                exact_area += area
            else:
                fallback_area += area
            for it in crew:
                share = area * _f(it.hours) / total_hours
                name = it.employee.strip()
                area_by_person[name] += share
                stage_by_person[name][pr.stage] += share

    people = []
    for name in sorted(set(area_by_person) | set(hours_by_person)):
        area = area_by_person.get(name, 0.0)
        hours = hours_by_person.get(name, 0.0)
        area_hours = area_hours_by_person.get(name, 0.0)
        other_hours = max(hours - area_hours, 0.0)
        nd = len(days_by_person.get(name, ()))
        people.append({
            "name": name,
            "area": round(area, 2),
            "hours": round(hours, 2),
            "areaHours": round(area_hours, 2),
            "otherHours": round(other_hours, 2),
            "days": nd,
            # بهره‌وری فقط روی ساعتِ کارِ متراژی — نه کل حضور.
            "perHour": round(area / area_hours, 3) if area_hours else 0.0,
            "perDay": round(area / nd, 2) if nd else 0.0,
            "stages": {k: round(v, 2) for k, v in sorted(stage_by_person.get(name, {}).items())},
        })
    people.sort(key=lambda r: -r["area"])

    total_area = round(sum(p["area"] for p in people) + unattributed, 2)
    return {
        "people": people,
        "unattributed": round(unattributed, 2),
        # «دقیق» یعنی فعالیتِ نفر با مرحلهٔ متراژ یکی بوده؛ «تقریبی» یعنی آن روز روی همان
        # پروژه بوده ولی فعالیت دیگری ثبت کرده. جدا نگه داشتنشان می‌گوید عدد چقدر قابل اتکاست.
        "exactArea": round(exact_area, 2),
        "fallbackArea": round(fallback_area, 2),
        "totalArea": total_area,
        "days": len(days),
        "byStage": {k: round(v, 2) for k, v in sorted(area_by_stage.items(), key=lambda kv: -kv[1])},
    }


# ============ توان کارگاه ============

def capacity(start=None, end=None):
    """توان کارگاه از روی سابقه: متراژ در روز، کلی و به تفکیک مرحله.

    پایهٔ پیش‌بینی زمان یک کار تازه. «روز» یعنی روزی که گزارش تأییدشده دارد، نه روز تقویمی،
    چون روزهای تعطیل نباید میانگین را پایین بیاورند.
    """
    data = person_areas(start, end)
    days = data["days"] or 0
    total = data["totalArea"]

    per_stage = {}
    if days:
        for stage, area in data["byStage"].items():
            per_stage[stage] = round(area / days, 2)

    crew = len(data["people"])
    return {
        "days": days,
        "totalArea": total,
        "perDay": round(total / days, 2) if days else 0.0,
        "perStagePerDay": per_stage,
        "crewSize": crew,
        "perPersonPerDay": round(total / days / crew, 2) if days and crew else 0.0,
        "workingRatio": working_ratio(start, end),
    }


# ============ پیش‌بینی زمان ============

def working_ratio(start=None, end=None):
    """چند درصد روزهای تقویمی، روز کاری‌اند — از روی سابقه، نه حدس.

    تعطیلی جمعه و تعطیلات رسمی را با هم می‌گیرد، چون هر دو در سابقه دیده شده‌اند.
    اگر سابقه کم باشد، ۰٫۷۸ (تقریباً شش‌روزِ کاری در هفته) فرض می‌شود.
    """
    qs = DailyReport.objects.filter(status=DONE_STATUS)
    if start:
        qs = qs.filter(date__gte=start)
    if end:
        qs = qs.filter(date__lte=end)
    dates = sorted(set(qs.values_list("date", flat=True)))
    if len(dates) < 5:
        return 0.78
    span = (dates[-1] - dates[0]).days + 1
    return round(min(len(dates) / span, 1.0), 3) if span > 0 else 0.78


def backlog(exclude_project_id=None, rows=None):
    """کار باقیماندهٔ پروژه‌های در جریان — صفی که جلوی یک کار تازه ایستاده.

    rows را می‌شود از بیرون داد تا board دوباره حساب نشود (و بازگشت بی‌پایان نسازد).
    """
    if rows is None:
        rows = board()["results"]
    total = 0.0
    for row in rows:
        if exclude_project_id and row["id"] == str(exclude_project_id):
            continue
        if row["state"] in ("running", "notstarted"):
            total += row["remaining"]
    return round(total, 2)


def _add_working_days(from_date, working_days, ratio):
    """روز کاری را به تاریخ تقویمی تبدیل می‌کند، با نسبت واقعی روزهای کاری."""
    if working_days <= 0:
        return from_date, 0
    calendar_days = int(round(working_days / (ratio or 0.78)))
    return from_date + dt.timedelta(days=calendar_days), calendar_days


def forecast(area, exclude_project_id=None, with_queue=True, from_date=None,
             cap=None, rows=None):
    """چند روز طول می‌کشد و چه تاریخی تمام می‌شود، برای کاری به اندازهٔ area متر.

    دو عدد می‌دهد چون هر دو لازم‌اند: «اگر فقط روی همین کار کنیم» و «با صفِ کارهای
    فعلی». عدد دوم واقعی‌تر است، چون کارگاه یک ظرفیت دارد و همهٔ کارها از آن می‌گذرند.
    """
    area = float(area or 0)
    cap = cap or capacity()
    per_day = cap["perDay"]
    ratio = cap["workingRatio"]
    today = from_date or dt.date.today()

    if per_day <= 0:
        return {"area": round(area, 2), "perDay": 0.0, "enoughHistory": False,
                "queue": 0.0, "alone": None, "withQueue": None,
                "note": "هنوز سابقهٔ کافی برای پیش‌بینی نیست."}

    queue = backlog(exclude_project_id, rows) if with_queue else 0.0
    alone_days = area / per_day
    queued_days = (area + queue) / per_day
    alone_date, alone_cal = _add_working_days(today, alone_days, ratio)
    queued_date, queued_cal = _add_working_days(today, queued_days, ratio)

    return {
        "area": round(area, 2),
        "perDay": per_day,
        "workingRatio": ratio,
        "historyDays": cap["days"],
        # سابقهٔ کم یعنی عدد تقریبی است، نه اینکه جوابی نداریم.
        "enoughHistory": cap["days"] >= 5,
        "note": "" if cap["days"] >= 5 else "سابقه هنوز کم است؛ عدد تقریبی است.",
        "queue": round(queue, 2),
        "alone": {"workingDays": round(alone_days, 1), "calendarDays": alone_cal,
                  "date": alone_date},
        "withQueue": {"workingDays": round(queued_days, 1), "calendarDays": queued_cal,
                      "date": queued_date},
    }


def _attach_promise(fc, due_date):
    """اگر تاریخ تحویل قول داده شده، بگوییم می‌رسیم یا نه."""
    fc["dueDate"] = due_date
    if due_date and fc.get("withQueue"):
        gap = (due_date - fc["withQueue"]["date"]).days
        fc["slackDays"] = gap
        fc["onTime"] = gap >= 0
    return fc


def forecasts():
    """پیش‌بینی پایان همهٔ پروژه‌های در جریان — با یک بار حساب کردن board و ظرفیت."""
    data = board()
    rows = data["results"]
    cap = capacity()
    out = []
    for row in rows:
        if row["state"] not in ("running", "notstarted"):
            continue
        fc = forecast(row["remaining"], exclude_project_id=row["id"], cap=cap, rows=rows)
        fc["projectId"] = row["id"]
        fc["projectName"] = row["name"]
        fc["remaining"] = row["remaining"]
        _attach_promise(fc, row["dueDate"])
        out.append(fc)
    out.sort(key=lambda f: (f.get("slackDays") is None, f.get("slackDays", 0)))
    return {"results": out, "capacity": cap,
            "backlog": backlog(rows=rows), "totals": data["totals"]}


def project_forecast(project, cap=None):
    """پیش‌بینی پایان یک پروژهٔ موجود، از روی کار باقیمانده‌اش."""
    done_map = _progress_by_project([DONE_STATUS])
    pending_map = _progress_by_project(PENDING_STATUSES)
    row = project_status(project, done_map, pending_map)
    fc = forecast(row["remaining"], exclude_project_id=project.pk, cap=cap)
    fc["projectId"] = str(project.pk)
    fc["projectName"] = project.name
    fc["remaining"] = row["remaining"]
    return _attach_promise(fc, project.due_date)
