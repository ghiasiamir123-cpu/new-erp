"""فرمول نام و کدِ رنگ‌های والرسا (Tint Color) — همان که حسابداری با آن کد می‌زند.

    نام:  Valresa - P.U - Topcoat Base [Tint Color - Nova L157] 1Kg (B:973002/H:190046) Mix(2.5+1) 25G
    کد:   VT-NL157-25G

کد رنگ از نام رنگ ساخته می‌شود: «NCS S 1002-Y50R» ← S1002Y50R، «RAL 7023» ← R7023،
«Nova L157» ← NL157. رنگی که از این سه نیست (Sedef Beyaz) کدِ رنگش را خود کاربر می‌دهد.
فرم تعریف کالا (src/App.jsx، vtBuild) همین قاعده را دارد؛ هر دو باید یکی بمانند.
"""
import re
from collections import Counter, defaultdict

NAME = re.compile(
    r"^Valresa - (?P<line>[^\[\]]+?) - (?P<category>[^\[\]]+?) "
    r"\[(?P<sub>[^\[\]]+?) - (?P<color>[^\[\]]+?)\] "
    r"(?P<qty>\d+(?:\.\d+)?)(?P<unit>Kg|L) "
    r"\(B:(?P<base>[^/()]+)/H:(?P<hardener>[^()]+)\) "
    r"Mix\((?P<mix>[^()]+)\) (?P<gloss>\S+)$")
SYSTEM = re.compile(r"^(?P<system>NCS|NSC|RAL|Nova)\s*(?P<rest>.*)$", re.I)
EXAMPLE = "Valresa - P.U - Topcoat Base [Tint Color - Nova L157] 1Kg (B:973002/H:190046) Mix(2.5+1) 25G"


def is_tint(name, code):
    """آیا این کالا رنگِ فرمول‌دار والرساست؟

    کد «VT-» به‌تنها کافی نیست: پتینهٔ Vivid هم کد VT-DSilver-375 دارد و والرسا نیست.
    """
    name = (name or "").strip().lower()
    return name.startswith("valresa") and ("[tint color" in name or (code or "").strip().upper().startswith("VT-"))


def color_code(color):
    """کد رنگ از نام رنگ، یا None اگر رنگ از NCS و RAL و Nova نیست."""
    m = SYSTEM.match((color or "").strip())
    if not m:
        return None
    rest = re.sub(r"[\s-]+", "", m.group("rest")).upper()
    if not rest:
        return None
    system = m.group("system").upper()
    if system in ("NCS", "NSC"):
        return rest if rest.startswith("S") else "S" + rest
    return ("R" if system == "RAL" else "N") + rest


def check(name, code):
    """خطای فرم به شکل {فیلد: پیام}، یا None اگر نام و کد طبق فرمول‌اند."""
    m = NAME.match((name or "").strip())
    if not m:
        return {"name": "نام رنگ والرسا طبق فرمول نیست. شکل درست: " + EXAMPLE}
    gloss = m.group("gloss")
    part = color_code(m.group("color"))
    if part:
        want = f"VT-{part}-{gloss}"
        if (code or "").strip() != want:
            return {"barcode": f"کد این رنگ طبق فرمول «{want}» است، نه «{code or '—'}»."}
    elif not re.fullmatch(r"VT-[^\s-]+-" + re.escape(gloss), (code or "").strip()):
        return {"barcode": f"کد این رنگ باید به شکل «VT-<کد رنگ>-{gloss}» باشد."}
    return None


def options(names):
    """مقدارهای موجود برای پیشنهاد در فرم، و ترکیب‌های رایجِ B/H/Mix برای هر براقیت."""
    seen = defaultdict(Counter)
    combos = defaultdict(Counter)
    for name in names:
        m = NAME.match((name or "").strip())
        if not m:
            continue
        for key in ("line", "category", "sub", "gloss", "base", "hardener", "mix"):
            seen[key][m.group(key)] += 1
        combos[m.group("gloss")][(m.group("base"), m.group("hardener"), m.group("mix"))] += 1
    plural = {"line": "lines", "category": "categories", "sub": "subs", "gloss": "glosses",
              "base": "bases", "hardener": "hardeners", "mix": "mixes"}
    out = {plural[key]: [v for v, _ in seen[key].most_common()] for key in plural}
    out["combos"] = {
        gloss: [{"base": b, "hardener": h, "mix": x, "count": n} for (b, h, x), n in counter.most_common()]
        for gloss, counter in combos.items()
    }
    return out
