import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0f1410", panel: "#161d18", border: "#263020",
  green: "#4ade80", greenDim: "#22543d", greenBright: "#86efac",
  amber: "#fbbf24", blue: "#60a5fa", red: "#f87171",
  text: "#e2e8e0", textMid: "#8fa88a", textFaint: "#4a5e46",
  ink: "#f0f4ef",
};
const MONO = "'JetBrains Mono', 'Fira Mono', monospace";

// ── Build disk offsets ────────────────────────────────────────────────────────
function buildOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) o.push([dx, dy]);
  return o;
}

// ── CA step (N is dynamic) ────────────────────────────────────────────────────
function caStep(state, p, N, W_OFF, S_OFF) {
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

// ── Init state ────────────────────────────────────────────────────────────────
function initState(N, seed = 42, initDensity = 0.28) {
  let s = seed | 0;
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  const v = new Float32Array(N * N);
  const w = new Float32Array(N * N);
  const σ = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    v[i] = rng() < initDensity ? rng() * 0.6 + 0.2 : 0;
    w[i] = 0.25 + rng() * 0.25;
    σ[i] = v[i] > 0 ? 0.4 + rng() * 0.4 : 0.1 + rng() * 0.2;
  }
  return { v, w, σ };
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function computeMetrics(state, N) {
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
        moran += (v[i] - vm) * (v[j] - vm); moranC++;
      }
    }
  moran = vvar > 0 ? moran / (moranC * vvar) : 0;
  const thr = 0.15, visited = new Uint8Array(N * N), sizes = [];
  for (let start = 0; start < N * N; start++) {
    if (v[start] < thr || visited[start]) continue;
    let q = [start], size = 0; visited[start] = 1;
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
  return {
    vm, wm, sm, vvar, moran,
    maxCluster: sizes.length ? Math.max(...sizes) : 0,
    meanCluster: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
    numClusters: sizes.length,
  };
}

// ── Render canvas ─────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function colorVeg(val) {
  if (val < 0.15) { const t = val / 0.15; return [lerp(30, 50, t), lerp(30, 70, t), lerp(25, 40, t)]; }
  if (val < 0.50) { const t = (val - 0.15) / 0.35; return [lerp(50, 30, t), lerp(70, 160, t), lerp(40, 60, t)]; }
  const t = (val - 0.5) / 0.5; return [lerp(30, 10, t), lerp(160, 220, t), lerp(60, 80, t)];
}
function colorWater(val) { return [lerp(15, 20, val), lerp(20, 100, val), lerp(30, 200, val)]; }
function colorSigma(val) { return [lerp(20, 160, val), lerp(30, 130, val), lerp(20, 20, val)]; }

function renderCanvas(canvas, state, view, N) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const size = Math.floor(560 / N);
  const arr = view === "veg" ? state.v : view === "water" ? state.w : state.σ;
  const cfn = view === "veg" ? colorVeg : view === "water" ? colorWater : colorSigma;
  const img = ctx.createImageData(N * size, N * size);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [r, g, b] = cfn(arr[y * N + x]);
      for (let py = 0; py < size; py++)
        for (let px = 0; px < size; px++) {
          const pi = ((y * size + py) * N * size + x * size + px) * 4;
          img.data[pi] = r; img.data[pi + 1] = g; img.data[pi + 2] = b; img.data[pi + 3] = 255;
        }
    }
  ctx.putImageData(img, 0, 0);
}

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS = {
  "Dense Cover":   { R: 0.50, E: 0.45, alpha: 3.2, beta: 2.0, mort: 0.18, eps: 0.04, gp: 0.06, gm: 0.03, wr: 4, sr: 1 },
  "Labyrinths":    { R: 0.32, E: 0.45, alpha: 3.2, beta: 2.0, mort: 0.18, eps: 0.04, gp: 0.06, gm: 0.03, wr: 4, sr: 1 },
  "Spots":         { R: 0.22, E: 0.45, alpha: 3.2, beta: 2.0, mort: 0.18, eps: 0.04, gp: 0.06, gm: 0.03, wr: 4, sr: 1 },
  "Tiger Stripes": { R: 0.30, E: 0.40, alpha: 3.8, beta: 1.5, mort: 0.15, eps: 0.02, gp: 0.05, gm: 0.02, wr: 6, sr: 1 },
  "Fairy Circles": { R: 0.38, E: 0.42, alpha: 2.8, beta: 2.5, mort: 0.14, eps: 0.06, gp: 0.07, gm: 0.04, wr: 3, sr: 2 },
  "Near Collapse": { R: 0.16, E: 0.45, alpha: 3.2, beta: 2.0, mort: 0.18, eps: 0.04, gp: 0.06, gm: 0.03, wr: 4, sr: 1 },
};

const DEF = PRESETS["Spots"];

// ── Slider ────────────────────────────────────────────────────────────────────
function Slider({ label, k, min, max, step, params, setParams, format = v => v.toFixed(3) }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: C.textMid, fontFamily: MONO }}>{label}</span>
        <span style={{ fontSize: 11, color: C.green, fontFamily: MONO, fontWeight: 600 }}>
          {format(params[k])}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={params[k]}
        onChange={e => setParams(p => ({ ...p, [k]: +e.target.value }))}
        style={{ width: "100%", accentColor: C.green, cursor: "pointer", height: 3 }} />
    </div>
  );
}

// ── Stat chip ─────────────────────────────────────────────────────────────────
function Chip({ label, value, color = C.textMid }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "6px 10px", flex: "1 1 80px",
    }}>
      <div style={{ fontSize: 9, fontFamily: MONO, color: C.textFaint, letterSpacing: "0.08em", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontFamily: MONO, color, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [params, setParams] = useState(DEF);
  const [gridN, setGridN] = useState(80);
  const [initDensity, setInitDensity] = useState(0.28);
  const [view, setView] = useState("veg");
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [metrics, setMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [showCharts, setShowCharts] = useState(false);

  const stateRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const paramsRef = useRef(params);
  const viewRef = useRef(view);
  const gridNRef = useRef(gridN);

  // keep refs in sync
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { gridNRef.current = gridN; }, [gridN]);

  // derived offsets
  const W_OFF = useRef(buildOffsets(params.wr));
  const S_OFF = useRef(buildOffsets(params.sr));
  useEffect(() => { W_OFF.current = buildOffsets(params.wr); }, [params.wr]);
  useEffect(() => { S_OFF.current = buildOffsets(params.sr); }, [params.sr]);

  // init on mount or N/density change
  const doReset = useCallback((N = gridNRef.current, density = initDensity) => {
    setRunning(false);
    cancelAnimationFrame(animRef.current);
    stateRef.current = initState(N, Math.random() * 1e6 | 0, density);
    setTick(0); setHistory([]); setMetrics(null);
    setTimeout(() => renderCanvas(canvasRef.current, stateRef.current, viewRef.current, N), 0);
  }, [initDensity]);

  useEffect(() => { doReset(gridN, initDensity); }, [gridN, initDensity]); // eslint-disable-line

  // re-render on view change
  useEffect(() => {
    if (stateRef.current) renderCanvas(canvasRef.current, stateRef.current, view, gridNRef.current);
  }, [view]);

  const doStep = useCallback(() => {
    const N = gridNRef.current;
    stateRef.current = caStep(stateRef.current, paramsRef.current, N, W_OFF.current, S_OFF.current);
    renderCanvas(canvasRef.current, stateRef.current, viewRef.current, N);
    setTick(t => {
      const nt = t + 1;
      if (nt % 5 === 0) {
        const m = computeMetrics(stateRef.current, N);
        setMetrics(m);
        setHistory(h => [...h.slice(-300), {
          t: nt,
          vm: +m.vm.toFixed(3), wm: +m.wm.toFixed(3), sm: +m.sm.toFixed(3),
          vvar: +m.vvar.toFixed(5), moran: +m.moran.toFixed(3),
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

  const applyPreset = (name) => {
    const p = PRESETS[name];
    setParams(p);
    paramsRef.current = p;
    W_OFF.current = buildOffsets(p.wr);
    S_OFF.current = buildOffsets(p.sr);
  };

  const regime = metrics
    ? (metrics.vm > 0.45 ? "Dense Cover" : metrics.vm > 0.20 ? "Patterned" : metrics.vm > 0.05 ? "Sparse / Spots" : "Bare Desert")
    : "—";
  const regimeColor = metrics
    ? (metrics.vm > 0.45 ? C.green : metrics.vm > 0.20 ? C.amber : metrics.vm > 0.05 ? "#f97316" : C.red)
    : C.textFaint;

  const canvasSize = Math.floor(560 / gridN) * gridN;

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: MONO, padding: "0 0 40px 0",
    }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        background: C.panel, borderBottom: `1px solid ${C.border}`,
        padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.greenBright, letterSpacing: "-0.02em" }}>
            vegetation ca
          </span>
          <span style={{ fontSize: 11, color: C.textFaint, marginLeft: 14 }}>
            dryland self-organisation
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.textFaint }}>t = {tick}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: regimeColor }}>{regime}</span>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, maxWidth: 1260, margin: "0 auto", padding: "20px 16px 0" }}>

        {/* ── Left: canvas + view + controls ─────────────────── */}
        <div style={{ flex: "0 0 auto" }}>

          {/* View toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[["veg", "vegetation"], ["water", "water"], ["soil", "soil σ"]].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)} style={{
                padding: "5px 14px", borderRadius: 4, cursor: "pointer",
                fontFamily: MONO, fontSize: 11, letterSpacing: "0.04em",
                background: view === id ? C.greenDim : "transparent",
                color: view === id ? C.greenBright : C.textFaint,
                border: `1px solid ${view === id ? C.green : C.border}`,
                transition: "all 0.1s",
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            width={canvasSize} height={canvasSize}
            style={{
              display: "block", borderRadius: 6,
              border: `1px solid ${C.border}`,
              imageRendering: "pixelated",
            }}
          />

          {/* Run controls */}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setRunning(r => !r)} style={{
              flex: 1, padding: "9px 0", borderRadius: 5, cursor: "pointer",
              fontSize: 13, fontFamily: MONO, fontWeight: 700,
              background: running ? "#3d1515" : "#0f2d1a",
              color: running ? C.red : C.green,
              border: `1px solid ${running ? C.red : C.green}`,
            }}>
              {running ? "■ stop" : "▶ run"}
            </button>
            <button onClick={doStep} style={{
              padding: "9px 16px", borderRadius: 5, cursor: "pointer",
              fontSize: 13, fontFamily: MONO,
              background: "transparent", color: C.textMid, border: `1px solid ${C.border}`,
            }}>step</button>
            <button onClick={() => doReset(gridN, initDensity)} style={{
              padding: "9px 16px", borderRadius: 5, cursor: "pointer",
              fontSize: 13, fontFamily: MONO,
              background: "transparent", color: C.textMid, border: `1px solid ${C.border}`,
            }}>reset</button>
          </div>

          {/* Stats */}
          {metrics && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              <Chip label="veg cover" value={`${(metrics.vm * 100).toFixed(1)}%`} color={C.green} />
              <Chip label="soil water" value={metrics.wm.toFixed(3)} color={C.blue} />
              <Chip label="soil σ" value={metrics.sm.toFixed(3)} color={C.amber} />
              <Chip label="spatial var" value={metrics.vvar.toFixed(4)} color={metrics.vvar > 0.04 ? C.red : C.textMid} />
              <Chip label="moran I" value={metrics.moran.toFixed(3)} color={metrics.moran > 0.1 ? C.greenBright : C.textMid} />
              <Chip label="patches" value={metrics.numClusters} />
              <Chip label="max cluster" value={`${((metrics.maxCluster / (gridN * gridN)) * 100).toFixed(1)}%`} />
            </div>
          )}

          {/* Charts toggle */}
          <button onClick={() => setShowCharts(s => !s)} style={{
            marginTop: 12, width: "100%", padding: "7px 0", borderRadius: 5,
            cursor: "pointer", fontSize: 11, fontFamily: MONO,
            background: "transparent", color: C.textFaint,
            border: `1px solid ${C.border}`,
          }}>
            {showCharts ? "▲ hide charts" : "▼ show charts"}
          </button>

          {showCharts && history.length > 5 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 4 }}>mean-field dynamics</div>
              <ResponsiveContainer width={canvasSize} height={130}>
                <LineChart data={history} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <XAxis dataKey="t" tick={{ fontSize: 9, fill: C.textFaint }} />
                  <YAxis tick={{ fontSize: 9, fill: C.textFaint }} domain={[0, 1]} />
                  <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="vm" name="v̄" stroke={C.green} dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="wm" name="w̄" stroke={C.blue} dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="sm" name="σ̄" stroke={C.amber} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 10, color: C.textFaint, marginTop: 8, marginBottom: 4 }}>early-warning signals</div>
              <ResponsiveContainer width={canvasSize} height={110}>
                <LineChart data={history} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <XAxis dataKey="t" tick={{ fontSize: 9, fill: C.textFaint }} />
                  <YAxis tick={{ fontSize: 9, fill: C.textFaint }} />
                  <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="vvar" name="variance" stroke={C.red} dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="moran" name="moran I" stroke={C.greenBright} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Right: parameters ───────────────────────────────── */}
        <div style={{
          flex: 1, marginLeft: 20, minWidth: 0,
          display: "flex", flexDirection: "column", gap: 14,
        }}>

          {/* Presets */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", marginBottom: 10 }}>
              PATTERN PRESETS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.keys(PRESETS).map(name => (
                <button key={name} onClick={() => applyPreset(name)} style={{
                  padding: "5px 12px", borderRadius: 4, cursor: "pointer",
                  fontSize: 11, fontFamily: MONO,
                  background: "transparent", color: C.textMid,
                  border: `1px solid ${C.border}`,
                  transition: "all 0.1s",
                }}
                  onMouseEnter={e => { e.target.style.borderColor = C.green; e.target.style.color = C.green; }}
                  onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.textMid; }}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Grid settings */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", marginBottom: 12 }}>
              GRID & INITIAL CONDITIONS
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: C.textMid }}>grid size (N)</span>
                <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>{gridN} × {gridN}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[40, 60, 80, 100, 120].map(n => (
                  <button key={n} onClick={() => setGridN(n)} style={{
                    padding: "4px 12px", borderRadius: 4, cursor: "pointer",
                    fontSize: 11, fontFamily: MONO,
                    background: gridN === n ? C.greenDim : "transparent",
                    color: gridN === n ? C.greenBright : C.textFaint,
                    border: `1px solid ${gridN === n ? C.green : C.border}`,
                  }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: C.textMid }}>initial veg density</span>
                <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>{(initDensity * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0.05} max={0.70} step={0.05} value={initDensity}
                onChange={e => setInitDensity(+e.target.value)}
                style={{ width: "100%", accentColor: C.green, cursor: "pointer", height: 3 }} />
            </div>
          </div>

          {/* Ecology params */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", marginBottom: 12 }}>
              ECOLOGICAL PARAMETERS
            </div>
            <Slider label="rainfall  R" k="R" min={0.05} max={0.65} step={0.005} params={params} setParams={setParams} />
            <Slider label="evaporation  E" k="E" min={0.10} max={0.90} step={0.01} params={params} setParams={setParams} />
            <Slider label="plant uptake  α" k="alpha" min={0.5} max={7.0} step={0.1} params={params} setParams={setParams} />
            <Slider label="saturation  β" k="beta" min={0.2} max={6.0} step={0.1} params={params} setParams={setParams} />
            <Slider label="mortality  m" k="mort" min={0.02} max={0.55} step={0.005} params={params} setParams={setParams} />
            <Slider label="seed dispersal  ε" k="eps" min={0.00} max={0.20} step={0.005} params={params} setParams={setParams} />
            <Slider label="soil recovery  γ⁺" k="gp" min={0.01} max={0.20} step={0.005} params={params} setParams={setParams} />
            <Slider label="soil degradation  γ⁻" k="gm" min={0.005} max={0.15} step={0.005} params={params} setParams={setParams} />
          </div>

          {/* Kernel radii */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", marginBottom: 12 }}>
              KERNEL RADII  <span style={{ color: C.textFaint, fontWeight: 400 }}>(controls pattern scale)</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.textMid }}>water diffusion radius  r_w</span>
                <span style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>{params.wr}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[2, 3, 4, 5, 6, 7].map(r => (
                  <button key={r} onClick={() => setParams(p => ({ ...p, wr: r }))} style={{
                    padding: "4px 12px", borderRadius: 4, cursor: "pointer",
                    fontSize: 11, fontFamily: MONO,
                    background: params.wr === r ? "#1a2a3a" : "transparent",
                    color: params.wr === r ? C.blue : C.textFaint,
                    border: `1px solid ${params.wr === r ? C.blue : C.border}`,
                  }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.textMid }}>seed dispersal radius  r_s</span>
                <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>{params.sr}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4].map(r => (
                  <button key={r} onClick={() => setParams(p => ({ ...p, sr: r }))} style={{
                    padding: "4px 12px", borderRadius: 4, cursor: "pointer",
                    fontSize: 11, fontFamily: MONO,
                    background: params.sr === r ? "#0f2d1a" : "transparent",
                    color: params.sr === r ? C.greenBright : C.textFaint,
                    border: `1px solid ${params.sr === r ? C.green : C.border}`,
                  }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div style={{
              marginTop: 12, padding: "8px 10px",
              background: "#0d1a10", borderRadius: 5,
              fontSize: 10, color: C.textFaint, lineHeight: 1.6,
            }}>
              λ* ≈ {(2 * Math.PI * params.wr / Math.sqrt((params.R * params.alpha) / (params.mort * params.E * (1 + params.beta * 0.25)))).toFixed(1)} cells
              &nbsp;·&nbsp; ratio r_w/r_s = {(params.wr / params.sr).toFixed(1)} (must be &gt; 1 for Turing patterns)
            </div>
          </div>

          {/* Theory quick-ref */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", marginBottom: 10 }}>
              LIVE THEORY
            </div>
            {[
              ["σ* (soil eq.)", (params.gp / (params.gp + params.gm)).toFixed(3), C.amber],
              ["R_c (collapse)", ((params.mort * params.E) / (params.alpha * params.gp / (params.gp + params.gm))).toFixed(3), C.red],
              ["λ* (wavelength)", `${(2 * Math.PI * params.wr / Math.sqrt((params.R * params.alpha) / (params.mort * params.E * (1 + params.beta * 0.25)))).toFixed(1)} cells`, C.green],
              ["Δ R_hyst ∝", (params.gm / params.gp).toFixed(2), C.blue],
            ].map(([l, v, col]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.textFaint }}>{l}</span>
                <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}