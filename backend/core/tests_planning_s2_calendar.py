"""سناریوهای تازهٔ برنامه‌ریزی تولید — تقویم، اضافه‌کاری، مرخصی و کارِ عمومی (۱ تا ۵۲).

هر تست رفتارِ درست را می‌خواهد و هر برنامه‌ای که می‌گیرد با planning_testkit.Kit.check وارسی می‌شود."""
from .models import PlanHoliday, PlanLeave, PlanOvertime
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit


class Calendar(Kit):
    def test_001_starting_on_a_thursday_gives_half_a_day(self):
        self.proj("الف")
        self.assertEqual(self.lines(self.plan(THU), THU), [("الف", self.a.name, 4.0)])

    def test_002_starting_on_a_friday_begins_on_saturday(self):
        self.proj("الف")
        d = self.plan(FRI)
        self.assertEqual((d["start"], d["days"][0]["date"], self.P(d, "الف")["start"]), (FRI, SAT2, SAT2))

    def test_003_overtime_on_a_normal_day_lengthens_it(self):
        self.proj("الف")
        self.overtime(SAT, 4)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 12.0)])
        self.assertEqual(self.area(d, SUN, "الف", self.a), 4.0)
        self.assertEqual(self.area(d, SUN, "الف", self.b), 4.0)

    def test_004_overtime_for_one_person_adds_only_that_person(self):
        self.proj("الف")
        self.overtime(SAT, 4, people=1)
        self.assertEqual(self.day(self.plan(), SAT)["pool"], 2.5)

    def test_005_friday_overtime_for_one_person_runs_one_persons_work(self):
        self.proj("الف", area=40)
        self.overtime(FRI, 8, people=1)
        x = self.day(self.plan(), FRI)
        self.assertEqual((x["pool"], x["present"]), (1.0, 2))
        self.assertTrue(x["lines"])
        self.assertLessEqual(x["used"], 1.0)

    def test_006_two_holidays_around_a_friday(self):
        self.proj("الف", area=40)
        self.holiday(THU)
        self.holiday(SAT2)
        d = self.plan()
        dates = [x["date"] for x in d["days"]]
        self.assertTrue(all(x not in dates for x in (THU, FRI, SAT2)))
        self.assertIn(SUN2, dates)

    def test_007_removing_a_holiday_gives_the_day_back(self):
        self.proj("الف", area=40)
        r = self.post("plan-holiday", {"date": MON.isoformat(), "title": "تعطیل"})
        hid = next(h["id"] for h in r.json()["holidays"] if h["date"] == MON.isoformat())
        self.assertEqual(self.lines(self.plan(), MON), [])
        self.assertEqual(self.post("plan-holiday", {"remove": hid}).status_code, 200)
        self.assertTrue(self.lines(self.plan(), MON))

    def test_008_overtime_on_a_holiday_thursday_is_only_the_overtime(self):
        self.proj("الف", area=40)
        self.holiday(THU)
        self.overtime(THU, 3)
        d = self.plan()
        x = self.day(d, THU)
        self.assertEqual((x["base"], x["overtime"]), (0.0, 3.0))
        self.assertEqual(self.area(d, THU, "الف", self.b), 1.5)        # ۴ متر در روز × ۳ ساعت از ۸

    def test_009_twelve_hours_of_friday_overtime_is_a_day_and_a_half(self):
        self.proj("الف", area=40)
        self.overtime(FRI, 12)
        self.assertEqual(self.area(self.plan(), FRI, "الف", self.b), 6.0)

    def test_010_today_is_a_holiday(self):
        self.proj("الف")
        self.holiday(SAT)
        d = self.plan()
        self.assertEqual((d["start"], d["days"][0]["date"]), (SAT, SUN))

    def test_011_old_overtime_is_not_listed(self):
        self.overtime(PAST, 4)
        self.overtime(MON, 4)
        self.assertEqual([o["date"] for o in self.plan()["overtime"]], [MON])

    def test_012_a_long_job_never_lands_on_an_official_holiday(self):
        self.proj("الف", area=480)
        d = self.plan()
        self.assertFalse(d["totals"]["unfinished"])
        off = set(PlanHoliday.objects.values_list("date", flat=True))
        self.assertTrue(off)
        self.assertFalse([x["date"] for x in d["days"] if x["date"] in off and x["lines"]])
        self.assertGreater(d["days"][-1]["date"], D(2027, 2, 11))      # از ۲۲ بهمن گذشته است

    def test_013_everyone_away_for_a_week(self):
        self.proj("الف")
        for n in ("علی", "رضا"):
            self.leave(n, SAT, THU)
        self.assertEqual(self.P(self.plan(), "الف")["start"], SAT2)

    def test_014_overtime_cannot_have_more_people_than_are_there(self):
        self.proj("الف")
        self.overtime(SAT, 4, people=10)
        self.assertEqual(self.day(self.plan(), SAT)["pool"], 3.0)

    def test_015_two_overtime_groups_on_one_day(self):
        self.proj("الف")
        self.overtime(SAT, 2)
        self.overtime(SAT, 4, people=1)
        x = self.day(self.plan(), SAT)
        self.assertEqual((x["overtime"], x["pool"]), (4.0, 3.0))

    def test_016_thursday_with_four_hours_of_overtime_is_a_full_day(self):
        self.proj("الف", area=40)
        self.overtime(THU, 4)
        d = self.plan()
        x = self.day(d, THU)
        self.assertEqual((x["base"], x["overtime"], x["pool"]), (4.0, 4.0, 2.0))
        self.assertEqual(self.area(d, THU, "الف", self.b), 4.0)

    def test_017_three_stations_but_only_two_workers(self):
        c = self.stage("رنگ آزمایشی", 3)
        x, y, z = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b]), self.proj("سه", stages=[c])
        planning.set_order([x.pk, y.pk, z.pk])
        d = self.plan()
        self.assertEqual(len(self.lines(d, SAT)), 2)
        self.assertEqual(self.J(d, "سه", c)["start"], MON)             # «یک» یکشنبه تمام می‌شود و یک نفر آزاد

    def test_018_work_reported_on_a_friday_counts(self):
        p = self.proj("الف")
        self.report(p, self.a, 8, FRI)
        d = self.plan(FRI)
        self.assertEqual((d["start"], self.J(d, "الف", self.a)["remaining"]), (SAT2, 8.0))

    def test_019_the_same_holiday_twice_is_one_holiday(self):
        self.holiday(MON, "یک")
        self.holiday(MON, "دو")
        self.assertEqual(list(PlanHoliday.objects.filter(date=MON).values_list("title", flat=True)), ["دو"])

    def test_020_half_an_hour_of_overtime(self):
        self.proj("الف", stages=[self.a])
        self.overtime(FRI, 0.5)
        self.assertEqual(self.lines(self.plan(FRI), FRI), [("الف", self.a.name, 0.5)])

    def test_021_friday_overtime_with_everyone_on_leave(self):
        self.proj("الف")
        self.overtime(FRI, 8)
        for n in ("علی", "رضا"):
            self.leave(n, FRI)
        self.assertEqual(self.lines(self.plan(FRI), FRI), [])

    def test_022_a_job_too_big_for_the_horizon_is_flagged_not_hidden(self):
        self.proj("الف", area=5000)
        d = self.plan()
        self.assertTrue(d["totals"]["unfinished"])
        self.assertIsNone(d["totals"]["finish"])
        self.assertLessEqual(len(d["days"]), planning.MAX_WORKING_DAYS)
        self.assertIsNone(self.P(d, "الف")["finish"])

    def test_023_no_projects_at_all(self):
        d = self.plan()
        self.assertEqual((d["projects"], d["days"], d["totals"]["finish"], d["totals"]["unfinished"]), ([], [], None, False))

    def test_024_removing_overtime_takes_the_hours_back(self):
        self.proj("الف")
        r = self.post("plan-overtime", {"date": SAT.isoformat(), "hours": 4})
        oid = r.json()["overtime"][0]["id"]
        self.post("plan-overtime", {"remove": oid})
        self.assertFalse(PlanOvertime.objects.exists())

    def test_025_today_is_a_holiday_but_was_worked_and_reported(self):
        p = self.proj("الف")
        self.holiday(SAT)
        self.report(p, self.a, 8, SAT, hours=8)
        d = self.plan()
        self.assertEqual((d["start"], self.J(d, "الف", self.a)["remaining"]), (SUN, 8.0))

    def test_026_overtime_on_friday_lets_drying_work_continue_next_day(self):
        self.proj("الف", area=40)
        self.overtime(FRI, 8)
        d = self.plan()
        self.assertEqual(self.area(d, FRI, "الف", self.b), 4.0)
        self.assertEqual(self.P(d, "الف")["finish"], D(2026, 10, 14))

    def test_027_a_week_of_holidays_in_the_middle(self):
        self.proj("الف", area=40)
        for i in range(6):
            self.holiday(SAT2 + W(i))
        d = self.plan()
        self.assertFalse([x["date"] for x in d["days"] if SAT2 <= x["date"] <= FRI2])
        self.assertGreater(self.P(d, "الف")["finish"], FRI2)

    def test_028_every_day_of_two_weeks_as_today(self):
        self.proj("الف", area=40, due_date=D(2026, 10, 20))
        self.proj("ب", area=24)
        for i in range(14):
            d = self.plan(SAT + W(i))
            self.assertFalse(d["totals"]["unfinished"])


class LeaveAndGeneral(Kit):
    def cal(self, day):
        return planning._Calendar(list(Employee.objects.filter(active=True).values_list("name", flat=True))).day(day)

    def test_029_a_full_day_leave_wins_over_an_hourly_general_row(self):
        self.leave("علی", SUN, kind="general", hours=3)
        self.leave("علی", SUN)
        x = self.cal(SUN)
        self.assertEqual((x["present"], x["leave"], x["pool"]), (1, ["علی"], 1.0))

    def test_030_the_same_two_rows_the_other_way_round(self):
        self.leave("علی", SUN)
        self.leave("علی", SUN, kind="general", hours=3)
        x = self.cal(SUN)
        self.assertEqual((x["present"], x["leave"], x["pool"]), (1, ["علی"], 1.0))

    def test_031_leave_across_a_friday(self):
        self.leave("علی", THU, SAT2)
        self.assertEqual((self.cal(THU)["pool"], self.cal(FRI)["pool"], self.cal(SAT2)["present"]), (0.5, 0.0, 1))

    def test_032_six_hours_off_on_a_thursday_is_the_whole_thursday(self):
        self.leave("علی", THU, hours=6)
        self.assertEqual(self.cal(THU)["pool"], 0.5)

    def test_033_a_worker_who_left_the_workshop(self):
        self.proj("الف")
        self.leave("رضا", SUN)
        Employee.objects.filter(name="رضا").update(active=False)
        d = self.plan()
        self.assertEqual((d["settings"]["crew"], self.day(d, SUN)["present"], self.day(d, SUN)["leave"]), (1, 1, []))

    def test_034_removing_a_leave_gives_the_person_back(self):
        self.proj("الف", area=40)
        r = self.post("plan-leave", {"employee": "علی", "from": SUN.isoformat()})
        self.assertEqual(self.day(self.plan(), SUN)["pool"], 1.0)
        self.post("plan-leave", {"remove": r.json()["leaves"][0]["id"]})
        self.assertEqual(self.day(self.plan(), SUN)["pool"], 2.0)

    def test_035_everybody_on_general_work_for_a_day(self):
        self.proj("الف", area=40)
        for n in ("علی", "رضا"):
            self.leave(n, SUN, kind="general")
        d = self.plan()
        x = self.day(d, SUN)
        self.assertEqual((self.lines(d, SUN), x["present"], x["leave"], x["pool"]), ([], 2, [], 0.0))

    def test_036_sixty_days_of_leave_is_the_limit(self):
        self.leave("علی", SAT, SAT + W(60))
        with self.assertRaises(Exception):
            self.leave("علی", SAT, SAT + W(61))

    def test_037_leave_that_ends_before_it_starts(self):
        with self.assertRaises(Exception):
            self.leave("علی", MON, SUN)

    def test_038_leave_for_someone_who_does_not_exist(self):
        with self.assertRaises(Exception):
            self.leave("ناشناس", MON)

    def test_039_twelve_hours_off_on_a_normal_day_is_the_whole_day(self):
        self.leave("علی", SUN, hours=12)
        x = self.cal(SUN)
        self.assertEqual((x["pool"], x["share"]["علی"]), (1.0, 0.0))

    def test_040_two_hourly_rows_cannot_take_more_than_the_day(self):
        self.leave("علی", SUN, hours=5)
        self.leave("علی", SUN, hours=5, kind="general")
        self.assertEqual(self.cal(SUN)["pool"], 1.0)

    def test_041_the_only_person_of_a_station_is_away(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی"], order=0)
        self.proj("الف")
        self.leave("علی", SAT)
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["start"], SUN)

    def test_042_one_of_two_workers_away_means_one_job_that_day(self):
        self.proj("الف", area=40)
        self.leave("رضا", SUN)
        d = self.plan()
        self.assertEqual(self.lines(d, SUN), [("الف", self.a.name, 8.0)])

    def test_043_three_hours_of_general_work_on_a_thursday(self):
        self.leave("رضا", THU, kind="general", hours=3)
        self.assertEqual(self.cal(THU)["pool"], 0.625)

    def test_044_leave_in_the_past_changes_nothing(self):
        self.proj("الف")
        self.leave("علی", PAST, PAST + W(5))
        self.assertEqual(self.day(self.plan(), SAT)["pool"], 2.0)

    def test_045_two_full_day_rows_for_one_person_count_once(self):
        self.leave("علی", SUN)
        self.leave("علی", SUN)
        self.assertEqual(self.cal(SUN)["present"], 1)

    def test_046_a_long_note_is_cut_not_refused(self):
        self.leave("علی", SUN, note="ن" * 500)
        self.assertEqual(len(PlanLeave.objects.get().note), 200)

    def test_047_blank_hours_mean_the_whole_day(self):
        r = self.post("plan-leave", {"employee": "علی", "from": SUN.isoformat(), "hours": ""})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(PlanLeave.objects.get().hours)

    def test_048_half_a_day_off_for_one_of_two_station_people(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        self.proj("الف", area=40)
        self.leave("رضا", SAT, hours=4)
        self.assertEqual(self.lines(self.plan(), SAT), [("الف", self.a.name, 12.0)])

    def test_049_leave_on_a_holiday_changes_nothing(self):
        self.proj("الف")
        self.holiday(SUN)
        self.leave("علی", SUN)
        self.assertEqual(self.lines(self.plan(), SUN), [])

    def test_050_general_work_does_not_stop_friday_overtime(self):
        self.overtime(FRI, 8)
        self.leave("رضا", FRI, kind="general", hours=3)
        self.assertEqual(self.cal(FRI)["pool"], 2.0)

    def test_051_leave_today_after_half_the_day_is_reported(self):
        p = self.proj("الف", area=40)
        self.report(p, self.a, 4, SAT, hours=8)                    # نصفِ توانِ امروز گزارش شده
        self.leave("رضا", SAT)
        d = self.plan()
        self.assertEqual(d["start"], SUN)                          # یک نفر حاضر بود و ۸ ساعتش گزارش شده

    def test_052_a_month_of_leave_for_a_named_station_person(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        self.proj("الف", area=80)
        self.leave("رضا", SAT, SAT + W(30))
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "الف", self.a), 8.0)
        self.assertFalse(d["totals"]["unfinished"])
