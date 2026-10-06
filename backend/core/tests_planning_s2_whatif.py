"""سناریوهای تازهٔ برنامه‌ریزی تولید — «اگر نفر اضافه کنم چه می‌شود؟» و سناریوهای فهرستِ بیرونی که هنوز تست نشده بودند
(۳۰۴ تا ۳۴۳).

what_if برنامه را با چند فرض دوباره می‌چیند (یک نفرِ بیشتر روی هر ایستگاه، کارگرِ تازه، اضافه‌کاری، و بهترین جای یک تا سه
نفر با هم) و پایانِ واقعیِ هر کدام را می‌گوید؛ چیزی ذخیره نمی‌شود."""
import time
from unittest import mock

from .models import PlanBaselineLine, PlanCommit, PlanHoliday, PlanOvertime, PlanTask, User
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit

NAMES = ["علی", "رضا", "حسن", "مینا", "سارا", "نیما", "زهرا", "امیر", "لیلا", "کاوه", "ندا", "بهرام", "شیرین", "پویا", "مهسا",
         "سینا", "نرگس", "آرش", "هما", "یاسر"]


class Base(Kit):
    def workers(self, n):
        Employee.objects.all().delete()
        for name in NAMES[:n]:
            Employee.objects.create(name=name)

    def ordered(self, *projects):
        planning.set_order([p.pk for p in projects])

    def what(self, today=SAT):
        return planning.what_if(today=today)

    def option(self, w, stage=None, kind="station"):
        return next(o for o in w["options"] if o["kind"] == kind and (stage is None or o["name"] == stage.name))

    def dates(self, d):
        return {(p["name"], j["stage"]): (j["start"], j["finish"]) for p in d["projects"] for j in p["jobs"]}


class WhatIf(Base):
    def test_304_nothing_to_plan_nothing_to_suggest(self):
        w = self.what()
        self.assertEqual((w["options"], w["combos"], w["now"]["finish"], w["now"]["projects"]), ([], [], None, []))

    def test_305_one_more_person_on_the_slow_station(self):
        self.proj("الف")
        w = self.what()
        self.assertEqual(w["now"]["finish"], WED)
        b = self.option(w, self.b)
        self.assertEqual((b["finish"], b["endGain"], b["better"], b["crew"]), (TUE, 1, True, 1))
        a = self.option(w, self.a)
        self.assertEqual((a["finish"], a["endGain"], a["better"]), (WED, 0, False))
        self.assertEqual([(c["people"], [(s["name"], s["add"]) for s in c["stations"]]) for c in w["combos"]][0],
                         (1, [(self.b.name, 1)]))

    def test_306_asking_changes_nothing(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=SUN.isoformat())
        self.overtime(MON, 2)
        before = self.plan()
        counts = lambda: (PlanTask.objects.count(), PlanOvertime.objects.count(), Employee.objects.count(),  # noqa: E731
                          Station.objects.count(), PlanBaselineLine.objects.count(), PlanCommit.objects.count())
        n = counts()
        self.what()
        self.assertEqual(counts(), n)
        self.assertEqual(self.plan(), before)

    def test_307_a_job_the_planner_sized_is_left_alone(self):
        p = self.proj("الف")
        self.task(p, self.b, days=4)
        w = self.what()
        self.assertEqual([o["name"] for o in w["options"] if o["kind"] == "station"], [self.a.name])

    def test_308_a_job_with_its_own_crew_is_left_alone(self):
        p = self.proj("الف")
        self.task(p, self.b, crew=1)
        w = self.what()
        self.assertEqual([o["name"] for o in w["options"] if o["kind"] == "station"], [self.a.name])

    def test_309_helping_one_station_alone_only_moves_the_bottleneck(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)                      # مثل پرداخت: روزی ۴ متر
        self.workers(5)
        self.proj("الف", area=32, stages=[self.a, self.b, c])
        w = self.what()
        self.assertEqual(w["now"]["finish"], WED2)
        for s in (self.b, c):
            self.assertEqual((self.option(w, s)["endGain"], self.option(w, s)["better"]), (0, False), s.name)
        best = w["combos"][0]
        self.assertEqual((best["people"], sorted(s["name"] for s in best["stations"])), (2, sorted([self.b.name, c.name])))
        self.assertEqual((best["finish"], best["endGain"]), (SAT2, 4))

    def test_310_two_hours_of_overtime_a_day(self):
        self.proj("الف", area=40)
        w = self.what()
        o = self.option(w, kind="overtime")
        self.assertEqual((w["now"]["finish"], o["finish"], o["endGain"]), (D(2026, 10, 15), TUE2, 2))

    def test_311_a_new_worker_helps_when_people_are_what_is_short(self):
        c = self.stage("رنگ آزمایشی", 3)
        x, y, z = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b]), self.proj("سه", stages=[c])
        self.ordered(x, y, z)
        o = self.option(self.what(), kind="worker")
        self.assertEqual((o["better"], o["projectDays"], [(g["label"], g["gain"]) for g in o["projects"]]),
                         (True, 2, [("سه", 2)]))

    def test_312_a_new_worker_does_not_help_when_a_station_is_what_is_short(self):
        self.proj("الف")
        o = self.option(self.what(), kind="worker")
        self.assertEqual((o["better"], o["endGain"], o["projects"]), (False, 0, []))

    def test_313_a_station_cannot_get_more_people_than_the_workshop_has(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=2, order=0)
        self.proj("الف", stages=[self.a])
        self.assertEqual([o["kind"] for o in self.what()["options"]], ["worker", "overtime"])

    def test_314_the_same_question_twice_gives_the_same_answer(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24, due_date=MON2)
        one, two = self.what(), self.what()
        for w in (one, two):
            w.pop("seconds")
        self.assertEqual(one, two)

    def test_315_the_page_can_ask_and_a_viewer_too(self):
        self.proj("الف")
        r = self.api().get("/api/production/plan-what-if/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(sorted(r.json()), ["choices", "combos", "now", "options", "order", "partial", "seconds", "today", "workers"])
        viewer = User.objects.create_user(username="viewer", password="x", name="بیننده", role="member", access=["production"])
        self.assertEqual(self.api(viewer).get("/api/production/plan-what-if/").status_code, 200)

    def test_316_an_extra_person_that_makes_something_later_says_so(self):
        # دو کارگر، دو ایستگاه. نفرِ دوم روی آستر همهٔ توان را می‌گیرد و پرداختِ پروژهٔ دیگر یک روز عقب می‌افتد.
        x, y = self.proj("یک", stages={self.a: 32}), self.proj("دو", stages={self.b: 8})
        self.ordered(x, y)
        o = self.option(self.what(), self.a)
        self.assertEqual({g["label"]: g["gain"] for g in o["projects"]}, {"یک": 2, "دو": -2})

    def test_317_thirty_projects_are_answered_quickly(self):
        self.workers(6)
        for i in range(30):
            self.proj(f"پ{i:02d}", area=8, due_date=D(2026, 11, 1) + W(i))
        t = time.monotonic()
        w = self.what()
        self.assertLess(time.monotonic() - t, 12.0)
        self.assertTrue(w["options"])


class OutsideList(Base):
    """سناریوهایی از فهرستِ ۲۰۰تاییِ بیرونی که با مدلِ «خطِ مراحل» جور بودند و هنوز تستی نداشتند."""

    def chain(self, n):
        extra = [self.stage(f"مرحلهٔ {i}", 10 + i) for i in range(n - 2)]
        return [self.a, self.b] + extra

    def test_318_six_stages_one_after_another(self):
        stages = self.chain(6)
        self.workers(6)
        self.proj("الف", area=8, stages=stages)
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [s.name for s in stages])
        self.assertEqual([self.J(d, "الف", s)["start"] for s in stages], [SAT, SUN, MON, TUE, WED, THU])

    def test_319_a_chain_of_twenty_stages_does_not_drift(self):
        stages = self.chain(20)
        self.workers(20)
        self.proj("الف", area=8, stages=stages)
        t = time.monotonic()
        d = self.plan()
        self.assertLess(time.monotonic() - t, 5.0)
        jobs = [self.J(d, "الف", s) for s in stages]
        for prev, nxt in zip(jobs, jobs[1:]):
            self.assertGreater(nxt["start"], prev["start"])
            self.assertGreaterEqual(nxt["finish"], prev["finish"])
        working = [x["date"] for x in d["days"]]
        self.assertEqual([j["start"] for j in jobs], working[:20])       # هر مرحله درست یک روزِ کاری پس از قبلی
        self.assertFalse(d["totals"]["unfinished"])

    def test_320_a_stage_with_no_area_is_not_a_job(self):
        self.proj("الف", stages={self.a: 0, self.b: 16})
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.b.name])
        self.assertEqual(self.J(d, "الف", self.b)["start"], SAT)

    def test_321_taking_a_middle_stage_out_of_a_project(self):
        c = self.stage("رنگ آزمایشی", 3)
        p = self.proj("الف", stages=[self.a, self.b, c])
        self.report(p, self.a, 16, PAST)
        self.report(p, self.b, 8, PAST)
        self.assertEqual(self.J(self.plan(), "الف", c)["ready"], 8.0)
        ProjectStage.objects.filter(project=p, name=self.b.name).delete()
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.a.name, c.name])
        self.assertEqual((self.J(d, "الف", c)["ready"], self.J(d, "الف", c)["start"]), (16.0, SAT))

    def test_322_equal_projects_are_ordered_the_same_way_every_time(self):
        self.proj("ب")
        self.proj("الف")
        self.assertEqual(self.names(self.plan()), ["الف", "ب"])
        Project.objects.filter(name="ب").update(start_date=PAST)
        self.assertEqual(self.names(self.plan()), ["ب", "الف"])        # تاریخ شروعِ زودتر جلوتر است

    def test_323_moving_a_due_date_reorders_the_plan(self):
        x = self.proj("یک", due_date=D(2026, 11, 30))
        self.proj("دو", due_date=D(2026, 10, 20))
        self.assertEqual(self.names(self.plan()), ["دو", "یک"])
        Project.objects.filter(pk=x.pk).update(due_date=D(2026, 10, 12))
        d = self.plan()
        self.assertEqual((self.names(d), self.J(d, "یک", self.a)["start"]), (["یک", "دو"], SAT))

    def test_324_changing_the_order_in_the_middle_of_a_job(self):
        one, two = self.proj("یک"), self.proj("دو")
        self.ordered(one, two)
        self.report(one, self.a, 8, SAT, hours=8)
        self.ordered(two, one)
        d = self.plan(SUN)
        self.assertEqual(self.names(d), ["دو", "یک"])
        self.assertEqual(self.lines(d, SUN)[0], ("یک", self.a.name, 8.0))     # کارِ نیمه‌کاره اول تمام می‌شود
        self.assertEqual(self.J(d, "دو", self.a)["start"], MON)

    def test_325_fifty_projects(self):
        self.workers(6)
        for i in range(50):
            self.proj(f"پ{i:02d}", area=8, due_date=D(2026, 11, 1) + W(i % 9))
        t = time.monotonic()
        d = planning.plan(today=SAT)
        self.assertLess(time.monotonic() - t, 6.0)
        self.assertFalse(d["totals"]["unfinished"])
        self.check(d)

    def test_326_a_thousand_jobs(self):
        stages = self.chain(10)
        self.workers(20)
        for i in range(100):
            self.proj(f"پ{i:03d}", area=4, stages=stages)
        t = time.monotonic()
        d = planning.plan(today=SAT)
        took = time.monotonic() - t
        self.assertEqual(sum(len(p["jobs"]) for p in d["projects"]), 1000)
        self.assertLess(took, 20.0)
        self.assertFalse(d["totals"]["unfinished"])
        self.check(d)

    def test_327_a_new_project_at_the_end_of_the_queue_moves_nobody(self):
        one, two = self.proj("یک", area=24), self.proj("دو", area=24)
        self.ordered(one, two)
        before = self.dates(self.plan())
        self.proj("سه", area=40)
        after = self.dates(self.plan())
        self.assertEqual({k: v for k, v in after.items() if k[0] != "سه"}, before)

    def test_328_an_urgent_project_moves_only_what_it_shares(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.workers(5)
        one, two = self.proj("یک", area=24), self.proj("دو", stages={c: 24})
        self.ordered(one, two)
        before = self.dates(self.plan())
        urgent = self.proj("فوری", stages={c: 16})
        self.ordered(urgent, one, two)
        after = self.dates(self.plan())
        self.assertEqual({k: v for k, v in after.items() if k[0] == "یک"}, {k: v for k, v in before.items() if k[0] == "یک"})
        self.assertGreater(after[("دو", c.name)][0], before[("دو", c.name)][0])
        self.assertEqual(after[("فوری", c.name)][0], SAT)

    def test_329_a_small_job_is_not_starved_by_a_big_one(self):
        c = self.stage("رنگ آزمایشی", 3)
        big, small = self.proj("بزرگ", area=80), self.proj("کوچک", stages={c: 4})
        self.ordered(big, small)
        d = self.plan()
        self.assertEqual((self.J(d, "کوچک", c)["start"], self.J(d, "کوچک", c)["finish"]), (SAT, SAT))

    def test_330_finishing_early_pulls_the_next_work_in(self):
        p = self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.report(p, self.a, 16, SAT)
        self.report(p, self.b, 8, SAT)
        d = self.plan(SUN)
        self.assertEqual((self.P(d, "الف")["finish"], self.P(d, "الف")["slipDays"]), (MON, -2))
        self.assertEqual(d["totals"]["behind"], 0)

    def test_331_the_morning_job_leaves_the_planners_decisions_alone(self):
        p = self.proj("الف", area=40)
        self.task(p, self.b, notBefore=WED.isoformat(), crew=2)
        self.task(p, self.a, days=10)
        before = list(PlanTask.objects.order_by("stage").values_list("stage", "not_before", "crew", "daily_area", "batch"))
        for day in (SAT, SUN, MON):
            planning.daily(today=day)
        self.assertEqual(list(PlanTask.objects.order_by("stage").values_list("stage", "not_before", "crew", "daily_area", "batch")),
                         before)

    def test_332_a_manual_move_that_makes_the_project_late_is_flagged(self):
        p = self.proj("الف", due_date=THU)
        d = self.plan()
        self.assertEqual((self.P(d, "الف")["onTime"], d["totals"]["late"]), (True, 0))
        self.task(p, self.b, notBefore=SAT2.isoformat())
        d = self.plan()
        x = self.P(d, "الف")
        self.assertEqual((x["onTime"], d["totals"]["late"]), (False, 1))
        self.assertLess(x["slackDays"], 0)

    def test_333_a_decision_carries_the_name_of_who_made_it(self):
        other = User.objects.create_user(username="planner2", password="x", name="برنامه‌ریز دوم", role="member",
                                         access=["production", "production.plan"])
        p = self.proj("الف")
        self.task(p, self.a, days=4)
        self.assertEqual(PlanTask.objects.get().updated_by_name, "مدیر")
        r = self.post("plan-task", {"project": str(p.pk), "stage": self.a.name, "crew": 2}, user=other)
        self.assertEqual(r.status_code, 200, r.content)
        t = PlanTask.objects.get()
        self.assertEqual((t.updated_by_name, t.crew), ("برنامه‌ریز دوم", 2))

    def test_334_a_station_deleted_from_under_a_job(self):
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=5)
        p = self.proj("الف")
        self.task(p, self.a, station=str(helper.pk), days=4)
        Station.objects.filter(pk=helper.pk).delete()
        d = self.plan()
        j = self.J(d, "الف", self.a)
        self.assertEqual((j["stationName"], j["stationFixed"], j["daily"]), (self.a.name, False, 4.0))

    def test_335_rubbish_areas_do_not_break_the_plan(self):
        p = self.proj("الف", stages={self.a: 16})
        ProjectStage.objects.create(project=p, name=self.b.name, area=-5, order=1)
        huge = self.proj("ب", stages={self.a: 9999999.99})
        tiny = self.proj("ج", stages={self.a: 0.01})
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.a.name])
        self.assertTrue(d["totals"]["unfinished"])
        self.assertIsNotNone(huge and tiny)

    def test_336_the_bottleneck_is_the_station_that_is_full_and_has_a_queue(self):
        for n in ("یک", "دو", "سه"):
            self.report(self.proj(n), self.a, 16, PAST)
        d = self.plan()
        q = {x["name"]: x for x in d["queues"]}
        self.assertEqual((q[self.b.name]["bottleneck"], q[self.b.name]["ready"], q[self.b.name]["load"]), (True, 48.0, 100.0))
        self.assertFalse(q[self.a.name]["bottleneck"])

    def test_337_a_save_that_fails_half_way_keeps_nothing(self):
        p = self.proj("الف")
        real, calls = PlanTask.save, []

        def flaky(self_, *a, **kw):
            calls.append(1)
            if len(calls) == 2:
                raise RuntimeError("قطع ارتباط")
            return real(self_, *a, **kw)

        with mock.patch.object(PlanTask, "save", flaky):
            with self.assertRaises(RuntimeError):
                planning.shift_project({"project": p.pk, "days": 2}, self.user, today=SAT)
        self.assertFalse(PlanTask.objects.exists())

    def test_338_committing_twice_in_a_row_is_the_same_baseline(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24)
        snap = lambda: list(PlanBaselineLine.objects.order_by("date", "project_id", "stage")  # noqa: E731
                            .values_list("date", "project_id", "stage", "area", "people", "station_name"))
        planning.commit(self.user, today=SAT)
        one = snap()
        planning.commit(self.user, today=SAT)
        self.assertEqual(snap(), one)

    def test_339_two_planners_editing_the_same_job(self):
        other = User.objects.create_user(username="planner2", password="x", name="برنامه‌ریز دوم", role="member",
                                         access=["production", "production.plan"])
        p = self.proj("الف")
        self.task(p, self.b, days=8, notBefore=TUE.isoformat())
        planning.set_task({"project": str(p.pk), "stage": self.b.name, "notBefore": WED.isoformat()}, other, today=SAT)
        t = PlanTask.objects.get()
        self.assertEqual((PlanTask.objects.count(), t.not_before, float(t.daily_area), t.updated_by_name),
                         (1, WED, 2.0, "برنامه‌ریز دوم"))
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], WED)

    def test_340_a_cancelled_project_frees_its_place_at_once(self):
        one, two = self.proj("یک"), self.proj("دو")
        self.ordered(one, two)
        self.assertEqual(self.J(self.plan(), "دو", self.a)["start"], MON)
        Project.objects.filter(pk=one.pk).update(closed_at=SAT)
        self.assertEqual(self.J(self.plan(), "دو", self.a)["start"], SAT)

    def test_341_a_holiday_entered_for_a_day_already_gone_changes_nothing(self):
        self.proj("الف", area=40)
        planning.commit(self.user, today=SAT)
        before = self.plan(MON)
        PlanHoliday.objects.create(date=SAT, title="فراموش‌شده")
        after = self.plan(MON)
        for key in ("projects", "days", "totals"):
            self.assertEqual(after[key], before[key], key)

    def test_342_a_paused_job_keeps_what_was_done_and_what_is_left(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, SAT)
        planning.pause_project({"project": p.pk, "start": SUN.isoformat()}, self.user, today=SUN)
        planning.resume_project({"project": p.pk, "end": SAT2.isoformat()}, self.user, today=SAT2)
        j = self.J(self.plan(SAT2), "الف", self.a)
        self.assertEqual((j["remaining"], j["actualStart"], j["start"], j["overdue"]), (8.0, SAT, SAT2, False))

    def test_343_a_half_done_job_carries_over_the_weekend(self):
        p = self.proj("الف", stages={self.a: 20})
        self.task(p, self.a, notBefore=WED.isoformat())
        self.assertEqual(self.worked(self.plan(), "الف", self.a), [WED, THU, SAT2])
