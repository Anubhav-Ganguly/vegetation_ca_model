import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

/* -------------------------------------------------------------------------- */
/*                                   THEME                                    */
/* -------------------------------------------------------------------------- */

const C = {
  bg: "#0f1410",
  panel: "#161d18",
  border: "#263020",
  green: "#4ade80",
  greenDim: "#22543d",
  greenBright: "#86efac",
  amber: "#fbbf24",
  blue: "#60a5fa",
  red: "#f87171",
  text: "#e2e8e0",
  textMid: "#8fa88a",
  textFaint: "#4a5e46",
};

const MONO = "'JetBrains Mono', monospace";

/* -------------------------------------------------------------------------- */
/*                                UTILITIES                                   */
/* -------------------------------------------------------------------------- */

const clamp = (x) => Math.max(0, Math.min(1, x));

function buildOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) o.push([dx, dy]);
  return o;
}

/* -------------------------------------------------------------------------- */
/*                                 CA STEP                                    */
/* -------------------------------------------------------------------------- */

function caStep(state, p, N, W_OFF, S_OFF) {
  const { v, w, σ } = state;
  const { R, E, alpha, beta, mort, eps, gp, gm } = p;

  const nv = new Float32Array(N * N);
  const nw = new Float32Array(N * N);
  const nσ = new Float32Array(N * N);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {

      const i = y * N + x;
      const vi = v[i];
      const wi = w[i];
      const si = σ[i];

      /* -------------------- water diffusion -------------------- */

      let wsum = 0;
      for (const [dx, dy] of W_OFF)
        wsum += w[((y + dy + N) % N) * N + (x + dx + N) % N];

      const wavg = wsum / W_OFF.length;
      const wflow = wavg - wi;

      /* ------------- long range vegetation competition ---------- */

      let vLong = 0;
      for (const [dx, dy] of W_OFF)
        vLong += v[((y + dy + N) % N) * N + (x + dx + N) % N];

      vLong /= W_OFF.length;

      /* --------------------- seed dispersal ---------------------- */

      let vseed = 0;
      for (const [dx, dy] of S_OFF)
        vseed += v[((y + dy + N) % N) * N + (x + dx + N) % N];

      vseed /= S_OFF.length;

      /* ------------------------ WATER ---------------------------- */
      nw[i] = clamp(
        wi
        + R
        - E * wi
        - vi * wi * (1 + si)     // local uptake
        - 0.7 * vLong * wi       // long range depletion (NEW)
        + 0.8 * wflow            // strong diffusion
      );

      /* --------------------- VEGETATION -------------------------- */
      nv[i] = clamp(
        vi
        + (alpha * wi * si / (1 + beta * wi)) * vi
        - mort * vi
        + eps * vseed * (1 - vi)
      );

      /* ----------------------- SOIL ------------------------------ */
      nσ[i] = clamp(
        si
        + gp * vi * (1 - si)
        - gm * (1 - vi) * si
      );
    }
  }

  return { v: nv, w: nw, σ: nσ };
}

/* -------------------------------------------------------------------------- */
/*                               INITIAL STATE                                */
/* -------------------------------------------------------------------------- */

function initState(N, seed = 1, density = 0.15) {
  let s = seed | 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };

  const v = new Float32Array(N * N);
  const w = new Float32Array(N * N);
  const σ = new Float32Array(N * N);

  for (let i = 0; i < N * N; i++) {
    v[i] = rng() < density ? 0.3 + rng() * 0.2 : 0;
    w[i] = 0.3 + rng() * 0.2;
    σ[i] = 0.3 + rng() * 0.2;
  }

  return { v, w, σ };
}

/* -------------------------------------------------------------------------- */
/*                                  PRESETS                                   */
/* -------------------------------------------------------------------------- */

const PRESETS = {
  "Spots":         { R: 0.22, E: 0.45, alpha: 4.0, beta: 2.0, mort: 0.18, eps: 0.01, gp: 0.06, gm: 0.04, wr: 6, sr: 1 },
  "Labyrinths":    { R: 0.27, E: 0.45, alpha: 4.0, beta: 2.0, mort: 0.18, eps: 0.01, gp: 0.06, gm: 0.04, wr: 6, sr: 1 },
  "Tiger Stripes": { R: 0.30, E: 0.40, alpha: 4.5, beta: 1.5, mort: 0.15, eps: 0.01, gp: 0.05, gm: 0.03, wr: 7, sr: 1 },
  "Dense Cover":   { R: 0.40, E: 0.40, alpha: 4.5, beta: 1.5, mort: 0.12, eps: 0.01, gp: 0.05, gm: 0.03, wr: 6, sr: 1 },
  "Near Collapse": { R: 0.16, E: 0.45, alpha: 4.0, beta: 2.0, mort: 0.18, eps: 0.01, gp: 0.06, gm: 0.04, wr: 6, sr: 1 },
};

/* -------------------------------------------------------------------------- */
/*                                   APP                                      */
/* -------------------------------------------------------------------------- */

export default function App() {

  const [params, setParams] = useState(PRESETS["Spots"]);
  const [gridN, setGridN] = useState(100);
  const [running, setRunning] = useState(false);

  const stateRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  const W_OFF = useRef(buildOffsets(params.wr));
  const S_OFF = useRef(buildOffsets(params.sr));

  useEffect(() => {
    W_OFF.current = buildOffsets(params.wr);
    S_OFF.current = buildOffsets(params.sr);
  }, [params.wr, params.sr]);

  const reset = useCallback(() => {
    stateRef.current = initState(gridN, Math.random() * 1e6 | 0);
    render();
  }, [gridN]);

  useEffect(() => { reset(); }, [reset]);

  function render() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const size = 600 / gridN;
    const img = ctx.createImageData(600, 600);

    const { v } = stateRef.current;

    for (let y = 0; y < gridN; y++) {
      for (let x = 0; x < gridN; x++) {
        const val = v[y * gridN + x];
        const g = 40 + 200 * val;

        for (let py = 0; py < size; py++)
          for (let px = 0; px < size; px++) {
            const pi = ((y * size + py) * 600 + x * size + px) * 4;
            img.data[pi] = 20;
            img.data[pi + 1] = g;
            img.data[pi + 2] = 20;
            img.data[pi + 3] = 255;
          }
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  function step() {
    stateRef.current = caStep(
      stateRef.current,
      params,
      gridN,
      W_OFF.current,
      S_OFF.current
    );
    render();
  }

  useEffect(() => {
    if (running) {
      const loop = () => {
        step();
        animRef.current = requestAnimationFrame(loop);
      };
      animRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [running, params]);

  return (
    <div style={{ background: "#0f1410", minHeight: "100vh", padding: 30, color: "#e2e8e0" }}>
      <h2>Vegetation Pattern CA (Turing regime)</h2>

      <canvas
        ref={canvasRef}
        width={600}
        height={600}
        style={{ border: "1px solid #263020", imageRendering: "pixelated" }}
      />

      <div style={{ marginTop: 15 }}>
        <button onClick={() => setRunning(r => !r)}>
          {running ? "Stop" : "Run"}
        </button>

        <button onClick={step} style={{ marginLeft: 10 }}>
          Step
        </button>

        <button onClick={reset} style={{ marginLeft: 10 }}>
          Reset
        </button>
      </div>

      <div style={{ marginTop: 15 }}>
        {Object.keys(PRESETS).map(name => (
          <button
            key={name}
            onClick={() => { setParams(PRESETS[name]); reset(); }}
            style={{ marginRight: 6 }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
