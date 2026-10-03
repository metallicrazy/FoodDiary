/* FoodDiary — UI & app logic */
const UI = (() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, dp = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '–' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: dp, minimumFractionDigits: 0 });

  const APP_VERSION = '1.10.0';

  const CDN = {
    chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
    scanner: 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
  };

  let currentDate = Nutrition.dateKey(new Date());
  let weekOffset = 0;
  let addTab = 'results';
  let lastQuery = '';
  let searchSeq = 0;
  const charts = {};

  /* ===================== Toast / sheet ===================== */
  let toastTimer;
  function toast(msg, ms = 2200) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  let onSheetClose = null;
  function openSheet(html, { onClose } = {}) {
    closeSheet(true);
    $('#sheetBody').innerHTML = html;
    $('#sheet').classList.remove('hidden');
    $('.sheet-body').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    onSheetClose = onClose || null;
    if (!(history.state && history.state.sheet)) history.pushState({ sheet: true }, '');
  }
  function closeSheet(silent) {
    if ($('#sheet').classList.contains('hidden')) return;
    $('#sheet').classList.add('hidden');
    $('#sheetBody').innerHTML = '';
    document.body.style.overflow = '';
    const cb = onSheetClose; onSheetClose = null;
    if (cb) cb();
    if (!silent && history.state && history.state.sheet) history.back();
  }
  window.addEventListener('popstate', () => { if (!$('#sheet').classList.contains('hidden')) closeSheet(true); });

  /* ===================== Navigation ===================== */
  function goto(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
    $$('.tabbar .tab').forEach((t) => t.classList.toggle('active', t.dataset.goto === view));
    window.scrollTo({ top: 0 });
    if (view === 'today') renderToday();
    if (view === 'add') { renderAdd(); setTimeout(() => { if (!lastQuery) $('#searchInput').focus({ preventScroll: true }); }, 50); }
    if (view === 'progress') renderProgress();
    if (view === 'me') renderMe();
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) goto(g.dataset.goto);
  });

  /* ===================== TODAY ===================== */
  function dateLabel(key) {
    const today = Nutrition.dateKey(new Date());
    if (key === today) return 'Today';
    if (key === Nutrition.addDays(today, -1)) return 'Yesterday';
    if (key === Nutrition.addDays(today, 1)) return 'Tomorrow';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fullDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderToday() {
    const s = Store.state;
    $('#dateLabel').textContent = dateLabel(currentDate);
    $('#dateSub').textContent = fullDate(currentDate);
    $('#datePicker').value = currentDate;
    const list = Store.entries(currentDate);
    const tot = Nutrition.sum(list);
    const T = s.targets;

    // Ring
    const left = T.kcal - tot.kcal;
    const pct = Math.min(1, T.kcal ? tot.kcal / T.kcal : 0);
    const circ = 2 * Math.PI * 52;
    const ring = $('#kcalRing');
    ring.style.strokeDashoffset = String(circ * (1 - pct));
    ring.classList.toggle('over', left < 0);
    $('#kcalLeft').textContent = fmt(Math.abs(left));
    $('#kcalLeftLabel').textContent = left < 0 ? 'kcal over' : 'kcal left';
    $('#kcalEaten').textContent = fmt(tot.kcal);
    $('#kcalTarget').textContent = fmt(T.kcal);

    for (const m of ['protein', 'carbs', 'fat']) {
      const eaten = tot[m], target = T[m] || 0, l = target - eaten;
      const p = target ? Math.min(1, eaten / target) : 0;
      const bar = $('#' + m + 'Bar');
      bar.style.width = (p * 100).toFixed(1) + '%';
      bar.classList.toggle('over', l < 0);
      $('#' + m + 'Left').textContent = l < 0 ? `${fmt(-l)} g over` : `${fmt(l)} g left`;
      $('#' + m + 'Sub').textContent = `${fmt(eaten)} / ${fmt(target)} g`;
    }

    // Entries
    const el = $('#entryList');
    el.innerHTML = list.map((e) => entryRow(e)).join('');
    $('#emptyToday').classList.toggle('hidden', list.length > 0);
    const yKey = Nutrition.addDays(currentDate, -1);
    $('#copyYesterday').classList.toggle('hidden', !(list.length === 0 && Store.entries(yKey).length));

    // Banners
    const p = s.profile;
    $('#setupBanner').classList.toggle('hidden', !!(p.heightCm && p.weightKg && p.age) || s.onboarded);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const dismissed = localStorage.getItem('fooddiary.installDismissed');
    $('#installBanner').classList.toggle('hidden', standalone || !!dismissed);
    if (!/iphone|ipad|ipod/i.test(navigator.userAgent)) $('#installHint').textContent = 'Open the browser menu (⋮) and choose “Add to Home screen” or “Install app”.';
  }

  function thumbHTML(food, cls = '') {
    if (food.image) return `<div class="thumb ${cls}"><img src="${esc(food.image)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${emojiFor(food)}'"></div>`;
    return `<div class="thumb ${cls}">${emojiFor(food)}</div>`;
  }
  function emojiFor(f) {
    const n = (f.name || '').toLowerCase();
    const map = [[/apple|pear|banana|berry|orange|grape|fruit|melon|mango|peach|plum/, '🍎'], [/bread|toast|bagel|roll|loaf|pitta|wrap/, '🍞'], [/chicken|turkey|poultry/, '🍗'], [/beef|steak|mince|lamb|pork|bacon|ham|sausage|meat/, '🥩'], [/fish|salmon|tuna|cod|prawn|haddock|mackerel/, '🐟'], [/egg/, '🥚'], [/milk|yogurt|yoghurt|cream|cheese|butter/, '🥛'], [/rice|pasta|noodle|spaghetti/, '🍝'], [/potato|chip|fries|crisps/, '🥔'], [/salad|lettuce|spinach|kale|broccoli|carrot|veg|pepper|tomato|cucumber|onion/, '🥦'], [/chocolate|sweet|candy|biscuit|cookie|cake|dessert|ice cream/, '🍫'], [/coffee|tea/, '☕'], [/beer|wine|cider|lager|vodka|gin|whisky/, '🍺'], [/juice|drink|cola|water|squash|smoothie/, '🥤'], [/nut|almond|peanut|cashew|seed/, '🥜'], [/oat|cereal|granola|muesli|porridge/, '🥣'], [/soup|curry|stew|pie|pizza|burger|sandwich/, '🍲']];
    for (const [re, e] of map) if (re.test(n)) return e;
    return f.isRecipe || f.source === 'recipe' ? '🍲' : '🍽️';
  }
  function entryRow(e) {
    const f = e.food;
    return `<button class="item" data-entry="${e.id}">
      ${thumbHTML(f)}
      <div class="item-main">
        <div class="item-title">${esc(f.name)}</div>
        <div class="item-sub">${f.brand ? esc(f.brand) + ' · ' : ''}${fmt(e.grams)} g · P ${fmt(e.protein)} · C ${fmt(e.carbs)} · F ${fmt(e.fat)}</div>
      </div>
      <div class="item-kcal"><b>${fmt(e.kcal)}</b><small>kcal</small></div>
    </button>`;
  }

  $('#prevDay').addEventListener('click', () => { currentDate = Nutrition.addDays(currentDate, -1); renderToday(); });
  $('#nextDay').addEventListener('click', () => { currentDate = Nutrition.addDays(currentDate, 1); renderToday(); });
  $('#datePicker').addEventListener('change', (e) => { if (e.target.value) { currentDate = e.target.value; renderToday(); } });
  $('#copyYesterday').addEventListener('click', () => {
    const y = Store.entries(Nutrition.addDays(currentDate, -1));
    y.forEach((e) => Store.addEntry(currentDate, { food: e.food, grams: e.grams, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat }));
    toast(`Copied ${y.length} item${y.length === 1 ? '' : 's'}`); renderToday();
  });
  $('#dismissInstall').addEventListener('click', () => { localStorage.setItem('fooddiary.installDismissed', '1'); renderToday(); });
  $('#entryList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-entry]');
    if (!b) return;
    const entry = Store.entries(currentDate).find((x) => x.id === b.dataset.entry);
    if (entry) openFoodSheet(entry.food, { entry });
  });
  // Swipe between days
  let tx = null;
  $('#view-today').addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $('#view-today').addEventListener('touchend', (e) => {
    if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 90) { currentDate = Nutrition.addDays(currentDate, dx < 0 ? 1 : -1); renderToday(); }
  }, { passive: true });

  /* ===================== FOOD SHEET ===================== */
  function openFoodSheet(food, { entry = null, onAdd = null, dateKey = null } = {}) {
    const isEdit = !!entry;
    const grams = isEdit ? entry.grams : (food.servingG || 100);
    const quick = [];
    if (food.servingG) quick.push({ label: `1 serving (${fmt(food.servingG)} g)`, g: food.servingG });
    quick.push({ label: '50 g', g: 50 }, { label: '100 g', g: 100 }, { label: '200 g', g: 200 });
    const packG = parsePackSize(food.quantity);
    if (packG && !quick.some((q) => q.g === packG)) quick.push({ label: `Whole pack (${fmt(packG)} g)`, g: packG });
    if (food.totalG && food.servings) quick.push({ label: `1 portion (${fmt(food.totalG / food.servings)} g)`, g: Math.round(food.totalG / food.servings) });
    const unit = /ml|litre|^l$/i.test(food.quantity || '') || /drink|juice|milk|beer|wine|cola/i.test(food.name || '') ? 'g / ml' : 'g';
    const src = { off: 'Open Food Facts', cofid: 'UK CoFID', custom: 'My food', recipe: 'Recipe' }[food.source] || '';

    openSheet(`
      <div class="food-hero">
        ${thumbHTML(food)}
        <div class="meta">
          <h2>${esc(food.name)}</h2>
          <p>${food.brand ? esc(food.brand) : ''}${food.quantity ? ' · ' + esc(food.quantity) : ''}</p>
          <p><span class="badge ${esc(food.source)}">${src}</span>${food.barcode ? '<span class="muted small">' + esc(food.barcode) + '</span>' : ''}</p>
        </div>
        <button class="star ${Store.isFavourite(food.id) ? 'on' : ''}" id="favBtn" aria-label="Favourite">★</button>
      </div>
      <div class="amount">
        <button class="btn icon-only" id="gMinus">−</button>
        <input type="number" id="gramsInput" inputmode="decimal" min="0" step="1" value="${grams}">
        <span class="unit">${unit}</span>
        <button class="btn icon-only" id="gPlus">＋</button>
      </div>
      <div class="quick">${quick.map((q) => `<button class="chip" data-g="${q.g}">${esc(q.label)}</button>`).join('')}</div>
      <div class="totals" id="totals"></div>
      <table class="ntable">
        <tr><td>Per 100 ${unit.includes('ml') ? 'g/ml' : 'g'}</td><td></td></tr>
        <tr><td>Energy</td><td>${fmt(food.kcal)} kcal</td></tr>
        <tr><td>Fat</td><td>${fmt(food.fat, 1)} g</td></tr>
        ${food.satFat != null ? `<tr class="sub"><td>of which saturates</td><td>${fmt(food.satFat, 1)} g</td></tr>` : ''}
        <tr><td>Carbohydrate</td><td>${fmt(food.carbs, 1)} g</td></tr>
        ${food.sugars != null ? `<tr class="sub"><td>of which sugars</td><td>${fmt(food.sugars, 1)} g</td></tr>` : ''}
        ${food.fibre != null ? `<tr><td>Fibre</td><td>${fmt(food.fibre, 1)} g</td></tr>` : ''}
        <tr><td>Protein</td><td>${fmt(food.protein, 1)} g</td></tr>
        ${food.salt != null ? `<tr><td>Salt</td><td>${fmt(food.salt, 2)} g</td></tr>` : ''}
      </table>
      ${!isEdit && !onAdd ? `<label class="field">Add to<select id="addDate">${dateOptions(dateKey || currentDate)}</select></label>` : ''}
      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" id="deleteEntry">Delete</button>' : ''}
        ${food.source === 'custom' ? '<button class="btn" id="editCustom">Edit</button>' : ''}
        ${food.source === 'recipe' ? '<button class="btn" id="editRecipe">Edit recipe</button>' : ''}
        <button class="btn primary" id="addBtn">${isEdit ? 'Save' : onAdd ? 'Add ingredient' : 'Add to diary'}</button>
      </div>`);

    const input = $('#gramsInput');
    const update = () => {
      const g = parseFloat(input.value) || 0;
      const t = Nutrition.scale(food, g);
      $('#totals').innerHTML = `<div><b>${fmt(t.kcal)}</b><small>kcal</small></div><div><b>${fmt(t.protein, 1)}</b><small>protein g</small></div><div><b>${fmt(t.carbs, 1)}</b><small>carbs g</small></div><div><b>${fmt(t.fat, 1)}</b><small>fat g</small></div>`;
    };
    update();
    input.addEventListener('input', update);
    $('#gMinus').addEventListener('click', () => { input.value = Math.max(0, (parseFloat(input.value) || 0) - 10); update(); });
    $('#gPlus').addEventListener('click', () => { input.value = (parseFloat(input.value) || 0) + 10; update(); });
    $$('.quick .chip').forEach((c) => c.addEventListener('click', () => { input.value = c.dataset.g; update(); }));
    $('#favBtn').addEventListener('click', (e) => { const on = Store.toggleFavourite(food); e.currentTarget.classList.toggle('on', on); toast(on ? 'Added to favourites' : 'Removed from favourites'); });
    if (isEdit) $('#deleteEntry').addEventListener('click', () => { Store.removeEntry(currentDate, entry.id); closeSheet(); renderToday(); toast('Removed'); });
    if ($('#editCustom')) $('#editCustom').addEventListener('click', () => openCustomFoodSheet(food));
    if ($('#editRecipe')) $('#editRecipe').addEventListener('click', () => { const r = Store.state.recipes.find((x) => x.id === food.id); if (r) openRecipeSheet(r); });
    $('#addBtn').addEventListener('click', () => {
      const g = parseFloat(input.value) || 0;
      if (g <= 0) return toast('Enter an amount');
      const t = Nutrition.scale(food, g);
      if (onAdd) { closeSheet(true); onAdd(Store.slimFood(food), g); return; }
      if (isEdit) { Store.updateEntry(currentDate, entry.id, { grams: g, ...t }); closeSheet(); renderToday(); toast('Updated'); return; }
      const dk = $('#addDate') ? $('#addDate').value : currentDate;
      Store.addEntry(dk, { food: Store.slimFood(food), grams: g, ...t });
      closeSheet(); toast(`Added ${fmt(t.kcal)} kcal to ${dateLabel(dk).toLowerCase()}`);
      currentDate = dk; goto('today');
    });
  }
  function dateOptions(sel) {
    const today = Nutrition.dateKey(new Date());
    const keys = [Nutrition.addDays(today, 1), today, Nutrition.addDays(today, -1), Nutrition.addDays(today, -2)];
    if (!keys.includes(sel)) keys.push(sel);
    return keys.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${dateLabel(k)}</option>`).join('');
  }
  function parsePackSize(q) {
    if (!q) return null;
    const m = String(q).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl)\b/i);
    if (!m) return null;
    let v = parseFloat(m[1].replace(',', '.'));
    const u = m[2].toLowerCase();
    if (u === 'kg' || u === 'l') v *= 1000; if (u === 'cl') v *= 10;
    const mult = String(q).match(/(\d+)\s*[x×]\s*\d/i);
    if (mult) v *= parseInt(mult[1], 10);
    return v > 0 && v < 5000 ? Math.round(v) : null;
  }

  /* ===================== ADD / SEARCH ===================== */
  const input = $('#searchInput');
  let debounce;
  input.addEventListener('input', () => {
    $('#clearSearch').classList.toggle('hidden', !input.value);
    clearTimeout(debounce);
    const q = input.value.trim();
    if (addTab !== 'results') { addTab = 'results'; $$('#addTabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'results')); }
    if (!q) return renderIdle();
    // Local sources update instantly; Open Food Facts search waits for a pause (rate-limited API).
    renderResults(q, { offPending: q.length >= 3 && !offResults.has(q) });
    if (q.length >= 3 && !offResults.has(q)) debounce = setTimeout(() => runSearch(q), 700);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); runSearch(input.value.trim()); input.blur(); } });
  $('#clearSearch').addEventListener('click', () => { input.value = ''; lastQuery = ''; $('#clearSearch').classList.add('hidden'); renderAdd(); input.focus(); });
  $('#addTabs').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    addTab = c.dataset.tab; $$('#addTabs .chip').forEach((x) => x.classList.toggle('active', x === c)); renderAdd();
  });
  $('#newCustomBtn').addEventListener('click', () => openCustomFoodSheet(null));
  $('#newRecipeBtn').addEventListener('click', () => openRecipeSheet(null));
  $('#scanBtn').addEventListener('click', () => openScanner());

  const offResults = new Map(); // query -> foods
  async function runSearch(q) {
    if (!q) return renderAdd();
    lastQuery = q;
    const seq = ++searchSeq;
    renderResults(q, { offPending: true });
    try {
      const res = Sources.search(q);
      const off = await res.off;
      if (seq !== searchSeq) return;
      offResults.set(q, off);
      renderResults(q, {});
    } catch (err) {
      if (seq !== searchSeq) return;
      renderResults(q, { offError: err.message });
    }
  }
  function renderAdd() {
    const q = input.value.trim();
    if (addTab === 'results') return q ? renderResults(q, { offPending: !offResults.has(q) && q.length >= 3 }) : renderIdle();
    const s = Store.state;
    const lists = { recents: s.recents, favourites: s.favourites, mine: s.customFoods, recipes: s.recipes.map(Sources.recipeAsFood) };
    const list = lists[addTab] || [];
    const empties = { recents: 'Foods you log will appear here for quick re-adding.', favourites: 'Tap ★ on any food to keep it here.', mine: 'Create a custom food from a photo of the nutrition label.', recipes: 'Build a recipe once and log it as a single item.' };
    $('#addContent').innerHTML = list.length ? `<div class="list">${list.map(foodRow).join('')}</div>` : `<div class="empty"><div class="empty-icon">${{ recents: '🕒', favourites: '★', mine: '🏷️', recipes: '🥘' }[addTab]}</div><p>${empties[addTab]}</p></div>`;
    bindFoodRows();
  }
  function renderIdle() {
    const s = Store.state;
    const rec = s.recents.slice(0, 8);
    const fav = s.favourites.slice(0, 8);
    let html = '';
    if (fav.length) html += `<div class="group-title">Favourites</div><div class="list">${fav.map(foodRow).join('')}</div>`;
    if (rec.length) html += `<div class="group-title">Recent</div><div class="list">${rec.map(foodRow).join('')}</div>`;
    if (!html) html = `<div class="empty"><div class="empty-icon">🔍</div><p>Search ${Sources.cofidCount() ? 'thousands of UK foods and ' : ''}millions of barcoded products, or scan a barcode.</p></div>`;
    $('#addContent').innerHTML = html; bindFoodRows();
  }
  function renderResults(q, { offPending = false, offError = null } = {}) {
    if (addTab !== 'results') return;
    const local = Sources.searchLocal(q);
    const cof = Sources.searchCofid(q, 20);
    const off = offResults.get(q);
    let html = '';
    if (local.length) html += `<div class="group-title">My foods & recipes</div><div class="list">${local.map(foodRow).join('')}</div>`;
    if (cof.length) html += `<div class="group-title">UK foods</div><div class="list">${cof.map(foodRow).join('')}</div>`;
    html += `<div class="group-title">Products ${offPending ? '<span class="spinner"></span>' : ''}</div>`;
    if (off && off.length) html += `<div class="list">${off.map(foodRow).join('')}</div>`;
    else if (offError) html += `<div class="inline-note">${esc(offError)}</div>`;
    else if (!offPending && off) html += `<div class="inline-note">No products found for “${esc(q)}”. Try a shorter name or scan the barcode.</div>`;
    else if (!offPending && q.length < 3) html += `<div class="inline-note">Type at least 3 letters or press search.</div>`;
    $('#addContent').innerHTML = html; bindFoodRows();
  }
  const COFID_GROUPS = { A: 'Cereals', B: 'Dairy', C: 'Eggs', D: 'Vegetables', F: 'Fruit', G: 'Nuts & seeds', H: 'Herbs & spices', J: 'Fish', M: 'Meat', O: 'Fats & oils', P: 'Drinks', Q: 'Alcoholic drinks', S: 'Sugars & snacks', W: 'Soups & sauces' };
  const groupName = (code) => COFID_GROUPS[String(code || '').charAt(0).toUpperCase()] || 'UK food';
  function foodRow(f) {
    const src = { off: 'OFF', cofid: 'UK', custom: 'Mine', recipe: 'Recipe' }[f.source] || '';
    return `<button class="item" data-food="${esc(f.id)}">
      ${thumbHTML(f)}
      <div class="item-main">
        <div class="item-title">${esc(f.name)}</div>
        <div class="item-sub"><span class="badge ${esc(f.source)}">${src}</span>${f.brand ? esc(f.brand) : (f.source === 'cofid' ? groupName(f.group) : '')}${f.quantity ? ' · ' + esc(f.quantity) : ''}</div>
      </div>
      <div class="item-kcal"><b>${fmt(f.kcal)}</b><small>kcal/100g</small></div>
    </button>`;
  }
  const foodIndex = new Map();
  function bindFoodRows(onPick) {
    foodIndex.clear();
    const all = [...Store.state.recents, ...Store.state.favourites, ...Store.state.customFoods, ...Store.state.recipes.map(Sources.recipeAsFood), ...Object.values(Store.state.cache)];
    for (const list of offResults.values()) all.push(...list);
    all.forEach((f) => foodIndex.set(f.id, f));
    Sources.searchCofid(input.value.trim(), 50).forEach((f) => foodIndex.set(f.id, f));
  }
  $('#addContent').addEventListener('click', (e) => {
    const b = e.target.closest('[data-food]'); if (!b) return;
    const f = foodIndex.get(b.dataset.food);
    if (f) openFoodSheet(f);
  });

  /* ===================== SCANNER ===================== */
  let scanner = null;
  async function openScanner(onCode) {
    openSheet(`
      <div class="sheet-title"><h2>Scan barcode</h2><button class="icon-btn" id="closeScan">✕</button></div>
      <div class="scan-area" id="reader"></div>
      <p class="scan-hint" id="scanHint">Point the camera at the barcode</p>
      <div class="manual-code"><input type="text" id="manualCode" inputmode="numeric" placeholder="or type the barcode number"><button class="btn primary" id="manualGo">Look up</button></div>`,
      { onClose: stopScanner });
    $('#closeScan').addEventListener('click', () => closeSheet());
    const handle = async (code) => {
      await stopScanner();
      if (onCode) { onCode(code); return; }
      $('#scanHint').innerHTML = `<span class="spinner"></span> Looking up ${esc(code)}…`;
      try {
        const f = await Sources.lookupBarcode(code);
        if (f) { if (navigator.vibrate) navigator.vibrate(30); openFoodSheet(f); }
        else {
          openSheet(`<div class="sheet-title"><h2>Not found</h2></div>
            <p>Barcode <b>${esc(code)}</b> isn't in Open Food Facts yet.</p>
            <p class="muted small">You can create it from the nutrition label – it'll be saved to <b>My foods</b> with this barcode so scanning works next time.</p>
            <div class="sheet-actions"><button class="btn" id="scanAgain">Scan again</button><button class="btn primary" id="createFromCode">Create custom food</button></div>`);
          $('#scanAgain').addEventListener('click', () => openScanner());
          $('#createFromCode').addEventListener('click', () => openCustomFoodSheet({ barcode: code }));
        }
      } catch (err) { $('#scanHint').textContent = err.message; }
    };
    $('#manualGo').addEventListener('click', () => { const c = $('#manualCode').value.replace(/\D/g, ''); if (c.length >= 8) handle(c); else toast('Enter the full barcode number'); });
    $('#manualCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#manualGo').click(); });
    // Local custom foods with barcodes take precedence
    const localHandle = (code) => {
      if (onCode) return false;
      const mine = Store.state.customFoods.find((f) => f.barcode === code);
      if (mine) { stopScanner(); openFoodSheet(mine); return true; }
      return false;
    };
    try {
      if (typeof Html5Qrcode === 'undefined') await Sources.loadScript(CDN.scanner);
      const formats = [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.CODE_128];
      scanner = new Html5Qrcode('reader', { formatsToSupport: formats, experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
      let done = false;
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(300, Math.round(w * 0.85)), height: Math.round(Math.min(300, w * 0.85) * 0.5) }), aspectRatio: 1.333 },
        (text) => { if (done) return; done = true; const code = text.replace(/\D/g, ''); if (!localHandle(code)) handle(code); },
        () => {});
    } catch (err) {
      console.warn(err);
      $('#scanHint').textContent = 'Camera unavailable – ' + (String(err).includes('Permission') || String(err).includes('NotAllowed') ? 'allow camera access in your browser settings, or type the barcode below.' : 'type the barcode below.');
    }
  }
  async function stopScanner() {
    if (scanner) { try { await scanner.stop(); scanner.clear(); } catch (e) { /* ignore */ } scanner = null; }
  }

  /* ===================== CUSTOM FOOD (with label OCR) ===================== */
  function openCustomFoodSheet(seed) {
    const f = Object.assign({ name: '', brand: '', barcode: '', kcal: '', protein: '', carbs: '', fat: '', satFat: '', sugars: '', fibre: '', salt: '', servingG: '', image: null }, seed || {});
    const isEdit = !!(seed && seed.id);
    const v = (x) => (x === null || x === undefined ? '' : x);
    openSheet(`
      <div class="sheet-title"><h2>${isEdit ? 'Edit food' : 'New custom food'}</h2><button class="icon-btn" id="closeCF">✕</button></div>
      <div class="row-btns">
        <label class="btn primary file-btn">📷 Scan nutrition label<input type="file" id="labelPhoto" accept="image/*" capture="environment" hidden></label>
        <label class="btn ghost file-btn">🖼️ Product photo<input type="file" id="productPhoto" accept="image/*" hidden></label>
      </div>
      <div id="ocrBox"></div>
      <div class="food-hero" id="cfHero">${thumbHTML(f)}<div class="meta"><p class="muted small">Values are per 100 g (or 100 ml). Check anything read from the label before saving.</p></div></div>
      <div class="form-grid">
        <label class="span2">Name<input type="text" id="cfName" value="${esc(f.name)}" placeholder="e.g. Granola, Tesco"></label>
        <label class="span2">Energy (kcal)<input type="number" id="cfKcal" inputmode="decimal" value="${v(f.kcal)}"></label>
        <label>Protein (g)<input type="number" id="cfProtein" inputmode="decimal" step="0.1" value="${v(f.protein)}"></label>
        <label>Carbs (g)<input type="number" id="cfCarbs" inputmode="decimal" step="0.1" value="${v(f.carbs)}"></label>
        <label>Fat (g)<input type="number" id="cfFat" inputmode="decimal" step="0.1" value="${v(f.fat)}"></label>
        <label>Brand <span class="opt">optional</span><input type="text" id="cfBrand" value="${esc(f.brand)}"></label>
        <label class="span2">Barcode <span class="opt">optional</span><input type="text" id="cfBarcode" inputmode="numeric" value="${esc(f.barcode)}"></label>
      </div>
      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" id="cfDelete">Delete</button>' : ''}
        <button class="btn primary" id="cfSave">Save food</button>
      </div>`);
    $('#closeCF').addEventListener('click', () => closeSheet());
    let image = f.image || null;
    $('#productPhoto').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      image = await fileToDataURL(file, 256, 0.8);
      $('#cfHero .thumb').innerHTML = `<img src="${image}" alt="">`;
    });
    $('#labelPhoto').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      await runLabelOCR(file);
    });
    async function runLabelOCR(file) {
      const box = $('#ocrBox');
      try {
        const preview = await fileToDataURL(file, 1600, 0.9, true);
        box.innerHTML = `<img class="ocr-preview" src="${preview}" alt="Label"><div class="progressline"><div id="ocrBar"></div></div><p class="muted small" id="ocrStatus">Loading text recognition…</p>`;
        if (typeof Tesseract === 'undefined') await Sources.loadScript(CDN.tesseract);
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: (m) => { if (m.status === 'recognizing text') { $('#ocrBar').style.width = Math.round(m.progress * 100) + '%'; $('#ocrStatus').textContent = 'Reading label… ' + Math.round(m.progress * 100) + '%'; } else if ($('#ocrStatus')) $('#ocrStatus').textContent = m.status.replace(/_/g, ' ') + '…'; }
        });
        await worker.setParameters({ preserve_interword_spaces: '1' });
        const { data } = await worker.recognize(preview);
        await worker.terminate();
        const r = Nutrition.parseLabelText(data.text);
        const set = (id, val) => { if (val !== null && val !== undefined) $(id).value = val; };
        set('#cfKcal', r.kcal); set('#cfFat', r.fat); set('#cfCarbs', r.carbs); set('#cfProtein', r.protein);
        const n = ['kcal', 'fat', 'carbs', 'protein'].filter((k) => r[k] !== null).length;
        if (n === 4) box.innerHTML = `<div class="inline-note">✅ Read energy, fat, carbs and protein from the label. Please double-check the numbers below.</div>`;
        else if (n > 0) box.innerHTML = `<div class="inline-note">⚠️ Read ${n} of 4 main values. Fill in the rest by hand, or retake the photo closer and in good light.</div><details class="small muted"><summary>Text found</summary><pre style="white-space:pre-wrap">${esc(data.text)}</pre></details>`;
        else box.innerHTML = `<div class="inline-note">Couldn't read a nutrition table. Try a straight-on, well-lit photo with the table filling the frame.</div><details class="small muted"><summary>Text found</summary><pre style="white-space:pre-wrap">${esc(data.text)}</pre></details>`;
      } catch (err) {
        console.error(err);
        box.innerHTML = `<div class="inline-note">Text recognition failed (${esc(err.message || err)}). You can still type the values.</div>`;
      }
    }
    const numv = (id) => { const x = parseFloat($(id).value); return Number.isFinite(x) ? x : null; };
    const keep = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null); // preserve values from label OCR / earlier edits; never store ''
    $('#cfSave').addEventListener('click', () => {
      const name = $('#cfName').value.trim();
      if (!name) return toast('Give the food a name');
      const kcal = numv('#cfKcal');
      if (kcal === null) return toast('Energy (kcal) is required');
      const food = Store.saveCustomFood({
        id: f.id, name, brand: $('#cfBrand').value.trim(), barcode: $('#cfBarcode').value.replace(/\D/g, ''),
        kcal, protein: numv('#cfProtein') ?? 0, carbs: numv('#cfCarbs') ?? 0, fat: numv('#cfFat') ?? 0,
        satFat: keep(f.satFat), sugars: keep(f.sugars), fibre: keep(f.fibre), salt: keep(f.salt), servingG: keep(f.servingG), image
      });
      toast(isEdit ? 'Food updated' : 'Food saved');
      openFoodSheet(food);
    });
    if (isEdit) $('#cfDelete').addEventListener('click', () => { Store.deleteCustomFood(f.id); closeSheet(); renderAdd(); toast('Deleted'); });
  }

  function fileToDataURL(file, maxSide, quality, enhance = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        if (enhance) {
          // greyscale + contrast stretch helps OCR on glossy packaging
          const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
          let min = 255, max = 0;
          for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; if (g < min) min = g; if (g > max) max = g; }
          const range = Math.max(1, max - min);
          for (let i = 0; i < d.length; i += 4) { const g = ((d[i] - min) / range) * 255; d[i] = d[i + 1] = d[i + 2] = g; }
          ctx.putImageData(id, 0, 0);
        }
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* ===================== RECIPES ===================== */
  function openRecipeSheet(recipe) {
    const r = recipe ? JSON.parse(JSON.stringify(recipe)) : { name: '', servings: 4, ingredients: [], totalG: null, image: null };
    const isEdit = !!(recipe && recipe.id);
    openSheet(`
      <div class="sheet-title"><h2>${isEdit ? 'Edit recipe' : 'New recipe'}</h2><button class="icon-btn" id="closeR">✕</button></div>
      <div class="form-grid">
        <label class="span2">Recipe name<input type="text" id="rName" value="${esc(r.name)}" placeholder="e.g. Chicken curry"></label>
        <label>Servings<input type="number" id="rServings" inputmode="numeric" min="1" value="${r.servings}"></label>
        <label>Cooked weight (g)<input type="number" id="rTotal" inputmode="decimal" placeholder="auto" value="${r.totalG ?? ''}"></label>
      </div>
      <div class="group-title">Ingredients</div>
      <div class="ingredients" id="rIngredients"></div>
      <div class="row-btns" style="margin:0"><button class="btn ghost" id="rFromDiary">🗓️ From my diary</button><button class="btn ghost" id="rAddIng">＋ Search foods</button></div>
      <div class="totals" id="rTotals" style="margin-top:12px"></div>
      <p class="muted small" id="rPer"></p>
      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" id="rDelete">Delete</button>' : ''}
        <button class="btn primary" id="rSave">Save recipe</button>
      </div>`);
    $('#closeR').addEventListener('click', () => closeSheet());
    const draw = () => {
      $('#rIngredients').innerHTML = r.ingredients.map((ing, i) => `<div class="ingredient"><span class="name">${esc(ing.food.name)}</span><input type="number" data-i="${i}" value="${ing.grams}" inputmode="decimal"><span class="muted small">g</span><button class="x" data-del="${i}">✕</button></div>`).join('') || '<p class="muted small">No ingredients yet.</p>';
      const sumG = r.ingredients.reduce((a, x) => a + (x.grams || 0), 0);
      const tot = Nutrition.sum(r.ingredients.map((x) => Nutrition.scale(x.food, x.grams)));
      const servings = Math.max(1, parseInt($('#rServings').value, 10) || 1);
      const totalG = parseFloat($('#rTotal').value) || sumG;
      $('#rTotals').innerHTML = `<div><b>${fmt(tot.kcal)}</b><small>kcal total</small></div><div><b>${fmt(tot.protein)}</b><small>protein g</small></div><div><b>${fmt(tot.carbs)}</b><small>carbs g</small></div><div><b>${fmt(tot.fat)}</b><small>fat g</small></div>`;
      $('#rPer').textContent = sumG ? `${fmt(totalG)} g total → ${fmt(tot.kcal / servings)} kcal per serving (${fmt(totalG / servings)} g). Per 100 g: ${fmt((tot.kcal / totalG) * 100)} kcal.` : '';
      $('#rTotal').placeholder = sumG ? `auto (${fmt(sumG)})` : 'auto';
    };
    draw();
    $('#rIngredients').addEventListener('input', (e) => { const i = e.target.dataset.i; if (i !== undefined) { r.ingredients[i].grams = parseFloat(e.target.value) || 0; draw(); } });
    $('#rIngredients').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { r.ingredients.splice(+d.dataset.del, 1); draw(); } });
    $('#rServings').addEventListener('input', draw); $('#rTotal').addEventListener('input', draw);
    const snapshot = () => Object.assign(r, { name: $('#rName').value, servings: parseInt($('#rServings').value, 10) || r.servings, totalG: parseFloat($('#rTotal').value) || null });
    $('#rAddIng').addEventListener('click', () => { snapshot(); openIngredientPicker((food, grams) => { r.ingredients.push({ food, grams }); openRecipeSheet(r); }, r); });
    $('#rFromDiary').addEventListener('click', () => { snapshot(); openDiaryPicker((items) => { items.forEach((x) => r.ingredients.push(x)); openRecipeSheet(r); toast(`Added ${items.length} item${items.length === 1 ? '' : 's'} from your diary`); }, r); });
    $('#rSave').addEventListener('click', () => {
      const name = $('#rName').value.trim(); if (!name) return toast('Name the recipe');
      if (!r.ingredients.length) return toast('Add at least one ingredient');
      const sumG = r.ingredients.reduce((a, x) => a + (x.grams || 0), 0);
      const totalG = parseFloat($('#rTotal').value) || sumG;
      const servings = Math.max(1, parseInt($('#rServings').value, 10) || 1);
      const tot = Nutrition.sum(r.ingredients.map((x) => Nutrition.scaleExact(x.food, x.grams)));
      const per100 = { kcal: Math.round((tot.kcal / totalG) * 100), protein: +((tot.protein / totalG) * 100).toFixed(1), carbs: +((tot.carbs / totalG) * 100).toFixed(1), fat: +((tot.fat / totalG) * 100).toFixed(1) };
      const saved = Store.saveRecipe({ id: r.id, name, servings, totalG, ingredients: r.ingredients, per100, servingG: Math.round(totalG / servings), servingLabel: '1 serving', image: r.image });
      closeSheet(); toast('Recipe saved'); addTab = 'recipes'; $$('#addTabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'recipes')); renderAdd();
      openFoodSheet(Sources.recipeAsFood(saved));
    });
    if (isEdit) $('#rDelete').addEventListener('click', () => { Store.deleteRecipe(r.id); closeSheet(); renderAdd(); toast('Recipe deleted'); });
  }
  // Mini search inside a sheet, used to pick recipe ingredients.
  function openIngredientPicker(onPick, draftRecipe) {
    openSheet(`
      <div class="sheet-title"><h2>Add ingredient</h2><button class="icon-btn" id="closeIP">✕</button></div>
      <div class="searchbar"><div class="search-input"><span class="search-icon">⌕</span><input type="search" id="ipInput" placeholder="Search foods or barcode" autocomplete="off"></div><button class="btn icon-only accent" id="ipScan">▦</button></div>
      <div id="ipResults" class="list"></div>`);
    $('#closeIP').addEventListener('click', () => openRecipeSheet(draftRecipe));
    const ipIndex = new Map();
    const show = (foods, pending) => {
      $('#ipResults').innerHTML = (foods.map((f) => { ipIndex.set(f.id, f); return foodRow(f); }).join('')) + (pending ? '<div class="group-title"><span class="spinner"></span> Searching products…</div>' : '');
    };
    const ipInput = $('#ipInput');
    let t;
    const doSearch = async () => {
      const q = ipInput.value.trim();
      if (!q) { show([...Store.state.recents.slice(0, 10), ...Store.state.customFoods.slice(0, 10)], false); return; }
      const local = [...Sources.searchLocal(q).filter((f) => f.source !== 'recipe'), ...Sources.searchCofid(q, 15)];
      show(local, q.length >= 3);
      if (q.length < 3) return;
      try { const off = await Sources.search(q).off; if (ipInput.value.trim() === q) show([...local, ...off], false); } catch (e) { show(local, false); }
    };
    ipInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(doSearch, 700); });
    ipInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); doSearch(); } });
    $('#ipScan').addEventListener('click', () => openScanner(async (code) => {
      const mine = Store.state.customFoods.find((f) => f.barcode === code);
      const f = mine || await Sources.lookupBarcode(code).catch(() => null);
      if (f) openFoodSheet(f, { onAdd: onPick }); else { toast('Barcode not found'); openIngredientPicker(onPick, draftRecipe); }
    }));
    $('#ipResults').addEventListener('click', (e) => { const b = e.target.closest('[data-food]'); if (!b) return; const f = ipIndex.get(b.dataset.food); if (f) openFoodSheet(f, { onAdd: onPick }); });
    doSearch();
    setTimeout(() => ipInput.focus(), 50);
  }

  // Pick already-logged foods from the last 7 days to reuse in a recipe.
  function openDiaryPicker(onDone, draftRecipe) {
    const today = Nutrition.dateKey(new Date());
    const days = Array.from({ length: 7 }, (_, i) => Nutrition.addDays(today, -i));
    let day = today;
    const selected = new Map(); // entryId -> { food, grams }
    openSheet(`
      <div class="sheet-title"><h2>From my diary</h2><button class="icon-btn" id="closeDP">✕</button></div>
      <p class="muted small" style="margin:0 0 8px">Pick a day, then tick the foods to add. Amounts come from what you logged.</p>
      <div class="chips" id="dpDays">${days.map((d) => `<button class="chip ${d === today ? 'active' : ''}" data-day="${d}">${dateLabel(d)}${Store.entries(d).length ? ` <small>· ${Store.entries(d).length}</small>` : ''}</button>`).join('')}</div>
      <div class="section-head" style="margin:4px 2px 6px"><span class="muted small" id="dpCount"></span><button class="link-btn" id="dpAll">Select all</button></div>
      <div class="list" id="dpList"></div>
      <div class="sheet-actions"><button class="btn" id="dpCancel">Cancel</button><button class="btn primary" id="dpAdd" disabled>Add to recipe</button></div>`);
    const back = () => openRecipeSheet(draftRecipe);
    $('#closeDP').addEventListener('click', back); $('#dpCancel').addEventListener('click', back);
    const drawList = () => {
      const list = Store.entries(day);
      $('#dpList').innerHTML = list.length ? list.map((e) => `<button class="item selectable ${selected.has(e.id) ? 'selected' : ''}" data-pick="${e.id}">
          <span class="check"></span>${thumbHTML(e.food)}
          <div class="item-main"><div class="item-title">${esc(e.food.name)}</div><div class="item-sub">${e.food.brand ? esc(e.food.brand) + ' · ' : ''}${fmt(e.grams)} g</div></div>
          <div class="item-kcal"><b>${fmt(e.kcal)}</b><small>kcal</small></div></button>`).join('')
        : `<div class="empty" style="padding:24px"><div class="empty-icon">📭</div><p>Nothing logged on ${dateLabel(day).toLowerCase()}.</p></div>`;
      const allDay = list.length && list.every((e) => selected.has(e.id));
      $('#dpAll').textContent = allDay ? 'Clear day' : 'Select all';
      $('#dpAll').classList.toggle('hidden', !list.length);
      const n = selected.size;
      $('#dpCount').textContent = n ? `${n} selected` : '';
      $('#dpAdd').disabled = !n; $('#dpAdd').textContent = n ? `Add ${n} to recipe` : 'Add to recipe';
    };
    drawList();
    $('#dpDays').addEventListener('click', (e) => {
      const c = e.target.closest('[data-day]'); if (!c) return;
      day = c.dataset.day; $$('#dpDays .chip').forEach((x) => x.classList.toggle('active', x === c)); drawList();
    });
    $('#dpList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const entry = Store.entries(day).find((x) => x.id === b.dataset.pick); if (!entry) return;
      if (selected.has(entry.id)) selected.delete(entry.id); else selected.set(entry.id, { food: Store.slimFood(entry.food), grams: entry.grams });
      drawList();
    });
    $('#dpAll').addEventListener('click', () => {
      const list = Store.entries(day);
      if (list.every((e) => selected.has(e.id))) list.forEach((e) => selected.delete(e.id));
      else list.forEach((e) => selected.set(e.id, { food: Store.slimFood(e.food), grams: e.grams }));
      drawList();
    });
    $('#dpAdd').addEventListener('click', () => { if (selected.size) { closeSheet(true); onDone([...selected.values()]); } });
  }

  /* ===================== PROGRESS ===================== */
  function weekKeys(offset) {
    const today = new Date(); const dow = (today.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(today); monday.setDate(today.getDate() - dow + offset * 7);
    return Array.from({ length: 7 }, (_, i) => Nutrition.dateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  }
  async function renderProgress() {
    if (typeof Chart === 'undefined') {
      try { await Sources.loadScript(CDN.chart); } catch (e) { $('#weekKpis').innerHTML = '<div class="inline-note">Charts need an internet connection the first time.</div>'; return; }
    }
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    Chart.defaults.color = col('--muted'); Chart.defaults.borderColor = col('--line'); Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

    const keys = weekKeys(weekOffset);
    const T = Store.state.targets;
    const days = keys.map((k) => Nutrition.sum(Store.entries(k)));
    const labels = keys.map((k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' }); });
    const first = keys[0].split('-'), last = keys[6].split('-');
    $('#weekLabel').textContent = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${+first[2]}/${+first[1]} – ${+last[2]}/${+last[1]}`;
    $('#nextWeek').disabled = weekOffset >= 0;

    const todayKey = Nutrition.dateKey(new Date());
    const logged = keys.filter((k, i) => Store.entries(k).length && k <= todayKey);
    const avg = logged.length ? Math.round(logged.reduce((a, k, i) => a + days[keys.indexOf(k)].kcal, 0) / logged.length) : 0;
    const onTarget = logged.filter((k) => days[keys.indexOf(k)].kcal <= T.kcal).length;
    $('#weekKpis').innerHTML = `<div class="kpi"><b>${fmt(avg)}</b><small>avg kcal / day</small></div><div class="kpi"><b>${avg ? (avg - T.kcal > 0 ? '+' : '') + fmt(avg - T.kcal) : '–'}</b><small>vs target</small></div><div class="kpi"><b>${logged.length ? onTarget + '/' + logged.length : '–'}</b><small>days on target</small></div>`;

    draw('kcalChart', {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'kcal', data: days.map((d) => d.kcal), backgroundColor: days.map((d) => d.kcal > T.kcal ? col('--danger') : col('--accent')), borderRadius: 8, borderSkipped: false, maxBarThickness: 34 },
        { label: 'Target', data: labels.map(() => T.kcal), type: 'line', borderColor: col('--muted'), borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false }
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.raw)} kcal` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: col('--line') }, ticks: { maxTicksLimit: 5 } } } }
    });
    draw('macroChart', {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Protein', data: days.map((d) => Math.round(d.protein)), backgroundColor: col('--protein'), borderRadius: 4, maxBarThickness: 34 },
        { label: 'Carbs', data: days.map((d) => Math.round(d.carbs)), backgroundColor: col('--carbs'), borderRadius: 4, maxBarThickness: 34 },
        { label: 'Fat', data: days.map((d) => Math.round(d.fat)), backgroundColor: col('--fat'), borderRadius: 4, maxBarThickness: 34 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)} g (target ${fmt(T[c.dataset.label.toLowerCase()])} g)` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { maxTicksLimit: 5, callback: (v) => v + ' g' } } } }
    });
    renderWeight(col);
  }
  function renderWeight(col) {
    const s = Store.state;
    const range = parseInt($('#weightRange').value, 10);
    const todayKey = Nutrition.dateKey(new Date());
    const from = range ? Nutrition.addDays(todayKey, -range) : '0000';
    const pts = s.weights.filter((w) => w.date >= from);
    const latest = Store.latestWeight();
    const todayW = s.weights.find((w) => w.date === todayKey);
    $('#weightInput').value = '';
    $('#weightInput').placeholder = "Enter today's weight";
    $('#weightTodayNote').textContent = todayW ? `Today's reading: ${fmt(todayW.kg, 1)} kg — logging again replaces it.` : 'One reading per day — weigh in at the same time each day, ideally first thing.';
    $('#logWeightBtn').textContent = todayW ? 'Update today' : 'Log today';
    updateWeightButton();
    const startKg = s.profile.startWeightKg || (s.weights[0] && s.weights[0].kg) || null;
    const change = startKg && latest ? Math.round((latest.kg - startKg) * 10) / 10 : null;
    const b = Nutrition.bmi(latest && latest.kg, s.profile.heightCm);
    $('#weightKpis').innerHTML = `<div class="kpi"><b>${startKg ? fmt(startKg, 1) : '–'}</b><small>start kg</small></div><div class="kpi"><b>${latest ? fmt(latest.kg, 1) : '–'}</b><small>now kg</small></div><div class="kpi ${change === null ? '' : change < 0 ? 'good' : change > 0 ? 'bad' : ''}"><b>${change === null ? '–' : (change > 0 ? '+' : '') + fmt(change, 1)}</b><small>kg since start</small></div>`;
    if (b) {
      const h = s.profile.heightCm, m2 = (h / 100) ** 2, kg = latest.kg;
      const LO = 12, HI = 40, pct = (v) => Math.max(0, Math.min(100, ((v - LO) / (HI - LO)) * 100));
      const kgAt = (bmiV) => Math.round(bmiV * m2 * 10) / 10;
      const targetBmi = s.profile.targetBmi || 24.9;
      const targetKg = kgAt(targetBmi);
      const diff = Math.round((kg - targetKg) * 10) / 10;
      let msg;
      if (diff > 0.05) msg = `Lose <b>${fmt(diff, 1)} kg</b> to reach target BMI of ${targetBmi} (${fmt(targetKg, 1)} kg).`;
      else if (diff < -0.05) msg = `You're <b>${fmt(-diff, 1)} kg</b> under your target BMI of ${targetBmi} (${fmt(targetKg, 1)} kg).`;
      else msg = `You're right on your target BMI of ${targetBmi} (${fmt(targetKg, 1)} kg).`;
      const marks = [[18.5, 'edge'], [22, 'mid'], [25, 'edge'], [30, 'edge'], [40, 'end']];
      $('#bmiCard').innerHTML = `
        <div class="bmi-top">
          <div><div class="bmi-val">${b}</div><div class="muted small">BMI</div></div>
          <div style="flex:1"><div class="bmi-cat">${Nutrition.bmiCategory(b)}</div><div class="muted small">${fmt(kg, 1)} kg · ${fmt(h)} cm</div></div>
          <label class="bmi-target">Target BMI<input type="number" id="targetBmi" step="0.1" min="15" max="35" inputmode="decimal" value="${targetBmi}"></label>
        </div>
        <div class="bmi-scale-wrap">
          <div class="bmi-labels top">${marks.map(([v, k]) => `<span class="${k}" style="left:${pct(v)}%">${fmt(kgAt(v), 1)}<small>kg</small></span>`).join('')}</div>
          <div class="bmi-scale">
            <i class="tgt" style="left:${pct(targetBmi)}%" title="Target BMI ${targetBmi}"></i>
            <i class="me" style="left:${pct(b)}%" title="You: BMI ${b}"></i>
          </div>
          <div class="bmi-labels bottom">${marks.map(([v, k]) => `<span class="${k}" style="left:${pct(v)}%">${v}</span>`).join('')}</div>
        </div>
        <div class="legend bmi-key">
          <span><i style="background:#60a5fa"></i>Underweight &lt;18.5</span><span><i style="background:#34d399"></i>Healthy 18.5–24.9</span><span><i style="background:#fbbf24"></i>Overweight 25–29.9</span><span><i style="background:#f87171"></i>Obese 30+</span>
        </div>
        <div class="marker-key">
          <span><i class="mk me"></i><b>You</b> · BMI ${b} · ${fmt(kg, 1)} kg</span>
          <span><i class="mk tgt"></i><b>Target</b> · BMI ${targetBmi} · ${fmt(targetKg, 1)} kg</span>
        </div>
        <div class="bmi-msg">${msg}</div>`;
      $('#targetBmi').addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (!v || v < 15 || v > 35) { toast('Target BMI should be between 15 and 35'); renderWeight(col); return; }
        s.profile.targetBmi = Math.round(v * 10) / 10; Store.save(); toast(`Target BMI saved (${s.profile.targetBmi})`, 1400); renderWeight(col);
      });
    } else $('#bmiCard').innerHTML = `<div class="muted small">Add your height in <b>Me</b> and log a weight to see your BMI and healthy weight range.</div>`;
    // ---- Forecast (30 days ahead) ----
    const showF = s.showForecast !== false;
    $('#forecastToggle').checked = showF;
    const fmtD = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
    const hasProfile = !!(s.profile.age && s.profile.heightCm);
    const baseKg = Nutrition.smoothedWeight(s.weights, todayKey);
    let plan = [], actual = [], intake = null, keyHtml = '';
    const targetKgLine = s.profile.heightCm ? Math.round((s.profile.targetBmi || 24.9) * (s.profile.heightCm / 100) ** 2 * 10) / 10 : null;
    if (showF && hasProfile && baseKg) {
      plan = Nutrition.projectWeight(baseKg, s.profile, s.targets.kcal, todayKey, 30);
      intake = Nutrition.averageIntake(s.diary, todayKey, 14);
      if (intake) actual = Nutrition.projectWeight(baseKg, s.profile, intake.kcal, todayKey, 30);
      const endPlan = plan[plan.length - 1], endAct = actual.length ? actual[actual.length - 1] : null;
      const d = (a, b) => { const v = Math.round((b - a) * 10) / 10; return (v > 0 ? '+' : '') + fmt(v, 1); };
      keyHtml = `<span><i class="solid"></i><b>Recorded</b> · your logged weights</span>
        <span><i class="dashed"></i><b>Plan</b> · if you eat your ${fmt(s.targets.kcal)} kcal target daily → <b>${fmt(endPlan.kg, 1)} kg</b> (${d(baseKg, endPlan.kg)} kg) by ${fmtD(endPlan.date)}</span>
        ${endAct ? `<span><i class="dotted"></i><b>Current pace</b> · at your recent average of ${fmt(intake.kcal)} kcal/day (${intake.days} logged days) → <b>${fmt(endAct.kg, 1)} kg</b> (${d(baseKg, endAct.kg)} kg)</span>` : `<span><i class="dotted"></i><b>Current pace</b> · shows once you've logged food on 3 days</span>`}
        ${targetKgLine ? `<span><i class="target"></i><b>Target weight</b> · ${fmt(targetKgLine, 1)} kg (BMI ${s.profile.targetBmi || 24.9})</span>` : ''}`;
    } else if (showF && !hasProfile) keyHtml = '<span>Add your age and height in <b>Me</b> to see a forecast.</span>';
    else if (showF && !baseKg) keyHtml = '<span>Log a weight to see a forecast.</span>';
    $('#forecastKey').innerHTML = keyHtml;

    // Shared date axis: past readings, then forecast dates
    const dates = pts.map((p) => p.date);
    const fDates = plan.map((p) => p.date).filter((dk) => !dates.includes(dk));
    const axis = [...dates, ...fDates];
    const series = (arr) => axis.map((dk) => { const hit = arr.find((p) => p.date === dk); return hit ? hit.kg : null; });
    const todayIdx = axis.indexOf(todayKey);
    const datasets = [{ label: 'Recorded', data: series(pts), borderColor: col('--accent'), backgroundColor: col('--accent-soft'), fill: true, tension: 0.35, pointRadius: pts.length > 30 ? 0 : 3, pointBackgroundColor: col('--accent'), borderWidth: 2, spanGaps: true, order: 1 }];
    if (plan.length) datasets.push({ label: 'Plan', data: series(plan), borderColor: col('--protein'), borderDash: [7, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.2, spanGaps: true, order: 2 });
    if (actual.length) datasets.push({ label: 'Current pace', data: series(actual), borderColor: col('--carbs'), borderDash: [2, 4], borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0.2, spanGaps: true, order: 3 });
    if (targetKgLine && plan.length) datasets.push({ label: 'Target weight', data: axis.map(() => targetKgLine), borderColor: col('--muted'), borderDash: [1, 3], borderWidth: 1, pointRadius: 0, fill: false, order: 4 });
    draw('weightChart', {
      type: 'line',
      data: { labels: axis.map(fmtD), datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { filter: (c) => c.raw !== null, callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw, 1)} kg` } },
          todayLine: { index: todayIdx, color: col('--muted') } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { ticks: { maxTicksLimit: 5, callback: (v) => v + ' kg' }, grace: '10%' } } },
      plugins: [{ id: 'todayLine', afterDraw(chart, args, opts) {
        if (opts.index === undefined || opts.index < 0 || !plan.length) return;
        const x = chart.scales.x.getPixelForValue(opts.index), { top, bottom } = chart.chartArea, ctx = chart.ctx;
        ctx.save(); ctx.strokeStyle = opts.color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.fillStyle = opts.color; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('today', x, top + 10); ctx.restore();
      } }]
    });
  }
  function draw(id, cfg) {
    if (charts[id]) { charts[id].destroy(); }
    charts[id] = new Chart($('#' + id).getContext('2d'), cfg);
  }
  $('#prevWeek').addEventListener('click', () => { weekOffset--; renderProgress(); });
  $('#nextWeek').addEventListener('click', () => { if (weekOffset < 0) { weekOffset++; renderProgress(); } });
  $('#weightRange').addEventListener('change', renderProgress);
  $('#forecastToggle').addEventListener('change', (e) => { Store.state.showForecast = e.target.checked; Store.save(); renderProgress(); });
  function updateWeightButton() {
    const v = parseFloat($('#weightInput').value);
    const ok = Number.isFinite(v) && v >= 20 && v <= 400;
    $('#logWeightBtn').disabled = !ok;
    $('#logWeightBtn').classList.toggle('primary', ok);
    $('#weightUnit').classList.toggle('hidden', $('#weightInput').value === '');
  }
  $('#weightInput').addEventListener('input', updateWeightButton);
  $('#weightInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#logWeightBtn').disabled) $('#logWeightBtn').click(); });
  $('#logWeightBtn').addEventListener('click', () => {
    const kg = Math.round((parseFloat($('#weightInput').value) || 0) * 10) / 10;
    if (!kg || kg < 20 || kg > 400) return toast('Enter a weight between 20 and 400 kg');
    const todayKey = Nutrition.dateKey(new Date());
    const prev = Store.state.weights.find((w) => w.date === todayKey);
    Store.logWeight(todayKey, kg);
    if (Store.state.targets.auto) recalcTargets();
    toast(prev ? `Today's reading updated: ${fmt(prev.kg, 1)} → ${fmt(kg, 1)} kg` : `Logged ${fmt(kg, 1)} kg for today`, 2600);
    renderProgress();
  });

  /* ===================== ME ===================== */
  let savedTimer;
  function showSaved(msg) {
    const b = $('#savedBadge'); b.classList.add('show');
    clearTimeout(savedTimer); savedTimer = setTimeout(() => b.classList.remove('show'), 1800);
    if (msg) toast(msg, 1400);
  }
  function renderMe() {
    const s = Store.state, p = s.profile, T = s.targets;
    const fill = (sel, obj) => { $(sel).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''); };
    fill('#pActivity', Nutrition.ACTIVITY); fill('#pGoal', Nutrition.GOALS);
    $('#pSex').value = p.sex; $('#pAge').value = p.age ?? ''; $('#pHeight').value = p.heightCm ?? ''; $('#pActivity').value = p.activity; $('#pGoal').value = p.goal;
    const locked = !!p.startWeightKg;
    $('#pWeight').value = p.startWeightKg ?? ''; $('#pWeight').disabled = locked; $('#pWeight').placeholder = 'kg';
    const latest = Store.latestWeight();
    const fmtDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
    $('#weightInfo').innerHTML = locked
      ? `<div><span class="muted">Started</span> <b>${fmt(p.startWeightKg, 1)} kg</b> <span class="muted">on ${fmtDate(p.startDate)}</span> · <button class="link-btn inline" id="correctStart">Correct</button></div>
         <div><span class="muted">Current</span> <b>${fmt(latest.kg, 1)} kg</b> <span class="muted">logged ${fmtDate(latest.date)}</span> · <button class="link-btn inline" data-goto="progress">Log weight in Progress</button></div>
         <div class="muted small">Calorie targets follow your current weight.</div>`
      : `<div class="muted small">Enter your weight once here – it's locked in as your first reading. After that, log new weights in <b>Progress</b>.</div>`;
    if (locked) $('#correctStart').addEventListener('click', () => {
      if (!confirm(`Correct your starting weight? This changes your first reading (${fmt(p.startWeightKg, 1)} kg on ${fmtDate(p.startDate)}).`)) return;
      $('#pWeight').disabled = false; $('#pWeight').focus(); $('#pWeight').select();
    });
    $('#tAuto').checked = T.auto;
    $('#pActivity').closest('label').classList.toggle('hidden', !T.auto);
    $('#pGoal').closest('label').classList.toggle('hidden', !T.auto);
    $('#profileNote').textContent = T.auto ? '' : 'Activity and goal are hidden because calories are set manually (Daily targets → Calories from profile).';
    $('#tKcal').value = T.kcal; $('#tProtein').value = T.protein; $('#tCarbs').value = T.carbs; $('#tFat').value = T.fat;
    $('#tKcal').disabled = T.auto;
    const calc = Nutrition.calcTargets(p, T);
    $('#autoNote').textContent = calc ? `BMR ${fmt(calc.bmr)} · maintenance ${fmt(calc.tdee)} · goal → ${fmt(calc.kcal)} kcal` : 'Fill in your profile to calculate calories automatically.';
    // Presets
    $('#presets').innerHTML = Object.entries(Nutrition.PRESETS).map(([k, v]) => `<button class="preset ${T.preset === k ? 'active' : ''}" data-preset="${k}"><b>${v.label}</b><small>${v.desc}</small></button>`).join('');
    $('#ketoRow').classList.toggle('hidden', T.preset !== 'keto');
    $('#ketoSlider').value = T.ketoCarbs || 25; $('#ketoVal').textContent = T.ketoCarbs || 25;
    const sp = Nutrition.splitOf(T);
    const pct = (x) => Math.round(x * 100);
    $('#splitBar').innerHTML = `<i style="width:${pct(sp.protein)}%"></i><i style="width:${pct(sp.carbs)}%"></i><i style="width:${pct(sp.fat)}%"></i>`;
    $('#splitLegend').innerHTML = `<span><i style="background:var(--protein)"></i>Protein ${pct(sp.protein)}%</span><span><i style="background:var(--carbs)"></i>Carbs ${pct(sp.carbs)}%</span><span><i style="background:var(--fat)"></i>Fat ${pct(sp.fat)}%</span>`;
    const mk = Nutrition.kcalOfMacros(T);
    $('#targetsNote').textContent = T.preset === 'custom'
      ? `Custom split. Change calories and the macros scale to keep this split; edit one macro and the other two adjust to fit. Macros add up to ${fmt(mk)} kcal.`
      : `${Nutrition.PRESETS[T.preset].label} split applied to ${fmt(T.kcal)} kcal. Edit any macro to make it custom.`;
    $('#cofidStatus').innerHTML = Sources.cofidCount() ? `✅ <b>${fmt(Sources.cofidCount())} UK foods</b> built in (McCance &amp; Widdowson CoFID 2021)${s.cofidLoadedAt ? ' – replaced by your import on ' + new Date(s.cofidLoadedAt).toLocaleDateString('en-GB') : ''}. Searchable offline alongside barcoded products.` : '<span class="spinner"></span> Loading the UK food database…';
  }
  function readProfile() {
    const p = Store.state.profile;
    p.sex = $('#pSex').value; p.age = parseInt($('#pAge').value, 10) || null; p.heightCm = parseFloat($('#pHeight').value) || null; p.activity = $('#pActivity').value; p.goal = $('#pGoal').value;
    Store.state.onboarded = true;
    const sw = parseFloat($('#pWeight').value);
    if (sw && sw >= 20 && sw <= 400 && (!p.startWeightKg || sw !== p.startWeightKg)) Store.setStartWeight(Math.round(sw * 10) / 10, Nutrition.dateKey(new Date()));
    if (Store.state.targets.auto) recalcTargets();
    Store.save(); renderMe(); showSaved('Profile saved');
  }
  // Recompute calories from the profile (when Auto is on) and macros from the current preset/split.
  function recalcTargets() {
    const T = Store.state.targets;
    const c = Nutrition.calcTargets(Store.state.profile, T);
    if (c) Object.assign(T, { kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat });
    Store.save();
  }
  // Apply the preset (or keep a custom split) to the current calorie target.
  function applyMacros() {
    const T = Store.state.targets;
    const m = Nutrition.macrosFor(T.kcal, T.preset, { ketoCarbs: T.ketoCarbs, split: T.preset === 'custom' ? Nutrition.splitOf(T) : null });
    Object.assign(T, m); Store.save();
  }
  ['#pSex', '#pAge', '#pHeight', '#pWeight', '#pActivity', '#pGoal'].forEach((id) => $(id).addEventListener('change', readProfile));
  $('#tAuto').addEventListener('change', (e) => {
    Store.state.targets.auto = e.target.checked;
    if (e.target.checked) recalcTargets(); else Store.save();
    renderMe(); showSaved(e.target.checked ? 'Calories now follow your profile' : 'Calories set manually');
  });
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    Store.state.targets.preset = b.dataset.preset; applyMacros(); renderMe(); showSaved(`${Nutrition.PRESETS[b.dataset.preset].label} targets applied`);
  });
  $('#ketoSlider').addEventListener('input', (e) => { $('#ketoVal').textContent = e.target.value; });
  $('#ketoSlider').addEventListener('change', (e) => { Store.state.targets.ketoCarbs = parseInt(e.target.value, 10); applyMacros(); renderMe(); showSaved('Carb limit saved'); });
  $('#tKcal').addEventListener('change', () => {
    const T = Store.state.targets; const v = parseInt($('#tKcal').value, 10);
    if (!v || v < 800) { renderMe(); return toast('Enter at least 800 kcal'); }
    T.kcal = v; applyMacros(); renderMe(); showSaved('Calories saved – macros rescaled');
  });
  [['#tProtein', 'protein'], ['#tCarbs', 'carbs'], ['#tFat', 'fat']].forEach(([id, key]) => $(id).addEventListener('change', () => {
    const T = Store.state.targets; const v = parseInt($(id).value, 10);
    if (!Number.isFinite(v) || v < 0) { renderMe(); return; }
    const next = Nutrition.rebalance(Object.assign({}, T, { [key]: v }), key, T.kcal);
    Object.assign(T, next, { preset: 'custom' }); Store.save(); renderMe(); showSaved('Macros saved – others adjusted to fit calories');
  }));
  $('#cofidFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    $('#cofidStatus').innerHTML = '<span class="spinner"></span> Importing… this takes a few seconds.';
    try { const n = await Sources.importCofidWorkbook(await file.arrayBuffer()); toast(`Imported ${fmt(n)} UK foods`); }
    catch (err) { console.error(err); toast('Import failed: ' + err.message, 4000); }
    e.target.value = ''; renderMe();
  });
  $('#backupBtn').addEventListener('click', async () => {
    const json = Store.exportJSON();
    const name = `FoodDiary-backup-${Nutrition.dateKey(new Date())}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'FoodDiary backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    toast('Backup downloaded');
  });
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('Restore this backup? It will replace the diary, foods and settings on this device.')) { e.target.value = ''; return; }
    try { Store.importJSON(await file.text()); toast('Backup restored'); renderMe(); renderToday(); }
    catch (err) { toast('Restore failed: ' + err.message, 4000); }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', () => { if (confirm('Erase all diary entries, foods and settings on this device?')) { Store.reset(); renderMe(); toast('Erased'); } });

  /* ===================== Sheet backdrop / init ===================== */
  $('.sheet-backdrop').addEventListener('click', () => closeSheet());

  /* ===================== Auto-update ===================== */
  let swReg = null, hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller), lastCheck = 0;
  async function setupUpdates() {
    if (!('serviceWorker' in navigator)) return;
    try {
      swReg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); // always check the repo, never the browser's 10-minute cache
      // A new version has been downloaded and taken over: reload once so the user is on it.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; } // first install – nothing to swap
        toast('Updating to the latest version…', 1500);
        setTimeout(() => location.reload(), 600);
      });
      swReg.addEventListener('updatefound', () => {
        const w = swReg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('New version found – applying…', 1500); });
      });
      checkForUpdates(false);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdates(false); });
    } catch (e) { console.warn('Service worker failed', e); }
  }
  // Ask the browser to re-fetch sw.js from the repo; if its VERSION changed, the new app files are downloaded.
  async function checkForUpdates(manual) {
    if (!swReg) { if (manual) toast('Updates need the app to be served over https'); return; }
    if (!manual && Date.now() - lastCheck < 5 * 60 * 1000) return; // at most every 5 minutes automatically
    lastCheck = Date.now();
    if (!navigator.onLine) { if (manual) toast('You\u2019re offline – will check when back online'); return; }
    try {
      await swReg.update();
      if (manual) {
        if (swReg.installing || swReg.waiting) toast('Update found – applying…');
        else toast(`You\u2019re on the latest version (v${APP_VERSION})`);
      }
    } catch (e) { if (manual) toast('Couldn\u2019t reach the update server'); }
  }
  $('#checkUpdates').addEventListener('click', () => checkForUpdates(true));
  $('#appVersion').textContent = 'v' + APP_VERSION;

  async function init() {
    renderToday();
    Sources.loadCofid().then((n) => { if (n && $('#view-add').classList.contains('active')) renderAdd(); });
    setupUpdates();
    // Recalculate "Today" when the app returns to foreground (date may have changed)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { const t = Nutrition.dateKey(new Date()); if (currentDate !== t && dateLabel(currentDate) === 'Yesterday') currentDate = t; if ($('#view-today').classList.contains('active')) renderToday(); } });
  }
  init();

  return { toast, goto, openFoodSheet };
})();
