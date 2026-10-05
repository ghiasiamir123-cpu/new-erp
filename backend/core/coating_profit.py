"""سود مرکز پوشش: قیمت تمام‌شدهٔ هر پروژه و سودش در برابر دریافتی از کارفرما.

  · دستمزد: ساعتِ گزارش‌های کار تأییدشده × نرخ هر ساعتِ همان کارگر (Employee.hourly_cost). کارگرِ
    بی‌نرخ با میانگین هزینهٔ ساعتی کارگاه (ProductionSettings) حساب می‌شود و «تخمینی» علامت می‌خورد؛
    اگر میانگین هم وارد نشده، ساعتش بی‌هزینه می‌ماند و «ایراد» است.
  · متریال: مصرف مواد تأییدشده × قیمت تمام‌شدهٔ هر واحد اصلی کالا (قیمت لیست، همان که مرکز پوشش کالا را
    با آن از دیواژ می‌گیرد — core/discount_profit.py). ردیفی که کالای انبار ندارد، کالایش قیمت ندارد یا
    واحدش به واحد اصلی تبدیل نمی‌شود، در هزینه نمی‌آید و «ایراد» است تا اصلاح شود.
  · دریافتی: ProjectReceipt. سود = دریافتی − قیمت تمام‌شده.
  · فروش: مبلغِ فروشِ پروژه از فاکتورهای فروش می‌آید (core/invoices.py) — جمعِ فاکتورهای صادرشده به‌اضافهٔ
    پیش‌فاکتورهایی که هنوز فاکتور نشده‌اند (برآورد). مالیات بر ارزش افزوده درآمد نیست و در سود نمی‌آید، ولی در
    «مانده طلب» هست چون کارفرما آن را هم می‌پردازد. پروژه‌ای که هیچ سندی ندارد، مبلغ قراردادِ دستی‌اش مبناست.
    سود فروش = فروش − قیمت تمام‌شده.

چیزی ذخیره نمی‌شود جز دریافتی‌ها؛ با اصلاح نرخ یا قیمت، همهٔ پروژه‌ها دوباره حساب می‌شوند.
گزارش کار یا مصرفی که هنوز تأیید نشده در هزینه نمی‌آید و جدا شمرده می‌شود.
"""
from collections import defaultdict

from django.db.models import Count, Sum

from .models import (DailyReport, Employee, MaterialUsage, MaterialUsageReport, ProductionSettings,
                     Project, ProjectReceipt, ReportItem, SalesInvoice)
from .production import _f, _to_base_qty, norm_name

PLACEHOLDER = 1.0          # قیمت ۱ ریال یعنی «قیمت‌گذاری نشده»
APPROVED = DailyReport.Status.APPROVED
USAGE_APPROVED = MaterialUsageReport.Status.APPROVED

# دلیل ایراد ردیف متریال
NO_SKU = "no_sku"
NO_PRICE = "no_price"
NO_UNIT = "no_unit"
REASON_LABEL = {
    NO_SKU: "به کالای انبار وصل نیست",
    NO_PRICE: "قیمت تمام‌شده ندارد",
    NO_UNIT: "واحدش به واحد اصلی کالا تبدیل نمی‌شود",
}


def _label(p):
    short = (p.short_name or p.name or "").strip()
    return f"{p.code} ({short})" if p.code else p.name


def _state(p):
    if p.closed_at:
        return "closed"
    return "active" if p.active else "inactive"


def _unit_cost(sku):
    """قیمت تمام‌شدهٔ هر واحد اصلی، یا None اگر ثبت نشده."""
    v = _f(sku.cost_price) or _f(sku.purchase_price)
    return v if v > PLACEHOLDER else None


def _base_qty(sku, qty, unit):
    """مثل _to_base_qty، ولی «۱ حلب = ۱۸ کیلو» که با شش رقم اعشار ۰٫۰۵۵۵۵۶ ذخیره شده، دقیق تقسیم می‌شود؛
    وگرنه ۳۶ کیلو ۲٫۰۰۰۰۱۶ حلب و هزینه چند ریال بیش از واقع می‌شد."""
    unit = (unit or "").strip()
    alt = _f(sku.alt_to_base)
    if unit and unit == (sku.alt_unit or "").strip() and unit != (sku.base_unit or "").strip() and alt:
        per = 1 / alt
        if abs(per - round(per)) < 0.001:
            return qty / round(per)
    return _to_base_qty(sku, qty, unit)


def _employees():
    """{نام یکسان‌شده: کارگر} — نرخ از اینجا خوانده و اصلاح می‌شود."""
    out = {}
    for e in Employee.objects.all().order_by("-active", "id"):
        out.setdefault(norm_name(e.name), e)
    return out


def _labour(project_ids, fallback):
    """{pid: [ردیف هر کارگر]} و {نام: ایراد نرخ}."""
    staff = _employees()
    per = defaultdict(lambda: defaultdict(lambda: {"hours": 0.0, "activities": defaultdict(float)}))
    for it in (ReportItem.objects.filter(report__status=APPROVED, project_id__in=project_ids)
               .values("project_id", "employee", "activity", "hours")):
        h = _f(it["hours"])
        if not h:
            continue
        row = per[it["project_id"]][norm_name(it["employee"])]
        row["name"] = it["employee"].strip()
        row["hours"] += h
        row["activities"][(it["activity"] or "").strip() or "—"] += h

    out, issues = {}, {}
    for pid, people in per.items():
        rows = []
        for key, r in people.items():
            e = staff.get(key)
            own = _f(e.hourly_cost) if e and e.hourly_cost else 0.0
            if own:
                rate, source = own, "own"
            elif fallback:
                rate, source = fallback, "average"
            else:
                rate, source = 0.0, "none"
            rows.append({"name": r["name"], "employeeId": str(e.pk) if e else None,
                         "hours": round(r["hours"], 2), "rate": round(rate), "rateSource": source,
                         "cost": round(r["hours"] * rate),
                         "activities": sorted(({"activity": a, "hours": round(h, 2)}
                                               for a, h in r["activities"].items()),
                                              key=lambda x: -x["hours"])})
            if source != "own":
                iss = issues.setdefault(key, {"name": r["name"], "employeeId": str(e.pk) if e else None,
                                              "hours": 0.0, "projects": set(), "severity": source})
                iss["hours"] += r["hours"]
                iss["projects"].add(pid)
        rows.sort(key=lambda x: -x["hours"])
        out[pid] = rows
    return out, issues


def _material(project_ids):
    """{pid: [ردیف هر کالا]} و {کلید: ایراد قیمت/واحد}."""
    per = defaultdict(dict)
    issues = {}
    lines = (MaterialUsage.objects.filter(report__status=USAGE_APPROVED, project_id__in=project_ids)
             .select_related("sku", "material"))
    for u in lines:
        q = _f(u.quantity) * u.sign          # برگشتی به انبار از هزینه کم می‌شود
        if not q:
            continue
        unit = (u.unit or "").strip()
        s = u.sku
        if s is None:
            reason, price, base = NO_SKU, None, None
            key = ("name", (u.material_name or (u.material.name if u.material else "")).strip(), unit)
        else:
            price = _unit_cost(s)
            base = _base_qty(s, q, unit)
            reason = NO_UNIT if base is None else NO_PRICE if price is None else ""
            key = ("sku", s.pk, unit)
        name = (s.display_name if s else key[1]) or "—"
        row = per[u.project_id].setdefault(key, {
            "name": name, "code": (s.warehouse_code or s.barcode or s.site_package_id) if s else u.material_code,
            "skuId": str(s.pk) if s else None, "unit": unit or (s.base_unit if s else ""),
            "baseUnit": s.base_unit if s else "", "qty": 0.0, "baseQty": 0.0,
            "unitCost": round(price) if price else None, "cost": 0.0, "reason": reason, "lines": 0})
        row["qty"] += q
        row["lines"] += 1
        if base is not None:
            row["baseQty"] += base
        if not reason:
            row["cost"] += price * base
            continue
        iss = issues.setdefault(key, {
            "name": name, "code": row["code"], "skuId": row["skuId"], "unit": row["unit"],
            "baseUnit": row["baseUnit"], "altUnit": s.alt_unit if s else "",
            "altToBase": _f(s.alt_to_base) if s and s.alt_to_base else None,
            "reason": reason, "reasonLabel": REASON_LABEL[reason],
            "qty": 0.0, "lines": 0, "projects": set()})
        iss["qty"] += q
        iss["lines"] += 1
        iss["projects"].add(u.project_id)

    out = {}
    for pid, rows in per.items():
        lst = []
        for r in rows.values():
            lst.append({**r, "qty": round(r["qty"], 3), "baseQty": round(r["baseQty"], 4),
                        "cost": round(r["cost"]), "reasonLabel": REASON_LABEL.get(r["reason"], "")})
        lst.sort(key=lambda x: (x["reason"] == "", -x["cost"]))
        out[pid] = lst
    return out, issues


def _pending(project_ids):
    """گزارش کار و مصرف مواد هر پروژه که هنوز تأیید نشده — در هزینه نیامده."""
    work = dict(ReportItem.objects.filter(project_id__in=project_ids).exclude(report__status=APPROVED)
                .values("project_id").annotate(n=Count("report", distinct=True)).values_list("project_id", "n"))
    usage = dict(MaterialUsage.objects.filter(project_id__in=project_ids).exclude(report__status=USAGE_APPROVED)
                 .values("project_id").annotate(n=Count("report", distinct=True)).values_list("project_id", "n"))
    return work, usage


SALE_LABEL = {"invoice": "فاکتور", "proforma": "پیش‌فاکتور", "mixed": "فاکتور + پیش‌فاکتور", "contract": "مبلغ قرارداد"}


def _sales(project_ids):
    """{pid: فروشِ هر پروژه از سندهایش}. فاکتور فقط صادرشده‌اش شمرده می‌شود. پیش‌فاکتور تا وقتی باطل نشده و فاکتورِ
    صادرشده‌ای از رویش ساخته نشده، برآوردِ همان کار است — پیش‌فاکتوری که فاکتور شده دو بار شمرده نمی‌شود."""
    docs = list(SalesInvoice.objects.filter(project_id__in=project_ids).exclude(status="cancelled")
                .values("id", "project_id", "kind", "status", "total", "vat", "source_id"))
    invoiced = {d["source_id"] for d in docs if d["source_id"] and d["kind"] != "proforma" and d["status"] == "issued"}
    out = defaultdict(lambda: {"invoiced": 0, "invoicedGross": 0, "quoted": 0, "quotedGross": 0, "invoices": 0, "proformas": 0})
    for d in docs:
        row, net = out[d["project_id"]], int(d["total"]) - int(d["vat"])
        if d["kind"] != "proforma":
            if d["status"] == "issued":
                row["invoiced"] += net
                row["invoicedGross"] += int(d["total"])
                row["invoices"] += 1
        elif d["id"] not in invoiced:
            row["quoted"] += net
            row["quotedGross"] += int(d["total"])
            row["proformas"] += 1
    return out


def report(project_id=None, detail=False):
    """detail: ردیف‌های دستمزد، متریال و دریافتیِ هر پروژه هم بیاید (برای یک پروژه همیشه می‌آید) — خروجیِ
    چاپیِ «همهٔ پروژه‌ها با جزئیات» همین را می‌خواهد."""
    detail = detail or project_id is not None
    st = ProductionSettings.get()
    fallback = _f(st.labour_cost_per_hour)
    qs = Project.objects.filter(general=False)
    if project_id is not None:
        qs = qs.filter(pk=project_id)
    projects = {p.pk: p for p in qs}
    ids = list(projects)

    labour, labour_issues = _labour(ids, fallback)
    material, material_issues = _material(ids)
    pend_work, pend_usage = _pending(ids)
    sales = _sales(ids)
    received = dict(ProjectReceipt.objects.filter(project_id__in=ids).values("project_id")
                    .annotate(s=Sum("amount")).values_list("project_id", "s"))
    receipts = defaultdict(list)
    if detail:
        for r in ProjectReceipt.objects.filter(project_id__in=ids):
            receipts[r.project_id].append({"id": str(r.pk), "date": r.date.isoformat(), "amount": float(r.amount),
                                           "note": r.note, "by": r.recorded_by_name})

    rows = []
    totals = defaultdict(float)
    for pid, p in projects.items():
        lab, mat = labour.get(pid, []), material.get(pid, [])
        got = _f(received.get(pid))
        sold = sales.get(pid)
        if not lab and not mat and not got and not p.price and not sold:
            continue                      # پروژه‌ای که هنوز هیچ هزینه، دریافتی یا فروشی ندارد
        labour_cost = sum(r["cost"] for r in lab)
        material_cost = sum(r["cost"] for r in mat)
        cost = labour_cost + material_cost
        contract = _f(p.price) or None
        # مبنای فروش: سندهای فروش اگر باشند، وگرنه مبلغ قراردادِ دستی
        if sold and (sold["invoiced"] or sold["quoted"]):
            sale, sale_gross = sold["invoiced"] + sold["quoted"], sold["invoicedGross"] + sold["quotedGross"]
            source = "mixed" if sold["invoiced"] and sold["quoted"] else "invoice" if sold["invoiced"] else "proforma"
        else:
            sale, sale_gross, source = contract, contract, "contract" if contract else ""
        issues = {
            "labourMissing": sum(1 for r in lab if r["rateSource"] == "none"),
            "labourEstimated": sum(1 for r in lab if r["rateSource"] == "average"),
            "material": sum(1 for r in mat if r["reason"]),
            "pendingWork": pend_work.get(pid, 0),
            "pendingUsage": pend_usage.get(pid, 0),
        }
        row = {
            "id": str(pid), "name": p.name, "label": _label(p), "owner": p.owner_name, "state": _state(p),
            "area": _f(p.base_area) or None,
            "hours": round(sum(r["hours"] for r in lab), 2),
            "labour": labour_cost, "material": material_cost, "cost": cost,
            "perM2": round(cost / _f(p.base_area)) if p.base_area else None,
            "contract": contract, "received": got,
            "sale": sale, "saleGross": sale_gross, "saleSource": source, "saleLabel": SALE_LABEL.get(source, ""),
            "invoiced": sold["invoiced"] if sold else 0, "quoted": sold["quoted"] if sold else 0,
            "invoices": sold["invoices"] if sold else 0, "proformas": sold["proformas"] if sold else 0,
            "receivable": (sale_gross - got) if sale_gross is not None else None,
            "profit": (got - cost) if got else None,
            "contractProfit": (sale - cost) if sale is not None else None,       # سودِ فروش (نامِ کلید از قبل مانده)
            "margin": round((sale - cost) / sale * 100, 1) if sale else None,
            "issues": issues,
            "complete": not (issues["labourMissing"] or issues["material"]),
        }
        if detail:
            row["labourRows"] = lab
            row["materialRows"] = mat
            row["receipts"] = receipts.get(pid, [])
        rows.append(row)
        for k in ("hours", "labour", "material", "cost", "received"):
            totals[k] += row[k] or 0
        totals["contract"] += contract or 0
        totals["sale"] += sale or 0
        if got:
            totals["profit"] += got - cost
    rows.sort(key=lambda r: (r["state"] != "active", -r["cost"]))

    def done(items):
        out = []
        for v in items.values():
            v = dict(v)
            v["projects"] = len(v["projects"])
            for k in ("hours", "qty"):
                if k in v:
                    v[k] = round(v[k], 2)
            out.append(v)
        return out

    lab_iss = sorted(done(labour_issues), key=lambda r: (r["severity"] != "none", -r["hours"]))
    mat_iss = sorted(done(material_issues), key=lambda r: (r["reason"], -r["lines"]))
    return {
        "projects": rows,
        "totals": {k: round(v) if k != "hours" else round(v, 2) for k, v in totals.items()},
        "labourRate": fallback,
        "issues": {"labour": lab_iss, "material": mat_iss},
    }
