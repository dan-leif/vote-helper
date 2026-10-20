# Vote Helper

A personal ballot advisor for California elections. It explains every item on your ballot, shows how your own beliefs map onto it, lets you agree or disagree, learns from your disagreements, and ends with a ballot cheat sheet.

It's a static page plus JSON data files. Host it anywhere (GitHub Pages works). **Your beliefs stay in your browser** (localStorage). You can export them to a `beliefs.json` file and keep that file somewhere private; it never belongs in a public repo.

First election covered: **November 3, 2026 General Election, San Luis Obispo County** (statewide contests plus CA-24, AD-30, Court of Appeal Second District, BOE District 2 and City of San Luis Obispo).

## How it works

1. **Research** (done ahead of time, per election). Each contest in `elections/<yyyy-mm>/*.json` has what it does, Yes/No meaning, fiscal impact, pros and cons, endorsements, and drafting-quality flags. Every claim cites a source and has a confidence level (`h`/`m`/`l`). During research each contest is also *tagged* with the beliefs it touches and which way a Yes vote points. See [RESEARCH.md](RESEARCH.md).
2. **Beliefs.** `values.json` holds Part 1 (general values that carry across elections) and Part 2 (specific questions asked only when a contest doesn't map cleanly onto general values). Answers are dated.
3. **Matching** is deterministic arithmetic in `engine.js`: position (−2…+2) × tag direction × tag weight × importance. No AI call, no API key, nothing sent anywhere. Items where your beliefs pull both ways with similar weight are flagged as conflicts.
4. **Effort levels.** *Quick* asks only the ~3 questions that change the most suggestions on this ballot, then shows the full slate with the 2–3 conflicts worth a closer look. *Standard* asks more and walks through the close calls. *Deep* asks everything and walks through every contest.
5. **Learning.** When you pick differently from your match, you choose a reason ("this matters less to me", "my view is different", "special case", "drafting concern"…). The page shows the profile change, applies it, and keeps a dated history.
6. **Optional AI.** "Ask your AI" builds a prompt with your beliefs and the sourced data to paste into your own assistant (Claude, Claude Code, etc.). Paste its reply back to attach notes and review suggested profile changes. The page never calls an AI itself.

Drafting and policy quality is shown separately from the values match, so you can see "matches your values, but poorly drafted."

## Run it locally

```
python3 -m http.server 8000     # then open http://localhost:8000
node test/engine.test.mjs       # scoring checks
node test/validate-data.mjs     # every claim cites a known source
```

Opening `index.html` straight from disk won't work, because browsers block `fetch` of local files.

## Add an election

1. Create `elections/<yyyy-mm>/` with one file per jurisdiction (e.g. `ca.json` for statewide, `ca-slo.json` for local). Statewide files can be reused by any county.
2. Add an entry to `elections/index.json` listing the files and the district choices.
3. Follow [RESEARCH.md](RESEARCH.md) and [SCHEMA.md](SCHEMA.md). Run `node test/validate-data.mjs`.

Answers already given carry over, so later elections need fewer questions.

## Keeping your beliefs private

- In the app: **My beliefs → Export or import**. Copy or download `beliefs.json`.
- Store it in a **private** repo. `private-template/` has a README and a CLAUDE.md for that repo, so you can also do a walkthrough by chatting with Claude Code there.
- `.gitignore` here blocks `beliefs*.json` as a backstop.

## Not advice

Vote Helper isn't affiliated with any campaign, party or election office. Check facts against your official voter guide and sample ballot.

## Credits

Approach informed by [la-ballot-match](https://github.com/bretmorris/la-ballot-match) (issue dimensions, evidence rules) and [ballot-fit](https://github.com/arunash/ballot-fit) (static, dependency-free, readable rules). Both are MIT-licensed. No code was copied; the 2026 data here was researched separately.
