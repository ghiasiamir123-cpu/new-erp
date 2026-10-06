"""سناریوهای تازهٔ برنامه‌ریزی تولید — توقف پروژه، گزارش‌های کار، ثبت برنامه و کارِ هر صبح (۱۵۹ تا ۲۱۷)."""
from rest_framework.exceptions import ValidationError

from .models import PlanBaselineLine, PlanCommit, PlanQueueSnapshot, PlanTask, User
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit


class Pauses(Kit):
    def pause(self, p, start=None, today=SAT, **kw):
        planning.pause_project({"project": p.pk, **({"start": start.isoformat()} if start else {}), **kw}, self.user, today=today)

    def resume(self, p, end=None, today=SAT, **kw):
        planning.resume_project({"project": p.pk, **({"end": end.isoformat()} if end else {}), **kw}, self.user, today=today)

    def test_159_pausing_today_takes_the_project_out(self):
        p = self.proj("الف")
        self.proj("ب")
        self.pause(p)
        d = self.plan()
        self.assertEqual((self.names(d), d["totals"]["paused"], [x["label"] for x in d["paused"]]), (["ب"], 1, ["الف"]))

    def test_160_a_pause_with_a_known_end_leaves_a_gap(self):
        p = self.proj("الف")
        self.pause(p, SUN)
        self.resume(p, WED)
        d = self.plan()
        self.assertEqual(self.worked(d, "الف", self.a), [SAT, WED])

    def test_161_days_of_a_pause_still_ahead_are_not_the_workshops_delay(self):
        p = self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.pause(p, SUN)
        self.resume(p, WED)
        x = self.P(self.plan(), "الف")
        self.assertEqual((x["pauseDays"], x["totalSlipDays"] - x["slipDays"]), (3, 3))

    def test_162_an_open_pause_starting_later_ends_the_plan_there(self):
        p = self.proj("الف")
        self.pause(p, MON)
        d = self.plan()
        self.assertEqual((d["totals"]["unfinished"], self.P(d, "الف")["finish"]), (False, None))
        self.assertEqual(self.worked(d, "الف", self.b), [SUN])

    def test_163_paused_and_resumed_the_same_day(self):
        p = self.proj("الف")
        self.pause(p)
        self.resume(p)
        d = self.plan()
        self.assertEqual((self.names(d), self.P(d, "الف")["start"], d["paused"]), (["الف"], SAT, []))

    def test_164_a_second_pause_may_follow_but_not_overlap(self):
        p = self.proj("الف")
        self.pause(p, MON)
        self.resume(p, THU)
        with self.assertRaises(ValidationError):
            self.pause(p, TUE)
        self.pause(p, THU)
        self.assertEqual(ProjectPause.objects.count(), 2)

    def test_165_what_cannot_be_paused(self):
        closed = self.proj("بسته", closed_at=SAT)
        shop = Project.objects.create(name="کار عمومی", general=True)
        for pk in (closed.pk, shop.pk, 999999, "abc", None):
            with self.assertRaises(ValidationError):
                planning.pause_project({"project": pk}, self.user, today=SAT)

    def test_166_deleting_a_pause_entered_by_mistake(self):
        p = self.proj("الف")
        r = self.post("plan-pause", {"project": p.pk})
        self.assertEqual(r.status_code, 200, r.content)
        pid = r.json()["paused"][0]["id"]
        r = self.post("plan-pause", {"remove": pid})
        self.assertEqual([x["name"] for x in r.json()["projects"]], ["الف"])

    def test_167_a_manual_place_that_passed_during_the_pause(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=MON.isoformat())
        self.pause(p)
        self.resume(p, TUE2, today=TUE2)
        j = self.J(self.plan(TUE2), "الف", self.a)
        self.assertEqual((j["placed"], j["start"]), (False, TUE2))

    def test_168_moving_the_due_date_of_a_project_without_one(self):
        p = self.proj("الف")
        self.pause(p)
        self.resume(p, WED, shiftDue=True)
        self.assertIsNone(Project.objects.get(pk=p.pk).due_date)

    def test_169_a_resume_day_still_ahead(self):
        p = self.proj("الف")
        self.proj("ب")
        self.pause(p)
        self.resume(p, WED)
        d = self.plan()
        self.assertEqual(self.P(d, "الف")["start"], WED)
        self.assertEqual(self.P(d, "ب")["start"], SAT)

    def test_170_a_long_note_and_no_reason(self):
        p = self.proj("الف")
        self.pause(p, note="ن" * 900)
        pz = ProjectPause.objects.get()
        self.assertEqual((len(pz.note), pz.reason), (300, "other"))

    def test_171_a_paused_project_gives_its_place_to_the_next(self):
        one, two = self.proj("یک"), self.proj("دو")
        planning.set_order([one.pk, two.pk])
        self.pause(one)
        self.assertEqual(self.lines(self.plan(), SAT), [("دو", self.a.name, 8.0)])

    def test_172_only_the_planner_can_pause(self):
        p = self.proj("الف")
        viewer = User.objects.create_user(username="viewer", password="x", name="بیننده", role="member", access=["production"])
        self.assertEqual(self.post("plan-pause", {"project": p.pk}, user=viewer).status_code, 403)
        self.assertFalse(ProjectPause.objects.exists())

    def test_173_a_project_closed_while_paused_is_not_listed(self):
        p = self.proj("الف")
        self.pause(p)
        Project.objects.filter(pk=p.pk).update(closed_at=SUN)
        d = self.plan()
        self.assertEqual((d["paused"], d["totals"]["paused"]), ([], 0))

    def test_174_a_pause_entered_late_clears_the_days_it_covers(self):
        p = self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.pause(p, SUN, today=TUE)                               # سه‌شنبه ثبت شد که از یکشنبه متوقف است
        self.proj("ب")
        d = self.plan(TUE)
        self.assertEqual([x["date"] for x in d["past"]], [SAT])

    def test_175_a_resume_entered_late(self):
        p = self.proj("الف")
        self.pause(p, SAT)
        self.resume(p, SUN, today=TUE)
        d = self.plan(TUE)
        self.assertEqual((self.P(d, "الف")["start"], self.P(d, "الف")["pauseDays"]), (TUE, 0))

    def test_176_two_paused_one_resumed(self):
        one, two = self.proj("یک"), self.proj("دو")
        self.pause(one)
        self.pause(two)
        self.resume(two)
        d = self.plan()
        self.assertEqual((self.names(d), [x["label"] for x in d["paused"]]), (["دو"], ["یک"]))

    def test_177_every_reason_is_accepted(self):
        for i, (key, _) in enumerate(ProjectPause.Reason.choices):
            self.pause(self.proj(f"پ{i}"), reason=key)
        self.assertEqual(len(self.plan()["paused"]), len(ProjectPause.Reason.choices))

    def test_178_resuming_before_the_pause_started_is_refused(self):
        p = self.proj("الف")
        self.pause(p, WED)
        with self.assertRaises(ValidationError):
            self.resume(p, MON)
        self.assertIsNone(ProjectPause.objects.get().end)


class Progress(Kit):
    def test_179_a_later_stage_reported_ahead_of_the_one_before(self):
        p = self.proj("الف")
        self.report(p, self.b, 8, PAST)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["remaining"], self.J(d, "الف", self.b)["remaining"]), (8.0, 8.0))

    def test_180_a_day_spent_on_workshop_chores_is_a_day_used(self):
        self.proj("الف")
        shop = Project.objects.create(name="کار عمومی", general=True)
        rep = DailyReport.objects.create(date=SAT, shift="صبح", supervisor=self.user, supervisor_name="م", status="approved")
        ReportItem.objects.create(report=rep, employee="علی", project=shop, activity="نظافت", hours=16)
        self.assertEqual(self.plan()["start"], SUN)

    def test_181_a_report_dated_tomorrow(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, SUN)
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["remaining"], 8.0)

    def test_182_deleting_a_report_brings_the_work_back(self):
        p = self.proj("الف")
        rep = self.report(p, self.a, 16, PAST)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["remaining"], 0.0)
        rep.delete()
        self.assertEqual(self.J(self.plan(), "الف", self.a)["remaining"], 16.0)

    def test_183_three_centimetres_short_is_finished(self):
        p = self.proj("الف")
        self.report(p, self.a, 15.97, PAST)
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["remaining"], j["status"]), (0.0, "done"))

    def test_184_a_stage_made_smaller_than_what_is_done(self):
        p = self.proj("الف")
        self.report(p, self.a, 10, PAST)
        ProjectStage.objects.filter(project=p, name=self.a.name).update(area=8)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["remaining"], 0.0)

    def test_185_a_finished_stage_made_bigger(self):
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        ProjectStage.objects.filter(project=p, name=self.a.name).update(area=24)
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["remaining"], j["status"]), (8.0, "doing"))

    def test_186_a_stage_added_to_a_running_project(self):
        c = self.stage("رنگ آزمایشی", 3)
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        ProjectStage.objects.create(project=p, name=c.name, area=10, order=0)
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.a.name, self.b.name, c.name])
        self.assertEqual(self.J(d, "الف", c)["start"], SUN)

    def test_187_ticking_the_last_stage_done_finishes_the_ones_before(self):
        p = self.proj("الف")
        self.proj("ب")
        ProjectStage.objects.filter(project=p, name=self.b.name).update(done=True)
        d = self.plan()
        self.assertFalse([ln for x in d["days"] for ln in x["lines"] if ln["project"] == "الف"])

    def test_188_a_project_that_only_has_the_second_stage(self):
        self.proj("الف", stages=[self.b])
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SAT)

    def test_189_the_line_order_wins_over_the_order_inside_the_project(self):
        self.proj("الف", stages=[self.b, self.a])
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.a.name, self.b.name])
        self.assertEqual(self.J(d, "الف", self.b)["start"], SUN)

    def test_190_yesterdays_work_is_in_the_history(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, SAT)
        d = self.plan(SUN)
        self.assertEqual([(x["date"], [(ln["project"], ln["area"]) for ln in x["lines"]]) for x in d["history"]
                          if x["date"] >= SAT], [(SAT, [("الف", 8.0)])])

    def test_191_hours_spent_come_from_approved_reports(self):
        p = self.proj("الف")
        self.report(p, self.a, 4, PAST, hours=5)
        self.report(p, self.a, 4, PAST + W(1), hours=3, who="رضا")
        self.assertEqual(self.P(self.plan(), "الف")["spentHours"], 8.0)

    def test_192_when_the_real_work_started_and_ended(self):
        p = self.proj("الف")
        self.report(p, self.a, 4, PAST)
        self.report(p, self.a, 4, PAST + W(3))
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["actualStart"], j["actualEnd"]), (PAST, PAST + W(3)))

    def test_193_work_waiting_in_front_of_a_station(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, PAST)
        d = self.plan()
        j = self.J(d, "الف", self.b)
        self.assertEqual((j["ready"], j["status"]), (8.0, "ready"))
        q = next(q for q in d["queues"] if q["name"] == self.b.name)
        self.assertEqual((q["ready"], q["jobs"]), (8.0, 1))

    def test_194_what_each_job_says_about_itself(self):
        p = self.proj("الف")
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["status"], self.J(d, "الف", self.b)["status"]), ("ready", "waiting"))
        self.report(p, self.a, 4, PAST)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["status"], self.J(d, "الف", self.b)["status"]), ("doing", "ready"))

    def test_195_two_reports_of_one_day_add_up(self):
        p = self.proj("الف")
        self.report(p, self.a, 3, PAST)
        self.report(p, self.a, 5, PAST)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["remaining"], 8.0)

    def test_196_far_more_reported_on_the_last_stage_than_planned(self):
        p = self.proj("الف")
        self.proj("ب")
        self.report(p, self.b, 30, PAST)
        d = self.plan()
        self.assertFalse([ln for x in d["days"] for ln in x["lines"] if ln["project"] == "الف"])

    def test_197_a_project_with_a_code_is_labelled_with_it(self):
        self.proj("ویلای لواسان", code="CC05-D1001", short_name="لواسان")
        d = self.plan()
        self.assertEqual(d["projects"][0]["label"], "CC05-D1001 (لواسان)")
        self.assertEqual(self.lines(d, SAT)[0][0], "CC05-D1001 (لواسان)")


class Baseline(Kit):
    def do(self, d, day, part=1.0):
        """کارِ برنامهٔ یک روز را همان‌طور (یا کسری از آن) گزارش و تأیید می‌کند."""
        x = self.day(d, day)
        for ln in (x["lines"] if x else []):
            self.report(Project.objects.get(pk=int(ln["projectId"])), WorkStage.objects.get(name=ln["stage"]),
                        round(ln["area"] * part, 2), day)

    def test_198_right_after_committing_nothing_is_late(self):
        self.proj("الف")
        planning.commit(self.user, today=SAT)
        p = self.P(self.plan(), "الف")
        self.assertEqual((p["slipDays"], p["baselineStart"], p["baselineFinish"]), (0, SAT, WED))
        self.assertEqual([j["slipDays"] for j in p["jobs"]], [0, 0])

    def test_199_a_holiday_added_after_committing_shows_as_delay(self):
        self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.holiday(MON)
        d = self.plan()
        self.assertGreater(self.P(d, "الف")["slipDays"], 0)
        self.assertEqual(self.J(d, "الف", self.b)["status"], "late")
        self.assertEqual(d["totals"]["behind"], 1)

    def test_200_overtime_added_after_committing_puts_the_plan_ahead(self):
        self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.overtime(MON, 8)
        d = self.plan()
        self.assertLess(self.P(d, "الف")["slipDays"], 0)
        self.assertEqual(d["totals"]["behind"], 0)

    def test_201_the_morning_job_on_a_friday(self):
        self.proj("الف")
        self.assertEqual(planning.daily(today=FRI), ["queues"])
        self.assertFalse(PlanCommit.objects.exists())
        self.assertTrue(PlanQueueSnapshot.objects.filter(date=FRI).exists())

    def test_202_a_saturday_holiday_moves_the_weekly_baseline_to_sunday(self):
        self.proj("الف")
        self.holiday(SAT)
        self.assertEqual(planning.daily(today=SAT), ["queues"])
        self.assertEqual(planning.daily(today=SUN), ["week", "queues"])
        self.assertEqual(PlanCommit.objects.get().by_name, planning.AUTO_NAME)

    def test_203_the_first_morning_job_in_the_middle_of_a_week(self):
        self.proj("الف")
        self.assertEqual(planning.daily(today=TUE), ["week", "queues"])
        self.assertEqual(PlanBaselineLine.objects.order_by("date").first().date, TUE)

    def test_204_a_weekday_morning_refreshes_only_that_day(self):
        self.proj("الف", area=40)
        planning.commit(self.user, today=SAT)
        before = {d: float(a) for d, a in PlanBaselineLine.objects.filter(stage=self.a.name).values_list("date", "area")}
        self.leave("علی", SAT, WED)
        self.leave("رضا", SUN)
        self.assertEqual(planning.daily(today=SUN), ["today", "queues"])
        after = {d: float(a) for d, a in PlanBaselineLine.objects.filter(stage=self.a.name).values_list("date", "area")}
        self.assertNotIn(SUN, after)                                # یکشنبه کسی نیست
        self.assertEqual({d: a for d, a in after.items() if d != SUN}, {d: a for d, a in before.items() if d != SUN})

    def test_205_the_morning_job_keeps_one_snapshot_per_station_per_day(self):
        self.proj("الف")
        for _ in range(3):
            planning.daily(today=SAT)
        self.assertEqual(PlanQueueSnapshot.objects.filter(date=SAT).count(), 2)

    def test_206_a_long_commit_note(self):
        self.proj("الف")
        planning.commit(self.user, "ی" * 900, today=SAT)
        c = PlanCommit.objects.get()
        self.assertEqual((len(c.note), c.by_name), (300, "مدیر"))

    def test_207_half_of_the_days_plan_done_is_fifty_percent(self):
        self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.do(self.plan(), SAT, 0.5)
        d = self.plan(SUN)
        self.assertEqual((d["past"][0]["percent"], d["deviation"]["avgPercent"]), (50.0, 50.0))

    def test_208_doing_more_than_the_plan_is_not_more_than_a_hundred(self):
        p = self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.report(p, self.a, 12, SAT)
        self.assertEqual(self.plan(SUN)["past"][0]["percent"], 100.0)

    def test_209_a_job_finished_early_says_so(self):
        p = self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.report(p, self.a, 16, SAT)
        j = self.J(self.plan(SUN), "الف", self.a)
        self.assertEqual((j["remaining"], j["doneSlip"]), (0.0, -1))

    def test_210_the_past_of_a_project_closed_since(self):
        p = self.proj("الف")
        self.proj("ب")
        planning.commit(self.user, today=SAT)
        Project.objects.filter(pk=p.pk).update(closed_at=SUN)
        d = self.plan(SUN)
        self.assertIn("الف", [ln["project"] for x in d["past"] for ln in x["lines"]])

    def test_211_committing_an_empty_plan(self):
        planning.commit(self.user, today=SAT)
        d = self.plan()
        self.assertEqual((d["baseline"]["by"], PlanBaselineLine.objects.count()), ("مدیر", 0))

    def test_212_the_comparison_goes_back_forty_five_days(self):
        self.proj("الف", area=400)
        planning.commit(self.user, today=SAT)
        d = self.plan(SAT + W(70))
        self.assertTrue(d["past"])
        self.assertGreaterEqual(min(x["date"] for x in d["past"]), SAT + W(70 - planning.PAST_DAYS))

    def test_213_committing_after_today_is_fully_reported_keeps_todays_plan(self):
        p = self.proj("الف")
        planning.commit(self.user, today=SAT)
        self.report(p, self.a, 8, SAT, hours=16)
        planning.commit(self.user, today=SAT)
        self.assertEqual(float(PlanBaselineLine.objects.get(date=SAT).area), 8.0)
        self.assertEqual(self.plan(SUN)["past"][0]["percent"], 100.0)

    def test_214_the_queue_of_a_station_over_the_days(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, PAST)
        planning.daily(today=SAT)
        planning.daily(today=SUN)
        q = next(q for q in self.plan(SUN)["queues"] if q["name"] == self.b.name)
        self.assertEqual([(t["date"], t["ready"]) for t in q["trend"]], [(SAT, 8.0), (SUN, 8.0)])

    def test_215_doing_exactly_the_plan_every_day_ends_on_the_planned_day(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24)
        first = self.plan()
        planning.commit(self.user, today=SAT)
        finish = {p["name"]: p["finish"] for p in first["projects"]}
        day = SAT
        while day <= max(finish.values()):
            d = self.plan(day)
            self.assertEqual({p["name"]: p["finish"] for p in d["projects"]},
                             {n: f for n, f in finish.items() if n in self.names(d)}, f"صبحِ {day}")
            self.assertTrue(all((p["slipDays"] or 0) == 0 for p in d["projects"]), f"صبحِ {day}")
            self.do(d, day)
            day += W(1)
        d = self.plan(day)
        self.assertEqual(d["projects"], [])
        self.assertTrue(all(x["percent"] == 100.0 for x in d["past"]), [(x["date"], x["percent"]) for x in d["past"]])
        self.assertEqual(d["deviation"]["avgPercent"], 100.0)

    def test_216_doing_half_the_plan_every_day_only_ever_moves_the_end_later(self):
        self.proj("الف", area=24)
        planning.commit(self.user, today=SAT)
        last, day = None, SAT
        for _ in range(8):
            d = self.plan(day)
            if not d["projects"]:
                break
            finish = self.P(d, "الف")["finish"]
            if last:
                self.assertGreaterEqual(finish, last)
            last = finish
            self.do(d, day, 0.5)
            day += W(1)
        self.assertGreater(last, WED)

    def test_217_doing_exactly_the_plan_with_drying_and_a_weekend(self):
        WorkStage.objects.filter(pk=self.a.pk).update(wait_hours=24)
        c = self.stage("رنگ آزمایشی", 3, wait=40)
        self.proj("الف", area=20, stages=[self.a, self.b, c])
        first = self.plan(TUE)
        finish = self.P(first, "الف")["finish"]
        day = TUE
        while day <= finish:
            d = self.plan(day)
            self.assertEqual(self.P(d, "الف")["finish"], finish, f"صبحِ {day}")
            self.do(d, day)
            day += W(1)
        self.assertEqual(self.plan(day)["projects"], [])
