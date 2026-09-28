import { useState, useEffect, useCallback } from "react";
import { maintenanceApi } from "../api.js";
import { AssetStatusChip } from "./warehouse/assets.jsx";
import { ASSET_EVENT_CLS, ASSET_STATUS, JalaliPicker, assetChangeText, faDateTime, faDigits, faRial, jShort, todayIso, useCan } from "../shared/core.jsx";

/* ============ کارتابل تعمیر و نگهداری ============ */
// اخطارها از «انبار › اموال» ساخته می‌شوند و با ثبت سرویس یا تعمیر خودکار بسته می‌شوند.
const MT_LEVEL_CLS = { high: "bad", medium: "warn", low: "info" };

const MT_GROUP = { service_overdue: "service", service_soon: "service", needs_repair: "repair", in_repair: "repair",
  inspection: "inspection", missing: "inspection", warranty_soon: "warranty" };
// کارهای هر نوع اخطار: [برچسب دکمه، نوع رخداد، وضعیت وسیله پس از کار، نمونهٔ شرح]
const MT_ACTIONS = {
  service_overdue: [["ثبت سرویس", "service", "", "مثلاً: شست‌وشو، تعویض واشر و روغن‌کاری"]],
  service_soon: [["ثبت سرویس", "service", "", "مثلاً: شست‌وشو، تعویض واشر و روغن‌کاری"]],
  needs_repair: [["فرستادن به تعمیر", "repair", "in_repair", "مثلاً: برای تعویض نازل به تعمیرگاه … فرستاده شد"],
    ["تعمیر شد", "repair", "ok", "مثلاً: نازل عوض شد و وسیله سالم است"]],
  in_repair: [["برگشت از تعمیر", "repair", "ok", "مثلاً: از تعمیرگاه برگشت؛ نازل عوض شد"],
    ["خارج از سرویس", "note", "out_of_service", "مثلاً: تعمیرش به‌صرفه نیست؛ کنار گذاشته شد"]],
  warranty_soon: [["ثبت یادداشت", "note", "", "مثلاً: وسیله بررسی شد و ایرادی ندارد"]],
  inspection: [["ثبت سرویس", "service", "", "مثلاً: سرویس کامل انجام شد"],
    ["ثبت تعمیر", "repair", "", "مثلاً: شلنگ هوا عوض شد"]],
  missing: [],
};

const daysFromToday = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayIso()}T00:00:00`)) / 86400000);

const dueText = (iso) => {
  const d = daysFromToday(iso);
  return d < 0 ? `${faDigits(-d)} روز گذشته` : d === 0 ? "امروز" : `${faDigits(d)} روز مانده`;
};

const inspLabel = (a) => (a.inspection ? faDigits(a.inspection.number) : "بازرسی");

function alertText(a) {
  const s = a.asset || {};
  if (a.status !== "open") {
    return [a.dueDate && `موعد ${jShort(a.dueDate)}`, a.inspection && inspLabel(a), a.detail].filter(Boolean).join(" · ");
  }
  switch (a.kind) {
    case "service_overdue":
    case "service_soon":
      return a.dueDate
        ? `موعد سرویس ${jShort(a.dueDate)} (${dueText(a.dueDate)}) · هر ${faDigits(s.serviceIntervalDays)} روز · آخرین سرویس: ${s.lastServiceOn ? jShort(s.lastServiceOn) : "ثبت نشده"}`
        : `دورهٔ سرویس هر ${faDigits(s.serviceIntervalDays)} روز است ولی هنوز هیچ سرویسی ثبت نشده؛ هر چه زودتر سرویس و ثبت کنید.`;
    case "needs_repair": return "وضعیت وسیله «نیاز به تعمیر» است؛ آن را برای تعمیر بفرستید یا پس از تعمیر ثبت کنید.";
    case "in_repair": return "وسیله در تعمیر است؛ وقتی برگشت، تعمیر را با هزینه ثبت کنید تا وضعیتش «سالم» شود.";
    case "warranty_soon": return `گارانتی تا ${jShort(a.dueDate)} (${dueText(a.dueDate)})؛ اگر ایرادی دارد، پیش از پایان گارانتی پیگیری کنید.`;
    case "missing": return `در ${inspLabel(a)} پیدا نشد${a.detail ? ` — ${a.detail}` : ""}. پیگیری کنید و نتیجه را بنویسید.`;
    case "inspection": return `پیشنهاد ${inspLabel(a)}: ${a.detail || "نیاز به اقدام"}`;
    default: return a.detail || "";
  }
}

export function MaintenanceView({ onChanged, onSeen }) {
  const canWork = useCan()("maintenance.work");
  const [status, setStatus] = useState("open");
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // اعلان مرورگر فقط روی نشانی امن (https) کار می‌کند.
  const notifySupported = window.isSecureContext && "Notification" in window;
  const [notifyPerm, setNotifyPerm] = useState(() => (notifySupported ? Notification.permission : "unsupported"));

  const load = useCallback(async () => {
    try {
      const d = await maintenanceApi.alerts({ status });
      setData(d); setErr("");
      if (status === "open") onSeen(d.counts?.openIds);
    } catch (e) { setErr(e.message); setData((p) => p || { results: [], counts: {} }); }
  }, [status, onSeen]);
  useEffect(() => {
    setData(null); load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const done = (text) => { setMsg(text); setTimeout(() => setMsg(""), 5000); load(); onChanged(); };

  const c = data?.counts || {};
  const by = c.byKind || {};
  const needle = q.trim().toLowerCase();
  const rows = (data?.results || []).filter((a) => (!group || MT_GROUP[a.kind] === group)
    && (!needle || [a.asset?.name, a.asset?.code, a.asset?.location, a.asset?.holder]
      .some((x) => (x || "").toLowerCase().includes(needle))));

  return (
    <>
      <div className="stats">
        <div className={c.high ? "stat warn" : "stat"}><b>{faDigits(c.high ?? 0)}</b><span>اخطار فوری</span></div>
        <div className="stat"><b>{faDigits((by.service_overdue || 0) + (by.service_soon || 0))}</b><span>سرویس رسیده یا نزدیک</span></div>
        <div className="stat"><b>{faDigits((by.needs_repair || 0) + (by.in_repair || 0))}</b><span>نیاز به تعمیر یا در تعمیر</span></div>
        <div className="stat"><b>{faDigits((by.inspection || 0) + (by.missing || 0))}</b><span>پیگیری بازرسی</span></div>
      </div>

      <div className="card">
        <div className="muted sm2" style={{ marginBottom: 10, lineHeight: 2 }}>
          اخطارها خودکار از «انبار › اموال» ساخته می‌شوند: سرویسی که موعدش رسیده یا تا دو هفته می‌رسد، وسیلهٔ خراب یا در تعمیر،
          گارانتی رو به پایان، و نتیجهٔ بازرسی‌ها. با ثبت سرویس یا تعمیر، اخطار خودش بسته می‌شود و کار در پروندهٔ وسیله هم می‌نشیند.
        </div>
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام وسیله، کد اموال، محل یا تحویل‌گیرنده…" />
        <div className="filters" style={{ marginTop: 8 }}>
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="نوع اخطار">
            <option value="">همهٔ اخطارها</option>
            <option value="service">سرویس دوره‌ای</option>
            <option value="repair">تعمیر</option>
            <option value="inspection">بازرسی</option>
            <option value="warranty">گارانتی</option>
          </select>
        </div>
        <div className="wh-toggles">
          <label><input type="radio" checked={status === "open"} onChange={() => setStatus("open")} /> باز ({faDigits(c.open ?? 0)})</label>
          <label><input type="radio" checked={status === "done"} onChange={() => setStatus("done")} /> انجام‌شده</label>
          {notifyPerm === "default" && (
            <button className="link-btn" onClick={() => Notification.requestPermission().then(setNotifyPerm)}>
              روشن کردن اعلان مرورگر
            </button>
          )}
          {msg && <span className="ok-msg" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>

      {err && !data?.results?.length ? <div className="notice warn">{err}</div>
        : data === null ? <div className="empty">در حال بارگذاری…</div>
        : rows.length === 0 ? (
          <div className="empty">
            {status === "open" && !group && !needle ? "کارتابل خالی است ✓ هیچ وسیله‌ای الان کاری لازم ندارد." : "اخطاری پیدا نشد."}
          </div>
        ) : (
          <ul className="mt-list">
            {rows.map((a) => <MaintenanceCard key={a.id} alert={a} canWork={canWork} onDone={done} />)}
          </ul>
        )}
    </>
  );
}

function MaintenanceCard({ alert: a, canWork, onDone }) {
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = a.asset || {};
  const open = a.status === "open";
  const actions = MT_ACTIONS[a.kind] || [];

  async function toggleHistory() {
    const show = !showHistory;
    setShowHistory(show);
    if (show && history === null) {
      try { setHistory(await maintenanceApi.history(a.id)); } catch (e) { setHistory([]); setErr(e.message); }
    }
  }
  async function submit() {
    if (busy || !form.description.trim()) return;
    setBusy(true); setErr("");
    try {
      if (form.mode === "close") {
        await maintenanceApi.close(a.id, form.description.trim());
        onDone(`اخطار «${s.name}» بسته شد ✓`);
      } else {
        await maintenanceApi.record(a.id, {
          kind: form.kind, status: form.status, date: form.date, description: form.description.trim(),
          cost: form.kind === "note" ? 0 : Number(form.cost) || 0,
        });
        onDone(`«${form.label}» برای «${s.name}» ثبت شد ✓`);
      }
      setForm(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <li className={`mt-card ${open ? a.level : "closed"}`}>
      <div className="mt-hd">
        <span className={`as-chip ${open ? MT_LEVEL_CLS[a.level] || "off" : "off"}`}>{a.kindLabel}</span>
        <div className="mt-title">
          <b>{s.name}</b>
          <small>{[s.code && `کد ${s.code}`, s.location, s.holder && `تحویل ${s.holder}`].filter(Boolean).join(" · ") || "—"}</small>
        </div>
        <AssetStatusChip status={s.status} />
      </div>
      <p className="mt-text">{alertText(a)}</p>
      {!open && (
        <p className="mt-closed">
          ✓ {a.autoClosed ? "خودکار بسته شد" : "بسته شد"}{a.closedBy ? ` · ${a.closedBy}` : ""} · {faDateTime(a.closedAt)}
          {a.closeNote && <><br />{a.closeNote}</>}
        </p>
      )}

      <div className="mt-actions">
        {open && canWork && !form && actions.map(([label, kind, st, hint], i) => (
          <button key={label} className={i === 0 ? "submit" : "ghost"}
            onClick={() => { setErr(""); setForm({ mode: "event", label, kind, status: st, hint, date: todayIso(), cost: "", description: "" }); }}>
            {label}
          </button>
        ))}
        {open && canWork && !form && a.manual && (
          <button className={actions.length ? "ghost" : "submit"}
            onClick={() => {
              setErr("");
              setForm({ mode: "close", label: "بستن اخطار", description: "",
                hint: a.kind === "missing" ? "مثلاً: پیدا شد؛ در انبار مرکزی بود" : "مثلاً: بررسی شد و کاری لازم نبود" });
            }}>
            بستن اخطار
          </button>
        )}
        <span className="mt-meta">از {faDateTime(a.createdAt)}</span>
        <button className="link-btn" onClick={toggleHistory}>{showHistory ? "بستن تاریخچه" : "تاریخچهٔ وسیله"}</button>
      </div>

      {form && (
        <div className="asset-card event-form">
          <div className="items-hd">{form.label} — {s.name}</div>
          {form.mode === "event" && (
            <>
              <div className="row2">
                <label className="fld"><span>تاریخ</span>
                  <JalaliPicker value={form.date} onChange={(v) => setForm((p) => ({ ...p, date: v }))} />
                </label>
                {form.kind !== "note" && (
                  <label className="fld"><span>هزینه (ریال)</span>
                    <input type="number" min="0" inputMode="numeric" value={form.cost}
                      onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
                  </label>
                )}
              </div>
              <label className="fld"><span>وضعیت وسیله پس از این کار</span>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="">بدون تغییر ({(ASSET_STATUS[s.status] || ASSET_STATUS.ok).label})</option>
                  {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
            </>
          )}
          <label className="fld"><span>{form.mode === "close" ? "نتیجهٔ پیگیری" : "شرح کار"}</span>
            <textarea rows={2} value={form.description} autoFocus placeholder={form.hint}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </label>
          <div className="btn-row">
            <button className="ghost" disabled={busy} onClick={() => setForm(null)}>انصراف</button>
            <button className="submit" disabled={busy || !form.description.trim()} onClick={submit}>
              {busy ? "…" : form.mode === "close" ? "بستن اخطار" : "ثبت"}
            </button>
          </div>
        </div>
      )}
      {err && <div className="err" role="alert">{err}</div>}

      {showHistory && (
        history === null ? <div className="muted sm2">در حال خواندن…</div>
          : history.length === 0 ? <div className="muted sm2">هنوز رخدادی برای این وسیله ثبت نشده.</div>
          : (
            <ul className="event-list">
              {history.map((ev) => (
                <li key={ev.id}>
                  <span className={`as-chip ${ASSET_EVENT_CLS[ev.kind] || "off"}`}>{ev.kindLabel}</span>
                  <div className="event-body">
                    <div>{[ev.description, assetChangeText(ev.changes)].filter(Boolean).join(" — ") || "—"}</div>
                    <small>{jShort(ev.date)}{ev.cost ? ` · هزینه ${faRial(ev.cost)} ریال` : ""}{ev.by ? ` · ${ev.by}` : ""}</small>
                  </div>
                </li>
              ))}
            </ul>
          )
      )}
    </li>
  );
}
