"""سناریوهای تازهٔ برنامه‌ریزی تولید — یازده قابلیتِ تازه و «کمکی» (۳۴۴ تا ۴۴۵):
خرابیِ ایستگاه، تاریخ شروعِ پروژه، «چرا اینجاست؟»، زنجیرهٔ بحرانی، تاریخچه و برگرداندن، «اگر…»های بیشتر، ترتیبِ بهتر،
مواد، مهارتِ نفرات، تعویض رنگ، و دوباره‌کاری."""
from decimal import Decimal

from rest_framework.exceptions import ValidationError

from .models import (PlanChange, PlanHoliday, PlanOvertime, PlanRework, PlanStationOff, PlanTask, Product, Sku,
                     StockMovement, User, Warehouse)
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit

NAMES = ["علی", "رضا", "حسن", "مینا", "سارا", "نیما", "زهرا"]


class Base(Kit):
    def workers(self, n):
        Employee.objects.all().delete()
        for name in NAMES[:n]:
            Employee.objects.create(name=name)

    def ordered(self, *projects):
        planning.set_order([p.pk for p in projects])

    def sid(self, stage):
        return planning.STAGE_ID + stage.name

    def off(self, stage, start, end=None, **kw):
        planning.add_station_off({"station": self.sid(stage), "from": start.isoformat(), "to": (end or start).isoformat(), **kw},
                                 self.user)

    def skill(self, **who):
        planning.set_skills({"skills": {n: [s.name for s in stages] for n, stages in who.items()}}, self.user)

    def color(self, project, name):
        planning.set_colors({"projects": {str(project.pk): name}}, self.user)

    def changeover(self, stage, hours):
        planning.set_colors({"stages": {stage.name: hours}}, self.user)

    def chain(self, d):
        return [(c["project"], c["stage"]) for c in d["critical"]]


class StationDown(Base):
    def test_344_a_station_down_for_two_days(self):
        self.proj("الف")
        self.off(self.b, SUN, MON)
        d = self.plan()
        self.assertEqual(self.worked(d, "الف", self.b), [TUE, WED, THU, SAT2, SUN2])
        self.assertEqual(self.day(d, SUN)["closed"], [self.sid(self.b)])

    def test_345_the_other_stations_keep_working(self):
        self.proj("الف")
        self.off(self.b, SUN, MON)
        self.assertEqual(self.lines(self.plan(), SUN), [("الف", self.a.name, 8.0)])

    def test_346_a_station_down_for_half_a_day(self):
        self.proj("الف", area=40)
        self.off(self.b, SUN, hours=4)
        self.assertEqual(self.area(self.plan(), SUN, "الف", self.b), 2.0)

    def test_347_a_job_placed_on_a_day_its_station_is_down(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=SUN.isoformat())
        self.off(self.b, SUN)
        self.assertEqual(self.J(self.plan(), "الف", self.b)["start"], MON)

    def test_348_entering_and_removing_through_the_page(self):
        self.proj("الف")
        r = self.post("plan-station-off", {"station": self.sid(self.b), "from": SUN.isoformat(), "to": MON.isoformat(),
                                           "reason": "تعمیر کمپرسور"})
        self.assertEqual(r.status_code, 200, r.content)
        row = PlanStationOff.objects.get()
        self.assertEqual((row.station_name, row.reason, row.created_by_name), (self.b.name, "تعمیر کمپرسور", "مدیر"))
        for bad in ({"station": "s:نیست", "from": SUN.isoformat()}, {"station": self.sid(self.b), "from": MON.isoformat(), "to": SUN.isoformat()},
                    {"station": self.sid(self.b), "from": SUN.isoformat(), "hours": 13}, {"station": self.sid(self.b)}):
            self.assertEqual(self.post("plan-station-off", bad).status_code, 400, bad)
        self.assertEqual(self.post("plan-station-off", {"remove": row.pk}).status_code, 200)
        self.assertFalse(PlanStationOff.objects.exists())

    def test_349_a_defined_station_down(self):
        st = Station.objects.create(name="کابین", stages=[self.a.name], crew=1, order=0)
        self.proj("الف")
        planning.add_station_off({"station": str(st.pk), "from": SAT.isoformat()}, self.user)
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["start"], SUN)
        self.assertEqual([(o["name"], o["from"], o["to"]) for o in d["stationOff"]], [("کابین", SAT, SAT)])

    def test_350_the_job_says_its_station_was_down(self):
        self.proj("الف")
        self.report(Project.objects.get(name="الف"), self.a, 16, PAST)
        self.off(self.b, SAT, SUN)
        self.assertIn("ایستگاه تعطیل یا خراب بود", self.J(self.plan(), "الف", self.b)["why"])

    def test_351_renaming_the_stage_keeps_the_closure(self):
        self.user.access = ["production", "production.plan", "production.stages"]
        self.user.save()
        self.proj("الف")
        self.off(self.b, SUN, MON)
        r = self.api().patch(f"/api/work-stages/{self.b.pk}/", {"name": "پرداخت تازه"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        planning.clear_cache()
        self.assertEqual(PlanStationOff.objects.get().station_key, "s:پرداخت تازه")
        self.assertEqual(self.day(self.plan(), SUN)["closed"], ["s:پرداخت تازه"])

    def test_352_a_closure_longer_than_four_months_is_refused(self):
        with self.assertRaises(ValidationError):
            self.off(self.b, SAT, SAT + W(200))


class ProjectStart(Base):
    def test_353_a_project_is_not_planned_before_its_start_day(self):
        self.proj("الف", start_date=WED)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.P(d, "الف")["holdUntil"]), (WED, WED))
        self.assertIn("تاریخ شروعِ پروژه", self.J(d, "الف", self.a)["why"])

    def test_354_a_project_already_started_ignores_a_later_start_day(self):
        p = self.proj("الف", start_date=WED)
        self.report(p, self.a, 4, PAST)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["start"], self.P(d, "الف")["holdUntil"]), (SAT, None))

    def test_355_a_start_day_in_the_past_changes_nothing(self):
        self.proj("الف", start_date=PAST)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["start"], SAT)

    def test_356_a_project_waiting_for_its_start_day_leaves_its_station_to_others(self):
        one, two = self.proj("یک", start_date=WED), self.proj("دو")
        self.ordered(one, two)
        d = self.plan()
        self.assertEqual((self.J(d, "دو", self.a)["start"], self.J(d, "یک", self.a)["start"]), (SAT, WED))

    def test_357_a_start_day_on_a_friday(self):
        self.proj("الف", start_date=FRI)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["start"], SAT2)


class Why(Base):
    def test_358_a_job_that_waited_a_day_for_the_stage_before(self):
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.a)["why"], "")
        self.assertEqual(self.J(d, "الف", self.b)["why"], f"پیش از شروع: ۱ روز منتظرِ کارِ «{self.a.name}» بود")

    def test_359_a_job_that_waited_for_its_station(self):
        one, two = self.proj("یک"), self.proj("دو")
        self.ordered(one, two)
        why = self.J(self.plan(), "دو", self.a)["why"]
        self.assertEqual(why, "پیش از شروع: ۲ روز ایستگاه دستِ یک بود")

    def test_360_a_job_that_waited_for_people(self):
        c = self.stage("رنگ آزمایشی", 3)
        x, y, z = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b]), self.proj("سه", stages=[c])
        self.ordered(x, y, z)
        self.assertEqual(self.J(self.plan(), "سه", c)["why"], "پیش از شروع: ۲ روز نفرِ آزاد نبود")

    def test_361_a_job_that_waited_for_drying(self):
        WorkStage.objects.filter(pk=self.a.pk).update(wait_hours=24)
        self.proj("الف")
        why = self.J(self.plan(), "الف", self.b)["why"]
        self.assertIn(f"منتظرِ خشک شدنِ «{self.a.name}» بود", why)
        self.assertIn(f"منتظرِ کارِ «{self.a.name}» بود", why)

    def test_362_a_job_the_planner_placed(self):
        p = self.proj("الف")
        self.task(p, self.a, notBefore=TUE.isoformat())
        self.assertEqual(self.J(self.plan(), "الف", self.a)["why"], "پیش از شروع: ۳ روز جایش را خودتان گذاشته‌اید")

    def test_363_a_fast_stage_held_to_the_pace_of_a_slow_one(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.workers(3)
        self.proj("الف", stages=[self.a, self.b, c])
        why = self.J(self.plan(), "الف", c)["why"]
        self.assertIn("کندتر از توانش", why)
        self.assertIn(f"«{self.b.name}»", why)

    def test_364_a_project_that_was_paused(self):
        p = self.proj("الف")
        planning.pause_project({"project": p.pk, "start": SAT.isoformat()}, self.user, today=SAT)
        planning.resume_project({"project": p.pk, "end": TUE.isoformat()}, self.user, today=SAT)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["why"], "پیش از شروع: ۳ روز پروژه متوقف بود")

    def test_365_a_finished_job_has_nothing_to_explain(self):
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["why"], "")


class Critical(Base):
    def test_366_one_project_is_its_own_chain(self):
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.chain(d), [("الف", self.a.name), ("الف", self.b.name)])
        self.assertEqual([j["critical"] for j in self.P(d, "الف")["jobs"]], [True, True])
        self.assertEqual(d["critical"][0]["why"], "از اولین روزِ برنامه و با توانِ کامل")

    def test_367_the_chain_crosses_to_the_project_that_held_the_station(self):
        one, two = self.proj("یک"), self.proj("دو")
        self.ordered(one, two)
        d = self.plan()
        self.assertEqual(self.chain(d), [("یک", self.a.name), ("یک", self.b.name), ("دو", self.b.name)])
        self.assertFalse(self.J(d, "دو", self.a)["critical"])

    def test_368_a_stage_paced_by_the_one_before_it(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.workers(3)
        self.proj("الف", stages=[self.a, self.b, c])
        self.assertEqual(self.chain(self.plan()), [("الف", self.a.name), ("الف", self.b.name), ("الف", c.name)])

    def test_369_nothing_planned_no_chain(self):
        self.assertEqual(self.plan()["critical"], [])

    def test_370_a_job_that_ends_early_is_not_on_the_chain(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.workers(3)
        self.proj("الف")
        self.proj("ب", stages={c: 8})
        d = self.plan()
        self.assertFalse(self.J(d, "ب", c)["critical"])
        self.assertEqual(self.chain(d)[-1], ("الف", self.b.name))


class History(Base):
    def edit(self, p, **kw):
        r = self.post("plan-task", {"project": str(p.pk), "stage": self.a.name, **kw})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_371_a_change_is_recorded_and_can_be_taken_back(self):
        p = self.proj("الف")
        d = self.edit(p, days=4)
        c = PlanChange.objects.get()
        self.assertEqual((c.by_name, c.action, c.summary), ("مدیر", "task", f"الف · {self.a.name} — مدت: ۴ روز"))
        self.assertEqual(d["undo"]["summary"], c.summary)
        r = self.post("plan-undo", {})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(PlanTask.objects.exists())
        self.assertIsNone(r.json()["undo"])
        self.assertEqual(PlanChange.objects.get().undone_by_name, "مدیر")

    def test_372_taking_back_two_changes_one_after_the_other(self):
        p = self.proj("الف")
        self.edit(p, days=4)
        self.post("plan-overtime", {"date": MON.isoformat(), "hours": 2})
        self.assertEqual(PlanChange.objects.count(), 2)
        self.post("plan-undo", {})
        self.assertFalse(PlanOvertime.objects.exists())
        self.assertTrue(PlanTask.objects.exists())
        self.post("plan-undo", {})
        self.assertFalse(PlanTask.objects.exists())
        self.assertEqual(self.post("plan-undo", {}).status_code, 400)

    def test_373_a_change_overwritten_since_cannot_be_taken_back_blindly(self):
        p = self.proj("الف")
        self.edit(p, days=4)
        PlanTask.objects.update(crew=2)                              # از راهی جز صفحهٔ برنامه‌ریزی عوض شد
        self.assertEqual(self.post("plan-undo", {}).status_code, 400)
        self.assertTrue(PlanTask.objects.exists())

    def test_374_taking_back_a_new_order(self):
        one, two = self.proj("یک"), self.proj("دو")
        self.post("plan-order", {"ids": [two.pk, one.pk]})
        self.assertEqual(Project.objects.get(pk=two.pk).plan_priority, 1)
        self.post("plan-undo", {})
        self.assertEqual(list(Project.objects.values_list("plan_priority", flat=True).distinct()), [None])

    def test_375_taking_back_a_deleted_station(self):
        st = Station.objects.create(name="کمکی", stages=[], crew=2, order=5)
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        self.task(p, self.a, station=str(st.pk))
        self.assertEqual(self.post("plan-stations", {"stations": []}).status_code, 200)
        self.assertFalse(Station.objects.exists())
        self.assertEqual(self.post("plan-undo", {}).status_code, 200)
        back = Station.objects.get()
        self.assertEqual((back.pk, back.name, back.crew, PlanTask.objects.get().station_id), (st.pk, "کمکی", 2, st.pk))

    def test_376_taking_back_a_resume_that_moved_the_due_date(self):
        p = self.proj("الف", due_date=D(2026, 11, 1))
        planning.pause_project({"project": p.pk, "start": SUN.isoformat()}, self.user, today=SUN)
        r = self.post("plan-resume", {"project": p.pk, "end": "2026-10-14", "shiftDue": True})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Project.objects.get(pk=p.pk).due_date, D(2026, 11, 11))
        self.post("plan-undo", {})
        self.assertEqual(Project.objects.get(pk=p.pk).due_date, D(2026, 11, 1))
        self.assertIsNone(ProjectPause.objects.get().end)

    def test_377_rework_and_commit_are_recorded_but_not_taken_back_this_way(self):
        p = self.proj("الف")
        self.post("plan-commit", {"note": "هفتهٔ اول"})
        self.assertEqual(PlanChange.objects.get().summary, "هفتهٔ اول")
        self.assertEqual(self.post("plan-undo", {}).status_code, 400)
        self.post("plan-rework", {"project": p.pk, "stage": self.b.name, "area": 3, "reason": "ضربه"})
        self.assertEqual(PlanChange.objects.count(), 2)
        self.assertIsNone(self.plan()["undo"])
        # و جلوی برگرداندنِ تغییرِ پیش از خودشان را نمی‌گیرند
        self.post("plan-overtime", {"date": MON.isoformat(), "hours": 2})
        self.post("plan-commit", {"note": "دوباره"})
        self.assertEqual(self.plan()["undo"]["summary"], "۱۴۰۵/۰۷/۱۳ — ۲ ساعت")
        self.assertEqual(self.post("plan-undo", {}).status_code, 200)
        self.assertFalse(PlanOvertime.objects.exists())

    def test_378_nothing_to_take_back(self):
        self.assertEqual(self.post("plan-undo", {}).status_code, 400)

    def test_379_an_edit_that_fails_or_changes_nothing_is_not_recorded(self):
        p = self.proj("الف")
        self.assertEqual(self.post("plan-task", {"project": str(p.pk), "stage": self.a.name, "days": -1}).status_code, 400)
        self.assertEqual(self.post("plan-overtime", {"remove": 999}).status_code, 200)
        self.assertEqual(self.post("plan-task", {"project": str(p.pk), "stage": self.a.name, "days": None}).status_code, 200)
        self.assertFalse(PlanChange.objects.exists())

    def test_380_anyone_may_read_the_history_but_only_the_planner_takes_back(self):
        p = self.proj("الف")
        self.edit(p, crew=2)
        viewer = User.objects.create_user(username="viewer", password="x", name="بیننده", role="member", access=["production"])
        r = self.api(viewer).get("/api/production/plan-history/")
        self.assertEqual(r.status_code, 200)
        row = r.json()["changes"][0]
        self.assertEqual((row["by"], row["action"], row["canUndo"], row["undone"]), ("مدیر", "تصمیمِ یک کار", True, False))
        self.assertEqual(self.post("plan-undo", {}, user=viewer).status_code, 403)

    def test_381_taking_back_skills_colours_and_a_closure(self):
        p = self.proj("الف")
        self.post("plan-skills", {"skills": {"علی": [self.a.name]}})
        self.post("plan-colors", {"projects": {str(p.pk): "سفید"}, "stages": {self.a.name: 2}})
        self.post("plan-station-off", {"station": self.sid(self.b), "from": SUN.isoformat()})
        self.assertEqual(PlanChange.objects.count(), 3)
        for _ in range(3):
            self.assertEqual(self.post("plan-undo", {}).status_code, 200)
        self.assertFalse(PlanStationOff.objects.exists())
        self.assertEqual((Project.objects.get(pk=p.pk).plan_color, float(WorkStage.objects.get(pk=self.a.pk).changeover_hours),
                          Employee.objects.get(name="علی").plan_stages), ("", 0.0, []))


class MoreWhatIf(Base):
    def ask(self, **body):
        r = self.post("plan-what-if", body)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["result"]

    def what(self, **body):
        return planning.what_if_custom(body, today=SAT)["result"]

    def test_382_my_own_assumption_one_more_person_on_a_station(self):
        self.proj("الف")
        r = self.what(station={"id": self.sid(self.b), "add": 1})
        self.assertEqual((r["finish"], r["endGain"], r["better"]), (TUE, 1, True))
        self.assertIn(self.b.name, r["label"])

    def test_383_my_own_overtime(self):
        self.proj("الف", area=40)
        r = self.what(overtime={"hours": 2, "days": 12})
        self.assertEqual((r["finish"], r["endGain"]), (TUE2, 2))

    def test_384_if_someone_is_away_for_three_days(self):
        self.proj("الف")
        r = self.what(absent={"employee": "رضا", "days": 3})
        self.assertEqual((r["finish"], r["endGain"]), (SAT2, -3))

    def test_385_if_a_station_breaks_down_for_three_days(self):
        self.proj("الف")
        r = self.what(off={"station": self.sid(self.b), "days": 3})
        self.assertEqual(r["finish"], SUN2)
        self.assertLess(r["endGain"], 0)

    def test_386_if_a_new_project_like_this_one_arrives_at_the_end(self):
        p = self.proj("الف")
        r = self.what(clone={"project": p.pk})
        self.assertEqual(r["projects"], [])                          # کارِ پروژهٔ فعلی تکان نمی‌خورد
        self.assertEqual(r["newProject"], TUE2)                      # آسترش دوشنبه شروع می‌شود و پرداختش پس از پرداختِ «الف»

    def test_387_if_a_new_project_jumps_the_queue(self):
        p = self.proj("الف")
        r = self.what(clone={"project": p.pk, "first": True})
        self.assertEqual(r["newProject"], WED)
        self.assertEqual([(g["label"], g["gain"] < 0) for g in r["projects"]], [("الف", True)])

    def test_388_assumptions_that_make_no_sense(self):
        p = self.proj("الف")
        for bad in ({}, {"station": {"id": "s:نیست"}}, {"station": {"id": self.sid(self.b), "add": 99}}, {"workers": "x"},
                    {"overtime": {"hours": 30}}, {"off": {"station": "x", "days": 2}}, {"absent": {"employee": "غریبه"}},
                    {"clone": {"project": 999999}}, {"overtime": {"hours": 2, "days": 0}}):
            self.assertEqual(self.post("plan-what-if", bad).status_code, 400, bad)
        self.assertIsNotNone(p)

    def test_389_the_overtime_needed_to_be_on_time(self):
        self.proj("الف", area=40, due_date=TUE2)
        w = planning.what_if(today=SAT)
        need = next(o for o in w["options"] if o["kind"] == "overtime-needed")
        self.assertEqual((w["now"]["late"], need["hours"], need["late"], need["finish"]), (1, 2, 0, TUE2))

    def test_390_overtime_that_still_is_not_enough(self):
        self.proj("الف", area=40, due_date=MON)
        w = planning.what_if(today=SAT)
        need = next(o for o in w["options"] if o["kind"] == "overtime-needed")
        self.assertEqual((need["hours"], need["late"]), (4, 1))
        self.assertIn("هنوز", need["label"])

    def test_391_several_assumptions_together_through_the_page(self):
        p = self.proj("الف", area=40)
        before = self.plan()
        r = self.ask(station={"id": self.sid(self.b), "add": 1}, workers=1, overtime={"hours": 2, "days": 6})
        self.assertTrue(r["better"])
        self.assertEqual(r["label"].count("؛"), 2)
        self.assertEqual(self.plan(), before)
        self.assertFalse(PlanOvertime.objects.exists())
        self.assertIsNotNone(p)


class BetterOrder(Base):
    def test_392_an_order_that_makes_a_project_late_gets_a_better_suggestion(self):
        far = self.proj("دیر", stages={self.a: 16}, due_date=D(2026, 11, 30))
        soon = self.proj("زود", stages={self.a: 16}, due_date=MON)
        self.ordered(far, soon)
        w = planning.what_if(today=SAT)
        self.assertEqual(w["now"]["late"], 1)
        o = w["order"]
        self.assertEqual((o["ids"], o["order"], o["late"], o["moved"]), ([str(soon.pk), str(far.pk)], ["زود", "دیر"], 0, 2))

    def test_393_an_order_that_is_already_the_best_gets_no_suggestion(self):
        self.proj("دیر", stages={self.a: 16}, due_date=D(2026, 11, 30))
        self.proj("زود", stages={self.a: 16}, due_date=MON)
        self.assertIsNone(planning.what_if(today=SAT)["order"])

    def test_394_one_project_has_no_order(self):
        self.proj("الف")
        self.assertIsNone(planning.what_if(today=SAT)["order"])

    def test_395_taking_the_suggestion_and_taking_it_back(self):
        far = self.proj("دیر", stages={self.a: 16}, due_date=D(2026, 11, 30))
        soon = self.proj("زود", stages={self.a: 16}, due_date=MON)
        self.ordered(far, soon)
        ids = planning.what_if(today=SAT)["order"]["ids"]
        r = self.post("plan-order", {"ids": ids})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.plan()["totals"]["late"], 0)
        self.post("plan-undo", {})
        self.assertEqual(self.plan()["totals"]["late"], 1)

    def test_396_a_shorter_end_when_nobody_is_late(self):
        # دو پروژه بی تاریخ تحویل: «بلند» اول باشد پایان زودتر است، چون دنبالهٔ دو مرحله‌ای‌اش زودتر شروع می‌شود.
        short, long = self.proj("کوتاه", stages={self.a: 16}), self.proj("بلند")
        self.ordered(short, long)
        w = planning.what_if(today=SAT)
        self.assertEqual(w["now"]["finish"], SUN2)
        o = w["order"]
        self.assertEqual((o["order"], o["finish"], o["endGain"]), (["بلند", "کوتاه"], WED, 4))


class Materials(Base):
    def setUp(self):
        super().setUp()
        self.primer = self.stage("استر تست", 5)
        self.top = self.stage("رنگ تست", 6)

    def stock(self, name, qty, base="کیلوگرم", **kw):
        shop = (Warehouse.objects.filter(supplies_workshop=True, active=True).order_by("id").first()
                or Warehouse.objects.create(name="انبار مصرفی", supplies_workshop=True))
        sku = Sku.objects.create(product=Product.objects.create(name=name), warehouse_name=name,
                                 site_package_id=f"T-{Sku.objects.count() + 1}", base_unit=base, **kw)
        StockMovement.objects.create(sku=sku, warehouse=shop, kind="transfer_in", qty=qty, date=PAST, created_by=self.user)

    def rows(self, d):
        return {r["group"]: r for r in d["rows"]}

    def test_397_what_the_next_two_weeks_need(self):
        Warehouse.objects.filter(supplies_workshop=True).update(active=False)
        self.proj("الف", stages={self.primer: 40, self.top: 40})
        d = planning.materials(today=SAT)
        r = self.rows(d)
        self.assertEqual((r["primer"]["area"], r["primer"]["need"], r["primer"]["status"]), (40.0, [6.7, 8.6], "short"))
        self.assertEqual((r["topcoat"]["need"], r["thinner"]["need"]), ([8.4, 10.8], [2.2, 4.3]))
        self.assertEqual((d["warehouse"], d["short"]), (None, ["آستر و هاردنرش", "رنگ رویه و هاردنرش", "تینر"]))

    def test_398_stock_in_the_workshop_store_is_set_against_it(self):
        self.proj("الف", stages={self.primer: 40, self.top: 40})
        self.stock("استر PU سفید", 10)
        self.stock("Topcoat matt 25KG", 0.4, base="حلب", alt_unit="کیلوگرم", alt_to_base=Decimal("0.04"))   # ۱۰ کیلو
        self.stock("تینر فوری", 3, base="لیتر")
        r = self.rows(planning.materials(today=SAT))
        self.assertEqual([(r[g]["stock"], r[g]["status"], r[g]["short"]) for g in ("primer", "topcoat", "thinner")],
                         [(10.0, "ok", 0.0), (10.0, "tight", 0.0), (3.0, "tight", 0.0)])

    def test_399_stages_that_use_no_paint_need_nothing(self):
        self.proj("الف")
        d = planning.materials(today=SAT)
        self.assertEqual([r["status"] for r in d["rows"]], ["none", "none", "none"])
        self.assertEqual(d["short"], [])

    def test_400_the_page_can_ask(self):
        self.proj("الف", stages={self.primer: 40})
        r = self.api().get("/api/production/plan-materials/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(sorted(r.json()), ["days", "rows", "short", "today", "unknownUnits", "until", "warehouse"])

    def test_401_only_the_work_of_the_next_two_weeks_counts_as_urgent(self):
        self.proj("الف", stages={self.primer: 400})
        r = self.rows(planning.materials(today=SAT))["primer"]
        self.assertEqual(r["area"], 88.0)                              # ۱۲ روزِ کاری: ۱۰ روزِ کامل و ۲ پنجشنبه
        self.assertEqual(r["needAll"], [67.2, 86.4])


class Skills(Base):
    def test_402_each_does_their_own_stage(self):
        self.skill(علی=[self.a], رضا=[self.b])
        self.proj("الف")
        d = self.plan()
        self.assertEqual(self.P(d, "الف")["finish"], WED)
        self.assertEqual(d["skills"], {"علی": [self.a.name], "رضا": [self.b.name]})

    def test_403_a_stage_nobody_can_do_is_pointed_out(self):
        self.skill(علی=[self.a], رضا=[self.a])
        self.proj("الف")
        d = self.plan()
        self.assertTrue(d["totals"]["unfinished"])
        self.assertIsNone(self.J(d, "الف", self.b)["start"])
        self.assertTrue(any(self.b.name in w and "مهارت" in w for w in d["warnings"]), d["warnings"])

    def test_404_the_specialist_goes_first_and_the_all_rounder_stays_free(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.skill(رضا=[self.a])
        x, y = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[c])
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.a.name, 8.0), ("دو", c.name, 8.0)])
        self.assertEqual(self.day(d, SAT)["free"], {})

    def test_405_the_only_person_who_can_do_a_stage_is_away(self):
        self.skill(علی=[self.a], رضا=[self.b])
        self.proj("الف")
        self.leave("رضا", SUN)
        d = self.plan()
        self.assertEqual(self.J(d, "الف", self.b)["start"], MON)
        self.assertEqual(self.day(d, SUN)["free"], {})

    def test_406_setting_skills_through_the_page(self):
        r = self.post("plan-skills", {"skills": {"علی": [self.a.name, "نیست"], "رضا": [self.a.name, self.b.name], "غریبه": [self.a.name]}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((Employee.objects.get(name="علی").plan_stages, Employee.objects.get(name="رضا").plan_stages),
                         ([self.a.name], []))                          # همهٔ مرحله‌ها = همه‌کاره
        for bad in ({}, {"skills": []}, {"skills": {"علی": "x"}}):
            self.assertEqual(self.post("plan-skills", bad).status_code, 400, bad)

    def test_407_someone_named_in_two_stations_is_not_in_both_at_once(self):
        Station.objects.create(name="یک", stages=[self.a.name], people=["علی"], order=0)
        Station.objects.create(name="دو", stages=[self.b.name], people=["علی"], order=1)
        self.proj("الف", area=40)
        d = self.plan()
        self.assertEqual(self.lines(d, SUN), [("الف", self.a.name, 8.0)])
        self.assertEqual(self.day(d, SUN)["free"], {"رضا": 1.0})

    def test_408_a_two_person_station_with_one_person_who_can_do_it(self):
        Station.objects.create(name="کابین", stages=[self.a.name], crew=2, order=0)
        self.skill(رضا=[self.b])
        self.proj("الف", area=40)
        self.assertEqual(self.area(self.plan(), SAT, "الف", self.a), 8.0)

    def test_409_renaming_a_stage_keeps_who_can_do_it(self):
        self.user.access = ["production", "production.plan", "production.stages"]
        self.user.save()
        self.skill(علی=[self.a])
        r = self.api().patch(f"/api/work-stages/{self.a.pk}/", {"name": "آستر تازه"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Employee.objects.get(name="علی").plan_stages, ["آستر تازه"])

    def test_410_a_new_helper_in_a_what_if_can_do_anything(self):
        c = self.stage("رنگ آزمایشی", 3)
        self.skill(علی=[self.a], رضا=[self.b])
        self.proj("الف", stages=[self.a, self.b, c])
        w = planning.what_if(today=SAT)
        self.assertTrue(w["now"]["unfinished"])
        self.assertFalse(next(o for o in w["options"] if o["kind"] == "worker")["finish"] is None)


class Colours(Base):
    def setUp(self):
        super().setUp()
        self.changeover(self.a, 4)
        self.x, self.y = self.proj("یک", stages={self.a: 8}), self.proj("دو", stages={self.a: 8})
        self.ordered(self.x, self.y)

    def test_411_a_different_colour_costs_the_changeover(self):
        self.color(self.x, "سفید")
        self.color(self.y, "مشکی")
        d = self.plan()
        self.assertEqual((self.area(d, SUN, "دو", self.a), self.P(d, "دو")["finish"]), (4.0, MON))
        su = self.day(d, SUN)["setups"]
        self.assertEqual([(s["project"], s["hours"], s["from"], s["to"]) for s in su], [("دو", 4.0, "سفید", "مشکی")])
        self.assertEqual(self.day(d, SUN)["used"], 1.0)                 # نیم روز شست‌وشو، نیم روز کار

    def test_412_the_same_colour_costs_nothing(self):
        self.color(self.x, "سفید")
        self.color(self.y, "سفید")
        d = self.plan()
        self.assertEqual((self.area(d, SUN, "دو", self.a), self.day(d, SUN)["setups"]), (8.0, []))

    def test_413_jobs_of_the_same_colour_are_run_together(self):
        z = self.proj("سه", stages={self.a: 8})
        self.ordered(self.x, self.y, z)
        self.color(self.x, "سفید")
        self.color(self.y, "مشکی")
        self.color(z, "سفید")
        d = self.plan()
        self.assertEqual((self.J(d, "سه", self.a)["start"], self.J(d, "دو", self.a)["start"]), (SUN, MON))
        self.assertEqual(sum(len(x["setups"]) for x in d["days"]), 1)   # یک شست‌وشو به‌جای دو تا

    def test_414_no_colour_no_changeover(self):
        d = self.plan()
        self.assertEqual(self.area(d, SUN, "دو", self.a), 8.0)
        self.assertEqual(sum(len(x["setups"]) for x in d["days"]), 0)

    def test_415_a_changeover_longer_than_the_day(self):
        self.changeover(self.a, 12)
        self.color(self.x, "سفید")
        self.color(self.y, "مشکی")
        d = self.plan()
        self.assertEqual([(x["date"], x["setups"][0]["hours"]) for x in d["days"] if x["setups"]], [(SUN, 8.0), (MON, 4.0)])
        self.assertEqual((self.J(d, "دو", self.a)["start"], self.area(d, MON, "دو", self.a)), (MON, 4.0))

    def test_416_a_stage_without_a_changeover_ignores_colours(self):
        self.changeover(self.a, 0)
        self.color(self.x, "سفید")
        self.color(self.y, "مشکی")
        self.assertEqual(self.area(self.plan(), SUN, "دو", self.a), 8.0)

    def test_417_colours_and_changeover_hours_through_the_page(self):
        r = self.post("plan-colors", {"projects": {str(self.x.pk): " سفید صدفی "}, "stages": {self.b.name: 1.5}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((Project.objects.get(pk=self.x.pk).plan_color, float(WorkStage.objects.get(pk=self.b.pk).changeover_hours)),
                         ("سفید صدفی", 1.5))
        self.assertEqual(self.P(r.json(), "یک")["color"], "سفید صدفی")
        for bad in ({"stages": {self.a.name: 30}}, {"stages": {"نیست": 1}}, {"projects": {"abc": "x"}}, {"stages": {self.a.name: "x"}}):
            self.assertEqual(self.post("plan-colors", bad).status_code, 400, bad)

    def test_418_the_job_says_it_waited_for_a_changeover(self):
        self.changeover(self.a, 12)
        self.color(self.x, "سفید")
        self.color(self.y, "مشکی")
        self.assertIn("تعویض رنگ", self.J(self.plan(), "دو", self.a)["why"])

    def test_419_a_placed_job_of_another_colour_still_goes_first(self):
        z = self.proj("سه", stages={self.a: 8})
        self.ordered(self.x, self.y, z)
        self.color(self.x, "سفید")
        self.color(self.y, "مشکی")
        self.color(z, "سفید")
        self.task(self.y, self.a, notBefore=SUN.isoformat())
        d = self.plan()
        self.assertEqual(self.J(d, "دو", self.a)["start"], SUN)


class Rework(Base):
    def done(self, name="الف"):
        p = self.proj(name)
        self.report(p, self.a, 16, PAST)
        self.report(p, self.b, 16, PAST)
        return p

    def rework(self, p, stage, area, **kw):
        planning.add_rework({"project": p.pk, "stage": stage.name, "area": area, **kw}, self.user)

    def areas(self, p):
        return [float(a) for a in ProjectStage.objects.filter(project=p).order_by("order").values_list("area", flat=True)]

    def test_420_rework_from_the_first_stage_brings_every_stage_back(self):
        p = self.done()
        self.rework(p, self.a, 4, reason="رد کنترل کیفیت")
        self.assertEqual(self.areas(p), [20.0, 20.0])
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["remaining"], self.J(d, "الف", self.b)["remaining"]), (4.0, 4.0))
        self.assertEqual([(r["project"], r["stage"], r["area"], r["reason"], r["by"]) for r in d["reworks"]],
                         [("الف", self.a.name, 4.0, "رد کنترل کیفیت", "مدیر")])

    def test_421_rework_from_the_last_stage_only(self):
        p = self.done()
        self.rework(p, self.b, 4)
        self.assertEqual(self.areas(p), [16.0, 20.0])
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["remaining"], self.J(d, "الف", self.b)["remaining"]), (0.0, 4.0))
        self.assertEqual(self.J(d, "الف", self.b)["start"], SAT)

    def test_422_removing_a_rework_gives_the_metres_back(self):
        p = self.done()
        self.rework(p, self.a, 4)
        planning.remove_rework(PlanRework.objects.get().pk)
        self.assertEqual(self.areas(p), [16.0, 16.0])
        self.assertFalse(PlanRework.objects.exists())

    def test_423_rework_that_makes_no_sense(self):
        p = self.done()
        closed = self.proj("بسته", closed_at=SAT)
        c = self.stage("رنگ آزمایشی", 3)
        for body in ({"project": p.pk, "stage": self.a.name, "area": 0}, {"project": p.pk, "stage": self.a.name, "area": -3},
                     {"project": p.pk, "stage": self.a.name, "area": "x"}, {"project": p.pk, "stage": c.name, "area": 2},
                     {"project": closed.pk, "stage": self.a.name, "area": 2}, {"project": "abc", "stage": self.a.name, "area": 2},
                     {"project": p.pk, "stage": self.a.name, "area": "nan"}):
            with self.assertRaises(ValidationError):
                planning.add_rework(body, self.user)
        self.assertEqual(self.areas(p), [16.0, 16.0])

    def test_424_rework_through_the_page(self):
        p = self.done()
        r = self.post("plan-rework", {"project": p.pk, "stage": self.b.name, "area": 2.5, "reason": "خط و خش"})
        self.assertEqual(r.status_code, 200, r.content)
        row = r.json()["reworks"][0]
        self.assertEqual((row["area"], row["stages"]), (2.5, [self.b.name]))
        self.assertEqual(self.post("plan-rework", {"remove": row["id"]}).status_code, 200)
        self.assertEqual(self.areas(p), [16.0, 16.0])

    def test_425_rework_unticks_a_stage_ticked_done(self):
        p = self.proj("الف")
        ProjectStage.objects.filter(project=p).update(done=True)
        self.rework(p, self.b, 4)
        self.assertEqual(list(ProjectStage.objects.filter(project=p).order_by("order").values_list("done", flat=True)), [True, False])

    def test_426_rework_in_the_middle_of_a_project(self):
        p = self.proj("الف")
        self.report(p, self.a, 16, PAST)
        self.report(p, self.b, 8, PAST)
        self.rework(p, self.a, 4)
        d = self.plan()
        self.assertEqual((self.J(d, "الف", self.a)["remaining"], self.J(d, "الف", self.b)["remaining"]), (4.0, 12.0))

    def test_427_rework_can_make_a_project_late_and_it_is_flagged(self):
        p = self.proj("الف", due_date=WED)
        self.assertEqual(self.plan()["totals"]["late"], 0)
        self.rework(p, self.b, 8)
        d = self.plan()
        self.assertEqual((d["totals"]["late"], self.P(d, "الف")["onTime"]), (1, False))


class Helpers(Base):
    """کمکی: در مرحله‌ای که «کمکی می‌گیرد»، کنارِ یک نفرِ ماهر بقیهٔ نفراتِ کار کمکی‌اند: «۲ نفر» یعنی یک نفرِ اصلی + یک کمکی (۴۲۸ تا ۴۴۵)."""

    def helpers(self, *stages):
        WorkStage.objects.update(helpers_ok=False)
        WorkStage.objects.filter(pk__in=[s.pk for s in stages]).update(helpers_ok=True)

    def booth(self, crew=2):
        Station.objects.create(name="کابین", stages=[self.b.name], crew=crew, order=1)

    def test_428_a_painter_with_a_helper_works_at_full_speed(self):
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a])
        self.proj("الف", stages={self.b: 40})
        self.assertEqual(self.area(self.plan(), SAT, "الف", self.b), 4.0)      # بی کمکی: نقاش تنهاست
        self.helpers(self.b)
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "الف", self.b), 8.0)
        self.assertEqual((d["helperStages"], self.day(d, SAT)["free"]), ([self.b.name], {}))

    def test_429_a_helper_cannot_work_without_the_painter(self):
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 40})
        self.leave("علی", SUN)
        d = self.plan()
        self.assertEqual([self.area(d, day, "الف", self.b) for day in (SAT, SUN, MON)], [8.0, 0, 8.0])
        self.assertIn("کسی که این مرحله را بلد است آزاد نبود", self.J(d, "الف", self.b)["why"])
        self.assertEqual(self.day(d, SUN)["free"], {"رضا": 1.0})

    def test_430_only_one_helper_is_taken_for_a_two_person_job(self):
        self.workers(3)
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a], حسن=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 40})
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "الف", self.b), 8.0)
        self.assertEqual(self.day(d, SAT)["free"], {"رضا": 1.0})

    def test_431_two_painters_run_two_booths_when_they_have_helpers(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(4)
        self.booth()
        Station.objects.create(name="کابین دو", stages=[c.name], crew=2, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a], مینا=[self.a])
        x, y = self.proj("یک", stages={self.b: 40}), self.proj("دو", stages={c: 40})
        self.ordered(x, y)
        self.assertEqual(self.lines(self.plan(), SAT), [("یک", self.b.name, 8.0)])       # هر دو نقاش در یک کابین
        self.helpers(self.b, c)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.b.name, 8.0), ("دو", c.name, 8.0)])
        self.assertEqual(self.day(d, SAT)["free"], {})

    def test_432_a_one_person_stage_takes_no_helper(self):
        self.skill(علی=[self.b], رضا=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 40})
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "الف", self.b), 4.0)
        self.assertEqual(self.day(d, SAT)["free"], {"رضا": 1.0})

    def test_433_helpers_through_the_page_and_taking_it_back(self):
        r = self.post("plan-skills", {"skills": {"علی": [self.b.name]}, "helpers": [self.b.name, "نیست"]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["helperStages"], WorkStage.objects.get(pk=self.b.pk).helpers_ok), ([self.b.name], True))
        self.assertIn("کمکی", PlanChange.objects.get().summary)
        for bad in ({"skills": {}, "helpers": "x"}, {"skills": {}, "helpers": [1]}):
            self.assertEqual(self.post("plan-skills", bad).status_code, 400, bad)
        self.assertEqual(self.post("plan-skills", {"skills": {"علی": [self.b.name]}}).status_code, 200)      # بی helpers: دست نمی‌خورد
        self.assertTrue(WorkStage.objects.get(pk=self.b.pk).helpers_ok)
        self.post("plan-undo", {})
        self.assertEqual((WorkStage.objects.get(pk=self.b.pk).helpers_ok, Employee.objects.get(name="علی").plan_stages), (False, []))

    def test_434_a_painter_with_two_helpers(self):
        self.workers(3)
        self.booth(crew=3)
        self.skill(علی=[self.b], رضا=[self.a], حسن=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 40})
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "الف", self.b), 12.0)
        self.assertEqual(self.day(d, SAT)["free"], {})

    def test_435_helpers_change_nothing_when_everyone_can_do_everything(self):
        self.booth()
        self.proj("الف", stages={self.b: 40})
        before = self.plan()
        self.helpers(self.a, self.b)
        after = self.plan()
        self.assertEqual(after["days"], before["days"])

    def test_436_helpers_go_to_the_job_but_the_painter_decides_how_many_jobs(self):
        # یک نقاش، دو کارِ رنگ در دو کابین: هر چند کمکی هست، دومی بی نقاش نمی‌گردد.
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(4)
        self.booth()
        Station.objects.create(name="کابین دو", stages=[c.name], crew=2, order=2)
        self.skill(علی=[self.b, c], رضا=[self.a], حسن=[self.a], مینا=[self.a])
        self.helpers(self.b, c)
        x, y = self.proj("یک", stages={self.b: 16}), self.proj("دو", stages={c: 16})
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.b.name, 8.0)])
        self.assertEqual(self.J(d, "دو", c)["start"], MON)
        self.assertIn("بلد است آزاد نبود", self.J(d, "دو", c)["why"])

    def test_437_a_busy_week_with_helpers_leave_and_overtime(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(5)
        self.booth()
        Station.objects.create(name="کابین دو", stages=[c.name], crew=3, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a], مینا=[self.a], سارا=[self.a])
        self.helpers(self.b, c)
        for i, area in enumerate((24, 16, 30, 12)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, c: area}, due_date=SAT + W(8 + 3 * i))
        self.leave("علی", MON, TUE)
        self.leave("حسن", SUN, hours=4)
        self.overtime(WED, 2)
        for today in (SAT, MON, THU):
            d = self.plan(today)
            self.assertFalse(d["totals"]["unfinished"])
        w = planning.what_if(today=SAT)
        self.assertTrue(w["options"])

    def test_438_the_idle_second_painter_fills_the_helper_seat(self):
        # کمکی نیست و کارِ رنگِ دیگری هم نیست: نقاشِ دوم که بی‌کار می‌ماند جای کمکی را می‌گیرد تا کار کند نرود.
        self.workers(3)
        self.booth()
        self.skill(علی=[self.b], رضا=[self.b], حسن=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 40})
        self.leave("حسن", SAT)
        d = self.plan()
        ln = self.day(d, SAT)["lines"][0]
        self.assertEqual((ln["area"], ln["lead"], ln["helpers"], ln["share"]), (8.0, 1, 1.0, 1.0))
        self.assertEqual(self.day(d, SAT)["free"], {})

    def test_439_each_painter_leads_his_own_job(self):
        # دو کارِ رنگ در دو کابین و کمکی نیست: هر نقاش سرِ یک کار می‌رود، نه هر دو سرِ یکی (یک کار، یک نفرِ اصلی).
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(3)
        self.booth()
        Station.objects.create(name="کابین دو", stages=[c.name], crew=2, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a])
        self.helpers(self.b, c)
        x, y = self.proj("یک", stages={self.b: 40}), self.proj("دو", stages={c: 40})
        self.ordered(x, y)
        self.leave("حسن", SAT)
        d = self.plan()
        self.assertEqual(self.lines(d, SAT), [("یک", self.b.name, 4.0), ("دو", c.name, 4.0)])
        self.assertEqual([(ln["lead"], ln["helpers"]) for ln in self.day(d, SAT)["lines"]], [(1, 0), (1, 0)])
        # فردا کمکی برمی‌گردد و کنارِ نقاشِ کارِ اول می‌ایستد
        self.assertEqual(self.lines(d, SUN), [("یک", self.b.name, 8.0), ("دو", c.name, 4.0)])
        self.assertEqual([(ln["lead"], ln["helpers"]) for ln in self.day(d, SUN)["lines"]], [(1, 1.0), (1, 0)])

    def test_440_the_booth_is_busy_as_long_as_its_painter_works(self):
        # نقاشِ بی‌کمکی کندتر می‌رود و کابین کلِ روز دستِ اوست؛ کارِ دومِ همان کابین منتظر می‌ماند (کمکی سرِ کارِ دیگری است).
        z = self.proj("صفر", stages={self.a: 400})
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a])
        self.helpers(self.b)
        x, y = self.proj("یک", stages={self.b: 40}), self.proj("دو", stages={self.b: 40})
        self.ordered(z, x, y)
        d = self.plan()
        self.assertEqual([(p, s) for p, s, a in self.lines(d, SAT)], [("صفر", self.a.name), ("یک", self.b.name)])
        ln = self.day(d, SAT)["lines"][1]
        self.assertEqual((ln["area"], ln["share"], ln["people"], ln["lead"], ln["helpers"]), (4.0, 1.0, 2, 1, 0))
        self.assertGreater(self.J(d, "دو", self.b)["start"], self.J(d, "یک", self.b)["finish"] - W(1))
        self.assertIn("ایستگاه دستِ یک بود", self.J(d, "دو", self.b)["why"])

    def test_441_a_helper_for_half_the_day(self):
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 40})
        self.leave("رضا", SAT, hours=4)
        ln = self.day(self.plan(), SAT)["lines"][0]
        self.assertEqual((ln["area"], ln["lead"], ln["helpers"], ln["share"]), (6.0, 1, 0.5, 1.0))

    def test_442_the_split_is_only_shown_where_there_are_helpers(self):
        self.booth()
        self.proj("الف", stages={self.b: 40})
        self.assertNotIn("lead", self.day(self.plan(), SAT)["lines"][0])       # همه همه‌کاره‌اند: دو نفر، بی اصلی و کمکی
        self.helpers(self.b)
        self.assertNotIn("lead", self.day(self.plan(), SAT)["lines"][0])
        self.skill(علی=[self.b], رضا=[self.a])
        ln = self.day(self.plan(), SAT)["lines"][0]
        self.assertEqual((ln["people"], ln["lead"], ln["helpers"]), (2, 1, 1.0))

    def test_443_washing_the_booth_alone_takes_twice_as_long(self):
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a])
        self.helpers(self.b)
        self.changeover(self.b, 2)
        x, y = self.proj("یک", stages={self.b: 4}), self.proj("دو", stages={self.b: 40})
        self.color(x, "سفید")
        self.color(y, "مشکی")
        self.ordered(x, y)
        d = self.plan()
        self.assertEqual([(s["hours"], s["share"]) for s in self.day(d, SAT)["setups"]], [(2.0, 0.25)])
        self.assertEqual(self.lines(d, SAT), [("یک", self.b.name, 4.0), ("دو", self.b.name, 2.0)])
        # کمکی سرِ کارِ دیگری است: نقاشِ تنها کلِ روز سرِ کارِ اول می‌ماند و فردا شست‌وشو دو برابر وقت می‌برد
        z = self.proj("صفر", stages={self.a: 400})
        self.ordered(z, x, y)
        d = self.plan()
        paint = lambda day: [(p, a) for p, s, a in self.lines(d, day) if s == self.b.name]      # noqa: E731
        self.assertEqual(paint(SAT), [("یک", 4.0)])
        self.assertEqual([(s["hours"], s["share"]) for s in self.day(d, SUN)["setups"]], [(4.0, 0.5)])
        self.assertEqual(paint(SUN), [("دو", 2.0)])

    def test_444_one_more_person_on_a_painting_station_is_one_more_helper(self):
        # «اگر یک نفر به کابین اضافه شود» یعنی کمکیِ دوم، نه نقاشِ دوم: کار تندتر می‌شود و نقاشِ دیگری لازم نیست.
        self.workers(3)
        self.booth()
        self.skill(علی=[self.b], رضا=[self.a], حسن=[self.a])
        self.helpers(self.b)
        self.proj("الف", stages={self.b: 36})
        self.assertEqual(self.J(self.plan(), "الف", self.b)["finish"], WED)
        labels = [o["label"] for o in planning.what_if(today=SAT)["options"] if o.get("kind") == "station"]
        self.assertEqual(labels, ["یک کمکیِ دیگر روی «کابین» (۲ ← ۳ نفر)"])
        Station.objects.filter(name="کابین").update(crew=3)
        d = self.plan()
        ln = self.day(d, SAT)["lines"][0]
        self.assertEqual((ln["area"], ln["people"], ln["lead"], ln["helpers"]), (12.0, 3, 1, 2.0))
        self.assertEqual(self.J(d, "الف", self.b)["finish"], MON)

    def test_445_a_long_mixed_run_keeps_one_lead_per_job(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        e = self.stage("رنگ پایانی آزمایشی", 4, hpm=2)
        self.workers(6)
        self.booth()
        Station.objects.create(name="کابین دو", stages=[c.name], crew=3, order=2)
        Station.objects.create(name="کابین سه", stages=[e.name], crew=2, order=3)
        self.skill(علی=[self.b, c, e], رضا=[self.b, c, e], حسن=[self.a], مینا=[self.a], سارا=[self.a], نیما=[self.a])
        self.helpers(self.b, c, e)
        for i, area in enumerate((28, 12, 36, 20, 9)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, c: area, e: area}, due_date=SAT + W(9 + 2 * i))
        self.leave("رضا", TUE)
        self.leave("حسن", SUN, MON)
        self.leave("مینا", MON, hours=4)
        self.leave("سارا", MON)
        self.leave("نیما", MON)
        self.overtime(WED, 2)
        for today in (SAT, SUN, TUE, THU):
            d = self.plan(today)
            self.assertFalse(d["totals"]["unfinished"])
            for x in d["days"]:
                paint = [ln for ln in x["lines"] if "lead" in ln]
                # دو نقاش: در هر لحظه بیش از دو کارِ رنگ پیش نمی‌رود
                self.assertLessEqual(sum(ln["share"] for ln in paint), 2.03, x["date"])
