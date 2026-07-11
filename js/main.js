// LOCAL TRIVIA LADDER — daily 5-question climb for Btown Games.
import { loadBank, dailyLadder, todayKey, RUNG_POINTS } from './questions.js';
import {
  lbEnabled, getName, submitScore, renamePlayer, fetchTop, monthLabel, playerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const TIMER_MS = 25000;
const STATE_KEY = 'trivia-ladder-state';

// ?testdate=YYYY-MM-DD plays another day's ladder without saving anything
// or touching the leaderboard — for testing only.
const TEST_DATE = new URLSearchParams(location.search).get('testdate');

const VERDICTS = [
  [1800, 'Town Elder 🏛️ You ARE the BTown Brief.'],
  [1500, 'Church Street Royalty 👑'],
  [1100, 'Certified Burlingtonian 🍁'],
  [700, 'Solid Local 🛶 You know your creemees.'],
  [400, 'New North Ender in training 🚲'],
  [100, 'Recent Transplant 📦 Keep reading the Brief.'],
  [0, 'Flatlander Alert 🚨 Were you even trying?'],
];

// ------------------------------------------------------------ state
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
}
function saveState(s) { if (!TEST_DATE) localStorage.setItem(STATE_KEY, JSON.stringify(s)); }

let state = TEST_DATE ? {} : loadState();
state.results = state.results || {};   // date -> { rungs:[{correct,points}], score, submitted }
state.streak = state.streak || { count: 0, lastDate: '' };

const today = TEST_DATE || todayKey();
let ladder = [];       // today's five questions
let rungIndex = 0;     // 0..4
let rungResults = [];  // [{correct, points, qId}]
let deadline = 0;
let timerInt = null;
let answered = false;

// resume partial progress after a refresh (no retry-scumming)
if (state.progress && state.progress.date !== today) delete state.progress;

// ------------------------------------------------------------ boot
$('dayBar').textContent = new Date(today + 'T12:00:00').toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York',
});

const previewEl = $('ladderPreview');
RUNG_POINTS.forEach((p) => {
  const div = document.createElement('div');
  div.className = 'rung-chip';
  div.textContent = p;
  previewEl.appendChild(div);
});
if (state.streak.count > 0) {
  $('introStreak').textContent = `🔥 ${state.streak.count}-day streak`;
}

let bank = [];
try {
  bank = await loadBank();
} catch (e) {
  $('introScreen').innerHTML = `<p style="text-align:center">Couldn't load today's questions (${e.message}). Try a refresh?</p>`;
  throw e;
}
ladder = dailyLadder(bank, today);

if (state.results[today]) {
  // already played — hard block, straight to results
  showResults(state.results[today], false);
} else if (state.progress && state.progress.date === today) {
  rungResults = state.progress.rungs;
  rungIndex = rungResults.length;
  startGame();
}

$('startBtn').addEventListener('click', startGame);

// ------------------------------------------------------------ game flow
function startGame() {
  $('introScreen').classList.add('hidden');
  $('resultsScreen').classList.add('hidden');
  $('gameScreen').classList.remove('hidden');
  renderLadderRail();
  showQuestion();
}

function renderLadderRail() {
  const rail = $('ladder');
  rail.innerHTML = '';
  ladder.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'rung';
    div.textContent = q.points;
    if (q.isNews) div.innerHTML += '<span class="news-badge">📰</span>';
    if (i < rungResults.length) div.classList.add(rungResults[i].correct ? 'won' : 'lost');
    else if (i === rungIndex) div.classList.add('current');
    rail.appendChild(div);
  });
}

function showQuestion() {
  answered = false;
  const q = ladder[rungIndex];
  $('reveal').classList.add('hidden');
  $('rungLabel').textContent = `RUNG ${q.rung} · ${q.points} PTS${q.isNews ? ' · 📰 FROM THE BRIEF' : ''}`;
  $('qText').textContent = q.q;
  const box = $('choices');
  box.innerHTML = '';
  q.choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = c;
    b.addEventListener('click', () => answer(i));
    box.appendChild(b);
  });
  renderLadderRail();
  startTimer();
}

function startTimer() {
  clearInterval(timerInt);
  deadline = Date.now() + TIMER_MS;
  timerInt = setInterval(tick, 100);
  tick();
}
function tick() {
  const left = Math.max(0, deadline - Date.now());
  const fill = $('timerFill');
  fill.style.width = `${(left / TIMER_MS) * 100}%`;
  fill.classList.toggle('hurry', left < 6000);
  $('qTimer').textContent = Math.ceil(left / 1000);
  if (left <= 0 && !answered) answer(-1); // time's up
}

function answer(choiceIdx) {
  if (answered) return;
  answered = true;
  clearInterval(timerInt);
  const q = ladder[rungIndex];
  const secondsLeft = Math.max(0, (deadline - Date.now()) / 1000);
  const correct = choiceIdx === q.answerIndex;
  const bonus = correct ? Math.round(secondsLeft * 2) : 0; // small speed bonus, max +50
  const points = correct ? q.points + bonus : 0;

  [...$('choices').children].forEach((b, i) => {
    b.disabled = true;
    if (i === q.answerIndex) b.classList.add('correct');
    else if (i === choiceIdx) b.classList.add('wrong');
    else b.classList.add('dim');
  });

  const head = $('revealHead');
  if (correct) {
    head.textContent = `✅ Correct! +${q.points}${bonus ? ` (+${bonus} speed bonus)` : ''}`;
    head.className = 'good';
  } else {
    head.textContent = choiceIdx === -1 ? '⏰ Time! No points this rung.' : '❌ Nope — no points this rung.';
    head.className = 'bad';
  }
  $('revealText').textContent = q.explanation;
  const srcA = $('revealSrc');
  if (q.source) { srcA.href = q.source; srcA.parentElement.classList.remove('hidden'); }
  else srcA.parentElement.classList.add('hidden');
  $('nextBtn').textContent = rungIndex === 4 ? 'See your results 🏁' : 'Next rung ↑';
  $('reveal').classList.remove('hidden');

  rungResults.push({ correct, points, qId: q.id });
  state.progress = { date: today, rungs: rungResults };
  saveState(state);
  renderLadderRail();
}

$('nextBtn').addEventListener('click', () => {
  if (rungIndex < 4) {
    rungIndex++;
    showQuestion();
  } else {
    finishDay();
  }
});

// ------------------------------------------------------------ results
function finishDay() {
  const score = rungResults.reduce((s, r) => s + r.points, 0);
  // streak
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  state.streak = {
    count: state.streak.lastDate === yesterday ? state.streak.count + 1 : 1,
    lastDate: today,
  };
  const result = { rungs: rungResults, score, submitted: false };
  state.results[today] = result;
  delete state.progress;
  saveState(state);
  showResults(result, true);
}

function showResults(result, justFinished) {
  $('introScreen').classList.add('hidden');
  $('gameScreen').classList.add('hidden');
  $('resultsScreen').classList.remove('hidden');

  $('verdict').textContent = VERDICTS.find(([min]) => result.score >= min)[1];
  $('finalScore').textContent = result.score;
  $('streakNote').textContent = state.streak.count > 1
    ? `🔥 ${state.streak.count}-day streak — see you tomorrow`
    : 'Come back tomorrow to start a streak 🔥';

  const recap = $('recap');
  recap.innerHTML = '';
  result.rungs.forEach((r, i) => {
    const q = ladder[i];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="emoji"></span><span class="rq"></span><span class="pts"></span>';
    row.querySelector('.emoji').textContent = r.correct ? '🟩' : '🟥';
    row.querySelector('.rq').textContent = `${q.isNews ? '📰 ' : ''}${q.q}`;
    const pts = row.querySelector('.pts');
    pts.textContent = r.correct ? `+${r.points}` : '0';
    if (!r.correct) pts.classList.add('zero');
    recap.appendChild(row);
  });

  startCountdown();
  updateLeaderboard(justFinished ? result : null);
}

function shareText() {
  const r = state.results[today];
  const squares = r.rungs.map((x) => (x.correct ? '🟩' : '🟥')).join('');
  return `Local Trivia Ladder ${today}\n${squares} ${r.score} pts\nhttps://btownbrief.github.io/trivia-ladder/`;
}
$('shareBtn').addEventListener('click', async () => {
  const text = shareText();
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      $('shareDone').classList.remove('hidden');
      setTimeout(() => $('shareDone').classList.add('hidden'), 1600);
    }
  } catch { /* user cancelled */ }
});

function startCountdown() {
  const el = $('countdown');
  function update() {
    // ms until next midnight in New York
    const now = new Date();
    const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const next = new Date(nyNow); next.setHours(24, 0, 0, 0);
    const ms = next - nyNow;
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    if (ms < 1500) location.reload();
  }
  update();
  setInterval(update, 1000);
}

// ------------------------------------------------------------ leaderboard
const lbBox = $('lb'), lbList = $('lbList'), lbStatus = $('lbStatus');
const lbForm = $('lbForm'), lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn'), lbLastBtn = $('lbLastBtn'), lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbBox.classList.remove('hidden');
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

async function submitOnce() {
  if (TEST_DATE) return; // test plays never touch the board
  const r = state.results[today];
  if (!r || r.submitted || r.score <= 0 || !getName()) return;
  await submitScore(r.score);
  r.submitted = true;
  saveState(state);
}

async function updateLeaderboard(freshResult) {
  if (!lbEnabled()) return;
  if (!getName()) {
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatus.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    return;
  }
  try { await submitOnce(); } catch { /* offline — stays unsubmitted */ }
  renderBoard();
}

async function renderBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatus.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = playerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = '<span class="rank"></span><span class="nm"></span><span class="sc"></span>';
      li.querySelector('.rank').textContent = medal || `${i + 1}.`;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('.sc').textContent = r.score;
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatus.textContent = rows.length === 0
      ? 'No scores yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatus.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  try {
    await renamePlayer(name);
    await submitOnce();
  } catch { /* offline */ }
  renderBoard();
});
lbNameInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // never let name-typing reach game shortcuts
  if (e.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = getName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel'); lbLastBtn.classList.remove('sel');
  renderBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel'); lbThisBtn.classList.remove('sel');
  renderBoard();
});

// ------------------------------------------------------------ keyboard
// 1-4 answer the current question; ignored while typing in any input.
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ($('gameScreen').classList.contains('hidden')) return;
  if (!$('reveal').classList.contains('hidden')) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('nextBtn').click(); }
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 4) answer(n - 1);
});
