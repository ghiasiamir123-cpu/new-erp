"""مصرف واقعی مواد در هر متر، در برابر مصرف استاندارد رنر.

مقایسهٔ منصفانه «به ازای هر دست روی هر متر» است، نه به ازای متراژ چوب کل پروژه: آستر با
متراژِ انجام‌شدهٔ مراحل آستر مقایسه می‌شود و رویه با متراژِ مراحل رنگ. وگرنه پروژه‌ای که
رویه‌اش هنوز تمام نشده «کم‌مصرف» به نظر می‌رسید. متراژ مراحل از گزارش کار تأییدشده است و
متراژ هر مرحله همان متراژ چوب ضربدر تعداد دست است، پس «کیلو ÷ متراژ مرحله» یعنی کیلو در
هر دست روی هر متر.

کالا از روی نامش در یکی از گروه‌ها می‌نشیند (آستر، رویه، روغن، تینر، سنباده، مصرفی). هاردنر
به گروهِ رنگی می‌رود که نامش آن را نشان می‌دهد («هاردنر آستر پولچم» ← آستر).

مقدارها به واحد فیزیکی (کیلو یا لیتر) برمی‌گردند؛ لیتر برای رنگ و تینر نزدیک به کیلو گرفته
می‌شود. این مقایسه برای تشخیص «کم / درست / زیاد» است، نه حسابداری.
"""
import re
from collections import defaultdict

from .models import MaterialUsage, Project, ReportProgress, WorkStage
from .production import DONE_STATUS, _f, _to_base_qty, _unit_price, board

# مصرف استاندارد رنر، از دیتاشیت‌هایی که روی سایت فروش (diwajshop.ir) ثبت شده:
#   PU Basecoat FL M720 / PU Basecoat Black: ۱۴۰–۱۸۰ گرم در هر دست، هاردنر ۱۰۰:۲۰، تینر ۲۰٪
#   Full Matt / Silk Matt / Black PU Topcoat: ۱۴۰–۱۸۰ گرم در هر دست، هاردنر ۱۰۰:۵۰، تینر ۲۰–۴۰٪
# گرم‌ها برای جزء A (رنگ) است؛ «با هاردنر» همان ضربدر (۱ + نسبت هاردنر).
RENNER = {
    "primer": {"label": "آستر PU رنر", "perCoat": (140, 180), "hardener": 0.20, "thinner": (0.20, 0.20),
               "source": "Renner PU Basecoat (FL M720): ۱۴۰–۱۸۰ g/m² در هر دست، هاردنر ۱۰۰:۲۰، تینر ۲۰٪"},
    "topcoat": {"label": "رویه PU رنر", "perCoat": (140, 180), "hardener": 0.50, "thinner": (0.20, 0.40),
                "source": "Renner PU Topcoat (Full Matt / Black): ۱۴۰–۱۸۰ g/m² در هر دست، هاردنر ۱۰۰:۵۰، تینر ۲۰–۴۰٪"},
}
TOLERANCE = 0.15   # ۱۵٪ بیرون از بازهٔ استاندارد هنوز «درست» است؛ اندازه‌گیری کارگاه دقیق نیست.

GROUPS = [
    ("thinner", "تینر", re.compile(r"تینر|tinner|thinner", re.I)),
    ("abrasive", "سنباده", re.compile(r"abrasive|سنباده", re.I)),
    ("oil", "روغن و رنگ‌مایه", re.compile(r"روغن|\boil\b|wax|stain", re.I)),
    ("primer", "آستر و هاردنرش", re.compile(r"آستر|استر|primer|basecoat|sealer|سورپلاس|پولچم", re.I)),
    ("topcoat", "رویه و هاردنرش", re.compile(r"رویه|topcoat|top coat|varnish|paint|converter", re.I)),
]
GROUP_LABEL = {k: lbl for k, lbl, _ in GROUPS} | {"other": "مصرفی (نوار، فوم، چسب)"}
MASS_UNITS = {"کیلوگرم", "لیتر"}


def group_of(name):
    for key, _, pattern in GROUPS:
        if pattern.search(name or ""):
            return key
    return "other"


def _stage_kind(name):
    """مراحل آستر و مراحل رنگ. «پرداخت قبل از استر» سنباده است، نه آستر."""
    if name.startswith("پرداخت"):
        return None
    if "استر" in name or "پرایمر" in name:
        return "primer"
    if "رنگ" in name:
        return "topcoat"
    return None


def _physical(u):
    """مقدار به واحدی که آدم می‌فهمد: کیلو/لیتر به‌جای «حلب»، اگر تبدیلش معلوم است."""
    s, q, unit = u.sku, _f(u.quantity), (u.unit or "").strip()
    if s and s.alt_unit and s.alt_to_base and unit == (s.base_unit or "").strip():
        return q / float(s.alt_to_base), s.alt_unit
    return q, unit


def _standard(kind):
    std = RENNER[kind]
    lo, hi = std["perCoat"]
    mix = (lo * (1 + std["hardener"]) / 1000, hi * (1 + std["hardener"]) / 1000)
    return mix


def _thinner_standard(primer_m2, top_m2):
    """تینرِ رقیق‌سازی برای متراژ دست‌های آستر و رویه (کیلو)."""
    p, t = RENNER["primer"], RENNER["topcoat"]
    lo = (primer_m2 * p["perCoat"][0] * p["thinner"][0] + top_m2 * t["perCoat"][0] * t["thinner"][0]) / 1000
    hi = (primer_m2 * p["perCoat"][1] * p["thinner"][1] + top_m2 * t["perCoat"][1] * t["thinner"][1]) / 1000
    return lo, hi


def verdict(actual, lo, hi):
    """missing: هیچ ثبت نشده · partial: کمتر از نصف استاندارد، یعنی بخشی از مصرف ثبت نشده
    (کسی نیمی از رنگ لازم را نمی‌زند) · low / ok / high."""
    if actual is None:
        return None
    if actual <= 0:
        return "missing"
    if actual < lo * 0.5:
        return "partial"
    if actual < lo * (1 - TOLERANCE):
        return "low"
    if actual > hi * (1 + TOLERANCE):
        return "high"
    return "ok"


def consumption(with_cost=False):
    rows = {r["id"]: r for r in board()["results"]}
    projects = {}
    for p in Project.objects.filter(general=False, base_area__gt=0):
        row = rows.get(str(p.pk))
        # پروژه‌ای که با «دادهٔ ناقص» بسته شده گزارش‌هایش کامل نیست؛ در میانگین نمی‌آید.
        if not row or p.close_reason == Project.CloseReason.INCOMPLETE_DATA:
            continue
        finished = p.closed_at and p.close_reason == Project.CloseReason.COMPLETED
        projects[p.pk] = {"id": str(p.pk), "name": p.name, "state": row["state"],
                          "percent": row["percent"],
                          "wood": float(p.base_area) if finished or row["state"] == "finished"
                          else row["baseDone"]}

    kinds = {s.name: _stage_kind(s.name) for s in WorkStage.objects.all()}
    coats = defaultdict(lambda: defaultdict(float))       # pid -> primer/topcoat -> m² of coats done
    for r in (ReportProgress.objects.filter(report__status=DONE_STATUS, project_id__in=list(projects))
              .values("project_id", "stage", "area")):
        kind = kinds.get(r["stage"])
        if kind:
            coats[r["project_id"]][kind] += _f(r["area"])

    kg = defaultdict(lambda: defaultdict(float))          # pid -> group -> kg
    mats = {}
    priced_lines = total_lines = 0
    for u in (MaterialUsage.objects.filter(report__status="approved", project_id__in=list(projects))
              .select_related("sku")):
        if not u.sku:
            continue
        total_lines += 1
        name = u.sku.display_name
        group = group_of(name)
        qty, unit = _physical(u)
        if unit in MASS_UNITS:
            kg[u.project_id][group] += qty
        m = mats.setdefault(u.sku_id, {"name": name, "group": group, "unit": unit, "qty": 0.0,
                                       "projects": set(), "cost": 0.0, "priced": True})
        m["qty"] += qty
        m["projects"].add(u.project_id)
        base = _to_base_qty(u.sku, _f(u.quantity), u.unit)
        price = _unit_price(u.sku)
        if price and base is not None:
            m["cost"] += price * base
            priced_lines += 1
        else:
            m["priced"] = False

    # ---- هر پروژه ----
    out_projects = []
    for pid, p in projects.items():
        if pid not in kg and pid not in coats:
            continue
        c, k = coats.get(pid, {}), kg.get(pid, {})
        checks = {}
        for kind in ("primer", "topcoat"):
            area = c.get(kind, 0.0)
            actual = k.get(kind, 0.0) / area if area else None
            lo, hi = _standard(kind)
            checks[kind] = {"kg": round(k.get(kind, 0.0), 2), "coatM2": round(area, 2),
                            "perCoatM2": round(actual, 3) if actual is not None else None,
                            "verdict": verdict(actual, lo, hi)}
        area_all = c.get("primer", 0.0) + c.get("topcoat", 0.0)
        lo, hi = _thinner_standard(c.get("primer", 0.0), c.get("topcoat", 0.0))
        th = k.get("thinner", 0.0)
        checks["thinner"] = {"kg": round(th, 2), "coatM2": round(area_all, 2),
                             "perCoatM2": round(th / area_all, 3) if area_all else None,
                             "standardKg": [round(lo, 2), round(hi, 2)],
                             "verdict": verdict(th, lo, hi) if area_all else None}
        checks["oil"] = {"kg": round(k.get("oil", 0.0), 2)}
        out_projects.append({**p, "checks": checks})
    out_projects.sort(key=lambda r: -r["wood"])

    # ---- جمع همه ----
    # میانگین فقط از پروژه‌هایی که مصرفشان کامل ثبت شده؛ ثبتِ ناقص عدد را بی‌جهت پایین می‌کشد.
    trusted = lambda c: c["kg"] > 0 and c["coatM2"] > 0 and c["verdict"] != "partial"
    summary = {}
    for kind in ("primer", "topcoat"):
        used = [r for r in out_projects if trusted(r["checks"][kind])]
        area = sum(r["checks"][kind]["coatM2"] for r in used)
        total = sum(r["checks"][kind]["kg"] for r in used)
        lo, hi = _standard(kind)
        actual = total / area if area else None
        summary[kind] = {"label": GROUP_LABEL[kind], "perCoatM2": round(actual, 3) if actual else None,
                         "standard": [round(lo, 3), round(hi, 3)], "standardLabel": RENNER[kind]["label"],
                         "source": RENNER[kind]["source"], "projects": len(used),
                         "sampleM2": round(area, 2), "verdict": verdict(actual, lo, hi) if area else None,
                         "notRecorded": [r["name"] for r in out_projects
                                         if r["checks"][kind]["coatM2"] > 0 and not r["checks"][kind]["kg"]],
                         "partial": [r["name"] for r in out_projects
                                     if r["checks"][kind]["verdict"] == "partial"]}
    used = [r for r in out_projects if trusted(r["checks"]["thinner"])]
    area = sum(r["checks"]["thinner"]["coatM2"] for r in used)
    total = sum(r["checks"]["thinner"]["kg"] for r in used)
    lo = sum(r["checks"]["thinner"]["standardKg"][0] for r in used)
    hi = sum(r["checks"]["thinner"]["standardKg"][1] for r in used)
    summary["thinner"] = {"label": GROUP_LABEL["thinner"], "perCoatM2": round(total / area, 3) if area else None,
                          "standard": [round(lo / area, 3), round(hi / area, 3)] if area else None,
                          "standardLabel": "رقیق‌سازی طبق نسبت رنر", "projects": len(used),
                          "sampleM2": round(area, 2), "verdict": verdict(total, lo, hi) if area else None,
                          "source": "تینر آستر ۲۰٪ و رویه ۲۰–۴۰٪ وزن رنگ؛ شست‌وشوی پیستوله جدا حساب نشده"}

    # ---- هر کالا، به ازای متر چوب ----
    out_mats = []
    for m in mats.values():
        wood = sum(projects[pid]["wood"] for pid in m["projects"])
        row = {"name": m["name"], "group": m["group"], "groupLabel": GROUP_LABEL[m["group"]],
               "unit": m["unit"], "qty": round(m["qty"], 2), "projects": len(m["projects"]),
               "wood": round(wood, 2), "perWoodM2": round(m["qty"] / wood, 3) if wood else None}
        if with_cost:
            row["costPerWoodM2"] = round(m["cost"] / wood) if wood and m["priced"] else None
        out_mats.append(row)
    order = {k: i for i, (k, _, _) in enumerate(GROUPS)} | {"other": 99}
    out_mats.sort(key=lambda r: (order[r["group"]], -(r["qty"])))

    result = {"summary": summary, "projects": out_projects, "materials": out_mats,
              "pricedShare": round(priced_lines / total_lines * 100, 1) if total_lines else 0.0,
              "unpriced": sum(1 for m in mats.values() if not m["priced"]), "materialCount": len(mats),
              "tolerance": TOLERANCE}
    return result
