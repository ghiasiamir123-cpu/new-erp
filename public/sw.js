// Diwaj ERP — کارگرِ سرویس.
// فقط برای اینکه سایت روی گوشی «نصب‌شدنی» باشد و وقتی اینترنت نیست پیامِ روشنی بدهد.
// هیچ‌چیز از سایت را نگه نمی‌دارد: هر بار تازه‌ترین نسخه از سرور می‌آید، پس با هر به‌روزرسانیِ سایت «برنامه» هم همان لحظه
// به‌روز است و دیتای کهنه نشان داده نمی‌شود.

const OFFLINE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diwaj ERP</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F8F7;color:#14302B;font-family:Tahoma,sans-serif;text-align:center;padding:24px}
  h1{font-size:20px;margin:0 0 8px} p{margin:0 0 18px;color:#5E736E;line-height:1.9}
  button{font:inherit;border:0;border-radius:10px;background:#147D70;color:#fff;padding:10px 22px;cursor:pointer}
</style>
</head>
<body>
<div>
  <h1>اینترنت وصل نیست</h1>
  <p>Diwaj ERP برای کار به اینترنت نیاز دارد. اتصال را نگاه کنید و دوباره امتحان کنید.</p>
  <button onclick="location.reload()">دوباره امتحان کن</button>
</div>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // فقط باز کردنِ خودِ صفحه؛ درخواست‌های دیتا و فایل‌ها دست‌نخورده به سرور می‌روند.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
