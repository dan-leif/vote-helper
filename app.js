/* Vote Helper app. Plain JS, no build step. Reads data/places.json, the chosen state's
   data/<state>/state.json and its data/<state>/<locality>/<date>.json election file.
   Keeps the person's beliefs in localStorage and never sends them anywhere.
   All judgments about ballot items live in the data files; this file only displays and does arithmetic. */
(function () {
  'use strict';
  var E = window.VHEngine;
  var STORE_KEY = 'voteHelper.v1';
  var AUDIT_KEY = 'voteHelper.audits.v1';
  var DATA = 'data/';
  var IN_FRAME = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  // Old election ids from before data was organized by place.
  var LEGACY_IDS = { '2026-11-ca-slo': 'ca/san-luis-obispo/2026-11-03' };

  var S = {
    values: null, baseValues: null, places: null, place: null, state: null, election: null, contests: [], sources: {},
    results: {}, beliefs: null, audits: {}, view: 'home', itemId: null,
    queue: [], queuePos: 0, walk: [], walkPos: 0, disagree: null, aiScope: null
  };

  // ---------- helpers ----------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function dimById(id) { return S.values.general.filter(function (d) { return d.id === id; })[0]; }
  function specById(id) { return S.values.specific.filter(function (q) { return q.id === id; })[0]; }
  function contestById(id) { return S.contests.filter(function (c) { return c.id === id; })[0]; }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }

  // ---------- storage ----------
  function blankBeliefs() {
    return { schema: 2, app: 'vote-helper', created: today(), updated: today(), general: {}, specific: {}, elections: {}, decisions: [], history: [] };
  }
  function load() {
    try { var raw = localStorage.getItem(STORE_KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) {}
    return blankBeliefs();
  }
  function normalize(b) {
    var base = blankBeliefs();
    Object.keys(base).forEach(function (k) { if (b[k] == null) b[k] = base[k]; });
    // Migrate election ids from the first version.
    Object.keys(LEGACY_IDS).forEach(function (old) {
      var nu = LEGACY_IDS[old];
      if (b.elections[old] && !b.elections[nu]) { b.elections[nu] = b.elections[old]; }
      delete b.elections[old];
      b.decisions.forEach(function (d) { if (d.election === old) d.election = nu; });
      Object.keys(b.specific).forEach(function (k) { if (b.specific[k].election === old) b.specific[k].election = nu; });
    });
    b.schema = 2;
    return b;
  }
  function save() {
    S.beliefs.updated = today();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.beliefs)); } catch (e) {}
  }
  function loadAudits() { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveAudits() { try { localStorage.setItem(AUDIT_KEY, JSON.stringify(S.audits)); } catch (e) {} }
  function itemAudits(id) { var a = S.audits[S.election.key] || {}; return a[id] || {}; }
  function eState() {
    var id = S.election.key;
    if (!S.beliefs.elections[id]) S.beliefs.elections[id] = { districts: {}, effort: 'quick', choices: {}, ai: {} };
    var st = S.beliefs.elections[id];
    st.choices = st.choices || {}; st.ai = st.ai || {}; st.districts = st.districts || {};
    return st;
  }

  // ---------- data ----------
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.json();
    });
  }
  function placeKey(p) { return p.state + '/' + p.locality; }
  function electionPath(state, locality, date) { return DATA + state + '/' + locality + '/' + date + '.json'; }
  // Load a place's election: the state config, the locality file, and any files it includes (e.g. statewide).
  function loadElection(place, date) {
    var stateP = fetchJSON(DATA + place.state + '/state.json');
    var mainP = fetchJSON(electionPath(place.state, place.locality, date));
    return Promise.all([stateP, mainP]).then(function (res) {
      var state = res[0], main = res[1];
      var incs = (main.include || []).map(function (inc) {
        var loc = typeof inc === 'string' ? inc : inc.locality, d = typeof inc === 'string' ? date : inc.date;
        return fetchJSON(electionPath(place.state, loc, d)).then(function (f) { f._key = place.state + '/' + loc + '/' + d; return f; });
      });
      main._key = placeKey(place) + '/' + date;
      return Promise.all(incs).then(function (files) {
        files.push(main);
        var contests = [], sources = {}, questions = [].concat(state.questions || []);
        Object.keys(state.sources || {}).forEach(function (k) { sources['state:' + k] = state.sources[k]; });
        files.forEach(function (f) {
          Object.keys(f.sources || {}).forEach(function (k) { sources[f._key + ':' + k] = f.sources[k]; });
          (f.contests || []).forEach(function (c) { c._file = f._key; contests.push(c); });
          (f.questions || []).forEach(function (q) { questions.push(q); });
        });
        contests.sort(function (a, b) { return a.order - b.order; });
        S.state = state; S.place = place;
        S.election = main; S.election.key = main._key;
        S.allContests = contests; S.sources = sources;
        S.values = { general: S.baseValues.general, specific: questions };
        S.beliefs.place = { key: placeKey(place), date: date }; save();
        applyDistricts();
      });
    });
  }
  function applyDistricts() {
    var st = eState();
    (S.election.districts || []).forEach(function (d) { if (!st.districts[d.id]) st.districts[d.id] = d.default; });
    S.contests = S.allContests.filter(function (c) { return E.applies(c, st.districts); });
    rescore();
  }
  function rescore() {
    S.results = {};
    S.contests.forEach(function (c) { S.results[c.id] = E.score(c, S.beliefs, S.values); });
  }
  // District choices the data marks as not researched yet.
  function uncovered() {
    var st = eState(), miss = [];
    (S.election.districts || []).forEach(function (d) {
      var o = d.options.filter(function (x) { return x.v === st.districts[d.id]; })[0];
      if (o && o.covered === false) miss.push(o.missing || (d.label + ' ' + o.l));
    });
    return miss;
  }
  function partyName(code) { return (S.state.parties && S.state.parties[code]) || code; }
  function measureShort() { return (S.state.measures && S.state.measures.short) || 'Measure'; }
  function measureName() { return (S.state.measures && S.state.measures.name) || 'Measure'; }

  // ---------- rendering pieces ----------
  function srcChip(c, id) {
    var s = S.sources[(c ? c._file : 'state') + ':' + id] || S.sources['state:' + id];
    if (!s) return '';
    var short = s.short || s.pub.split(/[\s,(]/)[0];
    return '<a class="src" href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.title + ' · ' + s.pub) + '">' + esc(short) + '</a>';
  }
  function claim(c, cl) {
    if (!cl) return '';
    var srcs = (cl.s || []).map(function (id) { return srcChip(c, id); }).join('');
    var low = cl.c === 'l' ? '<span class="lowconf" title="Low confidence: thin, opinion or advocacy source">low conf.</span>' : '';
    return esc(cl.t) + srcs + low;
  }
  function claimList(c, arr) {
    if (!arr || !arr.length) return '';
    return '<ul class="claims">' + arr.map(function (x) { return '<li>' + claim(c, x) + '</li>'; }).join('') + '</ul>';
  }
  function candName(c, id) {
    var k = (c.candidates || []).filter(function (x) { return x.id === id; })[0];
    return k ? k.name : id;
  }
  function verdictHTML(c, r) {
    r = r || S.results[c.id];
    var lab = r.label, cls = 'v-call', text = 'Your call', lean = false;
    if (c.kind === 'measure') {
      var map = { yes: ['v-yes', 'Yes'], 'lean-yes': ['v-yes', 'Lean Yes'], no: ['v-no', 'No'], 'lean-no': ['v-no', 'Lean No'], call: ['v-call', 'Your call'], none: ['v-none', 'Not enough info'], skip: ['v-skip', 'Leave blank'] };
      cls = map[lab][0]; text = map[lab][1]; lean = lab.indexOf('lean') === 0 || lab === 'call' || lab === 'none';
    } else if (c.kind === 'retention') {
      var m2 = { yes: ['v-yes', 'Yes on all'], no: ['v-no', 'No on all'], skip: ['v-skip', 'Leave blank'], none: ['v-none', 'Your call'] };
      cls = m2[lab][0]; text = m2[lab][1]; lean = lab === 'none';
    } else {
      var lastNames = function (ids) { return [].concat(ids).map(function (id) { return candName(c, id).split(' ').slice(-1)[0]; }).join(', '); };
      if (lab === 'strong' || lab === 'unopposed') { cls = 'v-cand'; text = Array.isArray(r.pick) ? lastNames(r.pick) : candName(c, r.pick); }
      else if (lab === 'lean') { cls = 'v-cand'; text = 'Lean ' + lastNames(r.pick); lean = true; }
      else if (lab === 'none') { cls = 'v-none'; text = 'Not enough info'; lean = true; }
      else { cls = 'v-call'; text = 'Your call'; lean = true; }
    }
    return '<span class="verdict ' + cls + (lean ? ' lean' : '') + '"><span class="dot"></span>' + esc(text) + '</span>';
  }
  function contestTitle(c) {
    if (c.kind === 'measure') return (c.numLabel || measureShort()) + ' ' + c.num + ': ' + c.title;
    return c.office;
  }
  function worstQuality(c) {
    var order = { high: 3, med: 2, low: 1, info: 0 };
    return (c.quality || []).reduce(function (m, q) { return Math.max(m, order[q.sev] || 0); }, -1);
  }
  function flagsHTML(c) {
    var r = S.results[c.id], out = [];
    var st = eState();
    if (st.choices[c.id]) out.push('<span class="flag decided">✓ You decided</span>');
    if (r.conflict) out.push('<span class="flag conflict">⇄ Your beliefs conflict</span>');
    var wq = worstQuality(c);
    if (wq >= 2) out.push('<span class="flag quality">⚠ ' + (wq === 3 ? 'Serious' : 'Some') + ' drafting concerns</span>');
    if (c.conf === 'l') out.push('<span class="flag low">Thin information</span>');
    if (st.ai[c.id]) out.push('<span class="flag low">AI note</span>');
    var au = E.auditStatus(itemAudits(c.id));
    if (au.status === 'disagree') out.push('<span class="flag quality">≠ Models disagree</span>');
    else if (au.status === 'split-minor' || au.status === 'minor') out.push('<span class="flag low">Audit notes</span>');
    else if (au.status === 'agree') out.push('<span class="flag decided">Audited</span>');
    return out.join('');
  }
  function choiceFor(c) {
    var st = eState(), ch = st.choices[c.id];
    if (ch) return { v: ch.v, mine: true };
    var r = S.results[c.id];
    if (c.kind === 'retention') return { v: r.label === 'skip' ? 'skip' : r.pick, mine: false };
    return { v: r.pick, mine: false };
  }
  function choiceText(c, v) {
    if (Array.isArray(v)) return v.length ? v.map(function (x) { return choiceText(c, x); }).join(', ') : '';
    if (!v) return '';
    if (v === 'skip') return 'Leave blank';
    if (c.kind === 'measure' || c.kind === 'retention') return v === 'yes' ? 'Yes' : 'No';
    if (v === 'writein') return 'Write-in';
    return candName(c, v);
  }
  function sectionName(c) {
    var key = c.kind === 'measure' ? 'measure' : c.level;
    var hit = (S.election.sections || []).filter(function (x) { return x[0] === key; })[0];
    if (hit) return hit[1];
    return c.kind === 'measure' ? measureName() + 's' : c.level;
  }

  // ---------- nav ----------
  function setView(v, opts) {
    S.view = v; if (opts && opts.item) S.itemId = opts.item;
    render(); window.scrollTo(0, 0);
  }
  function renderTabs() {
    var tabs = [['home', 'Start'], ['slate', 'My ballot'], ['sheet', 'Cheat sheet'], ['profile', 'My beliefs'], ['audit', 'Bias check'], ['about', 'How it works']];
    $('#tabs').innerHTML = tabs.map(function (t) {
      var cur = S.view === t[0] || (t[0] === 'slate' && S.view === 'item');
      return '<button type="button" data-nav="' + t[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
    }).join('');
    $('#mast-sub').textContent = S.election ? S.election.name + ' · ' + S.election.area : 'Personal ballot advisor';
  }

  function render() {
    renderTabs();
    var app = $('#app');
    var fn = { home: viewHome, ask: viewAsk, slate: viewSlate, item: viewItem, sheet: viewSheet, profile: viewProfile, about: viewAbout, ai: viewAI, data: viewData, audit: viewAudit }[S.view] || viewHome;
    app.innerHTML = fn();
    if (S.view === 'ai' || S.view === 'data') { var ta = $('#app textarea[readonly]'); if (ta) ta.scrollTop = 0; }
  }

  // ---------- home ----------
  function countAnswered() {
    var touched = E.dimsTouched(S.contests);
    var dims = Object.keys(touched);
    var ans = dims.filter(function (d) { return S.beliefs.general[d]; }).length;
    return { ans: ans, total: dims.length };
  }
  function viewHome() {
    var st = eState(), cnt = countAnswered();
    var miss = uncovered();
    var dHTML = (S.election.districts || []).map(function (d) {
      return '<label class="field" for="dist-' + d.id + '">' + esc(d.label) + '<select id="dist-' + d.id + '" data-district="' + d.id + '">' +
        d.options.map(function (o) { return '<option value="' + esc(o.v) + '"' + (st.districts[d.id] === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') +
        '</select></label>';
    }).join('');
    var efforts = [
      ['quick', 'Quick', 'About 3 questions, the ones that move the most votes on this ballot. Then your full ballot, with the 2–3 items worth a closer look.'],
      ['standard', 'Standard', 'About 8–12 questions, then a walk through the close calls and conflicts, one at a time.'],
      ['deep', 'Deep', 'Every relevant question, then every contest one at a time.']
    ];
    var lookup = S.election.lookup || S.state.lookup;
    var placeOpts = S.places.places.map(function (p) {
      var st = S.stateNames[p.state] || p.state.toUpperCase();
      return '<option value="' + esc(placeKey(p)) + '"' + (placeKey(p) === placeKey(S.place) ? ' selected' : '') + '>' + esc(p.name + ', ' + st) + '</option>';
    }).join('');
    var dateOpts = S.place.elections.map(function (e) {
      return '<option value="' + esc(e.date) + '"' + (e.date === S.election.date ? ' selected' : '') + '>' + esc(e.date + ' · ' + e.name) + '</option>';
    }).join('');
    return '' +
      '<section class="panel"><div class="band"><h2>Your ballot</h2><span class="votefor">' + esc(S.election.date) + '</span></div><div class="panel-body">' +
        '<p>Vote Helper explains each item on your ballot, shows how your beliefs map onto it, and lets you agree or disagree. It learns from your disagreements. Everything you enter stays in this browser.</p>' +
        '<div class="split"><label class="field" for="pick-place">Where you vote<select id="pick-place" data-pick="place">' + placeOpts + '</select></label>' +
        '<label class="field" for="pick-date">Election<select id="pick-date" data-pick="date">' + dateOpts + '</select></label></div>' +
        (dHTML ? '<div class="split">' + dHTML + '</div>' : '') +
        (lookup ? '<p class="small muted">Not sure? <a href="' + esc(lookup.url) + '" target="_blank" rel="noopener">' + esc(lookup.label) + '</a>' + (S.election.districtHint ? '. ' + esc(S.election.districtHint) : '.') + '</p>' : '') +
        (miss.length ? '<div class="callout warn"><p><b>Not covered yet:</b> ' + esc(miss.join(', ')) + '. Those contests won\'t appear here; check your sample ballot.</p></div>' : '') +
        '<p class="small muted">' + esc(S.election.coverageNote) + '</p>' +
      '</div></section>' +
      '<section class="panel"><div class="band"><h2>How much thinking?</h2><span class="votefor">Choose one</span></div><div class="panel-body">' +
        '<div class="efforts">' + efforts.map(function (e) {
          return '<button type="button" class="effort" data-effort="' + e[0] + '" aria-pressed="' + (st.effort === e[0]) + '"><span class="e-name"><span class="oval"></span>' + e[1] + '</span><span class="small muted">' + e[2] + '</span></button>';
        }).join('') + '</div>' +
        '<p class="small muted">You\'ve answered ' + cnt.ans + ' of ' + cnt.total + ' belief questions that apply to this ballot. Answers carry over to future elections.</p>' +
        '<div class="row"><button type="button" class="btn" data-act="start">Start</button>' +
        (Object.keys(S.beliefs.general).length ? '<button type="button" class="btn ghost" data-nav="slate">Go to my ballot</button>' : '') +
        '<button type="button" class="btn ghost" data-nav="data">Import beliefs</button></div>' +
      '</div></section>';
  }

  // ---------- question queue ----------
  function buildQueue(effort) {
    var q = [];
    var sw = E.swing(S.contests, S.beliefs, S.values);
    var useful = sw.filter(function (x) { return x.moved > 0; });
    var nGeneral = effort === 'quick' ? 3 : effort === 'standard' ? 8 : sw.length;
    var gen = (effort === 'deep' ? sw : useful).slice(0, nGeneral);
    gen.forEach(function (x) { q.push({ type: 'general', id: x.dim }); });
    if (effort !== 'quick') q.push({ type: 'specific-batch' });
    return q;
  }
  function expandSpecific() {
    // Called after general answers: decide which Part 2 questions to ask.
    rescore();
    var effort = eState().effort;
    var target = S.contests.filter(function (c) {
      var r = S.results[c.id];
      if (effort === 'deep') return true;
      return r.label === 'call' || r.label === 'none' || r.conflict || c.kind === 'retention';
    });
    return E.specificFor(target, S.values)
      .filter(function (q) { return !S.beliefs.specific[q.id]; })
      .map(function (q) { return { type: 'specific', id: q.id }; });
  }
  function startFlow() {
    var st = eState();
    S.queue = buildQueue(st.effort); S.queuePos = 0;
    advanceQueue();
  }
  function advanceQueue() {
    while (S.queuePos < S.queue.length && S.queue[S.queuePos].type === 'specific-batch') {
      var more = expandSpecific();
      S.queue.splice.apply(S.queue, [S.queuePos, 1].concat(more));
    }
    if (S.queuePos >= S.queue.length) { finishQuestions(); return; }
    setView('ask');
  }
  function finishQuestions() {
    rescore();
    var effort = eState().effort;
    if (effort === 'quick') { setView('slate'); return; }
    S.walk = S.contests.filter(function (c) {
      if (effort === 'deep') return true;
      var r = S.results[c.id];
      return r.conflict || ['call', 'none', 'lean-yes', 'lean-no', 'lean'].indexOf(r.label) >= 0 || worstQuality(c) >= 3;
    }).map(function (c) { return c.id; });
    S.walkPos = 0;
    if (S.walk.length) setView('item', { item: S.walk[0] }); else setView('slate');
  }

  function scaleHTML(d, cur) {
    var labels = ['Strongly A', 'Lean A', 'In between', 'Lean B', 'Strongly B'];
    return '<div class="scale" role="group" aria-label="Your position">' + [-2, -1, 0, 1, 2].map(function (v, i) {
      return '<button type="button" data-pos="' + v + '" aria-pressed="' + (cur && cur.pos === v) + '"><span class="oval"></span>' + labels[i] + '</button>';
    }).join('') + '</div>';
  }
  function impHTML(cur) {
    var imp = cur && typeof cur.imp === 'number' ? cur.imp : 2;
    var names = ['Doesn\'t matter', 'A little', 'Matters', 'Top issue'];
    return '<div class="chips" role="group" aria-label="How much it matters">' + names.map(function (n, i) {
      return '<button type="button" data-imp="' + i + '" aria-pressed="' + (imp === i) + '">' + n + '</button>';
    }).join('') + '</div>';
  }
  function generalQuestionHTML(d, cur, opts) {
    var touches = S.contests.filter(function (c) {
      return (c.tags || []).some(function (t) { return t.dim === d.id; }) ||
        (c.candidates || []).some(function (k) { return (k.positions || []).some(function (p) { return p.dim === d.id && p.stance; }); });
    }).map(contestTitle);
    return '<div class="panel-body">' +
      '<h4>' + esc(d.label) + '</h4>' +
      '<p style="font-size:var(--step-1);font-weight:600">' + esc(d.q) + '</p>' +
      '<div class="poles"><div class="pole"><b>A</b>' + esc(d.a) + '</div><div class="pole"><b>B</b>' + esc(d.b) + '</div></div>' +
      scaleHTML(d, cur) +
      '<div class="stack"><span class="small" style="font-weight:600">How much does this matter to you?</span>' + impHTML(cur) + '</div>' +
      (touches.length ? '<p class="small muted">On this ballot it affects: ' + esc(touches.slice(0, 6).join('; ')) + (touches.length > 6 ? '; and ' + (touches.length - 6) + ' more' : '') + '.</p>' : '') +
      (opts && opts.note !== false ? '<label class="field" for="q-note">Note to yourself (optional)<input type="text" id="q-note" value="' + esc(cur && cur.note || '') + '"></label>' : '') +
      '</div>';
  }
  function viewAsk() {
    var item = S.queue[S.queuePos];
    var total = S.queue.length, pos = S.queuePos + 1;
    var pct = Math.round((S.queuePos / Math.max(1, total)) * 100);
    var head = '<div class="progress" aria-hidden="true"><i style="width:' + pct + '%"></i></div>';
    var body;
    if (item.type === 'general') {
      var d = dimById(item.id), cur = S.draft || S.beliefs.general[item.id];
      body = '<section class="panel" data-q="general" data-id="' + d.id + '"><div class="band"><h2>Part 1 · Your values</h2><span class="votefor">Question ' + pos + ' of ' + total + '</span></div>' + generalQuestionHTML(d, cur) + '</section>';
    } else {
      var q = specById(item.id), a = S.draft || S.beliefs.specific[item.id];
      var forTitles = (q.for || []).map(contestById).filter(Boolean).concat(S.contests.filter(function (c) { return q.appliesToKind && c.kind === q.appliesToKind; })).map(contestTitle);
      body = '<section class="panel" data-q="specific" data-id="' + q.id + '"><div class="band"><h2>Part 2 · A specific question</h2><span class="votefor">Question ' + pos + ' of ' + total + '</span></div><div class="panel-body">' +
        '<p class="small muted">Your general values don\'t settle ' + esc(forTitles.join(' / ')) + ', so here\'s a direct question.</p>' +
        '<p style="font-size:var(--step-1);font-weight:600">' + esc(q.q) + '</p>' +
        '<div class="choices">' + q.options.map(function (o) {
          return '<button type="button" class="choice" data-opt="' + esc(o.v) + '" aria-pressed="' + (a && a.v === o.v) + '"><span class="oval"></span><span class="c-main"><span>' + esc(o.l) + '</span></span></button>';
        }).join('') + '</div></div></section>';
    }
    var canNext = item.type === 'general' ? (S.draft && typeof S.draft.pos === 'number') || !!S.beliefs.general[item.id] : (S.draft && S.draft.v) || !!S.beliefs.specific[item.id];
    return head + body +
      '<div class="pager"><div class="row"><button type="button" class="btn ghost" data-act="q-back"' + (S.queuePos === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button type="button" class="btn ghost" data-act="q-skip">Skip</button></div>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="q-stop">Stop and see my ballot</button>' +
      '<button type="button" class="btn" data-act="q-next"' + (canNext ? '' : ' disabled') + '>Next</button></div></div>';
  }
  function commitDraft() {
    var item = S.queue[S.queuePos];
    if (!S.draft) return;
    if (item.type === 'general') {
      var prev = S.beliefs.general[item.id] || {};
      var noteEl = $('#q-note');
      S.beliefs.general[item.id] = {
        pos: typeof S.draft.pos === 'number' ? S.draft.pos : prev.pos,
        imp: typeof S.draft.imp === 'number' ? S.draft.imp : (typeof prev.imp === 'number' ? prev.imp : 2),
        date: today(), note: noteEl ? noteEl.value : prev.note
      };
    } else {
      S.beliefs.specific[item.id] = { v: S.draft.v, date: today(), election: S.election.key };
    }
    S.draft = null; save();
  }

  // ---------- slate ----------
  function viewSlate() {
    rescore();
    var miss = uncovered();
    var matched = 0, call = 0, decided = 0, st = eState();
    S.contests.forEach(function (c) {
      var r = S.results[c.id];
      if (st.choices[c.id]) decided++;
      if (r.pick || r.label === 'skip') matched++; else call++;
    });
    var look = E.conflicts(S.contests, S.results, 3);
    var highQ = S.contests.filter(function (c) { return worstQuality(c) >= 3; }).map(function (c) { return c.id; });
    var lookHTML = '';
    if (look.length) {
      lookHTML = '<section class="callout"><h4>Worth a closer look</h4><p class="small">Your beliefs pull in different directions on these, so a closer look could change your vote.</p><div class="stack">' +
        look.map(function (id) {
          var c = contestById(id), r = S.results[id];
          var top = r.reasons.slice(0, 4);
          var pro = top.filter(function (x) { return x.contrib > 0; })[0], con = top.filter(function (x) { return x.contrib < 0; })[0];
          var why = c.kind === 'measure' && pro && con ? reasonShort(pro) + ' points Yes; ' + reasonShort(con) + ' points No.' : 'Close match between candidates on your beliefs.';
          return '<button type="button" class="linkish" data-open="' + id + '">' + esc(contestTitle(c)) + '</button><span class="small muted">' + esc(why) + '</span>';
        }).join('') + '</div></section>';
    }
    var groups = [], lastSec = null;
    S.contests.forEach(function (c) {
      var sec = sectionName(c);
      if (sec !== lastSec) { groups.push({ name: sec, items: [] }); lastSec = sec; }
      groups[groups.length - 1].items.push(c);
    });
    var list = groups.map(function (g) {
      return '<section class="panel"><h3 class="section-head">' + esc(g.name) + '</h3>' + g.items.map(function (c) {
        var ch = st.choices[c.id];
        var right = ch ? '<span class="verdict v-cand"><span class="dot"></span>' + esc(choiceText(c, ch.v)) + '</span>' : verdictHTML(c);
        return '<button type="button" class="slate-row" data-open="' + c.id + '"><span class="s-title">' + esc(contestTitle(c)) + '</span>' + right +
          '<span class="s-flags">' + flagsHTML(c) + '</span></button>';
      }).join('') + '</section>';
    }).join('');
    return '<section class="stack"><div class="summary-line"><span><b>' + S.contests.length + '</b> contests</span><span><b>' + matched + '</b> matched</span><span><b>' + call + '</b> your call</span><span><b>' + decided + '</b> decided</span></div>' +
      (miss.length ? '<p class="small muted">Not covered: ' + esc(miss.join(', ')) + '.</p>' : '') +
      '<div class="row no-print"><button type="button" class="btn" data-act="walk">Walk me through</button><button type="button" class="btn ghost" data-act="more-q">Answer more questions</button><button type="button" class="btn ghost" data-act="ai-all">Ask your AI</button><button type="button" class="btn ghost" data-nav="sheet">Cheat sheet</button></div></section>' +
      (call > 3 ? '<p class="small muted">' + call + ' items need more of your answers before Vote Helper can match them. <button type="button" class="linkish" data-act="more-q">Answer a few more questions</button></p>' : '') +
      lookHTML + list +
      (highQ.length ? '<p class="small muted">⚠ marks a measure with drafting or policy-quality concerns, shown separately from your values match.</p>' : '');
  }
  function reasonShort(x) {
    if (x.kind === 'specific') return 'your answer on this item';
    var d = dimById(x.dim); return 'your view on ' + d.label.toLowerCase();
  }

  // ---------- item / walkthrough ----------
  function reasonsHTML(c, r) {
    var rs = (r.reasons || []).slice(0, 4);
    if (!rs.length) {
      var dims = Object.keys(E.dimsTouched([c])).map(dimById).filter(Boolean).map(function (d) { return d.label.toLowerCase(); });
      return '<p class="small muted">None of your answers touch this yet.' + (dims.length ? ' It depends on: ' + esc(dims.join(', ')) + '.' : '') + ' <button type="button" class="linkish" data-ask-for="' + c.id + '">Answer those questions</button></p>';
    }
    return '<ul class="claims">' + rs.map(function (x) {
      var dir;
      if (c.kind === 'measure') dir = x.contrib > 0 ? 'points Yes' : 'points No';
      else if (c.kind === 'race') dir = x.contrib > 0 ? 'fits' : 'cuts against';
      else dir = '';
      if (x.kind === 'specific') return '<li><b>You said:</b> "' + esc(x.why) + '" ' + (dir ? '→ ' + dir : '') + '</li>';
      var d = dimById(x.dim), b = x.belief;
      var side = b.pos < 0 ? d.a : b.pos > 0 ? d.b : 'in between';
      var strength = Math.abs(b.pos) === 2 ? 'strongly' : 'lean';
      var imp = ['doesn\'t matter', 'a little', 'matters', 'top issue'][typeof b.imp === 'number' ? b.imp : 2];
      var disputed = E.auditStatus(itemAudits(c.id)).disputes.indexOf(x.dim) >= 0 ? ' <span class="flag quality">≠ a model disputes this mapping</span>' : '';
      return '<li><b>' + esc(d.label) + '</b>' + disputed + ' (you ' + strength + ': "' + esc(side) + '"; ' + imp + '). ' + esc(x.why) + ' → ' + dir + '</li>';
    }).join('') + '</ul>';
  }
  function endorseHTML(c) {
    var e = c.endorse; if (!e) return '';
    var pos = e.positions || {};
    var rows = (S.state.endorsers || []).filter(function (x) { return pos[x.id]; }).map(function (x) {
      var v = pos[x.id]; var cls = v === 'yes' ? 'v-yes' : v === 'no' ? 'v-no' : 'v-call';
      return '<tr><th>' + esc(x.name) + srcChip(null, x.src) + '</th><td class="' + cls + '" style="font-weight:700;text-transform:uppercase">' + esc(v) + '</td></tr>';
    }).join('');
    var other = (e.other || []).map(function (o) { return '<tr><th colspan="2">' + esc(o.who) + (o.s || []).map(function (s) { return srcChip(c, s); }).join('') + '</th></tr>'; }).join('');
    if (!rows && !other) return '';
    return '<div class="stack"><h4>Endorsements</h4><div style="overflow-x:auto"><table class="endorse">' + rows + other + '</table></div>' + (S.state.endorserNote ? '<p class="small muted">' + esc(S.state.endorserNote) + '</p>' : '') + '</div>';
  }
  function qualityHTML(c, r) {
    var qs = c.quality || [];
    var sevName = { high: 'Serious', med: 'Moderate', low: 'Minor', info: 'Note' };
    var lines = qs.map(function (q) {
      return '<div class="q-flag"><span class="sev">' + esc(sevName[q.sev] || q.sev) + ' · ' + esc(q.type.replace(/-/g, ' ')) + '</span><span>' + claim(c, q) + '</span></div>';
    }).join('');
    if (c.constitutional && S.state.constitutionalNote) lines += '<div class="q-flag"><span class="sev">Note · constitutional</span><span>' + esc(S.state.constitutionalNote) + '</span></div>';
    if (c.qualityNote) lines += '<p class="small muted">' + esc(c.qualityNote) + '</p>';
    if (!lines) lines = '<p class="small muted">No quality review recorded for this item.</p>';
    var mismatch = '';
    if (r.pick === 'yes' && worstQuality(c) >= 2) mismatch = '<p><b>Matches your values, but has drafting concerns.</b> Read these before deciding.</p>';
    return '<div class="callout warn"><h4>Drafting and policy quality</h4><p class="small">Separate from your values match. Each concern names a specific problem and its source.</p>' + mismatch + lines + '</div>';
  }
  function aiNoteHTML(c) {
    var a = eState().ai[c.id]; if (!a) return '';
    return '<div class="callout"><h4>Your AI\'s note (' + esc(a.date) + ')</h4><p><b>' + esc(a.suggest || '') + '</b>' + (a.confidence ? ' · ' + esc(a.confidence) + ' confidence' : '') + '</p><p class="small">' + esc(a.why || '') + '</p></div>';
  }
  function decisionHTML(c, r) {
    var st = eState(), ch = st.choices[c.id];
    var cur = ch ? ch.v : null;
    var opts;
    if (c.kind === 'measure') opts = [['yes', 'Yes', ''], ['no', 'No', ''], ['skip', 'Leave blank', '']];
    else if (c.kind === 'retention') opts = [['yes', 'Yes on all', 'Keep every justice listed'], ['no', 'No on all', ''], ['skip', 'Leave blank', '']];
    else {
      opts = c.candidates.map(function (k) { return [k.id, k.name, k.party ? (S.state.partyLabel || 'Party') + ': ' + partyName(k.party) + ' · ' + k.designation : k.designation]; });
      if (c.unopposed) opts.push(['writein', 'Write-in', 'Someone not on the ballot']);
      opts.push(['skip', 'Leave blank', '']);
    }
    var sug = c.kind === 'retention' ? (r.label === 'skip' ? 'skip' : r.pick) : r.pick;
    return '<section class="panel"><div class="band"><h3>Your vote</h3><span class="votefor">' + (c.voteFor ? 'Vote for ' + (c.voteFor === 1 ? 'One' : c.voteFor) : 'Yes or No') + '</span></div><div class="panel-body">' +
      (c.instructions ? '<p class="small"><b>' + esc(c.instructions) + '</b></p>' : '') +
      (r.multi ? '<p class="small">Vote for up to ' + r.seats + '. Tap to select or unselect.</p>' : '') +
      '<div class="choices">' + opts.map(function (o) {
        var isSug = Array.isArray(sug) ? sug.indexOf(o[0]) >= 0 : o[0] === sug;
        var isCur = Array.isArray(cur) ? cur.indexOf(o[0]) >= 0 : cur === o[0];
        var tag = isSug ? '<span class="flag conflict">Your match</span>' : '';
        return '<button type="button" class="choice" data-choose="' + esc(o[0]) + '" aria-pressed="' + isCur + '"><span class="oval"></span><span class="c-main"><span class="c-name">' + esc(o[1]) + '</span>' + (o[2] ? '<span class="c-sub">' + esc(o[2]) + '</span>' : '') + '</span>' + tag + '</button>';
      }).join('') + '</div>' +
      (ch ? '<p class="small muted">Saved ' + esc(ch.date) + (ch.agreed === false ? ' · you chose differently from your match' : '') + '. <button type="button" class="linkish" data-act="clear-choice">Clear</button></p>' : '') +
      (S.disagree && S.disagree.id === c.id ? disagreeHTML(c, r) : '') +
      '</div></section>';
  }
  function measureBody(c) {
    return '<p class="label-text">' + esc(c.label) + '</p>' +
      '<div class="stack"><h4>What it does</h4>' + claimList(c, c.summary) + '</div>' +
      '<div class="split"><div class="stack"><h4>A Yes vote means</h4><p>' + esc(c.yes) + '</p></div><div class="stack"><h4>A No vote means</h4><p>' + esc(c.no) + '</p></div></div>' +
      '<div class="stack"><h4>Fiscal impact</h4>' + claimList(c, c.fiscal) + '</div>' +
      '<div class="split"><div class="stack"><h4>For</h4>' + claimList(c, c.pro) + '</div><div class="stack"><h4>Against</h4>' + claimList(c, c.con) + '</div></div>' +
      '<div class="stack"><h4>On the ballot</h4>' + claimList(c, c.supporters) + '</div>' +
      endorseHTML(c) +
      (c.poll ? '<div class="stack"><h4>Polling</h4><p class="small">' + claim(c, c.poll) + '</p></div>' : '') +
      (c.related ? '<p class="small">Related: ' + c.related.map(function (id) { var x = contestById(id); return x ? '<button type="button" class="linkish" data-open="' + id + '">' + esc(contestTitle(x)) + '</button>' : ''; }).join(', ') + '</p>' : '');
  }
  function raceBody(c, r) {
    var maxAbs = Math.max.apply(null, [1].concat(r.candidates.map(function (k) { return Math.abs(k.score); })));
    return (c.about ? '<div class="stack"><h4>About the office</h4>' + claimList(c, c.about) + '</div>' : '') +
      (c.notes ? claimList(c, c.notes) : '') +
      '<div class="stack">' + c.candidates.map(function (k) {
        var res = r.candidates.filter(function (x) { return x.id === k.id; })[0];
        var w = Math.min(50, Math.abs(res.score) / maxAbs * 50);
        var meter = c.unopposed ? '' : '<div class="meter" title="How well this candidate fits your answers"><i style="' + (res.score >= 0 ? 'left:50%;width:' + w + '%' : 'left:' + (50 - w) + '%;width:' + w + '%') + '"></i></div>';
        return '<div class="cand"><div class="cand-head"><span class="cand-name">' + esc(k.name) + '</span><span class="small muted">' + esc(k.party ? partyName(k.party) + ' · ' : '') + esc(k.designation) + '</span></div>' + meter +
          claimList(c, (k.positions || []).concat(k.notes || [])) +
          (k.endorse ? '<p class="small"><b>Endorsed by:</b> ' + k.endorse.map(function (e) { return claim(c, { t: e.who, s: e.s, c: e.c }); }).join('; ') + '</p>' : '') +
          '</div>';
      }).join('') + '</div>' +
      (c.flags ? c.flags.map(function (f) { return '<p class="small"><span class="flag low">Thin information</span> ' + esc(f.t) + '</p>'; }).join('') : '');
  }
  function retentionBody(c) {
    var ret = S.state.retention || {};
    return claimList(c, c.about) +
      (ret.threshold && ret.threshold !== 0.5 ? '<p class="small"><b>' + Math.round(ret.threshold * 100) + '% Yes is needed to keep a judge in ' + esc(S.state.name) + '.</b></p>' : '') +
      '<div class="judge-grid">' + c.judges.map(function (j) {
        return '<div><b>' + esc(j.name) + '</b><br><span class="muted">' + esc(j.role) + '</span>' + (j.notes ? '<br>' + j.notes.map(function (n) { return claim(c, n); }).join(' ') : '') + '</div>';
      }).join('') + '</div>' +
      (c.flags ? c.flags.map(function (f) { return '<p class="small"><span class="flag low">Thin information</span> ' + esc(f.t) + '</p>'; }).join('') : '');
  }
  function viewItem() {
    var c = contestById(S.itemId); if (!c) return viewSlate();
    var r = S.results[c.id];
    var inWalk = S.walk.indexOf(c.id);
    var head = c.kind === 'measure' ? measureName() + ' ' + c.num : c.office;
    var sub = c.kind === 'measure' ? c.type : (c.voteFor ? 'Vote for ' + (c.voteFor === 1 ? 'One' : c.voteFor) : 'Yes / No');
    var conflictBox = r.conflict ? '<div class="callout"><h4>Your beliefs conflict here</h4><p class="small">Some of your answers point one way and some the other, so this is a close call. Look at the reasons below and decide which matters more to you.</p></div>' : '';
    var body = c.kind === 'measure' ? measureBody(c) : c.kind === 'retention' ? retentionBody(c) : raceBody(c, r);
    var walkNav = inWalk >= 0 ? '<div class="pager no-print"><button type="button" class="btn ghost" data-act="walk-prev"' + (inWalk === 0 ? ' disabled' : '') + '>Previous</button><span class="small muted">' + (inWalk + 1) + ' of ' + S.walk.length + '</span><button type="button" class="btn" data-act="walk-next">' + (inWalk === S.walk.length - 1 ? 'Finish' : 'Next') + '</button></div>' : '<div class="row no-print"><button type="button" class="btn ghost" data-nav="slate">Back to my ballot</button></div>';
    return walkNav +
      '<section class="panel"><div class="band"><h2>' + esc(head) + '</h2><span class="votefor">' + esc(sub) + '</span></div><div class="panel-body">' +
        (c.kind === 'measure' ? '<p style="font-size:var(--step-1);font-weight:700">' + esc(c.title) + '</p>' : '') +
        '<div class="stack"><div class="row"><h4>Your match</h4>' + verdictHTML(c, r) + '</div>' + reasonsHTML(c, r) + '</div>' +
        conflictBox +
        (c.kind === 'measure' ? qualityHTML(c, r) : '') +
        aiNoteHTML(c) +
        (E.auditStatus(itemAudits(c.id)).status === 'disagree' ? '<div class="callout warn"><p class="small"><b>≠ Models disagree.</b> Another AI model disputes parts of this entry. See "Bias check by other AI models" below.</p></div>' : '') +
        body +
        auditHTML(c) +
        '<div class="row no-print"><button type="button" class="btn ghost small" data-act="ai-one">Ask your AI about this</button></div>' +
      '</div></section>' +
      decisionHTML(c, r) + walkNav;
  }

  // ---------- disagreement ----------
  function disagreeOptions(c, r, chosen) {
    var opts = [];
    var towardSug = [], towardMine = [];
    if (c.kind === 'measure') {
      var sgn = r.pick === 'yes' ? 1 : -1;
      r.reasons.forEach(function (x) { if (Math.sign(x.contrib) === sgn) towardSug.push(x); else towardMine.push(x); });
    } else if (c.kind === 'race') {
      var sugC = r.candidates.filter(function (k) { return k.id === r.pick; })[0];
      var myC = r.candidates.filter(function (k) { return k.id === chosen; })[0];
      if (sugC) sugC.reasons.forEach(function (x) { if (x.contrib > 0) towardSug.push(x); });
      if (myC) myC.reasons.forEach(function (x) { if (x.contrib > 0) towardMine.push(x); });
    }
    towardSug.slice(0, 3).forEach(function (x) {
      if (x.kind === 'specific') { opts.push({ key: 'respec:' + x.q, type: 'specific', text: 'My answer to "' + specById(x.q).q + '" has changed' }); return; }
      var d = dimById(x.dim);
      if ((x.belief.imp == null ? 2 : x.belief.imp) > 0) opts.push({ key: 'less:' + x.dim, type: 'importance', text: '"' + d.label + '" matters less to me than you assumed' });
      opts.push({ key: 'view:' + x.dim, type: 'position', text: 'My view on "' + d.label + '" is different' });
    });
    towardMine.slice(0, 2).forEach(function (x) {
      if (x.kind === 'specific') return;
      var d = dimById(x.dim);
      if ((x.belief.imp == null ? 2 : x.belief.imp) < 3) opts.push({ key: 'more:' + x.dim, type: 'importance', text: '"' + d.label + '" matters more to me' });
    });
    Object.keys(E.dimsTouched([c])).forEach(function (dim) {
      if (!S.beliefs.general[dim] && dimById(dim)) opts.push({ key: 'view:' + dim, type: 'position', text: 'Something you haven\'t asked about: "' + dimById(dim).label + '"' });
    });
    opts.push({ key: 'special', type: 'special', text: 'This one is a special case. Don\'t change my profile.' });
    if (c.kind === 'measure') opts.push({ key: 'quality', type: 'quality', text: 'How it\'s written (drafting or policy quality)' });
    opts.push({ key: 'other', type: 'other', text: 'Something else (explain below)' });
    var seen = {};
    return opts.filter(function (o) { if (seen[o.key]) return false; seen[o.key] = 1; return true; });
  }
  function disagreeHTML(c, r) {
    var D = S.disagree;
    var opts = disagreeOptions(c, r, D.chosen);
    var sel = D.key;
    var extra = '';
    if (sel && sel.indexOf('view:') === 0) {
      var dim = sel.slice(5), d = dimById(dim);
      extra = '<div class="stack" data-q="general" data-id="' + dim + '"><div class="poles"><div class="pole"><b>A</b>' + esc(d.a) + '</div><div class="pole"><b>B</b>' + esc(d.b) + '</div></div>' + scaleHTML(d, D.draft || S.beliefs.general[dim]) + impHTML(D.draft || S.beliefs.general[dim]) + '</div>';
    }
    if (sel && sel.indexOf('respec:') === 0) {
      var q = specById(sel.slice(7)), a = D.draft || S.beliefs.specific[q.id];
      extra = '<div class="choices" data-q="specific" data-id="' + q.id + '">' + q.options.map(function (o) {
        return '<button type="button" class="choice" data-opt="' + esc(o.v) + '" aria-pressed="' + (a && a.v === o.v) + '"><span class="oval"></span><span class="c-main"><span>' + esc(o.l) + '</span></span></button>';
      }).join('') + '</div>';
    }
    var preview = sel ? '<p class="small"><b>What changes:</b> ' + esc(describeChange(sel, D)) + '</p>' : '';
    return '<div class="callout" id="disagree"><h4>You chose differently. Why?</h4><p class="small">Your reason helps Vote Helper understand you better next time.</p>' +
      '<div class="radio-list">' + opts.map(function (o, i) {
        return '<label for="dg-' + i + '"><input type="radio" name="dg" id="dg-' + i + '" value="' + esc(o.key) + '"' + (sel === o.key ? ' checked' : '') + '><span>' + esc(o.text) + '</span></label>';
      }).join('') + '</div>' + extra +
      '<label class="field" for="dg-note">Your reason in your own words (optional)<input type="text" id="dg-note" value="' + esc(D.note || '') + '"></label>' + preview +
      '<div class="row"><button type="button" class="btn" data-act="dg-save"' + (sel ? '' : ' disabled') + '>Save my reason</button><button type="button" class="btn ghost" data-act="dg-skip">Skip</button></div></div>';
  }
  function describeChange(key, D) {
    var parts = key.split(':');
    var names = ['doesn\'t matter', 'a little', 'matters', 'top issue'];
    if (parts[0] === 'less' || parts[0] === 'more') {
      var b = S.beliefs.general[parts[1]], cur = b.imp == null ? 2 : b.imp;
      var nxt = Math.max(0, Math.min(3, cur + (parts[0] === 'more' ? 1 : -1)));
      return 'Importance of "' + dimById(parts[1]).label + '": ' + names[cur] + ' → ' + names[nxt] + '. Other items that touch it will update too.';
    }
    if (parts[0] === 'view') return 'Your answer on "' + dimById(parts[1]).label + '" will be updated with what you pick above.';
    if (parts[0] === 'respec') return 'Your answer to this item\'s specific question will be updated.';
    if (parts[0] === 'quality') return 'Only this item. The reason is logged as a quality concern.';
    return 'Only this item. Your reason is logged.';
  }
  function saveDisagree() {
    var D = S.disagree, c = contestById(D.id), key = D.key, parts = key.split(':');
    var note = ($('#dg-note') || {}).value || '';
    var change = null;
    if (parts[0] === 'less' || parts[0] === 'more') {
      var b = S.beliefs.general[parts[1]], cur = b.imp == null ? 2 : b.imp;
      var nxt = Math.max(0, Math.min(3, cur + (parts[0] === 'more' ? 1 : -1)));
      change = { dim: parts[1], field: 'imp', from: cur, to: nxt };
      b.imp = nxt; b.date = today();
    } else if (parts[0] === 'view' && D.draft) {
      var prev = S.beliefs.general[parts[1]];
      var nb = { pos: typeof D.draft.pos === 'number' ? D.draft.pos : (prev ? prev.pos : 0), imp: typeof D.draft.imp === 'number' ? D.draft.imp : (prev && prev.imp != null ? prev.imp : 2), date: today() };
      change = { dim: parts[1], field: 'belief', from: prev || null, to: nb };
      S.beliefs.general[parts[1]] = nb;
    } else if (parts[0] === 'respec' && D.draft) {
      change = { q: parts[1], field: 'specific', from: S.beliefs.specific[parts[1]] || null, to: D.draft.v };
      S.beliefs.specific[parts[1]] = { v: D.draft.v, date: today(), election: S.election.key };
    }
    var dec = S.beliefs.decisions.filter(function (d) { return d.election === S.election.key && d.contest === c.id; }).slice(-1)[0];
    if (dec) { dec.reasonType = parts[0]; dec.reasonKey = key; dec.note = note; dec.change = change; }
    if (change) S.beliefs.history.push({ date: today(), change: change, because: contestTitle(c), note: note });
    S.disagree = null; save(); rescore();
    toast(change ? 'Saved. Your profile was updated.' : 'Saved your reason.');
    render();
  }
  function sameChoice(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return [].concat(a || []).slice().sort().join(',') === [].concat(b || []).slice().sort().join(',');
    return a === b;
  }
  function choose(c, v) {
    var r = S.results[c.id];
    if (r.multi && v !== 'skip') {
      // Toggle a candidate in a multi-seat race, up to the number of seats.
      var prev = eState().choices[c.id], cur = prev && Array.isArray(prev.v) ? prev.v.slice() : [];
      var i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1); else if (cur.length < r.seats) cur.push(v); else { toast('You can pick up to ' + r.seats); return; }
      v = cur;
    }
    var sug = c.kind === 'retention' ? (r.label === 'skip' ? 'skip' : r.pick) : r.pick;
    var agreed = sug ? sameChoice(sug, v) : null;
    eState().choices[c.id] = { v: v, date: today(), suggested: sug || null, agreed: agreed };
    S.beliefs.decisions.push({ date: today(), election: S.election.key, contest: c.id, suggested: sug || null, chose: v, agreed: agreed });
    save();
    if (agreed === false && v !== 'skip' && c.kind !== 'retention' && !r.multi) S.disagree = { id: c.id, chosen: v, key: null, draft: null };
    else S.disagree = null;
    render();
    if (S.disagree) { var el = $('#disagree'); if (el) el.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- cross-model bias audit ----------
  // Two rounds, both built only from the data files (never from other models' replies):
  //   blind    = official ballot text + belief list; the model maps items itself; the app compares.
  //   critique = Claude's full write-up and belief questions; the model points out bias and errors.
  var AUDIT_MODELS = [['chatgpt', 'ChatGPT', 'https://chatgpt.com/'], ['grok', 'Grok', 'https://grok.com/'], ['gemini', 'Gemini', 'https://gemini.google.com/'], ['other', 'Other model', '']];
  var PART_CHARS = 14000;
  function modelLabel(k) {
    var blind = /~blind$/.test(k), base = k.replace(/~blind$/, '');
    var m = AUDIT_MODELS.filter(function (x) { return x[0] === base; })[0];
    return (m ? m[1] : base) + (blind ? ' (blind)' : '');
  }
  function auditStore() { var ek = S.election.key; S.audits[ek] = S.audits[ek] || {}; return S.audits[ek]; }
  function sourcesFor(c) {
    var srcIds = {}, out = {};
    JSON.stringify(c, function (k, v) { if (k === 's' && Array.isArray(v)) v.forEach(function (x) { srcIds[x] = 1; }); return v; });
    Object.keys(srcIds).forEach(function (k) { var x = S.sources[c._file + ':' + k] || S.sources['state:' + k]; if (x) out[k] = x.pub + ': ' + x.title + ' <' + x.url + '>'; });
    return out;
  }
  function questionsFor(c, withEffects) {
    return E.specificFor([c], S.values).map(function (q) {
      return { id: q.id, question: q.q, options: q.options.map(function (o) {
        var fx = o.fx && (o.fx[c.id] != null ? o.fx[c.id] : o.fx['*' + c.kind]);
        return withEffects ? { answer: o.l, effectOnThisItem: fx == null ? 'none' : fx } : o.l;
      }) };
    });
  }
  function beliefList() {
    return S.values.general.map(function (d) { return { id: d.id, label: d.label, question: d.q, sideA: d.a, sideB: d.b }; });
  }
  // Critique payload: Claude's full entry.
  function critiqueItem(c) {
    var item = JSON.parse(JSON.stringify(c, function (k, v) { return k === '_file' || k === 'order' ? undefined : v; }));
    item.followUpQuestions = questionsFor(c, true);
    item.sources = sourcesFor(c);
    return item;
  }
  // Blind payload: only what's printed on the official ballot, none of Claude's judgments.
  function blindItem(c) {
    var official = function (arr) { return (arr || []).filter(function (x) { return (x.s || []).indexOf('ballot') >= 0; }).map(function (x) { return x.t; }); };
    var o = { id: c.id, kind: c.kind };
    if (c.kind === 'measure') {
      o.number = c.num; o.officialLabel = c.label; o.type = c.type;
      o.officialText = c.ballotText ? [c.ballotText.t] : official(c.summary).concat(official(c.fiscal)).concat(official(c.supporters));
    } else if (c.kind === 'retention') {
      o.office = c.office; o.judges = (c.judges || []).map(function (j) { return j.name + ' (' + j.role + ')'; });
    } else {
      o.office = c.office; o.voteFor = c.voteFor || 1;
      o.candidates = (c.candidates || []).map(function (k) { return { id: k.id, name: k.name, party: k.party ? partyName(k.party) : undefined, ballotDesignation: k.designation }; });
    }
    var qs = questionsFor(c, false);
    if (qs.length) o.followUpQuestionsAsked = qs;
    return o;
  }
  function parts(mode) {
    var list = [], cur = null;
    // Each part repeats the instructions (and, in the blind round, the belief list), so budget for them.
    var overhead = (mode === 'blind' ? JSON.stringify(beliefList(), null, 1).length : 0) + 3500;
    var budget = Math.max(4000, PART_CHARS - overhead);
    if (mode === 'critique') {
      list.push({ id: 'beliefs', title: 'Belief questions', beliefs: true, items: [] });
    }
    S.contests.forEach(function (c) {
      var size = JSON.stringify(mode === 'blind' ? blindItem(c) : critiqueItem(c)).length;
      if (!cur || cur.size + size > budget) { cur = { id: 'p' + list.length, title: '', items: [], size: 0 }; list.push(cur); }
      cur.items.push(c.id); cur.size += size;
    });
    list.forEach(function (p) {
      if (p.beliefs) return;
      var first = contestById(p.items[0]), last = contestById(p.items[p.items.length - 1]);
      p.title = contestTitle(first) + (p.items.length > 1 ? ' … ' + contestTitle(last) : '');
    });
    return list;
  }
  var CRITIQUE_RULES = [
    'Check each of these:',
    '1. Framing: is any wording in the summary, Yes/No meaning, fiscal text, pros or cons slanted toward one side? Quote the words.',
    '2. Arguments: are the strongest arguments on both sides present and fairly stated? Name any major missing argument and who makes it.',
    '3. Facts: flag anything you believe is wrong or outdated. Only flag what you can support, say when you\'re unsure, and cite a source if you can.',
    '4. Belief mappings: each "tag" says which belief a Yes vote moves ("yes": +1 toward side B, -1 toward side A) and how strongly ("w": 1-3). For candidates, each position has a "stance" from -1 (side A) to +1 (side B). Follow-up questions show how each answer moves the item (positive = toward Yes or toward that candidate). Are any directions wrong, weights off, or mappings missing?',
    '5. Quality flags: are any unsupported, one-sided, or held to a different standard than you would apply to a similar measure favored by the other side? Are real drafting problems missing?',
    '6. Overall lean: does the entry lean left, right, toward Yes, or toward No?'
  ];
  var BELIEF_RULES = [
    'Also review the BELIEF QUESTIONS that voters answer. For each: is the question or either side (A/B) worded to make one answer sound better? Is either side a straw man? Is anything important missing from the list for this ballot?'
  ];
  function independenceNote() {
    return 'Work independently. Don\'t look up or rely on other AI tools\' reviews of this guide. If you have memory of earlier conversations about Vote Helper, ignore it.';
  }
  function critiquePrompt(part, total, index) {
    var items = part.items.map(contestById).map(critiqueItem);
    var lines = [
      'You are reviewing a nonpartisan voter guide written by another AI model (Claude) for Vote Helper, a ballot advisor. Your job is to find bias, errors and gaps. Don\'t say how to vote. ' + independenceNote(),
      '',
      'Ballot: ' + S.election.name + ', ' + S.election.area + '.' + (total > 1 ? ' This is part ' + (index + 1) + ' of ' + total + '; review only what\'s here.' : ''),
      ''
    ];
    if (part.beliefs || part.all) lines = lines.concat(BELIEF_RULES, ['', 'BELIEF QUESTIONS (JSON):', JSON.stringify(beliefList(), null, 1), '']);
    if (items.length) lines = lines.concat(['For each ballot entry:'], CRITIQUE_RULES, ['Be specific and brief. If an entry is fair and accurate, say so.', '', 'BALLOT ENTRIES (JSON):', JSON.stringify(items, null, 1), '']);
    lines = lines.concat([
      'End your reply with exactly one JSON block in this format:',
      '```json',
      '{"voteHelperAudit": 1, "items": [{"id": "<entry id>", "verdict": "agree | minor | major", "lean": "none | left | right | yes | no | unclear", "issues": [{"area": "framing | arguments | facts | tags | quality | candidates", "severity": "minor | major", "detail": "...", "fix": "..."}], "tags": [{"dim": "<belief id>", "agree": true, "direction": -1, "weight": 3, "note": ""}]}]' +
        (part.beliefs || part.all ? ', "beliefQuestions": [{"id": "<belief id>", "verdict": "agree | minor | major", "lean": "none | left | right | unclear", "issue": "...", "fix": "..."}], "missingBeliefs": [{"label": "...", "why": "..."}]' : '') + '}',
      '```',
      'Include every entry' + (part.beliefs || part.all ? ' and every belief question' : '') + ' you were given. verdict: agree = fair and accurate; minor = small fixes; major = biased, wrong, or missing something important.'
    ]);
    return lines.join('\n');
  }
  function blindPrompt(part, total, index) {
    var items = part.items.map(contestById).map(blindItem);
    return [
      'You are helping test a nonpartisan ballot advisor for bias. Below are items from an official ballot and a list of belief questions voters answer. Without any other write-up to go on, decide for each item which beliefs it touches and which way. Don\'t say how to vote. ' + independenceNote(),
      '',
      'Ballot: ' + S.election.name + ', ' + S.election.area + '.' + (total > 1 ? ' This is part ' + (index + 1) + ' of ' + total + '.' : ''),
      '',
      'For each MEASURE: list the beliefs a Yes vote moves. "yes": +1 means a Yes vote moves toward side B of that belief, -1 toward side A. "w" is how strongly, 1 (slightly) to 3 (centrally). Only include beliefs it clearly touches.',
      'For each CANDIDATE RACE: for beliefs where you know a candidate\'s record or stated positions, give "stance" from -1 (side A) to +1 (side B). Skip what you don\'t know; don\'t guess from party alone except for the "party" belief.',
      'For any item, note real drafting or policy-quality problems you know of (vague terms, loopholes, title that doesn\'t match the effect, conflicting measures), each with a specific reason.',
      'Finally, list any belief a voter would need for this ballot that the list is missing.',
      '',
      'BELIEF QUESTIONS (JSON):',
      JSON.stringify(beliefList(), null, 1),
      '',
      'BALLOT ITEMS (JSON):',
      JSON.stringify(items, null, 1),
      '',
      'End your reply with exactly one JSON block in this format:',
      '```json',
      '{"voteHelperBlind": 1, "items": [{"id": "<item id>", "tags": [{"dim": "<belief id>", "yes": 1, "w": 2}], "stances": [{"candidate": "<candidate id>", "dim": "<belief id>", "stance": -1}], "quality": [{"type": "...", "detail": "..."}]}], "missingBeliefs": [{"label": "...", "why": "..."}]}',
      '```',
      'Include every item you were given.'
    ].join('\n');
  }
  function promptFor(mode, part, total, index) { return mode === 'blind' ? blindPrompt(part, total, index) : critiquePrompt(part, total, index); }
  function allParts(mode, split) {
    if (split) return parts(mode);
    return [{ id: 'all', title: 'Whole ballot', all: mode === 'critique', items: S.contests.map(function (c) { return c.id; }) }];
  }

  // Pull the JSON object containing a marker key out of a pasted reply.
  function extractJSON(text, marker) {
    try { var whole = JSON.parse(text); if (whole && whole[marker] != null) return whole; } catch (e) {}
    var i = text.indexOf('"' + marker + '"'); if (i < 0) return null;
    var start = text.lastIndexOf('{', i); if (start < 0) return null;
    var depth = 0, inStr = false, escNext = false;
    for (var j = start; j < text.length; j++) {
      var ch = text[j];
      if (inStr) { if (escNext) escNext = false; else if (ch === '\\') escNext = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, j + 1)); } catch (e) { return null; } } }
    }
    return null;
  }
  // Save a pasted reply. Accepts critique or blind replies, for one item or many.
  function saveReply(model, text, fallbackItem) {
    var store = auditStore(), date = today(), n = 0;
    var put = function (cid, key, rec) { store[cid] = store[cid] || {}; store[cid][key] = rec; n++; };
    var app = function (key, extra) { store._app = store._app || {}; store._app[key] = Object.assign(store._app[key] || {}, extra, { date: date }); };
    var crit = extractJSON(text, 'voteHelperAudit');
    if (crit) {
      var items = Array.isArray(crit.items) ? crit.items : (crit.item ? [crit] : []);
      items.forEach(function (it) {
        var cid = it.id || it.item || fallbackItem; if (!contestById(cid)) return;
        put(cid, model, { model: model, mode: 'critique', date: date,
          verdict: ['agree', 'minor', 'major'].indexOf(it.verdict) >= 0 ? it.verdict : 'minor', lean: it.lean || 'unclear',
          issues: Array.isArray(it.issues) ? it.issues.slice(0, 20) : [], tags: Array.isArray(it.tags) ? it.tags.slice(0, 30) : [] });
      });
      if (crit.beliefQuestions || crit.missingBeliefs) app(model, { beliefQuestions: crit.beliefQuestions || [], missingBeliefs: crit.missingBeliefs || [] });
      saveAudits(); return { mode: 'critique', n: n };
    }
    var blind = extractJSON(text, 'voteHelperBlind');
    if (blind) {
      (blind.items || []).forEach(function (it) {
        var cid = it.id || fallbackItem, c = contestById(cid); if (!c) return;
        var rec = E.compareBlind(c, it);
        rec.model = model; rec.date = date; rec.blindRaw = it;
        put(cid, model + '~blind', rec);
      });
      if (blind.missingBeliefs) app(model + '~blind', { missingBeliefs: blind.missingBeliefs });
      saveAudits(); return { mode: 'blind', n: n };
    }
    if (fallbackItem && contestById(fallbackItem)) {
      put(fallbackItem, model, { model: model, mode: 'critique', date: date, verdict: 'unparsed', issues: [], tags: [], raw: text.slice(0, 6000) });
      saveAudits(); return { mode: 'unparsed', n: 1 };
    }
    return { mode: 'none', n: 0 };
  }
  function receivedBy(part, mode) {
    var store = auditStore(), got = [];
    AUDIT_MODELS.forEach(function (m) {
      var key = mode === 'blind' ? m[0] + '~blind' : m[0];
      var items = part.items.every(function (id) { return store[id] && store[id][key]; });
      var beliefsOk = !(part.beliefs || part.all) || (store._app && store._app[key] && store._app[key].beliefQuestions);
      if (items && beliefsOk && (part.items.length || part.beliefs)) got.push(m[1]);
    });
    return got;
  }
  function modelSelect(id) {
    return '<select id="' + id + '">' + AUDIT_MODELS.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('') + '</select>';
  }
  function modelLinks() {
    return AUDIT_MODELS.filter(function (m) { return m[2]; }).map(function (m) { return '<a class="small" href="' + m[2] + '" target="_blank" rel="noopener">Open ' + m[1] + '</a>'; }).join(' · ');
  }

  // Whole-app view.
  function viewAudit() {
    var mode = S.auditMode || 'blind', split = S.auditSplit !== false;
    var list = allParts(mode, split);
    var store = auditStore();
    var partRows = list.map(function (p, i) {
      var text = promptFor(mode, p, list.length, i);
      var got = receivedBy(p, mode);
      return '<div class="sh-row"><span class="sh-office">' + (list.length > 1 ? 'Part ' + (i + 1) + ' of ' + list.length + ': ' : '') + esc(p.title) +
        '<br><span class="small muted">' + (p.items.length ? p.items.length + ' items · ' : '') + Math.round(text.length / 1000) + 'k characters' + (got.length ? ' · received from ' + esc(got.join(', ')) : '') + '</span></span>' +
        '<span class="sh-pick"><button type="button" class="btn small" data-copy-part="' + i + '">Copy</button></span>' +
        '<textarea class="part-text" id="part-' + i + '" readonly hidden>' + esc(text) + '</textarea></div>';
    }).join('');
    // Results
    var rows = S.contests.map(function (c) {
      var a = itemAudits(c.id), st = E.auditStatus(a);
      var chips = Object.keys(a).map(function (k) {
        var m = st.byModel[k] || {};
        return '<span class="flag ' + (m.level === 'disagree' ? 'quality' : m.level === 'agree' ? 'decided' : 'low') + '">' + esc(modelLabel(k)) + '</span>';
      }).join(' ');
      return '<button type="button" class="slate-row" data-open="' + c.id + '"><span class="s-title">' + esc(contestTitle(c)) + '</span>' +
        (st.status === 'disagree' ? '<span class="flag quality">≠ Models disagree</span>' : st.count ? '<span class="flag decided">' + st.count + ' review' + (st.count > 1 ? 's' : '') + '</span>' : '<span class="small muted">Not reviewed</span>') +
        '<span class="s-flags">' + chips + '</span></button>';
    }).join('');
    var appNotes = Object.keys(store._app || {}).map(function (k) {
      var a = store._app[k];
      var bq = (a.beliefQuestions || []).filter(function (q) { return q.verdict && q.verdict !== 'agree'; }).map(function (q) {
        var d = dimById(q.id);
        return '<li><b>' + esc(d ? d.label : q.id) + '</b> <span class="sev">' + esc(q.verdict + (q.lean && q.lean !== 'none' ? ' · leans ' + q.lean : '')) + '</span> ' + esc(q.issue || '') + (q.fix ? ' <span class="muted">Fix: ' + esc(q.fix) + '</span>' : '') + '</li>';
      }).join('');
      var mb = (a.missingBeliefs || []).map(function (m) { return '<li>Missing: <b>' + esc(m.label) + '</b>. ' + esc(m.why || '') + '</li>'; }).join('');
      if (!bq && !mb) return '<p class="small"><b>' + esc(modelLabel(k)) + '</b>: no problems with the belief questions.</p>';
      return '<div class="stack"><b>' + esc(modelLabel(k)) + '</b> <span class="small muted">' + esc(a.date) + '</span><ul class="claims small">' + bq + mb + '</ul></div>';
    }).join('');
    var nDis = S.contests.filter(function (c) { return E.auditStatus(itemAudits(c.id)).status === 'disagree'; }).length;
    var nRev = S.contests.filter(function (c) { return E.auditStatus(itemAudits(c.id)).count; }).length;
    return '<section class="panel"><div class="band"><h2>Bias check</h2><span class="votefor">Whole app</span></div><div class="panel-body">' +
      '<p>Everything Vote Helper says about this ballot, plus the belief questions themselves, was written by Claude. Ask other AI models to check it.</p>' +
      '<div class="callout"><h4>Keeping each model independent</h4><ul class="claims small">' +
        '<li>Prompts are built only from the guide\'s data. They never include another model\'s replies, or your beliefs.</li>' +
        '<li><b>Round 1 (blind)</b> gives the model only the official ballot text and the belief list. It maps each item itself, then Vote Helper compares its answers with Claude\'s. Do this round first.</li>' +
        '<li><b>Round 2 (critique)</b> shows the model Claude\'s full write-up and belief questions and asks what\'s slanted, missing or wrong.</li>' +
        '<li>Use a fresh temporary or private chat for each part (ChatGPT: Temporary Chat; Grok: Private chat) so earlier answers and memory don\'t carry over.</li>' +
      '</ul></div>' +
      '<div class="stack"><span class="small" style="font-weight:600">Round</span><div class="chips">' +
        '<button type="button" data-audit-mode="blind" aria-pressed="' + (mode === 'blind') + '">1 · Blind</button>' +
        '<button type="button" data-audit-mode="critique" aria-pressed="' + (mode === 'critique') + '">2 · Critique</button></div></div>' +
      '<div class="stack"><span class="small" style="font-weight:600">Size</span><div class="chips">' +
        '<button type="button" data-audit-split="1" aria-pressed="' + split + '">Split into parts (free tiers)</button>' +
        '<button type="button" data-audit-split="0" aria-pressed="' + !split + '">One paste</button></div>' +
        '<p class="small muted">Free tiers often cut off long messages or long replies. Split keeps each part around ' + Math.round(PART_CHARS / 1000) + 'k characters.</p></div>' +
      '<div class="row">' + modelLinks() + '</div>' +
      '</div>' + partRows + '</section>' +
      '<section class="panel"><div class="band"><h2>Paste a reply</h2></div><div class="panel-body">' +
        '<label class="field" for="audit-model-all">Which model answered?' + modelSelect('audit-model-all') + '</label>' +
        '<label class="field" for="audit-reply-all">Its whole reply (any part, either round)<textarea id="audit-reply-all" placeholder="Paste here"></textarea></label>' +
        '<div class="row"><button type="button" class="btn" data-act="save-reply-all">Save reply</button></div>' +
        (S.auditMsg ? '<p class="small">' + esc(S.auditMsg) + '</p>' : '') +
      '</div></section>' +
      '<section class="panel"><div class="band"><h2>Results</h2><span class="votefor">' + nRev + ' of ' + S.contests.length + ' reviewed · ' + nDis + ' disputed</span></div>' +
        (appNotes ? '<div class="panel-body"><h4>Belief questions</h4>' + appNotes + '</div>' : '') + rows + '</section>' +
      '<div class="row"><button type="button" class="btn ghost" data-nav="data">Export replies</button></div>';
  }

  // Per-item panel.
  function auditHTML(c) {
    var audits = itemAudits(c.id), st = E.auditStatus(audits);
    var headline = {
      none: 'Not checked by another model yet.',
      agree: 'Other models found this entry fair.',
      minor: 'Other models suggested small fixes.',
      'split-minor': 'Models differ slightly: one found it fair, another suggested small fixes.',
      disagree: 'Models disagree with parts of this entry. Read their objections before relying on it.',
      unparsed: 'A reply was saved but had no JSON block; read it below.'
    }[st.status];
    var verdictName = { agree: 'Fair', minor: 'Small fixes', major: 'Major problems', unparsed: 'Unparsed' };
    var blocks = Object.keys(audits).map(function (k) {
      var a = audits[k], m = st.byModel[k] || {};
      var issues = (a.issues || []).map(function (i) {
        return '<li><span class="sev">' + esc((i.severity || '') + ' · ' + (i.area || '')) + '</span> ' + esc(i.detail || '') + (i.fix ? ' <span class="muted">Suggested fix: ' + esc(i.fix) + '</span>' : '') + '</li>';
      }).join('');
      var tagLines = (a.tags || []).filter(function (t) { return t && t.agree === false; }).map(function (t) {
        var d = dimById(t.dim);
        return '<li><b>' + esc(d ? d.label : t.dim) + '</b>: ' + (a.mode === 'blind' ? 'its own mapping differs' : 'disputes the mapping') + (t.direction != null ? ' (direction ' + esc(t.direction) + ')' : '') + (t.weight != null ? ', weight ' + esc(t.weight) : '') + (t.note ? '. ' + esc(t.note) : '') + '</li>';
      }).join('');
      var chip = a.mode === 'blind' ? (m.level === 'disagree' ? 'Mapped it differently' : m.level === 'agree' ? 'Same mapping' : 'Mostly the same') :
        (a.verdict !== 'major' && m.tagDisputes && m.tagDisputes.length ? 'Disputes a mapping' : (verdictName[a.verdict] || a.verdict));
      return '<div class="stack" style="border-top:1px solid var(--rule);padding-top:8px">' +
        '<div class="row"><b>' + esc(modelLabel(k)) + '</b><span class="flag ' + (m.level === 'disagree' ? 'quality' : m.level === 'agree' ? 'decided' : 'low') + '">' + esc(chip) + '</span>' +
        (m.leaning ? '<span class="flag quality">Sees a lean: ' + esc(m.leaning) + '</span>' : '') + '<span class="small muted">' + esc(a.date) + '</span>' +
        '<button type="button" class="linkish small" data-audit-del="' + esc(k) + '">Remove</button></div>' +
        (issues ? '<ul class="claims small">' + issues + '</ul>' : '') +
        (tagLines ? '<ul class="claims small">' + tagLines + '</ul>' : '') +
        (a.verdict === 'unparsed' ? '<details><summary class="small">Show reply</summary><p class="small" style="white-space:pre-wrap">' + esc(a.raw) + '</p></details>' : '') +
        '</div>';
    }).join('');
    var one = { id: 'one', title: contestTitle(c), items: [c.id] };
    var open = st.status === 'disagree' || (S.auditOpen === c.id);
    return '<details class="callout' + (st.status === 'disagree' ? ' warn' : '') + '"' + (open ? ' open' : '') + ' id="audit-box"><summary><h4 style="display:inline">Bias check by other AI models' + (st.count ? ' (' + st.count + ')' : '') + '</h4></summary>' +
      '<p class="small">' + esc(headline) + ' Claude wrote this entry. Use a fresh temporary chat; prompts never include other models\' replies or your beliefs. <button type="button" class="linkish" data-nav="audit">Check the whole app at once</button></p>' +
      blocks +
      '<div class="stack no-print"><div class="row"><button type="button" class="btn small" data-copy-item="blind">Copy blind prompt</button><button type="button" class="btn small ghost" data-copy-item="critique">Copy critique prompt</button></div>' +
      '<div class="row">' + modelLinks() + '</div>' +
      '<textarea id="item-prompt-blind" readonly hidden>' + esc(blindPrompt(one, 1, 0)) + '</textarea>' +
      '<textarea id="item-prompt-critique" readonly hidden>' + esc(critiquePrompt(one, 1, 0)) + '</textarea>' +
      '<label class="field" for="audit-model">Which model answered?' + modelSelect('audit-model') + '</label>' +
      '<label class="field" for="audit-reply">Paste its whole reply<textarea id="audit-reply" placeholder="Paste here"></textarea></label>' +
      '<div class="row"><button type="button" class="btn small" data-act="save-audit">Save reply</button></div></div>' +
      '</details>';
  }

  // ---------- cheat sheet ----------
  function sheetRows() {
    var rows = [];
    S.contests.forEach(function (c) {
      var ch = choiceFor(c);
      rows.push({ c: c, v: ch.v, mine: ch.mine });
    });
    return rows;
  }
  function viewSheet() {
    rescore();
    var rows = sheetRows(), lastSec = null, html = '';
    rows.forEach(function (x) {
      var sec = sectionName(x.c);
      if (sec !== lastSec) { html += '<h3 class="section-head">' + esc(sec) + '</h3>'; lastSec = sec; }
      var pick = x.v ? '<span class="oval filled"></span>' + esc(choiceText(x.c, x.v)) : '<span class="oval"></span><span class="unreviewed">Undecided</span>';
      var note = '';
      if (!x.mine && x.v) note = '<span class="sh-note">Your match; not reviewed yet</span>';
      if (x.c.sheetNote) note += '<span class="sh-note">' + esc(x.c.sheetNote) + '</span>';
      if (x.c.kind === 'retention' && x.v && x.v !== 'skip') note += '<span class="sh-note">' + esc(x.c.judges.map(function (j) { return j.name; }).join(', ')) + '</span>';
      html += '<div class="sh-row"><span class="sh-office">' + esc(contestTitle(x.c)) + '</span><span class="sh-pick">' + pick + '</span>' + note + '</div>';
    });
    var undecided = rows.filter(function (x) { return !x.v; }).length, unrev = rows.filter(function (x) { return x.v && !x.mine; }).length;
    return '<section class="stack no-print"><p>Your picks in ballot order. Take this with you or copy it into your notes; it never leaves your device unless you share it.</p>' +
      '<p class="small muted">' + undecided + ' undecided · ' + unrev + ' suggested but not reviewed.</p>' +
      '<div class="row">' + (IN_FRAME ? '' : '<button type="button" class="btn" data-act="print">Print</button>') + '<button type="button" class="btn ghost" data-act="copy-sheet">Copy as text</button></div></section>' +
      '<section class="sheet"><div class="band"><h2>Ballot cheat sheet</h2><span class="votefor">' + esc(S.election.date) + '</span></div>' + html + '</section>';
  }
  function sheetText() {
    var lines = ['VOTE HELPER CHEAT SHEET · ' + S.election.name, ''];
    var lastSec = null;
    sheetRows().forEach(function (x) {
      var sec = sectionName(x.c);
      if (sec !== lastSec) { lines.push('', sec.toUpperCase()); lastSec = sec; }
      lines.push(contestTitle(x.c) + ': ' + (x.v ? choiceText(x.c, x.v) : 'undecided') + (x.mine || !x.v ? '' : ' (suggested)') + (x.c.sheetNote ? ' [' + x.c.sheetNote + ']' : ''));
    });
    return lines.join('\n');
  }

  // ---------- profile ----------
  function viewProfile() {
    var g = S.values.general.map(function (d) {
      var b = S.beliefs.general[d.id];
      var val = b ? ['Strongly A', 'Lean A', 'In between', 'Lean B', 'Strongly B'][b.pos + 2] + ' · ' + ['doesn\'t matter', 'a little', 'matters', 'top issue'][b.imp == null ? 2 : b.imp] + ' · ' + b.date : 'Not answered';
      return '<div class="sh-row"><span class="sh-office">' + esc(d.label) + '<br><span class="small muted">A: ' + esc(d.a) + ' / B: ' + esc(d.b) + '</span></span><span class="sh-pick small">' + esc(val) + ' <button type="button" class="btn ghost small" data-edit="' + d.id + '">' + (b ? 'Edit' : 'Answer') + '</button></span></div>';
    }).join('');
    var sp = S.values.specific.map(function (q) {
      var a = S.beliefs.specific[q.id];
      var opt = a ? q.options.filter(function (o) { return o.v === a.v; })[0] : null;
      return '<div class="sh-row"><span class="sh-office small">' + esc(q.q) + '</span><span class="sh-pick small">' + esc(opt ? opt.l + ' · ' + a.date : 'Not answered') + ' <button type="button" class="btn ghost small" data-edit-spec="' + q.id + '">' + (a ? 'Edit' : 'Answer') + '</button></span></div>';
    }).join('');
    var hist = S.beliefs.history.slice(-12).reverse().map(function (h) {
      var what = h.change.dim ? dimById(h.change.dim).label + (h.change.field === 'imp' ? ' importance ' + h.change.from + ' → ' + h.change.to : ' answer updated') : 'Specific answer updated';
      return '<li>' + esc(h.date) + ': ' + esc(what) + ' (because of ' + esc(h.because) + ')' + (h.note ? ': "' + esc(h.note) + '"' : '') + '</li>';
    }).join('');
    var disagreements = S.beliefs.decisions.filter(function (d) { return d.agreed === false; }).slice(-12).reverse().map(function (d) {
      var c = contestById(d.contest);
      return '<li>' + esc(d.date) + ': ' + esc(c ? contestTitle(c) : d.contest) + ', chose ' + esc(c ? choiceText(c, d.chose) : d.chose) + (d.note ? ': "' + esc(d.note) + '"' : '') + '</li>';
    }).join('');
    return '<section class="panel"><div class="band"><h2>Part 1 · General values</h2><span class="votefor">Carry across elections</span></div>' + g + '</section>' +
      '<section class="panel"><div class="band"><h2>Part 2 · Specific positions</h2></div>' + sp + '</section>' +
      '<section class="panel"><div class="band"><h2>How your profile has changed</h2></div><div class="panel-body">' +
        (hist ? '<ul class="claims">' + hist + '</ul>' : '<p class="small muted">No changes yet. When you disagree with a match and give a reason, the change shows here.</p>') +
        (disagreements ? '<h4>Recent disagreements</h4><ul class="claims">' + disagreements + '</ul>' : '') +
      '</div></section>' +
      '<div class="row"><button type="button" class="btn" data-nav="data">Export or import</button><button type="button" class="btn danger" data-act="reset">Erase everything</button></div>' +
      (S.confirmReset ? '<div class="callout warn"><p>This erases all your answers and choices from this browser. Export first if you want a copy.</p><div class="row"><button type="button" class="btn danger" data-act="reset-yes">Yes, erase</button><button type="button" class="btn ghost" data-act="reset-no">Cancel</button></div></div>' : '');
  }
  function viewEdit() { return ''; }

  // ---------- data (export/import) ----------
  function viewData() {
    var json = JSON.stringify(S.beliefs, null, 2);
    return '<section class="panel"><div class="band"><h2>Export your beliefs</h2></div><div class="panel-body">' +
      '<p class="small">This file holds your political views. Keep it private: in a private repo or on your own device. Don\'t commit it to a public repo.</p>' +
      '<textarea id="export-json" readonly>' + esc(json) + '</textarea>' +
      '<div class="row"><button type="button" class="btn" data-act="copy-export">Copy</button>' + (IN_FRAME ? '' : '<button type="button" class="btn ghost" data-act="download">Download beliefs.json</button>') + '</div>' +
      '</div></section>' +
      '<section class="panel"><div class="band"><h2>Bias-check replies</h2></div><div class="panel-body">' +
      '<p class="small">Replies you saved from other AI models, per item and model. These hold no personal views; share them with whoever maintains the data so the entries can be fixed.</p>' +
      '<textarea id="export-audits" readonly>' + esc(JSON.stringify({ app: 'vote-helper-audits', schema: 1, exported: today(), audits: S.audits }, null, 2)) + '</textarea>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="copy-audits">Copy</button></div>' +
      '</div></section>' +
      '<section class="panel"><div class="band"><h2>Import beliefs</h2></div><div class="panel-body">' +
      '<p class="small">Paste a beliefs file, or an AI reply that ends with a <code>voteHelperReply</code> JSON block.</p>' +
      '<textarea id="import-json" placeholder="Paste here"></textarea>' +
      '<label class="field" for="import-file">Or choose a file<input type="file" id="import-file" accept="application/json,.json"></label>' +
      '<div class="row"><button type="button" class="btn" data-act="import">Import</button></div>' +
      (S.importMsg ? '<p class="small">' + esc(S.importMsg) + '</p>' : '') +
      (S.aiProfile && S.aiProfile.length ? aiProfileHTML() : '') +
      '</div></section>';
  }
  function aiProfileHTML() {
    return '<div class="callout"><h4>Your AI suggested profile changes</h4>' + S.aiProfile.map(function (p, i) {
      var d = dimById(p.dim); if (!d) return '';
      return '<div class="row"><span class="small">' + esc(d.label) + ': ' + (p.pos != null ? 'position ' + p.pos : '') + (p.imp != null ? ' importance ' + p.imp : '') + (p.why ? ' · ' + esc(p.why) : '') + '</span><button type="button" class="btn small" data-ai-apply="' + i + '">Apply</button></div>';
    }).join('') + '</div>';
  }
  function doImport(text) {
    S.importMsg = '';
    var data = null;
    try { data = JSON.parse(text); } catch (e) {
      var m = text.match(/\{[\s\S]*"voteHelperReply"[\s\S]*\}/);
      if (m) { try { data = JSON.parse(m[0]); } catch (e2) { data = null; } }
    }
    if (!data) { S.importMsg = 'That isn\'t valid JSON. Paste the whole file, or the JSON block from your AI\'s reply.'; render(); return; }
    if (data.voteHelperReply) {
      var st = eState(), n = 0;
      (data.items || []).forEach(function (it) {
        if (!contestById(it.id)) return;
        st.ai[it.id] = { suggest: it.suggest, confidence: it.confidence, why: it.why, date: today() }; n++;
      });
      S.aiProfile = (data.profile || []).filter(function (p) { return dimById(p.dim); });
      save(); rescore();
      S.importMsg = 'Added AI notes to ' + n + ' items.' + (S.aiProfile.length ? ' Review the suggested profile changes below.' : '');
      render(); return;
    }
    if (data.app === 'vote-helper-audits' && data.audits) {
      Object.keys(data.audits).forEach(function (ek) {
        S.audits[ek] = S.audits[ek] || {};
        Object.keys(data.audits[ek]).forEach(function (cid) { S.audits[ek][cid] = Object.assign(S.audits[ek][cid] || {}, data.audits[ek][cid]); });
      });
      saveAudits(); S.importMsg = 'Imported bias-check replies.'; render(); return;
    }
    if (data.app !== 'vote-helper' || !data.general) { S.importMsg = 'This doesn\'t look like a Vote Helper beliefs file.'; render(); return; }
    S.beliefs = normalize(data); save(); applyDistricts();
    S.importMsg = 'Imported beliefs last updated ' + (data.updated || 'unknown') + '.';
    render();
  }

  // ---------- AI prompt ----------
  function compactContest(c) {
    var srcIds = {};
    JSON.stringify(c, function (k, v) { if (k === 's' && Array.isArray(v)) v.forEach(function (s) { srcIds[s] = 1; }); return v; });
    var out = JSON.parse(JSON.stringify(c, function (k, v) { return k === '_file' || k === 'order' ? undefined : v; }));
    out.sources = {};
    Object.keys(srcIds).forEach(function (s) { var x = S.sources[c._file + ':' + s]; if (x) out.sources[s] = x.pub + ': ' + x.title + ' <' + x.url + '>'; });
    out.voteHelperMatch = (function (r) { return { label: r.label, pick: r.pick, conflict: r.conflict, reasons: (r.reasons || []).slice(0, 5).map(function (x) { return { from: x.dim || x.q, contrib: Math.round(x.contrib * 100) / 100 }; }) }; })(S.results[c.id]);
    var ch = eState().choices[c.id]; if (ch) out.myChoice = ch.v;
    return out;
  }
  function beliefsForPrompt() {
    var g = {};
    Object.keys(S.beliefs.general).forEach(function (k) {
      var d = dimById(k), b = S.beliefs.general[k]; if (!d) return;
      g[k] = { label: d.label, A: d.a, B: d.b, position: b.pos, importance: b.imp == null ? 2 : b.imp, note: b.note || undefined, date: b.date };
    });
    var sp = {};
    Object.keys(S.beliefs.specific).forEach(function (k) {
      var q = specById(k), a = S.beliefs.specific[k]; if (!q) return;
      var o = q.options.filter(function (x) { return x.v === a.v; })[0];
      sp[k] = { question: q.q, answer: o ? o.l : a.v, date: a.date };
    });
    var dis = S.beliefs.decisions.filter(function (d) { return d.agreed === false; }).slice(-15).map(function (d) { return { election: d.election, item: d.contest, suggested: d.suggested, chose: d.chose, reason: d.reasonKey, note: d.note }; });
    return { general: g, specific: sp, pastDisagreements: dis };
  }
  function buildPrompt(scope) {
    var items = scope === 'all' ? S.contests : [contestById(scope)];
    return [
      'I\'m using Vote Helper, a ballot advisor, to prepare for the ' + S.election.name + ' (' + S.election.area + '). Please act as a careful, nonpartisan research assistant and help me reason about ' + (scope === 'all' ? 'my ballot' : 'this ballot item') + '.',
      '',
      'Ground rules:',
      '- Use the facts in the data below. Each fact cites a source; if you add facts, cite a source URL for each and say how confident you are.',
      '- Don\'t tell me what to believe. Apply MY stated beliefs. Where my beliefs conflict, explain the tradeoff plainly and say which way the balance tips given my importance weights.',
      '- Keep drafting/policy-quality concerns separate from values fit.',
      '- If my past disagreements suggest my profile is miscalibrated, say so and suggest specific changes.',
      '- Belief scale: position -2 = strongly side A, +2 = strongly side B. Importance 0-3.',
      '',
      'MY BELIEFS (JSON):',
      JSON.stringify(beliefsForPrompt(), null, 1),
      '',
      'BALLOT ITEMS, WITH VOTE HELPER\'S DETERMINISTIC MATCH (JSON):',
      JSON.stringify(items.map(compactContest), null, 1),
      '',
      'Please reply with a short explanation for each item, then end with exactly one JSON block in this format so I can paste it back into Vote Helper:',
      '```json',
      '{"voteHelperReply": 1, "items": [{"id": "<item id>", "suggest": "yes | no | <candidate id> | your call", "confidence": "high | medium | low", "why": "<one or two sentences>"}], "profile": [{"dim": "<belief id>", "pos": -2, "imp": 2, "why": "<only include if you recommend a change>"}]}',
      '```'
    ].join('\n');
  }
  function viewAI() {
    var scope = S.aiScope || 'all';
    var text = buildPrompt(scope);
    return '<section class="panel"><div class="band"><h2>Ask your AI</h2><span class="votefor">' + esc(scope === 'all' ? 'Whole ballot' : contestTitle(contestById(scope))) + '</span></div><div class="panel-body">' +
      '<p>Vote Helper doesn\'t call any AI itself. Copy this prompt into your own AI assistant (for example Claude or Claude Code). It includes your beliefs and the sourced ballot data.</p>' +
      '<p class="small muted">This sends your beliefs to whatever AI service you paste it into.</p>' +
      '<textarea id="ai-prompt" readonly>' + esc(text) + '</textarea>' +
      '<div class="row"><button type="button" class="btn" data-act="copy-ai">Copy prompt</button><button type="button" class="btn ghost" data-act="back-from-ai">Back</button></div>' +
      '<h4>Paste the AI\'s reply</h4><p class="small">Its JSON block adds notes to each item, and it can suggest profile changes you can accept or ignore.</p>' +
      '<textarea id="import-json" placeholder="Paste the AI\'s whole reply here"></textarea>' +
      '<div class="row"><button type="button" class="btn" data-act="import">Add AI notes</button></div>' +
      (S.importMsg ? '<p class="small">' + esc(S.importMsg) + '</p>' : '') +
      (S.aiProfile && S.aiProfile.length ? aiProfileHTML() : '') +
      '</div></section>';
  }

  // ---------- about ----------
  function viewAbout() {
    return '<section class="panel"><div class="band"><h2>How Vote Helper works</h2></div><div class="panel-body">' +
      '<div class="stack"><h4>1. Research</h4><p>Each election is a data file. Every ballot item lists what it does, fiscal impact, arguments for and against, endorsements, and drafting-quality concerns, each with a source. Claims marked <span class="lowconf">low conf.</span> rest on thin, opinion or advocacy sources. During research, each item is also tagged with which beliefs it touches and which way a Yes vote points.</p></div>' +
      '<div class="stack"><h4>2. Your beliefs</h4><p>Part 1 asks general values that carry across elections. Part 2 asks specific questions only when an item doesn\'t map cleanly onto your values. Quick mode asks only the questions that change the most suggestions on this ballot.</p></div>' +
      '<div class="stack"><h4>3. Matching</h4><p>The page adds up your answers against each item\'s tags: your position (−2 to +2) × the direction a Yes vote moves × how strongly the item touches that belief × how much it matters to you. No AI runs and nothing is sent anywhere. When answers point both ways with similar weight, the item is flagged as a conflict.</p></div>' +
      '<div class="stack"><h4>4. Learning</h4><p>When you pick differently from your match, you can say why. Choosing a reason updates your profile (with your OK), and the history is kept with dates.</p></div>' +
      '<div class="stack"><h4>Optional: your own AI</h4><p>"Ask your AI" builds a prompt with your beliefs and the sourced data that you can paste into your own assistant. Its reply can be pasted back as notes.</p></div>' +
      '<div class="stack"><h4>Research method for this election</h4><p class="small">' + esc(S.election.method || '') + ' Researched ' + esc(S.election.researched || '') + '.</p></div>' +
      (S.state.measures && S.state.measures.note ? '<div class="stack"><h4>Ballot measures in ' + esc(S.state.name) + '</h4><p class="small">' + esc(S.state.measures.note) + '</p></div>' : '') +
      (S.state.retention && S.state.retention.note ? '<div class="stack"><h4>Judges in ' + esc(S.state.name) + '</h4><p class="small">' + esc(S.state.retention.note) + '</p></div>' : '') +
      '<div class="stack"><h4>Bias check with other AI models</h4><p class="small">The summaries, arguments, belief tags, quality flags and the belief questions were written by Claude. The Bias check tab gives other models the whole app in two rounds: blind (official ballot text only; the model maps items itself and Vote Helper compares) and critique (the model reviews Claude\'s write-up). Prompts never include other models\' replies or your beliefs. Items where a model objects are flagged "Models disagree."</p></div>' +
      '</div></section>';
  }

  // ---------- events ----------
  function copyText(text, el) {
    function fallback() { if (el) { el.focus(); el.select(); } toast('Select all and copy'); }
    try { navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, fallback); } catch (e) { fallback(); }
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, [data-open]'); if (!t) return;
    var ds = t.dataset;
    if (t.id === 'go-home') return setView('home');
    if (ds.nav) { S.importMsg = ''; return setView(ds.nav); }
    if (ds.open) { S.disagree = null; return setView('item', { item: ds.open }); }
    if (ds.effort) { eState().effort = ds.effort; save(); return render(); }
    if (ds.edit) { S.queue = [{ type: 'general', id: ds.edit }]; S.queuePos = 0; S.draft = null; S.returnTo = 'profile'; return setView('ask'); }
    if (ds.editSpec) { S.queue = [{ type: 'specific', id: ds.editSpec }]; S.queuePos = 0; S.draft = null; S.returnTo = 'profile'; return setView('ask'); }
    if (ds.askFor) {
      var c0 = contestById(ds.askFor);
      S.queue = Object.keys(E.dimsTouched([c0])).filter(function (d) { return dimById(d); }).map(function (d) { return { type: 'general', id: d }; })
        .concat(E.specificFor([c0], S.values).map(function (q) { return { type: 'specific', id: q.id }; }));
      S.queuePos = 0; S.draft = null; S.returnTo = 'item'; return setView('ask');
    }
    if (ds.aiApply) {
      var p = S.aiProfile[+ds.aiApply], prev = S.beliefs.general[p.dim];
      var nb = { pos: p.pos != null ? Math.max(-2, Math.min(2, Math.round(p.pos))) : (prev ? prev.pos : 0), imp: p.imp != null ? Math.max(0, Math.min(3, Math.round(p.imp))) : (prev && prev.imp != null ? prev.imp : 2), date: today() };
      S.beliefs.general[p.dim] = nb;
      S.beliefs.history.push({ date: today(), change: { dim: p.dim, field: 'belief', from: prev || null, to: nb }, because: 'AI suggestion', note: p.why || '' });
      S.aiProfile.splice(+ds.aiApply, 1); save(); rescore(); toast('Applied'); return render();
    }
    // question widgets (ask view or disagreement panel)
    var qbox = t.closest('[data-q]');
    if (qbox && (ds.pos != null || ds.imp != null || ds.opt != null)) {
      var target = S.disagree ? S.disagree : S;
      var curBase = qbox.dataset.q === 'general' ? S.beliefs.general[qbox.dataset.id] : S.beliefs.specific[qbox.dataset.id];
      target.draft = target.draft || (curBase ? JSON.parse(JSON.stringify(curBase)) : {});
      if (ds.pos != null) target.draft.pos = +ds.pos;
      if (ds.imp != null) target.draft.imp = +ds.imp;
      if (ds.opt != null) target.draft.v = ds.opt;
      var note = $('#q-note'); var keep = note ? note.value : null;
      render();
      if (keep != null && $('#q-note')) $('#q-note').value = keep;
      return;
    }
    if (ds.choose) { var c = contestById(S.itemId); return choose(c, ds.choose); }
    if (ds.copyPart != null) { var pt = $('#part-' + ds.copyPart); pt.hidden = false; return copyText(pt.value, pt); }
    if (ds.copyItem) { var it = $('#item-prompt-' + ds.copyItem); it.hidden = false; return copyText(it.value, it); }
    if (ds.auditMode) { S.auditMode = ds.auditMode; S.auditMsg = ''; return render(); }
    if (ds.auditSplit != null) { S.auditSplit = ds.auditSplit === '1'; return render(); }
    if (ds.auditDel) { var ek = S.election.key; delete (S.audits[ek] || {})[S.itemId][ds.auditDel]; saveAudits(); S.auditOpen = S.itemId; return render(); }
    switch (ds.act) {
      case 'start': S.returnTo = null; return startFlow();
      case 'q-next': commitDraft(); S.queuePos++; if (S.returnTo && S.queuePos >= S.queue.length) { var rt = S.returnTo; S.returnTo = null; rescore(); return setView(rt); } return advanceQueue();
      case 'q-skip': S.draft = null; S.queuePos++; if (S.returnTo && S.queuePos >= S.queue.length) { var rt2 = S.returnTo; S.returnTo = null; return setView(rt2); } return advanceQueue();
      case 'q-back': S.draft = null; S.queuePos = Math.max(0, S.queuePos - 1); return setView('ask');
      case 'q-stop': commitDraft(); S.returnTo = null; rescore(); return setView('slate');
      case 'walk':
        S.walk = S.contests.map(function (c) { return c.id; });
        var firstOpen = S.walk.filter(function (id) { return !eState().choices[id]; })[0] || S.walk[0];
        S.walkPos = S.walk.indexOf(firstOpen); return setView('item', { item: firstOpen });
      case 'walk-next': var i = S.walk.indexOf(S.itemId); S.disagree = null; if (i >= S.walk.length - 1) { S.walk = []; return setView('sheet'); } return setView('item', { item: S.walk[i + 1] });
      case 'walk-prev': var j = S.walk.indexOf(S.itemId); S.disagree = null; return setView('item', { item: S.walk[Math.max(0, j - 1)] });
      case 'more-q': { var st = eState(); var prevE = st.effort; st.effort = prevE === 'quick' ? 'standard' : 'deep'; save(); S.returnTo = null; return startFlow(); }
      case 'clear-choice': delete eState().choices[S.itemId]; S.disagree = null; save(); return render();
      case 'dg-save': return saveDisagree();
      case 'dg-skip': S.disagree = null; return render();
      case 'ai-all': S.aiScope = 'all'; S.importMsg = ''; S.aiReturn = 'slate'; return setView('ai');
      case 'ai-one': S.aiScope = S.itemId; S.importMsg = ''; S.aiReturn = 'item'; return setView('ai');
      case 'back-from-ai': return setView(S.aiReturn || 'slate');
      case 'copy-ai': return copyText($('#ai-prompt').value, $('#ai-prompt'));
      case 'copy-export': return copyText($('#export-json').value, $('#export-json'));
      case 'copy-sheet': return copyText(sheetText(), null);
      case 'copy-audits': return copyText($('#export-audits').value, $('#export-audits'));
      case 'save-audit': {
        var txt = ($('#audit-reply') || {}).value || '';
        if (!txt.trim()) { toast('Paste the model\'s reply first'); return; }
        var res = saveReply($('#audit-model').value, txt, S.itemId);
        S.auditOpen = S.itemId; render();
        toast(res.mode === 'unparsed' ? 'Saved, but no JSON block was found' : res.n ? 'Saved ' + (res.mode === 'blind' ? 'blind mapping' : 'review') : 'Nothing to save for this item');
        var box = $('#audit-box'); if (box) box.scrollIntoView({ block: 'nearest' });
        return;
      }
      case 'save-reply-all': {
        var t2 = ($('#audit-reply-all') || {}).value || '', mdl = $('#audit-model-all').value;
        if (!t2.trim()) { toast('Paste the model\'s reply first'); return; }
        var r2 = saveReply(mdl, t2, null);
        S.auditMsg = r2.n ? 'Saved ' + modelLabel(r2.mode === 'blind' ? mdl + '~blind' : mdl) + ' for ' + r2.n + ' item' + (r2.n > 1 ? 's' : '') + '.' : (r2.mode === 'critique' ? 'Saved the belief-question review.' : 'No Vote Helper JSON block found. Ask the model to end with the JSON block from the prompt.');
        return render();
      }
      case 'print': return window.print();
      case 'download': {
        var blob = new Blob([JSON.stringify(S.beliefs, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'beliefs.json'; document.body.appendChild(a); a.click(); a.remove(); return;
      }
      case 'import': {
        var f = $('#import-file'), ta = $('#import-json');
        if (f && f.files && f.files[0]) { var rd = new FileReader(); rd.onload = function () { doImport(String(rd.result)); }; rd.readAsText(f.files[0]); return; }
        return doImport(ta ? ta.value : '');
      }
      case 'reset': S.confirmReset = true; return render();
      case 'reset-no': S.confirmReset = false; return render();
      case 'reset-yes': S.confirmReset = false; S.beliefs = blankBeliefs(); save(); applyDistricts(); toast('Erased'); return setView('home');
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.pick) {
      var pk = t.dataset.pick === 'place' ? t.value : placeKey(S.place);
      var place = S.places.places.filter(function (p) { return placeKey(p) === pk; })[0];
      var date = t.dataset.pick === 'date' ? t.value : place.elections[place.elections.length - 1].date;
      $('#app').innerHTML = '<div class="loading">Loading…</div>';
      return loadElection(place, date).then(function () { setView('home'); }).catch(showLoadError);
    }
    if (t.dataset && t.dataset.district) { eState().districts[t.dataset.district] = t.value; save(); applyDistricts(); return render(); }
    if (t.name === 'dg' && S.disagree) { S.disagree.key = t.value; S.disagree.draft = null; var n = $('#dg-note'); S.disagree.note = n ? n.value : ''; return render(); }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'dg-note' && S.disagree) S.disagree.note = ev.target.value;
  });

  // ---------- boot ----------
  function showLoadError(err) {
    $('#app').innerHTML = '<div class="callout warn"><p><b>Couldn\'t load the ballot data.</b> ' + esc(err.message) + '. If you opened this file directly from your computer, serve the folder instead (for example <code>python3 -m http.server</code>) or use the hosted page.</p></div>';
  }
  function pickInitial() {
    var saved = S.beliefs.place, list = S.places.places;
    var place = saved && list.filter(function (p) { return placeKey(p) === saved.key; })[0];
    // No saved place (e.g. beliefs from the first version): use a place this person already has answers for.
    if (!place) place = list.filter(function (p) { return Object.keys(S.beliefs.elections).some(function (k) { return k.indexOf(placeKey(p) + '/') === 0; }); })[0];
    place = place || list[0];
    var date = saved && saved.key === placeKey(place) && place.elections.some(function (e) { return e.date === saved.date; }) ? saved.date : null;
    if (!date) {
      // Default to the next upcoming election, else the latest.
      var t = today(), up = place.elections.filter(function (e) { return e.date >= t; });
      date = (up[0] || place.elections[place.elections.length - 1]).date;
    }
    return { place: place, date: date };
  }
  S.beliefs = load();
  S.audits = loadAudits();
  Promise.all([fetchJSON(DATA + 'values.json'), fetchJSON(DATA + 'places.json')]).then(function (res) {
    S.baseValues = res[0]; S.places = res[1];
    S.stateNames = S.places.stateNames || {};
    var init = pickInitial();
    return loadElection(init.place, init.date);
  }).then(function () {
    var hasAny = Object.keys(S.beliefs.general).length > 0;
    setView(hasAny ? 'slate' : 'home');
  }).catch(showLoadError);

  // Exposed for tests and the console.
  window.VoteHelper = { state: S, buildPrompt: function (s) { return buildPrompt(s || 'all'); }, critiquePrompt: function (id) { return critiquePrompt({ items: [id] }, 1, 0); }, blindPrompt: function (id) { return blindPrompt({ items: [id] }, 1, 0); }, parts: parts, saveReply: saveReply, extractJSON: extractJSON };
})();
