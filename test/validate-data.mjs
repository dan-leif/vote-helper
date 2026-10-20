// Run: node test/validate-data.mjs  (checks every claim cites a known source and tags use known beliefs)
import { readFileSync } from 'fs';
const read = p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
const values = read('values.json');
const dims = new Set(values.general.map(d => d.id));
const specs = new Set(values.specific.map(q => q.id));
const index = read('elections/index.json');
let errors = 0;
const err = m => { errors++; console.error('ERROR', m); };
for (const el of index.elections) for (const f of el.files) {
  const d = read(f); const S = new Set(Object.keys(d.sources));
  const walk = (o, path) => {
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, path + '[' + i + ']'));
    if (o && typeof o === 'object') {
      if ('t' in o && !('s' in o) && !path.endsWith('flags') && !/flags\[\d+\]$/.test(path)) err(f + ' ' + path + ' claim has no source');
      if (o.s) o.s.forEach(s => S.has(s) || err(f + ' ' + path + ' unknown source ' + s));
      if (o.c && !['h', 'm', 'l'].includes(o.c)) err(f + ' ' + path + ' bad confidence ' + o.c);
      for (const [k, v] of Object.entries(o)) if (k !== 's') walk(v, path + '.' + k);
    }
  };
  for (const c of d.contests) {
    walk(c, c.id);
    (c.tags || []).forEach(t => { dims.has(t.dim) || err(c.id + ' tag dim ' + t.dim); (t.s && t.s.length) || err(c.id + ' tag without source'); });
    (c.candidates || []).forEach(k => (k.positions || []).forEach(p => dims.has(p.dim) || err(c.id + ' position dim ' + p.dim)));
    (c.specific || []).forEach(q => specs.has(q) || err(c.id + ' unknown specific ' + q));
    (c.quality || []).forEach(q => (q.s && q.s.length) || err(c.id + ' quality flag without source'));
  }
}
if (errors) { console.error(errors + ' errors'); process.exit(1); }
console.log('data valid');
