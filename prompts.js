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

  // o: { contests, state, election, districts, values, sources, quickPicks }
  // Asks a model to critique Vote Helper's own logic, checking it the same way Vote Helper checks
  // another model's: direction vs. reasoning, rule adherence, weights, coverage, wording balance, sources.
  // o.part = { index, total, items: [contest ids] } builds one self-contained part of a split prompt.
  function buildCritiquePrompt(o) {
    // Sources are listed once and referred to by short ids to keep the prompt small.
    var srcTable = {}, srcIds = {}, n = 0;
    var url = function (ids) { return (ids || []).map(function (id) {
      var s = o.sources[id]; if (!s) return null;
      if (!srcIds[s.url]) { srcIds[s.url] = 'S' + (++n); srcTable[srcIds[s.url]] = s.type === 'model' ? 'the logic written by system ' + L(modelOf(id)) + ' (not a published source)' : s.url; }
      return srcIds[s.url];
    }).filter(Boolean); };
    var pick = o.part ? o.part.items : null;
    // Authors are named only by number: system 1 wrote the original logic, systems 2, 3, … were merged in.
    var letters = {}; letters[(o.author && o.author.id) || 'author'] = '1';
    (o.merges || []).forEach(function (m, i) { letters[m.model] = String(i + 2); });
    var L = function (id) { return letters[id] || id; };
    var modelOf = function (srcId) { var m = /^model_([^_]+)/.exec(srcId); return m ? m[1] : ''; };
    // Merge notes were written with model and app names; refer to the systems only by letter.
    var anon = function (text, from) {
      var out = String(text || '');
      (o.merges || []).forEach(function (m) { out = out.replace(new RegExp(m.label + '\'s', 'g'), 'system ' + L(m.model) + '\'s').replace(new RegExp(m.label, 'g'), 'system ' + L(m.model)); });
      return out.replace(/Vote Helper's/g, 'system 1\'s').replace(/Vote Helper/g, 'system 1');
    };
    var prov = function (x, out, fields) {
      out.by = (x.by || [(o.author && o.author.id) || 'author']).map(L);
      if (x.disputed) {
        out.disputed = true;
        out.views = {};
        Object.keys(x.views || {}).forEach(function (m) { var v = {}; fields.forEach(function (f) { if (x.views[m][f] !== undefined) v[f] = x.views[m][f]; }); out.views[L(m)] = v; });
      }
      return out;
    };
    var items = ballotItems(o.contests.filter(function (c) { return !pick || pick.indexOf(c.id) >= 0; }), o.state).map(function (it) {
      var c = o.contests.filter(function (x) { return x.id === it.id; })[0];
      if (c.kind === 'measure') {
        it.mappings = (c.tags || []).map(function (t) { return prov(t, { belief: t.dim, yes: t.yes, w: t.w, why: t.why, sources: url(t.s) }, ['yes', 'w', 'why']); });
        it.qualityFlags = (c.quality || []).map(function (q) { return prov(q, { type: q.type, severity: q.sev, detail: q.t, sources: url(q.s) }, []); });
        if (c.constitutional) it.constitutional = true;
      } else if (c.kind === 'race') {
        it.candidates.forEach(function (k) {
          var cand = (c.candidates || []).filter(function (x) { return x.id === k.id; })[0] || {};
          k.stances = (cand.positions || []).map(function (p) { return prov(p, { belief: p.dim, stance: p.stance, why: p.t, sources: url(p.s) }, ['stance', 't']); });
        });
      }
      var qs = o.values.specific.filter(function (q) { return (q.for || []).indexOf(c.id) >= 0 || q.appliesToKind === c.kind; });
      if (qs.length) it.followUpQuestions = qs.map(function (q) { return q.id; });
      return it;
    });
    var beliefs = o.values.general.map(function (d) {
      var b = { id: d.id, label: d.label, q: d.q, a: d.a, b: d.b, by: (d.by || [(o.author && o.author.id) || 'author']).map(L) };
      if (d.tiebreaker) b.tiebreaker = true;
      if (d.before) b.wordingBeforeMerge = d.before;
      return b;
    });
    var followUps = o.values.specific.filter(function (q) { return items.some(function (it) { return (it.followUpQuestions || []).indexOf(q.id) >= 0; }); }).map(function (q) {
      return { id: q.id, q: q.q, options: q.options.map(function (op) {
        var fx = {};
        Object.keys(op.fx || {}).forEach(function (k) { fx[k === '*retention' ? 'every judicial retention item' : k] = op.fx[k]; });
        return { answer: op.l, moves: fx };
      }) };
    });
    var where = (o.election.districts || []).map(function (d) {
      var v = o.districts && o.districts[d.id] != null ? o.districts[d.id] : d.default;
      var opt = (d.options || []).filter(function (x) { return x.v === v; })[0];
      return opt ? d.label + ': ' + opt.l : null;
    }).filter(Boolean).join('; ');
    // How each merged logic's questions, follow-ups and quality flags were handled.
    var mergeNotes = (o.merges || []).map(function (m) {
      var qs = {}; (m.logic.general || []).forEach(function (d) { qs[d.id] = d; });
      return { from: L(m.model),
        questions: Object.keys(m.record.questions || {}).map(function (id) {
          var r = m.record.questions[id], d = qs[id] || {};
          var result = r.drop ? 'left out' : r.toSpecific ? 'same as follow-up question ' + r.toSpecific : r.new ? 'added as new question ' + r.to : 'matched to ' + r.to + (r.orient < 0 ? ' (sides swapped)' : '') + (r.reword ? ', and ' + r.to + ' reworded' : '');
          return { question: id, label: d.label, q: d.q, a: d.a, b: d.b, result: result, why: anon(r.why) };
        }),
        followUps: Object.keys(m.record.specific || {}).map(function (id) { var r = m.record.specific[id]; return { question: id, result: r.keep ? 'kept' : 'left out', why: anon(r.why) }; }),
        rule: anon(m.record.stances && m.record.stances.why)
      };
    });
    var merged = mergeNotes.length > 0;
    return [
      'I\'m testing a free, nonpartisan ballot advisor for mistakes and bias. A voter answers values questions on a 5-point scale between two sides, A and B, and simple arithmetic matches the answers to each item on their ballot. ' + (merged ? 'The logic below was written independently by ' + (mergeNotes.length + 1) + ' AI systems, labeled 1' + mergeNotes.map(function (m) { return ' and ' + m.from; }).join('') + ', and then merged into one set. "by" lists which system(s) made each question or mapping (system 1 wrote it from research; the others worked only from the official ballot text, without seeing system 1\'s work). Where they pointed in opposite directions, the mapping is marked "disputed", shows both views, and counts for nothing.' : 'The logic below was written by another AI system.') + ' Please critique it carefully and specifically. Work from your own judgment and research; don\'t rely on any other review of this guide. Don\'t tell anyone how to vote.',
      '',
      'BALLOT: ' + o.election.name + ', ' + o.election.area + (where ? ' (' + where + ')' : '') + '.' +
        (o.part ? ' This is part ' + o.part.index + ' of ' + o.part.total + ' of the ballot; review only the items included here, plus the belief and follow-up questions.' : ''),
      '',
      'HOW THE LOGIC WORKS',
      '- BELIEFS: each has side A and side B. A voter answers from -2 (strongly A) to +2 (strongly B) and says how much it matters. Beliefs marked "tiebreaker" count half as much.',
      '- MEASURES: each mapping says which belief a YES vote moves. "yes": 1 means a Yes vote moves toward side B, -1 toward side A. "w" is how central the belief is to the measure, 1 (slightly) to 3 (central). "why" is the reasoning.',
      '- CANDIDATES: each stance runs from -1 (side A) to 1 (side B), based on the candidate\'s record or stated positions, with sources.',
      '- FOLLOW-UP QUESTIONS are asked only where the beliefs don\'t settle an item. Each answer moves an item: a number from -2 (toward No) to 2 (toward Yes), or toward a named candidate.',
      '- QUICK MODE asks only 3 belief questions. These are chosen automatically as the ones that change the most suggestions on this ballot: ' + (o.quickPicks || []).join(', ') + '.',
      '- QUALITY FLAGS describe drafting or policy-quality problems. They are shown separately and don\'t change the match.',
      '',
      'THE RULES IT WAS SUPPOSED TO FOLLOW',
      '- Belief questions reflect real disagreements this ballot turns on, are worded so a person on each side would accept their side\'s wording (no straw men, no loaded words), and are general enough to reuse in future elections.',
      '- Candidate stances come from a candidate\'s record or stated positions, with a source. Unknown positions are left out rather than guessed. Party alone is used only for the party-lean belief.',
      '- Every quality flag names a specific problem with a source, and the same standard applies to measures favored by either side.',
      '',
      'PLEASE CHECK',
      '1. Direction: for every mapping and stance, does the "why" agree with the side the number points to, using that belief\'s own A/B definitions? List every case where they contradict.',
      '2. Rules: stances based only on party, stances without a real record or source, different values for candidates with no sourced difference.',
      '3. Weights: mappings that are much too strong or too weak, and important mappings that are missing.',
      '4. Coverage: beliefs this ballot needs that are missing, beliefs that are defined but barely used, items or candidates that end up matched on party alone or not at all.',
      '5. Wording: any belief question or side that is slanted, a straw man, or lumps together views that don\'t belong together.',
      '6. Follow-up questions: are the options balanced, and does each answer move the item the right way?',
      '7. Quick mode: are those 3 the best questions for sorting this particular ballot? If not, which 3?',
      '8. Quality flags: unsupported, one-sided or missing ones.',
      (merged ? '10. The merge: were the questions matched correctly (right question, right way round)? Should anything left out have been kept? For each disputed mapping, which reading is right, and why?\n' : '') +
      '9. Facts: anything wrong or out of date. Use web search to check candidate positions and sources, and cite what you find. If you can\'t search in this chat, say so at the top of your reply.',
      'Be specific. If something is fine, say so briefly instead of rewriting it.',
      '',
      (merged ? 'HOW THE LOGICS WERE MERGED (JSON):\n' + JSON.stringify(mergeNotes) + '\n\n' : '') +
      'BELIEF QUESTIONS (JSON):',
      JSON.stringify(beliefs),
      '',
      'FOLLOW-UP QUESTIONS (JSON):',
      JSON.stringify(followUps),
      '',
      'BALLOT ITEMS WITH THEIR MAPPINGS (JSON; ballot text copied from the official ballot; "sources" refer to the SOURCES list):',
      JSON.stringify(items),
      '',
      'SOURCES (JSON):',
      JSON.stringify(srcTable),
      '',
      'Start your reply by stating which AI model you are (name and version, as specifically as you can), whether you used web search, and today\'s date. Then give a short overall assessment, then the result as JSON in exactly this shape:',
      '```json',
      '{"voteHelperCritique": 1,',
      ' "model": {"name": "<your model name>", "version": "<version, or unknown>", "maker": "<company>", "webSearch": true, "date": "YYYY-MM-DD"},',
      ' "overall": "fair | minor problems | major problems",',
      ' "issues": [{"item": "<item id, or empty for a belief question>", "belief": "<belief id>", "candidate": "<candidate id, or empty>", "kind": "direction | rule | weight | missing-mapping | coverage | wording | follow-up | quick-mode | quality-flag | fact | merge | dispute | other", "severity": "minor | major", "current": "what it says now", "suggested": "what it should say", "reason": "...", "source": "url or empty"}],',
      ' "missingBeliefs": [{"label": "...", "a": "side A", "b": "side B", "why": "..."}],',
      ' "quickPicks": [{"rank": 1, "id": "<belief id>", "why": "..."}]}',
      '```',
      'If your reply would get cut off, stop after a complete issue, close the JSON, and write CONTINUE on the last line; when I reply "continue", send the remaining issues in another JSON block of the same shape.'
    ].join('\n');
  }
  var api = { buildOwnLogicPrompt: buildOwnLogicPrompt, buildCritiquePrompt: buildCritiquePrompt, ballotItems: ballotItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VHPrompts = api;
})(typeof window !== 'undefined' ? window : this);
