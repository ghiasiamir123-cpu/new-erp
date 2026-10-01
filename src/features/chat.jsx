import { useState, useEffect, useRef, useCallback } from "react";
import { chatApi } from "../api.js";
import { Avatar, WhyOff, faDigits, jShort } from "../shared/core.jsx";

/* ============ گفتگوی درون‌سازمانی ============ */
// دو ستون: فهرست گفتگوها در سمت راست، پنجرهٔ چت در سمت چپ. هر ۵ ثانیه پیام‌های تازه گرفته می‌شود.
export function ChatView({ session, onUnread }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(null);   // "direct" یا "group"
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    try {
      const d = await chatApi.list();
      setList(d.results || []);
      if (typeof onUnread === "function") onUnread(d.unread || 0);
      setErr("");
    } catch (e) { setErr(e.message); }
  }, [onUnread]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [reload]);

  const opened = list?.find((c) => c.id === openId) || null;

  return (
    <div className="chat-shell">
      <aside className="chat-side">
        <div className="chat-side-hd">
          <b>گفتگوها</b>
          <div className="btn-row" style={{ margin: 0, gap: 6 }}>
            <button className="ghost" style={{ flex: "0 0 auto", padding: "6px 10px" }}
              onClick={() => setCreating("direct")}>+ دونفره</button>
            <button className="ghost" style={{ flex: "0 0 auto", padding: "6px 10px" }}
              onClick={() => setCreating("group")}>+ گروه</button>
          </div>
        </div>
        {err && <div className="notice warn">{err}</div>}
        {list === null ? <div className="empty">…</div>
          : list.length === 0 ? <div className="empty">هنوز گفتگویی نداری. با یکی شروع کن.</div> : (
          <ul className="chat-list">
            {list.map((c) => (
              <li key={c.id}>
                <button className={c.id === openId ? "chat-item on" : "chat-item"} onClick={() => setOpenId(c.id)}>
                  <Avatar user={c.kind === "direct" ? c.other : { name: c.title }} className="sm" />
                  <div className="chat-item-body">
                    <div className="chat-item-hd">
                      <b>{c.title}</b>
                      {c.countdown && <CountChip c={c.countdown} />}
                      {c.lastMessageAt && <small>{shortWhen(c.lastMessageAt)}</small>}
                    </div>
                    <div className="chat-item-sub">
                      <span>{c.lastMessage || (c.kind === "group" ? `${faDigits(c.members?.length || 0)} عضو` : " ")}</span>
                      {c.unread > 0 && <span className="sb-badge hot">{faDigits(c.unread)}</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="chat-pane">
        {opened ? <ChatConversation key={opened.id} conv={opened} session={session} onChanged={reload} />
          : <div className="empty">یک گفتگو را انتخاب کنید یا تازه شروع کنید.</div>}
      </section>

      {creating === "direct" && <NewDirectDialog onClose={() => setCreating(null)}
        onDone={(id) => { setCreating(null); reload(); setOpenId(id); }} />}
      {creating === "group" && <NewGroupDialog onClose={() => setCreating(null)}
        onDone={(id) => { setCreating(null); reload(); setOpenId(id); }} />}
    </div>
  );
}
/** روزشمار تحویل، کنار نام گروهِ پروژه در فهرست گفتگوها. */
function CountChip({ c }) {
  if (c.late) return <span className="chat-count late">{faDigits(-c.days)} روز عقب</span>;
  if (c.days === 0) return <span className="chat-count late">امروز تحویل</span>;
  return <span className={c.soon ? "chat-count soon" : "chat-count"}>{faDigits(c.days)} روز</span>;
}

function shortWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return faDigits(d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }));
  }
  return jShort(d.toISOString().slice(0, 10));
}

function ChatConversation({ conv, session, onChanged }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const lastId = useRef(0);

  const load = useCallback(async (fresh) => {
    try {
      const d = await chatApi.messages(conv.id, fresh ? undefined : lastId.current);
      setMessages((p) => {
        const base = fresh ? [] : (p || []);
        const seen = new Set(base.map((m) => m.id));
        const merged = [...base, ...d.results.filter((m) => !seen.has(m.id))];
        lastId.current = merged.length ? Number(merged[merged.length - 1].id) : lastId.current;
        return merged;
      });
      try { await chatApi.read(conv.id); } catch { /* بی‌مسئله */ }
      if (typeof onChanged === "function") onChanged();
    } catch (e) { setErr(e.message); }
  }, [conv.id, onChanged]);

  useEffect(() => {
    lastId.current = 0;
    setMessages(null);
    load(true);
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, [conv.id, load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function pickFile(f) {
    if (!f) { setFile(null); return; }
    if (f.size > 450 * 1024) { setErr("فایل بزرگ‌تر از ۴۵۰ کیلوبایت است."); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result); r.onerror = reject;
      r.readAsDataURL(f);
    });
    setFile({ name: f.name, kind: f.type.startsWith("image/") ? "image" : "file", data: dataUrl });
    setErr("");
  }
  async function send() {
    if (busy) return;
    if (!text.trim() && !file) return;
    setBusy(true); setErr("");
    try {
      await chatApi.send(conv.id, { text: text.trim(),
        attachment: file?.data || "", attachmentName: file?.name || "" });
      setText(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const groupHead = conv.kind === "group" ? conv.title : conv.other?.name || conv.other?.username || conv.title;

  return (
    <div className="chat-conv">
      <div className="chat-conv-hd">
        <Avatar user={conv.kind === "direct" ? conv.other : { name: conv.title }} />
        <div>
          <b>{groupHead}</b>
          <small>
            {conv.kind === "group"
              ? `${faDigits(conv.members?.length || 0)} عضو: ${conv.members?.map((m) => m.name).join("، ")}`
              : conv.other?.username ? <span dir="ltr">{conv.other.username}</span> : ""}
          </small>
        </div>
      </div>

      <div className="chat-msgs" ref={scrollRef}>
        {messages === null ? <div className="empty">…</div>
          : messages.length === 0 ? <div className="empty">هنوز پیامی نیست. اولین پیام را بنویسید.</div> : (
          messages.map((m) => {
            const mine = m.sender === session.username;
            return (
              <div key={m.id} className={mine ? "chat-msg mine" : "chat-msg"}>
                {!mine && <div className="chat-msg-from">{m.senderName}</div>}
                {m.attachment && m.attachmentKind === "image" && (
                  <a href={m.attachment} target="_blank" rel="noreferrer">
                    <img className="chat-msg-img" src={m.attachment} alt="" />
                  </a>
                )}
                {m.attachment && m.attachmentKind === "file" && (
                  <a href={m.attachment} download={m.attachmentName} className="chat-msg-file">
                    📎 {m.attachmentName || "فایل"}
                  </a>
                )}
                {m.text && <div className="chat-msg-text" dir="auto">{m.text}</div>}
                <small>{shortWhen(m.createdAt)}</small>
              </div>
            );
          })
        )}
      </div>

      {file && (
        <div className="chat-file-pin">
          {file.kind === "image" ? <img src={file.data} alt="" /> : <span>📎 {file.name}</span>}
          <button className="link-btn" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>حذف</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="chat-composer">
        <button className="ghost" style={{ flex: "0 0 auto", padding: "8px 12px" }}
          onClick={() => fileRef.current?.click()} title="پیوست عکس یا فایل">📎</button>
        <input ref={fileRef} type="file" hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
          onChange={(e) => pickFile(e.target.files?.[0])} />
        <textarea rows={1} placeholder="پیام…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="submit" style={{ flex: "0 0 auto", width: "auto", margin: 0, padding: "10px 18px" }}
          disabled={busy || (!text.trim() && !file)} onClick={send}>{busy ? "…" : "ارسال"}</button>
      </div>
    </div>
  );
}

function NewDirectDialog({ onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { chatApi.users().then(setUsers).catch((e) => setErr(e.message)); }, []);
  const needle = q.trim().toLowerCase();
  const shown = users.filter((u) => !needle
    || (u.name || "").toLowerCase().includes(needle) || (u.username || "").toLowerCase().includes(needle));
  async function pick(u) {
    if (busy) return;
    setBusy(true);
    try { const d = await chatApi.startDirect(u.username); onDone(d.id); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">شروع گفتگو</div>
        <input className="wh-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="نام یا نام کاربری…" />
        {err && <div className="err">{err}</div>}
        <div className="pick-list" style={{ maxHeight: 320 }}>
          {shown.length === 0 ? <div className="empty">کسی پیدا نشد.</div> : shown.map((u) => (
            <button key={u.username} className="pick-row" onClick={() => pick(u)} disabled={busy}>
              <Avatar user={u} className="sm" />
              <span className="pick-name">{u.name || u.username}</span>
              <span className="pick-sub"><span dir="ltr">{u.username}</span></span>
            </button>
          ))}
        </div>
        <div className="btn-row"><button className="ghost" onClick={onClose} disabled={busy}>بستن</button></div>
      </div>
    </div>
  );
}

function NewGroupDialog({ onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { chatApi.users().then(setUsers).catch((e) => setErr(e.message)); }, []);
  const toggle = (u) => setPicked((p) => {
    const n = new Set(p); if (n.has(u)) n.delete(u); else n.add(u); return n;
  });
  async function create() {
    if (busy || !title.trim() || picked.size < 1) return;
    setBusy(true); setErr("");
    try { const d = await chatApi.startGroup(title.trim(), [...picked]); onDone(d.id); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">گروه تازه</div>
        <label className="fld"><span>عنوان گروه</span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: مالی و انبار" />
        </label>
        <div className="items-hd">عضوها ({faDigits(picked.size)} انتخاب‌شده)</div>
        {err && <div className="err">{err}</div>}
        <div className="pick-list" style={{ maxHeight: 260 }}>
          {users.map((u) => (
            <label key={u.username} className={picked.has(u.username) ? "pick-row on" : "pick-row"}
              style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(u.username)}
                onChange={() => toggle(u.username)} />
              <Avatar user={u} className="sm" />
              <span className="pick-name">{u.name || u.username}</span>
            </label>
          ))}
        </div>
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>بستن</button>
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy || !title.trim() || picked.size < 1}
            onClick={create}>{busy ? "…" : "ساختن گروه"}</button>
        </div>
        <WhyOff busy={busy} reasons={[!title.trim() && "عنوان گروه نوشته نشده", picked.size < 1 && "هیچ عضوی انتخاب نشده"]} />
      </div>
    </div>
  );
}
