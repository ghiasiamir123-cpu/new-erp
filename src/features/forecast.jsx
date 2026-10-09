import { useEffect, useState } from "react";
import { productionApi } from "../api.js";
import { Empty, WhyOff, faDigits, jLong, jShort, round2 } from "../shared/core.jsx";
import { Tile } from "./planutil.jsx";

/* پیش‌بینی و ظرفیت: «کارِ تازه کی آماده می‌شود؟» برای قولِ اولیه به مشتری، و پایانِ پروژه‌های در جریان.
   پیش‌تر بخشی جدا در منوی تولید بود؛ حالا یکی از نماهای «برنامه‌ریزی تولید» است. هر دو تاریخ از خودِ برنامه می‌آیند:
   سفارشِ فرضی با همان موتور کنارِ کارهای فعلی چیده می‌شود (plan-quote)، و پایانِ پروژه‌ها از plan است (همان داده‌ای که
   نمودارِ زمانی را می‌کشد). فقط کاشی‌های بالا (توانِ میانگین و صف) از سابقهٔ گزارش‌ها حساب می‌شوند. */

const movedText = (list) => list.map((m) => `${m.label} (${m.days < 0 ? `${faDigits(-m.days)} روز دیرتر` : `${faDigits(m.days)} روز زودتر`})`).join("، ");

export function PlanForecast({ plan }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [area, setArea] = useState("");
  const [quote, setQuote] = useState(null);
  const [qBusy, setQBusy] = useState(false);
  const [stages, setStages] = useState([]);           // مرحله‌های معمولِ یک سفارشِ تازه
  const [off, setOff] = useState(() => new Set());    // مرحله‌هایی که این کار ندارد

  useEffect(() => {
    productionApi.forecasts().then(setData).catch((e) => setErr(e.message));
    productionApi.planQuote().then((d) => setStages(d.stages || [])).catch(() => {});
  }, []);

  const picked = stages.filter((s) => !off.has(s.name)).map((s) => s.name);
  const noStage = stages.length > 0 && picked.length === 0;

  async function ask() {
    const n = Number(area);
    if (!(n > 0) || qBusy || noStage) return;
    setQBusy(true);
    try { setQuote(await productionApi.planQuote({ area: n, stages: stages.length ? picked : undefined })); }
    catch (e) { setQuote(null); alert(e.message); } finally { setQBusy(false); }
  }
  const toggle = (name) => {
    setQuote(null);
    setOff((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  };

  if (err) return <div className="notice warn">{err}</div>;
  if (!data) return <div className="empty">…</div>;

  const cap = data.capacity;
  const thin = !cap.days || cap.days < 5;
  const days = plan?.days || [];
  const daysTo = (iso) => days.filter((x) => x.date <= iso).length;            // روزِ کاریِ برنامه تا آن تاریخ
  const paused = (plan?.paused || []).filter((z) => !z.upcoming);
  const pausedIds = new Set(paused.map((z) => String(z.projectId)));
  const rows = (plan?.projects || []).filter((p) => !pausedIds.has(String(p.id)))
    .sort((a, b) => (a.slackDays == null) - (b.slackDays == null) || (a.slackDays ?? 0) - (b.slackDays ?? 0));   // دیرترها اول
  const known = new Set([...rows.map((p) => String(p.id)), ...pausedIds]);
  const outside = data.results.filter((f) => !known.has(String(f.projectId)));  // در جریان است ولی در برنامه نیست

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
        <div className="board-h">کارِ تازه کی آماده می‌شود؟</div>
        <div className="muted sm2" style={{ marginBottom: 10 }}>
          متراژِ کار را بزنید. برنامه همین حالا آن را کنارِ کارهای فعلی، با همین نفرات و ایستگاه‌ها و مرخصی‌ها می‌چیند و روزِ
          آماده‌شدنش را می‌گوید؛ برای قولِ اولیه به مشتری. چیزی ذخیره نمی‌شود.
        </div>
        <div className="row2">
          <label className="fld"><span>متراژ کار (م²)</span>
            <input type="number" inputMode="decimal" value={area} placeholder="مثلاً ۱۰۰"
              onChange={(e) => { setArea(e.target.value); setQuote(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
          </label>
          <div className="fld"><span>&nbsp;</span>
            <button className="submit" style={{ margin: 0 }} disabled={!(Number(area) > 0) || qBusy || noStage}
              onClick={ask}>{qBusy ? "…" : "حساب کن"}</button>
          </div>
        </div>
        {stages.length > 0 && (
          <div className="fld"><span>مرحله‌های این کار (هر کدام را که ندارد بردارید)</span>
            <div className="seg-row" style={{ marginBottom: 0 }}>
              {stages.map((s) => (
                <button key={s.name} type="button" className={off.has(s.name) ? "seg" : "seg on"}
                  aria-pressed={!off.has(s.name)} onClick={() => toggle(s.name)}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
        <WhyOff busy={qBusy} reasons={[!(Number(area) > 0) && "متراژ کار وارد نشده", noStage && "هیچ مرحله‌ای انتخاب نشده"]} />
        {quote && (
          <div className="quote-box">
            <div className="quote-row main" style={{ borderTop: 0, marginTop: 0, paddingTop: 6 }}>
              <span>اگر امروز سفارش بگیریم و در نوبت برود (بعد از کارهای فعلی)</span>
              {quote.last.finish
                ? <><b>{jLong(quote.last.finish)}</b>
                  <small>{faDigits(quote.last.workingDays)} روز کاری · {faDigits(quote.last.calendarDays)} روز دیگر</small></>
                : <b>در برنامهٔ فعلی جا نمی‌گیرد</b>}
            </div>
            {quote.last.calmFinish && quote.last.calmFinish !== quote.last.finish && (
              <div className="muted sm2">با سرعتِ فعلیِ کارگاه (بدونِ هدفِ بهره‌وری): <b>{jLong(quote.last.calmFinish)}</b></div>
            )}
            {quote.last.moved.length > 0 && (
              <div className="muted sm2">با این سفارش این کارها جابه‌جا می‌شوند: {movedText(quote.last.moved)}</div>
            )}
            <div className="quote-row" style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 10 }}>
              <span>اگر جلوتر از همهٔ کارها انجام شود</span>
              {quote.first.finish
                ? <><b>{jLong(quote.first.finish)}</b><small>{faDigits(quote.first.workingDays)} روز کاری</small></>
                : <b>—</b>}
            </div>
            {quote.first.moved.length > 0 && (
              <div className="muted sm2">در عوض: {movedText(quote.first.moved)}</div>
            )}
            <div className="muted sm2" style={{ marginTop: 8 }}>
              حساب با {faDigits(quote.stages.length)} مرحله و جمعاً {faDigits(round2(quote.stages.reduce((n, s) => n + s.area, 0)))} م² کار،
              روی برنامهٔ همین لحظه ({faDigits(quote.now.projects)} پروژهٔ در جریان). با هر سفارشِ تازه یا تغییرِ برنامه این تاریخ
              جابه‌جا می‌شود.
              {quote.noSpeed.length > 0 && ` برای «${quote.noSpeed.join("»، «")}» هنوز سرعتی در سابقه نیست و برنامه نمی‌تواند آن را بچیند.`}
            </div>
          </div>
        )}
      </div>

      <div className="board-h">پروژه‌های در جریان</div>
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        تاریخِ پایانِ هر پروژه همان تاریخِ برنامه است؛ همان که در نمودارِ زمانی می‌بینید.
      </div>
      {rows.length + paused.length + outside.length === 0 && <Empty art="production">پروژهٔ در جریانی نیست.</Empty>}
      {rows.map((p) => (
        <div className="card" key={p.id}>
          <div className="prod-hd">
            <div className="prod-name">
              <b>{p.label}</b>
              <span className="muted sm2">{faDigits(round2(p.remaining))} م² مانده</span>
            </div>
            {p.dueDate && p.finish && p.slackDays != null && (p.slackDays >= 0
              ? <span className="pill ok">{faDigits(p.slackDays)} روز فرصت اضافه</span>
              : <span className="pill bad">{faDigits(-p.slackDays)} روز دیرتر از قول</span>)}
          </div>
          {p.finish ? (
            <div className="muted sm2">
              پایان طبقِ برنامه: <b>{jShort(p.finish)}</b> ({faDigits(daysTo(p.finish))} روز کاری)
              {p.realFinish && p.realFinish !== p.finish && <> · با سرعتِ فعلی: {jShort(p.realFinish)}</>}
              {p.dueDate ? <> · تاریخ تحویل قول‌داده‌شده: {jShort(p.dueDate)}</> : <> · تاریخ تحویل وارد نشده</>}
            </div>
          ) : <div className="muted sm2">در برنامهٔ فعلی به پایان نمی‌رسد؛ نمودارِ زمانی را ببینید.</div>}
        </div>
      ))}
      {paused.map((z) => (
        <div className="card" key={`z${z.id}`}>
          <div className="prod-hd">
            <div className="prod-name">
              <b>{z.label}</b>
              <span className="muted sm2">{faDigits(round2(z.remaining))} م² مانده</span>
            </div>
            <span className="pill idle">متوقف</span>
          </div>
          <div className="muted sm2">
            تا وقتی متوقف است در برنامه چیده نمی‌شود و تاریخِ پایان ندارد{z.reasonLabel ? ` (${z.reasonLabel})` : ""}.
          </div>
        </div>
      ))}
      {outside.map((f) => (
        <div className="card" key={`o${f.projectId}`}>
          <div className="prod-hd">
            <div className="prod-name">
              <b>{f.projectName}</b>
              <span className="muted sm2">{faDigits(round2(f.remaining))} م² مانده</span>
            </div>
            <span className="pill idle">بیرون از برنامه</span>
          </div>
          <div className="muted sm2">این پروژه در برنامهٔ تولید چیده نشده است؛ تاریخِ پایان ندارد.</div>
        </div>
      ))}
    </>
  );
}
