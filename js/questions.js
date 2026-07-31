// Question bank loading and deterministic daily selection.
//
// Everyone gets the same 5 questions on the same day: selection is seeded
// from the date (America/New_York). Questions only become eligible the day
// AFTER they're added, so a mid-day deploy of new questions never changes
// a ladder that people are already playing.

const RUNG_POINTS = [100, 200, 300, 500, 900];
export { RUNG_POINTS };

export function todayKey() {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// --- tiny seeded RNG (xmur3 + mulberry32) --------------------------------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRand(seedStr) {
  return mulberry32(xmur3(seedStr)())();
}

export async function loadBank() {
  const res = await fetch('data/questions.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`questions.json: HTTP ${res.status}`);
  const data = await res.json();
  return data.questions || [];
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// Returns today's five questions, easiest to hardest. Rung 5 may be a fresh
// "newsletter" question (added within the last 7 days) — the reader's edge.
export function dailyLadder(bank, dateKey = todayKey()) {
  const eligible = bank.filter((q) => q.added < dateKey);
  const pool = eligible.length >= 25 ? eligible : bank; // safety net for a young bank
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const used = new Set();
  const ladder = [];

  const freshNews = pool
    .filter((q) => q.category === 'newsletter' && daysBetween(q.added, dateKey) <= 7)
    .sort(byId);

  for (let d = 1; d <= 5; d++) {
    let tier;
    let isNews = false;
    if (d === 5 && freshNews.length > 0) {
      tier = freshNews.filter((q) => !used.has(q.id));
      isNews = tier.length > 0;
    }
    if (!tier || tier.length === 0) {
      tier = pool.filter((q) => q.difficulty === d && !used.has(q.id)).sort(byId);
    }
    if (tier.length === 0) tier = pool.filter((q) => !used.has(q.id)).sort(byId); // last resort
    const idx = Math.floor(seededRand(`${dateKey}#rung${d}`) * tier.length);
    const q = tier[idx];
    used.add(q.id);
    ladder.push({ ...q, rung: d, points: RUNG_POINTS[d - 1], isNews });
  }
  return ladder;
}

// The host uses a compact random seed once to choose five stable bank indices.
// The indices, rather than the seed, go into the room payload so a saved duel
// still names the exact questions after new questions are appended to the bank.
export function duelQuestionIndices(bank, seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Invalid duel seed');
  }
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  return RUNG_POINTS.map((_, index) => {
    const difficulty = index + 1;
    const tier = bank
      .map((question, bankIndex) => ({ ...question, bankIndex }))
      .filter((q) => q.difficulty === difficulty)
      .sort(byId);
    if (tier.length === 0) throw new Error(`No questions for duel rung ${difficulty}`);
    const pick = Math.floor(seededRand(`duel:${seed}#rung${difficulty}`) * tier.length);
    return tier[pick].bankIndex;
  });
}

// Returns the exact one-question-per-difficulty ladder pinned in a duel
// payload. The payload is the sole selector; no date or current news enters.
export function duelLadder(bank, questionIndices) {
  if (!Array.isArray(questionIndices) || questionIndices.length !== 5
      || new Set(questionIndices).size !== 5) {
    throw new Error('Invalid duel question list');
  }
  return questionIndices.map((bankIndex, index) => {
    const rung = index + 1;
    const question = Number.isSafeInteger(bankIndex) ? bank[bankIndex] : null;
    if (!question || question.difficulty !== rung) {
      throw new Error(`Invalid question for duel rung ${rung}`);
    }
    return { ...question, rung, points: RUNG_POINTS[index], isNews: false };
  });
}
