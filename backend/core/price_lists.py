"""لیست قیمت تأمین‌کننده ← قیمت تمام‌شدهٔ کالاها.

هر کالا نام یا کدِ خودش در لیست را در Sku.price_list_name دارد. قیمت لیست برای «یک بسته» است و
قیمت تمام‌شده هم برای یک واحد اصلی کالا (همان بسته) نگه داشته می‌شود؛ قیمت هر کیلو یا لیتر از
تبدیل واحدِ خود کالا درمی‌آید.
"""
import re
from decimal import Decimal

from .models import Sku


def key(text):
    """کلید تطبیق: فقط حرف و رقم، بی‌فاصله و بی‌خط‌تیره، تا «FC---M021/------41» و «FC-M021/-41» یکی شوند."""
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def apply(rows):
    """rows: [(نام یا کد در لیست، قیمت بسته)]. قیمت‌ها را می‌نشاند و گزارش می‌دهد چه شد.

    ردیفی که دو بار با دو قیمت آمده کنار گذاشته می‌شود، نه اینکه یکی‌شان بی‌صدا برنده شود.
    """
    prices, clash = {}, set()
    for name, price in rows:
        k, price = key(name), Decimal(str(price))
        if not k or price <= 1:
            continue
        if k in prices and prices[k][1] != price:
            clash.add(k)
        prices[k] = (name, price)

    changed, same, hit = [], 0, set()
    for sku in Sku.objects.exclude(price_list_name="").select_related("product"):
        k = key(sku.price_list_name)
        if k not in prices or k in clash:
            continue
        hit.add(k)
        price = prices[k][1]
        if sku.cost_price == price:
            same += 1
            continue
        changed.append({"id": sku.pk, "name": sku.display_name, "old": sku.cost_price, "new": price})
        sku.cost_price = price
        sku.save(update_fields=["cost_price"])
    return {
        "changed": changed,
        "same": same,
        "unmatched": [prices[k][0] for k in prices if k not in hit and k not in clash],
        "clash": [prices[k][0] for k in clash],
    }
