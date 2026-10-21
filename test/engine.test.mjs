// Run: node test/engine.test.mjs
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const E = require('../engine.js');
const read = p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
const state = read('data/ca/state.json');
const sw = read('data/ca/statewide/2026-11-03.json');
const lo = read('data/ca/san-luis-obispo/2026-11-03.json');
const values = { general: read('data/values.json').general, specific: [...state.questions, ...sw.questions, ...lo.questions] };
const contests = [...sw.contests, ...lo.contests];
const byId = id => contests.find(c => c.id === id);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.error('FAIL', msg); } else console.log('ok  ', msg); };

const empty = { general: {}, specific: {} };
ok(E.score(byId('p1'), empty, values).label === 'none', 'no beliefs -> not enough info');
const debtHawk = { general: { debt: { pos: 2, imp: 3 } }, specific: {} };
ok(E.score(byId('p1'), debtHawk, values).pick === 'no', 'debt hawk -> No on housing bond');
ok(E.score(byId('p38'), debtHawk, values).pick === 'no', 'debt hawk -> No on research bond');
const conflicted = { general: { debt: { pos: 2, imp: 2 }, housing: { pos: 2, imp: 3 } }, specific: {} };
ok(E.score(byId('p1'), conflicted, values).conflict === true, 'debt-averse housing booster -> conflict on Prop 1');
const taxRich = { general: { tax_wealthy: { pos: -2, imp: 3 } }, specific: {} };
ok(E.score(byId('p3'), taxRich, values).pick === 'yes', 'tax the rich -> Yes on 3');
ok(E.score(byId('p42'), taxRich, values).pick === 'no', 'tax the rich -> No on 42');
ok(E.score(byId('gov'), { general: { party: { pos: -2, imp: 2 } }, specific: {} }, values).pick === 'becerra', 'Dem lean -> Becerra');
ok(E.score(byId('ad30'), { general: { party: { pos: 2, imp: 2 } }, specific: {} }, values).pick === 'kessler', 'Rep lean -> Kessler');

// State-level retention question applies to every retention contest, statewide and local.
const judges = { general: {}, specific: { q_judicial: { v: 'yes' } } };
ok(E.score(byId('judges-coa'), judges, values).pick === 'yes', 'state retention default applies to local Court of Appeal');
ok(E.score(byId('judges-sc'), judges, values).pick === 'yes', 'state retention default applies to Supreme Court');
ok(E.specificFor([byId('judges-sc')], values).some(q => q.id === 'q_judicial'), 'retention question found by kind');
ok(E.score(byId('p5'), { general: {}, specific: { q_recall: { v: 'same_ballot' } } }, values).pick === 'no', 'recall same-ballot -> No on 5');
ok(E.score(byId('boe2'), { general: {}, specific: { q_boe_abolish: { v: 'yes' } } }, values).pick === 'pimentel', 'abolish BOE -> Pimentel');

const swg = E.swing(contests, empty, values).filter(x => !x.tiebreaker);
ok(swg.length > 5 && swg[0].moved >= swg[swg.length - 1].moved, 'swing sorted, top dim = ' + swg[0].dim);
ok(E.swing(contests, empty, values).slice(-1)[0].tiebreaker === true, 'tiebreaker belief asked last');
ok(E.applies(byId('ca24'), { cd: '19' }) === false && E.applies(byId('ca24'), { cd: '24' }), 'district filter');
ok(E.score(byId('slo-mayor'), empty, values).label === 'unopposed', 'unopposed mayor');

// Multi-seat race: vote for 2 of 3.
const board = { id: 'board', kind: 'race', voteFor: 2, candidates: [
  { id: 'a', name: 'A', positions: [{ dim: 'housing', stance: 1 }] },
  { id: 'b', name: 'B', positions: [{ dim: 'housing', stance: 1 }] },
  { id: 'c', name: 'C', positions: [{ dim: 'housing', stance: -1 }] }] };
const rb = E.score(board, { general: { housing: { pos: 2, imp: 3 } }, specific: {} }, values);
ok(Array.isArray(rb.pick) && rb.pick.sort().join() === 'a,b' && rb.multi && rb.seats === 2, 'multi-seat picks top two');

// Merged logic: mappings the models agree on count, disputed ones count for nothing.
const p2 = byId('p2');
const saver = { general: { savings: { pos: 2, imp: 3 } }, specific: {} };
ok(p2.tags.find(t => t.dim === 'savings').disputed === true, 'Prop 2 savings mapping is disputed after the merge');
ok(E.score(p2, saver, values).label === 'none', 'disputed mapping counts for nothing');
ok(!('savings' in E.dimsTouched([p2])), 'disputed mapping does not make a question look relevant');
ok(E.score(byId('p41'), saver, values).pick === 'yes', "merged-in mapping (Grok's) counts: saver -> Yes on 41");
ok(byId('p3').tags.find(t => t.dim === 'tax_wealthy').by.join() === 'claude,grok', 'agreed mapping is marked by both models');
ok(byId('p45').tags.some(t => t.dim === 'housing_approach' && t.by.join() === 'grok'), 'Grok-only mapping is marked as Grok only');
ok(read('data/values.json').general.some(d => d.id === 'housing_approach'), 'merged question added to values.json');
const merged = E.mergeLogic({ items: [{ id: 'p1', tags: [] }, { id: 'p2', tags: [] }] }, { items: [{ id: 'p2', tags: [{ dim: 'x', yes: 1, w: 1 }] }], changes: [{ id: 'p2' }] });
ok(merged.items.length === 2 && merged.items[1].tags.length === 1 && merged.revisions.length === 1, 'mergeLogic replaces items by id and logs changes');

// No place-specific logic in code.
const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8') + readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
const banned = ['slo-council', "'slo'", 'cadem', 'cagop', 'lwvc', 'Proposition ', "'Prop '", 'California', 'San Luis'];
ok(banned.every(w => !code.includes(w)), 'no California-specific strings in code');

if (fails) { console.error(fails + ' failing'); process.exit(1); }
console.log('all passed');
