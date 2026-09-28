import { useState } from "react";
import { auth } from "../api.js";
import { DiwajLogo } from "../shared/core.jsx";
import { CSS } from "../styles.js";

/* ============ ورود ============ */
export function Login({ onLogin }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy || !u.trim() || !p.trim()) return;
    setBusy(true); setErr("");
    try {
      await onLogin(u.trim(), p.trim());
    } catch (e) {
      setErr(e.message || "نام کاربری یا رمز نادرست است.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app" dir="rtl">
      <style>{CSS}</style>
      <div className="login-wrap">
        <img className="login-hero" src="/login-hero.webp" alt="" />
        <div className="login-card">
          <span className="mark big"><DiwajLogo /></span>
          <h1>Diwaj ERP</h1>
          <p className="sub">برنامه‌ریزی منابع سازمان</p>
          <label className="fld"><span>نام کاربری</span><input value={u} onChange={(e) => { setU(e.target.value); setErr(""); }} placeholder="نام کاربری" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          <label className="fld"><span>رمز</span><input type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(""); }} placeholder="••••" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          {err && <div className="err">{err}</div>}
          <button className="submit" disabled={busy} onClick={submit}>{busy ? "در حال ورود…" : "ورود"}</button>
        </div>
      </div>
    </div>
  );
}
/* ============ تغییر اجباری رمز عبور ============ */
export function ForcePasswordChange({ session, onChanged, onLogout }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const cur = current.trim(), nw = next.trim(), cf = confirm.trim();
    if (!cur) { setErr("لطفاً رمز فعلی را وارد کنید."); return; }
    if (nw.length < 4) { setErr("رمز جدید باید حداقل ۴ کاراکتر باشد."); return; }
    if (nw !== cf) { setErr("رمز جدید و تکرارش یکسان نیستند."); return; }
    setBusy(true); setErr("");
    try {
      const updated = await auth.changePassword(cur, nw);
      onChanged(updated);
    } catch (e) {
      setErr(e.message || "خطا در تغییر رمز.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" dir="rtl">
      <style>{CSS}</style>
      <div className="login-wrap">
        <div className="login-card">
          <span className="mark big"><DiwajLogo /></span>
          <h1>تغییر رمز عبور</h1>
          <p className="sub">برای ادامه، لطفاً رمز خودتون رو تغییر بدید</p>
          <label className="fld"><span>رمز فعلی</span><input type="password" value={current} onChange={(e) => { setCurrent(e.target.value); setErr(""); }} placeholder="••••" /></label>
          <label className="fld"><span>رمز جدید</span><input type="password" value={next} onChange={(e) => { setNext(e.target.value); setErr(""); }} placeholder="حداقل ۴ کاراکتر" /></label>
          <label className="fld"><span>تکرار رمز جدید</span><input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(""); }} placeholder="••••" onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          {err && <div className="err">{err}</div>}
          <button className="submit" disabled={busy} onClick={submit}>{busy ? "در حال ثبت…" : "ثبت رمز جدید"}</button>
          <button className="logout" style={{ marginTop: 10, width: "100%" }} onClick={onLogout}>خروج</button>
        </div>
      </div>
    </div>
  );
}
