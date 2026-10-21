// Run: node tools/add-model-logic.js <ballot-id> <model-id> "<Label>" <reply-file> [more reply files...]
//
// Adds (or updates) another AI model's own logic for a ballot. Each reply file is the model's
// answer to prompts/own-logic.txt, or a later follow-up, saved as .json or as the full chat text.
// Replies are merged in order (a follow-up replaces the items it returns), then:
//   - writes data/<state>/<locality>/<date>.logic.<model-id>.json
//   - lists it under "logics" in the election file, so the app loads it
//   - copies the raw replies to prompts/replies/<state>-<locality>-<date>/
//   - prints a review sheet for the consistency check (see CLAUDE.md, "Another model's logic")
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const { loadBallot, extractJSON } = require('./lib.js');
const [ballotId, modelId, label, ...replies] = process.argv.slice(2);
if (!ballotId || !modelId || !label || !replies.length) { console.error('Usage: node tools/add-model-logic.js <ballot-id> <model-id> "<Label>" <reply-file> [...]'); process.exit(1); }
const b = loadBallot(ballotId);
const logicPath = path.join(b.dir, b.ballot.date + '.logic.' + modelId + '.json');
let logic = fs.existsSync(logicPath) ? JSON.parse(fs.readFileSync(logicPath, 'utf8')) : {};
const replyDir = path.join(__dirname, '..', 'prompts', 'replies', b.ballot.state + '-' + b.ballot.locality + '-' + b.ballot.date);
fs.mkdirSync(replyDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
logic.received = logic.received || [];
replies.forEach(file => {
  const text = fs.readFileSync(file, 'utf8');
  const parts = extractJSON(text, ['voteHelperLogic', 'items', 'changes']);
  if (!parts.length) { console.error('No logic JSON found in ' + file); process.exit(1); }
  parts.forEach(p => { p.date = p.date || today; logic = E.mergeLogic(logic, p); });
  const n = fs.readdirSync(replyDir).filter(f => f.startsWith(modelId + '-')).length + 1;
  const saved = modelId + '-' + n + '-' + path.basename(file);
  fs.copyFileSync(file, path.join(replyDir, saved));
  logic.received.push({ date: today, file: 'prompts/replies/' + path.basename(replyDir) + '/' + saved });
});
const out = Object.assign({ voteHelperLogic: 1,
  about: 'Belief questions and mappings written independently by another AI model from the official ballot text, using prompts/own-logic.txt. Stored as the model wrote it; the only edits are the model\'s own follow-up corrections (see "revisions").' },
  { id: modelId, label, model: logic.model, received: logic.received, general: logic.general, items: logic.items, specific: logic.specific, quickPicks: logic.quickPicks, revisions: logic.revisions });
fs.writeFileSync(logicPath, JSON.stringify(out, null, 1));
const electionPath = path.join(b.dir, b.ballot.date + '.json');
const election = JSON.parse(fs.readFileSync(electionPath, 'utf8'));
election.logics = election.logics || [];
if (!election.logics.some(l => l.id === modelId)) election.logics.push({ id: modelId, label });
fs.writeFileSync(electionPath, JSON.stringify(election, null, 1));
console.log('wrote', path.relative(process.cwd(), logicPath));

// ---- review sheet ----
const dims = Object.fromEntries((out.general || []).map(d => [d.id, d]));
const items = Object.fromEntries((out.items || []).map(i => [i.id, i]));
const used = new Set();
const notes = [];
b.contests.forEach(c => {
  const it = items[c.id];
  if (!it) { notes.push('missing item: ' + c.id); return; }
  (it.tags || []).concat(it.stances || []).forEach(t => { used.add(t.dim); if (!dims[t.dim]) notes.push(c.id + ': uses undefined question ' + t.dim); });
  (it.stances || []).forEach(s => {
    if (!(c.candidates || []).some(k => k.id === s.candidate)) notes.push(c.id + ': unknown candidate ' + s.candidate);
    if (!/party/.test(s.dim) && !/^https?:/.test(s.source || '')) notes.push(c.id + ': ' + s.candidate + '/' + s.dim + ' stance has no source link');
  });
  (it.quality || []).forEach(q => { if (!/^https?:/.test(q.source || '')) notes.push(c.id + ': quality flag source is not a link'); });
  if (c.candidates && c.candidates.length > 1) {
    const parties = new Set(c.candidates.map(k => k.party || '?'));
    const partyDims = (out.general || []).filter(d => /party/.test(d.id)).map(d => d.id);
    partyDims.forEach(pd => {
      const vals = c.candidates.map(k => ((it.stances || []).find(s => s.candidate === k.id && s.dim === pd) || {}).stance);
      if (parties.size === 1 && new Set(vals.filter(v => v != null)).size > 1) notes.push(c.id + ': same-party candidates get different ' + pd + ' values (' + vals.join(' / ') + ')');
    });
    if ((it.stances || []).length && (it.stances || []).every(s => partyDims.includes(s.dim))) notes.push(c.id + ': matched on party alone');
  }
  if (!(it.tags || []).length && !(it.stances || []).length && c.kind !== 'retention' && !c.unopposed) notes.push(c.id + ': no mapping at all');
});
(out.general || []).forEach(d => { if (!used.has(d.id)) notes.push('question defined but never used: ' + d.id); });
(out.quickPicks || []).forEach(q => { if (!dims[q.id]) notes.push('quick pick is not one of its questions: ' + q.id); });
console.log('\n' + (out.model ? out.model.name + ' ' + (out.model.version || '') + (out.model.webSearch ? ' · web search' : ' · no web search') : '') + ' · ' + (out.general || []).length + ' questions · ' + Object.keys(items).length + ' items');
console.log('\nCHECKS (' + notes.length + ')\n' + notes.map(n => '- ' + n).join('\n'));
console.log('\nDIRECTION REVIEW: does each "why" agree with the side its number points to?');
b.contests.forEach(c => ((items[c.id] || {}).tags || []).forEach(t => {
  const d = dims[t.dim]; if (!d) return;
  const side = t.yes > 0 ? 'B' : 'A';
  console.log('- ' + c.id + ' ' + t.dim + ' yes=' + t.yes + ' -> ' + side + ' "' + (side === 'B' ? d.b : d.a) + '"\n    why: ' + t.why);
}));
