/* FoodDiary — food data sources: Open Food Facts (live), CoFID (bundled/imported), custom foods, recipes. */
const Sources = (() => {
  'use strict';
  const OFF_BASE = 'https://world.openfoodfacts.org';
  const OFF_UK = 'https://uk.openfoodfacts.org';
  const UA = 'FoodDiary-PWA/1.0 (personal diet tracker)';
  const FIELDS = 'code,product_name,product_name_en,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,image_front_small_url,image_front_url,image_url';

  let cofid = [];          // array of foods
  let cofidIndex = null;   // lowercase names

  /* ---------- CoFID ---------- */
  async function loadCofid() {
    // 1) previously imported copy in IndexedDB
    let data = await Store.kvGet('cofid');
    // 2) bundled data/cofid.json
    if (!data || !data.length) {
      try {
        const r = await fetch('data/cofid.json', { cache: 'no-cache' });
        if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) { data = j; await Store.kvSet('cofid', j); } }
      } catch (e) { /* offline or missing */ }
    }
    setCofid(data || []);
    return cofid.length;
  }
  function setCofid(arr) {
    cofid = arr || [];
    cofidIndex = cofid.map((f) => (f.name + ' ' + (f.group || '')).toLowerCase());
  }
  async function importCofidWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = wb.SheetNames.find((n) => /proximates/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    const foods = Nutrition.parseCofidRows(rows);
    if (!foods.length) throw new Error('Could not find food rows in the "Proximates" sheet.');
    await Store.kvSet('cofid', foods);
    Store.state.cofidLoadedAt = new Date().toISOString();
    Store.save();
    setCofid(foods);
    return foods.length;
  }
  function searchCofid(q, limit = 25) {
    if (!q || !cofid.length) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (let i = 0; i < cofid.length; i++) {
      const name = cofidIndex[i];
      let score = 0, ok = true;
      for (const t of terms) {
        const idx = name.indexOf(t);
        if (idx < 0) { ok = false; break; }
        score += idx === 0 ? 3 : (name[idx - 1] === ' ' || name[idx - 1] === ',') ? 2 : 1;
      }
      if (ok) scored.push({ f: cofid[i], score: score - name.length / 200 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.f);
  }
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
    const local = searchLocal(q);
    const cofidRes = searchCofid(q);
    const off = /^\d{8,14}$/.test(q.trim()) ? lookupBarcode(q.trim()).then((f) => (f ? [f] : [])) : searchOFF(q);
    return { local, cofid: cofidRes, off };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  return { loadCofid, importCofidWorkbook, searchCofid, cofidCount, searchLocal, recipeAsFood, lookupBarcode, searchOFF, search, loadScript };
})();
