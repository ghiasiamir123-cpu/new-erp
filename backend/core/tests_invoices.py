"""فاکتور فروش پروژه‌ها: حالت‌های فاکتورهای قبلی — ضریب، تخفیف، بسته‌بندی، مالیات، رسمی، چند سند برای یک پروژه."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from . import invoices
from .models import InvoiceSeller, Project, ProjectReceipt, SalesInvoice, User

D = datetime.date


class InvoiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fin", password="x", name="مالی", role="manager",
                                             access=["financereports", "financereports.invoice"])
        self.p = Project.objects.create(name="مطهری", code="DW05-R001", owner_name="آقای عباسیان", price=900_000_000)
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def _body(self, **kw):
        return {"project": str(self.p.pk), "kind": "invoice", "date": "2026-09-23", "seller": {"name": "مرکز پوشش"},
                "buyer": {"name": "آقای عباسیان"},
                "lines": [{"description": "رنگ درب", "quantity": 10, "unit": "مترمربع", "unitPrice": 48_000_000}], **kw}

    def test_a_line_is_quantity_times_coefficient_times_price(self):
        # برآوردِ «ابعاد × ضریب سختی × مبلغ»: ۶۹ متر با ضریب ۱٫۳ و ۱۵ متر با ضریب ۱٫۲، به‌اضافهٔ کاورکاری
        lines = invoices.clean_lines([
            {"description": "پلهٔ چوبی", "quantity": 69, "coefficient": 1.3, "unitPrice": 72_000_000},
            {"description": "پلهٔ فلزی", "quantity": 15, "coefficient": 1.2, "unitPrice": 30_000_000, "spec": "زیرسازی کامل"}])
        adj = invoices.clean_adjustments([{"label": "کاورکاری", "sign": 1, "mode": "amount", "value": 150_000_000}])
        c = invoices.compute(lines, adj, 0)
        self.assertEqual([r["net"] for r in c["lines"]], [6_458_400_000, 540_000_000])
        self.assertEqual((c["subtotal"], c["base"], c["vat"], c["total"]), (6_998_400_000, 7_148_400_000, 0, 7_148_400_000))

    def test_three_ways_to_price_a_row_and_two_coefficients(self):
        lines = invoices.clean_lines([
            # دانه‌ای: ۵ درب، هر کدام ۴۵۷ میلیون
            {"mode": "piece", "description": "درب سی‌ان‌سی", "quantity": 5, "unit": "عدد", "unitPrice": 457_000_000},
            # تعداد × متراژ: ۶۲ لنگه، هر لنگه ۴ متر، متری ۱۲ میلیون
            {"mode": "both", "description": "لنگه درب", "count": 62, "quantity": 4, "unit": "مترمربع", "unitPrice": 12_000_000},
            # متری با ضریب سختی ۱٫۲ و ضریب حجم/شیار ۲
            {"mode": "area", "description": "ترکه‌ها", "quantity": 52, "coefficient": 1.2, "coefficient2": 2, "unitPrice": 30_000_000},
            # دانه‌ای با ضریب سختی: ۳ روشوییِ قوس‌دار
            {"mode": "piece", "description": "روشویی قوس‌دار", "quantity": 3, "coefficient": 1.5, "unitPrice": 100_000_000}])
        c = invoices.compute(lines, [], 0)
        self.assertEqual([r["net"] for r in c["lines"]], [2_285_000_000, 2_976_000_000, 3_744_000_000, 450_000_000])
        self.assertEqual([r["factor"] for r in c["lines"]], [5.0, 248.0, 124.8, 4.5])
        self.assertEqual([(r["mode"], r["count"]) for r in c["lines"]], [("piece", 1), ("both", 62), ("area", 1), ("piece", 1)])
        with self.assertRaises(Exception):                                      # «تعداد × متراژ» بی تعداد نمی‌شود
            invoices.clean_lines([{"mode": "both", "description": "x", "quantity": 4, "unitPrice": 1}])
        # سندی که پیش از این ذخیره شده و این خانه‌ها را ندارد، همان حسابِ قبلی را می‌دهد
        old = [{"description": "x", "spec": "", "unit": "", "quantity": 2, "coefficient": 1.5, "unitPrice": 10, "percent": 100, "discount": 0}]
        self.assertEqual(invoices.compute(old, [], 0)["total"], 30)

    def test_discount_then_packaging_like_the_vanity_proforma(self):
        # «جمع کل، تخفیف ۵٪، بسته‌بندی، مبلغ قابل پرداخت»: درصد از جمعِ تا همان‌جاست و ترتیب مهم است
        lines = invoices.clean_lines([{"description": "روشویی", "quantity": 1, "unit": "عدد", "unitPrice": 2_433_516_000}])
        adj = invoices.clean_adjustments([{"label": "تخفیف", "sign": -1, "mode": "percent", "value": 5},
                                          {"label": "بسته‌بندی", "sign": 1, "mode": "amount", "value": 150_000_000}])
        c = invoices.compute(lines, adj, 0)
        self.assertEqual([a["signed"] for a in c["adjustments"]], [-121_675_800, 150_000_000])
        self.assertEqual(c["total"], 2_433_516_000 - 121_675_800 + 150_000_000)

    def test_official_invoice_tax_adds_up_row_by_row(self):
        # فاکتور رسمی: مالیاتِ ۱۰٪ هر ردیف جدا گرد می‌شود و جمعِ ستون با مالیاتِ کل یکی است
        lines = invoices.clean_lines([
            {"description": "آستر و رویه", "quantity": 84.09, "unitPrice": 30_000_000},
            {"description": "فیبر", "quantity": 26.53, "unitPrice": 19_500_001, "discount": 7},
            {"description": "نیمه‌کاره", "quantity": 3, "unitPrice": 1_000_001, "percent": 50}])
        c = invoices.compute(lines, [], 10)
        self.assertEqual(c["lines"][0]["net"], 2_522_700_000)
        self.assertEqual(c["lines"][2]["gross"], 1_500_002)                       # ۳ × ۱٬۰۰۰٬۰۰۱ × ۵۰٪ = ۱٬۵۰۰٬۰۰۱٫۵
        self.assertEqual(c["vat"], sum(r["vat"] for r in c["lines"]))
        self.assertEqual(c["total"], sum(r["total"] for r in c["lines"]))
        self.assertEqual(c["lineDiscount"], 7)

    def test_bad_rows_are_refused_with_a_reason(self):
        for bad in ([], [{"description": "", "quantity": 1, "unitPrice": 1}], [{"description": "x", "quantity": 0, "unitPrice": 1}],
                    [{"description": "x", "quantity": 1, "unitPrice": 10, "discount": 11}],
                    [{"description": "x", "quantity": 1, "unitPrice": 10, "percent": 120}]):
            with self.assertRaises(Exception):
                invoices.clean_lines(bad)
        with self.assertRaises(Exception):                                       # کسر بیشتر از جمع
            invoices.compute(invoices.clean_lines([{"description": "x", "quantity": 1, "unitPrice": 10}]),
                             invoices.clean_adjustments([{"label": "تخفیف", "sign": -1, "mode": "amount", "value": 11}]), 0)

    def test_a_project_carries_several_documents_and_only_drafts_change(self):
        r = self.api.post("/api/finance-reports/invoices/", self._body(scope="material", title="قسمت اول"), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        one = r.json()
        self.assertEqual((one["status"], one["total"], one["calc"]["lines"][0]["net"], one["scopeLabel"]), ("draft", 480_000_000, 480_000_000, "متریال"))
        # بی شماره صادر نمی‌شود
        self.assertEqual(self.api.post(f"/api/finance-reports/invoices/{one['id']}/status/", {"status": "issued"}, format="json").status_code, 400)
        r = self.api.put(f"/api/finance-reports/invoices/{one['id']}/", self._body(number="7111-405", vatPercent=10, showReceipts=True), format="json")
        self.assertEqual((r.status_code, r.json()["total"], r.json()["vat"]), (200, 528_000_000, 48_000_000))
        self.assertEqual(self.api.post(f"/api/finance-reports/invoices/{one['id']}/status/", {"status": "issued"}, format="json").status_code, 200)
        # صادرشده ویرایش و حذف نمی‌شود
        self.assertEqual(self.api.put(f"/api/finance-reports/invoices/{one['id']}/", self._body(), format="json").status_code, 400)
        self.assertEqual(self.api.delete(f"/api/finance-reports/invoices/{one['id']}/").status_code, 400)
        # رونوشت برای قسمتِ دوم: پیش‌نویس و بی‌شماره
        two = self.api.post(f"/api/finance-reports/invoices/{one['id']}/copy/").json()
        self.assertEqual((two["status"], two["number"], two["total"]), ("draft", "", 528_000_000))
        # تبدیل به فاکتور: سندِ تازه از نوعِ دیگر با شمارهٔ همان نوع؛ سندِ اول دست نمی‌خورد
        as_inv = self.api.post(f"/api/finance-reports/invoices/{one['id']}/copy/", {"kind": "proforma"}, format="json").json()
        self.assertEqual((as_inv["kind"], as_inv["status"], as_inv["number"], as_inv["total"]), ("proforma", "draft", "DW05-R001-P01", 528_000_000))
        self.assertEqual(self.api.get(f"/api/finance-reports/invoices/{one['id']}/").json()["kind"], "invoice")
        self.api.delete(f"/api/finance-reports/invoices/{as_inv['id']}/")
        # همان شماره را سندِ دیگری از همان نوع نمی‌تواند بگیرد
        self.api.put(f"/api/finance-reports/invoices/{two['id']}/", self._body(number="7111-405"), format="json")
        self.assertEqual(self.api.post(f"/api/finance-reports/invoices/{two['id']}/status/", {"status": "issued"}, format="json").status_code, 400)
        # دریافتیِ پروژه و مانده
        ProjectReceipt.objects.create(project=self.p, date=D(2026, 9, 24), amount=200_000_000)
        full = self.api.get(f"/api/finance-reports/invoices/{one['id']}/").json()
        self.assertEqual((full["received"], full["payable"], full["showReceipts"]), (200_000_000, 328_000_000, True))
        lst = self.api.get("/api/finance-reports/invoices/").json()
        me = next(x for x in lst["projects"] if x["id"] == str(self.p.pk))
        self.assertEqual((len(lst["invoices"]), me["invoiced"], me["contract"]), (2, 528_000_000, 900_000_000.0))
        # پیش‌نویس حذف می‌شود؛ باطل‌شده در جمعِ پروژه نمی‌آید
        self.assertEqual(self.api.delete(f"/api/finance-reports/invoices/{two['id']}/").status_code, 204)
        self.api.post(f"/api/finance-reports/invoices/{one['id']}/status/", {"status": "cancelled"}, format="json")
        self.assertEqual(invoices.project_summary(), {})

    def test_defaults_sellers_and_the_access_key(self):
        self.assertTrue(InvoiceSeller.objects.filter(name="شرکت دیواژ نقش ماندگار", national_id="14014585480").exists())
        d = self.api.get(f"/api/finance-reports/invoice-defaults/?project={self.p.pk}").json()
        self.assertEqual((d["buyer"]["name"], d["buyer"]["projectName"], d["contract"]), ("آقای عباسیان", "مطهری", 900_000_000.0))
        self.assertGreaterEqual(len(d["sellers"]), 4)
        SalesInvoice.objects.create(project=self.p, kind="official", number="7110-405", date=D(2026, 9, 23), status="issued")
        self.assertEqual(invoices.suggest_number("official", D(2026, 9, 23)), "7111-405")
        # پیش‌فاکتور و فاکتور از کد پروژه شماره می‌گیرند؛ پروژهٔ بی‌کد نه
        self.assertEqual(invoices.suggest_number("proforma", D(2026, 9, 23), self.p), "DW05-R001-P01")
        SalesInvoice.objects.create(project=self.p, kind="proforma", number="DW05-R001-P01", date=D(2026, 9, 23))
        SalesInvoice.objects.create(project=self.p, kind="proforma", number="DW05-R001-P07", date=D(2026, 9, 23))
        self.assertEqual(invoices.suggest_number("proforma", D(2026, 9, 23), self.p), "DW05-R001-P08")
        self.assertEqual(invoices.suggest_number("invoice", D(2026, 9, 23), self.p), "DW05-R001-F01")
        self.assertEqual(invoices.suggest_number("invoice", D(2026, 9, 23), Project.objects.create(name="بی‌کد")), "")
        self.assertEqual(d["numbers"], {"proforma": "DW05-R001-P01", "invoice": "DW05-R001-F01", "official": ""})
        r = self.api.post("/api/finance-reports/invoice-sellers/", {"name": "فروشندهٔ تازه", "phone": "0311"}, format="json")
        self.assertIn("فروشندهٔ تازه", [s["name"] for s in r.json()["sellers"]])
        self.user.access = ["financereports", "financereports.costs"]
        self.user.save()
        for path in ("invoices/", f"invoice-defaults/?project={self.p.pk}", "invoice-sellers/"):
            self.assertEqual(self.api.get(f"/api/finance-reports/{path}").status_code, 403, path)
