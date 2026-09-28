import { useState } from "react";

/* ============ چیدمان ویجت‌ها: دو ستون، هر ویجت نصف یا تمام عرض ============
   چیدمان هر کاربر روی سرور است (User.dashboard) تا در هر دستگاهی همان باشد. کدام ویجت‌ها
   اجازه دارند را مسئول کاربران در access تعیین می‌کند؛ اینجا فقط همان‌ها چیده می‌شوند.
   layout = {order: [ویجت‌های روشن به ترتیب], size: {id: "half"|"full"}, collapsed: {id: true}}
   layout خالی یعنی چیدمان پیش‌فرض. */

export function defaultLayout(defs) {
  return {
    order: defs.filter((d) => d.on !== false).map((d) => d.id),
    size: Object.fromEntries(defs.map((d) => [d.id, d.size || "half"])),
    collapsed: {},
  };
}

/** defs: ویجت‌های مجاز این کاربر [{id, title, group, hint, size, on}]. saved: چیدمان سرور. */
export function useDashboardLayout(saved, defs, onSave) {
  const allowed = new Set(defs.map((d) => d.id));
  const base = saved && Array.isArray(saved.order) ? saved : defaultLayout(defs);
  const [draft, setDraft] = useState(null);          // در حالت ویرایش: نسخهٔ در حال تغییر
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cur = draft || base;
  const sizeOf = (id) => cur.size?.[id] || defs.find((d) => d.id === id)?.size || "half";

  async function persist(layout) {
    setBusy(true); setErr("");
    try { await onSave(layout); return true; } catch (e) { setErr(e.message); return false; } finally { setBusy(false); }
  }
  const edit = (fn) => setDraft((d) => fn(JSON.parse(JSON.stringify(d || base))));

  return {
    editing: !!draft, busy, err,
    visible: cur.order.filter((id) => allowed.has(id)),
    isOn: (id) => cur.order.includes(id),
    sizeOf,
    collapsed: (id) => !draft && !!cur.collapsed?.[id],
    startEdit: () => { setErr(""); setDraft(JSON.parse(JSON.stringify({ ...base, size: base.size || {}, collapsed: base.collapsed || {} }))); },
    cancel: () => { setDraft(null); setErr(""); },
    save: async () => { if (await persist({ ...draft, order: draft.order.filter((id) => allowed.has(id)) })) setDraft(null); },
    resetDraft: () => setDraft(defaultLayout(defs)),
    toggle: (id) => edit((l) => ({ ...l, order: l.order.includes(id) ? l.order.filter((x) => x !== id) : [...l.order, id] })),
    toggleSize: (id) => edit((l) => ({ ...l, size: { ...l.size, [id]: sizeOf(id) === "full" ? "half" : "full" } })),
    move: (id, dir) => edit((l) => {
      const vis = l.order.filter((x) => allowed.has(x));
      const i = vis.indexOf(id), j = i + dir;
      if (j < 0 || j >= vis.length) return l;
      [vis[i], vis[j]] = [vis[j], vis[i]];
      return { ...l, order: vis };
    }),
    moveBefore: (id, target) => edit((l) => {
      if (id === target) return l;
      const vis = l.order.filter((x) => allowed.has(x) && x !== id);
      vis.splice(target ? vis.indexOf(target) : vis.length, 0, id);
      return { ...l, order: vis };
    }),
    // جمع/باز کردن بیرون از حالت ویرایش همان لحظه ذخیره می‌شود
    toggleCollapse: (id) => persist({ ...base, collapsed: { ...(base.collapsed || {}), [id]: !base.collapsed?.[id] } }),
  };
}

const Btn = ({ title, onClick, children, disabled }) => (
  <button type="button" className="wg-btn" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>
);

export function Widget({ id, title, sub, ctl, first, last, children }) {
  const [over, setOver] = useState(false);
  const full = ctl.sizeOf(id) === "full";
  const collapsed = ctl.collapsed(id);
  const drag = ctl.editing ? {
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData("text/widget", id); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e) => { if (e.dataTransfer.types.includes("text/widget")) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); ctl.moveBefore(e.dataTransfer.getData("text/widget"), id); },
  } : {};
  return (
    <section className={`wg ${full ? "wg-full" : ""} ${collapsed ? "wg-col" : ""} ${ctl.editing ? "wg-edit" : ""} ${over ? "wg-over" : ""}`}
      aria-label={title} {...drag}>
      <header className="wg-h">
        {ctl.editing && <span className="wg-grip" aria-hidden="true">⠿</span>}
        <div className="wg-t">
          <h3>{title}</h3>
          {sub && <span>{sub}</span>}
        </div>
        <div className="wg-ctl no-print">
          {ctl.editing ? (
            <>
              <Btn title="جابه‌جایی به قبل" onClick={() => ctl.move(id, -1)} disabled={first}>›</Btn>
              <Btn title="جابه‌جایی به بعد" onClick={() => ctl.move(id, 1)} disabled={last}>‹</Btn>
              <Btn title={full ? "نصف عرض" : "تمام عرض"} onClick={() => ctl.toggleSize(id)}>{full ? "◧" : "▭"}</Btn>
              <Btn title="برداشتن از داشبورد" onClick={() => ctl.toggle(id)}>✕</Btn>
            </>
          ) : (
            <Btn title={collapsed ? "باز کردن" : "جمع کردن"} onClick={() => ctl.toggleCollapse(id)} disabled={ctl.busy}>
              {collapsed ? "▾" : "▴"}
            </Btn>
          )}
        </div>
      </header>
      {!collapsed && <div className="wg-b">{children}</div>}
    </section>
  );
}

/** فهرست همهٔ ویجت‌های مجاز در حالت ویرایش، گروه‌به‌گروه، با تیک گذاشتن/برداشتن. */
export function WidgetCatalog({ ctl, defs }) {
  const groups = [...new Set(defs.map((d) => d.group))];
  return (
    <div className="wg-cat no-print">
      <div className="wg-cat-h">
        <b>ویرایش داشبورد</b>
        <span className="muted sm2">تیک هر ویجت آن را روی داشبورد می‌گذارد یا برمی‌دارد. برای جابه‌جایی، ویجت را بکشید یا از فلش‌ها استفاده کنید.</span>
      </div>
      <div className="wg-cat-g">
        {groups.map((g) => (
          <fieldset key={g}>
            <legend>{g}</legend>
            {defs.filter((d) => d.group === g).map((d) => (
              <label key={d.id} className={ctl.isOn(d.id) ? "on" : ""}>
                <input type="checkbox" checked={ctl.isOn(d.id)} onChange={() => ctl.toggle(d.id)} />
                <span><b>{d.title}</b>{d.hint && <small>{d.hint}</small>}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {ctl.err && <div className="err">{ctl.err}</div>}
      <div className="wg-cat-a">
        <button type="button" className="submit" style={{ width: "auto", margin: 0 }} onClick={ctl.save} disabled={ctl.busy}>
          {ctl.busy ? "در حال ذخیره…" : "ذخیرهٔ چیدمان"}
        </button>
        <button type="button" className="ghost" onClick={ctl.cancel} disabled={ctl.busy}>انصراف</button>
        <button type="button" className="link-btn" onClick={ctl.resetDraft}>چیدمان پیش‌فرض</button>
      </div>
    </div>
  );
}
