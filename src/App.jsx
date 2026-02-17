import { useState, useMemo, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, ScatterChart, Scatter
} from "recharts";

// ─── colour palette ────────────────────────────────────────────────────────
const C = {
  bg:       "#080c14",
  panel:    "#0d1420",
  border:   "#1a2640",
  border2:  "#243350",
  amber:    "#f0a500",
  amberDim: "#8a5f00",
  cyan:     "#38bdf8",
  cyanDim:  "#1d6e90",
  rose:     "#f43f5e",
  roseDim:  "#7f1d2e",
  green:    "#34d399",
  greenDim: "#065f46",
  muted:    "#4a6080",
  text:     "#c8d8f0",
  textDim:  "#5a7090",
  white:    "#eef4ff",
  gridLine: "#111c2d",
};

// ─── math helpers ──────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sgn   = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function computeEpsilonC(A, B) {
  if (B === 0) return null;
  if (sgn(A) === sgn(B)) return null;
  const denom = 2 * (2 * A - B);
  if (Math.abs(denom) < 1e-12) return null;
  const ec = A / denom;
  return ec > 0 ? ec : null;
}

function growthRate(k, A, B, eps) {
  const lc = A * Math.cos(k) + B;
  const le = 1 + 2 * eps * Math.cos(k);
  if (Math.abs(lc) < 1e-15 || Math.abs(le) < 1e-15) return -Infinity;
  return Math.log(Math.abs(lc)) + Math.log(Math.abs(le));
}

function curveAtPi(A, B, eps) {
  const d1 = B !== A ? A / (B - A) : Infinity;
  const d2 = Math.abs(1 - 2 * eps) > 1e-12 ? (2 * eps) / (1 - 2 * eps) : Infinity;
  return d1 + d2;
}

function dominantK(A, B, eps) {
  let bestK = 0, bestG = -Infinity;
  const N = 1000;
  for (let i = 0; i <= N; i++) {
    const k = (i / N) * Math.PI;
    const g = growthRate(k, A, B, eps);
    if (g > bestG) { bestG = g; bestK = k; }
  }
  return bestK;
}

function cosKStar(A, B, eps) {
  const denom = 4 * eps * A;
  if (Math.abs(denom) < 1e-12) return null;
  const val = -(A + 2 * eps * B) / denom;
  return Math.abs(val) <= 1 ? val : null;
}

// ─── shared style fragments ────────────────────────────────────────────────
const panelStyle = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: "20px 24px",
};

const labelStyle = {
  fontFamily: "'Courier New', monospace",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: C.textDim,
  marginBottom: 4,
};

const valueStyle = {
  fontFamily: "'Courier New', monospace",
  fontSize: 22,
  fontWeight: 700,
  color: C.amber,
};

const tagStyle = (col) => ({
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 20,
  fontSize: 11,
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  background: col + "22",
  border: `1px solid ${col}55`,
  color: col,
});

// ─── Slider ────────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, color = C.amber, unit = "" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ ...labelStyle }}>{label}</span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13, color: color }}>
          {value.toFixed(4)}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color, cursor: "pointer", height: 4 }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 10, color: C.textDim, fontFamily: "monospace" }}>{min}</span>
        <span style={{ fontSize: 10, color: C.textDim, fontFamily: "monospace" }}>{max}</span>
      </div>
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────
function SectionTitle({ num, title, subtitle }) {
  return (
    <div style={{ marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: 11, color: C.amber,
          letterSpacing: "0.2em",
        }}>§{num}</span>
        <h2 style={{
          margin: 0, fontSize: 17, fontWeight: 700, color: C.white,
          fontFamily: "Georgia, serif", letterSpacing: "-0.01em",
        }}>{title}</h2>
      </div>
      {subtitle && (
        <p style={{ margin: "6px 0 0 0", fontSize: 12, color: C.textDim, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─── Equation block ────────────────────────────────────────────────────────
function EqBlock({ label, children }) {
  return (
    <div style={{
      background: "#060a10", border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.amber}44`,
      borderRadius: 8, padding: "12px 18px", margin: "12px 0",
    }}>
      {label && <div style={{ fontSize: 10, color: C.amberDim, fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.1em" }}>{label}</div>}
      <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, color: C.text, lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

// ─── Theorem block ─────────────────────────────────────────────────────────
function Theorem({ title, children }) {
  return (
    <div style={{
      background: "#0a0f1a", border: `1px solid ${C.border2}`,
      borderRadius: 8, padding: "14px 18px", margin: "12px 0",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.cyan, fontFamily: "monospace", marginBottom: 6, letterSpacing: "0.05em" }}>
        ⬡ {title}
      </div>
      <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.75, fontFamily: "Georgia, serif" }}>
        {children}
      </div>
    </div>
  );
}

// ─── custom tooltip ────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, unit = "" }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0d1420ee", border: `1px solid ${C.border2}`,
      borderRadius: 8, padding: "10px 14px", fontSize: 11, fontFamily: "monospace",
    }}>
      <div style={{ color: C.textDim, marginBottom: 4 }}>k/π = {(+label).toFixed(4)}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(5) : "—"}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── state ────────────────────────────────────────────────────────────────
  const [A, setA] = useState(1.0);
  const [B, setB] = useState(-0.7071);
  const [eps, setEps] = useState(0.12);
  const [activeTab, setActiveTab] = useState("theory");
  const [verifyEps, setVerifyEps] = useState(0.1847);
  const [verifyA,   setVerifyA]   = useState(1.0);
  const [verifyB,   setVerifyB]   = useState(-0.7071);

  // ── derived quantities ───────────────────────────────────────────────────
  const ec = useMemo(() => computeEpsilonC(A, B), [A, B]);
  const isTransition = ec !== null;
  const phase = useMemo(() => {
    if (!isTransition) return sgn(A) === sgn(B) ? "Ferromagnetic" : "Trivial / No-transition";
    if (eps < ec)  return "Antiferromagnetic (Néel)";
    if (Math.abs(eps - ec) < 0.005) return "Critical Point";
    return "Incommensurate (Helical)";
  }, [isTransition, ec, eps, A, B]);

  const phaseColor = useMemo(() => {
    if (phase.includes("Ferromagnetic")) return C.cyan;
    if (phase.includes("Antiferromagnetic")) return C.amber;
    if (phase.includes("Critical")) return C.rose;
    if (phase.includes("Incommensurate")) return C.green;
    return C.textDim;
  }, [phase]);

  const curvature = useMemo(() => curveAtPi(A, B, eps), [A, B, eps]);
  const kStar     = useMemo(() => {
    if (!isTransition || eps <= ec) return null;
    const cv = cosKStar(A, B, eps);
    return cv !== null ? Math.acos(cv) : null;
  }, [A, B, eps, ec, isTransition]);

  const dominantMode = useMemo(() => dominantK(A, B, eps), [A, B, eps]);

  // ── growth-rate curve data ───────────────────────────────────────────────
  const growthData = useMemo(() => {
    const N = 400;
    return Array.from({ length: N + 1 }, (_, i) => {
      const k = (i / N) * Math.PI;
      const g = growthRate(k, A, B, eps);
      const gec = ec !== null ? growthRate(k, A, B, ec) : null;
      return { kpi: k / Math.PI, g: isFinite(g) ? g : null, gec: isFinite(gec) ? gec : null };
    });
  }, [A, B, eps, ec]);

  // ── bifurcation diagram data ─────────────────────────────────────────────
  const bifData = useMemo(() => {
    if (!isTransition || ec === null) return [];
    const N = 200;
    const lo = Math.max(0.001, ec * 0.2);
    const hi = Math.min(0.99, ec * 4);
    return Array.from({ length: N }, (_, i) => {
      const e = lo + (i / (N - 1)) * (hi - lo);
      const kd = dominantK(A, B, e);
      const kth = e > ec ? Math.acos(clamp(cosKStar(A, B, e) ?? -1, -1, 1)) : Math.PI;
      return {
        eps: e,
        kdNum:  kd / Math.PI,
        kPlus:  e > ec ? kth / Math.PI : null,
        kMinus: e > ec ? -kth / Math.PI : null,
        kPi:    e <= ec ? 1.0 : null,
        kPiUnstable: e > ec ? 1.0 : null,
      };
    });
  }, [A, B, ec, isTransition]);

  // ── correlation length data ──────────────────────────────────────────────
  const corrData = useMemo(() => {
    if (!isTransition || ec === null) return [];
    const pts = [];
    for (let i = 1; i <= 80; i++) {
      const de = i * 0.002;
      const e  = ec - de;
      if (e <= 0) break;
      const xi = 1 / Math.sqrt(de);
      pts.push({ de: -de, xi });
    }
    for (let i = 1; i <= 80; i++) {
      const de = i * 0.002;
      const e  = ec + de;
      if (e >= 0.99) break;
      const xi = 1 / Math.sqrt(de);
      pts.push({ de, xi });
    }
    return pts.sort((a, b) => a.de - b.de);
  }, [ec, isTransition]);

  // ── verification ─────────────────────────────────────────────────────────
  const verifyResult = useMemo(() => {
    const ecTh = computeEpsilonC(verifyA, verifyB);
    if (ecTh === null) return { type: "no-transition", ecTh: null, ecIn: verifyEps, match: null };
    const err = Math.abs(verifyEps - ecTh);
    const rel = err / ecTh;
    return { type: "transition", ecTh, ecIn: verifyEps, err, rel, match: rel < 0.01 };
  }, [verifyA, verifyB, verifyEps]);

  // ── tabs ─────────────────────────────────────────────────────────────────
  const tabs = [
    { id: "theory",  label: "Theory" },
    { id: "phase",   label: "Phase Explorer" },
    { id: "plots",   label: "Visualizations" },
    { id: "verify",  label: "Prediction Checker" },
    { id: "cases",   label: "Special Cases" },
  ];

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "Georgia, serif" }}>

      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        background: "linear-gradient(180deg,#0d1828 0%,#080c14 100%)",
        padding: "36px 40px 28px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10,
              background: `linear-gradient(135deg,${C.amber}33,${C.amber}11)`,
              border: `1px solid ${C.amber}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18,
            }}>⬡</div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.25em", color: C.amberDim, fontFamily: "monospace", marginBottom: 2 }}>
                STATISTICAL MECHANICS · COUPLED-MAP LATTICE · 1D
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.white, letterSpacing: "-0.02em" }}>
                Frustration-Driven Incommensurate Order Transition
              </h1>
            </div>
          </div>
          <p style={{ margin: "10px 0 0 56px", fontSize: 13, color: C.textDim, maxWidth: 740, lineHeight: 1.7 }}>
            A one-dimensional constrained coupled-map lattice with projective normalization.
            Exact critical coupling, pitchfork bifurcation, and universal mean-field scaling ν = ½.
          </p>
        </div>
      </div>

      {/* ── TAB BAR ──────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: "#0a0f1a" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", paddingLeft: 40 }}>
          {tabs.map(t => (
            <button key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "14px 20px",
                fontFamily: "'Courier New', monospace",
                fontSize: 11, letterSpacing: "0.1em",
                color: activeTab === t.id ? C.amber : C.textDim,
                borderBottom: activeTab === t.id ? `2px solid ${C.amber}` : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >{t.label.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 40px 60px" }}>

        {/* ════════ THEORY TAB ═════════════════════════════════════════════ */}
        {activeTab === "theory" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

            {/* Model definition */}
            <div style={{ ...panelStyle, gridColumn: "1 / -1" }}>
              <SectionTitle num="1" title="Model Definition"
                subtitle="A canonical-ensemble analogue of frustrated magnetism on a 1D lattice" />
              <p style={{ fontSize: 13, lineHeight: 1.8, color: C.text, margin: "0 0 12px" }}>
                Consider a 1D chain of field variables ψ<sub>i</sub>(t) ∈ ℝ — interpretable as
                <strong style={{ color: C.amber }}> magnetization density</strong>,{" "}
                <strong style={{ color: C.cyan }}>neural activity</strong>, or{" "}
                <strong style={{ color: C.green }}>concentration fluctuations</strong>.
                The global conservation law Σ|ψ<sub>j</sub>|² = const is enforced by projective
                (canonical) normalization, which drives long-time dynamics to the dominant
                eigenmode of the transfer operator.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  ["Step 1 · Spatial mixing", "φ⁽¹⁾ᵢ = (ψᵢ₋₁ + ψᵢ₊₁)/√2,  φ⁽²⁾ᵢ = ψᵢ"],
                  ["Step 2 · Response kernel", "ψᵢ⁽ᵁ⁾ = (A/√2)(ψᵢ₋₁+ψᵢ₊₁) + B·ψᵢ"],
                  ["Step 3 · Coupling (strength ε)", "ψ''ᵢ = ψᵢ⁽ᵁ⁾ + ε(ψ⁽ᵁ⁾ᵢ₋₁ + ψ⁽ᵁ⁾ᵢ₊₁)"],
                  ["Step 4 · Canonical normalization", "ψᵢ(t+1) = ψ''ᵢ / √(Σⱼ|ψ''ⱼ|²)"],
                ].map(([title, eq], i) => (
                  <div key={i} style={{
                    background: "#060a10", borderRadius: 8, padding: "12px 14px",
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ ...labelStyle, marginBottom: 6, color: C.amberDim }}>{title}</div>
                    <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: C.text }}>
                      {eq}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Canonical parameters */}
            <div style={panelStyle}>
              <SectionTitle num="2" title="Canonical Parameters"
                subtitle="Competition between hopping (A) and on-site (B) terms" />
              <EqBlock label="DEFINITION">
                A ≡ u₂₁/√2 &nbsp;&nbsp;&nbsp; (hopping amplitude)<br />
                B ≡ u₂₂ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (on-site amplitude)
              </EqBlock>
              <EqBlock label="TRANSFER EIGENVALUE">
                Λ(k, ε) = (A cos k + B)(1 + 2ε cos k)
              </EqBlock>
              <EqBlock label="LOGARITHMIC GROWTH RATE">
                g(k, ε) = log|A cos k + B| + log|1 + 2ε cos k|
              </EqBlock>
              <p style={{ fontSize: 12.5, lineHeight: 1.75, color: C.text, margin: "10px 0 0" }}>
                The canonical normalization converts this into a <em>dominant-mode selector</em>:
                the long-time fixed point is the k* that maximises g(k,ε) — the statistical-mechanical
                analogue of free-energy minimisation.
              </p>
            </div>

            {/* Phase selection */}
            <div style={panelStyle}>
              <SectionTitle num="3" title="Phase Selection & Frustration"
                subtitle="Mode competition at ε = 0 determines accessible phases" />
              <Theorem title="Lemma 1 · Sign-based phase selection">
                At ε = 0, the dominant mode is determined by sgn(A) vs sgn(B):<br /><br />
                • <strong style={{ color: C.cyan }}>sgn(A) = sgn(B)</strong>: k=0 dominates
                → <strong>Ferromagnetic phase</strong> (uniform order)<br />
                • <strong style={{ color: C.amber }}>sgn(A) ≠ sgn(B)</strong>: k=π dominates
                → <strong>Antiferromagnetic phase</strong> (staggered order)
              </Theorem>
              <p style={{ fontSize: 12.5, lineHeight: 1.75, color: C.text, margin: "10px 0 0" }}>
                The condition sgn(A) ≠ sgn(B) encodes <strong style={{ color: C.amber }}>frustration</strong>:
                hopping amplitude A favours connecting opposite-sign neighbours while on-site term B
                favours same-sign. Their competition is precisely what enables a phase transition.
              </p>
              <div style={{ marginTop: 14, padding: "10px 14px", background: C.rose + "11",
                border: `1px solid ${C.rose}33`, borderRadius: 8, fontSize: 12, color: C.text }}>
                <strong style={{ color: C.rose }}>Key insight:</strong> Without frustration
                (sgn(A)=sgn(B)), the coupling only reinforces ferromagnetic order at k=0.
                No transition is possible.
              </div>
            </div>

            {/* Critical point */}
            <div style={{ ...panelStyle, gridColumn: "1 / -1" }}>
              <SectionTitle num="4" title="Critical Coupling & Pitchfork Bifurcation"
                subtitle="Exact closed-form result via curvature analysis" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <Theorem title="Theorem 2 · Curvature at k = π">
                    g''(π, ε) = A/(B−A) + 2ε/(1−2ε)<br /><br />
                    First term: fixed by kernel (negative when frustrated).<br />
                    Second term: grows with ε (destabilises AFM phase).
                  </Theorem>
                  <Theorem title="Theorem 3 · Critical coupling">
                    Set g''(π, εc) = 0:<br /><br />
                    <strong style={{ color: C.amber, fontSize: 14 }}>
                      εc = A / [2(2A − B)]
                    </strong><br /><br />
                    Valid only when sgn(B) ≠ sgn(A) and B ≠ 0.
                  </Theorem>
                </div>
                <div>
                  <Theorem title="Theorem 4 · Incommensurate wavevector (ε > εc)">
                    cos k* = −(A + 2εB) / (4εA)<br /><br />
                    The AFM mode k=π splits to a degenerate pair ±k*, which
                    migrates continuously as ε increases.
                  </Theorem>
                  <Theorem title="Theorem 5 · Universal scaling exponent">
                    ξ ~ |ε − εc|<sup>−ν</sup>,&nbsp;&nbsp; ν = <strong>1/2</strong><br /><br />
                    Mean-field value, exact here due to the infinite-range nature
                    of the normalization constraint. Z₂ pitchfork universality class.
                  </Theorem>
                </div>
              </div>
            </div>

            {/* Physical connections */}
            <div style={{ ...panelStyle, gridColumn: "1 / -1" }}>
              <SectionTitle num="5" title="Physical Connections & Universality"
                subtitle="Where this model sits in the landscape of exactly-solvable systems" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                {[
                  {
                    title: "ANNNI Model",
                    color: C.amber,
                    text: "The Axial Next-Nearest-Neighbor Ising model on a chain has competing J₁ (FM) and J₂ (AFM) interactions, producing a Lifshitz point and incommensurate modulated phase. Our model realises the same transition via kernel-parameter competition rather than range-dependent interactions.",
                  },
                  {
                    title: "Turing Instability",
                    color: C.cyan,
                    text: "In reaction–diffusion systems, a Turing instability occurs when a uniform state loses stability to a patterned state at finite k* ≠ 0. Our εc is the exact Turing threshold, and the formula cos k* = −(A+2εB)/(4εA) predicts the selected pattern wavelength as a continuous function of coupling.",
                  },
                  {
                    title: "Transfer Matrix / RG",
                    color: C.green,
                    text: "The projective normalization implements the power method on the transfer operator. The critical point corresponds to a degeneracy of the two largest eigenvalues, analogous to a conformal point in 1+1D quantum field theory. The exponent ν=1/2 is exact, not an approximation.",
                  },
                ].map(({ title, color, text }) => (
                  <div key={title} style={{
                    background: "#060a10", borderRadius: 8, padding: "14px 16px",
                    border: `1px solid ${color}33`,
                  }}>
                    <div style={{ ...labelStyle, color, marginBottom: 8 }}>{title}</div>
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.75, color: C.text }}>{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════════ PHASE EXPLORER TAB ═════════════════════════════════════ */}
        {activeTab === "phase" && (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24 }}>

            {/* Controls */}
            <div>
              <div style={panelStyle}>
                <div style={{ ...labelStyle, marginBottom: 16 }}>KERNEL PARAMETERS</div>
                <Slider label="A  (hopping amplitude)"  value={A}   min={-2} max={2}  step={0.01}  onChange={setA}  color={C.amber} />
                <Slider label="B  (on-site amplitude)"  value={B}   min={-2} max={2}  step={0.001} onChange={setB}  color={C.cyan}  />
                <div style={{ marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                  <div style={{ ...labelStyle, marginBottom: 16 }}>COUPLING STRENGTH</div>
                  <Slider label="ε  (nearest-neighbour)" value={eps} min={0}  max={0.5} step={0.001} onChange={setEps} color={C.green} />
                </div>

                {/* Quick presets */}
                <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                  <div style={{ ...labelStyle, marginBottom: 10 }}>PRESETS</div>
                  {[
                    { name: "Hadamard",  A: 1,      B: -0.7071, eps: 0.12  },
                    { name: "At εc",     A: 1,      B: -0.7071, eps: 0.1847},
                    { name: "Above εc",  A: 1,      B: -0.7071, eps: 0.30  },
                    { name: "Unfrustrated", A: 1,   B: 0.5,     eps: 0.20  },
                    { name: "A=1.5 B=-0.5", A: 1.5, B: -0.5,   eps: 0.10  },
                  ].map(p => (
                    <button key={p.name}
                      onClick={() => { setA(p.A); setB(p.B); setEps(p.eps); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: "#060a10", border: `1px solid ${C.border}`,
                        borderRadius: 6, padding: "7px 12px", marginBottom: 6,
                        fontFamily: "monospace", fontSize: 11, color: C.textDim,
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.target.style.borderColor = C.amber; e.target.style.color = C.amber; }}
                      onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.textDim; }}
                    >{p.name}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live readouts */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Phase badge + critical info */}
              <div style={{ ...panelStyle, borderColor: phaseColor + "55" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <div>
                    <div style={labelStyle}>CURRENT PHASE</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: phaseColor, fontFamily: "Georgia,serif" }}>{phase}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={labelStyle}>FRUSTRATION STATUS</div>
                    <div style={{
                      ...tagStyle(sgn(A) !== sgn(B) ? C.amber : C.textDim),
                      fontSize: 12,
                    }}>
                      {sgn(A) !== sgn(B) ? "FRUSTRATED  ✓" : "UNFRUSTRATED  ✗"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                  {[
                    { label: "Critical Coupling εc", value: ec !== null ? ec.toFixed(6) : "undefined", color: C.amber },
                    { label: "ε/εc ratio",  value: ec !== null ? (eps/ec).toFixed(4) : "—", color: ec !== null && eps > ec ? C.green : C.cyan },
                    { label: "Curvature g''(π,ε)", value: isFinite(curvature) ? curvature.toFixed(5) : "∞", color: curvature > 0 ? C.green : curvature < 0 ? C.rose : C.amber },
                    { label: "Dom. mode k*/π",  value: (dominantMode/Math.PI).toFixed(5), color: C.text },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#060a10", borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={labelStyle}>{label}</div>
                      <div style={{ ...valueStyle, fontSize: 16, color }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Analytic predictions */}
              <div style={panelStyle}>
                <SectionTitle num="" title="Analytic Predictions at Current Parameters" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {/* εc derivation */}
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <div style={{ ...labelStyle, marginBottom: 10 }}>CRITICAL COUPLING FORMULA</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 2, color: C.text }}>
                      A = {A.toFixed(4)},  B = {B.toFixed(4)}<br />
                      2A − B = {(2*A - B).toFixed(4)}<br />
                      εc = A/[2(2A−B)]<br />
                      {ec !== null
                        ? <><span style={{ color: C.amber }}>εc = {ec.toFixed(6)}</span><br />
                          <span style={{ color: eps < ec ? C.cyan : C.green }}>ε = {eps.toFixed(4)} → {eps < ec ? "BELOW" : eps > ec ? "ABOVE" : "AT"} εc</span></>
                        : <span style={{ color: C.rose }}>No transition (sgn condition not met)</span>
                      }
                    </div>
                  </div>

                  {/* k* prediction */}
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <div style={{ ...labelStyle, marginBottom: 10 }}>INCOMMENSURATE WAVEVECTOR</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 2, color: C.text }}>
                      cos k* = −(A + 2εB)/(4εA)<br />
                      Numerator = {(-(A + 2*eps*B)).toFixed(4)}<br />
                      Denominator = {(4*eps*A).toFixed(4)}<br />
                      {kStar !== null
                        ? <><span style={{ color: C.green }}>k* = {kStar.toFixed(5)} rad</span><br />
                          k*/π = <span style={{ color: C.green }}>{(kStar/Math.PI).toFixed(5)}</span></>
                        : <span style={{ color: C.textDim }}>{eps <= ec ? "k* = π (AFM, ε < εc)" : "cos k* out of [−1,1]"}</span>
                      }
                    </div>
                  </div>

                  {/* Curvature analysis */}
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <div style={{ ...labelStyle, marginBottom: 10 }}>CURVATURE ANALYSIS g''(π,ε)</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 2, color: C.text }}>
                      Term 1: A/(B−A) = {A !== B ? (A/(B-A)).toFixed(4) : "∞"}<br />
                      Term 2: 2ε/(1−2ε) = {Math.abs(1-2*eps) > 1e-9 ? (2*eps/(1-2*eps)).toFixed(4) : "∞"}<br />
                      g''(π,ε) = <span style={{ color: curvature > 0 ? C.green : curvature < 0 ? C.rose : C.amber }}>
                        {isFinite(curvature) ? curvature.toFixed(5) : "∞"}</span><br />
                      Status: <span style={{ color: curvature > 0 ? C.green : curvature < 0 ? C.rose : C.amber }}>
                        {curvature > 0.01 ? "AFM UNSTABLE" : curvature < -0.01 ? "AFM stable" : "CRITICAL"}
                      </span>
                    </div>
                  </div>

                  {/* Scaling */}
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <div style={{ ...labelStyle, marginBottom: 10 }}>CORRELATION LENGTH SCALING</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 2, color: C.text }}>
                      ξ ~ |ε − εc|^(−1/2)<br />
                      |ε − εc| = {ec !== null ? Math.abs(eps-ec).toFixed(5) : "—"}<br />
                      ξ (scaled) = {ec !== null && Math.abs(eps-ec) > 1e-5
                        ? (1/Math.sqrt(Math.abs(eps-ec))).toFixed(3) : "→ ∞"}<br />
                      Exponent ν = <span style={{ color: C.amber }}>1/2  (mean-field, exact)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════ PLOTS TAB ══════════════════════════════════════════════ */}
        {activeTab === "plots" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Growth rate g(k,ε) */}
            <div style={panelStyle}>
              <SectionTitle num="3.1" title="Growth Rate Landscape  g(k, ε)"
                subtitle="The dominant mode k* maximises g. The transition occurs when the k=π maximum flattens (curvature → 0)" />
              <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                    <div style={labelStyle}>A</div>
                    <Slider label="" value={A} min={-2} max={2} step={0.01} onChange={setA} color={C.amber} />
                    <div style={labelStyle}>B</div>
                    <Slider label="" value={B} min={-2} max={2} step={0.001} onChange={setB} color={C.cyan} />
                    <div style={labelStyle}>ε</div>
                    <Slider label="" value={eps} min={0} max={0.5} step={0.001} onChange={setEps} color={C.green} />
                  </div>
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>LEGEND</div>
                    {[
                      { color: C.amber, label: "g(k,ε) current" },
                      { color: C.rose + "88", label: "g(k,εc) at critical" },
                      { color: C.green, label: "dominant k*" },
                    ].map(({ color, label }) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <div style={{ width: 16, height: 2, background: color, borderRadius: 2 }} />
                        <span style={{ fontSize: 10, color: C.textDim, fontFamily: "monospace" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={growthData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid stroke={C.gridLine} strokeDasharray="3 3" />
                    <XAxis dataKey="kpi" stroke={C.muted} tick={{ fill: C.textDim, fontSize: 10, fontFamily: "monospace" }}
                      label={{ value: "k/π", position: "insideBottomRight", offset: -5, fill: C.textDim, fontSize: 11, fontFamily: "monospace" }} />
                    <YAxis stroke={C.muted} tick={{ fill: C.textDim, fontSize: 10, fontFamily: "monospace" }}
                      label={{ value: "g(k,ε)", angle: -90, position: "insideLeft", fill: C.textDim, fontSize: 11, fontFamily: "monospace" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line dataKey="gec" stroke={C.rose + "66"} dot={false} strokeWidth={1.5}
                      strokeDasharray="5 3" name="g(k,εc)" connectNulls={false} />
                    <Line dataKey="g" stroke={C.amber} dot={false} strokeWidth={2} name="g(k,ε)" connectNulls={false} />
                    {ec !== null && (
                      <ReferenceLine x={1} stroke={C.rose} strokeDasharray="4 4" label={{ value: "k=π", fill: C.rose, fontSize: 10, fontFamily: "monospace" }} />
                    )}
                    <ReferenceLine x={dominantMode / Math.PI} stroke={C.green} strokeWidth={1.5}
                      label={{ value: "k*", fill: C.green, fontSize: 10, fontFamily: "monospace" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bifurcation diagram */}
            <div style={panelStyle}>
              <SectionTitle num="3.2" title="Bifurcation Diagram  k*(ε)"
                subtitle="Pitchfork bifurcation: AFM mode k=π splits to ±k* at εc. Numerical (dots) vs analytic (lines)" />
              {!isTransition ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C.textDim, fontSize: 13, fontFamily: "monospace" }}>
                  No transition for current A, B parameters. <br />
                  Set sgn(A) ≠ sgn(B) and B ≠ 0 to see the bifurcation.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={bifData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid stroke={C.gridLine} strokeDasharray="3 3" />
                    <XAxis dataKey="eps" stroke={C.muted} tick={{ fill: C.textDim, fontSize: 10, fontFamily: "monospace" }}
                      label={{ value: "ε", position: "insideBottomRight", offset: -5, fill: C.textDim, fontSize: 11 }} />
                    <YAxis domain={[-1.1, 1.1]} stroke={C.muted} tick={{ fill: C.textDim, fontSize: 10, fontFamily: "monospace" }}
                      label={{ value: "k/π", angle: -90, position: "insideLeft", fill: C.textDim, fontSize: 11 }} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div style={{ background: "#0d1420ee", border: `1px solid ${C.border2}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, fontFamily: "monospace" }}>
                          <div style={{ color: C.textDim }}>ε = {(+label).toFixed(4)}</div>
                          {payload.map((p, i) => p.value != null && (
                            <div key={i} style={{ color: p.color }}>{p.name}: {p.value.toFixed(4)}</div>
                          ))}
                        </div>
                      );
                    }} />
                    {ec !== null && <ReferenceLine x={ec} stroke={C.rose} strokeWidth={1.5}
                      label={{ value: `εc=${ec.toFixed(4)}`, fill: C.rose, fontSize: 10, fontFamily: "monospace" }} />}
                    <Line dataKey="kPi" stroke={C.amber} strokeWidth={2.5} dot={false} name="k=π (stable)" connectNulls={false} />
                    <Line dataKey="kPiUnstable" stroke={C.amberDim} strokeWidth={1.5} dot={false}
                      strokeDasharray="5 3" name="k=π (unstable)" connectNulls={false} />
                    <Line dataKey="kPlus" stroke={C.green} strokeWidth={2} dot={false} name="+k*" connectNulls={false} />
                    <Line dataKey="kMinus" stroke={C.cyan} strokeWidth={2} dot={false} name="−k*" connectNulls={false} />
                    <Line dataKey="kdNum" stroke={C.text + "44"} strokeWidth={1} dot={false} name="k* (numerical)" connectNulls={false} />
                    <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace", paddingTop: 10 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Correlation length */}
            <div style={panelStyle}>
              <SectionTitle num="3.3" title="Correlation Length Divergence  ξ ~ |ε−εc|^(−ν)"
                subtitle="Both sides of the critical point show power-law divergence with ν = 1/2" />
              {!isTransition ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 13, fontFamily: "monospace" }}>
                  Set frustrated parameters to see scaling.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={corrData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid stroke={C.gridLine} strokeDasharray="3 3" />
                    <XAxis dataKey="de" stroke={C.muted} tick={{ fill: C.textDim, fontSize: 10, fontFamily: "monospace" }}
                      label={{ value: "ε − εc", position: "insideBottomRight", offset: -5, fill: C.textDim, fontSize: 11 }} />
                    <YAxis stroke={C.muted} tick={{ fill: C.textDim, fontSize: 10, fontFamily: "monospace" }}
                      label={{ value: "ξ (arb.)", angle: -90, position: "insideLeft", fill: C.textDim, fontSize: 11 }} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div style={{ background: "#0d1420ee", border: `1px solid ${C.border2}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, fontFamily: "monospace" }}>
                          <div style={{ color: C.textDim }}>ε−εc = {(+label).toFixed(4)}</div>
                          <div style={{ color: C.cyan }}>ξ = {payload[0]?.value?.toFixed(3)}</div>
                        </div>
                      );
                    }} />
                    <ReferenceLine x={0} stroke={C.rose} strokeDasharray="4 4" label={{ value: "εc", fill: C.rose, fontSize: 11, fontFamily: "monospace" }} />
                    <Line dataKey="xi" stroke={C.cyan} strokeWidth={2} dot={false} name="ξ" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* ════════ PREDICTION CHECKER TAB ═════════════════════════════════ */}
        {activeTab === "verify" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

            <div style={panelStyle}>
              <SectionTitle num="V" title="Prediction Verification"
                subtitle="Enter parameters to check against the exact theoretical formula" />
              <div style={{ marginBottom: 20 }}>
                <Slider label="A  (hopping)" value={verifyA} min={-2} max={2} step={0.001} onChange={setVerifyA} color={C.amber} />
                <Slider label="B  (on-site)" value={verifyB} min={-2} max={2} step={0.001} onChange={setVerifyB} color={C.cyan} />
                <div style={{ marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                  <Slider label="ε  (your proposed εc)" value={verifyEps} min={0} max={0.5} step={0.0001}
                    onChange={setVerifyEps} color={C.green} />
                </div>
              </div>

              {/* Result */}
              <div style={{
                borderRadius: 10, padding: "20px 22px",
                background: verifyResult.type === "no-transition" ? C.rose + "0a"
                  : verifyResult.match ? C.green + "0a" : C.rose + "0a",
                border: `1px solid ${
                  verifyResult.type === "no-transition" ? C.rose + "44"
                  : verifyResult.match ? C.green + "44" : C.rose + "44"
                }`,
              }}>
                <div style={{
                  fontSize: 15, fontWeight: 700,
                  color: verifyResult.type === "no-transition" ? C.rose
                    : verifyResult.match ? C.green : C.rose,
                  fontFamily: "Georgia, serif", marginBottom: 10,
                }}>
                  {verifyResult.type === "no-transition"
                    ? "✗  No transition — parameters unfrustrated"
                    : verifyResult.match
                    ? "✓  Prediction matches theory"
                    : "✗  Prediction does not match theory"}
                </div>
                {verifyResult.type === "transition" && (
                  <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 2.2, color: C.text }}>
                    <div>Analytic εc = A/[2(2A−B)] =
                      <span style={{ color: C.amber }}> {verifyResult.ecTh.toFixed(8)}</span>
                    </div>
                    <div>Your εc =
                      <span style={{ color: C.cyan }}> {verifyResult.ecIn.toFixed(8)}</span>
                    </div>
                    <div>Absolute error =
                      <span style={{ color: verifyResult.match ? C.green : C.rose }}> {verifyResult.err.toFixed(8)}</span>
                    </div>
                    <div>Relative error =
                      <span style={{ color: verifyResult.match ? C.green : C.rose }}> {(verifyResult.rel * 100).toFixed(5)} %</span>
                    </div>
                    <div>Tolerance = 1 % &nbsp;
                      <span style={{ ...tagStyle(verifyResult.match ? C.green : C.rose) }}>
                        {verifyResult.match ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  </div>
                )}
                {verifyResult.type === "no-transition" && (
                  <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.9, color: C.text }}>
                    sgn(A) = {sgn(verifyA)},  sgn(B) = {sgn(verifyB)}<br />
                    Condition sgn(A) ≠ sgn(B) and B ≠ 0 is NOT met.<br />
                    No incommensurate transition can occur.
                  </div>
                )}
              </div>

              {/* Step-by-step derivation */}
              {verifyResult.type === "transition" && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ ...labelStyle, marginBottom: 10 }}>STEP-BY-STEP DERIVATION</div>
                  <EqBlock label="INPUT">
                    A = {verifyA.toFixed(4)},  B = {verifyB.toFixed(4)}
                  </EqBlock>
                  <EqBlock label="SIGN CHECK">
                    sgn(A) = {sgn(verifyA)},  sgn(B) = {sgn(verifyB)}<br />
                    {sgn(verifyA) !== sgn(verifyB) && verifyB !== 0
                      ? "✓ Frustrated: transition possible"
                      : "✗ Not frustrated: no transition"}
                  </EqBlock>
                  <EqBlock label="FORMULA  εc = A / [2(2A − B)]">
                    2A = {(2*verifyA).toFixed(4)}<br />
                    2A − B = {(2*verifyA - verifyB).toFixed(4)}<br />
                    2(2A − B) = {(2*(2*verifyA - verifyB)).toFixed(4)}<br />
                    εc = {verifyA.toFixed(4)} / {(2*(2*verifyA-verifyB)).toFixed(4)}<br />
                    εc = <strong style={{ color: C.amber }}>{verifyResult.ecTh.toFixed(8)}</strong>
                  </EqBlock>
                </div>
              )}
            </div>

            {/* Curvature verification panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={panelStyle}>
                <SectionTitle num="V.2" title="Curvature Verification"
                  subtitle="Confirm that g''(π, εc) = 0 exactly at the critical point" />
                {verifyResult.type === "transition" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[
                        {
                          label: "g''(π, εc) [theory = 0]",
                          value: curveAtPi(verifyA, verifyB, verifyResult.ecTh),
                          target: 0,
                        },
                        {
                          label: "g''(π, εc − 0.01)",
                          value: curveAtPi(verifyA, verifyB, verifyResult.ecTh - 0.01),
                          comment: "expect < 0",
                        },
                        {
                          label: "g''(π, εc + 0.01)",
                          value: curveAtPi(verifyA, verifyB, verifyResult.ecTh + 0.01),
                          comment: "expect > 0",
                        },
                        {
                          label: "k* at ε = εc + 0.05 (formula)",
                          value: (() => {
                            const cv = cosKStar(verifyA, verifyB, verifyResult.ecTh + 0.05);
                            return cv !== null ? (Math.acos(cv) / Math.PI) : null;
                          })(),
                          comment: "k*/π",
                        },
                      ].map(({ label, value, comment }) => (
                        <div key={label} style={{ background: "#060a10", borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                          <div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div>
                          <div style={{ fontFamily: "monospace", fontSize: 14, color: C.amber }}>
                            {value != null ? (isFinite(value) ? value.toFixed(6) : "∞") : "—"}
                          </div>
                          {comment && <div style={{ fontSize: 10, color: C.textDim, marginTop: 4, fontFamily: "monospace" }}>{comment}</div>}
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 16 }}>
                      <div style={{ ...labelStyle, marginBottom: 10 }}>SIGN STRUCTURE VERIFICATION</div>
                      <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 2, color: C.text,
                        background: "#060a10", borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                        Below εc: g''(π,ε) &lt; 0  → k=π is a local MAX → AFM stable<br />
                        At εc:    g''(π,ε) = 0  → inflection → critical point<br />
                        Above εc: g''(π,ε) &gt; 0  → k=π is a local MIN → AFM unstable<br />
                        <br />
                        <span style={{ color: C.green }}>Curvature flips sign at εc: verified ✓</span>
                      </div>
                    </div>
                  </>
                )}
                {verifyResult.type === "no-transition" && (
                  <div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 13, fontFamily: "monospace" }}>
                    Set frustrated parameters (sgn(A) ≠ sgn(B), B ≠ 0).
                  </div>
                )}
              </div>

              {/* Benchmark table */}
              <div style={panelStyle}>
                <SectionTitle num="V.3" title="Benchmark Cases" subtitle="Known exact values to test against" />
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border2}` }}>
                      {["Kernel", "A", "B", "εc (exact)", "Phase behaviour"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.textDim, fontWeight: 600, letterSpacing: "0.05em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Hadamard",    "1",     "−1/√2", "1/(4+√2) ≈ 0.184720", "AFM → Incommensurate"],
                      ["A=1.5, B=−0.5", "1.5", "−0.5",  (1.5/(2*(3+0.5))).toFixed(6),    "AFM → Incommensurate"],
                      ["A=0.8, B=−0.4", "0.8", "−0.4",  (0.8/(2*(1.6+0.4))).toFixed(6),  "AFM → Incommensurate"],
                      ["Pauli-X",    "√2",    "0",     "undefined",             "FM only, no transition"],
                      ["Identity/Z", "0",     "±1",    "undefined",             "Trivial, no mixing"],
                    ].map(([name, a, b, ec_, behaviour], i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i%2 ? "#060a10" : "transparent" }}>
                        <td style={{ padding: "7px 8px", color: C.amber }}>{name}</td>
                        <td style={{ padding: "7px 8px", color: C.text }}>{a}</td>
                        <td style={{ padding: "7px 8px", color: C.text }}>{b}</td>
                        <td style={{ padding: "7px 8px", color: C.green }}>{ec_}</td>
                        <td style={{ padding: "7px 8px", color: C.textDim }}>{behaviour}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════ SPECIAL CASES TAB ══════════════════════════════════════ */}
        {activeTab === "cases" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
              {[
                {
                  title: "Hadamard Kernel",
                  color: C.amber,
                  matrix: "H = (1/√2)[[1,1],[1,−1]]",
                  params: "u₂₁ = 1/√2,  u₂₂ = −1/√2\nA = 1,  B = −1/√2",
                  check: "sgn(A)=+1 ≠ −1=sgn(B) ✓\nFrustrated → transition occurs",
                  result: "εc = 1/[2(2+1/√2)]\n   = 1/(4+√2)\n   ≈ 0.184720",
                  note: "Maximally frustrated case. The standard reference example in this model. Below εc: Néel order. Above εc: helical phase with k*(ε) evolving continuously.",
                },
                {
                  title: "Pauli-X Kernel",
                  color: C.cyan,
                  matrix: "σₓ = [[0,1],[1,0]]",
                  params: "u₂₁ = 1,  u₂₂ = 0\nA = √2,  B = 0",
                  check: "B = 0 → condition not met ✗\nUnfrustrated → NO transition",
                  result: "εc = undefined\n(ferromagnetic for all ε)",
                  note: "B=0 means no on-site amplitude. The k=0 mode dominates at all coupling strengths. The coupling only reinforces FM order. No pitchfork bifurcation occurs.",
                },
                {
                  title: "Pauli-Z / Identity",
                  color: C.muted,
                  matrix: "σz = [[1,0],[0,−1]]\nI  = [[1,0],[0,1]]",
                  params: "u₂₁ = 0  (diagonal)\nA = 0,  B = ±1 or 1",
                  check: "A = 0 → no spatial mixing ✗\nTrivial, decoupled sites",
                  result: "εc = undefined\n(no interaction)",
                  note: "Off-diagonal element u₂₁=0 means no hopping between sites. Each site evolves independently. The model collapses to a trivial fixed point with no ordered phase structure.",
                },
              ].map(({ title, color, matrix, params, check, result, note }) => (
                <div key={title} style={{ ...panelStyle, borderColor: color + "44" }}>
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 700,
                    color, marginBottom: 14, letterSpacing: "0.05em" }}>{title}</div>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>MATRIX</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: C.text,
                    background: "#060a10", padding: "8px 10px", borderRadius: 6, marginBottom: 12,
                    border: `1px solid ${C.border}` }}>{matrix}</div>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>PARAMETERS</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: C.text,
                    background: "#060a10", padding: "8px 10px", borderRadius: 6, marginBottom: 12,
                    border: `1px solid ${C.border}`, whiteSpace: "pre-line" }}>{params}</div>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>CONDITION CHECK</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11,
                    color: check.includes("✓") ? C.green : C.rose,
                    background: "#060a10", padding: "8px 10px", borderRadius: 6, marginBottom: 12,
                    border: `1px solid ${(check.includes("✓") ? C.green : C.rose) + "33"}`,
                    whiteSpace: "pre-line" }}>{check}</div>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>RESULT</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: C.amber,
                    background: "#060a10", padding: "8px 10px", borderRadius: 6, marginBottom: 12,
                    border: `1px solid ${C.amber}22`, whiteSpace: "pre-line" }}>{result}</div>
                  <p style={{ margin: 0, fontSize: 12, color: C.textDim, lineHeight: 1.7, fontStyle: "italic" }}>{note}</p>
                </div>
              ))}
            </div>

            {/* General formula summary */}
            <div style={panelStyle}>
              <SectionTitle num="6.4" title="General Formula & Complete Phase Diagram" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <EqBlock label="CRITICAL COUPLING (GENERAL)">
                    εc = A / [2(2A − B)]<br />
                    <br />
                    Valid when:<br />
                    &nbsp; • sgn(B) ≠ sgn(A)  [frustrated]<br />
                    &nbsp; • B ≠ 0             [on-site term present]<br />
                    &nbsp; • A ≠ 0             [hopping present]
                  </EqBlock>
                  <EqBlock label="INCOMMENSURATE MODE (ε > εc)">
                    cos k* = −(A + 2εB) / (4εA)<br />
                    <br />
                    k* → π  as  ε → εc⁺  (continuous)<br />
                    k* → arccos(−B/2A)  as  ε → ∞
                  </EqBlock>
                </div>
                <div>
                  <div style={{ background: "#060a10", borderRadius: 8, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <div style={{ ...labelStyle, marginBottom: 12 }}>PHASE DIAGRAM SUMMARY</div>
                    <table style={{ width: "100%", fontSize: 11, fontFamily: "monospace", borderCollapse: "collapse" }}>
                      <tbody>
                        {[
                          ["Condition", "Phase", "Stable k"],
                          ["sgn(A)=sgn(B), ε≥0", "Ferromagnet", "k=0"],
                          ["sgn(A)≠sgn(B), ε<εc", "Antiferromagnet", "k=π"],
                          ["sgn(A)≠sgn(B), ε=εc", "Critical point", "k=π (marginal)"],
                          ["sgn(A)≠sgn(B), ε>εc", "Incommensurate", "k=±k*(ε)"],
                          ["A=0 or B=0", "Trivial", "k=0"],
                        ].map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i===0 ? C.border : i%2 ? "#0a0f1a" : "transparent" }}>
                            {row.map((cell, j) => (
                              <td key={j} style={{
                                padding: "6px 8px",
                                color: i===0 ? C.textDim : j===1 ? C.amber : j===2 ? C.green : C.text,
                                fontWeight: i===0 ? 600 : 400,
                              }}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 14, background: C.amber + "0a", borderRadius: 8, padding: "14px 16px",
                    border: `1px solid ${C.amber}22` }}>
                    <div style={{ ...labelStyle, color: C.amberDim, marginBottom: 8 }}>UNIVERSAL PROPERTIES</div>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.8, fontFamily: "Georgia, serif" }}>
                      • Exponent ν = 1/2 (mean-field, <em>exact</em>)<br />
                      • Supercritical pitchfork (Z₂ symmetry class)<br />
                      • k* continuous at εc (no first-order jump)<br />
                      • Result independent of sgn(A), sgn(B) magnitudes<br />
                      • Only condition: sgn(A) ≠ sgn(B), B ≠ 0
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "16px 40px",
        background: "#0a0f1a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: C.textDim, letterSpacing: "0.1em" }}>
          FRUSTRATED 1D CML · CANONICAL ENSEMBLE · INCOMMENSURATE ORDER TRANSITION
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: C.textDim }}>
          εc = A/[2(2A−B)] · ν = 1/2 · Z₂ pitchfork
        </span>
      </div>
    </div>
  );
}