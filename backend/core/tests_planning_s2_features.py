"""سناریوهای تازهٔ برنامه‌ریزی تولید — یازده قابلیتِ تازه، «کمکی» و «خدمات عمومی» و برنامهٔ نفرات (۳۴۴ تا ۴۹۸):
خرابیِ ایستگاه، تاریخ شروعِ پروژه، «چرا اینجاست؟»، زنجیرهٔ بحرانی، تاریخچه و برگرداندن، «اگر…»های بیشتر، ترتیبِ بهتر،
مواد، مهارتِ نفرات، تعویض رنگ، و دوباره‌کاری."""
from collections import defaultdict
from decimal import Decimal

from rest_framework.exceptions import ValidationError

from .models import (PlanChange, PlanHoliday, PlanLeave, PlanOvertime, PlanRework, PlanStationOff, PlanTask, Product, Sku,
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


class GeneralFill(Base):
    """مهارتِ «خدمات عمومی کارگاه و تعمیر و نگهداری» و سپردنِ وقتِ بی‌کاری به کارِ عمومی (۴۴۶ تا ۴۷۸).

    این سپردن از توانِ پروژه‌ها چیزی کم نمی‌کند: برنامهٔ تولید همان می‌ماند و فقط وقتی که آن نفر کارِ تولید ندارد
    «کار عمومی» می‌شود."""

    def general(self, *names):
        planning.set_skills({"skills": {}, "general": list(names)}, self.user)

    def fill(self, who, day, to=None, **kw):
        planning.add_leave({"employee": who, "from": day.isoformat(), "to": (to or day).isoformat(), "kind": "fill", **kw},
                           self.user)

    def fills(self, d, day):
        """جمعِ ساعتِ کارِ عمومیِ هر نفر در یک روز (هر ردیف کارِ جدایی است)."""
        out = {}
        for f in (self.day(d, day) or {"fill": []})["fill"]:
            out[f["name"]] = round(out.get(f["name"], 0) + f["hours"], 1)
        return out

    @staticmethod
    def strip(d):
        return [(x["date"], x["lines"], x["free"], x["used"], x["pool"], x["present"]) for x in d["days"]]

    @staticmethod
    def production(d):
        """برنامهٔ تولید، بی اینکه چه کسی بی‌کار مانده: کارهای هر روز، نفر-روزِ رفته و مانده، و پایانِ پروژه‌ها."""
        return ([(x["date"], x["lines"], x["used"], x["pool"], x["present"], round(sum(x["free"].values()), 2))
                 for x in d["days"]], [(p["name"], p["finish"]) for p in d["projects"]])

    @staticmethod
    def idle_of(d, who):
        return round(sum(x["free"].get(who, 0.0) for x in d["days"]), 2)

    def test_446_the_general_skill_is_saved_shown_and_undone(self):
        r = self.post("plan-skills", {"skills": {}, "general": ["علی", "نیست"]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["generalPeople"], ["علی"])
        self.assertEqual(sorted(Employee.objects.filter(plan_general=True).values_list("name", flat=True)), ["علی"])
        self.assertIn("خدمات عمومی", PlanChange.objects.get().summary)
        for bad in ({"skills": {}, "general": "x"}, {"skills": {}, "general": [1]}):
            self.assertEqual(self.post("plan-skills", bad).status_code, 400, bad)
        self.post("plan-undo", {})
        self.assertFalse(Employee.objects.filter(plan_general=True).exists())

    def test_447_saving_skills_without_the_list_leaves_it_alone(self):
        self.general("علی")
        self.skill(علی=[self.a])
        self.assertTrue(Employee.objects.get(name="علی").plan_general)
        self.assertEqual(Employee.objects.get(name="علی").plan_stages, [self.a.name])       # مهارتِ تولید جداست
        self.general()
        self.assertFalse(Employee.objects.get(name="علی").plan_general)
        self.assertEqual(Employee.objects.get(name="علی").plan_stages, [self.a.name])

    def test_448_only_someone_with_the_skill_can_be_given_the_work(self):
        body = {"employee": "علی", "from": SAT.isoformat(), "to": MON.isoformat(), "kind": "fill", "note": "نظافت"}
        r = self.post("plan-leave", body)
        self.assertEqual(r.status_code, 400)
        self.assertIn("خدمات عمومی", r.content.decode())
        self.general("علی")
        r = self.post("plan-leave", body)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([(lv["employee"], lv["kind"], lv["hours"], lv["note"]) for lv in r.json()["leaves"]],
                         [("علی", "fill", None, "نظافت")])
        self.assertIn("کار عمومی در وقتِ بی‌کاری", PlanChange.objects.first().summary)
        self.post("plan-undo", {})
        self.assertFalse(PlanLeave.objects.exists())

    def test_449_it_takes_nothing_from_production(self):
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.a: 10, self.b: 10})
        before = self.plan()
        self.assertTrue(any(x["free"] for x in before["days"]))
        self.general("علی", "رضا")
        self.fill("علی", SAT, SAT2)
        self.fill("رضا", SAT, SAT2)
        after = self.plan()
        self.assertEqual(self.strip(after), self.strip(before))
        self.assertEqual([p["finish"] for p in after["projects"]], [p["finish"] for p in before["projects"]])
        for x in after["days"]:
            idle = {n: round(v * 8, 1) for n, v in x["free"].items()} if x["date"] <= SAT2 else {}
            self.assertEqual(self.fills(after, x["date"]), idle, x["date"])
        self.assertTrue(all(x["away"] == [] for x in after["days"]))                 # غیبت نیست

    def test_450_a_cap_on_hours_per_day(self):
        self.proj("الف", stages={self.a: 40})
        d = self.plan()
        who, = self.day(d, SAT)["free"]                                              # یک نفر کلِ روز بی‌کار است
        self.assertEqual(self.day(d, SAT)["free"], {who: 1.0})
        self.general(who)
        self.fill(who, SAT, hours=3)
        self.fill(who, SUN)
        d = self.plan()
        self.assertEqual((self.fills(d, SAT), self.fills(d, SUN), self.fills(d, MON)), ({who: 3.0}, {who: 8.0}, {}))
        self.assertEqual(self.day(d, SAT)["free"], {who: 1.0})                       # توانِ تولیدش سرِ جاست

    def test_451_production_work_comes_first_and_the_general_work_shrinks(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT, WED, note="تعمیر")
        d = self.plan()
        self.assertEqual([self.fills(d, day).get(who) for day in (SAT, SUN, MON)], [8.0, 8.0, 8.0])
        # کارِ تازه‌ای می‌رسد که همان نفر باید انجامش بدهد: برنامه اول آن را می‌دهد
        new = self.proj("ب", stages={self.b: 12})
        soft = self.plan()
        job = self.J(soft, "ب", self.b)
        self.assertEqual(job["start"], SAT)
        for day in self.worked(soft, "ب", self.b):
            self.assertLess(self.fills(soft, day).get(who, 0), 8.0)
        self.assertEqual(sum(self.fills(soft, x["date"]).get(who, 0) for x in soft["days"]),
                         sum(x["free"].get(who, 0) * 8 for x in soft["days"] if x["date"] <= WED))
        # همان کار با «کار عمومیِ» معمولی (که از توان کم می‌کند) عقب می‌افتاد
        PlanLeave.objects.update(kind="general")
        hard = self.plan()
        self.assertGreater(self.J(hard, "ب", self.b)["finish"], job["finish"])
        self.assertTrue(new.pk)

    def test_452_no_general_work_on_a_day_off_or_on_leave(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT, WED)
        self.leave(who, SUN)
        self.leave(who, MON, hours=5)
        self.holiday(TUE)
        d = self.plan()
        self.assertEqual([self.fills(d, day) for day in (SAT, SUN, MON)], [{who: 8.0}, {}, {who: 3.0}])
        self.assertIsNone(self.day(d, TUE))
        self.assertEqual(self.fills(d, WED), {who: 8.0})

    def test_462_nobody_stays_overtime_for_general_work(self):
        self.proj("الف", stages={self.a: 80})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT, FRI)
        self.overtime(SUN, 2)                    # دو ساعت بیشتر در یک روزِ عادی
        self.overtime(FRI, 4)                    # جمعه فقط اضافه‌کاری
        d = self.plan()
        self.assertEqual(self.day(d, SUN)["free"], {who: 1.25})
        self.assertEqual(self.day(d, FRI)["free"], {who: 0.5})
        self.assertEqual((self.fills(d, SAT), self.fills(d, SUN), self.fills(d, FRI)), ({who: 8.0}, {who: 8.0}, {}))

    def test_453_two_rows_on_the_same_day_add_up(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT, hours=2, note="نظافت")
        self.fill(who, SAT, hours=3, note="تعمیر")
        self.fill(who, SUN, hours=2, note="نظافت")
        self.fill(who, SUN, note="نظافت")
        d = self.plan()
        self.assertEqual([(f["hours"], f["note"]) for f in self.day(d, SAT)["fill"]], [(2.0, "نظافت"), (3.0, "تعمیر")])
        self.assertEqual([(f["hours"], f["note"]) for f in self.day(d, SUN)["fill"]], [(2.0, "نظافت"), (6.0, "نظافت")])
        self.assertEqual((self.fills(d, SAT), self.fills(d, SUN)), ({who: 5.0}, {who: 8.0}))
        self.assertEqual(len({f["id"] for x in d["days"] for f in x["fill"]}), 4)       # هر ردیف با شناسهٔ خودش

    def test_454_the_tile_counts_idle_time_and_what_was_given(self):
        self.proj("الف", stages={self.a: 40})
        d = self.plan()
        who, = self.day(d, SAT)["free"]
        idle = d["totals"]["idle"]
        self.assertEqual((d["totals"]["filled"], d["loadDays"], d["generalPeople"]), (0.0, 12, []))
        self.assertGreater(idle, 2)
        self.general(who)
        self.fill(who, SAT, SUN)
        d = self.plan()
        self.assertEqual((d["totals"]["idle"], d["totals"]["filled"], d["generalPeople"]), (idle, 2.0, [who]))
        self.assertEqual(d["totals"]["utilization"], self.plan()["totals"]["utilization"])

    def test_455_general_works_are_offered_by_name(self):
        Project.objects.create(name="خدمات کارگاه", general=True, no_area=True)
        Project.objects.create(name="آموزش", general=True, no_area=True, active=False)
        self.proj("الف")
        self.assertEqual(self.plan()["generalWorks"], ["خدمات کارگاه"])

    def test_456_planned_general_hours_of_past_days_include_it(self):
        self.general("علی", "رضا")
        self.fill("علی", SAT)
        self.fill("رضا", SUN, hours=3)
        self.leave("رضا", SAT, kind="general", hours=2)
        cal = planning._Calendar(["علی", "رضا"])
        planned, _ = planning._general_hours(SAT, TUE, cal)
        self.assertEqual(dict(planned), {SAT: 10.0, SUN: 3.0})

    def test_457_someone_no_longer_in_the_workshop_is_ignored(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT, WED)
        Employee.objects.filter(name=who).update(active=False)
        d = self.plan()
        self.assertTrue(all(x["fill"] == [] for x in d["days"]))
        self.assertEqual(d["generalPeople"], [])

    def test_458_a_new_name_keeps_the_work(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT)
        self.user.access = ["production", "production.plan", "dashboard.staff"]
        self.user.save()
        e = Employee.objects.get(name=who)
        r = self.api().patch(f"/api/employees/{e.pk}/", {"name": "نامِ تازه"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        d = self.plan()
        self.assertEqual((self.fills(d, SAT), d["generalPeople"]), ({"نامِ تازه": 8.0}, ["نامِ تازه"]))

    def test_459_what_if_still_answers_with_general_work_in_the_plan(self):
        self.workers(4)
        self.proj("الف", stages={self.a: 30, self.b: 30}, due_date=SAT + W(3))
        self.proj("ب", stages={self.a: 20, self.b: 20})
        self.general("علی", "حسن")
        self.fill("علی", SAT, SAT2)
        self.fill("حسن", SAT, SAT2, hours=4)
        base = planning.plan(today=SAT)
        w = planning.what_if(today=SAT)
        self.assertTrue(w["options"])
        r = self.post("plan-what-if", {"absent": {"employee": "علی", "days": 2}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.strip(planning.plan(today=SAT)), self.strip(base))            # «اگر…» چیزی را عوض نمی‌کند

    def test_460_the_general_skill_does_not_touch_who_can_do_a_stage(self):
        self.booth = Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        self.skill(علی=[self.b], رضا=[self.a])
        WorkStage.objects.filter(pk=self.b.pk).update(helpers_ok=True)
        self.proj("الف", stages={self.a: 12, self.b: 40})
        before = self.plan()
        self.general("علی", "رضا")
        self.assertEqual(self.strip(self.plan()), self.strip(before))
        self.assertEqual(self.plan()["skills"], before["skills"])

    def test_461_a_busy_fortnight_with_skills_helpers_leave_and_general_work(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(6)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        Station.objects.create(name="کابین دو", stages=[c.name], crew=2, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a], مینا=[self.a], سارا=[self.a], نیما=[self.a])
        WorkStage.objects.filter(pk__in=[self.b.pk, c.pk]).update(helpers_ok=True)
        for i, area in enumerate((30, 14, 22, 9)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, c: area}, due_date=SAT + W(8 + 3 * i))
        self.leave("حسن", SUN)
        self.leave("علی", TUE, hours=4)
        self.overtime(WED, 2)
        before = {today: self.plan(today) for today in (SAT, MON, THU)}
        self.general("حسن", "مینا", "سارا", "علی")
        self.assertEqual(self.plan()["generalPeople"], ["حسن", "سارا", "مینا"])         # علی نقاش است: استادکار
        self.fill("حسن", SAT, SAT2 + W(6), note="نظافت")
        self.fill("مینا", SAT, SAT2 + W(6), hours=4, note="تعمیر و نگهداری")
        self.fill("سارا", MON, open=True)
        given = 0.0
        for today in (SAT, MON, THU):
            d = self.plan(today)
            self.assertEqual(self.production(d), self.production(before[today]))
            for x in d["days"]:
                for f in x["fill"]:
                    self.assertIn(f["name"], ("حسن", "مینا", "سارا"))
                    self.assertLessEqual(f["hours"], x["free"].get(f["name"], 0) * 8 + 0.06, (x["date"], f))
                    if f["name"] == "مینا":
                        self.assertLessEqual(f["hours"], 4.0)
                    given += f["hours"]
            self.assertLessEqual(d["totals"]["filled"], d["totals"]["idle"])
        self.assertGreater(given, 8)

    # ---------- کارها اول به بقیه می‌رسد؛ نفرِ خدمات عمومی آخر از همه ----------

    def test_463_the_general_person_is_the_one_left_idle(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        before = self.plan()
        self.assertEqual(self.day(before, SAT)["free"], {"علی": 1.0})          # به ترتیبِ نام، آخری بی‌کار می‌ماند
        for who in ("حسن", "رضا", "علی"):
            self.general(who)
            d = self.plan()
            self.assertEqual(self.day(d, SAT)["free"], {who: 1.0}, who)
            self.assertEqual(self.production(d), self.production(before), who)
            for x in d["days"]:                                                 # هر روز، بی‌کاری اول به او می‌رسد
                self.assertEqual(x["free"].get(who, 0), min(round(sum(x["free"].values()), 2), x["base"] / 8), (who, x["date"]))

    def test_464_ticking_it_never_changes_the_production_plan(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(7)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        Station.objects.create(name="کابین دو", stages=[c.name], crew=2, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a], مینا=[self.a], سارا=[self.a, self.b], نیما=[self.a, c])
        WorkStage.objects.filter(pk__in=[self.b.pk, c.pk]).update(helpers_ok=True)
        for i, area in enumerate((26, 11, 19, 33, 8)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, c: area}, due_date=SAT + W(7 + 2 * i))
        self.leave("مینا", SUN, MON)
        self.leave("رضا", TUE, hours=3)
        self.overtime(WED, 2)
        self.holiday(SAT2)
        before = self.plan()
        base = self.production(before)
        for who in NAMES:
            self.general(who)
            d = self.plan()
            self.assertEqual(self.production(d), base, who)
            self.assertGreaterEqual(self.idle_of(d, who), self.idle_of(before, who), who)
        self.general(*NAMES)
        self.assertEqual(self.strip(self.plan()), self.strip(before))            # همه تیک دارند = هیچ‌کس جلو نمی‌افتد

    def test_465_someone_fixed_to_a_station_keeps_his_place(self):
        self.workers(3)
        Station.objects.create(name="میز", stages=[self.a.name], people=["حسن", "رضا"], order=1)
        self.proj("الف", stages={self.a: 40, self.b: 40})
        before = self.plan()
        self.general("حسن")
        self.assertEqual(self.strip(self.plan()), self.strip(before))

    def test_466_given_wholly_to_general_work_the_rest_take_his_jobs(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        before = self.plan()
        self.assertEqual(self.day(before, SAT)["free"], {"علی": 1.0})
        self.general("حسن")                                                     # حسن که سرِ کارِ تولید بود کنار می‌رود
        self.leave("حسن", SAT, WED, kind="general", note="تعمیر")
        d = self.plan()
        lines = lambda q: [(x["date"], x["lines"]) for x in q["days"]]           # noqa: E731
        self.assertEqual(lines(d), lines(before))                               # همان کارها، همان روزها — با دو نفرِ دیگر
        self.assertEqual([p["finish"] for p in d["projects"]], [p["finish"] for p in before["projects"]])
        self.assertEqual(self.day(d, SAT)["free"], {})
        self.assertEqual(self.day(d, SAT)["away"], [{"name": "حسن", "hours": None, "kind": "general"}])
        self.assertEqual(self.day(d, SAT)["fill"], [])

    def ask(self, who, first, last, hours=None):
        """«اگر این نفر در این روزها کارِ عمومی کند؟» — همان حسابی که صفحه پیش از ثبت نشان می‌دهد."""
        return planning.what_if_custom({"general": {"employee": who, "from": first.isoformat(), "to": last.isoformat(),
                                                    "hours": hours}}, today=SAT)

    def test_467_before_giving_the_page_says_whether_the_plan_slips(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        ok = self.ask("حسن", SAT, THU)
        self.assertEqual((ok["result"]["endGain"], ok["result"]["projects"], ok["result"]["late"]), (0, [], 0))
        self.assertEqual(ok["result"]["finish"], ok["now"]["finish"])
        self.assertEqual(ok["result"]["finish"], self.plan()["totals"]["finish"])
        self.assertIn("«حسن»", ok["result"]["label"])
        self.assertIn("کلِ روز کارِ عمومی", ok["result"]["label"])
        r = self.post("plan-what-if", {"general": {"employee": "حسن", "from": SAT.isoformat(), "to": THU.isoformat()}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(PlanLeave.objects.exists())                             # فقط حساب است؛ چیزی ثبت نشد
        self.assertFalse(PlanChange.objects.exists())

    def test_468_and_it_says_so_when_the_rest_cannot_cover(self):
        self.proj("الف", stages={self.a: 30}, due_date=WED)
        self.proj("ب", stages={self.b: 30})
        now = self.plan()
        bad = self.ask("علی", SAT, TUE)
        self.assertLess(bad["result"]["endGain"], 0)
        self.assertTrue(all(g["gain"] < 0 for g in bad["result"]["projects"]) and bad["result"]["projects"])
        self.assertGreaterEqual(bad["result"]["late"], bad["now"]["late"])
        self.assertEqual(bad["now"]["finish"], now["totals"]["finish"])
        # همان که می‌گوید، پس از ثبت همان می‌شود
        self.leave("علی", SAT, TUE, kind="general")
        after = self.plan()
        self.assertEqual(after["totals"]["finish"], bad["result"]["finish"])
        self.assertGreater(after["totals"]["finish"], now["totals"]["finish"])
        self.assertEqual({p["id"]: p["finish"] for p in after["projects"]},
                         {**{p["id"]: p["finish"] for p in now["projects"]}, **{g["id"]: g["finish"] for g in bad["result"]["projects"]}})

    def test_469_a_few_hours_a_day_and_bad_requests(self):
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        day = {"from": SAT.isoformat(), "to": TUE.isoformat()}
        whole, part = self.ask("علی", SAT, TUE), self.ask("علی", SAT, TUE, hours=2)
        self.assertLess(whole["result"]["endGain"], part["result"]["endGain"])
        self.assertIn("روزی ۲ ساعت", part["result"]["label"])
        self.leave("علی", SAT, TUE, kind="general", hours=2)
        self.assertEqual(self.plan()["totals"]["finish"], part["result"]["finish"])
        for body in ({"employee": "نیست", **day}, {"employee": "علی", "from": "x"}, {"employee": "علی", "hours": 20, **day},
                     {"employee": "علی", "hours": "y", **day}, {"employee": "علی", "from": TUE.isoformat(), "to": SAT.isoformat()},
                     {"employee": "علی", "from": SAT.isoformat(), "to": (SAT + D(2027, 1, 1).resolution * 90).isoformat()}, "x"):
            self.assertEqual(self.post("plan-what-if", {"general": body}).status_code, 400, body)

    def test_470_the_general_person_with_idle_time_work_gets_the_most_of_it(self):
        self.workers(4)
        self.proj("الف", stages={self.a: 40})
        self.proj("ب", stages={self.b: 24})
        before = self.plan()
        self.general("حسن")
        self.fill("حسن", SAT, SAT2)
        d = self.plan()
        self.assertEqual(self.production(d), self.production(before))
        given = sum(f["hours"] for x in d["days"] for f in x["fill"])
        self.assertEqual(given, round(sum(min(sum(x["free"].values()), x["base"] / 8) for x in before["days"]
                                          if x["date"] <= SAT2) * 8, 1))

    # ---------- استادکار کارِ عمومی نمی‌گیرد ----------

    def painters(self):
        """علی نقاش است (مرحلهٔ کمکی‌بگیر را انجام می‌دهد)، رضا و حسن کارگرِ پرداخت."""
        self.workers(3)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        self.skill(علی=[self.b], رضا=[self.a], حسن=[self.a])
        WorkStage.objects.filter(pk=self.b.pk).update(helpers_ok=True)

    def test_471_a_master_is_never_given_general_work(self):
        self.painters()
        self.proj("الف", stages={self.a: 20, self.b: 40})
        before = self.plan()
        self.assertEqual((before["masters"], before["generalPeople"]), (["علی"], []))
        r = self.post("plan-skills", {"skills": {"علی": [self.b.name], "رضا": [self.a.name], "حسن": [self.a.name]},
                                      "general": ["علی", "رضا"]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["generalPeople"], r.json()["masters"]), (["رضا"], ["علی"]))
        self.assertFalse(Employee.objects.get(name="علی").plan_general)
        bad = self.post("plan-leave", {"employee": "علی", "from": SAT.isoformat(), "kind": "fill", "open": True})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("استادکار", bad.content.decode())
        self.assertFalse(PlanLeave.objects.exists())
        self.assertEqual(self.production(self.plan()), self.production(before))

    def test_472_a_tick_left_on_someone_who_became_a_master_counts_for_nothing(self):
        self.painters()
        self.general("رضا")
        self.fill("رضا", SAT, open=True)
        self.proj("الف", stages={self.a: 12, self.b: 40})
        self.assertEqual(self.plan()["generalPeople"], ["رضا"])
        Employee.objects.filter(name="رضا").update(plan_stages=[self.a.name, self.b.name], plan_general=True)   # حالا رنگ هم می‌زند
        d = self.plan()
        self.assertEqual((d["masters"], d["generalPeople"]), (["رضا", "علی"], []))
        self.skill(علی=[self.b], رضا=[self.a, self.b], حسن=[self.a])                                       # ذخیرهٔ بعدی تیک را هم برمی‌دارد
        self.assertFalse(Employee.objects.get(name="رضا").plan_general)

    def test_473_when_everyone_can_paint_nobody_is_a_master(self):
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        WorkStage.objects.filter(pk=self.b.pk).update(helpers_ok=True)
        self.proj("الف", stages={self.b: 40})
        self.general("علی")
        d = self.plan()
        self.assertEqual((d["masters"], d["generalPeople"]), ([], ["علی"]))

    # ---------- «تا اطلاعِ بعدی» ----------

    def test_474_general_work_whenever_idle_until_further_notice(self):
        self.proj("الف", stages={self.a: 80})
        who, = self.day(self.plan(), SAT)["free"]
        before = self.plan()
        self.general(who)
        r = self.post("plan-leave", {"employee": who, "from": MON.isoformat(), "kind": "fill", "open": True, "note": "خدمات کارگاه"})
        self.assertEqual(r.status_code, 200, r.content)
        row = PlanLeave.objects.get()
        self.assertEqual((row.date_from, row.date_to, row.kind), (MON, planning.OPEN_END, "fill"))
        self.assertEqual([(lv["from"], lv["open"]) for lv in r.json()["leaves"]], [(MON.isoformat(), True)])
        self.assertIn("تا اطلاعِ بعدی", PlanChange.objects.first().summary)
        d = self.plan()
        self.assertEqual(self.production(d), self.production(before))
        for x in d["days"]:
            want = {who: round(min(x["free"].get(who, 0) * 8, x["base"]), 1)} if x["date"] >= MON and x["free"].get(who) and x["base"] else {}
            self.assertEqual(self.fills(d, x["date"]), want, x["date"])
        self.assertGreater(len([x for x in d["days"] if x["fill"]]), 8)             # هفتهٔ بعد و بعدتر هم
        self.post("plan-undo", {})
        self.assertFalse(PlanLeave.objects.exists())

    def test_475_must_do_general_work_until_further_notice(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 60})
        self.proj("ب", stages={self.b: 60})
        self.leave("حسن", SUN, kind="general", open=True, note="تعمیرِ کمپرسور")
        row = PlanLeave.objects.get()
        self.assertEqual((row.date_from, row.date_to), (SUN, planning.OPEN_END))
        d = self.plan()
        away = {x["date"]: [(a["name"], a["hours"], a["kind"]) for a in x["away"]] for x in d["days"]}
        self.assertEqual(away[SAT], [])
        self.assertTrue(all(v == [("حسن", None, "general")] for day, v in away.items() if day >= SUN))
        self.assertTrue(all("حسن" not in x["free"] for x in d["days"] if x["date"] >= SUN))
        # همان است که یک ردیفِ تاریخ‌دارِ بلند می‌داد
        PlanLeave.objects.all().delete()
        self.leave("حسن", SUN, SUN + D(2026, 1, 1).resolution * 60, kind="general")
        self.assertEqual(self.strip(self.plan()), self.strip(d))
        # مرخصیِ همان روز سرِ جایش است، و چند ساعت در روز هم می‌شود
        PlanLeave.objects.all().delete()
        self.leave("حسن", SUN, kind="general", open=True, hours=3)
        self.leave("حسن", TUE)
        d = self.plan()
        self.assertEqual([a["hours"] for a in self.day(d, MON)["away"]], [3.0])
        self.assertEqual((self.day(d, TUE)["leave"], self.day(d, TUE)["present"]), (["حسن"], 2))

    def test_476_the_page_says_beforehand_what_until_further_notice_does(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 60})
        self.proj("ب", stages={self.b: 60})
        ask = planning.what_if_custom({"general": {"employee": "حسن", "from": SUN.isoformat(), "open": True}}, today=SAT)
        self.assertIn("تا اطلاعِ بعدی", ask["result"]["label"])
        self.assertEqual(ask["result"]["endGain"], 0)                            # دو نفرِ دیگر می‌رسانند
        short = planning.what_if_custom({"general": {"employee": "علی", "from": SAT.isoformat(), "open": True}}, today=SAT)
        self.assertEqual(short["result"]["finish"], ask["result"]["finish"])
        self.workers(2)
        two = planning.what_if_custom({"general": {"employee": "علی", "from": SAT.isoformat(), "open": True}}, today=SAT)
        self.assertLess(two["result"]["endGain"], 0)
        self.leave("علی", SAT, kind="general", open=True)
        self.assertEqual(self.plan()["totals"]["finish"], two["result"]["finish"])
        self.assertFalse(PlanChange.objects.exists())

    def test_477_a_leave_cannot_be_open_ended(self):
        self.leave("علی", SAT, open=True)
        row = PlanLeave.objects.get()
        self.assertEqual((row.kind, row.date_from, row.date_to), ("leave", SAT, SAT))

    def test_478_planned_general_hours_count_the_standing_rows(self):
        self.general("علی", "رضا")
        self.fill("علی", SUN, open=True, hours=2)
        self.leave("رضا", MON, kind="general", open=True)
        cal = planning._Calendar(["علی", "رضا"])
        planned, _ = planning._general_hours(SAT, THU, cal)
        self.assertEqual(dict(planned), {SUN: 2.0, MON: 10.0, TUE: 10.0, WED: 10.0})
        self.assertEqual(cal.day(SAT)["fill"], [])
        self.assertEqual([r[1:] for r in cal.day(D(2027, 3, 1))["fill"]], [("علی", 2.0, "", True)])   # سالِ بعد هم سرِ جایش است


class PeoplePlan(Base):
    """برنامهٔ هر نفر، کارِ عمومی برای کلِ کارگاه، و کارِ مشخص در وقتِ کارِ عمومی (۴۷۹ تا ۴۹۸)."""

    def general(self, *names):
        planning.set_skills({"skills": {}, "general": list(names)}, self.user)

    def fill(self, who, day, to=None, **kw):
        planning.add_leave({"employee": who, "from": day.isoformat(), "to": (to or day).isoformat(), "kind": "fill", **kw},
                           self.user)

    @staticmethod
    def hours(x, who):
        return round(sum(i["hours"] for i in x["people"].get(who, [])), 1)

    def consistent(self, d):
        """ساعتِ نفرات با کارهای همان روز می‌خواند: هیچ‌کس بیش از روزش کار ندارد و جمعِ ساعتِ هر کار همان نفر-روزِ آن است."""
        for x in d["days"]:
            day_hours = x["base"] + x["overtime"]
            jobs = defaultdict(float)
            for who, items in x["people"].items():
                self.assertIn(who, d["employees"])
                self.assertNotIn(who, x["leave"], (x["date"], who))
                self.assertLessEqual(self.hours(x, who), day_hours + 0.11, (x["date"], who))
                self.assertLessEqual(self.hours(x, who) + x["free"].get(who, 0) * 8, day_hours + 0.11, (x["date"], who))
                for i in items:
                    self.assertGreater(i["hours"], 0)
                    self.assertIn(i["role"], ("", "lead", "help"))
                    jobs[(i["projectId"], i["stage"], i["kind"])] += i["hours"]
            lines = {(ln["projectId"], ln["stage"]) for ln in x["lines"]}
            setups = {(su["projectId"], su["stage"]) for su in x["setups"]}
            for (pid, stage, kind), h in jobs.items():
                self.assertIn((pid, stage), lines if kind == "job" else setups, (x["date"], stage, kind))
            named = sum(sum(i["hours"] for i in items) for items in x["people"].values()) / 8
            self.assertLessEqual(named, x["used"] + 0.02 * max(len(x["people"]), 1), x["date"])
            if not x["freeExtra"] and not x["over"] and x["overtime"] == 0:
                self.assertAlmostEqual(named, x["used"], delta=0.02 * max(len(x["people"]), 1) + 0.02, msg=str(x["date"]))

    def test_479_each_person_gets_the_job_he_is_planned_on(self):
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        d = self.plan()
        x = self.day(d, SAT)
        self.assertEqual({who: [(i["project"], i["stage"], i["hours"], i["role"], i["kind"]) for i in items]
                          for who, items in x["people"].items()},
                         {"رضا": [("الف", self.a.name, 8.0, "", "job")], "علی": [("ب", self.b.name, 8.0, "", "job")]})
        self.consistent(d)

    def test_480_the_idle_one_has_no_job_that_day(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        d = self.plan()
        x = self.day(d, SAT)
        self.assertEqual(sorted(x["people"]), ["حسن", "رضا"])
        self.assertEqual(x["free"], {"علی": 1.0})
        self.consistent(d)

    def test_481_the_painter_leads_and_the_other_helps(self):
        self.workers(3)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        self.skill(علی=[self.b], رضا=[self.a], حسن=[self.a])
        WorkStage.objects.filter(pk=self.b.pk).update(helpers_ok=True)
        self.proj("الف", stages={self.b: 40})
        d = self.plan()
        x = self.day(d, SAT)
        self.assertEqual({who: [(i["role"], i["hours"]) for i in items] for who, items in x["people"].items()},
                         {"علی": [("lead", 8.0)], "حسن": [("help", 8.0)]})
        self.consistent(d)

    def test_482_a_day_split_between_two_jobs(self):
        self.proj("الف", stages={self.a: 4})
        self.proj("ب", stages={self.a: 30})
        d = self.plan()
        who, = self.day(d, SAT)["people"]
        self.assertEqual([(i["project"], i["hours"]) for i in self.day(d, SAT)["people"][who]], [("الف", 4.0), ("ب", 4.0)])
        self.consistent(d)

    def test_483_leave_and_half_days_show_in_the_hours(self):
        self.proj("الف", stages={self.a: 60})
        self.proj("ب", stages={self.b: 60})
        self.leave("علی", SUN)
        self.leave("رضا", MON, hours=3)
        self.overtime(TUE, 2)
        d = self.plan()
        self.assertNotIn("علی", self.day(d, SUN)["people"])
        self.assertEqual(self.hours(self.day(d, MON), "رضا"), 5.0)
        self.assertEqual(self.hours(self.day(d, TUE), "علی"), 10.0)
        self.assertEqual(self.hours(self.day(d, THU), "علی"), 4.0)
        self.consistent(d)

    def test_484_washing_the_booth_is_on_his_sheet_too(self):
        planning.set_colors({"stages": {self.a.name: 2}}, self.user)
        x, y = self.proj("یک", stages={self.a: 4}), self.proj("دو", stages={self.a: 40})
        planning.set_colors({"projects": {str(x.pk): "سفید", str(y.pk): "مشکی"}}, self.user)
        self.ordered(x, y)
        d = self.plan()
        who, = self.day(d, SAT)["people"]
        self.assertEqual([(i["project"], i["kind"], i["hours"]) for i in self.day(d, SAT)["people"][who]],
                         [("یک", "job", 4.0), ("دو", "setup", 2.0), ("دو", "job", 2.0)])
        self.consistent(d)

    def test_485_people_with_a_fixed_station(self):
        Station.objects.create(name="میز", stages=[self.a.name], people=["علی"], order=1)
        self.proj("الف", stages={self.a: 30, self.b: 30})
        d = self.plan()
        self.assertEqual([i["stage"] for i in self.day(d, SAT)["people"]["علی"]], [self.a.name])
        self.consistent(d)

    def test_486_a_long_mixed_run_adds_up_for_everyone(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(6)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        Station.objects.create(name="کابین دو", stages=[c.name], crew=3, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a], مینا=[self.a], سارا=[self.a], نیما=[self.a])
        WorkStage.objects.filter(pk__in=[self.b.pk, c.pk]).update(helpers_ok=True)
        for i, area in enumerate((30, 14, 22, 9, 17)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, c: area}, due_date=SAT + W(8 + 3 * i))
        self.leave("حسن", SUN)
        self.leave("علی", TUE, hours=4)
        self.leave("مینا", MON, WED, kind="general", hours=2)
        self.general("سارا", "نیما")
        self.fill("سارا", SAT, open=True)
        for today in (SAT, MON, THU):
            d = self.plan(today)
            self.consistent(d)
            for x in d["days"]:
                for f in x["fill"]:                                    # کارِ عمومی فقط در وقتی که کارِ پروژه ندارد
                    self.assertLessEqual(self.hours(x, f["name"]) + f["hours"], x["base"] + x["overtime"] + 0.11)

    # ---------- کلِ کارگاه ----------

    def test_487_must_do_general_work_for_the_whole_workshop(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 60})
        self.proj("ب", stages={self.b: 60})
        before = self.plan()
        r = self.post("plan-leave", {"employee": "*", "from": MON.isoformat(), "to": MON.isoformat(), "kind": "general",
                                     "hours": 3, "note": "نظافتِ عمومی"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([(lv["employee"], lv["kind"], lv["hours"]) for lv in r.json()["leaves"]], [("*", "general", 3.0)])
        self.assertIn("کلِ کارگاه", PlanChange.objects.first().summary)
        d = self.plan()
        x = self.day(d, MON)
        self.assertEqual(sorted((a["name"], a["hours"], a["kind"]) for a in x["away"]),
                         [(n, 3.0, "general") for n in ("حسن", "رضا", "علی")])
        self.assertEqual((x["everyone"], x["pool"], x["present"]), (3.0, round(3 * 5 / 8, 2), 3))
        self.assertEqual((self.day(d, SUN)["everyone"], self.day(d, SUN)["away"]), (None, []))
        self.assertEqual(self.hours(x, "رضا"), 5.0)
        self.assertGreaterEqual(d["totals"]["finish"], before["totals"]["finish"])
        self.consistent(d)

    def test_488_a_whole_day_for_everyone_and_until_further_notice(self):
        self.proj("الف", stages={self.a: 30})
        self.leave("*", TUE, kind="general", note="آموزش")
        d = self.plan()
        self.assertEqual((self.day(d, TUE)["everyone"], self.day(d, TUE)["lines"], self.day(d, TUE)["present"]), (0, [], 2))
        self.leave("*", SAT2, kind="general", open=True, hours=1, note="نظافتِ آخرِ روز")
        d = self.plan(SAT2)
        self.assertTrue(all(x["everyone"] == 1.0 for x in d["days"]))
        self.assertTrue(all(self.hours(x, who) <= x["base"] - 1 + 0.11 for x in d["days"] for who in x["people"] if not x["overtime"]))

    def test_489_a_leave_for_everyone_is_refused(self):
        r = self.post("plan-leave", {"employee": "*", "from": MON.isoformat(), "to": MON.isoformat()})
        self.assertEqual(r.status_code, 400)
        self.assertIn("تعطیلات", r.content.decode())

    def test_490_idle_time_work_for_whoever_has_the_skill(self):
        self.workers(4)
        self.proj("الف", stages={self.a: 60})
        r = self.post("plan-leave", {"employee": "*", "from": SAT.isoformat(), "kind": "fill", "open": True, "note": "مرتب‌کردن"})
        self.assertEqual(r.status_code, 400)                                   # هنوز کسی مهارتش را ندارد
        self.general("حسن", "علی")
        before = self.plan()
        self.fill("*", SAT, WED, note="مرتب‌کردن")
        d = self.plan()
        self.assertEqual([(x["date"], x["lines"], x["free"], x["used"]) for x in d["days"]],
                         [(x["date"], x["lines"], x["free"], x["used"]) for x in before["days"]])
        for x in d["days"]:
            want = {n: round(v * 8, 1) for n, v in x["free"].items() if n in ("حسن", "علی")} if x["date"] <= WED else {}
            self.assertEqual({f["name"]: f["hours"] for f in x["fill"]}, want, x["date"])
        self.assertTrue(any(len(x["fill"]) == 2 for x in d["days"]))

    def test_491_the_whole_workshop_in_a_what_if(self):
        self.proj("الف", stages={self.a: 30}, due_date=WED)
        self.proj("ب", stages={self.b: 30})
        ask = planning.what_if_custom({"general": {"employee": "*", "from": SUN.isoformat(), "to": MON.isoformat()}}, today=SAT)
        self.assertIn("کلِ کارگاه", ask["result"]["label"])
        self.assertLess(ask["result"]["endGain"], 0)
        self.leave("*", SUN, MON, kind="general")
        self.assertEqual(self.plan()["totals"]["finish"], ask["result"]["finish"])
        open_ = planning.what_if_custom({"general": {"employee": "*", "from": SUN.isoformat(), "open": True, "hours": 2}}, today=SAT)
        self.assertLessEqual(open_["result"]["endGain"], 0)

    # ---------- کارِ مشخص در وقتِ کارِ عمومی ----------

    def test_492_a_dated_task_comes_before_the_standing_one(self):
        self.proj("الف", stages={self.a: 80})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, SAT, open=True, note="خدمات کارگاه")
        self.fill(who, MON, hours=3, note="سرویسِ کمپرسور")
        self.fill(who, TUE, note="نظافتِ انبار")
        d = self.plan()
        notes = lambda day: [(f["note"], f["hours"]) for f in self.day(d, day)["fill"]]          # noqa: E731
        self.assertEqual(notes(SUN), [("خدمات کارگاه", 8.0)])
        self.assertEqual(notes(MON), [("سرویسِ کمپرسور", 3.0), ("خدمات کارگاه", 5.0)])
        self.assertEqual(notes(TUE), [("نظافتِ انبار", 8.0)])                     # کارِ بی‌سقفِ آن روز همهٔ وقت را می‌گیرد
        self.assertEqual(notes(WED), [("خدمات کارگاه", 8.0)])

    def test_493_editing_a_task_replaces_it_in_one_step(self):
        self.proj("الف", stages={self.a: 80})
        who, = self.day(self.plan(), SAT)["free"]
        self.general(who)
        self.fill(who, MON, hours=3, note="سرویسِ کمپرسور")
        row = PlanLeave.objects.get()
        PlanChange.objects.all().delete()
        r = self.post("plan-leave", {"replace": str(row.pk), "employee": who, "from": TUE.isoformat(), "to": WED.isoformat(),
                                     "kind": "fill", "hours": 2, "note": "سرویسِ پمپ"})
        self.assertEqual(r.status_code, 200, r.content)
        new = PlanLeave.objects.get()
        self.assertEqual((new.date_from, new.date_to, float(new.hours), new.note), (TUE, WED, 2.0, "سرویسِ پمپ"))
        self.assertEqual(PlanChange.objects.count(), 1)
        self.assertTrue(PlanChange.objects.get().summary.startswith("ویرایش: "))
        self.post("plan-undo", {})
        old = PlanLeave.objects.get()
        self.assertEqual((old.date_from, old.note), (MON, "سرویسِ کمپرسور"))

    def test_494_a_bad_edit_leaves_the_old_task_alone(self):
        self.general("علی")
        self.fill("علی", MON, note="سرویس")
        row = PlanLeave.objects.get()
        for bad in ({"employee": "رضا", "from": TUE.isoformat(), "kind": "fill"}, {"employee": "علی", "from": "x", "kind": "fill"},
                    {"employee": "علی", "from": TUE.isoformat(), "kind": "fill", "hours": 40}):
            r = self.post("plan-leave", {"replace": str(row.pk), **bad})
            self.assertEqual(r.status_code, 400, bad)
            self.assertEqual(PlanLeave.objects.get().pk, row.pk)

    def test_495_must_do_changed_to_idle_time_gives_the_capacity_back(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 60})
        self.proj("ب", stages={self.b: 60})
        before = self.plan()
        self.general("حسن")
        self.leave("حسن", SAT, WED, kind="general", note="تعمیر")
        row = PlanLeave.objects.get()
        planning.add_leave({"replace": row.pk, "employee": "حسن", "from": SAT.isoformat(), "to": WED.isoformat(), "kind": "fill",
                            "note": "تعمیر"}, self.user)
        d = self.plan()
        self.assertEqual(PlanLeave.objects.get().kind, "fill")
        self.assertEqual([(x["date"], x["lines"]) for x in d["days"]], [(x["date"], x["lines"]) for x in before["days"]])

    def test_496_the_sheet_of_someone_set_aside_for_must_do_work(self):
        self.workers(3)
        self.proj("الف", stages={self.a: 60})
        self.proj("ب", stages={self.b: 60})
        self.leave("حسن", SUN, MON, kind="general", note="تعمیرِ کمپرسور")
        d = self.plan()
        for day in (SUN, MON):
            x = self.day(d, day)
            self.assertNotIn("حسن", x["people"])
            self.assertEqual([(a["name"], a["kind"]) for a in x["away"]], [("حسن", "general")])
            self.assertEqual(sorted(x["people"]), ["رضا", "علی"])
        self.assertIn("حسن", self.day(d, SAT)["people"])
        self.consistent(d)

    def test_497_the_preview_of_an_edit_counts_the_old_task_out(self):
        self.proj("الف", stages={self.a: 30}, due_date=WED)
        self.proj("ب", stages={self.b: 30})
        free = self.plan()["totals"]["finish"]
        self.leave("علی", SAT, TUE, kind="general", note="تعمیر")
        row = PlanLeave.objects.get()
        now = self.plan()["totals"]["finish"]
        self.assertGreater(now, free)
        ask = lambda **kw: planning.what_if_custom({"general": {"employee": "علی", "replace": str(row.pk), **kw}}, today=SAT)   # noqa: E731
        same = ask(**{"from": SAT.isoformat(), "to": TUE.isoformat()})
        self.assertEqual((same["result"]["finish"], same["result"]["endGain"]), (now, 0))        # همان ردیف: چیزی عوض نمی‌شود
        shorter = ask(**{"from": SAT.isoformat(), "to": SAT.isoformat()})
        self.assertGreater(shorter["result"]["endGain"], 0)                                     # کوتاه‌تر: برنامه جلو می‌آید
        planning.add_leave({"replace": row.pk, "employee": "علی", "from": SAT.isoformat(), "to": SAT.isoformat(), "kind": "general",
                            "note": "تعمیر"}, self.user)
        self.assertEqual(self.plan()["totals"]["finish"], shorter["result"]["finish"])
        self.assertEqual(PlanLeave.objects.count(), 1)

    def test_498_asking_about_an_edit_changes_nothing(self):
        self.proj("الف", stages={self.a: 30})
        self.leave("علی", SAT, TUE, kind="general", note="تعمیر")
        row = PlanLeave.objects.get()
        r = self.post("plan-what-if", {"general": {"employee": "علی", "from": SAT.isoformat(), "to": SUN.isoformat(), "replace": str(row.pk)}})
        self.assertEqual(r.status_code, 200, r.content)
        again = PlanLeave.objects.get()
        self.assertEqual((again.pk, again.date_from, again.date_to), (row.pk, SAT, TUE))
        self.assertFalse(PlanChange.objects.exists())
