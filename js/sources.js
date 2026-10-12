/* FoodDiary — food data sources: Open Food Facts (live), CoFID (bundled/imported), custom foods, recipes. */
const Sources = (() => {
  'use strict';
  const OFF_BASE = 'https://world.openfoodfacts.org';
  const OFF_UK = 'https://uk.openfoodfacts.org';
  const FIELDS = 'code,product_name,product_name_en,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,image_front_small_url,image_front_url,image_url';

  let cofid = [];          // array of foods

  /* ---------- CoFID ---------- */
  async function loadCofid() {
    let data = null;
    // 1) a newer file the user imported on this device
    const imported = await Store.kvGet('cofid-imported');
    if (imported && imported.length) data = imported;
    // 2) the dataset bundled with the app (also cached by the service worker for offline use)
    if (!data) {
      if (location.protocol === 'file:') {
        // Local preview (index.html opened from a folder): fetch() is blocked, so load the script version instead.
        try { await loadScript('data/cofid.js'); if (Array.isArray(window.__COFID) && window.__COFID.length) data = window.__COFID; } catch (e) { /* missing */ }
      } else {
        try {
          const r = await fetch('data/cofid.json');
          if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) data = j; }
        } catch (e) { /* offline and not yet cached */ }
      }
    }
    // 3) last resort: an older cached copy
    if (!data) { const cached = await Store.kvGet('cofid'); if (cached && cached.length) data = cached; }
    setCofid(data || []);
    return cofid.length;
  }
  function setCofid(arr) {
    // Hide "weighed with skin/peel/bone" variants (for weighing before peeling) and give everything a plain-English name.
    memo = new Map(); vocab = null; vocabList = null; byFirst = null; fixCache.clear(); corrections.clear();
    cofid = (arr || []).filter((f) => !/weighed with/i.test(f.cofidName || f.name)).map((f) => {
      if (f.cofidName) return f; // already processed (e.g. restored from cache)
      const cofidName = f.name;
      return Object.assign({}, f, { cofidName, name: (typeof Names !== 'undefined' ? Names.friendly(cofidName) : cofidName) });
    });
  }
  async function importCofidWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = wb.SheetNames.find((n) => /proximates/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    const foods = Nutrition.parseCofidRows(rows);
    if (!foods.length) throw new Error('Could not find food rows in the "Proximates" sheet.');
    await Store.kvSet('cofid-imported', foods);
    Store.state.cofidLoadedAt = new Date().toISOString();
    Store.save();
    setCofid(foods);
    return foods.length;
  }
  // 1.21.0: one ranked list per query is remembered, so the several places that show UK foods for the same
  // search (results list, tap handling, recipe builder) don't each re-scan all ~2,800 foods. When the query just
  // grows ("chi" → "chic"), only the foods that matched the shorter query are scored.
  let memo = new Map(); // key → { q, recentKey, all: [{ f, score }] }
  function searchCofidExact(q, limit = 25) {
    q = (q || '').trim();
    if (!q || !cofid.length) return [];
    const recents = typeof Store !== 'undefined' ? Store.state.recents : [];
    const recentKey = recents.map((f) => f.id).join('|');
    const key = q.toLowerCase();
    let m = memo.get(key);
    if (!m || m.recentKey !== recentKey) {
      const recentIds = new Set(recents.map((f) => f.id));
      const score = Ranking.prepare(q);
      // Narrow from the longest remembered query that this one extends (same recents → same matches, only fewer).
      let pool = null;
      for (const prev of memo.values()) if (prev.recentKey === recentKey && key.startsWith(prev.key) && (!pool || prev.key.length > pool.key.length)) pool = prev;
      const source = pool ? pool.matched : cofid;
      const all = [], matched = [];
      for (let i = 0; i < source.length; i++) {
        const f = source[i];
        const sc = score(f.cofidName || f.name, f.name, recentIds.has(f.id));
        if (sc > -Infinity) { all.push({ f, score: sc }); matched.push(f); }
      }
      all.sort((a, b) => b.score - a.score);
      m = { key, recentKey, all, matched };
      memo.delete(key); memo.set(key, m);
      if (memo.size > 12) memo.delete(memo.keys().next().value); // forget the oldest
    } else { memo.delete(key); memo.set(key, m); } // mark as recently used
    const out = [];
    for (let i = 0; i < m.all.length && i < limit; i++) out.push(m.all[i].f);
    return out;
  }
  // Spelling-tolerant search (1.23.0). Only used when a search finds NOTHING: each word that doesn't appear in any
  // UK food name is swapped for the closest real word (1 typo allowed in 4–6 letter words, 2 in longer ones; a word
  // still being typed is compared with the start of longer words). Brand names aren't touched for Open Food Facts
  // (see search()). The word list is built once, on first use.
  let vocab = null, vocabList = null, byFirst = null;
  const fixCache = new Map(), corrections = new Map();
  function buildVocab() {
    vocab = new Map();
    for (const f of cofid) for (const w of ((f.cofidName || '') + ' ' + (f.name || '')).toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) vocab.set(w, (vocab.get(w) || 0) + 1);
    vocabList = [...vocab.keys()];
    byFirst = new Map(); // first letter → words (typos rarely change the first letter; swapped first two letters are covered too)
    for (const w of vocabList) { if (!byFirst.has(w[0])) byFirst.set(w[0], []); byFirst.get(w[0]).push(w); }
  }
  // Edit distance (swapped neighbours count as one typo), giving up as soon as it must exceed `max`.
  // Three reusable rows, no allocation per call — this runs on every keystroke while a word is misspelt.
  let r0 = new Uint8Array(64), r1 = new Uint8Array(64), r2 = new Uint8Array(64);
  function typoDistance(a, b, max, bLen = b.length) {
    if (Math.abs(a.length - bLen) > max) return max + 1;
    if (bLen + 1 > r0.length) { r0 = new Uint8Array(bLen + 1); r1 = new Uint8Array(bLen + 1); r2 = new Uint8Array(bLen + 1); }
    let prev2 = r0, prev = r1, cur = r2;
    for (let j = 0; j <= bLen; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i; let rowMin = i;
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= bLen; j++) {
        const bj = b.charCodeAt(j - 1);
        let v = prev[j - 1] + (ai === bj ? 0 : 1);
        if (prev[j] + 1 < v) v = prev[j] + 1;
        if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
        if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const t = prev2; prev2 = prev; prev = cur; cur = t;
    }
    return prev[bLen];
  }
  function known(t) { for (const w of vocabList) if (w.includes(t)) return true; return false; }
  function fixWord(t) {
    if (fixCache.has(t)) return fixCache.get(t);
    let res = null;
    if (t.length >= 4 && /^[a-z]+$/.test(t) && !known(t)) {
      const max = t.length >= 7 ? 2 : 1;
      let bestD = max + 1, bestN = 0;
      const pool = (byFirst.get(t[0]) || []).concat(t[1] !== t[0] ? (byFirst.get(t[1]) || []) : []);
      for (const w of pool) {
        if (w.length < t.length - max) continue;
        let dd = typoDistance(t, w, max);
        // A word still being typed: compare with the start of longer words ("brocol" → broccoli)
        if (dd > max && w.length > t.length) dd = Math.min(typoDistance(t, w, max, t.length), typoDistance(t, w, max, t.length + 1));
        const n = vocab.get(w);
        if (dd < bestD || (dd === bestD && n > bestN)) { res = w; bestD = dd; bestN = n; }
      }
      if (bestD > max) res = null;
    }
    if (fixCache.size > 500) fixCache.clear();
    fixCache.set(t, res);
    return res;
  }
  // The corrected query, or null if nothing needed/could be corrected.
  function correctQuery(q) {
    if (!cofid.length) return null;
    if (!vocab) buildVocab();
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let changed = false;
    const out = terms.map((t) => { const f = fixWord(t); if (f && f !== t) { changed = true; return f; } return t; });
    return changed ? out.join(' ') : null;
  }
  function searchCofid(q, limit = 25) {
    q = (q || '').trim();
    const res = searchCofidExact(q, limit);
    if (res.length || !q) { corrections.delete(q.toLowerCase()); return res; }
    const fixed = correctQuery(q);
    if (!fixed) return res;
    const alt = searchCofidExact(fixed, limit);
    if (alt.length) { corrections.set(q.toLowerCase(), fixed); if (corrections.size > 50) corrections.delete(corrections.keys().next().value); }
    return alt;
  }
  // "showing results for …" — the corrected query used for the UK foods, if any.
  const correctionFor = (q) => corrections.get((q || '').trim().toLowerCase()) || null;

  const cofidCount = () => cofid.length;

  /* ---------- Local (custom, recipes, favourites, recents) ---------- */
  function searchLocal(q) {
    const s = Store.state;
    const all = [...s.customFoods, ...s.recipes.map(recipeAsFood)];
    if (!q) return all;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((f) => { const n = ((f.name || '') + ' ' + (f.brand || '')).toLowerCase(); return terms.every((t) => n.includes(t)); });
  }
  function recipeAsFood(r) {
    return Object.assign({ source: 'recipe', isRecipe: true }, r.per100, { id: r.id, name: r.name, brand: 'Recipe', servingG: r.servingG, servingLabel: r.servingLabel, image: r.image || null, totalG: r.totalG, servings: r.servings });
  }

  /* ---------- Open Food Facts ---------- */
  async function offFetch(url) {
    const r = await fetch(url);
    if (r.status === 429) throw new Error('Open Food Facts is rate-limiting; wait a moment and try again.');
    if (!r.ok) throw new Error('Open Food Facts returned ' + r.status);
    return r.json();
  }
  async function lookupBarcode(code) {
    code = String(code).replace(/\D/g, '');
    if (!code) return null;
    const cached = Store.state.cache[code];
    if (cached && Date.now() - (cached._t || 0) < 1000 * 60 * 60 * 24 * 30) return cached;
    let j = await offFetch(`${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
    if ((j.status !== 1 || !j.product) && code.length === 12) {
      // UPC-A scanned; Open Food Facts usually stores it as a 13-digit EAN with a leading zero.
      j = await offFetch(`${OFF_BASE}/api/v2/product/0${code}.json?fields=${FIELDS}`);
    } else if ((j.status !== 1 || !j.product) && code.length === 13 && code[0] === '0') {
      j = await offFetch(`${OFF_BASE}/api/v2/product/${code.slice(1)}.json?fields=${FIELDS}`);
    }
    if (j.status !== 1 || !j.product) return null;
    const food = Nutrition.fromOFF(j.product);
    food.barcode = code;
    food._t = Date.now();
    Store.state.cache[code] = food;
    // keep cache bounded
    const keys = Object.keys(Store.state.cache);
    if (keys.length > 400) keys.sort((a, b) => (Store.state.cache[a]._t || 0) - (Store.state.cache[b]._t || 0)).slice(0, 100).forEach((k) => delete Store.state.cache[k]);
    Store.save();
    return food;
  }
  async function searchOFF(q, page = 1) {
    if (!q) return [];
    const params = new URLSearchParams({
      search_terms: q, search_simple: 1, action: 'process', json: 1, page_size: 24, page,
      fields: FIELDS, sort_by: 'unique_scans_n'
    });
    const j = await offFetch(`${OFF_UK}/cgi/search.pl?${params.toString()}`);
    const list = (j.products || []).map(Nutrition.fromOFF).filter((f) => f && f.name && f.kcal !== null);
    return list;
  }

  /* ---------- Unified search ---------- */
  // Returns { local, cofid, off } — off is a promise so UI can render instantly.
  function search(q) {
    const cofidRes = searchCofid(q);
    const fixed = correctionFor(q);
    let local = searchLocal(q);
    if (!local.length && fixed) local = searchLocal(fixed);
    const off = /^\d{8,14}$/.test(q.trim()) ? lookupBarcode(q.trim()).then((f) => (f ? [f] : []))
      // Products: search what was typed (brand names aren't in the UK list); only if that finds nothing, try the corrected words.
      : searchOFF(q).then((list) => (list.length || !fixed ? list : searchOFF(fixed)));
    return { local, cofid: cofidRes, off, corrected: fixed };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  return { loadCofid, importCofidWorkbook, searchCofid, correctionFor, correctQuery, cofidCount, searchLocal, recipeAsFood, lookupBarcode, searchOFF, search, loadScript };
})();
