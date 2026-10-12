/* FoodDiary — UI & app logic */
const UI = (() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Number and date formatters are built once and reused (1.21.0): creating one per number was ~10× slower.
  const NF = [0, 1, 2, 3].map((dp) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: dp, minimumFractionDigits: 0 }));
  const fmt = (n, dp = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '–' : (NF[dp] || new Intl.NumberFormat('en-GB', { maximumFractionDigits: dp })).format(Number(n));
  const DF = {};
  const fmtDateOpts = (date, opts) => { const k = JSON.stringify(opts); return (DF[k] || (DF[k] = new Intl.DateTimeFormat('en-GB', opts))).format(date); };

  const APP_VERSION = '1.23.0';

  const CDN = {
    chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
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
    if (!silent && history.state && history.state.sheet) { selfBacks++; history.back(); }
  }
  // Panels are tied to browser history so the phone's back gesture closes them. When the app itself calls
  // history.back() (closing a panel), the browser fires popstate a moment later. If the app has opened a new
  // panel in the meantime (e.g. Save recipe → show the saved recipe), that late popstate must NOT close it (1.19.0).
  let selfBacks = 0;
  window.addEventListener('popstate', () => {
    const open = !$('#sheet').classList.contains('hidden');
    if (selfBacks > 0) {
      selfBacks--;
      if (open) history.pushState({ sheet: true }, ''); // keep the new panel closable with the back gesture
      return;
    }
    if (open) closeSheet(true); // a genuine back gesture / back button
  });

  /* ===================== Navigation ===================== */
  function goto(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
    $$('.tabbar .tab').forEach((t) => t.classList.toggle('active', t.dataset.goto === view));
    window.scrollTo({ top: 0 });
    if (view === 'today') renderToday();
    if (view === 'add') { renderAdd(); if (typeof Scanner !== 'undefined' && navigator.onLine) setTimeout(Scanner.warmUp, 400); } // keyboard only when the user taps the search box
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
    return fmtDateOpts(new Date(y, m - 1, d), { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fullDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return fmtDateOpts(new Date(y, m - 1, d), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // One sentence about distance to the target BMI. Shared by the Progress BMI card and the Today journey card.
  function bmiTargetMessage(kg, profile) {
    const h = profile.heightCm; if (!kg || !h) return '';
    const targetBmi = profile.targetBmi || 24.9;
    const targetKg = Math.round(targetBmi * (h / 100) ** 2 * 10) / 10;
    const diff = Math.round((kg - targetKg) * 10) / 10;
    if (diff > 0.05) return `Lose <b>${fmt(diff, 1)} kg</b> to reach target BMI of ${targetBmi} (${fmt(targetKg, 1)} kg).`;
    if (diff < -0.05) return `You're <b>${fmt(-diff, 1)} kg</b> under your target BMI of ${targetBmi} (${fmt(targetKg, 1)} kg).`;
    return `You're right on your target BMI of ${targetBmi} (${fmt(targetKg, 1)} kg).`;
  }

  function renderJourney() {
    const s = Store.state, p = s.profile, el = $('#journeyCard');
    const latest = Store.latestWeight();
    const startKg = p.startWeightKg, h = p.heightCm;
    if (!startKg || !h || !latest) {
      el.classList.remove('done');
      el.innerHTML = `<div class="j-prompt"><span>📍</span><span>Set your height and starting weight to track your journey.</span><button class="btn small" data-goto="me">Set up</button></div>`;
      return;
    }
    const targetKg = Math.round((p.targetBmi || 24.9) * (h / 100) ** 2 * 10) / 10;
    const now = latest.kg;
    const total = startKg - targetKg;                 // positive = losing journey, negative = gaining
    const done = startKg - now;                       // same sign convention
    const losing = total > 0;
    const reached = losing ? now <= targetKg : total < 0 ? now >= targetKg : true;
    const frac = total === 0 ? 1 : Math.max(0, Math.min(1, done / total));
    const pct = Math.round(frac * 100);
    const moved = Math.round(Math.abs(now - startKg) * 10) / 10;
    const wrongWay = losing ? now > startKg : now < startKg;
    const fmtD = (k) => { const [y, m, d] = k.split('-').map(Number); return fmtDateOpts(new Date(y, m - 1, d), { day: 'numeric', month: 'short' }); };

    // Pace line from real intake
    const todayKey = Nutrition.dateKey(new Date());
    const intake = Nutrition.averageIntake(s.diary, todayKey, 14);
    let paceHtml = '';
    if (!reached) {
      if (intake) {
        const diff = Math.round(intake.kcal - s.targets.kcal);
        const vs = Math.abs(diff) < 50 ? 'right on your target intake' : `averaging <b class="${diff > 0 ? 'up' : 'down'}">${fmt(Math.abs(diff))} kcal ${diff > 0 ? 'above' : 'below'}</b> target`;
        const base = Nutrition.smoothedWeight(s.weights, todayKey);
        const days = Nutrition.daysToTarget(base, p, intake.kcal, targetKg, 730);
        const when = days === null ? 'not reaching target at this pace' : days === 0 ? 'there now' : `on track for <b>${fmtD(Nutrition.addDays(todayKey, days))}</b>`;
        paceHtml = `<small>At your real intake: ${when} — ${vs}.</small>`;
      } else paceHtml = `<small>Log food on 3 days to see when you'll reach target.</small>`;
    }

    el.classList.toggle('done', reached);
    const curBmi = Nutrition.bmi(now, h);
    const pctText = reached ? '100%' : `${pct}%`;
    let note = '';
    if (reached) note = `<small class="ok">🎉 Target reached — ${fmt(moved, 1)} kg ${losing ? 'down' : 'up'} since ${fmtD(p.startDate)}.</small>`;
    else if (wrongWay) note = `<small class="up">${fmt(moved, 1)} kg ${losing ? 'above' : 'below'} starting weight.</small>`;
    el.innerHTML = `
      <div class="j-row">
        <b class="j-end">${fmt(startKg, 1)} kg</b>
        <div class="j-bar"><div class="j-fill" style="width:${reached ? 100 : pct}%"></div><div class="j-dot" style="left:${reached ? 100 : pct}%"></div></div>
        <b class="j-end">${fmt(targetKg, 1)} kg</b>
        <span class="j-pct ${reached ? 'done' : wrongWay ? 'over' : ''}">(${pctText})</span>
      </div>
      ${reached ? '' : `<div class="j-bmi">${bmiTargetMessage(now, p)}</div>`}
      ${note || paceHtml ? `<p class="j-line">${note}${reached ? '' : paceHtml}</p>` : ''}`;
  }

  function renderToday() {
    renderJourney();
    renderTodayNotes();
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

  /* ---- Today notes (1.23.0): Monday check-in card + backup reminder. Only when viewing today. ---- */
  let notesHTML = null;
  function renderTodayNotes() {
    const box = $('#todayNotes'); if (!box) return;
    const today = Nutrition.dateKey(new Date());
    const html = currentDate === today ? checkinHTML(today) + backupNudgeHTML(today) : '';
    if (html !== notesHTML) { box.innerHTML = html; notesHTML = html; } // skip the redraw if nothing changed
  }
  function checkinHTML(today) {
    const s = Store.state, wk = weekKeys(0)[0];
    if (s.checkinDone === wk) return ''; // dismissed for this week
    const last = weekKeys(-1);
    const logged = last.filter((k) => Store.entries(k).length);
    const inWeek = s.weights.filter((w) => w.date >= last[0] && w.date <= last[6]);
    if (!logged.length && !inWeek.length) return '';
    const T = s.targets;
    const kcals = logged.map((k) => Nutrition.sum(Store.entries(k)).kcal);
    const avg = kcals.length ? Math.round(kcals.reduce((a, v) => a + v, 0) / kcals.length / 10) * 10 : null;
    const onT = kcals.filter((k) => k <= T.kcal).length;
    const d = (k) => { const [y, m, dd] = k.split('-').map(Number); return fmtDateOpts(new Date(y, m - 1, dd), { day: 'numeric', month: 'short' }); };
    let weight = '<span class="muted">No weigh-ins last week.</span>';
    if (inWeek.length) {
      const end = inWeek[inWeek.length - 1];
      const before = s.weights.filter((w) => w.date < last[0]);
      const start = before.length ? before[before.length - 1] : inWeek[0];
      const ch = Math.round((end.kg - start.kg) * 10) / 10;
      weight = start === end ? `Weight: <b>${fmt(end.kg, 1)} kg</b>` : `Weight: ${fmt(start.kg, 1)} → <b>${fmt(end.kg, 1)} kg</b> (${ch > 0 ? '+' : ch < 0 ? '−' : '±'}${fmt(Math.abs(ch), 1)} kg)`;
    }
    const r = Nutrition.realBurn(s.diary, s.weights, today);
    const burn = r.ready && r.reliable ? `<p>Real burn: <b>${fmt(Math.round(r.burn / 10) * 10)} kcal</b> a day</p>` : '';
    const sug = Nutrition.burnSuggestion(r, s.profile.goal, T.kcal);
    const tip = sug && !burnSnoozed(sug, today) ? `<p class="checkin-tip">💡 A lower target (${fmt(sug.kcal)} kcal) is suggested from your real burn – <button class="link-btn inline" data-act="toProgress">see Progress</button></p>` : '';
    return `<section class="card checkin">
      <div class="card-head"><h3>Last week · ${d(last[0])} – ${d(last[6])}</h3><button class="icon-btn" data-act="checkinDone" aria-label="Dismiss last week's summary">✕</button></div>
      <div class="kpis">
        <div class="kpi"><b>${avg === null ? '–' : fmt(avg)}</b><small>avg kcal / day</small></div>
        <div class="kpi"><b>${logged.length} / 7</b><small>days logged</small></div>
        <div class="kpi ${logged.length && onT === logged.length ? 'good' : ''}"><b>${logged.length ? onT + ' / ' + logged.length : '–'}</b><small>on target</small></div>
      </div>
      <p>${weight}</p>${burn}${tip}
      <button class="btn ghost block small" data-act="checkinDone">Done</button>
    </section>`;
  }
  function backupNudgeHTML(today) {
    const s = Store.state;
    if (s.backupSnoozeUntil && today < s.backupSnoozeUntil) return '';
    const age = s.lastBackupAt ? Nutrition.daysBetween(Nutrition.dateKey(new Date(s.lastBackupAt)), today) : null;
    if (age === null ? Object.keys(s.diary).length < 3 : age < 7) return '';
    return `<div class="banner backup-nudge">
      <div><strong>💾 ${age === null ? 'No backup recorded on this phone yet' : `Last backup ${age} days ago`}</strong><br><small>Your diary is only on this phone – save a copy to OneDrive or Files.</small></div>
      <button class="btn small" data-act="backupNow">Back up</button>
      <button class="icon-btn" data-act="backupLater" aria-label="Remind me in 3 days">✕</button>
    </div>`;
  }
  $('#todayNotes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const s = Store.state, today = Nutrition.dateKey(new Date());
    if (b.dataset.act === 'checkinDone') { s.checkinDone = weekKeys(0)[0]; Store.save(); renderTodayNotes(); }
    else if (b.dataset.act === 'toProgress') goto('progress');
    else if (b.dataset.act === 'backupLater') { s.backupSnoozeUntil = Nutrition.addDays(today, 3); Store.save(); renderTodayNotes(); toast('OK – I’ll remind you in 3 days'); }
    else if (b.dataset.act === 'backupNow') await doBackup();
  });

  function thumbHTML(food, cls = '') {
    const src = Store.photoSrc(food.image); // stored photo (photo:<id>) or a web address
    if (src) return `<div class="thumb ${cls}"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${emojiFor(food)}'"></div>`;
    return `<div class="thumb ${cls}">${emojiFor(food)}</div>`;
  }
  function emojiFor(f) {
    if (f.source === 'quick') return '⚡';
    const n = (f.name || '').toLowerCase();
    const map = [[/apple|pear|banana|berry|orange|grape|fruit|melon|mango|peach|plum/, '🍎'], [/bread|toast|bagel|roll|loaf|pitta|wrap/, '🍞'], [/chicken|turkey|poultry/, '🍗'], [/beef|steak|mince|lamb|pork|bacon|ham|sausage|meat/, '🥩'], [/fish|salmon|tuna|cod|prawn|haddock|mackerel/, '🐟'], [/egg/, '🥚'], [/milk|yogurt|yoghurt|cream|cheese|butter/, '🥛'], [/rice|pasta|noodle|spaghetti/, '🍝'], [/potato|chip|fries|crisps/, '🥔'], [/salad|lettuce|spinach|kale|broccoli|carrot|veg|pepper|tomato|cucumber|onion/, '🥦'], [/chocolate|sweet|candy|biscuit|cookie|cake|dessert|ice cream/, '🍫'], [/coffee|tea/, '☕'], [/beer|wine|cider|lager|vodka|gin|whisky/, '🍺'], [/juice|drink|cola|water|squash|smoothie/, '🥤'], [/nut|almond|peanut|cashew|seed/, '🥜'], [/oat|cereal|granola|muesli|porridge/, '🥣'], [/soup|curry|stew|pie|pizza|burger|sandwich/, '🍲']];
    for (const [re, e] of map) if (re.test(n)) return e;
    return f.isRecipe || f.source === 'recipe' ? '🍲' : '🍽️';
  }
  function amountLabel(e) {
    if (e.quick) return 'Quick add';
    const u = e.liquid ? 'ml' : 'g';
    if (e.unit && e.qty) return `${fmt(e.qty, 2)} ${e.qty === 1 ? e.unit : (e.unitPlural || e.unit + 's')} · ${fmt(e.grams)} ${u}`;
    if (e.qty && e.qty !== 1 && e.sizeG) return `${fmt(e.qty, 2)} × ${fmt(e.sizeG)} ${u} · ${fmt(e.grams)} ${u}`;
    return `${fmt(e.grams)} ${u}`;
  }
  function entryRow(e) {
    const f = e.food;
    return `<button class="item" data-entry="${e.id}">
      ${thumbHTML(f)}
      <div class="item-main">
        <div class="item-title">${esc(f.name)}</div>
        <div class="item-sub">${f.brand ? esc(f.brand) + ' · ' : ''}${amountLabel(e)}${e.quick && !(e.protein || e.carbs || e.fat) ? '' : ` · P ${fmt(e.protein)} · C ${fmt(e.carbs)} · F ${fmt(e.fat)}`}</div>
      </div>
      <div class="item-kcal"><b>${fmt(e.kcal)}</b><small>kcal</small></div>
    </button>`;
  }

  $('#prevDay').addEventListener('click', () => { currentDate = Nutrition.addDays(currentDate, -1); renderToday(); });
  $('#nextDay').addEventListener('click', () => { currentDate = Nutrition.addDays(currentDate, 1); renderToday(); });
  $('#datePicker').addEventListener('change', (e) => { if (e.target.value) { currentDate = e.target.value; renderToday(); } });
  $('#copyYesterday').addEventListener('click', () => {
    const src = Nutrition.addDays(currentDate, -1);
    const y = Store.entries(src);
    logWithDayGuard((dk) => {
      y.forEach((e) => Store.addEntry(dk, { quick: e.quick || undefined, food: e.food, grams: e.grams, qty: e.qty, sizeG: e.sizeG, unit: e.unit, unitPlural: e.unitPlural, liquid: e.liquid, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat }));
      toast(`Copied ${y.length} item${y.length === 1 ? '' : 's'} to ${dateLabel(dk).toLowerCase()}`); currentDate = dk; renderToday();
    });
  });
  $('#dismissInstall').addEventListener('click', () => { localStorage.setItem('fooddiary.installDismissed', '1'); renderToday(); });
  $('#entryList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-entry]');
    if (!b) return;
    const entry = Store.entries(currentDate).find((x) => x.id === b.dataset.entry);
    if (entry) { if (entry.quick) openQuickAdd(entry); else openFoodSheet(entry.food, { entry }); }
  });
  // Swipe between days
  let tx = null;
  $('#view-today').addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $('#view-today').addEventListener('touchend', (e) => {
    if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 90) { currentDate = Nutrition.addDays(currentDate, dx < 0 ? 1 : -1); renderToday(); }
  }, { passive: true });

  /* ===================== FOOD SHEET ===================== */
  // Work out the "size" options for a food: a unit portion (egg, slice, can…) if known, else grams.
  function portionFor(food) {
    if (food.unitG && food.unitName) return { unit: food.unitName, plural: food.unitPlural || food.unitName + 's', g: food.unitG };
    if (food.source === 'cofid' && typeof Portions !== 'undefined') { const p = Portions.forName(food.cofidName || food.name); if (p) return p; }
    if (food.source === 'recipe' && food.totalG && food.servings) return { unit: 'portion', plural: 'portions', g: Math.round(food.totalG / food.servings) };
    if (food.servingG) {
      const lbl = (food.servingLabel || '').toLowerCase();
      const unit = /can|tin/.test(lbl) ? 'can' : /bottle/.test(lbl) ? 'bottle' : /bar/.test(lbl) ? 'bar' : /slice/.test(lbl) ? 'slice' : /pot/.test(lbl) ? 'pot' : /bag|pack/.test(lbl) ? 'pack' : /piece|biscuit|cookie/.test(lbl) ? 'piece' : 'serving';
      return { unit, plural: unit === 'serving' ? 'servings' : unit + 's', g: food.servingG };
    }
    return null;
  }

  function openFoodSheet(food, { entry = null, onAdd = null, onBack = null, fromQuery = '' } = {}) {
    const isEdit = !!entry;
    const portion = portionFor(food);
    const isLiquid = /ml|litre|^l$/i.test(food.quantity || '') || /drink|juice|milk|beer|lager|cider|wine|cola|lemonade|smoothie|squash|coffee|tea,/i.test(food.name || '');
    const gUnit = isLiquid ? 'ml' : 'g';
    // Initial state: existing entry → its qty/size; else 1 × portion (or 100 g)
    let qty = isEdit && entry.qty ? entry.qty : 1;
    let sizeG = isEdit ? (entry.sizeG || entry.grams) : (portion ? portion.g : 100);
    let mode = isEdit ? (entry.unit ? 'unit' : 'grams') : (portion ? 'unit' : 'grams');
    const packG = parsePackSize(food.quantity);
    const gramChips = [50, 100, 200].map((g) => ({ label: `${g} ${gUnit}`, g }));
    if (packG && !gramChips.some((q) => q.g === packG)) gramChips.push({ label: `Whole pack (${fmt(packG)} ${gUnit})`, g: packG });
    const src = { off: 'Open Food Facts', cofid: 'UK CoFID', custom: 'My food', recipe: 'Recipe' }[food.source] || '';

    openSheet(`
      <div class="food-hero">
        ${thumbHTML(food)}
        <div class="meta">
          <h2>${esc(food.name)}</h2>
          <p>${food.brand ? esc(food.brand) : ''}${food.quantity ? ' · ' + esc(food.quantity) : ''}</p>
          <p><span class="badge ${esc(food.source)}">${src}</span>${food.barcode ? '<span class="muted small">' + esc(food.barcode) + '</span>' : ''}</p>
        </div>
      </div>

      ${portion ? `<div class="chips mode-chips"><button class="chip ${mode === 'unit' ? 'active' : ''}" data-mode="unit">By ${esc(portion.plural)}</button><button class="chip ${mode === 'grams' ? 'active' : ''}" data-mode="grams">By ${gUnit === 'ml' ? 'ml' : 'grams'}</button></div>` : ''}

      <div class="amount2">
        <div class="amt-field">
          <label>Qty</label>
          <div class="stepper"><button class="btn icon-only" id="qMinus">−</button><input type="number" id="qtyInput" inputmode="decimal" min="0" step="1" value="${qty}"><button class="btn icon-only" id="qPlus">＋</button></div>
        </div>
        <div class="amt-x">×</div>
        <div class="amt-field grow">
          <label id="sizeLabel"></label>
          <div class="stepper"><button class="btn icon-only" id="gMinus">−</button><input type="number" id="gramsInput" inputmode="decimal" min="0" step="1" value="${sizeG}"><span class="unit" id="sizeUnit">${gUnit}</span><button class="btn icon-only" id="gPlus">＋</button></div>
        </div>
      </div>
      <div class="quick" id="quickChips"></div>
      <div class="total-line" id="totalLine"></div>
      <div class="totals" id="totals"></div>
      <table class="ntable">
        <tr><td>Per 100 ${gUnit}</td><td></td></tr>
        <tr><td>Energy</td><td>${fmt(food.kcal)} kcal</td></tr>
        <tr><td>Fat</td><td>${fmt(food.fat, 1)} g</td></tr>
        ${food.satFat != null ? `<tr class="sub"><td>of which saturates</td><td>${fmt(food.satFat, 1)} g</td></tr>` : ''}
        <tr><td>Carbohydrate</td><td>${fmt(food.carbs, 1)} g</td></tr>
        ${food.sugars != null ? `<tr class="sub"><td>of which sugars</td><td>${fmt(food.sugars, 1)} g</td></tr>` : ''}
        ${food.fibre != null ? `<tr><td>Fibre</td><td>${fmt(food.fibre, 1)} g</td></tr>` : ''}
        <tr><td>Protein</td><td>${fmt(food.protein, 1)} g</td></tr>
        ${food.salt != null ? `<tr><td>Salt</td><td>${fmt(food.salt, 2)} g</td></tr>` : ''}
      </table>
      <div class="sheet-actions">
        ${onBack ? '<button class="btn" id="backBtn">← Back to results</button>' : ''}
        ${isEdit ? '<button class="btn danger" id="deleteEntry">Delete</button>' : ''}
        ${food.source === 'custom' || food.source === 'recipe' ? '<button class="btn icon-only" id="shareBtn" aria-label="Share" title="Share">⇪</button>' : ''}
        ${food.source === 'custom' ? '<button class="btn" id="editCustom">Edit</button>' : ''}
        ${food.source === 'recipe' && Store.state.recipes.some((x) => x.id === food.id) ? '<button class="btn" id="viewRecipe">View recipe</button>' : ''}
        <button class="btn primary" id="addBtn">${isEdit ? 'Save' : onAdd ? 'Add ingredient' : 'Add to diary'}</button>
      </div>`);

    const qIn = $('#qtyInput'), gIn = $('#gramsInput');
    const unitLabel = (n) => (n === 1 ? portion.unit : portion.plural);
    const drawChips = () => {
      if (mode === 'unit') {
        $('#sizeLabel').textContent = `Size of 1 ${portion.unit}`; $('#sizeUnit').textContent = gUnit;
        $('#quickChips').innerHTML = [1, 2, 3, 4].map((n) => `<button class="chip ${qty === n ? 'active' : ''}" data-q="${n}">${n} ${esc(unitLabel(n))}</button>`).join('');
      } else {
        $('#sizeLabel').textContent = 'Amount'; $('#sizeUnit').textContent = gUnit;
        $('#quickChips').innerHTML = gramChips.map((c) => `<button class="chip ${sizeG === c.g ? 'active' : ''}" data-g="${c.g}">${esc(c.label)}</button>`).join('');
      }
    };
    const update = () => {
      qty = Math.max(0, parseFloat(qIn.value) || 0); sizeG = Math.max(0, parseFloat(gIn.value) || 0);
      const total = qty * sizeG;
      const t = Nutrition.scale(food, total);
      const desc = mode === 'unit' ? `${fmt(qty, 2)} ${unitLabel(qty)} × ${fmt(sizeG)} ${gUnit} = <b>${fmt(total)} ${gUnit}</b>` : qty !== 1 ? `${fmt(qty, 2)} × ${fmt(sizeG)} ${gUnit} = <b>${fmt(total)} ${gUnit}</b>` : `<b>${fmt(total)} ${gUnit}</b>`;
      $('#totalLine').innerHTML = desc;
      $('#totals').innerHTML = `<div><b>${fmt(t.kcal)}</b><small>kcal</small></div><div><b>${fmt(t.protein, 1)}</b><small>protein g</small></div><div><b>${fmt(t.carbs, 1)}</b><small>carbs g</small></div><div><b>${fmt(t.fat, 1)}</b><small>fat g</small></div>`;
      drawChips();
    };
    update();
    qIn.addEventListener('input', update); gIn.addEventListener('input', update);
    $('#qMinus').addEventListener('click', () => { qIn.value = Math.max(0, (parseFloat(qIn.value) || 0) - 1); update(); });
    $('#qPlus').addEventListener('click', () => { qIn.value = (parseFloat(qIn.value) || 0) + 1; update(); });
    $('#gMinus').addEventListener('click', () => { gIn.value = Math.max(0, (parseFloat(gIn.value) || 0) - 10); update(); });
    $('#gPlus').addEventListener('click', () => { gIn.value = (parseFloat(gIn.value) || 0) + 10; update(); });
    $('#quickChips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (c.dataset.q) qIn.value = c.dataset.q; else if (c.dataset.g) { gIn.value = c.dataset.g; qIn.value = 1; }
      update();
    });
    $$('.mode-chips .chip').forEach((c) => c.addEventListener('click', () => {
      mode = c.dataset.mode; $$('.mode-chips .chip').forEach((x) => x.classList.toggle('active', x === c));
      gIn.value = mode === 'unit' ? portion.g : 100; qIn.value = 1; update();
    }));
    if (onBack) $('#backBtn').addEventListener('click', () => onBack());
    if (isEdit) $('#deleteEntry').addEventListener('click', () => { Store.removeEntry(currentDate, entry.id); closeSheet(); renderToday(); toast('Removed'); });
    if ($('#shareBtn')) $('#shareBtn').addEventListener('click', () => { if (food.source === 'recipe') { const r = Store.state.recipes.find((x) => x.id === food.id); if (r) shareItem('recipe', r); } else shareItem('food', food); });
    if ($('#editCustom')) $('#editCustom').addEventListener('click', () => openCustomFoodSheet(food));
    if ($('#viewRecipe')) $('#viewRecipe').addEventListener('click', () => { const r = Store.state.recipes.find((x) => x.id === food.id); if (r) openRecipeView(r, () => openFoodSheet(food, { entry, onAdd, onBack, fromQuery })); });

    const buildEntry = () => {
      const total = qty * sizeG;
      const t = Nutrition.scale(food, total);
      return { food: Store.slimFood(food), grams: total, qty, sizeG, unit: mode === 'unit' ? portion.unit : null, unitPlural: mode === 'unit' ? portion.plural : null, liquid: isLiquid, ...t };
    };
    $('#addBtn').addEventListener('click', () => {
      if (qty * sizeG <= 0) return toast('Enter an amount');
      const e = buildEntry();
      if (onAdd) { closeSheet(true); onAdd(e.food, e.grams); return; }
      if (isEdit) { Store.updateEntry(currentDate, entry.id, { grams: e.grams, qty: e.qty, sizeG: e.sizeG, unit: e.unit, unitPlural: e.unitPlural, liquid: e.liquid, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat }); closeSheet(); renderToday(); toast('Updated'); return; }
      logWithDayGuard((dk) => { Store.addEntry(dk, e); if (fromQuery) Store.rememberPick(fromQuery, food); toast(`Added ${fmt(e.kcal)} kcal to ${dateLabel(dk).toLowerCase()}`); currentDate = dk; goto('today'); });
    });
  }

  // Quick add (1.23.0): calories (+ optional macros and name) without looking up a food. Stored as a normal diary
  // entry with `quick: true` and a tiny food snapshot (per-100 values = the totals at 100 g, so any code that
  // scales by grams stays consistent). Not added to Recents and not offered as a recipe ingredient.
  function openQuickAdd(entry) {
    const e = entry || null;
    const v = (x) => (x === null || x === undefined || x === 0 ? '' : x);
    openSheet(`
      <div class="sheet-title"><h2>${e ? 'Edit quick add' : 'Quick add'}</h2><button class="icon-btn" id="qaClose" aria-label="Close">✕</button></div>
      <p class="muted small" style="margin:0 0 10px">For meals out or best guesses – just the calories, plus macros if you know them.</p>
      <div class="form-grid">
        <label class="span2">Calories (kcal)<input type="number" id="qaKcal" inputmode="numeric" min="1" max="10000" placeholder="e.g. 650" value="${e ? v(e.kcal) : ''}"></label>
        <label>Protein (g)<input type="number" id="qaP" inputmode="decimal" min="0" step="0.1" placeholder="optional" value="${e ? v(e.protein) : ''}"></label>
        <label>Carbs (g)<input type="number" id="qaC" inputmode="decimal" min="0" step="0.1" placeholder="optional" value="${e ? v(e.carbs) : ''}"></label>
        <label>Fat (g)<input type="number" id="qaF" inputmode="decimal" min="0" step="0.1" placeholder="optional" value="${e ? v(e.fat) : ''}"></label>
        <label>Name<input type="text" id="qaName" maxlength="60" placeholder="optional" value="${e && e.food.name !== 'Quick add' ? esc(e.food.name) : ''}"></label>
      </div>
      <p class="muted small" id="qaNote" style="min-height:1.2em"></p>
      <div class="sheet-actions">${e ? '<button class="btn danger" id="qaDelete">Delete</button>' : '<button class="btn" id="qaCancel">Cancel</button>'}<button class="btn primary" id="qaSave" disabled>${e ? 'Save' : 'Add'}</button></div>`);
    const num = (id) => { const x = parseFloat($(id).value); return Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : 0; };
    const kcalOf = () => { const x = parseInt($('#qaKcal').value, 10); return Number.isFinite(x) && x > 0 && x <= 10000 ? x : 0; };
    const check = () => {
      const k = kcalOf(), m = Math.round(num('#qaP') * 4 + num('#qaC') * 4 + num('#qaF') * 9);
      $('#qaSave').disabled = !k;
      $('#qaNote').textContent = k && m > k * 1.25 ? `Those macros add up to about ${fmt(m)} kcal – more than ${fmt(k)}. Worth a quick check.` : '';
    };
    ['#qaKcal', '#qaP', '#qaC', '#qaF'].forEach((id) => $(id).addEventListener('input', check));
    check();
    const build = () => {
      const k = kcalOf(), p = num('#qaP'), c = num('#qaC'), f = num('#qaF');
      const name = $('#qaName').value.trim() || 'Quick add';
      return { quick: true, food: { id: 'quick', source: 'quick', name, kcal: k, protein: p, carbs: c, fat: f }, grams: 100, kcal: k, protein: p, carbs: c, fat: f };
    };
    $('#qaClose').addEventListener('click', () => closeSheet());
    if ($('#qaCancel')) $('#qaCancel').addEventListener('click', () => closeSheet());
    if (e) $('#qaDelete').addEventListener('click', () => { Store.removeEntry(currentDate, e.id); closeSheet(); renderToday(); toast('Removed'); });
    $('#qaSave').addEventListener('click', () => {
      if (!kcalOf()) return;
      const x = build();
      if (e) { Store.updateEntry(currentDate, e.id, x); closeSheet(); renderToday(); toast('Saved'); return; }
      logWithDayGuard((dk) => { Store.addEntry(dk, x); toast(`Added ${fmt(x.kcal)} kcal to ${dateLabel(dk).toLowerCase()}`); currentDate = dk; goto('today'); });
    });
    setTimeout(() => { if (!e) $('#qaKcal') && $('#qaKcal').focus(); }, 50);
  }
  $('#quickAddBtn').addEventListener('click', () => openQuickAdd(null));

  // If the user is viewing a day other than today, confirm where the entry should go before saving.
  function logWithDayGuard(commit) {
    const today = Nutrition.dateKey(new Date());
    if (currentDate === today) { closeSheet(); commit(today); return; }
    const viewing = currentDate;
    openSheet(`
      <div class="sheet-title"><h2>Which day?</h2></div>
      <p class="muted">You're viewing <b>${esc(dateLabel(viewing))}</b> (${esc(fullDate(viewing))}). Where should this go?</p>
      <div class="day-guard">
        <button class="btn primary block" id="dgToday">Log for today</button>
        <button class="btn block" id="dgViewing">Log for ${esc(dateLabel(viewing))}</button>
        <button class="btn ghost block" id="dgCancel">Cancel</button>
      </div>`);
    $('#dgToday').addEventListener('click', () => { closeSheet(); commit(today); });
    $('#dgViewing').addEventListener('click', () => { closeSheet(); commit(viewing); });
    $('#dgCancel').addEventListener('click', () => closeSheet());
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
      if (offResults.size > 20) offResults.delete(offResults.keys().next().value); // keep the last 20 searches
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
    const lists = { recents: s.recents, mine: s.customFoods, recipes: s.recipes.map(Sources.recipeAsFood) };
    const list = lists[addTab] || [];
    const empties = { recents: 'Foods you log will appear here for quick re-adding.', mine: 'Create a custom food from a photo of the nutrition label, or import one a friend shared.', recipes: 'Build a recipe once and log it as a single item — or import one a friend shared.' };
    const d = addTab === 'recipes' ? Store.state.recipeDraft : null;
    const TRASH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
    const draftRow = d ? `<div class="draft-row"><button class="item draft-main" id="resumeDraft"><div class="thumb">✏️</div><div class="item-main"><div class="item-title">Unsaved recipe${d.name ? ': ' + esc(d.name) : ''}</div><div class="item-sub">${d.ingredients.length} ingredient${d.ingredients.length === 1 ? '' : 's'} · tap to continue</div></div></button><button class="trash-btn" id="deleteDraft" aria-label="Delete unsaved recipe" title="Delete unsaved recipe">${TRASH}</button></div>` : '';
    $('#addContent').innerHTML = draftRow + (list.length || d ? `<div class="list">${list.map(foodRow).join('')}</div>` : `<div class="empty"><div class="empty-icon">${{ recents: '🕒', mine: '🏷️', recipes: '🥘' }[addTab]}</div><p>${empties[addTab]}</p></div>`);
    bindFoodRows();
    if ($('#resumeDraft')) $('#resumeDraft').addEventListener('click', () => openRecipeSheet(Store.state.recipeDraft, { resume: true }));
    if ($('#deleteDraft')) $('#deleteDraft').addEventListener('click', () => {
      const dr = Store.state.recipeDraft; if (!dr) return;
      openSheet(`<div class="sheet-title"><h2>Delete unsaved recipe?</h2></div>
        <p>${dr.id ? `This deletes your unsaved changes to <b>${esc(dr.name || 'this recipe')}</b>. The saved version stays as it is.` : `This deletes <b>${esc(dr.name || 'your unsaved recipe')}</b> (${dr.ingredients.length} ingredient${dr.ingredients.length === 1 ? '' : 's'}). It can't be undone.`}</p>
        <div class="day-guard"><button class="btn danger block" id="ddYes">Delete</button><button class="btn ghost block" id="ddNo">Cancel</button></div>`);
      $('#ddYes').addEventListener('click', () => { Store.clearDraft(); closeSheet(); renderAdd(); toast('Unsaved recipe deleted'); });
      $('#ddNo').addEventListener('click', () => closeSheet());
    });
  }
  function renderIdle() {
    const s = Store.state;
    const rec = s.recents.slice(0, 8);
    let html = '';
    if (rec.length) html += `<div class="group-title">Recent</div><div class="list">${rec.map(foodRow).join('')}</div>`;
    if (!html) html = `<div class="empty"><div class="empty-icon">🔍</div><p>Search ${Sources.cofidCount() ? 'thousands of UK foods and ' : ''}millions of barcoded products, or scan a barcode.</p></div>`;
    $('#addContent').innerHTML = html; bindFoodRows();
  }
  function renderResults(q, { offPending = false, offError = null } = {}) {
    if (addTab !== 'results') return;
    const pick = Store.pickFor(q);
    const notPick = (f) => !pick || f.id !== pick.id;
    const cof = Sources.searchCofid(q, 20).filter(notPick);
    const fixed = Sources.correctionFor(q); // spelling-tolerant search (1.23.0)
    let localAll = Sources.searchLocal(q);
    if (!localAll.length && fixed) localAll = Sources.searchLocal(fixed);
    const local = localAll.filter(notPick);
    const offAll = offResults.get(q);
    const off = offAll ? offAll.filter(notPick) : offAll;
    let html = fixed ? `<div class="inline-note spell-note">No exact match for “${esc(q)}” – showing results for “<b>${esc(fixed)}</b>”.</div>` : '';
    if (pick) html += `<div class="group-title">Your pick last time</div><div class="list">${foodRow(pick)}</div>`;
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
    const all = [...Object.values(Store.state.picks || {}), ...Store.state.recents, ...Store.state.customFoods, ...Store.state.recipes.map(Sources.recipeAsFood), ...Object.values(Store.state.cache)];
    for (const list of offResults.values()) all.push(...list);
    all.forEach((f) => foodIndex.set(f.id, f));
    Sources.searchCofid(input.value.trim(), 50).forEach((f) => foodIndex.set(f.id, f));
  }
  $('#addContent').addEventListener('click', (e) => {
    const b = e.target.closest('[data-food]'); if (!b) return;
    const f = foodIndex.get(b.dataset.food);
    if (f) openFoodSheet(f, { fromQuery: addTab === 'results' ? input.value.trim() : '' });
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
      scanner = await Scanner.start($('#reader'), (code) => { if (navigator.vibrate) navigator.vibrate(30); if (!localHandle(code)) handle(code); }, {
        onStatus: (st) => { const h = $('#scanHint'); if (!h) return; if (st === 'loading') h.innerHTML = '<span class="spinner"></span> Starting scanner…'; if (st === 'ready') h.textContent = 'Hold the barcode in the middle of the screen'; }
      });
    } catch (err) {
      console.warn(err);
      const msg = String(err && (err.name || err.message || err));
      const h = $('#scanHint');
      if (h) h.textContent = 'Camera unavailable – ' + (/NotAllowed|Permission|Security/i.test(msg) ? 'allow camera access in your browser settings, or type the barcode below.' : /load|engine/i.test(msg) ? 'the scanner needs an internet connection the first time. Type the barcode below.' : 'type the barcode below.');
    }
  }
  async function stopScanner() {
    if (scanner) { try { scanner.stop(); } catch (e) { /* ignore */ } scanner = null; }
  }


  /* ===================== CUSTOM FOOD (with label OCR) ===================== */
  function openCustomFoodSheet(seed) {
    const f = Object.assign({ name: '', brand: '', barcode: '', kcal: '', protein: '', carbs: '', fat: '', satFat: '', sugars: '', fibre: '', salt: '', servingG: '', image: null }, seed || {});
    const isEdit = !!(seed && seed.id);
    const v = (x) => (x === null || x === undefined ? '' : x);
    openSheet(`
      <div class="sheet-title"><h2>${isEdit ? 'Edit food' : 'New custom food'}</h2><button class="icon-btn" id="closeCF">✕</button></div>
      <div class="row-btns">
        <button class="btn ghost photo-btn" id="labelPhotoBtn" type="button">📷 Scan nutrition label</button>
        <button class="btn ghost photo-btn" id="productPhotoBtn" type="button">📸 Product photo</button>
        <input type="file" id="labelPhotoCam" accept="image/*" capture="environment" class="hidden-file">
        <input type="file" id="labelPhoto" accept="image/*" class="hidden-file">
        <input type="file" id="productPhotoCam" accept="image/*" capture="environment" class="hidden-file">
        <input type="file" id="productPhoto" accept="image/*" class="hidden-file">
      </div>
      <div id="photoChooser"></div>
      <div id="ocrBox"></div>
      <div class="food-hero" id="cfHero">${thumbHTML(f)}<div class="meta"><p class="muted small">Values are per 100 g (or 100 ml). Check anything read from the label before saving.</p></div></div>
      <div class="form-grid">
        <label class="span2">Name<input type="text" id="cfName" value="${esc(f.name)}" placeholder="e.g. Granola, Tesco"></label>
        <label class="span2">Energy (kcal)<input type="number" id="cfKcal" inputmode="decimal" value="${v(f.kcal)}"></label>
        <label>Protein (g)<input type="number" id="cfProtein" inputmode="decimal" step="0.1" value="${v(f.protein)}"></label>
        <label>Carbs (g)<input type="number" id="cfCarbs" inputmode="decimal" step="0.1" value="${v(f.carbs)}"></label>
        <label>Fat (g)<input type="number" id="cfFat" inputmode="decimal" step="0.1" value="${v(f.fat)}"></label>
        <label>Brand (optional)<input type="text" id="cfBrand" value="${esc(f.brand)}"></label>
        <label class="span2">Barcode (optional)<input type="text" id="cfBarcode" inputmode="numeric" value="${esc(f.barcode)}"></label>
      </div>
      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" id="cfDelete">Delete</button>' : ''}
        <button class="btn primary" id="cfSave">Save food</button>
      </div>`);
    $('#closeCF').addEventListener('click', () => closeSheet());
    let image = f.image || null;
    // Android doesn't reliably offer a camera/gallery chooser for a plain file input, so ask explicitly.
    // "Take photo" clicks an input with capture="environment"; "Choose" clicks a plain one. Same chooser for both buttons.
    const onProductPhoto = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      image = await fileToDataURL(file, 256, 0.8);
      $('#cfHero .thumb').innerHTML = `<img src="${image}" alt="">`;
      e.target.value = '';
    };
    $('#productPhotoCam').addEventListener('change', onProductPhoto);
    $('#productPhoto').addEventListener('change', onProductPhoto);
    const onLabelPhoto = async (e) => { const file = e.target.files[0]; if (!file) return; e.target.value = ''; await runLabelOCR(file); };
    $('#labelPhotoCam').addEventListener('change', onLabelPhoto);
    $('#labelPhoto').addEventListener('change', onLabelPhoto);
    function photoChooser(title, camInput, galInput, srcBtn) {
      const host = $('#photoChooser');
      const close = () => { host.innerHTML = ''; $$('.photo-btn').forEach((b) => b.classList.remove('selected')); };
      // Tapping the same button again closes the chooser
      if (srcBtn.classList.contains('selected')) { close(); return; }
      $$('.photo-btn').forEach((b) => b.classList.toggle('selected', b === srcBtn));
      host.innerHTML = `<div class="choice-pop"><div class="choice-title">${esc(title)}</div><button class="btn primary block" data-c="cam">📷 Take photo</button><button class="btn outline block" data-c="gal">🖼️ Choose from gallery</button><button class="btn text-btn block" data-c="x">Cancel</button></div>`;
      host.onclick = (ev) => {
        const b = ev.target.closest('[data-c]'); if (!b) return;
        close();
        if (b.dataset.c === 'cam') camInput.click(); else if (b.dataset.c === 'gal') galInput.click();
      };
    }
    $('#labelPhotoBtn').addEventListener('click', (e) => photoChooser('Nutrition label', $('#labelPhotoCam'), $('#labelPhoto'), e.currentTarget));
    $('#productPhotoBtn').addEventListener('click', (e) => photoChooser('Product photo', $('#productPhotoCam'), $('#productPhoto'), e.currentTarget));
    async function runLabelOCR(file) {
      const box = $('#ocrBox');
      try {
        const preview = await fileToDataURL(file, 1600, 0.9, true);
        box.innerHTML = `<img class="ocr-preview" src="${preview}" alt="Label"><div class="progressline"><div id="ocrBar"></div></div><p class="muted small" id="ocrStatus">Loading text recognition…</p>`;
        const worker = await ocrWorker();
        const { data } = await worker.recognize(preview);
        ocrIdle();
        const r = Nutrition.parseLabelText(data.text);
        const set = (id, val) => { if (val !== null && val !== undefined) $(id).value = val; };
        set('#cfKcal', r.kcal); set('#cfFat', r.fat); set('#cfCarbs', r.carbs); set('#cfProtein', r.protein);
        const n = ['kcal', 'fat', 'carbs', 'protein'].filter((k) => r[k] !== null).length;
        if (n === 4) box.innerHTML = `<div class="inline-note">✅ Read energy, fat, carbs and protein from the label. Please double-check the numbers below.</div>`;
        else if (n > 0) box.innerHTML = `<div class="inline-note">⚠️ Read ${n} of 4 main values. Fill in the rest by hand, or retake the photo closer and in good light.</div><details class="small muted"><summary>Text found</summary><pre style="white-space:pre-wrap">${esc(data.text)}</pre></details>`;
        else box.innerHTML = `<div class="inline-note">Couldn't read a nutrition table. Try a straight-on, well-lit photo with the table filling the frame.</div><details class="small muted"><summary>Text found</summary><pre style="white-space:pre-wrap">${esc(data.text)}</pre></details>`;
      } catch (err) {
        console.error(err);
        { const p = ocrWorkerP; ocrWorkerP = null; if (p) p.then((w) => w.terminate()).catch(() => {}); } // start fresh next time
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
  // Read-only recipe: see exactly what went into it (to recreate it) without any risk of changing it (1.19.0).
  // "Edit recipe" from here opens the editor; "Back" returns to wherever the user came from.
  function openRecipeView(r, onBack) {
    const totalG = r.totalG || r.ingredients.reduce((a, x) => a + (x.grams || 0), 0);
    const tot = Nutrition.sum(r.ingredients.map((x) => Nutrition.scaleExact(x.food, x.grams)));
    const servings = Math.max(1, r.servings || 1);
    const per = { kcal: tot.kcal / servings, protein: tot.protein / servings, carbs: tot.carbs / servings, fat: tot.fat / servings };
    openSheet(`
      <div class="sheet-title"><h2>Recipe</h2><button class="icon-btn" id="closeRV">✕</button></div>
      <div class="food-hero">
        <div class="thumb">${Store.photoSrc(r.image) ? `<img src="${esc(Store.photoSrc(r.image))}" alt="">` : '🥘'}</div>
        <div class="meta"><h2>${esc(r.name)}</h2><p>${servings} serving${servings === 1 ? '' : 's'} · ${fmt(totalG)} g total · ${fmt(totalG / servings)} g per serving</p></div>
      </div>
      <div class="group-title">Per serving</div>
      <div class="totals"><div><b>${fmt(per.kcal)}</b><small>kcal</small></div><div><b>${fmt(per.protein, 1)}</b><small>protein g</small></div><div><b>${fmt(per.carbs, 1)}</b><small>carbs g</small></div><div><b>${fmt(per.fat, 1)}</b><small>fat g</small></div></div>
      <div class="group-title">Ingredients (${r.ingredients.length})</div>
      <div class="rv-list">
        ${r.ingredients.map((x) => { const k = Nutrition.scale(x.food, x.grams).kcal; return `<div class="rv-row">${thumbHTML(x.food)}<div class="item-main"><div class="item-title">${esc(x.food.name)}</div><div class="item-sub">${x.food.brand ? esc(x.food.brand) + ' · ' : ''}${fmt(x.grams)} g</div></div><div class="item-kcal"><b>${fmt(k)}</b><small>kcal</small></div></div>`; }).join('')}
      </div>
      <p class="muted small">Whole recipe: ${fmt(tot.kcal)} kcal · P ${fmt(tot.protein)} g · C ${fmt(tot.carbs)} g · F ${fmt(tot.fat)} g</p>
      <div class="sheet-actions">
        <button class="btn" id="rvBack">← Back</button>
        <button class="btn primary" id="rvEdit">Edit recipe</button>
      </div>`);
    $('#closeRV').addEventListener('click', () => closeSheet());
    $('#rvBack').addEventListener('click', () => (onBack ? onBack() : closeSheet()));
    $('#rvEdit').addEventListener('click', () => { const cur = Store.state.recipes.find((x) => x.id === r.id) || r; openRecipeSheet(cur); });
  }

  // Does a recipe-in-progress differ from what's saved (or, for a new recipe, contain anything)?
  function recipeIsDirty(r) {
    const sig = (x) => JSON.stringify({ n: (x.name || '').trim(), s: x.servings, t: x.totalG || null, im: x.image || null, ing: (x.ingredients || []).map((i) => [i.food && i.food.id, i.grams]) });
    if (r.id) { const saved = Store.state.recipes.find((x) => x.id === r.id); return !saved || sig(saved) !== sig(r); }
    return !!((r.name || '').trim() || (r.ingredients || []).length || r.image);
  }

  // resume = returning to the editor mid-flow (from the ingredient search, diary picker or a draft) — no draft prompt.
  function openRecipeSheet(recipe, { resume = false } = {}) {
    const d = Store.state.recipeDraft;
    if (!resume && d) {
      if (!recipeIsDirty(d)) Store.clearDraft();
      else {
        const opening = recipe && recipe.id ? `Delete it and open “${esc(recipe.name)}”` : 'Delete it and start a new one';
        openSheet(`<div class="sheet-title"><h2>Unsaved recipe</h2><button class="icon-btn" id="closeDr">✕</button></div>
          <p>You were ${d.id ? 'editing' : 'building'} <b>${esc(d.name || 'a recipe')}</b> (${d.ingredients.length} ingredient${d.ingredients.length === 1 ? '' : 's'}) and it wasn't saved.</p>
          <div class="day-guard"><button class="btn primary block" id="drContinue">Continue it</button><button class="btn block" id="drDelete">${opening}</button></div>`);
        $('#closeDr').addEventListener('click', () => closeSheet());
        $('#drContinue').addEventListener('click', () => openRecipeSheet(d, { resume: true }));
        $('#drDelete').addEventListener('click', () => { Store.clearDraft(); openRecipeSheet(recipe, { resume: true }); });
        return;
      }
    }
    const r = recipe ? JSON.parse(JSON.stringify(recipe)) : { name: '', servings: 4, ingredients: [], totalG: null, image: null };
    delete r.draftSavedAt;
    const isEdit = !!(recipe && recipe.id);
    openSheet(`
      <div class="sheet-title"><h2>${isEdit ? 'Edit recipe' : 'New recipe'}</h2><button class="icon-btn" id="closeR">✕</button></div>
      <div class="recipe-photo">
        <div class="thumb" id="rThumb">${Store.photoSrc(r.image) ? `<img src="${esc(Store.photoSrc(r.image))}" alt="">` : '🥘'}</div>
        <div class="recipe-photo-btns">
          <button class="btn ghost photo-btn" id="rPhotoBtn" type="button">📸 ${r.image ? 'Change photo' : 'Add photo'}</button>
          ${r.image ? '<button class="btn text-btn" id="rPhotoRemove" type="button">Remove photo</button>' : ''}
        </div>
        <input type="file" id="rPhotoCam" accept="image/*" capture="environment" class="hidden-file">
        <input type="file" id="rPhotoGal" accept="image/*" class="hidden-file">
      </div>
      <div id="rPhotoChooser"></div>
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
    // Recipe photo: same Take photo / Choose from gallery chooser as custom foods
    const setRecipePhoto = (img) => {
      r.image = img;
      $('#rThumb').innerHTML = Store.photoSrc(img) ? `<img src="${esc(Store.photoSrc(img))}" alt="">` : '🥘';
      $('#rPhotoBtn').textContent = img ? '📸 Change photo' : '📸 Add photo';
      const rm = $('#rPhotoRemove');
      if (img && !rm) $('#rPhotoBtn').insertAdjacentHTML('afterend', '<button class="btn text-btn" id="rPhotoRemove" type="button">Remove photo</button>');
      if (!img && rm) rm.remove();
      autosave();
    };
    const onRecipePhoto = async (e) => { const file = e.target.files[0]; if (!file) return; e.target.value = ''; setRecipePhoto(await fileToDataURL(file, 256, 0.8)); };
    $('#rPhotoCam').addEventListener('change', onRecipePhoto);
    $('#rPhotoGal').addEventListener('change', onRecipePhoto);
    $('.recipe-photo').addEventListener('click', (e) => { if (e.target.closest('#rPhotoRemove')) setRecipePhoto(null); });
    $('#rPhotoBtn').addEventListener('click', () => {
      const host = $('#rPhotoChooser'), btn = $('#rPhotoBtn');
      const close = () => { host.innerHTML = ''; btn.classList.remove('selected'); };
      if (btn.classList.contains('selected')) return close();
      btn.classList.add('selected');
      host.innerHTML = `<div class="choice-pop"><div class="choice-title">Recipe photo</div><button class="btn primary block" data-c="cam">📷 Take photo</button><button class="btn outline block" data-c="gal">🖼️ Choose from gallery</button><button class="btn text-btn block" data-c="x">Cancel</button></div>`;
      host.onclick = (ev) => {
        const b = ev.target.closest('[data-c]'); if (!b) return;
        close();
        if (b.dataset.c === 'cam') $('#rPhotoCam').click(); else if (b.dataset.c === 'gal') $('#rPhotoGal').click();
      };
    });
    // Rebuild the ingredient rows only when the list itself changes (add/remove).
    // Typing in a gram box must NOT rebuild the rows — that replaces the focused box and closes the keyboard.
    const drawList = () => {
      $('#rIngredients').innerHTML = r.ingredients.map((ing, i) => `<div class="ingredient"><span class="name">${esc(ing.food.name)}</span><input type="number" data-i="${i}" value="${ing.grams}" inputmode="decimal"><span class="muted small">g</span><button class="x" data-del="${i}">✕</button></div>`).join('') || '<p class="muted small">No ingredients yet.</p>';
    };
    const drawTotals = () => {
      const sumG = r.ingredients.reduce((a, x) => a + (x.grams || 0), 0);
      const tot = Nutrition.sum(r.ingredients.map((x) => Nutrition.scale(x.food, x.grams)));
      const servings = Math.max(1, parseInt($('#rServings').value, 10) || 1);
      const totalG = parseFloat($('#rTotal').value) || sumG;
      $('#rTotals').innerHTML = `<div><b>${fmt(tot.kcal)}</b><small>kcal total</small></div><div><b>${fmt(tot.protein)}</b><small>protein g</small></div><div><b>${fmt(tot.carbs)}</b><small>carbs g</small></div><div><b>${fmt(tot.fat)}</b><small>fat g</small></div>`;
      $('#rPer').textContent = sumG ? `${fmt(totalG)} g total → ${fmt(tot.kcal / servings)} kcal per serving (${fmt(totalG / servings)} g). Per 100 g: ${fmt((tot.kcal / totalG) * 100)} kcal.` : '';
      $('#rTotal').placeholder = sumG ? `auto (${fmt(sumG)})` : 'auto';
    };

    const draw = () => { drawList(); drawTotals(); };
    draw();
    $('#rIngredients').addEventListener('input', (e) => { const i = e.target.dataset.i; if (i !== undefined) { r.ingredients[i].grams = parseFloat(e.target.value) || 0; drawTotals(); } });
    $('#rIngredients').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { r.ingredients.splice(+d.dataset.del, 1); draw(); } });
    $('#rServings').addEventListener('input', drawTotals); $('#rTotal').addEventListener('input', drawTotals);
    const snapshot = () => Object.assign(r, { name: $('#rName').value, servings: parseInt($('#rServings').value, 10) || r.servings, totalG: parseFloat($('#rTotal').value) || null });
    // Auto-save the work in progress so an accidental close (tap outside, swipe back) never loses it.
    const autosave = () => { snapshot(); if (recipeIsDirty(r)) Store.saveDraft(r); else if (Store.state.recipeDraft && (Store.state.recipeDraft.id || null) === (r.id || null)) Store.clearDraft(); };
    $('#rName').addEventListener('input', autosave);
    $('#rServings').addEventListener('input', autosave); $('#rTotal').addEventListener('input', autosave);
    $('#rIngredients').addEventListener('input', autosave);
    $('#rIngredients').addEventListener('click', (e) => { if (e.target.closest('[data-del]')) autosave(); });
    autosave();
    $('#rAddIng').addEventListener('click', () => { snapshot(); autosave(); openIngredientPicker((food, grams) => { r.ingredients.push({ food, grams }); openRecipeSheet(r, { resume: true }); }, r); });
    $('#rFromDiary').addEventListener('click', () => { snapshot(); autosave(); openDiaryPicker((items) => { items.forEach((x) => r.ingredients.push(x)); openRecipeSheet(r, { resume: true }); toast(`Added ${items.length} item${items.length === 1 ? '' : 's'} from your diary`); }, r); });
    $('#rSave').addEventListener('click', () => {
      const name = $('#rName').value.trim(); if (!name) return toast('Name the recipe');
      if (!r.ingredients.length) return toast('Add at least one ingredient');
      const sumG = r.ingredients.reduce((a, x) => a + (x.grams || 0), 0);
      const totalG = parseFloat($('#rTotal').value) || sumG;
      const servings = Math.max(1, parseInt($('#rServings').value, 10) || 1);
      const tot = Nutrition.sum(r.ingredients.map((x) => Nutrition.scaleExact(x.food, x.grams)));
      const per100 = { kcal: Math.round((tot.kcal / totalG) * 100), protein: +((tot.protein / totalG) * 100).toFixed(1), carbs: +((tot.carbs / totalG) * 100).toFixed(1), fat: +((tot.fat / totalG) * 100).toFixed(1) };
      const saved = Store.saveRecipe({ id: r.id, name, servings, totalG, ingredients: r.ingredients, per100, servingG: Math.round(totalG / servings), servingLabel: '1 serving', image: r.image });
      Store.clearDraft();
      closeSheet(); toast('Recipe saved'); addTab = 'recipes'; $$('#addTabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'recipes')); renderAdd();
      openFoodSheet(Sources.recipeAsFood(saved));
    });
    if (isEdit) $('#rDelete').addEventListener('click', () => { Store.deleteRecipe(r.id); Store.clearDraft(); closeSheet(); renderAdd(); toast('Recipe deleted'); });
  }
  // Mini search inside a sheet, used to pick recipe ingredients.
  const ipOffCache = new Map(); // product search results per query, so "Back to results" doesn't re-query
  function openIngredientPicker(onPick, draftRecipe, { query = '' } = {}) {
    openSheet(`
      <div class="sheet-title"><h2>Add ingredient</h2><button class="icon-btn" id="closeIP">✕</button></div>
      <div class="searchbar"><div class="search-input"><span class="search-icon">⌕</span><input type="search" id="ipInput" placeholder="Search foods or barcode" autocomplete="off" enterkeyhint="search"></div><button class="btn icon-only accent" id="ipScan">▦</button></div>
      <div id="ipResults" class="list"></div>`);
    $('#closeIP').addEventListener('click', () => openRecipeSheet(draftRecipe, { resume: true }));
    const ipIndex = new Map();
    const ipInput = $('#ipInput');
    ipInput.value = query;
    // Picking a food opens its page with "Back to results" (keeps the search) and remembers the pick for next time.
    const pickFood = (f, q) => openFoodSheet(f, {
      onAdd: (food, grams) => { if (q) Store.rememberPick(q, food); onPick(food, grams); },
      onBack: () => openIngredientPicker(onPick, draftRecipe, { query: q })
    });
    const show = (foods, pending, q) => {
      // Results can arrive after the user has moved on (opened a food, gone back to the recipe) — ignore them then.
      const box = $('#ipResults'); if (!box || $('#ipInput') !== ipInput) return;
      const pick = q ? Store.pickFor(q) : null;
      const usePick = pick && pick.source !== 'recipe' ? pick : null;
      const rest = foods.filter((f) => !usePick || f.id !== usePick.id);
      if (usePick) ipIndex.set(usePick.id, usePick);
      box.innerHTML = (usePick ? `<div class="group-title">Your pick last time</div>${foodRow(usePick)}${rest.length ? '<div class="group-title">Other results</div>' : ''}` : '') +
        rest.map((f) => { ipIndex.set(f.id, f); return foodRow(f); }).join('') +
        (pending ? '<div class="group-title"><span class="spinner"></span> Searching products…</div>' : '');
    };
    let t;
    const doSearch = async () => {
      const q = ipInput.value.trim();
      if (!q) { show([...Store.state.recents.slice(0, 10), ...Store.state.customFoods.slice(0, 10)], false, ''); return; }
      const local = [...Sources.searchLocal(q).filter((f) => f.source !== 'recipe'), ...Sources.searchCofid(q, 15)];
      const cached = ipOffCache.get(q);
      if (cached) { show([...local, ...cached], false, q); return; }
      show(local, q.length >= 3, q);
      if (q.length < 3) return;
      try {
        const off = await Sources.search(q).off;
        ipOffCache.set(q, off);
        if (ipOffCache.size > 20) ipOffCache.delete(ipOffCache.keys().next().value);
        if (ipInput.value.trim() === q) show([...local, ...off], false, q);
      } catch (e) { if (ipInput.value.trim() === q) show(local, false, q); }
    };
    ipInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(doSearch, 700); });
    ipInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); doSearch(); ipInput.blur(); } });
    $('#ipScan').addEventListener('click', () => {
      const q = ipInput.value.trim();
      openScanner(async (code) => {
        const mine = Store.state.customFoods.find((f) => f.barcode === code);
        const f = mine || await Sources.lookupBarcode(code).catch(() => null);
        if (f) openFoodSheet(f, { onAdd: onPick, onBack: () => openIngredientPicker(onPick, draftRecipe, { query: q }) });
        else { toast('Barcode not found'); openIngredientPicker(onPick, draftRecipe, { query: q }); }
      });
    });
    $('#ipResults').addEventListener('click', (e) => { const b = e.target.closest('[data-food]'); if (!b) return; const f = ipIndex.get(b.dataset.food); if (f) pickFood(f, ipInput.value.trim()); });
    doSearch();
    if (!query) setTimeout(() => { const el = $('#ipInput'); if (el) el.focus(); }, 50); // returning with a search: don't pop the keyboard
  }

  // Pick already-logged foods from the last 7 days to reuse in a recipe.
  function openDiaryPicker(onDone, draftRecipe) {
    const today = Nutrition.dateKey(new Date());
    const days = Array.from({ length: 7 }, (_, i) => Nutrition.addDays(today, -i));
    let day = today;
    const selected = new Map(); // entryId -> { food, grams }
    const pickable = (d) => Store.entries(d).filter((e) => !e.quick); // quick-add entries have no real food/weight (1.23.0)
    openSheet(`
      <div class="sheet-title"><h2>From my diary</h2><button class="icon-btn" id="closeDP">✕</button></div>
      <p class="muted small" style="margin:0 0 8px">Pick a day, then tick the foods to add. Amounts come from what you logged.</p>
      <div class="chips" id="dpDays">${days.map((d) => `<button class="chip ${d === today ? 'active' : ''}" data-day="${d}">${dateLabel(d)}${pickable(d).length ? ` <small>· ${pickable(d).length}</small>` : ''}</button>`).join('')}</div>
      <div class="section-head" style="margin:4px 2px 6px"><span class="muted small" id="dpCount"></span><button class="link-btn" id="dpAll">Select all</button></div>
      <div class="list" id="dpList"></div>
      <div class="sheet-actions"><button class="btn" id="dpCancel">Cancel</button><button class="btn primary" id="dpAdd" disabled>Add to recipe</button></div>`);
    const back = () => openRecipeSheet(draftRecipe, { resume: true });
    $('#closeDP').addEventListener('click', back); $('#dpCancel').addEventListener('click', back);
    const drawList = () => {
      const list = pickable(day);
      $('#dpList').innerHTML = list.length ? list.map((e) => `<button class="item selectable ${selected.has(e.id) ? 'selected' : ''}" data-pick="${e.id}">
          <span class="check"></span>${thumbHTML(e.food)}
          <div class="item-main"><div class="item-title">${esc(e.food.name)}</div><div class="item-sub">${e.food.brand ? esc(e.food.brand) + ' · ' : ''}${amountLabel(e)}</div></div>
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
      const entry = pickable(day).find((x) => x.id === b.dataset.pick); if (!entry) return;
      if (selected.has(entry.id)) selected.delete(entry.id); else selected.set(entry.id, { food: Store.slimFood(entry.food), grams: entry.grams });
      drawList();
    });
    $('#dpAll').addEventListener('click', () => {
      const list = pickable(day);
      if (list.every((e) => selected.has(e.id))) list.forEach((e) => selected.delete(e.id));
      else list.forEach((e) => selected.set(e.id, { food: Store.slimFood(e.food), grams: e.grams }));
      drawList();
    });
    $('#dpAdd').addEventListener('click', () => { if (selected.size) { closeSheet(true); onDone([...selected.values()]); } });
  }

  /* ===================== SHARE / IMPORT ===================== */
  async function shareItem(type, item) {
    try {
      const payload = type === 'recipe' ? Share.packRecipe(item) : Share.packFood(item);
      const code = await Share.encode(payload);
      const url = Share.shareUrl(code);
      const summary = type === 'recipe'
        ? `${item.name} — ${item.servings} serving${item.servings === 1 ? '' : 's'}, ${fmt((item.per100.kcal * (item.totalG || 0)) / 100 / item.servings)} kcal per serving.`
        : `${item.name}${item.brand ? ' (' + item.brand + ')' : ''} — ${fmt(item.kcal)} kcal per 100 g.`;
      const text = `${summary}\nOpen in FoodDiary: ${url}\n\nOn iPhone: copy this link, open FoodDiary from your home screen, go to Add → Import and paste it.`;
      if (navigator.share) {
        try { await navigator.share({ title: `FoodDiary ${type}: ${item.name}`, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      openSheet(`<div class="sheet-title"><h2>Share ${type}</h2><button class="icon-btn" id="closeSh">✕</button></div>
        <p class="muted small">Copy this message and send it over WhatsApp, Signal, email — anything. The link contains the whole ${type}.</p>
        <textarea id="shareText" rows="6" readonly>${esc(text)}</textarea>
        <div class="sheet-actions"><button class="btn primary" id="copyShare">Copy message</button></div>`);
      $('#closeSh').addEventListener('click', () => closeSheet());
      $('#copyShare').addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { $('#shareText').select(); toast('Select and copy the text'); } });
    } catch (err) { console.error(err); toast('Couldn\u2019t create the share link'); }
  }

  function openImportSheet(prefill) {
    openSheet(`<div class="sheet-title"><h2>Import</h2><button class="icon-btn" id="closeIm">✕</button></div>
      <p class="muted small">Paste a FoodDiary share link or code that someone sent you.</p>
      <textarea id="importText" rows="4" placeholder="https://…/fooddiary/#share=…">${esc(prefill || '')}</textarea>
      <div class="sheet-actions"><button class="btn" id="pasteIm">Paste</button><button class="btn primary" id="goIm">Import</button></div>`);
    $('#closeIm').addEventListener('click', () => closeSheet());
    $('#pasteIm').addEventListener('click', async () => { try { $('#importText').value = await navigator.clipboard.readText(); } catch (e) { toast('Tap the box and paste'); $('#importText').focus(); } });
    $('#goIm').addEventListener('click', () => handleShareCode($('#importText').value));
    setTimeout(() => { const t = $('#importText'); if (t) t.focus(); }, 50);
  }

  async function handleShareCode(code) {
    let parsed;
    try { parsed = await Share.decode(code); } catch (err) { toast(err.message, 3500); return; }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const item = parsed.type === 'recipe' ? parsed.recipe : parsed.food;
    const taken = (name) => (parsed.type === 'recipe' ? Store.state.recipes : Store.state.customFoods).some((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    const kcalLine = parsed.type === 'recipe'
      ? `${item.servings} serving${item.servings === 1 ? '' : 's'} · ${fmt((item.per100.kcal * (item.totalG || item.ingredients.reduce((a, i) => a + i.grams, 0))) / 100 / item.servings)} kcal per serving`
      : `${item.brand ? esc(item.brand) + ' · ' : ''}${fmt(item.kcal)} kcal · P ${fmt(item.protein, 1)} · C ${fmt(item.carbs, 1)} · F ${fmt(item.fat, 1)} per 100 g`;
    openSheet(`<div class="sheet-title"><h2>Import ${parsed.type}</h2><button class="icon-btn" id="closeIm2">✕</button></div>
      <div class="food-hero"><div class="thumb">${parsed.type === 'recipe' ? '🥘' : '🏷️'}</div><div class="meta"><h2>${esc(item.name)}</h2><p>${kcalLine}</p></div></div>
      ${parsed.type === 'recipe' ? `<div class="group-title">Ingredients</div><div class="ingredients">${item.ingredients.map((i) => `<div class="ingredient"><span class="name">${esc(i.food.name)}</span><span class="muted small">${fmt(i.grams)} g</span></div>`).join('')}</div>` : ''}
      <label class="field" style="margin-top:12px">Save as<input type="text" id="importName" value="${esc(item.name)}"></label>
      <p class="small name-hint" id="nameHint"></p>
      ${!isStandalone && isIOS ? `<div class="inline-note">📱 Using FoodDiary from your home screen? Import there instead: tap <b>Copy code</b>, open the app, then Add → Import → paste.</div>` : ''}
      <div class="sheet-actions">${!isStandalone ? '<button class="btn" id="copyCode">Copy code</button>' : ''}<button class="btn primary" id="confirmIm">Add to my ${parsed.type === 'recipe' ? 'recipes' : 'foods'}</button></div>`);
    $('#closeIm2').addEventListener('click', () => closeSheet());
    const nameIn = $('#importName'), hint = $('#nameHint'), btn = $('#confirmIm');
    const check = () => {
      const v = nameIn.value.trim();
      const bad = !v || taken(v);
      nameIn.classList.toggle('invalid', bad);
      hint.textContent = !v ? 'Give it a name.' : taken(v) ? `You already have a ${parsed.type} called “${v}” — choose a different name.` : '';
      btn.disabled = bad;
    };
    check(); nameIn.addEventListener('input', check);
    if ($('#copyCode')) $('#copyCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(String(code).trim()); toast('Code copied — paste it in your FoodDiary app'); } catch (e) { toast('Couldn\u2019t copy'); } });
    btn.addEventListener('click', () => {
      const name = nameIn.value.trim(); if (!name || taken(name)) return check();
      if (parsed.type === 'recipe') {
        const r = item; r.name = name;
        r.totalG = r.totalG || r.ingredients.reduce((a, i) => a + i.grams, 0);
        r.servingG = Math.round(r.totalG / r.servings); r.servingLabel = '1 serving';
        if (!r.per100) { const tot = Nutrition.sum(r.ingredients.map((x) => Nutrition.scaleExact(x.food, x.grams))); r.per100 = { kcal: Math.round((tot.kcal / r.totalG) * 100), protein: +((tot.protein / r.totalG) * 100).toFixed(1), carbs: +((tot.carbs / r.totalG) * 100).toFixed(1), fat: +((tot.fat / r.totalG) * 100).toFixed(1) }; }
        const saved = Store.saveRecipe(r);
        closeSheet(); toast(`Recipe “${name}” added`); addTab = 'recipes';
        goto('add'); $$('#addTabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'recipes')); renderAdd();
        openFoodSheet(Sources.recipeAsFood(saved));
      } else {
        const f = item; f.name = name;
        const saved = Store.saveCustomFood(f);
        closeSheet(); toast(`Food “${name}” added`); addTab = 'mine';
        goto('add'); $$('#addTabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'mine')); renderAdd();
        openFoodSheet(saved);
      }
    });
  }

  // Incoming share link: #share=… in the URL
  function checkIncomingShare() {
    const m = location.hash.match(/#share=([^&]+)/);
    if (!m) return;
    const code = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search); // don't re-import on reload
    handleShareCode(code);
  }
  window.addEventListener('hashchange', checkIncomingShare);
  $('#importBtn').addEventListener('click', () => openImportSheet(''));

  /* ===================== LABEL READING (shared worker) ===================== */
  // 1.21.0: one text-recognition worker is kept for a few minutes after use, so a second label photo
  // doesn't pay the 1–3 s start-up again. It is closed after 3 idle minutes to give the memory back.
  let ocrWorkerP = null, ocrTimer = null;
  function ocrWorker() {
    clearTimeout(ocrTimer);
    if (!ocrWorkerP) {
      ocrWorkerP = (async () => {
        if (typeof Tesseract === 'undefined') await Sources.loadScript(CDN.tesseract);
        const w = await Tesseract.createWorker('eng', 1, {
          logger: (m) => {
            const bar = $('#ocrBar'), st = $('#ocrStatus');
            if (m.status === 'recognizing text') { if (bar) bar.style.width = Math.round(m.progress * 100) + '%'; if (st) st.textContent = 'Reading label… ' + Math.round(m.progress * 100) + '%'; }
            else if (st) st.textContent = m.status.replace(/_/g, ' ') + '…';
          }
        });
        await w.setParameters({ preserve_interword_spaces: '1' });
        return w;
      })();
      ocrWorkerP.catch(() => { ocrWorkerP = null; });
    }
    return ocrWorkerP;
  }
  function ocrIdle() {
    clearTimeout(ocrTimer);
    ocrTimer = setTimeout(() => { const p = ocrWorkerP; ocrWorkerP = null; if (p) p.then((w) => w.terminate()).catch(() => {}); }, 180000);
  }

  /* ===================== PROGRESS ===================== */
  function weekKeys(offset) {
    const today = new Date(); const dow = (today.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(today); monday.setDate(today.getDate() - dow + offset * 7);
    return Array.from({ length: 7 }, (_, i) => Nutrition.dateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  }
  async function renderProgress() {
    renderBurn(); // doesn't need the chart library, so it shows even offline
    if (typeof Chart === 'undefined') {
      try { await Sources.loadScript(CDN.chart); } catch (e) { $('#weekKpis').innerHTML = '<div class="inline-note">Charts need an internet connection the first time.</div>'; return; }
    }
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    Chart.defaults.color = col('--muted'); Chart.defaults.borderColor = col('--line'); Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

    const keys = weekKeys(weekOffset);
    const T = Store.state.targets;
    const days = keys.map((k) => Nutrition.sum(Store.entries(k)));
    const labels = keys.map((k) => { const [y, m, d] = k.split('-').map(Number); return fmtDateOpts(new Date(y, m - 1, d), { weekday: 'short' }); });
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
    }, [T.protein, T.carbs, T.fat]);
    renderWeight(col);
  }
  // Real daily burn (1.22.0): measured from the owner's own food log + weight trend. Only ever suggests a LOWER
  // calorie target (owner's rule), and only as a suggestion with Apply / Not now.
  // 'Not now' hides a suggestion for 7 days, unless it has since dropped by another 100 kcal.
  function burnSnoozed(sug, todayKey) {
    const dis = Store.state.burnDismissed;
    return !!(dis && Nutrition.daysBetween(dis.date, todayKey) < 7 && sug.kcal > dis.kcal - 100);
  }
  function renderBurn() {
    const box = $('#burnCard'); if (!box) return;
    const s = Store.state, T = s.targets, todayKey = Nutrition.dateKey(new Date());
    const r = Nutrition.realBurn(s.diary, s.weights, todayKey);
    const R = r.rules;
    if (!r.ready) {
      const bar = (n, of) => `<div class="bar"><i style="width:${Math.min(100, Math.round((n / of) * 100))}%"></i></div>`;
      const wNote = r.readings < R.minReadings ? `${r.readings} of ${R.minReadings}+ weigh-ins` : `weigh-ins span ${r.span} of ${R.minSpan} days`;
      box.innerHTML = `<p class="small muted" style="margin-top:0">Once there's enough data, this shows how many calories your body <b>actually</b> burns a day – worked out from what you've eaten and how your weight has really changed, not a formula.</p>
        <div class="burn-progress">
          <div class="row"><span>Days logged (last 4 weeks)</span><b>${Math.min(r.loggedDays, R.minDays)} / ${R.minDays}</b></div>${bar(r.loggedDays, R.minDays)}
          <div class="row"><span>Weigh-ins</span><b>${wNote}</b></div>${bar(r.readings < R.minReadings ? r.readings : r.span, r.readings < R.minReadings ? R.minReadings : R.minSpan)}
        </div>
        <p class="small muted">Weigh in at least a few times a week. Days with under ${fmt(R.minKcal)} kcal logged are left out, as they're probably not fully logged${r.skippedDays ? ` (${r.skippedDays} so far)` : ''}.</p>`;
      return;
    }
    const calc = Nutrition.calcTargets(Object.assign({}, s.profile, { weightKg: (Store.latestWeight() || {}).kg || s.profile.weightKg }), T);
    const burn = Math.round(r.burn / 10) * 10;
    const eaten = Math.round(r.intake / 10) * 10;
    const deficit = burn - eaten; // same rounding as the two figures shown, so the three always add up
    const wk = r.kgPerWeek;
    const trend = Math.abs(wk) < 0.05 ? 'steady' : `${wk < 0 ? 'down' : 'up'} ${fmt(Math.abs(wk), 2)} kg a week`;
    const dShort = (k) => { const [y, m, d] = k.split('-').map(Number); return fmtDateOpts(new Date(y, m - 1, d), { day: 'numeric', month: 'short' }); };
    const period = `${r.loggedDays} logged days, ${dShort(r.firstDate)} – ${dShort(r.lastDate)} · weight trend ${trend} (${r.readings} weigh-ins)`;
    const facts = (withBurn) => `<div class="burn-facts">
        ${withBurn ? `<div class="kpi burn-main"><b>${fmt(burn)}</b><small>real burn / day</small></div>` : ''}
        <div class="kpi"><b>${fmt(eaten)}</b><small>avg eaten / day</small></div>
        ${withBurn ? `<div class="kpi ${deficit >= 0 ? 'good' : ''}"><b>${fmt(Math.abs(deficit))}</b><small>avg ${deficit >= 0 ? 'deficit' : 'surplus'} / day</small></div>` : ''}
      </div><p class="small muted" style="margin:0">${period}</p>`;
    if (!r.reliable) {
      box.innerHTML = facts(false) + `<div class="inline-note">The numbers don't add up yet (they point to about ${fmt(burn)} kcal a day, which isn't realistic). This is usually a few meals not logged, or water-weight swings. Keep logging and weighing in – it settles down.</div>`;
      return;
    }
    const cmp = calc && calc.tdee ? (() => { const d = burn - Math.round(calc.tdee / 10) * 10; return `Formula estimate ${fmt(Math.round(calc.tdee / 10) * 10)} kcal – your real burn is ${Math.abs(d) < 50 ? 'about the same' : `${fmt(Math.abs(d))} kcal ${d > 0 ? 'higher' : 'lower'}`}.`; })() : '';
    const sug = Nutrition.burnSuggestion(r, s.profile.goal, T.kcal);
    const goal = Nutrition.GOALS[s.profile.goal] || Nutrition.GOALS.maintain;
    const snoozed = sug && burnSnoozed(sug, todayKey);
    let action = '';
    if (sug && !snoozed) {
      action = `<div class="burn-suggest"><p><b>Suggested target: ${fmt(sug.kcal)} kcal</b> – ${fmt(sug.drop)} less than your current ${fmt(T.kcal)}, to ${goal.label.replace(/^./, (c) => c.toLowerCase())} based on your real burn.</p>
        <div class="row-inline"><button class="btn primary small" id="burnApply">Apply</button><button class="btn ghost small" id="burnLater">Not now</button></div></div>`;
    } else if (!sug) {
      action = `<div class="burn-ok">✓ Your target of ${fmt(T.kcal)} kcal suits your goal (${goal.label.replace(/^./, (c) => c.toLowerCase())}) – no change needed.</div>`;
    }
    box.innerHTML = `<p class="small muted" style="margin-top:0">Measured from your last 4 weeks: what you ate, and how your weight trend actually moved.</p>
      ${facts(true)}
      ${cmp ? `<p class="small muted">${cmp}</p>` : ''}${action}
      <p class="small muted" style="margin-bottom:0">Updates as you log. Water and salt can move it a little week to week. It will never suggest eating more.</p>`;
    if ($('#burnApply')) $('#burnApply').addEventListener('click', () => {
      const wasAuto = T.auto;
      T.kcal = sug.kcal; T.auto = false; s.burnDismissed = null;
      applyMacros();
      toast(`Target lowered to ${fmt(sug.kcal)} kcal – macros rescaled.${wasAuto ? ' Calories from profile switched off so the formula doesn’t raise it again.' : ''}`, 4500);
      renderProgress();
    });
    if ($('#burnLater')) $('#burnLater').addEventListener('click', () => {
      s.burnDismissed = { kcal: sug.kcal, date: todayKey }; Store.save();
      toast('OK – I’ll only mention it again in a week, or sooner if it drops further.', 3000);
      renderBurn();
    });
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
    const fmtD = (k) => { const [y, m, d] = k.split('-').map(Number); return fmtDateOpts(new Date(y, m - 1, d), { day: 'numeric', month: 'short' }); };
    const startKg = s.profile.startWeightKg || (s.weights[0] && s.weights[0].kg) || null;
    const change = startKg && latest ? Math.round((latest.kg - startKg) * 10) / 10 : null;
    const b = Nutrition.bmi(latest && latest.kg, s.profile.heightCm);
    const trend = change === null ? '' : change < 0 ? 'good' : change > 0 ? 'bad' : '';
    $('#weightKpis').innerHTML = `<div class="ktitle">Recorded <small>your logged weights</small></div><table class="ftable recorded">
      <thead><tr><th></th><th>Start kg</th><th>Now kg</th><th>Kg since start</th></tr></thead>
      <tbody><tr><td><i class="solid"></i>Recorded</td><td>${startKg ? fmt(startKg, 1) : '—'}${s.profile.startDate ? `<small>${fmtD(s.profile.startDate)}</small>` : ''}</td><td>${latest ? fmt(latest.kg, 1) : '—'}${latest ? `<small>BMI ${b ?? '—'} · ${fmtD(latest.date)}</small>` : ''}</td><td class="${trend}">${change === null ? '—' : (change > 0 ? '+' : '') + fmt(change, 1)}</td></tr></tbody>
    </table>`;
    if (b) {
      const h = s.profile.heightCm, m2 = (h / 100) ** 2, kg = latest.kg;
      const LO = 12, HI = 40, pct = (v) => Math.max(0, Math.min(100, ((v - LO) / (HI - LO)) * 100));
      const kgAt = (bmiV) => Math.round(bmiV * m2 * 10) / 10;
      const targetBmi = s.profile.targetBmi || 24.9;
      const targetKg = kgAt(targetBmi);
      const msg = bmiTargetMessage(kg, s.profile);
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
    const hasProfile = !!(s.profile.age && s.profile.heightCm);
    const baseKg = Nutrition.smoothedWeight(s.weights, todayKey);
    let plan = [], actual = [], intake = null, keyHtml = '';
    const targetKgLine = s.profile.heightCm ? Math.round((s.profile.targetBmi || 24.9) * (s.profile.heightCm / 100) ** 2 * 10) / 10 : null;
    // The Forecast switch only shows/hides the projected lines on the chart; the summary table below always shows (1.18.0).
    if (hasProfile && baseKg) {
      plan = Nutrition.projectWeight(baseKg, s.profile, s.targets.kcal, todayKey, 30);
      intake = Nutrition.averageIntake(s.diary, todayKey, 14);
      if (intake) actual = Nutrition.projectWeight(baseKg, s.profile, intake.kcal, todayKey, 30);
      const endPlan = plan[plan.length - 1], endAct = actual.length ? actual[actual.length - 1] : null;
      const d = (a, b) => { const v = Math.round((b - a) * 10) / 10; return (v > 0 ? '+' : '') + fmt(v, 1); };
      const when = (kcal) => {
        if (!targetKgLine) return '—';
        const days = Nutrition.daysToTarget(baseKg, s.profile, kcal, targetKgLine, 730);
        if (days === 0) return 'Already there';
        if (days === null) return '<span class="muted">Not at this pace</span>';
        return `${fmtD(Nutrition.addDays(todayKey, days))}<small>${Nutrition.durationLabel(days)}</small>`;
      };
      const tBmi = s.profile.targetBmi || 24.9;
      const targetCell = targetKgLine ? `${tBmi}<small>${fmt(targetKgLine, 1)} kg</small>` : '<span class="muted">Set height in Me</span>';
      const row = (cls, name, kcal, target, date) => `<tr><td><i class="${cls}"></i>${name}</td><td>${kcal}</td><td>${target}</td><td>${date}</td></tr>`;
      keyHtml = `<div class="ktitle">Forecast</div><table class="ftable">
        <thead><tr><th></th><th>Daily kcal</th><th>Target BMI</th><th>Forecast date</th></tr></thead>
        <tbody>
          ${row('dashed', 'Plan intake', fmt(s.targets.kcal), targetCell, when(s.targets.kcal))}
          ${endAct ? row('dotted', 'Avg intake', `${fmt(intake.kcal)}<small>${intake.days}-day avg</small>`, targetCell, when(intake.kcal))
                   : row('dotted', 'Avg intake', '<span class="muted">—</span>', targetCell, '<span class="muted">Log food on 3 days</span>')}
        </tbody></table>
        <p class="ftable-note">Plan intake = eating your calorie target every day.<br>Avg intake = your recent average of what you've logged.</p>`;
    } else if (!hasProfile) keyHtml = '<p class="ftable-note">Add your age and height in <b>Me</b> to see a forecast.</p>';
    else if (!baseKg) keyHtml = '<p class="ftable-note">Log a weight to see a forecast.</p>';
    $('#forecastKey').innerHTML = keyHtml;

    // Shared date axis: past readings, then forecast dates
    const dates = pts.map((p) => p.date);
    const chartPlan = showF ? plan : [], chartActual = showF ? actual : [];
    const fDates = chartPlan.map((p) => p.date).filter((dk) => !dates.includes(dk));
    const axis = [...dates, ...fDates];
    const series = (arr) => axis.map((dk) => { const hit = arr.find((p) => p.date === dk); return hit ? hit.kg : null; });
    const todayIdx = axis.indexOf(todayKey);
    const datasets = [{ label: 'Recorded', data: series(pts), borderColor: col('--accent'), backgroundColor: col('--accent-soft'), fill: true, tension: 0.35, pointRadius: pts.length > 30 ? 0 : 3, pointBackgroundColor: col('--accent'), borderWidth: 2, spanGaps: true, order: 1 }];
    if (chartPlan.length) datasets.push({ label: 'Plan intake', data: series(chartPlan), borderColor: col('--protein'), borderDash: [7, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.2, spanGaps: true, order: 2 });
    if (chartActual.length) datasets.push({ label: 'Avg intake', data: series(chartActual), borderColor: col('--carbs'), borderDash: [2, 4], borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0.2, spanGaps: true, order: 3 });
    if (targetKgLine && chartPlan.length) datasets.push({ label: 'Target weight', data: axis.map(() => targetKgLine), borderColor: col('--muted'), borderDash: [1, 3], borderWidth: 1, pointRadius: 0, fill: false, order: 4 });
    draw('weightChart', {
      type: 'line',
      data: { labels: axis.map(fmtD), datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { filter: (c) => c.raw !== null, callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw, 1)} kg` } },
          todayLine: { index: todayIdx, color: col('--muted'), show: chartPlan.length > 0 } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { ticks: { maxTicksLimit: 5, callback: (v) => v + ' kg' }, grace: '10%' } } },
      plugins: [{ id: 'todayLine', afterDraw(chart, args, opts) {
        if (opts.index === undefined || opts.index < 0 || !opts.show) return;
        const x = chart.scales.x.getPixelForValue(opts.index), { top, bottom } = chart.chartArea, ctx = chart.ctx;
        ctx.save(); ctx.strokeStyle = opts.color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.fillStyle = opts.color; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('today', x, top + 10); ctx.restore();
      } }]
    });
  }
  // 1.21.0: charts are created once and then updated in place (no redraw at all if nothing changed),
  // instead of being thrown away and rebuilt on every visit to Progress.
  const chartSig = {};
  function draw(id, cfg, extra) {
    const sig = JSON.stringify([cfg.type, cfg.data, cfg.options, extra === undefined ? null : extra]);
    const ch = charts[id];
    if (ch && ch.canvas === $('#' + id) && ch.config.type === cfg.type) {
      if (chartSig[id] === sig) return;
      ch.data = cfg.data; ch.options = cfg.options;
      ch.update('none');
    } else {
      if (ch) ch.destroy();
      charts[id] = new Chart($('#' + id).getContext('2d'), cfg);
    }
    chartSig[id] = sig;
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
    renderBackupExtras();
    const s = Store.state, p = s.profile, T = s.targets;
    const fill = (sel, obj) => { $(sel).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''); };
    fill('#pActivity', Nutrition.ACTIVITY); fill('#pGoal', Nutrition.GOALS);
    $('#pSex').value = p.sex; $('#pAge').value = p.age ?? ''; $('#pHeight').value = p.heightCm ?? ''; $('#pActivity').value = p.activity; $('#pGoal').value = p.goal;
    const locked = !!p.startWeightKg;
    $('#pWeight').value = p.startWeightKg ?? ''; $('#pWeight').disabled = locked; $('#pWeight').placeholder = 'kg';
    const latest = Store.latestWeight();
    const fmtDate = (k) => { const [y, m, d] = k.split('-').map(Number); return fmtDateOpts(new Date(y, m - 1, d), { day: 'numeric', month: 'short' }); };
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
  // Backup card extras (1.20.0): is storage protected from being cleared, and downloads of the safety copies.
  async function renderBackupExtras() {
    const box = $('#backupExtras'); if (!box) return;
    const prot = await Store.storageProtected();
    const up = await Store.safetyCopy('upgrade'), rs = await Store.safetyCopy('restore');
    const wk = await Store.safetyCopy('weekly'), wp = await Store.safetyCopy('weekly-prev');
    const when = (x) => fmtDateOpts(new Date(x.savedAt), { day: 'numeric', month: 'short', year: 'numeric' });
    const lb = Store.state.lastBackupAt;
    const age = lb ? Nutrition.daysBetween(Nutrition.dateKey(new Date(lb)), Nutrition.dateKey(new Date())) : null;
    box.innerHTML = `<p class="small last-backup"><b>${lb ? `Last backup: ${when({ savedAt: lb })} (${age === 0 ? 'today' : age === 1 ? 'yesterday' : age + ' days ago'})` : 'No backup recorded on this phone yet'}</b>${lb && age >= 7 ? ' – time for a new one' : ''}</p>
      <p class="small muted">The app also keeps an automatic copy on this phone each week (the last two). It helps if something goes wrong in the app, but not if the phone is lost – that's what your backup file is for.</p>
      ${wk ? `<button class="link-btn" id="dlWeekly">Download this week's automatic copy (${when(wk)})</button>` : ''}
      ${wp ? `<button class="link-btn" id="dlWeeklyPrev">Download the previous automatic copy (${when(wp)})</button>` : ''}
      <p class="small muted">${prot === true ? '🔒 Storage protected – the phone won’t clear this app’s data to free up space.' : prot === false ? 'Storage not yet protected – the phone could clear this app’s data if it runs very low on space, so keep regular backups.' : ''}</p>
      ${up ? `<button class="link-btn" id="dlUpgrade">Download the copy saved before the 1.20 upgrade (${when(up)})</button>` : ''}
      ${rs ? `<button class="link-btn" id="dlRestore">Download the copy saved before your last restore (${when(rs)})</button>` : ''}`;
    const dl = async (which, label) => {
      const c = await Store.safetyCopy(which); if (!c) return;
      const data = JSON.parse(c.data); const photos = {};
      const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); for (const k in o) { const v = o[k]; if (k === 'image' && typeof v === 'string' && v.startsWith('photo:')) { const src = Store.photoSrc(v); if (src) photos[v.slice(6)] = src; } else if (v && typeof v === 'object') walk(v); } };
      walk(data);
      const json = JSON.stringify({ app: 'FoodDiary', format: 2, exportedAt: c.savedAt, data, photos }, null, 1);
      await shareOrDownload(json, `FoodDiary-${label}-${c.savedAt.slice(0, 10)}.json`);
    };
    if ($('#dlUpgrade')) $('#dlUpgrade').addEventListener('click', () => dl('upgrade', 'before-1.20-upgrade'));
    if ($('#dlRestore')) $('#dlRestore').addEventListener('click', () => dl('restore', 'before-restore'));
    if ($('#dlWeekly')) $('#dlWeekly').addEventListener('click', () => dl('weekly', 'weekly-copy'));
    if ($('#dlWeeklyPrev')) $('#dlWeeklyPrev').addEventListener('click', () => dl('weekly-prev', 'weekly-copy'));
  }
  // Returns true if the file was handed over (share sheet completed, or downloaded); false if cancelled.
  async function shareOrDownload(json, name) {
    const blob = new Blob([json], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'FoodDiary backup' }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Backup downloaded');
    return true;
  }
  // 1.23.0: remembers when a backup was last made (drives the Today reminder and the line in Me → Backup).
  async function doBackup() {
    await Store.flush();
    const ok = await shareOrDownload(Store.exportJSON(), `FoodDiary-backup-${Nutrition.dateKey(new Date())}.json`);
    if (ok) { Store.state.lastBackupAt = new Date().toISOString(); Store.state.backupSnoozeUntil = null; Store.save(); }
    renderTodayNotes();
    if ($('#view-me').classList.contains('active')) renderBackupExtras();
    return ok;
  }
  $('#backupBtn').addEventListener('click', () => doBackup());
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('Restore this backup? It will replace the diary, foods and settings on this device.')) { e.target.value = ''; return; }
    try { const c = await Store.importJSON(await file.text()); toast(`Backup restored – ${c.entries} diary entries, ${c.recipes} recipes, ${c.uniquePhotos} photos`, 4000); renderMe(); renderToday(); }
    catch (err) { toast('Restore failed: ' + err.message, 4000); }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', async () => { if (confirm('Erase all diary entries, foods, photos and settings on this device?')) { await Store.reset(); renderMe(); renderToday(); toast('Erased'); } });

  /* ===================== Sheet backdrop / init ===================== */
  $('.sheet-backdrop').addEventListener('click', () => closeSheet());

  /* ===================== Auto-update ===================== */
  let swReg = null, hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller), lastCheck = 0;
  async function setupUpdates() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return; // no offline/update features in local preview
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

  function showUpgradeNotice(res) {
    const c = res.after || {};
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    openSheet(`<div class="sheet-title"><h2>Data upgraded ✓</h2></div>
      <p>Everything checked out after moving to the new storage:</p>
      <ul class="upgrade-list">
        <li>${pl(c.entries || 0, 'diary entry').replace('entrys', 'entries')} across ${pl(c.days || 0, 'day')}</li>
        <li>${pl(c.recipes || 0, 'recipe')} · ${pl(c.customFoods || 0, 'custom food')}</li>
        <li>${pl(c.weights || 0, 'weight reading')}</li>
        <li>${c.uniquePhotos ? `${pl(c.uniquePhotos, 'photo')} now stored once (${c.photoCopies === c.uniquePhotos ? 'no duplicates' : `previously saved ${c.photoCopies} times`})` : 'No photos needed moving'}</li>
      </ul>
      <p class="small muted">A copy of your data from before the upgrade is kept on this phone – Me → Backup.</p>
      <div class="sheet-actions"><button class="btn primary" id="upOk">OK</button></div>`);
    $('#upOk').addEventListener('click', () => closeSheet());
  }

  async function init() {
    Sources.loadCofid().then((n) => { if (n && $('#view-add').classList.contains('active')) renderAdd(); });
    renderToday(); // draw straight away; stored photos appear as soon as they're loaded (a few ms)
    // One-time data upgrade (1.20.0). It runs on a copy, then applies the same photo change to the live data,
    // so anything logged while it runs is kept either way.
    Store.upgrade().catch((e) => ({ upgraded: false, reason: String(e) })).then((res) => {
      if ($('#view-today').classList.contains('active')) renderToday();
      if (res && res.upgraded) showUpgradeNotice(res);
      return Store.weeklyCopy(); // automatic weekly copy on the phone (1.23.0), after any upgrade
    });
    Store.protectStorage();
    setTimeout(checkIncomingShare, 0);
    setupUpdates();
    // Recalculate "Today" when the app returns to foreground (date may have changed)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { const t = Nutrition.dateKey(new Date()); if (currentDate !== t && dateLabel(currentDate) === 'Yesterday') currentDate = t; if ($('#view-today').classList.contains('active')) renderToday(); } });
  }
  init();

  return { toast, goto, openFoodSheet };
})();
