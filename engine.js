/* Vote Helper scoring engine. Pure functions, no DOM.
   Works in the browser (window.VHEngine) and in Node (module.exports). */
(function (root) {
  'use strict';

  // How much a belief counts, by importance 0-3.
  var IMPORTANCE = [0, 0.5, 1, 1.5];
  // A Part 2 answer is about this exact item, so it counts more than one general belief.
  var SPECIFIC_WEIGHT = 1.5;

  function impFactor(b) {
    var imp = b && typeof b.imp === 'number' ? b.imp : 2;
    return IMPORTANCE[Math.max(0, Math.min(3, imp))];
  }

  // Per-dimension multiplier from values.json (tiebreaker beliefs count less).
  function dimWeight(values, dim) {
    var d = values && values.general && values.general.filter(function (x) { return x.id === dim; })[0];
    return d && typeof d.weight === 'number' ? d.weight : 1;
  }
  function isTiebreaker(values, dim) {
    var d = values && values.general && values.general.filter(function (x) { return x.id === dim; })[0];
    return !!(d && d.tiebreaker);
  }

  function generalBelief(beliefs, dim) {
    var b = beliefs && beliefs.general && beliefs.general[dim];
    if (!b || typeof b.pos !== 'number') return null;
    return b;
  }

  function specificFx(values, beliefs, contest) {
    // Returns a list of {q, option, fx} for answered Part 2 questions that touch this contest.
    var out = [];
    var ids = contest.specific || [];
    var all = (values && values.specific) || [];
    // Also include questions that list this contest in "for" even if the contest doesn't list them.
    all.forEach(function (q) {
      if (q.for && q.for.indexOf(contest.id) >= 0 && ids.indexOf(q.id) < 0) ids = ids.concat([q.id]);
    });
    ids.forEach(function (qid) {
      var q = all.filter(function (x) { return x.id === qid; })[0];
      var ans = beliefs && beliefs.specific && beliefs.specific[qid];
      if (!q || !ans) return;
      var opt = q.options.filter(function (o) { return o.v === ans.v; })[0];
      if (!opt || !opt.fx || !(contest.id in opt.fx)) return;
      out.push({ q: q, option: opt, fx: opt.fx[contest.id] });
    });
    return out;
  }

  function labelFor(score, max) {
    if (!max) return 'none';
    var r = score / max;
    if (Math.abs(score) < 0.5) return 'call';
    if (r >= 0.5) return 'yes';
    if (r >= 0.15) return 'lean-yes';
    if (r <= -0.5) return 'no';
    if (r <= -0.15) return 'lean-no';
    return 'call';
  }

  function scoreMeasure(contest, beliefs, values) {
    var reasons = [];
    var score = 0, max = 0, pro = 0, con = 0;
    (contest.tags || []).forEach(function (tag) {
      var b = generalBelief(beliefs, tag.dim);
      if (!b) return;
      var f = impFactor(b);
      var w = tag.w * dimWeight(values, tag.dim);
      var c = (b.pos / 2) * tag.yes * w * f;
      max += w * f;
      score += c;
      if (c > 0) pro += c; else con -= c;
      if (c !== 0) reasons.push({ kind: 'general', dim: tag.dim, contrib: c, why: tag.why, belief: b });
    });
    var skip = false;
    specificFx(values, beliefs, contest).forEach(function (s) {
      if (s.fx === 'skip') { skip = true; return; }
      var c = s.fx * SPECIFIC_WEIGHT;
      max += Math.abs(2 * SPECIFIC_WEIGHT);
      score += c;
      if (c > 0) pro += c; else con -= c;
      reasons.push({ kind: 'specific', q: s.q.id, contrib: c, why: s.option.l, question: s.q.q });
    });
    reasons.sort(function (a, b) { return Math.abs(b.contrib) - Math.abs(a.contrib); });
    var label = skip ? 'skip' : labelFor(score, max);
    var conflict = pro >= 0.75 && con >= 0.75 && Math.min(pro, con) / Math.max(pro, con) >= 0.4;
    return {
      kind: contest.kind, label: label, score: score, max: max, pro: pro, con: con,
      conflict: conflict, tension: Math.min(pro, con), reasons: reasons,
      pick: label === 'yes' || label === 'lean-yes' ? 'yes' : label === 'no' || label === 'lean-no' ? 'no' : null
    };
  }

  function scoreRace(contest, beliefs, values) {
    var fx = specificFx(values, beliefs, contest);
    var cands = (contest.candidates || []).map(function (cand) {
      var score = 0, reasons = [], pro = 0, con = 0;
      (cand.positions || []).forEach(function (p) {
        var b = generalBelief(beliefs, p.dim);
        if (!b) return;
        var w = (typeof p.w === 'number' ? p.w : 2) * dimWeight(values, p.dim);
        var c = (b.pos / 2) * p.stance * w * impFactor(b);
        score += c;
        if (c > 0) pro += c; else con -= c;
        if (c !== 0) reasons.push({ kind: 'general', dim: p.dim, contrib: c, why: p.t, belief: b });
      });
      fx.forEach(function (s) {
        if (s.fx && typeof s.fx === 'object' && cand.id in s.fx) {
          var c = s.fx[cand.id] * SPECIFIC_WEIGHT;
          score += c;
          if (c > 0) pro += c; else con -= c;
          reasons.push({ kind: 'specific', q: s.q.id, contrib: c, why: s.option.l, question: s.q.q });
        }
      });
      reasons.sort(function (a, b) { return Math.abs(b.contrib) - Math.abs(a.contrib); });
      return { id: cand.id, name: cand.name, score: score, pro: pro, con: con, reasons: reasons };
    });
    var sorted = cands.slice().sort(function (a, b) { return b.score - a.score; });
    var best = sorted[0], second = sorted[1];
    var anySignal = cands.some(function (c) { return c.reasons.length > 0; });
    var label, pick = null;
    if (contest.unopposed) {
      label = 'unopposed'; pick = best ? best.id : null;
    } else if (!anySignal) {
      label = 'none';
    } else {
      var margin = best.score - (second ? second.score : 0);
      if (margin >= 1.5) label = 'strong';
      else if (margin >= 0.5) label = 'lean';
      else label = 'call';
      if (label !== 'call') pick = best.id;
    }
    var margin2 = best && second ? best.score - second.score : 0;
    var conflict = !contest.unopposed && anySignal && best && best.pro >= 0.75 && best.con >= 0.75 && margin2 < 1;
    return {
      kind: 'race', label: label, pick: pick, candidates: cands, ranked: sorted,
      margin: margin2, conflict: conflict, tension: best ? Math.min(best.pro, best.con) : 0,
      reasons: best ? best.reasons : []
    };
  }

  function scoreRetention(contest, beliefs, values) {
    var fx = specificFx(values, beliefs, contest);
    var label = 'none', pick = null, reasons = [];
    fx.forEach(function (s) {
      reasons.push({ kind: 'specific', q: s.q.id, contrib: s.fx === 'skip' ? 0 : s.fx, why: s.option.l, question: s.q.q });
      if (s.fx === 'skip') { label = 'skip'; }
      else if (s.fx > 0) { label = 'yes'; pick = 'yes'; }
      else if (s.fx < 0) { label = 'no'; pick = 'no'; }
    });
    return { kind: 'retention', label: label, pick: pick, reasons: reasons, conflict: false, tension: 0 };
  }

  function score(contest, beliefs, values) {
    if (contest.kind === 'measure') return scoreMeasure(contest, beliefs, values);
    if (contest.kind === 'retention') return scoreRetention(contest, beliefs, values);
    return scoreRace(contest, beliefs, values);
  }

  // Outcome bucket used to tell whether an answer changes a suggestion.
  function bucket(r) {
    if (r.kind === 'race') return r.pick || 'call';
    return r.pick || 'call';
  }

  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

  // Which general dimensions touch this ballot.
  function dimsTouched(contests) {
    var set = {};
    contests.forEach(function (c) {
      (c.tags || []).forEach(function (t) { set[t.dim] = (set[t.dim] || 0) + t.w; });
      (c.candidates || []).forEach(function (cand) {
        (cand.positions || []).forEach(function (p) { if (p.stance) set[p.dim] = (set[p.dim] || 0) + Math.abs(p.stance); });
      });
    });
    return set;
  }

  // For each unanswered general dimension, count how many suggestions would differ between a
  // strong "A" answer and a strong "B" answer. Higher = asking it moves more votes.
  function swing(contests, beliefs, values, opts) {
    opts = opts || {};
    var touched = dimsTouched(contests);
    var out = [];
    Object.keys(touched).forEach(function (dim) {
      var answered = beliefs && beliefs.general && beliefs.general[dim];
      if (answered && !opts.includeAnswered) return;
      var lo = clone(beliefs), hi = clone(beliefs);
      lo.general = lo.general || {}; hi.general = hi.general || {};
      lo.general[dim] = { pos: -2, imp: 2 };
      hi.general[dim] = { pos: 2, imp: 2 };
      var moved = 0;
      contests.forEach(function (c) {
        if (c.unopposed) return;
        var a = bucket(score(c, lo, values)), b = bucket(score(c, hi, values));
        if (a !== b) moved++;
      });
      out.push({ dim: dim, moved: moved, weight: touched[dim], tiebreaker: isTiebreaker(values, dim) });
    });
    // Tiebreaker beliefs go last; otherwise most votes moved first.
    out.sort(function (a, b) { return (a.tiebreaker - b.tiebreaker) || b.moved - a.moved || b.weight - a.weight; });
    return out;
  }

  // Part 2 questions relevant to the given contests.
  function specificFor(contests, values) {
    var ids = {};
    contests.forEach(function (c) { (c.specific || []).forEach(function (q) { ids[q] = true; }); });
    return ((values && values.specific) || []).filter(function (q) { return ids[q.id]; });
  }

  // Pick the contests worth a closer look: strongest internal conflict first.
  function conflicts(contests, results, n) {
    return contests
      .map(function (c) { return { c: c, r: results[c.id] }; })
      .filter(function (x) { return x.r && x.r.conflict; })
      .sort(function (a, b) { return b.r.tension - a.r.tension; })
      .slice(0, n || 3)
      .map(function (x) { return x.c.id; });
  }

  // A contest is on this voter's ballot unless appliesTo excludes their districts.
  function applies(contest, districts) {
    var a = contest.appliesTo;
    if (!a) return true;
    return Object.keys(a).every(function (k) {
      return !districts || !districts[k] || a[k].indexOf(districts[k]) >= 0;
    });
  }

  var api = {
    IMPORTANCE: IMPORTANCE, score: score, swing: swing, specificFor: specificFor,
    conflicts: conflicts, applies: applies, dimsTouched: dimsTouched, labelFor: labelFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VHEngine = api;
})(typeof window !== 'undefined' ? window : this);
