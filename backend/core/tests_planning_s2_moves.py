"""سناریوهای تازهٔ برنامه‌ریزی تولید — جای دستی و کشیدنِ نوارها، «با هم بردن»، خشک شدن (۱۰۳ تا ۱۵۸)."""
from rest_framework.exceptions import ValidationError

from .models import PlanTask
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit


def held(project, stage):
    t = PlanTask.objects.filter(project=project, stage=stage.name).first()
    return t.not_before if t else None


class Moves(Kit):
    def three(self, name="الف", **kw):
        self.c = getattr(self, "c", None) or self.stage("رنگ آزمایشی", 3)
        return self.proj(name, stages=[self.a, self.b, self.c], **kw)

    def test_103_a_later_stage_put_on_a_later_day(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=TUE.isoformat())
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.J(d, "الف", self.b)["start"]), (SAT, TUE))

    def test_104_moving_the_first_stage_later_takes_the_next_with_it(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=MON.isoformat())
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.J(d, "الف", self.b)["start"]), (MON, TUE))

    def test_105_a_stage_put_before_its_work_exists_waits_for_it(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=SAT.isoformat())
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SUN)

    def test_106_dragging_a_stage_later_leaves_the_one_before_alone(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=WED.isoformat(), pull=True)
        self.assertEqual((held(p, self.a), held(p, self.b)), (None, WED))
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], WED)

    def test_107_dragging_a_stage_onto_the_first_day_lands_on_the_first_possible_day(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=SAT.isoformat(), pull=True)
        self.assertEqual(held(p, self.b), SUN)

    def test_108_dragging_onto_a_holiday_lands_on_the_next_working_day(self):
        p = self.proj("الف")
        self.holiday(MON)
        self.task(p, self.b, notBefore=MON.isoformat(), pull=True)
        self.assertEqual(held(p, self.b), TUE)

    def test_109_dragging_onto_a_friday_lands_on_saturday(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=FRI.isoformat(), pull=True)
        self.assertEqual(held(p, self.b), SAT2)
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SAT2)

    def test_110_a_placed_job_takes_its_station_before_the_queue(self):
        one, two = self.proj("یک"), self.proj("دو")
        planning.set_order([one.pk, two.pk])
        self.task(two, self.a, notBefore=SAT.isoformat())
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "دو", self.a), 8.0)
        self.assertEqual(self.J(d, "یک", self.a)["start"], MON)

    def test_111_shifting_a_project_one_day(self):
        p = self.proj("الف")
        planning.shift_project({"project": p.pk, "days": 1}, self.user, today=SAT)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.J(d, "الف", self.b)["start"]), (SUN, MON))

    def test_112_a_shift_that_lands_on_a_friday(self):
        p = self.proj("الف")
        planning.shift_project({"project": p.pk, "days": 6}, self.user, today=SAT)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["start"], SAT2)

    def test_113_an_absurd_shift_is_refused_not_crashed(self):
        p = self.proj("الف")
        for days in (99999999, -99999999, 5000):
            with self.assertRaises(ValidationError):
                planning.shift_project({"project": p.pk, "days": days}, self.user, today=SAT)
        self.assertEqual(self.post("plan-shift", {"project": p.pk, "days": 99999999}).status_code, 400)
        self.assertFalse(PlanTask.objects.exists())

    def test_114_shifting_what_is_not_in_the_plan(self):
        p = self.proj("الف")
        planning.pause_project({"project": p.pk}, self.user, today=SAT)
        for pk in (p.pk, 999999, "abc", None):
            with self.assertRaises(ValidationError):
                planning.shift_project({"project": pk, "days": 2}, self.user, today=SAT)

    def test_115_two_shifts_add_up(self):
        p = self.proj("الف")
        for _ in range(2):
            planning.shift_project({"project": p.pk, "days": 1}, self.user, today=SAT)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["start"], MON)

    def test_116_taking_a_manual_place_away(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=WED.isoformat())
        self.task(p, self.a, notBefore=None)
        self.assertFalse(PlanTask.objects.exists())
        self.assertEqual(self.J(self.plan(), "الف", self.a)["start"], SAT)

    def test_117_a_start_day_months_ahead(self):
        p = self.proj("الف")
        far = SAT + W(120)
        self.task(p, self.a, notBefore=far.isoformat())
        d = self.plan()
        self.assertFalse(d["totals"]["unfinished"])
        self.assertGreaterEqual(self.J(d, "الف", self.a)["start"], far)

    def test_118_a_start_day_in_the_year_9999_is_refused(self):
        p = self.proj("الف")
        for body in ({"notBefore": "9999-12-31", "pull": True}, {"notBefore": "9999-12-31"},
                     {"notBefore": "2090-01-01", "pull": True}):
            with self.assertRaises(ValidationError):
                self.task(p, self.b, **body)
        self.assertFalse(PlanTask.objects.exists())

    def test_119_holding_a_first_stage_back_frees_its_station_meanwhile(self):
        one, two = self.proj("یک"), self.proj("دو")
        planning.set_order([one.pk, two.pk])
        self.task(one, self.a, notBefore=WED.isoformat())
        d = self.plan()
        self.assertEqual((self.J(d, "دو", self.a)["start"], self.J(d, "یک", self.a)["start"]), (SAT, WED))

    def test_120_dragging_a_stage_earlier_brings_the_held_stage_before_it(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=WED.isoformat())
        self.task(p, self.b, notBefore=MON.isoformat(), pull=True)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.J(d, "الف", self.b)["start"]), (SUN, MON))

    def test_121_dragging_earlier_cannot_beat_the_drying_time(self):
        WorkStage.objects.filter(pk=self.a.pk).update(wait_hours=24)
        p = self.proj("الف")
        self.task(p, self.b, notBefore=SUN.isoformat(), pull=True)
        self.assertEqual(held(p, self.b), MON)
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], MON)

    def test_122_dragging_the_third_stage_earlier_brings_both_before_it(self):
        p = self.three()
        self.task(p, self.a, notBefore=WED.isoformat())
        self.task(p, self.c, notBefore=TUE.isoformat(), pull=True)
        d = self.plan()
        self.assertEqual([self.J(d, "الف", s)["start"] for s in (self.a, self.b, self.c)], [SUN, MON, TUE])

    def test_123_moving_a_stage_later_keeps_the_gap_to_the_next_one(self):
        p = self.three()
        self.task(p, self.a, notBefore=SAT.isoformat())
        self.task(p, self.b, notBefore=SUN.isoformat())
        self.task(p, self.c, notBefore=MON.isoformat())
        self.task(p, self.b, notBefore=TUE.isoformat(), pull=True)
        self.assertEqual((held(p, self.b), held(p, self.c)), (TUE, WED))
        d = self.plan()
        self.assertEqual([self.J(d, "الف", s)["start"] for s in (self.a, self.b, self.c)], [SAT, TUE, WED])

    def test_124_a_start_day_already_gone_is_no_start_day(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=PAST.isoformat())
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["placed"], j["start"]), (False, SAT))

    def test_125_three_placed_jobs_but_two_workers(self):
        c = self.stage("رنگ آزمایشی", 3)
        x, y, z = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b]), self.proj("سه", stages=[c])
        planning.set_order([x.pk, y.pk, z.pk])
        for p, s in ((x, self.a), (y, self.b), (z, c)):
            self.task(p, s, notBefore=SAT.isoformat())
        d = self.plan()
        self.assertEqual(len(self.lines(d, SAT)), 2)
        self.assertEqual(self.J(d, "سه", c)["start"], MON)

    def test_126_a_start_day_on_a_finished_job_changes_nothing(self):
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        self.task(p, self.a, notBefore=WED.isoformat())
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SAT)

    def test_127_shifting_back_a_project_that_is_half_done(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, SAT)
        planning.shift_project({"project": p.pk, "days": -3}, self.user, today=SUN)
        d = self.plan(SUN)
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.J(d, "الف", self.b)["start"]), (SUN, SUN))

    def test_128_dragging_onto_today_when_today_is_already_reported(self):
        p = self.proj("الف")
        self.report(p, self.a, 4, SAT, hours=16)                   # امروز کامل گزارش شده
        self.task(p, self.b, notBefore=SAT.isoformat(), pull=True)
        self.assertEqual(held(p, self.b), SUN)

    def test_129_days_of_a_shift_typed_as_text(self):
        p = self.proj("الف")
        self.assertEqual(self.post("plan-shift", {"project": str(p.pk), "days": "2"}).status_code, 200)

    def test_130_dragging_a_job_whose_work_is_already_there(self):
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        self.task(p, self.b, notBefore=MON.isoformat(), pull=True)
        self.assertEqual((held(p, self.a), held(p, self.b)), (None, MON))
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], MON)


class Together(Kit):
    def setUp(self):
        super().setUp()
        self.one, self.two = self.proj("یک"), self.proj("دو")
        planning.set_order([self.one.pk, self.two.pk])

    def batch(self, project, stage):
        t = PlanTask.objects.filter(project=project, stage=stage.name).first()
        return t.batch if t else None

    def test_131_two_projects_go_to_the_next_stage_together(self):
        self.task(self.one, self.b, together=[str(self.two.pk)])
        d = self.plan()
        self.assertEqual(self.J(d, "یک", self.b)["start"], WED)        # آسترِ «دو» سه‌شنبه تمام می‌شود
        self.assertGreaterEqual(self.J(d, "دو", self.b)["start"], WED)
        self.assertEqual([x["label"] for x in self.J(d, "یک", self.b)["together"]], ["دو"])

    def test_132_three_projects_together(self):
        three = self.proj("سه")
        planning.set_order([self.one.pk, self.two.pk, three.pk])
        self.task(self.one, self.b, together=[str(self.two.pk), str(three.pk)])
        d = self.plan()
        self.assertEqual(self.J(d, "سه", self.a)["finish"], SAT2)
        self.assertEqual(min(self.J(d, n, self.b)["start"] for n in ("یک", "دو", "سه")), SUN2)

    def test_133_a_mate_that_is_already_ready_waits_for_the_other(self):
        self.report(self.two, self.a, 16, PAST)
        self.task(self.one, self.b, together=[str(self.two.pk)])
        d = self.plan()
        self.assertEqual(self.J(d, "یک", self.b)["start"], MON)
        self.assertGreaterEqual(self.J(d, "دو", self.b)["start"], MON)     # بی «با هم»، شنبه شروع می‌شد

    def test_134_a_paused_mate_does_not_hold_the_other(self):
        self.task(self.one, self.b, together=[str(self.two.pk)])
        planning.pause_project({"project": self.two.pk}, self.user, today=SAT)
        self.assertEqual(self.J(self.plan(), "یک", self.b)["start"], SUN)

    def test_135_a_mate_that_is_completely_done_does_not_hold_the_other(self):
        self.task(self.one, self.b, together=[str(self.two.pk)])
        self.report(self.two, self.a, 16, PAST)
        self.report(self.two, self.b, 16, PAST)
        self.assertEqual(self.J(self.plan(), "یک", self.b)["start"], SUN)

    def test_136_together_with_a_project_that_has_no_such_stage(self):
        other = self.proj("بی‌پرداخت", stages=[self.a])
        with self.assertRaises(ValidationError):
            self.task(self.one, self.b, together=[str(other.pk)])
        self.assertFalse(PlanTask.objects.exists())

    def test_137_together_with_a_closed_project(self):
        Project.objects.filter(pk=self.two.pk).update(closed_at=SAT)
        with self.assertRaises(ValidationError):
            self.task(self.one, self.b, together=[str(self.two.pk)])
        self.assertFalse(PlanTask.objects.exists())

    def test_138_together_with_itself_is_nothing(self):
        self.task(self.one, self.b, together=[str(self.one.pk)])
        self.assertFalse(PlanTask.objects.exists())

    def test_139_one_of_three_leaves_and_the_other_two_stay(self):
        three = self.proj("سه")
        self.task(self.one, self.b, together=[str(self.two.pk), str(three.pk)])
        self.task(three, self.b, together=[])
        self.assertEqual(self.batch(self.one, self.b), self.batch(self.two, self.b))
        self.assertIsNotNone(self.batch(self.one, self.b))
        self.assertIsNone(self.batch(three, self.b))

    def test_140_together_on_the_first_stage_starts_at_once(self):
        self.task(self.one, self.a, together=[str(self.two.pk)])
        self.assertEqual(self.J(self.plan(), "یک", self.a)["start"], SAT)

    def test_141_rubbish_in_the_together_list_is_ignored(self):
        self.task(self.one, self.b, together=["abc", "", None, "999999"])
        self.assertFalse(PlanTask.objects.exists())

    def test_142_a_placed_job_still_waits_for_its_mates(self):
        self.task(self.one, self.b, together=[str(self.two.pk)])
        self.task(self.one, self.b, notBefore=SUN.isoformat())
        self.assertEqual(self.J(self.plan(), "یک", self.b)["start"], WED)

    def test_143_two_stages_each_with_their_own_group(self):
        c = self.stage("رنگ آزمایشی", 3)
        for p in (self.one, self.two):
            ProjectStage.objects.create(project=p, name=c.name, area=16, order=2)
        self.task(self.one, self.b, together=[str(self.two.pk)])
        self.task(self.one, c, together=[str(self.two.pk)])
        d = self.plan()
        self.assertFalse(d["totals"]["unfinished"])
        self.assertTrue(self.J(d, "یک", c)["together"])

    def test_144_joining_two_pairs_leaves_nobody_in_a_group_of_one(self):
        three, four = self.proj("سه"), self.proj("چهار")
        self.task(self.one, self.b, together=[str(self.two.pk)])
        self.task(three, self.b, together=[str(four.pk)])
        self.task(self.one, self.b, together=[str(self.two.pk), str(three.pk)])
        n = self.batch(self.one, self.b)
        self.assertEqual((self.batch(self.two, self.b), self.batch(three, self.b)), (n, n))
        self.assertIsNone(self.batch(four, self.b))

    def test_145_dragging_a_job_that_goes_with_others(self):
        self.task(self.one, self.b, together=[str(self.two.pk)])
        self.task(self.one, self.b, notBefore=MON.isoformat(), pull=True)
        self.assertEqual(self.J(self.plan(), "یک", self.b)["start"], WED)

    def test_146_deleting_a_mate_project_frees_the_other(self):
        self.task(self.one, self.b, together=[str(self.two.pk)])
        self.two.delete()
        self.assertEqual(self.J(self.plan(), "یک", self.b)["start"], SUN)


class Drying(Kit):
    def wait(self, stage, hours):
        WorkStage.objects.filter(pk=stage.pk).update(wait_hours=hours)

    def test_147_a_day_of_drying_delays_the_next_stage_one_day(self):
        self.wait(self.a, 24)
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.worked(d, "الف", self.b), [MON, TUE, WED, THU, SAT2])

    def test_148_ten_hours_of_drying_is_over_by_the_morning(self):
        self.wait(self.a, 10)
        self.proj("الف")
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SUN)

    def test_149_where_a_drying_time_becomes_another_day(self):
        self.assertEqual([planning.dry_days(h) for h in (None, 0, 15, 16, 39, 40, 63, 64)], [0, 0, 0, 1, 1, 2, 2, 3])

    def test_150_three_days_of_drying(self):
        self.wait(self.a, 72)
        self.proj("الف")
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], WED)

    def test_151_friday_counts_as_drying_time(self):
        self.wait(self.a, 24)
        p = self.proj("الف", stages={self.a: 4, self.b: 4})
        self.task(p, self.a, notBefore=THU.isoformat())
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SAT2)

    def test_152_work_reported_yesterday_is_still_drying_today(self):
        self.wait(self.a, 48)
        p = self.proj("الف")
        self.report(p, self.a, 16, SUN)
        self.assertEqual(self.J(self.plan(MON), "الف", self.b)["start"], WED)

    def test_153_work_reported_long_ago_is_dry(self):
        self.wait(self.a, 48)
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        self.assertEqual(self.J(self.plan(MON), "الف", self.b)["start"], MON)

    def test_154_switching_the_drying_time_off(self):
        self.wait(self.a, 24)
        self.proj("الف")
        self.plan()
        self.wait(self.a, 0)
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], SUN)

    def test_155_the_job_says_how_long_it_dries(self):
        self.wait(self.a, 24)
        self.proj("الف")
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["waitHours"], j["dryDays"]), (24, 1))

    def test_156_drying_after_the_last_stage_does_not_move_the_finish(self):
        self.wait(self.b, 48)
        self.proj("الف")
        self.assertEqual(self.P(self.plan(), "الف")["finish"], WED)

    def test_157_this_mornings_work_dries_like_any_other(self):
        self.wait(self.a, 24)
        p = self.proj("الف")
        self.report(p, self.a, 8, SAT, hours=16)                   # امروز کامل گزارش شده؛ ۸ متر آستر
        d = self.plan()
        self.assertEqual((d["start"], self.J(d, "الف", self.b)["start"]), (SUN, MON))

    def test_158_half_dry_half_wet(self):
        self.wait(self.a, 48)
        p = self.proj("الف")
        self.report(p, self.a, 8, PAST)                            # خشک
        self.report(p, self.a, 8, SUN)                             # دیروز؛ هنوز خیس
        d = self.plan(MON)
        self.assertEqual(self.worked(d, "الف", self.b), [MON, TUE, WED, THU, SAT2])
        self.assertEqual(self.area(d, WED, "الف", self.b), 4.0)        # نیمهٔ دوم از چهارشنبه خشک است
