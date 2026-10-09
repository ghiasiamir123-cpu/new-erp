/* دستگاه‌های نمای کارگاه در شبیه‌ساز: هر ایستگاه شکلِ خودش را دارد (میزِ کار، میزِ پرداخت، کابینِ پاشش، بازدید، بسته‌بندی…)،
   حجمی و شیشه‌ای. همه در قابِ ۱۶۰×۱۲۶ کشیده می‌شوند و زمین روی y=۱۱۸ است. رنگ و حرکت در styles.js (‎.eq-*‎). */

/** نوعِ دستگاه از روی نامِ ایستگاه و مرحله‌هایش. */
export function kindOf(st) {
  if (st.id === "site") return "site";
  const name = st.name || "", all = `${name} ${(st.stages || []).join(" ")}`;
  if (/بسته|ارسال|تحویل/.test(all)) return "pack";
  if (/بازدید|کنترل|بازرسی/.test(name)) return "inspect";
  if (/پرداخت|سنباده|ساب‌|سابیدن/.test(name)) return "sander";
  if (/رنگ|رویه|کیلر|پلی/.test(name)) return "paint";
  if (/استر|آستر|پرایمر|سیلر|زیرکار/.test(name)) return "booth";
  if (/خشک/.test(all)) return "rack";
  if (/بتونه|میخ|ایراد|مونتاژ|برش|آماده/.test(all)) return "bench";
  return "generic";
}

export function SimDefs() {
  return (
    <defs>
      <linearGradient id="simSteel" x2="1">
        <stop stopColor="#2b5364" /><stop offset=".4" stopColor="#6f9daa" /><stop offset=".6" stopColor="#4c7e8e" /><stop offset="1" stopColor="#1a3545" />
      </linearGradient>
      <linearGradient id="simSteelV" x2="0" y2="1"><stop stopColor="#8dbbc7" /><stop offset="1" stopColor="#3b6a7a" /></linearGradient>
      <linearGradient id="simDark" x2="0" y2="1"><stop stopColor="#1b3a4a" /><stop offset="1" stopColor="#0c1e2a" /></linearGradient>
      <linearGradient id="simWood" x2="1"><stop stopColor="#b08a55" /><stop offset=".5" stopColor="#e6c690" /><stop offset="1" stopColor="#9c7746" /></linearGradient>
      <linearGradient id="simGloss" x2="1" y2="1"><stop stopColor="#c9f7ec" /><stop offset=".45" stopColor="#56c2ad" /><stop offset="1" stopColor="#267a6e" /></linearGradient>
      <linearGradient id="simPrimed" x2="1" y2="1"><stop stopColor="#ffffff" /><stop offset=".6" stopColor="#d5e0e5" /><stop offset="1" stopColor="#a9bbc3" /></linearGradient>
      <linearGradient id="simLight" x2="0" y2="1"><stop stopColor="#ffe7a0" stopOpacity=".6" /><stop offset="1" stopColor="#ffe7a0" stopOpacity="0" /></linearGradient>
      <radialGradient id="simShade"><stop stopColor="#01070d" stopOpacity=".75" /><stop offset="1" stopColor="#01070d" stopOpacity="0" /></radialGradient>
    </defs>
  );
}

/** جعبهٔ سه‌بعدی: رو، سقف و پهلو. */
function B({ x, y, w, h, d = 16, c = "" }) {
  const k = d * 0.55;
  return (
    <g>
      <polygon className={`eq-top ${c}`} points={`${x},${y} ${x + d},${y - k} ${x + w + d},${y - k} ${x + w},${y}`} />
      <polygon className={`eq-side ${c}`} points={`${x + w},${y} ${x + w + d},${y - k} ${x + w + d},${y + h - k} ${x + w},${y + h}`} />
      <rect className={`eq-front ${c}`} x={x} y={y} width={w} height={h} rx="1.5" />
    </g>
  );
}
const Shade = ({ cx = 80, rx = 72 }) => <ellipse className="eq-shade" cx={cx} cy="119" rx={rx} ry={rx * 0.15} />;
const Fan = ({ cx, cy, r = 8 }) => (
  <g>
    <circle className="eq-dark" cx={cx} cy={cy} r={r} />
    <g className="eq-blades"><path d={`M${cx},${cy - r + 1.5} L${cx},${cy + r - 1.5} M${cx - r + 2},${cy + (r - 2) * 0.55} L${cx + r - 2},${cy - (r - 2) * 0.55} M${cx - r + 2},${cy - (r - 2) * 0.55} L${cx + r - 2},${cy + (r - 2) * 0.55}`} /></g>
  </g>
);

function Table({ x = 14, w = 108, y = 72, d = 22 }) {
  return (
    <g>
      <rect className="eq-leg" x={x + d + w - 6} y={y - d * 0.55 + 8} width="4" height="38" />
      <rect className="eq-leg" x={x + 4} y={y + 8} width="5" height="38" />
      <rect className="eq-leg" x={x + w - 9} y={y + 8} width="5" height="38" />
      <path className="eq-thin" d={`M${x + 7},${y + 32} H${x + w - 6}`} />
      <B x={x} y={y} w={w} h={9} d={d} />
    </g>
  );
}
/** ورقی که روی میز خوابیده. */
const Flat = ({ x, y, w = 78, c }) => <polygon className={`eq-sheet ${c}`} points={`${x},${y} ${x + 15},${y - 9} ${x + 15 + w},${y - 9} ${x + w},${y}`} />;

function Stack() {
  return (
    <g>
      <Shade cx={78} rx={66} />
      <B x={24} y={108} w={92} h={6} d={22} c="dark" />
      {[0, 1, 2, 3, 4, 5].map((k) => <B key={k} x={28} y={99 - k * 10} w={84} h={7} d={22} c="wood" />)}
      <path className="eq-edge" d="M28,49 H112" />
    </g>
  );
}

function Bench() {
  return (
    <g>
      <Shade cx={82} />
      <Table />
      <Flat x={26} y={70} c="wood" />
      <path className="eq-line" d="M62,65 l22,-7" />
      <rect className="eq-front" x="80" y="53" width="11" height="7" rx="1.5" transform="rotate(-18 85 56)" />
      <B x={112} y={58} w={20} h={11} d={8} />
      <path className="eq-line" d="M116,58 v-6 h12 v6" />
      <ellipse className="eq-top" cx="37" cy="59" rx="6" ry="2.4" /><rect className="eq-front" x="31" y="59" width="12" height="8" />
    </g>
  );
}

function Sander() {
  return (
    <g>
      <Shade cx={84} rx={76} />
      <Table x={8} w={98} />
      <Flat x={18} y={70} w={70} c="wood" />
      <path className="eq-thin" d="M30,66 h60 M35,63 h60" />
      <ellipse className="eq-disc" cx="60" cy="63" rx="14" ry="4.4" />
      <rect className="eq-front" x="52" y="48" width="16" height="12" rx="3" /><ellipse className="eq-top" cx="60" cy="48" rx="8" ry="2.6" />
      <path className="eq-hose" d="M68,50 C86,32 108,44 124,26" />
      <rect className="eq-front" x="122" y="34" width="28" height="48" /><ellipse className="eq-top" cx="136" cy="34" rx="14" ry="4.6" />
      <polygon className="eq-side" points="122,82 150,82 141,104 131,104" />
      <path className="eq-line" d="M124,82 l-4,34 M148,82 l4,34 M131,104 v6 h10 v-6" />
      <path className="eq-thin" d="M122,48 h28 M122,62 h28" />
      <Fan cx={136} cy={24} r={7} />
    </g>
  );
}

/** کابینِ پاشش: آستر/پرایمر (tone=primed) یا رنگ (tone=gloss). */
function Booth({ tone }) {
  return (
    <g>
      <Shade cx={80} rx={78} />
      <rect className="eq-front" x="100" y="2" width="20" height="22" /><ellipse className="eq-top" cx="110" cy="2.5" rx="10" ry="3.2" />
      <Fan cx={110} cy={13} r={7} />
      <polygon className="eq-top" points="8,22 152,22 132,38 28,38" />
      <polygon className="eq-side" points="8,22 28,38 28,102 8,118" />
      <polygon className="eq-side" points="152,22 132,38 132,102 152,118" />
      <rect className="eq-dark" x="28" y="38" width="104" height="64" />
      <polygon className="eq-floor" points="8,118 152,118 132,102 28,102" />
      <path className="eq-thin" d="M40,38 v64 M52,38 v64 M64,38 v64 M76,38 v64 M88,38 v64 M100,38 v64 M112,38 v64 M124,38 v64 M20,112 h120 M15,115 h130" />
      <polygon className="eq-lamp" points="50,25 110,25 104,31 56,31" />
      <path className="eq-line" d="M34,46 H126 M80,46 v6" />
      <rect className={`eq-sheet ${tone}`} x="64" y="52" width="32" height="44" rx="1" />
      <path className="eq-edge" d="M67,55 v36" />
      <polygon className={`eq-spray ${tone}`} points="38,80 64,58 64,94" />
      <path className="eq-gun" d="M24,78 h14 v4 h-6 l-2,9 h-4 l1,-9 h-3 z" />
      <rect className="eq-frame" x="8" y="22" width="144" height="96" />
    </g>
  );
}

function Inspect() {
  return (
    <g>
      <Shade cx={80} rx={70} />
      <path className="eq-line" d="M52,116 L74,40 M106,116 L84,40 M79,40 L79,116" />
      <path className="eq-line" d="M44,100 H114" />
      <polygon className="eq-sheet gloss" points="50,46 108,46 113,98 45,98" />
      <path className="eq-edge" d="M55,50 L52,94" />
      <polygon className="eq-light" points="126,26 96,34 60,96 118,96" />
      <path className="eq-line" d="M140,116 V28 L118,20" />
      <polygon className="eq-front" points="108,16 124,18 128,28 110,28" />
      <ellipse className="eq-top" cx="140" cy="116" rx="10" ry="2.6" />
      <circle className="eq-glass" cx="30" cy="78" r="11" /><path className="eq-line" d="M38,86 l9,10" />
      <path className="eq-tick" d="M25,78 l4,4 l7,-8" />
    </g>
  );
}

function Pack() {
  return (
    <g>
      <Shade cx={78} rx={72} />
      <B x={16} y={108} w={100} h={6} d={24} c="dark" />
      <B x={20} y={78} w={44} h={30} d={16} c="card" />
      <B x={68} y={84} w={40} h={24} d={16} c="card" />
      <B x={36} y={52} w={42} h={26} d={16} c="card" />
      <path className="eq-thin" d="M42,78 v30 M88,84 v24 M57,52 v26" />
      <rect className="eq-front" x="130" y="84" width="16" height="30" rx="2" /><ellipse className="eq-top" cx="138" cy="84" rx="8" ry="2.6" />
      <path className="eq-thin" d="M130,92 h16 M130,100 h16 M130,108 h16" />
    </g>
  );
}

function Truck() {
  return (
    <g>
      <Shade cx={80} rx={78} />
      <B x={46} y={44} w={92} h={56} d={14} />
      <path className="eq-thin" d="M46,58 h92 M92,44 v56" />
      <B x={14} y={62} w={32} h={38} d={12} />
      <polygon className="eq-glass" points="18,66 40,66 40,80 18,80" />
      <path className="eq-line" d="M14,100 H138" />
      <circle className="eq-wheel" cx="34" cy="106" r="10" /><circle className="eq-hub" cx="34" cy="106" r="4" />
      <circle className="eq-wheel" cx="114" cy="106" r="10" /><circle className="eq-hub" cx="114" cy="106" r="4" />
      <path className="eq-tick" d="M80,74 l8,8 l14,-16" />
    </g>
  );
}

function Rack() {
  return (
    <g>
      <Shade cx={80} rx={66} />
      <path className="eq-line" d="M30,116 V26 M130,116 V26 M48,106 V16 M148,106 V16 M30,26 L48,16 M130,26 L148,16" />
      {[40, 60, 80, 100].map((y) => <polygon key={y} className="eq-sheet primed" points={`30,${y} 48,${y - 10} 148,${y - 10} 130,${y}`} />)}
      <path className="eq-line" d="M30,116 H130 L148,106" />
    </g>
  );
}

function Site() {
  return (
    <g>
      <Shade cx={80} rx={74} />
      <B x={30} y={60} w={78} h={56} d={22} />
      <polygon className="eq-top" points="26,60 69,30 112,60" />
      <polygon className="eq-side" points="112,60 69,30 91,18 134,48" />
      <rect className="eq-dark" x="58" y="84" width="20" height="32" /><rect className="eq-glass" x="84" y="70" width="16" height="14" />
      <path className="eq-line" d="M140,116 V40 M152,116 V40 M140,54 h12 M140,70 h12 M140,86 h12 M140,102 h12" />
    </g>
  );
}

function Generic() {
  return (
    <g>
      <Shade cx={80} rx={68} />
      <B x={28} y={52} w={92} h={62} d={20} />
      <rect className="eq-dark" x="38" y="62" width="44" height="26" rx="2" />
      <circle className="eq-glass" cx="100" cy="76" r="9" /><path className="eq-line" d="M100,76 l5,-5" />
      <path className="eq-thin" d="M38,98 h72 M38,104 h72" />
      <Fan cx={132} cy={34} r={7} />
    </g>
  );
}

const ART = { stack: Stack, bench: Bench, sander: Sander, booth: () => <Booth tone="primed" />, paint: () => <Booth tone="gloss" />,
  inspect: Inspect, pack: Pack, truck: Truck, rack: Rack, site: Site, generic: Generic };

export function Equip({ kind }) {
  const Art = ART[kind] || Generic;
  return <g className="sim-art"><Art /></g>;
}
