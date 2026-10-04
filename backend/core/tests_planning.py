"""برنامه‌ریزی تولید: کار باقیمانده روزبه‌روز روی ایستگاه‌ها چیده می‌شود؛ مسئول مدت، ترتیب، اضافه‌کاری
و مرخصی را عوض می‌کند و انحراف از برنامهٔ ثبت‌شده سنجیده می‌شود."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import planning
from .models import (DailyReport, Employee, PlanBaselineLine, PlanLeave, PlanOvertime, Project, ProjectStage,
                     ReportItem, ReportProgress, Station, User, WorkStage)

SAT = datetime.date(2026, 10, 3)      # شنبه
SUN = datetime.date(2026, 10, 4)
PAST = datetime.date(2026, 9, 1)
D = datetime.date


class PlanningTests(TestCase):
    def setUp(self):
        planning.clear_cache()
        WorkStage.objects.all().delete()
        self.a = WorkStage.objects.create(name="آستر آزمایشی", order=1, needs_area=True)
        self.b = WorkStage.objects.create(name="پرداخت آزمایشی", order=2, needs_area=True)
        self.user = User.objects.create_user(username="boss", password="x", name="مدیر", role="manager",
                                             access=["production", "production.plan"])
        Employee.objects.all().delete()
        for n in ("علی", "رضا"):
            Employee.objects.create(name=n)
        # سابقه: آستر ۱ ساعت بر متر، پرداخت ۲ ساعت بر متر؛ همهٔ ساعت‌ها مفید (سهم وقت مفید = ۱)
        old = Project.objects.create(name="سابقه", closed_at=PAST)
        rep = DailyReport.objects.create(date=PAST, shift="صبح", supervisor=self.user, supervisor_name="م",
                                         status="approved")
        for stage, hours in ((self.a, 50), (self.b, 100)):
            ReportItem.objects.create(report=rep, employee="علی", project=old, activity=stage.name, hours=hours)
            ReportProgress.objects.create(report=rep, project=old, stage=stage.name, area=50)

    def _project(self, name, area=16, **kw):
        p = Project.objects.create(name=name, **kw)
        for i, s in enumerate((self.a, self.b)):
            ProjectStage.objects.create(project=p, name=s.name, area=area, order=i)
        return p

    def _report(self, project, stage, area, day):
        rep = DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="م",
                                         status="approved")
        ReportProgress.objects.create(report=rep, project=project, stage=stage.name, area=area)

    def _days(self, d):
        return [(x["date"].isoformat(), [(t["stage"], t["area"]) for t in x["lines"]]) for x in d["days"]]

    # ---------- زمان‌بندی ----------

    def test_the_next_stage_waits_a_day_for_the_one_before(self):
        # هر مرحله خودش یک ایستگاه است و سابقه می‌گوید یک نفر رویش کار می‌کند: آستر ۸ متر در روز، پرداخت ۴
        self._project("الف")
        d = planning.plan(today=SAT)
        self.assertEqual(self._days(d), [("2026-10-03", [(self.a.name, 8.0)]),
                                         ("2026-10-04", [(self.a.name, 8.0), (self.b.name, 4.0)]),
                                         ("2026-10-05", [(self.b.name, 4.0)]),
                                         ("2026-10-06", [(self.b.name, 4.0)]),
                                         ("2026-10-07", [(self.b.name, 4.0)])])
        p = d["projects"][0]
        self.assertEqual((p["start"], p["finish"]), (SAT, D(2026, 10, 7)))
        jobs = {j["stage"]: (j["days"], j["suggestedDays"], j["manual"], j["stationName"]) for j in p["jobs"]}
        self.assertEqual(jobs, {self.a.name: (2.0, 2.0, False, self.a.name), self.b.name: (4.0, 4.0, False, self.b.name)})
        self.assertEqual([(st["name"], st["crew"], st["implicit"]) for st in d["stations"]],
                         [(self.a.name, 1, True), (self.b.name, 1, True)])
        self.assertFalse(d["totals"]["unfinished"])

    def test_thursday_is_half_and_friday_is_off_unless_overtime_opens_it(self):
        self._project("الف", area=40)
        d = planning.plan(today=SAT)
        by = dict(self._days(d))
        self.assertEqual(by["2026-10-08"], [(self.b.name, 2.0)])          # پنجشنبه نیم‌روز
        self.assertNotIn("2026-10-09", by)                                 # جمعه
        self.assertEqual(d["projects"][0]["finish"], D(2026, 10, 15))
        PlanOvertime.objects.create(date=D(2026, 10, 9), hours=8)          # جمعه‌کاری
        d = planning.plan(today=SAT)
        self.assertEqual(dict(self._days(d))["2026-10-09"], [(self.b.name, 4.0)])
        self.assertEqual(d["projects"][0]["finish"], D(2026, 10, 14))

    def test_an_official_holiday_is_not_worked(self):
        from .models import PlanHoliday
        self.assertTrue(PlanHoliday.objects.filter(date=D(2027, 2, 11)).exists())      # ۲۲ بهمن ۱۴۰۵ از مهاجرت
        self._project("الف")
        planning.add_holiday({"date": "2026-10-04", "title": "تعطیلی کارگاه"})
        d = planning.plan(today=SAT)
        self.assertNotIn("2026-10-04", dict(self._days(d)))
        self.assertEqual(d["projects"][0]["finish"], D(2026, 10, 10))                   # بی این تعطیلی ۷ اکتبر بود
        self.assertIn(("2026-10-04", "تعطیلی کارگاه"), [(str(h["date"]), h["title"]) for h in d["holidays"]])

    def test_due_date_then_manual_order_decides_who_goes_first(self):
        late = self._project("دیر", due_date=D(2026, 12, 1))
        soon = self._project("زود", due_date=D(2026, 10, 10))
        d = planning.plan(today=SAT)
        self.assertEqual([p["name"] for p in d["projects"]], ["زود", "دیر"])
        self.assertEqual(d["days"][0]["lines"][0]["project"], "زود")
        self.assertTrue(d["projects"][0]["onTime"])
        planning.set_order([late.pk, soon.pk])
        d = planning.plan(today=SAT)
        self.assertEqual([(p["name"], p["pinned"]) for p in d["projects"]], [("دیر", True), ("زود", True)])
        self.assertEqual(d["days"][0]["lines"][0]["project"], "دیر")

    def test_a_stage_recorded_behind_its_successor_counts_as_done_that_far(self):
        p = self._project("الف")
        self._report(p, self.b, 8, PAST)                                   # پرداخت نصف، آستر صفر
        d = planning.plan(today=SAT)
        self.assertEqual({j["stage"]: j["remaining"] for j in d["projects"][0]["jobs"]},
                         {self.a.name: 8.0, self.b.name: 8.0})

    def test_stations_work_side_by_side(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=1, order=0)
        Station.objects.create(name="میز پرداخت", stages=[self.b.name], crew=1, order=1)
        self._project("الف")          # هر ایستگاه یک نفر: آستر ۸ متر در روز، پرداخت ۴
        d = planning.plan(today=SAT)
        names = {s["id"]: s["name"] for s in d["stations"]}
        day2 = [(names[t["station"]], t["stage"], t["area"]) for t in d["days"][1]["lines"]]
        self.assertEqual(day2, [("کابین", self.a.name, 8.0), ("میز پرداخت", self.b.name, 4.0)])
        self.assertEqual(d["projects"][0]["jobs"][0]["stationName"], "کابین")

    def test_two_projects_move_through_the_stations_side_by_side(self):
        first, second = self._project("الف"), self._project("ب")
        planning.set_order([first.pk, second.pk])
        d = planning.plan(today=SAT)
        starts = {(p["name"], j["stage"]): j["start"] for p in d["projects"] for j in p["jobs"]}
        # پروژهٔ دوم منتظرِ تمام شدنِ کلِ اولی نمی‌ماند: آسترش همین که ایستگاهِ آستر خالی شد شروع می‌شود.
        self.assertEqual(starts[("ب", self.a.name)], D(2026, 10, 5))
        self.assertLess(starts[("ب", self.a.name)], d["projects"][0]["finish"])

    def test_tasks_tied_together_wait_for_each_other(self):
        first, second = self._project("الف"), self._project("ب")
        planning.set_order([first.pk, second.pk])
        self.assertEqual(planning.plan(today=SAT)["projects"][0]["jobs"][1]["start"], SUN)
        # پرداختِ هر دو پروژه با هم: تا آسترِ «ب» تمام نشود (سه‌شنبه)، پرداختِ «الف» هم شروع نمی‌شود.
        planning.set_task({"project": str(first.pk), "stage": self.b.name, "together": [str(second.pk)]},
                          self.user, today=SAT)
        d = planning.plan(today=SAT)
        a_job, b_job = d["projects"][0]["jobs"][1], d["projects"][1]["jobs"][1]
        self.assertEqual((a_job["start"], [m["label"] for m in a_job["together"]]), (D(2026, 10, 7), ["ب"]))
        self.assertEqual([m["label"] for m in b_job["together"]], ["الف"])
        self.assertGreaterEqual(b_job["start"], a_job["start"])
        planning.set_task({"project": str(second.pk), "stage": self.b.name, "together": []}, self.user, today=SAT)
        d = planning.plan(today=SAT)
        self.assertEqual((d["projects"][0]["jobs"][1]["start"], d["projects"][0]["jobs"][1]["together"]), (SUN, []))
        self.assertFalse(first.plan_tasks.exists() or second.plan_tasks.exists())

    def test_a_bar_dropped_on_a_day_stays_there_even_when_the_station_is_busy(self):
        first, second = self._project("الف"), self._project("ب")
        planning.set_order([first.pk, second.pk])
        d = planning.plan(today=SAT)
        self.assertEqual(d["projects"][1]["jobs"][0]["start"], D(2026, 10, 5))      # پیشنهاد: بعد از آسترِ «الف»
        self.assertFalse(any(x["over"] for x in d["days"]))
        # مسئول آسترِ «ب» را روی همان شنبه می‌گذارد: همان‌جا می‌ماند و آسترِ «الف» (که جایش پیشنهاد بود) کنار می‌رود.
        planning.set_task({"project": str(second.pk), "stage": self.a.name, "notBefore": "2026-10-03"},
                          self.user, today=SAT)
        d = planning.plan(today=SAT)
        job = d["projects"][1]["jobs"][0]
        self.assertEqual((job["start"], job["placed"], job["finish"]), (SAT, True, SUN))
        self.assertEqual(d["projects"][0]["jobs"][0]["start"], D(2026, 10, 5))
        self.assertEqual(d["days"][0]["overStations"], [])
        # هر دو را دستی روی شنبه بگذارد: هر دو می‌مانند و ایستگاهِ آستر «بیش از توان» علامت می‌خورد.
        planning.set_task({"project": str(first.pk), "stage": self.a.name, "notBefore": "2026-10-03"},
                          self.user, today=SAT)
        d = planning.plan(today=SAT)
        self.assertEqual([p["jobs"][0]["start"] for p in d["projects"]], [SAT, SAT])
        self.assertEqual(d["days"][0]["overStations"], [planning.STAGE_ID + self.a.name])
        self.assertFalse(d["days"][0]["over"])                                      # دو نفر حاضرند و دو نفر لازم است

    def test_a_bar_stretched_to_a_day_ends_on_that_day(self):
        p = self._project("الف")                       # آستر ۱۶ متر
        ask = lambda end: planning.set_task({"project": str(p.pk), "stage": self.a.name, "notBefore": "2026-10-03",  # noqa: E731
                                             "finish": end}, self.user, today=SAT)
        job = lambda: planning.plan(today=SAT)["projects"][0]["jobs"][0]  # noqa: E731
        ask("2026-10-07")                               # شنبه تا چهارشنبه: پنج روز کامل
        self.assertEqual((job()["start"], job()["finish"], job()["daily"]), (SAT, D(2026, 10, 7), 3.2))
        ask("2026-10-08")                               # تا پنجشنبه: نیم‌روز هم حساب است
        self.assertEqual(job()["finish"], D(2026, 10, 8))
        ask("2026-10-10")                               # تا شنبهٔ بعد: جمعه در میان است و شمرده نمی‌شود
        self.assertEqual(job()["finish"], D(2026, 10, 10))
        with self.assertRaises(Exception):
            ask("2026-10-02")                           # پایان پیش از شروع
        with self.assertRaises(Exception):              # بی روز شروع نمی‌شود
            planning.set_task({"project": str(p.pk), "stage": self.b.name, "finish": "2026-10-20"}, self.user, today=SAT)

    def test_a_stage_put_before_the_one_before_it_pulls_that_one_earlier(self):
        third = WorkStage.objects.create(name="رویه آزمایشی", order=3, needs_area=True)
        p = self._project("الف")
        ProjectStage.objects.create(project=p, name=third.name, area=16, order=2)
        planning.shift_project({"project": str(p.pk), "days": 7}, self.user, today=SAT)     # همه یک هفته دیرتر
        starts = lambda: [j["start"] for j in planning.plan(today=SAT)["projects"][0]["jobs"]]  # noqa: E731
        self.assertEqual(starts(), [D(2026, 10, 10), D(2026, 10, 11), D(2026, 10, 12)])
        move = lambda stage, day, **kw: planning.set_task(  # noqa: E731
            {"project": str(p.pk), "stage": stage.name, "notBefore": day, **kw}, self.user, today=SAT)
        # رویه را مسئول روی سه‌شنبه می‌گذارد: همان‌جا می‌نشیند و دو مرحلهٔ قبل هر کدام یک روزِ کاری جلوتر از بعدی می‌آیند.
        move(third, "2026-10-06", pull=True)
        self.assertEqual(starts(), [SUN, D(2026, 10, 5), D(2026, 10, 6)])
        # از روی جمعه می‌پرد: پرداخت روی شنبهٔ بعد، آستر پنجشنبهٔ قبلش — ولی آستر همین حالا زودتر است و دست نمی‌خورد.
        move(self.b, "2026-10-10", pull=True)
        self.assertEqual(starts()[:2], [SUN, D(2026, 10, 10)])
        # زودتر از شروعِ برنامه جا نیست: سه مرحله، هر کدام یک روز؛ رویه زودتر از دوشنبه نمی‌شود.
        move(third, "2026-10-01", pull=True)
        self.assertEqual(starts(), [SAT, SUN, D(2026, 10, 5)])
        # بی «pull» (پنجرهٔ کار که فقط چیزِ دیگری را عوض می‌کند) مرحله‌های قبل دست نمی‌خورند.
        move(self.a, "2026-10-12")
        move(self.b, "2026-10-04")
        self.assertEqual(starts()[:2], [D(2026, 10, 12), D(2026, 10, 13)])
        # کاری که دیرتر برود، مرحله‌های بعدش را خودِ زمان‌بندی دیرتر می‌برد.
        move(self.a, "2026-10-17", pull=True)
        self.assertEqual(starts(), [D(2026, 10, 17), D(2026, 10, 18), D(2026, 10, 19)])
        # و اگر زودتر بیاید، مرحله‌های چسبیده به آن هم با همان یک روز فاصله زودتر می‌آیند — با اینکه جایشان دستی بود.
        move(self.a, "2026-10-05", pull=True)
        self.assertEqual(starts(), [D(2026, 10, 5), D(2026, 10, 6), D(2026, 10, 7)])
        # مرحله‌ای که فاصله‌اش بیشتر است چسبیده نیست: سر جایش می‌ماند تا وقتی جا داشته باشد.
        move(third, "2026-10-14", pull=True)
        move(self.a, "2026-10-04", pull=True)
        self.assertEqual(starts(), [SUN, D(2026, 10, 5), D(2026, 10, 14)])

    def test_work_already_waiting_needs_nobody_to_move(self):
        p = self._project("الف")
        self._report(p, self.a, 8, PAST)                                   # نیمی از آستر آمادهٔ پرداخت است
        planning.set_task({"project": str(p.pk), "stage": self.a.name, "notBefore": "2026-10-10"}, self.user, today=SAT)
        planning.set_task({"project": str(p.pk), "stage": self.b.name, "notBefore": "2026-10-05", "pull": True},
                          self.user, today=SAT)
        jobs = planning.plan(today=SAT)["projects"][0]["jobs"]
        self.assertEqual([j["start"] for j in jobs], [D(2026, 10, 10), D(2026, 10, 5)])

    def test_more_people_on_a_task_finish_it_sooner(self):
        for n in ("حسن", "مهدی", "جواد"):
            Employee.objects.create(name=n)
        p = self._project("الف", area=40)              # آستر ۴۰ نفر-ساعت: با یک نفر پنج روز
        job = lambda: planning.plan(today=SAT)["projects"][0]["jobs"][0]  # noqa: E731
        self.assertEqual((job()["crew"], job()["crewManual"], job()["days"], job()["hours"]), (1, False, 5.0, 40.0))
        ask = lambda **kw: planning.set_task({"project": str(p.pk), "stage": self.a.name, **kw}, self.user, today=SAT)  # noqa: E731
        ask(crew=5)
        j = job()
        self.assertEqual((j["crew"], j["crewManual"], j["stationCrew"], j["daily"], j["days"], j["finish"]),
                         (5, True, 1, 40.0, 1.0, SAT))
        d = planning.plan(today=SAT)
        self.assertEqual((d["days"][0]["lines"][0]["people"], d["days"][0]["used"], d["days"][0]["over"]), (5, 5.0, False))
        # مدتِ دستی با عوض شدنِ نفرات کنار می‌رود و از نو از نفر-ساعت درمی‌آید.
        ask(days=4)
        self.assertEqual((job()["days"], job()["crew"]), (4.0, 5))
        ask(crew=2)
        self.assertEqual((job()["days"], job()["manual"]), (2.5, False))
        with self.assertRaises(Exception):
            ask(crew=0)
        ask(crew=None)
        self.assertEqual((job()["crew"], job()["crewManual"], job()["days"]), (1, False, 5.0))
        self.assertFalse(p.plan_tasks.exists())

    def test_drying_time_holds_the_next_stage_back_and_runs_through_days_off(self):
        self.assertEqual([planning.dry_days(h) for h in (0, 8, 15, 16, 24, 39, 40, 48)], [0, 0, 0, 1, 1, 1, 2, 2])
        self._project("الف")                             # آستر شنبه و یکشنبه ۸ متر، پرداخت روزی ۴ متر
        starts = lambda: [(j["start"], j["finish"]) for j in planning.plan(today=SAT)["projects"][0]["jobs"]]  # noqa: E731
        self.assertEqual(starts()[1], (SUN, D(2026, 10, 7)))
        self.a.wait_hours = 24                           # آستر یک شبانه‌روز خشک شود: کارِ شنبه دوشنبه آماده است
        self.a.save()
        d = planning.plan(today=SAT)
        self.assertEqual(starts(), [(SAT, SUN), (D(2026, 10, 5), D(2026, 10, 10))])
        job = d["projects"][0]["jobs"][0]
        self.assertEqual((job["waitHours"], job["dryDays"]), (24, 1))
        # جمعه هم خشک می‌شود: آسترِ چهارشنبه و پنجشنبه، شنبه آمادهٔ پرداخت است، نه یکشنبه.
        planning.set_task({"project": d["projects"][0]["id"], "stage": self.a.name, "notBefore": "2026-10-07"},
                          self.user, today=SAT)
        self.assertEqual(starts()[1][0], D(2026, 10, 10))
        # مسئول پرداخت را روی سه‌شنبه می‌گذارد: آستر آن‌قدر زودتر می‌آید که خشک هم شده باشد (یکشنبه).
        planning.set_task({"project": d["projects"][0]["id"], "stage": self.b.name, "notBefore": "2026-10-06", "pull": True},
                          self.user, today=SAT)
        self.assertEqual([x[0] for x in starts()], [SUN, D(2026, 10, 6)])

    def test_every_morning_keeps_the_days_plan_and_the_stations_queue(self):
        from .models import PlanCommit, PlanQueueSnapshot
        p = self._project("الف")
        self.assertEqual(planning.daily(today=SAT), ["week", "queues"])                 # اولین بار: مبنای هفته
        base = PlanCommit.objects.get()
        self.assertEqual((base.by_name, base.note), (planning.AUTO_NAME, "مبنای هفته"))
        self.assertEqual(float(PlanBaselineLine.objects.get(date=SAT).area), 8.0)
        q = {x.station: (float(x.ready_area), float(x.load)) for x in PlanQueueSnapshot.objects.filter(date=SAT)}
        # آستر ۱۶ متر کارِ آماده دارد و دو روز از دوازده روزِ پیشِ رو (یکی نیم‌روز) پر است؛ پرداخت هنوز چیزی ندارد
        self.assertEqual(q[self.a.name][0], 16.0)
        self.assertEqual(q[self.b.name][0], 0.0)
        self.assertTrue(0 < q[self.a.name][1] < q[self.b.name][1])
        # شنبه کمتر از برنامه کار شد؛ صبحِ یکشنبه برنامهٔ یکشنبه همان می‌شود که آن صبح است، و مبنای هفته می‌ماند.
        self._report(p, self.a, 2, SAT)
        PlanCommit.objects.update(at=datetime.datetime(2026, 10, 3, 6, 0, tzinfo=datetime.timezone.utc))
        self.assertEqual(planning.daily(today=SUN), ["today", "queues"])
        self.assertEqual(planning.daily(today=SUN), ["today", "queues"])                # دوباره: بی‌ضرر
        self.assertEqual(PlanCommit.objects.count(), 1)
        self.assertEqual(sorted((ln.stage, float(ln.area)) for ln in PlanBaselineLine.objects.filter(date=SUN)),
                         [(self.a.name, 8.0), (self.b.name, 2.0)])
        self.assertEqual(float(PlanBaselineLine.objects.get(date=SAT).area), 8.0)       # دیروز دست نخورده
        d = planning.plan(today=SUN)
        self.assertEqual((d["past"][0]["planned"], d["past"][0]["actual"]), (8.0, 2.0))
        self.assertEqual([t["date"] for t in next(x for x in d["queues"] if x["name"] == self.a.name)["trend"]], [SAT, SUN])
        # جمعه کاری نیست: فقط صف برداشته می‌شود. شنبهٔ بعد دوباره مبنای هفته.
        self.assertEqual(planning.daily(today=D(2026, 10, 9)), ["queues"])
        self.assertEqual(planning.daily(today=D(2026, 10, 10)), ["week", "queues"])
        self.assertEqual(PlanCommit.objects.count(), 2)

    def test_dragging_a_project_moves_all_its_remaining_jobs(self):
        p = self._project("الف")
        planning.shift_project({"project": str(p.pk), "days": 7}, self.user, today=SAT)
        d = planning.plan(today=SAT)
        jobs = d["projects"][0]["jobs"]
        self.assertEqual([(j["start"], j["placed"]) for j in jobs], [(D(2026, 10, 10), True), (D(2026, 10, 11), True)])
        with self.assertRaises(Exception):
            planning.shift_project({"project": str(p.pk), "days": 0}, self.user, today=SAT)

    def test_work_already_reported_shows_its_real_dates(self):
        p = self._project("الف")
        self._report(p, self.a, 4, D(2026, 9, 28))
        self._report(p, self.a, 4, D(2026, 9, 30))
        d = planning.plan(today=SAT)
        job = d["projects"][0]["jobs"][0]
        self.assertEqual((job["actualStart"], job["actualEnd"], job["percent"]), (D(2026, 9, 28), D(2026, 9, 30), 50))
        # وضعیت هر کار برای بورد و داشبورد: آستر نیمه‌کاره و در جریان؛ پرداخت ۸ متر کارِ آماده دارد و شروع نشده
        self.assertEqual([(j["status"], j["ready"]) for j in d["projects"][0]["jobs"]], [("doing", 8.0), ("ready", 8.0)])
        self.assertEqual([(x["date"], ln["area"]) for x in d["history"] for ln in x["lines"] if ln["project"] == "الف"],
                         [(D(2026, 9, 28), 4.0), (D(2026, 9, 30), 4.0)])
        self.assertEqual((d["projects"][0]["doneArea"], d["projects"][0]["plannedArea"]), (8.0, 32.0))

    def test_a_stage_station_can_be_picked_for_any_task(self):
        p = self._project("الف")
        planning.set_task({"project": str(p.pk), "stage": self.b.name, "station": planning.STAGE_ID + self.a.name},
                          self.user, today=SAT)
        d = planning.plan(today=SAT)
        self.assertEqual([j["stationName"] for j in d["projects"][0]["jobs"]], [self.a.name, self.a.name])
        self.assertEqual([(st["name"], st["implicit"]) for st in d["stations"]],
                         [(self.a.name, False), (self.b.name, True)])

    def test_a_task_can_be_moved_to_another_station_or_held_back(self):
        Station.objects.create(name="کابین", stages=[self.a.name, self.b.name], crew=1, order=0)
        other = Station.objects.create(name="کمکی", stages=[], crew=1, order=1)
        p = self._project("الف")
        planning.set_task({"project": str(p.pk), "stage": self.b.name, "station": str(other.pk),
                           "notBefore": "2026-10-10"}, self.user, today=SAT)
        d = planning.plan(today=SAT)
        job = d["projects"][0]["jobs"][1]
        self.assertEqual((job["stationName"], job["stationFixed"], job["start"]), ("کمکی", True, D(2026, 10, 10)))
        planning.set_task({"project": str(p.pk), "stage": self.b.name, "station": None, "notBefore": None},
                          self.user, today=SAT)
        self.assertEqual(planning.plan(today=SAT)["projects"][0]["jobs"][1]["stationName"], "کابین")
        self.assertFalse(p.plan_tasks.exists())                            # فقط پیشنهاد سیستم مانده

    def test_leave_takes_the_worker_out_of_his_station_that_day(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی"], order=0)
        self._project("الف")
        PlanLeave.objects.create(employee="علی", date_from=SAT, date_to=SAT)
        d = planning.plan(today=SAT)
        self.assertEqual(d["projects"][0]["start"], SUN)
        self.assertEqual((d["settings"]["presentToday"], d["settings"]["leaveToday"]), (1, ["علی"]))

    # ---------- تصمیم مسئول و انحراف ----------

    def test_manual_days_slip_by_themselves_when_a_day_falls_short(self):
        p = self._project("الف")
        planning.set_task({"project": str(p.pk), "stage": self.a.name, "days": 4}, self.user, today=SAT)
        d = planning.plan(today=SAT)
        job = d["projects"][0]["jobs"][0]
        self.assertEqual((job["manual"], job["daily"], job["days"], job["suggestedDays"], job["finish"]),
                         (True, 4.0, 4.0, 2.0, D(2026, 10, 6)))
        planning.commit(self.user, today=SAT)
        self.assertEqual(planning.plan(today=SAT)["projects"][0]["slipDays"], 0)

        self._report(p, self.a, 2, SAT)                # شنبه به‌جای ۴ متر فقط ۲ متر کار شد
        d = planning.plan(today=SUN)
        job = d["projects"][0]["jobs"][0]
        self.assertEqual((job["remaining"], job["days"], job["finish"], job["baselineFinish"], job["slipDays"]),
                         (14.0, 3.5, D(2026, 10, 7), D(2026, 10, 6), 1))
        day = d["past"][0]
        self.assertEqual((day["date"], day["planned"], day["actual"], day["percent"]), (SAT, 4.0, 2.0, 50.0))
        self.assertEqual((d["deviation"]["days"], d["deviation"]["avgPercent"], d["deviation"]["stdPercent"]),
                         (1, 50.0, 0.0))

        planning.commit(self.user, today=SUN)          # ثبت دوباره: آینده از نو، شنبهٔ گذشته سر جایش
        self.assertEqual(planning.plan(today=SUN)["projects"][0]["jobs"][0]["slipDays"], 0)
        self.assertTrue(PlanBaselineLine.objects.filter(date=SAT).exists())

        planning.set_task({"project": str(p.pk), "stage": self.a.name, "days": None}, self.user, today=SUN)
        self.assertFalse(planning.plan(today=SUN)["projects"][0]["jobs"][0]["manual"])

    def test_todays_report_moves_the_plan_to_tomorrow(self):
        p = self._project("الف")
        self._report(p, self.a, 16, SAT)
        d = planning.plan(today=SAT)
        self.assertEqual((d["start"], d["days"][0]["date"]), (SUN, SUN))

    def test_stations_are_saved_in_order_and_a_stage_belongs_to_one(self):
        planning.save_stations([{"name": "کابین", "stages": [self.a.name], "crew": 2, "people": ["علی", "ناشناس"]},
                                {"name": "میز", "stages": [self.b.name]}])
        self.assertEqual([(s.name, s.order, s.crew, s.people) for s in Station.objects.all()],
                         [("کابین", 0, 2, ["علی"]), ("میز", 1, 1, [])])
        first = Station.objects.get(name="کابین")
        with self.assertRaises(Exception):
            planning.save_stations([{"id": first.pk, "name": "کابین", "stages": [self.a.name]},
                                    {"name": "دوم", "stages": [self.a.name]}])
        planning.save_stations([{"id": first.pk, "name": "کابین رنگ", "stages": [self.a.name, self.b.name]}])
        self.assertEqual(list(Station.objects.values_list("name", flat=True)), ["کابین رنگ"])

    def test_endpoints_and_the_edit_key(self):
        p1, p2 = self._project("الف"), self._project("ب")
        api = APIClient()
        api.force_authenticate(self.user)
        post = lambda path, body: api.post(f"/api/production/{path}/", body, format="json")  # noqa: E731
        r = api.get("/api/production/plan/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((len(r.json()["projects"]), r.json()["canEdit"]), (2, True))
        r = post("plan-order", {"ids": [p2.pk, p1.pk]})
        self.assertEqual([x["name"] for x in r.json()["projects"]], ["ب", "الف"])
        r = post("plan-stations", {"stations": [{"name": "کابین", "stages": [self.a.name], "crew": 2}]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["stations"][0]["crew"], 2)
        r = post("plan-overtime", {"date": "2026-10-09", "hours": 4, "people": 1})
        self.assertEqual(len(r.json()["overtime"]), 1) if r.json()["overtime"] else None
        self.assertEqual(post("plan-overtime", {"date": "2026-10-09", "hours": 40}).status_code, 400)
        ot = PlanOvertime.objects.get()
        post("plan-overtime", {"remove": ot.pk})
        self.assertFalse(PlanOvertime.objects.exists())
        self.assertEqual(post("plan-leave", {"employee": "علی", "from": "2026-10-05", "to": "2026-10-06"}).status_code, 200)
        self.assertEqual(post("plan-leave", {"employee": "غریبه", "from": "2026-10-05"}).status_code, 400)
        post("plan-leave", {"remove": PlanLeave.objects.get().pk})
        self.assertFalse(PlanLeave.objects.exists())
        self.assertEqual(post("plan-task", {"project": str(p1.pk), "stage": self.a.name, "days": 2}).status_code, 200)
        self.assertEqual(post("plan-task", {"project": str(p1.pk), "stage": self.a.name, "days": 0}).status_code, 400)
        self.assertEqual(post("plan-shift", {"project": str(p2.pk), "days": 3}).status_code, 200)
        r = post("plan-commit", {"note": "برنامهٔ هفته"})
        self.assertEqual((r.status_code, r.json()["baseline"]["by"], r.json()["baseline"]["note"]),
                         (200, "مدیر", "برنامهٔ هفته"))
        self.user.access = ["production"]
        self.user.save()
        self.assertEqual(api.get("/api/production/plan/").json()["canEdit"], False)
        for path in ("plan-order", "plan-task", "plan-shift", "plan-stations", "plan-overtime", "plan-holiday", "plan-leave",
                     "plan-commit"):
            self.assertEqual(post(path, {}).status_code, 403, path)
