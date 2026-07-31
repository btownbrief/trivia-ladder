# Local Trivia Ladder — agent instructions

Shared guidance for any AI agent working in this repo.

## What this is

Btown's daily five-question Burlington and Vermont trivia climb. It is a plain
static site with no build step: `index.html`, `style.css`, ES modules in `js/`,
and the question bank in `data/questions.json`.

## Rules that matter

- `js/questions.js` owns deterministic question selection. The daily ladder is
  a pure function of its date; a duel ladder is pinned by five bank indices in
  the room payload. Never make either depend on local time after its input is
  chosen.
- Daily play is one shot. Test dates and friend duels must never write daily
  progress, results, streaks, leaderboard identity, or leaderboard scores.
- The monthly leaderboard is higher-score-wins and uses the shared Btown
  Supabase project. Never ship a service-role key or other secret in client JS.

## Friend duels

The ⚔️ mode is an asynchronous duel: two phones independently climb the same
explicitly pinned ladder and submit one write-once `{score, ms}` result. Higher
score wins, then lower elapsed time; an explicit forfeit loses.

`js/duel.js` is vendored byte-for-byte from
`maple-scramble/js/duel.js`. `js/rooms.js` and
`scripts/rooms-shim.mjs` are vendored byte-for-byte from
`four-in-a-rowboat`; change their canonical copies and re-vendor rather than
editing them here.

## Before you finish

Run `node scripts/test-duel.mjs` for changes to duel wiring, room integration,
question seeding, or duel result rules. Run `node --check` on every touched
JavaScript file. For UI changes, verify the daily and duel paths at a
phone-sized viewport and report what you checked.
