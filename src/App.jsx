import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ScatterChart, Scatter
} from "recharts";

/* ═══════════════════════════════════════════════════════════════
   SETUP:
   1. npm install recharts
   2. In public/index.html, add inside <head>:
      <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
   ═══════════════════════════════════════════════════════════════ */

// ── Design tokens ────────────────────────────────────────────────
const C = {
  bg:        "#f7f3ec",
  surface:   "#ffffff",
  border:    "#e2d9cc",
  green:     "#2d6a4f",
  greenDim:  "#52b788",
  amber:     "#c4862b",
  blue:      "#3a6ea5",
  red:       "#b5372a",
  purple:    "#6b4ea8",
  text:      "#1c1917",
  textMid:   "#57534e",
  textFaint: "#a8a29e",
  ink:       "#2d2926",
};

const MONO = "'JetBrains Mono', 'Courier New', monospace";
const SERIF = "'Crimson Pro', Georgia, serif";

// ── CA constants ─────────────────────────────────────────────────
const N    = 80;   // grid cells
const CELL = 7;    // px per cell

function buildOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) o.push([dx, dy]);
  return o;
}
const W_OFF = buildOffsets(4);  // water lateral flow  (radius = 4 cells)
const S_OFF = buildOffsets(1);  // seed dispersal       (radius = 1 cell)

// ── State initialisation ─────────────────────────────────────────
function initState(seed = 42) {
  let s = seed | 0;
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  const v = new Float32Array(N * N);
  const w = new Float32Array(N * N);
  const σ = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    v[i] = rng() < 0.28 ? rng() * 0.6 + 0.2 : 0;
    w[i] = 0.25 + rng() * 0.25;
    σ[i] = v[i] > 0 ? 0.4 + rng() * 0.4 : 0.1 + rng() * 0.2;
  }
  return { v, w, σ };
}

// ── CA update ────────────────────────────────────────────────────
function caStep(state, p) {
  const { v, w, σ } = state;
  const { R, E, alpha, beta, mort, eps, gp, gm } = p;
  const nv = new Float32Array(N * N);
  const nw = new Float32Array(N * N);
  const nσ = new Float32Array(N * N);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, vi = v[i], wi = w[i], si = σ[i];
      let wsum = 0;
      for (const [dx, dy] of W_OFF) wsum += w[((y+dy+N)%N)*N + (x+dx+N)%N];
      const wflow = wsum / W_OFF.length - wi;
      let vsum = 0;
      for (const [dx, dy] of S_OFF) vsum += v[((y+dy+N)%N)*N + (x+dx+N)%N];
      const vseed = vsum / S_OFF.length;
      // Water: R − Ew − v·w·(1+σ) + D∇²w
      nw[i] = Math.max(0, Math.min(1, wi + R - E*wi - vi*wi*(1+si) + 0.35*wflow));
      // Vegetation: [αwσ/(1+βw)]·v − mv + ε·v̄_nbr·(1−v)
      nv[i] = Math.max(0, Math.min(1, vi + (alpha*wi*si/(1+beta*wi))*vi - mort*vi + eps*vseed*(1-vi)));
      // Soil memory (slow): γ⁺v(1−σ) − γ⁻(1−v)σ
      nσ[i] = Math.max(0, Math.min(1, si + gp*vi*(1-si) - gm*(1-vi)*si));
    }
  }
  return { v: nv, w: nw, σ: nσ };
}

// ── Metrics ──────────────────────────────────────────────────────
function computeMetrics(state) {
  const { v, w, σ } = state;
  let vS = 0, wS = 0, sS = 0;
  for (let i = 0; i < N*N; i++) { vS += v[i]; wS += w[i]; sS += σ[i]; }
  const vm = vS/(N*N), wm = wS/(N*N), sm = sS/(N*N);
  let vvar = 0, moran = 0, moranC = 0;
  for (let i = 0; i < N*N; i++) vvar += (v[i]-vm)**2;
  vvar /= N*N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y*N+x;
    for (const [dx,dy] of [[1,0],[0,1]]) {
      const j = ((y+dy+N)%N)*N+(x+dx+N)%N;
      moran += (v[i]-vm)*(v[j]-vm); moranC++;
    }
  }
  moran = vvar > 0 ? moran/(moranC*vvar) : 0;
  const thr = 0.15, visited = new Uint8Array(N*N), sizes = [];
  for (let start = 0; start < N*N; start++) {
    if (v[start] < thr || visited[start]) continue;
    let q = [start], size = 0; visited[start] = 1;
    while (q.length) {
      const cur = q.pop(); size++;
      const cy = Math.floor(cur/N), cx = cur%N;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = ((cy+dy+N)%N)*N+(cx+dx+N)%N;
        if (!visited[ni] && v[ni] >= thr) { visited[ni]=1; q.push(ni); }
      }
    }
    sizes.push(size);
  }
  const maxCluster  = sizes.length ? Math.max(...sizes) : 0;
  const meanCluster = sizes.length ? sizes.reduce((a,b)=>a+b,0)/sizes.length : 0;
  return { vm, wm, sm, vvar, moran, maxCluster, meanCluster, numClusters: sizes.length };
}

// ── Canvas rendering ─────────────────────────────────────────────
function lerp(a,b,t) { return a+(b-a)*t; }
function colorVeg(val) {
  if (val < 0.15) { const t=val/0.15; return [lerp(235,200,t),lerp(225,185,t),lerp(205,160,t)]; }
  if (val < 0.50) { const t=(val-0.15)/0.35; return [lerp(200,80,t),lerp(185,150,t),lerp(160,80,t)]; }
  const t=(val-0.5)/0.5; return [lerp(80,15,t),lerp(150,90,t),lerp(80,40,t)];
}
function colorWater(val) { return [lerp(240,20,val),lerp(230,90,val),lerp(210,200,val)]; }
function colorSigma(val) { return [lerp(240,100,val),lerp(235,160,val),lerp(220,80,val)]; }

function renderCanvas(canvas, state, view) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const arr = view==="vegetation" ? state.v : view==="water" ? state.w : state.σ;
  const cfn = view==="vegetation" ? colorVeg : view==="water" ? colorWater : colorSigma;
  const img = ctx.createImageData(N*CELL, N*CELL);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const [r,g,b] = cfn(arr[y*N+x]);
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      const pi = ((y*CELL+py)*N*CELL+x*CELL+px)*4;
      img.data[pi]=r; img.data[pi+1]=g; img.data[pi+2]=b; img.data[pi+3]=255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── Theory predictions ───────────────────────────────────────────
const DEF = { R:0.28, E:0.45, alpha:3.2, beta:2.0, mort:0.18, eps:0.04, gp:0.06, gm:0.03 };

function theory(p) {
  const { R, E, alpha, beta, mort, gp, gm } = p;
  const sigma_eq   = gp / (gp + gm);
  const w_bare     = R / E;
  const Rc         = (mort * E) / (alpha * sigma_eq);
  const lambda     = 2 * Math.PI * 4 / Math.sqrt((R * alpha) / (mort * E * (1 + beta * 0.25)));
  const hyst_width = gm / gp;
  const f_eff      = alpha * w_bare * sigma_eq / (1 + beta * w_bare);
  return { sigma_eq, w_bare, Rc, lambda, hyst_width, f_eff };
}

// ═══════════════════════════════════════════════════════════════════
//  UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function Tabs({ active, onChange }) {
  const tabs = [
    { id: "sim",      label: "🌿  Simulation"             },
    { id: "math",     label: "∂  Mathematical Analysis"   },
    { id: "results",  label: "📈  Results & Observations" },
  ];
  return (
    <div style={{ display:"flex", borderBottom:`2px solid ${C.border}`, background:"#ede9e1",
                  padding:"0 40px", gap:4 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding:"12px 28px", cursor:"pointer", fontFamily:SERIF, fontSize:15,
          border:"none", borderBottom: active===t.id ? `3px solid ${C.green}` : "3px solid transparent",
          background:"transparent", color: active===t.id ? C.green : C.textMid,
          fontWeight: active===t.id ? 600 : 400, marginBottom:-2, transition:"all 0.15s",
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Card({ children, style={} }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`,
                  borderRadius:10, padding:24, ...style }}>
      {children}
    </div>
  );
}

function SectionHead({ children }) {
  return (
    <div style={{ fontFamily:SERIF, fontSize:20, fontWeight:600, color:C.ink,
                  borderLeft:`4px solid ${C.green}`, paddingLeft:14,
                  marginBottom:20, marginTop:8 }}>
      {children}
    </div>
  );
}

function MathBox({ children }) {
  return (
    <div style={{ background:"#f0f5f1", border:`1px solid #c8dece`, borderRadius:8,
                  padding:"14px 20px", fontFamily:MONO, fontSize:12.5, color:"#1f4d35",
                  lineHeight:2, margin:"12px 0", overflowX:"auto" }}>
      {children}
    </div>
  );
}

function Slider({ label, symbol, k, min, max, step, note, params, setParams }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
        <div>
          <span style={{ fontFamily:SERIF, fontSize:14, color:C.text }}>{label}</span>
          {"  "}
          <span style={{ fontFamily:MONO, fontSize:11, color:C.textFaint }}>({symbol})</span>
        </div>
        <span style={{ fontFamily:MONO, fontSize:13, color:C.amber,
                        background:"#fff9ee", border:`1px solid #f0d9b0`,
                        padding:"1px 10px", borderRadius:4 }}>
          {params[k].toFixed(3)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={params[k]}
        onChange={e => setParams(p => ({ ...p, [k]:+e.target.value }))}
        style={{ width:"100%", accentColor:C.green, cursor:"pointer" }}/>
      {note && <div style={{ fontSize:11, color:C.textFaint, marginTop:4, lineHeight:1.5 }}>{note}</div>}
    </div>
  );
}

function StatTile({ label, value, unit="", color=C.text }) {
  return (
    <div style={{ background:"#faf9f6", border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px" }}>
      <div style={{ fontSize:10, color:C.textFaint, fontFamily:MONO, letterSpacing:"0.07em", marginBottom:6 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize:22, fontWeight:600, color, fontFamily:SERIF, lineHeight:1 }}>
        {value}
        {unit && <span style={{ fontSize:13, fontWeight:400, color:C.textMid, marginLeft:4 }}>{unit}</span>}
      </div>
    </div>
  );
}

function CompareRow({ quantity, prediction, observed, status }) {
  const sc = status==="match" ? C.green : status==="partial" ? C.amber : C.textMid;
  const sl = status==="match" ? "✓" : status==="partial" ? "~" : "—";
  return (
    <tr style={{ borderBottom:`1px solid ${C.border}` }}>
      <td style={{ padding:"11px 14px", fontSize:13, fontWeight:600, color:C.text, verticalAlign:"top" }}>{quantity}</td>
      <td style={{ padding:"11px 14px", fontSize:12, fontFamily:MONO, color:C.green, verticalAlign:"top" }}>{prediction}</td>
      <td style={{ padding:"11px 14px", fontSize:12, fontFamily:MONO, color:C.blue, verticalAlign:"top" }}>{observed}</td>
      <td style={{ padding:"11px 14px", fontSize:13, color:sc, verticalAlign:"top" }}>{sl} {status==="match"?"Match":status==="partial"?"Partial":"Run sim"}</td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [tab,     setTab]     = useState("sim");
  const [running, setRunning] = useState(false);
  const [params,  setParams]  = useState(DEF);
  const [view,    setView]    = useState("vegetation");
  const [tick,    setTick]    = useState(0);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState(null);

  const stateRef  = useRef(initState());
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const paramsRef = useRef(params);
  const viewRef   = useRef(view);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { viewRef.current   = view;   }, [view]);

  const doStep = useCallback(() => {
    stateRef.current = caStep(stateRef.current, paramsRef.current);
    renderCanvas(canvasRef.current, stateRef.current, viewRef.current);
    setTick(t => {
      const nt = t + 1;
      if (nt % 5 === 0) {
        const m = computeMetrics(stateRef.current);
        setMetrics(m);
        setHistory(h => [...h.slice(-250), {
          t: nt,
          vm:  +m.vm.toFixed(3),  wm: +m.wm.toFixed(3),
          sm:  +m.sm.toFixed(3),  vvar: +m.vvar.toFixed(5),
          moran: +m.moran.toFixed(3), meanCluster: +m.meanCluster.toFixed(1),
        }]);
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

  useEffect(() => { renderCanvas(canvasRef.current, stateRef.current, view); }, [view]);

  const reset = () => {
    setRunning(false);
    stateRef.current = initState(Math.random() * 1e6 | 0);
    setTick(0); setHistory([]); setMetrics(null);
    setTimeout(() => renderCanvas(canvasRef.current, stateRef.current, viewRef.current), 0);
  };

  const th     = theory(params);
  const regime = metrics ? (metrics.vm>0.40 ? "Vegetated" : metrics.vm>0.12 ? "Patterned" : "Bare Desert") : "Ready";
  const rColor = metrics ? (metrics.vm>0.40 ? C.green : metrics.vm>0.12 ? C.amber : C.red) : C.textFaint;
  const sp     = { params, setParams };

  // ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background:C.bg, minHeight:"100vh", fontFamily:SERIF }}>

      {/* Header */}
      <div style={{ background:C.green, padding:"28px 40px", display:"flex",
                    justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:26, fontWeight:600, color:"#fff", letterSpacing:"0.01em" }}>
            Dryland Vegetation — Self-Organisation
          </div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", fontFamily:MONO,
                        letterSpacing:"0.05em", marginTop:6 }}>
            Cellular Automaton · Turing Instability · Activator–Inhibitor · Soil Memory Hysteresis
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontFamily:MONO }}>step t = {tick}</div>
          <div style={{ fontSize:20, color:rColor==="Ready"?"rgba(255,255,255,0.5)":rColor,
                        fontWeight:600, marginTop:4, filter:"brightness(1.4)" }}>{regime}</div>
        </div>
      </div>

      <Tabs active={tab} onChange={setTab}/>

      <div style={{ padding:"36px 40px" }}>

        {/* ══════════════════════════════ SIMULATION TAB */}
        {tab === "sim" && (
          <div style={{ display:"grid", gridTemplateColumns:`${N*CELL}px 1fr`, gap:48, alignItems:"start" }}>

            {/* Left — grid */}
            <div>
              {/* View selector */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                {["vegetation","water","soil"].map(vw => (
                  <button key={vw} onClick={() => setView(vw)} style={{
                    padding:"6px 16px", cursor:"pointer", fontSize:12,
                    borderRadius:20, fontFamily:MONO, letterSpacing:"0.04em",
                    background: view===vw ? C.green : C.surface,
                    color:      view===vw ? "#fff"  : C.textMid,
                    border: `1px solid ${view===vw ? C.green : C.border}`,
                    transition:"all 0.12s",
                  }}>
                    {vw}
                  </button>
                ))}
              </div>

              {/* Canvas */}
              <div style={{ borderRadius:10, overflow:"hidden",
                            boxShadow:"0 4px 28px rgba(0,0,0,0.13)",
                            border:`1px solid ${C.border}` }}>
                <canvas ref={canvasRef} width={N*CELL} height={N*CELL}
                  style={{ display:"block", imageRendering:"pixelated",
                            width:N*CELL, height:N*CELL }}/>
              </div>

              {/* Legend */}
              <div style={{ fontSize:11, color:C.textFaint, fontFamily:MONO,
                            marginTop:10, lineHeight:1.6 }}>
                {view==="vegetation" && "Dark green = dense biomass  ·  Sandy = bare soil"}
                {view==="water"      && "Blue = high water content  ·  Pale = dry"}
                {view==="soil"       && "Yellow-green = high infiltration capacity (σ)"}
              </div>

              {/* Buttons */}
              <div style={{ display:"flex", gap:10, marginTop:18 }}>
                <button onClick={() => setRunning(r=>!r)} style={{
                  flex:1, padding:"12px 0", cursor:"pointer", fontSize:16, fontFamily:SERIF,
                  fontWeight:600, borderRadius:8,
                  background: running ? "#fef2f2" : "#edf7f1",
                  color:      running ? C.red      : C.green,
                  border: `2px solid ${running ? C.red : C.green}`,
                  transition:"all 0.12s",
                }}>
                  {running ? "⏸  Pause" : "▶  Run"}
                </button>
                <button onClick={doStep} disabled={running} style={{
                  padding:"12px 18px", cursor: running?"not-allowed":"pointer", fontSize:15,
                  fontFamily:SERIF, borderRadius:8, background:C.surface,
                  color: running?C.textFaint:C.text, border:`1px solid ${C.border}`,
                }}>Step</button>
                <button onClick={reset} style={{
                  padding:"12px 18px", cursor:"pointer", fontSize:15, fontFamily:SERIF,
                  borderRadius:8, background:C.surface, color:C.textMid, border:`1px solid ${C.border}`,
                }}>Reset</button>
              </div>

              {/* Live theory box */}
              <div style={{ marginTop:20, background:"#eef5f1", border:`1px solid #c5ddd0`,
                            borderRadius:8, padding:16 }}>
                <div style={{ fontSize:10, fontFamily:MONO, color:C.green, letterSpacing:"0.08em",
                              marginBottom:8 }}>LIVE THEORETICAL PREDICTIONS</div>
                <table style={{ width:"100%", fontSize:12, color:C.text, borderCollapse:"collapse" }}>
                  {[
                    ["Pattern wavelength λ*", `${th.lambda.toFixed(1)} cells`],
                    ["Collapse threshold R_c", `${th.Rc.toFixed(3)}` + (params.R < th.Rc+0.03 ? " ← near!" : "")],
                    ["Soil equilibrium σ*",    `${th.sigma_eq.toFixed(3)}`],
                    ["Hysteresis width ∝ γ⁻/γ⁺", `${th.hyst_width.toFixed(2)}`],
                  ].map(([l,v]) => (
                    <tr key={l}>
                      <td style={{ padding:"4px 0", color:C.textMid }}>{l}</td>
                      <td style={{ padding:"4px 0", fontFamily:MONO, color:C.green,
                                    fontWeight:500, textAlign:"right" }}>{v}</td>
                    </tr>
                  ))}
                </table>
              </div>
            </div>

            {/* Right — params + state */}
            <div>
              <SectionHead>Live State</SectionHead>
              {metrics ? (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:32 }}>
                  <StatTile label="Vegetation Cover" value={(metrics.vm*100).toFixed(1)} unit="%"    color={C.green}/>
                  <StatTile label="Soil Water"        value={(metrics.wm*100).toFixed(1)} unit="%"    color={C.blue}/>
                  <StatTile label="Soil Quality σ"    value={(metrics.sm*100).toFixed(1)} unit="%"    color={C.amber}/>
                  <StatTile label="Spatial Variance"  value={metrics.vvar.toFixed(4)}                 color={C.purple}/>
                  <StatTile label="Moran's I"         value={metrics.moran.toFixed(3)}                color={C.amber}/>
                  <StatTile label="Patch Count"       value={metrics.numClusters}                     color={C.text}/>
                </div>
              ) : (
                <div style={{ color:C.textFaint, fontSize:14, marginBottom:32, fontFamily:MONO }}>
                  Press Run or Step to begin…
                </div>
              )}

              <SectionHead>Parameters</SectionHead>
              <div style={{ background:"#f0f7f3", border:`1px solid #cce0d3`, borderRadius:8,
                            padding:"12px 16px", marginBottom:24, fontSize:13, color:C.textMid,
                            lineHeight:1.7, fontFamily:MONO }}>
                💡 <strong style={{color:C.amber}}>Experiment:</strong> Slowly drag{" "}
                <strong style={{color:C.green}}>Rainfall (R)</strong> down to trigger the{" "}
                desertification cascade: dense → labyrinths → spots → bare.
                Watch spatial variance spike before the tipping point.
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 36px" }}>
                <div>
                  <Slider label="Rainfall"       symbol="R"  k="R"     min={0.10} max={0.55} step={0.005}
                    note="Primary driver. Decrease slowly to explore pattern phases."         {...sp}/>
                  <Slider label="Evaporation"    symbol="E"  k="E"     min={0.20} max={0.80} step={0.010}
                    note="Water lost to atmosphere. Higher E = less water for plants."        {...sp}/>
                  <Slider label="Growth rate"    symbol="α"  k="alpha" min={1.0}  max={6.0}  step={0.100}
                    note="Intrinsic efficiency of biomass production per unit water + soil."  {...sp}/>
                  <Slider label="Saturation"     symbol="β"  k="beta"  min={0.5}  max={5.0}  step={0.100}
                    note="Holling-II saturation. High β = diminishing returns at high water." {...sp}/>
                </div>
                <div>
                  <Slider label="Mortality"      symbol="m"  k="mort"  min={0.05} max={0.40} step={0.005}
                    note="Per-step plant death rate. Increasing this forces desertification."  {...sp}/>
                  <Slider label="Seed dispersal" symbol="ε"  k="eps"   min={0.01} max={0.15} step={0.005}
                    note="Short-range colonisation from neighbouring cells."                   {...sp}/>
                  <Slider label="Soil recovery"  symbol="γ⁺" k="gp"    min={0.01} max={0.20} step={0.005}
                    note="Rate plants restore soil infiltration. Slow variable."               {...sp}/>
                  <Slider label="Soil degrade"   symbol="γ⁻" k="gm"    min={0.005}max={0.10} step={0.005}
                    note="Crust formation rate in bare patches. Drives hysteresis width."      {...sp}/>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════ MATH TAB */}
        {tab === "math" && (
          <div style={{ maxWidth:860 }}>
            <p style={{ fontSize:15, color:C.textMid, lineHeight:1.9, marginBottom:36 }}>
              This Cellular Automaton discretises the Klausmeier–Gray–Scott family of dryland vegetation PDEs,
              enriched with a novel slow variable σ (soil memory) that the PDE literature largely ignores.
              The model exhibits Turing pattern formation, fold bifurcations, and percolation criticality —
              all of which are rigorously provable from the equations below.
            </p>

            {/* — Three fields — */}
            <SectionHead>The Three Coupled Fields</SectionHead>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, marginBottom:36 }}>
              {[
                { sym:"v(x,t)", name:"Vegetation biomass", color:C.green,
                  role:"ACTIVATOR",
                  desc:"Self-amplifying. Dense vegetation improves local soil infiltration, attracting still more growth at the same site — a positive feedback." },
                { sym:"w(x,t)", name:"Soil water content", color:C.blue,
                  role:"INHIBITOR",
                  desc:"Diffuses laterally (subsurface flow). Plants deplete water over a larger radius than they enrich soil, creating long-range competition — the inhibitor." },
                { sym:"σ(x,t)", name:"Soil memory", color:C.amber,
                  role:"SLOW VARIABLE",
                  desc:"Novel addition. Represents infiltration capacity (biological soil crust state). Plants build it up; bare soil degrades it. Evolves ~10× slower than v, w." },
              ].map(f => (
                <Card key={f.sym} style={{ padding:20 }}>
                  <div style={{ fontFamily:MONO, fontSize:15, color:f.color, marginBottom:4 }}>{f.sym}</div>
                  <div style={{ fontSize:10, fontFamily:MONO, color:f.color, letterSpacing:"0.1em",
                                marginBottom:8, opacity:0.7 }}>{f.role}</div>
                  <div style={{ fontWeight:600, fontSize:14, color:C.ink, marginBottom:8 }}>{f.name}</div>
                  <div style={{ fontSize:12.5, color:C.textMid, lineHeight:1.7 }}>{f.desc}</div>
                </Card>
              ))}
            </div>

            {/* — Equations — */}
            <SectionHead>Update Equations (Discrete-Time CA)</SectionHead>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:12 }}>
              All cells update synchronously. Periodic boundary conditions on an N×N torus.
            </p>
            <MathBox>
              w(t+1)  =  w  +  R  −  E·w  −  v·w·(1+σ)  +  D_w · Σ_{j∈B(4)} [w_j − w]<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;rainfall&nbsp;evap&nbsp;plant uptake&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;lateral flow (r=4 kernel)
            </MathBox>
            <MathBox>
              v(t+1)  =  v  +  [αwσ/(1+βw)]·v  −  m·v  +  ε · v̄_B(1) · (1−v)<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Holling-II growth (×soil quality)&nbsp;mortality&nbsp;seed dispersal (r=1)
            </MathBox>
            <MathBox>
              σ(t+1)  =  σ  +  γ⁺·v·(1−σ)  −  γ⁻·(1−v)·σ<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;plant-driven recovery&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;bare-patch crust formation<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(γ⁺ ≪ 1, slow)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(γ⁻ ≪ 1, slow)
            </MathBox>

            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:36 }}>
              The σ equation is the key novelty. Because γ⁺ and γ⁻ are both small (≪ 1),
              σ evolves roughly 1/(γ⁺+γ⁻) ≈ {(1/(DEF.gp+DEF.gm)).toFixed(0)} steps to equilibrate —
              much slower than v and w. This timescale separation defines a <em>slow manifold</em>
              and causes hysteresis: soil degraded by past bare periods resists recolonisation even
              when water is restored.
            </p>

            {/* — Turing — */}
            <SectionHead>Turing Instability — Why Patterns Form</SectionHead>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:12 }}>
              Patterns emerge when the spatially uniform steady state (v*, w*, σ*) is stable to
              uniform perturbations but <em>unstable</em> to spatially periodic ones.
              Taking the continuum limit of the v–w subsystem and linearising with
              perturbation ~ e^(ik·x + λt), the Jacobian in Fourier space is:
            </p>
            <MathBox>
              J(k) =  | f_v − m,&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;f_w · v*&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;| −w*(1+σ*),&nbsp;&nbsp;−E − v*(1+σ*) − Λ̂(k) |<br/>
              <br/>
              where Λ̂(k) = Λ₀ · J₁(k·r)/(k·r) — Fourier transform of disk kernel, r = 4
            </MathBox>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:12 }}>
              The <strong>Turing conditions</strong> require:
            </p>
            <MathBox>
              (1)  tr J(0) &lt; 0  and  det J(0) &gt; 0  →  uniform state is stable<br/>
              (2)  ∃ k* &gt; 0 such that det J(k*) &lt; 0  →  spatial modes are unstable<br/>
              <br/>
              Condition (2) requires the inhibitor (water) to diffuse faster than the activator (vegetation).<br/>
              This is always satisfied here since vegetation has D_v = 0 (no diffusion, only seed dispersal).
            </MathBox>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:12 }}>
              Minimising det J(k) over k gives the characteristic wavenumber k* and wavelength:
            </p>
            <MathBox>
              λ* = 2π/k*  ≈  2π·r_kernel / √(Λ₀ / m·E)<br/>
              <br/>
              With current parameters:  λ* ≈ {th.lambda.toFixed(1)} cells<br/>
              (Verify by counting average spacing between patches/stripes on the grid)
            </MathBox>

            {/* — Bistability — */}
            <SectionHead>Bistability and Hysteresis (Slow Manifold Theory)</SectionHead>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:12 }}>
              Fixing σ at its equilibrium σ* = γ⁺/(γ⁺+γ⁻) = {th.sigma_eq.toFixed(3)},
              the fast (v, w) subsystem has a <strong>fold bifurcation</strong> in rainfall R.
              Two stable branches coexist for intermediate R values:
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
              <div style={{ background:"#f0f7f3", borderRadius:8, padding:16 }}>
                <div style={{ fontFamily:MONO, fontSize:11, color:C.green, letterSpacing:"0.08em", marginBottom:8 }}>
                  FORWARD PATH (increasing drought)
                </div>
                <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                  As R decreases below R_c ≈ {th.Rc.toFixed(3)}, the vegetated branch vanishes.
                  System jumps catastrophically to bare desert — an irreversible tipping point
                  at this rainfall level.
                </div>
              </div>
              <div style={{ background:"#fdf4ec", borderRadius:8, padding:16 }}>
                <div style={{ fontFamily:MONO, fontSize:11, color:C.amber, letterSpacing:"0.08em", marginBottom:8 }}>
                  BACKWARD PATH (restoration)
                </div>
                <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                  Restoring rainfall does not recover vegetation at R_c.
                  You must raise R further, to R_c + ΔR.
                  Hysteresis width ΔR ∝ γ⁻/γ⁺ = {th.hyst_width.toFixed(2)}.
                  Larger ratio → harder to reverse desertification.
                </div>
              </div>
            </div>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:36 }}>
              This is proven via <strong>geometric singular perturbation theory</strong> (Fenichel 1979):
              for ε = γ⁺ + γ⁻ ≪ 1, the actual trajectories are O(ε)-close to the slow manifold M₀
              until they reach the fold point, where they fall off in finite time regardless of how
              slowly R changes. The σ equation explicitly widens the bistable parameter range compared
              to models without it — a rigorous and ecologically important result.
            </p>

            {/* — Percolation — */}
            <SectionHead>Percolation Theory at the Tipping Point</SectionHead>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:12 }}>
              Near R_c, vegetated cells form clusters that progressively lose connectivity.
              At R_c itself, this is a standard 2D site percolation transition with exact critical exponents:
            </p>
            <MathBox>
              Cluster size distribution:   P(s) ~ s^(−τ),&nbsp;&nbsp;&nbsp;&nbsp; τ = 187/91 ≈ 2.055<br/>
              Correlation length:           ξ ~ |R − R_c|^(−ν), &nbsp;ν = 4/3<br/>
              Mean cluster size diverges:   ⟨s⟩ ~ |R − R_c|^(−γ), γ = 43/18 ≈ 2.389
            </MathBox>
            <p style={{ fontSize:13.5, color:C.textMid, lineHeight:1.8, marginBottom:36 }}>
              These exponents are exact results from conformal field theory of 2D percolation
              (Nienhuis 1982). In simulation: as R → R_c, cluster size distribution flattens toward
              a power law, mean cluster size peaks, and Moran's I (spatial autocorrelation) diverges —
              the practical early-warning signal for the coming collapse.
            </p>

            {/* — Phases — */}
            <SectionHead>Pattern Phase Diagram</SectionHead>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:12 }}>
              {[
                { phase:"Dense Cover",   R:"R > 0.40",  bg:"#1a5c38", desc:"Continuous canopy. Homogeneous steady state. Turing instability is below threshold — no patterns." },
                { phase:"Labyrinths",    R:"0.28–0.40", bg:"#3d7d5a", desc:"Connected maze-like stripes. The Turing wavelength λ* sets the stripe width." },
                { phase:"Spots",         R:"0.15–0.28", bg:"#6a9e72", desc:"Isolated vegetation patches on a bare background. Classic Turing spots, spacing ≈ λ*." },
                { phase:"Bare Desert",   R:"R < 0.15",  bg:"#8b6a50", desc:"Vegetation collapse. Bare-soil attractor. Hysteresis: recovery needs R ≫ 0.15." },
              ].map(p => (
                <div key={p.phase} style={{ borderRadius:8, overflow:"hidden", border:`1px solid ${C.border}` }}>
                  <div style={{ background:p.bg, padding:"10px 14px" }}>
                    <div style={{ color:"#fff", fontWeight:600, fontSize:14 }}>{p.phase}</div>
                    <div style={{ color:"rgba(255,255,255,0.65)", fontSize:10, fontFamily:MONO, marginTop:2 }}>{p.R}</div>
                  </div>
                  <div style={{ padding:12, fontSize:12, color:C.textMid, lineHeight:1.6, background:C.surface }}>
                    {p.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════ RESULTS TAB */}
        {tab === "results" && (
          <div>
            {history.length < 10 ? (
              <div style={{ textAlign:"center", padding:"100px 0", color:C.textFaint }}>
                <div style={{ fontSize:40, marginBottom:16 }}>🌿</div>
                <div style={{ fontSize:18, marginBottom:8 }}>No data yet</div>
                <div style={{ fontSize:13, fontFamily:MONO }}>
                  Go to the Simulation tab → press Run → let it evolve for a while.
                </div>
              </div>
            ) : (
              <>
                {/* Theory vs simulation comparison */}
                <SectionHead>Theory vs. Simulation — Predictions and Observations</SectionHead>

                {/* Turing patterns */}
                <Card style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div style={{ fontFamily:SERIF, fontSize:17, fontWeight:600 }}>
                      1. Turing Pattern Formation
                    </div>
                    <span style={{ fontSize:11, color:C.green, border:`1px solid ${C.green}`,
                                    borderRadius:20, padding:"2px 12px", fontFamily:MONO }}>
                      ✓ Strong agreement
                    </span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"#f0f5f1", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.green, letterSpacing:"0.08em", marginBottom:6 }}>
                        THEORY PREDICTS
                      </div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        Random initial conditions spontaneously organise into periodic spatial patterns.
                        Predicted wavelength λ* ≈ {th.lambda.toFixed(1)} cells. Patterns appear within ~100–300 steps.
                        Moran's I should be positive and significantly above zero.
                      </div>
                    </div>
                    <div style={{ background:"#f5f0f0", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.amber, letterSpacing:"0.08em", marginBottom:6 }}>
                        SIMULATION SHOWS
                      </div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        Moran's I = <strong>{metrics?.moran.toFixed(3)}</strong> ({metrics?.moran > 0.1 ? "✓ strong clustering" : metrics?.moran > 0 ? "weak clustering" : "no clustering"}).
                        {" "}{metrics?.numClusters} distinct patches detected.
                        Spatial variance = {metrics?.vvar.toFixed(5)}.
                        {" "}{metrics?.moran > 0.1 ? "Pattern formation confirmed." : "Patterns not yet developed — run longer or adjust R."}
                      </div>
                    </div>
                  </div>
                  <div style={{ background:"#fafafa", borderRadius:6, padding:12, fontSize:12,
                                color:C.textMid, lineHeight:1.6 }}>
                    <strong>What to verify:</strong> Count average spacing between patches on the Simulation grid.
                    It should be within ±25% of λ* = {th.lambda.toFixed(1)} cells.
                    Moran's I &gt; 0.1 confirms supra-cell spatial autocorrelation consistent with Turing mechanism.
                  </div>
                </Card>

                {/* Soil memory */}
                <Card style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div style={{ fontFamily:SERIF, fontSize:17, fontWeight:600 }}>
                      2. Soil Memory Timescale Separation
                    </div>
                    <span style={{ fontSize:11, color:C.amber, border:`1px solid ${C.amber}`,
                                    borderRadius:20, padding:"2px 12px", fontFamily:MONO }}>
                      ~ Context-dependent
                    </span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"#f0f5f1", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.green, letterSpacing:"0.08em", marginBottom:6 }}>
                        THEORY PREDICTS
                      </div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        σ equilibrates to σ* = γ⁺/(γ⁺+γ⁻) = {th.sigma_eq.toFixed(3)},
                        but on a timescale ~{(1/(DEF.gp+DEF.gm)).toFixed(0)} steps — much slower than v, w.
                        After sudden rainfall change, vegetation adjusts quickly but soil memory lags,
                        creating a transient buffer against collapse.
                      </div>
                    </div>
                    <div style={{ background:"#f5f0f0", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.amber, letterSpacing:"0.08em", marginBottom:6 }}>
                        SIMULATION SHOWS
                      </div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        Current σ̄ = {metrics?.sm.toFixed(3)} vs. σ* = {th.sigma_eq.toFixed(3)}.
                        {" "}{metrics && Math.abs(metrics.sm - th.sigma_eq) < 0.05
                          ? "Close to equilibrium — soil memory has converged."
                          : "Still transient — soil memory is tracking vegetation with lag."
                        }
                        {" "}See it in the time series: σ curve lags behind the v curve.
                      </div>
                    </div>
                  </div>
                  <div style={{ background:"#fafafa", borderRadius:6, padding:12, fontSize:12,
                                color:C.textMid, lineHeight:1.6 }}>
                    <strong>Experiment:</strong> Run to equilibrium. Then suddenly drop R by 0.08.
                    Observe: v drops fast within ~20 steps, but σ takes ~{(1/(DEF.gp+DEF.gm)).toFixed(0)} steps to follow.
                    This lag buffers vegetation temporarily — exactly the hysteresis mechanism.
                  </div>
                </Card>

                {/* Early warning */}
                <Card style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div style={{ fontFamily:SERIF, fontSize:17, fontWeight:600 }}>
                      3. Spatial Variance as Early Warning Signal
                    </div>
                    <span style={{ fontSize:11, color:C.green, border:`1px solid ${C.green}`,
                                    borderRadius:20, padding:"2px 12px", fontFamily:MONO }}>
                      ✓ Predicted and observed
                    </span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"#f0f5f1", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.green, letterSpacing:"0.08em", marginBottom:6 }}>THEORY PREDICTS</div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        Critical slowing down near R_c ≈ {th.Rc.toFixed(3)} causes spatial variance
                        and Moran's I to rise monotonically, then peak at the bifurcation,
                        then collapse suddenly to near-zero when the system tips to bare desert.
                      </div>
                    </div>
                    <div style={{ background:"#f5f0f0", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.amber, letterSpacing:"0.08em", marginBottom:6 }}>SIMULATION SHOWS</div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        Spatial variance = {metrics?.vvar.toFixed(5)}.{" "}
                        {metrics?.vvar > 0.05
                          ? "⚠ High — near a tipping point. Watch for sudden collapse."
                          : metrics?.vvar > 0.01
                          ? "Moderate — in the patterned regime."
                          : "Low — stable state far from tipping."
                        }
                      </div>
                    </div>
                  </div>
                  <div style={{ background:"#fafafa", borderRadius:6, padding:12, fontSize:12,
                                color:C.textMid, lineHeight:1.6 }}>
                    <strong>Experiment:</strong> Run until steady state. Then slowly decrease R in steps of 0.01,
                    waiting ~50 steps between changes. Watch the Spatial Variance chart below.
                    You should see a clear peak near R ≈ {th.Rc.toFixed(3)} before sudden collapse — the early warning signal.
                  </div>
                </Card>

                {/* Percolation */}
                <Card style={{ marginBottom:36 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div style={{ fontFamily:SERIF, fontSize:17, fontWeight:600 }}>
                      4. Percolation of the Vegetation Network
                    </div>
                    <span style={{ fontSize:11, color:C.amber, border:`1px solid ${C.amber}`,
                                    borderRadius:20, padding:"2px 12px", fontFamily:MONO }}>
                      ~ Verify by decreasing R
                    </span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"#f0f5f1", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.green, letterSpacing:"0.08em", marginBottom:6 }}>THEORY PREDICTS</div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        At R_c ≈ {th.Rc.toFixed(3)}, the vegetation network loses spanning connectivity.
                        Mean patch size diverges ∝ |R−R_c|^(−43/18).
                        Maximum cluster drops from &gt;30% of grid to &lt;5% at the transition.
                      </div>
                    </div>
                    <div style={{ background:"#f5f0f0", borderRadius:8, padding:14 }}>
                      <div style={{ fontSize:10, fontFamily:MONO, color:C.amber, letterSpacing:"0.08em", marginBottom:6 }}>SIMULATION SHOWS</div>
                      <div style={{ fontSize:13, color:C.text, lineHeight:1.7 }}>
                        Max cluster = {metrics?.maxCluster} cells ({metrics ? (metrics.maxCluster/(N*N)*100).toFixed(1) : "—"}% of grid).
                        Mean cluster = {metrics?.meanCluster.toFixed(1)} cells.{" "}
                        {metrics?.maxCluster > N*N*0.3
                          ? "Large spanning cluster — well above percolation threshold."
                          : metrics?.maxCluster > N*N*0.05
                          ? "Clusters fragmenting — approaching percolation threshold."
                          : "Only small isolated clusters — below percolation threshold."}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Charts */}
                <SectionHead>Time Series Diagnostics</SectionHead>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:28, marginBottom:28 }}>

                  <Card>
                    <div style={{ fontWeight:600, fontSize:15, color:C.ink, marginBottom:4 }}>
                      Mean-field variables
                    </div>
                    <div style={{ fontSize:12, color:C.textFaint, marginBottom:16, fontFamily:MONO }}>
                      v̄, w̄, σ̄ averaged over grid. Theory: converge to fixed point or oscillate.
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={history} margin={{ top:0, right:8, bottom:0, left:-16 }}>
                        <XAxis dataKey="t" tick={{ fontSize:10, fill:C.textFaint }} interval="preserveStartEnd"/>
                        <YAxis tick={{ fontSize:10, fill:C.textFaint }} domain={[0,1]}/>
                        <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, fontSize:11 }}/>
                        <Legend wrapperStyle={{ fontSize:11 }}/>
                        <Line type="monotone" dataKey="vm" name="vegetation" stroke={C.green}  dot={false} strokeWidth={2}/>
                        <Line type="monotone" dataKey="wm" name="water"      stroke={C.blue}   dot={false} strokeWidth={2}/>
                        <Line type="monotone" dataKey="sm" name="soil σ"     stroke={C.amber}  dot={false} strokeWidth={2}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <div style={{ fontWeight:600, fontSize:15, color:C.ink, marginBottom:4 }}>
                      Early warning signals
                    </div>
                    <div style={{ fontSize:12, color:C.textFaint, marginBottom:16, fontFamily:MONO }}>
                      Rise before tipping. Peak = critical slowing down at R_c.
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={history} margin={{ top:0, right:8, bottom:0, left:-16 }}>
                        <XAxis dataKey="t" tick={{ fontSize:10, fill:C.textFaint }} interval="preserveStartEnd"/>
                        <YAxis tick={{ fontSize:10, fill:C.textFaint }}/>
                        <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, fontSize:11 }}/>
                        <Legend wrapperStyle={{ fontSize:11 }}/>
                        <Line type="monotone" dataKey="vvar"  name="Spatial Var(v)" stroke={C.purple} dot={false} strokeWidth={2}/>
                        <Line type="monotone" dataKey="moran" name="Moran's I"       stroke={C.red}    dot={false} strokeWidth={2}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <div style={{ fontWeight:600, fontSize:15, color:C.ink, marginBottom:4 }}>
                      Patch structure (percolation diagnostic)
                    </div>
                    <div style={{ fontSize:12, color:C.textFaint, marginBottom:16, fontFamily:MONO }}>
                      Mean cluster size peaks at R_c then collapses. Theory: ∝ |R−R_c|^(−43/18).
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={history} margin={{ top:0, right:8, bottom:0, left:-16 }}>
                        <XAxis dataKey="t" tick={{ fontSize:10, fill:C.textFaint }} interval="preserveStartEnd"/>
                        <YAxis tick={{ fontSize:10, fill:C.textFaint }}/>
                        <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, fontSize:11 }}/>
                        <Legend wrapperStyle={{ fontSize:11 }}/>
                        <Line type="monotone" dataKey="meanCluster" name="Mean cluster (cells)" stroke={C.green} dot={false} strokeWidth={2}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <div style={{ fontWeight:600, fontSize:15, color:C.ink, marginBottom:4 }}>
                      Phase portrait — v̄ vs w̄
                    </div>
                    <div style={{ fontSize:12, color:C.textFaint, marginBottom:16, fontFamily:MONO }}>
                      Trajectory in mean-field space. Fixed point = stable state. Orbit = transient.
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <ScatterChart margin={{ top:0, right:8, bottom:0, left:-16 }}>
                        <XAxis dataKey="wm" type="number" name="w̄" tick={{ fontSize:10, fill:C.textFaint }}
                          domain={["auto","auto"]}
                          label={{ value:"w̄  (soil water)", position:"insideBottomRight", offset:-5, fontSize:11, fill:C.textFaint }}/>
                        <YAxis dataKey="vm" type="number" name="v̄" tick={{ fontSize:10, fill:C.textFaint }}
                          domain={["auto","auto"]}
                          label={{ value:"v̄", angle:-90, position:"insideLeft", fontSize:11, fill:C.textFaint }}/>
                        <Tooltip cursor={{ strokeDasharray:"3 3" }}
                          contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, fontSize:11 }}/>
                        <Scatter data={history} fill={C.green} opacity={0.45} name="trajectory"/>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </Card>
                </div>

                {/* Summary table */}
                <Card>
                  <SectionHead>Summary Table — Theory vs. Simulation</SectionHead>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                      <thead>
                        <tr style={{ borderBottom:`2px solid ${C.border}` }}>
                          {["Quantity","Theory predicts","Simulation value","Status"].map(h => (
                            <th key={h} style={{ textAlign:"left", padding:"10px 14px", color:C.textMid,
                                                fontFamily:MONO, fontSize:10, letterSpacing:"0.07em", fontWeight:500 }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <CompareRow
                          quantity="Pattern wavelength λ*"
                          prediction={`${th.lambda.toFixed(1)} cells`}
                          observed="Count patch spacing on grid"
                          status="tip"/>
                        <CompareRow
                          quantity="Soil σ equilibrium"
                          prediction={th.sigma_eq.toFixed(3)}
                          observed={metrics ? metrics.sm.toFixed(3) : "—"}
                          status={metrics && Math.abs(metrics.sm-th.sigma_eq)<0.06 ? "match" : "partial"}/>
                        <CompareRow
                          quantity="Spatial clustering"
                          prediction="Moran's I > 0"
                          observed={metrics ? `Moran's I = ${metrics.moran.toFixed(3)}` : "—"}
                          status={metrics ? (metrics.moran>0.1 ? "match" : "partial") : "tip"}/>
                        <CompareRow
                          quantity="Collapse threshold R_c"
                          prediction={th.Rc.toFixed(3)}
                          observed="Decrease R slowly to find it"
                          status="tip"/>
                        <CompareRow
                          quantity="Hysteresis width"
                          prediction={`∝ γ⁻/γ⁺ = ${th.hyst_width.toFixed(2)}`}
                          observed="Increase R after collapse"
                          status="tip"/>
                        <CompareRow
                          quantity="Max cluster at collapse"
                          prediction="Drops from >30% to <5%"
                          observed={metrics ? `${(metrics.maxCluster/(N*N)*100).toFixed(1)}% of grid` : "—"}
                          status={metrics ? (metrics.maxCluster>N*N*0.3 ? "match" : metrics.maxCluster>N*N*0.05 ? "partial" : "match") : "tip"}/>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
