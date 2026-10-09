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
import copy
import datetime as dt
import itertools
import json
import math
import time
import types
from collections import defaultdict
from decimal import ROUND_UP, Decimal

from django.db import transaction
from django.db.models import Count, Max, Min, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import production
from .models import ProductionSettings
from .models import (DailyReport, Employee, PlanBaselineLine, PlanChange, PlanCommit, PlanHoliday, PlanLeave,
                     PlanOvertime, PlanQueueSnapshot, PlanRework, PlanStationOff, PlanTask, Project, ProjectPause,
                     ProjectStage, ReportItem, ReportProgress, Station, WorkStage)

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
OPEN_END = dt.date(2099, 12, 31)  # «تا اطلاعِ بعدی»: کارِ عمومی‌ای که پایانش معلوم نیست، با این تاریخِ پایان نگه داشته می‌شود
ALL = "*"                         # کارِ عمومی برای «کلِ کارگاه»: به‌جای نامِ یک نفر در PlanLeave.employee
SITE = "site"                     # «ایستگاهِ» کارهایی که در محلِ پروژه انجام می‌شود (نه در کارگاه)
SITE_NAME = "محل پروژه"
SITE_TEAM = 4                     # تیمِ محل بیش از این نمی‌شود
COAT_ROUNDS = 2                   # استر و رنگِ هر پروژه در نهایت در این چند نوبت زده می‌شود (کارِ رنگ‌شده آسیب‌پذیر است)
EFF_STEP = 5                      # پلهٔ پیشنهادیِ بالا بردنِ هدفِ بهره‌وری (درصد)
EFF_WEEKS = 12                    # روندِ بهره‌وری تا چند هفته پیش
EFF_WINDOW = 4                    # «الان» و «قبل» هر کدام چند هفته
SITE_SPEED = 0.75                 # کار در محلِ پروژه کندتر از کارگاه است (رفت‌وآمد، نبودِ ابزارِ کارگاه): سهمی از سرعتِ کارگاه
WHATIF_OVERTIME = 2.0            # «اگر هر روز دو ساعت اضافه‌کاری باشد»
WHATIF_STATIONS = 7              # دنبالِ بهترین جای نفرِ اضافه فقط میانِ همین چند ایستگاهِ پرکار می‌گردد
WHATIF_BUDGET = 6.0              # ثانیه؛ بیش از این دنبالِ ترکیبِ بهتر نمی‌گردد


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


def _int(value):
    """شناسهٔ عددی، یا None. «²» و مانندش برای پایتون «رقم» است ولی عدد نیست؛ فهرست و بولی هم شناسه نیستند."""
    if isinstance(value, (bool, list, tuple, dict, float)) or value is None:
        return None
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return n if 0 < n < 2 ** 31 else None


_FA_DIGITS = str.maketrans("0123456789.", "۰۱۲۳۴۵۶۷۸۹٫")


def _fa(text):
    """عددهای یک پیامِ فارسی با رقمِ فارسی."""
    return str(text).translate(_FA_DIGITS)


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
        # «کار عمومی در وقتِ بی‌کاری»: روز -> نام -> [حداکثر ساعت یا None (هر چه بی‌کار بود)، چه کاری]. از توان کم نمی‌کند.
        # هر ردیف یک کار است: روز -> [(شناسهٔ ردیف، نام یا ALL، حداکثر ساعت یا None، چه کاری، تا اطلاعِ بعدی؟)]
        self.fill = defaultdict(list)
        # کارِ عمومیِ «تا اطلاعِ بعدی»: [(شناسه، نام، از روز، ساعت، نوع، چه کاری)]. روز به روز نوشته نمی‌شود؛ day() هر روز رویش می‌گذارد.
        self.standing = []
        # کارِ عمومیِ واجب برای کلِ کارگاه: روز -> [ساعت یا None (کلِ روز)] — فقط برای نمایش؛ خودش روی تک‌تکِ نفرات می‌نشیند.
        self.all_hands = defaultdict(list)
        names = set(employees)
        for lv in PlanLeave.objects.all():
            everyone = lv.employee == ALL and lv.kind != PlanLeave.Kind.LEAVE
            if lv.employee not in names and not everyone:
                continue
            h = float(lv.hours) if lv.hours else None
            if lv.date_to >= OPEN_END:
                self.standing.append((lv.pk, lv.employee, lv.date_from, h, lv.kind, lv.note))
                continue
            d = lv.date_from
            while d <= lv.date_to:
                if lv.kind == PlanLeave.Kind.FILL:
                    self.fill[d].append((lv.pk, lv.employee, h, lv.note, False))
                else:
                    self.put(d, lv.employee, h, lv.kind)
                d += dt.timedelta(days=1)

    @staticmethod
    def merge(rows, name, h, kind):
        """مرخصی یا کارِ عمومیِ این نفر در یک روز (h خالی = کلِ روز). دو ردیفِ یک نفر در یک روز جمع می‌شوند."""
        was = rows.get(name)
        if was is None:
            rows[name] = [h, kind]
        elif PlanLeave.Kind.LEAVE in ((was[1] if was[0] is None else None), (kind if h is None else None)):
            was[0], was[1] = None, PlanLeave.Kind.LEAVE     # یکی از ردیف‌ها مرخصیِ کلِ روز است: آن روز نیست
        elif was[0] is None or h is None:
            was[0], was[1] = None, PlanLeave.Kind.GENERAL   # کلِ روز کارِ عمومی، با چند ساعت مرخصی هم همان است
        else:
            was[0] += h

    def put(self, d, name, h, kind):
        """مرخصی یا کارِ عمومیِ این نفر (یا با ALL، کارِ عمومیِ همهٔ کارگاه) در این روز."""
        if name == ALL:
            self.all_hands[d].append(h)
        for n in (dict.fromkeys(self.employees) if name == ALL else [name]):
            self.merge(self.away[d], n, h, kind)

    def day(self, day):
        base = 0.0 if day in self.holidays else day_hours(day)
        extra = self.overtime[day][0] if day in self.overtime else 0.0
        rows, fill, hands = self.away.get(day, {}), list(self.fill.get(day, ())), list(self.all_hands.get(day, ()))
        if any(r[2] <= day for r in self.standing):
            rows = {n: list(v) for n, v in rows.items()}
            for rid, name, start, h, kind, note in self.standing:
                if start > day:
                    continue
                if kind == PlanLeave.Kind.FILL:
                    fill.append((rid, name, h, note, True))
                    continue
                if name == ALL:
                    hands.append(h)
                for n in (dict.fromkeys(self.employees) if name == ALL else [name]):
                    self.merge(rows, n, h, kind)
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
        # چند نفر امروز می‌توانند سرِ کارِ پروژه باشند: حاضران منهای کسانی که کلِ روز کارِ عمومی دارند؛ در روزی که فقط
        # اضافه‌کاری است، همان‌هایی که می‌مانند.
        chores = sum(1 for n, (h, _) in rows.items() if h is None and n not in gone)
        staying = sum((min(people, present) if people else present) for _, people in self._ot_people.get(day, []))
        heads = max(present - chores if base else 0, min(present, staying))
        # توانِ هر نفر در این روز (نفر-روز): ساعتِ عادی‌اش منهای مرخصی و کارِ عمومی، به‌اضافهٔ اضافه‌کاری‌ای که «همه»
        # می‌مانند. اضافه‌کاری‌ای که فقط چند نفرش گفته شده (معلوم نیست چه کسانی) جدا می‌ماند: anon.
        caps, anon, anon_heads, regular = {}, 0.0, 0, {}
        for n in self.employees:
            row = rows.get(n)
            lost_n = base if n in gone else 0.0 if row is None else base if row[0] is None else min(row[0], base)
            caps[n] = caps.get(n, 0.0) + max(base - lost_n, 0.0) / DAY_HOURS
            regular[n] = max(base - lost_n, 0.0)             # ساعتِ عادی‌ای که سرِ کار است (بی اضافه‌کاری)
        for hours, people in self._ot_people.get(day, []):
            if people:
                anon += min(people, present) * hours / DAY_HOURS
                anon_heads += min(people, present)
        # اضافه‌کاریِ «همه»: اگر برای یک روز دو بار ثبت شده باشد، هر کس به‌اندازهٔ بلندترینش می‌ماند، نه جمعشان — ساعتِ
        # کارگاه هم همان بلندترین است.
        whole = max((hours for hours, people in self._ot_people.get(day, []) if not people), default=0.0)
        if whole:
            for n in set(self.employees) - gone:
                caps[n] += whole / DAY_HOURS * self.employees.count(n)
        pool = sum(caps.values()) + anon
        return {"base": base, "overtime": extra, "factor": (base + extra) / DAY_HOURS,
                "present": present, "pool": pool, "share": share, "heads": heads,
                "caps": caps, "anon": anon, "anonHeads": anon_heads,
                "leave": sorted(n for n, (h, k) in rows.items() if h is None and k == PlanLeave.Kind.LEAVE),
                "fill": [r for r in fill if r[1] not in gone],
                # کارِ عمومیِ واجبِ کلِ کارگاه در این روز: None = ندارد، وگرنه ساعتش (0 = کلِ روز)
                "everyone": None if not hands else 0 if any(h is None for h in hands) else sum(hands),
                "regular": regular,
                "away": sorted(({"name": n, "hours": h, "kind": k} for n, (h, k) in rows.items()),
                               key=lambda x: (x["kind"], x["name"]))}


def _masters(employees, skills, helper_stages):
    """استادکارها: کسانی که مرحله‌ای را انجام می‌دهند که «کمکی می‌گیرد» (مثلِ رنگ)، وقتی همه آن را بلد نیستند. استادکار
    کارِ عمومی نمی‌گیرد: کارش را کسِ دیگری نمی‌تواند بکند و ساعتش هم گران‌تر است."""
    out, everyone = set(), set(employees)
    for stage in helper_stages:
        lead = {n for n in everyone if not skills.get(n) or stage in skills[n]}
        if lead != everyone:
            out |= lead
    return out


def _master_names():
    rows = list(Employee.objects.filter(active=True).values_list("name", "plan_stages"))
    return _masters([n for n, _ in rows], {n: set(st) for n, st in rows if st},
                    set(WorkStage.objects.filter(helpers_ok=True).values_list("name", flat=True)))


def stage_crews():
    """چند نفر معمولاً هم‌زمان روی هر مرحله کار می‌کنند — از گزارش‌های تأییدشده."""
    per = defaultdict(lambda: defaultdict(set))
    for day, stage, who in (ReportItem.objects
                            .filter(report__status=DailyReport.Status.APPROVED, hours__gt=0, project__general=False)
                            .values_list("report__date", "activity", "employee")):
        per[stage][day].add(who)
    return {stage: max(1, round(sum(len(v) for v in days.values()) / len(days))) for stage, days in per.items()}


def _stations(order, employees=None):
    """ایستگاه‌های کارگاه به ترتیب خط. مرحله‌ای که در هیچ ایستگاهِ تعریف‌شده‌ای نیست، خودش یک ایستگاه است،
    با همان تعداد نفری که سابقه نشان می‌دهد معمولاً رویش کار می‌کنند. از نفراتِ ثابتِ ایستگاه فقط کارگرانِ فعال
    شمرده می‌شوند (employees) و هر کس یک بار."""
    out, covered = [], set()
    known = None if employees is None else set(employees)
    for s in Station.objects.all():
        people = [p for p in dict.fromkeys(s.people or []) if p and (known is None or p in known)]
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


def _site_done(projects):
    """متراژی از هر مرحله که در محلِ پروژه انجام و گزارش شده: {(پروژه، مرحله): متر}.

    متراژ در گزارش یک بار برای هر پروژه/مرحله می‌آید و «کارگاه یا محل» روی ردیفِ نفرات است؛ پس متراژِ هر گزارش به نسبتِ
    ساعتِ ردیف‌های «محل پروژه»ِ همان گزارش و همان مرحله به محل می‌رسد."""
    ids = [int(k) for k in projects]
    hours = defaultdict(lambda: [0.0, 0.0])                # (گزارش، پروژه، مرحله) -> [ساعت در محل، همهٔ ساعت‌ها]
    for rid, pid, stage, where, h, n in (ReportItem.objects
                                         .filter(project_id__in=ids, report__status=DailyReport.Status.APPROVED)
                                         .values_list("report_id", "project_id", "activity", "location")
                                         .annotate(h=Sum("hours"), n=Count("id"))):
        weight = production._f(h) or float(n)             # گزارشِ بی‌ساعت: به شمارِ ردیف‌ها
        hours[(rid, pid, stage)][1] += weight
        if where == ReportItem.Location.ONSITE:
            hours[(rid, pid, stage)][0] += weight
    out = defaultdict(float)
    for rid, pid, stage, area in (ReportProgress.objects
                                  .filter(project_id__in=ids, area__gt=0, report__status=DailyReport.Status.APPROVED)
                                  .values_list("report_id", "project_id", "stage", "area")):
        there, every = hours.get((rid, pid, stage), (0.0, 0.0))
        if there and every:
            out[(str(pid), stage)] += production._f(area) * there / every
    return out


def _site_ratio(project, planned):
    """چه کسری از متراژِ پروژه در محل انجام می‌شود (۰ تا ۱). «همه سر پروژه» یعنی همه؛ وگرنه متراژِ محل بر متراژِ پایه."""
    if project.work_site == Project.WorkSite.ONSITE:
        return 1.0
    area = float(project.onsite_area or 0)
    whole = float(project.base_area or 0) or planned
    return min(area / whole, 1.0) if area > 0 and whole > 0 else 0.0


def _tasks(rows, ctx, sites=None, site_done=None):
    """کار باقیماندهٔ هر پروژه به ترتیب خط، با ایستگاه و سرعتِ هر کار. برمی‌گرداند (کارهای کارگاه، پروژه‌های بی‌مرحله،
    کارهای محلِ پروژه). متراژی که در محلِ پروژه انجام می‌شود از کارِ کارگاه بیرون می‌رود و جدا می‌آید."""
    rates, order, fallback, share, waits = ctx["rates"], ctx["order"], ctx["fallback"], ctx["share"], ctx["waits"]
    stretch = ctx.get("stretch") or 1.0                     # برنامهٔ خط با هدفِ بهره‌وری: همان سرعتِ سابقه × هدف ÷ مبنا
    sites, site_done, away = sites or {}, site_done or {}, {}
    from . import material_consumption as mc
    by_stage = _by_stage(ctx["stations"])
    station = {st["id"]: st for st in ctx["stations"]}
    overrides = {(str(t.project_id), t.stage): t for t in PlanTask.objects.all()}
    targets = {s.name: float(s.daily_target or 0) for s in WorkStage.objects.all()}

    out, skipped, off, lost = {}, [], [], defaultdict(list)
    for r in rows:
        if r["state"] not in OPEN_STATES:
            continue
        for s in r["stages"]:
            if (s["inPlan"] and s["planned"] > 0 and s["name"] not in order and not s["closed"]
                    and s["planned"] - s["done"] >= DUST):
                lost[s["name"]].append(_label_row(r))
        line = sorted((s for s in r["stages"] if s["inPlan"] and s["planned"] > 0 and s["name"] in order),
                      key=lambda s: order[s["name"]])
        if not line:
            skipped.append(r["name"])
            continue
        tasks, there = [], []
        cfg = sites.get(r["id"])
        ratio = _site_ratio(cfg, max(s["planned"] for s in line)) if cfg else 0.0
        on_site = set(cfg.onsite_stages or []) if cfg else set()
        for s in line:
            rate = rates.get(s["name"]) or {}
            hpm = rate.get("hoursPerM2") or fallback
            # بخشی از این مرحله که در محلِ پروژه انجام می‌شود
            part = ratio if ratio and (not on_site or s["name"] in on_site) else 0.0
            if part:
                planned = s["planned"] * part
                did = min(site_done.get((r["id"], s["name"]), 0.0), planned)
                # گزارشی که «محل پروژه» نخورده به حسابِ کارگاه می‌رود؛ هر چه از سهمِ کارگاه بیشتر شد کارِ محل بوده است
                did = min(did + max(s["done"] - did - (s["planned"] - planned), 0.0), planned)
                there.append({
                    "name": s["name"], "planned": planned, "hpm": hpm,
                    "frac": 1.0 if s["closed"] or planned - did < DUST else did / planned,
                    # متر به ازای هر نفر-روزِ تیم در محل
                    "per": DAY_HOURS * share / hpm * SITE_SPEED * stretch if hpm else 0.0,
                    "waitHours": waits.get(s["name"], 0), "dry": dry_days(waits.get(s["name"], 0)),
                    # دستِ آستر یا رنگ: تا فردا خشک نمی‌شود و مرحلهٔ بعد همان روز رویش نمی‌رود
                    "coat": bool(mc._stage_kind(s["name"])),
                })
                s = {**s, "planned": s["planned"] - planned, "done": max(s["done"] - did, 0.0)}
                if s["planned"] < DUST:
                    continue                                   # همهٔ این مرحله در محل است؛ در کارگاه کاری ندارد
            ov = overrides.get((r["id"], s["name"]))
            fixed = bool(ov and ov.station_id and station.get(str(ov.station_id), {}).get("active"))
            if ov and ov.station_id and not fixed:
                gone = station.get(str(ov.station_id), {}).get("name", "")
                off.append(f"{_label_row(r)} · {s['name']}" + (f" (ایستگاه «{gone}»)" if gone else ""))
            sid = str(ov.station_id) if fixed else by_stage[s["name"]]
            own = ov.crew if ov and ov.crew else None             # نفراتی که مسئول برای همین کار گذاشته
            crew = own or station[sid]["crew"]
            # پیشنهاد سیستم: نفراتِ ایستگاه در یک روز کامل، با همان سهمی از وقت که واقعاً صرف کار می‌شود.
            suggested = crew * DAY_HOURS * share / hpm * stretch if hpm else (targets.get(s["name"]) or None)
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
                "color": "", "changeover": ctx["changeover"].get(s["name"], 0.0),
                "coat": s["name"] in ctx.get("fewRounds", ()),   # استر یا رنگ: در نهایت COAT_ROUNDS نوبت
            })
        # تقدم: مرحله‌ای که بعدی‌اش جلوتر رفته، خودش دست‌کم تا همان‌جا انجام شده است.
        for chain in (tasks, there):
            ahead = 0.0
            for t in reversed(chain):
                ahead = max(ahead, t["frac"])
                t["frac"] = ahead
        out[r["id"]] = tasks
        if there:
            # مرحله‌ای از همین قطعه‌ها که در کارگاه انجام می‌شود (تیکِ «در محل» ندارد) باید پیش از رفتنِ تیم تمام شده باشد
            shop = {t["name"]: i for i, t in enumerate(tasks)}
            for t in there:
                t["after"] = [i for n, i in shop.items() if on_site and n not in on_site and order[n] < order[t["name"]]]
            away[r["id"]] = there
    ctx["offStation"] = off
    ctx["noArea"] = dict(lost)
    return out, skipped, away


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
    """زمان‌بندیِ روزبه‌روز از روی داده‌های همین لحظه."""
    return _simulate(_prepare(today))


def _prepare(today=None):
    """هر چه زمان‌بندی از پایگاه داده می‌خواند و از رویش می‌فهمد (کارها، نوبت، تقویم، هشدارها) — یک بار.

    شبیه‌سازی (‎_simulate) دیگر چیزی نمی‌خواند؛ برای همین «اگر…»ها (what_if) ده‌ها بار شبیه‌سازی می‌کنند بی پرس‌وجوی تازه."""
    today = today or dt.date.today()
    rows = production.board()["results"]
    rates = _cached("rates", production.stage_time_rates)
    order = _stage_order()
    measured = [r["hoursPerM2"] for r in rates.values() if r.get("measured") and r.get("hoursPerM2")]
    employees = list(Employee.objects.filter(active=True).order_by("name").values_list("name", flat=True))
    auto_share = _cached("share", productive_share)
    eff = efficiency_setting()
    ctx = {
        "stretch": eff["factor"],
        # مرحله‌هایی که کارِ هر پروژه‌شان در نهایت COAT_ROUNDS نوبت زده می‌شود (استر و رنگ)
        "fewRounds": set(WorkStage.objects.filter(few_rounds=True).values_list("name", flat=True)),
        "rates": rates, "order": order, "stations": _stations(order, employees),
        "fallback": round(sum(measured) / len(measured), 4) if measured else 0.0,
        "share": auto_share or DEFAULT_SHARE,
        "waits": dict(WorkStage.objects.filter(wait_hours__gt=0).values_list("name", "wait_hours")),
        "changeover": {n: float(h) for n, h in WorkStage.objects.filter(changeover_hours__gt=0)
                       .values_list("name", "changeover_hours")},
    }
    cal = _Calendar(employees)

    # کار در محلِ پروژه: «همه سر پروژه»، یا پروژه‌ای که متراژِ محل دارد
    site_cfg = {str(p.pk): p for p in Project.objects.filter(general=False, closed_at__isnull=True)
                .filter(Q(work_site=Project.WorkSite.ONSITE) | Q(work_site=Project.WorkSite.MIXED, onsite_area__gt=0))}
    tasks, skipped, away = _tasks(rows, ctx, site_cfg, _site_done(site_cfg) if site_cfg else None)
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
    for pid, ts in tasks.items():
        for t in ts:
            t["color"] = (meta[pid].plan_color or "").strip()
    # پروژه‌ای که هنوز شروع نشده و «تاریخ شروع»ش نرسیده، زودتر از آن روز چیده نمی‌شود.
    project_start = {pid: p.start_date for pid, p in meta.items()
                     if p.start_date and p.start_date > start_day and all(t["frac"] <= 0 for t in tasks[pid])}
    # مهارت: چه کسی کدام مرحله را انجام می‌دهد (خالی = همه‌کاره). نفراتِ ثابتِ ایستگاه‌ها آخر از همه به کارِ دیگر می‌روند.
    skills = {n: set(st) for n, st in Employee.objects.filter(active=True).values_list("name", "plan_stages") if st}
    named = {p for st in ctx["stations"] if st["active"] for p in st["people"]}
    # «خدمات عمومی کارگاه و تعمیر و نگهداری»: این نفرات میانِ هم‌مهارت‌هایشان آخر از همه سرِ کارِ تولید می‌روند.
    general = set(Employee.objects.filter(active=True, plan_general=True).values_list("name", flat=True))
    # مرحله‌هایی که «کمکی» می‌گیرند: یک نفرِ ماهر کافی است و بقیهٔ نفراتِ کار هر کسی می‌تواند باشد.
    helper_stages = set(WorkStage.objects.filter(helpers_ok=True).values_list("name", flat=True))
    masters = _masters(employees, skills, helper_stages)
    general -= masters                                   # استادکار کارِ عمومی نمی‌گیرد، حتی اگر تیکش مانده باشد
    # سرکارگر (رنگ‌کارِ اصلی) و مرحله‌هایی که نفرِ اصلی‌شان تا جایی که بشود اوست (مثلِ رنگ رویه)
    foremen = set(Employee.objects.filter(active=True, plan_foreman=True).values_list("name", flat=True))
    prime = set(WorkStage.objects.filter(foreman_first=True).values_list("name", flat=True))
    # نامِ کارِ عمومیِ کارگاه (همان که در گزارشِ روزانه ساعت رویش ثبت می‌شود)، برای وقتِ آزادِ کسی که تیکِ «کار عمومی» دارد
    chore = (Project.objects.filter(general=True, active=True, closed_at__isnull=True).order_by("name")
             .values_list("name", flat=True).first() or "")
    # خرابی و تعطیلیِ ایستگاه‌ها
    off = defaultdict(list)
    for key, a, b, hours in (PlanStationOff.objects.filter(date_to__gte=start_day)
                             .values_list("station_key", "date_from", "date_to", "hours")):
        off[key].append((a, b, float(hours) if hours else None))

    def rank(pid):
        p = meta[pid]
        return (p.plan_priority is None, p.plan_priority or 0, p.due_date or far, p.start_date or far, p.name)

    queue = sorted(tasks, key=rank)

    warnings = []
    # کار در محلِ پروژه: تیمی که می‌رود و روزی که می‌رود. بی این دو، کارِ محل چیده نمی‌شود.
    sites = {}
    for pid, there in away.items():
        if pid not in tasks:
            continue
        p = site_cfg[pid]
        chosen = list(dict.fromkeys(p.onsite_team or []))
        team = [n for n in chosen if n in employees]
        # نفرِ اولِ تیم استادکارِ آن است: اگر او نباشد (یا دیگر فعال نباشد) کسی به محل نمی‌رود
        sites[pid] = {"tasks": there, "team": team, "master": chosen[0] if chosen else "", "from": p.onsite_from,
                      "ok": bool(team and team[0] == chosen[0] and p.onsite_from),
                      "stages": list(p.onsite_stages or []),
                      "note": p.onsite_note, "all": p.work_site == Project.WorkSite.ONSITE,
                      # متراژِ پایه‌ای که در محل است: همان که وارد شده، یا (همه سر پروژه) متراژِ پایهٔ پروژه
                      "area": float(p.onsite_area) if p.onsite_area and p.work_site != Project.WorkSite.ONSITE
                      else float(p.base_area or 0) or round(max(t["planned"] for t in there), 2)}
    unset = [_label(meta[pid]) for pid in queue if pid in sites and not sites[pid]["ok"]
             and any((1 - t["frac"]) * t["planned"] >= DUST for t in sites[pid]["tasks"])]
    if unset:
        warnings.append("کارِ محلِ پروژهٔ این پروژه‌ها تیم یا روزِ رفتن ندارد (یا استادکارِ تیم دیگر فعال نیست) و در برنامه نیامده — "
                        "دکمهٔ «محل پروژه» کنارِ نامِ پروژه در گانت: " + "، ".join(unset))
    pending = [_label(meta[pid]) for pid in queue
               if meta[pid].work_site == Project.WorkSite.MIXED and not float(meta[pid].onsite_area or 0)]
    if pending:
        warnings.append("این پروژه‌ها «بخشی سر پروژه» هستند ولی متراژِ محلِ پروژه هنوز وارد نشده و همهٔ کارشان در کارگاه چیده شده: "
                        + "، ".join(pending))
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
    metered = set(ReportProgress.objects.filter(stage__in=list(ctx["noArea"]), area__gt=0).values_list("stage", flat=True))
    ctx["noArea"] = {n: ps for n, ps in ctx["noArea"].items() if n in metered}
    if ctx["noArea"]:
        warnings.append("این مرحله‌ها در پروژه‌های باز متراژِ مانده دارند ولی در فهرستِ مراحل «متراژدار» نیستند و در برنامه "
                        "نیامده‌اند: " + "، ".join(f"{n} ({'، '.join(ps)})" for n, ps in ctx["noArea"].items()))
    if employees:
        n = len(employees)
        busy = {t["station"] for ts in tasks.values() for t in ts if t["frac"] < 1 and not t["crewOwn"]}
        big = [f"{st['name']} ({_fa(st['crew'])} نفر)" for st in ctx["stations"] if st["crew"] > n and st["id"] in busy]
        if big:
            warnings.append(f"نفراتِ این ایستگاه‌ها از کلِ کارگرانِ فعال ({_fa(n)} نفر) بیشتر است و برنامه با همان {_fa(n)} نفر "
                            "چیده می‌شود: " + "، ".join(big))
        own = [f"{_label(meta[pid])} · {t['name']} ({_fa(t['crew'])} نفر)" for pid in queue for t in tasks[pid]
               if t["crewOwn"] and t["crew"] > n and t["frac"] < 1]
        if own:
            warnings.append(f"برای این کارها نفرِ بیشتری از کلِ کارگرانِ فعال ({_fa(n)} نفر) گذاشته شده و با همان {_fa(n)} نفر "
                            "چیده می‌شوند: " + "، ".join(own))
    if skills:
        fixed = {st["id"] for st in ctx["stations"] if st["active"] and st["people"]}
        nobody = sorted({t["name"] for ts in tasks.values() for t in ts
                         if t["frac"] < 1 and (t["crewOwn"] or t["station"] not in fixed)
                         and not any(not skills.get(n) or t["name"] in skills[n] for n in employees)}, key=lambda n: order[n])
        if nobody:
            warnings.append("هیچ کارگرِ فعالی این مرحله‌ها را در «مهارت نفرات» ندارد و کارشان چیده نمی‌شود: " + "، ".join(nobody))

    # کارِ گزارش‌شدهٔ همین چند روزِ اخیر هنوز دارد خشک می‌شود؛ شبیه‌سازی از روی همین می‌فهمد چه مقدارش تا کِی خشک است.
    wet = [t["dry"] for ts in tasks.values() for t in ts if t["dry"] and t["frac"] > 0]
    recent = defaultdict(list)
    if wet:
        for pid, stage, d, a in (ReportProgress.objects
                                 .filter(project_id__in=[int(pid) for pid in tasks], area__gt=0,
                                         report__date__gte=start_day - dt.timedelta(days=max(wet)),
                                         report__status=DailyReport.Status.APPROVED)
                                 .values_list("project_id", "stage", "report__date").annotate(a=Sum("area"))
                                 .order_by("report__date")):
            recent[(str(pid), stage)].append((d, production._f(a)))
    return {"today": today, "start": start_day, "ctx": ctx, "stations": ctx["stations"], "employees": employees,
            "tasks": tasks, "queue": queue, "meta": meta, "rows": {r["id"]: r for r in rows},
            "warnings": warnings, "autoShare": auto_share, "calendar": cal, "pauses": pauses,
            "stopFrom": stop_from, "usedToday": used_today, "recent": dict(recent),
            "projectStart": project_start, "skills": skills, "named": named, "off": dict(off),
            "helpers": helper_stages, "general": general, "masters": masters, "foremen": foremen, "prime": prime,
            "chore": chore, "sites": sites, "efficiency": eff}


def _simulate(env):
    """کارها را روزبه‌روز روی ایستگاه‌ها می‌چیند. چیزی از پایگاه داده نمی‌خواند و env را عوض نمی‌کند."""
    today, start_day, tasks, queue, meta = env["today"], env["start"], env["tasks"], env["queue"], env["meta"]
    cal, pauses, stop_from, used_today = env["calendar"], env["pauses"], env["stopFrom"], env["usedToday"]
    stations = {s["id"]: s for s in env["ctx"]["stations"]}
    days, first, last = [], {}, {}
    span = defaultdict(dict)                                  # pid -> stage -> [start, finish]
    cur = {pid: [t["frac"] for t in ts] for pid, ts in tasks.items()}
    rest = lambda pid, i: (1 - cur[pid][i]) * tasks[pid][i]["planned"]  # noqa: E731
    doable = lambda pid, i: tasks[pid][i]["daily"]  # noqa: E731
    # استر و رنگِ هر پروژه در نهایت COAT_ROUNDS نوبت: هر نوبت وقتی شروع می‌شود که سهمِ آن نوبت آماده باشد (با دو نوبتِ
    # مانده، نصفِ کارِ مانده؛ با یک نوبت، همه‌اش) و فقط همان متراژی را می‌زند که در آغازِ نوبت آماده بود — نه اینکه هر روز
    # چند متر زده شود. کاری که پیش از برنامه شروع شده یک نوبتش رفته است. جای دستیِ مسئول جلوتر از این قاعده است.
    quota = {pid: [0.0] * len(ts) for pid, ts in tasks.items()}
    rounds = {pid: [1 if t.get("coat") and 0 < t["frac"] < 1 else 0 for t in ts] for pid, ts in tasks.items()}
    # کار در محلِ پروژه: تیمِ خودش را دارد و جدا از ایستگاه‌های کارگاه پیش می‌رود
    sites = env.get("sites") or {}
    scur = {pid: [t["frac"] for t in st["tasks"]] for pid, st in sites.items()}
    sbase = {pid: list(fs) for pid, fs in scur.items()}
    slog = {pid: [[] for _ in fs] for pid, fs in scur.items()}             # (روز، پیشرفت) — برای خشک شدن
    sspan = defaultdict(dict)                                              # pid -> مرحله -> [شروع، پایان]
    srest = lambda pid, k: (1 - scur[pid][k]) * sites[pid]["tasks"][k]["planned"]   # noqa: E731
    site_open = lambda pid, day: (sites[pid]["ok"] and not (pid in stop_from and day >= stop_from[pid])   # noqa: E731
                                  and any(srest(pid, k) >= DUST and sites[pid]["tasks"][k]["per"] for k in range(len(scur[pid]))))
    left = lambda day: (any(rest(pid, i) >= DUST and doable(pid, i) and not (pid in stop_from and day >= stop_from[pid])  # noqa: E731
                            for pid in cur for i in range(len(cur[pid])))
                        or any(site_open(pid, day) for pid in sites))

    def site_dry(pid, k, day):
        """سهمی از مرحلهٔ k در محل که صبحِ day خشک است و می‌شود رویش رفت: آنچه تا (۱ + روزهای انتظار) روز پیش انجام
        شده — همان قاعدهٔ کارگاه."""
        cut = day - dt.timedelta(days=1 + sites[pid]["tasks"][k]["dry"])
        done = sbase[pid][k]
        for d, frac in slog[pid][k]:
            if d <= cut:
                done = frac
        return done
    # کارهایی که باید «با هم» انجام شوند: (مرحله، شمارهٔ دسته) ← کارها
    together = defaultdict(list)
    for pid, ts in tasks.items():
        for i, t in enumerate(ts):
            if t["batch"]:
                together[(t["name"], t["batch"])].append((pid, i))
    # دسته‌ای که فقط یک کارِ باز در آن مانده (هم‌دسته‌اش بسته یا تمام شده) دیگر منتظرِ کسی نیست.
    for key, members in list(together.items()):
        if len(members) < 2:
            del together[key]

    # پیشرفتِ هر کار در پایانِ هر روزی که رویش کار شده — برای اینکه بدانیم چه مقدارش تا کِی خشک شده است
    base = {pid: list(fs) for pid, fs in cur.items()}
    log = {pid: [[] for _ in fs] for pid, fs in cur.items()}

    # کارِ گزارش‌شدهٔ همین چند روزِ اخیر هنوز دارد خشک می‌شود: مرحلهٔ بعد وقتی رویش می‌رود که انتظارش گذشته باشد،
    # درست مثل کاری که خودِ برنامه چیده است. (پیش‌تر هر کارِ گزارش‌شده‌ای «خشک» فرض می‌شد.)
    for pid, ts in tasks.items():
        for i, t in enumerate(ts):
            if not t["dry"] or t["frac"] <= 0:
                continue
            fresh = [(min(d, start_day), a) for d, a in env["recent"].get((pid, t["name"]), ())
                     if d >= start_day - dt.timedelta(days=t["dry"])]
            if not fresh:
                continue
            # مرحلهٔ بعد تا هر جا رفته، همان‌قدر از این مرحله خشک بوده است
            later = ts[i + 1]["frac"] if i + 1 < len(ts) else 0.0
            done = max(t["frac"] - sum(a for _, a in fresh) / t["planned"], later, 0.0)
            base[pid][i] = done
            for d, a in fresh:
                done = min(done + a / t["planned"], t["frac"])
                log[pid][i].append((d, done))

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

    skills, named, off, project_start = env["skills"], env["named"], env["off"], env["projectStart"]
    helper_stages = env["helpers"]
    general, masters = env.get("general") or set(), env.get("masters") or set()
    foremen, prime = env.get("foremen") or set(), env.get("prime") or set()
    chore = env.get("chore") or ""
    people = list(dict.fromkeys(cal.employees))
    able_cache, hands_cache = {}, {}

    def kept_last(order):
        """کسی که «خدمات عمومی» دارد، میانِ هم‌مهارت‌هایش آخر از همه سرِ کارِ تولید می‌رود؛ پس کارها اول به بقیه می‌رسد و
        وقتِ بی‌کاری به او.

        فقط جای کسانی با هم عوض می‌شود که دقیقاً همان مرحله‌ها را بلدند (و نفرِ ثابتِ ایستگاهی نیستند). چنین کسانی برای
        هر کاری یا هر دو می‌آیند یا هیچ‌کدام، پس برنامهٔ تولید ذره‌ای عوض نمی‌شود — فقط اینکه کدامشان بی‌کار بماند."""
        if not general.intersection(order):
            return order
        slots = defaultdict(list)
        for k, n in enumerate(order):
            if n not in named:
                slots[frozenset(skills.get(n) or ())].append(k)
        out = list(order)
        for ks in slots.values():
            for k, n in zip(ks, sorted((order[k] for k in ks), key=lambda n: n in general)):
                out[k] = n
        return out

    def hands_of(stage):
        """کمکی‌های این مرحله: هر که خودش مرحله را بلد نیست (اگر مرحله کمکی می‌گیرد)."""
        if stage not in hands_cache:
            lead = set(able(stage))
            hands_cache[stage] = kept_last(sorted(
                (n for n in people if n not in lead),
                key=lambda n: (n in named, len(skills.get(n) or ()) or 999, n))) if stage in helper_stages else []
        return hands_cache[stage]

    def able(stage):
        """کسانی که این مرحله را انجام می‌دهند، به ترتیبی که نفرِ همه‌کاره برای کارهای بعدی بماند: اول کسی که ایستگاهِ
        ثابت ندارد و مهارت‌های کمتری دارد."""
        if stage not in able_cache:
            able_cache[stage] = kept_last(sorted((n for n in people if not skills.get(n) or stage in skills[n]),
                                                 key=lambda n: (n in named, len(skills.get(n) or ()) or 999, n)))
        return able_cache[stage]

    # «چرا»: هر روزی که کاری کمتر از توانش پیش رفت، علتش شمرده می‌شود — پیش از شروع (wait) و پس از آن (slow).
    wait = {pid: [defaultdict(int) for _ in ts] for pid, ts in tasks.items()}
    slow = {pid: [defaultdict(int) for _ in ts] for pid, ts in tasks.items()}
    held = {pid: [set() for _ in ts] for pid, ts in tasks.items()}       # ایستگاه دستِ کدام پروژه‌ها بود
    gate = {pid: [None] * len(ts) for pid, ts in tasks.items()}          # علتِ آخرین روزِ انتظار پیش از شروع
    tail = {pid: [None] * len(ts) for pid, ts in tasks.items()}          # آخرین روزی که پس از شروع کند شد
    began = {pid: [False] * len(ts) for pid, ts in tasks.items()}
    colour_at, owed, owed_for = {}, defaultdict(float), {}               # رنگِ فعلیِ هر ایستگاه و تعویضِ نیمه‌کاره

    def note(pid, i, code, blocker=None):
        if began[pid][i]:
            slow[pid][i][code] += 1
            tail[pid][i] = (day, code, blocker)
        else:
            wait[pid][i][code] += 1
            gate[pid][i] = (code, blocker)
        if blocker and code in ("station", "setup"):
            held[pid][i].add(blocker[0])

    def take(who, amount, spare=True):
        """این‌قدر نفر-روز از این نفرات (به ترتیب) و بعد — اگر spare — از اضافه‌کاریِ بی‌نام کم می‌شود.
        برمی‌گرداند {نام: نفر-روزی که از او رفت} (اضافه‌کاریِ بی‌نام با کلیدِ None)."""
        nonlocal anon, pool
        pool -= amount
        out = {}
        for n in who:
            if amount <= 1e-9:
                return out
            got = min(caps.get(n, 0.0), amount)
            if got > 0:
                caps[n] -= got
                amount -= got
                out[n] = got
        if spare:
            got = min(anon, amount)
            anon -= got
            if got > 0:
                out[None] = got
        return out

    def book(tag, taken, role):
        """«برنامهٔ نفرات»: هر کس امروز چند ساعت سرِ کدام کار است. tag = (پروژه، مرحله، job یا setup)."""
        for n, part in taken.items():
            if n is not None:
                doing[(n,) + tag + (role,)] += part * DAY_HOURS

    def spend(who, hands, crew, amount, tag):
        """نفر-روزِ یک کار میانِ نفراتش؛ برمی‌گرداند (وقتی که از ایستگاه رفت، نفر-روزِ کمکی‌ها).

        در مرحله‌ای که کمکی می‌گیرد، نفراتِ کار «یک نفرِ اصلی + بقیه کمکی» است: کمکی‌ها تا جایی که جا دارند (همه جز یک
        نفر) و بقیه از یک نفرِ اصلی. ایستگاه همان‌قدر مشغول است که نفرِ اصلی سرِ کار است — پس اگر کمکی کم باشد، کار
        کندتر می‌رود و ایستگاه بیشتر دستش می‌ماند (نفرِ اصلیِ دوم هم‌زمان در همان ایستگاه نمی‌ایستد)."""
        if not hands or crew <= 1:
            book(tag, take(who, amount), "")
            return amount / crew, 0.0
        aid = min(sum(caps.get(n, 0.0) for n in hands), amount * (1 - 1 / crew))
        if aid > 0:
            book(tag, take(hands, aid, spare=False), "help")
        book(tag, take(who, amount - aid), "lead")
        return amount - aid, aid

    def slowed(pid, i, t, area, ready, got, before, setup, crew, time, by_people, fixed, blocker):
        """امروز کمتر از توانِ یک روزِ کاملش پیش رفت؟ چرا؟"""
        if area + DUST >= min(before, t["daily"] * room[t["station"]]):
            return
        if area >= ready - 1e-6:
            drying = i and (start[pid][i - 1] - got) * tasks[pid][i - 1]["planned"] >= DUST
            note(pid, i, "dry" if drying else "prev")
        elif setup:
            note(pid, i, "setup")
        elif crew * time <= by_people and time < room[t["station"]] - 1e-6:
            note(pid, i, "station", blocker)
        else:
            note(pid, i, "away" if fixed and crew < t["crew"] - 1e-6 else "people")

    day, worked = start_day, 0
    while left(day) and worked < MAX_WORKING_DAYS:
        info = cal.day(day)
        scale = 1 - used_today if day == today and used_today else 1.0
        factor = info["factor"] * scale
        if factor <= 0:
            day += dt.timedelta(days=1)
            continue
        worked += 1
        caps = {n: c * scale for n, c in info["caps"].items()}
        anon = info["anon"] * scale
        pool = pool0 = sum(caps.values()) + anon
        # وقتِ هر ایستگاه در این روز: کلِ روز، مگر خراب یا تعطیل باشد
        room = {}
        for sid in stations:
            lost = 0.0
            for a, b, hours in off.get(sid, ()):
                if a <= day <= b:
                    lost = factor if hours is None else max(lost, min(hours / DAY_HOURS, factor))
            room[sid] = max(factor - lost, 0.0)
        free = dict(room)
        start = {pid: list(fs) for pid, fs in cur.items()}    # مرحلهٔ بعد فقط کارِ تا دیروز را می‌بیند
        lines, setups, last_on, seats = [], [], {}, []
        doing = defaultdict(float)                            # (نام، پروژه، مرحله، نوع، نقش) -> ساعت
        # ---------- کار در محلِ پروژه ----------
        # تیمِ محل پیش از کارهای کارگاه سرِ کارِ خودش می‌رود: مرحله‌های محل را پشتِ سرِ هم (با انتظارِ خشک شدن) پیش می‌برد
        # و آن روز دیگر در کارگاه نیست. رنگ رویهٔ محل هم کارِ همین تیم است، نه سرکارگر و نه اتاقِ رنگِ کارگاه.
        away_today, site_lines = [], []
        for pid in queue:
            st = sites.get(pid)
            if (not st or not st["ok"] or day < st["from"] or not site_open(pid, day) or _paused_on(pauses, pid, day)):
                continue
            team = [n for n in st["team"] if caps.get(n, 0.0) > 1e-9]
            if st["team"][0] not in team:                     # استادکارِ تیم امروز نیست: کسی به محل نمی‌رود
                continue
            whole = budget = sum(caps[n] for n in team)       # نفر-روزِ تیم در امروز
            did = []
            for k, t in enumerate(st["tasks"]):
                if srest(pid, k) < DUST or not t["per"]:
                    continue
                # مرحله‌ای از همین قطعه‌ها که در کارگاه انجام می‌شود هنوز تمام نشده (تا دیروز)
                if any(start[pid][i] < 1 - 1e-9 and doable(pid, i) for i in t["after"]):
                    break
                # مرحلهٔ قبل اگر دستِ آستر یا رنگ است (یا انتظار دارد) فقط کارِ تا دیروزش، مثلِ کارگاه؛ وگرنه (سنباده،
                # بتونه) همین تیم همان روز پشتش می‌رود — تیمی که تا محل رفته برای یک سنباده برنمی‌گردد.
                got = 1.0
                if k:
                    prev = st["tasks"][k - 1]
                    got = site_dry(pid, k - 1, day) if prev["waitHours"] or prev["coat"] else scur[pid][k - 1]
                ready = (got - scur[pid][k]) * t["planned"]
                area = min(ready, srest(pid, k), t["per"] * budget)
                if area < DUST:
                    break                                     # منتظرِ مرحلهٔ قبل (یا خشک شدنش)، یا وقتِ امروزِ تیم تمام شد
                spent = area / t["per"]
                budget -= spent
                scur[pid][k] = min(scur[pid][k] + area / t["planned"], 1.0)
                if srest(pid, k) < DUST:
                    scur[pid][k] = 1.0
                did.append((k, t, area, spent))
            if not did:
                continue
            for k, t, area, spent in did:
                site_lines.append({"station": SITE, "projectId": pid, "project": _label(meta[pid]), "stage": t["name"],
                                   "area": round(area, 2), "people": len(team), "share": round(spent / whole, 2),
                                   "hours": round(spent * DAY_HOURS, 1), "team": team})
                for n in team:
                    doing[(n, pid, t["name"], "site", "")] += spent * caps[n] / whole * DAY_HOURS
                sspan[pid].setdefault(t["name"], [day, day])[1] = day
                slog[pid][k].append((day, scur[pid][k]))
            for n in team:                                    # باقیِ روزِ تیم هم در محل می‌گذرد، نه در کارگاه
                doing[(n, pid, "", "sitetime", "")] += budget * caps[n] / whole * DAY_HOURS
                pool -= caps[n]
                caps[n] = 0.0
            away_today.append({"projectId": pid, "project": _label(meta[pid]), "people": team})
            first.setdefault(pid, day)
        # اول کارهایی که مسئول جایشان را دستی گذاشته، بعد کارهای عقب‌افتاده و نیمه‌کاره، بعد بقیه به ترتیب اولویت.
        turn = [(pid, i, t) for group in ("placed", "overdue", "rest") for pid in queue
                for i, t in enumerate(tasks[pid])
                if (t["placed"] if group == "placed" else
                    not t["placed"] and t["overdue"] if group == "overdue" else
                    not t["placed"] and not t["overdue"])]
        # کارهای هم‌رنگ پشتِ هم: در ایستگاهی که تعویض رنگ دارد، میانِ کارهای عادیِ همان ایستگاه، کارِ هم‌رنگِ رنگِ فعلیِ
        # ایستگاه جلوتر می‌آید تا بی‌دلیل شست‌وشو نشود. جای کارهای ایستگاه‌های دیگر در نوبت عوض نمی‌شود.
        slots = defaultdict(list)
        for k, (pid, i, t) in enumerate(turn):
            if t["changeover"] and t["color"] and not t["placed"] and not t["overdue"] and colour_at.get(t["station"]):
                slots[t["station"]].append(k)
        for sid, ks in slots.items():
            for k, job in zip(ks, sorted((turn[k] for k in ks), key=lambda x: x[2]["color"] != colour_at[sid])):
                turn[k] = job

        for pid, i, t in turn:
            if rest(pid, i) < DUST:
                continue
            sid = t["station"]
            if not t["daily"]:
                note(pid, i, "nodaily")
                continue
            if t["notBefore"] and t["notBefore"] > day:
                note(pid, i, "placed")
                continue
            if pid in project_start and day < project_start[pid]:
                note(pid, i, "projstart")
                continue
            if _paused_on(pauses, pid, day):
                note(pid, i, "paused")
                continue
            got = delivered(pid, i - 1, day, start) if i else 1.0
            ready = (got - cur[pid][i]) * t["planned"]
            if ready < DUST:
                # کارِ مرحلهٔ قبل انجام شده ولی هنوز خشک نیست، یا اصلاً نرسیده
                drying = i and (start[pid][i - 1] - got) * tasks[pid][i - 1]["planned"] >= DUST
                note(pid, i, "dry" if drying else "prev")
                continue
            if not all_arrived(pid, i, day, start):
                note(pid, i, "batch")
                continue
            fresh = False                                        # نوبتِ تازه‌ای از استر یا رنگ امروز شروع می‌شود؟
            if t.get("coat") and not t["placed"]:
                if ready >= rest(pid, i) - DUST:
                    quota[pid][i] = max(quota[pid][i], ready)    # هر چه مانده آماده است: همه‌اش پشتِ سرِ هم زده می‌شود
                if quota[pid][i] >= DUST:
                    ready = min(ready, quota[pid][i])            # ادامهٔ همان نوبت: فقط آنچه در آغازش آماده بود
                else:
                    turns = max(COAT_ROUNDS - rounds[pid][i], 1)
                    stuck = i and not doable(pid, i - 1)         # مرحلهٔ قبل دیگر چیزی نمی‌رساند
                    if ready < rest(pid, i) - DUST and ready < rest(pid, i) / turns - DUST and not stuck:
                        note(pid, i, "round")
                        continue
                    fresh = True
            if room[sid] <= 0.001:
                note(pid, i, "off")
                continue
            if not t["placed"] and free[sid] <= 0.001:
                note(pid, i, "station", last_on.get(sid))
                continue
            if pool <= 0.001:
                note(pid, i, "people")
                continue
            # چه کسانی روی این کار می‌روند: نفراتِ ثابتِ ایستگاه (که مرخصی یا کارِ عمومی‌شان از سرعتش کم می‌کند)، وگرنه
            # هر که این مرحله را بلد است. «extra» فقط در «اگر…»ها هست: نفری که فرضاً به این ایستگاه اضافه شده.
            crew = t["crew"]
            st = stations.get(sid)
            fixed = bool(st and st["people"] and not t["crewOwn"])
            if fixed:
                extra = 0 if t["manual"] else st.get("extra", 0)
                crew = sum(info["share"].get(p, 1.0) for p in st["people"]) + extra
                who = [p for p in st["people"] if p in caps] + ([n for n in able(t["name"]) if n not in st["people"]] if extra else [])
                heads = info["heads"]
            else:
                who = able(t["name"])
                hands = hands_of(t["name"])
                heads = min(info["heads"], sum(1 for n in who + hands if info["caps"].get(n, 0) > 0) + info["anonHeads"])
            if fixed:
                hands = []
            # بیش از کسانی که امروز در کارگاه‌اند (و این کار را بلدند یا کمکی‌اش هستند) کسی سرِ کار نیست — کارِ دستی هم.
            crew = min(crew, heads)

            def can(span):
                """نفر-روزی که این کار در این‌قدر وقتِ ایستگاه می‌تواند بگیرد: نفراتش در آن وقت، و نه بیش از نفر-روزِ هنوز
                آزادِ کسانی که رویش می‌روند.

                در مرحله‌ای که کمکی می‌گیرد، نفراتِ هر کار یعنی «یک نفرِ اصلی + بقیه کمکی»: فقط یک نفر از کسانی که مرحله را
                بلدند سرِ این کار می‌آید (نفرِ اصلیِ دوم برای کارِ دیگری می‌ماند) و کمکی‌ها فقط کنارِ او کار می‌کنند. اگر
                کمکیِ آزاد کم باشد، کار با نفرِ کمتر و کندتر پیش می‌رود."""
                lead = sum(caps.get(n, 0.0) for n in who) + anon
                if not hands or crew <= 1:
                    return min(crew * span, lead)
                one = min(span, lead)
                return one + min((crew - 1) * one, sum(caps.get(n, 0.0) for n in hands))

            if crew < 0.05 or can(1e9) <= 0.001:
                # نفر هست ولی کسی که این مرحله را بلد باشد آزاد نیست؟
                short = not fixed and len(who) < len(people) and pool > 0.05
                note(pid, i, "away" if fixed else "skill" if short else "people")
                continue
            time = room[sid] if t["placed"] else free[sid]            # کارِ دستی منتظرِ وقتِ ایستگاه نمی‌ماند
            # تعویض رنگ: ایستگاه پیش از کارِ رنگِ دیگر، وقتِ شست‌وشو می‌خواهد (و نفراتش همان مدت مشغول‌اند).
            setup = 0.0
            if t["changeover"] and t["color"]:
                was = colour_at.get(sid)
                if was and was != t["color"]:
                    if owed_for.get(sid) != t["color"]:
                        owed_for[sid], owed[sid] = t["color"], t["changeover"] / DAY_HOURS
                    setup = max(min(owed[sid], time, can(time) / crew), 0.0)
                    if setup > 0:
                        owed[sid] -= setup
                        took = spend(who, hands, crew, crew * setup, (pid, t["name"], "setup"))[0]
                        free[sid] -= took
                        time -= took
                        setups.append({"station": sid, "projectId": pid, "project": _label(meta[pid]), "stage": t["name"],
                                       "hours": round(took * DAY_HOURS, 1), "people": round(crew, 1),
                                       "share": round(took / factor, 2), "from": was, "to": t["color"]})
                    if owed[sid] > 1e-6:
                        note(pid, i, "setup", last_on.get(sid))
                        last_on[sid] = (pid, i)
                        continue
                    owed_for.pop(sid, None)
                colour_at[sid] = t["color"]
            # نفر-روزی که این کار امروز می‌گیرد: نفراتش در وقتی که ایستگاه هنوز دارد، و نه بیش از نفر-روزِ هنوز آزادِ
            # کسانی که می‌توانند رویش بروند. وقتی کارِ قبلی وسطِ روز تمام شده، باقیِ روزِ ایستگاه و همان نفرِ آزادشده با
            # سرعتِ کامل به کارِ بعد می‌رسد.
            per = t["daily"] / t["crew"]                              # متر به ازای هر نفر-روز
            area = min(ready, per * can(time))
            if area < DUST:
                note(pid, i, "setup" if setup else "station" if crew * time <= can(1e9) else "people", last_on.get(sid))
                continue
            by_people = can(1e9)                                       # پیش از برداشتن: سقفی که نفرات می‌گذارند
            before = rest(pid, i)
            spent = area / per                                        # نفر-روزی که رفت
            used, aid = spend(who, hands, crew, spent, (pid, t["name"], "job"))   # وقتی که از ایستگاه رفت
            if t.get("coat") and not t["placed"]:
                if fresh:
                    rounds[pid][i] += 1
                    quota[pid][i] = ready
                quota[pid][i] = max(quota[pid][i] - area, 0.0)
            free[sid] -= used
            cur[pid][i] = min(cur[pid][i] + area / t["planned"], 1.0)
            if rest(pid, i) < DUST:
                cur[pid][i] = 1.0
            line = {"station": sid, "projectId": pid, "project": _label(meta[pid]), "stage": t["name"],
                    "area": round(area, 2), "people": round(crew, 1), "share": round(used / factor, 2)}
            lines.append(line)
            began[pid][i] = True
            why = (pid, i, t, area, ready, got, before, setup, crew, time, by_people, fixed, last_on.get(sid))
            if hands and crew > 1:
                # ترکیبِ نفراتِ این کار: یک نفرِ اصلی و چند کمکی (میانگینِ کمکی‌ها در وقتی که ایستگاه دستِ کار بود)
                line["lead"], line["helpers"] = 1, round(aid / used, 1) if used > 1e-9 else 0
                seats.append({"why": why, "line": line, "per": per, "who": who, "area": area, "aid": aid,
                              "empty": crew * used - spent, "used": used})
            else:
                slowed(*why)
            last_on[sid] = (pid, i)
            first.setdefault(pid, day)
            span[pid].setdefault(t["name"], [day, day])[1] = day
            if all(rest(pid, j) < DUST or not doable(pid, j) for j in range(len(cur[pid]))):
                last[pid] = day
        # جای کمکیِ خالی‌مانده: وقتی همهٔ کارها نوبتشان را گرفته‌اند و باز نفری بی‌کار است که مرحله را بلد است، او جای
        # کمکی را پر می‌کند تا کار کند نرود. نفرِ اصلی فقط در این حالت «کمکی» می‌شود، نه وقتی کارِ دیگری منتظرِ اوست.
        for s in seats:
            pid, i, t, area, ready = s["why"][:5]
            more = min(s["empty"], sum(caps.get(n, 0.0) for n in s["who"]) + anon, (ready - area) / s["per"])
            if more * s["per"] >= DUST:
                book((pid, t["name"], "job"), take(s["who"], more), "help")
                area += more * s["per"]
                if t.get("coat") and not t["placed"]:
                    quota[pid][i] = max(quota[pid][i] - more * s["per"], 0.0)
                cur[pid][i] = min(cur[pid][i] + more * s["per"] / t["planned"], 1.0)
                if rest(pid, i) < DUST:
                    cur[pid][i] = 1.0
                s["line"]["area"] = round(area, 2)
                s["line"]["helpers"] = round((s["aid"] + more) / s["used"], 1)
                if all(rest(pid, j) < DUST or not doable(pid, j) for j in range(len(cur[pid]))):
                    last[pid] = day
            slowed(pid, i, t, area, *s["why"][4:])
        for pid, fs in cur.items():
            for i, frac in enumerate(fs):
                if frac != start[pid][i]:
                    log[pid][i].append((day, frac))
        # کارِ عمومی در وقتِ بی‌کاری: پس از آنکه همهٔ کارهای تولید نفرشان را گرفتند، هر چه از وقتِ این نفر مانده —
        # ولی فقط در ساعتِ عادی؛ کسی برای کارِ عمومی اضافه‌کاری نمی‌ماند.
        # سرکارگر (رنگ‌کارِ اصلی): در مرحله‌هایی که «اولویت با سرکارگر» است، ساعتِ نفرِ اصلیِ کار تا جایی که بشود به او می‌رسد و
        # بعد به نفرِ بعدی. فقط «چه کسی سرِ چه کاری» جابه‌جا می‌شود — یا وقتِ آزادِ سرکارگر با هم‌مهارتش عوض می‌شود، یا کارِ
        # دیگرِ سرکارگر با همان نفری که جایش را می‌دهد (اگر از پسش برمی‌آید). برنامهٔ تولید ذره‌ای عوض نمی‌شود.
        # کارهای دیگر برعکس: اول به هم‌مهارت‌های او می‌رسد، تا اگر برای همه کار نبود، کسی که آزاد می‌ماند سرکارگر باشد و به
        # کارِ بقیه سرکشی کند.
        if foremen:
            top = lambda k: k[2] in prime and k[3] == "job" and k[4] in ("lead", "")        # noqa: E731
            knows = lambda n, stage: not skills.get(n) or stage in skills[n]                # noqa: E731
            alike = lambda a, b: frozenset(skills.get(a) or ()) == frozenset(skills.get(b) or ())   # noqa: E731
            for key in [k for k in doing if top(k) and k[0] not in foremen and k[0] not in named]:
                other = key[0]
                for boss in sorted(foremen):
                    if boss in named or boss not in caps or not knows(boss, key[2]):
                        continue
                    if alike(boss, other) and boss not in general:
                        move = min(doing[key], caps[boss] * DAY_HOURS)
                        if move >= 0.05:
                            doing[key] -= move
                            doing[(boss,) + key[1:]] += move
                            caps[boss] -= move / DAY_HOURS
                            caps[other] = caps.get(other, 0.0) + move / DAY_HOURS
                    for mine in [k for k in doing if k[0] == boss and not top(k) and k[3] in ("job", "setup")]:
                        if mine[4] != "help" and not knows(other, mine[2]):
                            continue
                        move = min(doing[key], doing[mine])
                        if move >= 0.05:
                            doing[key] -= move
                            doing[(boss,) + key[1:]] += move
                            doing[mine] -= move
                            doing[(other,) + mine[1:]] += move
            for boss in sorted(foremen):
                if boss in named or boss not in caps:
                    continue
                mates = [n for n in people if n != boss and n not in foremen and n not in named and n not in general
                         and alike(boss, n)]
                for mine in [k for k in doing if k[0] == boss and not top(k) and k[3] in ("job", "setup")]:
                    for other in mates:
                        move = min(doing[mine], caps.get(other, 0.0) * DAY_HOURS)
                        if move >= 0.05:
                            doing[mine] -= move
                            doing[(other,) + mine[1:]] += move
                            caps[other] -= move / DAY_HOURS
                            caps[boss] += move / DAY_HOURS
        # هر ردیف یک کار است. کاری که تاریخ دارد جلوتر از کارِ «تا اطلاعِ بعدی» است و کاری که سقفِ ساعت دارد جلوتر از
        # کارِ بی‌سقف — تا کارِ مشخصِ یک روز، پیش از کارِ همیشگی (مثلِ «خدمات کارگاه») وقتِ بی‌کاری را بگیرد.
        # وقتِ آزادِ هر کس که تیکِ «کار عمومی» دارد (ساعتِ عادی؛ کسی برای کارِ عمومی اضافه‌کاری نمی‌ماند)
        spare = {n: min(caps.get(n, 0.0) * DAY_HOURS, info["regular"].get(n, 0.0) * scale) for n in general.intersection(caps)}
        fills = []
        for rid, target, h, what, lasting in sorted(info["fill"], key=lambda r: (r[4], r[2] is None, r[0])):
            for n in (sorted(spare) if target == ALL else [target]):
                if n not in spare:                           # تیکش برداشته شده، یا استادکار است
                    continue
                got = spare[n] if h is None else min(h, spare[n])
                if got >= 0.05:
                    spare[n] -= got
                    fills.append({"id": str(rid), "name": n, "hours": round(got, 1), "note": what})
        # تیکِ «کار عمومی» به‌تنهایی کافی است: هر چه از وقتِ آزادِ این نفر مانده (پس از کارهای مشخصی که به او داده شده)
        # کارِ عمومیِ کارگاه است. ردیفی لازم ندارد.
        for n in sorted(spare):
            if spare[n] >= 0.05:
                fills.append({"id": "auto:" + n, "name": n, "hours": round(spare[n], 1), "note": chore, "auto": True})
        # پروژه‌ای که کارِ محل دارد وقتی تمام است که هم کارگاه تمام شده باشد هم محل. کارِ محلی که تیم یا روز ندارد
        # چیده نمی‌شود؛ پس چنین پروژه‌ای در این برنامه پایانی ندارد.
        for pid in sites:
            shop = any(rest(pid, j) >= DUST and doable(pid, j) for j in range(len(cur[pid])))
            if shop or any(srest(pid, k) >= DUST for k in range(len(scur[pid]))):
                last.pop(pid, None)
            elif pid not in last and pid in first:
                last[pid] = day
        roster = defaultdict(list)                             # «برنامهٔ نفرات»: نام -> کارهای امروزش
        for (n, pid, stage, what, role), hours in doing.items():
            if hours >= 0.05:
                roster[n].append({"projectId": pid, "project": _label(meta[pid]), "stage": stage, "kind": what, "role": role,
                                  "hours": round(hours, 1)})
        days.append({"date": day, "base": info["base"], "overtime": info["overtime"], "fill": fills,
                     "people": dict(roster), "everyone": info["everyone"], "siteTeams": away_today,
                     "present": info["present"], "leave": info["leave"], "away": info["away"],
                     "pool": round(pool0, 2), "used": round(pool0 - pool, 2),
                     # جای دستیِ کارها نفر یا ایستگاهِ بیشتری از آنچه هست می‌خواهد
                     "over": pool < -0.01, "overStations": [sid for sid, v in free.items() if v < -0.01],
                     "closed": [sid for sid in stations if room[sid] < factor - 1e-6],
                     "free": {n: round(c, 2) for n, c in caps.items() if c > 0.005}, "freeExtra": round(anon, 2),
                     "lines": lines, "setups": setups, "site": site_lines})
        day += dt.timedelta(days=1)
    unfinished = left(day)

    return {**{k: env[k] for k in ("today", "start", "ctx", "stations", "employees", "tasks", "queue", "meta", "rows",
                                   "warnings", "autoShare", "calendar", "pauses", "projectStart", "skills", "helpers",
                                   "general", "masters", "foremen", "prime", "sites")},
            "site": {pid: {"span": dict(sspan[pid]), "frac": list(scur[pid])} for pid in sites},
            "together": together, "days": days, "first": first, "last": last, "span": span, "unfinished": unfinished,
            "why": {pid: [{"wait": dict(wait[pid][i]), "slow": dict(slow[pid][i]), "held": sorted(held[pid][i]),
                           "gate": gate[pid][i], "tail": tail[pid][i]} for i in range(len(ts))]
                    for pid, ts in tasks.items()}}


WHY = {
    "placed": "جایش را خودتان گذاشته‌اید", "projstart": "تاریخ شروعِ پروژه نرسیده بود", "paused": "پروژه متوقف بود",
    "prev": "منتظرِ کارِ مرحلهٔ قبل بود", "dry": "منتظرِ خشک شدنِ مرحلهٔ قبل بود", "batch": "منتظرِ هم‌دسته‌هایش بود",
    "off": "ایستگاه تعطیل یا خراب بود", "station": "ایستگاه دستِ کارِ دیگری بود", "people": "نفرِ آزاد نبود",
    "away": "نفراتِ ایستگاه نبودند", "setup": "تعویض رنگ", "nodaily": "مدتش قابل برآورد نیست",
    "skill": "کسی که این مرحله را بلد است آزاد نبود",
    "round": "منتظر بود تا کارِ یک نوبتِ کامل آماده شود (استر و رنگ در نهایت دو نوبت)",
}


def _why_text(s, pid, i):
    """به زبانِ ساده: این کار چرا همین‌جاست — چند روز منتظرِ چه بود و چه چیزی کندش کرد."""
    w, t = s["why"][pid][i], s["tasks"][pid][i]
    prev = s["tasks"][pid][i - 1]["name"] if i else ""

    def phrase(code, days):
        text = WHY[code]
        if code in ("prev", "dry") and prev:
            text = text.replace("مرحلهٔ قبل", f"«{prev}»")
        if code == "station" and w["held"]:
            text = "ایستگاه دستِ " + "، ".join(_label(s["meta"][q]) for q in w["held"][:3] if q in s["meta"]) + " بود"
        if code == "placed" and t["notBefore"]:
            text = "جایش را خودتان گذاشته‌اید"
        return f"{_fa(days)} روز {text}"

    parts = []
    if w["wait"]:
        parts.append("پیش از شروع: " + "؛ ".join(phrase(c, n) for c, n in sorted(w["wait"].items(), key=lambda x: -x[1])))
    if w["slow"]:
        parts.append("کندتر از توانش: " + "؛ ".join(phrase(c, n) for c, n in sorted(w["slow"].items(), key=lambda x: -x[1])))
    return " — ".join(parts)


def _critical(s):
    """زنجیرهٔ کارهایی که پایانِ برنامه را تعیین می‌کند، از آخرین کار به عقب: هر کار یا به‌اندازهٔ کارِ رسیده از مرحلهٔ
    قبل پیش رفته، یا شروعش را چیزی عقب انداخته (مرحلهٔ قبل، کارِ دیگری روی همان ایستگاه، نبودِ نفر، تصمیمِ دستی…)."""
    tasks, span, why, queue = s["tasks"], s["span"], s["why"], s["queue"]
    ends = [(span[pid][t["name"]][1], n, i, pid) for n, pid in enumerate(queue) for i, t in enumerate(tasks[pid])
            if t["name"] in span[pid]]
    if not ends:
        return []
    _, _, i, pid = max(ends)
    chain, seen, here = [], set(), (pid, i)
    while here and here not in seen and len(chain) < 40:
        seen.add(here)
        pid, i = here
        w, sp = why[pid][i], span[pid].get(tasks[pid][i]["name"])
        link, nxt = None, None
        if i and w["tail"] and w["tail"][1] in ("prev", "dry") and sp and (sp[1] - w["tail"][0]).days <= 3:
            link, nxt = w["tail"][1], (pid, i - 1)       # تا آخر به‌اندازهٔ کارِ رسیده از مرحلهٔ قبل پیش رفت
        elif w["gate"]:
            link, blocker = w["gate"]
            if link in ("prev", "dry") and i:
                nxt = (pid, i - 1)
            elif link in ("station", "setup") and blocker:
                nxt = tuple(blocker)
        if nxt and tasks[nxt[0]][nxt[1]]["name"] not in span[nxt[0]]:
            nxt = None                                    # آن کار پیش از برنامه تمام شده است
        chain.append((pid, i, link))
        here = nxt
    return chain[::-1]


# ---------- «اگر … چه می‌شود؟» ----------

def _tweaked(env, station=None, workers=0, overtime=0.0, overtime_days=None, off=None, absent=None, clone=None,
             queue=None, general=None):
    """همان ورودی‌های زمان‌بندی با یک فرضِ دیگر — چیزی ذخیره نمی‌شود.

      · station = {شناسهٔ ایستگاه: چند نفرِ بیشتر}. کاری که مسئول خودش نفرات یا مدتش را گذاشته دست نمی‌خورد.
      · workers: چند کارگرِ تازه در کارگاه (نفراتِ ایستگاه‌ها همان می‌ماند).
      · overtime: چند ساعت اضافه‌کاری برای همه، هر روز، در overtime_days روزِ کاریِ پیشِ رو (روزی که خودش اضافه‌کاری دارد نه).
      · off = {شناسهٔ ایستگاه: چند روز از امروز خراب یا تعطیل}.   · absent = {نام: چند روز از امروز نیست}.
      · clone = (شناسهٔ پروژه، اولِ صف؟): پروژه‌ای تازه با همان مرحله‌ها و متراژ.   · queue: ترتیبِ دیگری از پروژه‌ها.
      · general = (نام، از روز، تا روز یا None (تا اطلاعِ بعدی)، ساعت یا None): این نفر در این روزها کارِ عمومی کند و
        کارِ تولیدش به بقیه برسد.
    """
    out = dict(env)
    extra = {sid: n for sid, n in (station or {}).items() if n}
    if extra or clone:
        out["tasks"] = {pid: list(ts) for pid, ts in env["tasks"].items()}
    if extra:
        out["ctx"] = {**env["ctx"], "stations": [
            {**st, "crew": st["crew"] + extra[st["id"]], "extra": extra[st["id"]]} if st["id"] in extra else st
            for st in env["ctx"]["stations"]]}
        out["stations"] = out["ctx"]["stations"]
        for pid, ts in out["tasks"].items():
            for i, t in enumerate(ts):
                n = extra.get(t["station"], 0)
                if n and not t["crewOwn"] and not t["manual"] and t["daily"]:
                    grown = (t["crew"] + n) / t["crew"]              # همان نفر-ساعت، با نفرِ بیشتر
                    ts[i] = {**t, "crew": t["crew"] + n, "stationCrew": t["stationCrew"] + n,
                             "suggested": t["suggested"] * grown if t["suggested"] else t["suggested"],
                             "daily": t["daily"] * grown}
    if clone:
        src, first = clone
        out["tasks"]["new"] = [{**t, "frac": 0.0, "notBefore": None, "placed": False, "batch": None, "overdue": False}
                               for t in env["tasks"][src]]
        p = env["meta"][src]
        out["meta"] = {**env["meta"], "new": types.SimpleNamespace(
            pk=0, name="پروژهٔ فرضی", short_name="", code="", due_date=None, start_date=None, plan_priority=None,
            plan_color=p.plan_color)}
        out["queue"] = (["new"] + list(env["queue"])) if first else (list(env["queue"]) + ["new"])
    if queue is not None:
        out["queue"] = list(queue)
    if off:
        days_off = dict(env["off"])
        for sid, n in off.items():
            days_off[sid] = list(days_off.get(sid, ())) + [(env["start"], env["start"] + dt.timedelta(days=n - 1), None)]
        out["off"] = days_off
    if workers or overtime or absent or general:
        cal = copy.copy(env["calendar"])
        if workers > 0:
            cal.employees = list(cal.employees) + [f"+{i + 1}" for i in range(workers)]
        if absent or general:
            cal.away = defaultdict(dict, {d: {n: list(v) for n, v in rows.items()} for d, rows in cal.away.items()})
        if absent:
            for name, n in absent.items():
                for k in range(n):
                    cal.away[env["start"] + dt.timedelta(days=k)][name] = [None, PlanLeave.Kind.LEAVE]
        if general:
            name, first, last, hours = general
            if last is None:
                cal.standing = list(cal.standing) + [(0, name, first, hours, PlanLeave.Kind.GENERAL, "")]
            else:
                cal.all_hands = defaultdict(list, {d: list(v) for d, v in cal.all_hands.items()})
            for k in range((last - first).days + 1 if last else 0):
                cal.put(first + dt.timedelta(days=k), name, hours, PlanLeave.Kind.GENERAL)
        if overtime:
            cal.overtime = defaultdict(lambda: [0.0, 0.0], {k: list(v) for k, v in cal.overtime.items()})
            cal._ot_people = {k: list(v) for k, v in cal._ot_people.items()}
            day, n = env["start"], 0
            for _ in range(400):
                if n >= (overtime_days or LOAD_DAYS):
                    break
                if env["calendar"].day(day)["base"] > 0:
                    n += 1
                    if day not in cal._ot_people:
                        cal.overtime[day][0] = overtime
                        cal._ot_people[day] = [(overtime, None)]
                day += dt.timedelta(days=1)
        out["calendar"] = cal
    return out


class _Lab:
    """یک بار داده‌ها را می‌خواند و بعد هر فرضی را در چند هزارمِ ثانیه شبیه‌سازی می‌کند."""

    def __init__(self, today=None):
        self.t0 = time.monotonic()
        self.env = _prepare(today)
        self.now = _simulate(self.env)
        self.meta, self.queue = self.env["meta"], self.env["queue"]
        self.workers = len(self.env["employees"])
        self.base = self.outcome(self.now)

    def outcome(self, s):
        queue, meta = s["queue"], s["meta"]
        finish = {pid: s["last"].get(pid) for pid in queue}
        due = {pid: meta[pid].due_date for pid in queue}
        late = [(finish[pid] - due[pid]).days for pid in queue if due[pid] and finish[pid] and finish[pid] > due[pid]]
        return {"end": s["days"][-1]["date"] if s["days"] and not s["unfinished"] else None, "finish": finish,
                "days": len(s["days"]), "late": len(late), "lateDays": sum(late)}

    @staticmethod
    def score(o):
        """کوچک‌تر بهتر: پایانِ کلِ برنامه، بعد شمارِ دیرکردها، بعد جمعِ روزِ پایانِ پروژه‌ها."""
        never = dt.date.max.toordinal()
        return (o["end"].toordinal() if o["end"] else never, o["late"],
                sum(f.toordinal() if f else never for f in o["finish"].values()))

    @staticmethod
    def on_time(o):
        """کوچک‌تر بهتر، برای ترتیبِ پروژه‌ها: اول دیرکردها، بعد پایانِ برنامه."""
        never = dt.date.max.toordinal()
        return (o["late"], o["lateDays"], o["end"].toordinal() if o["end"] else never,
                sum(f.toordinal() if f else never for f in o["finish"].values()))

    def row(self, o, **more):
        base, meta = self.base, self.meta
        gains = [{"id": pid, "label": _label(meta[pid]), "finish": o["finish"][pid],
                  "gain": (base["finish"][pid] - o["finish"][pid]).days}
                 for pid in self.queue
                 if base["finish"].get(pid) and o["finish"].get(pid) and o["finish"][pid] != base["finish"][pid]]
        return {**more, "finish": o["end"],
                "endGain": (base["end"] - o["end"]).days if base["end"] and o["end"] else None,
                "workDaysSaved": base["days"] - o["days"], "late": o["late"],
                "projects": gains, "projectDays": sum(g["gain"] for g in gains), "better": self.score(o) < self.score(base)}

    def run(self, **tweak):
        return self.outcome(_simulate(_tweaked(self.env, **tweak)))

    def now_row(self):
        base = self.base
        return {"finish": base["end"], "late": base["late"], "days": base["days"], "unfinished": self.now["unfinished"],
                "projects": [{"id": pid, "label": _label(self.meta[pid]), "finish": base["finish"][pid],
                              "dueDate": self.meta[pid].due_date} for pid in self.queue]}

    def stations(self):
        """ایستگاه‌هایی که نفرِ بیشتر رویشان معنی دارد: کارِ مانده‌ای دارند که مسئول خودش اندازه‌اش را نگذاشته، و هنوز
        همهٔ کارگاه رویشان نیست."""
        open_at = defaultdict(int)
        for ts in self.env["tasks"].values():
            for t in ts:
                if t["frac"] < 1 and t["daily"] and not t["crewOwn"] and not t["manual"]:
                    open_at[t["station"]] += 1
        return [st for st in self.env["ctx"]["stations"]
                if st["active"] and open_at.get(st["id"]) and st["crew"] < self.workers]

    def better_order(self):
        """ترتیبِ دیگری از پروژه‌ها که دیرکردِ کمتری بدهد یا زودتر تمام شود: چند ترتیبِ شناخته‌شده و بعد جابه‌جاییِ
        دوتاییِ پروژه‌ها تا وقتی بهتر می‌شود."""
        queue = list(self.queue)
        if len(queue) < 2:
            return None
        far = dt.date.max
        left = {pid: sum((1 - t["frac"]) * t["planned"] * (t["hpm"] or 0) for t in self.env["tasks"][pid]) for pid in queue}
        tried = {}

        def test(q):
            key = tuple(q)
            if key not in tried:
                tried[key] = self.outcome(_simulate(_tweaked(self.env, queue=q)))
            return tried[key]

        best = queue
        for cand in (sorted(queue, key=lambda p: (self.meta[p].due_date or far, queue.index(p))),
                     sorted(queue, key=lambda p: (left[p], queue.index(p))),
                     sorted(queue, key=lambda p: (-left[p], queue.index(p)))):
            if self.on_time(test(cand)) < self.on_time(test(best)):
                best = cand
        for _ in range(8):
            improved = False
            for i, j in itertools.combinations(range(len(best)), 2):
                if time.monotonic() - self.t0 > WHATIF_BUDGET:
                    break
                cand = list(best)
                cand[i], cand[j] = cand[j], cand[i]
                if self.on_time(test(cand)) < self.on_time(test(best)):
                    best, improved = cand, True
            if not improved:
                break
        # پیشنهاد فقط وقتی می‌ارزد که دیرکرد کم شود یا کلِ برنامه زودتر تمام شود — نه فقط جابه‌جاییِ چند روز میانِ پروژه‌ها.
        if best == queue or not self.on_time(test(best))[:3] < self.on_time(self.base)[:3]:
            return None
        return self.row(test(best), ids=best, order=[_label(self.meta[p]) for p in best],
                        moved=sum(1 for x, y in zip(best, queue) if x != y), tried=len(tried))


def what_if(today=None):
    """«اگر نفر اضافه کنم چه می‌شود؟» — برنامه را با چند فرض دوباره می‌چیند و پایانِ واقعیِ هر کدام را می‌گوید.

      · یک نفرِ دیگر روی هر ایستگاهی که کارِ مانده دارد (هر کدام جدا)؛
      · یک کارگرِ تازه در کارگاه؛ روزی دو ساعت اضافه‌کاری در دو هفتهٔ کاریِ پیشِ رو؛ و اگر پروژه‌ای دیر می‌شود، کمترین
        اضافه‌کاری‌ای که همه را به تحویل برساند؛
      · بهترین جای یک، دو و سه نفرِ اضافه با هم — چون گاهی کمک به یک ایستگاه به‌تنهایی فقط گلوگاه را به ایستگاهِ بعد
        می‌برد و پایانِ برنامه تکان نمی‌خورد؛
      · و ترتیبِ بهتری از پروژه‌ها، اگر پیدا شود.

    فقط می‌خواند و حساب می‌کند؛ هیچ چیزِ برنامه عوض نمی‌شود."""
    lab = _Lab(today)
    env, now, base, workers = lab.env, lab.now, lab.base, lab.workers
    stations = lab.stations()
    name = {st["id"]: st["name"] for st in stations}
    crew = {st["id"]: st["crew"] for st in stations}

    def one_more(st):
        """در ایستگاهی که کمکی می‌گیرد، «یک نفرِ دیگر» یعنی یک کمکیِ دیگر کنارِ همان یک نفرِ اصلی."""
        aided = not st["people"] and any(s in env["helpers"] and any(sk and s not in sk for sk in env["skills"].values())
                                         for s in st["stages"])
        return f"یک {'کمکیِ' if aided else 'نفرِ'} دیگر روی «{st['name']}» ({_fa(st['crew'])} ← {_fa(st['crew'] + 1)} نفر)"

    options = [lab.row(lab.run(station={st["id"]: 1}), kind="station", station=st["id"], name=st["name"], crew=st["crew"],
                       label=one_more(st))
               for st in stations]
    if lab.queue:
        options.append(lab.row(lab.run(workers=1), kind="worker", label="یک کارگرِ تازه در کارگاه (نفراتِ ایستگاه‌ها همان بماند)"))
        options.append(lab.row(lab.run(overtime=WHATIF_OVERTIME), kind="overtime",
                               label=f"روزی {_fa(f'{WHATIF_OVERTIME:g}')} ساعت اضافه‌کاری برای همه، در {_fa(LOAD_DAYS)} روزِ کاریِ پیشِ رو"))
    if base["late"]:
        found = None
        for hours in (1, 2, 3, 4):
            o = lab.run(overtime=hours)
            found = (hours, o)
            if not o["late"]:
                break
        hours, o = found
        options.append(lab.row(o, kind="overtime-needed", hours=hours, label=(
            f"برای اینکه هیچ پروژه‌ای دیر نشود: روزی {_fa(hours)} ساعت اضافه‌کاری در {_fa(LOAD_DAYS)} روزِ کاریِ پیشِ رو"
            if not o["late"] else
            f"حتی با روزی {_fa(hours)} ساعت اضافه‌کاری در {_fa(LOAD_DAYS)} روزِ کاریِ پیشِ رو، هنوز {_fa(o['late'])} پروژه دیر می‌شود")))

    # بهترین جای ۱، ۲ و ۳ نفرِ اضافه با هم، میانِ پرکارترین ایستگاه‌ها (روزهایی که ایستگاه پر بوده)
    full = defaultdict(float)
    for x in now["days"]:
        for ln in x["lines"]:
            full[ln["station"]] += ln["share"]
    busy = sorted(stations, key=lambda st: -full[st["id"]])[:WHATIF_STATIONS]
    combos, best, cut = [], base, False
    for n in (1, 2, 3):
        found = None
        for pick in itertools.combinations_with_replacement([st["id"] for st in busy], n):
            if time.monotonic() - lab.t0 > WHATIF_BUDGET:
                cut = True
                break
            add = {sid: pick.count(sid) for sid in set(pick)}
            if any(crew[sid] + k > workers for sid, k in add.items()):
                continue
            o = lab.run(station=add)
            if found is None or lab.score(o) < lab.score(found[1]):
                found = (add, o)
        if found and lab.score(found[1]) < lab.score(best):
            best = found[1]
            combos.append(lab.row(found[1], people=n, stations=[
                {"id": sid, "name": name[sid], "add": k, "crew": crew[sid]}
                for sid, k in sorted(found[0].items(), key=lambda x: name[x[0]])]))
        if cut:
            break

    return {"today": env["today"], "workers": workers, "now": lab.now_row(),
            "options": options, "combos": combos, "partial": cut, "order": lab.better_order(),
            # برای فرضِ دلخواه در صفحه
            "choices": {"stations": [{"id": st["id"], "name": st["name"], "crew": st["crew"]}
                                     for st in env["ctx"]["stations"] if st["active"]],
                        "employees": list(env["employees"]),
                        "projects": [{"id": pid, "label": _label(lab.meta[pid])} for pid in lab.queue]},
            "seconds": round(time.monotonic() - lab.t0, 2)}


def what_if_custom(data, today=None):
    """فرضِ دلخواهِ مسئول: نفرِ بیشتر روی یک ایستگاه، کارگرِ تازه، اضافه‌کاری، خرابیِ یک ایستگاه، نبودنِ یک نفر، یا پروژه‌ای
    تازه مثلِ یکی از پروژه‌ها — هر چند تا با هم. چیزی ذخیره نمی‌شود."""
    if not isinstance(data, dict):
        raise ValidationError("درخواست نامعتبر است.")
    lab = _Lab(today)
    _, result = _assume(lab, data)
    return {"today": lab.env["today"], "now": lab.now_row(), "result": result}


def _assume(lab, data):
    """برنامه با فرض‌های data چیده می‌شود: (وضعیتِ کاملِ آن شبیه‌سازی، خلاصه‌اش در برابرِ برنامهٔ فعلی)."""
    if not isinstance(data, dict):
        raise ValidationError("درخواست نامعتبر است.")
    env = lab.env
    known = {st["id"]: st for st in env["ctx"]["stations"] if st["active"]}

    def whole(value, label, low, high):
        try:
            n = int(value)
        except (TypeError, ValueError, OverflowError):
            raise ValidationError(f"{label} عددی نیست.")
        if not low <= n <= high:
            raise ValidationError(f"{label} باید میان {_fa(low)} و {_fa(high)} باشد.")
        return n

    tweak, said = {}, []
    st = data.get("station") or {}
    if st:
        if not isinstance(st, dict) or str(st.get("id")) not in known:
            raise ValidationError("ایستگاه پیدا نشد.")
        n = whole(st.get("add", 1), "تعداد نفر", 1, 10)
        tweak["station"] = {str(st["id"]): n}
        said.append(f"{_fa(n)} نفرِ بیشتر روی «{known[str(st['id'])]['name']}»")
    if data.get("workers"):
        n = whole(data["workers"], "تعداد کارگر", 1, 20)
        tweak["workers"] = n
        said.append(f"{_fa(n)} کارگرِ تازه")
    ot = data.get("overtime") or {}
    if ot:
        try:
            hours = float(ot.get("hours") if isinstance(ot, dict) else ot)
        except (TypeError, ValueError):
            raise ValidationError("ساعت اضافه‌کاری عددی نیست.")
        if not 0 < hours <= 12:
            raise ValidationError("ساعت اضافه‌کاری باید بین ۰ و ۱۲ باشد.")
        n = whole(ot.get("days", LOAD_DAYS) if isinstance(ot, dict) else LOAD_DAYS, "تعداد روز", 1, 120)
        tweak.update(overtime=hours, overtime_days=n)
        said.append(f"روزی {_fa(f'{hours:g}')} ساعت اضافه‌کاری در {_fa(n)} روزِ کاری")
    off = data.get("off") or {}
    if off:
        if not isinstance(off, dict) or str(off.get("station")) not in known:
            raise ValidationError("ایستگاه پیدا نشد.")
        n = whole(off.get("days", 1), "تعداد روز", 1, 60)
        tweak["off"] = {str(off["station"]): n}
        said.append(f"«{known[str(off['station'])]['name']}» {_fa(n)} روز از کار بیفتد")
    gone = data.get("absent") or {}
    if gone:
        if not isinstance(gone, dict) or gone.get("employee") not in env["employees"]:
            raise ValidationError("کارگر پیدا نشد.")
        n = whole(gone.get("days", 1), "تعداد روز", 1, 60)
        tweak["absent"] = {gone["employee"]: n}
        said.append(f"«{gone['employee']}» {_fa(n)} روز نباشد")
    chore = data.get("general") or {}
    if chore:
        # یک نفر کلاً (یا چند ساعت در روز) کارِ عمومی کند: برنامه کارِ تولیدش را به بقیه می‌دهد. عقب می‌افتد؟
        if not isinstance(chore, dict) or chore.get("employee") not in list(env["employees"]) + [ALL]:
            raise ValidationError("کارگر پیدا نشد.")
        first = _date(chore.get("from"), "تاریخ شروع")
        last = None if chore.get("open") else _date(chore.get("to") or chore.get("from"), "تاریخ پایان")
        if last and last < first:
            raise ValidationError("تاریخ پایان پیش از شروع است.")
        if last and (last - first).days > 60:
            raise ValidationError("بازهٔ بیش از دو ماه را «تا اطلاعِ بعدی» بسنجید.")
        hours = chore.get("hours")
        if hours in (None, ""):
            hours = None
        else:
            try:
                hours = float(hours)
            except (TypeError, ValueError):
                raise ValidationError("ساعت را عددی وارد کنید.")
            if not 0 < hours <= 12:
                raise ValidationError("ساعت باید بین ۰ و ۱۲ باشد؛ برای کلِ روز خالی بگذارید.")
        tweak["general"] = (chore["employee"], first, last, hours)
        if chore.get("replace"):
            # ویرایشِ یک کارِ عمومی: برنامه «بی آن ردیف و با ردیفِ تازه» سنجیده می‌شود، نه «ردیفِ تازه روی قبلی». ردیف در یک
            # تراکنش کنار گذاشته، ورودی‌ها خوانده و همه‌چیز برگردانده می‌شود؛ چیزی ذخیره نمی‌شود.
            with transaction.atomic():
                point = transaction.savepoint()
                PlanLeave.objects.filter(pk=_int(chore.get("replace")) or 0).delete()
                env = _prepare(env["today"])
                transaction.savepoint_rollback(point)
        span = ("از " + _jdate(first.isoformat()) + " تا اطلاعِ بعدی" if last is None
                else _jdate(first.isoformat()) + (f" تا {_jdate(last.isoformat())}" if last != first else ""))
        who = "کلِ کارگاه" if chore["employee"] == ALL else f"«{chore['employee']}»"
        said.append(f"{who} {span} {'روزی ' + _fa(f'{hours:g}') + ' ساعت' if hours else 'کلِ روز'} کارِ عمومی کند")
    site = data.get("site") or {}
    if site:
        # کارِ محلِ یک پروژه با این تنظیم: در یک تراکنش ذخیره، ورودی‌ها خوانده و همه‌چیز برگردانده می‌شود؛ چیزی نمی‌ماند.
        if not isinstance(site, dict):
            raise ValidationError("درخواست نامعتبر است.")
        with transaction.atomic():
            point = transaction.savepoint()
            set_site(site, None, env["today"])
            env = _prepare(env["today"])
            transaction.savepoint_rollback(point)
        said.append(describe("site", site))
    goal = data.get("efficiency") or {}
    if goal:
        # برنامه با هدفِ دیگری از بهره‌وری: همان کارها با سرعتِ «هدفِ تازه ÷ هدفِ فعلی»
        try:
            target = float(goal.get("target") if isinstance(goal, dict) else goal)
        except (TypeError, ValueError):
            raise ValidationError("درصد را عددی وارد کنید.")
        now = env["efficiency"]
        if not now["base"] <= target <= min(now["base"] * 2, 100):
            raise ValidationError(f"هدف باید بین {_fa(f'{now['base']:g}')} و {_fa(f'{min(now['base'] * 2, 100):g}')} درصد باشد.")
        env = _at_speed(env, target / now["target"])
        said.append(f"هدفِ بهره‌وری {_fa(f'{target:g}')}٪ باشد")
    new = data.get("clone") or {}
    if new:
        pid = str(_int(new.get("project") if isinstance(new, dict) else new) or "")
        if pid not in env["tasks"]:
            raise ValidationError("پروژه در برنامه نیست.")
        first = bool(isinstance(new, dict) and new.get("first"))
        tweak["clone"] = (pid, first)
        said.append(f"پروژه‌ای تازه مثلِ «{_label(lab.meta[pid])}» {'اولِ' if first else 'آخرِ'} صف")
    if not tweak and not site and not goal:
        raise ValidationError("فرضی انتخاب نشده.")
    s = _simulate(_tweaked(env, **tweak) if tweak else env)
    result = lab.row(lab.outcome(s), label="؛ ".join(said))
    if site:
        pid = str(_int(site.get("project")) or "")
        result["site"] = _site_view(s, pid)
        result["siteProject"] = {"finish": s["last"].get(pid), "before": lab.base["finish"].get(pid)}
    if "clone" in tweak:
        result["newProject"] = s["last"].get("new")
    return s, result


# ---------- شبیه‌سازِ کارگاه ----------

SIM_ASSUME = ("station", "workers", "overtime", "off", "absent", "efficiency", "clone")   # فرض‌هایی که شبیه‌ساز می‌پذیرد


def _timeline(s):
    """یک برنامهٔ چیده‌شده، روزبه‌روز و فشرده: هر روز، هر ایستگاه چه کاری و چند متر — برای نمای متحرکِ کارگاه."""
    return [{"date": x["date"], "hours": x["base"] + x["overtime"], "overtime": x["overtime"], "present": x["present"],
             "pool": x["pool"], "used": x["used"], "closed": x["closed"],
             "lines": [{"station": ln["station"], "projectId": ln["projectId"], "stage": ln["stage"], "area": ln["area"],
                        "share": ln["share"], "people": ln["people"]} for ln in x["lines"] + x["site"]]}
            for x in s["days"]]


def simulator(data=None, today=None):
    """شبیه‌سازِ کارگاه: برنامهٔ فعلی روزبه‌روز و ایستگاه‌به‌ایستگاه، و اگر فرضی داده شده (همان فرض‌های «اگر…»)، همان برنامه با
    آن فرض کنارش. فقط می‌خواند و حساب می‌کند؛ چیزی ذخیره نمی‌شود."""
    if data is not None and not isinstance(data, dict):
        raise ValidationError("درخواست نامعتبر است.")
    assume = {k: v for k, v in (data or {}).items() if k in SIM_ASSUME and v}
    lab = _Lab(today)
    now, eff = lab.now, lab.env["efficiency"]

    def side(s):
        o = lab.outcome(s)
        return {"finish": o["end"], "late": o["late"], "unfinished": s["unfinished"], "days": _timeline(s),
                "finishes": {pid: s["last"].get(pid) for pid in s["queue"]},
                "crews": {st["id"]: st["crew"] for st in s["ctx"]["stations"] if st["active"]}}

    def project(s, pid):
        p, row = s["meta"][pid], s["rows"].get(pid) or {}
        return {"id": pid, "label": _label(p), "dueDate": p.due_date, "color": (p.plan_color or "").strip(),
                "percent": row.get("percent", 0)}

    out = {"today": now["today"], "start": now["start"],
           "stations": [{"id": st["id"], "name": st["name"], "stages": st["stages"]}
                        for st in now["ctx"]["stations"] if st["active"]]
                       + ([{"id": SITE, "name": SITE_NAME, "stages": []}] if now["sites"] else []),
           "projects": [project(now, pid) for pid in now["queue"]],
           "employees": list(now["employees"]),
           "efficiency": {"base": eff["base"], "target": eff["target"], "max": min(eff["base"] * 2, 100)},
           "now": side(now), "scenario": None}
    if assume:
        s, row = _assume(lab, assume)
        out["scenario"] = {**side(s), "label": row["label"], "endGain": row["endGain"], "better": row["better"],
                           "gains": row["projects"],
                           "extra": [project(s, pid) for pid in s["queue"] if pid not in now["queue"]]}
    return out


# ---------- مواد ----------

def materials(today=None):
    """موادِ لازم برای کارهای دو هفتهٔ کاریِ پیشِ رو (و کلِ برنامه) در برابر موجودیِ انبارِ مصرفیِ کارگاه.

    تخمین است، نه حسابداری: متراژِ دست‌های آستر و رنگ در برنامه × مصرفِ استانداردِ هر دست (با هاردنر)، و موجودی از روی
    نامِ کالاها گروه می‌شود (آستر، رویه، تینر). رنگ‌بندیِ هر پروژه دیده نمی‌شود — فقط جمعِ هر گروه."""
    from . import material_consumption as mc
    from . import stock_reports
    from .models import Sku, Warehouse

    s = schedule(today)
    kinds = {name: mc._stage_kind(name) for name in s["ctx"]["order"]}

    def coats(days):
        out = defaultdict(float)
        for x in days:
            for ln in x["lines"] + x.get("site", []):         # کارِ محلِ پروژه هم از همین انبار مواد می‌برد
                if kinds.get(ln["stage"]):
                    out[kinds[ln["stage"]]] += ln["area"]
        return out

    ahead = s["days"][:LOAD_DAYS]
    soon, whole = coats(ahead), coats(s["days"])
    warehouse = Warehouse.objects.filter(supplies_workshop=True, active=True).order_by("id").first()
    stock, unknown = defaultdict(float), 0
    if warehouse:
        on_hand = stock_reports.on_hand_map(warehouse)
        for sku in Sku.objects.filter(pk__in=[k for k, v in on_hand.items() if v and v > 0]):
            group = mc.group_of(sku.display_name)
            if group not in ("primer", "topcoat", "thinner"):
                continue
            qty, base, alt = float(on_hand[sku.pk]), (sku.base_unit or "").strip(), (sku.alt_unit or "").strip()
            if base in mc.MASS_UNITS:
                stock[group] += qty
            elif alt in mc.MASS_UNITS and sku.alt_to_base:
                stock[group] += qty / float(sku.alt_to_base)
            else:
                unknown += 1

    def need(group, area):
        if group == "thinner":
            return mc._thinner_standard(area["primer"], area["topcoat"])
        lo, hi = mc._standard(group)
        return area[group] * lo, area[group] * hi

    rows = []
    for group, label in (("primer", "آستر و هاردنرش"), ("topcoat", "رنگ رویه و هاردنرش"), ("thinner", "تینر")):
        lo, hi = need(group, soon)
        wlo, whi = need(group, whole)
        have = stock[group]
        rows.append({"group": group, "label": label,
                     "area": round(soon["primer"] + soon["topcoat"] if group == "thinner" else soon[group], 1),
                     "need": [round(lo, 1), round(hi, 1)], "needAll": [round(wlo, 1), round(whi, 1)],
                     "stock": round(have, 1),
                     "status": "none" if hi <= 0 else "short" if have < lo else "tight" if have < hi else "ok",
                     "short": round(max(lo - have, 0.0), 1)})
    return {"today": s["today"], "days": len(ahead), "until": ahead[-1]["date"] if ahead else None,
            "warehouse": warehouse.name if warehouse else None, "rows": rows, "unknownUnits": unknown,
            "short": [r["label"] for r in rows if r["status"] == "short"]}


def _baseline():
    """برنامهٔ ثبت‌شده: [شروع، پایان]ِ هر کار و هر پروژه."""
    job, proj = {}, {}
    for pid, stage, d, where in PlanBaselineLine.objects.values_list("project_id", "stage", "date", "station_name"):
        # کارِ محلِ پروژه در پایانِ پروژه حساب است، ولی نوارِ همان مرحله در کارگاه را کش نمی‌دهد
        for box, k in ((proj, str(pid)),) if where == SITE_NAME else ((job, (str(pid), stage)), (proj, str(pid))):
            if k not in box:
                box[k] = [d, d]
            else:
                box[k] = [min(box[k][0], d), max(box[k][1], d)]
    return job, proj


def _general_hours(since, start, cal):
    """کارِ عمومیِ کارگاه در هر روزِ گذشته: ساعتِ برنامه‌ریزی‌شده در برابر ساعتِ گزارش‌شده (تأییدشده).

    کسی که تیکِ «کار عمومی» دارد هر وقت کارِ پروژه نداشته باشد کارِ عمومی می‌کند؛ ساعتِ عادیِ او «مجاز» است (allowed) و
    گزارشِ کارِ عمومی‌اش بیش از برنامه شمرده نمی‌شود."""
    planned, allowed = defaultdict(float), defaultdict(float)
    ticked = set(Employee.objects.filter(active=True, plan_general=True).values_list("name", flat=True)) - _master_names()
    d = since
    while d < start:
        info = cal.day(d)
        allowed[d] = sum(info["regular"].get(n, 0.0) for n in ticked)
        for a in info["away"]:
            if a["kind"] == PlanLeave.Kind.GENERAL:
                planned[d] += a["hours"] if a["hours"] is not None else info["base"]
        for _, target, h, _, _ in info["fill"]:              # در وقتِ بی‌کاری: تا همین‌قدر (بی عدد: تا کلِ روز) جا دارد
            planned[d] += (h if h is not None else info["base"]) * (len(set(cal.employees)) if target == ALL else 1)
        d += dt.timedelta(days=1)
    actual = {day: production._f(h) for day, h in
              ReportItem.objects.filter(report__date__gte=since, report__date__lt=start,
                                        report__status=DailyReport.Status.APPROVED, project__general=True)
              .values_list("report__date").annotate(h=Sum("hours"))}
    return planned, actual, allowed


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
        by_day[ln.date].append({"station": SITE if ln.station_name == SITE_NAME else by_stage.get(ln.stage, ""),
                                "stationName": ln.station_name, "projectId": str(ln.project_id),
                                "project": _label(ln.project), "stage": ln.stage,
                                "planned": round(float(ln.area), 2), "actual": round(act, 2)})
    gplan, gact, gfree = _general_hours(since, start, cal) if cal else ({}, {}, {})
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
                    "generalPlanned": round(gplan.get(d, 0.0), 1), "generalActual": round(gact.get(d, 0.0), 1),
                    "generalAllowed": round(gfree.get(d, 0.0), 1)})
    stats = None
    if pcts:
        avg = sum(pcts) / len(pcts)
        stats = {"days": len(pcts), "avgPercent": round(avg, 1),
                 "stdPercent": round(math.sqrt(sum((x - avg) ** 2 for x in pcts) / len(pcts)), 1),
                 "planned": round(sum(d["planned"] for d in out), 2), "actual": round(sum(d["actual"] for d in out), 2)}
    return out, stats


def efficiency_setting():
    """مبنا و هدفِ بهره‌وریِ پرسنل، و ضریبی که برنامهٔ خط با آن تندتر از سابقه چیده می‌شود."""
    row = ProductionSettings.get()
    base, target = float(row.plan_eff_base or 50), float(row.plan_eff_target or 0)
    target = target or base
    return {"base": round(base, 1), "target": round(target, 1), "factor": round(target / base, 4) if base > 0 else 1.0}


def _at_speed(env, factor):
    """همان ورودی‌ها با سرعتِ دیگر (factor برابرِ سرعتِ فعلیِ برنامه). مدتی که مسئول دستی گذاشته دست نمی‌خورد."""
    out = dict(env)
    out["tasks"] = {pid: [t if t["manual"] or not t["daily"] else
                          {**t, "daily": t["daily"] * factor, "suggested": t["suggested"] * factor if t["suggested"] else t["suggested"]}
                          for t in ts] for pid, ts in env["tasks"].items()}
    out["sites"] = {pid: {**st, "tasks": [{**t, "per": t["per"] * factor} for t in st["tasks"]]}
                    for pid, st in (env.get("sites") or {}).items()}
    return out


def _week_start(day):
    return day - dt.timedelta(days=(day.weekday() - 5) % 7)              # شنبهٔ همان هفته


def productivity_trend(today=None, base=None):
    """بهره‌وریِ پرسنل در هفته‌های اخیر، از روی گزارش‌های تأییدشده.

    کارگاه ساعت را هر روز ثبت می‌کند ولی متراژ را وقتی که کار (یا تکه‌ای از آن) تمام شد. پس هر بار که برای یک مرحلهٔ یک
    پروژه متراژ ثبت می‌شود، همهٔ ساعت‌هایی که از ثبتِ قبلی تا همان روز روی آن رفته به همان متراژ می‌رسد، و در هفتهٔ همان
    ثبت شمرده می‌شود: «ساعتِ استاندارد» (متراژ × ساعت بر مترِ میانگینِ کلِ سابقهٔ همان مرحله) تقسیم بر ساعتِ واقعی. ۱ یعنی
    همان سرعتِ میانگینِ سابقه؛ در «مبنا» ضرب می‌شود تا درصد شود. ساعتی که هنوز متراژی پس از آن ثبت نشده (کارِ در جریان)
    در هیچ هفته‌ای نمی‌آید و جدا گفته می‌شود. «الان» = EFF_WINDOW هفتهٔ اخیر، «قبل» = EFF_WINDOW هفتهٔ پیش از آن."""
    today = today or dt.date.today()
    base = efficiency_setting()["base"] if base is None else base
    rates = {n: r["hoursPerM2"] for n, r in production.stage_time_rates().items() if r.get("measured") and r.get("hoursPerM2")}
    first = _week_start(today) - dt.timedelta(weeks=EFF_WEEKS - 1)
    done, worked = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    for pid, stage, day, a in (ReportProgress.objects
                               .filter(report__date__lte=today, area__gt=0, stage__in=list(rates),
                                       report__status=DailyReport.Status.APPROVED, project__general=False)
                               .values_list("project_id", "stage", "report__date").annotate(a=Sum("area"))):
        done[(pid, stage)][day] += production._f(a)
    for pid, stage, day, h in (ReportItem.objects
                               .filter(report__date__lte=today, activity__in=list(rates), rework=False,
                                       report__status=DailyReport.Status.APPROVED, project__general=False, project__isnull=False)
                               .values_list("project_id", "activity", "report__date").annotate(h=Sum("hours"))):
        worked[(pid, stage)][day] += production._f(h)
    earned, spent, loose = defaultdict(float), defaultdict(float), []
    for key, days in worked.items():
        marks = sorted(done.get(key, ()))                    # روزهایی که برای این کار متراژ ثبت شده
        k, got, since = 0, 0.0, []
        for day in sorted(days):
            while k < len(marks) and marks[k] < day:         # ساعت‌های تا این ثبت بسته می‌شود
                if got > 0:
                    earned[_week_start(marks[k])] += done[key][marks[k]] * rates[key[1]]
                    spent[_week_start(marks[k])] += got
                k, got, since = k + 1, 0.0, []
            got += days[day]
            since.append(day)
        if k < len(marks):                                   # اولین ثبتِ متراژِ هم‌روز یا پس از آخرین ساعت‌ها
            earned[_week_start(marks[k])] += sum(done[key][m] for m in marks[k:]) * rates[key[1]]
            spent[_week_start(marks[k])] += got
        elif got >= 1 and since[-1] >= first:                # ساعت هست، متراژ نیست
            loose.append((got, key, since[0], since[-1], marks[-1] if marks else None))
    pending = sum(x[0] for x in loose)
    names = {p.pk: p for p in Project.objects.filter(pk__in=[x[1][0] for x in loose])}
    missing = [{"projectId": str(key[0]), "project": _label(names[key[0]]), "stage": key[1], "hours": round(h, 1),
                "from": a, "to": b, "lastArea": last, "closed": bool(names[key[0]].closed_at)}
               for h, key, a, b, last in sorted(loose, key=lambda x: (-x[0], x[1])) if key[0] in names]
    weeks = [first + dt.timedelta(weeks=k) for k in range(EFF_WEEKS)]
    rows = [{"start": w, "hours": round(spent[w], 1), "earned": round(earned[w], 1),
             "percent": round(base * earned[w] / spent[w], 1) if spent[w] >= 8 else None} for w in weeks]

    def window(ws):
        e, h = sum(earned[w] for w in ws), sum(spent[w] for w in ws)
        return (round(base * e / h, 1), round(h, 1)) if h >= 40 else (None, round(h, 1))     # کمتر از یک هفتهٔ یک نفر: بی‌معنی

    now, now_h = window(weeks[-EFF_WINDOW:])
    before, before_h = window(weeks[-2 * EFF_WINDOW:-EFF_WINDOW])
    trend = None
    if now is not None and before is not None:
        trend = "up" if now >= before * 1.05 else "down" if now <= before * 0.95 else "flat"
    return {"weeks": rows, "now": now, "nowHours": now_h, "before": before, "beforeHours": before_h, "trend": trend,
            "window": EFF_WINDOW, "pendingHours": round(pending, 1), "missing": missing}


def _site_view(s, pid):
    """کارِ محلِ یک پروژه برای صفحه: تنظیم‌ها، مرحله‌ها و روزهایی که تیم آنجاست."""
    st = s["sites"].get(pid)
    if not st:
        return None
    res = s["site"][pid]
    jobs = []
    for k, t in enumerate(st["tasks"]):
        area = (1 - t["frac"]) * t["planned"]
        area = area if area >= DUST else 0.0
        sp = res["span"].get(t["name"])
        jobs.append({"stage": t["name"], "planned": round(t["planned"], 2), "remaining": round(area, 2),
                     "hours": round(area * (t["hpm"] or 0) / SITE_SPEED, 1), "percent": round(t["frac"] * 100),
                     "start": sp[0] if sp else None, "finish": sp[1] if sp else None, "dryDays": t["dry"]})
    days = [d["date"] for d in s["days"] if any(x["projectId"] == pid for x in d["siteTeams"])]
    ends = [j["finish"] for j in jobs if j["finish"]]
    return {"area": st["area"], "note": st["note"], "all": st["all"], "team": st["team"], "master": st["master"],
            "from": st["from"], "ready": st["ok"], "stages": st["stages"], "jobs": jobs, "days": days,
            "start": min(j["start"] for j in jobs if j["start"]) if ends else None, "finish": max(ends) if ends else None,
            "remaining": round(sum(j["remaining"] for j in jobs), 2),
            # آنچه با این تیم و این روز در برنامه جا نگرفت
            "unplanned": round(sum((1 - res["frac"][k]) * t["planned"] for k, t in enumerate(st["tasks"])), 2)}


def plan(today=None):
    """همه‌چیزِ صفحهٔ برنامه‌ریزی تولید."""
    env = _prepare(today)
    s = _simulate(env)
    # برنامهٔ خط با هدفِ بهره‌وری چیده می‌شود؛ کنارش پایانِ هر پروژه «با سرعتِ فعلی» (سابقه) هم می‌آید — برای قول به مشتری.
    eff = env["efficiency"]
    real = _simulate(_at_speed(env, 1 / eff["factor"])) if abs(eff["factor"] - 1) > 1e-6 else None
    tasks, meta, stations = s["tasks"], s["meta"], {st["id"]: st for st in s["stations"]}
    base_job, base_proj = _baseline()

    def slip(now, base):
        return (now - base).days if now and base else None

    def paused_days(since, until):
        """روزهای توقف از آغازِ برنامهٔ ثبت‌شده تا پایانِ کار در برنامهٔ فعلی — توقفی که هنوز نرسیده ولی معلوم است هم."""
        return _pause_days(s["pauses"], pid, since, max(until or s["today"], s["today"]))

    def own(days, since, until=None):
        """عقب‌افتادگیِ خودِ کارگاه: روزهایی که پروژه متوقف بود (یا خواهد بود) از آن کم می‌شود."""
        return None if days is None else days - paused_days(since, until)

    chain = _critical(s)
    on_chain = {(q, k) for q, k, _ in chain}
    projects = []
    for n, pid in enumerate(s["queue"], 1):
        p = meta[pid]
        jobs, total_h, total_a = [], 0.0, 0.0
        before = 1.0
        for k, t in enumerate(tasks[pid]):
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
                "why": _why_text(s, pid, k) if area else "", "critical": (pid, k) in on_chain,
                "color": t["color"] if t["changeover"] else "", "changeoverHours": t["changeover"],
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
                "slipDays": own(slip(sp[1] if sp else None, base), bstart, sp[1] if sp else None) if area else None,
                "pauseDays": paused_days(bstart, sp[1] if sp else None) if area and base else 0,
                "overdue": t.get("overdue", False),
                "ready": ready, "coat": bool(t.get("coat")),
            })
            late = (jobs[-1]["slipDays"] or 0) > 0
            jobs[-1]["status"] = ("done" if not area else "late" if late else
                                  "waiting" if not ready else "doing" if t["frac"] > 0 else "ready")
        site = _site_view(s, pid)
        if site:                                           # کارِ محل هم کارِ ماندهٔ همین پروژه است
            total_a += sum(j["remaining"] for j in site["jobs"])
            total_h += sum(j["hours"] for j in site["jobs"])
        finish = s["last"].get(pid)
        bstart, base = base_proj.get(pid, (None, None))
        slack = (p.due_date - finish).days if p.due_date and finish else None
        calm = real["last"].get(pid) if real else finish       # پایان با سرعتِ فعلی
        projects.append({
            "id": pid, "name": p.name, "label": _label(p), "order": n, "pinned": p.plan_priority is not None,
            "dueDate": p.due_date, "state": s["rows"][pid]["state"], "owner": p.owner_name,
            "percent": s["rows"][pid]["percent"], "plannedArea": s["rows"][pid]["planned"],
            "doneArea": round(s["rows"][pid]["done"], 2),
            "remaining": round(total_a, 2), "hours": round(total_h, 1),
            "start": s["first"].get(pid), "finish": finish,
            "baselineStart": bstart, "baselineFinish": base, "slipDays": own(slip(finish, base), bstart, finish),
            "totalSlipDays": slip(finish, base),
            "pauseDays": paused_days(bstart, finish) if base else 0,
            "slackDays": slack, "onTime": None if slack is None else slack >= 0,
            "realFinish": calm, "realOnTime": None if not (p.due_date and calm) else calm <= p.due_date,
            "color": (p.plan_color or "").strip(), "startDate": p.start_date, "holdUntil": s["projectStart"].get(pid),
            "jobs": jobs,
            # کار در محلِ پروژه: «بخشی سر پروژه» تا متراژش وارد نشود site ندارد
            "workSite": p.work_site or "", "site": site,
            "baseArea": float(p.base_area or 0) or max((x["planned"] for x in s["rows"][pid]["stages"] if x["inPlan"]), default=0.0),
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
    # توانِ کارگاه در دو هفتهٔ کاریِ پیشِ رو: چند نفر-روز هست و چند نفر-روزش کار دارد
    ahead = s["days"][:LOAD_DAYS]
    room, used = sum(x["pool"] for x in ahead), sum(x["used"] for x in ahead)
    idle = round(max(room - used, 0.0), 1)
    filled = round(min(sum(f["hours"] for x in ahead for f in x["fill"]) / DAY_HOURS, max(room - used, 0.0)), 1)
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
        "critical": [{"projectId": q, "project": _label(meta[q]), "stage": tasks[q][k]["name"],
                      "start": s["span"][q][tasks[q][k]["name"]][0], "finish": s["span"][q][tasks[q][k]["name"]][1],
                      "link": link, "why": _link_text(s, q, k, link)} for q, k, link in chain],
        "stationOff": [{"id": str(o.pk), "station": o.station_key, "name": o.station_name, "from": o.date_from,
                        "to": o.date_to, "hours": float(o.hours) if o.hours else None, "reason": o.reason}
                       for o in PlanStationOff.objects.filter(date_to__gte=s["today"] - dt.timedelta(days=7))],
        "reworks": [{"id": str(r.pk), "projectId": str(r.project_id), "project": _label(r.project), "stage": r.stage,
                     "stages": r.stages, "area": float(r.area), "reason": r.reason, "by": r.by_name, "at": r.at}
                    for r in PlanRework.objects.filter(project__closed_at__isnull=True).select_related("project")[:60]],
        "skills": {n: sorted(st, key=lambda x: s["ctx"]["order"].get(x, 10 ** 6)) for n, st in s["skills"].items()},
        "helperStages": sorted(s["helpers"], key=lambda x: s["ctx"]["order"].get(x, 10 ** 6)),
        # مهارتِ «خدمات عمومی کارگاه و تعمیر و نگهداری» و کارهای عمومی‌ای که می‌شود سپرد
        "generalPeople": sorted(n for n in s["general"] if n in set(s["employees"])),
        "masters": sorted(s["masters"]),
        # سرکارگر (رنگ‌کارِ اصلی) و مرحله‌هایی که اولویتِ نفرِ اصلی‌شان با اوست
        "foremen": sorted(n for n in s["foremen"] if n in set(s["employees"])),
        "primeStages": sorted(s["prime"], key=lambda x: s["ctx"]["order"].get(x, 10 ** 6)),
        "generalWorks": list(Project.objects.filter(general=True, active=True, closed_at__isnull=True)
                             .order_by("name").values_list("name", flat=True)),
        "loadDays": LOAD_DAYS, "coatRounds": COAT_ROUNDS,
        "efficiency": _efficiency_view(s, real, eff, past),
        "undo": _undo_info(),
        "pauseReasons": [{"id": k, "label": v} for k, v in ProjectPause.Reason.choices],
        "leaves": [{"id": str(lv.pk), "employee": lv.employee, "from": lv.date_from, "to": lv.date_to, "note": lv.note,
                    "kind": lv.kind, "hours": float(lv.hours) if lv.hours else None, "open": lv.date_to >= OPEN_END}
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
                   "idle": idle, "filled": filled, "utilization": round(used / room * 100, 1) if room else None,
                   "paused": ProjectPause.objects.filter(end__isnull=True, project__closed_at__isnull=True).count()},
        "warnings": s["warnings"],
    }


def _efficiency_view(s, real, eff, past):
    """بهره‌وریِ پرسنل برای صفحه: مبنا و هدف، روندِ واقعی از گزارش‌ها، دو پایانِ برنامه، و اینکه وقتِ پلهٔ بعد شده یا نه."""
    trend = productivity_trend(s["today"], eff["base"])
    end = lambda x: x["days"][-1]["date"] if x["days"] and not x["unfinished"] else None       # noqa: E731
    # تحققِ برنامهٔ روزانه در ده روزِ کاریِ اخیر: پلهٔ بعد وقتی که هدفِ فعلی جا افتاده باشد
    recent = [d["percent"] for d in past[-10:] if d["percent"] is not None]
    met = round(sum(recent) / len(recent), 1) if len(recent) >= 5 else None
    advice = None if met is None else "raise" if met >= 90 else "hold" if met >= 70 else "high"
    late = lambda x: sum(1 for pid in x["queue"]                                                # noqa: E731
                         if x["meta"][pid].due_date and x["last"].get(pid) and x["last"][pid] > x["meta"][pid].due_date)
    return {**eff, **trend, "step": EFF_STEP, "planFinish": end(s), "realFinish": end(real) if real else end(s),
            "planLate": late(s), "realLate": late(real) if real else late(s),
            "met": met, "metDays": len(recent), "advice": advice}


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
    if not isinstance(ids, (list, tuple)) or any(_int(i) is None for i in ids):
        raise ValidationError("فهرست پروژه‌ها نامعتبر است.")
    ids = [_int(i) for i in ids]
    Project.objects.exclude(pk__in=ids).exclude(plan_priority__isnull=True).update(plan_priority=None)
    for n, pk in enumerate(ids, 1):
        Project.objects.filter(pk=pk).update(plan_priority=n)


@transaction.atomic
def shift_project(data, user, today=None):
    """همهٔ کارهای ماندهٔ یک پروژه را چند روز جلو یا عقب می‌برد (کشیدنِ نوارِ پروژه در گانت)."""
    pk = str(_int(data.get("project")) or "")
    try:
        delta = int(data.get("days"))
    except (TypeError, ValueError, OverflowError):
        raise ValidationError("تعداد روز جابه‌جایی عددی نیست.")
    if abs(delta) > 366:
        raise ValidationError("جابه‌جاییِ بیش از یک سال ممکن نیست.")
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
    if _int(sid):
        return Station.objects.filter(pk=_int(sid), active=True).first()
    sid = str(sid)
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
    wanted = {n for n in (_int(i) for i in (ids if isinstance(ids, (list, tuple)) else [])) if n} - {task.project_id}
    mates = list(Project.objects.filter(pk__in=wanted, general=False))
    for p in mates:
        if p.closed_at or not p.active:
            raise ValidationError(f"پروژهٔ «{_label(p)}» بسته یا غیرفعال است و نمی‌شود کاری را با آن «با هم» کرد.")
        if not p.stages.filter(name=task.stage).exists():
            raise ValidationError(f"پروژهٔ «{_label(p)}» مرحلهٔ «{task.stage}» ندارد.")
    old = task.batch
    touched = {old}
    if not mates:
        task.batch = None                              # فقط همین کار جدا می‌شود؛ بقیهٔ دسته با هم می‌مانند
    else:
        others = [PlanTask.objects.get_or_create(project=p, stage=task.stage)[0] for p in mates]
        touched.update(o.batch for o in others)
        number = old or next((o.batch for o in others if o.batch), None) \
            or (PlanTask.objects.filter(stage=task.stage).order_by("-batch").values_list("batch", flat=True).first() or 0) + 1
        for o in others:
            o.batch = number
            o.updated_by_name = user.name or user.username
            o.save()
        task.batch = number
        if old:                                        # دستهٔ خودش را از نو چیده: هر که در فهرست نیست جدا می‌شود
            for o in (PlanTask.objects.filter(stage=task.stage, batch=old).exclude(pk=task.pk)
                      .exclude(project_id__in=[p.pk for p in mates])):
                o.batch = None
                _tidy(o)
    task.save()
    # هر دسته‌ای که با این تغییر تک‌نفره مانده، دیگر دسته نیست
    for number in (touched | {task.batch}) - {None}:
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


def _speed(value, rounding=None):
    """متر در روز برای ذخیره: دو رقم اعشار، و نه آن‌قدر بزرگ که در ستونش جا نشود."""
    value = Decimal(str(value))
    value = value.quantize(Decimal("0.01"), rounding=rounding) if rounding else Decimal(str(round(value, 2)))
    if value >= 10 ** 7:
        raise ValidationError("این مدت برای این متراژ خیلی کوتاه است.")
    return value


@transaction.atomic
def set_task(data, user, today=None):
    """مدت، نفرات، ایستگاه، زودترین شروع و «با هم بودنِ» یک کار. days خالی یعنی «پیشنهاد سیستم»."""
    if not isinstance(data, dict):
        raise ValidationError("درخواست نامعتبر است.")
    pk = _int(data.get("project"))
    project = Project.objects.filter(pk=pk, general=False).first() if pk else None
    stage = data.get("stage")
    stage = stage.strip() if isinstance(stage, str) else ""
    if project is None or not WorkStage.objects.filter(name=stage).exists():
        raise ValidationError("پروژه یا مرحله پیدا نشد.")
    if project.closed_at or not project.active:
        raise ValidationError("این پروژه بسته یا غیرفعال است و در برنامه نیست.")
    if not project.stages.filter(name=stage).exists():
        # تصمیمی برای مرحله‌ای که پروژه ندارد در هیچ صفحه‌ای دیده نمی‌شود ولی مثلاً جلوی حذفِ ایستگاهش را می‌گیرد
        raise ValidationError(f"این پروژه مرحلهٔ «{stage}» ندارد.")
    task, _ = PlanTask.objects.get_or_create(project=project, stage=stage)

    if "crew" in data:
        crew = data.get("crew")
        if crew in (None, ""):
            crew = None
        else:
            try:
                crew = int(crew)
            except (TypeError, ValueError, OverflowError):
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
            if not math.isfinite(days) or days <= 0:
                raise ValidationError("تعداد روز باید بزرگ‌تر از صفر باشد.")
            if not 0.05 <= days <= 2000:
                raise ValidationError("تعداد روز باید میان ۰٫۰۵ و ۲۰۰۰ باشد.")
            remaining = _remaining(project, stage)
            if not remaining:
                raise ValidationError("از این مرحله کاری نمانده که برایش روز تعیین شود.")
            task.daily_area = _speed(remaining / days)
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
        if task.not_before and task.not_before > (today or dt.date.today()) + dt.timedelta(days=730):
            raise ValidationError("روز شروع بیش از دو سال جلوتر است.")
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
        task.daily_area = _speed(Decimal(str(remaining)) / Decimal(str(room)), ROUND_UP)
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
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise ValidationError("فهرست ایستگاه‌ها نامعتبر است.")
    stage_names = set(WorkStage.objects.values_list("name", flat=True))
    employees = set(Employee.objects.values_list("name", flat=True))
    crews = stage_crews()

    def clean(raw):
        name = raw.get("name")
        name = name.strip() if isinstance(name, str) else ""
        if len(name) > 100:
            raise ValidationError("نام ایستگاه بلندتر از ۱۰۰ حرف است.")
        listed = lambda v: [x for x in v if isinstance(x, str)] if isinstance(v, (list, tuple)) else []  # noqa: E731
        stages = [x for x in dict.fromkeys(listed(raw.get("stages"))) if x in stage_names]
        people = [x for x in dict.fromkeys(listed(raw.get("people"))) if x in employees]     # هر کس یک بار
        try:
            crew = int(raw.get("crew") or 1)
        except (TypeError, ValueError, OverflowError):
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

    ids = [_int(r.get("id")) for r in keep if _int(r.get("id"))]
    going = Station.objects.exclude(pk__in=ids)
    # فقط کاری که هنوز مانده ایستگاهش را نگه می‌دارد؛ کارِ تمام‌شده یا مرحله‌ای که از پروژه برداشته شده نه.
    busy = [t for t in (PlanTask.objects.filter(station__in=going, project__closed_at__isnull=True, project__active=True)
                        .select_related("station", "project"))
            if _remaining(t.project, t.stage) > 0]
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
        st = Station.objects.filter(pk=_int(raw.get("id"))).first() if _int(raw.get("id")) else None
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
    p = Project.objects.filter(pk=_int(data.get("project")) or 0, general=False).first()
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
    pz = ProjectPause.objects.filter(project_id=_int(data.get("project")) or 0,
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


def _link_text(s, pid, i, link):
    """در زنجیرهٔ بحرانی: این کار چرا زودتر نشد."""
    if not link:
        return "از اولین روزِ برنامه و با توانِ کامل"
    prev = s["tasks"][pid][i - 1]["name"] if i else ""
    text = WHY.get(link, "")
    if link in ("prev", "dry") and prev:
        text = text.replace("مرحلهٔ قبل", f"«{prev}»")
    return text


def add_station_off(data, user, today=None):
    """خرابی یا تعطیلیِ یک ایستگاه از روزی تا روزی (یا چند ساعت از هر روز)."""
    key = str(data.get("station") or "").strip()
    known = {st["id"]: st["name"] for st in _stations(_stage_order()) if st["active"]}
    if key not in known:
        raise ValidationError("ایستگاه پیدا نشد.")
    start = _date(data.get("from"), "تاریخ شروع")
    end = _date(data.get("to") or data.get("from"), "تاریخ پایان")
    if end < start:
        raise ValidationError("تاریخ پایان پیش از شروع است.")
    if (end - start).days > 120:
        raise ValidationError("تعطیلیِ بیش از چهار ماه را جدا ثبت کنید (یا ایستگاه را غیرفعال کنید).")
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
    reason = data.get("reason")
    PlanStationOff.objects.create(station_key=key, station_name=known[key], date_from=start, date_to=end,
                                  hours=Decimal(str(hours)) if hours else None,
                                  reason=(reason if isinstance(reason, str) else "").strip()[:200],
                                  created_by_name=user.name or user.username)


@transaction.atomic
def set_skills(data, user):
    """مهارتِ نفرات: {نام: [مرحله‌هایی که انجام می‌دهد]}؛ فهرستِ خالی یعنی همه‌کاره. با helpers، مرحله‌هایی که «کمکی»
    می‌گیرند: کنارِ یک نفرِ ماهر، بقیهٔ نفراتِ کار هر کارگری می‌تواند باشد."""
    rows = data.get("skills")
    if not isinstance(rows, dict):
        raise ValidationError("فهرست مهارت‌ها نامعتبر است.")
    stages = set(_stage_order())
    if "helpers" in data:
        want = data.get("helpers")
        if not isinstance(want, (list, tuple)) or not all(isinstance(x, str) for x in want):
            raise ValidationError("فهرست مرحله‌های کمکی‌بگیر نامعتبر است.")
        WorkStage.objects.filter(helpers_ok=True).exclude(name__in=want).update(helpers_ok=False)
        WorkStage.objects.filter(name__in=[x for x in want if x in stages], helpers_ok=False).update(helpers_ok=True)
    if "foremen" in data:
        # سرکارگر: فقط یک نفر. رنگ رویه اول با اوست و میانِ استادکارها وقتِ آزاد به او می‌رسد (قاعده ثابت است).
        want = data.get("foremen")
        if not isinstance(want, (list, tuple)) or not all(isinstance(x, str) for x in want):
            raise ValidationError("سرکارگر نامعتبر است.")
        want = list(Employee.objects.filter(active=True, name__in=want).values_list("name", flat=True))
        if len(want) > 1:
            raise ValidationError("سرکارگر فقط یک نفر است.")
        Employee.objects.filter(plan_foreman=True).exclude(name__in=want).update(plan_foreman=False)
        Employee.objects.filter(active=True, name__in=want, plan_foreman=False).update(plan_foreman=True)
    if "general" in data:
        # «خدمات عمومی کارگاه و تعمیر و نگهداری»: کسانی که می‌شود وقتِ بی‌کاری‌شان را به کارِ عمومی سپرد
        want = data.get("general")
        if not isinstance(want, (list, tuple)) or not all(isinstance(x, str) for x in want):
            raise ValidationError("فهرست نفراتِ خدمات عمومی نامعتبر است.")
        Employee.objects.filter(plan_general=True).exclude(name__in=want).update(plan_general=False)
        Employee.objects.filter(active=True, name__in=want, plan_general=False).update(plan_general=True)
    for e in Employee.objects.filter(active=True, name__in=[n for n in rows if isinstance(n, str)]):
        want = rows[e.name]
        if not isinstance(want, (list, tuple)):
            raise ValidationError(f"مهارت‌های «{e.name}» نامعتبر است.")
        clean = [x for x in dict.fromkeys(want) if isinstance(x, str) and x in stages]
        if len(clean) == len(stages):
            clean = []                                   # همه را بلد است = همه‌کاره
        if clean != (e.plan_stages or []):
            e.plan_stages = clean
            e.save(update_fields=["plan_stages"])
    # استادکار (کسی که مرحلهٔ کمکی‌بگیر را انجام می‌دهد) کارِ عمومی نمی‌گیرد
    Employee.objects.filter(plan_general=True, name__in=_master_names()).update(plan_general=False)


@transaction.atomic
def set_efficiency(data, user=None):
    """هدفِ بهره‌وریِ پرسنل (و اگر آمد، مبنا). برنامهٔ خط با «هدف ÷ مبنا» برابرِ سرعتِ سابقه چیده می‌شود."""
    row = ProductionSettings.get()

    def pct(key, now):
        if data.get(key) in (None, ""):
            return float(now)
        try:
            v = float(data.get(key))
        except (TypeError, ValueError):
            raise ValidationError("درصد را عددی وارد کنید.")
        if not 10 <= v <= 100:
            raise ValidationError("درصد باید بین ۱۰ و ۱۰۰ باشد.")
        return round(v, 1)

    base, target = pct("base", row.plan_eff_base), pct("target", row.plan_eff_target)
    if target < base:
        raise ValidationError("هدف نمی‌تواند از مبنا کمتر باشد.")
    if target > base * 2:
        raise ValidationError("هدف بیش از دو برابرِ مبنا نمی‌شود؛ پله‌پله بالا ببرید.")
    ProductionSettings.objects.filter(pk=row.pk).update(plan_eff_base=Decimal(str(base)), plan_eff_target=Decimal(str(target)))


@transaction.atomic
def set_site(data, user=None, today=None):
    """کار در محلِ پروژه: چه متراژی (یا همه)، کدام مرحله‌ها، کدام تیم و از چه روزی. با remove برداشته می‌شود و همهٔ کار
    به کارگاه برمی‌گردد."""
    project = Project.objects.filter(pk=_int(data.get("project")) or 0, general=False, closed_at__isnull=True).first()
    if not project:
        raise ValidationError("پروژه پیدا نشد.")
    if data.get("remove"):
        Project.objects.filter(pk=project.pk).update(work_site=Project.WorkSite.WORKSHOP, onsite_area=None, onsite_note="",
                                                     onsite_stages=[], onsite_team=[], onsite_from=None)
        return
    area = None
    if not data.get("all"):
        try:
            area = float(data.get("area"))
        except (TypeError, ValueError):
            raise ValidationError("متراژِ محلِ پروژه را عددی وارد کنید.")
        if area <= 0:
            raise ValidationError("متراژِ محلِ پروژه باید بیشتر از صفر باشد.")
        # پروژه‌ای که متراژِ پایه ندارد: بزرگ‌ترین متراژِ مرحله‌هایش (همان که _site_ratio «همهٔ کار» می‌گیرد)
        base = float(project.base_area or 0) or float(project.stages.aggregate(m=Max("area"))["m"] or 0)
        if base and area > base + 0.005:
            raise ValidationError(f"متراژِ محلِ پروژه ({_fa(f'{area:g}')}) از متراژِ کلِ پروژه ({_fa(f'{base:g}')}) بیشتر است.")
    order = _stage_order()
    stages = data.get("stages") or []
    if not isinstance(stages, list) or any(x not in order for x in stages):
        raise ValidationError("مرحله نامعتبر است.")
    team = data.get("team") or []
    if not isinstance(team, list):
        raise ValidationError("تیم نامعتبر است.")
    team = list(dict.fromkeys(str(n).strip() for n in team if str(n).strip()))
    active = set(Employee.objects.filter(active=True).values_list("name", flat=True))
    if any(n not in active for n in team):
        raise ValidationError("کارگر پیدا نشد: " + "، ".join(n for n in team if n not in active))
    if len(team) > SITE_TEAM:
        raise ValidationError(f"تیمِ محلِ پروژه بیش از {_fa(SITE_TEAM)} نفر نمی‌شود.")
    start = _date(data.get("from"), "روزِ رفتن به محلِ پروژه") if data.get("from") else None
    Project.objects.filter(pk=project.pk).update(
        work_site=Project.WorkSite.ONSITE if area is None else Project.WorkSite.MIXED,
        onsite_area=None if area is None else Decimal(str(round(area, 2))),
        onsite_note=str(data.get("note") or "").strip()[:200],
        onsite_stages=sorted(dict.fromkeys(stages), key=order.get), onsite_team=team, onsite_from=start)
    # تیم باید از پسِ همهٔ مرحله‌های محل بربیاید (کسی که در «مهارت نفرات» مرحله‌ای ندارد همه‌کاره است)
    env = _prepare(today)
    there = env["sites"].get(str(project.pk))
    if there and team:
        skills = env["skills"]
        nobody = [t["name"] for t in there["tasks"] if (1 - t["frac"]) * t["planned"] >= DUST
                  and not any(not skills.get(n) or t["name"] in skills[n] for n in team)]
        if nobody:
            raise ValidationError("هیچ‌کس از این تیم این مرحله‌ها را در «مهارت نفرات» ندارد: " + "، ".join(nobody))


def set_colors(data, user):
    """رنگِ هر پروژه و ساعتِ تعویض رنگِ هر مرحله: {"projects": {شناسه: رنگ}, "stages": {نام مرحله: ساعت}}."""
    projects, stages = data.get("projects") or {}, data.get("stages") or {}
    if not isinstance(projects, dict) or not isinstance(stages, dict):
        raise ValidationError("درخواست نامعتبر است.")
    for pk, color in projects.items():
        if _int(pk) is None or not isinstance(color, (str, type(None))):
            raise ValidationError("رنگ پروژه نامعتبر است.")
        Project.objects.filter(pk=_int(pk), general=False).update(plan_color=(color or "").strip()[:60])
    for name, hours in stages.items():
        try:
            hours = float(hours or 0)
        except (TypeError, ValueError):
            raise ValidationError("ساعتِ تعویض رنگ را عددی وارد کنید.")
        if not 0 <= hours <= 24:
            raise ValidationError("ساعتِ تعویض رنگ باید بین ۰ و ۲۴ باشد.")
        if not WorkStage.objects.filter(name=name).exists():
            raise ValidationError("مرحله پیدا نشد.")
        WorkStage.objects.filter(name=name).update(changeover_hours=Decimal(str(round(hours, 1))))


@transaction.atomic
def add_rework(data, user):
    """دوباره‌کاری: از این مرحله تا آخرِ خط، این‌قدر متر دوباره. متراژِ همان مرحله‌های پروژه همین‌قدر زیاد می‌شود."""
    project = Project.objects.filter(pk=_int(data.get("project")) or 0, general=False).first()
    stage = data.get("stage")
    stage = stage.strip() if isinstance(stage, str) else ""
    if project is None or project.closed_at or not project.active:
        raise ValidationError("پروژه پیدا نشد یا بسته است.")
    try:
        area = float(data.get("area"))
    except (TypeError, ValueError):
        raise ValidationError("متراژ را عددی وارد کنید.")
    if not math.isfinite(area) or not 0 < area <= 100000:
        raise ValidationError("متراژ دوباره‌کاری باید بزرگ‌تر از صفر باشد.")
    order = _stage_order()
    line = sorted((ps for ps in project.stages.all() if ps.name in order and ps.area > 0), key=lambda ps: order[ps.name])
    at = next((n for n, ps in enumerate(line) if ps.name == stage), None)
    if at is None:
        raise ValidationError(f"این پروژه مرحلهٔ «{stage}» ندارد.")
    extra = Decimal(str(round(area, 2)))
    for ps in line[at:]:
        ps.area += extra
        ps.done = False
        ps.save(update_fields=["area", "done"])
    reason = data.get("reason")
    PlanRework.objects.create(project=project, stage=stage, stages=[ps.name for ps in line[at:]], area=extra,
                              reason=(reason if isinstance(reason, str) else "").strip()[:300],
                              by_name=user.name or user.username)


@transaction.atomic
def remove_rework(pk):
    """دوباره‌کاری‌ای که اشتباه ثبت شده: همان متراژ از همان مرحله‌ها برمی‌گردد."""
    r = PlanRework.objects.filter(pk=_int(pk) or 0).first()
    if r is None:
        return
    for ps in ProjectStage.objects.filter(project_id=r.project_id, name__in=r.stages or []):
        ps.area = max(ps.area - r.area, Decimal("0"))
        ps.save(update_fields=["area"])
    r.delete()


# ---------- تاریخچهٔ تصمیم‌ها و برگرداندنِ آخرین تغییر ----------

ACTIONS = {
    "order": ("ترتیب پروژه‌ها", ("order",)),
    "task": ("تصمیمِ یک کار", ("tasks", "stations")),
    "shift": ("جابه‌جایی پروژه", ("tasks",)),
    "stations": ("ایستگاه‌ها", ("stations", "tasks")),
    "overtime": ("اضافه‌کاری", ("overtime",)),
    "holiday": ("تعطیلات", ("holidays",)),
    "leave": ("مرخصی و کار عمومی", ("leaves",)),
    "pause": ("توقف پروژه", ("pauses", "due")),
    "resume": ("ادامهٔ پروژه", ("pauses", "due")),
    "stationoff": ("خرابی یا تعطیلی ایستگاه", ("off",)),
    "skills": ("مهارت نفرات", ("skills", "helpers", "general", "foremen")),
    "colors": ("رنگ و تعویض رنگ", ("colors", "changeover")),
    "site": ("کار در محل پروژه", ("sites",)),
    "efficiency": ("هدف بهره‌وری", ("efficiency",)),
    "rework": ("دوباره‌کاری", ()),
    "commit": ("ثبت برنامه", ()),
}
_iso = lambda d: d.isoformat() if d else None  # noqa: E731
_num = lambda v: None if v is None else str(v)  # noqa: E731


def snapshot(keys):
    """وضعیتِ تصمیم‌های برنامه‌ریزی در این لحظه، برای همین بخش‌ها — به شکلی که در JSON بنشیند و بشود برش گرداند."""
    out = {}
    if "tasks" in keys:
        out["tasks"] = [[t.project_id, t.stage, t.station_id, _num(t.daily_area), _iso(t.not_before), t.batch, t.crew]
                        for t in PlanTask.objects.order_by("project_id", "stage")]
    if "order" in keys:
        out["order"] = {str(pk): n for pk, n in Project.objects.filter(plan_priority__isnull=False)
                        .order_by("pk").values_list("pk", "plan_priority")}
    if "stations" in keys:
        out["stations"] = [[s.pk, s.name, s.order, s.active, list(s.stages or []), s.crew, list(s.people or [])]
                           for s in Station.objects.order_by("pk")]
    if "overtime" in keys:
        out["overtime"] = [[o.pk, _iso(o.date), _num(o.hours), o.people, o.note, o.created_by_name]
                           for o in PlanOvertime.objects.order_by("pk")]
    if "holidays" in keys:
        out["holidays"] = [[h.pk, _iso(h.date), h.title] for h in PlanHoliday.objects.order_by("pk")]
    if "leaves" in keys:
        out["leaves"] = [[x.pk, x.kind, _num(x.hours), x.employee, _iso(x.date_from), _iso(x.date_to), x.note,
                          x.created_by_name] for x in PlanLeave.objects.order_by("pk")]
    if "pauses" in keys:
        out["pauses"] = [[z.pk, z.project_id, _iso(z.start), _iso(z.end), z.reason, z.note, z.due_shift, z.by_name,
                          z.resumed_by_name] for z in ProjectPause.objects.order_by("pk")]
    if "due" in keys:
        out["due"] = {str(pk): _iso(d) for pk, d in Project.objects.filter(closed_at__isnull=True)
                      .order_by("pk").values_list("pk", "due_date")}
    if "off" in keys:
        out["off"] = [[o.pk, o.station_key, o.station_name, _iso(o.date_from), _iso(o.date_to), _num(o.hours), o.reason,
                       o.created_by_name] for o in PlanStationOff.objects.order_by("pk")]
    if "skills" in keys:
        out["skills"] = {str(pk): list(st or []) for pk, st in Employee.objects.order_by("pk").values_list("pk", "plan_stages")
                         if st}
    if "helpers" in keys:
        out["helpers"] = sorted(WorkStage.objects.filter(helpers_ok=True).values_list("pk", flat=True))
    if "general" in keys:
        out["general"] = sorted(Employee.objects.filter(plan_general=True).values_list("pk", flat=True))
    if "foremen" in keys:
        out["foremen"] = sorted(Employee.objects.filter(plan_foreman=True).values_list("pk", flat=True))
    if "colors" in keys:
        out["colors"] = {str(pk): c for pk, c in Project.objects.exclude(plan_color="").order_by("pk")
                         .values_list("pk", "plan_color")}
    if "changeover" in keys:
        out["changeover"] = {str(pk): _num(h) for pk, h in WorkStage.objects.filter(changeover_hours__gt=0)
                             .order_by("pk").values_list("pk", "changeover_hours")}
    if "efficiency" in keys:
        row = ProductionSettings.get()
        out["efficiency"] = [_num(row.plan_eff_base), _num(row.plan_eff_target)]
    if "sites" in keys:
        out["sites"] = {str(p.pk): [p.work_site, _num(p.onsite_area), p.onsite_note, list(p.onsite_stages or []),
                                    list(p.onsite_team or []), _iso(p.onsite_from)]
                        for p in Project.objects.filter(general=False, closed_at__isnull=True).order_by("pk")}
    return json.loads(json.dumps(out))


def _sync(model, rows, make):
    """ردیف‌های یک جدول همان می‌شود که در rows آمده (با همان شناسه‌ها): زیادی‌ها پاک، بقیه ساخته یا به‌روز."""
    model.objects.exclude(pk__in=[r[0] for r in rows]).delete()
    for r in rows:
        model.objects.update_or_create(pk=r[0], defaults=make(r))


def _date_of(v):
    return dt.date.fromisoformat(v) if v else None


def _dec(v):
    return Decimal(v) if v is not None else None


@transaction.atomic
def _restore(snap):
    if "stations" in snap:
        _sync(Station, snap["stations"], lambda r: {"name": f"__{r[0]}__"})     # نام‌ها یکتا هستند؛ اول نامِ موقت
        _sync(Station, snap["stations"], lambda r: {"name": r[1], "order": r[2], "active": r[3], "stages": r[4],
                                                    "crew": r[5], "people": r[6]})
    if "tasks" in snap:
        alive = set(Project.objects.values_list("pk", flat=True))
        stations = set(Station.objects.values_list("pk", flat=True))
        PlanTask.objects.all().delete()
        PlanTask.objects.bulk_create([
            PlanTask(project_id=r[0], stage=r[1], station_id=r[2] if r[2] in stations else None, daily_area=_dec(r[3]),
                     not_before=_date_of(r[4]), batch=r[5], crew=r[6]) for r in snap["tasks"] if r[0] in alive])
    if "order" in snap:
        Project.objects.exclude(plan_priority__isnull=True).update(plan_priority=None)
        for pk, n in snap["order"].items():
            Project.objects.filter(pk=int(pk)).update(plan_priority=n)
    if "overtime" in snap:
        _sync(PlanOvertime, snap["overtime"], lambda r: {"date": _date_of(r[1]), "hours": _dec(r[2]), "people": r[3],
                                                         "note": r[4], "created_by_name": r[5]})
    if "holidays" in snap:
        PlanHoliday.objects.exclude(pk__in=[r[0] for r in snap["holidays"]]).delete()
        _sync(PlanHoliday, snap["holidays"], lambda r: {"date": _date_of(r[1]), "title": r[2]})
    if "leaves" in snap:
        _sync(PlanLeave, snap["leaves"], lambda r: {"kind": r[1], "hours": _dec(r[2]), "employee": r[3],
                                                    "date_from": _date_of(r[4]), "date_to": _date_of(r[5]), "note": r[6],
                                                    "created_by_name": r[7]})
    if "pauses" in snap:
        alive = set(Project.objects.values_list("pk", flat=True))
        _sync(ProjectPause, [r for r in snap["pauses"] if r[1] in alive],
              lambda r: {"project_id": r[1], "start": _date_of(r[2]), "end": _date_of(r[3]), "reason": r[4], "note": r[5],
                         "due_shift": r[6], "by_name": r[7], "resumed_by_name": r[8]})
    if "due" in snap:
        for pk, d in snap["due"].items():
            Project.objects.filter(pk=int(pk)).exclude(due_date=_date_of(d)).update(due_date=_date_of(d))
    if "off" in snap:
        _sync(PlanStationOff, snap["off"], lambda r: {"station_key": r[1], "station_name": r[2], "date_from": _date_of(r[3]),
                                                      "date_to": _date_of(r[4]), "hours": _dec(r[5]), "reason": r[6],
                                                      "created_by_name": r[7]})
    if "skills" in snap:
        for e in Employee.objects.all():
            want = snap["skills"].get(str(e.pk), [])
            if (e.plan_stages or []) != want:
                e.plan_stages = want
                e.save(update_fields=["plan_stages"])
    if "helpers" in snap:
        WorkStage.objects.filter(helpers_ok=True).exclude(pk__in=snap["helpers"]).update(helpers_ok=False)
        WorkStage.objects.filter(pk__in=snap["helpers"]).update(helpers_ok=True)
    if "general" in snap:
        Employee.objects.filter(plan_general=True).exclude(pk__in=snap["general"]).update(plan_general=False)
        Employee.objects.filter(pk__in=snap["general"]).update(plan_general=True)
    if "foremen" in snap:
        Employee.objects.filter(plan_foreman=True).exclude(pk__in=snap["foremen"]).update(plan_foreman=False)
        Employee.objects.filter(pk__in=snap["foremen"]).update(plan_foreman=True)
    if "colors" in snap:
        Project.objects.exclude(plan_color="").exclude(pk__in=[int(k) for k in snap["colors"]]).update(plan_color="")
        for pk, c in snap["colors"].items():
            Project.objects.filter(pk=int(pk)).update(plan_color=c)
    if "changeover" in snap:
        WorkStage.objects.exclude(pk__in=[int(k) for k in snap["changeover"]]).update(changeover_hours=0)
        for pk, h in snap["changeover"].items():
            WorkStage.objects.filter(pk=int(pk)).update(changeover_hours=_dec(h))
    if "efficiency" in snap:
        ProductionSettings.objects.filter(pk=ProductionSettings.get().pk).update(
            plan_eff_base=_dec(snap["efficiency"][0]), plan_eff_target=_dec(snap["efficiency"][1]))
    if "sites" in snap:
        for p in Project.objects.filter(pk__in=[int(k) for k in snap["sites"]]):
            where, area, note, stages, team, start = snap["sites"][str(p.pk)]
            was = (p.work_site, p.onsite_area, p.onsite_note, list(p.onsite_stages or []), list(p.onsite_team or []), p.onsite_from)
            if was != (where, _dec(area), note, stages, team, _date_of(start)):
                Project.objects.filter(pk=p.pk).update(work_site=where, onsite_area=_dec(area), onsite_note=note,
                                                       onsite_stages=stages, onsite_team=team, onsite_from=_date_of(start))


def logged(user, action, summary, fn):
    """یک تصمیمِ برنامه‌ریزی را انجام می‌دهد و در تاریخچه می‌نویسد — با وضعیتِ پیش و پس از آن، تا بشود برش گرداند."""
    keys = ACTIONS[action][1]
    before = snapshot(keys) if keys else {}
    out = fn()
    after = snapshot(keys) if keys else {}
    if not keys or before != after:
        PlanChange.objects.create(by_name=(user.name or user.username) if user else AUTO_NAME, action=action,
                                  summary=(summary or "")[:300], before=before, after=after)
        old = PlanChange.objects.order_by("-id").values_list("id", flat=True)[400:401]
        if old:
            PlanChange.objects.filter(id__lte=old[0]).delete()
    return out


def _last_undoable(lock=False):
    """آخرین تغییری که وضعیتِ پیش از خودش را دارد و هنوز برگردانده نشده. «ثبت برنامه» و «دوباره‌کاری» از این راه
    برنمی‌گردند و جلوی برگرداندنِ تغییرِ پیش از خودشان را هم نمی‌گیرند (به بخشِ دیگری دست می‌زنند)."""
    qs = PlanChange.objects.select_for_update() if lock else PlanChange.objects
    return qs.filter(undone_at__isnull=True).exclude(before={}).first()


def _undo_info():
    """آخرین تغییری که می‌شود برش گرداند (یا None)."""
    c = _last_undoable()
    if c is None:
        return None
    return {"id": str(c.pk), "summary": c.summary, "by": c.by_name, "at": c.at, "action": ACTIONS.get(c.action, (c.action,))[0]}


@transaction.atomic
def undo(user):
    """آخرین تغییرِ برنامه برمی‌گردد — اگر از آن وقت همان بخش دوباره عوض نشده باشد."""
    c = _last_undoable(lock=True)
    if c is None:
        raise ValidationError("تغییری برای برگرداندن نیست.")
    if snapshot(list(c.after)) != c.after:
        raise ValidationError("از آن تغییر تا حالا چیزِ دیگری در همین بخش عوض شده؛ برگرداندنِ خودکار ممکن نیست.")
    _restore(c.before)
    c.undone_at, c.undone_by_name = timezone.now(), user.name or user.username
    c.save(update_fields=["undone_at", "undone_by_name"])
    return c.summary


def history(limit=80):
    rows = list(PlanChange.objects.all()[:limit])
    latest = _last_undoable()
    return [{"id": str(c.pk), "at": c.at, "by": c.by_name, "action": ACTIONS.get(c.action, (c.action,))[0],
             "summary": c.summary, "undone": bool(c.undone_at), "undoneBy": c.undone_by_name,
             "canUndo": bool(latest) and c.pk == latest.pk} for c in rows]


def _jdate(value):
    """تاریخِ یک درخواست، به شمسی و با رقمِ فارسی — برای خطِ تاریخچه."""
    from .jalali import gregorian_to_jalali
    try:
        d = dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return ""
    return _fa("%d/%02d/%02d" % tuple(gregorian_to_jalali(d.year, d.month, d.day)))


def describe(action, data):
    """یک خطِ فارسی برای تاریخچه: چه چیزی عوض شد."""
    data = data if isinstance(data, dict) else {}
    project = Project.objects.filter(pk=_int(data.get("project")) or 0).first()
    who = _label(project) if project else ""
    if action == "task":
        bits = []
        if "days" in data:
            bits.append("مدت: " + (f"{_fa(data.get('days'))} روز" if data.get("days") not in (None, "") else "پیشنهاد سیستم"))
        if "crew" in data:
            bits.append("نفرات: " + (_fa(data.get("crew")) if data.get("crew") not in (None, "") else "نفراتِ ایستگاه"))
        if "station" in data:
            bits.append("ایستگاه")
        if "notBefore" in data:
            bits.append("شروع: " + (_jdate(data.get("notBefore")) if data.get("notBefore") else "خودکار"))
        if data.get("finish"):
            bits.append("پایان: " + _jdate(data.get("finish")))
        if "together" in data:
            bits.append("با هم بردن")
        return f"{who} · {data.get('stage') or ''} — " + "، ".join(bits)
    if action == "shift":
        return f"{who} — {_fa(data.get('days'))} روز"
    if action == "order":
        return f"{_fa(len(data.get('ids') or []))} پروژه"
    if action == "overtime":
        return "حذف" if data.get("remove") else f"{_jdate(data.get('date'))} — {_fa(data.get('hours'))} ساعت"
    if action == "holiday":
        return "حذف" if data.get("remove") else f"{_jdate(data.get('date'))} {data.get('title') or ''}".strip()
    if action == "leave":
        if data.get("remove"):
            return "حذف"
        fill = " — کار عمومی در وقتِ بی‌کاری" if data.get("kind") == PlanLeave.Kind.FILL else ""
        lasting = " تا اطلاعِ بعدی" if data.get("open") and data.get("kind") in (PlanLeave.Kind.FILL, PlanLeave.Kind.GENERAL) else ""
        who = "کلِ کارگاه" if data.get("employee") == ALL else data.get("employee") or ""
        what = f" · {str(data.get('note')).strip()[:60]}" if data.get("note") and data.get("kind") != PlanLeave.Kind.LEAVE else ""
        return f"{'ویرایش: ' if data.get('replace') else ''}{who}{fill} — از {_jdate(data.get('from'))}{lasting}{what}"
    if action == "pause":
        return "پاک کردنِ توقف" if data.get("remove") else who
    if action == "resume":
        return who
    if action == "stationoff":
        if data.get("remove"):
            return "حذف"
        name = next((st["name"] for st in _stations(_stage_order()) if st["id"] == str(data.get("station"))), "")
        return f"{name} — از {_jdate(data.get('from'))}" + (f" تا {_jdate(data.get('to'))}" if data.get("to") and data.get("to") != data.get("from") else "")
    if action == "skills":
        rows = data.get("skills") if isinstance(data.get("skills"), dict) else {}
        said = "، ".join(f"{n}: {_fa(len(v)) + ' مرحله' if v else 'همه‌کاره'}" for n, v in list(rows.items())[:6] if isinstance(v, list))
        helpers = data.get("helpers") if isinstance(data.get("helpers"), list) else None
        general = data.get("general") if isinstance(data.get("general"), list) else None
        foremen = data.get("foremen") if isinstance(data.get("foremen"), list) else None
        return (said + (f" · کمکی در {_fa(len(helpers))} مرحله" if helpers else "")
                + (f" · کار عمومی: {_fa(len(general))} نفر" if general else "")
                + (f" · سرکارگر: {'، '.join(str(x) for x in foremen[:2])}" if foremen else ""))
    if action == "colors":
        projects = data.get("projects") if isinstance(data.get("projects"), dict) else {}
        stages = data.get("stages") if isinstance(data.get("stages"), dict) else {}
        return f"رنگِ {_fa(sum(1 for v in projects.values() if v))} پروژه، تعویضِ {_fa(sum(1 for v in stages.values() if v))} مرحله"
    if action == "rework":
        return "حذف" if data.get("remove") else f"{who} · از «{data.get('stage') or ''}» — {_fa(data.get('area'))} متر"
    if action == "efficiency":
        return (f"هدف: {_fa(data.get('target'))}٪" if data.get("target") not in (None, "") else "")\
            + (f" · مبنا: {_fa(data.get('base'))}٪" if data.get("base") not in (None, "") else "")
    if action == "site":
        if data.get("remove"):
            return f"{who} — کارِ محلِ پروژه برداشته شد"
        team = data.get("team") if isinstance(data.get("team"), list) else []
        return (f"{who} — {'همهٔ کار' if data.get('all') else _fa(data.get('area')) + ' متر'} در محلِ پروژه"
                + (f"، تیم: {'، '.join(str(n) for n in team[:SITE_TEAM])}" if team else "")
                + (f"، از {_jdate(data.get('from'))}" if data.get("from") else ""))
    if action == "commit":
        note = data.get("note")
        return note.strip()[:200] if isinstance(note, str) else ""
    return ""


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
    kind = data.get("kind") or PlanLeave.Kind.LEAVE
    if kind not in PlanLeave.Kind.values:
        raise ValidationError("نوع نامعتبر است.")
    if name == ALL and kind == PlanLeave.Kind.LEAVE:
        raise ValidationError("روزی که همه نیستند را از «تعطیلات» ثبت کنید.")
    if name != ALL and not Employee.objects.filter(name=name).exists():
        raise ValidationError("کارگر پیدا نشد.")
    start = _date(data.get("from"), "تاریخ شروع")
    if data.get("open") and kind in (PlanLeave.Kind.GENERAL, PlanLeave.Kind.FILL):
        end = OPEN_END                                   # کارِ عمومی «تا اطلاعِ بعدی»
    else:
        end = _date(data.get("to") or data.get("from"), "تاریخ پایان")
        if end < start:
            raise ValidationError("تاریخ پایان پیش از شروع است.")
        if (end - start).days > 60:
            raise ValidationError("مرخصیِ بیش از دو ماه را جدا ثبت کنید.")
    if kind == PlanLeave.Kind.FILL:
        masters = _master_names()
        if name in masters:
            raise ValidationError(f"«{name}» استادکار است و کارِ عمومی نمی‌گیرد.")
        skilled = Employee.objects.filter(active=True, plan_general=True).exclude(name__in=masters)
        if name == ALL and not skilled.exists():
            raise ValidationError("هنوز کسی مهارتِ «خدمات عمومی کارگاه و تعمیر و نگهداری» ندارد؛ اول در «مهارت نفرات» تیک بزنید.")
        if name != ALL and not skilled.filter(name=name).exists():
            raise ValidationError(f"«{name}» مهارتِ «خدمات عمومی کارگاه و تعمیر و نگهداری» ندارد؛ اول در «مهارت نفرات» "
                                  "برایش تیک بزنید.")
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
    if data.get("replace"):                              # ویرایش: ردیفِ قبلی جایش را به این می‌دهد (همه‌چیز پیش‌تر وارسی شده)
        PlanLeave.objects.filter(pk=_int(data.get("replace")) or 0).delete()
    PlanLeave.objects.create(employee=name, date_from=start, date_to=end, kind=kind,
                             hours=Decimal(str(hours)) if hours else None,
                             note=(data.get("note") or "").strip()[:200],
                             created_by_name=user.name or user.username)


def _baseline_lines(s, days):
    names = {st["id"]: st["name"] for st in s["stations"]}
    return [PlanBaselineLine(date=d["date"], station_id=int(ln["station"]) if ln["station"].isdigit() else None,
                             station_name=names.get(ln["station"], ""), project_id=int(ln["projectId"]),
                             stage=ln["stage"], area=Decimal(str(ln["area"])), people=Decimal(str(ln["people"])))
            for d in days for ln in d["lines"]] + [
        PlanBaselineLine(date=d["date"], station_id=None, station_name=SITE_NAME, project_id=int(ln["projectId"]),
                         stage=ln["stage"], area=Decimal(str(ln["area"])), people=Decimal(str(ln["people"])))
        for d in days for ln in d.get("site", ())]


@transaction.atomic
def commit(user, note="", today=None, by=None):
    """زمان‌بندیِ همین لحظه «برنامهٔ ثبت‌شده» می‌شود. روزهای گذشتهٔ برنامهٔ قبلی دست نمی‌خورد."""
    s = schedule(today)
    PlanBaselineLine.objects.filter(date__gte=s["start"]).delete()
    PlanBaselineLine.objects.bulk_create(_baseline_lines(s, s["days"]))
    PlanCommit.objects.create(by_name=by or user.name or user.username,
                              note=(note if isinstance(note, str) else "").strip()[:300])


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
