"""سناریوهای تازهٔ برنامه‌ریزی تولید — ایستگاه‌ها، نفرات و مدتِ کار (۵۳ تا ۱۰۲)."""
import time

from rest_framework.exceptions import ValidationError

from .models import PlanTask
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit


class Stations(Kit):
    def rows(self, *rows):
        planning.save_stations(list(rows))

    def test_053_one_station_doing_two_stages_shares_its_day(self):
        Station.objects.create(name="خط", stages=[self.a.name, self.b.name], crew=1, order=0)
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.lines(d, SUN), [("الف", self.a.name, 8.0)])
        self.assertEqual(self.P(d, "الف")["finish"], SAT2)

    def test_054_a_two_person_station_is_twice_as_fast(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=2, order=0)
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 16.0)])
        self.assertEqual(self.J(d, "الف", self.b)["start"], SUN)

    def test_055_a_station_set_for_more_people_than_the_workshop_has(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=5, order=0)
        self.proj("الف", area=40)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 16.0)])       # دو نفر هست، نه پنج
        self.assertTrue(any("کابین" in w for w in d["warnings"]), d["warnings"])

    def test_056_the_same_person_written_twice_in_a_station_is_one_person(self):
        self.rows({"name": "کابین", "stages": [self.a.name], "people": ["علی", "علی"]})
        self.proj("الف")
        d = self.plan()
        self.assertEqual(Station.objects.get().people, ["علی"])
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 8.0)])

    def test_057_a_station_person_who_left_the_workshop_is_not_counted(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        Employee.objects.filter(name="رضا").update(active=False)
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 8.0)])
        self.assertEqual(next(s for s in d["stations"] if s["name"] == "کابین")["crew"], 1)

    def test_058_someone_in_two_stations_away_stops_both(self):
        Station.objects.create(name="یک", stages=[self.a.name], people=["علی"], order=0)
        Station.objects.create(name="دو", stages=[self.b.name], people=["علی"], order=1)
        self.proj("الف", area=40)
        self.leave("علی", SUN)
        self.assertEqual(self.lines(self.plan(), SUN), [])

    def test_059_a_switched_off_station_hands_its_stage_back(self):
        Station.objects.create(name="قدیمی", stages=[self.a.name], crew=3, active=False, order=0)
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["stationName"], self.a.name)
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 8.0)])

    def test_060_one_stage_in_two_stations_is_refused(self):
        with self.assertRaises(ValidationError):
            self.rows({"name": "یک", "stages": [self.a.name]}, {"name": "دو", "stages": [self.a.name]})
        self.assertFalse(Station.objects.exists())

    def test_061_a_station_without_a_name_is_refused(self):
        with self.assertRaises(ValidationError):
            self.rows({"name": "  ", "stages": [self.a.name]})

    def test_062_two_stations_with_one_name_are_refused(self):
        with self.assertRaises(ValidationError):
            self.rows({"name": "یک", "stages": [self.a.name]}, {"name": "یک", "stages": [self.b.name]})

    def test_063_rows_that_are_not_stations_are_refused_cleanly(self):
        for bad in (["x"], [None], [5], "abc", {"name": "یک"}):
            with self.assertRaises(ValidationError):
                planning.save_stations(bad)
        self.assertEqual(self.post("plan-stations", {"stations": ["x"]}).status_code, 400)

    def test_064_station_crew_limits(self):
        self.rows({"name": "یک", "stages": [self.a.name], "crew": 0})
        self.assertEqual(Station.objects.get().crew, 1)
        for bad in (51, -3):
            with self.assertRaises(ValidationError):
                self.rows({"name": "یک", "stages": [self.a.name], "crew": bad})

    def test_065_unknown_people_and_stages_are_dropped(self):
        self.rows({"name": "یک", "stages": [self.a.name, "نیست"], "people": ["علی", "غریبه"]})
        st = Station.objects.get()
        self.assertEqual((st.stages, st.people), ([self.a.name], ["علی"]))

    def test_066_a_helper_station_runs_a_second_job_of_the_same_stage(self):
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=5)
        one, two = self.proj("یک"), self.proj("دو")
        planning.set_order([one.pk, two.pk])
        self.task(two, self.a, station=str(helper.pk))
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 8.0), ("دو", self.a.name, 8.0)])
        self.assertEqual(self.J(d, "دو", self.a)["stationName"], "کمکی")

    def test_067_a_station_whose_job_is_finished_can_be_removed(self):
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=5)
        p = self.proj("الف")
        self.task(p, self.a, station=str(helper.pk))
        self.report(p, self.a, 16, PAST)
        self.rows()
        self.assertFalse(Station.objects.exists())

    def test_068_a_station_used_only_by_a_closed_project_can_be_removed(self):
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=5)
        p = self.proj("الف")
        self.task(p, self.a, station=str(helper.pk))
        Project.objects.filter(pk=p.pk).update(closed_at=SAT)
        self.rows()
        self.assertFalse(Station.objects.exists())

    def test_069_a_stage_taken_out_of_the_project_no_longer_holds_its_station(self):
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=5)
        p = self.proj("الف")
        self.task(p, self.b, station=str(helper.pk))
        ProjectStage.objects.filter(project=p, name=self.b.name).delete()
        self.rows()                                                   # کاری که دیگر در برنامه نیست جلوی حذف را نمی‌گیرد
        self.assertFalse(Station.objects.exists())

    def test_070_a_decision_for_a_stage_the_project_does_not_have_is_refused(self):
        c = self.stage("رنگ آزمایشی", 3)
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=5)
        p = self.proj("الف")
        for body in ({"station": str(helper.pk)}, {"notBefore": MON.isoformat()}, {"crew": 2}):
            with self.assertRaises(ValidationError):
                self.task(p, c, **body)
        self.assertFalse(PlanTask.objects.exists())

    def test_071_two_people_on_one_job(self):
        p = self.proj("الف")
        self.task(p, self.a, crew=2)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 16.0)])
        self.assertEqual((self.J(d, "الف", self.a)["crew"], self.J(d, "الف", self.a)["crewManual"]), (2, True))

    def test_072_clearing_the_crew_goes_back_to_the_station(self):
        p = self.proj("الف")
        self.task(p, self.a, crew=2)
        self.task(p, self.a, crew=None)
        self.assertFalse(PlanTask.objects.exists())
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 8.0)])

    def test_073_changing_the_crew_recomputes_a_manual_duration(self):
        p = self.proj("الف")
        self.task(p, self.a, days=4)
        self.task(p, self.a, crew=2)
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["manual"], j["daily"]), (False, 16.0))

    def test_074_a_crew_bigger_than_the_whole_workshop_is_pointed_out(self):
        p = self.proj("الف", area=80)
        self.task(p, self.a, crew=10)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 16.0)])
        self.assertTrue(any("الف" in w and self.a.name in w for w in d["warnings"]), d["warnings"])

    def test_075_choosing_an_automatic_station_twice_makes_one_station(self):
        one, two = self.proj("یک"), self.proj("دو")
        sid = planning.STAGE_ID + self.b.name
        self.task(one, self.a, station=sid)
        self.task(two, self.a, station=sid)
        self.assertEqual(Station.objects.count(), 1)
        self.plan()

    def test_076_a_station_name_that_is_too_long_is_refused(self):
        with self.assertRaises(ValidationError):
            self.rows({"name": "ک" * 150, "stages": [self.a.name]})

    def test_077_one_person_put_on_a_job_of_a_two_person_station(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        p = self.proj("الف")
        self.task(p, self.a, crew=1)
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 8.0)])

    def test_078_stations_are_listed_in_line_order(self):
        Station.objects.create(name="ته خط", stages=[self.b.name], order=0)
        Station.objects.create(name="سر خط", stages=[self.a.name], order=5)
        self.assertEqual([s["name"] for s in self.plan()["stations"]], ["سر خط", "ته خط"])

    def test_079_named_people_decide_the_crew_not_the_number(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی"], crew=3, order=0)
        self.proj("الف")
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 8.0)])

    def test_080_switching_a_station_off_from_the_stations_page(self):
        st = Station.objects.create(name="کابین", stages=[self.a.name], crew=2, order=0)
        self.proj("الف")
        self.rows({"id": st.pk, "name": "کابین", "stages": [self.a.name], "crew": 2, "active": False})
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["stationName"], self.a.name)
        self.assertFalse(next(s for s in d["stations"] if s["name"] == "کابین")["active"])

    def test_081_the_list_order_is_the_station_order(self):
        x = Station.objects.create(name="یک", stages=[], order=0)
        y = Station.objects.create(name="دو", stages=[], order=1)
        self.rows({"id": y.pk, "name": "دو"}, {"id": x.pk, "name": "یک"})
        self.assertEqual(list(Station.objects.values_list("name", flat=True)), ["دو", "یک"])

    def test_082_the_stations_page_without_a_list(self):
        self.assertEqual(self.post("plan-stations", {}).status_code, 400)
        self.assertEqual(self.post("plan-stations", {"stations": "x"}).status_code, 400)


class Durations(Kit):
    def test_083_four_days_for_the_first_stage(self):
        p = self.proj("الف")
        self.task(p, self.a, days=4)
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["days"], j["daily"], j["finish"]), (4.0, 4.0, TUE))

    def test_084_half_a_day_for_a_job(self):
        p = self.proj("الف")
        self.task(p, self.a, days=0.5)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 16.0)])
        self.assertEqual(self.J(d, "الف", self.b)["start"], SUN)

    def test_085_a_duration_too_small_to_mean_anything_is_refused(self):
        p = self.proj("الف")
        with self.assertRaises(ValidationError):
            self.task(p, self.a, days=0.0000001)
        self.assertFalse(PlanTask.objects.exists())

    def test_086_not_a_number_and_infinity_are_refused(self):
        p = self.proj("الف")
        for bad in ("nan", "inf", "-inf", float("nan"), float("inf")):
            with self.assertRaises(ValidationError):
                self.task(p, self.a, days=bad)
        self.assertFalse(PlanTask.objects.exists())

    def test_087_clearing_the_days_goes_back_to_the_suggestion(self):
        p = self.proj("الف")
        self.task(p, self.a, days=4)
        self.task(p, self.a, days=None)
        self.assertFalse(PlanTask.objects.exists())
        self.assertFalse(self.J(self.plan(), "الف", self.a)["manual"])

    def test_088_start_and_finish_on_the_same_day(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=MON.isoformat(), finish=MON.isoformat())
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["start"], j["finish"]), (MON, MON))

    def test_089_impossible_finish_dates_are_refused(self):
        p = self.proj("الف")
        for end in (SAT, SUN + W(500)):
            with self.assertRaises(ValidationError):
                self.task(p, self.a, notBefore=SUN.isoformat(), finish=end.isoformat())
        self.assertFalse(PlanTask.objects.exists())

    def test_090_a_finish_day_needs_a_start_day(self):
        p = self.proj("الف")
        with self.assertRaises(ValidationError):
            self.task(p, self.a, finish=MON.isoformat())

    def test_091_a_bar_stretched_over_thursday_and_friday_ends_where_it_was_dropped(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=WED.isoformat(), finish=SAT2.isoformat())
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["start"], j["finish"]), (WED, SAT2))

    def test_092_a_bar_ending_on_a_friday_with_overtime(self):
        p = self.proj("الف")
        self.overtime(FRI, 8)
        self.task(p, self.a, notBefore=THU.isoformat(), finish=FRI.isoformat())
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["start"], j["finish"]), (THU, FRI))

    def test_093_a_finish_day_for_a_half_done_job(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, PAST)
        self.task(p, self.a, notBefore=SAT.isoformat(), finish=SUN.isoformat())
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["daily"], j["finish"]), (4.0, SUN))

    def test_094_a_stage_without_history_uses_its_time_weight(self):
        c = self.stage("رنگ آزمایشی", 3, history=False)
        WorkStage.objects.filter(pk=c.pk).update(time_weight=2)
        planning.clear_cache()
        self.proj("الف", stages={c: 20})
        d = self.plan()
        self.assertEqual(self.J(d, "الف", c)["daily"], 2.67)           # ۳ ساعت بر متر
        self.assertTrue(any(c.name in w and "تخمینی" in w for w in d["warnings"]))

    def test_095_a_manual_duration_silences_the_guess_warning(self):
        c = self.stage("رنگ آزمایشی", 3, history=False)
        p = self.proj("الف", stages={c: 20})
        self.task(p, c, days=2)
        self.assertFalse(any(c.name in w for w in self.plan()["warnings"]))

    def test_096_the_suggestion_stays_visible_next_to_a_manual_duration(self):
        p = self.proj("الف")
        self.task(p, self.a, days=8)
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["days"], j["suggestedDays"], j["manual"]), (8.0, 2.0, True))

    def test_097_a_stage_with_a_few_centimetres_is_not_a_job(self):
        self.proj("الف", stages={self.a: 0.03, self.b: 16})
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["status"], "done")
        self.assertEqual(self.J(d, "الف", self.b)["start"], SAT)

    def test_098_a_million_metres_does_not_hang_the_page(self):
        self.proj("الف", area=1000000)
        t = time.monotonic()
        d = self.plan()
        self.assertTrue(d["totals"]["unfinished"])
        self.assertLess(time.monotonic() - t, 5.0)

    def test_099_a_manual_speed_survives_a_bigger_job(self):
        p = self.proj("الف")
        self.task(p, self.a, days=2)
        ProjectStage.objects.filter(project=p, name=self.a.name).update(area=32)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["days"], 4.0)

    def test_100_a_finish_day_with_two_people_on_the_job(self):
        p = self.proj("الف")
        self.task(p, self.a, crew=2, notBefore=SAT.isoformat(), finish=SAT.isoformat())
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 16.0)])

    def test_101_days_typed_as_text_or_persian_digits(self):
        p = self.proj("الف")
        self.task(p, self.a, days="4")
        self.assertEqual(self.J(self.plan(), "الف", self.a)["daily"], 4.0)
        self.task(p, self.a, days="۲")
        self.assertEqual(self.J(self.plan(), "الف", self.a)["daily"], 8.0)

    def test_102_a_finish_day_on_a_holiday_week(self):
        p = self.proj("الف")
        self.holiday(SUN)
        self.holiday(MON)
        self.task(p, self.a, notBefore=SAT.isoformat(), finish=TUE.isoformat())
        j = self.J(self.plan(), "الف", self.a)
        self.assertEqual((j["start"], j["finish"], j["daily"]), (SAT, TUE, 8.0))
