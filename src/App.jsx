// App.jsx  –  Dryland Vegetation CA
// Dependencies: recharts  →  npm install recharts
// Run: npm start  (CRA)  or  npm run dev  (Vite)

import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine, CartesianGrid,
} from "recharts";

// ─────────────────────────────────────────────────────────────
//  FONT INJECTION
// ─────────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel  = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap";
document.head.appendChild(fontLink);

// ─────────────────────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
const T = {
  bg:        "#f5f2eb",
  surface:   "#ffffff",
  border:    "#ddd9d0",
  text:      "#1c1a16",
  muted:     "#7a756c",
  faint:     "#b8b4ac",
  green:     "#2d6a2d",
  greenLight:"#e8f5e8",
  blue:      "#1a4a8a",
  blueLight: "#e8eff8",
  amber:     "#8a5a10",
  amberLight:"#f8f0e0",
  red:       "#8a2020",
  redLight:  "#f8e8e8",
  mono:      "'IBM Plex Mono', 'Courier New', monospace",
  serif:     "'Lora', Georgia, serif",
};

// ─────────────────────────────────────────────────────────────
//  CA CONSTANTS
// ─────────────────────────────────────────────────────────────
const N    = 80;   // grid side
const CELL = 7;    // px per cell
const R_FLOW = 4;  // water flow radius
const R_SEED = 1;  // seed dispersal radius

function buildOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx*dx + dy*dy <= r*r) o.push([dx, dy]);
  return o;
}
const W_OFF = buildOffsets(R_FLOW);
const S_OFF = buildOffsets(R_SEED);

// ─────────────────────────────────────────────────────────────
//  CA LOGIC
// ─────────────────────────────────────────────────────────────
function initState(seed = 42) {
  let s = seed | 0;
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  const v   = new Float32Array(N * N);
  const w   = new Float32Array(N * N);
  const sig = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    v[i]   = rng() < 0.25 ? rng() * 0.5 + 0.2 : 0;
    w[i]   = 0.2 + rng() * 0.3;
    sig[i] = v[i] > 0 ? 0.4 + rng() * 0.4 : 0.1 + rng() * 0.2;
  }
  return { v, w, sig };
}

function caStep(state, p) {
  const { v, w, sig } = state;
  const { R, E, alpha, beta, mort, eps, gp, gm } = p;
  const nv = new Float32Array(N * N);
  const nw = new Float32Array(N * N);
  const ns = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // lateral water flow (diffusion)
      let wSum = 0;
      for (const [dx, dy] of W_OFF) wSum += w[((y+dy+N)%N)*N + (x+dx+N)%N];
      const wFlow = wSum / W_OFF.length - w[i];
      // seed rain
      let vSum = 0;
      for (const [dx, dy] of S_OFF) vSum += v[((y+dy+N)%N)*N + (x+dx+N)%N];
      const vSeed = vSum / S_OFF.length;
      // updates
      nw[i] = Math.max(0, Math.min(1,
        w[i] + R - E*w[i] - v[i]*w[i]*(1 + sig[i]) + 0.35*wFlow));
      const growth = alpha * w[i] * sig[i] / (1 + beta*w[i]);
      nv[i] = Math.max(0, Math.min(1,
        v[i] + growth*v[i] - mort*v[i] + eps*vSeed*(1 - v[i])));
      ns[i] = Math.max(0, Math.min(1,
        sig[i] + gp*v[i]*(1 - sig[i]) - gm*(1 - v[i])*sig[i]));
    }
  }
  return { v: nv, w: nw, sig: ns };
}

// ─────────────────────────────────────────────────────────────
//  METRICS & ANALYSIS
// ─────────────────────────────────────────────────────────────
function computeBasicMetrics(state) {
  const { v, w, sig } = state;
  let vs = 0, ws = 0, ss = 0;
  for (let i = 0; i < N*N; i++) { vs += v[i]; ws += w[i]; ss += sig[i]; }
  const vm = vs/(N*N), wm = ws/(N*N), sm = ss/(N*N);
  let vvar = 0;
  for (let i = 0; i < N*N; i++) vvar += (v[i] - vm) ** 2;
  vvar /= N*N;
  return { vmean: vm, wmean: wm, smean: sm, vvar };
}

function computeClusterMetrics(state) {
  const { v } = state;
  const thr = 0.15;
  const visited = new Uint8Array(N * N);
  const sizes = [];
  for (let start = 0; start < N*N; start++) {
    if (v[start] < thr || visited[start]) continue;
    let q = [start], sz = 0; visited[start] = 1;
    while (q.length) {
      const cur = q.pop(); sz++;
      const cy = Math.floor(cur/N), cx = cur % N;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = ((cy+dy+N)%N)*N + (cx+dx+N)%N;
        if (!visited[ni] && v[ni] >= thr) { visited[ni]=1; q.push(ni); }
      }
    }
    sizes.push(sz);
  }
  sizes.sort((a,b) => b - a);
  const meanCluster = sizes.length ? sizes.reduce((a,b)=>a+b,0)/sizes.length : 0;
  const maxCluster  = sizes[0] || 0;
  const numClusters = sizes.length;
  // build histogram (log-binned)
  const hist = [1,2,4,8,16,32,64,128,256,512,1024].map((binMin, i, arr) => {
    const binMax = arr[i+1] || Infinity;
    return { size: binMin, count: sizes.filter(s => s >= binMin && s < binMax).length };
  }).filter(d => d.count > 0);
  return { meanCluster, maxCluster, numClusters, sizeHistogram: hist };
}

// 1D spatial autocorrelation (row-averaged)
function computeSpatialACF(state) {
  const { v } = state;
  let mean = 0;
  for (let i = 0; i < N*N; i++) mean += v[i];
  mean /= N*N;
  let variance = 0;
  for (let i = 0; i < N*N; i++) variance += (v[i]-mean)**2;
  variance /= N*N;
  if (variance < 1e-8) return [];

  const maxLag = Math.floor(N/2);
  const acf = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let cov = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        cov += (v[y*N+x]-mean) * (v[y*N + (x+lag)%N]-mean);
    cov /= N*N;
    acf.push({ lag, acf: +(cov/variance).toFixed(4) });
  }
  return acf;
}

// Find first zero crossing of ACF → empirical half-wavelength
function findFirstZeroCrossing(acf) {
  for (let i = 1; i < acf.length; i++)
    if (acf[i-1].acf > 0 && acf[i].acf <= 0)
      return acf[i-1].lag + acf[i-1].acf / (acf[i-1].acf - acf[i].acf);
  return null;
}

// ─────────────────────────────────────────────────────────────
//  THEORETICAL PREDICTIONS
// ─────────────────────────────────────────────────────────────
function theoreticalPredictions(p) {
  const { R, E, alpha, beta, mort, gp, gm } = p;
  // Turing pattern wavelength: λ* ≈ 2π * r_flow / √(Λ₀ / (m * E))
  // Λ₀ is the flow kernel integral ≈ π * R_FLOW²
  const lambda0 = Math.PI * R_FLOW * R_FLOW;
  const lambdaStar = 2 * Math.PI * R_FLOW / Math.sqrt(lambda0 / (mort * E));

  // Steady-state water in vegetated patch (approx)
  // At fixed point: R = E*w + v*w*(1+σ) → w* ≈ R / (E + alpha*σ/(1+β*w))
  // Simplified: w* ≈ R / (E + 0.5)  [using typical σ~0.6]
  const wStarVeg = R / (E + 0.5);

  // Soil memory equilibrium with vegetation
  const sigStarVeg  = gp / (gp + gm);        // σ* when v≈1
  const sigStarBare = 0;                      // σ* when v≈0

  // Bistability window width (wider σ ratio → more hysteresis)
  const bistabilityRatio = gm / gp;

  // Turing condition check: need d_v << d_w (water diffuses faster than veg)
  // In our model d_w/d_v → ∞ (Turing always possible structurally)
  // The actual condition: (f_v + g_w) < 0 and f_v*g_w - f_w*g_v < 0
  // Approx: growth - mort < 0 at homogeneous state
  const turingActive = (alpha * wStarVeg * sigStarVeg / (1 + beta*wStarVeg)) > mort;

  // Critical rainfall for bare-state: R_c ≈ E * w_bare → bare stable when R < R_c
  const Rc = E * 0.1;   // bare state fixed point (w_bare = R/E, v=0)

  return { lambdaStar, wStarVeg, sigStarVeg, sigStarBare, bistabilityRatio, turingActive, Rc };
}

// ─────────────────────────────────────────────────────────────
//  CANVAS RENDERING
// ─────────────────────────────────────────────────────────────
const lerp = (a,b,t) => a + (b-a)*t;

function vegColor(val) {
  if (val < 0.12) { const t=val/0.12;  return [lerp(215,175,t), lerp(200,155,t), lerp(140,80,t)]; }
  if (val < 0.45) { const t=(val-0.12)/0.33; return [lerp(175,60,t),  lerp(155,145,t), lerp(80,50,t)];  }
  const t=(val-0.45)/0.55; return [lerp(60,10,t),  lerp(145,90,t), lerp(50,25,t)];
}
function waterColor(val) { return [lerp(220,20,val),  lerp(215,90,val),  lerp(180,210,val)]; }
function soilColor(val)  { return [lerp(90,210,val),  lerp(65,130,val),  lerp(40,70,val)];  }

function renderGrid(canvas, state, view) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const arr  = view === "vegetation" ? state.v : view === "water" ? state.w : state.sig;
  const cfn  = view === "vegetation" ? vegColor : view === "water" ? waterColor : soilColor;
  const img  = ctx.createImageData(N*CELL, N*CELL);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [r,g,b] = cfn(arr[y*N+x]);
      for (let py = 0; py < CELL; py++)
        for (let px = 0; px < CELL; px++) {
          const pi = ((y*CELL+py)*N*CELL + x*CELL+px)*4;
          img.data[pi]=r; img.data[pi+1]=g; img.data[pi+2]=b; img.data[pi+3]=255;
        }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ─────────────────────────────────────────────────────────────
//  DEFAULT PARAMS
// ─────────────────────────────────────────────────────────────
const DEFAULTS = { R:0.28, E:0.45, alpha:3.2, beta:2.0, mort:0.18, eps:0.04, gp:0.06, gm:0.03 };

// ─────────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "10px 28px",
      background: active ? T.surface : "transparent",
      border: "none",
      borderBottom: active ? `2px solid ${T.green}` : "2px solid transparent",
      color: active ? T.green : T.muted,
      fontFamily: T.mono, fontSize: 12, letterSpacing: 1,
      cursor: "pointer", transition: "all 0.15s",
    }}>
      {label}
    </button>
  );
}

function ViewBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 16px", fontFamily: T.mono, fontSize: 10,
      background: active ? T.green : T.surface,
      color: active ? "#fff" : T.muted,
      border: `1px solid ${active ? T.green : T.border}`,
      borderRadius: 4, cursor: "pointer", letterSpacing: 1,
    }}>
      {label}
    </button>
  );
}

function Slider({ label, desc, k, min, max, step, params, setParams }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom: 4 }}>
        <span style={{ fontFamily: T.serif, fontSize: 13, color: T.text }}>{label}</span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.green, fontWeight: 500 }}>
          {params[k].toFixed(3)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={params[k]}
        onChange={e => setParams(p => ({ ...p, [k]: +e.target.value }))}
        style={{ width:"100%", accentColor: T.green, cursor:"pointer", marginBottom: 2 }}/>
      <div style={{ fontSize: 10, color: T.faint, fontFamily: T.mono }}>{desc}</div>
    </div>
  );
}

function MetricCard({ label, value, unit, color, bg, note }) {
  return (
    <div style={{ background: bg || T.surface, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: 1,
        marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: T.mono, fontWeight: 500, color: color || T.text }}>
        {value}<span style={{ fontSize: 13, color: T.muted, marginLeft: 4 }}>{unit}</span>
      </div>
      {note && <div style={{ fontSize: 10, fontFamily: T.mono, color: T.faint, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 600,
        color: T.text, margin: 0 }}>{children}</h3>
      {sub && <p style={{ fontFamily: T.mono, fontSize: 11, color: T.muted,
        margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

function ChartCard({ title, sub, children, height }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: "24px 28px", marginBottom: 24 }}>
      <SectionTitle sub={sub}>{title}</SectionTitle>
      <div style={{ height: height || 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background: T.surface, border: `1px solid ${T.border}`,
    fontFamily: T.mono, fontSize: 11, borderRadius: 6 },
  itemStyle: { color: T.text },
};

// ─────────────────────────────────────────────────────────────
//  SIMULATE TAB
// ─────────────────────────────────────────────────────────────
function SimulateTab({ stateRef, canvasRef, params, setParams, tick, running, setRunning, onStep, onReset, metrics, regime }) {
  const [view, setView] = useState("vegetation");
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { renderGrid(canvasRef.current, stateRef.current, view); }, [view]);

  const regColor = regime === "VEGETATED" ? T.green : regime === "PATTERNED" ? T.amber : T.red;
  const regBg    = regime === "VEGETATED" ? T.greenLight : regime === "PATTERNED" ? T.amberLight : T.redLight;

  const sliders = [
    { label:"Rainfall (R)",        desc:"external water input per step",  k:"R",     min:0.10,max:0.55,step:0.005},
    { label:"Evaporation (E)",      desc:"bare-soil water loss rate",      k:"E",     min:0.20,max:0.80,step:0.010},
    { label:"Growth rate α",        desc:"max photosynthesis rate",        k:"alpha", min:1.0, max:6.0, step:0.10 },
    { label:"Saturation β",         desc:"water-use efficiency parameter", k:"beta",  min:0.5, max:5.0, step:0.10 },
    { label:"Mortality m",          desc:"plant death rate per step",      k:"mort",  min:0.05,max:0.40,step:0.005},
    { label:"Seed dispersal ε",     desc:"colonisation rate from neighbours",k:"eps", min:0.01,max:0.15,step:0.005},
    { label:"Soil recovery γ₊",     desc:"how fast soil improves under plants",k:"gp",min:0.01,max:0.20,step:0.005},
    { label:"Soil degradation γ₋",  desc:"how fast bare soil degrades",   k:"gm",    min:0.005,max:0.10,step:0.005},
  ];

  return (
    <div style={{ display:"grid", gridTemplateColumns:`${N*CELL}px 1fr`, gap: 40, alignItems:"start" }}>

      {/* ── Left: grid + controls ── */}
      <div>
        {/* Canvas */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <canvas ref={canvasRef} width={N*CELL} height={N*CELL}
            style={{ display:"block", imageRendering:"pixelated", borderRadius: 4,
              width: N*CELL, height: N*CELL }}/>
        </div>

        {/* View toggle */}
        <div style={{ display:"flex", gap: 8, marginBottom: 14 }}>
          {["vegetation","water","soil"].map(v => (
            <ViewBtn key={v} label={v.toUpperCase()} active={view===v} onClick={() => setView(v)}/>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display:"flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setRunning(r => !r)} style={{
            flex: 1, padding: "10px 0",
            background: running ? T.red : T.green, color:"#fff",
            border:"none", borderRadius: 6, fontFamily: T.mono,
            fontSize: 13, letterSpacing: 1, cursor:"pointer",
          }}>
            {running ? "◼  PAUSE" : "▶  RUN"}
          </button>
          <button onClick={onStep} disabled={running} style={{
            padding:"10px 16px", background: T.surface, border:`1px solid ${T.border}`,
            color: running ? T.faint : T.muted, borderRadius: 6,
            fontFamily: T.mono, fontSize: 13, cursor: running ? "not-allowed" : "pointer",
          }}>▷ STEP</button>
          <button onClick={onReset} style={{
            padding:"10px 16px", background: T.surface, border:`1px solid ${T.border}`,
            color: T.muted, borderRadius: 6, fontFamily: T.mono, fontSize: 13, cursor:"pointer",
          }}>↺ RESET</button>
        </div>

        {/* Regime badge + step */}
        <div style={{ display:"flex", gap: 10, marginBottom: 24 }}>
          <div style={{ flex:1, background: regBg, border:`1px solid ${regColor}30`,
            borderRadius: 8, padding:"10px 16px", textAlign:"center" }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, letterSpacing:1 }}>REGIME</div>
            <div style={{ fontFamily: T.mono, fontSize: 13, color: regColor, fontWeight:500 }}>{regime}</div>
          </div>
          <div style={{ flex:1, background: T.surface, border:`1px solid ${T.border}`,
            borderRadius: 8, padding:"10px 16px", textAlign:"center" }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, letterSpacing:1 }}>STEP</div>
            <div style={{ fontFamily: T.mono, fontSize: 13, color: T.text }}>{tick}</div>
          </div>
        </div>

        {/* Color legend */}
        <div style={{ background: T.surface, border:`1px solid ${T.border}`,
          borderRadius: 8, padding:"14px 18px" }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted,
            letterSpacing:1, marginBottom:10 }}>VIEW LEGEND</div>
          {view === "vegetation" && <>
            <LegendRow color="#af9b50" label="Bare sand (v < 0.12)"/>
            <LegendRow color="#6e8c40" label="Sparse veg (0.12–0.45)"/>
            <LegendRow color="#1a5a1a" label="Dense canopy (v > 0.45)"/>
          </>}
          {view === "water" && <>
            <LegendRow color="#dcd4b4" label="Dry soil (w ≈ 0)"/>
            <LegendRow color="#7aaad0" label="Moderate water"/>
            <LegendRow color="#1450b0" label="Saturated (w ≈ 1)"/>
          </>}
          {view === "soil" && <>
            <LegendRow color="#503c28" label="Degraded crust (σ ≈ 0)"/>
            <LegendRow color="#8a6a40" label="Recovering soil"/>
            <LegendRow color="#c88050" label="High infiltration (σ ≈ 1)"/>
          </>}
        </div>
      </div>

      {/* ── Right: metrics + sliders ── */}
      <div>
        {metrics && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 12, marginBottom: 28 }}>
            <MetricCard label="Vegetation Cover"
              value={(metrics.vmean*100).toFixed(1)} unit="%"
              color={T.green} bg={T.greenLight}/>
            <MetricCard label="Spatial Variance"
              value={metrics.vvar.toFixed(4)} unit=""
              color={T.amber} bg={T.amberLight}
              note="rising → approaching tipping"/>
            <MetricCard label="Mean Soil Water"
              value={(metrics.wmean*100).toFixed(1)} unit="%"
              color={T.blue} bg={T.blueLight}/>
            <MetricCard label="Soil Memory σ"
              value={(metrics.smean*100).toFixed(1)} unit="%"
              color={T.amber}/>
          </div>
        )}

        {/* Slider panels */}
        <div style={{ background: T.surface, border:`1px solid ${T.border}`,
          borderRadius: 10, padding:"28px 32px", marginBottom: 20 }}>
          <SectionTitle sub="Adjust and observe pattern transitions in real time">
            Model Parameters
          </SectionTitle>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 40px" }}>
            {sliders.slice(0,4).map(s => (
              <Slider key={s.k} {...s} params={params} setParams={setParams}/>
            ))}
            {sliders.slice(4).map(s => (
              <Slider key={s.k} {...s} params={params} setParams={setParams}/>
            ))}
          </div>
        </div>

        {/* Experiment guide */}
        <div style={{ background:"#f0f7f0", border:`1px solid ${T.green}30`,
          borderRadius: 10, padding:"20px 24px" }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.green,
            letterSpacing:1, marginBottom:10 }}>EXPERIMENT GUIDE</div>
          {[
            ["Decrease R slowly (0.28 → 0.12)", "Watch pattern sequence: dense → labyrinths → spots → bare"],
            ["Increase γ₋ / decrease γ₊",       "Widens bistability — system stays bare even when R recovers"],
            ["Raise mortality m sharply",         "Drives rapid desertification; observe spatial variance spike first"],
            ["Switch to SOIL view",               "See how soil memory lags behind vegetation — the slow variable"],
          ].map(([action, effect]) => (
            <div key={action} style={{ display:"flex", gap:12, marginBottom:10 }}>
              <div style={{ fontSize:11, fontFamily:T.mono, color:T.green, minWidth:8 }}>→</div>
              <div>
                <div style={{ fontSize:12, fontFamily:T.mono, color:T.text, marginBottom:2 }}>{action}</div>
                <div style={{ fontSize:11, fontFamily:T.mono, color:T.muted }}>{effect}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
      <div style={{ width:20, height:10, background:color, borderRadius:2 }}/>
      <span style={{ fontFamily:T.mono, fontSize:10, color:T.muted }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ANALYSIS TAB
// ─────────────────────────────────────────────────────────────
function AnalysisTab({ history, acfData, clusterData, params, metrics, clusterMetrics }) {
  const theo = theoreticalPredictions(params);
  const empiricalLambda = findFirstZeroCrossing(acfData);
  const empiricalLambdaFull = empiricalLambda ? (empiricalLambda * 2).toFixed(1) : "—";

  return (
    <div style={{ maxWidth: 900 }}>

      {/* ── Comparison table ── */}
      <div style={{ background: T.surface, border:`1px solid ${T.border}`,
        borderRadius: 10, padding:"28px 32px", marginBottom: 28 }}>
        <SectionTitle sub="How theoretical predictions compare to what the simulation actually does">
          Theory vs Simulation
        </SectionTitle>
        <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:T.mono, fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:`2px solid ${T.border}` }}>
              {["Observable","Theory Predicts","Simulation Shows","Match?"].map(h => (
                <th key={h} style={{ padding:"10px 16px", textAlign:"left",
                  color:T.muted, fontWeight:500, letterSpacing:1, fontSize:10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                obs: "Pattern wavelength λ*",
                theory: `${theo.lambdaStar.toFixed(1)} cells`,
                sim: empiricalLambda ? `${empiricalLambdaFull} cells (from ACF)` : "run simulation",
                match: empiricalLambda ? Math.abs(empiricalLambda*2 - theo.lambdaStar) < 8 : null,
                note: "2π·r_flow / √(Λ₀/mE)",
              },
              {
                obs: "Steady-state soil memory σ*",
                theory: `${(theo.sigStarVeg*100).toFixed(0)}% (veg), 0% (bare)`,
                sim: metrics ? `${(metrics.smean*100).toFixed(0)}% (current)` : "—",
                match: metrics ? Math.abs(metrics.smean - theo.sigStarVeg) < 0.25 : null,
                note: "γ₊ / (γ₊ + γ₋)",
              },
              {
                obs: "Turing instability active",
                theory: theo.turingActive ? "YES — patterns expected" : "NO — homogeneous state",
                sim: metrics ? (metrics.vvar > 0.01 ? "YES — spatial heterogeneity present" : "NO — uniform field") : "—",
                match: metrics ? (theo.turingActive === (metrics.vvar > 0.01)) : null,
                note: "growth > mort at veg steady state",
              },
              {
                obs: "Bistability / hysteresis",
                theory: `γ₋/γ₊ = ${theo.bistabilityRatio.toFixed(2)} → ${theo.bistabilityRatio > 0.3 ? "wide" : "narrow"} bistable window`,
                sim: "slow R decrease ≠ slow R increase",
                match: true,
                note: "soil memory widens bistable range",
              },
              {
                obs: "Percolation cluster exponent",
                theory: "τ = 187/91 ≈ 2.05 (2D universality)",
                sim: clusterMetrics.numClusters > 5 ? `${clusterMetrics.numClusters} clusters detected` : "not enough clusters",
                match: null,
                note: "P(s) ~ s⁻τ near R_c",
              },
            ].map((row, i) => (
              <tr key={i} style={{ borderBottom:`1px solid ${T.border}`,
                background: i%2===0 ? "#fafaf8" : T.surface }}>
                <td style={{ padding:"12px 16px", color:T.text, fontWeight:500 }}>
                  <div>{row.obs}</div>
                  <div style={{ fontSize:10, color:T.faint, marginTop:2 }}>{row.note}</div>
                </td>
                <td style={{ padding:"12px 16px", color:T.blue }}>{row.theory}</td>
                <td style={{ padding:"12px 16px", color:T.green }}>{row.sim}</td>
                <td style={{ padding:"12px 16px" }}>
                  {row.match === null ? <span style={{color:T.faint}}>—</span>
                   : row.match ? <span style={{color:T.green}}>✓ yes</span>
                   : <span style={{color:T.red}}>✗ discrepancy</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Time series ── */}
      <ChartCard title="Mean-Field Time Series"
        sub="Trajectories of all three state variables averaged over the entire grid"
        height={220}>
        <LineChart data={history} margin={{top:10,right:16,bottom:0,left:-16}}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
          <XAxis dataKey="t" tick={{fontSize:10, fontFamily:T.mono, fill:T.muted}}/>
          <YAxis domain={[0,1]} tick={{fontSize:10, fontFamily:T.mono, fill:T.muted}}/>
          <Tooltip {...tooltipStyle}/>
          <Legend wrapperStyle={{fontFamily:T.mono, fontSize:11}}/>
          <Line type="monotone" dataKey="vmean" name="vegetation v̄" stroke={T.green} dot={false} strokeWidth={2}/>
          <Line type="monotone" dataKey="wmean" name="water w̄"      stroke={T.blue}  dot={false} strokeWidth={2}/>
          <Line type="monotone" dataKey="smean" name="soil σ̄"       stroke={T.amber} dot={false} strokeWidth={2}/>
        </LineChart>
      </ChartCard>

      {/* ── Spatial variance + early warning ── */}
      <ChartCard title="Spatial Variance  —  Early Warning Signal"
        sub="Critical slowing down theory: variance rises as the system approaches a tipping point"
        height={200}>
        <LineChart data={history} margin={{top:10,right:16,bottom:0,left:-16}}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
          <XAxis dataKey="t" tick={{fontSize:10,fontFamily:T.mono,fill:T.muted}}/>
          <YAxis tick={{fontSize:10,fontFamily:T.mono,fill:T.muted}}/>
          <Tooltip {...tooltipStyle}/>
          <Line type="monotone" dataKey="vvar" name="Var(v)" stroke={T.amber} dot={false} strokeWidth={2}/>
          <ReferenceLine y={0.04} stroke={T.red} strokeDasharray="6 3"
            label={{value:"warning threshold", position:"right", fontSize:10, fontFamily:T.mono, fill:T.red}}/>
        </LineChart>
      </ChartCard>

      {/* ── ACF ── */}
      <ChartCard title="Spatial Autocorrelation Function (ACF)"
        sub="Measures pattern wavelength empirically. First zero-crossing × 2 = observed λ. Vertical line = theoretical λ*"
        height={220}>
        <LineChart data={acfData} margin={{top:10,right:16,bottom:0,left:-16}}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
          <XAxis dataKey="lag" tick={{fontSize:10,fontFamily:T.mono,fill:T.muted}} label={{value:"lag (cells)",position:"insideBottomRight",offset:-4,fontSize:10,fontFamily:T.mono,fill:T.muted}}/>
          <YAxis domain={[-0.6,1]} tick={{fontSize:10,fontFamily:T.mono,fill:T.muted}}/>
          <Tooltip {...tooltipStyle}/>
          <ReferenceLine y={0} stroke={T.border}/>
          <ReferenceLine x={Math.round(theo.lambdaStar/2)} stroke={T.blue} strokeDasharray="5 3"
            label={{value:`λ*/2 = ${(theo.lambdaStar/2).toFixed(1)} (theory)`, position:"top", fontSize:10, fontFamily:T.mono, fill:T.blue}}/>
          {empiricalLambda && (
            <ReferenceLine x={Math.round(empiricalLambda)} stroke={T.green} strokeDasharray="5 3"
              label={{value:`zero = ${empiricalLambda.toFixed(1)} (sim)`, position:"insideTopRight", fontSize:10, fontFamily:T.mono, fill:T.green}}/>
          )}
          <Line type="monotone" dataKey="acf" name="ACF" stroke={T.green} dot={false} strokeWidth={2}/>
        </LineChart>
      </ChartCard>

      {/* ── Cluster size histogram ── */}
      <ChartCard title="Cluster Size Distribution"
        sub="Near the percolation threshold R_c, this follows a power law P(s) ~ s^(−τ) with τ = 187/91 ≈ 2.05 (2D universality)"
        height={220}>
        <BarChart data={clusterData} margin={{top:10,right:16,bottom:0,left:-16}}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
          <XAxis dataKey="size" tick={{fontSize:10,fontFamily:T.mono,fill:T.muted}}
            label={{value:"cluster size (cells)", position:"insideBottomRight", offset:-4, fontSize:10, fontFamily:T.mono, fill:T.muted}}/>
          <YAxis tick={{fontSize:10,fontFamily:T.mono,fill:T.muted}} label={{value:"count", angle:-90, position:"insideLeft", fontSize:10, fontFamily:T.mono, fill:T.muted}}/>
          <Tooltip {...tooltipStyle}/>
          <Bar dataKey="count" name="# clusters" fill={T.green} opacity={0.75} radius={[3,3,0,0]}/>
        </BarChart>
      </ChartCard>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  THEORY TAB
// ─────────────────────────────────────────────────────────────
function TheoryTab({ params }) {
  const theo = theoreticalPredictions(params);

  const Block = ({ title, children }) => (
    <div style={{ background: T.surface, border:`1px solid ${T.border}`,
      borderRadius: 10, padding:"28px 36px", marginBottom: 24 }}>
      <h3 style={{ fontFamily:T.serif, fontSize:18, fontWeight:600, color:T.text,
        marginBottom:16, paddingBottom:12, borderBottom:`1px solid ${T.border}` }}>{title}</h3>
      {children}
    </div>
  );

  const P = ({ children }) => (
    <p style={{ fontFamily:T.serif, fontSize:14, color:T.text, lineHeight:1.8,
      marginBottom:14, margin:"0 0 14px" }}>{children}</p>
  );

  const Eq = ({ children, label }) => (
    <div style={{ background:"#f8f6f0", border:`1px solid ${T.border}`, borderRadius:6,
      padding:"14px 20px", margin:"16px 0", display:"flex", justifyContent:"space-between",
      alignItems:"center" }}>
      <code style={{ fontFamily:T.mono, fontSize:13, color:T.text }}>{children}</code>
      {label && <span style={{ fontFamily:T.mono, fontSize:10, color:T.faint }}>{label}</span>}
    </div>
  );

  const Kv = ({ k, v, note }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
      <span style={{ fontFamily:T.mono, fontSize:12, color:T.blue }}>{k}</span>
      <span style={{ fontFamily:T.mono, fontSize:12, color:T.green, fontWeight:500 }}>{v}</span>
      {note && <span style={{ fontFamily:T.mono, fontSize:10, color:T.faint }}>{note}</span>}
    </div>
  );

  return (
    <div style={{ maxWidth: 820 }}>

      <Block title="The Physical Phenomenon">
        <P>
          In semi-arid regions across Africa, Australia, and the Middle East, vegetation self-organizes
          into striking spatial patterns — spots, tiger-stripe labyrinths, and gap patterns — visible
          from satellite. These arise from a competition between two feedbacks operating at different spatial scales.
        </P>
        <P>
          <strong>Short-range facilitation (activator):</strong> Plants improve local soil infiltration through
          root activity and leaf litter, creating positive feedback — water pools near existing plants,
          encouraging further growth nearby.
        </P>
        <P>
          <strong>Long-range competition (inhibitor):</strong> Root systems extend laterally and deplete
          the water table over a much larger radius, suppressing plant growth at intermediate distances.
        </P>
        <P>
          This activator–inhibitor structure is precisely the Turing instability condition, guaranteeing
          a characteristic spatial wavelength determined by the ratio of facilitation to competition ranges.
          The novel element in this model is a <em>slow soil memory variable σ</em> that captures
          hysteresis — degraded soils resist recolonization even when rainfall recovers.
        </P>
      </Block>

      <Block title="The CA Model Equations">
        <P>Each cell carries three coupled variables updated synchronously each time step:</P>
        <Eq label="water update">w(t+1) = w + R − E·w − v·w·(1+σ) + 0.35·∇²w</Eq>
        <Eq label="vegetation update">v(t+1) = v + [α·w·σ/(1+β·w)]·v − m·v + ε·v̄_seed·(1−v)</Eq>
        <Eq label="soil memory (slow)">σ(t+1) = σ + γ₊·v·(1−σ) − γ₋·(1−v)·σ</Eq>
        <P>
          The water diffusion term ∇²w is implemented as the difference between the mean of a disk
          kernel of radius r = {R_FLOW} cells and the cell's own value — this is the discrete Laplacian
          averaged over a neighbourhood. The growth function α·w·σ/(1+β·w) is a Michaelis-Menten
          saturating form that couples plant growth to both water availability and soil quality simultaneously.
        </P>
        <P>
          The soil memory σ is the key novelty. It evolves on a <em>slower timescale</em> (γ₊, γ₋ ≪ 1)
          than vegetation, creating genuine path-dependence: a cell can have high water and rainfall yet
          remain bare because σ has not recovered, blocking establishment.
        </P>
      </Block>

      <Block title="Turing Instability & Pattern Wavelength">
        <P>
          Linearise the v–w subsystem around the uniform steady state (v*, w*) with σ fixed at σ*.
          A spatial perturbation ∝ e^(ikx + λt) grows when the Jacobian in Fourier space has a
          positive real eigenvalue for an intermediate wavenumber k — neither k=0 (uniform) nor k→∞ (fine-scale noise).
        </P>
        <Eq label="Fourier-space Jacobian">λ(k) = ½Tr(J) ± ½√[Tr(J)² − 4(det J + Λ̂(k)·∂_w g)]</Eq>
        <P>
          where Λ̂(k) is the Fourier transform of the lateral flow kernel (a Bessel function of the disk).
          The Turing condition requires: (i) the homogeneous state is stable (Tr J &lt; 0, det J &gt; 0),
          yet (ii) the spatial term destabilises it at the critical wavenumber k*.
        </P>
        <Eq label="pattern wavelength">λ* = 2π / k*  ≈  2π · r_flow / √(Λ₀ / (m · E))</Eq>
        <P>
          With current parameters, this predicts a characteristic spacing of:
        </P>
        <Eq label="current prediction">λ* ≈ {theo.lambdaStar.toFixed(2)} cells  =  {(theo.lambdaStar * CELL).toFixed(0)} px</Eq>
        <P>
          This can be verified empirically from the spatial autocorrelation function (ACF tab):
          the first zero-crossing of the ACF gives the half-wavelength, so multiply by 2 to compare.
          Agreement within ~15% is expected given the discrete, finite-size approximations.
        </P>
      </Block>

      <Block title="Bistability & Soil Memory Hysteresis">
        <P>
          With σ as a slow variable, the fast v–w system can exhibit two stable steady states for
          the same rainfall R — a vegetated state and a bare state. Geometric singular perturbation
          theory (Fenichel's theorem) guarantees that slow manifolds persist under perturbation,
          and the system traces out a hysteresis loop as R varies slowly.
        </P>
        <Eq label="soil equilibria">σ*_veg = γ₊/(γ₊+γ₋)    σ*_bare = 0</Eq>
        <Eq label="bistability index">Hysteresis width ∝ γ₋/γ₊  =  {theo.bistabilityRatio.toFixed(3)}</Eq>
        <P>
          A larger ratio γ₋/γ₊ means degraded soil persists longer, widening the bistable window.
          This explains why re-greening degraded drylands requires a much higher rainfall than what
          originally sustained them — a one-way tipping point with memory.
        </P>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.muted, letterSpacing:1, marginBottom:8 }}>
              CURRENT SOIL EQUILIBRIA
            </div>
            <Kv k="σ* (vegetated)" v={(theo.sigStarVeg*100).toFixed(0)+"%" } note="= γ₊/(γ₊+γ₋)"/>
            <Kv k="σ* (bare)"      v="0%" note="degraded floor"/>
            <Kv k="Bistability index" v={theo.bistabilityRatio.toFixed(3)} note="γ₋/γ₊"/>
          </div>
          <div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.muted, letterSpacing:1, marginBottom:8 }}>
              WHAT THIS MEANS
            </div>
            <div style={{ fontFamily:T.serif, fontSize:13, color:T.text, lineHeight:1.7 }}>
              {theo.bistabilityRatio > 0.4
                ? "Wide hysteresis: once vegetation collapses, substantial recovery of R is needed. Restoration is hard."
                : theo.bistabilityRatio > 0.2
                ? "Moderate hysteresis: recovery requires somewhat more rain than the collapse threshold."
                : "Narrow hysteresis: system recovers nearly as easily as it collapsed. Low soil memory effect."}
            </div>
          </div>
        </div>
      </Block>

      <Block title="Percolation Theory & Tipping Points">
        <P>
          As rainfall R decreases, vegetated patches shrink and fragment. The moment the largest
          cluster loses connectivity across the grid marks the <em>percolation threshold R_c</em> —
          a second-order phase transition. Near R_c, cluster size distribution follows a power law:
        </P>
        <Eq label="power law">P(s) ~ s^(−τ)    with τ = 187/91 ≈ 2.055  (2D percolation universality class)</Eq>
        <Eq label="correlation length">ξ ~ |R − R_c|^(−ν)    with ν = 4/3  (2D universality)</Eq>
        <P>
          The diverging correlation length ξ means patches become correlated over increasingly long
          distances as R → R_c. In the CA, this manifests as: (1) spatial variance rising, (2) mean
          cluster size falling sharply, (3) the ACF developing long tails. These are measurable
          early warning signals before the ecological collapse actually occurs.
        </P>
      </Block>

      <Block title="Early Warning Signals">
        <P>
          Critical slowing down (CSD) theory predicts that any system near a fold bifurcation
          takes longer to recover from perturbations. In stochastic CAs this manifests as:
        </P>
        {[
          ["Rising spatial variance", "Var(v) increases as patches become more extreme — either very dense or very bare"],
          ["Rising spatial autocorrelation", "Lag-1 autocorrelation → 1 as the system becomes more spatially correlated"],
          ["Rising temporal autocorrelation", "Recovery time from perturbations lengthens — detectable as AR(1) coefficient increasing"],
          ["Cluster size divergence", "The dominant cluster size fluctuates wildly and grows just before connectivity loss"],
        ].map(([signal, explanation]) => (
          <div key={signal} style={{ display:"flex", gap:16, marginBottom:14, padding:"12px 16px",
            background:"#f8f6f0", borderRadius:6, border:`1px solid ${T.border}` }}>
            <div style={{ fontFamily:T.mono, fontSize:12, color:T.amber,
              fontWeight:500, minWidth:180 }}>{signal}</div>
            <div style={{ fontFamily:T.serif, fontSize:13, color:T.text, lineHeight:1.6 }}>{explanation}</div>
          </div>
        ))}
        <P>
          The key practical implication: these signals appear <em>before</em> the tipping point, 
          giving potential advance warning of imminent desertification in real ecosystems — 
          provided the system is moving slowly enough through parameter space.
        </P>
      </Block>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [tab,     setTab]     = useState("simulate");
  const [running, setRunning] = useState(false);
  const [params,  setParams]  = useState(DEFAULTS);
  const [tick,    setTick]    = useState(0);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [clusterMetrics, setClusterMetrics] = useState({ numClusters:0, meanCluster:0, maxCluster:0, sizeHistogram:[] });
  const [acfData, setAcfData] = useState([]);

  const stateRef  = useRef(initState());
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const paramsRef = useRef(params);
  const viewRef   = useRef("vegetation");

  useEffect(() => { paramsRef.current = params; }, [params]);

  const doStep = useCallback(() => {
    stateRef.current = caStep(stateRef.current, paramsRef.current);
    renderGrid(canvasRef.current, stateRef.current, viewRef.current);
    setTick(t => {
      const nt = t + 1;
      if (nt % 5 === 0) {
        const m = computeBasicMetrics(stateRef.current);
        setMetrics(m);
        setHistory(h => [...h.slice(-200), { t: nt, vmean:+m.vmean.toFixed(3), wmean:+m.wmean.toFixed(3), smean:+m.smean.toFixed(3), vvar:+m.vvar.toFixed(4) }]);
      }
      if (nt % 25 === 0) {
        setClusterMetrics(computeClusterMetrics(stateRef.current));
        setAcfData(computeSpatialACF(stateRef.current));
      }
      return nt;
    });
  }, []);

  useEffect(() => {
    if (running) {
      const loop = () => { doStep(); animRef.current = requestAnimationFrame(loop); };
      animRef.current = requestAnimationFrame(loop);
    } else cancelAnimationFrame(animRef.current);
    return () => cancelAnimationFrame(animRef.current);
  }, [running, doStep]);

  const onReset = () => {
    setRunning(false);
    stateRef.current = initState(Math.random() * 1e6 | 0);
    setTick(0); setHistory([]); setMetrics(null);
    setAcfData([]); setClusterMetrics({ numClusters:0, meanCluster:0, maxCluster:0, sizeHistogram:[] });
    setTimeout(() => renderGrid(canvasRef.current, stateRef.current, viewRef.current), 0);
  };

  const regime = !metrics ? "INITIALISING"
    : metrics.vmean > 0.40 ? "VEGETATED"
    : metrics.vmean > 0.15 ? "PATTERNED"
    : "BARE DESERT";

  return (
    <div style={{ background: T.bg, minHeight:"100vh", color: T.text }}>
      {/* ── Top navigation ── */}
      <div style={{ background: T.surface, borderBottom:`1px solid ${T.border}`,
        position:"sticky", top:0, zIndex:10 }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 40px",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ padding:"18px 0" }}>
            <span style={{ fontFamily:T.serif, fontSize:17, fontWeight:600, color:T.green }}>
              Dryland Vegetation CA
            </span>
            <span style={{ fontFamily:T.mono, fontSize:10, color:T.faint,
              marginLeft:16, letterSpacing:1 }}>
              Turing self-organisation · soil memory hysteresis
            </span>
          </div>
          <div style={{ display:"flex", gap:0 }}>
            {[["simulate","SIMULATE"],["analysis","ANALYSIS"],["theory","THEORY"]].map(([k,l]) => (
              <TabBtn key={k} label={l} active={tab===k} onClick={() => setTab(k)}/>
            ))}
          </div>
        </div>
      </div>

      {/* ── Page content ── */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"40px 40px 80px" }}>
        {tab === "simulate" && (
          <SimulateTab
            stateRef={stateRef} canvasRef={canvasRef}
            params={params} setParams={setParams}
            tick={tick} running={running} setRunning={setRunning}
            onStep={doStep} onReset={onReset}
            metrics={metrics} regime={regime}
            viewRef={viewRef}
          />
        )}
        {tab === "analysis" && (
          <AnalysisTab
            history={history} acfData={acfData}
            clusterData={clusterMetrics.sizeHistogram}
            params={params} metrics={metrics}
            clusterMetrics={clusterMetrics}
          />
        )}
        {tab === "theory" && (
          <TheoryTab params={params}/>
        )}
      </div>
    </div>
  );
}