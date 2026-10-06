"""سناریوهای تازهٔ برنامه‌ریزی تولید — بهره‌وریِ خودِ برنامه (۲۵۲ تا ۳۰۳).

برنامهٔ درست برنامه‌ای است که توانِ کارگاه را هدر ندهد: نفری که وسطِ روز آزاد می‌شود همان روز سرِ کارِ بعد برود، وقتِ ماندهٔ
یک ایستگاه به کارِ بعدیِ همان ایستگاه برسد، گلوگاه بی‌کار نماند، و نوبتِ پروژه‌ها رعایت شود. هر برنامه‌ای که این تست‌ها
می‌گیرند با Kit.check هم وارسی می‌شود (بی‌کاریِ بی‌دلیل و نوبت‌شکنی در هیچ روزی نباشد)."""
import random

from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit

NAMES = ["علی", "رضا", "حسن", "مینا", "سارا", "نیما", "زهرا"]


class Efficiency(Kit):
    def workers(self, n):
        Employee.objects.all().delete()
        for name in NAMES[:n]:
            Employee.objects.create(name=name)

    def ordered(self, *projects):
        planning.set_order([p.pk for p in projects])

    def used(self, d, day):
        return self.day(d, day)["used"]

    # ---------- نفر و وقتی که وسطِ روز آزاد می‌شود ----------

    def test_252_the_rest_of_a_stations_day_goes_to_the_next_job_at_full_speed(self):
        self.workers(1)
        x, y = self.proj("یک", stages={self.a: 4}), self.proj("دو", stages={self.a: 16})
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 4.0), ("دو", self.a.name, 4.0)])
        self.assertEqual(self.used(d, SAT), 1.0)

    def test_253_a_worker_freed_at_noon_moves_to_another_station(self):
        self.workers(1)
        x, y = self.proj("یک", stages={self.a: 4}), self.proj("دو", stages={self.b: 16})
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 4.0), ("دو", self.b.name, 2.0)])
        self.assertEqual(self.used(d, SAT), 1.0)

    def test_254_two_workers_three_jobs_two_stations(self):
        x, y, z = self.proj("یک", stages={self.a: 4}), self.proj("دو", stages={self.a: 16}), self.proj("سه", stages={self.b: 16})
        self.ordered(x, y, z)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 4.0), ("دو", self.a.name, 4.0), ("سه", self.b.name, 4.0)])
        self.assertEqual(self.used(d, SAT), 2.0)

    def test_255_everybody_is_busy_while_there_is_work_for_them(self):
        c = self.stage("رنگ آزمایشی", 3)
        x, y, z = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b]), self.proj("سه", stages=[c])
        self.ordered(x, y, z)
        d = self.plan()
        self.assertEqual([self.used(d, day) for day in (SAT, SUN, MON)], [2.0, 2.0, 2.0])

    def test_256_many_small_jobs_fill_every_day_of_the_station(self):
        for i, area in enumerate((3, 5, 2, 7, 4, 6)):
            self.proj(f"پ{i}", stages={self.a: area})
        d = self.plan()
        self.assertEqual([round(sum(a for _, _, a in self.lines(d, day)), 2) for day in (SAT, SUN, MON, TUE)], [8.0, 8.0, 8.0, 3.0])
        self.assertEqual(d["totals"]["finish"], TUE)

    def test_257_small_jobs_finish_in_due_date_order(self):
        for i, area in enumerate((3, 5, 2, 7, 4, 6)):
            self.proj(f"پ{i}", stages={self.a: area}, due_date=SAT + W(20 - i))
        d = self.plan()
        by_due = sorted(d["projects"], key=lambda p: p["dueDate"])
        self.assertEqual([p["name"] for p in by_due], [p["name"] for p in d["projects"]])
        finishes = [p["finish"] for p in by_due]
        self.assertEqual(finishes, sorted(finishes))

    def test_258_the_project_due_sooner_goes_first_and_both_are_on_time(self):
        self.proj("دیر", stages={self.a: 16}, due_date=D(2026, 11, 30))
        self.proj("زود", stages={self.a: 16}, due_date=MON)
        d = self.plan()
        self.assertEqual(self.names(d), ["زود", "دیر"])
        self.assertEqual([p["onTime"] for p in d["projects"]], [True, True])
        self.assertEqual(self.P(d, "زود")["finish"], SUN)

    def test_259_a_due_date_that_cannot_be_met_is_flagged(self):
        self.proj("الف", stages={self.a: 40}, due_date=MON)
        d = self.plan()
        p = self.P(d, "الف")
        self.assertEqual((p["finish"], p["slackDays"], p["onTime"], d["totals"]["late"]), (WED, -2, False, 1))

    def test_260_pinning_a_project_first_can_make_another_late_and_says_so(self):
        far = self.proj("دیر", stages={self.a: 16}, due_date=D(2026, 11, 30))
        self.proj("زود", stages={self.a: 16}, due_date=MON)
        self.ordered(far)
        d = self.plan()
        self.assertEqual((self.P(d, "زود")["onTime"], d["totals"]["late"]), (False, 1))

    def test_261_a_thursday_leftover(self):
        self.workers(1)
        x, y = self.proj("یک", stages={self.a: 2}), self.proj("دو", stages={self.a: 16})
        self.ordered(x, y)
        self.assertEqual(self.lines(self.plan(THU), THU), [("یک", self.a.name, 2.0), ("دو", self.a.name, 2.0)])

    def test_262_half_a_person_left_still_works(self):
        x, y = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b])
        self.ordered(x, y)
        self.leave("رضا", SAT, hours=4)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 8.0), ("دو", self.b.name, 2.0)])
        self.assertEqual(self.used(d, SAT), 1.5)

    def test_263_a_two_person_station_with_a_person_and_a_half(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=2, order=0)
        x, y = self.proj("یک", stages={self.a: 40}), self.proj("دو", stages=[self.b])
        self.ordered(x, y)
        self.leave("رضا", SAT, hours=4)
        self.assertEqual(self.lines(self.plan(), SAT), [("یک", self.a.name, 12.0)])

    def test_264_with_one_worker_the_first_project_is_finished_first(self):
        self.workers(1)
        one, two = self.proj("یک"), self.proj("دو", stages=[self.a])
        self.ordered(one, two)
        self.report(one, self.a, 8, PAST, hours=8)
        d = self.plan()
        self.assertEqual(self.J(d, "دو", self.a)["start"], THU)
        self.assertLess(self.P(d, "یک")["finish"], self.P(d, "دو")["finish"])

    def test_265_one_persons_overtime_is_used_to_the_hour(self):
        x, y = self.proj("یک", stages={self.a: 40}), self.proj("دو", stages={self.b: 40})
        self.ordered(x, y)
        self.overtime(SAT, 4, people=1)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 12.0), ("دو", self.b.name, 4.0)])
        self.assertEqual((self.day(d, SAT)["pool"], self.used(d, SAT)), (2.5, 2.5))

    def test_266_one_person_on_a_friday_runs_one_station(self):
        x, y = self.proj("یک", stages={self.a: 40}), self.proj("دو", stages={self.b: 40})
        self.ordered(x, y)
        self.overtime(FRI, 8, people=1)
        d = self.plan(FRI)
        self.assertEqual(self.lines(d, FRI), [("یک", self.a.name, 8.0)])
        self.assertEqual(self.used(d, FRI), 1.0)

    # ---------- گلوگاه ----------

    def test_267_the_bottleneck_never_stands_idle(self):
        ps = [self.proj(n) for n in ("یک", "دو", "سه")]
        self.ordered(*ps)
        d = self.plan()
        end = D(2026, 10, 18)
        self.assertEqual(d["totals"]["finish"], end)
        for x in d["days"]:
            if x["date"] >= SUN:
                done = round(sum(ln["area"] for ln in x["lines"] if ln["stage"] == self.b.name), 2)
                self.assertEqual(done, 2.0 if x["date"].weekday() == 3 else 4.0, x["date"])

    def test_268_a_job_runs_every_working_day_once_its_work_keeps_coming(self):
        self.proj("الف", area=40)
        d = self.plan()
        days = self.worked(d, "الف", self.b)
        working = [x["date"] for x in d["days"] if days[0] <= x["date"] <= days[-1]]
        self.assertEqual(days, working)

    def test_269_work_resumes_the_very_day_a_pause_ends(self):
        p = self.proj("الف")
        planning.pause_project({"project": p.pk, "start": SUN.isoformat()}, self.user, today=SAT)
        planning.resume_project({"project": p.pk, "end": TUE.isoformat()}, self.user, today=SAT)
        self.assertEqual(self.worked(self.plan(), "الف", self.a), [SAT, TUE])

    def test_270_every_station_resumes_right_after_a_holiday(self):
        self.proj("الف", area=40)
        self.holiday(SUN)
        d = self.plan()
        self.assertEqual({s for _, s, _ in self.lines(d, MON)}, {self.a.name, self.b.name})

    def test_271_while_one_project_dries_the_station_serves_the_next(self):
        WorkStage.objects.filter(pk=self.a.pk).update(wait_hours=24)
        one, two = self.proj("یک", stages={self.a: 8, self.b: 8}), self.proj("دو", stages={self.b: 16})
        self.ordered(one, two)
        d = self.plan()
        self.assertEqual((self.area(d, SAT, "دو", self.b), self.area(d, SUN, "دو", self.b)), (4.0, 4.0))
        self.assertEqual((self.area(d, MON, "یک", self.b), self.area(d, MON, "دو", self.b)), (4.0, 0))

    def test_272_a_station_waiting_for_a_pair_serves_a_third_project(self):
        one, two, three = self.proj("یک"), self.proj("دو"), self.proj("سه", stages=[self.b])
        self.ordered(one, two, three)
        self.task(one, self.b, together=[str(two.pk)])
        d = self.plan()
        self.assertEqual((self.J(d, "سه", self.b)["start"], self.J(d, "سه", self.b)["finish"]), (SAT, TUE))
        self.assertEqual(self.J(d, "یک", self.b)["start"], WED)

    def test_273_one_more_worker_never_ends_this_plan_later(self):
        c = self.stage("رنگ آزمایشی", 3)
        for n in ("یک", "دو", "سه"):
            self.proj(n, stages=[self.a, self.b, c])
        two = self.plan()["totals"]["finish"]
        Employee.objects.create(name="حسن")
        three = self.plan()["totals"]["finish"]
        self.assertLessEqual(three, two)

    def test_274_overtime_never_ends_this_plan_later(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24)
        before = {p["name"]: p["finish"] for p in self.plan()["projects"]}
        self.overtime(MON, 4)
        self.overtime(TUE, 4)
        after = {p["name"]: p["finish"] for p in self.plan()["projects"]}
        self.assertTrue(all(after[n] <= before[n] for n in before), (before, after))
        self.assertLess(max(after.values()), max(before.values()))

    def test_275_taking_a_holiday_away_never_ends_this_plan_later(self):
        from .models import PlanHoliday
        self.proj("الف", area=40)
        self.holiday(MON)
        with_holiday = self.plan()["totals"]["finish"]
        PlanHoliday.objects.filter(date=MON).delete()
        self.assertLess(self.plan()["totals"]["finish"], with_holiday)

    def test_276_a_second_person_on_the_slow_job_shortens_the_project(self):
        p = self.proj("الف")
        self.assertEqual(self.P(self.plan(), "الف")["finish"], WED)
        self.task(p, self.b, crew=2)
        d = self.plan()
        self.assertEqual(self.area(d, SUN, "الف", self.b), 4.0)        # یکشنبه یک نفر هنوز سرِ آستر است
        self.assertEqual(self.area(d, MON, "الف", self.b), 8.0)
        self.assertEqual(self.P(d, "الف")["finish"], TUE)

    # ---------- عددهای بهره‌وری و راهنمایی ----------

    def test_277_how_much_of_the_workshop_the_plan_uses(self):
        self.proj("الف")
        d = self.plan()
        self.assertEqual((d["totals"]["idle"], d["totals"]["utilization"]), (4.0, 60.0))

    def test_278_one_worker_who_is_always_busy(self):
        self.workers(1)
        self.proj("الف")
        d = self.plan()
        self.assertEqual((d["totals"]["idle"], d["totals"]["utilization"]), (0.5, 92.3))       # فقط نیم‌روزِ آخر خالی است

    def test_279_nothing_to_do_means_no_utilization_number(self):
        d = self.plan()
        self.assertEqual((d["totals"]["idle"], d["totals"]["utilization"]), (0.0, None))

    def test_280_utilization_looks_at_the_next_two_working_weeks(self):
        self.workers(5)
        self.proj("الف", stages={self.a: 16, self.b: 160})
        d = self.plan()
        ahead = d["days"][:planning.LOAD_DAYS]
        self.assertEqual(d["totals"]["idle"], round(sum(x["pool"] - x["used"] for x in ahead), 1))
        self.assertLess(d["totals"]["utilization"], 30)                # پنج نفر، یک ایستگاهِ یک‌نفره

    def test_281_more_ready_work_means_a_fuller_workshop(self):
        self.proj("الف")
        one = self.plan()["totals"]["utilization"]
        c = self.stage("رنگ آزمایشی", 3)
        self.proj("ب", stages={c: 40})                              # کارِ آماده برای ایستگاهی که بی‌کار بود
        self.assertGreater(self.plan()["totals"]["utilization"], one)

    def test_282_general_work_takes_its_hours_and_the_rest_is_used(self):
        x, y = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b])
        self.ordered(x, y)
        self.leave("رضا", SAT, hours=4, kind="general")
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 8.0), ("دو", self.b.name, 2.0)])

    def test_283_the_rest_of_today_is_planned_at_full_speed(self):
        p = self.proj("الف", area=40)
        self.report(p, self.a, 8, SAT, hours=8)                    # نصفِ توانِ امروز گزارش شده
        d = self.plan()
        self.assertEqual((d["start"], self.area(d, SAT, "الف", self.a)), (SAT, 4.0))

    def test_284_a_station_with_two_stages_gives_its_leftover_to_the_other_stage(self):
        Station.objects.create(name="خط", stages=[self.a.name, self.b.name], crew=1, order=0)
        x, y = self.proj("یک", stages={self.a: 4}), self.proj("دو", stages={self.b: 16})
        self.ordered(x, y)
        self.assertEqual(self.lines(self.plan(), SAT), [("یک", self.a.name, 4.0), ("دو", self.b.name, 2.0)])

    def test_285_someone_on_chores_all_day_is_not_counted_for_a_station(self):
        self.workers(3)
        Station.objects.create(name="کابین", stages=[self.a.name], crew=3, order=0)
        self.proj("الف", stages={self.a: 48})
        self.leave("حسن", SAT, kind="general")
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 16.0)])

    def test_286_a_one_person_job_stays_a_one_person_job(self):
        self.workers(5)
        self.proj("الف")
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 8.0)])

    def test_287_a_job_short_of_ready_work_leaves_the_station_to_the_next(self):
        one, two = self.proj("یک"), self.proj("دو", stages=[self.b])
        self.ordered(one, two)
        self.report(one, self.a, 2, PAST, hours=2)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 8.0), ("یک", self.b.name, 2.0), ("دو", self.b.name, 2.0)])

    def test_288_people_days_add_up(self):
        x, y, z = self.proj("یک", stages={self.a: 4}), self.proj("دو", stages={self.a: 16}), self.proj("سه", stages={self.b: 16})
        self.ordered(x, y, z)
        self.overtime(SUN, 4, people=1)
        d = self.plan()
        for x in d["days"]:
            factor = (x["base"] + x["overtime"]) / 8
            self.assertAlmostEqual(sum(ln["people"] * ln["share"] * factor for ln in x["lines"]), x["used"], delta=0.1)

    def test_289_a_project_ending_at_noon_hands_the_station_over_that_day(self):
        x, y = self.proj("یک", stages={self.a: 12}), self.proj("دو", stages={self.a: 16})
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, SUN), [("یک", self.a.name, 4.0), ("دو", self.a.name, 4.0)])

    def test_290_one_worker_one_project_takes_exactly_its_work(self):
        self.workers(1)
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.P(d, "الف")["finish"], SAT2)          # ۲ روز آستر + ۴ روز پرداخت؛ پنجشنبه نیم‌روز است
        self.assertTrue(all(x["used"] == x["pool"] for x in d["days"][:-1]), [(x["date"], x["pool"], x["used"]) for x in d["days"]])

    def test_291_one_worker_two_projects_and_the_leftover_half_day(self):
        self.workers(1)
        one, two = self.proj("یک"), self.proj("دو", stages=[self.a])
        self.ordered(one, two)
        d = self.plan()
        self.assertEqual(self.area(d, SAT2, "دو", self.a), 4.0)
        self.assertTrue(all(x["used"] == x["pool"] for x in d["days"][:-1]))

    def test_292_a_two_person_station_when_only_one_person_is_free(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=2, order=0)
        x, y = self.proj("یک", stages=[self.b]), self.proj("دو", stages={self.a: 40})
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.b.name, 4.0), ("دو", self.a.name, 8.0)])
        self.assertEqual(self.used(d, SAT), 2.0)

    def test_293_a_placed_job_cannot_take_people_who_are_not_there(self):
        self.workers(1)
        x, y = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b])
        self.ordered(x, y)
        self.task(y, self.b, notBefore=SAT.isoformat())
        self.task(x, self.a, notBefore=SAT.isoformat())
        d = self.plan()
        self.assertEqual(len(self.lines(d, SAT)), 1)
        self.assertEqual(self.used(d, SAT), 1.0)

    def test_294_three_stages_flow_without_a_wasted_day(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.workers(3)
        self.proj("الف", stages=[self.a, self.b, c])
        d = self.plan()
        self.assertEqual([self.J(d, "الف", s)["start"] for s in (self.a, self.b, c)], [SAT, SUN, MON])
        self.assertEqual(self.P(d, "الف")["finish"], THU)           # رنگ هر روز همان ۴ مترِ دیروزِ پرداخت را می‌گیرد

    def test_295_the_faster_stage_does_not_wait_for_people_it_does_not_need(self):
        self.workers(3)
        x, y = self.proj("یک"), self.proj("دو")
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, MON), [("یک", self.b.name, 4.0), ("دو", self.a.name, 8.0)])

    # ---------- کارگاهِ کم‌نفر با کارهای ریز ----------

    def tight(self, seed):
        """چهار مرحله، دو یا سه کارگر، هشت پروژه با کارهای ریز و نیمه‌کاره. چیزی که باید درست بماند وارسیِ Kit.check است:
        هیچ روزی نفرِ آزاد و ایستگاهِ آزاد و کارِ آماده با هم نمانَد."""
        r = random.Random(seed)
        c = self.stage("رنگ آزمایشی", 3, hpm=r.choice([0.5, 1, 2]))
        e = self.stage("بسته‌بندی آزمایشی", 4, hpm=r.choice([0.25, 0.5]))
        self.workers(r.choice([2, 3]))
        if r.random() < 0.5:
            Station.objects.create(name="کابین", stages=[self.a.name, c.name], crew=r.choice([1, 2]), order=0)
        stages = [self.a, self.b, c, e]
        for i in range(8):
            chosen = sorted(r.sample(stages, r.randint(1, 4)), key=lambda s: s.order)
            areas = {s: r.choice([1.5, 3, 4.5, 6, 10]) for s in chosen}
            p = self.proj(f"پ{i}", stages=areas, due_date=r.choice([None, SAT + W(r.randint(2, 20))]))
            done = 1.0
            for s in chosen:                                           # پیشرفتِ واقعی: هر مرحله تا جایی که قبلی رفته
                done = round(done * r.choice([0, 0.5, 1, 1]), 2)
                if done:
                    self.report(p, s, round(areas[s] * done, 2), PAST + W(r.randint(0, 20)))
        if r.random() < 0.5:
            self.leave(r.choice(NAMES[:2]), SAT + W(r.randint(0, 5)), hours=r.choice([None, 3]) or "")
        if r.random() < 0.5:
            self.overtime(SAT + W(r.randint(0, 6)), r.choice([2, 4]), r.choice([None, 1]))
        for today in (SAT, TUE, THU):
            d = self.plan(today)
            self.assertFalse(d["totals"]["unfinished"])
        return d

    def test_296_a_small_busy_workshop_1(self):
        self.tight(11)

    def test_297_a_small_busy_workshop_2(self):
        self.tight(12)

    def test_298_a_small_busy_workshop_3(self):
        self.tight(13)

    def test_299_a_small_busy_workshop_4(self):
        self.tight(14)

    def test_300_a_small_busy_workshop_5(self):
        self.tight(15)

    def test_301_a_small_busy_workshop_6(self):
        self.tight(16)

    def test_302_a_small_busy_workshop_7(self):
        self.tight(17)

    def test_303_a_small_busy_workshop_8(self):
        self.tight(18)
