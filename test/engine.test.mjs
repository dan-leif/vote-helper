// Run: node test/engine.test.mjs
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const E = require('../engine.js');
const values = JSON.parse(readFileSync(new URL('../values.json', import.meta.url)));
const load = p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
const contests = [...load('elections/2026-11/ca.json').contests, ...load('elections/2026-11/ca-slo.json').contests];
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

const dem = { general: { party: { pos: -2, imp: 2 } }, specific: {} };
ok(E.score(byId('gov'), dem, values).pick === 'becerra', 'Dem lean -> Becerra');
const rep = { general: { party: { pos: 2, imp: 2 } }, specific: {} };
ok(E.score(byId('ad30'), rep, values).pick === 'kessler', 'Rep lean -> Kessler');

const judges = { general: {}, specific: { q_judicial: { v: 'yes' } } };
ok(E.score(byId('judges-coa'), judges, values).pick === 'yes', 'judicial default yes');
const recall = { general: {}, specific: { q_recall: { v: 'same_ballot' } } };
ok(E.score(byId('p5'), recall, values).pick === 'no', 'recall same-ballot -> No on 5');
const boe = { general: {}, specific: { q_boe_abolish: { v: 'yes' } } };
ok(E.score(byId('boe2'), boe, values).pick === 'pimentel', 'abolish BOE -> Pimentel');

const sw = E.swing(contests, empty, values).filter(x => !x.tiebreaker);
ok(sw.length > 5 && sw[0].moved >= sw[sw.length - 1].moved, 'swing sorted, top dim = ' + sw[0].dim + ' (' + sw[0].moved + ')');
ok(E.applies(byId('ca24'), { cd: '19' }) === false && E.applies(byId('ca24'), { cd: '24' }), 'district filter');
ok(E.swing(contests, empty, values).slice(-1)[0].tiebreaker === true, 'tiebreaker belief asked last');
ok(E.score(byId('slo-mayor'), empty, values).label === 'unopposed', 'unopposed mayor');

if (fails) { console.error(fails + ' failing'); process.exit(1); }
console.log('all passed');
