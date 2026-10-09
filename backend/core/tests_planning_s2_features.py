"""سناریوهای تازهٔ برنامه‌ریزی تولید — یازده قابلیتِ تازه، «کمکی» و «خدمات عمومی» و برنامهٔ نفرات، سرکارگر و تیکِ کار عمومی (۳۴۴ تا ۵۲۷):
خرابیِ ایستگاه، تاریخ شروعِ پروژه، «چرا اینجاست؟»، زنجیرهٔ بحرانی، تاریخچه و برگرداندن، «اگر…»های بیشتر، ترتیبِ بهتر،
مواد، مهارتِ نفرات، تعویض رنگ، و دوباره‌کاری."""
from collections import defaultdict
from decimal import Decimal

from rest_framework.exceptions import ValidationError

from .models import (PlanChange, PlanHoliday, PlanLeave, PlanOvertime, PlanRework, PlanStationOff, PlanTask, Product, Sku,
                     StockMovement, User, Warehouse)
from . import production
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

    @staticmethod
    def tasks(x):
        """کارهای عمومیِ مشخصی که ردیف دارند (نه وقتِ آزادِ مانده که تیکِ «کار عمومی» خودش پر می‌کند)."""
        return [f for f in x["fill"] if not f.get("auto")] if x else []

    def fills(self, d, day, auto=False):
        """جمعِ ساعتِ کارِ عمومیِ هر نفر در یک روز: فقط کارهای مشخص، یا با auto همهٔ وقتِ آزادش."""
        out = {}
        x = self.day(d, day)
        for f in ((x or {"fill": []})["fill"] if auto else self.tasks(x)):
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
        self.assertIn("کار عمومی", PlanChange.objects.get().summary)
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
            idle = {n: round(v * 8, 1) for n, v in x["free"].items()}
            self.assertEqual(self.fills(after, x["date"]), idle if x["date"] <= SAT2 else {}, x["date"])
            self.assertEqual(self.fills(after, x["date"], auto=True), idle, x["date"])      # با تیک، همهٔ وقتِ آزاد کارِ عمومی است
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
        self.assertEqual([(f["hours"], f["note"]) for f in self.tasks(self.day(d, SAT))], [(2.0, "نظافت"), (3.0, "تعمیر")])
        self.assertEqual([(f["hours"], f["note"]) for f in self.tasks(self.day(d, SUN))], [(2.0, "نظافت"), (6.0, "نظافت")])
        self.assertEqual((self.fills(d, SAT), self.fills(d, SUN)), ({who: 5.0}, {who: 8.0}))
        self.assertEqual(len({f["id"] for x in d["days"] for f in self.tasks(x)}), 4)   # هر ردیف با شناسهٔ خودش
        self.assertEqual([(f["hours"], f["id"]) for f in self.day(d, SAT)["fill"][2:]], [(3.0, f"auto:{who}")])   # بقیهٔ روز

    def test_454_the_tile_counts_idle_time_and_what_was_given(self):
        self.proj("الف", stages={self.a: 40})
        d = self.plan()
        who, = self.day(d, SAT)["free"]
        idle = d["totals"]["idle"]
        self.assertEqual((d["totals"]["filled"], d["loadDays"], d["generalPeople"]), (0.0, 12, []))
        self.assertGreater(idle, 2)
        self.general(who)
        d = self.plan()
        self.assertEqual((d["totals"]["idle"], d["totals"]["filled"], d["generalPeople"]), (idle, idle, [who]))   # تیک کافی است
        self.fill(who, SAT, SUN)
        d = self.plan()
        self.assertEqual((d["totals"]["idle"], d["totals"]["filled"], d["generalPeople"]), (idle, idle, [who]))
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
        planned, _, allowed = planning._general_hours(SAT, TUE, cal)
        self.assertEqual(dict(planned), {SAT: 10.0, SUN: 3.0})
        # هر دو تیکِ «کار عمومی» دارند: ساعتِ عادی‌شان (منهای کارِ واجبِ همان روز) هر وقت آزاد باشند کارِ عمومی است
        self.assertEqual(dict(allowed), {SAT: 14.0, SUN: 16.0, MON: 16.0})

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
                    if f["name"] == "مینا" and not f.get("auto"):
                        self.assertLessEqual(f["hours"], 4.0)
                    given += f["hours"]
                for who in ("حسن", "مینا", "سارا"):                    # با تیک، همهٔ وقتِ آزادِ عادی‌اش کارِ عمومی است
                    took = sum(f["hours"] for f in x["fill"] if f["name"] == who)
                    self.assertAlmostEqual(took, min(x["free"].get(who, 0) * 8, x["base"]), delta=0.11, msg=str((x["date"], who)))
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
        given = sum(f["hours"] for x in d["days"] for f in self.tasks(x))
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
        self.assertGreater(len([x for x in d["days"] if self.tasks(x)]), 8)         # هفتهٔ بعد و بعدتر هم
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
        planned, _, allowed = planning._general_hours(SAT, THU, cal)
        self.assertEqual(dict(planned), {SUN: 2.0, MON: 10.0, TUE: 10.0, WED: 10.0})
        self.assertEqual(dict(allowed), {SAT: 16.0, SUN: 16.0, MON: 8.0, TUE: 8.0, WED: 8.0})
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
                self.assertLessEqual(self.hours(x, who) + x["free"].get(who, 0) * 8, day_hours + 0.06 + 0.05 * len(items),
                                     (x["date"], who))                 # هر ردیف تا یک رقم گرد شده است
                for i in items:
                    self.assertGreater(i["hours"], 0)
                    self.assertIn(i["role"], ("", "lead", "help"))
                    jobs[(i["projectId"], i["stage"], i["kind"])] += i["hours"]
            lines = {(ln["projectId"], ln["stage"]) for ln in x["lines"]}
            setups = {(su["projectId"], su["stage"]) for su in x["setups"]}
            for (pid, stage, kind), h in jobs.items():
                if kind in ("site", "sitetime"):                     # کارِ محلِ پروژه خطِ ایستگاه ندارد
                    self.assertIn(pid, [t["projectId"] for t in x["siteTeams"]], (x["date"], stage, kind))
                    continue
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
            want = {n: round(v * 8, 1) for n, v in x["free"].items() if n in ("حسن", "علی")}
            named = {f["name"]: f["hours"] for f in x["fill"] if not f.get("auto")}
            self.assertEqual(named, want if x["date"] <= WED else {}, x["date"])
            self.assertEqual({f["name"]: f["hours"] for f in x["fill"]}, want, x["date"])
            self.assertEqual({f["note"] for f in x["fill"]}, ({"مرتب‌کردن"} if x["date"] <= WED else {""}) if want else set(), x["date"])
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


class Foreman(Base):
    """سرکارگر (فقط یک نفر): رنگ رویه را تا جایی که وقت دارد او می‌زند، بعد رنگ‌کارِ بعدی؛ و اگر برای همهٔ استادکارها کار
    نبود، کسی که آزاد می‌ماند اوست. قاعده ثابت است (رویه = مرحله‌ای که foreman_first دارد)؛ فقط خودِ سرکارگر عوض می‌شود.
    فقط «چه کسی» جابه‌جا می‌شود؛ برنامهٔ تولید همان می‌ماند (۴۹۹ تا ۵۱۷)."""

    hours = staticmethod(PeoplePlan.hours)
    consistent = PeoplePlan.consistent

    def setUp(self):
        super().setUp()
        # علی و رضا رنگ‌کارند (همه‌کاره)، حسن و مینا کارگرِ پرداخت. «آستر» (b) و «رویه» (top) هر دو کابینِ دونفره و کمکی‌بگیرند.
        self.top = self.stage("رویهٔ آزمایشی", 3, hpm=2)
        self.workers(4)
        Station.objects.create(name="کابین آستر", stages=[self.b.name], crew=2, order=1)
        Station.objects.create(name="کابین رویه", stages=[self.top.name], crew=2, order=2)
        self.skill(حسن=[self.a], مینا=[self.a])
        WorkStage.objects.filter(pk__in=[self.b.pk, self.top.pk]).update(helpers_ok=True)
        WorkStage.objects.filter(pk=self.top.pk).update(foreman_first=True)      # «رویه» کارِ سرکارگر است (مثلِ رنگ رویه)

    def boss(self, *names, stages=None):
        """سرکارگر را می‌گذارد. stages فقط برای آزمودنِ خودِ قاعده است؛ در صفحه چنین تنظیمی نیست."""
        planning.set_skills({"skills": {}, "foremen": list(names)}, self.user)
        if stages is not None:
            WorkStage.objects.update(foreman_first=False)
            WorkStage.objects.filter(pk__in=[s.pk for s in stages]).update(foreman_first=True)

    @staticmethod
    def lead_of(x, stage):
        """{نام: ساعت} برای نفرِ اصلیِ این مرحله در یک روزِ برنامه."""
        out = {}
        for who, items in x["people"].items():
            h = sum(i["hours"] for i in items if i["stage"] == stage.name and i["role"] == "lead")
            if h:
                out[who] = round(h, 1)
        return out

    def lead(self, d, day, stage):
        return self.lead_of(self.day(d, day), stage)

    @staticmethod
    def production(d):
        return ([(x["date"], x["lines"], x["used"], x["pool"], round(sum(x["free"].values()), 2), x["fill"]) for x in d["days"]],
                [(p["name"], p["finish"]) for p in d["projects"]])

    def two_jobs(self):
        x, y = self.proj("آستری", stages={self.b: 40}), self.proj("رویه‌ای", stages={self.top: 40})
        self.ordered(x, y)

    def test_499_the_foreman_sprays_the_top_coat(self):
        self.two_jobs()
        before = self.plan()
        self.assertEqual((self.lead(before, SAT, self.b), self.lead(before, SAT, self.top)), ({"رضا": 8.0}, {"علی": 8.0}))
        self.boss("رضا")
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.b), self.lead(d, SAT, self.top)), ({"علی": 8.0}, {"رضا": 8.0}))
        self.assertEqual(self.production(d), self.production(before))
        self.assertEqual((d["foremen"], d["primeStages"]), (["رضا"], [self.top.name]))
        self.consistent(d)

    def test_500_no_preference_on_the_other_stages(self):
        self.two_jobs()
        self.boss("علی", stages=[])                                            # سرکارگر هست، ولی مرحله‌ای اولویت ندارد
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.b), self.lead(d, SAT, self.top)), ({"رضا": 8.0}, {"علی": 8.0}))
        self.boss(stages=[self.top])                                            # مرحله اولویت دارد، ولی سرکارگری نیست
        self.assertEqual(self.lead(self.plan(), SAT, self.top), {"علی": 8.0})

    def test_501_when_the_foreman_is_away_the_next_painter_does_it(self):
        y, x = self.proj("رویه‌ای", stages={self.top: 60}), self.proj("آستری", stages={self.b: 60})
        self.ordered(y, x)
        self.leave("علی", SUN)
        self.leave("علی", MON, hours=4)
        before = self.plan()
        self.assertEqual(self.lead(before, MON, self.top), {"رضا": 8.0})         # بی سرکارگر: به ترتیبِ نام
        self.boss("علی")
        d = self.plan()
        self.assertEqual(self.lead(d, SAT, self.top), {"علی": 8.0})
        self.assertEqual(self.lead(d, SUN, self.top), {"رضا": 8.0})               # سرکارگر نیست: نفرِ بعدی
        self.assertEqual(self.lead(d, MON, self.top), {"علی": 4.0, "رضا": 4.0})   # تا جایی که هست خودش؛ بقیه با نفرِ بعدی
        self.assertEqual(self.lead(d, MON, self.b), {"رضا": 4.0})
        self.assertEqual(self.lead(d, TUE, self.top), {"علی": 8.0})
        self.assertEqual(self.production(d), self.production(before))
        self.consistent(d)

    def test_502_his_idle_time_goes_to_the_top_coat_first(self):
        self.proj("رویه‌ای", stages={self.top: 40})
        before = self.plan()
        self.assertEqual((self.lead(before, SAT, self.top), self.day(before, SAT)["free"].get("علی")), ({"رضا": 8.0}, 1.0))
        self.boss("علی")
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.top), self.day(d, SAT)["free"].get("رضا")), ({"علی": 8.0}, 1.0))
        self.assertNotIn("علی", self.day(d, SAT)["free"])
        self.assertEqual(self.production(d), self.production(before))
        self.consistent(d)

    def test_503_a_swap_only_with_someone_who_can_take_his_job(self):
        self.skill(حسن=[self.a], مینا=[self.a], علی=[self.top])                 # علی فقط رویه می‌زند؛ رضا همه‌کاره است
        self.two_jobs()
        before = self.plan()
        self.assertEqual((self.lead(before, SAT, self.b), self.lead(before, SAT, self.top)), ({"رضا": 8.0}, {"علی": 8.0}))
        self.boss("رضا")                                                        # اگر رضا رویه بزند، آستر بی نفرِ اصلی می‌ماند
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.b), self.lead(d, SAT, self.top)), ({"رضا": 8.0}, {"علی": 8.0}))
        self.assertEqual(self.production(d), self.production(before))
        self.skill(حسن=[self.a], مینا=[self.a], علی=[self.b, self.top])         # حالا علی آستر هم می‌زند: جایشان عوض می‌شود
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.b), self.lead(d, SAT, self.top)), ({"علی": 8.0}, {"رضا": 8.0}))
        self.consistent(d)

    def test_504_through_the_page_and_taken_back(self):
        r = self.post("plan-skills", {"skills": {}, "foremen": ["نیست"]})                         # نامِ ناشناس کاری نمی‌کند
        self.assertEqual((r.status_code, r.json()["foremen"]), (200, []))
        PlanChange.objects.all().delete()
        r = self.post("plan-skills", {"skills": {}, "foremen": ["رضا"]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["foremen"], r.json()["primeStages"]), (["رضا"], [self.top.name]))
        self.assertTrue(Employee.objects.get(name="رضا").plan_foreman)
        self.assertIn("سرکارگر: رضا", PlanChange.objects.first().summary)
        for bad in ({"skills": {}, "foremen": "x"}, {"skills": {}, "foremen": [3]}, {"skills": {}, "foremen": ["رضا", "علی"]}):
            self.assertEqual(self.post("plan-skills", bad).status_code, 400, bad)             # سرکارگر فقط یک نفر است
        self.assertEqual(self.post("plan-skills", {"skills": {}}).status_code, 200)          # بی این فهرست: دست نمی‌خورد
        self.assertTrue(Employee.objects.get(name="رضا").plan_foreman)
        r = self.post("plan-skills", {"skills": {}, "foremen": ["علی"]})                       # سرکارگر عوض می‌شود
        self.assertEqual(sorted(Employee.objects.filter(plan_foreman=True).values_list("name", flat=True)), ["علی"])
        self.post("plan-undo", {})
        self.assertEqual(sorted(Employee.objects.filter(plan_foreman=True).values_list("name", flat=True)), ["رضا"])
        self.assertTrue(WorkStage.objects.get(pk=self.top.pk).foreman_first)                   # قاعده با برگرداندن دست نمی‌خورد

    def test_505_a_stage_without_helpers_too(self):
        WorkStage.objects.update(helpers_ok=False)
        Station.objects.filter(name="کابین رویه").update(crew=1)
        Station.objects.filter(name="کابین آستر").update(crew=1)
        self.skill(حسن=[self.a], مینا=[self.a])
        self.two_jobs()
        before = self.plan()
        who = lambda d, stage: {n: sum(i["hours"] for i in items if i["stage"] == stage.name)             # noqa: E731
                                for n, items in self.day(d, SAT)["people"].items() if any(i["stage"] == stage.name for i in items)}
        self.assertEqual(who(before, self.top), {"علی": 8.0})
        self.boss("رضا")
        d = self.plan()
        self.assertEqual((who(d, self.top), who(d, self.b)), ({"رضا": 8.0}, {"علی": 8.0}))
        self.assertEqual(self.production(d), self.production(before))

    def test_506_someone_fixed_to_a_station_is_left_alone(self):
        Station.objects.filter(name="کابین آستر").update(people=["رضا", "حسن"])
        self.two_jobs()
        before = self.plan()
        self.boss("رضا")
        d = self.plan()
        self.assertEqual([x["people"] for x in d["days"]], [x["people"] for x in before["days"]])

    def test_507_two_top_coat_jobs_in_one_day(self):
        x, y = self.proj("یک", stages={self.top: 4}), self.proj("دو", stages={self.top: 40})
        z = self.proj("آستری", stages={self.b: 40})
        self.ordered(x, y, z)
        self.boss("علی")
        d = self.plan()
        self.assertEqual(self.lead(d, SAT, self.top), {"علی": 8.0})
        self.assertEqual(self.lead(d, SAT, self.b), {"رضا": 8.0})
        self.consistent(d)

    def test_508_what_if_and_general_work_still_add_up(self):
        self.two_jobs()
        self.proj("پرداختی", stages={self.a: 30})
        planning.set_skills({"skills": {}, "general": ["حسن"]}, self.user)
        planning.add_leave({"employee": "حسن", "from": SAT.isoformat(), "kind": "fill", "open": True, "note": "خدمات"}, self.user)
        before = self.plan()
        self.boss("رضا")
        d = self.plan()
        self.assertEqual(self.production(d), self.production(before))
        self.assertTrue(planning.what_if(today=SAT)["options"])
        self.assertTrue(planning.what_if_custom({"absent": {"employee": "رضا", "days": 2}}, today=SAT)["result"]["finish"])
        self.consistent(d)

    def test_509_a_busy_fortnight_changes_only_who_does_what(self):
        self.workers(6)
        self.skill(حسن=[self.a], مینا=[self.a], سارا=[self.a], نیما=[self.a])
        for i, area in enumerate((30, 14, 22, 9, 17)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, self.top: area}, due_date=SAT + W(8 + 3 * i))
        self.leave("حسن", SUN)
        self.leave("علی", TUE, hours=4)
        self.leave("رضا", THU)
        self.overtime(WED, 2)
        before = {today: self.plan(today) for today in (SAT, MON, THU)}
        self.boss("رضا")
        moved = 0
        for today in (SAT, MON, THU):
            d = self.plan(today)
            self.assertEqual(self.production(d), self.production(before[today]))
            self.consistent(d)
            for x, was in zip(d["days"], before[today]["days"]):
                mine = self.lead_of(x, self.top)
                moved += mine != self.lead_of(was, self.top)
                # اتاقِ رنگ رویه جای یک رنگ‌کار دارد: جمعِ ساعتِ نفرِ اصلی از ساعتِ همان روز بیشتر نمی‌شود
                self.assertLessEqual(sum(mine.values()), x["base"] + x["overtime"] + 0.11, x["date"])
                others = sum(h for n, h in mine.items() if n != "رضا")
                if others >= 0.2:
                    # نفرِ بعدی فقط وقتی رویه می‌زند که سرکارگر آن روز همهٔ وقتش را سرِ رویه باشد یا نباشد
                    rest = sum(i["hours"] for i in x["people"].get("رضا", []) if not (i["stage"] == self.top.name and i["role"] == "lead"))
                    self.assertLess(rest, 0.2, (x["date"], x["people"]))
                    self.assertLess(x["free"].get("رضا", 0), 0.03, x["date"])
                # و اگر سرکارگر کارِ دیگری جز رویه دارد، رنگ‌کارِ دیگر آن روز وقتِ آزاد ندارد (وگرنه آن کار با او بود)
                other = sum(i["hours"] for i in x["people"].get("رضا", []) if not (i["stage"] == self.top.name and i["role"] == "lead"))
                if other >= 0.2:
                    self.assertLess(x["free"].get("علی", 0), 0.03, (x["date"], x["people"], x["free"]))
        self.assertGreater(moved, 0)

    def test_510_renaming_keeps_the_foreman(self):
        self.two_jobs()
        self.boss("رضا")
        self.user.access = ["production", "production.plan", "dashboard.staff"]
        self.user.save()
        e = Employee.objects.get(name="رضا")
        r = self.api().patch(f"/api/employees/{e.pk}/", {"name": "رضا احمدی"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        d = self.plan()
        self.assertEqual((d["foremen"], self.lead(d, SAT, self.top)), (["رضا احمدی"], {"رضا احمدی": 8.0}))

    def test_511_only_one_person_sprays_the_top_coat_at_a_time(self):
        # اتاقِ رنگ رویه جای یک رنگ‌کار دارد. با سه کارِ رویه و دو رنگ‌کارِ آزاد هم، هر روز فقط یک «نفرِ اصلی» سرِ رویه است
        # (نفرِ دومِ اتاق کمکی است) — و آن یک نفر، هر وقت هست، سرکارگر است.
        for i, area in enumerate((40, 24, 16)):
            self.proj(f"ر{i}", stages={self.top: area})
        self.boss("علی")
        d = self.plan()
        for x in d["days"]:
            sprayers = self.lead_of(x, self.top)
            self.assertLessEqual(sum(sprayers.values()), x["base"] + x["overtime"] + 0.11, x["date"])
            self.assertLessEqual(sum(ln["share"] for ln in x["lines"] if ln["stage"] == self.top.name), 1.03, x["date"])
            self.assertEqual(list(sprayers), ["علی"], x["date"])
            helpers = sum(i["hours"] for items in x["people"].values() for i in items if i["stage"] == self.top.name and i["role"] == "help")
            self.assertLessEqual(helpers, sum(sprayers.values()) + 0.11, x["date"])
        self.assertEqual(self.day(d, SAT)["free"].get("رضا"), 1.0)               # رنگ‌کارِ دوم آن روز سرِ رویه نیست
        self.consistent(d)

    def test_512_overtime_and_a_short_day_keep_it_to_one_sprayer(self):
        jobs = [self.proj(f"ر{i}", stages={self.top: area}) for i, area in enumerate((30, 30))]
        self.ordered(*jobs, self.proj("آستری", stages={self.b: 60}))
        self.boss("رضا")
        self.overtime(SUN, 3)
        self.leave("رضا", MON, hours=5)
        d = self.plan()
        for x in d["days"]:
            self.assertLessEqual(sum(self.lead_of(x, self.top).values()), x["base"] + x["overtime"] + 0.11, x["date"])
        self.assertEqual(self.lead(d, SUN, self.top), {"رضا": 11.0})
        self.assertEqual(self.lead(d, MON, self.top), {"رضا": 3.0, "علی": 5.0})
        self.consistent(d)

    # ---------- اگر برای همه کار نیست، کسی که آزاد می‌ماند سرکارگر است (تا به کارِ بقیه سرکشی کند) ----------

    def test_513_with_one_painting_job_the_foreman_is_the_free_one(self):
        self.proj("آستری", stages={self.b: 40})
        before = self.plan()
        self.assertEqual((self.lead(before, SAT, self.b), self.day(before, SAT)["free"].get("علی")), ({"رضا": 8.0}, 1.0))
        self.boss("رضا")                                                        # رضا سرکارگر است: آستر با علی، رضا آزاد
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.b), self.day(d, SAT)["free"].get("رضا")), ({"علی": 8.0}, 1.0))
        self.assertNotIn("علی", self.day(d, SAT)["free"])
        self.assertEqual(self.production(d), self.production(before))
        self.consistent(d)

    def test_514_but_a_top_coat_job_is_his_even_then(self):
        self.proj("رویه‌ای", stages={self.top: 40})
        self.boss("رضا")
        d = self.plan()
        self.assertEqual((self.lead(d, SAT, self.top), self.day(d, SAT)["free"].get("علی")), ({"رضا": 8.0}, 1.0))

    def test_515_three_painters_and_two_jobs(self):
        self.workers(5)
        self.skill(حسن=[self.a], مینا=[self.a])                                # علی، رضا و سارا رنگ‌کارند
        self.two_jobs()
        before = self.plan()
        self.assertEqual(self.day(before, SAT)["free"], {"علی": 1.0})
        for boss, primer in (("رضا", "سارا"), ("سارا", "رضا"), ("علی", "رضا")):
            self.boss(boss)
            d = self.plan()
            x = self.day(d, SAT)
            self.assertEqual(self.lead_of(x, self.top), {boss: 8.0}, boss)        # رویه با سرکارگر
            self.assertEqual(len(self.lead_of(x, self.b)), 1, boss)
            self.assertNotIn(boss, self.lead_of(x, self.b), boss)
            self.assertEqual(self.production(d), self.production(before), boss)
        self.boss("علی", stages=[])                                             # مرحله‌ای اولویت ندارد: سرکارگر فقط آخر از همه سرِ کار می‌رود
        self.assertEqual(self.day(self.plan(), SAT)["free"], {"علی": 1.0})
        self.boss("رضا", stages=[])
        self.assertEqual(self.day(self.plan(), SAT)["free"], {"رضا": 1.0})

    def test_516_part_of_a_day_free(self):
        self.proj("آستری", stages={self.b: 12})                                 # یک روز و نیم کارِ آستر
        self.proj("رویه‌ای", stages={self.top: 40})
        self.boss("علی")
        d = self.plan()
        self.assertEqual((self.lead(d, SUN, self.top), self.lead(d, SUN, self.b)), ({"علی": 8.0}, {"رضا": 4.0}))
        free = self.day(d, SUN)["free"]                                         # رویه کارِ سرکارگر است؛ پس آن نیم‌روز رضا آزاد می‌ماند
        self.assertEqual((free.get("رضا"), free.get("علی")), (0.5, None))
        self.consistent(d)

    def test_517_someone_with_other_skills_is_not_swapped_in(self):
        self.skill(حسن=[self.a], مینا=[self.a], علی=[self.b, self.top])         # علی فقط رنگ؛ رضا همه‌کاره
        self.proj("آستری", stages={self.b: 40})
        before = self.plan()
        self.boss("علی")
        d = self.plan()
        self.assertEqual([x["people"] for x in d["days"]], [x["people"] for x in before["days"]])
        self.assertEqual([x["free"] for x in d["days"]], [x["free"] for x in before["days"]])


class GeneralTick(Base):
    """«کار عمومی تخصیص داده شود؟» — یک تیک برای هر کارگر: وقتِ خالیِ برنامه به او می‌رسد و در همان وقت کارِ عمومیِ کارگاه
    می‌کند. ردیف و تاریخ نمی‌خواهد (۵۱۸ تا ۵۲۷)."""

    def tick(self, *names):
        planning.set_skills({"skills": {}, "general": list(names)}, self.user)

    @staticmethod
    def auto(x):
        return {f["name"]: f["hours"] for f in x["fill"] if f.get("auto")}

    @staticmethod
    def production(d):
        return ([(x["date"], x["lines"], x["used"], x["pool"], round(sum(x["free"].values()), 2)) for x in d["days"]],
                [(p["name"], p["finish"]) for p in d["projects"]])

    def test_518_the_tick_alone_turns_free_time_into_general_work(self):
        self.proj("الف", stages={self.a: 40})
        before = self.plan()
        who, = self.day(before, SAT)["free"]
        self.assertTrue(all(x["fill"] == [] for x in before["days"]))
        self.tick(who)
        d = self.plan()
        self.assertEqual(self.production(d), self.production(before))
        for x in d["days"]:
            self.assertEqual(self.auto(x), {n: round(v * 8, 1) for n, v in x["free"].items()}, x["date"])
            self.assertEqual([(f["id"], f["note"]) for f in x["fill"]], [(f"auto:{who}", "")] if x["free"] else [])
        self.assertEqual((d["totals"]["filled"], d["generalPeople"]), (d["totals"]["idle"], [who]))
        self.assertFalse(PlanLeave.objects.exists())                             # هیچ ردیفی ساخته نمی‌شود
        self.tick()
        self.assertTrue(all(x["fill"] == [] for x in self.plan()["days"]))

    def test_519_it_goes_to_the_ticked_workers_first(self):
        self.workers(4)
        self.proj("الف", stages={self.a: 30})
        self.proj("ب", stages={self.b: 30})
        before = self.plan()
        self.assertEqual(self.day(before, SAT)["free"], {"علی": 1.0, "مینا": 1.0})   # به ترتیبِ نام، آخری‌ها آزادند
        self.tick("حسن", "رضا")
        d = self.plan()
        self.assertEqual(self.day(d, SAT)["free"], {"حسن": 1.0, "رضا": 1.0})      # حالا وقتِ خالی به این دو می‌رسد
        self.assertEqual(self.auto(self.day(d, SAT)), {"حسن": 8.0, "رضا": 8.0})
        self.assertEqual(self.production(d), self.production(before))
        self.tick("حسن")
        d = self.plan()
        self.assertEqual((self.day(d, SAT)["free"], self.auto(self.day(d, SAT))), ({"حسن": 1.0, "مینا": 1.0}, {"حسن": 8.0}))

    def test_520_project_work_comes_first(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.tick(who)
        self.proj("ب", stages={self.b: 12})                                     # کاری که همان نفر باید انجام بدهد
        d = self.plan()
        self.assertEqual(self.J(d, "ب", self.b)["start"], SAT)
        for x in d["days"]:
            got = sum(i["hours"] for i in x["people"].get(who, []))
            self.assertAlmostEqual(got + self.auto(x).get(who, 0), x["base"], delta=0.11, msg=str(x["date"]))

    def test_521_named_tasks_take_their_hours_and_the_rest_is_general(self):
        Project.objects.create(name="خدمات کارگاه", general=True, no_area=True)
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.tick(who)
        planning.add_leave({"employee": who, "from": SUN.isoformat(), "to": SUN.isoformat(), "kind": "fill", "hours": 3,
                            "note": "سرویسِ کمپرسور"}, self.user)
        d = self.plan()
        self.assertEqual([(f["note"], f["hours"], bool(f.get("auto"))) for f in self.day(d, SAT)["fill"]], [("خدمات کارگاه", 8.0, True)])
        self.assertEqual([(f["note"], f["hours"], bool(f.get("auto"))) for f in self.day(d, SUN)["fill"]],
                         [("سرویسِ کمپرسور", 3.0, False), ("خدمات کارگاه", 5.0, True)])

    def test_522_without_the_tick_a_named_task_is_not_planned(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.tick(who)
        planning.add_leave({"employee": who, "from": SAT.isoformat(), "kind": "fill", "open": True, "note": "نظافت"}, self.user)
        self.assertTrue(self.day(self.plan(), SAT)["fill"])
        self.tick()                                                             # تیک برداشته شد: دیگر کارِ عمومی‌ای برایش نیست
        d = self.plan()
        self.assertTrue(all(x["fill"] == [] for x in d["days"]))
        self.assertEqual(self.day(d, SAT)["free"], {who: 1.0})

    def test_523_no_general_work_on_leave_overtime_or_days_off(self):
        self.proj("الف", stages={self.a: 80})
        who, = self.day(self.plan(), SAT)["free"]
        self.tick(who)
        self.leave(who, SUN)
        self.leave(who, MON, hours=5)
        self.holiday(TUE)
        self.overtime(WED, 2)
        self.overtime(FRI, 4)
        d = self.plan()
        self.assertEqual([self.auto(self.day(d, day)) for day in (SAT, SUN, MON, WED, FRI)],
                         [{who: 8.0}, {}, {who: 3.0}, {who: 8.0}, {}])
        self.assertIsNone(self.day(d, TUE))

    def test_524_a_master_never_gets_it(self):
        self.workers(3)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        self.skill(علی=[self.b], رضا=[self.a], حسن=[self.a])
        WorkStage.objects.filter(pk=self.b.pk).update(helpers_ok=True)
        self.proj("الف", stages={self.a: 12})
        Employee.objects.update(plan_general=True)                              # تیکِ مانده روی استادکار هم بی‌اثر است
        d = self.plan()
        self.assertEqual((d["masters"], d["generalPeople"]), (["علی"], ["حسن", "رضا"]))
        self.assertTrue(all("علی" not in self.auto(x) for x in d["days"]))
        self.assertTrue(any(x["free"].get("علی") for x in d["days"]))

    def test_525_must_do_work_still_takes_its_hours_first(self):
        self.proj("الف", stages={self.a: 40})
        who, = self.day(self.plan(), SAT)["free"]
        self.tick(who)
        self.leave(who, SAT, kind="general", hours=3, note="تعمیرِ فوری")
        d = self.plan()
        x = self.day(d, SAT)
        self.assertEqual(([(a["name"], a["hours"]) for a in x["away"]], self.auto(x)), ([(who, 3.0)], {who: 5.0}))

    def test_526_reported_general_hours_are_not_flagged_for_a_ticked_worker(self):
        self.tick("علی")
        cal = planning._Calendar(["علی", "رضا"])
        planned, _, allowed = planning._general_hours(SAT, MON, cal)
        self.assertEqual((dict(planned), dict(allowed)), ({}, {SAT: 8.0, SUN: 8.0}))
        self.leave("علی", SUN)
        cal = planning._Calendar(["علی", "رضا"])
        self.assertEqual(dict(planning._general_hours(SAT, MON, cal)[2]), {SAT: 8.0, SUN: 0.0})

    def test_527_a_busy_fortnight_with_ticks_only(self):
        c = self.stage("رنگ آزمایشی", 3, hpm=2)
        self.workers(6)
        Station.objects.create(name="کابین", stages=[self.b.name], crew=2, order=1)
        Station.objects.create(name="کابین دو", stages=[c.name], crew=2, order=2)
        self.skill(علی=[self.b, c], رضا=[self.b, c], حسن=[self.a], مینا=[self.a], سارا=[self.a], نیما=[self.a])
        WorkStage.objects.filter(pk__in=[self.b.pk, c.pk]).update(helpers_ok=True)
        for i, area in enumerate((30, 14, 22, 9)):
            self.proj(f"پ{i}", stages={self.a: area, self.b: area, c: area}, due_date=SAT + W(8 + 3 * i))
        self.leave("حسن", SUN)
        self.overtime(WED, 2)
        before = {today: self.plan(today) for today in (SAT, MON, THU)}
        self.tick("حسن", "مینا")
        for today in (SAT, MON, THU):
            d = self.plan(today)
            self.assertEqual(self.production(d), self.production(before[today]))
            for x in d["days"]:
                got = self.auto(x)
                self.assertTrue(set(got) <= {"حسن", "مینا"})
                for who in ("حسن", "مینا"):
                    self.assertAlmostEqual(got.get(who, 0), min(x["free"].get(who, 0) * 8, x["base"]), delta=0.11, msg=str((x["date"], who)))
                # وقتِ خالیِ کارگرانِ پرداخت اول به این دو می‌رسد: تا یکی از این دو کار دارد، هم‌مهارتِ بی‌تیکش آزاد نیست
                if any(x["free"].get(n, 0) > 0.02 for n in ("سارا", "نیما")):
                    for who in ("حسن", "مینا"):
                        if who not in x["leave"]:
                            self.assertFalse(any(i["kind"] == "job" and i["stage"] == self.a.name and i["hours"] > 0.2
                                                 for i in x["people"].get(who, [])), (x["date"], who, x["people"], x["free"]))


class OnSite(Base):
    """کار در محلِ پروژه: بخشی (یا همهٔ) متراژ در محل انجام می‌شود، با تیمِ خودش و از روزی که مسئول می‌گوید. تیم آن روزها در
    کارگاه نیست، رنگ رویهٔ محل با همان تیم است، و پروژه وقتی تمام است که هم کارگاه تمام شده باشد هم محل (۵۲۸ تا ۵۵۱).

    در محل هر نفر-روز ۶ متر آستر یا ۳ متر پرداخت پیش می‌رود (سه‌چهارمِ سرعتِ کارگاه)."""

    hours = staticmethod(PeoplePlan.hours)
    consistent = PeoplePlan.consistent

    def site(self, p, today=SAT, **kw):
        if "start" in kw:
            kw["from"] = kw.pop("start").isoformat()
        planning.set_site({"project": str(p.pk), **kw}, self.user, today=today)

    def onsite(self, d, name):
        return [(j["stage"], j["planned"], j["start"], j["finish"]) for j in self.P(d, name)["site"]["jobs"]]

    def away(self, d, day):
        """چه کسانی آن روز در محلِ پروژه‌اند."""
        x = self.day(d, day)
        return sorted(n for t in (x["siteTeams"] if x else []) for n in t["people"])

    def there(self, d, day):
        x = self.day(d, day)
        return [(ln["project"], ln["stage"], ln["area"]) for ln in x["site"]] if x else []

    def site_report(self, project, stage, area, day, hours=4, where="onsite", who="علی"):
        rep = DailyReport.objects.create(date=day, shift="صبح", supervisor=self.user, supervisor_name="م", status="approved")
        ReportProgress.objects.create(report=rep, project=project, stage=stage.name, area=area)
        ReportItem.objects.create(report=rep, employee=who, project=project, activity=stage.name, hours=hours, location=where)

    def test_528_part_of_a_project_is_done_on_site(self):
        p = self.proj("در و چهارچوب")
        self.site(p, area=8, note="چهارچوب‌ها", team=["علی"], start=SUN)
        d = self.plan()
        P = self.P(d, "در و چهارچوب")
        # کارگاه: ۸ متر از هر مرحله (شنبه آستر، یکشنبه و دوشنبه پرداخت — با رضا، چون علی در محل است)
        self.assertEqual([(j["stage"], j["planned"], j["start"], j["finish"]) for j in P["jobs"]],
                         [(self.a.name, 8.0, SAT, SAT), (self.b.name, 8.0, SUN, MON)])
        # محل: علی از یکشنبه — آستر ۶ + ۲، بعد همان دوشنبه پشتش پرداخت ۲، و سه‌شنبه و چهارشنبه ۳ + ۳
        self.assertEqual(self.onsite(d, "در و چهارچوب"), [(self.a.name, 8.0, SUN, MON), (self.b.name, 8.0, MON, WED)])
        self.assertEqual([self.there(d, x) for x in (SAT, SUN, MON, TUE, WED)],
                         [[], [("در و چهارچوب", self.a.name, 6.0)],
                          [("در و چهارچوب", self.a.name, 2.0), ("در و چهارچوب", self.b.name, 2.0)],
                          [("در و چهارچوب", self.b.name, 3.0)], [("در و چهارچوب", self.b.name, 3.0)]])
        self.assertEqual([self.away(d, x) for x in (SAT, SUN, WED)], [[], ["علی"], ["علی"]])
        self.assertEqual((P["start"], P["finish"], P["remaining"], P["workSite"]), (SAT, WED, 32.0, "mixed"))
        self.assertEqual((P["site"]["area"], P["site"]["note"], P["site"]["team"], P["site"]["from"], P["site"]["ready"],
                          P["site"]["days"], P["site"]["unplanned"]),
                         (8.0, "چهارچوب‌ها", ["علی"], SUN, True, [SUN, MON, TUE, WED], 0.0))
        self.assertEqual(d["totals"]["finish"], WED)
        self.consistent(d)

    def test_529_a_whole_project_on_site(self):
        p = self.proj("ویلا", area=12)
        self.site(p, all=True, team=["علی", "رضا"], start=SAT)
        d = self.plan()
        P = self.P(d, "ویلا")
        self.assertEqual((P["jobs"], P["workSite"], P["site"]["all"], P["site"]["area"]), ([], "onsite", True, 12.0))
        # دو نفر: شنبه ۱۲ متر آستر، یکشنبه و دوشنبه ۶ + ۶ متر پرداخت
        self.assertEqual(self.onsite(d, "ویلا"), [(self.a.name, 12.0, SAT, SAT), (self.b.name, 12.0, SUN, MON)])
        self.assertEqual((P["start"], P["finish"], P["remaining"]), (SAT, MON, 24.0))
        for x in d["days"]:
            self.assertEqual((x["lines"], x["free"], x["used"]), ([], {}, 2.0))
        self.consistent(d)

    def test_530_without_a_team_or_a_day_it_is_not_planned(self):
        p = self.proj("در")
        self.site(p, area=8)
        d = self.plan()
        P = self.P(d, "در")
        self.assertEqual([(j["planned"], j["finish"]) for j in P["jobs"]], [(8.0, SAT), (8.0, MON)])
        self.assertEqual(([j["start"] for j in P["site"]["jobs"]], P["site"]["ready"], P["site"]["unplanned"], P["finish"]),
                         ([None, None], False, 16.0, None))
        self.assertTrue(any("تیم یا روزِ رفتن ندارد" in w and "در" in w for w in d["warnings"]), d["warnings"])
        self.assertFalse(d["totals"]["unfinished"])
        self.site(p, area=8, team=["رضا"])                                     # تیم هست، روز نه
        self.assertFalse(self.P(self.plan(), "در")["site"]["ready"])
        self.site(p, area=8, team=["رضا"], start=MON)
        d = self.plan()
        self.assertEqual((self.P(d, "در")["site"]["ready"], self.P(d, "در")["site"]["start"]), (True, MON))
        self.assertFalse(any("تیم یا روزِ رفتن ندارد" in w for w in d["warnings"]))

    def test_531_the_team_is_out_of_the_workshop(self):
        x, y = self.proj("ویلا", area=12), self.proj("کمد", stages={self.a: 8})
        self.ordered(y, x)                                                     # نوبتِ کمد جلوتر است، ولی روزِ محل را مسئول گذاشته
        self.site(x, all=True, team=["علی", "رضا"], start=SAT)
        d = self.plan()
        self.assertEqual([self.away(d, day) for day in (SAT, SUN, MON, TUE)], [["رضا", "علی"]] * 3 + [[]])
        self.assertEqual((self.J(d, "کمد", self.a)["start"], self.P(d, "کمد")["finish"]), (TUE, TUE))
        self.site(x, remove=True)                                              # بی کارِ محل، کمد همان شنبه شروع می‌شود
        self.assertEqual(self.J(self.plan(), "کمد", self.a)["start"], SAT)

    def test_532_when_the_teams_master_is_away_nobody_goes(self):
        x = self.proj("ویلا", area=12)
        self.proj("کمد", stages={self.a: 40})
        self.site(x, all=True, team=["علی", "رضا"], start=SAT)
        self.leave("علی", SUN)
        d = self.plan()
        self.assertEqual([self.away(d, day) for day in (SAT, SUN, MON, TUE)], [["رضا", "علی"], [], ["رضا", "علی"], ["رضا", "علی"]])
        self.assertEqual(self.area(d, SUN, "کمد", self.a), 8.0)               # رضا آن روز در کارگاه کار می‌کند
        self.assertEqual(self.P(d, "ویلا")["finish"], TUE)
        # کارگرِ تیم نباشد: استادکار تنها می‌رود
        PlanLeave.objects.all().delete()
        self.leave("رضا", SUN)
        self.assertEqual(self.away(self.plan(), SUN), ["علی"])

    def test_533_drying_on_site_like_the_workshop(self):
        c = self.stage("بتونهٔ آزمایشی", 0, hpm=1, wait=24)                    # یک روزِ کامل انتظار
        x = self.proj("ویلا", stages={c: 6, self.b: 6})
        self.proj("کمد", stages={self.a: 40})
        self.site(x, all=True, team=["علی"], start=SAT)
        d = self.plan()
        # شنبه بتونه؛ یکشنبه دارد خشک می‌شود و علی به کارگاه برمی‌گردد؛ دوشنبه و سه‌شنبه پرداخت
        self.assertEqual(self.onsite(d, "ویلا"), [(c.name, 6.0, SAT, SAT), (self.b.name, 6.0, MON, TUE)])
        self.assertEqual([self.away(d, day) for day in (SAT, SUN, MON, TUE, WED)], [["علی"], [], ["علی"], ["علی"], []])
        self.assertEqual(self.P(d, "ویلا")["site"]["days"], [SAT, MON, TUE])
        self.consistent(d)

    def test_534_only_some_stages_on_site(self):
        p = self.proj("در")
        self.site(p, area=8, stages=[self.b.name], team=["علی"], start=SAT)
        d = self.plan()
        P = self.P(d, "در")
        # آسترِ همهٔ ۱۶ متر در کارگاه؛ پرداختِ ۸ مترش در کارگاه و ۸ مترش در محل — پس از تمام شدنِ آستر
        self.assertEqual([(j["stage"], j["planned"], j["start"], j["finish"]) for j in P["jobs"]],
                         [(self.a.name, 16.0, SAT, SUN), (self.b.name, 8.0, SUN, MON)])
        self.assertEqual(self.onsite(d, "در"), [(self.b.name, 8.0, MON, WED)])
        self.assertEqual((P["site"]["stages"], self.away(d, SAT), self.away(d, SUN), self.away(d, MON)),
                         ([self.b.name], [], [], ["علی"]))
        self.assertEqual(P["finish"], WED)

    def test_535_reported_site_work_counts_for_the_site(self):
        p = self.proj("در")
        self.site(p, area=8, team=["علی"], start=SAT)
        self.site_report(p, self.a, 6, D(2026, 9, 30))                         # ۶ متر آستر در محل
        d = self.plan()
        self.assertEqual([(j["stage"], j["remaining"]) for j in self.P(d, "در")["site"]["jobs"]],
                         [(self.a.name, 2.0), (self.b.name, 8.0)])
        self.assertEqual(self.J(d, "در", self.a)["remaining"], 8.0)            # کارگاه دست نخورده
        self.assertEqual(self.P(d, "در")["remaining"], 26.0)
        # گزارشی که «محل» نخورده به حسابِ کارگاه می‌رود؛ هر چه از سهمِ کارگاه بیشتر شد کارِ محل بوده است
        self.site_report(p, self.a, 9, D(2026, 10, 1), where="workshop")
        d = self.plan()
        self.assertEqual((self.J(d, "در", self.a)["remaining"], self.P(d, "در")["site"]["jobs"][0]["remaining"]), (0, 1.0))
        self.assertEqual(self.P(d, "در")["remaining"], 17.0)

    def test_536_top_coat_on_site_is_the_teams_not_the_foremans(self):
        top = self.stage("رویهٔ آزمایشی", 3, hpm=2)
        self.workers(4)                                                        # علی، رضا، حسن، مینا
        self.skill(حسن=[self.a], مینا=[self.a])
        WorkStage.objects.filter(pk=top.pk).update(helpers_ok=True, foreman_first=True)
        planning.set_skills({"skills": {}, "foremen": ["علی"]}, self.user)
        x, y = self.proj("محلی", stages={top: 12}), self.proj("کارگاهی", stages={top: 12})
        with self.assertRaises(ValidationError):                               # کسی از این تیم رویه بلد نیست
            self.site(x, all=True, team=["حسن", "مینا"], start=SAT)
        self.assertEqual(Project.objects.get(pk=x.pk).work_site, "")
        self.site(x, all=True, team=["رضا", "حسن"], start=SAT)
        d = self.plan()
        day = self.day(d, SAT)
        # رویهٔ محل با رضا و حسن (هر نفر-روز ۳ متر)، رویهٔ کارگاه با سرکارگر
        self.assertEqual(self.there(d, SAT), [("محلی", top.name, 6.0)])
        self.assertEqual({n: [(i["kind"], i["stage"], i["hours"]) for i in items] for n, items in day["people"].items()},
                         {"رضا": [("site", top.name, 8.0)], "حسن": [("site", top.name, 8.0)], "علی": [("job", top.name, 8.0)]})
        self.assertEqual((self.P(d, "محلی")["finish"], self.P(d, "کارگاهی")["finish"], d["foremen"]), (SUN, MON, ["علی"]))
        self.consistent(d)
        self.assertEqual(y.work_site, "")

    def test_537_through_the_page_and_taken_back(self):
        p = self.proj("در")
        PlanChange.objects.all().delete()
        body = {"project": str(p.pk), "area": 8, "note": "در و چهارچوب", "team": ["علی"], "from": SUN.isoformat()}
        r = self.post("plan-site", body)
        self.assertEqual(r.status_code, 200, r.content)
        P = next(x for x in r.json()["projects"] if x["name"] == "در")
        self.assertEqual((P["workSite"], P["site"]["area"], P["site"]["team"], P["site"]["note"], P["site"]["from"]),
                         ("mixed", 8.0, ["علی"], "در و چهارچوب", SUN.isoformat()))
        change = PlanChange.objects.first()
        self.assertEqual(change.action, "site")
        self.assertIn("۸ متر در محلِ پروژه، تیم: علی", change.summary)
        r = self.post("plan-site", {**body, "all": True, "team": ["علی", "رضا"]})
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area, p.onsite_team), ("onsite", None, ["علی", "رضا"]))
        self.post("plan-undo", {})
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area, p.onsite_team, p.onsite_from), ("mixed", Decimal("8.00"), ["علی"], SUN))
        self.post("plan-undo", {})
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area, p.onsite_note, p.onsite_team, p.onsite_from), ("", None, "", [], None))
        r = self.post("plan-site", body, user=User.objects.create_user(username="viewer", password="x", role="manager",
                                                                       access=["production"]))
        self.assertEqual(r.status_code, 403)                                   # بی حقِ ویرایشِ برنامه نمی‌شود

    def test_538_the_preview_saves_nothing(self):
        p = self.proj("در")
        self.proj("کمد", stages={self.a: 40})
        before = self.plan()
        ask = {"site": {"project": str(p.pk), "area": 8, "team": ["علی", "رضا"], "from": SAT.isoformat()}}
        r = planning.what_if_custom(ask, today=SAT)
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area, p.onsite_team, PlanChange.objects.count()), ("", None, [], 0))
        self.assertEqual(self.plan(), before)
        res = r["result"]
        self.assertEqual((r["now"]["finish"], res["site"]["team"], res["site"]["ready"], res["site"]["days"][0]),
                         (before["totals"]["finish"], ["علی", "رضا"], True, SAT))
        # همان چیزی را می‌گوید که پس از ذخیره می‌شود
        self.site(p, area=8, team=["علی", "رضا"], start=SAT)
        d = self.plan()
        self.assertEqual((res["finish"], res["siteProject"]["finish"], res["site"]["finish"], res["site"]["days"]),
                         (d["totals"]["finish"], self.P(d, "در")["finish"], self.P(d, "در")["site"]["finish"],
                          self.P(d, "در")["site"]["days"]))
        self.assertEqual(res["endGain"], (before["totals"]["finish"] - d["totals"]["finish"]).days)
        self.assertLess(res["endGain"], 0)                                     # دو نفر بیرون از کارگاه: برنامه عقب می‌افتد
        with self.assertRaises(ValidationError):
            planning.what_if_custom({"site": {"project": "0", "area": 8}}, today=SAT)
        r = self.post("plan-what-if", ask)                                      # از راهِ صفحه هم
        self.assertEqual((r.status_code, r.json()["result"]["site"]["team"]), (200, ["علی", "رضا"]))

    def test_539_what_is_refused(self):
        p = self.proj("در", base_area=10)
        closed = self.proj("بسته", closed_at=PAST)
        chores = Project.objects.create(name="خدمات", general=True)
        for bad in ({"area": 12}, {"area": 0}, {"area": "x"}, {}, {"area": 5, "team": ["نیست"]}, {"area": 5, "team": "علی"},
                    {"area": 5, "stages": ["نیست"]}, {"area": 5, "stages": "x"}, {"area": 5, "from": "دیروز"},
                    {"area": 5, "team": ["علی", "رضا", "حسن", "مینا", "سارا"]}):
            with self.assertRaises(ValidationError, msg=bad):
                self.site(p, **bad)
        for other in (closed, chores):
            with self.assertRaises(ValidationError):
                self.site(other, area=5)
        with self.assertRaises(ValidationError):
            planning.set_site({"project": "x", "area": 5}, self.user)
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area), ("", None))
        self.assertEqual(self.post("plan-site", {"project": str(p.pk), "area": 12}).status_code, 400)
        self.site(p, area=10, team=["علی", "علی", " رضا "])                    # همهٔ متراژ هم می‌شود؛ نامِ تکراری یک بار
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area, p.onsite_team), ("mixed", Decimal("10.00"), ["علی", "رضا"]))
        self.assertEqual(self.P(self.plan(), "در")["jobs"], [])

    def test_540_taking_it_off_brings_everything_back_to_the_workshop(self):
        p = self.proj("در")
        before = self.plan()
        self.site(p, area=8, team=["علی"], start=SUN)
        self.assertNotEqual(self.plan()["days"], before["days"])
        self.site(p, remove=True)
        d = self.plan()
        p.refresh_from_db()
        self.assertEqual((p.work_site, p.onsite_area, p.onsite_team, p.onsite_from), ("workshop", None, [], None))
        self.assertEqual((d["days"], self.P(d, "در")["site"], self.P(d, "در")["jobs"]),
                         (before["days"], None, self.P(before, "در")["jobs"]))
        # «همه در کارگاه» در فرمِ پروژه هم همین کار را می‌کند، حتی اگر متراژِ محل مانده باشد
        self.site(p, area=8, team=["علی"], start=SUN)
        Project.objects.filter(pk=p.pk).update(work_site="workshop")
        self.assertEqual(self.plan()["days"], before["days"])

    def test_541_the_recorded_plan_and_the_materials_include_it(self):
        from .models import PlanBaselineLine
        p = self.proj("در")
        self.site(p, area=8, team=["علی"], start=SUN)
        planning.commit(self.user, "با محل", today=SAT)
        there = PlanBaselineLine.objects.filter(station_name=planning.SITE_NAME)
        self.assertEqual(sorted((ln.date, ln.stage, float(ln.area)) for ln in there),
                         sorted([(SUN, self.a.name, 6.0), (MON, self.a.name, 2.0), (MON, self.b.name, 2.0),
                                 (TUE, self.b.name, 3.0), (WED, self.b.name, 3.0)]))
        self.assertEqual(float(sum(ln.area for ln in PlanBaselineLine.objects.all())), 32.0)
        d = self.plan()
        P = self.P(d, "در")
        self.assertEqual((P["baselineFinish"], P["slipDays"]), (WED, 0))
        self.assertEqual((self.J(d, "در", self.b)["baselineFinish"], self.J(d, "در", self.b)["slipDays"]), (MON, 0))
        # روزِ گذشته: کارِ محل زیرِ «محل پروژه» می‌آید، نه ایستگاهِ کارگاه
        self.site_report(p, self.a, 6, SUN)
        later = self.plan(today=MON, check=False)
        row = next(ln for x in later["past"] if x["date"] == SUN for ln in x["lines"] if ln["stationName"] == planning.SITE_NAME)
        self.assertEqual((row["station"], row["planned"], row["stage"]), (planning.SITE, 6.0, self.a.name))

    def test_542_two_sites_with_the_same_master_go_one_after_the_other(self):
        x, y = self.proj("ویلا", stages={self.a: 6}), self.proj("برج", stages={self.a: 6})
        self.proj("کمد", stages={self.a: 40})
        self.ordered(x, y)
        self.site(x, all=True, team=["علی"], start=SAT)
        self.site(y, all=True, team=["علی", "رضا"], start=SAT)
        d = self.plan()
        self.assertEqual((self.there(d, SAT), self.away(d, SAT)), ([("ویلا", self.a.name, 6.0)], ["علی"]))
        self.assertEqual(self.area(d, SAT, "کمد", self.a), 8.0)               # رضا شنبه در کارگاه می‌ماند
        self.assertEqual((self.there(d, SUN), self.away(d, SUN)), ([("برج", self.a.name, 6.0)], ["رضا", "علی"]))
        self.assertEqual((self.P(d, "ویلا")["finish"], self.P(d, "برج")["finish"]), (SAT, SUN))
        self.consistent(d)

    def test_543_the_whole_day_of_the_team_is_spent_there(self):
        p = self.proj("ویلا", stages={self.a: 3})
        self.proj("کمد", stages={self.a: 40})
        self.site(p, all=True, team=["علی", "رضا"], start=SAT)
        d = self.plan()
        x = self.day(d, SAT)
        # ۳ متر آستر نیم نفر-روز است؛ باقیِ روزِ هر دو هم در محل (رفت‌وآمد) می‌گذرد و کارگاه آن روز کسی را ندارد
        self.assertEqual((x["site"][0]["area"], x["site"][0]["hours"], x["site"][0]["team"], x["site"][0]["share"]),
                         (3.0, 4.0, ["علی", "رضا"], 0.25))
        self.assertEqual({n: sorted((i["kind"], i["hours"]) for i in items) for n, items in x["people"].items()},
                         {"علی": [("site", 2.0), ("sitetime", 6.0)], "رضا": [("site", 2.0), ("sitetime", 6.0)]})
        self.assertEqual((x["lines"], x["free"], x["used"], x["pool"]), ([], {}, 2.0, 2.0))
        self.assertEqual(self.area(d, SUN, "کمد", self.a), 8.0)
        self.consistent(d)

    def test_544_short_days_leave_and_overtime(self):
        p = self.proj("ویلا", stages={self.a: 40})
        self.site(p, all=True, team=["علی"], start=WED)
        self.leave("علی", SAT2, hours=4)
        self.overtime(SUN2, 4)
        d = self.plan()
        # چهارشنبه ۶، پنجشنبه (نیم‌روز) ۳، شنبه (نیمی مرخصی) ۳، یکشنبه (۴ ساعت اضافه‌کاری) ۹، بعد روزی ۶
        self.assertEqual([self.there(d, day)[0][2] for day in (WED, THU, SAT2, SUN2, MON2)], [6.0, 3.0, 3.0, 9.0, 6.0])
        self.assertEqual(self.there(d, FRI), [])
        self.consistent(d)

    def test_545_a_paused_project_is_not_worked_on_site(self):
        p = self.proj("ویلا", stages={self.a: 12})
        self.site(p, all=True, team=["علی"], start=SAT)
        ProjectPause.objects.create(project=p, start=SUN, end=TUE, reason="customer")
        d = self.plan()
        self.assertEqual([self.away(d, day) for day in (SAT, SUN, MON, TUE)], [["علی"], [], [], ["علی"]])
        ProjectPause.objects.all().delete()
        ProjectPause.objects.create(project=p, start=SAT, reason="customer")   # توقفِ بی‌پایان: اصلاً در برنامه نیست
        d = self.plan()
        self.assertEqual((self.names(d), d["days"]), ([], []))

    def test_546_partly_on_site_but_the_area_is_not_known_yet(self):
        p = self.proj("در", work_site="mixed")
        d = self.plan()
        P = self.P(d, "در")
        self.assertEqual((P["workSite"], P["site"], [j["planned"] for j in P["jobs"]]), ("mixed", None, [16.0, 16.0]))
        self.assertTrue(any("متراژِ محلِ پروژه هنوز وارد نشده" in w and "در" in w for w in d["warnings"]), d["warnings"])
        self.site(p, area=4, team=["رضا"], start=SAT)
        d = self.plan()
        self.assertFalse(any("متراژِ محلِ پروژه هنوز وارد نشده" in w for w in d["warnings"]))
        self.assertEqual([j["planned"] for j in self.P(d, "در")["jobs"]], [12.0, 12.0])

    def test_547_the_area_is_a_share_of_the_projects_base_area(self):
        # متراژِ پایه ۲۰ متر است ولی پرداخت دو رو حساب شده (۴۰ متر): یک‌چهارمِ پروژه در محل یعنی ۵ متر آستر و ۱۰ متر پرداخت
        p = self.proj("در", stages={self.a: 20, self.b: 40}, base_area=20)
        self.site(p, area=5, team=["علی"], start=SAT)
        d = self.plan()
        self.assertEqual([(j["stage"], j["planned"]) for j in self.P(d, "در")["site"]["jobs"]],
                         [(self.a.name, 5.0), (self.b.name, 10.0)])
        self.assertEqual([j["planned"] for j in self.P(d, "در")["jobs"]], [15.0, 30.0])
        self.assertEqual(self.P(d, "در")["site"]["area"], 5.0)

    def test_548_general_work_and_a_fixed_station_do_not_reach_the_team(self):
        self.workers(3)                                                        # علی، رضا، حسن
        planning.set_skills({"skills": {}, "general": ["حسن", "رضا"]}, self.user)
        p = self.proj("ویلا", stages={self.a: 12})
        self.site(p, all=True, team=["علی", "حسن"], start=SAT)
        d = self.plan()
        x = self.day(d, SAT)
        self.assertEqual(self.away(d, SAT), ["حسن", "علی"])
        self.assertEqual([(f["name"], f["hours"]) for f in x["fill"]], [("رضا", 8.0)])   # حسن در محل است، کارِ عمومی نمی‌گیرد
        self.assertEqual(x["used"], 2.0)
        self.consistent(d)

    def test_549_someone_who_left_the_company(self):
        p = self.proj("ویلا", stages={self.a: 12})
        self.site(p, all=True, team=["علی", "رضا"], start=SAT)
        Employee.objects.filter(name="رضا").update(active=False)                # کارگرِ تیم رفته: استادکار تنها می‌رود
        d = self.plan()
        self.assertEqual((self.away(d, SAT), self.P(d, "ویلا")["site"]["team"], self.P(d, "ویلا")["finish"]), (["علی"], ["علی"], SUN))
        Employee.objects.filter(name="رضا").update(active=True)
        Employee.objects.filter(name="علی").update(active=False)                # استادکارِ تیم رفته: تا تیمِ تازه، چیده نمی‌شود
        d = self.plan()
        self.assertEqual((self.P(d, "ویلا")["site"]["ready"], self.P(d, "ویلا")["finish"], d["days"]), (False, None, []))
        self.assertTrue(any("استادکارِ تیم دیگر فعال نیست" in w for w in d["warnings"]))

    def test_550_a_project_that_starts_later_or_stops(self):
        p = self.proj("ویلا", stages={self.a: 12}, start_date=MON)
        self.site(p, all=True, team=["علی"], start=TUE)
        d = self.plan()
        self.assertEqual((self.P(d, "ویلا")["site"]["start"], self.P(d, "ویلا")["finish"]), (TUE, WED))
        r = planning.what_if_custom({"absent": {"employee": "علی", "days": 5}}, today=SAT)     # فرضِ نبودنِ استادکار
        self.assertEqual(r["result"]["projects"][0]["finish"], SUN2)

    def test_551_a_busy_fortnight_with_two_sites(self):
        top = self.stage("رویهٔ آزمایشی", 3, hpm=2, wait=24)
        self.workers(5)
        self.skill(حسن=[self.a], مینا=[self.a], سارا=[self.a, self.b])
        WorkStage.objects.filter(pk=top.pk).update(helpers_ok=True, foreman_first=True)
        Station.objects.create(name="کابین رویه", stages=[top.name], crew=2, order=1)
        planning.set_skills({"skills": {}, "foremen": ["علی"], "general": ["مینا"]}, self.user)
        ps = [self.proj(f"پروژه {i}", stages={self.a: 20 + 6 * i, self.b: 14 + 4 * i, top: 10 + 5 * i}, due_date=SAT2 + W(3 * i))
              for i in range(5)]
        base = self.plan()
        self.consistent(base)
        self.site(ps[1], area=10, team=["رضا", "حسن"], start=MON)
        self.site(ps[3], all=True, stages=[self.b.name, top.name], team=["رضا", "سارا"], start=SAT2)
        self.leave("رضا", WED)
        self.overtime(TUE, 2)
        self.holiday(SUN2)
        d = self.plan()
        self.consistent(d)
        for name in ("پروژه 1", "پروژه 3"):
            site = self.P(d, name)["site"]
            self.assertTrue(site["ready"] and site["finish"] and not site["unplanned"], (name, site))
            self.assertGreaterEqual(self.P(d, name)["finish"], site["finish"])
        self.assertEqual(self.away(d, WED), [])                                # استادکارِ تیم مرخصی است
        self.assertEqual(self.away(d, SUN2), [])
        for x in d["days"]:                                                    # رویهٔ کارگاه: هر وقت سرکارگر هست، با او
            lead = Foreman.lead_of(x, top)
            if lead and "علی" not in x["leave"]:
                self.assertIn("علی", lead, x["date"])
            for n in self.away(d, x["date"]):
                self.assertFalse([i for i in x["people"][n] if i["kind"] not in ("site", "sitetime")], (x["date"], n))
        self.assertAlmostEqual(d["totals"]["area"], base["totals"]["area"], delta=0.1)   # جدا کردنِ محل کاری کم یا زیاد نمی‌کند
        self.assertFalse(d["totals"]["unfinished"])

    def test_552_a_coat_dries_overnight_but_sanding_goes_on_the_same_day(self):
        coat = self.stage("پرایمر آزمایشی", 0, hpm=1)                          # دستِ آستر: نامش می‌گوید (مثلِ موادِ مصرفی)
        p = self.proj("در", stages={coat: 3, self.a: 3, self.b: 3})
        self.site(p, all=True, team=["علی"], start=SAT)
        d = self.plan()
        # شنبه پرایمر (نیم‌روز) و بس: تا فردا خشک نمی‌شود. یکشنبه آستر آزمایشی (که دستِ رنگ نیست) و همان روز پشتش پرداخت
        self.assertEqual(self.onsite(d, "در"), [(coat.name, 3.0, SAT, SAT), (self.a.name, 3.0, SUN, SUN), (self.b.name, 3.0, SUN, MON)])
        self.assertEqual([self.there(d, day) for day in (SAT, SUN, MON)],
                         [[("در", coat.name, 3.0)], [("در", self.a.name, 3.0), ("در", self.b.name, 1.5)], [("در", self.b.name, 1.5)]])
        self.assertEqual(self.P(d, "در")["finish"], MON)
        self.consistent(d)


class Rounds(Base):
    """استر و رنگِ هر پروژه در نهایت دو نوبت: هر نوبت وقتی شروع می‌شود که سهمش آماده باشد و فقط همان را می‌زند — نه هر روز
    چند متر. فقط برای مرحله‌ای که few_rounds دارد (در سایت: استر و رنگ) (۵۵۳ تا ۵۶۰)."""

    def setUp(self):
        super().setUp()
        self.c = self.stage("رنگ آزمایشی", 3)                                  # روزی ۸ متر
        WorkStage.objects.filter(pk=self.c.pk).update(few_rounds=True)
        planning.clear_cache()

    def sprayed(self, d, name):
        return [(x["date"], ln["area"]) for x in d["days"] for ln in x["lines"] if ln["project"] == name and ln["stage"] == self.c.name]

    def test_553_two_rounds_instead_of_a_little_every_day(self):
        self.proj("پ", stages={self.b: 16, self.c: 16})                        # پرداخت روزی ۴ متر، چهار روز
        d = self.plan()
        # نوبتِ اول وقتی نصفِ کار (۸ متر) آماده است: دوشنبه. نوبتِ دوم وقتی باقی‌اش آماده است: چهارشنبه.
        self.assertEqual(self.sprayed(d, "پ"), [(MON, 8.0), (WED, 8.0)])
        self.assertEqual((self.P(d, "پ")["finish"], self.J(d, "پ", self.c)["coat"], d["coatRounds"]), (WED, True, 2))
        self.assertIn("نوبت", self.J(d, "پ", self.c)["why"])
        WorkStage.objects.filter(pk=self.c.pk).update(few_rounds=False)        # بی این قاعده: هر روز ۴ متر
        planning.clear_cache()
        self.assertEqual(self.sprayed(self.plan(), "پ"), [(SUN, 4.0), (MON, 4.0), (TUE, 4.0), (WED, 4.0)])

    def test_554_a_round_too_big_for_one_day_runs_on(self):
        self.proj("پ", stages={self.a: 40, self.c: 40})                        # آستر روزی ۸ متر، پنج روز
        d = self.plan()
        # سه‌شنبه ۲۴ متر آماده است (بیش از نصف): همان ۲۴ متر زده می‌شود؛ پنجشنبه که باقی هم رسیده، پشتِ سرش تا آخر می‌رود
        self.assertEqual(self.sprayed(d, "پ"), [(TUE, 8.0), (WED, 8.0), (THU, 4.0), (SAT2, 8.0), (SUN2, 8.0), (MON2, 4.0)])

    def test_555_a_job_already_started_has_one_round_left(self):
        p = self.proj("پ", stages={self.b: 16, self.c: 16})
        self.report(p, self.b, 8, D(2026, 9, 29))
        self.report(p, self.c, 4, D(2026, 9, 30))
        d = self.plan()
        # ۴ متر مانده از پرداختِ قبلی آماده است، ولی نوبتِ آخر وقتی است که همهٔ ۱۲ مترِ مانده آماده باشد
        got = self.sprayed(d, "پ")
        self.assertEqual(([day for day, _ in got], round(sum(a for _, a in got), 1)), ([MON, TUE], 12.0))
        self.assertEqual(self.worked(d, "پ", self.b), [SAT, SUN])

    def test_556_everything_ready_goes_in_one_round(self):
        self.proj("پ", stages={self.c: 20})                                    # مرحلهٔ قبلی ندارد: همه‌اش از اول آماده است
        self.assertEqual(self.sprayed(self.plan(), "پ"), [(SAT, 8.0), (SUN, 8.0), (MON, 4.0)])

    def test_557_a_job_the_planner_placed_by_hand_is_not_held(self):
        p = self.proj("پ", stages={self.b: 16, self.c: 16})
        self.task(p, self.c, notBefore=SUN.isoformat())
        self.assertEqual(self.sprayed(self.plan(), "پ")[0], (SUN, 4.0))

    def test_558_two_projects_share_the_booth_in_whole_rounds(self):
        x, y = self.proj("الف", stages={self.b: 8, self.c: 8}), self.proj("ب", stages={self.b: 8, self.c: 8})
        self.ordered(x, y)
        d = self.plan()
        # الف: پرداخت شنبه و یکشنبه، نوبتِ اولِ رنگ یکشنبه (۴ متر = نصف) و نوبتِ دوم دوشنبه. ب پشتِ سرش.
        self.assertEqual(self.sprayed(d, "الف"), [(SUN, 4.0), (MON, 4.0)])
        self.assertEqual(self.sprayed(d, "ب"), [(TUE, 4.0), (WED, 4.0)])

    def test_560_a_busy_fortnight_still_adds_up(self):
        self.workers(4)
        Station.objects.create(name="کابین", stages=[self.c.name], crew=2, order=1)
        ps = [self.proj(f"پ{i}", stages={self.a: 16 + 8 * i, self.b: 12 + 4 * i, self.c: 16 + 8 * i}, due_date=SAT2 + W(2 * i))
              for i in range(4)]
        self.leave("علی", MON)
        self.overtime(TUE, 2)
        d = self.plan()
        for p in ps:
            days = [day for day, _ in self.sprayed(d, p.name)]
            runs = 1 + sum(1 for a, b in zip(days, days[1:]) if (b - a).days > 3)
            self.assertLessEqual(runs, 3, (p.name, days))                      # دو نوبت؛ ایستگاهِ شلوغ شاید یکی را دو تکه کند
            self.assertIsNotNone(self.P(d, p.name)["finish"])
        self.assertFalse(d["totals"]["unfinished"])


class Efficiency(Base):
    """هدفِ بهره‌وری: برنامهٔ خط با «هدف ÷ مبنا» برابرِ سرعتِ سابقه چیده می‌شود و پایانِ «با سرعتِ فعلی» کنارش می‌ماند؛ و روندِ
    بهره‌وریِ واقعی از گزارش‌ها (۵۶۱ تا ۵۷۰)."""

    def goal(self, **kw):
        planning.set_efficiency(kw, self.user)
        planning.clear_cache()

    def test_561_by_default_the_plan_is_what_it_was(self):
        self.proj("پ", stages={self.a: 48})
        d = self.plan()
        e = d["efficiency"]
        self.assertEqual((e["base"], e["target"], e["factor"], e["planFinish"], e["realFinish"]), (50.0, 50.0, 1.0, SAT2, SAT2))
        self.assertEqual((self.P(d, "پ")["finish"], self.P(d, "پ")["realFinish"], self.J(d, "پ", self.a)["daily"]), (SAT2, SAT2, 8.0))

    def test_562_a_higher_goal_gives_the_floor_a_tighter_plan(self):
        self.proj("پ", stages={self.a: 48}, due_date=THU)
        before = self.plan()
        self.goal(target=60)                                                   # ۲۰٪ تندتر از سابقه: روزی ۹٫۶ متر
        d = self.plan()
        P = self.P(d, "پ")
        self.assertEqual((self.J(d, "پ", self.a)["daily"], P["finish"], P["realFinish"]), (9.6, WED, SAT2))
        self.assertEqual((P["onTime"], P["realOnTime"]), (True, False))        # با هدف به قول می‌رسد، با سرعتِ فعلی نه
        e = d["efficiency"]
        self.assertEqual((e["target"], e["factor"], e["planFinish"], e["realFinish"], e["planLate"], e["realLate"]),
                         (60.0, 1.2, WED, SAT2, 0, 1))
        self.assertEqual(self.P(before, "پ")["finish"], SAT2)
        self.goal(target=50)
        self.assertEqual(self.plan()["days"], before["days"])

    def test_563_a_duration_set_by_hand_is_left_alone(self):
        p = self.proj("پ", stages={self.a: 48})
        self.task(p, self.a, days=4)                                           # روزی ۱۲ متر، حرفِ مسئول
        self.goal(target=75)
        d = self.plan()
        self.assertEqual((self.J(d, "پ", self.a)["daily"], self.P(d, "پ")["finish"], self.P(d, "پ")["realFinish"]), (12.0, TUE, TUE))

    def test_564_what_is_refused(self):
        for bad in ({"target": 40}, {"target": 101}, {"target": "x"}, {"target": 5}, {"base": 50, "target": 101}, {"base": 30, "target": 70}):
            with self.assertRaises(ValidationError, msg=bad):
                planning.set_efficiency(bad, self.user)
        self.assertEqual(planning.efficiency_setting(), {"base": 50.0, "target": 50.0, "factor": 1.0})
        self.goal(base=40, target=50)                                          # مبنا هم عوض‌شدنی است
        self.assertEqual(planning.efficiency_setting(), {"base": 40.0, "target": 50.0, "factor": 1.25})

    def test_565_through_the_page_and_taken_back(self):
        self.proj("پ", stages={self.a: 48})
        PlanChange.objects.all().delete()
        r = self.post("plan-efficiency", {"target": 55})
        self.assertEqual((r.status_code, r.json()["efficiency"]["target"], r.json()["efficiency"]["factor"]), (200, 55.0, 1.1))
        self.assertEqual((PlanChange.objects.first().action, PlanChange.objects.first().summary), ("efficiency", "هدف: ۵۵٪"))
        self.assertEqual(self.post("plan-efficiency", {"target": 20}).status_code, 400)
        r = self.post("plan-undo", {})
        self.assertEqual(r.json()["efficiency"]["target"], 50.0)
        viewer = User.objects.create_user(username="viewer2", password="x", role="manager", access=["production"])
        self.assertEqual(self.post("plan-efficiency", {"target": 55}, user=viewer).status_code, 403)

    def test_566_asking_first_changes_nothing(self):
        self.proj("پ", stages={self.a: 48})
        r = planning.what_if_custom({"efficiency": {"target": 60}}, today=SAT)
        self.assertEqual((r["now"]["finish"], r["result"]["finish"], r["result"]["endGain"]), (SAT2, WED, 3))
        self.assertEqual((planning.efficiency_setting()["target"], PlanChange.objects.count()), (50.0, 0))
        with self.assertRaises(ValidationError):
            planning.what_if_custom({"efficiency": {"target": 30}}, today=SAT)

    def test_567_site_work_follows_the_goal_too(self):
        p = self.proj("ویلا", stages={self.a: 12})
        planning.set_site({"project": str(p.pk), "all": True, "team": ["علی"], "from": SAT.isoformat()}, self.user, today=SAT)
        self.assertEqual(self.P(self.plan(), "ویلا")["finish"], SUN)           # ۶ متر در روز
        self.goal(target=100)                                                  # دو برابر: ۱۲ متر در روز
        d = self.plan()
        self.assertEqual((self.P(d, "ویلا")["finish"], self.P(d, "ویلا")["realFinish"]), (SAT, SUN))

    def test_568_the_trend_from_the_reports(self):
        p = self.proj("پ", stages={self.a: 500})
        # دو هفتهٔ کند (هر ساعت ۰٫۵ متر)، بعد دو هفتهٔ تند (هر ساعت ۲ متر)
        for day, area in ((D(2026, 8, 10), 20), (D(2026, 8, 17), 20), (D(2026, 9, 14), 80), (D(2026, 9, 21), 80)):
            self.report(p, self.a, area, day, hours=40)
        planning.clear_cache()
        t = planning.productivity_trend(today=SAT)
        rate = (50 + 160) / (50 + 200)                                         # ساعت بر مترِ آستر در کلِ سابقه
        self.assertEqual(len(t["weeks"]), planning.EFF_WEEKS)
        self.assertEqual((t["now"], t["nowHours"], t["trend"]), (round(50 * 160 * rate / 80, 1), 80.0, "up"))
        self.assertLess(t["before"], t["now"])
        fast = next(w for w in t["weeks"] if w["start"] == D(2026, 9, 12))
        self.assertEqual((fast["hours"], fast["percent"]), (40.0, round(50 * 80 * rate / 40, 1)))
        d = self.plan(check=False)
        self.assertEqual((d["efficiency"]["now"], d["efficiency"]["trend"]), (t["now"], "up"))

    def test_569_too_few_hours_say_nothing(self):
        p = self.proj("پ", stages={self.a: 500})
        self.report(p, self.a, 10, D(2026, 9, 21), hours=5)
        planning.clear_cache()
        t = planning.productivity_trend(today=SAT)
        self.assertEqual((t["now"], t["trend"]), (None, None))
        self.assertIsNone(next(w for w in t["weeks"] if w["start"] == D(2026, 9, 19))["percent"])

    def test_570_general_work_and_rework_are_left_out(self):
        p = self.proj("پ", stages={self.a: 500})
        chores = Project.objects.create(name="خدمات", general=True)
        for day in (D(2026, 9, 14), D(2026, 9, 21)):
            rep = self.report(p, self.a, 40, day, hours=40)
            ReportItem.objects.create(report=rep, employee="رضا", project=chores, activity=self.a.name, hours=30)
            ReportItem.objects.create(report=rep, employee="رضا", project=p, activity=self.a.name, hours=20, rework=True)
        planning.clear_cache()
        self.assertEqual(planning.productivity_trend(today=SAT)["nowHours"], 80.0)

    def test_571_hours_every_day_but_the_area_only_when_the_job_is_done(self):
        p = self.proj("پ", stages={self.a: 500})
        q = self.proj("ق", stages={self.a: 500})
        # دو هفته هر روز ساعت می‌زنند و متراژ را آخرِ کار: همهٔ ۸۰ ساعت به همان ۱۶۰ متر و به هفتهٔ ثبتِ متراژ می‌رسد
        for day in (D(2026, 9, 12), D(2026, 9, 14), D(2026, 9, 16), D(2026, 9, 19), D(2026, 9, 21)):
            self.report(p, self.a, 0, day, hours=16)
        self.report(p, self.a, 160, D(2026, 9, 22))
        self.report(q, self.a, 0, D(2026, 9, 28), hours=30)                    # کارِ در جریان: هنوز متراژ ندارد
        planning.clear_cache()
        t = planning.productivity_trend(today=SAT)
        rate = (50 + 80) / (50 + 160)                                          # ساعتِ کارِ بی‌متراژ در سرعتِ مرحله هم نمی‌آید
        self.assertEqual({w["start"]: w["hours"] for w in t["weeks"] if w["hours"]},
                         {D(2026, 8, 29): 150.0, D(2026, 9, 19): 80.0})          # ۱۵۰ ساعتِ سابقهٔ پایه، و این کار
        self.assertEqual((t["now"], t["nowHours"], t["pendingHours"]), (round(50 * 160 * rate / 80, 1), 80.0, 30.0))
        self.assertEqual([(m["project"], m["stage"], m["hours"], m["from"], m["to"], m["lastArea"], m["closed"]) for m in t["missing"]],
                         [("ق", self.a.name, 30.0, D(2026, 9, 28), D(2026, 9, 28), None, False)])
        self.report(q, self.a, 30, SAT)                                        # متراژش که ثبت شد، ساعت‌هایش هم حساب می‌شود
        planning.clear_cache()
        t = planning.productivity_trend(today=SAT)
        self.assertEqual((t["nowHours"], t["pendingHours"], t["missing"]), (110.0, 0.0, []))


class Simulator(Base):
    """شبیه‌سازِ کارگاه: همان برنامه، روزبه‌روز و ایستگاه‌به‌ایستگاه، با فرضِ دلخواه و بدونِ ذخیره (۵۷۴ تا ۵۷۶)."""

    def test_574_the_simulator_plays_the_same_plan_day_by_day(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24)
        d, sim = self.plan(), planning.simulator(today=SAT)
        self.assertIsNone(sim["scenario"])
        self.assertEqual([x["date"] for x in sim["now"]["days"]], [x["date"] for x in d["days"]])
        for mine, real in zip(sim["now"]["days"], d["days"]):
            self.assertEqual([(ln["projectId"], ln["stage"], ln["station"], ln["area"]) for ln in mine["lines"]],
                             [(ln["projectId"], ln["stage"], ln["station"], ln["area"]) for ln in real["lines"]])
            self.assertEqual((mine["pool"], mine["used"]), (real["pool"], real["used"]))
        self.assertEqual(sim["now"]["finish"], d["totals"]["finish"])
        self.assertEqual({p["id"]: sim["now"]["finishes"][p["id"]] for p in sim["projects"]},
                         {p["id"]: p["finish"] for p in d["projects"]})
        self.assertEqual({st["id"] for st in sim["stations"]}, {st["id"] for st in d["stations"] if st["active"]})

    def test_575_an_assumption_gives_a_second_plan_and_saves_nothing(self):
        self.user.access = ["production"]                                      # خواندنی است؛ همان سربرگِ تولید بس است
        self.user.save()
        self.proj("الف", area=80)
        before = (PlanOvertime.objects.count(), self.plan()["totals"]["finish"])
        sim = planning.simulator({"overtime": {"hours": 4, "days": 10}, "note": "فرض نیست"}, today=SAT)
        sc = sim["scenario"]
        self.assertLess(sc["finish"], sim["now"]["finish"])
        self.assertEqual(sc["endGain"], (sim["now"]["finish"] - sc["finish"]).days)
        self.assertEqual((sc["days"][0]["overtime"], sim["now"]["days"][0]["overtime"]), (4.0, 0.0))
        self.assertEqual(sum(ln["area"] for x in sc["days"] for ln in x["lines"]),
                         sum(ln["area"] for x in sim["now"]["days"] for ln in x["lines"]))     # همان کار، فقط زودتر
        r = self.api().post("/api/production/plan-sim/", {"workers": 1}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["scenario"]["label"], "۱ کارگرِ تازه")
        self.assertIsNone(self.api().get("/api/production/plan-sim/").json()["scenario"])
        self.assertEqual((PlanOvertime.objects.count(), self.plan()["totals"]["finish"]), before)

    def test_576_a_new_project_and_a_wrong_assumption(self):
        p = self.proj("الف", area=40)
        sim = planning.simulator({"clone": {"project": str(p.pk)}}, today=SAT)
        self.assertEqual([x["id"] for x in sim["scenario"]["extra"]], ["new"])
        self.assertTrue(sim["scenario"]["finishes"]["new"])
        self.assertEqual(len(sim["projects"]), 1)                              # پروژهٔ فرضی فقط در همان فرض است
        with self.assertRaises(ValidationError):
            planning.simulator({"off": {"station": "نیست", "days": 2}}, today=SAT)
        with self.assertRaises(ValidationError):
            planning.simulator(["نه"], today=SAT)
        self.assertIsNone(planning.simulator({"note": "x"}, today=SAT)["scenario"])


class NewOrder(Base):
    """«کارِ تازه کی آماده می‌شود؟»: سفارشِ فرضی با خودِ برنامه چیده می‌شود، نه با میانگین (۵۷۷ تا ۵۷۹)."""

    def test_577_the_promised_day_is_the_day_the_plan_gives_the_real_project(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24)
        before = (Project.objects.count(), self.plan()["totals"]["finish"])
        q = planning.new_order({"area": 32}, today=SAT)
        self.assertEqual([s["name"] for s in q["stages"]], [self.a.name, self.b.name])
        self.assertEqual([s["area"] for s in q["stages"]], [32.0, 32.0])
        self.assertEqual(q["now"]["finish"], before[1])
        self.assertGreaterEqual(q["last"]["finish"], before[1])                # در نوبت: بعد از کارهای فعلی
        self.assertEqual(q["last"]["moved"], [])                               # و کسی را عقب نمی‌اندازد
        self.assertEqual((Project.objects.count(), self.plan()["totals"]["finish"]), before)   # چیزی ذخیره نشد
        # همان سفارش اگر واقعاً پروژه شود، برنامه همان روز را برایش می‌دهد
        self.proj("تازه", area=32)
        d = self.plan()
        self.assertEqual(self.P(d, "تازه")["finish"], q["last"]["finish"])
        self.assertEqual(q["last"]["workingDays"], sum(1 for x in d["days"] if x["date"] <= q["last"]["finish"]))

    def test_578_fewer_stages_or_first_in_line(self):
        self.proj("الف", area=80)
        full = planning.new_order({"area": 40}, today=SAT)
        short = planning.new_order({"area": 40, "stages": [self.a.name, "مرحله‌ای که نیست"]}, today=SAT)
        self.assertEqual([s["name"] for s in short["stages"]], [self.a.name])
        self.assertLessEqual(short["last"]["finish"], full["last"]["finish"])
        # جلوتر از همه: خودش زودتر آماده است و کارِ فعلی دیرتر می‌شود
        self.assertLess(full["first"]["finish"], full["last"]["finish"])
        self.assertEqual([m["label"] for m in full["first"]["moved"]], ["الف"])
        self.assertLess(full["first"]["moved"][0]["days"], 0)
        for bad in ({}, {"area": 0}, {"area": -5}, {"area": "زیاد"}, {"area": 10, "stages": ["مرحله‌ای که نیست"]},
                    {"area": 10, "stages": "آستر"}, ["نه"]):
            with self.assertRaises(ValidationError, msg=bad):
                planning.new_order(bad, today=SAT)

    def test_579_the_page_asks_with_the_production_tab_only(self):
        self.user.access = ["production"]
        self.user.save()
        self.proj("الف", area=40)
        before = Project.objects.count()
        r = self.api().get("/api/production/plan-quote/")
        self.assertEqual([s["name"] for s in r.json()["stages"]], [self.a.name, self.b.name])
        r = self.api().post("/api/production/plan-quote/", {"area": 16}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["last"]["finish"])
        self.assertEqual(self.api().post("/api/production/plan-quote/", {"area": 0}, format="json").status_code, 400)
        self.assertEqual(Project.objects.count(), before)


class Modes(Base):
    """فورس (اول صف) و خارج از برنامه، از دستِ مسئول؛ برمی‌گردد و در تاریخچه می‌ماند (۵۸۰ تا ۵۸۲)."""

    def test_580_a_forced_project_goes_first_whatever_the_order(self):
        self.proj("الف")
        b = self.proj("ب")
        self.assertEqual([p["name"] for p in self.plan()["projects"]], ["الف", "ب"])
        self.assertEqual(self.post("plan-mode", {"project": str(b.pk), "mode": "force"}).status_code, 200)
        d = self.plan()
        self.assertEqual([p["name"] for p in d["projects"]], ["ب", "الف"])
        self.assertEqual((self.P(d, "ب")["mode"], self.P(d, "الف")["mode"]), ("force", ""))

    def test_581_an_outside_project_is_not_planned_until_it_comes_back(self):
        a = self.proj("الف")
        self.proj("ب")
        self.assertEqual(self.post("plan-mode", {"project": str(a.pk), "mode": "outside"}).status_code, 200)
        d = self.plan()
        self.assertEqual([p["name"] for p in d["projects"]], ["ب"])
        self.assertEqual([o["label"] for o in d["outside"]], ["الف"])
        self.assertTrue(all(ln["projectId"] != str(a.pk) for x in d["days"] for ln in x["lines"]))
        self.assertEqual(self.post("plan-mode", {"project": str(a.pk), "mode": ""}).status_code, 200)
        d = self.plan()
        self.assertEqual([p["name"] for p in d["projects"]], ["الف", "ب"])
        self.assertEqual(d["outside"], [])

    def test_582_a_wrong_mode_is_refused_and_undo_brings_it_back(self):
        self.proj("الف")
        b = self.proj("ب")
        self.assertEqual(self.post("plan-mode", {"project": str(b.pk), "mode": "هیچی"}).status_code, 400)
        self.assertEqual(self.post("plan-mode", {"project": "999999", "mode": "force"}).status_code, 400)
        n = PlanChange.objects.count()
        self.assertEqual(self.post("plan-mode", {"project": str(b.pk), "mode": "force"}).status_code, 200)
        self.assertEqual(PlanChange.objects.count(), n + 1)                    # در تاریخچه ثبت شد
        self.assertEqual(self.post("plan-undo", {}).status_code, 200)
        b.refresh_from_db()
        self.assertEqual(b.plan_mode, "")
        self.assertEqual([p["name"] for p in self.plan()["projects"]], ["الف", "ب"])


class DayForm(Base):
    """فرمِ «ثبت گزارش» طبق برنامهٔ همان روز: نفرات و ساعتشان، و متراژِ هر پروژه/مرحله (۵۸۳ تا ۵۸۵)."""

    def test_583_the_form_of_a_day_is_what_the_plan_says_for_that_day(self):
        self.proj("الف", area=40)
        self.proj("ب", area=24)
        x = self.day(self.plan(), SAT)
        f = planning.day_form(SAT)
        self.assertEqual((f["date"], f["working"], f["hours"]), (SAT, True, 8.0))
        want = defaultdict(float)
        for name, jobs in x["people"].items():
            for j in jobs:
                want[(name, j["project"], j["stage"])] += j["hours"]
        self.assertEqual(sorted((i["employee"], i["projectLabel"], i["activity"], i["hours"]) for i in f["items"]),
                         sorted((n, p, s, round(h * 2) / 2) for (n, p, s), h in want.items()))
        self.assertTrue(f["items"] and all(i["location"] == "workshop" for i in f["items"]))
        area = defaultdict(float)
        for ln in x["lines"]:
            area[(ln["project"], ln["stage"])] += ln["area"]
        self.assertEqual({(g["projectLabel"], g["stage"]): g["area"] for g in f["progress"]},
                         {k: round(v, 2) for k, v in area.items()})
        per = defaultdict(float)
        for i in f["items"]:
            per[i["employee"]] += i["hours"]
        self.assertTrue(all(h <= 8.5 for h in per.values()), dict(per))        # هیچ‌کس بیش از روزش (با گرد کردنِ نیم‌ساعتی)

    def test_584_a_day_off_has_no_form_and_a_later_day_is_planned_from_that_day(self):
        self.proj("الف", area=40)
        f = planning.day_form(FRI)
        self.assertEqual((f["working"], f["items"], f["progress"]), (False, [], []))
        self.holiday(SUN)
        self.assertFalse(planning.day_form(SUN)["working"])
        # فرمِ دوشنبه «از دوشنبه» چیده می‌شود: همان کاری که اگر تا آن روز چیزی گزارش نشده باشد اول از همه می‌آید
        mon, sat = planning.day_form(MON), planning.day_form(SAT)
        self.assertEqual([(g["projectLabel"], g["stage"]) for g in mon["progress"]], [(g["projectLabel"], g["stage"]) for g in sat["progress"]])

    def test_585_the_entry_page_reads_it_and_saves_nothing(self):
        self.proj("الف", area=40)
        before = (DailyReport.objects.count(), ReportItem.objects.count(), ReportProgress.objects.count())
        self.user.access = ["entry"]
        self.user.save()
        r = self.api().get("/api/reports/plan-day/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(set(r.json()), {"date", "working", "hours", "items", "progress"})
        self.assertEqual(self.api().get("/api/reports/plan-day/?date=نه").status_code, 400)
        self.assertEqual(self.api().get("/api/reports/plan-day/?date=2020-01-01").status_code, 400)
        self.user.access = ["reports"]
        self.user.save()
        self.assertEqual(self.api().get("/api/reports/plan-day/").status_code, 403)
        self.assertEqual((DailyReport.objects.count(), ReportItem.objects.count(), ReportProgress.objects.count()), before)

    def test_586_a_report_not_yet_approved_counts_for_the_next_days_form(self):
        p = self.proj("الف")                                    # آستر و پرداخت، هر کدام ۱۶ متر
        self.assertIn(self.a.name, [g["stage"] for g in planning.day_form(SAT)["progress"]])
        rep = self.report(p, self.a, 16, SAT - W(2), status="waiting", hours=16)      # کلِ آستر، ثبت‌شده ولی هنوز تأییدنشده
        real = production.stage_time_rates()
        after = planning.day_form(SAT)
        self.assertEqual([g["stage"] for g in after["progress"]], [self.b.name])        # آستر تمام است: مرحلهٔ بعد می‌آید
        self.assertTrue(all(i["activity"] == self.b.name for i in after["items"]) and after["items"])
        # هیچ چیز ذخیره نشده، برنامهٔ واقعی همان است، و سه عددِ سابقه دست نخورده‌اند
        self.assertEqual(DailyReport.objects.get(pk=rep.pk).status, "waiting")
        self.assertIn(self.a.name, [ln[1] for ln in self.lines(self.plan(), SAT)])
        self.assertEqual(planning._history["rates"][1], real)
        self.assertEqual(production.stage_time_rates(), real)
        # گزارشِ همان روز یا بعدش شمرده نمی‌شود: فرمِ پنجشنبه هنوز آستر را دارد
        self.assertIn(self.a.name, [g["stage"] for g in planning.day_form(SAT - W(2))["progress"]])

    def test_587_days_with_an_unfinished_report_are_listed_oldest_first(self):
        p = self.proj("الف")
        self.assertEqual(planning.report_todo(SAT, back=0), [{"date": SAT.isoformat(), "why": "none"}])
        self.holiday(SUN)
        self.report(p, self.a, 0, SAT, status="waiting", hours=8)     # ساعت دارد و متراژ نه، ولی متراژِ همین مرحله سه‌شنبه آمد
        self.report(p, self.a, 4, MON)                                 # فقط متراژ: هنوز ردیفِ کاری ندارد
        self.report(p, self.a, 8, TUE, hours=8)                        # کامل
        self.report(p, self.b, 0, WED, status="waiting", hours=6)     # ساعت دارد، متراژش مانده
        q = self.proj("ب", stages=(self.a,))
        self.report(q, self.b, 0, THU, hours=3)                        # مرحله‌ای که پروژه ندارد: درست‌شدنی نیست، روز را ناتمام نمی‌کند
        self.assertEqual(planning.report_todo(THU, back=5),
                         [{"date": MON.isoformat(), "why": "none"}, {"date": WED.isoformat(), "why": "area"}])
        self.report(p, self.b, 3, THU)                                 # متراژِ پرداخت که آمد، چهارشنبه هم کامل است
        self.assertEqual(planning.report_todo(THU, back=5), [{"date": MON.isoformat(), "why": "none"}])
        days = [t["date"] for t in planning.report_todo(SAT2, back=7)]
        self.assertEqual(days, [MON.isoformat(), SAT2.isoformat()])   # جمعه و تعطیلِ رسمی هیچ‌وقت

    def test_588_the_entry_page_reads_the_unfinished_days(self):
        self.user.access = ["entry"]
        self.user.save()
        r = self.api().get("/api/reports/todo/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(all(set(t) == {"date", "why"} for t in r.json()))
        self.user.access = ["reports"]
        self.user.save()
        self.assertEqual(self.api().get("/api/reports/todo/").status_code, 403)


class Corrections(Base):
    """ایرادی که صد سناریو روی دیتای واقعی نشان داد (۵۷۲)، و ایرادی که نقشهٔ پیوندها نشان داد (۵۷۳)."""

    def test_573_a_new_name_reaches_the_on_site_team_and_stages(self):
        """تیم و مرحله‌های محلِ پروژه با نام نگه داشته می‌شوند؛ نامِ تازهٔ کارگر یا مرحله باید به آن‌ها هم برسد."""
        self.user.access = ["production", "production.plan", "production.stages", "dashboard.staff"]
        self.user.save()
        p = self.proj("در و چهارچوب")
        planning.set_site({"project": str(p.pk), "area": 8, "stages": [self.b.name], "team": ["علی"], "from": SUN.isoformat()},
                          self.user, today=SAT)
        other = self.proj("کمد")                                                # پروژه‌ای که کاری در محل ندارد دست نمی‌خورد
        r = self.api().patch(f"/api/employees/{Employee.objects.get(name='علی').pk}/", {"name": "علی رضایی"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        r = self.api().patch(f"/api/work-stages/{self.b.pk}/", {"name": "پرداخت تازه"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        p.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual((p.onsite_team, p.onsite_stages), (["علی رضایی"], ["پرداخت تازه"]))
        self.assertEqual((other.onsite_team, other.onsite_stages), ([], []))
        site = self.P(self.plan(), "در و چهارچوب")["site"]
        self.assertEqual({j["stage"] for j in site["jobs"]}, {"پرداخت تازه"})   # برنامه هنوز کارِ محل را با نامِ تازه می‌چیند

    def test_572_overtime_entered_twice_for_one_day_is_the_longer_one(self):
        self.proj("پ", stages={self.a: 100})
        self.overtime(SAT, 2)
        self.overtime(SAT, 3)                                                  # همان روز، دوباره برای همه
        d = self.plan()
        x = self.day(d, SAT)
        # روز ۱۱ ساعت است (۸ + ۳)، نه ۱۳: هر نفر ۱۱ ساعت و کارگاه دو نفر × ۱۱ ساعت
        self.assertEqual((x["base"], x["overtime"], x["pool"], self.area(d, SAT, "پ", self.a)), (8.0, 3.0, 2.75, 11.0))
        for who, items in x["people"].items():
            self.assertLessEqual(sum(i["hours"] for i in items) + x["free"].get(who, 0) * 8, 11.11, who)
        self.assertLessEqual(sum(x["free"].values()) * 8 + sum(i["hours"] for v in x["people"].values() for i in v), 22.2)
        self.overtime(SAT, 4, people=1)                                        # یک گروهِ یک‌نفره کنارِ آن‌ها: این یکی جمع می‌شود
        self.assertEqual(self.day(self.plan(), SAT)["pool"], 3.25)
