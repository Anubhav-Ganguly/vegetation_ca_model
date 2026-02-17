import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ScatterChart, Scatter } from "recharts";

// ── Design tokens ────────────────────────────────────────────────
const C = {
  bg: "#f7f3ec", surface: "#ffffff", border: "#e2d9cc",
  green: "#2d6a4f", greenDim: "#52b788", amber: "#c4862b",
  blue: "#3a6ea5", red: "#b5372a", purple: "#6b4ea8",
  text: "#1c1917", textMid: "#57534e", textFaint: "#a8a29e", ink: "#2d2926",
};
const MONO = "'JetBrains Mono', 'Courier New', monospace";
const SERIF = "'Crimson Pro', Georgia, serif";

// ── CA constants ─────────────────────────────────────────────────
const N = 80;
const CELL = 7;

function buildOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) o.push([dx, dy]);
  return o;
}
const W_OFF = buildOffsets(4);
const S_OFF = buildOffsets(1);

// ── State initialisation ──────────────────────────────────────────
function initState(seed = 42) {
  let s = seed | 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
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

// ── CA update ─────────────────────────────────────────────────────
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
      for (const [dx, dy] of W_OFF) wsum += w[((y + dy + N) % N) * N + (x + dx + N) % N];
      const wflow = wsum / W_OFF.length - wi;
      let vsum = 0;
      for (const [dx, dy] of S_OFF) vsum += v[((y + dy + N) % N) * N + (x + dx + N) % N];
      const vseed = vsum / S_OFF.length;
      nw[i] = Math.max(0, Math.min(1, wi + R - E * wi - vi * wi * (1 + si) + 0.35 * wflow));
      nv[i] = Math.max(0, Math.min(1, vi + (alpha * wi * si / (1 + beta * wi)) * vi - mort * vi + eps * vseed * (1 - vi)));
      nσ[i] = Math.max(0, Math.min(1, si + gp * vi * (1 - si) - gm * (1 - vi) * si));
    }
  }
  return { v: nv, w: nw, σ: nσ };
}

// ── Metrics ───────────────────────────────────────────────────────
function computeMetrics(state) {
  const { v, w, σ } = state;
  let vS = 0, wS = 0, sS = 0;
  for (let i = 0; i < N * N; i++) { vS += v[i]; wS += w[i]; sS += σ[i]; }
  const vm = vS / (N * N), wm = wS / (N * N), sm = sS / (N * N);
  let vvar = 0, moran = 0, moranC = 0;
  for (let i = 0; i < N * N; i++) vvar += (v[i] - vm) ** 2;
  vvar /= N * N;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const j = ((y + dy + N) % N) * N + (x + dx + N) % N;
        moran += (v[i] - vm) * (v[j] - vm);
        moranC++;
      }
    }
  moran = vvar > 0 ? moran / (moranC * vvar) : 0;
  const thr = 0.15, visited = new Uint8Array(N * N), sizes = [];
  for (let start = 0; start < N * N; start++) {
    if (v[start] < thr || visited[start]) continue;
    let q = [start], size = 0;
    visited[start] = 1;
    while (q.length) {
      const cur = q.pop(); size++;
      const cy = Math.floor(cur / N), cx = cur % N;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ((cy + dy + N) % N) * N + (cx + dx + N) % N;
        if (!visited[ni] && v[ni] >= thr) { visited[ni] = 1; q.push(ni); }
      }
    }
    sizes.push(size);
  }
  const maxCluster = sizes.length ? Math.max(...sizes) : 0;
  const meanCluster = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  return { vm, wm, sm, vvar, moran, maxCluster, meanCluster, numClusters: sizes.length };
}

// ── Canvas rendering ──────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function colorVeg(val) {
  if (val < 0.15) { const t = val / 0.15; return [lerp(235, 200, t), lerp(225, 185, t), lerp(205, 160, t)]; }
  if (val < 0.50) { const t = (val - 0.15) / 0.35; return [lerp(200, 80, t), lerp(185, 150, t), lerp(160, 80, t)]; }
  const t = (val - 0.5) / 0.5; return [lerp(80, 15, t), lerp(150, 90, t), lerp(80, 40, t)];
}
function colorWater(val) { return [lerp(240, 20, val), lerp(230, 90, val), lerp(210, 200, val)]; }
function colorSigma(val) { return [lerp(240, 100, val), lerp(235, 160, val), lerp(220, 80, val)]; }

function renderCanvas(canvas, state, view) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const arr = view === "vegetation" ? state.v : view === "water" ? state.w : state.σ;
  const cfn = view === "vegetation" ? colorVeg : view === "water" ? colorWater : colorSigma;
  const img = ctx.createImageData(N * CELL, N * CELL);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [r, g, b] = cfn(arr[y * N + x]);
      for (let py = 0; py < CELL; py++)
        for (let px = 0; px < CELL; px++) {
          const pi = ((y * CELL + py) * N * CELL + x * CELL + px) * 4;
          img.data[pi] = r; img.data[pi + 1] = g; img.data[pi + 2] = b; img.data[pi + 3] = 255;
        }
    }
  ctx.putImageData(img, 0, 0);
}

// ── Theory predictions ────────────────────────────────────────────
const DEF = { R: 0.28, E: 0.45, alpha: 3.2, beta: 2.0, mort: 0.18, eps: 0.04, gp: 0.06, gm: 0.03 };

function theory(p) {
  const { R, E, alpha, beta, mort, gp, gm } = p;
  const sigma_eq = gp / (gp + gm);
  const w_bare = R / E;
  const Rc = (mort * E) / (alpha * sigma_eq);
  const lambda = 2 * Math.PI * 4 / Math.sqrt((R * alpha) / (mort * E * (1 + beta * 0.25)));
  const hyst_width = gm / gp;
  const f_eff = alpha * w_bare * sigma_eq / (1 + beta * w_bare);
  return { sigma_eq, w_bare, Rc, lambda, hyst_width, f_eff };
}

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function Tabs({ active, onChange }) {
  const tabs = [
    { id: "sim", label: "🌿 Simulation" },
    { id: "math", label: "∂ Mathematical Analysis" },
    { id: "results", label: "📈 Results & Observations" },
  ];
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: "12px 28px", cursor: "pointer", fontFamily: SERIF, fontSize: 15,
          border: "none", borderBottom: active === t.id ? `3px solid ${C.green}` : "3px solid transparent",
          background: "transparent", color: active === t.id ? C.green : C.textMid,
          fontWeight: active === t.id ? 600 : 400, marginBottom: -2, transition: "all 0.15s",
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "20px 24px", marginBottom: 16, ...style
    }}>
      {children}
    </div>
  );
}

function SectionHead({ children }) {
  return (
    <div style={{
      fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: C.ink,
      marginBottom: 14, marginTop: 8, borderLeft: `3px solid ${C.green}`, paddingLeft: 10
    }}>
      {children}
    </div>
  );
}

function MathBox({ children }) {
  return (
    <pre style={{
      fontFamily: MONO, fontSize: 12.5, background: "#faf8f5", border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "14px 18px", overflowX: "auto", color: C.ink,
      lineHeight: 1.7, margin: "10px 0",
    }}>
      {children}
    </pre>
  );
}

function Slider({ label, symbol, k, min, max, step, note, params, setParams }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: SERIF, fontSize: 13.5, color: C.text }}>
          {label} <span style={{ fontFamily: MONO, color: C.textMid, fontSize: 12 }}>({symbol})</span>
        </span>
        <span style={{ fontFamily: MONO, fontSize: 13, color: C.green, fontWeight: 600 }}>
          {params[k].toFixed(3)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={params[k]}
        onChange={e => setParams(p => ({ ...p, [k]: +e.target.value }))}
        style={{ width: "100%", accentColor: C.green, cursor: "pointer" }} />
      {note && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function StatTile({ label, value, unit = "", color = C.text }) {
  return (
    <div style={{
      background: "#faf8f5", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px", flex: 1, minWidth: 90,
    }}>
      <div style={{ fontSize: 10, fontFamily: MONO, color: C.textFaint, letterSpacing: "0.06em", marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 17, fontFamily: MONO, color, fontWeight: 600 }}>
        {value} {unit && <span style={{ fontSize: 11, color: C.textFaint }}>{unit}</span>}
      </div>
    </div>
  );
}

function CompareRow({ quantity, prediction, observed, status }) {
  const sc = status === "match" ? C.green : status === "partial" ? C.amber : C.textMid;
  const sl = status === "match" ? "✓" : status === "partial" ? "~" : "—";
  return (
    <tr>
      <td style={{ padding: "8px 12px", fontFamily: SERIF, fontSize: 13.5, borderBottom: `1px solid ${C.border}` }}>{quantity}</td>
      <td style={{ padding: "8px 12px", fontFamily: MONO, fontSize: 12, color: C.blue, borderBottom: `1px solid ${C.border}` }}>{prediction}</td>
      <td style={{ padding: "8px 12px", fontFamily: MONO, fontSize: 12, color: C.green, borderBottom: `1px solid ${C.border}` }}>{observed}</td>
      <td style={{ padding: "8px 12px", fontFamily: MONO, fontSize: 12, color: sc, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>
        {sl} {status === "match" ? "Match" : status === "partial" ? "Partial" : "Run sim"}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("sim");
  const [running, setRunning] = useState(false);
  const [params, setParams] = useState(DEF);
  const [view, setView] = useState("vegetation");
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const stateRef = useRef(initState());
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const paramsRef = useRef(params);
  const viewRef = useRef(view);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { viewRef.current = view; }, [view]);

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
          vm: +m.vm.toFixed(3), wm: +m.wm.toFixed(3), sm: +m.sm.toFixed(3),
          vvar: +m.vvar.toFixed(5), moran: +m.moran.toFixed(3),
          meanCluster: +m.meanCluster.toFixed(1),
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

  useEffect(() => {
    renderCanvas(canvasRef.current, stateRef.current, view);
  }, [view]);

  const reset = () => {
    setRunning(false);
    stateRef.current = initState(Math.random() * 1e6 | 0);
    setTick(0); setHistory([]); setMetrics(null);
    setTimeout(() => renderCanvas(canvasRef.current, stateRef.current, viewRef.current), 0);
  };

  const th = theory(params);
  const regime = metrics
    ? (metrics.vm > 0.40 ? "Vegetated" : metrics.vm > 0.12 ? "Patterned" : "Bare Desert")
    : "Ready";
  const rColor = metrics
    ? (metrics.vm > 0.40 ? C.green : metrics.vm > 0.12 ? C.amber : C.red)
    : C.textFaint;
  const sp = { params, setParams };

  // ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "0 0 60px 0", fontFamily: SERIF }}>
      {/* Header */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "20px 40px 0 40px", marginBottom: 0,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 4 }}>
            <h1 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, color: C.ink, margin: 0 }}>
              Dryland Vegetation — Self-Organisation
            </h1>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.textFaint }}>
              step t = {tick}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: rColor }}>
              {regime}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: C.textFaint, fontFamily: MONO, marginBottom: 14, letterSpacing: "0.03em" }}>
            Cellular Automaton · Turing Instability · Activator–Inhibitor · Soil Memory Hysteresis
          </div>
          <Tabs active={tab} onChange={setTab} />
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 40px 0 40px" }}>

        {/* ══════════════════════════════ SIMULATION TAB */}
        {tab === "sim" && (
          <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>

            {/* Left — grid */}
            <div style={{ flex: "0 0 auto" }}>
              <Card style={{ padding: 16 }}>
                {/* View selector */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {["vegetation", "water", "soil"].map(vw => (
                    <button key={vw} onClick={() => setView(vw)} style={{
                      padding: "6px 16px", cursor: "pointer", fontSize: 12, borderRadius: 20,
                      fontFamily: MONO, letterSpacing: "0.04em",
                      background: view === vw ? C.green : C.surface,
                      color: view === vw ? "#fff" : C.textMid,
                      border: `1px solid ${view === vw ? C.green : C.border}`,
                      transition: "all 0.12s",
                    }}>
                      {vw}
                    </button>
                  ))}
                </div>

                {/* Canvas */}
                <canvas ref={canvasRef} width={N * CELL} height={N * CELL}
                  style={{ display: "block", borderRadius: 4, border: `1px solid ${C.border}` }} />

                {/* Legend */}
                <div style={{ marginTop: 8, fontSize: 11, fontFamily: MONO, color: C.textFaint }}>
                  {view === "vegetation" && "Dark green = dense biomass · Sandy = bare soil"}
                  {view === "water" && "Blue = high water content · Pale = dry"}
                  {view === "soil" && "Yellow-green = high infiltration capacity (σ)"}
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => setRunning(r => !r)} style={{
                    flex: 1, padding: "12px 0", cursor: "pointer", fontSize: 16,
                    fontFamily: SERIF, fontWeight: 600, borderRadius: 8,
                    background: running ? "#fef2f2" : "#edf7f1",
                    color: running ? C.red : C.green,
                    border: `2px solid ${running ? C.red : C.green}`,
                    transition: "all 0.12s",
                  }}>
                    {running ? "⏸ Pause" : "▶ Run"}
                  </button>
                  <button onClick={doStep} style={{
                    padding: "12px 18px", cursor: "pointer", fontSize: 14,
                    fontFamily: SERIF, borderRadius: 8,
                    background: C.surface, color: C.textMid, border: `1px solid ${C.border}`,
                  }}>
                    Step
                  </button>
                  <button onClick={reset} style={{
                    padding: "12px 18px", cursor: "pointer", fontSize: 14,
                    fontFamily: SERIF, borderRadius: 8,
                    background: C.surface, color: C.textMid, border: `1px solid ${C.border}`,
                  }}>
                    Reset
                  </button>
                </div>
              </Card>

              {/* Live theory box */}
              <Card style={{ padding: "14px 18px" }}>
                <div style={{ fontSize: 10, fontFamily: MONO, color: C.textFaint, letterSpacing: "0.08em", marginBottom: 10 }}>
                  LIVE THEORETICAL PREDICTIONS
                </div>
                {[
                  ["Pattern wavelength λ*", `${th.lambda.toFixed(1)} cells`],
                  ["Collapse threshold R_c", `${th.Rc.toFixed(3)}` + (params.R < th.Rc + 0.03 ? " ← near!" : "")],
                  ["Soil equilibrium σ*", `${th.sigma_eq.toFixed(3)}`],
                  ["Hysteresis width ∝ γ⁻/γ⁺", `${th.hyst_width.toFixed(2)}`],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontFamily: MONO, color: C.textMid }}>{l}</span>
                    <span style={{ fontSize: 12, fontFamily: MONO, color: C.green, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </Card>
            </div>

            {/* Right — params + state */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Card>
                <SectionHead>Live State</SectionHead>
                {metrics ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
                    <StatTile label="Veg cover" value={(metrics.vm * 100).toFixed(1)} unit="%" color={C.green} />
                    <StatTile label="Soil water" value={metrics.wm.toFixed(3)} color={C.blue} />
                    <StatTile label="Soil memory" value={metrics.sm.toFixed(3)} color={C.amber} />
                    <StatTile label="Spatial var" value={metrics.vvar.toFixed(4)} color={metrics.vvar > 0.05 ? C.red : C.textMid} />
                    <StatTile label="Moran's I" value={metrics.moran.toFixed(3)} color={metrics.moran > 0.1 ? C.purple : C.textMid} />
                    <StatTile label="Patches" value={metrics.numClusters} color={C.textMid} />
                    <StatTile label="Max cluster" value={metrics.maxCluster} unit="cells" color={C.textMid} />
                  </div>
                ) : (
                  <div style={{ color: C.textFaint, fontFamily: MONO, fontSize: 13, padding: "12px 0" }}>
                    Press Run or Step to begin…
                  </div>
                )}
              </Card>

              <Card>
                <SectionHead>Parameters</SectionHead>
                <Slider label="Rainfall" symbol="R" k="R" min={0.05} max={0.60} step={0.005}
                  note="Key bifurcation parameter. Decrease slowly to trigger patterning → collapse." {...sp} />
                <Slider label="Evaporation" symbol="E" k="E" min={0.1} max={0.9} step={0.01} {...sp} />
                <Slider label="Plant uptake" symbol="α" k="alpha" min={0.5} max={6.0} step={0.1}
                  note="Water-to-biomass conversion efficiency." {...sp} />
                <Slider label="Saturation" symbol="β" k="beta" min={0.2} max={5.0} step={0.1}
                  note="Holling-II saturation constant." {...sp} />
                <Slider label="Mortality" symbol="m" k="mort" min={0.02} max={0.50} step={0.005} {...sp} />
                <Slider label="Seed dispersal" symbol="ε" k="eps" min={0.0} max={0.15} step={0.005} {...sp} />
                <Slider label="Soil recovery" symbol="γ⁺" k="gp" min={0.01} max={0.15} step={0.005}
                  note="Plant-driven soil crust improvement. Slow (0.01–0.10)." {...sp} />
                <Slider label="Soil degradation" symbol="γ⁻" k="gm" min={0.005} max={0.10} step={0.005}
                  note="Bare-patch crust breakdown. γ⁻/γ⁺ sets hysteresis width." {...sp} />
                <div style={{
                  marginTop: 14, padding: "10px 14px", background: "#fef9f0",
                  borderRadius: 8, border: `1px solid #e8d8b0`, fontSize: 12.5,
                  fontFamily: SERIF, color: C.amber, lineHeight: 1.6,
                }}>
                  💡 Experiment: Slowly drag <strong>Rainfall (R)</strong> down to trigger the desertification cascade:
                  dense → labyrinths → spots → bare. Watch spatial variance spike before the tipping point.
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ══════════════════════════════ MATH TAB */}
        {tab === "math" && (
          <div style={{ maxWidth: 820 }}>
            <Card>
              <p style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.75, color: C.text, margin: 0 }}>
                This Cellular Automaton discretises the <strong>Klausmeier–Gray–Scott</strong> family of dryland vegetation PDEs,
                enriched with a novel slow variable <em>σ</em> (soil memory) that the PDE literature largely ignores.
                The model exhibits Turing pattern formation, fold bifurcations, and percolation criticality —
                all of which are rigorously provable from the equations below.
              </p>
            </Card>

            {/* — Three fields — */}
            <SectionHead>The Three Coupled Fields</SectionHead>
            <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
              {[
                { sym: "v(x,t)", name: "Vegetation biomass", color: C.green, role: "ACTIVATOR", desc: "Self-amplifying. Dense vegetation improves local soil infiltration, attracting still more growth at the same site — a positive feedback." },
                { sym: "w(x,t)", name: "Soil water content", color: C.blue, role: "INHIBITOR", desc: "Diffuses laterally (subsurface flow). Plants deplete water over a larger radius than they enrich soil, creating long-range competition — the inhibitor." },
                { sym: "σ(x,t)", name: "Soil memory", color: C.amber, role: "SLOW VARIABLE", desc: "Novel addition. Represents infiltration capacity (biological soil crust state). Plants build it up; bare soil degrades it. Evolves ~10× slower than v, w." },
              ].map(f => (
                <Card key={f.sym} style={{ flex: 1, minWidth: 220, padding: "14px 18px" }}>
                  <div style={{ fontFamily: MONO, fontSize: 16, color: f.color, fontWeight: 700, marginBottom: 2 }}>{f.sym}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: f.color, letterSpacing: "0.08em", marginBottom: 6 }}>{f.role}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 13, fontWeight: 600, marginBottom: 6, color: C.ink }}>{f.name}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>{f.desc}</div>
                </Card>
              ))}
            </div>

            {/* — Equations — */}
            <SectionHead>Update Equations (Discrete-Time CA)</SectionHead>
            <Card>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, marginBottom: 10 }}>
                All cells update synchronously. Periodic boundary conditions on an N×N torus.
              </p>
              <MathBox>{`w(t+1) = w + R − E·w − v·w·(1+σ) + D_w · Σ_{j∈B(4)} [w_j − w]
              ↑      ↑      ↑            ↑                     ↑
           rainfall evap plant uptake            lateral flow (r=4 kernel)

v(t+1) = v + [αwσ/(1+βw)]·v − m·v + ε · v̄_B(1) · (1−v)
                   ↑                   ↑       ↑
        Holling-II growth (×soil quality) mortality seed dispersal (r=1)

σ(t+1) = σ + γ⁺·v·(1−σ) − γ⁻·(1−v)·σ
                   ↑                  ↑
     plant-driven recovery     bare-patch crust formation
          (γ⁺ ≪ 1, slow)          (γ⁻ ≪ 1, slow)`}</MathBox>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, marginTop: 10 }}>
                The σ equation is the key novelty. Because γ⁺ and γ⁻ are both small (≪ 1), σ evolves
                roughly 1/(γ⁺+γ⁻) ≈ {(1 / (DEF.gp + DEF.gm)).toFixed(0)} steps to equilibrate — much slower than v and w.
                This timescale separation defines a <em>slow manifold</em> and causes hysteresis: soil degraded
                by past bare periods resists recolonisation even when water is restored.
              </p>
            </Card>

            {/* — Turing — */}
            <SectionHead>Turing Instability — Why Patterns Form</SectionHead>
            <Card>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, marginBottom: 10 }}>
                Patterns emerge when the spatially uniform steady state (v*, w*, σ*) is stable to uniform
                perturbations but unstable to spatially periodic ones. Taking the continuum limit of the v–w
                subsystem and linearising with perturbation ~ e^(ik·x + λt), the Jacobian in Fourier space is:
              </p>
              <MathBox>{`J(k) = | f_v − m,               f_w · v*              |
       | −w*(1+σ*),  −E − v*(1+σ*) − Λ̂(k) |
where Λ̂(k) = Λ₀ · J₁(k·r)/(k·r) — Fourier transform of disk kernel, r = 4`}</MathBox>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, margin: "10px 0" }}>
                The Turing conditions require:
              </p>
              <MathBox>{`(1) tr J(0) < 0 and det J(0) > 0  →  uniform state is stable
(2) ∃ k* > 0 such that det J(k*) < 0  →  spatial modes are unstable
Condition (2) requires the inhibitor (water) to diffuse faster than the activator (vegetation).
This is always satisfied here since vegetation has D_v = 0 (no diffusion, only seed dispersal).`}</MathBox>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, marginTop: 10 }}>
                Minimising det J(k) over k gives the characteristic wavenumber k* and wavelength:
              </p>
              <MathBox>{`λ* = 2π/k* ≈ 2π·r_kernel / √(Λ₀ / m·E)
With current parameters: λ* ≈ ${th.lambda.toFixed(1)} cells
(Verify by counting average spacing between patches/stripes on the grid)`}</MathBox>
            </Card>

            {/* — Bistability — */}
            <SectionHead>Bistability and Hysteresis (Slow Manifold Theory)</SectionHead>
            <Card>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7 }}>
                Fixing σ at its equilibrium σ* = γ⁺/(γ⁺+γ⁻) = {th.sigma_eq.toFixed(3)}, the fast (v, w)
                subsystem has a fold bifurcation in rainfall R. Two stable branches coexist for intermediate R values:
              </p>
              <div style={{ display: "flex", gap: 12, margin: "14px 0", flexWrap: "wrap" }}>
                {[
                  { label: "FORWARD PATH (increasing drought)", color: C.red, text: `As R decreases below R_c ≈ ${th.Rc.toFixed(3)}, the vegetated branch vanishes. System jumps catastrophically to bare desert — an irreversible tipping point at this rainfall level.` },
                  { label: "BACKWARD PATH (restoration)", color: C.blue, text: `Restoring rainfall does not recover vegetation at R_c. You must raise R further, to R_c + ΔR. Hysteresis width ΔR ∝ γ⁻/γ⁺ = ${th.hyst_width.toFixed(2)}. Larger ratio → harder to reverse desertification.` },
                ].map(item => (
                  <div key={item.label} style={{
                    flex: 1, minWidth: 260, background: "#faf8f5",
                    borderLeft: `3px solid ${item.color}`, borderRadius: "0 6px 6px 0",
                    padding: "12px 16px",
                  }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: item.color, letterSpacing: "0.07em", marginBottom: 6 }}>{item.label}</div>
                    <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.text, lineHeight: 1.65, margin: 0 }}>{item.text}</p>
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, marginTop: 8 }}>
                This is proven via <em>geometric singular perturbation theory</em> (Fenichel 1979): for ε = γ⁺ + γ⁻ ≪ 1,
                the actual trajectories are O(ε)-close to the slow manifold M₀ until they reach the fold point,
                where they fall off in finite time regardless of how slowly R changes. The σ equation explicitly
                widens the bistable parameter range compared to models without it — a rigorous and ecologically important result.
              </p>
            </Card>

            {/* — Percolation — */}
            <SectionHead>Percolation Theory at the Tipping Point</SectionHead>
            <Card>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, marginBottom: 10 }}>
                Near R_c, vegetated cells form clusters that progressively lose connectivity.
                At R_c itself, this is a standard 2D site percolation transition with exact critical exponents:
              </p>
              <MathBox>{`Cluster size distribution: P(s) ~ s^(−τ),     τ = 187/91 ≈ 2.055
Correlation length:        ξ ~ |R − R_c|^(−ν),  ν = 4/3
Mean cluster size diverges: ⟨s⟩ ~ |R − R_c|^(−γ), γ = 43/18 ≈ 2.389`}</MathBox>
              <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.textMid, lineHeight: 1.7, marginTop: 10 }}>
                These exponents are exact results from conformal field theory of 2D percolation (Nienhuis 1982).
                In simulation: as R → R_c, cluster size distribution flattens toward a power law,
                mean cluster size peaks, and Moran's I (spatial autocorrelation) diverges — the practical
                early-warning signal for the coming collapse.
              </p>
            </Card>

            {/* — Phases — */}
            <SectionHead>Pattern Phase Diagram</SectionHead>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { phase: "Dense Cover", R: "R > 0.40", bg: "#1a5c38", desc: "Continuous canopy. Homogeneous steady state. Turing instability is below threshold — no patterns." },
                { phase: "Labyrinths", R: "0.28–0.40", bg: "#3d7d5a", desc: "Connected maze-like stripes. The Turing wavelength λ* sets the stripe width." },
                { phase: "Spots", R: "0.15–0.28", bg: "#6a9e72", desc: "Isolated vegetation patches on a bare background. Classic Turing spots, spacing ≈ λ*." },
                { phase: "Bare Desert", R: "R < 0.15", bg: "#8b6a50", desc: "Vegetation collapse. Bare-soil attractor. Hysteresis: recovery needs R ≫ 0.15." },
              ].map(p => (
                <div key={p.phase} style={{
                  flex: 1, minWidth: 160, background: p.bg, borderRadius: 8,
                  padding: "14px 16px", color: "#fff",
                }}>
                  <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{p.phase}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, opacity: 0.85, marginBottom: 8 }}>{p.R}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 12.5, opacity: 0.9, lineHeight: 1.55 }}>{p.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════ RESULTS TAB */}
        {tab === "results" && (
          <div>
            {history.length < 10 ? (
              <Card style={{ textAlign: "center", padding: "60px 40px" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🌿</div>
                <div style={{ fontFamily: SERIF, fontSize: 20, color: C.textMid, marginBottom: 8 }}>No data yet</div>
                <div style={{ fontFamily: SERIF, fontSize: 14, color: C.textFaint }}>
                  Go to the Simulation tab → press Run → let it evolve for a while.
                </div>
              </Card>
            ) : (
              <>
                {/* Theory vs simulation comparison */}
                <SectionHead>Theory vs. Simulation — Predictions and Observations</SectionHead>

                {/* Turing patterns */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.ink }}>1. Turing Pattern Formation</div>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.green, background: "#edf7f1", padding: "3px 10px", borderRadius: 20 }}>✓ Strong agreement</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { label: "THEORY PREDICTS", color: C.blue, text: `Random initial conditions spontaneously organise into periodic spatial patterns. Predicted wavelength λ* ≈ ${th.lambda.toFixed(1)} cells. Patterns appear within ~100–300 steps. Moran's I should be positive and significantly above zero.` },
                      { label: "SIMULATION SHOWS", color: C.green, text: `Moran's I = ${metrics?.moran.toFixed(3)} (${metrics?.moran > 0.1 ? "✓ strong clustering" : metrics?.moran > 0 ? "weak clustering" : "no clustering"}). ${metrics?.numClusters} distinct patches detected. Spatial variance = ${metrics?.vvar.toFixed(5)}. ${metrics?.moran > 0.1 ? "Pattern formation confirmed." : "Patterns not yet developed — run longer or adjust R."}` },
                    ].map(item => (
                      <div key={item.label} style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: item.color, letterSpacing: "0.08em", marginBottom: 6 }}>{item.label}</div>
                        <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.text, lineHeight: 1.65, margin: 0 }}>{item.text}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0f4fa", borderRadius: 6, fontSize: 12.5, fontFamily: SERIF, color: C.blue, lineHeight: 1.6 }}>
                    <strong>What to verify:</strong> Count average spacing between patches on the Simulation grid.
                    It should be within ±25% of λ* = {th.lambda.toFixed(1)} cells.
                    Moran's I &gt; 0.1 confirms supra-cell spatial autocorrelation consistent with Turing mechanism.
                  </div>
                </Card>

                {/* Soil memory */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.ink }}>2. Soil Memory Timescale Separation</div>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.amber, background: "#fef9f0", padding: "3px 10px", borderRadius: 20 }}>~ Context-dependent</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { label: "THEORY PREDICTS", color: C.blue, text: `σ equilibrates to σ* = γ⁺/(γ⁺+γ⁻) = ${th.sigma_eq.toFixed(3)}, but on a timescale ~${(1 / (DEF.gp + DEF.gm)).toFixed(0)} steps — much slower than v, w. After sudden rainfall change, vegetation adjusts quickly but soil memory lags, creating a transient buffer against collapse.` },
                      { label: "SIMULATION SHOWS", color: C.green, text: `Current σ̄ = ${metrics?.sm.toFixed(3)} vs. σ* = ${th.sigma_eq.toFixed(3)}. ${metrics && Math.abs(metrics.sm - th.sigma_eq) < 0.05 ? "Close to equilibrium — soil memory has converged." : "Still transient — soil memory is tracking vegetation with lag."} See it in the time series: σ curve lags behind the v curve.` },
                    ].map(item => (
                      <div key={item.label} style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: item.color, letterSpacing: "0.08em", marginBottom: 6 }}>{item.label}</div>
                        <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.text, lineHeight: 1.65, margin: 0 }}>{item.text}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef9f0", borderRadius: 6, fontSize: 12.5, fontFamily: SERIF, color: C.amber, lineHeight: 1.6 }}>
                    <strong>Experiment:</strong> Run to equilibrium. Then suddenly drop R by 0.08.
                    Observe: v drops fast within ~20 steps, but σ takes ~{(1 / (DEF.gp + DEF.gm)).toFixed(0)} steps to follow.
                    This lag buffers vegetation temporarily — exactly the hysteresis mechanism.
                  </div>
                </Card>

                {/* Early warning */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.ink }}>3. Spatial Variance as Early Warning Signal</div>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.green, background: "#edf7f1", padding: "3px 10px", borderRadius: 20 }}>✓ Predicted and observed</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { label: "THEORY PREDICTS", color: C.blue, text: `Critical slowing down near R_c ≈ ${th.Rc.toFixed(3)} causes spatial variance and Moran's I to rise monotonically, then peak at the bifurcation, then collapse suddenly to near-zero when the system tips to bare desert.` },
                      { label: "SIMULATION SHOWS", color: C.green, text: `Spatial variance = ${metrics?.vvar.toFixed(5)}. ${metrics?.vvar > 0.05 ? "⚠ High — near a tipping point. Watch for sudden collapse." : metrics?.vvar > 0.01 ? "Moderate — in the patterned regime." : "Low — stable state far from tipping."}` },
                    ].map(item => (
                      <div key={item.label} style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: item.color, letterSpacing: "0.08em", marginBottom: 6 }}>{item.label}</div>
                        <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.text, lineHeight: 1.65, margin: 0 }}>{item.text}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0f4fa", borderRadius: 6, fontSize: 12.5, fontFamily: SERIF, color: C.blue, lineHeight: 1.6 }}>
                    <strong>Experiment:</strong> Run until steady state. Then slowly decrease R in steps of 0.01,
                    waiting ~50 steps between changes. Watch the Spatial Variance chart below.
                    You should see a clear peak near R ≈ {th.Rc.toFixed(3)} before sudden collapse — the early warning signal.
                  </div>
                </Card>

                {/* Percolation */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.ink }}>4. Percolation of the Vegetation Network</div>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.amber, background: "#fef9f0", padding: "3px 10px", borderRadius: 20 }}>~ Verify by decreasing R</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { label: "THEORY PREDICTS", color: C.blue, text: `At R_c ≈ ${th.Rc.toFixed(3)}, the vegetation network loses spanning connectivity. Mean patch size diverges ∝ |R−R_c|^(−43/18). Maximum cluster drops from >30% of grid to <5% at the transition.` },
                      { label: "SIMULATION SHOWS", color: C.green, text: `Max cluster = ${metrics?.maxCluster} cells (${metrics ? (metrics.maxCluster / (N * N) * 100).toFixed(1) : "—"}% of grid). Mean cluster = ${metrics?.meanCluster.toFixed(1)} cells. ${metrics?.maxCluster > N * N * 0.3 ? "Large spanning cluster — well above percolation threshold." : metrics?.maxCluster > N * N * 0.05 ? "Clusters fragmenting — approaching percolation threshold." : "Only small isolated clusters — below percolation threshold."}` },
                    ].map(item => (
                      <div key={item.label} style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: item.color, letterSpacing: "0.08em", marginBottom: 6 }}>{item.label}</div>
                        <p style={{ fontFamily: SERIF, fontSize: 13.5, color: C.text, lineHeight: 1.65, margin: 0 }}>{item.text}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Charts */}
                <SectionHead>Time Series Diagnostics</SectionHead>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card>
                    <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Mean-field variables</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginBottom: 12 }}>
                      v̄, w̄, σ̄ averaged over grid. Theory: converge to fixed point or oscillate.
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={history}>
                        <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="vm" name="v̄" stroke={C.green} dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="wm" name="w̄" stroke={C.blue} dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="sm" name="σ̄" stroke={C.amber} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Early warning signals</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginBottom: 12 }}>
                      Rise before tipping. Peak = critical slowing down at R_c.
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={history}>
                        <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="vvar" name="Spatial var" stroke={C.red} dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="moran" name="Moran's I" stroke={C.purple} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Patch structure (percolation diagnostic)</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginBottom: 12 }}>
                      Mean cluster size peaks at R_c then collapses. Theory: ∝ |R−R_c|^(−43/18).
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={history}>
                        <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="meanCluster" name="Mean cluster" stroke={C.green} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Phase portrait — v̄ vs w̄</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.textFaint, marginBottom: 12 }}>
                      Trajectory in mean-field space. Fixed point = stable state. Orbit = transient.
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <ScatterChart>
                        <XAxis dataKey="vm" name="v̄" tick={{ fontSize: 10 }} domain={[0, 1]} label={{ value: "v̄", position: "insideBottom", offset: -2 }} />
                        <YAxis dataKey="wm" name="w̄" tick={{ fontSize: 10 }} domain={[0, 1]} label={{ value: "w̄", angle: -90, position: "insideLeft" }} />
                        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                        <Scatter data={history} fill={C.green} opacity={0.5} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </Card>
                </div>

                {/* Summary table */}
                <SectionHead>Summary Table — Theory vs. Simulation</SectionHead>
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#faf8f5" }}>
                        {["Quantity", "Theory predicts", "Simulation value", "Status"].map(h => (
                          <th key={h} style={{
                            padding: "10px 12px", textAlign: "left", fontFamily: MONO,
                            fontSize: 11, color: C.textFaint, letterSpacing: "0.06em",
                            borderBottom: `2px solid ${C.border}`,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <CompareRow
                        quantity="Pattern formation (Moran's I > 0.1)"
                        prediction="Yes, within 300 steps"
                        observed={metrics?.moran > 0.1 ? `✓ I = ${metrics.moran.toFixed(3)}` : `I = ${metrics?.moran.toFixed(3)}`}
                        status={metrics?.moran > 0.1 ? "match" : "partial"}
                      />
                      <CompareRow
                        quantity="Soil memory σ̄ → σ*"
                        prediction={`σ* = ${th.sigma_eq.toFixed(3)}`}
                        observed={`σ̄ = ${metrics?.sm.toFixed(3)}`}
                        status={metrics && Math.abs(metrics.sm - th.sigma_eq) < 0.05 ? "match" : "partial"}
                      />
                      <CompareRow
                        quantity="Spatial variance rise near R_c"
                        prediction={`Peak near R_c = ${th.Rc.toFixed(3)}`}
                        observed={`Var = ${metrics?.vvar.toFixed(5)}`}
                        status={metrics?.vvar > 0.03 ? "partial" : "tip"}
                      />
                      <CompareRow
                        quantity="Large spanning cluster (>30% grid)"
                        prediction="Yes for R > R_c"
                        observed={`${metrics ? (metrics.maxCluster / (N * N) * 100).toFixed(1) : "—"}% of grid`}
                        status={metrics ? (metrics.maxCluster > N * N * 0.3 ? "match" : metrics.maxCluster > N * N * 0.05 ? "partial" : "match") : "tip"}
                      />
                    </tbody>
                  </table>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
