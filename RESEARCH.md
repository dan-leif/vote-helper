# Research checklist (per election)

Research is done ahead of time, typically by an AI research assistant (e.g. Claude Code) following this list. The page never researches at runtime. Start by reading the state's `data/<state>/state.json`: it says whether the state has ballot measures, what they're called, and whether judges face retention votes.

## 1. Get the exact ballot
- Start from an official sample ballot for the target ballot type (photo or PDF). Transcribe every contest, candidate name, ballot designation, party preference and proposition label exactly.
- Note "Vote for One / Two", write-in lines, and any local rule changes (e.g. SLO council: vote for one, top two win).

## 2. Official sources first
- **Propositions:** Secretary of State voter guide (`voterguide.sos.ca.gov`), LAO analyses (`lao.ca.gov/BallotAnalysis`), the ballot label's fiscal summary and supporter/opponent list.
- **Candidates:** county Clerk-Recorder certified list, SOS results pages, candidate statements.
- **Local measures:** county counsel impartial analysis, city/county staff reports.

## 3. Balanced perspectives
- Pros and cons from both official arguments, plus reputable nonpartisan explainers (CalMatters, LAist, KQED, KPBS, local papers).
- Endorsements: both state parties, League of Women Voters, plus major local endorsers. Record each as yes/no/neutral with a source.
- Treat both sides with equal effort. If one side has no findable argument, say so; don't pad.

## 4. Cite and grade every claim
- Each claim gets `s` (source ids) and `c` (`h`/`m`/`l`).
- Mark opinion, advocacy and campaign sources as such in `sources[].type`, and grade claims resting only on them `l`.
- Record how sources were reached in the file's `method` (e.g. "via search summaries; pages not opened in full").

## 5. Tag beliefs (for deterministic scoring)
For each measure, add `tags`: which general beliefs a Yes vote moves and which way, weight 1–3, a one-line `why`, and a source. For candidates, add `positions` with `stance` −1…+1 only where a sourced statement, vote or action supports it.
- If a measure doesn't map cleanly onto general beliefs, add a Part 2 question to `values.json` and list it in `specific`.
- Don't tag a belief from a party label alone except for the `party` belief itself.

## 6. Drafting and policy quality (separate from values)
Check each measure against the same list, whichever side it favors:
- LAO fiscal concerns or large uncertainty
- Constitutional lock-in (`constitutional: true` adds a standard note)
- Vague terms likely to be litigated or delegated
- Loopholes or narrow beneficiaries
- Title or label that doesn't match the effect
- Conflicting or "poison pill" measures on the same ballot
- One-sided official record (no argument filed)

Every flag must name a specific problem and cite a source. No "experts dislike it."

## 7. Merge with another model, then cross-check
Get another model's independent logic for the ballot, merge it into Vote Helper's, and have that model critique the merged result. Steps are in [CLAUDE.md](CLAUDE.md), sections 3 to 5. Keep judgments in the data files; never encode them in code.

## 8. Validate
`node test/validate-data.mjs` checks that every claim cites a known source and every tag uses a known belief.
