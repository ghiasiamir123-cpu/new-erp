import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// نصب روی گوشی: کارگرِ سرویس فقط روی سایتِ واقعی (نه هنگامِ توسعه) و فقط روی نشانیِ امن ثبت می‌شود.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* نصب‌شدنی نشد؛ سایت همان کار می‌کند */ }); });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
