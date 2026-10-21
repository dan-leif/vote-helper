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
const prompt = buildCritiquePrompt({ contests: b.contests, state: b.state, election: b.main, districts: b.ballot.districts, values: b.values, sources: b.sources, quickPicks: quick });
const dir = path.join(__dirname, '..', 'prompts');
const write = (name, text) => { fs.writeFileSync(path.join(dir, name), text); console.log('wrote prompts/' + name, '·', text.length, 'chars'); };
write('critique-' + b.ballot.id + '.txt', prompt);
// Two self-contained halves (measures; candidates and judges) for chat apps that reject long messages.
const measures = b.contests.filter(c => c.kind === 'measure').map(c => c.id);
const races = b.contests.filter(c => c.kind !== 'measure').map(c => c.id);
[[races, 1], [measures, 2]].forEach(([ids, i]) => write('critique-' + b.ballot.id + '.part' + i + '-of-2.txt',
  buildCritiquePrompt({ contests: b.contests, state: b.state, election: b.main, districts: b.ballot.districts, values: b.values, sources: b.sources, quickPicks: quick, part: { index: i, total: 2, items: ids } })));
console.log('Quick picks', quick.join(', '));
