// Sparse, opt-in WebAudio cues for a workday-friendly daily game.
const SOUND_KEY = 'trivia-ladder-sound';

let context = null;
let master = null;
let enabled = localStorage.getItem(SOUND_KEY) === 'on';

function audioContext() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.09;
    master.connect(context.destination);
  }
  return context;
}

async function unlock() {
  if (!enabled) return;
  const ctx = audioContext();
  if (ctx?.state === 'suspended') {
    try { await ctx.resume(); } catch { /* sound is an optional enhancement */ }
  }
}

function tone(frequency, delay, duration, volume, type = 'sine') {
  const ctx = audioContext();
  if (!enabled || !ctx || !master || ctx.state !== 'running') return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

function answer(correct) {
  if (!enabled) return;
  void unlock().then(() => {
    if (correct) {
      tone(523.25, 0, 0.12, 0.65, 'triangle');
      tone(659.25, 0.075, 0.16, 0.55, 'triangle');
    } else {
      tone(220, 0, 0.14, 0.35, 'sine');
    }
  });
}

function results(score) {
  if (!enabled) return;
  void unlock().then(() => {
    const notes = score >= 1100 ? [392, 523.25, 659.25] : [329.63, 392, 493.88];
    notes.forEach((note, index) => tone(note, index * 0.09, 0.24, 0.46, 'triangle'));
  });
}

function setEnabled(nextEnabled) {
  enabled = Boolean(nextEnabled);
  localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  if (enabled) void unlock();
  return enabled;
}

function isEnabled() {
  return enabled;
}

export const sound = { answer, results, unlock, setEnabled, isEnabled };
