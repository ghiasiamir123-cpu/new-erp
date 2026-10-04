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

from .models import (DailyReport, MaterialUsage, ProductionSettings, Project, ProjectStage,
                     ReportItem, ReportProgress, WorkStage)

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


def progress_maps():
    """(انجام‌شده، منتظر تأیید، وزن‌ها) — یک بار برای کل فهرست پروژه‌ها."""
    return (_progress_by_project([DONE_STATUS]), _progress_by_project(PENDING_STATUSES),
            stage_weights())


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

    # سهم هر مرحله از مبلغ قرارداد، به نسبت وزنش. «کسب‌شده» همان پیشرفت وزنی است
    # ضربدر مبلغ — یعنی چقدر از قرارداد را می‌شود تا امروز صورتحساب کرد.
    #
    # پول از کسرِ دقیق حساب می‌شود، نه از درصدِ گردشده: درصد به یک رقم اعشار گرد می‌شود
    # و روی ۱۰۰ میلیون ۴۷ هزار ریال گم می‌کرد — و جمعِ کل با جمعِ مراحل نمی‌خواند.
    price = float(project.price) if project.price else 0.0
    if price and total_w:
        for s in stages:
            w = weights.get(s["name"], 0.0)
            if not w:
                s["priceShare"], s["earned"] = 0, 0
                continue
            done_frac = (min(s["done"] / s["planned"], 1.0) if s["planned"] > 0
                         else (1.0 if s["done"] > 0 else 0.0))
            s["priceShare"] = round(price * w / total_w)
            s["earned"] = round(price * w / total_w * done_frac)
    if not price:
        earned = 0
    elif total_w:
        earned = round(price * got / total_w)
    else:
        earned = round(price * min(tot_done / tot_plan, 1.0)) if tot_plan else 0
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
        "price": price, "earned": earned, "unearned": round(max(price - earned, 0)),
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
        # مبالغ قرارداد — فقط پروژه‌هایی که مبلغ دارند
        "price": round(sum(r["price"] for r in rows)),
        "earned": round(sum(r["earned"] for r in rows)),
        "unearned": round(sum(r["unearned"] for r in open_rows)),
        "priced": sum(1 for r in rows if r["price"]),
        "projects": len(rows),
        "closed": sum(1 for r in rows if r["state"] == "closed"),
        "needSetup": sum(1 for r in rows if r["state"] == "nosetup"),
        "withIssues": sum(1 for r in rows if r["issues"]),
        # پروژهٔ غیرفعال از صفحه پنهان است؛ بی این عدد، کاربر فکر می‌کند گم شده.
        "hiddenInactive": hidden,
    }
    return {"results": rows, "totals": totals}


# ============ قیمت‌گذاری ============

def _unit_price(sku):
    """قیمت تمام‌شدهٔ هر واحد اصلی. قیمت فروش نه — آن هزینه را بیش از واقع نشان می‌دهد."""
    if sku is None:
        return 0.0
    return _f(sku.cost_price) or _f(sku.purchase_price)


def _to_base_qty(sku, qty, unit):
    """مقدار مصرف را به واحد اصلیِ کالا برمی‌گرداند، یا None اگر واحد نامعلوم است.

    بدون این، ۲۵ کیلو رنگ از حلبِ ۲۵ کیلویی ۲۵ حلب قیمت می‌خورد.
    """
    unit = (unit or "").strip()
    if not unit or unit == (sku.base_unit or "").strip():
        return qty
    if unit == (sku.alt_unit or "").strip() and sku.alt_to_base:
        return qty * _f(sku.alt_to_base)
    return None


def material_rate():
    """هزینهٔ مواد بر هر متر چوب، از مصرفِ واقعیِ پروژه‌های گذشته.

    فقط مرجع است، با پوششش: ردیفی که کالایش قیمت ندارد یا واحدش تبدیل‌پذیر نیست، از
    حساب بیرون می‌ماند و هزینه را کم نشان می‌دهد. هر چه پوشش کمتر، عدد بی‌اعتبارتر.
    """
    wood = {p.pk: float(p.base_area) for p in Project.objects.filter(general=False)
            if p.base_area and p.base_area > 0}
    lines = (MaterialUsage.objects
             .filter(report__status="approved", project_id__in=list(wood))
             .select_related("sku"))

    cost = defaultdict(float)
    total = priced = 0
    missing = {}
    for u in lines:
        total += 1
        price = _unit_price(u.sku)
        qty = _to_base_qty(u.sku, _f(u.quantity) * u.sign, u.unit) if u.sku else None
        if price and qty is not None:
            priced += 1
            cost[u.project_id] += price * qty
            continue
        key = u.sku_id or f"name:{u.material_name}"
        row = missing.setdefault(key, {
            "name": (u.sku.warehouse_name or u.sku.site_name) if u.sku else u.material_name,
            "code": u.sku.warehouse_code if u.sku else u.material_code,
            "unit": u.unit, "lines": 0, "qty": 0.0,
            "reason": ("بی کالای انبار" if not u.sku else
                       "قیمت ندارد" if not price else "واحد تبدیل‌پذیر نیست")})
        row["lines"] += 1
        row["qty"] += _f(u.quantity)

    used = [pid for pid in wood if cost.get(pid)]
    area = sum(wood[p] for p in used)
    spent = sum(cost[p] for p in used)
    return {
        "perM2": round(spent / area) if area else 0,
        "coverage": round(priced / total * 100, 1) if total else 0.0,
        "pricedLines": priced, "totalLines": total,
        "projects": len(used), "sampleArea": round(area, 2),
        "missing": sorted(missing.values(), key=lambda r: -r["lines"]),
    }


def quote(base_area, stages, margin_percent=None, labour_rate=None, material_per_m2=None):
    """قیمت یک کار: دستمزد + مواد + سود.

    وزنِ اهمیت اینجا نمی‌آید. هزینه از زمان و مواد درمی‌آید، نه از اهمیت — وگرنه مرحله‌ای
    که کوتاه ولی حساس است گران‌تر از هزینهٔ واقعی‌اش قیمت می‌خورد. وزن فقط برای تقسیمِ
    قیمتِ نهایی بین مراحل به کار می‌رود (سهم هر مرحله، برای صورتحساب مرحله‌ای).

    stages: [{"name": .., "coefficient": ..}]
    """
    st = ProductionSettings.get()
    # labour: میانگین کارگاه — فقط برای کارگرِ بی‌نرخ به کار می‌رود. هر کس نرخ خودش را
    # دارد، پس مرحله‌ای که کارگر ارزان‌تر انجامش می‌دهد ارزان‌تر هم قیمت می‌خورد.
    labour = _f(labour_rate) if labour_rate is not None else _f(st.labour_cost_per_hour)
    material = _f(material_per_m2) if material_per_m2 is not None else _f(st.material_cost_per_m2)
    margin = _f(margin_percent) if margin_percent is not None else _f(st.margin_percent)
    base = _f(base_area)

    rates = stage_time_rates(with_cost=True, fallback_rate=labour)
    weights = stage_weights()

    # نرخ مؤثرِ هر مرحله (دستمزد ÷ ساعت) از سابقهٔ همان مرحله می‌آید؛ ساعت اول گرد می‌شود
    # و دستمزد از همان ساعتِ نشان‌داده‌شده × نرخ مؤثر، تا جمع ستون‌ها دستی هم بخواند.
    rows, hours_total, labour_cost, w_total = [], 0.0, 0, 0.0
    rated_h = 0.0
    for s in stages or []:
        name = (s.get("name") or "").strip()
        coef = _f(s.get("coefficient")) or 1.0
        work = round(base * coef, 2)
        rate = (rates.get(name) or {})
        h = round(work * rate["hoursPerM2"], 2) if rate.get("hoursPerM2") else None
        w = weights.get(name, 0.0)
        hour_rate = rate.get("hourRate") or 0
        stage_labour = round(h * hour_rate) if h is not None else 0
        rows.append({"name": name, "coefficient": coef, "work": work, "hours": h,
                     "measured": bool(rate.get("measured")), "hourRate": hour_rate,
                     "ratedShare": rate.get("ratedShare", 0.0),
                     "labour": stage_labour, "weight": w})
        hours_total += h or 0.0
        rated_h += (h or 0.0) * (rate.get("ratedShare") or 0.0) / 100
        labour_cost += stage_labour
        w_total += w
    material_cost = round(base * material)
    subtotal = labour_cost + material_cost
    price = round(subtotal * (1 + margin / 100))
    for r in rows:
        r["priceShare"] = round(price * r["weight"] / w_total) if w_total else 0

    missing = []
    if any(r["hours"] and not r["hourRate"] for r in rows):
        missing.append("نه نرخ کارگرها وارد شده نه میانگین هزینهٔ ساعتی کارگاه")
    elif not labour and any(r["hours"] and r["ratedShare"] < 100 for r in rows):
        missing.append("بعضی کارگرها نرخ ندارند و میانگین کارگاه هم وارد نشده — "
                       "ساعت آن‌ها بی‌هزینه حساب شد")
    if not material:
        missing.append("هزینهٔ مواد برای هر متر وارد نشده")
    if any(r["hours"] is None for r in rows):
        missing.append("بعضی مراحل نرخ زمانی ندارند")

    return {
        "baseArea": round(base, 2),
        "workArea": round(sum(r["work"] for r in rows), 2),
        "hours": round(hours_total, 2),
        "labourRate": round(labour), "materialPerM2": round(material), "marginPercent": margin,
        # میانگینِ مؤثر: دستمزد ÷ ساعت، با ترکیبِ واقعیِ کارگرهای هر مرحله
        "effectiveRate": round(labour_cost / hours_total) if hours_total else 0,
        # چند درصدِ ساعت‌ها با نرخ خودِ کارگر حساب شد (بقیه با میانگین کارگاه)
        "ratedShare": round(rated_h / hours_total * 100, 1) if hours_total else 0.0,
        # ساعتِ جمع از ساعت‌های گردشدهٔ مراحل است، پس با جمعِ ستون مراحل می‌خواند.
        "labour": labour_cost, "material": material_cost, "subtotal": subtotal,
        "margin": price - subtotal, "price": price,
        "perM2": round(price / base) if base else 0,
        "stages": rows, "missing": missing,
        "estimatedStages": sum(1 for r in rows if r["hours"] is not None and not r["measured"]),
    }


# ============ نرخ زمانی مراحل ============

def norm_name(s):
    """نام برای تطبیق: ی/ک عربی، نیم‌فاصله و فاصله‌های اضافه یکسان می‌شوند."""
    s = (s or "").replace("ي", "ی").replace("ى", "ی").replace("ك", "ک").replace("‌", " ")
    return " ".join(s.split())


def personal_rates():
    """{نامِ یکسان‌شده: هزینهٔ هر ساعت} برای کارگرهایی که نرخ دارند."""
    from .models import Employee
    return {norm_name(e.name): float(e.hourly_cost)
            for e in Employee.objects.filter(hourly_cost__gt=0)}


def _time_data(fallback_rate=0.0):
    """داده‌ی خام نرخ‌ها: متراژ، ساعت و هزینهٔ دستمزدِ هر مرحله، و مقیاس ضریب زمان.

    فقط ساعت‌هایی شمرده می‌شوند که همان پروژه برای همان مرحله متراژ هم ثبت کرده؛ وگرنه
    پروژه‌هایی مثل کاسیان که ۱۷۹ ساعت کار ولی صفر متراژ دارند، نرخ را بی‌جهت بالا می‌بردند.

    دستمزد هر ساعت با نرخِ همان کارگر حساب می‌شود؛ کارگرِ بی‌نرخ با fallback_rate.
    """
    stages = {s.name: s for s in WorkStage.objects.filter(active=True, needs_area=True)}

    area = defaultdict(float)
    has_area = set()
    for r in (ReportProgress.objects
              .filter(report__status=DONE_STATUS, project__isnull=False, project__general=False)
              .values("project_id", "stage").annotate(a=Sum("area"))):
        a = _f(r["a"])
        if a > 0:
            area[r["stage"]] += a
            has_area.add((r["project_id"], r["stage"]))

    rates = personal_rates()
    hours, cost, rated = defaultdict(float), defaultdict(float), defaultdict(float)
    for it in (ReportItem.objects
               .filter(report__status=DONE_STATUS, project__isnull=False, project__general=False)
               .values("project_id", "activity", "hours", "employee")):
        key = (it["project_id"], (it["activity"] or "").strip())
        if key not in has_area:
            continue
        h = _f(it["hours"])
        hours[key[1]] += h
        own = rates.get(norm_name(it["employee"]))
        if own:
            rated[key[1]] += h
        cost[key[1]] += h * (own or fallback_rate)

    measured = {n: hours[n] / area[n] for n in stages if area.get(n, 0) > 0 and hours.get(n, 0) > 0}

    # مقیاس: ساعتِ واقعی به ازای یک واحدِ ضریب زمانِ دستی، روی مراحلی که هر دو را دارند.
    num = sum(hours[n] for n in measured)
    den = sum(area[n] * float(stages[n].time_weight or 0) for n in measured)
    scale = num / den if den else None
    return {"stages": stages, "area": area, "hours": hours, "cost": cost, "rated": rated,
            "measured": measured, "scale": scale}


def stage_time_rates(with_cost=False, fallback_rate=None):
    """ساعتِ لازم برای هر متر کار، به تفکیک مرحله — و با with_cost، دستمزدِ هر متر.

    از سابقهٔ واقعی درمی‌آید، نه از ضریب زمانِ دستی — آن ضریب خیلی صاف‌تر از واقعیت بود
    (پرداخت میانی را ۱٫۲۵ برابر رنگ رویه گرفته بود، در حالی که واقعاً ۳ برابر است).

    مرحلهٔ بی‌سابقه از ضریب زمانِ دستی‌اش تخمین زده می‌شود، به مقیاسِ داده برگردانده؛
    دستمزدش با میانگینِ واقعیِ کارگاه (ساعت‌وزنی) حساب می‌شود.
    """
    if fallback_rate is None:
        fallback_rate = _f(ProductionSettings.get().labour_cost_per_hour)
    d = _time_data(fallback_rate)
    stages, area, hours, measured, scale = (d["stages"], d["area"], d["hours"],
                                            d["measured"], d["scale"])
    # میانگین ساعت‌وزنیِ کارگاه، برای مراحل بی‌سابقه. بی میانگینِ دستی، فقط ساعت‌هایی که
    # نرخ دارند در مخرج می‌آیند؛ وگرنه ساعتِ بی‌نرخ (صفر ریال) میانگین را پایین می‌کشید.
    all_cost = sum(d["cost"][n] for n in measured)
    denom = (sum(hours[n] for n in measured) if fallback_rate
             else sum(d["rated"][n] for n in measured))
    avg_rate = (all_cost / denom) if denom else fallback_rate

    out = {}
    for n, s in stages.items():
        if n in measured:
            row = {"hoursPerM2": round(measured[n], 4), "measured": True,
                   "sampleArea": round(area[n], 2), "sampleHours": round(hours[n], 2)}
            if with_cost:
                row["costPerM2"] = round(d["cost"][n] / area[n], 2)
                row["hourRate"] = round(d["cost"][n] / hours[n])
                row["ratedShare"] = round(d["rated"][n] / hours[n] * 100, 1)
        elif scale and s.time_weight:
            hpm = float(s.time_weight) * scale
            row = {"hoursPerM2": round(hpm, 4), "measured": False,
                   "sampleArea": 0.0, "sampleHours": 0.0}
            if with_cost:
                row["costPerM2"] = round(hpm * avg_rate, 2)
                row["hourRate"] = round(avg_rate)
                row["ratedShare"] = 0.0
        else:
            row = {"hoursPerM2": None, "measured": False, "sampleArea": 0.0, "sampleHours": 0.0}
            if with_cost:
                row["costPerM2"], row["hourRate"], row["ratedShare"] = None, round(avg_rate), 0.0
        out[n] = row
    return out


def stage_calibration():
    """ضریب‌های فعلی در برابر آنچه داده‌ی واقعی نشان می‌دهد — برای دقیق‌کردن ضریب‌ها.

    · ضریب (دست روی هر متر چوب): متراژِ کارِ انجام‌شدهٔ مرحله ÷ متراژ چوب، فقط در پروژه‌هایی
      که آن مرحله در آن‌ها تمام شده (تیک انجام یا پروژهٔ بسته‌شده با «کار تکمیل شد»).
      مرحلهٔ نیمه‌کاره ضریب را کمتر از واقع نشان می‌داد.
    · ضریب زمان: ساعت واقعی بر متر، به همان مقیاسِ جدول ضریب زمان برگردانده، تا دو عدد
      کنار هم معنا داشته باشند.
    """
    d = _time_data()
    stages, scale = d["stages"], d["scale"]

    done = _progress_by_project((DONE_STATUS,))
    wood = defaultdict(float)
    work = defaultdict(float)
    count = defaultdict(int)
    finished = (ProjectStage.objects
                .filter(project__general=False, project__base_area__gt=0, name__in=list(stages))
                .select_related("project"))
    for ps in finished:
        p = ps.project
        complete = ps.done or (p.closed_at and p.close_reason == Project.CloseReason.COMPLETED)
        if not complete:
            continue
        a = done.get(p.pk, {}).get(ps.name, 0.0)
        if a <= 0:      # تمام شده ولی متراژش ثبت نشده — داده‌ی ناقص، نه ضریب صفر
            continue
        wood[ps.name] += float(p.base_area)
        work[ps.name] += a
        count[ps.name] += 1

    def variance(actual, planned):
        return round((actual - planned) / planned * 100, 1) if planned and actual is not None else None

    rows = []
    for n, s in stages.items():
        coef = float(s.default_coefficient or 1)
        act_coef = round(work[n] / wood[n], 2) if wood.get(n) else None
        tw = float(s.time_weight or 0)
        hpm = d["measured"].get(n)
        act_tw = round(hpm / scale, 2) if (hpm and scale) else None
        rows.append({
            "name": n, "order": s.order,
            "coefficient": coef, "actualCoefficient": act_coef,
            "coefficientVariance": variance(act_coef, coef),
            "coefProjects": count[n], "coefWood": round(wood[n], 2), "coefWork": round(work[n], 2),
            "timeWeight": tw, "actualTimeWeight": act_tw,
            "timeVariance": variance(act_tw, tw),
            "hoursPerM2": round(hpm, 3) if hpm else None,
            "sampleHours": round(d["hours"].get(n, 0.0), 2),
            "sampleArea": round(d["area"].get(n, 0.0), 2),
        })
    rows.sort(key=lambda r: r["order"])
    return {"stages": rows, "scale": round(scale, 4) if scale else None}


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

    # امتیاز عملکرد: متراژ × اهمیت × ساعتِ لازم برای هر متر.
    #   متراژ × ساعتِ لازم = ساعتی که کارگاه به‌طور متوسط برای همین کار صرف می‌کند.
    #   پس امتیاز ÷ ساعتِ واقعی = اهمیت × (ساعتِ متوسط ÷ ساعتِ واقعی)
    #                          = اهمیتِ کار × سرعتِ نسبیِ نفر.
    # سختیِ مرحله خودش حذف می‌شود: کسی که کارِ کُند (پرداخت) می‌کند دیگر کم‌بازده دیده
    # نمی‌شود، که در «متر بر ساعت» سه برابر عقب‌تر از رنگ‌کار به نظر می‌رسید.
    rates = stage_time_rates()
    importance = {s.name: float(s.importance or 0) for s in WorkStage.objects.all()}

    people = []
    for name in sorted(set(area_by_person) | set(hours_by_person)):
        area = area_by_person.get(name, 0.0)
        hours = hours_by_person.get(name, 0.0)
        area_hours = area_hours_by_person.get(name, 0.0)
        other_hours = max(hours - area_hours, 0.0)
        nd = len(days_by_person.get(name, ()))

        score = expected = 0.0
        for stage, a in stage_by_person.get(name, {}).items():
            h = (rates.get(stage) or {}).get("hoursPerM2")
            if not h:
                continue
            expected += a * h
            score += a * importance.get(stage, 0.0) * h

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
            "score": round(score, 2),
            "scorePerHour": round(score / area_hours, 3) if area_hours else 0.0,
            # بالای ۱ یعنی سریع‌تر از متوسطِ کارگاه برای همان کار.
            "efficiency": round(expected / area_hours, 3) if area_hours else 0.0,
            "expectedHours": round(expected, 2),
            "stages": {k: round(v, 2) for k, v in sorted(stage_by_person.get(name, {}).items())},
        })
    people.sort(key=lambda r: -r["score"])

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
        "rates": rates,
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


def forecasts(data=None, cap=None):
    """پیش‌بینی پایان همهٔ پروژه‌های در جریان — با یک بار حساب کردن board و ظرفیت."""
    data = data or board()
    rows = data["results"]
    cap = cap or capacity()
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


# ============ نبض تولید (داشبورد) ============

def throughput(period="day", end=None):
    """متراژِ کارِ هر مرحله در یک روز یا هفتهٔ منتهی به end، در برابر هدف همان مرحله.

    تأییدشده و در انتظار تأیید جدا می‌آیند: گزارشِ امروز معمولاً هنوز تأیید نشده، و اگر
    فقط تأییدشده شمرده شود داشبوردِ صبح همیشه صفر است.

    هدفِ هفته = هدف روزانه × روزهای کاریِ آن هفته، یعنی روزهایی که گزارش دارند؛ تعطیلی
    هدف را بالا نمی‌برد. هفته‌ای که هنوز هیچ گزارشی ندارد با نسبت روزهای کاریِ سابقه
    حساب می‌شود.
    """
    end = end or dt.date.today()
    start = end if period == "day" else end - dt.timedelta(days=6)

    stages = list(WorkStage.objects.filter(active=True, needs_area=True))
    done, pending = defaultdict(float), defaultdict(float)
    for r in (ReportProgress.objects
              .filter(report__date__range=(start, end))
              .exclude(project__general=True)
              .values("stage", "report__status").annotate(a=Sum("area"))):
        if r["report__status"] == DONE_STATUS:
            done[r["stage"]] += _f(r["a"])
        elif r["report__status"] in PENDING_STATUSES:
            pending[r["stage"]] += _f(r["a"])

    if period == "day":
        days = 1
    else:
        dates = set(DailyReport.objects.filter(date__range=(start, end))
                    .values_list("date", flat=True))
        days = len(dates) or max(round(7 * working_ratio()), 1)

    rows = []
    for s in stages:
        target = _f(s.daily_target) * days
        d, p = done.get(s.name, 0.0), pending.get(s.name, 0.0)
        rows.append({
            "name": s.name, "order": s.order,
            "done": round(d, 2), "pending": round(p, 2), "total": round(d + p, 2),
            "target": round(target, 2) if target else None,
            "percent": round((d + p) / target * 100, 1) if target else None,
        })
    return {"period": period, "from": start, "to": end, "workingDays": days,
            "stages": rows, "hasTargets": any(r["target"] for r in rows)}


def bottlenecks(rows, cap):
    """متراژی که پشت هر مرحله منتظر مانده — گلوگاه خط.

    برای هر پروژهٔ در جریان، مراحلِ برنامه به ترتیب خط چیده می‌شوند. آنچه مرحلهٔ قبل
    تمام کرده ولی این مرحله هنوز رویش کار نکرده، منتظرِ این مرحله است. چون متراژِ هر
    مرحله ضربدر ضریب خودش است (استر دو دست دارد)، مقایسه با کسرِ انجام‌شده است نه متر:
    اگر پرداخت قبل از استر ۶۰٪ جلو رفته و استر ۲۰٪، ۴۰٪ از متراژِ استر منتظر است.
    برای مرحلهٔ اول کلِ باقیمانده‌اش منتظر است.

    «روز تا خالی شدن» = منتظر ÷ متراژِ روزانهٔ واقعیِ همان مرحله؛ بیشترینش گلوگاه است.
    """
    order = {s.name: s.order for s in WorkStage.objects.filter(active=True, needs_area=True)}
    waiting, remaining = defaultdict(float), defaultdict(float)
    who = defaultdict(list)
    for r in rows:
        if r["state"] not in ("running", "notstarted"):
            continue
        line = sorted((s for s in r["stages"]
                       if s["inPlan"] and s["planned"] > 0 and s["name"] in order),
                      key=lambda s: order[s["name"]])
        before = 1.0
        for s in line:
            frac = 1.0 if s["closed"] else min(s["done"] / s["planned"], 1.0)
            if not s["closed"]:
                remaining[s["name"]] += s["remaining"]
            w = max(before - frac, 0.0) * s["planned"]
            if w > 0.01:
                waiting[s["name"]] += w
                who[s["name"]].append({"project": r["name"], "area": round(w, 2)})
            before = frac

    per_day = cap.get("perStagePerDay", {})
    out = []
    for name in sorted(order, key=order.get):
        w = waiting.get(name, 0.0)
        speed = per_day.get(name) or 0.0
        out.append({
            "name": name, "waiting": round(w, 2), "remaining": round(remaining.get(name, 0.0), 2),
            "perDay": speed, "daysToClear": round(w / speed, 1) if speed and w else None,
            "projects": sorted(who.get(name, []), key=lambda x: -x["area"]),
        })
    ranked = [o for o in out if o["waiting"] > 0]
    worst = max(ranked, key=lambda o: (o["daysToClear"] or 0, o["waiting"]), default=None)
    return {"stages": out, "bottleneck": worst["name"] if worst else None}


def pulse(period="day", end=None):
    """همهٔ عددهای داشبوردِ تولید با یک بار حساب کردن board و ظرفیت."""
    data = board()
    cap = capacity()
    fc = forecasts(data, cap)
    open_rows = [r for r in data["results"] if r["state"] in ("running", "notstarted")]
    promises = [{
        "projectId": f["projectId"], "projectName": f["projectName"],
        "remaining": f["remaining"], "dueDate": f.get("dueDate"),
        "forecastDate": (f.get("withQueue") or {}).get("date"),
        "aloneDate": (f.get("alone") or {}).get("date"),
        "slackDays": f.get("slackDays"), "onTime": f.get("onTime"),
    } for f in fc["results"]]
    calib = stage_calibration()
    return {
        "throughput": throughput(period, end),
        "promises": promises,
        "withoutDueDate": sum(1 for r in open_rows if not r["dueDate"]),
        "enoughHistory": cap["days"] >= 5,
        "bottlenecks": bottlenecks(data["results"], cap),
        "stageTimes": [{
            "name": s["name"], "timeWeight": s["timeWeight"],
            "actualTimeWeight": s["actualTimeWeight"], "timeVariance": s["timeVariance"],
            "hoursPerM2": s["hoursPerM2"], "sampleHours": s["sampleHours"],
            "coefficient": s["coefficient"], "actualCoefficient": s["actualCoefficient"],
            "coefficientVariance": s["coefficientVariance"],
        } for s in calib["stages"]],
    }


def area_gaps(days=60, today=None):
    """روزهایی که برای یک پروژه/مرحله کارکرد پرسنل ثبت شده ولی متراژی نه.

    بدون متراژ، ساعتِ آن روز در نرخ‌ها و بهره‌وری بی‌جفت می‌ماند و عددها را خراب می‌کند.
    تطبیق بر اساس «روز» است، نه «گزارش»: متراژ و نفرات اغلب در دو گزارش جدا ثبت می‌شوند.
    کار عمومی کارگاه، پروژهٔ بی‌متراژ، مرحله‌ای که متراژ نمی‌خواهد و دوباره‌کاری شمرده نمی‌شوند.
    """
    since = (today or dt.date.today()) - dt.timedelta(days=days)
    area_stages = set(WorkStage.objects.filter(needs_area=True).values_list("name", flat=True))
    done = {(r["report__date"], r["project_id"], r["stage"])
            for r in (ReportProgress.objects.filter(report__date__gte=since, area__gt=0)
                      .values("report__date", "project_id", "stage"))}
    hours, people = defaultdict(float), defaultdict(set)
    names = {}
    for it in (ReportItem.objects
               .filter(report__date__gte=since, hours__gt=0, project__isnull=False, rework=False,
                       project__general=False, project__no_area=False, activity__in=area_stages)
               .values("report__date", "project_id", "project__name", "project__code", "activity",
                       "employee", "hours")):
        key = (it["report__date"], it["project_id"], it["activity"])
        if key in done:
            continue
        hours[key] += _f(it["hours"])
        people[key].add(it["employee"])
        names[it["project_id"]] = (it["project__name"], it["project__code"])
    by_day = defaultdict(list)
    for (day, pid, stage), h in hours.items():
        by_day[day].append({"project": str(pid), "projectName": names[pid][0], "projectCode": names[pid][1],
                            "stage": stage, "hours": round(h, 2), "people": sorted(people[(day, pid, stage)])})
    return [{"date": day.isoformat(),
             "rows": sorted(rows, key=lambda r: (r["projectName"], r["stage"]))}
            for day, rows in sorted(by_day.items(), reverse=True)]
