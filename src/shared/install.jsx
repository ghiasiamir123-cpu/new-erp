import { useEffect, useState } from "react";

/* ============ نصب روی گوشی ============
   سایت روی گوشی مثلِ یک برنامه نصب می‌شود (آیکون روی صفحهٔ اصلی، تمام‌صفحه). در اندروید/کروم خودِ مرورگر پنجرهٔ نصب را
   می‌دهد؛ در آیفون و مرورگرهای دیگر راهش دستی است و همین‌جا گفته می‌شود. وقتی از داخلِ برنامهٔ نصب‌شده باز شده، چیزی
   نشان داده نمی‌شود. */

const SECURE_URL = "https://erp.diwajshop.ir";

const standalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
};

export function InstallApp() {
  const [ask, setAsk] = useState(null);                 // پنجرهٔ نصبِ خودِ مرورگر، اگر داده باشد
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(standalone);

  useEffect(() => {
    const onAsk = (e) => { e.preventDefault(); setAsk(e); };
    const onDone = () => { setDone(true); setAsk(null); };
    window.addEventListener("beforeinstallprompt", onAsk);
    window.addEventListener("appinstalled", onDone);
    return () => {
      window.removeEventListener("beforeinstallprompt", onAsk);
      window.removeEventListener("appinstalled", onDone);
    };
  }, []);

  if (done) return null;
  const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const click = async () => {
    if (!ask) { setOpen(!open); return; }
    ask.prompt();
    const choice = await ask.userChoice.catch(() => null);
    if (choice && choice.outcome === "accepted") setDone(true);
    setAsk(null);
  };
  return (
    <div className="sb-install no-print">
      <button onClick={click} aria-expanded={open}>نصب روی گوشی</button>
      {open && (
        <div className="sb-install-how">
          {!window.isSecureContext
            ? <>برای نصب، سایت را از نشانیِ امنش باز کنید:<b dir="ltr">{SECURE_URL}</b></>
            : ios
              ? <>در Safari دکمهٔ «اشتراک‌گذاری» (مربع با فلشِ رو به بالا) را بزنید و <b>Add to Home Screen</b> را انتخاب کنید.</>
              : <>منوی مرورگر (سه‌نقطه) را باز کنید و <b>«افزودن به صفحهٔ اصلی»</b> یا <b>Install app</b> را بزنید.</>}
        </div>
      )}
    </div>
  );
}
