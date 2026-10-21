// Run: node tools/build-critique-prompt.js [ballot-id]
// Writes prompts/critique-<ballot-id>.txt: a prompt asking another AI model to critique Vote Helper's
// own logic for a ballot (belief questions, mappings, follow-ups, Quick picks, quality flags),
// using the same checks Vote Helper applies to other models' logic.
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const { buildCritiquePrompt } = require('../prompts.js');
const { loadBallot } = require('./lib.js');
const b = loadBallot(process.argv[2]);
const quick = E.swing(b.contests, { general: {}, specific: {} }, b.values).slice(0, 3).map(x => x.dim);
const prompt = buildCritiquePrompt({ contests: b.contests, state: b.state, election: b.main, districts: b.ballot.districts, values: b.values, sources: b.sources, quickPicks: quick, merges: b.merges, author: b.author });
const dir = path.join(__dirname, '..', 'prompts');
const write = (name, text) => { fs.writeFileSync(path.join(dir, name), text); console.log('wrote prompts/' + name, '·', text.length, 'chars'); };
write('critique-' + b.ballot.id + '.txt', prompt);
// Self-contained parts (candidates and judges; then the measures in two halves) for chat apps that
// reject long messages. Each part repeats the belief questions, follow-ups and merge notes.
const measures = b.contests.filter(c => c.kind === 'measure').map(c => c.id);
const races = b.contests.filter(c => c.kind !== 'measure').map(c => c.id);
const half = Math.ceil(measures.length / 2);
const groups = [races, measures.slice(0, half), measures.slice(half)].filter(g => g.length);
fs.readdirSync(dir).filter(f => f.startsWith('critique-' + b.ballot.id + '.part')).forEach(f => fs.unlinkSync(path.join(dir, f)));
groups.forEach((ids, i) => write('critique-' + b.ballot.id + '.part' + (i + 1) + '-of-' + groups.length + '.txt',
  buildCritiquePrompt({ contests: b.contests, state: b.state, election: b.main, districts: b.ballot.districts, values: b.values, sources: b.sources, quickPicks: quick, merges: b.merges, author: b.author, part: { index: i + 1, total: groups.length, items: ids } })));
console.log('Quick picks', quick.join(', '));
