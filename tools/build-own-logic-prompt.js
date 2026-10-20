// Run: node tools/build-own-logic-prompt.js
// Builds the "a model writes its own logic" prompt from the data files (official ballot text only).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'data') + '/';
const r = p => JSON.parse(fs.readFileSync(root + p));
const state = r('ca/state.json');
const sw = r('ca/statewide/2026-11-03.json'), lo = r('ca/san-luis-obispo/2026-11-03.json');
const contests = [...sw.contests, ...lo.contests].sort((a, b) => a.order - b.order);
const official = arr => (arr || []).filter(x => (x.s || []).includes('ballot')).map(x => x.t);
const party = c => state.parties[c] || c;
const items = contests.map(c => {
  if (c.kind === 'measure') return { id: c.id, kind: 'measure', number: 'Proposition ' + c.num, label: c.label, type: c.type, ballotText: c.ballotText ? c.ballotText.t : [...official(c.summary), ...official(c.fiscal), ...official(c.supporters)].join(' ') };
  if (c.kind === 'retention') return { id: c.id, kind: 'retention', office: c.office, judges: c.judges.map(j => j.name + ' (' + j.role + ')') };
  const o = { id: c.id, kind: 'race', office: c.office, voteFor: c.voteFor || 1, candidates: c.candidates.map(k => ({ id: k.id, name: k.name, party: k.party ? party(k.party) : undefined, ballotDesignation: k.designation })) };
  if (c.instructions) o.note = c.instructions;
  return o;
});
const prompt = `I'm building a free, nonpartisan ballot advisor. A voter answers a short set of values questions, and simple arithmetic matches their answers to each item on their ballot. I'd like you to design that logic yourself, from scratch, for the ballot below. Work only from your own judgment and research; don't base it on any other voter guide or AI tool. Don't tell anyone how to vote.

BALLOT: November 3, 2026 General Election, San Luis Obispo County, California (City of San Luis Obispo; U.S. House District 24; Assembly District 30). The items below are copied from the official ballot.

Please produce five things:

1. BELIEF QUESTIONS (about 12 to 20). Each is a values question a voter answers on a 5-point scale between two sides, A and B. Rules:
   - Each question should reflect a real disagreement among voters that this ballot turns on.
   - Write both sides so a person who holds that view would accept the wording. No straw men, no loaded words.
   - Keep them general enough to reuse in future elections (taxes, housing, elections, and so on), not about one measure.
   - Give each an id in snake_case. Mark "tiebreaker": true for any that should count only lightly (for example, experience vs. newcomers).

2. MAPPINGS for every ballot item:
   - Measures: which of your beliefs a YES vote moves. "yes": 1 means a Yes vote moves toward side B, -1 toward side A. "w" is how central that belief is to the measure, 1 (slightly) to 3 (central). Add a one-line "why".
   - Candidate races: for each candidate, a "stance" from -1 (side A) to 1 (side B) on beliefs where you know their record or stated positions, with a one-line reason and a source URL if you have one. Leave out what you don't know rather than guessing. Use party alone only for a party-lean belief, if you include one.
   - Judicial retention: say whether any justice has a specific, sourced reason for concern; otherwise say none found.

3. FOLLOW-UP QUESTIONS, only for items your belief questions don't settle. Each has 2 to 4 answer options, and each option says how it moves that item: a number from -2 (strongly toward No) to 2 (strongly toward Yes), or for races, toward a named candidate id.

4. DRAFTING OR POLICY-QUALITY PROBLEMS you know of for any measure (vague terms likely to be litigated, loopholes, a title that doesn't match the effect, measures that cancel each other). Each needs a specific problem and a source if you have one. Apply the same standard to measures favored by either side.

5. QUICK PICKS. Some voters will only answer 3 questions. Choose the 3 belief questions from your list that would do the most to sort out how a voter's values apply to this particular ballot, ranked 1 to 3, with a one-line reason each.

Before you answer, check your own work for balance: would a thoughtful voter on the left and one on the right both call your questions and mappings fair? Fix anything they wouldn't.

BALLOT ITEMS (JSON):
${JSON.stringify(items)}

Start your reply by stating which AI model you are (name and version, as specifically as you can), whether you used web search for this answer, and today's date. Then give a short note on your approach, then the result as JSON in exactly this shape:
\`\`\`json
{"voteHelperLogic": 1,
 "model": {"name": "<your model name>", "version": "<version, or unknown>", "maker": "<company>", "webSearch": true, "date": "YYYY-MM-DD"},
 "general": [{"id": "...", "label": "...", "q": "...", "a": "side A", "b": "side B", "tiebreaker": false}],
 "items": [{"id": "<item id>",
   "tags": [{"dim": "<belief id>", "yes": 1, "w": 2, "why": "..."}],
   "stances": [{"candidate": "<candidate id>", "dim": "<belief id>", "stance": -1, "why": "...", "source": "url or empty"}],
   "quality": [{"type": "...", "detail": "...", "source": "url or empty"}],
   "note": "only if needed, e.g. no concerns found for these judges"}],
 "specific": [{"id": "q_...", "for": ["<item id>"], "q": "...", "options": [{"l": "answer text", "fx": {"<item id>": 1}}]}],
 "quickPicks": [{"rank": 1, "id": "<belief id>", "why": "..."}, {"rank": 2, "id": "...", "why": "..."}, {"rank": 3, "id": "...", "why": "..."}]}
\`\`\`
Include every item id listed above. If your reply would get cut off, stop after a complete item, close the JSON, and write CONTINUE on the last line; when I reply "continue", send the remaining items in another JSON block of the same shape (repeat the "model" object; put "quickPicks" in the last block).`;
fs.writeFileSync(path.join(__dirname, '..', 'prompts', 'own-logic.txt'), prompt);
console.log('chars', prompt.length, '~tokens', Math.round(prompt.length / 3.6), 'items', items.length);
