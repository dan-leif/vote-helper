# Vote Helper

A personal ballot advisor for California elections. It explains every item on your ballot, shows how your own beliefs map onto it, lets you agree or disagree, learns from your disagreements, and ends with a ballot cheat sheet.

It's a static page plus JSON data files. Host it anywhere (GitHub Pages works). **Your beliefs stay in your browser** (localStorage). You can export them to a `beliefs.json` file and keep that file somewhere private; it never belongs in a public repo.

Places are data, not code: pick a place and an election, and the app loads that place's files. First place covered: **San Luis Obispo County, CA, November 3, 2026 General Election** (statewide contests plus CA-24, AD-30, Court of Appeal Second District, BOE District 2 and City of San Luis Obispo). State settings for Indiana, Illinois and Wisconsin are in place for future elections.

## How it works

1. **Research** (done ahead of time, per election). Each contest in `data/<state>/<locality>/<date>.json` has what it does, Yes/No meaning, fiscal impact, pros and cons, endorsements, and drafting-quality flags. Every claim cites a source and has a confidence level (`h`/`m`/`l`). During research each contest is also *tagged* with the beliefs it touches and which way a Yes vote points. See [RESEARCH.md](RESEARCH.md).
2. **Beliefs.** `data/values.json` holds Part 1 (general values that carry across places and elections). Part 2 questions (asked only when a contest doesn't map cleanly onto general values) live in each election file, and a state's judicial-retention default lives in its `state.json`. Answers are dated.
3. **Matching** is deterministic arithmetic in `engine.js`: position (−2…+2) × tag direction × tag weight × importance. No AI call, no API key, nothing sent anywhere. Items where your beliefs pull both ways with similar weight are flagged as conflicts.
4. **Effort levels.** *Quick* asks only the ~3 questions that change the most suggestions on this ballot, then shows the full slate with the 2–3 conflicts worth a closer look. *Standard* asks more and walks through the close calls. *Deep* asks everything and walks through every contest.
5. **Learning.** When you pick differently from your match, you choose a reason ("this matters less to me", "my view is different", "special case", "drafting concern"…). The page shows the profile change, applies it, and keeps a dated history.
6. **Optional AI.** "Ask your AI" builds a prompt with your beliefs and the sourced data to paste into your own assistant (Claude, Claude Code, etc.). Paste its reply back to attach notes and review suggested profile changes. The page never calls an AI itself.

7. **Cross-model bias check.** Every judgment (summaries, pros and cons, belief tags, quality flags) is written by Claude and stored in the data files, never in code. On each item, "Bias check by other AI models" copies an audit prompt (the entry only, never your beliefs) to paste into free ChatGPT, Grok or Gemini. Paste the reply back; it's saved per item and per model. Items where a model disputes a mapping, sees a lean, or reports a major problem are flagged **Models disagree**. Export the replies (My beliefs → Export or import) so the data can be fixed.

Drafting and policy quality is shown separately from the values match, so you can see "matches your values, but poorly drafted."

## Run it locally

```
python3 -m http.server 8000     # then open http://localhost:8000
node test/engine.test.mjs       # scoring checks
node test/validate-data.mjs     # every claim cites a known source
```

Opening `index.html` straight from disk won't work, because browsers block `fetch` of local files.

## Data layout

```
data/
  places.json                          registry: which places and election dates exist
  values.json                          Part 1 belief questions (shared everywhere)
  ca/state.json                        California settings: measures, retention, parties, endorsers, cycles
  ca/statewide/2026-11-03.json         statewide contests, shared by every CA county
  ca/san-luis-obispo/2026-11-03.json   local contests + "include": ["statewide"]
  in/state.json  il/state.json  wi/state.json   settings ready for future places
```

## Add a place or election (data files only)

1. If the state is new, add `data/<state>/state.json` (copy one of the existing ones; Wisconsin shows a state without retention votes and with spring elections).
2. Add `data/<state>/<locality>/<date>.json`. To reuse statewide contests, put them in `data/<state>/statewide/<date>.json` and add `"include": ["statewide"]`.
3. Add the place and date to `data/places.json`.
4. Follow [RESEARCH.md](RESEARCH.md) and [SCHEMA.md](SCHEMA.md). Run `node test/validate-data.mjs`.

No code changes are needed: section names, measure names ("Proposition", "Public Question"), party names, endorsers, retention thresholds (Illinois needs 60%), district choices, special voting instructions and multi-seat races ("Vote for 3") all come from the data.

Answers already given carry over, so later elections need fewer questions.

## Keeping your beliefs private

- In the app: **My beliefs → Export or import**. Copy or download `beliefs.json`.
- Store it in a **private** repo. `private-template/` has a README and a CLAUDE.md for that repo, so you can also do a walkthrough by chatting with Claude Code there.
- `.gitignore` here blocks `beliefs*.json` as a backstop.

## Not advice

Vote Helper isn't affiliated with any campaign, party or election office. Check facts against your official voter guide and sample ballot.

## Credits

Approach informed by [la-ballot-match](https://github.com/bretmorris/la-ballot-match) (issue dimensions, evidence rules) and [ballot-fit](https://github.com/arunash/ballot-fit) (static, dependency-free, readable rules). Both are MIT-licensed. No code was copied; the 2026 data here was researched separately.
