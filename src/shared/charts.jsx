import { useState } from "react";
import { faDigits, isoToJ, pad, J_MONTHS } from "./core.jsx";

/* ============ نمودارهای داشبورد — SVG ساده، با رنگ‌های خود برنامه ============ */

const fmt = (n) => faDigits(Math.round((n || 0) * 10) / 10);

/** فهرست میله‌ای افقی: برچسب، میله، مقدار و سهم. بیش از `limit` ردیف در «سایر» جمع می‌شود. */
export function BarList({ rows, tone = "accent", unit = "", limit = 8, empty = "داده‌ای نیست." }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <div className="muted">{empty}</div>;
  const total = rows.reduce((a, [, v]) => a + v, 0) || 1;
  let shown = rows;
  if (!all && rows.length > limit) {
    const rest = rows.slice(limit - 1).reduce((a, [, v]) => a + v, 0);
    shown = [...rows.slice(0, limit - 1), [`سایر (${faDigits(rows.length - limit + 1)} مورد)`, rest, true]];
  }
  const max = Math.max(...shown.map(([, v]) => v), 1);
  return (
    <div className="bl">
      {shown.map(([name, v, other]) => (
        <div className={other ? "bl-row other" : "bl-row"} key={name} title={`${name}: ${fmt(v)} ${unit}`}>
          <span className="bl-lbl">{name}</span>
          <div className="bl-track"><div className={`bl-fill ${tone}`} style={{ width: `${(v / max) * 100}%` }} /></div>
          <span className="bl-v">{fmt(v)}</span>
          <span className="bl-p">{faDigits(Math.round((v / total) * 100))}٪</span>
        </div>
      ))}
      {rows.length > limit && (
        <button className="link-btn bl-more" onClick={() => setAll(!all)}>
          {all ? "خلاصه" : `نمایش همه (${faDigits(rows.length)})`}
        </button>
      )}
    </div>
  );
}

/** ستون‌های روزانه با خط‌های راهنما. points: [{date, value}] به ترتیب زمان. */
export function TrendChart({ points, unit = "ساعت", highlight }) {
  if (!points.some((p) => p.value > 0)) {
    return <div className="muted">در {faDigits(points.length)} روز اخیر {unit}ی ثبت نشده است.</div>;
  }
  const W = 640, H = 200, L = 34, R = 8, T = 12, B = 26;
  const max = Math.max(...points.map((p) => p.value), 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = (W - L - R) / points.length;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const total = points.reduce((a, p) => a + p.value, 0);
  const days = points.filter((p) => p.value > 0).length;
  return (
    <div>
      <div className="tc-sum">
        <span><b>{fmt(total)}</b> {unit} در {faDigits(points.length)} روز</span>
        <span>میانگین روزهای کاری: <b>{fmt(days ? total / days : 0)}</b> {unit}</span>
      </div>
      <div className="tc-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="tc" role="img" aria-label={`${unit} روزانه`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="tc-grid" />
              <text x={L - 6} y={y(v) + 4} className="tc-ax" textAnchor="end">{faDigits(v)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            // راست‌به‌چپ: قدیمی‌ترین روز سمت راست، امروز سمت چپ
            const x = W - R - (i + 1) * bw;
            const h = H - B - y(p.value);
            const j = isoToJ(p.date);
            const hot = p.date === highlight;
            return (
              <g key={p.date}>
                <rect x={x + bw * 0.18} y={y(p.value)} width={bw * 0.64} height={Math.max(h, p.value ? 1.5 : 0)}
                  rx={Math.min(3, bw * 0.2)} className={hot ? "tc-bar hot" : "tc-bar"}>
                  <title>{`${faDigits(j.jd)} ${J_MONTHS[j.jm - 1]}: ${fmt(p.value)} ${unit}`}</title>
                </rect>
                {(j.jd === 1 || i === 0 || i % 5 === 0) && (
                  <text x={x + bw / 2} y={H - 8} className="tc-ax" textAnchor="middle">
                    {j.jd === 1 ? J_MONTHS[j.jm - 1] : faDigits(`${pad(j.jm)}/${pad(j.jd)}`)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

/** دونات با راهنما. parts: [{label, value, color}] */
export function Donut({ parts, center, sub }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 42, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="dn">
      <svg viewBox="0 0 110 110" className="dn-svg" role="img" aria-label={sub}>
        <circle cx="55" cy="55" r={r} className="dn-bg" />
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / total) * C;
          const el = (
            <circle key={p.label} cx="55" cy="55" r={r} fill="none" stroke={p.color} strokeWidth="13"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 55 55)">
              <title>{`${p.label}: ${faDigits(p.value)}`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
        <text x="55" y="54" textAnchor="middle" className="dn-c">{center}</text>
        <text x="55" y="70" textAnchor="middle" className="dn-s">{sub}</text>
      </svg>
      <ul className="dn-leg">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <b>{faDigits(p.value)}</b>
            <em>{total ? faDigits(Math.round((p.value / total) * 100)) : "۰"}٪</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** خط کوچک روند برای کارت‌های خلاصه. */
export function Sparkline({ values }) {
  if (values.length < 2) return null;
  const W = 90, H = 26, max = Math.max(...values, 1);
  const pts = values.map((v, i) => [W - (i / (values.length - 1)) * W, H - 2 - (v / max) * (H - 4)]);
  const d = pts.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spk" aria-hidden="true">
      <path d={`${d} L${pts.at(-1)[0]},${H} L${pts[0][0]},${H} Z`} className="spk-a" />
      <path d={d} className="spk-l" />
      <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="2.4" className="spk-d" />
    </svg>
  );
}
