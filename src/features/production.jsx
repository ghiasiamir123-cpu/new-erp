import { useState, useEffect, useRef, useCallback } from "react";
import { chatApi, payrollApi, productionApi, workStagesApi, projectsApi } from "../api.js";
import { calcPayroll, hourRateOf, money, rial } from "../payroll.js";
import { J_MONTHS, faDigits, isoToJ, jShort, jToIso, pad, resetStageCache, round2, saveSheet, todayIso, useCan, useWorkStages } from "../shared/core.jsx";

/* ============ تولید ============ */
// وضعیت زندهٔ هر پروژه: چقدر برنامه، چقدر انجام شده، چقدر مانده. دادهٔ همان گزارش‌های
// روزانه است — چیزی جدا ثبت نمی‌شود.
// دلیل بستن — بی این، پروژه‌ای که برنامه‌اش هرگز وارد نشده «۱۰۰٪ تکمیل» به نظر می‌رسد.
const CLOSE_REASONS = [
  { id: "completed", label: "کار تکمیل شد",
    hint: "همهٔ متراژ برنامه انجام شده. فقط وقتی می‌شود که برنامه وارد شده باشد." },
  { id: "short", label: "با کسری بسته شد",
    hint: "کار تمام شده ولی کمتر از برنامه — مثلاً مشتری مقداری را حذف کرده." },
  { id: "incomplete_data", label: "دادهٔ ناقص — بسته شد",
    hint: "کار انجام شده ولی گزارش‌هایش کامل ثبت نشده. برای پروژه‌های قدیمی." },
];

const PROD_STATES = {
  nosetup: { label: "متراژ ندارد", cls: "bad" },
  notstarted: { label: "شروع نشده", cls: "idle" },
  running: { label: "در جریان", cls: "run" },
  finished: { label: "متراژ کامل شد", cls: "ok" },
  closed: { label: "بسته شد", cls: "done" },
  service: { label: "خدماتی", cls: "idle" },
  // «غیرفعال» یعنی در فهرست انتخابِ فرم گزارش نمی‌آید — با «بسته شد» فرق دارد.
  archived: { label: "غیرفعال", cls: "idle" },
};

const PROD_PANES = [
  { id: "board", label: "وضعیت پروژه‌ها" },
  { id: "plan", label: "پیش‌بینی و ظرفیت" },
  { id: "people", label: "عملکرد کارگاه و پرسنل" },
  { id: "general", label: "کارهای عمومی کارگاه" },
  { id: "stages", label: "مراحل و ضریب‌ها" },
  { id: "pricing", label: "قیمت‌گذاری", key: "production.pricing" },
];

export function ProductionView() {
  const can = useCan();
  const [pane, setPane] = useState("board");
  const panes = PROD_PANES.filter((p) => !p.key || can(p.key));
  return (
    <>
      <div className="sub-tabs no-print">
        {panes.map((p) => (
          <button key={p.id} className={pane === p.id ? "sub-tab on" : "sub-tab"}
            onClick={() => setPane(p.id)}>{p.label}</button>
        ))}
      </div>
      {pane === "board" && <ProdBoard />}
      {pane === "plan" && <ProdPlan />}
      {pane === "people" && <ProdPeople />}
      {pane === "general" && <ProdGeneral />}
      {pane === "stages" && <ProdStages />}
      {pane === "pricing" && can("production.pricing") && <ProdPricing />}
    </>
  );
}

function ProdBoard() {
  const can = useCan();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [groupBusy, setGroupBusy] = useState("");
  const [closing, setClosing] = useState(null);   // ردیفی که دارد بسته می‌شود
  const [reopenBusy, setReopenBusy] = useState("");
  const [picked, setPicked] = useState(new Set());  // برای بستن گروهی
  const [bulk, setBulk] = useState(false);

  const reload = useCallback(async () => {
    try { setData(await productionApi.board()); setErr(""); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload]);

  // گروه گفتگوی پروژه: اگر هست بازش می‌کند، وگرنه می‌سازد و پیام افتتاحیه می‌فرستد.
  async function openGroup(row) {
    if (groupBusy) return;
    setGroupBusy(row.id);
    try {
      const conv = await chatApi.projectGroup(row.id);
      window.location.hash = "#chat";
      if (conv.created) alert(`گروه «${conv.title}» ساخته شد.`);
    } catch (e) { alert(e.message); } finally { setGroupBusy(""); }
  }

  async function reopen(row) {
    if (reopenBusy) return;
    if (!window.confirm(`پروژهٔ «${row.name}» دوباره باز شود؟`)) return;
    setReopenBusy(row.id);
    try { await productionApi.reopen(row.id); await reload(); }
    catch (e) { alert(e.message); } finally { setReopenBusy(""); }
  }

  // برنامه را برابر کارِ ثبت‌شده می‌گذارد — برای پروژهٔ قدیمی که برنامه‌اش وارد نشده.
  async function planFromWork(row) {
    if (!window.confirm(
      `متراژ برنامهٔ «${row.name}» برابر ${faDigits(round2(row.done))} م² کارِ ثبت‌شده شود؟`)) return;
    try { await productionApi.planFromWork(row.id); setClosing(null); await reload(); }
    catch (e) { alert(e.message); }
  }

  const togglePick = (id) => setPicked((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  if (err) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;

  const t = data.totals;
  const needSetup = data.results.filter((r) => r.state === "nosetup");
  const withIssues = data.results.filter((r) => r.issues.length && r.state !== "nosetup");
  // پروژهٔ بسته پیش‌فرض پنهان است؛ صفحه دربارهٔ کارِ در جریان است.
  const shown = showClosed ? data.results : data.results.filter((r) => r.state !== "closed");

  return (
    <>
      {/* عددهای اصلی متراژ چوب‌اند — اندازهٔ واقعی کارها. متراژ کار (جمع پاس‌ها) زیرشان
          می‌آید، چون زمان و ظرفیت به آن بستگی دارد نه به اندازهٔ چوب. */}
      <div className="prod-tiles">
        <Tile label="متراژ پروژه‌ها" value={`${faDigits(round2(t.baseArea))} م²`}
          sub={`${faDigits(round2(t.planned))} م² کار`} />
        <Tile label="انجام شده" value={`${faDigits(round2(t.baseDone))} م²`} tone="ok"
          sub={`${faDigits(round2(t.done))} م² کار`} />
        <Tile label="باقیمانده" value={`${faDigits(round2(t.baseRemaining))} م²`} tone="run"
          sub={`${faDigits(round2(t.remaining))} م² کار`} />
        <Tile label="پروژه‌ها"
          value={t.closed ? `${faDigits(t.projects - t.closed)} باز · ${faDigits(t.closed)} بسته`
                          : faDigits(t.projects)}
          sub={t.baseArea > 0 ? `هر متر چوب ${faDigits(round2(t.planned / t.baseArea))} متر کار` : ""} />
      </div>
      {/* مبالغ فقط وقتی سرور فرستاده باشد — یعنی کاربر کلید قیمت‌گذاری دارد. */}
      {t.price > 0 && (
        <div className="prod-tiles">
          <Tile label="مبلغ قراردادها" value={rial(t.price)}
            sub={`${faDigits(t.priced)} پروژه مبلغ دارد`} />
          <Tile label="کسب‌شده" value={rial(t.earned)} tone="ok"
            sub={`${faDigits(round2(t.earned / t.price * 100))}٪ از کل`} />
          <Tile label="هنوز کسب‌نشده" value={rial(t.unearned)} tone="run"
            sub="پروژه‌های باز" />
        </div>
      )}

      {needSetup.length > 0 && (
        <div className="notice warn">
          <b>{faDigits(needSetup.length)} پروژه متراژ ندارد.</b> تا مراحل و متراژشان وارد نشود،
          نمی‌شود گفت چقدر پیش رفته‌اند و چقدر مانده. در صفحهٔ «پروژه‌ها» وارد کنید — یا اگر
          کار خدماتی‌اند، تیک «بدون متراژ» را بزنید.
          <div className="chip-row">
            {needSetup.map((r) => <span className="chip bad" key={r.id}>{r.name}</span>)}
          </div>
        </div>
      )}
      {withIssues.length > 0 && (
        <div className="notice warn">
          <b>{faDigits(withIssues.length)} پروژه مغایرت دارد.</b> بیش از برنامه ثبت شده یا
          مرحله‌ای خارج از برنامهٔ پروژه کار خورده.
        </div>
      )}

      <div className="board-h" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ flex: 1 }}>وضعیت پروژه‌ها</span>
        {can("projects.manage") && (
          <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
            onClick={() => { setBulk(!bulk); setPicked(new Set()); }}>
            {bulk ? "لغو انتخاب گروهی" : "بستن گروهی"}
          </button>
        )}
        {t.closed > 0 && (
          <label className="chk-line" style={{ margin: 0 }}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            <span>بسته‌شده‌ها ({faDigits(t.closed)})</span>
          </label>
        )}
      </div>

      {bulk && (
        <div className="bulk-bar">
          <span>{faDigits(picked.size)} پروژه انتخاب شده</span>
          <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
            onClick={() => setPicked(new Set(shown.filter((r) => r.state !== "closed"
              && r.state !== "service").map((r) => r.id)))}>همه</button>
          <button className="submit submit-warn" style={{ width: "auto", margin: 0, padding: "7px 16px" }}
            disabled={picked.size === 0} onClick={() => setClosing({ bulkIds: [...picked] })}>
            بستن {faDigits(picked.size)} پروژه
          </button>
        </div>
      )}

      {shown.length === 0 ? <div className="empty">پروژه‌ای نیست.</div> : shown.map((r) => {
        const st = PROD_STATES[r.state] || PROD_STATES.idle;
        const isClosed = r.state === "closed";
        return (
          <div className={isClosed ? "card closed" : "card"} key={r.id}>
            <div className="prod-hd">
              {bulk && r.state !== "closed" && r.state !== "service" && (
                <input type="checkbox" checked={picked.has(r.id)}
                  onChange={() => togglePick(r.id)} style={{ flex: "0 0 auto" }} />
              )}
              <div className="prod-name">
                <b>{r.name}</b>
                {r.code ? <span className="proj-code">{r.code}</span> : null}
                <span className={`pill ${st.cls}`}>{st.label}</span>
              </div>
              {!isClosed && <Countdown due={r.dueDate} done={r.state === "finished"} />}
              {can("chat") && r.state !== "service" && (
                <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                  disabled={groupBusy === r.id} onClick={() => openGroup(r)}>
                  {groupBusy === r.id ? "…" : "گروه گفتگو"}
                </button>
              )}
              {can("projects.manage") && r.state !== "service" && (isClosed ? (
                <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                  disabled={reopenBusy === r.id} onClick={() => reopen(r)}>
                  {reopenBusy === r.id ? "…" : "بازکردن"}
                </button>
              ) : (
                <button className="ghost" style={{ flex: "0 0 auto", padding: "5px 10px" }}
                  onClick={() => setClosing(r)}>بستن پروژه</button>
              ))}
            </div>

            {isClosed && (
              <div className="close-note">
                بسته شد در {jShort(r.closedAt)}
                {r.closedBy ? ` توسط ${r.closedBy}` : ""}
                {r.closeReasonLabel && <> · <b>{r.closeReasonLabel}</b></>}
                {r.closeReason === "short" && r.closedRemaining > 0 && (
                  <> · <span className="warn-txt">{faDigits(round2(r.closedRemaining))} م² کسری</span></>
                )}
                {r.closeReason === "incomplete_data" && (
                  <> · <span className="warn-txt">آمارش کامل نیست</span></>
                )}
                {r.closeNote && <div className="muted sm2" style={{ marginTop: 4 }}>{r.closeNote}</div>}
              </div>
            )}

            {r.planned > 0 && (
              <>
                <div className="bar-row">
                  <span className="bar-lbl">پیشرفت</span>
                  <div className="bar"><div style={{ width: Math.min(r.percent, 100) + "%" }} /></div>
                  <span className="bar-v">{faDigits(r.percent)}٪</span>
                </div>
                <div className="muted sm2">
                  {r.baseArea > 0
                    ? <>{faDigits(round2(r.baseDone))} از {faDigits(round2(r.baseArea))} م² چوب ·
                        باقیمانده {faDigits(round2(r.baseRemaining))} م²</>
                    : <>{faDigits(round2(r.done))} از {faDigits(round2(r.planned))} م² کار ·
                        باقیمانده {faDigits(round2(r.remaining))} م²</>}
                  {r.pending > 0 && <> · <span className="warn-txt">{faDigits(round2(r.pending))} م² در انتظار تأیید</span></>}
                </div>
                {r.baseArea > 0 && (
                  <div className="muted sm2">
                    متراژ کار: {faDigits(round2(r.done))} از {faDigits(round2(r.planned))} م²
                    {" "}({faDigits(round2(r.planned / r.baseArea))} پاس روی هر متر چوب)
                  </div>
                )}
                {r.price > 0 && (
                  <div className="sm2" style={{ marginTop: 2 }}>
                    <span className="ok-txt">کسب‌شده {rial(r.earned)}</span>
                    {" "}از {rial(r.price)}
                    {r.unearned > 0 && <> · <span className="warn-txt">مانده {rial(r.unearned)}</span></>}
                  </div>
                )}
              </>
            )}

            {r.issues.length > 0 && (
              <ul className="prod-issues">
                {r.issues.map((i) => <li key={i}>{i}</li>)}
              </ul>
            )}

            {r.stages.length > 0 && (
              <button className="stage-toggle" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                {openId === r.id ? "بستن مراحل ▲" : `مراحل (${faDigits(r.stages.length)}) ▼`}
              </button>
            )}
            {openId === r.id && (
              <div className="prod-stages">
                {r.stages.map((s) => (
                  <div className={s.over || !s.inPlan ? "prod-stage bad" : "prod-stage"} key={s.name}>
                    <div className="prod-stage-hd">
                      <b>{s.name}</b>
                      {!s.inPlan && <span className="pill bad">خارج از برنامه</span>}
                      {s.over && <span className="pill bad">{faDigits(round2(s.overBy))} م² بیشتر</span>}
                      {s.closed && <span className="pill ok">انجام شد</span>}
                    </div>
                    <div className="bar-row">
                      <div className="bar"><div style={{ width: Math.min(s.percent, 100) + "%" }} /></div>
                      <span className="bar-v">{faDigits(s.percent)}٪</span>
                    </div>
                    <div className="muted sm2">
                      برنامه {faDigits(round2(s.planned))} · انجام {faDigits(round2(s.done))} ·
                      مانده {faDigits(round2(s.remaining))} م²
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {closing && (closing.bulkIds
        ? <BulkCloseDialog rows={data.results.filter((r) => closing.bulkIds.includes(r.id))}
            onClose={() => setClosing(null)}
            onDone={() => { setClosing(null); setBulk(false); setPicked(new Set()); reload(); }} />
        : <CloseProjectDialog row={closing} onClose={() => setClosing(null)}
            onPlanFromWork={planFromWork}
            onDone={() => { setClosing(null); reload(); }} />)}
    </>
  );
}
/** بستن چند پروژه با یک دلیل — برای جمع کردن پروژه‌های قدیمی. */
function BulkCloseDialog({ rows, onClose, onDone }) {
  // اگر حتی یکی از انتخاب‌شده‌ها برنامه نداشته باشد، «تکمیل شد» برای همه ممکن نیست.
  const anyNoPlan = rows.some((r) => !(r.planned > 0));
  const [reason, setReason] = useState(anyNoPlan ? "incomplete_data" : "short");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (busy) return;
    setBusy(true); setErr("");
    try { await productionApi.bulkClose(rows.map((r) => r.id), reason, note.trim()); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">بستن {faDigits(rows.length)} پروژه</div>

        <div className="pick-list" style={{ maxHeight: 200 }}>
          {rows.map((r) => (
            <div className="pick-row" key={r.id}>
              <span className="pick-name">{r.name}</span>
              <span className="pick-sub">
                {r.planned > 0
                  ? `${faDigits(round2(r.done))} از ${faDigits(round2(r.planned))} م²`
                  : r.done > 0 ? `${faDigits(round2(r.done))} م² بی برنامه` : "بی متراژ، بی کار"}
              </span>
            </div>
          ))}
        </div>

        {anyNoPlan && (
          <div className="notice warn">
            بعضی از اینها متراژ برنامه ندارند، پس «تکمیل شد» برایشان معنی ندارد.
            همه با یک دلیل بسته می‌شوند.
          </div>
        )}

        <div className="items-hd">چرا بسته می‌شوند؟</div>
        <div className="reason-list">
          {CLOSE_REASONS.map((r) => {
            const blocked = r.id === "completed" && anyNoPlan;
            return (
              <label key={r.id}
                className={`reason-row${reason === r.id ? " on" : ""}${blocked ? " off" : ""}`}>
                <input type="radio" name="bulkReason" disabled={blocked}
                  checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>
                  <b>{r.label}</b>
                  <small>{blocked ? "چون بعضی برنامه ندارند، ممکن نیست." : r.hint}</small>
                </span>
              </label>
            );
          })}
        </div>

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="مثلاً: پروژه‌های پیش از راه‌اندازی سامانه" />
        </label>

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className="submit submit-warn" style={{ width: "auto", margin: 0 }}
            disabled={busy} onClick={go}>
            {busy ? "…" : `بستن ${faDigits(rows.length)} پروژه`}
          </button>
        </div>
      </div>
    </div>
  );
}
/** بستن پروژه: می‌گوید چقدر مانده، دلیلش را می‌پرسد و می‌گذارد با کسری هم بسته شود. */
function CloseProjectDialog({ row, onClose, onDone, onPlanFromWork }) {
  const noPlan = !(row.planned > 0);
  const short = !noPlan && row.remaining > 0.01;
  const [reason, setReason] = useState(noPlan ? "incomplete_data" : short ? "short" : "completed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // کاری ثبت شده ولی برنامه‌ای نیست ⟵ می‌شود برنامه را از روی همین کار ساخت.
  const canPlanFromWork = noPlan && row.done > 0;

  async function go() {
    if (busy) return;
    setBusy(true); setErr("");
    try { await productionApi.close(row.id, { reason, note: note.trim() }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="doc-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wh-dialog">
        <div className="board-h">بستن پروژهٔ «{row.name}»</div>

        {noPlan ? (
          <div className="notice warn">
            این پروژه متراژ برنامه ندارد
            {row.done > 0
              ? <> ولی <b>{faDigits(round2(row.done))} م²</b> کار رویش ثبت شده.</>
              : <> و هیچ کاری هم رویش ثبت نشده.</>}
            {" "}پس نمی‌شود گفت «تکمیل شد» — فقط با دلیل «دادهٔ ناقص» بسته می‌شود.
          </div>
        ) : (
          <div className="quote-box" style={{ marginTop: 0 }}>
            <div className="quote-row">
              <span>متراژ برنامه</span><b>{faDigits(round2(row.planned))} م²</b>
            </div>
            <div className="quote-row">
              <span>انجام شده</span><b>{faDigits(round2(row.done))} م²</b>
            </div>
            <div className="quote-row main">
              <span>{short ? "کسری" : "باقیمانده"}</span>
              <b style={short ? { color: "#B02A2A" } : undefined}>
                {faDigits(round2(row.remaining))} م²
              </b>
            </div>
          </div>
        )}

        {canPlanFromWork && (
          <div className="notice">
            می‌توانید به‌جای بستن با دادهٔ ناقص، <b>برنامه را برابر همین کارِ ثبت‌شده</b> بگذارید
            تا پروژه ۱۰۰٪ و آمارش درست شود.
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="ghost" disabled={busy}
                onClick={() => onPlanFromWork(row)}>برنامه را از روی کار بساز</button>
            </div>
          </div>
        )}
        {row.pending > 0 && (
          <div className="notice warn">
            {faDigits(round2(row.pending))} م² گزارشِ تأییدنشده دارد. اگر تأیید شود، پس از بستن
            هم در آمار می‌آید ولی روی «کسری ثبت‌شده» اثر نمی‌گذارد.
          </div>
        )}

        <div className="items-hd">چرا بسته می‌شود؟</div>
        <div className="reason-list">
          {CLOSE_REASONS.map((r) => {
            const blocked = r.id === "completed" && noPlan;
            return (
              <label key={r.id}
                className={`reason-row${reason === r.id ? " on" : ""}${blocked ? " off" : ""}`}>
                <input type="radio" name="closeReason" disabled={blocked}
                  checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>
                  <b>{r.label}</b>
                  <small>{blocked ? "برای این پروژه ممکن نیست — متراژ برنامه ندارد." : r.hint}</small>
                </span>
              </label>
            );
          })}
        </div>

        <label className="fld"><span>توضیح (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="مثلاً: مشتری ۴۰ متر را حذف کرد" />
        </label>

        {err && <div className="err">{err}</div>}
        <div className="btn-row">
          <button className="ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button className={reason === "completed" ? "submit" : "submit submit-warn"}
            style={{ width: "auto", margin: 0 }} disabled={busy} onClick={go}>
            {busy ? "…" : "بستن پروژه"}
          </button>
        </div>
      </div>
    </div>
  );
}
/** پیش‌بینی: کارِ تازه چقدر طول می‌کشد، و پروژه‌های فعلی کی تمام می‌شوند. */
function ProdPlan() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [area, setArea] = useState("");
  const [quote, setQuote] = useState(null);
  const [qBusy, setQBusy] = useState(false);

  useEffect(() => {
    productionApi.forecasts().then(setData).catch((e) => setErr(e.message));
  }, []);

  async function ask() {
    const n = Number(area);
    if (!(n > 0) || qBusy) return;
    setQBusy(true);
    try { setQuote(await productionApi.quote(n)); }
    catch (e) { alert(e.message); } finally { setQBusy(false); }
  }

  if (err) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;

  const cap = data.capacity;
  const thin = !cap.days || cap.days < 5;

  return (
    <>
      <div className="prod-tiles">
        <Tile label="توان کارگاه" value={`${faDigits(cap.perDay)} م²/روز`} tone="ok" />
        <Tile label="صف کار فعلی" value={`${faDigits(round2(data.backlog))} م²`} tone="run" />
        <Tile label="نفرات" value={faDigits(cap.crewSize)} />
        <Tile label="سابقهٔ محاسبه" value={`${faDigits(cap.days)} روز کاری`} />
      </div>

      {thin && (
        <div className="notice warn">
          سابقهٔ گزارش‌ها هنوز کم است؛ پیش‌بینی‌ها تقریبی‌اند و هر چه گزارش بیشتر تأیید شود دقیق‌تر می‌شوند.
        </div>
      )}

      <div className="card">
        <div className="board-h">کار تازه چقدر وقت می‌گیرد؟</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          متراژ کارِ تازه را بزنید تا با توان امروز کارگاه و صفِ کارهای فعلی حساب شود.
        </div>
        <div className="row2">
          <label className="fld"><span>متراژ کار (م²)</span>
            <input type="number" inputMode="decimal" value={area} placeholder="مثلاً ۳۰۰"
              onChange={(e) => setArea(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
          </label>
          <div className="fld"><span>&nbsp;</span>
            <button className="submit" style={{ margin: 0 }} disabled={!(Number(area) > 0) || qBusy}
              onClick={ask}>{qBusy ? "…" : "حساب کن"}</button>
          </div>
        </div>
        {/* «سابقهٔ کم» جواب را حذف نمی‌کند، فقط کنارش هشدار می‌گذارد؛ نبودِ جواب را
            خودِ alone نشان می‌دهد (وقتی ظرفیت هنوز صفر است). */}
        {quote && (!quote.alone ? (
          <div className="notice warn">{quote.note || "هنوز سابقهٔ کافی برای پیش‌بینی نیست."}</div>
        ) : (
          <div className="quote-box">
            <div className="quote-row">
              <span>اگر فقط روی همین کار کنیم</span>
              <b>{faDigits(quote.alone.workingDays)} روز کاری</b>
              <small>تا {jShort(quote.alone.date)}</small>
            </div>
            <div className="quote-row main">
              <span>با احتساب صفِ {faDigits(round2(quote.queue))} متری کارهای فعلی</span>
              <b>{faDigits(quote.withQueue.workingDays)} روز کاری</b>
              <small>تا {jShort(quote.withQueue.date)}</small>
            </div>
            <div className="muted sm2">
              پایهٔ محاسبه: {faDigits(quote.perDay)} م² در روز، از {faDigits(quote.historyDays)} روز
              گزارشِ تأییدشده. تاریخ تقویمی با نسبت واقعی روزهای کاری
              ({faDigits(Math.round(quote.workingRatio * 100))}٪) حساب شده.
              {!quote.enoughHistory && " این سابقه هنوز کم است، پس عدد تقریبی است."}
            </div>
          </div>
        ))}
      </div>

      <div className="board-h">پروژه‌های در جریان</div>
      {data.results.length === 0 ? <div className="empty">پروژهٔ در جریانی نیست.</div>
        : data.results.map((f) => (
        <div className="card" key={f.projectId}>
          <div className="prod-hd">
            <div className="prod-name">
              <b>{f.projectName}</b>
              <span className="muted sm2">{faDigits(round2(f.remaining))} م² مانده</span>
            </div>
            {f.dueDate && (f.onTime
              ? <span className="pill ok">{faDigits(f.slackDays)} روز فرصت اضافه</span>
              : <span className="pill bad">{faDigits(Math.abs(f.slackDays))} روز دیرتر از قول</span>)}
          </div>
          {f.withQueue ? (
            <div className="muted sm2">
              پیش‌بینی پایان: <b>{jShort(f.withQueue.date)}</b> ({faDigits(f.withQueue.workingDays)} روز کاری)
              {f.dueDate && <> · تاریخ تحویل قول‌داده‌شده: {jShort(f.dueDate)}</>}
              {!f.dueDate && <> · تاریخ تحویل وارد نشده</>}
            </div>
          ) : <div className="muted sm2">{f.note}</div>}
        </div>
      ))}
    </>
  );
}
/** ماه شمسی → بازهٔ تاریخ میلادی، برای گزارش ماهانه. */
function jMonthRange(jy, jm) {
  const from = jToIso({ jy, jm, jd: 1 });
  const ny = jm === 12 ? jy + 1 : jy;
  const nm = jm === 12 ? 1 : jm + 1;
  const d = new Date(jToIso({ jy: ny, jm: nm, jd: 1 }) + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return { from, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}
/** عملکرد کارگاه و پرسنل در یک ماه. */
function ProdPeople() {
  const nowJ = isoToJ(todayIso());
  const [jy, setJy] = useState(nowJ.jy);
  const [jm, setJm] = useState(nowJ.jm);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const { from, to } = jMonthRange(jy, jm);
  useEffect(() => {
    setData(null);
    productionApi.people(from, to).then(setData).catch((e) => setErr(e.message));
  }, [from, to]);

  const step = (d) => {
    let y = jy, m = jm + d;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setJy(y); setJm(m); setErr("");
  };

  if (err) return <div className="notice warn">{err}</div>;

  const top = data?.people?.filter((p) => p.areaHours > 0) || [];
  const best = top.length ? top.reduce((a, b) => (b.scorePerHour > a.scorePerHour ? b : a)) : null;
  const maxScore = top.length ? Math.max(...top.map((p) => p.score)) : 0;

  return (
    <>
      <div className="month-nav">
        <button className="ghost" onClick={() => step(-1)}>‹ ماه قبل</button>
        <b>{J_MONTHS[jm - 1]} {faDigits(jy)}</b>
        <button className="ghost" onClick={() => step(1)}>ماه بعد ›</button>
      </div>

      {!data ? <div className="empty">…</div> : (
        <>
          <div className="prod-tiles">
            <Tile label="متراژ ماه" value={`${faDigits(round2(data.totalArea))} م²`} tone="ok" />
            <Tile label="روز کاری" value={faDigits(data.days)} />
            <Tile label="میانگین روزانه"
              value={`${faDigits(data.days ? round2(data.totalArea / data.days) : 0)} م²`} tone="run" />
            <Tile label="نفرات فعال" value={faDigits(data.people.length)} />
          </div>

          {best && (
            <div className="notice">
              بهترین عملکرد این ماه: <b>{best.name}</b> با امتیاز ساعتی {faDigits(best.scorePerHour)}
              {" "}— سرعت {faDigits(round2(best.efficiency))} برابرِ متوسط کارگاه روی همان کارها.
            </div>
          )}
          {data.unattributed > 0 && (
            <div className="notice warn">
              {faDigits(round2(data.unattributed))} م² به هیچ نفری نچسبید — آن روز کسی با همان
              فعالیت روی همان پروژه ثبت نشده بود. برای اینکه عملکرد کامل باشد، فعالیت هر نفر
              باید با مرحله‌ای که متراژش ثبت می‌شود یکی باشد.
            </div>
          )}

          <div className="board-h">متراژ هر نفر</div>
          {data.people.length === 0 ? <div className="empty">این ماه گزارشی نیست.</div> : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>نفر</th><th>امتیاز</th><th>سهم</th><th>امتیاز ساعتی</th>
                    <th>سرعت نسبی</th><th>متراژ</th><th>ساعت متراژی</th><th>ساعت سایر</th>
                    <th>متر/ساعت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td><b>{faDigits(round2(p.score))}</b></td>
                      <td style={{ minWidth: 80 }}>
                        <div className="bar sm">
                          <div style={{ width: (maxScore ? (p.score / maxScore) * 100 : 0) + "%" }} />
                        </div>
                      </td>
                      <td><b>{p.areaHours ? faDigits(p.scorePerHour) : "—"}</b></td>
                      <td className={p.efficiency >= 1 ? "ok-txt" : p.efficiency ? "warn-txt" : "muted"}>
                        {p.areaHours ? `${faDigits(round2(p.efficiency))}×` : "—"}
                      </td>
                      <td>{faDigits(round2(p.area))}</td>
                      <td>{faDigits(p.areaHours)}</td>
                      <td className="muted">{faDigits(p.otherHours)}</td>
                      <td className="muted">{p.areaHours ? faDigits(p.perHour) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted sm2" style={{ marginTop: 8, lineHeight: 2 }}>
                <b>امتیاز</b> = متراژ × اهمیت مرحله × ساعتی که کارگاه به‌طور متوسط برای هر متر
                همان مرحله صرف می‌کند.<br />
                <b>امتیاز ساعتی</b> = اهمیتِ کار × سرعت نسبی. سختیِ مرحله در آن حذف شده: کسی که
                پرداخت می‌کند (کُند) دیگر از رنگ‌کار (تند) عقب‌تر دیده نمی‌شود، که در «متر/ساعت»
                سه برابر عقب‌تر به نظر می‌رسید.<br />
                <b>سرعت نسبی</b> بالای ۱ یعنی سریع‌تر از متوسطِ کارگاه روی همان کارها.
                ساعتِ «سایر» در هیچ‌کدام نمی‌آید.
              </div>
            </div>
          )}

          {Object.keys(data.byStage || {}).length > 0 && (
            <>
              <div className="board-h">متراژ به تفکیک مرحله</div>
              <div className="card">
                {Object.entries(data.byStage).map(([name, v]) => (
                  <div className="bar-row" key={name}>
                    <span className="bar-lbl">{name}</span>
                    <div className="bar">
                      <div style={{ width: (data.totalArea ? (v / data.totalArea) * 100 : 0) + "%" }} />
                    </div>
                    <span className="bar-v">{faDigits(round2(v))} م²</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
/** کارهای عمومی کارگاه: نظافت، تعمیر، آموزش — نه پروژه، نه متراژ، ولی وقتِ واقعی. */
function ProdGeneral() {
  const can = useCan();
  const nowJ = isoToJ(todayIso());
  const [jy, setJy] = useState(nowJ.jy);
  const [jm, setJm] = useState(nowJ.jm);
  const [all, setAll] = useState(false);       // همهٔ دوره‌ها، نه فقط یک ماه
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [moving, setMoving] = useState("");

  const { from, to } = jMonthRange(jy, jm);
  const reload = useCallback(async () => {
    setData(null);
    try { setData(await productionApi.generalWork(all ? "" : from, all ? "" : to)); setErr(""); }
    catch (e) { setErr(e.message); }
  }, [from, to, all]);
  useEffect(() => { reload(); }, [reload]);

  const step = (d) => {
    let y = jy, m = jm + d;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setJy(y); setJm(m); setErr("");
  };

  // برگرداندن به فهرست پروژه‌ها — راهِ بازگشت، تا چیزی اینجا گیر نیفتد.
  async function backToProjects(kind) {
    if (moving) return;
    if (!window.confirm(`«${kind.name}» به فهرست پروژه‌ها برگردد؟`)) return;
    setMoving(kind.id);
    try { await projectsApi.update(kind.id, { general: false }); await reload(); }
    catch (e) { alert(e.message); } finally { setMoving(""); }
  }

  if (err) return <div className="notice warn">{err}</div>;

  const maxPerson = data?.byPerson?.length ? Math.max(...data.byPerson.map((k) => k.hours)) : 0;

  return (
    <>
      <div className="notice">
        اینها پروژه نیستند و در هیچ محاسبهٔ پروژه‌ای (متراژ، پیش‌بینی، صف کار) نمی‌آیند —
        ولی وقتِ واقعی کارگاه‌اند. فعلاً دسته‌بندی نمی‌کنیم؛ هر کس موقع ثبت گزارش در
        <b> ستون «شرح» </b> می‌نویسد چه کرده و همان اینجا دیده می‌شود.
      </div>

      <div className="month-nav">
        <button className="ghost" disabled={all} onClick={() => step(-1)}>‹ ماه قبل</button>
        <b>{all ? "همهٔ دوره‌ها" : `${J_MONTHS[jm - 1]} ${faDigits(jy)}`}</b>
        <button className="ghost" disabled={all} onClick={() => step(1)}>ماه بعد ›</button>
      </div>
      <label className="chk-line" style={{ justifyContent: "center" }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        <span>از ابتدا تا امروز</span>
      </label>

      {!data ? <div className="empty">…</div> : (
        <>
          <div className="prod-tiles">
            <Tile label="ساعت کار عمومی" value={`${faDigits(round2(data.totalHours))} ساعت`} tone="run" />
            <Tile label="ساعت کار پروژه‌ای" value={`${faDigits(round2(data.projectHours))} ساعت`} tone="ok" />
            <Tile label="سهم از کل وقت" value={`${faDigits(data.share)}٪`} />
            <Tile label="روزهای درگیر" value={faDigits(data.days)} />
          </div>

          {data.kinds.length === 0 ? (
            <div className="empty">
              هنوز هیچ کارِ عمومی‌ای تعریف نشده. در صفحهٔ «پروژه‌ها» یکی بسازید و تیک
              «کار عمومی کارگاه» را بزنید.
            </div>
          ) : (
            <>
              <div className="board-h">چه کارهایی انجام شده</div>
              {data.noDesc > 0 && (
                <div className="notice warn">
                  {faDigits(data.noDesc)} ردیف بدون شرح ثبت شده، پس معلوم نیست آن ساعت‌ها صرف
                  چه شده. موقع ثبت گزارش، ستون «شرح» را پر کنید.
                </div>
              )}
              <div className="card" style={{ overflowX: "auto" }}>
                {data.entries.length === 0 ? <div className="muted sm2">این بازه ساعتی ثبت نشده.</div> : (
                  <table className="mini-table">
                    <thead>
                      <tr><th>تاریخ</th><th>نفر</th><th>ساعت</th><th>شرح کار</th></tr>
                    </thead>
                    <tbody>
                      {data.entries.map((e, i) => (
                        <tr key={i}>
                          <td>{jShort(e.date)}</td>
                          <td>{e.person}</td>
                          <td>{faDigits(round2(e.hours))}</td>
                          <td style={{ whiteSpace: "normal", minWidth: 200 }}>
                            {e.desc || <span className="muted">— شرحی نوشته نشده —</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="board-h">به تفکیک نفر</div>
              <div className="card">
                {data.byPerson.length === 0 ? <div className="muted sm2">این بازه ساعتی ثبت نشده.</div>
                  : data.byPerson.map((k) => (
                  <div className="bar-row" key={k.name}>
                    <span className="bar-lbl">{k.name}</span>
                    <div className="bar">
                      <div style={{ width: (maxPerson ? (k.hours / maxPerson) * 100 : 0) + "%" }} />
                    </div>
                    <span className="bar-v">{faDigits(round2(k.hours))} ساعت</span>
                  </div>
                ))}
              </div>

              {can("projects.manage") && (
                <>
                  <div className="board-h">تنظیم</div>
                  <div className="card">
                    <div className="muted sm2" style={{ marginBottom: 8 }}>
                      چیزهایی که به‌جای پروژه، کارِ عمومی حساب می‌شوند. با ↩ هر کدام به
                      فهرست پروژه‌ها برمی‌گردد.
                    </div>
                    <div className="chip-row">
                      {data.kinds.map((k) => (
                        <span className={k.active ? "chip" : "chip bad"} key={k.id}>
                          {k.name}{k.active ? "" : " (غیرفعال)"}
                          <button className="chip-x" disabled={moving === k.id}
                            title="برگرداندن به فهرست پروژه‌ها"
                            onClick={() => backToProjects(k)}>↩</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
// نام برای تطبیق کارگرِ گزارش با پرسنل حقوق: ی/ک عربی و نیم‌فاصله یکسان می‌شوند.
const normName = (s) => String(s || "").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
  .replace(/‌/g, " ").split(/\s+/).filter(Boolean).join(" ");
/** هزینهٔ هر ساعتِ هر کارگر. هر کس نرخ خودش را دارد؛ میانگین کارگاه فقط برای بی‌نرخ‌ها. */
function WorkerRates({ payByName, onSaved, onLoaded }) {
  const [workers, setWorkers] = useState(null);
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;

  const load = useCallback(async () => {
    try {
      const d = await productionApi.labourRates();
      setWorkers(d.workers || []); setEdit({});
      loadedRef.current?.(d.workers || []);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err && !workers) return <div className="notice warn">{err}</div>;
  if (!workers) return null;

  const valOf = (w) => (edit[w.id] !== undefined ? edit[w.id] : (w.hourlyCost ? String(w.hourlyCost) : ""));
  const changed = workers.filter((w) => edit[w.id] !== undefined
    && (money(edit[w.id]) || null) !== (w.hourlyCost || null));
  // اول نام کامل؛ وگرنه اگر یک نام ادامهٔ دیگری باشد («محمد جعفری» ↔ «محمد جعفری شاهدانی»)
  // و فقط یک نفر این‌طور جور شود.
  const suggest = (w) => {
    if (!payByName) return 0;
    const n = normName(w.name);
    if (payByName[n]) return payByName[n];
    const hits = Object.keys(payByName).filter((k) => k.startsWith(n + " ") || n.startsWith(k + " "));
    return hits.length === 1 ? payByName[hits[0]] : 0;
  };
  const fillable = workers.filter((w) => !money(valOf(w)) && suggest(w) > 0);
  const withHours = workers.filter((w) => w.projectHours > 0);
  const shown = showAll ? workers : withHours;
  const rated = withHours.filter((w) => w.hourlyCost > 0);
  const ratedHours = rated.reduce((a, w) => a + w.projectHours, 0);
  const allHours = withHours.reduce((a, w) => a + w.projectHours, 0);

  async function save() {
    if (busy || !changed.length) return;
    setBusy(true); setErr("");
    try {
      await productionApi.saveLabourRates(changed.map((w) => ({
        id: w.id, hourlyCost: money(edit[w.id]) || null })));
      await load();
      setOkMsg("ذخیره شد ✓"); setTimeout(() => setOkMsg(""), 2500);
      onSaved?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="board-h">هزینهٔ هر ساعتِ هر کارگر</div>
      <div className="muted sm2" style={{ marginBottom: 8, lineHeight: 1.9 }}>
        دستمزدِ هر مرحله با نرخ همان کسانی حساب می‌شود که واقعاً آن مرحله را کار کرده‌اند؛ پس
        مرحله‌ای که بیشتر دست کارگر کم‌هزینه‌تر است، ارزان‌تر درمی‌آید.
        کارگرِ بی‌نرخ با «میانگین کارگاه» بالا حساب می‌شود.
        {allHours > 0 && <> الان <b>{faDigits(Math.round(ratedHours / allHours * 100))}٪</b> از ساعت‌های
          کار پروژه‌ای نرخ دارد.</>}
      </div>
      {shown.length === 0 && (
        <div className="empty">
          {workers.length ? "هنوز کسی ساعت کار پروژه‌ای ندارد." : "فهرست کارگرها خالی است."}
        </div>
      )}
      {shown.length > 0 && <table className="mini-table">
        <thead>
          <tr><th>کارگر</th><th>ساعت کار پروژه‌ای</th><th>هزینهٔ هر ساعت (ریال)</th>
            {payByName && <th>از حقوق</th>}</tr>
        </thead>
        <tbody>
          {shown.map((w) => {
            const v = valOf(w);
            const sg = suggest(w);
            return (
              <tr key={w.id}>
                <td>{w.name}{!w.active && <span className="muted"> (غیرفعال)</span>}</td>
                <td>{faDigits(round2(w.projectHours))}</td>
                <td>
                  <input className="rate-in" inputMode="numeric" value={v ? rial(money(v)) : ""}
                    placeholder="میانگین کارگاه"
                    onChange={(e) => setEdit((p) => ({ ...p, [w.id]: e.target.value }))} />
                </td>
                {payByName && (
                  <td>
                    {sg > 0 ? (
                      <>
                        <span className="muted">{rial(sg)}</span>
                        {money(v) !== sg && (
                          <button className="link-btn" style={{ marginInlineStart: 6 }}
                            onClick={() => setEdit((p) => ({ ...p, [w.id]: String(sg) }))}>بگذار</button>
                        )}
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>}
      <div className="btn-row" style={{ flexWrap: "wrap", alignItems: "center" }}>
        {workers.length > withHours.length && (
          <button className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? "فقط کسانی که کار پروژه‌ای دارند" : `همهٔ کارگرها (${faDigits(workers.length)})`}
          </button>
        )}
        {fillable.length > 0 && (
          <button className="link-btn" onClick={() => setEdit((p) => {
            const n = { ...p };
            fillable.forEach((w) => { n[w.id] = String(suggest(w)); });
            return n;
          })}>پرکردن {faDigits(fillable.length)} خانهٔ خالی از حقوق</button>
        )}
        {changed.length > 0 && (
          <button className="submit" style={{ width: "auto", margin: 0 }} disabled={busy} onClick={save}>
            {busy ? "…" : `ذخیرهٔ ${faDigits(changed.length)} نرخ`}</button>
        )}
        {okMsg && <span className="ok-txt sm2">{okMsg}</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {payByName && (
        <div className="muted sm2" style={{ marginTop: 6 }}>
          «از حقوق» = ناخالص حقوق همان نفر ÷ ساعت‌های پرداختی‌اش در ماه آخر؛ فقط وقتی پیدا می‌شود که
          نامش در حقوق و گزارش‌ها یکی باشد. بیمهٔ سهم کارفرما را ندارد.
        </div>
      )}
    </div>
  );
}
/** قیمت‌گذاری: هزینهٔ نیرو، مواد و سود — و پیش‌فاکتورِ یک کار از روی متراژ چوبش. */
function ProdPricing() {
  const stageList = useWorkStages();
  const [st, setSt] = useState(null);
  const [form, setForm] = useState({ labour: "", material: "", margin: "" });
  const [mat, setMat] = useState(null);
  const [payByName, setPayByName] = useState(null);   // نرخ ساعتیِ هر نفر از حقوق
  const [workerAvg, setWorkerAvg] = useState(null);   // میانگین ساعت‌وزنیِ نرخ‌های واردشده
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const [base, setBase] = useState("");
  const [rows, setRows] = useState([]);
  const [quote, setQuote] = useState(null);
  const [qBusy, setQBusy] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, m] = await Promise.all([productionApi.pricingSettings(), productionApi.materialRate()]);
        setSt(s); setMat(m);
        setForm({ labour: String(s.labourCostPerHour || ""), material: String(s.materialCostPerM2 || ""),
          margin: String(s.marginPercent ?? "") });
      } catch (e) { setErr(e.message); }
    })();
    // پیشنهاد نرخ هر نفر از حقوق خودش — فقط اگر کاربر به حقوق دسترسی دارد. میانگینِ کل
    // حقوق به کار نمی‌آید: لیست حقوق بیشتر کارکنان دفترند، نه کارگرهای کارگاه.
    (async () => {
      try {
        const [ps, months] = await Promise.all([payrollApi.settings(), payrollApi.listMonths()]);
        const m = months?.[0];
        if (!m || !(m.entries || []).length) return;
        const hr = hourRateOf(ps);
        const byName = {};
        m.entries.forEach((e) => {
          const c = calcPayroll(e, ps, hr);
          const g = (c.grossRasmi || 0) + (c.grossGheyr || 0);
          // ساعتی که پولش داده شده: روز کارکرد × ساعت روزانه + اضافه‌کار − کسرکار
          const h = Number(e.workedDays || 0) * (ps.dailyHours || 7.33)
            + Number(e.otHours || 0) - Number(e.shortHours || 0);
          if (h > 0 && e.staffName) byName[normName(e.staffName)] = Math.round(g / h);
        });
        setPayByName(Object.keys(byName).length ? byName : null);
      } catch { /* دسترسی حقوق ندارد یا ماهی نیست؛ پیشنهادی نشان داده نمی‌شود */ }
    })();
  }, []);

  useEffect(() => {
    setRows((prev) => stageList.filter((s) => s.needsArea !== false).map((s) => {
      const kept = prev.find((r) => r.name === s.name);
      return kept || { name: s.name, on: true, coef: String(s.coefficient ?? 1) };
    }));
  }, [stageList]);

  async function saveSettings() {
    if (saveBusy) return;
    setSaveBusy(true); setErr("");
    try {
      const s = await productionApi.savePricingSettings({
        labourCostPerHour: money(form.labour), materialCostPerM2: money(form.material),
        marginPercent: money(form.margin) });
      setSt(s); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { setErr(e.message); } finally { setSaveBusy(false); }
  }

  async function runQuote() {
    const b = money(base);
    const picked = rows.filter((r) => r.on);
    if (!(b > 0) || !picked.length || qBusy) return;
    setQBusy(true); setErr("");
    try {
      setQuote(await productionApi.priceQuote({
        baseArea: b, stages: picked.map((r) => ({ name: r.name, coefficient: money(r.coef) || 1 })),
        labourCostPerHour: money(form.labour), materialCostPerM2: money(form.material),
        marginPercent: money(form.margin) }));
    } catch (e) { setErr(e.message); } finally { setQBusy(false); }
  }

  function exportMissing() {
    if (!mat?.missing?.length) return;
    saveSheet("کالاهای-بی-قیمت", "بی قیمت", [
      ["کالا", "کد", "واحد مصرف", "تعداد ردیف مصرف", "جمع مقدار", "دلیل"],
      ...mat.missing.map((m) => [m.name, m.code || "", m.unit || "", m.lines,
        Math.round(m.qty * 100) / 100, m.reason]),
    ]);
  }

  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const dirty = st && (money(form.labour) !== st.labourCostPerHour
    || money(form.material) !== st.materialCostPerM2 || money(form.margin) !== st.marginPercent);

  if (err && !st) return <div className="notice warn">{err}</div>;
  if (!st) return <div className="empty">…</div>;

  return (
    <>
      <div className="notice">
        <b>قیمت = دستمزد + مواد + سود.</b> دستمزد از ساعتِ واقعیِ هر مرحله بر متر حساب می‌شود،
        نه از اهمیتش — هزینه از زمان و مواد درمی‌آید. وزنِ اهمیت فقط قیمتِ نهایی را بین
        مراحل پخش می‌کند، برای صورتحسابِ مرحله‌ای.
      </div>

      <div className="card">
        <div className="board-h">پایه‌های قیمت</div>
        <div className="row3">
          <label className="fld"><span>میانگین هزینهٔ ساعتی کارگاه (برای کارگر بی‌نرخ)</span>
            <input value={form.labour ? rial(money(form.labour)) : ""} inputMode="numeric"
              className={!(money(form.labour) > 0) ? "need" : ""} onChange={setF("labour")} /></label>
          <label className="fld"><span>هزینهٔ مواد هر متر چوب (ریال)</span>
            <input value={form.material ? rial(money(form.material)) : ""} inputMode="numeric"
              className={!(money(form.material) > 0) ? "need" : ""} onChange={setF("material")} /></label>
          <label className="fld"><span>سود (٪)</span>
            <input value={form.margin} inputMode="decimal" onChange={setF("margin")} /></label>
        </div>

        {workerAvg ? (
          <div className="ref-box">
            <b>میانگین نرخ کارگرهای واردشده:</b> <b>{rial(workerAvg.rate)}</b> ریال در ساعت
            {Math.round(workerAvg.rate) !== money(form.labour) && (
              <button className="link-btn" onClick={() => setForm((p) => ({
                ...p, labour: String(Math.round(workerAvg.rate)) }))}>همین را بگذار</button>
            )}
            <div className="muted sm2">
              به نسبت ساعت کار هر نفر، از {faDigits(workerAvg.count)} کارگرِ نرخ‌دار. این میانگین فقط برای
              کسی به کار می‌رود که هنوز نرخ ندارد، و برای مراحلی که سابقه ندارند.
            </div>
          </div>
        ) : (
          <div className="ref-box warn">
            هنوز برای هیچ کارگری نرخ وارد نشده؛ همهٔ ساعت‌ها با همین میانگین حساب می‌شوند. نرخ هر
            نفر را در جدول پایین وارد کنید.
          </div>
        )}

        {mat && (
          <div className={mat.coverage < 60 ? "ref-box warn" : "ref-box"}>
            <b>مرجع از مصرف واقعی مواد:</b>{" "}
            {mat.perM2 > 0 ? <><b>{rial(mat.perM2)}</b> ریال برای هر متر چوب</> : "عددی درنیامد"}
            {" "}— از {faDigits(mat.projects)} پروژه و {faDigits(round2(mat.sampleArea))} متر.
            {mat.perM2 > 0 && (
              <button className="link-btn" onClick={() => setForm((p) => ({
                ...p, material: String(mat.perM2) }))}>همین را بگذار</button>
            )}
            <div className="sm2" style={{ marginTop: 4 }}>
              فقط <b>{faDigits(mat.pricedLines)} از {faDigits(mat.totalLines)}</b> ردیف مصرف
              قیمت دارد ({faDigits(mat.coverage)}٪).
              {mat.coverage < 60 && " این عدد بسیار کمتر از واقعیت است — بقیهٔ مواد قیمت ندارند و به حساب نیامده‌اند."}
            </div>
            {mat.missing?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <button className="link-btn" onClick={() => setShowMissing(!showMissing)}>
                  {showMissing ? "بستن" : `${faDigits(mat.missing.length)} کالای بی‌قیمت`}
                </button>
                {" · "}
                <button className="link-btn" onClick={exportMissing}>خروجی اکسل</button>
              </div>
            )}
            {showMissing && (
              <div className="card" style={{ overflowX: "auto", marginTop: 8, marginBottom: 0 }}>
                <table className="mini-table">
                  <thead><tr><th>کالا</th><th>کد</th><th>ردیف</th><th>مقدار</th><th>دلیل</th></tr></thead>
                  <tbody>
                    {mat.missing.map((m, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: "normal" }}>{m.name}</td>
                        <td className="muted">{m.code || "—"}</td>
                        <td>{faDigits(m.lines)}</td>
                        <td>{faDigits(round2(m.qty))} {m.unit}</td>
                        <td className="warn-txt">{m.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {err && <div className="err">{err}</div>}
        {dirty && (
          <div className="btn-row">
            <button className="submit" style={{ width: "auto", margin: 0 }} disabled={saveBusy}
              onClick={saveSettings}>{saveBusy ? "…" : "ذخیرهٔ پایه‌های قیمت"}</button>
          </div>
        )}
        {saved && <div className="ok-txt sm2">ذخیره شد ✓</div>}
      </div>

      <WorkerRates payByName={payByName} onSaved={() => setQuote(null)}
        onLoaded={(ws) => {
          const rated = ws.filter((w) => w.hourlyCost > 0 && w.projectHours > 0);
          const h = rated.reduce((a, w) => a + w.projectHours, 0);
          setWorkerAvg(h > 0 ? { rate: rated.reduce((a, w) => a + w.hourlyCost * w.projectHours, 0) / h,
            count: rated.length } : null);
        }} />

      <div className="card">
        <div className="board-h">پیش‌فاکتور یک کار</div>
        <label className="fld"><span>متراژ چوب (م²)</span>
          <input value={base} inputMode="decimal" onChange={(e) => setBase(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runQuote(); }} placeholder="مثلاً ۴۰" /></label>
        <div className="stage-box" style={{ maxHeight: 220, overflowY: "auto" }}>
          {rows.map((r) => (
            <div className={r.on ? "stage-row on" : "stage-row"} key={r.name}>
              <label className="stage-pick">
                <input type="checkbox" checked={r.on}
                  onChange={(e) => setRows((p) => p.map((x) => (x.name === r.name ? { ...x, on: e.target.checked } : x)))} />
                <span>{r.name}</span>
              </label>
              {r.on && (
                <div className="stage-fields">
                  <label className="fld sm" style={{ maxWidth: 80 }}><span>ضریب</span>
                    <input value={r.coef} inputMode="decimal"
                      onChange={(e) => setRows((p) => p.map((x) => (x.name === r.name ? { ...x, coef: e.target.value } : x)))} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="btn-row">
          <button className="submit" style={{ width: "auto", margin: 0 }}
            disabled={!(money(base) > 0) || qBusy} onClick={runQuote}>{qBusy ? "…" : "حساب کن"}</button>
        </div>

        {quote && (
          <>
            {quote.missing.length > 0 && (
              <div className="notice warn">
                ناقص: {quote.missing.join("، ")} — عدد زیر کمتر از واقع است.
              </div>
            )}
            <div className="quote-box">
              <div className="quote-row"><span>متراژ چوب / متراژ کار</span>
                <b>{faDigits(quote.baseArea)} / {faDigits(quote.workArea)} م²</b></div>
              <div className="quote-row"><span>ساعت کار لازم</span>
                <b>{faDigits(quote.hours)} ساعت</b>
                {quote.estimatedStages > 0 && <small>{faDigits(quote.estimatedStages)} مرحله تخمینی</small>}</div>
              <div className="quote-row"><span>دستمزد (نرخ هر کارگر · میانگین مؤثر {rial(quote.effectiveRate)} در ساعت)</span>
                <b>{rial(quote.labour)}</b>
                {quote.ratedShare < 100 && quote.hours > 0 && (
                  <small>{faDigits(round2(quote.ratedShare))}٪ ساعت‌ها با نرخ خود کارگر، بقیه با میانگین کارگاه</small>
                )}</div>
              <div className="quote-row"><span>مواد ({rial(quote.materialPerM2)} × متر چوب)</span>
                <b>{rial(quote.material)}</b></div>
              <div className="quote-row"><span>جمع هزینه</span><b>{rial(quote.subtotal)}</b></div>
              <div className="quote-row"><span>سود {faDigits(quote.marginPercent)}٪</span>
                <b>{rial(quote.margin)}</b></div>
              <div className="quote-row main"><span>قیمت پیشنهادی</span>
                <b>{rial(quote.price)} ریال</b>
                <small>{rial(quote.perM2)} برای هر متر چوب</small></div>
            </div>

            <div className="board-h" style={{ marginTop: 14 }}>به تفکیک مرحله</div>
            <div style={{ overflowX: "auto" }}>
              <table className="mini-table">
                <thead>
                  <tr><th>مرحله</th><th>متراژ کار</th><th>ساعت</th><th>نرخ ساعتی</th><th>دستمزد</th>
                    <th>سهم از قیمت</th></tr>
                </thead>
                <tbody>
                  {quote.stages.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{faDigits(s.work)}</td>
                      <td>{s.hours == null ? "—" : faDigits(s.hours)}
                        {s.hours != null && !s.measured && <span className="muted"> ~</span>}</td>
                      <td>{s.hourRate ? rial(s.hourRate) : "—"}</td>
                      <td>{rial(s.labour)}</td>
                      <td><b>{rial(s.priceShare)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted sm2" style={{ marginTop: 8 }}>
              «نرخ ساعتی» میانگینِ نرخ کسانی است که آن مرحله را واقعاً کار کرده‌اند، به نسبت ساعتشان.
              «سهم از قیمت» به نسبت وزنِ مرحله است و برای صورتحسابِ مرحله‌ای به کار می‌رود — مثلاً
              وقتی پرداخت‌ها تمام شد، سهمشان را می‌شود درخواست کرد. «~» یعنی مرحله هنوز سابقه
              ندارد و ساعتش از ضریب زمان تخمین زده شده.
            </div>
          </>
        )}
      </div>
    </>
  );
}
/** فهرست مراحل و ضریبِ هر کدام — چند دست روی هر متر چوب انجام می‌شود. */
function ProdStages() {
  const can = useCan();
  const editable = can("production.stages");
  const [rows, setRows] = useState(null);
  const [rates, setRates] = useState({});
  const [cal, setCal] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, r, c] = await Promise.all([workStagesApi.list(), productionApi.stageRates(),
        productionApi.stageCalibration()]);
      setRows(list); setRates(r || {}); setCal(c); setErr("");
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(row, patch) {
    if (patch.coefficient !== undefined && !(Number(patch.coefficient) > 0)) {
      alert("ضریب باید بزرگ‌تر از صفر باشد."); return;
    }
    if ((patch.importance !== undefined && Number(patch.importance) < 0)
        || (patch.timeWeight !== undefined && Number(patch.timeWeight) < 0)) {
      alert("اهمیت و ضریب زمان نمی‌توانند منفی باشند."); return;
    }
    setBusy(row.id);
    try {
      await workStagesApi.update(row.id, patch);
      resetStageCache();   // فهرست کهنه نماند
      await load();
      setSaved(row.id);
      setTimeout(() => setSaved(""), 2500);
    } catch (e) { alert(e.message); } finally { setBusy(""); }
  }

  if (err) return <div className="notice warn">{err}</div>;
  if (!rows) return <div className="empty">…</div>;

  const withArea = rows.filter((r) => r.needsArea !== false);
  const sumCoef = withArea.reduce((a, r) => a + (Number(r.coefficient) || 1), 0);
  const sumWeight = rows.reduce((a, r) => a + (Number(r.weight) || 0), 0);

  return (
    <>
      <div className="notice">
        <b>ضریب</b> می‌گوید روی هر متر چوب چند دست کار انجام می‌شود — متراژ برنامه از
        «متراژ چوب × ضریب» ساخته می‌شود.<br />
        <b>وزن = اهمیت × ضریب زمان.</b> نوار پیشرفت و سهم هر مرحله از مبلغ قرارداد از
        وزن درمی‌آید.<br />
        <b>ساعت واقعی بر متر</b> از گزارش‌ها حساب می‌شود و امتیاز عملکرد و قیمت‌گذاری از آن
        استفاده می‌کنند — نه از ضریب زمان، چون آن ضریب از واقعیت صاف‌تر بود.
      </div>

      <div className="prod-tiles">
        <Tile label="مراحل" value={faDigits(rows.length)}
          sub={`${faDigits(withArea.length)} مرحلهٔ متراژی`} />
        <Tile label="جمع ضریب‌ها" value={`${faDigits(round2(sumCoef))}×`} tone="run"
          sub={`هر متر چوب ${faDigits(round2(sumCoef))} م² کار`} />
        <Tile label="جمع وزن‌ها" value={faDigits(round2(sumWeight))} tone="ok"
          sub="سهم هر مرحله از همین حساب می‌شود" />
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="mini-table">
          <thead>
            <tr>
              <th>مرحله</th><th>ضریب</th><th>اهمیت</th><th>ضریب زمان</th>
              <th>وزن</th><th>سهم از کار</th><th>ساعت واقعی بر متر</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <StageCoefRow key={r.id} row={r} editable={editable} totalWeight={sumWeight}
                rate={rates[r.name]}
                busy={busy === r.id} saved={saved === r.id} onSave={save} />
            ))}
          </tbody>
        </table>
        {!editable && (
          <div className="muted sm2" style={{ marginTop: 8 }}>
            برای تغییر ضریب و وزن به دسترسی «ویرایش فهرست مراحل تولید» نیاز است.
          </div>
        )}
      </div>

      {cal && <StageCalibration data={cal} />}
    </>
  );
}
/** اختلاف درصدی با رنگ: تا ۱۰٪ نزدیک، تا ۲۵٪ قابل‌توجه، بیشتر از آن دور. */
function VarianceCell({ v }) {
  if (v == null) return <td className="muted">—</td>;
  const a = Math.abs(v);
  const cls = a <= 10 ? "var-ok" : a <= 25 ? "var-mid" : "var-hi";
  return <td className={cls}>{v > 0 ? "+" : v < 0 ? "−" : ""}{faDigits(round2(a))}٪</td>;
}
/** ضریب فعلی در برابر ضریبی که داده‌ی واقعی نشان می‌دهد — برای دقیق‌کردن ضریب‌ها در طول زمان. */
function StageCalibration({ data }) {
  const rows = data.stages || [];

  function exportSheet() {
    const n = (v) => (v == null ? "" : v);
    saveSheet(`ضرایب-فعلی-و-واقعی-${todayIso()}`, "ضرایب", [
      ["مرحله", "ضریب فعلی", "ضریب واقعی", "اختلاف ضریب ٪", "تعداد پروژه", "متراژ چوب نمونه",
        "متراژ کار نمونه", "ضریب زمان فعلی", "ضریب زمان واقعی", "اختلاف زمان ٪",
        "ساعت بر متر کار", "ساعت نمونه", "متراژ نمونه"],
      ...rows.map((r) => [r.name, r.coefficient, n(r.actualCoefficient), n(r.coefficientVariance),
        r.coefProjects, r.coefWood, r.coefWork, r.timeWeight, n(r.actualTimeWeight),
        n(r.timeVariance), n(r.hoursPerM2), r.sampleHours, r.sampleArea]),
    ]);
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="board-h" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>ضریب فعلی در برابر واقعیت</span>
        <button className="link-btn" onClick={exportSheet}>خروجی اکسل</button>
      </div>
      <table className="mini-table">
        <thead>
          <tr>
            <th rowSpan={2}>مرحله</th>
            <th colSpan={4}>ضریب (دست روی هر متر چوب)</th>
            <th colSpan={4}>ضریب زمان</th>
          </tr>
          <tr>
            <th>فعلی</th><th>واقعی</th><th>اختلاف</th><th>نمونه</th>
            <th>فعلی</th><th>واقعی</th><th>اختلاف</th><th>نمونه</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{faDigits(r.coefficient)}</td>
              <td><b>{r.actualCoefficient == null ? "—" : faDigits(r.actualCoefficient)}</b></td>
              <VarianceCell v={r.coefficientVariance} />
              <td className="muted sm2">
                {r.coefProjects ? `${faDigits(r.coefProjects)} پروژه · ${faDigits(round2(r.coefWood))} م² چوب` : "هنوز نه"}
              </td>
              <td>{faDigits(r.timeWeight)}</td>
              <td><b>{r.actualTimeWeight == null ? "—" : faDigits(r.actualTimeWeight)}</b></td>
              <VarianceCell v={r.timeVariance} />
              <td className="muted sm2">
                {r.sampleHours ? `${faDigits(round2(r.sampleHours))} ساعت · ${faDigits(round2(r.sampleArea))} م²` : "هنوز نه"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted sm2" style={{ marginTop: 8, lineHeight: 1.9 }}>
        <b>ضریب واقعی</b> = متراژ کارِ ثبت‌شده ÷ متراژ چوب، فقط از پروژه‌هایی که آن مرحله‌شان تمام
        شده (تیک انجام، یا پروژهٔ بسته با «کار تکمیل شد»)؛ مرحلهٔ نیمه‌کاره ضریب را کم نشان می‌داد.
        مرحلهٔ تمام‌شده‌ای که متراژ ثبت نکرده کنار گذاشته می‌شود.<br />
        <b>ضریب زمان واقعی</b> = ساعت واقعی بر متر کار، به مقیاسِ همین جدول برگردانده تا با عدد
        فعلی مقایسه‌پذیر باشد.<br />
        اختلاف: <span className="var-ok">تا ۱۰٪ نزدیک</span> ·{" "}
        <span className="var-mid">تا ۲۵٪ قابل‌توجه</span> ·{" "}
        <span className="var-hi">بیشتر، دور</span>. هر چه نمونه بزرگ‌تر، عدد واقعی قابل‌اعتمادتر؛
        با نمونهٔ کم ضریب را عوض نکنید. خروجی اکسل را هر ماه بگیرید تا روند اختلاف‌ها دیده شود.
      </div>
    </div>
  );
}

function StageCoefRow({ row, editable, busy, saved, totalWeight, rate, onSave }) {
  const [coef, setCoef] = useState(String(row.coefficient ?? 1));
  const [imp, setImp] = useState(String(row.importance ?? 0));
  const [tw, setTw] = useState(String(row.timeWeight ?? 0));
  useEffect(() => { setCoef(String(row.coefficient ?? 1)); }, [row.coefficient]);
  useEffect(() => { setImp(String(row.importance ?? 0)); }, [row.importance]);
  useEffect(() => { setTw(String(row.timeWeight ?? 0)); }, [row.timeWeight]);
  const noArea = row.needsArea === false;
  // وزن همیشه حاصل‌ضرب است؛ پیش از ذخیره هم زنده نشان داده می‌شود.
  const weight = (Number(imp) || 0) * (Number(tw) || 0);
  const dirty = Number(coef) !== Number(row.coefficient ?? 1)
    || Number(imp) !== Number(row.importance ?? 0) || Number(tw) !== Number(row.timeWeight ?? 0);
  const share = totalWeight > 0 ? weight / totalWeight * 100 : 0;
  const small = { width: 64 };

  return (
    <tr>
      <td>{row.name}{row.active === false && <span className="muted"> (غیرفعال)</span>}</td>
      <td>
        {noArea ? <span className="muted">—</span> : (
          <input type="number" step="0.25" inputMode="decimal" value={coef} disabled={!editable}
            onChange={(e) => setCoef(e.target.value)} style={small} />
        )}
      </td>
      <td>
        <input type="number" step="0.5" inputMode="decimal" value={imp} disabled={!editable}
          onChange={(e) => setImp(e.target.value)} style={small} />
      </td>
      <td>
        <input type="number" step="0.5" inputMode="decimal" value={tw} disabled={!editable}
          onChange={(e) => setTw(e.target.value)} style={small} />
      </td>
      <td><b>{faDigits(round2(weight))}</b></td>
      <td style={{ minWidth: 100 }}>
        {weight > 0 ? (
          <span>
            <b>{faDigits(round2(share))}٪</b>
            <div className="bar sm" style={{ marginTop: 3 }}>
              <div style={{ width: share + "%" }} />
            </div>
          </span>
        ) : <span className="muted">در پیشرفت نمی‌آید</span>}
      </td>
      <td>
        {!rate?.hoursPerM2 ? <span className="muted">—</span>
          : rate.measured
            ? <span title={`از ${rate.sampleHours} ساعت روی ${rate.sampleArea} متر`}>
                {faDigits(round2(rate.hoursPerM2))} ساعت</span>
            : <span className="muted" title="هنوز سابقه ندارد؛ از ضریب زمان تخمین زده شده">
                ~{faDigits(round2(rate.hoursPerM2))} (تخمین)</span>}
      </td>
      <td style={{ width: 84 }}>
        {saved ? <span className="ok-txt">ذخیره شد ✓</span>
          : (editable && dirty && (
            <button className="ghost" style={{ padding: "4px 10px" }} disabled={busy}
              onClick={() => onSave(row, { coefficient: Number(coef) || 1,
                importance: Number(imp) || 0, timeWeight: Number(tw) || 0 })}>
              {busy ? "…" : "ذخیره"}</button>
          ))}
      </td>
    </tr>
  );
}

function Tile({ label, value, tone, sub }) {
  return (
    <div className={tone ? `prod-tile ${tone}` : "prod-tile"}>
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}
/** روزشمار تا تاریخ تحویل — همان چیزی که در گروه گفتگوی پروژه هم می‌آید. */
function Countdown({ due, done }) {
  if (!due) return <span className="muted sm2">تاریخ تحویل ندارد</span>;
  const today = new Date(todayIso() + "T00:00:00");
  const target = new Date(due + "T00:00:00");
  const days = Math.round((target - today) / 86400000);
  if (done) return <span className="pill ok">تحویل {jShort(due)}</span>;
  if (days < 0) return <span className="pill bad">{faDigits(-days)} روز عقب از تحویل</span>;
  if (days === 0) return <span className="pill bad">امروز تحویل است</span>;
  return <span className={days <= 7 ? "pill run" : "pill idle"}>{faDigits(days)} روز تا تحویل</span>;
}
