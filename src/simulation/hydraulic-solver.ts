/** Solver internals use kPa and L/min. The public boundary stays SI. */
export type FlowEdge = {
  from: number;
  to: number;
  atRestDelta: number;
  evaluate: (delta: number) => { q: number; dq: number };
};

type Sample = { q: number; dq: number };
type Evaluation = { residual: Float64Array; samples: Sample[]; norm: number };
const maxFlowResidual = 1e-7;

function evaluate(heads: Float64Array, edges: readonly FlowEdge[]): Evaluation {
  const residual = new Float64Array(heads.length);
  const samples = edges.map((edge) => {
    const sample = edge.evaluate(heads[edge.from]! - heads[edge.to]!);
    residual[edge.from] = residual[edge.from]! + sample.q;
    residual[edge.to] = residual[edge.to]! - sample.q;
    return sample;
  });
  let norm = 0;
  for (let i = 1; i < residual.length; i++) norm = Math.max(norm, Math.abs(residual[i]!));
  return { residual, samples, norm };
}
function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 1; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

// Jacobi-preconditioned conjugate gradients on the anchored weighted graph Laplacian.
function linearStep(e: Evaluation, edges: readonly FlowEdge[]): Float64Array | null {
  const size = e.residual.length;
  const r = e.residual.map((f, i) => i === 0 ? 0 : -f);
  const step = new Float64Array(size), diagonal = new Float64Array(size);
  for (const [i, edge] of edges.entries()) {
    const coeff = e.samples[i]!.dq;
    diagonal[edge.from] = diagonal[edge.from]! + coeff;
    diagonal[edge.to] = diagonal[edge.to]! + coeff;
  }
  const h = r.map((f, i) => i === 0 ? 0 : f / diagonal[i]!);
  const p = h.slice();
  let product = dot(r, h);
  const target = Math.max(1e-22, dot(r, r) * 1e-12);
  for (let it = 0; it < Math.min(1200, Math.max(20, size * 3)); it++) {
    if (dot(r, r) <= target) return step;
    if (!Number.isFinite(product) || product <= 0) return null;
    const applied = new Float64Array(size);
    for (const [i, edge] of edges.entries()) {
      const d = e.samples[i]!.dq * (p[edge.from]! - p[edge.to]!);
      applied[edge.from] = applied[edge.from]! + d;
      applied[edge.to] = applied[edge.to]! - d;
    }
    const denom = dot(p, applied);
    if (!Number.isFinite(denom) || denom <= 0) return null;
    const scale = product / denom;
    for (let i = 1; i < size; i++) {
      step[i] = step[i]! + scale * p[i]!;
      r[i] = r[i]! - scale * applied[i]!;
      h[i] = r[i]! / diagonal[i]!;
    }
    const next = dot(r, h);
    for (let i = 1; i < size; i++) p[i] = h[i]! + (next / product) * p[i]!;
    product = next;
  }
  return null;
}

function initialHeads(size: number, edges: readonly FlowEdge[]): Float64Array {
  const heads = new Float64Array(size), known = new Set([0]), queue = [0];
  const neighbors: FlowEdge[][] = Array.from({ length: size }, () => []);
  for (const edge of edges) { neighbors[edge.from]!.push(edge); neighbors[edge.to]!.push(edge); }
  for (let i = 0; i < queue.length; i++) {
    const here = queue[i]!;
    for (const edge of neighbors[here]!) {
      const forward = edge.from === here;
      const next = forward ? edge.to : edge.from;
      if (known.has(next)) continue;
      known.add(next);
      heads[next] = heads[here]! + (forward ? -edge.atRestDelta : edge.atRestDelta);
      queue.push(next);
    }
  }
  return heads;
}

export function solveHeads(size: number, edges: readonly FlowEdge[], iterationLimit: number):
  { heads: Float64Array; evaluation: Evaluation } | null {
  let heads = initialHeads(size, edges);
  let current = evaluate(heads, edges);
  for (let iteration = 0; iteration <= iterationLimit; iteration++) {
    if (!Number.isFinite(current.norm)) return null;
    if (current.norm <= maxFlowResidual && Math.abs(current.residual[0] ?? 0) <= maxFlowResidual * Math.max(1, size - 1)) {
      return { heads, evaluation: current };
    }
    if (iteration === iterationLimit) break;
    const step = linearStep(current, edges);
    if (!step) return null;
    let improved = false;
    for (let scale = 1; scale >= 1 / 65_536; scale /= 2) {
      const guess = heads.map((head, i) => head + scale * step[i]!);
      const candidate = evaluate(guess, edges);
      if (candidate.norm < current.norm) {
        heads = guess; current = candidate; improved = true; break;
      }
    }
    if (!improved) return null;
  }
  return null;
}
