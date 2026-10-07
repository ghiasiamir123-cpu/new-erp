"""ابزارِ سناریوهای برنامه‌ریزی تولید (tests_planning_s2_*.py).

پایه همان tests_planning است: دو مرحله (آستر ۱ ساعت بر متر، پرداخت ۲ ساعت بر متر)، هر مرحله یک ایستگاهِ یک‌نفره،
دو کارگر (علی، رضا). پس آستر روزی ۸ متر و پرداخت روزی ۴ متر، و کارگاه روزی ۲ نفر-روز توان دارد.

هر بار که سناریویی برنامه می‌گیرد (self.plan)، خودِ برنامه هم وارسی می‌شود (check): چیزهایی که در هر موقعیتی باید
درست باشند — هیچ روزی بیش از حاضران نفر نگیرد، مرحلهٔ بعد از مرحلهٔ قبل جلو نزند، روزِ تعطیل کاری نباشد، پروژهٔ متوقف
چیده نشود، جمعِ کارِ چیده‌شدهٔ هر کار همان ماندهٔ آن کار باشد، و پاسخ عددِ نامعتبر نداشته باشد.

دو وارسیِ دیگر برای «بهره‌وریِ» برنامه است (efficient):
  · بی‌کاریِ بی‌دلیل نباشد: روزی که هم نفر آزاد هست، هم ایستگاه وقت دارد، هم کارِ آماده جلویش مانده، آن کار باید چیده
    شده باشد.
  · نوبت رعایت شود: در یک ایستگاه، کاری که نوبتش جلوتر است (جای دستی، بعد عقب‌افتاده، بعد اولویتِ پروژه) و کارِ آماده
    دارد، پیش از کارِ بعدی وقتِ ایستگاه را می‌گیرد.
"""
import datetime
import json
from collections import defaultdict

from rest_framework.test import APIClient

from . import planning, tests_planning
from .models import (DailyReport, Employee, Project, ProjectPause, ProjectStage, ReportItem, ReportProgress, Station,
                     WorkStage)

D = datetime.date
W = datetime.timedelta
PAST = D(2026, 9, 1)
SAT, SUN, MON, TUE, WED, THU, FRI = (D(2026, 10, 3) + W(i) for i in range(7))
SAT2, SUN2, MON2, TUE2, WED2, THU2, FRI2 = (D(2026, 10, 10) + W(i) for i in range(7))
STATUSES = {"done", "late", "waiting", "doing", "ready"}


class Kit(tests_planning.PlanningTests):
    """فقط setUp و کمک‌تابع‌ها؛ تست‌های خودِ PlanningTests اینجا دوباره اجرا نمی‌شوند."""

    def setUp(self):
        super().setUp()
        self.old = Project.objects.get(name="سابقه")
        self.hist = DailyReport.objects.get(date=PAST)

    # ---------- ساختن ----------

    def stage(self, name, order, hpm=1.0, wait=0, history=True):
        """یک مرحلهٔ دیگر با سابقهٔ زمان (ساعت بر متر) و ایستگاهِ خودکارِ یک‌نفره."""
        s = WorkStage.objects.create(name=name, order=order, needs_area=True, wait_hours=wait)
        if history:
            ReportItem.objects.create(report=self.hist, employee="علی", project=self.old, activity=name, hours=50 * hpm)
            ReportProgress.objects.create(report=self.hist, project=self.old, stage=name, area=50)
        planning.clear_cache()
        return s

    def proj(self, name, area=16, stages=None, **kw):
        """پروژه با مرحله‌های داده‌شده (پیش‌فرض آستر و پرداخت). stages می‌تواند {مرحله: متراژ} باشد."""
        p = Project.objects.create(name=name, **kw)
        stages = stages if stages is not None else (self.a, self.b)
        rows = stages.items() if isinstance(stages, dict) else [(s, area) for s in stages]
        for i, (s, a) in enumerate(rows):
            ProjectStage.objects.create(project=p, name=s.name, area=a, order=i)
        return p

    def report(self, project, stage, area, day, status="approved", hours=None, who="علی"):
        rep = DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="م", status=status)
        if area:
            ReportProgress.objects.create(report=rep, project=project, stage=stage.name, area=area)
        if hours:
            ReportItem.objects.create(report=rep, employee=who, project=project, activity=stage.name, hours=hours)
        return rep

    def task(self, project, stage, today=SAT, **kw):
        planning.set_task({"project": str(project.pk), "stage": stage.name, **kw}, self.user, today=today)

    def leave(self, who, day, to=None, **kw):
        planning.add_leave({"employee": who, "from": day.isoformat(), "to": (to or day).isoformat(), **kw}, self.user)

    def overtime(self, day, hours, people=None):
        planning.add_overtime({"date": day.isoformat(), "hours": hours, "people": people}, self.user)

    def holiday(self, day, title="تعطیل"):
        planning.add_holiday({"date": day.isoformat(), "title": title})

    def api(self, user=None):
        c = APIClient()
        c.force_authenticate(user or self.user)
        return c

    def post(self, path, body, user=None):
        return self.api(user).post(f"/api/production/{path}/", body, format="json")

    # ---------- خواندن ----------

    def plan(self, today=SAT, check=True):
        d = planning.plan(today=today)
        if check:
            self.check(d)
        return d

    def P(self, d, name):
        return next(p for p in d["projects"] if p["name"] == name)

    def J(self, d, name, stage):
        return next(j for j in self.P(d, name)["jobs"] if j["stage"] == stage.name)

    def day(self, d, date):
        return next((x for x in d["days"] if x["date"] == date), None)

    def lines(self, d, date):
        x = self.day(d, date)
        return [(ln["project"], ln["stage"], ln["area"]) for ln in x["lines"]] if x else []

    def area(self, d, date, name, stage):
        return sum(a for p, s, a in self.lines(d, date) if p == name and s == stage.name)

    def names(self, d):
        return [p["name"] for p in d["projects"]]

    def worked(self, d, name, stage):
        """روزهایی که این کار در برنامه رویشان چیده شده."""
        return [x["date"] for x in d["days"] if any(ln["project"] == name and ln["stage"] == stage.name for ln in x["lines"])]

    # ---------- وارسیِ خودِ برنامه ----------

    def check(self, d):
        json.dumps(d, default=str, allow_nan=False)                     # عددِ نامعتبر (NaN/بی‌نهایت) در پاسخ نباشد
        dates = [x["date"] for x in d["days"]]
        self.assertEqual(dates, sorted(set(dates)), "روزها مرتب و یکتا نیستند")
        if dates:
            self.assertGreaterEqual(dates[0], d["start"])
        self.assertGreaterEqual(d["start"], d["today"])
        projects = {p["id"]: p for p in d["projects"]}
        pauses = defaultdict(list)
        for pid, a, b in ProjectPause.objects.values_list("project_id", "start", "end"):
            pauses[str(pid)].append((a, b))

        frac, order = {}, {}
        for p in projects.values():
            self.assertEqual(len({j["stage"] for j in p["jobs"]}), len(p["jobs"]), "یک مرحله دو بار در پروژه آمده")
            for n, j in enumerate(p["jobs"]):
                self.assertIn(j["status"], STATUSES)
                self.assertGreaterEqual(j["remaining"], 0)
                self.assertLessEqual(j["remaining"], j["planned"] + 0.01)
                self.assertTrue(0 <= j["percent"] <= 100, j["percent"])
                frac[(p["id"], n)] = 1 - j["remaining"] / j["planned"] if j["planned"] else 1.0
                order[(p["id"], j["stage"])] = n
        got, seen = defaultdict(float), defaultdict(list)
        site_got = defaultdict(float)
        jobs = {(p["id"], n): j for p in projects.values() for n, j in enumerate(p["jobs"])}
        rank = {p["id"]: p["order"] for p in projects.values()}
        base0, hist = dict(frac), defaultdict(list)
        stations = {s["id"]: s for s in d["stations"]}
        reported_today = DailyReport.objects.filter(date=d["today"], status=DailyReport.Status.APPROVED).exists()
        for x in d["days"]:
            if x["lines"]:
                self.assertGreater(x["base"] + x["overtime"], 0, f"{x['date']} روز کاری نیست ولی کار دارد")
            self.assertLessEqual(x["used"], x["pool"] + 0.02, f"{x['date']}: بیش از حاضران نفر گرفته شده")
            self.assertFalse(x["over"], f"{x['date']}: بیش از توان")
            share = defaultdict(float)
            before = dict(frac)
            today_lines = defaultdict(lambda: [0.0, 0.0])                # کار -> [متر، سهم از روزِ ایستگاه]
            for ln in x["lines"]:
                pid = ln["projectId"]
                self.assertIn(pid, projects, "کارِ پروژه‌ای که در فهرست نیست")
                self.assertGreater(ln["area"], 0)
                self.assertGreater(ln["people"], 0)
                self.assertFalse(any(a <= x["date"] and (b is None or x["date"] < b) for a, b in pauses[pid]),
                                 f"{ln['project']} در {x['date']} متوقف است ولی چیده شده")
                share[ln["station"]] += ln["share"]
                n = order[(pid, ln["stage"])]
                planned = projects[pid]["jobs"][n]["planned"]
                frac[(pid, n)] += ln["area"] / planned
                got[(pid, n)] += ln["area"]
                seen[(pid, n)].append(x["date"])
                today_lines[(pid, n)][0] += ln["area"]
                today_lines[(pid, n)][1] += ln["share"]
                if n:                                                    # مرحلهٔ بعد فقط روی کارِ تا دیروزِ مرحلهٔ قبل
                    self.assertLessEqual(frac[(pid, n)], before[(pid, n - 1)] + 0.03 + 0.03 / planned,
                                         f"{ln['project']} · {ln['stage']} در {x['date']} از مرحلهٔ قبل جلو زده")
            taken = set()
            for ln in x["site"]:                                         # کارِ محلِ پروژه: تیمِ خودش، بیرون از کارگاه
                site = projects[ln["projectId"]]["site"]
                self.assertTrue(site and site["ready"] and x["date"] >= site["from"], f"{ln['project']} در {x['date']} در محل چیده شده")
                self.assertGreater(ln["area"], 0)
                self.assertIn(ln["stage"], [j["stage"] for j in site["jobs"]])
                self.assertEqual(ln["team"][0], site["master"], f"{x['date']}: تیمِ محل بی استادکارش رفته")
                self.assertFalse(any(a <= x["date"] and (b is None or x["date"] < b) for a, b in pauses[ln["projectId"]]),
                                 f"{ln['project']} در {x['date']} متوقف است ولی در محل چیده شده")
                site_got[(ln["projectId"], ln["stage"])] += ln["area"]
                taken.update(ln["team"])
            self.assertEqual(taken, {n for t in x["siteTeams"] for n in t["people"]})
            for n in taken:                                              # کسی که در محل است در کارگاه نه کار دارد نه وقتِ آزاد
                self.assertNotIn(n, x["free"], f"{x['date']}: {n} در محل است ولی در کارگاه آزاد شمرده شده")
                self.assertNotIn(n, x["leave"])
                self.assertFalse([i for i in x["people"].get(n, []) if i["kind"] not in ("site", "sitetime")],
                                 f"{x['date']}: {n} هم در محل است هم در کارگاه")
                self.assertNotIn(n, [f["name"] for f in x["fill"]])
            for su in x["setups"]:                                       # وقتِ تعویض رنگ هم از روزِ ایستگاه می‌رود
                share[su["station"]] += su["share"]
                self.assertGreater(su["hours"], 0)
            for sid, v in share.items():
                if sid not in x["overStations"]:
                    self.assertLessEqual(v, 1.03, f"{x['date']}: ایستگاه {sid} بیش از یک روز کار گرفته")
            for sid in x["closed"]:
                if sid not in x["overStations"]:
                    self.assertLess(share[sid], 1.0, f"{x['date']}: ایستگاهِ تعطیل {sid} کلِ روز کار کرده")
            self.assertTrue(all(v >= 0 for v in x["free"].values()) and x["freeExtra"] >= 0)
            for key, v in frac.items():
                if v != before[key]:
                    hist[key].append((x["date"], v))
            if not (x["date"] == d["today"] and reported_today):         # بخشی از امروز رفته؛ توانِ مانده‌اش را نمی‌دانیم
                self.efficient(d, x, jobs, rank, stations, pauses, frac, before, base0, hist, share, today_lines)

        total = 0.0
        for p in projects.values():
            starts, ends, open_jobs = [], [], 0
            for n, j in enumerate(p["jobs"]):
                total += j["remaining"]
                days = seen[(p["id"], n)]
                self.assertEqual((j["start"], j["finish"]), (days[0], days[-1]) if days else (None, None),
                                 f"{p['name']} · {j['stage']}: شروع و پایان با روزهای چیده‌شده نمی‌خواند")
                if not j["remaining"]:
                    self.assertEqual(j["status"], "done")
                    self.assertFalse(days, f"{p['name']} · {j['stage']} تمام شده ولی در برنامه کار دارد")
                    continue
                open_jobs += 1
                tol = 0.06 + 0.006 * len(days)
                self.assertLessEqual(got[(p["id"], n)], j["remaining"] + tol, f"{p['name']} · {j['stage']}: بیش از مانده چیده شده")
                if p["finish"] and j["daily"]:
                    self.assertAlmostEqual(got[(p["id"], n)], j["remaining"], delta=tol,
                                           msg=f"{p['name']} · {j['stage']}: پروژه تمام اعلام شده ولی کارش کامل چیده نشده")
                if j["placed"] and j["notBefore"] and j["start"]:
                    self.assertGreaterEqual(j["start"], j["notBefore"])
                if j["daily"]:
                    self.assertAlmostEqual(j["days"], j["remaining"] / j["daily"], delta=0.06 + 0.004 * j["days"])
                if days:
                    starts.append(days[0])
                    ends.append(days[-1])
            site = p["site"]
            for j in site["jobs"] if site else ():                       # کارِ محل هم کارِ همین پروژه است
                total += j["remaining"]
                self.assertTrue(0 <= j["remaining"] <= j["planned"] + 0.01 and 0 <= j["percent"] <= 100, j)
                self.assertLessEqual(site_got[(p["id"], j["stage"])], j["remaining"] + 0.1)
                if j["start"]:
                    starts.append(j["start"])
                    ends.append(j["finish"])
                if p["finish"]:
                    self.assertAlmostEqual(site_got[(p["id"], j["stage"])], j["remaining"], delta=0.1,
                                           msg=f"{p['name']} · {j['stage']}: پروژه تمام اعلام شده ولی کارِ محلش کامل چیده نشده")
            if site and p["finish"]:
                self.assertLess(site["unplanned"], 0.06)
            self.assertEqual(p["start"], min(starts) if starts else None)
            if p["finish"]:
                self.assertEqual(p["finish"], max(ends))
                if p["dueDate"]:
                    self.assertEqual(p["slackDays"], (p["dueDate"] - p["finish"]).days)
            elif site and site["unplanned"] >= 0.05 and not site["ready"]:
                pass                                                     # کارِ محلی که تیم یا روز ندارد پایان ندارد
            elif open_jobs and not d["totals"]["unfinished"]:
                # برنامه «تمام» اعلام شده؛ پس هر پروژه‌ای که کار دارد یا پایان دارد یا توقفی در پیش
                self.assertTrue(any(b is None for a, b in pauses[p["id"]]), f"{p['name']} پایان ندارد ولی برنامه تمام است")
        self.assertAlmostEqual(d["totals"]["area"], total, delta=0.05)
        for q in d["queues"]:
            self.assertGreaterEqual(q["ready"], 0)
            self.assertGreaterEqual(q["load"], 0)
        return d


    def efficient(self, d, x, jobs, rank, stations, pauses, frac, before, base0, hist, share, today_lines):
        """بی‌کاریِ بی‌دلیل و نوبت‌شکنی در یک روزِ برنامه."""
        day = x["date"]
        factor = (x["base"] + x["overtime"]) / 8
        skills = d["skills"]
        hold = {p["id"]: p["holdUntil"] for p in d["projects"]}

        def with_helpers(j, st, crew):
            """این کار «یک نفرِ اصلی + کمکی» است؟ (مرحله کمکی می‌گیرد، نفراتش بیش از یکی است و کسی هست که مرحله را بلد نباشد)"""
            return (j["stage"] in d["helperStages"] and crew > 1 and not (st["people"] and not j["crewManual"])
                    and any(skills.get(n) and j["stage"] not in skills[n] for n in d["employees"]))

        def idle_for(j, st, crew, room):
            """نفر-روزی که این کار هنوز می‌توانست بگیرد: نفراتِ ثابتِ ایستگاه، وگرنه هر که مرحله را بلد است. اگر مرحله
            کمکی می‌گیرد: یک نفرِ اصلی در وقتِ ماندهٔ ایستگاه و کنارش هر نفرِ آزادِ دیگر (کمکی، یا نفرِ اصلیِ بی‌کار)."""
            if st["people"] and not j["crewManual"]:
                return min(crew * room, sum(x["free"].get(n, 0.0) for n in st["people"]) + x["freeExtra"])
            able = [n for n in x["free"] if not skills.get(n) or j["stage"] in skills[n]]
            lead = sum(x["free"][n] for n in able) + x["freeExtra"]
            if not with_helpers(j, st, crew):
                return min(crew * room, lead)
            one = min(room, lead)
            return one + min((crew - 1) * one, lead - one + sum(v for n, v in x["free"].items() if n not in able))

        waiting = {}                                                     # کاری که کارِ آماده دارد و امروز تمامش نکرده
        for (pid, n), j in jobs.items():
            st = stations.get(j["station"])
            if (not j["daily"] or j["together"] or st is None
                    or (j["placed"] and j["notBefore"] and j["notBefore"] > day)
                    or (hold.get(pid) and day < hold[pid])
                    or j["station"] in x["closed"]                       # ایستگاه امروز خراب یا تعطیل است
                    or (j["changeoverHours"] and j["color"])             # شاید وقتِ مانده به تعویض رنگ نرسد
                    or any(a <= day and (b is None or day < b) for a, b in pauses[pid])):
                continue
            if n == 0:
                arrived = 1.0
            else:
                prev = jobs[(pid, n - 1)]
                if not prev["dryDays"]:
                    arrived = before[(pid, n - 1)]
                elif day <= d["start"] + W(prev["dryDays"]):
                    continue                                             # کارِ گزارش‌شدهٔ این چند روز شاید هنوز خیس است
                else:
                    cut = day - W(1 + prev["dryDays"])
                    arrived = next((f for dd, f in reversed(hist[(pid, n - 1)]) if dd <= cut), base0[(pid, n - 1)])
            left = (arrived - frac[(pid, n)]) * j["planned"]
            if left >= 0.15:
                waiting[(pid, n)] = left
        cls = lambda j: 0 if j["placed"] else 1 if j["overdue"] else 2   # noqa: E731
        for (pid, n), left in waiting.items():
            j = jobs[(pid, n)]
            name = f"{d['projects'][rank[pid] - 1]['name']} · {j['stage']}"
            crew = min(j["crew"], x["present"])
            per = j["daily"] / j["crew"]                                 # متر به ازای هر نفر-روز
            sid = j["station"]
            room = factor * (1 - (today_lines[(pid, n)][1] if j["placed"] else share[sid]))
            room = max(room - 0.02 * factor, 0.0)                         # سهم‌ها تا دو رقم گرد شده‌اند
            if sid in x["overStations"] and not j["placed"]:
                room = 0.0
            idle = idle_for(j, stations[sid], crew, room)
            could = min(left, per * idle)
            self.assertLess(could, 0.15, f"{day}: {name} می‌توانست {could:.2f} متر بیشتر کار کند — {idle:.2f} نفر-روز بی‌کار، "
                                         f"{room:.2f} روز از وقتِ ایستگاه آزاد، {left:.2f} متر کارِ آماده")
            # جای کمکی: کاری که امروز با نفرِ کمتر رفته، نباید کنارش کسی بی‌کار مانده باشد
            if with_helpers(j, stations[sid], crew) and (pid, n) in today_lines:
                area, used = today_lines[(pid, n)]
                empty = crew * (used - 0.02) * factor - area / per
                spare = min(left, per * min(empty, sum(x["free"].values()) + x["freeExtra"]))
                self.assertLess(spare, 0.15, f"{day}: {name} با نفرِ کمتر رفت ({empty:.2f} نفر-روز جای کمکیِ خالی) ولی کسی بی‌کار بود")
            for ln in x["lines"]:
                if "lead" in ln:
                    self.assertEqual(ln["lead"], 1)
                    self.assertTrue(0 <= ln["helpers"] <= ln["people"] - 1 + 0.05, ln)
            # نوبت: کارِ دیگری در همین ایستگاه که نوبتش عقب‌تر است امروز وقت گرفته؟
            for (qid, m), (area, used) in today_lines.items():
                other = jobs[(qid, m)]
                if other["station"] != sid or (qid, m) == (pid, n) or (cls(j), rank[pid]) >= (cls(other), rank[qid]):
                    continue
                if other["placed"]:
                    continue                                             # جای دستی منتظرِ وقتِ ایستگاه نمی‌ماند (و علامت می‌خورد)
                if per * crew * used * factor >= 0.15 and used * factor >= 0.05:
                    self.fail(f"{day}: {name} کارِ آماده داشت ولی «{other['stage']}»ِ پروژه‌ای با نوبتِ عقب‌تر وقتِ ایستگاه را گرفت")


for _name in [n for n in dir(tests_planning.PlanningTests) if n.startswith("test_")]:
    setattr(Kit, _name, None)

__all__ = ["Kit", "D", "W", "PAST", "SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT2", "SUN2", "MON2", "TUE2",
           "WED2", "THU2", "FRI2", "planning", "Employee", "Project", "ProjectStage", "Station", "WorkStage",
           "DailyReport", "ReportItem", "ReportProgress", "ProjectPause"]
