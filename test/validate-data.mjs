// Run: node test/validate-data.mjs
// Checks every place's data: files exist where places.json says, claims cite known sources,
// tags use known beliefs, questions and endorsers resolve.
import { readFileSync, existsSync } from 'fs';
const root = new URL('../data/', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root)));
const values = read('values.json');
const dims = new Set(values.general.map(d => d.id));
const places = read('places.json');
let errors = 0;
const err = m => { errors++; console.error('ERROR', m); };

// Group ballots by election file; check each ballot's fixed districts exist in that file.
const elections = {};
for (const b of places.ballots) {
  const k = `${b.state}/${b.locality}/${b.date}`;
  (elections[k] = elections[k] || { state: b.state, locality: b.locality, date: b.date, ballots: [] }).ballots.push(b);
}
const ballotIds = new Set();
for (const b of places.ballots) { ballotIds.has(b.id) && err('duplicate ballot id ' + b.id); ballotIds.add(b.id); }
for (const p of Object.values(elections)) {
  const statePath = p.state + '/state.json';
  if (!existsSync(new URL(statePath, root))) { err('missing ' + statePath); continue; }
  const state = read(statePath);
  const stateSrc = new Set(Object.keys(state.sources || {}));
  const endorserIds = new Set((state.endorsers || []).map(e => e.id));
  (state.endorsers || []).forEach(e => stateSrc.has(e.src) || err(statePath + ' endorser ' + e.id + ' has unknown source'));
  for (const e of [{ date: p.date }]) {
    const path = `${p.state}/${p.locality}/${e.date}.json`;
    if (!existsSync(new URL(path, root))) { err('missing ' + path); continue; }
    const main = read(path);
    for (const b of p.ballots) for (const [id, val] of Object.entries(b.districts || {})) {
      const d = (main.districts || []).find(x => x.id === id);
      if (!d || !d.options.some(o => o.v === val)) err('ballot ' + b.id + ': district ' + id + '=' + val + ' is not in ' + path);
    }
    const files = [[path, main], ...(main.include || []).map(inc => {
      const ip = `${p.state}/${typeof inc === 'string' ? inc : inc.locality}/${typeof inc === 'string' ? e.date : inc.date}.json`;
      if (!existsSync(new URL(ip, root))) { err(path + ' includes missing ' + ip); return null; }
      return [ip, read(ip)];
    }).filter(Boolean)];
    // Merged logic: every model named in "by" is the author or a merged model, and its merge record exists.
    const models = new Set([values.author && values.author.id, ...files.flatMap(([, f]) => (f.merged || []).map(m => m.model))]);
    files.forEach(([fp, f]) => (f.merged || []).forEach(m => existsSync(new URL('../' + m.record, root)) || err(fp + ' merge record missing: ' + m.record)));
    const checkBy = (where, x) => {
      (x.by || []).forEach(m => models.has(m) || err(where + ' "by" names unknown model ' + m));
      if (x.disputed && !(x.views && Object.keys(x.views).length >= 2)) err(where + ' is disputed but lacks both models\' views');
    };
    files.forEach(([fp, f]) => (f.contests || []).forEach(c => {
      (c.tags || []).forEach(t => checkBy(fp + ' ' + c.id + ' tag ' + t.dim, t));
      (c.candidates || []).forEach(k => (k.positions || []).forEach(p => checkBy(fp + ' ' + c.id + '/' + k.id + ' ' + p.dim, p)));
      (c.quality || []).forEach(q => checkBy(fp + ' ' + c.id + ' quality', q));
    }));
    const questions = new Set([...(state.questions || []), ...files.flatMap(([, f]) => f.questions || [])].map(q => q.id));
    const ids = new Set();
    for (const [f, d] of files) {
      const S = new Set(Object.keys(d.sources || {}));
      const known = s => S.has(s) || stateSrc.has(s);
      const walk = (o, at) => {
        if (Array.isArray(o)) return o.forEach((v, i) => walk(v, at + '[' + i + ']'));
        if (o && typeof o === 'object') {
          if ('t' in o && !('s' in o) && !/flags\[\d+\]$/.test(at)) err(f + ' ' + at + ' claim has no source');
          if (o.s) o.s.forEach(s => known(s) || err(f + ' ' + at + ' unknown source ' + s));
          if (o.c && !['h', 'm', 'l'].includes(o.c)) err(f + ' ' + at + ' bad confidence ' + o.c);
          for (const [k, v] of Object.entries(o)) if (k !== 's' && k !== 'views') walk(v, at + '.' + k);
        }
      };
      for (const c of d.contests || []) {
        if (ids.has(c.id)) err(f + ' duplicate contest id ' + c.id);
        ids.add(c.id);
        walk(c, c.id);
        (c.tags || []).forEach(t => { dims.has(t.dim) || err(c.id + ' tag dim ' + t.dim); (t.s && t.s.length) || err(c.id + ' tag without source'); });
        (c.candidates || []).forEach(k => (k.positions || []).forEach(x => dims.has(x.dim) || err(c.id + ' position dim ' + x.dim)));
        (c.specific || []).forEach(q => questions.has(q) || err(c.id + ' unknown question ' + q));
        (c.quality || []).forEach(q => (q.s && q.s.length) || err(c.id + ' quality flag without source'));
        Object.keys((c.endorse && c.endorse.positions) || {}).forEach(k => endorserIds.has(k) || err(c.id + ' endorser ' + k + ' not in ' + statePath));
        if (c.kind === 'retention' && !(state.retention && state.retention.has)) err(c.id + ': ' + state.name + ' has no retention elections');
        if (c.kind === 'measure' && !(state.measures && state.measures.has)) err(c.id + ': ' + state.name + ' has no ballot measures');
      }
    }
  }
}
if (errors) { console.error(errors + ' errors'); process.exit(1); }
console.log('data valid (' + places.ballots.length + ' ballot(s))');
