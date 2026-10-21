# Vote Helper: maintainer guide

This is how to add a ballot and fill in both sets of logic: Vote Helper's own logic (written by Claude) and a second, independent logic written by another model (Grok so far). It's written for whoever maintains the data, including Claude Code sessions working in this repo.

## Ground rules

- **Judgments live in data files, never in code.** Summaries, pros and cons, belief questions, mappings, quality flags, section names, measure names, party names and voting instructions all come from `data/`. `test/engine.test.mjs` fails if place-specific text appears in `app.js` or `engine.js`.
- **Every claim cites a source** with a confidence level (`h`/`m`/`l`). See [RESEARCH.md](RESEARCH.md).
- **Keep models independent.** A prompt to another model never contains your beliefs, never names a model, and never contains another model's answers. The one exception is the critique prompt, which deliberately shows Vote Helper's own logic, and only that. Use a fresh private or incognito chat for every prompt.
- **Never commit a beliefs file** to this repo. People keep their own in the browser or in a private repo (see `private-template/`).

## Layout

```
data/places.json                                 the ballots in the app's single drop-down
data/values.json                                 Vote Helper's general belief questions (shared everywhere)
data/<state>/state.json                          state settings: measure names, retention, parties, endorsers
data/<state>/statewide/<date>.json               statewide contests, shared by every locality in the state
data/<state>/<locality>/<date>.json              local contests, districts, Part 2 questions, "include", "logics"
data/<state>/<locality>/<date>.logic.<model>.json   another model's own logic for that ballot
prompts/replies/<state>-<locality>-<date>/       raw replies from other models, and the prompts they saw
tools/                                           prompt builders and the logic importer
```

Formats are in [SCHEMA.md](SCHEMA.md).

## 1. Add a ballot

1. **Get the ballot.** Start from an official sample ballot (photo or PDF) for one ballot type. Transcribe every contest, candidate name, party, ballot designation and measure text exactly.
2. **State settings.** If the state is new, copy an existing `data/<state>/state.json` and fill it in (Wisconsin's shows a state with no retention votes and spring elections).
3. **Election files.** Put statewide contests in `data/<state>/statewide/<date>.json` and local ones in `data/<state>/<locality>/<date>.json` with `"include": ["statewide"]`. Give each measure a `ballotText` claim with the verbatim ballot text; the other models see only that.
4. **Districts.** List the local file's district choices under `districts`, and use `appliesTo` on contests that only some districts vote on.
5. **Make it pickable.** Add one entry to `data/places.json`: an `id`, a `label` for the drop-down, the state, locality and date, and the fixed `districts` for that ballot type.
6. **Check.** `node test/validate-data.mjs` and `node test/engine.test.mjs`.

## 2. Vote Helper's own logic (Claude's)

Research and tagging follow [RESEARCH.md](RESEARCH.md). In short, for each ballot:

- **Belief questions.** Reuse `data/values.json`. Add a general question only if the ballot turns on a disagreement none of the existing ones covers, and word it so it carries over to later elections. Mark light ones `tiebreaker` (counted at half weight).
- **Measures.** Add `tags`: which belief a Yes vote moves (`yes`: +1 toward side B, -1 toward side A), how centrally (`w` 1–3), a one-line `why`, and a source. Re-read each tag against the belief's A/B wording; a backwards sign is the most common mistake.
- **Candidates.** Add `positions` (`stance` -1…+1) only from a sourced record or statement. Use party only for the `party` belief.
- **Part 2 questions.** Where general beliefs don't settle an item, add a question to the election file's `questions` with each answer's effect (`fx`). The state's judicial-retention default lives in `state.json`.
- **Quality flags.** Each names a specific problem with a source, using the same standard for measures favored by either side.

The app works out Quick, Standard and Deep from these mappings; nothing extra is needed.

## 3. A second logic from another model (Grok)

1. **Build the prompt.** `node tools/build-own-logic-prompt.js <ballot-id>` writes `prompts/own-logic.txt`. It contains only the official ballot text and the rules; none of Vote Helper's logic.
2. **Ask the model.** Paste it into a new private chat (free Grok works). If the reply ends with CONTINUE, reply "continue" and keep every part. Save each reply to a file, either the JSON or the whole chat text.
3. **Import it.** `node tools/add-model-logic.js <ballot-id> grok "Grok" reply-1.txt` writes the logic file, adds it to the election's `logics` list so the app loads it, copies the raw reply to `prompts/replies/`, and prints a review sheet.
4. **Review it.** The sheet lists mechanical problems: undefined questions, unknown candidates, unused questions, missing source links, same-party candidates scored differently, and races matched on party alone. It also prints every mapping next to the side its number points to. Read each one: does the model's own "why" agree with that side?
5. **Send one follow-up.** In the same chat, list only internal contradictions and breaks of the prompt's own rules, quoting the model's own text. Don't add your own opinions, Vote Helper's logic, or other models' answers. Ask for corrected items plus a `changes` list. See `prompts/replies/ca-san-luis-obispo-2026-11-03/` for the Grok example.
6. **Merge the corrections.** Run `node tools/add-model-logic.js <ballot-id> grok "Grok" reply-2.txt`; it merges into the existing file and logs the changes under `revisions`.
7. **Don't fix the model's judgments yourself.** If its logic still disagrees with Vote Helper's after its own corrections, leave it. Showing that disagreement is the point.
8. **Check and commit.** `node test/validate-data.mjs`, `node test/engine.test.mjs`.

Other models work the same way: use a different `<model-id>` and label (for example `chatgpt "ChatGPT"`).

## 4. Another model critiques Vote Helper's logic

1. **Build the prompt.** `node tools/build-critique-prompt.js <ballot-id>` writes `prompts/critique-<ballot-id>.txt`, plus two self-contained halves (`.part1-of-2`, `.part2-of-2`) for chat apps that reject long messages. It describes Vote Helper's belief questions, mappings, follow-ups, Quick picks and quality flags, with the rules they were written under, and asks for the same checks used on other models' logic.
2. **Ask the model.** Use a new private chat. If the full prompt is too long, send each half in its own new chat.
3. **Save the reply** to `prompts/replies/<state>-<locality>-<date>/<model>-critique-<n>.txt`.
4. **Weigh each issue** against the sources. Apply the ones that hold up to the data files (re-checking any fact it raises), and leave the rest.
5. **Record the decisions** in `prompts/replies/<state>-<locality>-<date>/critique-decisions.md`: issue, accepted or not, and why.
6. **Check and commit.**

## Commands

```
python3 -m http.server 8000                          # run the app at http://localhost:8000
node test/engine.test.mjs                            # scoring and logic tests
node test/validate-data.mjs                          # every claim sourced, ids resolve, ballots valid
node tools/build-own-logic-prompt.js [ballot-id]     # prompt for another model's own logic
node tools/add-model-logic.js <ballot-id> <model-id> "<Label>" <reply files...>
node tools/build-critique-prompt.js [ballot-id]      # prompt for a critique of Vote Helper's logic
```
