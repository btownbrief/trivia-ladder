// Trivia Ladder duel results are deliberately tiny and JSON-safe.
// Score decides first; elapsed time breaks equal-score ties. Timing is
// self-reported by each phone, which is an accepted friends-only tradeoff.

export function makeDuelResult(score, ms, gaveUp = false) {
  return {
    score: gaveUp ? -1 : Math.max(0, Math.floor(Number(score) || 0)),
    ms: Math.max(0, Math.floor(Number(ms) || 0)),
    ...(gaveUp ? { gaveUp: true } : {}),
  };
}

// 1 means a wins, -1 means b wins, 0 means draw.
export function compareDuelResults(a, b) {
  if (!a || !b) return 0;
  if (a.gaveUp || b.gaveUp) {
    if (a.gaveUp && b.gaveUp) return 0;
    return a.gaveUp ? -1 : 1;
  }
  if (a.score !== b.score) return a.score > b.score ? 1 : -1;
  if (a.ms !== b.ms) return a.ms < b.ms ? 1 : -1;
  return 0;
}
