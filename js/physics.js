(() => {
  "use strict";

  const KINETIC = 0.0380998212; // ℏ² / (2mₑ), eV·nm²
  const BAND_COUNT = 5;
  const GRID_SIZES = [192, 384, 768];

  // The propagator is [[C, S], [-q² S, C]]. For an evanescent
  // segment divide every matrix element by exp(z) before matching.
  function segment(q2, length) {
    const z = Math.sqrt(Math.abs(q2)) * length;
    if (q2 < 0) {
      return [(1 + Math.exp(-2 * z)) / 2, z ? -Math.expm1(-2 * z) * length / (2 * z) : length, Math.exp(-z)];
    }
    return [Math.cos(z), z ? Math.sin(z) * length / z : length, 1];
  }

  function halfCell(energy, a, c, height) {
    const q2 = energy / KINETIC;
    const p2 = (energy - height) / KINETIC;
    const [ca, sa] = segment(q2, a / 2);
    const [cb, sb] = segment(p2, (c - a) / 2);
    // Match from the two symmetry centers. Boundary types are NN, ND, DN, DD.
    return [
      ca * p2 * sb + q2 * sa * cb,
      ca * cb - q2 * sa * sb,
      p2 * sa * sb - ca * cb,
      sa * cb + ca * sb,
    ];
  }

  function cellEquation(energy, a, c, height, target) {
    const q2 = energy / KINETIC;
    const p2 = (energy - height) / KINETIC;
    const [ca, sa] = segment(q2, a);
    const [cb, sb, scale] = segment(p2, c - a);
    return ca * cb - (q2 + p2) * sa * sb / 2 - target * scale;
  }

  function bisect(fn, left, right, positiveLeft) {
    for (let iteration = 0; iteration < 60; iteration++) {
      const mid = (left + right) / 2;
      if (mid === left || mid === right) break;
      const value = fn(mid);
      if (value === 0) return mid;
      if ((value > 0) === positiveLeft) left = mid;
      else right = mid;
    }
    return (left + right) / 2;
  }

  function finiteBands(a, c, height) {
    // Separate same-parity and opposite-parity problems so a narrow
    // band or a closed gap cannot hide both edges in one sign test.
    const step = Math.PI / (48 * c);
    const freeTop = KINETIC * (BAND_COUNT * Math.PI / c) ** 2;
    const isolatedTop = KINETIC * (BAND_COUNT * Math.PI / a) ** 2;
    const bound = Math.min(freeTop + height, isolatedTop);
    const steps = Math.ceil(Math.sqrt(bound / KINETIC) / step) + 1;
    const roots = [];
    let left = 0;
    let before = halfCell(left, a, c, height);
    for (let i = 1; i <= steps; i++) {
      const right = KINETIC * (i * step) ** 2;
      const after = halfCell(right, a, c, height);
      for (let type = 0; type < 4; type++) {
        if (after[type] === 0 || (before[type] !== 0 && (before[type] > 0) !== (after[type] > 0))) {
          const root = after[type] === 0 ? right : bisect(
            energy => halfCell(energy, a, c, height)[type], left, right, before[type] > 0,
          );
          roots.push({ energy: root, periodic: type === 0 || type === 3 });
        }
      }
      before = after;
      left = right;
      // Earlier intervals have already been searched for all four types.
      if (roots.length >= 2 * BAND_COUNT) break;
    }
    roots.sort((x, y) => x.energy - y.energy);
    return Array.from({ length: BAND_COUNT }, (_, i) => {
      const lower = roots[2 * i];
      const upper = roots[2 * i + 1];
      if (!upper || lower.periodic === upper.periodic) {
        throw new Error("Не удалось разделить границы энергетических зон.");
      }
      const tolerance = 32 * Number.EPSILON * Math.max(1, upper.energy);
      if (upper.energy - lower.energy < tolerance) {
        const energy = (lower.energy + upper.energy) / 2;
        return { min: energy, max: energy, center: energy, boundary: energy };
      }
      const center = lower.periodic ? lower.energy : upper.energy;
      const boundary = lower.periodic ? upper.energy : lower.energy;
      return { min: lower.energy, max: upper.energy, center, boundary };
    });
  }

  function free(c, k) {
    return [-3, -2, -1, 0, 1, 2, 3]
      .map(index => KINETIC * (Math.PI * (k + 2 * index) / c) ** 2)
      .sort((x, y) => x - y).slice(0, BAND_COUNT);
  }

  function edgeLimits(center, boundary) {
    return center.map((value, i) => ({
      min: Math.min(value, boundary[i]),
      max: Math.max(value, boundary[i]),
    }));
  }

  function spectrum(a, c, height, regime) {
    if (regime === "isolated") {
      const levels = Array.from({ length: BAND_COUNT }, (_, i) => KINETIC * ((i + 1) * Math.PI / a) ** 2);
      return { edges: levels.map(min => ({ min, max: min })), at: () => levels };
    }
    if (regime === "free" || height === 0) {
      const center = free(c, 0);
      const boundary = free(c, 1);
      return {
        edges: edgeLimits(center, boundary),
        at: k => free(c, k),
      };
    }
    const edges = finiteBands(a, c, height);
    return {
      edges,
      at(k) {
        const target = Math.cos(Math.PI * k);
        return edges.map(({ min, max, center, boundary }) => {
          if (k === 0) return center;
          if (k === 1) return boundary;
          if (min === max) return min;
          return bisect(energy => cellEquation(energy, a, c, height, target), min, max, center === min);
        });
      },
    };
  }

  function gaps(edges) {
    return edges.slice(1).map(({ min }, i) => Math.max(0, min - edges[i].max));
  }

  function gridEdges(a, c, height, intervals) {
    const dx = c / intervals;
    const kinetic = KINETIC / dx ** 2;
    const half = intervals / 2;
    const diagonal = Float64Array.from({ length: half + 1 }, (_, i) => {
      const left = Math.max(0, (i - 0.5) * dx);
      const right = Math.min(c / 2, (i + 0.5) * dx);
      const barrierFraction = Math.max(0, right - Math.max(left, a / 2)) / (right - left);
      return 2 * kinetic + height * barrierFraction;
    });

    function halfSpectrum(leftNeumann, rightNeumann) {
      // Dirichlet omits an endpoint. Reflecting a ghost node at a Neumann
      // endpoint gives sqrt(2) times the usual off-diagonal after symmetrizing.
      const first = leftNeumann ? 0 : 1;
      const last = rightNeumann ? half : half - 1;
      const offSquared = new Float64Array(last - first + 1).fill(kinetic ** 2);
      offSquared[0] = 0;
      if (leftNeumann) offSquared[1] *= 2;
      if (rightNeumann) offSquared[offSquared.length - 1] *= 2;

      function countBelow(energy) {
        let pivot = 1;
        let count = 0;
        for (let i = first; i <= last; i++) {
          pivot = diagonal[i] - energy - offSquared[i - first] / pivot;
          if (Math.abs(pivot) < kinetic * Number.EPSILON) pivot = -kinetic * Number.EPSILON;
          if (pivot < 0) count++;
        }
        return count;
      }

      return Array.from({ length: BAND_COUNT }, (_, i) => bisect(
        energy => countBelow(energy) <= i ? 1 : -1, -1, 4 * kinetic + height + 1, true,
      ));
    }

    const ordered = (first, second) => [...first, ...second].sort((x, y) => x - y).slice(0, BAND_COUNT);
    const periodic = ordered(halfSpectrum(true, true), halfSpectrum(false, false));
    const antiperiodic = ordered(halfSpectrum(true, false), halfSpectrum(false, true));
    return edgeLimits(periodic, antiperiodic);
  }

  function solve({ a, c, height, regime }) {
    if (![a, c, height].every(Number.isFinite) || !(a > 0 && c > a && height >= 0)) {
      throw new Error("Требуется 0 < a < c и U ≥ 0.");
    }
    const { edges, at } = spectrum(a, c, height, regime);
    const steps = 40;
    const half = Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
    const bands = edges.map((_, n) => Array.from({ length: 2 * steps + 1 }, (_, i) => {
      const j = i - steps;
      return [j / steps, half[Math.abs(j)][n]];
    }));
    const maxHeight = 15;
    const sweepHeights = Array.from({ length: 31 }, (_, i) => maxHeight * (i / 30));
    if (regime === "finite" && height > 0 && !sweepHeights.some(u => Math.abs(u - height) < 1e-10)) {
      sweepHeights.push(height);
      sweepHeights.sort((u, v) => u - v);
    }
    const sweep = sweepHeights.map(u => [
      u, gaps(regime === "finite" && Math.abs(u - height) < 1e-10 ? edges : spectrum(a, c, u, "finite").edges),
    ]);
    const gridComparison = regime === "isolated" ? [] : GRID_SIZES.map(intervals => {
      const numerical = gridEdges(a, c, regime === "free" ? 0 : height, intervals);
      const maxError = Math.max(...numerical.map(({ min, max }, i) => (
        Math.max(Math.abs(min - edges[i].min), Math.abs(max - edges[i].max))
      )));
      return { intervals, firstGap: gaps(numerical)[0], maxError };
    });
    return { bands, edges, gaps: gaps(edges), sweep, maxHeight, gridComparison };
  }

  globalThis.Simulation = { solve };
})();
