// Run: node tools/build-own-logic-prompt.js [state] [locality] [date]
// Writes prompts/own-logic.txt: the "a model writes its own logic" prompt, built from the
// official ballot text in the data files (the same code the app uses).
const fs = require('fs');
const path = require('path');
const { buildOwnLogicPrompt } = require('../prompts.js');
const [state = 'ca', locality = 'san-luis-obispo', date = '2026-11-03'] = process.argv.slice(2);
const root = path.join(__dirname, '..', 'data');
const r = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p)));
const st = r(state, 'state.json');
const main = r(state, locality, date + '.json');
const files = [...(main.include || []).map(inc => r(state, typeof inc === 'string' ? inc : inc.locality, (typeof inc === 'string' ? date : inc.date) + '.json')), main];
const contests = files.flatMap(f => f.contests || []);
const prompt = buildOwnLogicPrompt({ contests, state: st, election: main, districts: {} });
fs.writeFileSync(path.join(__dirname, '..', 'prompts', 'own-logic.txt'), prompt);
console.log('chars', prompt.length, '~tokens', Math.round(prompt.length / 3.6), 'items', contests.length);
