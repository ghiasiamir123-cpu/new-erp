"""ارتباط با سایت فروش diwajshop.ir

کلید و آدرس از فایل .env خوانده می‌شود و هرگز داخل کد نوشته نمی‌شود:

    DIWAJ_SHOP_URL=https://diwajshop.ir/api/v1
    DIWAJ_SHOP_TOKEN=…

کلید ساخته‌شده در سایت این دسترسی‌ها را دارد:
read_items · read_stock · write_stock · read_movements
"""

import json
import os
import urllib.error
import urllib.request


class ShopError(RuntimeError):
    pass


def _config():
    url = (os.environ.get("DIWAJ_SHOP_URL") or "https://diwajshop.ir/api/v1").rstrip("/")
    token = os.environ.get("DIWAJ_SHOP_TOKEN") or ""
    if not token:
        raise ShopError(
            "کلید سایت تنظیم نشده. در فایل .env روی سرور DIWAJ_SHOP_TOKEN را بگذارید."
        )
    return url, token


def call(path, method="GET", body=None, timeout=45):
    url, token = _config()
    req = urllib.request.Request(url + path, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise ShopError(f"سایت پاسخ {e.code} داد: {detail}") from e
    except urllib.error.URLError as e:
        raise ShopError(f"اتصال به سایت ممکن نشد: {e.reason}") from e


def fetch_all(path, key, page_size=200):
    """صفحه‌به‌صفحه می‌گیرد تا has_next تمام شود."""
    out, page = [], 1
    while True:
        sep = "&" if "?" in path else "?"
        d = call(f"{path}{sep}page={page}&page_size={page_size}")
        batch = d.get(key) or []
        out.extend(batch)
        if not d.get("has_next") or not batch:
            return out
        page += 1
        if page > 200:  # محافظ در برابر حلقهٔ بی‌پایان
            return out


def fetch_items():
    return fetch_all("/items/", "items")


def fetch_stock():
    return fetch_all("/stock/", "stock")
