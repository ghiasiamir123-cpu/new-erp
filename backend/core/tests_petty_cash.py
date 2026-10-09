"""تنخواه: خرجِ تنخواه‌دار با مرکز هزینه، شارژ و تأییدِ مالی، و اینکه هر کس فقط تنخواهِ خودش را می‌بیند."""

import datetime
import importlib

from django.apps import apps as django_apps
from django.test import TestCase
from rest_framework.test import APIClient

from . import access, pettycash
from .models import PettyCash, PettyCashHolder, Project, User, UserAuditLog

TODAY = datetime.date.today()
PHOTO = "data:image/jpeg;base64," + "A" * 200


class PettyCashTests(TestCase):
    def setUp(self):
        self.fin = User.objects.create_user(username="fin", password="x", name="مالی", role="manager",
                                            access=["accounting", "accounting.cash"])
        self.drv = User.objects.create_user(username="drv", password="x", name="راننده", role="driver",
                                            access=["driver", "accounting"])
        self.buyer = User.objects.create_user(username="buyer", password="x", name="خریدار", role="data_entry",
                                              access=["accounting"])
        self.out = User.objects.create_user(username="out", password="x", name="بی‌دسترسی", role="viewer", access=["reports"])
        self.p = Project.objects.create(name="مطهری", code="CC05-D1001")
        self.chores = Project.objects.create(name="کارهای عمومی", general=True)
        for who in ("drv", "buyer"):                            # مالی این دو را تنخواه‌دار کرده است
            pettycash.set_holder({"holder": who}, self.fin)

    def api(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def post(self, user, **kw):
        body = {"date": TODAY.isoformat(), "amount": 2_500_000, "title": "بنزین", "category": "fuel", "center": "general", **kw}
        return self.api(user).post("/api/petty-cash/", body, format="json")

    def me(self, user):
        d = self.api(user).get("/api/petty-cash/").json()
        return d, next(h for h in d["holders"] if h["holder"] == user.username)

    def test_a_holder_enters_his_expense_and_sees_only_his_own(self):
        self.assertEqual(self.post(self.fin, kind="charge", holder="drv", amount=10_000_000, title="شارژ مهر").status_code, 201)
        r = self.post(self.drv)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["status"], r.json()["holder"], r.json()["centerLabel"], r.json()["categoryLabel"]),
                         ("waiting", "drv", "کارهای عمومی کارگاه", "سوخت"))
        self.assertEqual(self.post(self.buyer, amount=900_000, title="چسب").status_code, 201)
        d, mine = self.me(self.drv)
        self.assertEqual((d["canReview"], d["me"], [h["holder"] for h in d["holders"]]), (False, "drv", ["drv"]))
        self.assertEqual(sorted((x["kind"], x["amount"]) for x in d["rows"]), [("charge", 10_000_000.0), ("expense", 2_500_000.0)])
        self.assertEqual((mine["charged"], mine["waiting"], mine["waitingCount"], mine["approved"], mine["balance"]),
                         (10_000_000.0, 2_500_000.0, 1, 0.0, 7_500_000.0))
        # مالی همه را می‌بیند: هر سه تنخواه‌دار (خودش هم)، و هر سه ردیف
        d = self.api(self.fin).get("/api/petty-cash/").json()                             # خودش تنخواه‌دار نیست
        self.assertEqual((d["canReview"], d["isHolder"], len(d["rows"]), {h["holder"] for h in d["holders"]}),
                         (True, False, 3, {"drv", "buyer"}))
        self.assertEqual([p["label"] for p in d["projects"]], ["CC05-D1001 (مطهری)"])      # کار عمومی پروژهٔ مرکز هزینه نیست
        self.assertEqual([c["id"] for c in d["centers"]], ["project", "general", "admin"])
        self.assertEqual(self.api(self.out).get("/api/petty-cash/").status_code, 403)

    def test_every_expense_needs_a_cost_centre(self):
        self.assertEqual(self.post(self.drv, center="").status_code, 400)
        self.assertEqual(self.post(self.drv, center="جای دیگر").status_code, 400)
        self.assertEqual(self.post(self.drv, center="project").status_code, 400)                       # پروژه‌اش کو؟
        self.assertEqual(self.post(self.drv, center="project", project=str(self.chores.pk)).status_code, 400)
        r = self.post(self.drv, center="project", project=str(self.p.pk))
        self.assertEqual((r.status_code, r.json()["centerLabel"], r.json()["project"]), (201, "CC05-D1001 (مطهری)", str(self.p.pk)))
        r = self.post(self.drv, center="admin", project=str(self.p.pk))
        self.assertEqual((r.status_code, r.json()["centerLabel"], r.json()["project"]), (201, "اداری", ""))
        # نامِ پروژه با حذفش کنارِ خرج می‌ماند
        self.p.delete()
        row = PettyCash.objects.get(center="project")
        self.assertEqual((row.project_id, pettycash.center_label(row)), (None, "CC05-D1001 (مطهری)"))

    def test_amount_date_and_title_are_checked(self):
        for bad in (0, -5, "", "abc", 12.5, 10 ** 12):
            self.assertEqual(self.post(self.drv, amount=bad).status_code, 400, bad)
        self.assertEqual(self.post(self.drv, amount="1,250,000").status_code, 201)
        self.assertEqual(self.post(self.drv, date=(TODAY + datetime.timedelta(days=3)).isoformat()).status_code, 400)
        self.assertEqual(self.post(self.drv, date="نه").status_code, 400)
        self.assertEqual(self.post(self.drv, title="  ").status_code, 400)
        self.assertEqual(self.post(self.drv, category="x").status_code, 400)
        self.assertEqual(PettyCash.objects.count(), 1)

    def test_only_finance_charges_and_reviews(self):
        self.assertEqual(self.post(self.drv, kind="charge", amount=1_000_000).status_code, 403)
        self.assertEqual(self.post(self.drv, kind="refund", amount=1_000_000).status_code, 403)
        self.assertEqual(self.post(self.drv, holder="buyer").status_code, 403)
        self.assertEqual(self.post(self.fin, kind="charge", holder="out", amount=1_000_000).status_code, 400)   # تنخواه‌دار نیست
        self.assertEqual(self.post(self.fin, kind="charge", holder="drv", amount=10_000_000).status_code, 201)
        self.assertEqual(self.post(self.fin, kind="refund", holder="drv", amount=3_000_000, title="تسویه").status_code, 201)
        pk = self.post(self.drv).json()["id"]
        self.assertEqual(self.api(self.drv).post(f"/api/petty-cash/{pk}/review/", {"action": "approve"}, format="json").status_code, 403)
        self.assertEqual(self.api(self.buyer).post(f"/api/petty-cash/{pk}/review/", {"action": "approve"}, format="json").status_code, 400)
        self.assertEqual(self.api(self.fin).post(f"/api/petty-cash/{pk}/review/", {"action": "return"}, format="json").status_code, 400)
        r = self.api(self.fin).post(f"/api/petty-cash/{pk}/review/", {"action": "return", "note": "رسید ندارد"}, format="json")
        self.assertEqual((r.status_code, r.json()["status"], r.json()["reviewNote"], r.json()["reviewedBy"]), (200, "returned", "رسید ندارد", "مالی"))
        _, mine = self.me(self.drv)
        self.assertEqual((mine["returnedCount"], mine["waiting"], mine["balance"]), (1, 0.0, 7_000_000.0))   # برگشتی تا اصلاح نشود حساب نیست
        # تنخواه‌دار اصلاح می‌کند و دوباره منتظرِ تأیید می‌شود
        body = {"date": TODAY.isoformat(), "amount": 2_000_000, "title": "بنزین با رسید", "category": "fuel", "center": "admin"}
        r = self.api(self.drv).put(f"/api/petty-cash/{pk}/", body, format="json")
        self.assertEqual((r.status_code, r.json()["status"], r.json()["amount"], r.json()["center"]), (200, "waiting", 2_000_000.0, "admin"))
        self.assertEqual(self.api(self.buyer).put(f"/api/petty-cash/{pk}/", body, format="json").status_code, 400)   # مالِ او نیست
        r = self.api(self.fin).post(f"/api/petty-cash/{pk}/review/", {"action": "approve"}, format="json")
        self.assertEqual(r.json()["status"], "approved")
        _, mine = self.me(self.drv)
        self.assertEqual((mine["approved"], mine["waiting"], mine["refunded"], mine["balance"]), (2_000_000.0, 0.0, 3_000_000.0, 5_000_000.0))
        # تأییدشده قفل است
        self.assertEqual(self.api(self.drv).put(f"/api/petty-cash/{pk}/", body, format="json").status_code, 400)
        self.assertEqual(self.api(self.drv).delete(f"/api/petty-cash/{pk}/").status_code, 400)
        self.assertEqual(self.api(self.fin).delete(f"/api/petty-cash/{pk}/").status_code, 400)
        # شارژ را فقط مالی برمی‌دارد؛ خرجِ منتظر را خودِ تنخواه‌دار
        charge = PettyCash.objects.get(kind="charge").pk
        self.assertEqual(self.api(self.drv).delete(f"/api/petty-cash/{charge}/").status_code, 403)
        self.assertEqual(self.api(self.fin).delete(f"/api/petty-cash/{charge}/").status_code, 204)
        pk2 = self.post(self.drv).json()["id"]
        self.assertEqual(self.api(self.drv).delete(f"/api/petty-cash/{pk2}/").status_code, 204)

    def test_receipt_photo_comes_separately(self):
        self.assertEqual(self.post(self.drv, receipt="data:text/html,x").status_code, 400)
        self.assertEqual(self.post(self.drv, receipt="data:image/jpeg;base64," + "A" * pettycash.MAX_RECEIPT).status_code, 400)
        r = self.post(self.drv, receipt=PHOTO)
        pk = r.json()["id"]
        self.assertEqual((r.status_code, r.json()["hasReceipt"]), (201, True))
        self.assertNotIn("AAAAAAAAAA", self.api(self.drv).get("/api/petty-cash/").content.decode())
        self.assertEqual(self.api(self.drv).get(f"/api/petty-cash/{pk}/receipt/").json()["receipt"], PHOTO)
        self.assertEqual(self.api(self.fin).get(f"/api/petty-cash/{pk}/receipt/").json()["receipt"], PHOTO)
        self.assertEqual(self.api(self.buyer).get(f"/api/petty-cash/{pk}/receipt/").status_code, 400)
        body = {"date": TODAY.isoformat(), "amount": 2_500_000, "title": "بنزین", "center": "general"}
        r = self.api(self.drv).put(f"/api/petty-cash/{pk}/", body, format="json")            # بی نامِ رسید: همان می‌ماند
        self.assertEqual((r.json()["hasReceipt"], r.json()["category"]), (True, "other"))
        r = self.api(self.drv).put(f"/api/petty-cash/{pk}/", {**body, "receipt": ""}, format="json")
        self.assertEqual((r.json()["hasReceipt"], PettyCash.objects.get(pk=pk).receipt), (False, ""))


class HolderTests(TestCase):
    """تنخواه‌دار را مالی از همان صفحهٔ تنخواه تعریف می‌کند و برمی‌دارد؛ حساب و سقفش همان‌جا نوشته می‌شود."""

    def setUp(self):
        self.fin = User.objects.create_user(username="fin", password="x", name="مالی", role="manager",
                                            access=["accounting", "accounting.cash"])
        self.drv = User.objects.create_user(username="drv", password="x", name="راننده", role="driver", access=["driver"])
        self.acc = User.objects.create_user(username="acc", password="x", name="حسابدار", role="accountant",
                                            access=["accounting", "accounting.salary"])
        self.gone = User.objects.create_user(username="gone", password="x", name="رفته", role="viewer", access=[], is_active=False)

    def api(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def holder(self, user=None, **kw):
        return self.api(user or self.fin).post("/api/petty-cash/holder/", kw, format="json")

    def expense(self, user, **kw):
        body = {"date": TODAY.isoformat(), "amount": 1_000_000, "title": "بنزین", "center": "general", **kw}
        return self.api(user).post("/api/petty-cash/", body, format="json")

    def test_finance_defines_a_holder_with_his_account(self):
        d = self.api(self.fin).get("/api/petty-cash/").json()
        self.assertEqual((d["holders"], [c["username"] for c in d["candidates"]]), ([], ["acc", "drv", "fin"]))   # غیرفعال نه
        # بی تعریف، نه خودش خرج می‌زند نه مالی برایش شارژ می‌کند
        self.assertEqual(self.expense(self.acc).status_code, 400)
        self.assertEqual(self.expense(self.fin, kind="charge", holder="drv", amount=5_000_000).status_code, 400)
        r = self.holder(holder="drv", account="۶۱۰۴-۳۳۷۷ 1234 5678", bank="ملت", limit=50_000_000, note="تنخواهِ سوخت و عوارض")
        self.assertEqual(r.status_code, 200, r.content)
        h = next(x for x in r.json()["holders"] if x["holder"] == "drv")
        self.assertEqual((h["defined"], h["account"], h["bank"], h["limit"], h["note"]),
                         (True, "6104337712345678", "ملت", 50_000_000.0, "تنخواهِ سوخت و عوارض"))
        self.assertNotIn("drv", [c["username"] for c in r.json()["candidates"]])
        # سربرگ خودکار به او داده شد و در تاریخچهٔ کاربر نوشته شد؛ «تنخواهِ من» را می‌بیند
        self.drv.refresh_from_db()
        self.assertEqual(self.drv.access, ["driver", "accounting"])
        log = UserAuditLog.objects.get(target=self.drv)
        self.assertEqual((log.action, log.changes, log.actor_name), ("access", {"added": ["accounting"], "removed": []}, "مالی"))
        me = self.api(self.drv).get("/api/auth/me/").json()
        self.assertEqual((me["pettyHolder"], self.api(self.acc).get("/api/auth/me/").json()["pettyHolder"]), (True, False))
        mine = self.api(self.drv).get("/api/petty-cash/").json()
        self.assertEqual((mine["isHolder"], mine["candidates"], mine["holders"][0]["account"]), (True, [], "6104337712345678"))
        self.assertEqual(self.expense(self.drv).status_code, 201)
        # ویرایشِ مشخصات: شبا هم می‌شود، خالی هم می‌شود؛ عددِ بی‌معنی نه
        self.assertEqual(self.holder(holder="drv", account="IR06 0120 0000 0000 1234 5678 90").json()["holders"][0]["account"],
                         "IR060120000000001234567890")
        self.assertEqual(self.holder(holder="drv", account="12ab").status_code, 400)
        self.assertEqual(self.holder(holder="drv", account="123").status_code, 400)
        self.assertEqual(self.holder(holder="drv", limit=-5).status_code, 400)
        r = self.holder(holder="drv", account="", limit="")
        self.assertEqual((r.json()["holders"][0]["account"], r.json()["holders"][0]["limit"]), ("", None))
        self.assertEqual(UserAuditLog.objects.filter(target=self.drv).count(), 1)          # دسترسی دوباره عوض نشد

    def test_only_finance_manages_holders(self):
        self.assertEqual(self.holder(self.acc, holder="drv").status_code, 403)             # سربرگ دارد ولی کلیدِ تنخواه نه
        self.assertEqual(self.holder(self.drv, holder="drv").status_code, 403)             # سربرگ هم ندارد
        self.assertEqual(self.holder(holder="نیست").status_code, 400)
        self.assertEqual(self.holder(holder="gone").status_code, 400)                      # کاربرِ غیرفعال
        self.assertEqual(PettyCashHolder.objects.count(), 0)

    def test_removing_a_holder_needs_a_settled_account(self):
        self.holder(holder="drv")
        self.holder(holder="acc")
        self.drv.refresh_from_db()
        self.assertEqual(self.expense(self.fin, kind="charge", holder="drv", amount=5_000_000).status_code, 201)
        pk = self.expense(self.drv).json()["id"]
        self.assertEqual(self.holder(holder="drv", active=False).status_code, 400)         # خرجِ منتظر دارد
        self.api(self.fin).post(f"/api/petty-cash/{pk}/review/", {"action": "approve"}, format="json")
        self.assertEqual(self.holder(holder="drv", active=False).status_code, 400)         # ۴ میلیون مانده دارد
        self.assertEqual(self.expense(self.fin, kind="refund", holder="drv", amount=4_000_000).status_code, 201)
        r = self.holder(holder="drv", active=False)
        self.assertEqual(r.status_code, 200, r.content)
        h = next(x for x in r.json()["holders"] if x["holder"] == "drv")
        self.assertEqual((h["defined"], h["balance"]), (False, 0.0))                       # سابقه‌اش در فهرست می‌ماند
        self.assertIn("drv", [c["username"] for c in r.json()["candidates"]])
        self.drv.refresh_from_db()
        self.assertEqual(self.drv.access, ["driver"])                                      # سربرگ پس گرفته شد
        self.assertEqual(self.expense(self.drv).status_code, 403)
        self.assertEqual(self.expense(self.fin, kind="charge", holder="drv", amount=1).status_code, 400)
        self.assertEqual(self.holder(holder="drv", active=False).status_code, 400)         # دیگر تنخواه‌دار نیست
        # کسی که بخشِ دیگری از سربرگ را دارد، سربرگش می‌ماند
        self.assertEqual(self.holder(holder="acc", active=False).status_code, 200)
        self.acc.refresh_from_db()
        self.assertEqual(self.acc.access, ["accounting", "accounting.salary"])
        # دوباره تعریف کردن همان ردیف را زنده می‌کند
        self.assertEqual(self.holder(holder="drv", bank="ملی").status_code, 200)
        self.assertEqual((PettyCashHolder.objects.filter(user=self.drv).count(), PettyCashHolder.objects.get(user=self.drv).active), (1, True))

    def test_those_who_only_had_the_tab_become_holders(self):
        """مهاجرتِ ۰۰۹۵: تیکِ خالیِ «دستیار حسابداری» تا پیش از این یعنی تنخواه‌دار."""
        m = importlib.import_module("core.migrations.0095_petty_cash_holder")
        bare = User.objects.create_user(username="bare", password="x", role="driver", access=["driver", "accounting"])
        PettyCash.objects.create(holder=self.drv, holder_name="راننده", kind="charge", date=TODAY, amount=10, status="approved")
        m.define_existing(django_apps, None)
        self.assertEqual(set(PettyCashHolder.objects.values_list("user__username", flat=True)), {"bare", "drv"})
        m.define_existing(django_apps, None)
        self.assertEqual(PettyCashHolder.objects.count(), 2)


class AccessMoveTests(TestCase):
    """مهاجرتِ ۰۰۹۳: فاکتور، تسهیم حقوق و خروجیِ راننده به سربرگِ «دستیار حسابداری» می‌روند و برمی‌گردند."""

    def test_old_keys_move_to_the_new_tab_and_back(self):
        m = importlib.import_module("core.migrations.0093_accounting_access")
        before = {
            "boss": ("manager", ["dashboard", "dashboard.w.driver", "financereports", "financereports.invoice", "financereports.salary"]),
            "acc": ("data_entry", ["financereports", "financereports.salary", "dashboard", "dashboard.w.driver"]),
            "drv": ("driver", ["driver"]),
            "dash": ("data_entry", ["dashboard", "dashboard.w.queue"]),
        }
        for name, (role, keys) in before.items():
            u = User.objects.create_user(username=name, password="x", role=role, access=[])
            User.objects.filter(pk=u.pk).update(access=keys)
        m.forward(django_apps, None)
        now = {u.username: u.access for u in User.objects.all()}
        self.assertEqual(set(now["boss"]), {"dashboard", "financereports", "accounting", "accounting.cash", "accounting.invoice",
                                            "accounting.salary", "accounting.driver"})
        self.assertEqual(set(now["acc"]), {"financereports", "dashboard", "accounting", "accounting.salary", "accounting.driver"})
        self.assertEqual((now["drv"], now["dash"]), (["driver"], ["dashboard", "dashboard.w.queue"]))
        for keys in now.values():
            self.assertEqual(set(access.clean_access(keys)), set(keys))               # همه کلیدِ شناخته‌شده‌اند
        m.forward(django_apps, None)                                                   # دوباره اجرا شدن چیزی را عوض نمی‌کند
        self.assertEqual({u.username: u.access for u in User.objects.all()}, now)
        m.backward(django_apps, None)
        self.assertEqual({u.username: set(u.access) for u in User.objects.all()}, {k: set(v) for k, (_, v) in before.items()})

    def test_the_moved_pages_ask_for_the_new_keys(self):
        self.assertNotIn("dashboard.w.driver", access.KEYS)
        self.assertNotIn("financereports.invoice", access.KEYS)
        for key in ("accounting", "accounting.cash", "accounting.invoice", "accounting.salary", "accounting.driver"):
            self.assertIn(key, access.KEYS)
        self.assertNotIn("accounting", access.defaults_for("driver"))                  # به راننده خودکار داده نمی‌شود
        self.assertIn("accounting.cash", access.ROLE_ACTIONS["manager"])

    def test_payroll_lives_inside_the_accounting_tab(self):
        """مهاجرتِ ۰۰۹۴: سربرگِ «حقوق و دستمزد» یک بخش از «دستیار حسابداری» شد."""
        m = importlib.import_module("core.migrations.0094_payroll_in_accounting")
        before = {
            "boss": ["reports", "payroll", "accounting", "accounting.cash"],
            "pay": ["dashboard", "payroll"],
            "drv": ["driver", "accounting"],
        }
        for name, keys in before.items():
            u = User.objects.create_user(username=name, password="x", role="manager", access=[])
            User.objects.filter(pk=u.pk).update(access=keys)
        m.forward(django_apps, None)
        now = {u.username: u.access for u in User.objects.all()}
        self.assertEqual(set(now["boss"]), {"reports", "accounting", "accounting.cash", "accounting.payroll"})
        self.assertEqual(set(now["pay"]), {"dashboard", "accounting", "accounting.payroll"})
        self.assertEqual(now["drv"], ["driver", "accounting"])
        for keys in now.values():
            self.assertEqual(set(access.clean_access(keys)), set(keys))
        m.forward(django_apps, None)
        self.assertEqual({u.username: u.access for u in User.objects.all()}, now)
        m.backward(django_apps, None)
        back = {u.username: set(u.access) for u in User.objects.all()}
        self.assertEqual(back["boss"], set(before["boss"]))
        self.assertEqual(back["pay"], {"dashboard", "payroll", "accounting"})         # خودِ سربرگ می‌ماند
        self.assertEqual(back["drv"], set(before["drv"]))
        # کلیدِ قبلی دیگر نیست، و نقشِ مدیر و حسابدار مثل قبل حقوق و دستمزد را پیش‌فرض دارند
        self.assertNotIn("payroll", access.KEYS)
        self.assertIn("accounting.payroll", access.defaults_for("manager"))
        self.assertIn("accounting.payroll", access.defaults_for("accountant"))
        self.assertNotIn("accounting.cash", access.defaults_for("accountant"))

    def test_the_payroll_pages_ask_for_the_new_key(self):
        api = APIClient()
        u = User.objects.create_user(username="pay", password="x", role="accountant", access=["accounting", "accounting.payroll"])
        api.force_authenticate(u)
        for url in ("/api/payroll-settings/", "/api/payroll-staff/", "/api/payroll-months/"):
            self.assertEqual(api.get(url).status_code, 200, url)
        u.access = ["accounting", "accounting.cash", "accounting.salary"]                # دستیار حسابداری بی این کلید کافی نیست
        u.save()
        for url in ("/api/payroll-settings/", "/api/payroll-staff/", "/api/payroll-months/"):
            self.assertEqual(api.get(url).status_code, 403, url)
