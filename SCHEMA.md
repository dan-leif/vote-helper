# Data schema

## `data/places.json`
```jsonc
{ "stateNames": { "ca": "California" },
  "places": [ { "state": "ca", "locality": "san-luis-obispo", "name": "San Luis Obispo County",
                "elections": [ { "date": "2026-11-03", "name": "General Election" } ] } ] }
```
The election file for each entry is `data/<state>/<locality>/<date>.json`.

## `data/<state>/state.json`
```jsonc
{
  "id": "ca", "name": "California", "abbr": "CA",
  "measures": { "has": true, "name": "Proposition", "short": "Prop", "citizenInitiatives": true, "note": "..." },
  "constitutionalNote": "Shown on measures with constitutional: true",
  "retention": { "has": true, "threshold": 0.5, "courts": ["..."], "note": "..." },
  "cycles": [ { "id": "general", "label": "General", "months": [11] } ],
  "primarySystem": "...", "partyLabel": "Party Preference", "parties": { "D": "Democratic" },
  "endorsers": [ { "id": "cadem", "name": "CA Democratic Party", "src": "cadem" } ], "endorserNote": "...",
  "lookup": { "label": "...", "url": "..." },
  "questions": [ /* state-wide Part 2 questions, e.g. the retention default (appliesToKind: "retention") */ ],
  "sources": { /* sources for endorsers and state facts */ }
}
```

## Election data file: `data/<state>/<locality>/<date>.json`
```jsonc
{
  "schema": 2, "state": "ca", "locality": "san-luis-obispo", "date": "2026-11-03", "cycle": "general",
  "name": "November 3, 2026 General Election", "area": "San Luis Obispo County, California",
  "researched": "2026-10-20", "method": "how facts were gathered",
  "include": ["statewide"],                       // other localities' files for the same date
  "districts": [ { "id": "cd", "label": "U.S. House district", "default": "24",
                   "options": [ { "v": "24", "l": "District 24", "covered": true },
                                { "v": "19", "l": "District 19", "covered": false, "missing": "U.S. House District 19" } ] } ],
  "districtHint": "...", "coverageNote": "...",
  "sections": [ ["State", "State offices"], ["City", "City of San Luis Obispo"], ["measure", "State propositions"] ],
  "questions": [ /* Part 2 questions for items in this file */ ],
  "sources": { "lao1": { "title": "...", "pub": "Legislative Analyst's Office", "short": "LAO", "url": "...", "type": "official|news|analysis|advocacy|opinion|endorser|campaign|reference" } },
  "contests": [ /* see below */ ]
}
```

A **claim** is `{ "t": "text", "s": ["sourceId", ...], "c": "h|m|l" }`.
`h` = official ballot or several sources agree. `m` = one reputable source. `l` = advocacy, opinion, thin or conflicting.

### Measure
```jsonc
{
  "id": "p1", "kind": "measure", "order": 101, "num": "1", "title": "Short plain title",
  "label": "Official ballot label", "type": "Initiative statute", "constitutional": false,
  "summary": [claim], "yes": "A Yes vote means…", "no": "A No vote means…",
  "fiscal": [claim], "pro": [claim], "con": [claim], "supporters": [claim],
  "endorse": { "positions": { "<endorser id from state.json>": "yes|no|neutral" }, "other": [{ "who": "...", "s": [] }] },
  "poll": claim,
  "tags": [ { "dim": "debt", "yes": -1, "w": 3, "why": "Yes means $11.25B of new borrowing.", "s": ["lao1"] } ],
  "specific": ["q_recall"],                // Part 2 questions for this item
  "quality": [ { "type": "title-mismatch", "sev": "high|med|low|info", "t": "specific problem", "s": [], "c": "m" } ],
  "qualityNote": "Shown when there are no quality flags",
  "related": ["p41"], "appliesTo": { "city": ["slo"] }, "conf": "h|m|l"
}
```
`tags[].yes` is the direction a **Yes** vote moves on that belief: `+1` toward side B, `−1` toward side A. `w` is 1–3.

### Candidate race
```jsonc
{
  "id": "gov", "kind": "race", "order": 10, "level": "State|Federal|Legislature|Judicial|School|City",
  "office": "Governor", "voteFor": 1, "nonpartisan": false, "unopposed": false,
  "instructions": "Shown above the choices (e.g. pick only one; top two win)", "sheetNote": "Shown on the cheat sheet",
  "about": [claim], "notes": [claim], "specific": ["q_..."], "flags": [{ "t": "...", "c": "l" }],
  "candidates": [ {
    "id": "becerra", "name": "...", "party": "D", "designation": "Ballot designation",
    "positions": [ { "dim": "tax_wealthy", "stance": -0.5, "t": "...", "s": [], "c": "m" } ],
    "notes": [claim], "endorse": [ { "who": "...", "s": [], "c": "m" } ]
  } ]
}
```
`stance` is −1 (side A) to +1 (side B); optional `w` (default 2).

### Retention (judges)
`{ "kind": "retention", "judges": [ { "id", "name", "role", "notes": [claim] } ], "specific": ["q_judicial"] }`

`voteFor` above 1 makes a multi-seat race: the match picks the top N and the voter can select up to N.

## `data/values.json`
- `general[]`: `{ id, label, q, a, b, weight?, tiebreaker? }`. `a` is side A (−2), `b` is side B (+2).

## Part 2 questions (in election files and `state.json`)
`{ id, for: [contestIds] | appliesToKind: "retention", q, options: [ { v, l, fx } ] }`. `fx` maps a contest id (or `"*<kind>"`, e.g. `"*retention"`) to a number −2…+2 (measures: + means Yes), or for races to `{ candidateId: number }`, or `"skip"`.

## Bias-check replies (browser only, exportable; no personal views)
```jsonc
{ "app": "vote-helper-audits", "audits": { "ca/san-luis-obispo/2026-11-03": { "p1": {
  "grok": { "date": "...", "verdict": "agree|minor|major|unparsed", "lean": "none|left|right|yes|no|unclear",
            "issues": [ { "area": "...", "severity": "minor|major", "detail": "...", "fix": "..." } ],
            "tags": [ { "dim": "housing", "agree": false, "direction": 1, "weight": 1, "note": "..." } ], "raw": "..." } } } } }
```
"Models disagree" shows when any model reports a major problem, sees a lean, disputes a belief mapping, or flags a major issue.

## Beliefs file (private; never commit publicly)
```jsonc
{
  "schema": 1, "app": "vote-helper", "created": "2026-10-20", "updated": "2026-10-20",
  "general":  { "debt": { "pos": 1, "imp": 2, "date": "2026-10-20", "note": "" } },
  "specific": { "q_recall": { "v": "same_ballot", "date": "2026-10-20", "election": "ca/san-luis-obispo/2026-11-03" } },
  "place": { "key": "ca/san-luis-obispo", "date": "2026-11-03" },
  "elections": { "ca/san-luis-obispo/2026-11-03": { "districts": { "cd": "24" }, "effort": "quick", "choices": { "p1": { "v": "yes", "date": "...", "suggested": "no", "agreed": false } }, "ai": {} } },
  "decisions": [ { "date": "...", "election": "...", "contest": "p1", "suggested": "no", "chose": "yes", "agreed": false, "reasonKey": "less:debt", "note": "...", "change": { "dim": "debt", "field": "imp", "from": 2, "to": 1 } } ],
  "history":   [ { "date": "...", "change": {}, "because": "Prop 1: ...", "note": "..." } ]
}
```
