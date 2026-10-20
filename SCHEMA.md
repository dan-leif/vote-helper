# Data schema

## `elections/index.json`
```jsonc
{ "elections": [ {
  "id": "2026-11-ca-slo", "name": "...", "area": "...", "date": "2026-11-03", "researched": "2026-10-20",
  "files": ["elections/2026-11/ca.json", "elections/2026-11/ca-slo.json"],
  "lookup": { "label": "...", "url": "..." },
  "districts": [ { "id": "cd", "label": "U.S. House district", "default": "24", "options": [ { "v": "24", "l": "District 24" } ] } ],
  "coverageNote": "What is and isn't covered"
} ] }
```

## Election data file
```jsonc
{
  "id": "2026-11/ca", "scope": "...", "election": "2026-11-03", "researched": "2026-10-20", "method": "how facts were gathered",
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
  "endorse": { "cadem": "yes|no|neutral", "cagop": "...", "lwvc": "...", "other": [{ "who": "...", "s": [] }] },
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

## `values.json`
- `general[]`: `{ id, label, q, a, b, weight?, tiebreaker? }`. `a` is side A (−2), `b` is side B (+2).
- `specific[]`: `{ id, for: [contestIds], q, options: [ { v, l, fx } ] }`. `fx` maps a contest id to a number −2…+2 (measures: + means Yes) or, for races, `{ candidateId: number }`, or `"skip"`.

## Beliefs file (private; never commit publicly)
```jsonc
{
  "schema": 1, "app": "vote-helper", "created": "2026-10-20", "updated": "2026-10-20",
  "general":  { "debt": { "pos": 1, "imp": 2, "date": "2026-10-20", "note": "" } },
  "specific": { "q_recall": { "v": "same_ballot", "date": "2026-10-20", "election": "2026-11-ca-slo" } },
  "elections": { "2026-11-ca-slo": { "districts": { "cd": "24" }, "effort": "quick", "choices": { "p1": { "v": "yes", "date": "...", "suggested": "no", "agreed": false } }, "ai": {} } },
  "decisions": [ { "date": "...", "election": "...", "contest": "p1", "suggested": "no", "chose": "yes", "agreed": false, "reasonKey": "less:debt", "note": "...", "change": { "dim": "debt", "field": "imp", "from": 2, "to": 1 } } ],
  "history":   [ { "date": "...", "change": {}, "because": "Prop 1: ...", "note": "..." } ]
}
```
