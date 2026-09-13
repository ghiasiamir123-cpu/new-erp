"""وصل کردن کالاهای سایت فروش به کالای انبار (هر کالا یک ردیف با دو نام).

    python manage.py link_site_items --auto --dry-run        # فقط گزارش اتصال‌های مطمئن
    python manage.py link_site_items --auto                  # انجام اتصال‌های مطمئن
    python manage.py link_site_items --export links.xlsx     # اکسل بقیه، با پیشنهاد
    python manage.py link_site_items --apply links.xlsx --dry-run
    python manage.py link_site_items --apply links.xlsx

«مطمئن» یعنی کد و اندازه فقط یک کالای انبار را نشان می‌دهند و آن کالا را بستهٔ سایتِ
دیگری نخواسته است (core/linking.py). بقیه در اکسل با پیشنهاد می‌آیند تا کسی کد درست را بزند.
"""
import re
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum

from core.linking import LinkError, Matcher, link_site_sku, plan_auto_links
from core.models import Sku, StockMovement

SHEET = "وصل کردن"
WH_SHEET = "کالاهای انبار"
COL_CODE = "کد کالای انبار"
COL_ONLY = "فقط در سایت است"
COL_PACK = "شناسهٔ سایت"
YES = {"بله", "yes", "y", "1", "true", "✓"}


def site_skus():
    return (Sku.objects.exclude(shop_pack_id="").filter(warehouse_name="", is_asset=False)
            .select_related("product").order_by("product__brand", "site_name", "pack_size", "id"))


def wh_code(sku):
    return sku.barcode or sku.site_package_id


class Command(BaseCommand):
    help = "وصل کردن کالاهای سایت به کالای انبار: خودکار، اکسل پیشنهاد، یا اعمال اکسل پرشده"

    def add_arguments(self, parser):
        parser.add_argument("--auto", action="store_true", help="اتصال‌های مطمئن")
        parser.add_argument("--export", metavar="XLSX", help="ساخت اکسل کالاهای وصل‌نشده با پیشنهاد")
        parser.add_argument("--apply", metavar="XLSX", help="اعمال اکسلی که ستون «کد کالای انبار» آن پر شده")
        parser.add_argument("--dry-run", action="store_true", help="انجام و برگرداندن؛ چیزی ذخیره نمی‌شود")

    def handle(self, *args, **opts):
        chosen = [k for k in ("auto", "export", "apply") if opts.get(k)]
        if len(chosen) != 1:
            raise CommandError("دقیقاً یکی از --auto ، --export یا --apply را بدهید.")
        getattr(self, "_" + chosen[0])(opts)

    # ---------------- خودکار ----------------
    def _auto(self, opts):
        skus = list(site_skus())
        sure, rest = plan_auto_links(skus)
        self.stdout.write(f"کالای سایتِ وصل‌نشده: {len(skus)} | مطمئن: {len(sure)} | برای اکسل: {len(rest)}")
        done, failed, moved = 0, [], Counter()
        with transaction.atomic():
            for site, wh in sure:
                label = f"{site.shop_pack_id:>6} {site.site_name[:34]:<34} {site.pack_size:<8} → {wh_code(wh):<22} {wh.warehouse_name[:50]}"
                try:
                    with transaction.atomic():
                        counts = link_site_sku(site, wh)
                except LinkError as exc:
                    failed.append((label, str(exc)))
                    continue
                done += 1
                moved.update(counts)
                self.stdout.write("  ✓ " + label + ("" if not any(counts.values()) else f"  {dict(counts)}"))
            if opts["dry_run"]:
                transaction.set_rollback(True)
        for label, why in failed:
            self.stdout.write(self.style.WARNING(f"  ✗ {label}\n      {why}"))
        self.stdout.write(f"\nوصل شد: {done} | انجام نشد: {len(failed)} | منتقل‌شده: {dict(moved)}")
        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))

    # ---------------- اکسل پیشنهاد ----------------
    def _export(self, opts):
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.worksheet.datavalidation import DataValidation

        skus = list(site_skus())
        matcher = Matcher()
        # اتصال‌های مطمئن هم خودکار انجام نمی‌شوند: کد و اندازه یکی است ولی رنگ و براقیتِ کالای سایت
        # گاهی در نامش نیست. پس از پیش پر می‌شوند تا کسی نگاهشان کند.
        sure = {site.pk: wh for site, wh in plan_auto_links(skus, matcher)[0]}
        on_hand =dict(StockMovement.objects.values("sku_id").annotate(q=Sum("qty")).values_list("sku_id", "q"))
        activity = Counter(StockMovement.objects.filter(sku__in=skus).values_list("sku_id", flat=True))

        font, bold = Font(name="Arial"), Font(name="Arial", bold=True, color="FFFFFF")
        head_fill = PatternFill("solid", start_color="1F4E5A")
        input_fill = PatternFill("solid", start_color="FFF2CC")
        wb = Workbook()

        guide = wb.active
        guide.title = "راهنما"
        guide.sheet_view.rightToLeft = True
        guide.column_dimensions["A"].width = 110
        lines = [
            ("وصل کردن کالاهای سایت به کالای انبار", Font(name="Arial", bold=True, size=15)),
            (f"در برگهٔ «{SHEET}» هر ردیف یک کالای سایت است که هنوز به کالای انبار وصل نشده ({len(skus)} ردیف).", font),
            ("کنار هر ردیف تا سه کالای انبار پیشنهاد شده است؛ پیشنهاد فقط کمک است و ممکن است غلط باشد.", font),
            ("فقط دو ستون زرد را پر کنید:", Font(name="Arial", bold=True)),
            (f"  • «{COL_CODE}»: کد کالای انبارِ همین جنس (همان کد مالی). از کد پیشنهاد کپی کنید یا از برگهٔ «{WH_SHEET}» پیدا کنید.", font),
            (f"    ردیف‌هایی که ستون «توضیح»شان «پیشنهاد مطمئن» است از پیش پر شده‌اند (کد و اندازه یکی است). "
             f"اگر درست است دست نزنید؛ اگر رنگ یا براقیتش غلط است، کد را پاک یا عوض کنید.", font),
            (f"  • «{COL_ONLY}»: اگر این کالا در انبار همتا ندارد «بله» بزنید؛ با نام سایت می‌ماند.", font),
            ("  نمونه:  کد کالای انبار = BO-4902        یا        فقط در سایت است = بله", font),
            ("ردیفی که هیچ‌کدام را ندارد دست نمی‌خورد. هر کالای انبار فقط به یک کالای سایت وصل می‌شود.", font),
            ("وقتی وصل شود: نام و شناسهٔ سایت روی کالای انبار می‌نشیند، موجودی و حواله و گزارش کالای سایت به آن منتقل می‌شود و ردیف تکراری حذف می‌شود.", font),
        ]
        for i, (text, f) in enumerate(lines, 1):
            c = guide.cell(row=i, column=1, value=text)
            c.font = f
            c.alignment = Alignment(wrap_text=True)
        guide.cell(row=8, column=1).fill = input_fill

        ws = wb.create_sheet(SHEET)
        ws.sheet_view.rightToLeft = True
        head = [COL_PACK, "نام سایت", "برند", "کد محصول سایت", "اندازه بسته", "شماره سنباده", "شید",
                "واحد اصلی", "موجودی", "گردش ثبت‌شده",
                "کد پیشنهاد ۱", "نام پیشنهاد ۱", "کد پیشنهاد ۲", "نام پیشنهاد ۲", "کد پیشنهاد ۳", "نام پیشنهاد ۳",
                COL_CODE, COL_ONLY, "توضیح"]
        widths = [12, 38, 14, 18, 12, 11, 12, 10, 9, 10, 20, 44, 20, 44, 20, 44, 22, 14, 30]
        for col, (h, w) in enumerate(zip(head, widths), 1):
            c = ws.cell(row=1, column=col, value=h)
            c.font = Font(name="Arial", bold=True, color="000000" if h in (COL_CODE, COL_ONLY) else "FFFFFF")
            c.fill = input_fill if h in (COL_CODE, COL_ONLY) else head_fill
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            ws.column_dimensions[c.column_letter].width = w
        reasons = Counter()
        for r, site in enumerate(skus, 2):
            suggestions, _ = matcher.suggest(site, limit=3)
            reasons["مطمئن" if site.pk in sure else "با پیشنهاد" if suggestions else "بی پیشنهاد"] += 1
            row = [site.shop_pack_id, site.site_name, site.product.brand, site.product.code, site.pack_size,
                   site.grit, site.shade, site.base_unit, float(on_hand.get(site.id) or 0), activity.get(site.id, 0)]
            for _, w, why in suggestions:
                row += [wh_code(w), f"{w.warehouse_name}  ({why})"]
            row += [""] * (16 - len(row))
            if site.pk in sure:
                row += [wh_code(sure[site.pk]), "", "پیشنهاد مطمئن — اگر درست است دست نزنید"]
            else:
                row += ["", "", ""]
            for col, value in enumerate(row, 1):
                c = ws.cell(row=r, column=col, value=value)
                c.font = font
                if head[col - 1] in (COL_CODE, COL_ONLY):
                    c.fill = input_fill
        last = len(skus) + 1
        ws.freeze_panes = "C2"
        ws.auto_filter.ref = f"A1:S{last}"

        wh = wb.create_sheet(WH_SHEET)
        wh.sheet_view.rightToLeft = True
        wh_head = ["کد", "نام انبار", "برند", "اندازه بسته", "واحد اصلی", "موجودی"]
        for col, (h, w) in enumerate(zip(wh_head, [24, 70, 16, 14, 10, 9]), 1):
            c = wh.cell(row=1, column=col, value=h)
            c.font, c.fill = bold, head_fill
            wh.column_dimensions[c.column_letter].width = w
        free = sorted(matcher.pool, key=lambda s: (s.product.brand, s.warehouse_name, s.pack_size))
        for r, s in enumerate(free, 2):
            for col, value in enumerate([wh_code(s), s.warehouse_name, s.product.brand, s.pack_size,
                                         s.base_unit, float(on_hand.get(s.id) or 0)], 1):
                wh.cell(row=r, column=col, value=value).font = font
        wh.freeze_panes = "A2"
        wh.auto_filter.ref = f"A1:F{len(free) + 1}"

        code_list = DataValidation(type="list", formula1=f"='{WH_SHEET}'!$A$2:$A${len(free) + 1}", allow_blank=True)
        code_list.error = f"این کد در برگهٔ «{WH_SHEET}» نیست."
        code_list.errorTitle = "کد نامعتبر"
        only_list = DataValidation(type="list", formula1='"بله"', allow_blank=True)
        ws.add_data_validation(code_list)
        ws.add_data_validation(only_list)
        code_list.add(f"Q2:Q{last}")
        only_list.add(f"R2:R{last}")

        wb.active = 1
        wb.save(opts["export"])
        self.stdout.write(f"ساخته شد: {opts['export']} | کالای سایت: {len(skus)} {dict(reasons)} | کالای انبار آزاد: {len(free)}")

    # ---------------- اعمال اکسل ----------------
    def _apply(self, opts):
        from openpyxl import load_workbook

        wb = load_workbook(opts["apply"], data_only=True)
        if SHEET not in wb.sheetnames:
            raise CommandError(f"برگهٔ «{SHEET}» در فایل نیست.")
        ws = wb[SHEET]
        header = [str(c.value or "").strip() for c in ws[1]]
        try:
            i_pack, i_code, i_only = header.index(COL_PACK), header.index(COL_CODE), header.index(COL_ONLY)
        except ValueError:
            raise CommandError(f"ستون‌های «{COL_PACK}»، «{COL_CODE}» و «{COL_ONLY}» لازم است.")

        requests, only_site, problems = [], 0, []
        for n, row in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
            pack = re.sub(r"\.0$", "", str(row[i_pack] or "").strip())
            code = str(row[i_code] or "").strip()
            only = str(row[i_only] or "").strip().lower() in YES
            if not pack or not (code or only):
                continue
            if code and only:
                problems.append((n, pack, "هم کد انبار دارد و هم «فقط در سایت»؛ یکی را بگذارید."))
            elif only:
                only_site += 1
            else:
                requests.append((n, pack, code))

        wanted = Counter(code.lower() for _, _, code in requests)
        done, moved = 0, Counter()
        with transaction.atomic():
            for n, pack, code in requests:
                if wanted[code.lower()] > 1:
                    problems.append((n, pack, f"کد «{code}» برای چند کالای سایت زده شده؛ هر کالای انبار فقط یک کالای سایت می‌گیرد."))
                    continue
                site = Sku.objects.filter(shop_pack_id=pack).select_related("product").first()
                if site is None:
                    problems.append((n, pack, "این شناسهٔ سایت در سامانه نیست."))
                    continue
                if site.warehouse_name:
                    problems.append((n, pack, f"از قبل کالای انبار است: «{site.warehouse_name}»."))
                    continue
                matches = list(Sku.objects.filter(is_asset=False).exclude(pk=site.pk).extra(
                    where=["UPPER(barcode) = UPPER(%s) OR UPPER(site_package_id) = UPPER(%s) "
                           "OR UPPER(warehouse_code) = UPPER(%s)"], params=[code, code, code]))
                if not matches:
                    problems.append((n, pack, f"کالای انباری با کد «{code}» پیدا نشد."))
                    continue
                if len(matches) > 1:
                    problems.append((n, pack, f"کد «{code}» به {len(matches)} کالا می‌خورد."))
                    continue
                try:
                    with transaction.atomic():
                        counts = link_site_sku(site, matches[0])
                except LinkError as exc:
                    problems.append((n, pack, str(exc)))
                    continue
                done += 1
                moved.update(counts)
            if opts["dry_run"]:
                transaction.set_rollback(True)

        self.stdout.write(f"وصل شد: {done} | فقط در سایت: {only_site} | ایراد: {len(problems)} | منتقل‌شده: {dict(moved)}")
        for n, pack, why in sorted(problems):
            self.stdout.write(self.style.WARNING(f"  ردیف {n} (شناسهٔ سایت {pack}): {why}"))
        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("« اجرای آزمایشی — چیزی ذخیره نشد »"))
