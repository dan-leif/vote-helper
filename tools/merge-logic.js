// Run: node tools/merge-logic.js <ballot-id> <model-id>
//
// Merges another model's own logic into Vote Helper's single set of questions and mappings, using the
// merge record data/<state>/<locality>/<date>.merge.<model-id>.json (which says which of the model's
// questions match Vote Helper's, and why). Safe to re-run: it first removes anything an earlier merge
// with this model added, then merges again.
//
// For each mapping (measure tag or candidate stance) on the same question:
//   both models, same direction  -> kept, marked by both, weight/stance averaged, both reasons kept
//   both models, opposite        -> marked "disputed": shown with both reasons, counts for nothing
//   only the other model         -> added, marked as that model's
// The model's follow-up questions and quality flags are added or matched as the merge record says.
// New or reworded belief questions go into data/values.json.
const fs = require('fs');
const path = require('path');
const { loadBallot, DATA } = require('./lib.js');
const [ballotId, model] = process.argv.slice(2);
if (!ballotId || !model) { console.error('Usage: node tools/merge-logic.js <ballot-id> <model-id>'); process.exit(1); }
const b = loadBallot(ballotId);
const mergePath = path.join(b.dir, b.ballot.date + '.merge.' + model + '.json');
const M = JSON.parse(fs.readFileSync(mergePath, 'utf8'));
const L = JSON.parse(fs.readFileSync(path.join(__dirname, '..', M.logic), 'utf8'));
const label = M.label || model;
const round = x => Math.round(x * 10) / 10;
const sign = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
const log = { agree: [], disputed: [], added: [], dropped: [], questions: [] };

// ---- 1. belief questions (global, data/values.json) ----
const valuesPath = path.join(DATA, 'values.json');
const values = JSON.parse(fs.readFileSync(valuesPath, 'utf8'));
const vh = id => values.general.find(d => d.id === id);
Object.entries(M.questions).forEach(([from, q]) => {
  if (q.drop) { log.dropped.push('question ' + from + ': ' + q.why); return; }
  if (q.toSpecific) return;
  let d = vh(q.to);
  if (!d && q.new) { d = Object.assign({ id: q.to }, q.new, { by: [model], from: { [model]: from } }); values.general.push(d); log.questions.push('new ' + q.to + ' (from ' + from + ')'); }
  if (!d) throw new Error('Merge record maps ' + from + ' to unknown question ' + q.to);
  if (q.reword && !d.reworded) { d.before = { label: d.label, q: d.q, a: d.a, b: d.b }; Object.assign(d, q.reword); d.reworded = true; log.questions.push('reworded ' + q.to); }
  d.by = Array.from(new Set([...(d.by || ['claude']), model]));
  // A model can name the same question differently on different ballots; keep every name.
  const prev = (d.from || {})[model], names = Array.from(new Set([].concat(prev || [], from)));
  d.from = Object.assign(d.from || {}, { [model]: names.length === 1 ? names[0] : names });
});
fs.writeFileSync(valuesPath, JSON.stringify(values, null, 2));

// ---- 2. per election file: reset, then merge ----
const crosswalk = {};
Object.entries(M.questions).forEach(([from, q]) => { if (q.to) crosswalk[from] = [q.to, q.orient]; });
const items = Object.fromEntries((L.items || []).map(i => [i.id, i]));
const keepQs = Object.entries(M.specific || {}).filter(([, v]) => v.keep).map(([k]) => k);

function reset(f) {
  const drop = x => x.by && x.by.length === 1 && x.by[0] === model;
  (f.contests || []).forEach(c => {
    if (c.tags) c.tags = c.tags.filter(t => !drop(t)).map(t => unmerge(t, ['yes', 'w', 'why']));
    (c.candidates || []).forEach(k => { if (k.positions) k.positions = k.positions.filter(p => !drop(p)).map(p => unmerge(p, ['stance', 't'])); });
    if (c.quality) c.quality = c.quality.filter(q => !drop(q)).map(q => { if (q.by) { q.by = q.by.filter(x => x !== model); if (q.by.length <= 1) delete q.by; } delete q.alsoSaid; return q; });
  });
  if (f.questions) f.questions = f.questions.filter(q => !drop(q)).map(q => { if (q.by) { q.by = q.by.filter(x => x !== model); if (q.by.length <= 1) delete q.by; } return q; });
  Object.keys(f.sources || {}).forEach(k => { if (k === 'model_' + model || k.startsWith('model_' + model + '_')) delete f.sources[k]; });
  if (f.merged) f.merged = f.merged.filter(m => m.model !== model);
}
function unmerge(x, fields) {
  if (!x.views || !x.views.claude) return x;
  fields.forEach(k => { if (x.views.claude[k] !== undefined) x[k] = x.views.claude[k]; });
  delete x.views; delete x.by; delete x.disputed;
  return x;
}
function srcFor(f, url) {
  f.sources = f.sources || {};
  if (!f.sources['model_' + model]) f.sources['model_' + model] = { title: label + "'s own logic for this ballot, written from the official ballot text", pub: label, short: label, url: 'https://github.com/dan-leif/vote-helper/blob/main/' + M.logic, type: 'model' };
  if (!/^https?:/.test(url || '')) return ['model_' + model];
  const existing = Object.entries(f.sources).find(([, s]) => s.url === url);
  if (existing) return ['model_' + model, existing[0]];
  const id = 'model_' + model + '_' + (Object.keys(f.sources).filter(k => k.startsWith('model_' + model + '_')).length + 1);
  let host = url; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
  f.sources[id] = { title: 'Cited by ' + label + ' (not checked by Vote Helper)', pub: host, short: host.split('.')[0], url, type: 'via-model' };
  return ['model_' + model, id];
}
function mergeMapping(f, list, mine, theirs, fields, idLabel) {
  // fields: [value field, weight field or null, reason field]
  const [vf, wf, rf] = fields;
  const existing = list.find(x => x.dim === theirs.dim);
  if (!existing) {
    const add = { dim: theirs.dim, [vf]: theirs[vf] }; if (wf) add[wf] = theirs[wf];
    add[rf] = theirs[rf]; add.s = srcFor(f, theirs.source); add.c = /^https?:/.test(theirs.source || '') ? 'l' : 'm'; add.by = [model];
    list.push(add); log.added.push(idLabel + ' ' + theirs.dim); return;
  }
  const claude = { [vf]: existing[vf], [rf]: existing[rf] }; if (wf) claude[wf] = existing[wf];
  existing.views = { claude, [model]: theirs.view };
  existing.by = ['claude', model];
  if (sign(existing[vf]) && sign(theirs[vf]) && sign(existing[vf]) !== sign(theirs[vf])) {
    existing.disputed = true; log.disputed.push(idLabel + ' ' + theirs.dim);
  } else {
    if (wf) existing[wf] = round((existing[wf] + theirs[wf]) / 2); else existing[vf] = round((existing[vf] + theirs[vf]) / 2);
    log.agree.push(idLabel + ' ' + theirs.dim);
  }
}
b.files.forEach(f => {
  reset(f);
  (f.contests || []).forEach(c => {
    const it = items[c.id]; if (!it) return;
    if (c.kind === 'measure') {
      c.tags = c.tags || [];
      (it.tags || []).forEach(t => {
        const cw = crosswalk[t.dim]; if (!cw) return;
        const yes = sign(t.yes) * cw[1], w = round(Math.abs(t.yes) * t.w);
        mergeMapping(f, c.tags, null, { dim: cw[0], yes, w, why: t.why, view: { yes, w, why: t.why, question: t.dim } }, ['yes', 'w', 'why'], c.id);
      });
      (it.quality || []).forEach((q, i) => {
        const rule = (M.quality || {})[c.id + '#' + i]; if (!rule) return;
        if (rule.same) {
          const mine = (c.quality || []).find(x => x.type === rule.same);
          if (mine) { mine.by = ['claude', model]; mine.alsoSaid = { [model]: q.detail }; }
        } else if (rule.add) {
          c.quality = c.quality || [];
          c.quality.push({ type: rule.type || q.type, sev: rule.sev || 'low', t: q.detail, s: srcFor(f, q.source), c: 'l', by: [model] });
          log.added.push(c.id + ' quality ' + (rule.type || q.type));
        }
      });
    }
    if (c.candidates) {
      const byDim = {};
      (it.stances || []).forEach(s => { const cw = crosswalk[s.dim]; if (cw) (byDim[cw[0]] = byDim[cw[0]] || []).push(Object.assign({}, s, { dim: cw[0], stance: round(s.stance * cw[1]) })); });
      Object.entries(byDim).forEach(([dim, list]) => {
        if (M.stances && M.stances.skipEqual && c.candidates.length > 1 && list.length === c.candidates.length && new Set(list.map(s => s.stance)).size === 1) { log.dropped.push(c.id + ' ' + dim + ': same value for every candidate'); return; }
        list.forEach(s => {
          const k = c.candidates.find(x => x.id === s.candidate); if (!k) return;
          k.positions = k.positions || [];
          mergeMapping(f, k.positions, null, { dim, stance: s.stance, t: s.why, source: s.source, view: { stance: s.stance, t: s.why, question: s.dim, source: s.source } }, ['stance', null, 't'], c.id + '/' + k.id);
        });
      });
    }
  });
  // Follow-up questions the merge record keeps, placed in the file that holds their items.
  (L.specific || []).filter(q => keepQs.includes(q.id) && (q.for || []).some(id => (f.contests || []).some(c => c.id === id))).forEach(q => {
    f.questions = f.questions || [];
    f.questions.push({ id: q.id, for: q.for, q: q.q, options: q.options.map((o, i) => ({ v: o.v || 'o' + i, l: o.l, fx: o.fx })), by: [model] });
    log.added.push('question ' + q.id);
  });
  // A Vote Helper follow-up the model independently asked too.
  Object.entries(M.questions).filter(([, q]) => q.toSpecific).forEach(([, q]) => {
    const vq = (f.questions || []).find(x => x.id === q.toSpecific); if (vq) vq.by = ['claude', model];
  });
  Object.entries(M.specific || {}).filter(([, v]) => v.drop).forEach(([k, v]) => { if (f === b.files[0]) log.dropped.push('follow-up ' + k + ': ' + v.why); });
  // Record the merge so the app can carry over answers given to the model's own questions.
  if (f === b.files[b.files.length - 1]) {
    f.merged = f.merged || [];
    f.merged.push({ model, label, date: M.decided && M.decided.date, record: path.relative(path.join(__dirname, '..'), mergePath), questions: crosswalk });
  }
  fs.writeFileSync(f._path, JSON.stringify(f, null, 1));
});
const show = (k, t) => console.log('\n' + t + ' (' + log[k].length + ')\n' + log[k].map(x => '- ' + x).join('\n'));
show('questions', 'Belief questions changed'); show('agree', 'Both models, same direction'); show('disputed', 'Disputed (count for nothing)'); show('added', 'Added from ' + label); show('dropped', 'Left out');
