// Shared helpers for the maintainer tools: load a ballot the same way the app does.
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const DATA = path.join(__dirname, '..', 'data');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(DATA, ...p)));
function loadBallot(id) {
  const places = read('places.json');
  const ballot = id ? places.ballots.find(b => b.id === id) : places.ballots[0];
  if (!ballot) throw new Error('No ballot "' + id + '" in data/places.json. Options: ' + places.ballots.map(b => b.id).join(', '));
  const state = read(ballot.state, 'state.json');
  const main = read(ballot.state, ballot.locality, ballot.date + '.json');
  const files = [...(main.include || []).map(inc => read(ballot.state, typeof inc === 'string' ? inc : inc.locality, (typeof inc === 'string' ? ballot.date : inc.date) + '.json')), main];
  const contests = files.flatMap(f => f.contests || []).filter(c => E.applies(c, ballot.districts)).sort((a, b) => a.order - b.order);
  const sources = Object.assign({}, state.sources, ...files.map(f => f.sources || {}));
  const values = { general: read('values.json').general, specific: [...(state.questions || []), ...files.flatMap(f => f.questions || [])] };
  const dir = path.join(DATA, ballot.state, ballot.locality);
  return { ballot, state, main, files, contests, sources, values, dir, read };
}
// Pull JSON out of a pasted chat reply: the whole text if it's JSON, otherwise every {...} block
// that contains one of the marker keys.
function extractJSON(text, markers) {
  try { return [JSON.parse(text)]; } catch (e) {}
  const out = [];
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        const chunk = text.slice(start, j + 1);
        if (markers.some(m => chunk.includes('"' + m + '"'))) {
          try { out.push(JSON.parse(chunk)); start = j; } catch (e) {}
        }
        break;
      }
    }
  }
  return out;
}
module.exports = { loadBallot, DATA, read, extractJSON };
