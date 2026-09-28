import { useState, useEffect, useRef } from "react";
import { usersApi } from "../api.js";
import { ACCESS_ACTIONS, ACCESS_KEYS, ACCESS_TABS, Avatar, Icon, NAV_GROUPS, POSITIONS, ROLES, actionsOf, askConfirm, faDateTime, faDigits, readPhotoFile } from "../shared/core.jsx";

/* ============ کاربران ============ */
/* ============ کاربران ============ */
// پیش‌فرض هر نقش — همان ROLE_DEFAULTS، ROLE_ACTIONS و TAB_WIDE_ACTIONS در backend/core/access.py.
const ROLE_TAB_DEFAULTS = {
  manager: ["entry", "reports", "materials", "driver", "dashboard", "projects", "contract", "payroll", "users"],
  data_entry: ["entry", "reports", "materials", "driver", "dashboard", "projects", "contract"],
  viewer: ["reports", "materials", "driver", "dashboard"],
  driver: ["driver"],
  accountant: ["dashboard", "payroll"],
};

const ROLE_ACTION_DEFAULTS = {
  manager: ACCESS_ACTIONS.map((a) => a.id),
  data_entry: ["entry.create", "materials.create", "driver.create", "dashboard.cost", "projects.create"],
  viewer: [],
  driver: ["driver.create"],
  accountant: ["dashboard.cost", "dashboard.backup", "warehouse.cost"],
};
// این کارها پیش‌تر با خودِ سربرگ داده می‌شد، برای هر نقشی.
const TAB_WIDE_ACTIONS = ["warehouse.voucher", "warehouse.post", "warehouse.assets", "consumables.edit",
  "stockreview.edit", "finance.approve", "financereports.refresh", "maintenance.work"];
/** کارهای پیش‌فرض نقش (برای سربرگ‌های داده‌شده) — tabs نیامد یعنی سربرگ‌های پیش‌فرض خود نقش. */
function roleDefaults(role, tabs = ROLE_TAB_DEFAULTS[role] || []) {
  const wanted = new Set([...(ROLE_ACTION_DEFAULTS[role] || []), ...TAB_WIDE_ACTIONS]);
  const have = new Set(tabs);
  return ACCESS_KEYS.filter((k) => (k.includes(".") ? wanted.has(k) && have.has(k.split(".")[0]) : have.has(k)));
}

const AUDIT_LABELS = {
  created: "ساخت کاربر", profile: "ویرایش مشخصات", access: "تغییر دسترسی",
  activated: "فعال شد", deactivated: "غیرفعال شد", password_reset: "بازنشانی رمز",
};

const tabName = (key) => {
  const tab = (id) => (ACCESS_TABS.find((t) => t.id === id)?.label || id).replace(" (داخل انبار)", "");
  if (!key.includes(".")) return tab(key);
  return `${tab(key.split(".")[0])} › ${ACCESS_ACTIONS.find((a) => a.id === key)?.label || key}`;
};

const isActiveUser = (u) => u.isActive !== false;

const orderAccess = (set) => ACCESS_KEYS.filter((k) => set.has(k));
// گروه‌های تیک دسترسی همان گروه‌های منوی کناری‌اند؛ زیرسربرگ‌ها زیر سربرگ مادر.
function accessGroups() {
  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.ids));
  return NAV_GROUPS.map((g, i) => ({
    label: g.label,
    items: [
      ...g.ids.flatMap((id) => [ACCESS_TABS.find((t) => t.id === id), ...ACCESS_TABS.filter((t) => t.sub === id)]),
      ...(i === NAV_GROUPS.length - 1 ? ACCESS_TABS.filter((t) => !t.sub && !grouped.has(t.id)) : []),
    ].filter(Boolean),
  }));
}

function auditText(e) {
  const c = e.changes || {};
  if (e.action === "access") {
    return [...(c.added || []).map((k) => `+ ${tabName(k)}`), ...(c.removed || []).map((k) => `− ${tabName(k)}`)].join("، ");
  }
  if (e.action === "profile") {
    const label = { name: "نام", role: "نقش", position: "سمت" };
    const val = (f, v) => (f === "role" ? ROLES[v]?.label || v : v || "—");
    return Object.entries(c).map(([f, [a, b]]) => `${label[f] || f}: ${val(f, a)} ← ${val(f, b)}`).join(" · ");
  }
  if (e.action === "created" && c.role) return `با نقش ${ROLES[c.role]?.label || c.role}`;
  return "";
}

function AuditRow({ e, users }) {
  const target = users ? users.find((u) => u.username === e.target)?.name || e.target : null;
  const text = auditText(e);
  return (
    <li>
      <span className={`audit-kind k-${e.action}`}>{AUDIT_LABELS[e.action] || e.action}</span>
      <div className="audit-body">
        <div>{target && <b>{target}</b>}{target && text ? " — " : ""}{text}</div>
        <small>{e.actor || "سامانه"} · {faDateTime(e.at)}</small>
      </div>
    </li>
  );
}

export function UsersView({ users, session, onCreate, onUpdate, onResetPassword }) {
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [open, setOpen] = useState(null);   // { username, pane }
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [recent, setRecent] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };

  // هر تغییری در فهرست کاربران یعنی شاید سطر تازه‌ای در تاریخچه آمده باشد.
  useEffect(() => { usersApi.history().then(setRecent).catch(() => setRecent([])); }, [users]);

  const counts = {
    all: users.length,
    active: users.filter(isActiveUser).length,
    inactive: users.filter((u) => !isActiveUser(u)).length,
    pw: users.filter((u) => isActiveUser(u) && u.mustChangePassword).length,
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = users
    .filter((u) => words.every((w) => `${u.name} ${u.username} ${u.position || ""}`.toLowerCase().includes(w)))
    .filter((u) => !roleF || u.role === roleF)
    .filter((u) => !statusF
      || (statusF === "active" && isActiveUser(u))
      || (statusF === "inactive" && !isActiveUser(u))
      || (statusF === "pw" && isActiveUser(u) && u.mustChangePassword))
    .sort((a, b) => Number(!isActiveUser(a)) - Number(!isActiveUser(b)) || (a.name || "").localeCompare(b.name || "", "fa"));
  const current = open && users.find((u) => u.username === open.username);

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{faDigits(counts.all)}</b><span>کاربر</span></div>
        <div className="stat"><b>{faDigits(counts.active)}</b><span>فعال</span></div>
        <div className={counts.inactive ? "stat warn" : "stat"}><b>{faDigits(counts.inactive)}</b><span>غیرفعال</span></div>
        <div className={counts.pw ? "stat warn" : "stat"}><b>{faDigits(counts.pw)}</b><span>با رمز موقت</span></div>
      </div>

      <div className="card users-toolbar">
        <input className="wh-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو: نام، نام کاربری یا سمت…" aria-label="جست‌وجوی کاربر" />
        <div className="users-filters">
          <select value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label="فیلتر نقش">
            <option value="">همهٔ نقش‌ها</option>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="فیلتر وضعیت">
            <option value="">همهٔ وضعیت‌ها</option>
            <option value="active">فعال</option>
            <option value="inactive">غیرفعال</option>
            <option value="pw">با رمز موقت</option>
          </select>
          <button className="submit users-new" onClick={() => setCreating(true)}>+ کاربر جدید</button>
        </div>
      </div>
      {msg && <div className="ok-msg" role="status">{msg}</div>}

      {list.length === 0 ? <div className="empty">کاربری با این جست‌وجو پیدا نشد.</div> : (
        <div className="tbl-scroll">
          <table className="print-table users-table">
            <thead>
              <tr><th>کاربر</th><th>نقش</th><th>سمت</th><th>وضعیت</th><th>آخرین ورود</th><th>سربرگ‌ها</th>
                <th><span className="sr-only">ویرایش</span></th></tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.username} className={isActiveUser(u) ? "" : "is-off"}>
                  <td>
                    <div className="user-cell">
                      <Avatar user={u} className="sm" />
                      <div><b>{u.name}</b><small dir="ltr">{u.username}</small></div>
                    </div>
                  </td>
                  <td>
                    <span className="role-chip" style={{ color: ROLES[u.role]?.color, background: (ROLES[u.role]?.color || "#6B7A74") + "16" }}>
                      {ROLES[u.role]?.label || u.role}
                    </span>
                  </td>
                  <td>{u.position || "—"}</td>
                  <td>
                    <span className={isActiveUser(u) ? "u-status on" : "u-status off"}>{isActiveUser(u) ? "فعال" : "غیرفعال"}</span>
                    {isActiveUser(u) && u.mustChangePassword && <span className="u-status pw">رمز موقت</span>}
                  </td>
                  <td className="muted sm2">{u.lastLogin ? faDateTime(u.lastLogin) : "هنوز وارد نشده"}</td>
                  <td>{faDigits(ACCESS_TABS.filter((t) => (u.access || []).includes(t.id)).length)} از {faDigits(ACCESS_TABS.length)}</td>
                  <td><button className="act edit" onClick={() => setOpen({ username: u.username, pane: "profile" })}>ویرایش</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="items-hd">آخرین تغییرات کاربران</div>
        {recent === null ? <div className="muted sm2">در حال خواندن…</div>
          : recent.length === 0 ? <div className="muted sm2">هنوز تغییری ثبت نشده؛ از این به بعد هر تغییر اینجا می‌آید.</div>
          : <ul className="audit-list">{recent.slice(0, 8).map((e) => <AuditRow key={e.id} e={e} users={users} />)}</ul>}
      </div>

      {creating && (
        <NewUserDialog onClose={() => setCreating(false)} onCreate={onCreate}
          onCreated={(u) => {
            setCreating(false);
            flash(`«${u.name}» ساخته شد ✓ — دسترسی‌هایش را بررسی کنید.`);
            setOpen({ username: u.username, pane: "access" });
          }} />
      )}
      {current && (
        <UserDialog key={current.username} user={current} users={users} session={session} initialPane={open.pane}
          onClose={() => setOpen(null)} onUpdate={onUpdate} onResetPassword={onResetPassword} flash={flash} />
      )}
    </>
  );
}

function NewUserDialog({ onClose, onCreate, onCreated }) {
  const [f, setF] = useState({ username: "", name: "", role: "data_entry", position: POSITIONS[2], password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.username.trim() && f.name.trim() && f.password.trim().length >= 4;

  async function add() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const u = await onCreate({ username: f.username.trim(), name: f.name.trim(), role: f.role, position: f.position, password: f.password.trim() });
      onCreated(u);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog user-dialog" role="dialog" aria-labelledby="nu-title">
        <div className="items-hd" id="nu-title">کاربر جدید</div>
        <div className="row2">
          <label className="fld"><span>نام و نام خانوادگی</span><input value={f.name} onChange={set("name")} autoFocus /></label>
          <label className="fld"><span>نام کاربری</span><input value={f.username} onChange={set("username")} dir="ltr" autoComplete="off" placeholder="لاتین، بدون فاصله" /></label>
        </div>
        <div className="row2">
          <label className="fld"><span>نقش</span>
            <select value={f.role} onChange={set("role")}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </label>
          <label className="fld"><span>سمت سازمانی</span>
            <select value={f.position} onChange={set("position")}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        </div>
        <label className="fld"><span>رمز اولیه</span>
          <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" placeholder="حداقل ۴ نویسه" />
        </label>
        <div className="muted sm2" style={{ lineHeight: 1.9 }}>
          کاربر با این رمز وارد می‌شود و همان بار اول باید رمز دلخواهش را بگذارد. سربرگ‌ها از پیش‌فرض نقش پر می‌شوند
          و بعد از ساختن، قابل تغییرند.
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit" onClick={add} disabled={!valid || busy}>{busy ? "…" : "ساختن کاربر"}</button>
        </div>
      </div>
    </div>
  );
}

function UserDialog({ user, users, session, initialPane = "profile", onClose, onUpdate, onResetPassword, flash }) {
  const me = user.username === session.username;
  const active = isActiveUser(user);
  const [pane, setPane] = useState(initialPane);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState(user.name || "");
  const [role, setRole] = useState(user.role);
  const [position, setPosition] = useState(user.position || "");
  const [access, setAccess] = useState(() => new Set(user.access || []));
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [history, setHistory] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  async function pickPhoto(file) {
    if (!file || photoBusy) return;
    setPhotoBusy(true); setErr("");
    try {
      const photo = await readPhotoFile(file);
      await onUpdate(user.username, { photo });
      flash(`عکس «${user.name}» ذخیره شد ✓`);
    } catch (e) { setErr(e.message); } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function clearPhoto() {
    if (photoBusy) return;
    const ok = await askConfirm({ title: "برداشتن عکس", message: `عکس پروفایل «${user.name}» برداشته شود؟`,
      confirmLabel: "بردار", danger: true });
    if (!ok) return;
    setPhotoBusy(true); setErr("");
    try {
      await onUpdate(user.username, { photo: "" });
      flash("عکس برداشته شد");
    } catch (e) { setErr(e.message); } finally { setPhotoBusy(false); }
  }

  const profileDirty = name.trim() !== (user.name || "") || role !== user.role || position !== (user.position || "");
  const accessDirty = orderAccess(access).join() !== orderAccess(new Set(user.access || [])).join();

  useEffect(() => {
    if (pane !== "history") return;
    setHistory(null);
    usersApi.history(user.username).then(setHistory).catch((e) => { setHistory([]); setErr(e.message); });
  }, [pane, user.username]);

  async function run(fn, done) {
    setBusy(true); setErr("");
    try { await fn(); if (done) flash(done); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const saveProfile = () => run(() => onUpdate(user.username, { name: name.trim(), role, position }), `مشخصات «${name.trim()}» ذخیره شد ✓`);
  const saveAccess = () => run(() => onUpdate(user.username, { access: orderAccess(access) }), `سربرگ‌های «${user.name}» ذخیره شد ✓`);

  async function toggleActive() {
    const ok = await askConfirm(active
      ? {
        title: `غیرفعال کردن «${user.name}»`,
        message: "این کاربر دیگر نمی‌تواند وارد سامانه شود و اگر الان وارد است، بیرون می‌افتد.\nگزارش‌ها و سوابقش پاک نمی‌شود و هر وقت بخواهید دوباره فعالش می‌کنید.",
        confirmLabel: "غیرفعال کن", danger: true,
      }
      : { title: `فعال کردن «${user.name}»`, message: "این کاربر دوباره با همان نام کاربری و رمز می‌تواند وارد شود.", confirmLabel: "فعال کن" });
    if (ok) run(() => onUpdate(user.username, { isActive: !active }), active ? `«${user.name}» غیرفعال شد` : `«${user.name}» فعال شد ✓`);
  }

  // هر کار درون سربرگش است و هر زیرسربرگ زیر سربرگ مادر: تیک فرزند مادر را هم می‌زند،
  // و برداشتن مادر فرزندها را برمی‌دارد (ACCESS_KEYS مادر را پیش از فرزند دارد).
  const parentOf = (key) => (key.includes(".") ? key.split(".")[0] : ACCESS_TABS.find((t) => t.id === key)?.sub);
  const prune = (n) => {
    ACCESS_KEYS.forEach((k) => { const p = parentOf(k); if (p && !n.has(p)) n.delete(k); });
    if (me) n.add("users");
    return n;
  };
  const addWithParents = (n, key) => { for (let k = key; k; k = parentOf(k)) n.add(k); };
  const toggle = (id, on) => setAccess((prev) => {
    const n = new Set(prev);
    if (on) {
      const fresh = !id.includes(".") && !n.has(id);
      addWithParents(n, id);
      // سربرگی که تازه داده می‌شود، کارهای پیش‌فرضِ نقش را هم می‌گیرد؛ بعد می‌شود تک‌تک برداشت.
      if (fresh) roleDefaults(role, [id]).filter((k) => k.includes(".")).forEach((k) => n.add(k));
    } else {
      n.delete(id);
    }
    return prune(n);
  });
  const setGroup = (items, on) => setAccess((prev) => {
    const n = new Set(prev);
    items.forEach((t) => [t.id, ...actionsOf(t.id).map((a) => a.id)].forEach((k) => (on ? addWithParents(n, k) : n.delete(k))));
    return prune(n);
  });
  const applyList = (keys) => setAccess(prune(new Set(keys)));

  const pwValid = pw.length >= 4 && pw === pw2;
  async function resetPw() {
    const ok = await askConfirm({
      title: `بازنشانی رمز «${user.name}»`,
      message: "رمز قبلی دیگر کار نمی‌کند. رمز تازه را به خود کاربر بدهید؛ در اولین ورود باید رمز دلخواهش را بگذارد.",
      confirmLabel: "بازنشانی رمز", danger: true,
    });
    if (ok) run(async () => { await onResetPassword(user.username, pw); setPw(""); setPw2(""); }, `رمز «${user.name}» بازنشانی شد ✓`);
  }

  async function close() {
    if (profileDirty || accessDirty) {
      const ok = await askConfirm({ title: "تغییرات ذخیره نشده", message: "تغییراتی که ذخیره نکرده‌اید از بین می‌رود.", confirmLabel: "بستن بدون ذخیره", danger: true });
      if (!ok) return;
    }
    onClose();
  }

  const others = users.filter((u) => u.username !== user.username);
  const positions = !position || POSITIONS.includes(position) ? POSITIONS : [position, ...POSITIONS];
  const panes = [["profile", `مشخصات${profileDirty ? " •" : ""}`], ["access", `سربرگ‌ها${accessDirty ? " •" : ""}`], ["password", "رمز"], ["history", "تاریخچه"]];

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="wh-dialog user-dialog" role="dialog" aria-labelledby="ud-title">
        <div className="user-dialog-hd">
          <Avatar user={user} />
          <div className="ud-name">
            <b id="ud-title">{user.name}</b>
            <small><span dir="ltr">{user.username}</span> · {ROLES[user.role]?.label}{me ? " · خودتان" : ""}</small>
          </div>
          <span className={active ? "u-status on" : "u-status off"}>{active ? "فعال" : "غیرفعال"}</span>
        </div>

        <div className="sub-tabs" role="tablist">
          {panes.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={pane === k} className={pane === k ? "sub-tab on" : "sub-tab"}
              onClick={() => { setErr(""); setPane(k); }}>{l}</button>
          ))}
        </div>

        {pane === "profile" && (
          <>
            <div className="user-photo">
              <Avatar user={user} className="lg" />
              <div className="user-photo-body">
                <b>عکس پروفایل</b>
                <small>یک عکس مربع یا نزدیک به مربع بگذارید؛ خودش به ۲۵۶×۲۵۶ کوچک می‌شود. حداکثر ۳۰۰ کیلوبایت.</small>
                <div>
                  <button className="ghost" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                    {photoBusy ? "…" : user.photo ? "عوض کردن عکس" : "گذاشتن عکس"}
                  </button>
                  {user.photo && (
                    <button className="ghost" disabled={photoBusy} style={{ marginInlineStart: 8 }} onClick={clearPhoto}>
                      برداشتن عکس
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" hidden
                    onChange={(e) => pickPhoto(e.target.files?.[0])} />
                </div>
              </div>
            </div>
            <div className="row2">
              <label className="fld"><span>نام و نام خانوادگی</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="fld"><span>نام کاربری</span><input value={user.username} disabled dir="ltr" /></label>
            </div>
            <div className="row2">
              <label className="fld"><span>نقش</span>
                <select value={role} disabled={me} title={me ? "نقش خودتان را نمی‌توانید عوض کنید" : ""} onChange={(e) => setRole(e.target.value)}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="fld"><span>سمت سازمانی</span>
                <select value={position} onChange={(e) => setPosition(e.target.value)}>
                  {!position && <option value="">—</option>}
                  {positions.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
            </div>
            <div className="muted sm2" style={{ lineHeight: 1.9 }}>
              نقش تعیین می‌کند کاربر درون صفحه‌ها چه کاری می‌تواند بکند (ثبت، تأیید)؛ اینکه چه سربرگ‌هایی ببیند با «سربرگ‌ها» است.
            </div>
            <div className="user-danger">
              <div>
                <b>{active ? "غیرفعال کردن حساب" : "فعال کردن حساب"}</b>
                <small>{me ? "حساب خودتان را نمی‌توانید غیرفعال کنید." : active ? "کاربر نمی‌تواند وارد شود؛ سوابقش می‌ماند." : "کاربر دوباره می‌تواند وارد شود."}</small>
              </div>
              <button className={active ? "confirm-danger" : "ghost"} style={{ flex: "0 0 auto" }} disabled={busy || me} onClick={toggleActive}>
                {active ? "غیرفعال کن" : "فعال کن"}
              </button>
            </div>
          </>
        )}

        {pane === "access" && (
          <>
            <div className="access-tools">
              <select value="" aria-label="کپی سربرگ‌ها از کاربر دیگر"
                onChange={(e) => { const o = others.find((u) => u.username === e.target.value); if (o) applyList(o.access || []); }}>
                <option value="">کپی سربرگ‌ها از کاربر دیگر…</option>
                {others.map((o) => <option key={o.username} value={o.username}>{o.name} ({faDigits((o.access || []).length)} سربرگ)</option>)}
              </select>
              <button className="ghost" onClick={() => applyList(roleDefaults(role))}>
                پیش‌فرض نقش «{ROLES[role]?.label}»
              </button>
            </div>
            <div className="muted sm2" style={{ lineHeight: 1.9 }}>
              تیک سربرگ یعنی آن را می‌بیند؛ تیک‌های زیرش کارهایی است که درون همان سربرگ می‌تواند بکند.
              تا «ذخیرهٔ سربرگ‌ها» را نزنید چیزی اعمال نمی‌شود.
            </div>
            {accessGroups().map((g) => {
              const keys = g.items.flatMap((t) => [t.id, ...actionsOf(t.id).map((a) => a.id)]);
              return (
                <fieldset className="access-group" key={g.label}>
                  <legend className="access-group-hd">
                    <span>{g.label}</span>
                    <span className="access-group-actions">
                      <button type="button" className="link-btn" disabled={keys.every((k) => access.has(k))} onClick={() => setGroup(g.items, true)}>همه</button>
                      <button type="button" className="link-btn" disabled={keys.every((k) => !access.has(k) || (me && k === "users"))} onClick={() => setGroup(g.items, false)}>هیچ</button>
                    </span>
                  </legend>
                  <div className="access-tabs">
                    {g.items.map((t) => {
                      const lock = me && t.id === "users";
                      const acts = actionsOf(t.id);
                      const on = access.has(t.id);
                      return (
                        <div key={t.id} className={`access-tab${t.sub ? " sub" : ""}${on ? " on" : ""}`}>
                          <label className="access-item" title={lock ? "دسترسی «کاربران» را از خودتان نمی‌توانید بردارید" : ""}>
                            <input type="checkbox" checked={on} disabled={lock} onChange={(e) => toggle(t.id, e.target.checked)} />
                            {!t.sub && <Icon name={t.id} size={15} />}
                            <span>{t.sub ? `› ${tabName(t.id)}` : t.label}</span>
                            {acts.length > 0 && (
                              <small className="access-count">{faDigits(acts.filter((a) => access.has(a.id)).length)} از {faDigits(acts.length)}</small>
                            )}
                          </label>
                          {acts.length > 0 && (
                            <div className="access-actions">
                              {acts.map((a) => (
                                <label key={a.id} className="access-item action">
                                  <input type="checkbox" checked={access.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                                  <span>{a.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </>
        )}

        {pane === "password" && (me ? (
          <div className="notice warn">رمز خودتان را از این‌جا نمی‌توانید بازنشانی کنید.</div>
        ) : (
          <>
            <div className="muted sm2" style={{ lineHeight: 1.9 }}>
              وقتی کاربری رمزش را فراموش کرده، یک رمز موقت بگذارید و به خودش بدهید؛ در اولین ورود باید رمز دلخواهش را بگذارد.
              {user.mustChangePassword && " این کاربر هنوز رمز موقت قبلی‌اش را عوض نکرده."}
            </div>
            <div className="row2">
              <label className="fld"><span>رمز تازه</span>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="حداقل ۴ نویسه" />
              </label>
              <label className="fld"><span>تکرار رمز تازه</span>
                <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </label>
            </div>
            {pw2 && pw !== pw2 && <div className="err">دو رمز یکی نیستند.</div>}
          </>
        ))}

        {pane === "history" && (
          <>
            <div className="muted sm2" style={{ marginBottom: 6 }}>
              آخرین ورود: {user.lastLogin ? faDateTime(user.lastLogin) : "هنوز وارد نشده"}
            </div>
            {history === null ? <div className="muted sm2">در حال خواندن…</div>
              : history.length === 0 ? <div className="empty">هنوز تغییری برای این کاربر ثبت نشده.</div>
              : <ul className="audit-list">{history.map((e) => <AuditRow key={e.id} e={e} />)}</ul>}
          </>
        )}

        {err && <div className="err" role="alert">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={close} disabled={busy}>بستن</button>
          {pane === "profile" && <button className="submit" disabled={!profileDirty || !name.trim() || busy} onClick={saveProfile}>ذخیرهٔ مشخصات</button>}
          {pane === "access" && <button className="submit" disabled={!accessDirty || busy} onClick={saveAccess}>ذخیرهٔ سربرگ‌ها</button>}
          {pane === "password" && !me && <button className="submit" disabled={!pwValid || busy} onClick={resetPw}>بازنشانی رمز</button>}
        </div>
      </div>
    </div>
  );
}
