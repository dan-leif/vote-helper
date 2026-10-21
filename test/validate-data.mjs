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

for (const p of places.places) {
  const statePath = p.state + '/state.json';
  if (!existsSync(new URL(statePath, root))) { err('missing ' + statePath); continue; }
  const state = read(statePath);
  const stateSrc = new Set(Object.keys(state.sources || {}));
  const endorserIds = new Set((state.endorsers || []).map(e => e.id));
  (state.endorsers || []).forEach(e => stateSrc.has(e.src) || err(statePath + ' endorser ' + e.id + ' has unknown source'));
  for (const e of p.elections) {
    const path = `${p.state}/${p.locality}/${e.date}.json`;
    if (!existsSync(new URL(path, root))) { err('missing ' + path); continue; }
    const main = read(path);
    const files = [[path, main], ...(main.include || []).map(inc => {
      const ip = `${p.state}/${typeof inc === 'string' ? inc : inc.locality}/${typeof inc === 'string' ? e.date : inc.date}.json`;
      if (!existsSync(new URL(ip, root))) { err(path + ' includes missing ' + ip); return null; }
      return [ip, read(ip)];
    }).filter(Boolean)];
    // Other models' logic files listed by the election.
    for (const l of main.logics || []) {
      const lp = `${p.state}/${p.locality}/${e.date}.logic.${l.id}.json`;
      if (!existsSync(new URL(lp, root))) { err(path + ' lists missing logic ' + lp); continue; }
      const L = read(lp);
      const ld = new Set((L.general || []).map(d => d.id));
      const contestIds = new Set(files.flatMap(([, f]) => (f.contests || []).map(c => c.id)));
      const cands = {}; files.forEach(([, f]) => (f.contests || []).forEach(c => cands[c.id] = new Set((c.candidates || []).map(k => k.id))));
      (L.items || []).forEach(it => {
        contestIds.has(it.id) || err(lp + ' unknown item ' + it.id);
        (it.tags || []).forEach(t => ld.has(t.dim) || err(lp + ' ' + it.id + ' tag uses undefined question ' + t.dim));
        (it.stances || []).forEach(x => { ld.has(x.dim) || err(lp + ' ' + it.id + ' stance uses undefined question ' + x.dim); (cands[it.id] && cands[it.id].has(x.candidate)) || err(lp + ' ' + it.id + ' unknown candidate ' + x.candidate); });
      });
      (L.quickPicks || []).forEach(q => ld.has(q.id) || err(lp + ' quick pick ' + q.id + ' is not one of its questions'));
      [...contestIds].forEach(id => (L.items || []).some(i => i.id === id) || console.warn('note: ' + lp + ' has no entry for ' + id));
    }
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
          for (const [k, v] of Object.entries(o)) if (k !== 's') walk(v, at + '.' + k);
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
console.log('data valid (' + places.places.length + ' place(s))');
