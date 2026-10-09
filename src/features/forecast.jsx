import { useEffect, useState } from "react";
import { productionApi } from "../api.js";
import { Empty, WhyOff, faDigits, jShort, round2 } from "../shared/core.jsx";
import { Tile } from "./planutil.jsx";

/* پیش‌بینی و ظرفیت: توانِ کارگاه از سابقهٔ گزارش‌ها، مدتِ یک کارِ تازه، و تخمینِ پایانِ پروژه‌های در جریان.
   پیش‌تر بخشی جدا در منوی تولید بود؛ حالا یکی از نماهای «برنامه‌ریزی تولید» است. */
export function PlanForecast() {
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
        <WhyOff busy={qBusy} reasons={[!(Number(area) > 0) && "متراژ کار وارد نشده"]} />
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
      <div className="muted sm2" style={{ marginBottom: 10 }}>
        این تاریخ‌ها تخمینِ سرانگشتی‌اند، از توانِ میانگینِ کارگاه. تاریخِ دقیقِ هر پروژه در نمودارِ زمانی است.
      </div>
      {data.results.length === 0 ? <Empty art="production">پروژهٔ در جریانی نیست.</Empty>
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
