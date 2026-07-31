// LOCAL TRIVIA LADDER — daily 5-question climb for Btown Games.
import {
  loadBank, dailyLadder, duelQuestionIndices, duelLadder, todayKey, RUNG_POINTS,
} from './questions.js';
import {
  lbEnabled, getName, submitScore, renamePlayer, fetchTop, monthLabel, playerId,
} from './leaderboard.js';
import {
  Duel,
  getName as duelGetName,
  savedSession as duelSavedSession,
  clearSession as duelClearSession,
} from './duel.js';
import { makeDuelResult, compareDuelResults } from './duel-rules.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const TIMER_MS = 25000;
const STATE_KEY = 'trivia-ladder-state';
const DUEL_GAME = 'trivia-ladder';
const DUEL_NAME_KEY = 'trivia-ladder-duel-name';

// ?testdate=YYYY-MM-DD plays another day's ladder without saving anything
// or touching the leaderboard — for testing only.
const QUERY = new URLSearchParams(location.search);
const TEST_DATE = QUERY.get('testdate');
const DUEL_REQUESTED = QUERY.get('duel') === '1';
const ISOLATED_PLAY = Boolean(TEST_DATE) || DUEL_REQUESTED;

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
function saveState(s) {
  if (!ISOLATED_PLAY) localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

let state = ISOLATED_PLAY ? {} : loadState();
state.results = state.results || {};   // date -> { rungs:[{correct,points}], score, submitted }
state.streak = state.streak || { count: 0, lastDate: '' };

const today = TEST_DATE || todayKey();
let ladder = [];       // today's five questions
let rungIndex = 0;     // 0..4
let rungResults = [];  // [{correct, points, qId}]
let deadline = 0;
let timerInt = null;
let answered = false;
let duel = null;
let duelSubmitted = false;
let duelStartedAt = 0;
let scoreAnimation = 0;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function clearTransientEffects() {
  document.querySelectorAll('.points-fly, .climb-glow').forEach((node) => node.remove());
  cancelAnimationFrame(scoreAnimation);
  scoreAnimation = 0;
}

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

function renderSoundButton() {
  const on = sound.isEnabled();
  $('soundBtn').textContent = on ? '🔊' : '🔇';
  $('soundBtn').setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  $('soundBtn').setAttribute('aria-pressed', String(on));
}

renderSoundButton();
$('soundBtn').addEventListener('click', () => {
  sound.setEnabled(!sound.isEnabled());
  renderSoundButton();
});

$('startBtn').addEventListener('click', () => {
  void sound.unlock();
  startGame();
});

// ------------------------------------------------------------ game flow
function startGame() {
  if (duelActive() && !duelStartedAt) duelStartedAt = Date.now();
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
  clearTransientEffects();
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
  $('speedBonus').textContent = `answer now: +${Math.round((left / 1000) * 2)}`;
  $('speedBonus').style.setProperty('--bonus-width', `${(left / TIMER_MS) * 100}%`);
  if (left <= 0 && !answered) answer(-1); // time's up
}

function removeAfterAnimation(node, fallbackMs) {
  node.addEventListener('animationend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), fallbackMs);
}

function animateResolvedRung(correct, points) {
  const rail = $('ladder');
  const rungs = rail.querySelectorAll('.rung');
  const resolved = rungs[rungIndex];
  const next = rungs[rungIndex + 1];
  if (!resolved) return;

  resolved.classList.add('resolved-now');
  resolved.addEventListener('animationend', () => resolved.classList.remove('resolved-now'), { once: true });
  setTimeout(() => resolved.classList.remove('resolved-now'), 500);
  if (reducedMotion.matches) return;

  if (correct) {
    document.querySelector('.points-fly')?.remove();
    const cardRect = document.querySelector('.qcard').getBoundingClientRect();
    const rungRect = resolved.getBoundingClientRect();
    const pointsFly = document.createElement('span');
    pointsFly.className = 'points-fly';
    pointsFly.setAttribute('aria-hidden', 'true');
    pointsFly.textContent = `+${points}`;
    pointsFly.style.left = `${cardRect.left + cardRect.width / 2}px`;
    pointsFly.style.top = `${cardRect.top + Math.min(cardRect.height * 0.42, 90)}px`;
    pointsFly.style.setProperty('--fly-x', `${rungRect.left + rungRect.width / 2 - (cardRect.left + cardRect.width / 2)}px`);
    pointsFly.style.setProperty('--fly-y', `${rungRect.top + rungRect.height / 2 - (cardRect.top + Math.min(cardRect.height * 0.42, 90))}px`);
    document.body.appendChild(pointsFly);
    removeAfterAnimation(pointsFly, 800);
  }

  if (next) {
    rail.querySelector('.climb-glow')?.remove();
    const railRect = rail.getBoundingClientRect();
    const from = resolved.getBoundingClientRect();
    const to = next.getBoundingClientRect();
    const glow = document.createElement('span');
    glow.className = 'climb-glow';
    glow.setAttribute('aria-hidden', 'true');
    glow.style.left = `${from.left + from.width / 2 - railRect.left}px`;
    glow.style.top = `${from.top + from.height / 2 - railRect.top}px`;
    glow.style.setProperty('--climb-x', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
    glow.style.setProperty('--climb-y', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
    rail.appendChild(glow);
    removeAfterAnimation(glow, 750);
  }
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
  sound.answer(correct);

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
  $('speedBonus').textContent = correct ? `earned: +${bonus} speed` : 'speed bonus: +0';
  $('speedBonus').style.setProperty('--bonus-width', '0%');
  animateResolvedRung(correct, points);
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
  if (duelActive()) {
    clearInterval(timerInt);
    $('gameScreen').classList.add('hidden');
    const ms = Math.max(0, Date.now() - duelStartedAt);
    void duelSubmit(makeDuelResult(score, ms));
    return;
  }
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
  clearTransientEffects();
  $('introScreen').classList.add('hidden');
  $('gameScreen').classList.add('hidden');
  $('resultsScreen').classList.remove('hidden');

  $('verdict').textContent = VERDICTS.find(([min]) => result.score >= min)[1];
  const scoreline = document.querySelector('.scoreline');
  scoreline.setAttribute('aria-label', `${result.score} points out of 2000 plus bonus`);
  $('finalScore').textContent = justFinished && !reducedMotion.matches ? '0' : result.score;

  const streak = $('streakNote');
  streak.classList.add('results-streak');
  streak.innerHTML = '';
  const flame = document.createElement('span');
  flame.className = `streak-flame${justFinished && !reducedMotion.matches ? ' incremented' : ''}`;
  flame.setAttribute('aria-hidden', 'true');
  flame.style.setProperty('--flame-size', `${Math.min(38, 22 + state.streak.count * 1.4)}px`);
  flame.textContent = '🔥';
  const streakText = document.createElement('span');
  streakText.textContent = state.streak.count > 1
    ? `${state.streak.count}-day streak — see you tomorrow`
    : 'Come back tomorrow to start a streak';
  streak.append(flame, streakText);

  const recap = $('recap');
  recap.innerHTML = '';
  result.rungs.forEach((r, i) => {
    const q = ladder[i];
    const row = document.createElement('div');
    row.className = 'row';
    if (justFinished && !reducedMotion.matches) {
      row.classList.add('recap-enter');
      row.style.setProperty('--recap-delay', `${i * 90}ms`);
    }
    row.innerHTML = '<span class="emoji"></span><span class="rq"></span><span class="pts"></span>';
    row.querySelector('.emoji').textContent = r.correct ? '🟩' : '🟥';
    row.querySelector('.rq').textContent = `${q.isNews ? '📰 ' : ''}${q.q}`;
    const pts = row.querySelector('.pts');
    pts.textContent = r.correct ? `+${r.points}` : '0';
    if (!r.correct) pts.classList.add('zero');
    recap.appendChild(row);
  });

  if (justFinished) {
    sound.results(result.score);
    if (!reducedMotion.matches) {
      const started = performance.now();
      const duration = 650;
      const countScore = (now) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - progress) ** 3;
        $('finalScore').textContent = Math.round(result.score * eased);
        if (progress < 1) scoreAnimation = requestAnimationFrame(countScore);
        else scoreAnimation = 0;
      };
      scoreAnimation = requestAnimationFrame(countScore);
    }
  }

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
  if (ISOLATED_PLAY) return; // test plays and friend duels never touch the board
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

// ------------------------------------------------------------ duel mode
// ⚔️ Friend climbs use a payload of { q: [five bank indices] } to pin one
// deterministic question per difficulty. Deals are rejected if any selected
// question is on today's live ladder. Daily saves, streaks, results, and
// leaderboard writes are gated above; only room/session keys persist.

function duelActive() {
  return DUEL_REQUESTED && duel !== null;
}
let duelPanelIntent = 'host';
let duelChallengeKey = '';

function duelUrl() {
  return '?duel=1';
}

function validDuelPayload(payload) {
  if (!payload || !Array.isArray(payload.q)) return false;
  try {
    const challenge = duelLadder(bank, payload.q);
    const liveIds = new Set(dailyLadder(bank, todayKey()).map((q) => q.id));
    return challenge.every((question) => !liveIds.has(question.id));
  } catch {
    return false;
  }
}

function freshDuelPayload() {
  const liveIds = new Set(dailyLadder(bank, todayKey()).map((q) => q.id));
  for (let attempt = 0; attempt < 1000; attempt++) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const q = duelQuestionIndices(bank, seed);
    const challenge = duelLadder(bank, q);
    if (challenge.every((question) => !liveIds.has(question.id))) return { q };
  }
  throw new Error('Could not deal a separate friend ladder');
}

const FRIENDLY_DUEL_ERRORS = {
  not_found: 'That friend climb has vanished — start a fresh one.',
  not_seated: 'That seat is no longer yours — start a fresh climb.',
  room_full: 'That ladder already has two climbers.',
  room_started: 'That ladder already started without you.',
  not_ready: 'Friend climbs are not switched on yet — check back soon.',
  offline: 'Can’t reach the trivia desk — are you online?',
  opponent_left: 'Your rival stepped off the ladder.',
};
function duelFriendly(err) {
  if (err && err.code === 'wrong_game') {
    return `That code belongs to ${String(err.detail || 'another game').replace(/-/g, ' ')}.`;
  }
  return (err && FRIENDLY_DUEL_ERRORS[err.code]) || 'The trivia desk stumbled — please try again.';
}

function snapshotLeaderboardIdentity() {
  return {
    id: localStorage.getItem('btown-player-id'),
    name: localStorage.getItem('btown-player-name'),
  };
}

function restoreLeaderboardIdentity(previous) {
  for (const [key, value] of [
    ['btown-player-id', previous.id],
    ['btown-player-name', previous.name],
  ]) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

function rememberDuelName(name) {
  localStorage.setItem(DUEL_NAME_KEY, name.trim().slice(0, 24));
}

function openDuelPanel(intent) {
  duelPanelIntent = intent;
  $('duelOverlay').classList.add('hidden');
  $('opTitle').textContent = intent === 'host' ? 'Start a friend climb' : 'Join a friend climb';
  $('opGo').textContent = intent === 'host' ? 'Get a code' : 'Climb!';
  $('opCodeWrap').classList.toggle('hidden', intent === 'host');
  $('opError').classList.add('hidden');
  $('opName').value = $('opName').value
    || localStorage.getItem(DUEL_NAME_KEY)
    || duelGetName();
  $('onlinePanel').classList.remove('hidden');
  (intent === 'join' && $('opName').value ? $('opCode') : $('opName')).focus();
}

async function duelGo() {
  if ($('opGo').disabled) return;
  const name = $('opName').value.trim();
  if (!name) {
    $('opError').textContent = 'Every climber needs a name.';
    $('opError').classList.remove('hidden');
    $('opName').focus();
    return;
  }
  $('opGo').disabled = true;
  $('opError').classList.add('hidden');
  const previousLeaderboardIdentity = snapshotLeaderboardIdentity();
  rememberDuelName(name);
  try {
    if (duelPanelIntent === 'host') {
      const d = await Duel.create({
        game: DUEL_GAME,
        name,
        payload: freshDuelPayload(),
      });
      $('onlinePanel').classList.add('hidden');
      openDuelLobby(d);
    } else {
      const code = $('opCode').value.trim();
      if (code.length !== 4) {
        $('opError').textContent = 'A climb code is 4 letters.';
        $('opError').classList.remove('hidden');
        $('opCode').focus();
        return;
      }
      const d = await Duel.join({ game: DUEL_GAME, code, name });
      if (!validDuelPayload(d.payload)) throw new Error('Invalid duel payload');
      location.href = duelUrl();
    }
  } catch (err) {
    $('opError').textContent = duelFriendly(err);
    $('opError').classList.remove('hidden');
  } finally {
    // rooms.js shares the fleet identity id/name; restore both so opening a
    // duel cannot mint or rename this game's monthly leaderboard identity.
    restoreLeaderboardIdentity(previousLeaderboardIdentity);
    $('opGo').disabled = false;
  }
}

function openDuelLobby(d) {
  if ($('lobby')._duel && $('lobby')._duel !== d) $('lobby')._duel.stop();
  $('lobby')._duel = d;
  $('lobbyCode').textContent = d.code;
  $('lobby').classList.remove('hidden');
  d.start({
    onChange: () => {
      $('lobbyError').classList.add('hidden');
      if (d.status !== 'waiting') location.href = duelUrl();
    },
    onError: (err) => {
      $('lobbyError').textContent = `${duelFriendly(err)} You can still call off the climb.`;
      $('lobbyError').classList.remove('hidden');
      if (err && ['not_found', 'not_seated', 'room_started'].includes(err.code)) {
        duelClearSession(DUEL_GAME);
      }
    },
  });
}

function cancelDuelLobby() {
  const d = $('lobby')._duel;
  if (d) void d.leave();
  $('lobby')._duel = null;
  $('lobby').classList.add('hidden');
}

function refreshDuelRejoin() {
  const saved = duelSavedSession(DUEL_GAME);
  const btn = $('rejoinBtn');
  btn.classList.toggle('hidden', !saved || duelActive());
  if (saved) btn.textContent = `↩ Rejoin climb ${saved.code}`;
}

async function rejoinDuel() {
  $('rejoinBtn').disabled = true;
  $('opError').classList.add('hidden');
  try {
    const d = await Duel.resume({ game: DUEL_GAME });
    if (d.status === 'waiting') {
      $('duelOverlay').classList.add('hidden');
      openDuelLobby(d);
    } else if (validDuelPayload(d.payload)) {
      location.href = duelUrl();
    } else {
      throw new Error('Invalid duel payload');
    }
  } catch (err) {
    // Transient failures keep the saved session. Only terminal room errors
    // remove the rejoin path.
    if (err && ['not_found', 'not_seated', 'room_started'].includes(err.code)) {
      duelClearSession(DUEL_GAME);
      refreshDuelRejoin();
    }
    $('opError').textContent = duelFriendly(err);
    $('opError').classList.remove('hidden');
    $('onlinePanel').classList.remove('hidden');
  } finally {
    $('rejoinBtn').disabled = false;
  }
}

function exitDuel() {
  if (duel) {
    if (duel.isComplete()) void duel.leave();
    else duel.stop(); // preserve an unfinished session for later rejoin
  }
  location.replace(location.pathname);
}

function duelOpponent() {
  return duel ? (duel.others()[0] || {}) : {};
}

function renderDuelBar() {
  if (!duel) return;
  const opp = duelOpponent();
  const who = opp.name ? `vs ${opp.name}` : 'waiting for your rival';
  let note = '';
  if (opp.left && !duel.isComplete()) note = ' — they stepped off';
  else if (duelSubmitted && !duel.isComplete()) note = ' — waiting on their score…';
  $('duelBarText').textContent = `⚔️ CLIMB ${duel.code} · ${who}${note}`;
  $('duelBar').classList.remove('hidden');
}

function formatDuelTime(ms) {
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

function formatDuelResult(result) {
  if (!result) return 'waiting…';
  if (result.gaveUp) return 'forfeited';
  return `${result.score} pts · ${formatDuelTime(result.ms)}`;
}

function addDuelResultRow(label, result, winner) {
  const row = document.createElement('div');
  row.className = `duel-row${winner ? ' win' : ''}`;
  const name = document.createElement('span');
  name.textContent = label;
  const score = document.createElement('span');
  score.className = 'duel-time';
  score.textContent = formatDuelResult(result);
  row.append(name, score);
  $('duelDoneRows').appendChild(row);
}

function showDuelWaiting(message = 'LADDER LOCKED IN 🪜') {
  const opp = duelOpponent();
  $('duelDoneHead').textContent = opp.left
    ? 'YOUR RIVAL STEPPED OFF'
    : message;
  $('duelDoneRows').innerHTML = '';
  addDuelResultRow('You', duel.myResult(), true);
  addDuelResultRow(opp.name || 'Rival', opp.result, false);
  $('duelRematchBtn').classList.add('hidden');
  $('duelExitBtn').textContent = 'Back to today’s ladder';
  $('duelDone').classList.remove('hidden');
}

function showDuelDeadEnd(message) {
  $('introScreen').classList.add('hidden');
  $('gameScreen').classList.add('hidden');
  $('resultsScreen').classList.add('hidden');
  $('duelDoneHead').textContent = message;
  $('duelDoneRows').innerHTML = '';
  $('duelRematchBtn').classList.add('hidden');
  $('duelExitBtn').textContent = 'Back to today’s ladder';
  $('duelDone').classList.remove('hidden');
}

function showDuelDone() {
  duel.stop();
  const mine = duel.myResult();
  const opp = duelOpponent();
  const theirs = opp.result;
  const outcome = compareDuelResults(mine, theirs);
  $('duelDoneHead').textContent = outcome === 0
    ? 'DEAD EVEN — DRAW! 🪜'
    : outcome > 0
      ? 'YOU TOPPED THE LADDER! 🏆'
      : `${(opp.name || 'YOUR RIVAL').toUpperCase()} TAKES IT`;
  $('duelDoneRows').innerHTML = '';
  addDuelResultRow('You', mine, outcome >= 0);
  addDuelResultRow(opp.name || 'Rival', theirs, outcome <= 0);
  $('duelRematchBtn').classList.remove('hidden');
  $('duelExitBtn').textContent = 'Back to today’s ladder';
  $('duelDone').classList.remove('hidden');
}

async function duelSubmit(result) {
  if (!duel || duelSubmitted) return;
  duelSubmitted = true;
  renderDuelBar();
  showDuelWaiting('POSTING YOUR CLIMB…');
  try {
    await duel.submitResult(result);
  } catch (err) {
    if (err && err.code === 'opponent_left') {
      showDuelWaiting();
      return;
    }
    duelSubmitted = false;
    showDuelDeadEnd(`${duelFriendly(err)} Your climb was not posted.`);
    return;
  }
  if (duel.isComplete()) showDuelDone();
  else showDuelWaiting();
}

async function abandonDuel() {
  if (!duelActive() || duelSubmitted) {
    exitDuel();
    return;
  }
  $('duelAbandonBtn').disabled = true;
  const ms = duelStartedAt ? Date.now() - duelStartedAt : 0;
  await duelSubmit(makeDuelResult(0, ms, true));
  duel.stop();
  location.replace(location.pathname); // saved session can rejoin the comparison
}

async function bootDuel() {
  try {
    duel = await Duel.resume({ game: DUEL_GAME });
  } catch (err) {
    if (err && ['not_found', 'not_seated', 'room_started'].includes(err.code)) {
      duelClearSession(DUEL_GAME);
    }
    showDuelDeadEnd(duelFriendly(err));
    return 'blocked';
  }
  if (!validDuelPayload(duel.payload)) {
    showDuelDeadEnd('This friend ladder is unreadable. Head back and start a fresh one.');
    return 'blocked';
  }
  duelChallengeKey = duel.payload.q.join(',');
  duelSubmitted = duel.myResult() !== null;
  renderDuelBar();
  duel.start({
    onChange: () => {
      if (!validDuelPayload(duel.payload)) {
        showDuelDeadEnd('This friend ladder is unreadable. Head back and start a fresh one.');
        return;
      }
      if (duel.payload.q.join(',') !== duelChallengeKey) {
        location.replace(duelUrl());
        return;
      }
      renderDuelBar();
      if (duel.isComplete()) showDuelDone();
      else if (duel.myResult()) showDuelWaiting();
    },
    onError: (err) => {
      if (err && ['not_found', 'not_seated', 'room_started'].includes(err.code)) {
        duelClearSession(DUEL_GAME);
      }
      showDuelDeadEnd(duelFriendly(err));
    },
  });
  if (duel.isComplete()) {
    showDuelDone();
    return 'done';
  }
  if (duelSubmitted) {
    showDuelWaiting();
    return 'waiting';
  }
  return 'play';
}

async function duelRematch() {
  if (!duel) return;
  $('duelRematchBtn').disabled = true;
  try {
    await duel.rematch(freshDuelPayload());
    location.href = duelUrl();
  } catch (err) {
    $('duelDoneHead').textContent = duelFriendly(err);
    $('duelRematchBtn').disabled = false;
  }
}

$('duelBtn').addEventListener('click', () => {
  refreshDuelRejoin();
  $('duelOverlay').classList.remove('hidden');
});
$('hostBtn').addEventListener('click', () => openDuelPanel('host'));
$('joinBtn').addEventListener('click', () => openDuelPanel('join'));
$('opCancel').addEventListener('click', () => $('onlinePanel').classList.add('hidden'));
$('opGo').addEventListener('click', duelGo);
$('lobbyCancel').addEventListener('click', cancelDuelLobby);
$('rejoinBtn').addEventListener('click', rejoinDuel);
$('duelRematchBtn').addEventListener('click', duelRematch);
$('duelExitBtn').addEventListener('click', exitDuel);
$('duelAbandonBtn').addEventListener('click', abandonDuel);
$('opCode').addEventListener('input', () => {
  $('opCode').value = $('opCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
['opName', 'opCode'].forEach((id) => $(id).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') duelGo();
}));
document.querySelectorAll('#duelOverlay [data-close]').forEach((button) => {
  button.addEventListener('click', () => $('duelOverlay').classList.add('hidden'));
});

refreshDuelRejoin();

if (DUEL_REQUESTED) {
  const duelMode = await bootDuel();
  if (duelMode === 'play') {
    ladder = duelLadder(bank, duel.payload.q);
    $('dayBar').textContent = 'FRIEND CLIMB · SAME FIVE QUESTIONS';
    startGame();
  }
} else {
  ladder = dailyLadder(bank, today);
  if (state.results[today]) {
    // already played — hard block, straight to results
    showResults(state.results[today], false);
  } else if (state.progress && state.progress.date === today) {
    rungResults = state.progress.rungs;
    rungIndex = rungResults.length;
    startGame();
  }
}
