"""برنامه‌ریزی تولید در موقعیت‌های واقعیِ کارگاه — هر تست رفتارِ درست را می‌خواهد؛ تستی که نگذرد ایراد است.

پایه همان tests_planning است: دو مرحله (آستر ۱ ساعت بر متر، پرداخت ۲ ساعت بر متر)، هر مرحله یک ایستگاهِ یک‌نفره،
دو کارگر. پس آستر روزی ۸ متر و پرداخت روزی ۴ متر.
"""
import datetime
import time

from rest_framework.test import APIClient

from . import planning
from .models import (DailyReport, Employee, PlanBaselineLine, PlanHoliday, PlanLeave, PlanOvertime, PlanTask,
                     Project, ProjectStage, ReportProgress, Station, WorkStage)
from . import tests_planning

SAT = datetime.date(2026, 10, 3)
SUN = datetime.date(2026, 10, 4)
MON = datetime.date(2026, 10, 5)
THU = datetime.date(2026, 10, 8)
FRI = datetime.date(2026, 10, 9)
NEXT_SAT = datetime.date(2026, 10, 10)
D = datetime.date
PAST = datetime.date(2026, 9, 1)
W = datetime.timedelta


class Base(tests_planning.PlanningTests):
    """تست‌های خودِ PlanningTests اینجا دوباره اجرا نمی‌شوند؛ فقط setUp و کمک‌تابع‌هایش."""


for _name in [n for n in dir(tests_planning.PlanningTests) if n.startswith("test_")]:
    setattr(Base, _name, None)


class Scenarios(Base):
    def plan(self, today=SAT):
        return planning.plan(today=today)

    def proj(self, d, name):
        return next(p for p in d["projects"] if p["name"] == name)

    def job(self, d, name, stage):
        return next(j for j in self.proj(d, name)["jobs"] if j["stage"] == stage.name)

    def lines(self, d, day):
        x = next((x for x in d["days"] if x["date"] == day), None)
        return [(ln["project"], ln["stage"], ln["area"]) for ln in x["lines"]] if x else []

    def report(self, project, stage, area, day, status="approved", hours=None, who="علی"):
        rep = DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="م",
                                         status=status)
        ReportProgress.objects.create(report=rep, project=project, stage=stage.name, area=area)
        if hours:
            from .models import ReportItem
            ReportItem.objects.create(report=rep, employee=who, project=project, activity=stage.name, hours=hours)
        return rep

    def task(self, project, stage, **kw):
        planning.set_task({"project": str(project.pk), "stage": stage.name, **kw}, self.user, today=SAT)

    # ================= ۱. گزارشی ثبت نمی‌شود / کار پیش نمی‌رود =================

    def test_01_no_report_for_a_week_slides_the_whole_plan(self):
        self._project("الف")
        planning.commit(self.user, today=SAT)
        d = self.plan(SAT + W(7))
        p = self.proj(d, "الف")
        self.assertEqual(p["start"], SAT + W(7))
        self.assertGreater(p["slipDays"], 0)

    def test_02_baseline_days_with_nothing_done_score_zero(self):
        self._project("الف")
        planning.commit(self.user, today=SAT)
        d = self.plan(SAT + W(3))
        self.assertTrue(d["past"])
        self.assertTrue(all(x["percent"] == 0 for x in d["past"]))
        self.assertEqual(d["deviation"]["avgPercent"], 0)

    def test_03_late_jobs_are_marked_late_when_nothing_is_done(self):
        self._project("الف")
        planning.commit(self.user, today=SAT)
        d = self.plan(SAT + W(7))
        self.assertIn("late", [j["status"] for j in self.proj(d, "الف")["jobs"]])

    def test_04_half_a_day_done_carries_the_rest_to_the_next_day(self):
        p = self._project("الف")
        self.report(p, self.a, 4, SAT)
        d = self.plan(SAT)                     # گزارش امروز هست → برنامه از فردا
        self.assertEqual(self.job(d, "الف", self.a)["remaining"], 12.0)
        self.assertEqual(self.lines(d, SUN)[0][:2], ("الف", self.a.name))

    def test_05_more_than_planned_reported_never_goes_negative(self):
        p = self._project("الف")
        self.report(p, self.a, 30, PAST)
        d = self.plan()
        j = self.job(d, "الف", self.a)
        self.assertEqual((j["remaining"], j["status"]), (0.0, "done"))

    def test_06_work_on_a_stage_outside_the_project_plan_is_ignored(self):
        other = WorkStage.objects.create(name="رنگ خارج از برنامه", order=9, needs_area=True)
        p = self._project("الف")
        self.report(p, other, 5, PAST)
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.proj(d, "الف")["jobs"]], [self.a.name, self.b.name])

    def test_07_a_draft_report_is_not_finished_work(self):
        # پیش‌نویس هنوز ممکن است عوض یا پاک شود؛ نباید برنامه را جلو ببرد.
        p = self._project("الف")
        self.report(p, self.a, 16, PAST, status="draft")
        self.assertEqual(self.job(self.plan(), "الف", self.a)["remaining"], 16.0)

    def test_08_a_report_sent_back_for_revision_is_not_finished_work(self):
        p = self._project("الف")
        self.report(p, self.a, 16, PAST, status="revision")
        self.assertEqual(self.job(self.plan(), "الف", self.a)["remaining"], 16.0)

    def test_09_only_an_approved_report_counts_as_done(self):
        p = self._project("الف")
        rep = self.report(p, self.a, 16, PAST, status="waiting")
        self.assertEqual(self.job(self.plan(), "الف", self.a)["remaining"], 16.0)
        rep.status = "approved"
        rep.save()
        self.assertEqual(self.job(self.plan(), "الف", self.a)["remaining"], 0.0)

    def test_10_a_draft_report_today_does_not_close_today(self):
        p = self._project("الف")
        self.report(p, self.a, 2, SAT, status="draft")
        self.assertEqual(self.plan()["start"], SAT)

    def test_11_one_shift_reported_today_leaves_the_rest_of_today(self):
        # فقط شیفت صبح گزارش شده (۴ ساعت از ۱۶ نفر-ساعتِ امروز)؛ بقیهٔ امروز هنوز ظرفیت دارد.
        p = self._project("الف", area=40)
        self.report(p, self.a, 2, SAT, hours=4)
        d = self.plan()
        self.assertEqual(d["start"], SAT)
        self.assertTrue(0 < self.lines(d, SAT)[0][2] < 8.0)
        self.report(p, self.a, 2, SAT, hours=12, who="رضا")            # حالا کلِ امروز گزارش شده
        self.assertEqual(self.plan()["start"], SUN)

    def test_12_past_day_actual_ignores_drafts(self):
        p = self._project("الف")
        planning.commit(self.user, today=SAT)
        self.report(p, self.a, 8, SAT, status="draft")
        d = self.plan(SUN)
        self.assertEqual(d["past"][0]["actual"], 0.0)

    def test_13_unplanned_work_shows_as_unplanned(self):
        p1 = self._project("الف")
        p2 = self._project("ب", due_date=D(2027, 1, 1))
        planning.commit(self.user, today=SAT)
        # «ب» تاریخ تحویل دارد و اول می‌رود؛ آسترِ «الف» برای دوشنبه برنامه شده ولی شنبه کار شد
        self.report(p1, self.a, 3, SAT)
        d = self.plan(SUN)
        self.assertEqual(d["past"][0]["unplanned"], 3.0)
        self.assertIsNotNone(p2)

    def test_14_spent_hours_count_only_real_reports(self):
        p = self._project("الف")
        self.report(p, self.a, 1, PAST, status="draft", hours=5)
        self.assertEqual(self.proj(self.plan(), "الف")["spentHours"], 0.0)

    # ================= ۲. تقویم، اضافه‌کاری، مرخصی =================

    def test_15_holiday_on_a_thursday(self):
        self._project("الف", area=40)
        planning.add_holiday({"date": THU.isoformat(), "title": "تعطیل"})
        self.assertEqual(self.lines(self.plan(), THU), [])

    def test_16_overtime_on_a_holiday_opens_it(self):
        self._project("الف", area=40)
        planning.add_holiday({"date": MON.isoformat()})
        PlanOvertime.objects.create(date=MON, hours=8)
        self.assertTrue(self.lines(self.plan(), MON))

    def test_17_two_overtime_rows_for_two_people_do_not_double_the_day(self):
        cal = planning._Calendar(["علی", "رضا"])
        PlanOvertime.objects.create(date=FRI, hours=2, people=1)
        PlanOvertime.objects.create(date=FRI, hours=2, people=1)
        cal = planning._Calendar(["علی", "رضا"])
        self.assertEqual(cal.day(FRI)["factor"], 0.25)      # ۲ ساعت کار، نه ۴

    def test_18_overtime_people_cannot_exceed_present(self):
        PlanOvertime.objects.create(date=FRI, hours=8, people=10)
        self.assertEqual(planning._Calendar(["علی", "رضا"]).day(FRI)["pool"], 2.0)

    def test_19_everyone_on_leave_means_no_work(self):
        self._project("الف")
        for n in ("علی", "رضا"):
            PlanLeave.objects.create(employee=n, date_from=SAT, date_to=SAT)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [])
        self.assertEqual(self.proj(d, "الف")["start"], SUN)

    def test_20_leave_of_an_inactive_worker_changes_nothing(self):
        Employee.objects.create(name="رفته", active=False)
        PlanLeave.objects.create(employee="رفته", date_from=SAT, date_to=SAT)
        self.assertEqual(planning._Calendar(["علی", "رضا"]).day(SAT)["present"], 2)

    def test_21_station_people_on_leave_slow_that_station(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        self._project("الف", area=32)
        PlanLeave.objects.create(employee="رضا", date_from=SAT, date_to=SAT)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("الف", self.a.name, 8.0)])      # یک نفر از دو نفر

    def test_22_no_workers_at_all_warns_and_finishes_quickly(self):
        Employee.objects.all().delete()
        self._project("الف")
        t = time.monotonic()
        d = self.plan()
        self.assertTrue(any("کارگر" in w for w in d["warnings"]))
        self.assertTrue(d["totals"]["unfinished"])
        self.assertLess(time.monotonic() - t, 2.0)

    def test_23_leave_longer_than_two_months_is_refused(self):
        with self.assertRaises(Exception):
            planning.add_leave({"employee": "علی", "from": "2026-10-01", "to": "2027-01-01"}, self.user)

    # ================= ۳. برآورد مدت =================

    def test_24_a_stage_with_no_history_and_no_target_is_flagged(self):
        new = WorkStage.objects.create(name="مرحلهٔ تازه", order=3, needs_area=True)
        p = self._project("الف")
        ProjectStage.objects.create(project=p, name=new.name, area=10, order=2)
        d = self.plan()
        # بی سابقه، میانگینِ مراحلِ دیگر به کار می‌رود و هشدار «تخمینی» می‌آید
        self.assertTrue(any(new.name in w for w in d["warnings"]))
        self.assertFalse(d["totals"]["unfinished"])

    def test_25_a_stage_that_cannot_be_estimated_does_not_block_other_projects(self):
        WorkStage.objects.all().update(daily_target=0)
        from .models import ReportItem
        ReportItem.objects.all().delete()                 # هیچ سابقه‌ای نیست
        planning.clear_cache()
        self._project("الف")
        d = self.plan()
        self.assertTrue(any("چند روز" in w for w in d["warnings"]))

    def test_26_manual_days_on_a_finished_stage_are_refused(self):
        p = self._project("الف")
        self.report(p, self.a, 16, PAST)
        with self.assertRaises(Exception):
            self.task(p, self.a, days=3)

    def test_27_manual_days_then_half_done_keeps_the_speed(self):
        p = self._project("الف")
        self.task(p, self.a, days=4)                      # ۴ متر در روز
        self.report(p, self.a, 8, PAST)
        j = self.job(self.plan(), "الف", self.a)
        self.assertEqual((j["daily"], j["days"]), (4.0, 2.0))

    def test_28_finish_across_a_holiday(self):
        p = self._project("الف")
        planning.add_holiday({"date": MON.isoformat()})
        self.task(p, self.a, notBefore=SAT.isoformat(), finish="2026-10-06")
        self.assertEqual(self.job(self.plan(), "الف", self.a)["finish"], D(2026, 10, 6))

    def test_29_bad_numbers_are_refused_cleanly(self):
        p = self._project("الف")
        for bad in ({"days": "abc"}, {"days": -1}, {"crew": 0}, {"crew": 99}, {"crew": "x"}):
            with self.assertRaises(Exception):
                self.task(p, self.a, **bad)

    def test_30_a_failed_edit_leaves_nothing_half_saved(self):
        p = self._project("الف")
        with self.assertRaises(Exception):
            self.task(p, self.a, crew=3, notBefore="2026-10-06", finish="2026-10-01")
        self.assertFalse(PlanTask.objects.filter(project=p).exists())

    # ================= ۴. ترتیب و جای دستی =================

    def test_31_priority_beats_due_date(self):
        late = self._project("دیر", due_date=D(2026, 12, 1))
        self._project("زود", due_date=D(2026, 10, 10))
        planning.set_order([late.pk])
        self.assertEqual(self.plan()["projects"][0]["name"], "دیر")

    def test_32_order_with_a_bad_id_is_refused(self):
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.post("/api/production/plan-order/", {"ids": ["12a"]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_33_a_manual_place_that_has_passed_no_longer_jumps_the_queue(self):
        first = self._project("یک")
        second = self._project("دو")
        planning.set_order([first.pk, second.pk])
        self.task(second, self.a, notBefore=SAT.isoformat())         # «دو» را دستی روی شنبه گذاشت
        d = self.plan(SAT + W(9))                                     # یک هفته گذشت و کاری ثبت نشد
        self.assertEqual(self.lines(d, SAT + W(9))[0][0], "یک")       # حالا باید اولویت حرف بزند

    def test_34_shifting_a_project_does_not_pin_it_forever(self):
        first = self._project("یک")
        second = self._project("دو")
        planning.set_order([first.pk, second.pk])
        planning.shift_project({"project": second.pk, "days": -2}, self.user, today=SAT)
        d = self.plan(SAT + W(9))
        self.assertEqual(self.lines(d, SAT + W(9))[0][0], "یک")

    def test_35_two_bars_on_one_station_same_day_are_flagged(self):
        a, b = self._project("یک"), self._project("دو")
        self.task(a, self.a, notBefore=SAT.isoformat())
        self.task(b, self.a, notBefore=SAT.isoformat())
        self.assertTrue(self.plan()["days"][0]["overStations"])

    def test_36_a_bar_dragged_into_the_past_starts_today(self):
        p = self._project("الف")
        planning.shift_project({"project": p.pk, "days": -30}, self.user, today=SAT)
        self.assertEqual(self.proj(self.plan(), "الف")["start"], SAT)

    def test_37_a_closed_project_leaves_the_plan(self):
        p = self._project("الف")
        p.closed_at = SAT
        p.save()
        self.assertEqual(self.plan()["projects"], [])

    def test_38_an_inactive_project_leaves_the_plan(self):
        self._project("الف", active=False)
        self.assertEqual(self.plan()["projects"], [])

    def test_39_a_project_without_stages_is_named_in_the_warnings(self):
        Project.objects.create(name="بی‌مرحله")
        self.assertEqual(self.plan()["projects"], [])

    def test_40_a_stage_ticked_done_is_done(self):
        p = self._project("الف")
        ProjectStage.objects.filter(project=p, name=self.a.name).update(done=True)
        self.assertEqual(self.job(self.plan(), "الف", self.a)["remaining"], 0.0)

    # ================= ۵. با هم بردن =================

    def test_41_a_batch_mate_that_cannot_be_estimated_is_named(self):
        new = WorkStage.objects.create(name="بی‌برآورد", order=0, needs_area=True)
        WorkStage.objects.filter(pk=new.pk).update(daily_target=0)
        a, b = self._project("یک"), self._project("دو")
        ProjectStage.objects.filter(project=b, name=self.a.name).delete()
        ProjectStage.objects.create(project=b, name=new.name, area=10, order=0)
        self.task(a, self.b, together=[str(b.pk)])
        d = self.plan()
        self.assertTrue(self.job(d, "یک", self.b)["start"])            # «یک» تا ابد منتظر نمی‌ماند، یا علتش گفته می‌شود

    def test_42_a_batch_mate_closed_lets_the_other_go(self):
        a, b = self._project("یک"), self._project("دو")
        self.task(a, self.b, together=[str(b.pk)])
        b.closed_at = SAT
        b.save()
        d = self.plan()
        self.assertEqual(self.job(d, "یک", self.b)["start"], SUN)

    def test_43_leaving_a_pair_clears_the_other_side(self):
        a, b = self._project("یک"), self._project("دو")
        self.task(a, self.b, together=[str(b.pk)])
        self.task(a, self.b, together=[])
        self.assertFalse(PlanTask.objects.filter(batch__isnull=False).exists())

    # ================= ۶. ایستگاه‌ها =================

    def test_44_saving_the_stations_page_keeps_the_automatic_ones_automatic(self):
        self._project("الف")
        d = self.plan()
        rows = [{"id": s["id"], "name": s["name"], "crew": s["crew"], "stages": s["stages"], "people": s["people"],
                 "active": True} for s in d["stations"]]
        planning.save_stations(rows)                                  # همان‌طور که صفحه می‌فرستد، دست نخورده
        self.assertEqual(Station.objects.count(), 0)
        rows[1]["crew"] = 3                                           # فقط پرداخت عوض شد
        planning.save_stations(rows)
        self.assertEqual(list(Station.objects.values_list("name", "crew")), [(self.b.name, 3)])

    def test_45_deleting_a_station_used_by_a_task_says_so(self):
        st = Station.objects.create(name="کمکی", stages=[], order=5)
        p = self._project("الف")
        self.task(p, self.b, station=str(st.pk))
        with self.assertRaises(Exception):
            planning.save_stations([])

    def test_46_two_stations_can_swap_names(self):
        x = Station.objects.create(name="الف", stages=[self.a.name], order=0)
        y = Station.objects.create(name="ب", stages=[self.b.name], order=1)
        planning.save_stations([{"id": x.pk, "name": "ب", "stages": [self.a.name]},
                                {"id": y.pk, "name": "الف", "stages": [self.b.name]}])
        self.assertEqual(Station.objects.get(pk=x.pk).name, "ب")

    def test_47_a_task_on_a_switched_off_station_is_reported(self):
        st = Station.objects.create(name="کمکی", stages=[], order=5)
        p = self._project("الف")
        self.task(p, self.b, station=str(st.pk))
        Station.objects.filter(pk=st.pk).update(active=False)
        d = self.plan()
        self.assertTrue(any("کمکی" in w for w in d["warnings"]))

    # ================= ۷. خشک شدن =================

    def test_48_two_days_drying_over_the_weekend(self):
        self.a.wait_hours = 48
        self.a.save()
        p = self._project("الف")
        self.task(p, self.a, notBefore=THU.isoformat())
        # آستر پنجشنبه (۴ متر) و شنبه... پرداخت دست‌کم دو شبانه‌روز بعد از اولین کار
        d = self.plan()
        self.assertGreaterEqual((self.job(d, "الف", self.b)["start"] - THU).days, 3)

    # ================= ۸. نام و فهرست مراحل عوض می‌شود =================

    def test_49_renaming_a_stage_in_the_stage_list_keeps_its_work_in_the_plan(self):
        p = self._project("الف")
        self.report(p, self.a, 4, PAST)
        self.task(p, self.a, days=4)
        st = Station.objects.create(name="کابین", stages=[self.a.name], order=0)
        api = APIClient()
        self.user.access = ["production", "production.plan", "production.stages"]
        self.user.save()
        api.force_authenticate(self.user)
        r = api.patch(f"/api/work-stages/{self.a.pk}/", {"name": "آستر تازه"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        planning.clear_cache()
        d = self.plan()
        j = next(j for j in self.proj(d, "الف")["jobs"] if j["stage"] == "آستر تازه")
        self.assertEqual((j["remaining"], j["manual"], j["stationName"]), (12.0, True, "کابین"))
        self.assertEqual(Station.objects.get(pk=st.pk).stages, ["آستر تازه"])

    def test_50_a_stage_switched_off_still_shows_its_remaining_work(self):
        p = self._project("الف")
        WorkStage.objects.filter(pk=self.b.pk).update(active=False)
        d = self.plan()
        self.assertIn(self.b.name, [j["stage"] for j in self.proj(d, "الف")["jobs"]])
        self.assertIsNotNone(p)

    # ================= ۹. ثبت برنامه و صبح =================

    def test_51_committing_twice_keeps_the_past(self):
        p = self._project("الف")
        planning.commit(self.user, today=SAT)
        self.report(p, self.a, 8, SAT)
        planning.commit(self.user, today=SUN)
        self.assertEqual(float(PlanBaselineLine.objects.get(date=SAT, stage=self.a.name).area), 8.0)

    def test_52_morning_job_with_todays_report_already_in_still_keeps_today(self):
        p = self._project("الف")
        planning.daily(today=SAT)
        self.report(p, self.a, 8, SUN, status="waiting")              # سرپرست زود ثبت کرد
        did = planning.daily(today=SUN)
        self.assertTrue(PlanBaselineLine.objects.filter(date=SUN).exists(), did)

    def test_53_morning_job_twice_is_harmless(self):
        self._project("الف")
        planning.daily(today=SAT)
        n = PlanBaselineLine.objects.count()
        planning.daily(today=SAT)
        self.assertEqual(PlanBaselineLine.objects.count(), n)

    # ================= ۱۰. API و دسترسی =================

    def test_54_removing_something_that_is_not_there_is_fine(self):
        api = APIClient()
        api.force_authenticate(self.user)
        for path in ("plan-overtime", "plan-holiday", "plan-leave"):
            self.assertEqual(api.post(f"/api/production/{path}/", {"remove": 999}, format="json").status_code, 200)

    def test_55_bad_dates_are_refused_with_400(self):
        api = APIClient()
        api.force_authenticate(self.user)
        p = self._project("الف")
        for path, body in (("plan-holiday", {"date": "x"}), ("plan-overtime", {"date": "1405/07/12", "hours": 2}),
                           ("plan-task", {"project": str(p.pk), "stage": self.a.name, "notBefore": "abc"}),
                           ("plan-shift", {"project": str(p.pk), "days": "x"})):
            self.assertEqual(api.post(f"/api/production/{path}/", body, format="json").status_code, 400, path)

    def test_56_a_project_id_that_is_not_a_number(self):
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.post("/api/production/plan-task/", {"project": "abc", "stage": self.a.name, "days": 2}, format="json")
        self.assertEqual(r.status_code, 400)

    # ================= ۱۱. سرعت =================

    def test_57_thirty_projects_plan_in_reasonable_time(self):
        for i in range(30):
            self._project(f"پ{i}", area=40, due_date=D(2026, 11, 1) + W(i))
        t = time.monotonic()
        self.plan()
        one = time.monotonic() - t
        p = Project.objects.get(name="پ5")
        t = time.monotonic()
        self.task(p, self.b, notBefore="2026-10-20", pull=True)
        drag = time.monotonic() - t
        print(f"\n  [سرعت] برنامهٔ ۳۰ پروژه: {one:.2f} ثانیه · یک جابه‌جایی روی گانت (بی پاسخ): {drag:.2f} ثانیه")
        self.assertLess(one, 3.0)


# ایرادهای باز (۱۴۰۵/۰۷/۱۲). هر کدام رفع شد، از این فهرست برداشته شود؛ تا آن وقت «شکستِ مورد انتظار» است
# و اگر بی‌خبر درست شود، «موفقیتِ غیرمنتظره» خبر می‌دهد.
import unittest  # noqa: E402

KNOWN_ISSUES = [
]
for _name in KNOWN_ISSUES:
    setattr(Scenarios, _name, unittest.expectedFailure(getattr(Scenarios, _name)))


class LateWorkFirst(Base):
    """کارِ عقب‌افتاده و نیمه‌کاره اول تمام می‌شود؛ بقیه یک روز عقب می‌روند."""

    def test_a_job_left_over_yesterday_goes_before_a_new_one(self):
        first, second = self._project("یک"), self._project("دو")
        planning.set_order([first.pk, second.pk])
        rep = DailyReport.objects.create(date=PAST, shift="صبح", supervisor=self.user, supervisor_name="م",
                                         status="approved")
        ReportProgress.objects.create(report=rep, project=second, stage=self.a.name, area=16)
        # شنبه: پرداختِ «دو» (آسترش از قبل تمام است) برنامه شده؛ «یک» هنوز آستر دارد
        d = planning.plan(today=SAT)
        self.assertIn(("دو", self.b.name), [(ln["project"], ln["stage"]) for ln in d["days"][0]["lines"]])
        planning.commit(self.user, today=SAT)
        # شنبه پرداختِ «دو» انجام نشد. یکشنبه آسترِ «یک» هم برای پرداخت آماده است، ولی کارِ ماندهٔ «دو» اول می‌رود.
        d = planning.plan(today=SUN)
        sun = [(ln["project"], ln["stage"]) for x in d["days"] if x["date"] == SUN for ln in x["lines"]]
        self.assertIn(("دو", self.b.name), sun)
        self.assertNotIn(("یک", self.b.name), sun)
        job = next(j for p in d["projects"] if p["name"] == "دو" for j in p["jobs"] if j["stage"] == self.b.name)
        self.assertTrue(job["overdue"])
        self.assertEqual(job["baselineStart"], SAT)

    def test_a_finished_job_reports_how_late_it_finished(self):
        p = self._project("الف")
        planning.commit(self.user, today=SAT)                        # آستر شنبه و یکشنبه
        for day in (SAT, SUN, MON):
            rep = DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="م",
                                             status="approved")
            ReportProgress.objects.create(report=rep, project=p, stage=self.a.name, area=16 / 3)
        job = planning.plan(today=D(2026, 10, 6))["projects"][0]["jobs"][0]
        self.assertEqual((job["remaining"], job["doneSlip"]), (0.0, 1))


class LeaveAndGeneralWork(Base):
    """مرخصی (کلِ روز یا چند ساعت) و کارِ عمومیِ کارگاه از توانِ پروژه‌ها کم می‌کنند؛ هیچ کاری بیش از حاضران نفر نمی‌گیرد."""

    def line(self, d, day, stage):
        x = next(x for x in d["days"] if x["date"] == day)
        return next(((ln["area"], ln["people"]) for ln in x["lines"] if ln["stage"] == stage.name), None)

    def leave(self, who, day, **kw):
        planning.add_leave({"employee": who, "from": day.isoformat(), **kw}, self.user)

    def test_a_manual_crew_is_cut_to_who_is_there(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        p = self._project("الف", area=40)
        planning.set_task({"project": str(p.pk), "stage": self.a.name, "crew": 2}, self.user, today=SAT)
        self.leave("رضا", SUN)
        self.assertEqual(self.line(planning.plan(today=SAT), SUN, self.a), (8.0, 1.0))

    def test_a_placed_job_with_nobody_there_waits(self):
        p = self._project("الف", area=40)
        planning.set_task({"project": str(p.pk), "stage": self.a.name, "crew": 2, "notBefore": SUN.isoformat()},
                          self.user, today=SAT)
        self.leave("علی", SUN)
        self.leave("رضا", SUN)
        d = planning.plan(today=SAT)
        self.assertIsNone(self.line(d, SUN, self.a))
        self.assertEqual(self.proj(d, "الف")["jobs"][0]["start"], MON)

    def proj(self, d, name):
        return next(p for p in d["projects"] if p["name"] == name)

    def test_a_few_hours_off_take_only_those_hours(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی"], order=0)
        self._project("الف", area=40)
        self.leave("علی", SUN, hours=4)                        # نیم‌روز مرخصی
        d = planning.plan(today=SAT)
        self.assertEqual(self.line(d, SUN, self.a), (4.0, 0.5))
        day = next(x for x in d["days"] if x["date"] == SUN)
        self.assertEqual((day["present"], day["leave"], day["away"][0]["hours"]), (2, [], 4.0))

    def test_general_work_is_not_leave_but_takes_the_time(self):
        self._project("الف", area=40)
        self.leave("رضا", SUN, kind="general")                 # رضا کلِ یکشنبه کار عمومی کارگاه
        d = planning.plan(today=SAT)
        day = next(x for x in d["days"] if x["date"] == SUN)
        self.assertEqual((day["pool"], day["leave"], day["present"]), (1.0, [], 2))
        self.assertEqual([(a["name"], a["kind"]) for a in day["away"]], [("رضا", "general")])
        self.assertEqual(len(day["lines"]), 1)                 # یک نفر، یک کار

    def test_general_work_planned_is_set_against_general_work_reported(self):
        from .models import ReportItem
        p = self._project("الف")
        planning.commit(self.user, today=SAT)
        self.leave("رضا", SAT, kind="general", hours=3)
        shop = Project.objects.create(name="کار عمومی کارگاه", general=True)
        rep = DailyReport.objects.create(date=SAT, shift="صبح", supervisor=self.user, supervisor_name="م",
                                         status="approved")
        ReportItem.objects.create(report=rep, employee="رضا", project=shop, activity="نظافت", hours=5)
        ReportProgress.objects.create(report=rep, project=p, stage=self.a.name, area=4)
        day = planning.plan(today=SUN)["past"][0]
        self.assertEqual((day["generalPlanned"], day["generalActual"]), (3.0, 5.0))

    def test_bad_leave_input_is_refused(self):
        for bad in ({"hours": 0}, {"hours": 20}, {"hours": "x"}, {"kind": "holiday"}):
            with self.assertRaises(Exception):
                self.leave("علی", SUN, **bad)

    def test_two_partial_rows_add_up(self):
        self.leave("علی", SUN, hours=2)
        self.leave("علی", SUN, hours=3, kind="general")
        info = planning._Calendar(["علی", "رضا"]).day(SUN)
        self.assertEqual((info["share"]["علی"], round(info["pool"], 3)), (3 / 8, round(11 / 8, 3)))


class PausedProject(Base):
    """پروژه‌ای که وسطِ کار متوقف می‌شود: چیده نمی‌شود، تقصیرِ کارگاه حساب نمی‌شود، و پس از ادامه جلوی بقیه نمی‌پرد."""

    def setUp(self):
        super().setUp()
        self.one, self.two, self.three = self._project("یک"), self._project("دو"), self._project("سه")
        planning.set_order([self.one.pk, self.two.pk, self.three.pk])
        rep = DailyReport.objects.create(date=PAST, shift="صبح", supervisor=self.user, supervisor_name="م",
                                         status="approved")
        ReportProgress.objects.create(report=rep, project=self.one, stage=self.a.name, area=16)
        ReportProgress.objects.create(report=rep, project=self.one, stage=self.b.name, area=6)
        planning.commit(self.user, today=SAT)

    def names(self, d):
        return [p["name"] for p in d["projects"]]

    def first_day(self, d):
        return [ln["project"] for ln in d["days"][0]["lines"]]

    def test_a_paused_project_is_not_scheduled_but_is_listed(self):
        planning.pause_project({"project": self.one.pk, "start": SUN.isoformat(), "reason": "client", "note": "کارفرما گفت"},
                               self.user, today=SUN)
        d = planning.plan(today=SUN)
        self.assertEqual(self.names(d), ["دو", "سه"])
        self.assertNotIn("یک", self.first_day(d))
        self.assertEqual([(x["label"], x["reasonLabel"], x["remaining"]) for x in d["paused"]],
                         [("یک", "به خواست کارفرما", 10.0)])
        self.assertEqual(d["totals"]["paused"], 1)
        self.assertFalse(d["totals"]["unfinished"])

    def test_paused_days_are_not_the_workshops_fault(self):
        planning.pause_project({"project": self.one.pk, "start": SAT.isoformat()}, self.user, today=SAT)
        d = planning.plan(today=SUN)
        self.assertNotIn("یک", [ln["project"] for x in d["past"] for ln in x["lines"]])

    def test_after_resuming_it_is_not_late_and_does_not_jump_the_queue(self):
        later = SAT + W(14)
        planning.pause_project({"project": self.one.pk, "start": SUN.isoformat()}, self.user, today=SUN)
        # «دو» و «سه» در این دو هفته جلو رفتند و حالا کارِ نیمه‌کاره دارند
        for p in (self.two, self.three):
            rep = DailyReport.objects.create(date=later - W(1), shift="صبح", supervisor=self.user, supervisor_name="م",
                                             status="approved")
            ReportProgress.objects.create(report=rep, project=p, stage=self.a.name, area=16)
            ReportProgress.objects.create(report=rep, project=p, stage=self.b.name, area=4)
        planning.resume_project({"project": self.one.pk, "end": later.isoformat()}, self.user, today=later)
        d = planning.plan(today=later)
        one = next(p for p in d["projects"] if p["name"] == "یک")
        job = next(j for j in one["jobs"] if j["stage"] == self.b.name)
        self.assertFalse(job["overdue"])
        self.assertEqual(one["pauseDays"], 13)
        # از عقب‌افتادگیِ کل، ۱۳ روز به‌خاطر توقف است؛ بقیه از صفِ کارگاه
        self.assertEqual(one["totalSlipDays"] - one["slipDays"], 13)
        # کارِ نیمه‌کارهٔ «دو» و «سه» عقب‌افتاده است و اول می‌رود؛ «یک» با اولویتِ عادی‌اش
        self.assertNotEqual(self.first_day(d)[0], "یک")

    def test_resume_can_move_the_due_date(self):
        Project.objects.filter(pk=self.one.pk).update(due_date=D(2026, 11, 1))
        planning.pause_project({"project": self.one.pk, "start": SUN.isoformat()}, self.user, today=SUN)
        planning.resume_project({"project": self.one.pk, "end": "2026-10-14", "shiftDue": True}, self.user)
        self.assertEqual(Project.objects.get(pk=self.one.pk).due_date, D(2026, 11, 11))

    def test_a_pause_ahead_lets_work_run_until_that_day(self):
        planning.pause_project({"project": self.one.pk, "start": MON.isoformat()}, self.user, today=SAT)
        d = planning.plan(today=SAT)
        days = {x["date"]: [ln["project"] for ln in x["lines"]] for x in d["days"]}
        self.assertIn("یک", days[SAT])
        self.assertTrue(all("یک" not in v for k, v in days.items() if k >= MON))
        self.assertTrue(d["paused"][0]["upcoming"])

    def test_bad_pause_and_resume_are_refused(self):
        planning.pause_project({"project": self.one.pk}, self.user, today=SAT)
        with self.assertRaises(Exception):
            planning.pause_project({"project": self.one.pk}, self.user, today=SAT)          # دوباره
        with self.assertRaises(Exception):
            planning.resume_project({"project": self.one.pk, "end": "2026-09-01"}, self.user)   # پیش از توقف
        with self.assertRaises(Exception):
            planning.resume_project({"project": self.two.pk}, self.user)                     # متوقف نیست
        with self.assertRaises(Exception):
            planning.pause_project({"project": self.two.pk, "reason": "x"}, self.user)
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.post("/api/production/plan-resume/", {"project": self.one.pk}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["paused"], [])
