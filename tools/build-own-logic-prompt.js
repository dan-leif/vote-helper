// Run: node tools/build-own-logic-prompt.js [ballot-id]
// Writes prompts/own-logic.txt: the prompt that asks another AI model to design its own logic for a
// ballot, built from the official ballot text in the data files (same code the app uses).
const fs = require('fs');
const path = require('path');
const { buildOwnLogicPrompt } = require('../prompts.js');
const { loadBallot } = require('./lib.js');
const b = loadBallot(process.argv[2]);
const prompt = buildOwnLogicPrompt({ contests: b.contests, state: b.state, election: b.main, districts: b.ballot.districts });
const out = path.join(__dirname, '..', 'prompts', 'own-logic.txt');
fs.writeFileSync(out, prompt);
console.log('wrote', path.relative(process.cwd(), out), '·', prompt.length, 'chars ·', b.contests.length, 'items · ballot', b.ballot.id);
