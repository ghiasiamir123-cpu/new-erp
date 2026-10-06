"""سناریوهای تازهٔ برنامه‌ریزی تولید — ورودیِ خراب و دسترسی، تغییرِ داده‌های پایه، و موقعیت‌های درهم (۲۱۸ تا ۲۵۰)."""
import random

from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from .models import PlanBaselineLine, PlanLeave, PlanQueueSnapshot, PlanTask, User
from .planning_testkit import *  # noqa: F401,F403
from .planning_testkit import Kit

POSTS = ("plan-order", "plan-task", "plan-shift", "plan-stations", "plan-overtime", "plan-holiday", "plan-leave",
         "plan-pause", "plan-resume", "plan-commit")


class Robust(Kit):
    def test_218_a_body_that_is_a_list_is_refused_not_crashed(self):
        self.proj("الف")
        for path in POSTS:
            r = self.post(path, [1, 2])
            self.assertEqual(r.status_code, 400, f"{path}: {r.status_code}")

    def test_219_a_digit_that_is_not_a_number(self):
        p = self.proj("الف")
        for path, body in (("plan-task", {"project": "²", "stage": self.a.name, "days": 2}),
                           ("plan-order", {"ids": ["²"]}),
                           ("plan-pause", {"project": "²"}),
                           ("plan-resume", {"project": "²"}),
                           ("plan-shift", {"project": "²", "days": 1}),
                           ("plan-task", {"project": str(p.pk), "stage": self.a.name, "together": ["²"]}),
                           ("plan-stations", {"stations": [{"id": "²", "name": "یک"}]})):
            r = self.post(path, body)
            self.assertIn(r.status_code, (200, 400), f"{path}: {r.status_code}")

    def test_220_someone_who_may_only_look(self):
        self.proj("الف")
        viewer = User.objects.create_user(username="viewer", password="x", name="بیننده", role="member", access=["production"])
        r = self.api(viewer).get("/api/production/plan/")
        self.assertEqual((r.status_code, r.json()["canEdit"]), (200, False))
        for path in POSTS:
            self.assertEqual(self.post(path, {}, user=viewer).status_code, 403, path)

    def test_221_nobody_signed_in(self):
        c = APIClient()
        self.assertIn(c.get("/api/production/plan/").status_code, (401, 403))
        self.assertIn(c.post("/api/production/plan-commit/", {}, format="json").status_code, (401, 403))

    def test_222_the_order_list(self):
        p = self.proj("الف")
        closed = self.proj("بسته", closed_at=SAT)
        for bad in ({"ids": "x"}, {"ids": None}, {}, {"ids": [1, "a"]}, {"ids": [[1]]}):
            self.assertEqual(self.post("plan-order", bad).status_code, 400)
        self.assertEqual(self.post("plan-order", {"ids": [closed.pk, p.pk, p.pk, 999999]}).status_code, 200)
        self.assertEqual(Project.objects.get(pk=p.pk).plan_priority, 3)

    def test_223_overtime_that_makes_no_sense(self):
        for bad in ({"date": SAT.isoformat(), "hours": 0}, {"date": SAT.isoformat(), "hours": 13},
                    {"date": SAT.isoformat(), "hours": "x"}, {"date": SAT.isoformat(), "hours": 2, "people": 0},
                    {"date": SAT.isoformat(), "hours": 2, "people": "x"}, {"hours": 2}, {"date": SAT.isoformat()},
                    {"date": SAT.isoformat(), "hours": "nan"}, {"date": SAT.isoformat(), "hours": -2}):
            self.assertEqual(self.post("plan-overtime", bad).status_code, 400, bad)

    def test_224_a_holiday_or_a_leave_with_missing_parts(self):
        self.assertEqual(self.post("plan-holiday", {"title": "x"}).status_code, 400)
        for bad in ({"from": SAT.isoformat()}, {"employee": "علی"}, {"employee": "علی", "from": "x"},
                    {"employee": "علی", "from": SAT.isoformat(), "to": "x"}):
            self.assertEqual(self.post("plan-leave", bad).status_code, 400, bad)

    def test_225_pause_and_resume_with_nothing_to_act_on(self):
        p = self.proj("الف")
        self.assertEqual(self.post("plan-resume", {"project": p.pk}).status_code, 400)
        self.assertEqual(self.post("plan-pause", {"project": 999999}).status_code, 400)
        self.assertEqual(self.post("plan-pause", {}).status_code, 400)
        self.assertEqual(self.post("plan-pause", {"project": p.pk, "start": "x"}).status_code, 400)

    def test_226_committing_through_the_page(self):
        self.proj("الف")
        r = self.post("plan-commit", {"note": "ی" * 900})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["baseline"]["note"]), 300)

    def test_227_a_job_edit_with_nothing_or_nonsense_in_it(self):
        p = self.proj("الف")
        for bad in ({}, {"project": str(p.pk)}, {"project": str(p.pk), "stage": "نیست"}, {"stage": self.a.name},
                    {"project": str(p.pk), "stage": self.a.name, "station": "s:نیست"},
                    {"project": str(p.pk), "stage": self.a.name, "station": 999999},
                    {"project": str(p.pk), "stage": self.a.name, "crew": 2.5e9},
                    {"project": str(p.pk), "stage": self.a.name, "notBefore": 5}):
            self.assertEqual(self.post("plan-task", bad).status_code, 400, bad)
        self.assertFalse(PlanTask.objects.exists())

    def test_228_clearing_the_crew_through_the_page(self):
        p = self.proj("الف")
        self.assertEqual(self.post("plan-task", {"project": str(p.pk), "stage": self.a.name, "crew": 2}).status_code, 200)
        self.assertEqual(self.post("plan-task", {"project": str(p.pk), "stage": self.a.name, "crew": None}).status_code, 200)
        self.assertFalse(PlanTask.objects.exists())

    def test_229_removing_with_rubbish_ids(self):
        for path in ("plan-overtime", "plan-holiday", "plan-leave", "plan-pause"):
            for rid in ("abc", True, [1], {"a": 1}, "²", -5):
                self.assertEqual(self.post(path, {"remove": rid}).status_code, 200, (path, rid))

    def test_230_the_page_gets_everything_it_reads(self):
        self.proj("الف")
        d = self.api().get("/api/production/plan/").json()
        for key in ("today", "start", "settings", "stations", "stageNames", "employees", "projects", "days", "past", "history",
                    "deviation", "baseline", "queues", "overtime", "holidays", "paused", "pauseReasons", "leaves", "totals",
                    "warnings", "canEdit"):
            self.assertIn(key, d)
        self.assertRegex(d["today"], r"^\d{4}-\d{2}-\d{2}$")

    def test_231_a_decision_for_a_closed_project_is_refused(self):
        p = self.proj("الف", closed_at=SAT)
        for body in ({"notBefore": MON.isoformat()}, {"crew": 2}, {"days": 3}):
            with self.assertRaises(ValidationError):
                self.task(p, self.a, **body)
        self.assertFalse(PlanTask.objects.exists())

    def test_232_a_leave_with_rubbish_hours_or_kind(self):
        for bad in ({"hours": "nan"}, {"hours": "inf"}, {"hours": -1}, {"hours": [1]}, {"kind": 5}, {"kind": ["leave"]}):
            r = self.post("plan-leave", {"employee": "علی", "from": SAT.isoformat(), **bad})
            self.assertEqual(r.status_code, 400, bad)
        self.assertFalse(PlanLeave.objects.exists())


class DataChanges(Kit):
    def test_233_renaming_a_worker_keeps_the_station_and_the_leave(self):
        self.user.access = ["production", "production.plan", "dashboard.staff"]
        self.user.save()
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        self.leave("رضا", SUN)
        e = Employee.objects.get(name="رضا")
        r = self.api().patch(f"/api/employees/{e.pk}/", {"name": "رضا احمدی"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Station.objects.get().people, ["علی", "رضا احمدی"])
        self.assertEqual(PlanLeave.objects.get().employee, "رضا احمدی")
        self.proj("الف", area=40)
        d = self.plan()
        self.assertEqual(self.area(d, SAT, "الف", self.a), 16.0)
        self.assertEqual(self.area(d, SUN, "الف", self.a), 8.0)        # مرخصیِ یکشنبه سر جایش است

    def test_234_deleting_a_worker(self):
        Station.objects.create(name="کابین", stages=[self.a.name], people=["علی", "رضا"], order=0)
        self.leave("رضا", SUN)
        Employee.objects.filter(name="رضا").delete()
        self.proj("الف")
        d = self.plan()
        self.assertEqual((d["settings"]["crew"], self.area(d, SAT, "الف", self.a)), (1, 8.0))

    def test_235_a_stage_in_use_cannot_be_deleted(self):
        self.user.access = ["production", "production.plan", "production.stages"]
        self.user.save()
        self.proj("الف")
        r = self.api().delete(f"/api/work-stages/{self.b.pk}/")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(WorkStage.objects.filter(pk=self.b.pk).exists())

    def test_236_swapping_the_order_of_two_stages(self):
        self.proj("الف")
        WorkStage.objects.filter(pk=self.a.pk).update(order=5)
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.b.name, self.a.name])
        self.assertEqual([s["name"] for s in d["stations"]], [self.b.name, self.a.name])
        self.assertEqual(self.J(d, "الف", self.a)["start"], SUN)

    def test_237_a_reopened_project_comes_back_with_its_decisions(self):
        p = self.proj("الف")
        self.task(p, self.a, days=4)
        Project.objects.filter(pk=p.pk).update(closed_at=SAT)
        self.assertEqual(self.plan()["projects"], [])
        Project.objects.filter(pk=p.pk).update(closed_at=None)
        self.assertEqual(self.J(self.plan(), "الف", self.a)["daily"], 4.0)

    def test_238_deleting_a_project_takes_its_plan_with_it(self):
        p = self.proj("الف")
        self.proj("ب")
        self.task(p, self.a, days=4)
        planning.commit(self.user, today=SAT)
        p.delete()
        d = self.plan(SUN)
        self.assertEqual(self.names(d), ["ب"])
        self.assertFalse(PlanTask.objects.exists())
        self.assertNotIn("الف", [ln["project"] for x in d["past"] for ln in x["lines"]])

    def test_239_a_decision_left_behind_by_a_removed_stage_is_ignored(self):
        p = self.proj("الف")
        self.task(p, self.b, notBefore=WED.isoformat(), crew=2)
        ProjectStage.objects.filter(project=p, name=self.b.name).delete()
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.a.name])
        self.assertEqual(self.P(d, "الف")["finish"], SUN)

    def test_240_renaming_a_stage_keeps_its_queue_history(self):
        self.user.access = ["production", "production.plan", "production.stages"]
        self.user.save()
        p = self.proj("الف")
        self.report(p, self.a, 8, PAST)
        planning.daily(today=SAT)
        r = self.api().patch(f"/api/work-stages/{self.b.pk}/", {"name": "پرداخت تازه"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        planning.clear_cache()
        q = next(q for q in self.plan(SUN)["queues"] if q["name"] == "پرداخت تازه")
        self.assertEqual([(t["date"], t["ready"]) for t in q["trend"]], [(SAT, 8.0)])
        self.assertEqual(set(PlanBaselineLine.objects.values_list("stage", flat=True)), {self.a.name, "پرداخت تازه"})

    def test_241_a_stage_switched_to_no_area_while_work_is_left(self):
        self.proj("الف")
        WorkStage.objects.filter(pk=self.b.pk).update(needs_area=False)
        d = self.plan()
        self.assertEqual([j["stage"] for j in self.P(d, "الف")["jobs"]], [self.a.name])
        self.assertTrue(any(self.b.name in w for w in d["warnings"]), d["warnings"])

    def test_242_a_project_switched_off_and_on_again(self):
        p = self.proj("الف")
        Project.objects.filter(pk=p.pk).update(active=False)
        self.assertEqual(self.plan()["projects"], [])
        Project.objects.filter(pk=p.pk).update(active=True)
        self.assertEqual(self.P(self.plan(), "الف")["finish"], WED)

    def test_243_a_new_worker_joins(self):
        c = self.stage("رنگ آزمایشی", 3)
        x, y, z = self.proj("یک", stages=[self.a]), self.proj("دو", stages=[self.b]), self.proj("سه", stages=[c])
        planning.set_order([x.pk, y.pk, z.pk])
        self.assertEqual(len(self.lines(self.plan(), SAT)), 2)
        Employee.objects.create(name="مینا")
        self.assertEqual(len(self.lines(self.plan(), SAT)), 3)


class Mixtures(Kit):
    def mixture(self, seed, n=10):
        """کارگاهی درهم با عددهای ثابتِ همین بذر: مرحله‌ها، ایستگاه‌ها، مرخصی، اضافه‌کاری، تعطیلی، تصمیم‌های دستی،
        با هم بردن، توقف و برنامهٔ ثبت‌شده. چیزی که باید درست بماند وارسیِ خودِ برنامه است (Kit.check)."""
        r = random.Random(seed)
        WorkStage.objects.filter(pk=self.a.pk).update(wait_hours=r.choice([0, 0, 24]))
        c = self.stage("رنگ آزمایشی", 3, hpm=r.choice([0.5, 1, 1.5]), wait=r.choice([0, 24, 48]))
        for name in ("حسن", "مینا", "سارا"):
            Employee.objects.create(name=name)
        people = ["علی", "رضا", "حسن", "مینا", "سارا"]
        if r.random() < 0.7:
            Station.objects.create(name="کابین", stages=[self.a.name], people=r.sample(people, 2), order=0)
        if r.random() < 0.5:
            Station.objects.create(name="میز", stages=[self.b.name, c.name], crew=r.randint(1, 3), order=1)
        helper = Station.objects.create(name="کمکی", stages=[], crew=1, order=9)
        all_stages = [self.a, self.b, c]
        projects = []
        for i in range(n):
            chosen = sorted(r.sample(all_stages, r.randint(1, 3)), key=lambda s: s.order)
            stages = {s: r.choice([4, 9.5, 16, 33.3, 60]) for s in chosen}
            p = self.proj(f"پ{i:02d}", stages=stages, due_date=r.choice([None, SAT + W(r.randint(3, 40))]))
            projects.append((p, stages))
            for s, area in stages.items():
                if r.random() < 0.3:
                    self.report(p, s, round(area * r.random(), 2), PAST + W(r.randint(0, 31)))
        planning.set_order([p.pk for p, _ in r.sample(projects, 3)])
        for _ in range(r.randint(0, 5)):
            kw = {"kind": r.choice(["leave", "general"])}
            if r.random() < 0.5:
                kw["hours"] = r.choice([2, 4, 6])
            day = SAT + W(r.randint(0, 12))
            self.leave(r.choice(people), day, day + W(r.randint(0, 3)), **kw)
        for _ in range(r.randint(0, 3)):
            self.overtime(SAT + W(r.randint(0, 13)), r.choice([2, 4, 8]), r.choice([None, 1, 2]))
        for _ in range(r.randint(0, 2)):
            self.holiday(SAT + W(r.randint(1, 13)))
        for p, stages in r.sample(projects, min(6, n)):
            s = r.choice(list(stages))
            body = r.choice([{"days": r.choice([1, 2.5, 6])}, {"crew": r.randint(1, 4)},
                             {"notBefore": (SAT + W(r.randint(0, 10))).isoformat()},
                             {"notBefore": (SAT + W(r.randint(0, 10))).isoformat(), "pull": True},
                             {"station": str(helper.pk)},
                             {"notBefore": (SAT + W(2)).isoformat(), "finish": (SAT + W(r.randint(2, 9))).isoformat()}])
            try:
                self.task(p, s, **body)
            except ValidationError:
                pass
        for s in all_stages:
            having = [p for p, stages in projects if s in stages]
            if len(having) >= 2 and r.random() < 0.6:
                x, y = r.sample(having, 2)
                self.task(x, s, together=[str(y.pk)])
        p, _ = r.choice(projects)
        planning.pause_project({"project": p.pk, "start": (SAT + W(r.randint(0, 4))).isoformat()}, self.user, today=SAT)
        if r.random() < 0.6:
            planning.resume_project({"project": p.pk, "end": (SAT + W(r.randint(5, 9))).isoformat()}, self.user, today=SAT)
        planning.commit(self.user, today=SAT)
        out = []
        for today in (SAT, MON, THU, FRI, SAT2, SAT2 + W(9)):
            out.append(self.plan(today))
        return out

    def test_244_the_same_question_twice_gives_the_same_answer(self):
        self.proj("الف", area=40, due_date=D(2026, 10, 20))
        self.proj("ب", area=24)
        self.leave("علی", MON)
        self.assertEqual(self.plan(), self.plan())

    def test_245_a_tangled_workshop_1(self):
        self.mixture(1)

    def test_246_a_tangled_workshop_2(self):
        self.mixture(2)

    def test_247_a_tangled_workshop_3(self):
        self.mixture(3)

    def test_248_a_tangled_workshop_4(self):
        self.mixture(4, n=14)

    def test_249_a_tangled_workshop_5(self):
        self.mixture(5, n=20)

    def test_250_undoing_every_change_gives_the_first_plan_back(self):
        p = self.proj("الف", area=40)
        self.proj("ب", area=24)
        first = self.plan()
        self.leave("علی", MON)
        self.overtime(TUE, 4)
        self.holiday(WED)
        self.task(p, self.b, notBefore=SUN2.isoformat(), crew=2)
        planning.pause_project({"project": p.pk}, self.user, today=SAT)
        self.assertNotEqual(self.plan(), first)
        from .models import PlanHoliday, PlanOvertime
        PlanLeave.objects.all().delete()
        PlanOvertime.objects.all().delete()
        PlanHoliday.objects.filter(date=WED).delete()
        self.task(p, self.b, notBefore=None, crew=None)
        ProjectPause.objects.all().delete()
        again = self.plan()
        for key in ("projects", "days", "totals", "queues", "warnings"):
            self.assertEqual(again[key], first[key], key)

    def test_251_a_month_of_mornings_in_a_tangled_workshop(self):
        """هر صبح کارِ صبح اجرا می‌شود و هشتاد درصدِ برنامهٔ همان روز گزارش می‌شود؛ کار باید بالاخره تمام شود."""
        for i, area in enumerate((24, 16, 30)):
            self.proj(f"پ{i}", area=area, due_date=SAT + W(10 + 5 * i))
        self.leave("رضا", WED, THU)
        self.holiday(MON2)
        day, left = SAT, None
        for _ in range(45):
            planning.daily(today=day)
            d = self.plan(day)
            if not d["projects"]:
                break
            x = self.day(d, day)
            for ln in (x["lines"] if x else []):
                self.report(Project.objects.get(pk=int(ln["projectId"])), WorkStage.objects.get(name=ln["stage"]),
                            round(ln["area"] * 0.8, 2), day)
            left = d["totals"]["area"]
            day += W(1)
        self.assertEqual(self.plan(day)["totals"]["area"], 0.0, f"هنوز {left} متر مانده")
        self.assertEqual(PlanQueueSnapshot.objects.values("date", "station").distinct().count(), PlanQueueSnapshot.objects.count())
