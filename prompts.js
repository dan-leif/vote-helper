/* Builds the "own logic" prompt: asks an AI model to design its own belief questions and
   mappings for a ballot, from the official ballot text only. Used by the app and by
   tools/build-own-logic-prompt.js. Works in the browser (window.VHPrompts) and Node. */
(function (root) {
  'use strict';
  function ballotItems(contests, state) {
    var official = function (arr) { return (arr || []).filter(function (x) { return (x.s || []).indexOf('ballot') >= 0; }).map(function (x) { return x.t; }); };
    var party = function (c) { return (state.parties && state.parties[c]) || c; };
    var measureName = (state.measures && state.measures.name) || 'Measure';
    return contests.slice().sort(function (a, b) { return a.order - b.order; }).map(function (c) {
      if (c.kind === 'measure') return { id: c.id, kind: 'measure', number: measureName + ' ' + c.num, label: c.label, type: c.type,
        ballotText: c.ballotText ? c.ballotText.t : official(c.summary).concat(official(c.fiscal), official(c.supporters)).join(' ') };
      if (c.kind === 'retention') return { id: c.id, kind: 'retention', office: c.office, judges: (c.judges || []).map(function (j) { return j.name + ' (' + j.role + ')'; }) };
      var o = { id: c.id, kind: 'race', office: c.office, voteFor: c.voteFor || 1, candidates: (c.candidates || []).map(function (k) { return { id: k.id, name: k.name, party: k.party ? party(k.party) : undefined, ballotDesignation: k.designation }; }) };
      if (c.instructions) o.note = c.instructions;
      return o;
    });
  }
  // o: { contests, state, election, districts: { id: value } }
  function buildOwnLogicPrompt(o) {
    var items = ballotItems(o.contests, o.state);
    var where = (o.election.districts || []).map(function (d) {
      var v = o.districts && o.districts[d.id] != null ? o.districts[d.id] : d.default;
      var opt = (d.options || []).filter(function (x) { return x.v === v; })[0];
      return opt ? d.label + ': ' + opt.l : null;
    }).filter(Boolean).join('; ');
    return `I'm building a free, nonpartisan ballot advisor. A voter answers a short set of values questions, and simple arithmetic matches their answers to each item on their ballot. I'd like you to design that logic yourself, from scratch, for the ballot below. Work only from your own judgment and research; don't base it on any other voter guide or AI tool. Don't tell anyone how to vote.

BALLOT: ${o.election.name}, ${o.election.area}${where ? ' (' + where + ')' : ''}. The items below are copied from the official ballot.

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

Use web search for candidate positions, any concerns about specific judges, and drafting problems, since these races and measures may be newer than your training data. Cite what you find. If you can't search in this chat, say so at the top of your reply and leave those parts blank rather than relying on memory.

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
  }
  var api = { buildOwnLogicPrompt: buildOwnLogicPrompt, ballotItems: ballotItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VHPrompts = api;
})(typeof window !== 'undefined' ? window : this);
