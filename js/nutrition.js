/* FoodDiary — pure nutrition helpers (no DOM). Also loadable in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Nutrition = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round = (n, dp = 0) => {
    if (n === null || n === undefined || Number.isNaN(n)) return null;
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
  };

  /* ---------- Targets (Mifflin-St Jeor) ---------- */
  const ACTIVITY = {
    sedentary: { label: 'Mostly sitting', factor: 1.2 },
    light: { label: 'Lightly active', factor: 1.375 },
    moderate: { label: 'Moderately active', factor: 1.55 },
    active: { label: 'Very active', factor: 1.725 },
    athlete: { label: 'Extremely active', factor: 1.9 }
  };
  const GOALS = {
    lose2: { label: 'Lose ~1 kg / week', delta: -1000 },
    lose1: { label: 'Lose ~0.5 kg / week', delta: -500 },
    lose05: { label: 'Lose ~0.25 kg / week', delta: -250 },
    maintain: { label: 'Maintain weight', delta: 0 },
    gain05: { label: 'Gain ~0.25 kg / week', delta: 250 },
    gain1: { label: 'Gain ~0.5 kg / week', delta: 500 }
  };

  function bmr({ sex, weightKg, heightCm, age }) {
    if (!weightKg || !heightCm || !age) return null;
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === 'female' ? base - 161 : base + 5;
  }

  /* ---------- Macro presets ---------- */
  // Shares are fractions of total calories. Keto fixes carbs in grams instead.
  const PRESETS = {
    lowcarb: { label: 'Low carb', desc: '35% protein · 20% carbs · 45% fat', protein: 0.35, carbs: 0.20, fat: 0.45 },
    balanced: { label: 'Balanced', desc: '30% protein · 40% carbs · 30% fat', protein: 0.30, carbs: 0.40, fat: 0.30 },
    keto: { label: 'Keto', desc: 'Carbs capped in grams · 25% protein · rest fat', protein: 0.25, carbsG: 25 }
  };

  // Grams of protein/carbs/fat for a calorie target, from a preset or an explicit split.
  function macrosFor(kcal, presetKey, { ketoCarbs = 25, split = null } = {}) {
    kcal = Math.max(0, kcal || 0);
    if (presetKey === 'keto' && !split) {
      const carbs = Math.round(ketoCarbs);
      const protein = Math.round((kcal * PRESETS.keto.protein) / 4);
      const fat = Math.max(0, Math.round((kcal - carbs * 4 - protein * 4) / 9));
      return { protein, carbs, fat };
    }
    const p = split || PRESETS[presetKey] || PRESETS.lowcarb;
    return { protein: Math.round((kcal * p.protein) / 4), carbs: Math.round((kcal * p.carbs) / 4), fat: Math.round((kcal * p.fat) / 9) };
  }

  // Current calorie split of a set of gram targets.
  function splitOf(t) {
    const total = (t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9;
    if (!total) return { protein: PRESETS.lowcarb.protein, carbs: PRESETS.lowcarb.carbs, fat: PRESETS.lowcarb.fat };
    return { protein: (t.protein * 4) / total, carbs: (t.carbs * 4) / total, fat: (t.fat * 9) / total };
  }

  // Calories implied by gram targets.
  const kcalOfMacros = (t) => Math.round((t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9);

  // After the user edits one macro by hand: keep it, and scale the other two so the total still matches kcal.
  function rebalance(t, changedKey, kcal) {
    const per = { protein: 4, carbs: 4, fat: 9 };
    const others = ['protein', 'carbs', 'fat'].filter((k) => k !== changedKey);
    const remaining = Math.max(0, kcal - (t[changedKey] || 0) * per[changedKey]);
    const otherKcal = others.reduce((a, k) => a + (t[k] || 0) * per[k], 0);
    const out = Object.assign({}, t);
    if (otherKcal <= 0) {
      // nothing to scale: split the remainder evenly by calories
      others.forEach((k) => { out[k] = Math.round(remaining / 2 / per[k]); });
    } else {
      others.forEach((k) => { out[k] = Math.round(((t[k] || 0) * per[k] * (remaining / otherKcal)) / per[k]); });
    }
    return out;
  }

  // Calorie target from profile (Mifflin-St Jeor + activity + goal). Macros come from macrosFor().
  function calcTargets(profile, targets = {}) {
    const b = bmr(profile);
    if (b === null) return null;
    const act = (ACTIVITY[profile.activity] || ACTIVITY.light).factor;
    const goal = GOALS[profile.goal] || GOALS.maintain;
    const tdee = b * act;
    const kcal = Math.max(1200, Math.round((tdee + goal.delta) / 10) * 10);
    const preset = targets.preset && targets.preset !== 'custom' ? targets.preset : 'lowcarb';
    const split = targets.preset === 'custom' ? splitOf(targets) : null;
    const m = macrosFor(kcal, preset, { ketoCarbs: targets.ketoCarbs, split });
    return Object.assign({ kcal, bmr: Math.round(b), tdee: Math.round(tdee) }, m);
  }

  /* ---------- Healthy weight ---------- */
  function healthyWeightRange(heightCm) {
    if (!heightCm) return null;
    const m2 = (heightCm / 100) ** 2;
    return { min: round(18.5 * m2, 1), max: round(24.9 * m2, 1), mid: round(22 * m2, 1) };
  }

  function bmi(weightKg, heightCm) {
    if (!weightKg || !heightCm) return null;
    const m = heightCm / 100;
    return round(weightKg / (m * m), 1);
  }

  function bmiCategory(v) {
    if (v === null || v === undefined) return '';
    if (v < 18.5) return 'Underweight';
    if (v < 25) return 'Healthy';
    if (v < 30) return 'Overweight';
    return 'Obese';
  }

  /* ---------- Scaling ---------- */
  // food: { kcal, protein, carbs, fat } per 100 g/ml. grams: amount.
  function scale(food, grams) {
    const f = (grams || 0) / 100;
    return {
      kcal: round((food.kcal || 0) * f, 0),
      protein: round((food.protein || 0) * f, 1),
      carbs: round((food.carbs || 0) * f, 1),
      fat: round((food.fat || 0) * f, 1)
    };
  }

  function scaleExact(food, grams) {
    const f = (grams || 0) / 100;
    return { kcal: (food.kcal || 0) * f, protein: (food.protein || 0) * f, carbs: (food.carbs || 0) * f, fat: (food.fat || 0) * f };
  }

  function sum(items) {
    return items.reduce(
      (a, e) => ({
        kcal: a.kcal + (e.kcal || 0),
        protein: a.protein + (e.protein || 0),
        carbs: a.carbs + (e.carbs || 0),
        fat: a.fat + (e.fat || 0)
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }

  /* ---------- Open Food Facts product -> food ---------- */
  function fromOFF(p) {
    if (!p) return null;
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal === null && num(n['energy-kj_100g']) !== null) kcal = num(n['energy-kj_100g']) / 4.184;
    if (kcal === null && num(n['energy_100g']) !== null) {
      // energy_100g is usually kJ
      const e = num(n['energy_100g']);
      kcal = n['energy_unit'] === 'kcal' ? e : e / 4.184;
    }
    const name = p.product_name_en || p.product_name || p.generic_name_en || p.generic_name || '';
    const quantity = p.quantity || '';
    const servingG = num(p.serving_quantity);
    return {
      id: 'off:' + p.code,
      source: 'off',
      barcode: p.code,
      name: name.trim(),
      brand: (p.brands || '').split(',')[0].trim(),
      quantity,
      servingG: servingG || null,
      servingLabel: p.serving_size || null,
      image: p.image_front_small_url || p.image_front_url || p.image_url || null,
      imageLarge: p.image_front_url || p.image_url || null,
      kcal: kcal === null ? null : round(kcal, 0),
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
      sugars: num(n.sugars_100g),
      satFat: num(n['saturated-fat_100g']),
      fibre: num(n.fiber_100g),
      salt: num(n.salt_100g),
      complete: kcal !== null && num(n.proteins_100g) !== null && num(n.carbohydrates_100g) !== null && num(n.fat_100g) !== null
    };
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  /* ---------- CoFID parsing (from SheetJS rows: array of arrays) ---------- */
  // Returns array of { id, source:'cofid', code, name, group, kcal, protein, carbs, fat }
  function parseCofidRows(rows) {
    if (!rows || !rows.length) return [];
    const lower = (v) => String(v === null || v === undefined ? '' : v).trim().toLowerCase();
    // Locate header rows within the first 6 rows.
    let headerIdx = -1, abbrIdx = -1;
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const cells = (rows[r] || []).map(lower);
      if (headerIdx < 0 && cells.some((c) => c === 'food code')) headerIdx = r;
      if (abbrIdx < 0 && cells.some((c) => c === 'kcals' || c === 'prot') ) abbrIdx = r;
    }
    const header = headerIdx >= 0 ? rows[headerIdx].map(lower) : [];
    const abbr = abbrIdx >= 0 ? rows[abbrIdx].map(lower) : [];
    const findCol = (abbrevs, nameRegex) => {
      for (const a of abbrevs) { const i = abbr.indexOf(a); if (i >= 0) return i; }
      for (let i = 0; i < header.length; i++) if (nameRegex.test(header[i])) return i;
      return -1;
    };
    const cCode = findCol(['food code'], /^food code/);
    const cName = findCol(['name', 'food name'], /^food name/);
    const cGroup = findCol(['group'], /^group$/);
    const cProt = findCol(['prot'], /^protein/);
    const cFat = findCol(['fat'], /^fat\b/);
    const cCho = findCol(['cho'], /^carbohydrate/);
    const cKcal = findCol(['kcals'], /energy.*kcal/);
    const cKj = findCol(['kj'], /energy.*kj/);
    const cSug = findCol(['totsug'], /^total sugars/);
    const cFib = findCol(['aoacfib'], /aoac/);
    const cSat = findCol(['satfod'], /^satd fa.*food|^saturated.*food/);
    if (cName < 0 || cKcal < 0 && cKj < 0) return [];
    const start = Math.max(headerIdx, abbrIdx) + 1;
    const out = [];
    for (let r = start; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = String(row[cName] || '').trim();
      if (!name) continue;
      let kcal = cofidNum(row[cKcal]);
      if (kcal === null && cKj >= 0) { const kj = cofidNum(row[cKj]); kcal = kj === null ? null : kj / 4.184; }
      if (kcal === null) continue;
      out.push({
        id: 'cofid:' + (row[cCode] || r),
        source: 'cofid',
        code: String(row[cCode] || ''),
        name,
        group: String(row[cGroup] || ''),
        kcal: round(kcal, 0),
        protein: cofidNum(row[cProt]) ?? 0,
        carbs: cofidNum(row[cCho]) ?? 0,
        fat: cofidNum(row[cFat]) ?? 0,
        sugars: cSug >= 0 ? cofidNum(row[cSug]) : null,
        fibre: cFib >= 0 ? cofidNum(row[cFib]) : null,
        satFat: cSat >= 0 ? cofidNum(row[cSat]) : null
      });
    }
    return out;
  }
  function cofidNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    if (s === '' || s === 'N') return null;
    if (s === 'Tr') return 0;
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  /* ---------- Nutrition label OCR text -> values per 100 g ---------- */
  // Parses typical UK back-of-pack tables. Returns { kcal, protein, carbs, fat, sugars, satFat, fibre, salt, servingG, confidence }
  function parseLabelText(text) {
    const t = String(text || '')
      .replace(/[|]/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[oO](?=\d)|(?<=\d)[oO]/g, '0')
      .replace(/(\d),(\d)/g, '$1.$2');
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // Which column is "per 100g"? Look at header line.
    let col100 = 0, colCount = 1;
    for (const l of lines) {
      const m = l.match(/per\s*100\s*(g|ml)|100\s*(g|ml)/i);
      if (m) {
        const headers = l.split(/\s{2,}|\t/).filter(Boolean).filter((h) => /\d+\s*(g|ml)|per|serving|portion/i.test(h));
        colCount = Math.max(1, headers.length);
        const idx = headers.findIndex((h) => /100\s*(g|ml)/i.test(h));
        col100 = idx < 0 ? 0 : idx;
        break;
      }
    }

    const numsIn = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const pick = (s) => {
      const ns = numsIn(s);
      if (!ns.length) return null;
      return ns[Math.min(col100, ns.length - 1)];
    };

    const res = { kcal: null, protein: null, carbs: null, fat: null, sugars: null, satFat: null, fibre: null, salt: null, servingG: null };
    let found = 0, kcalFromKj = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const low = l.toLowerCase();
      const rest = l.replace(/^[^\d]*/, '');
      if ((res.kcal === null || kcalFromKj) && /kcal/i.test(l)) {
        // "Energy 1046kJ / 250kcal" or "... 250 kcal"
        const m = l.match(/(\d+(?:\.\d+)?)\s*kcal/gi);
        if (m) {
          const vals = m.map((x) => parseFloat(x));
          res.kcal = vals[Math.min(col100, vals.length - 1)];
          if (!kcalFromKj) found++;
          kcalFromKj = false;
        }
      } else if (res.kcal === null && /^energy/i.test(low) && /kj/i.test(low)) {
        const m = l.match(/(\d+(?:\.\d+)?)\s*kj/gi);
        if (m) { const v = parseFloat(m[Math.min(col100, m.length - 1)]); res.kcal = Math.round(v / 4.184); kcalFromKj = true; found++; }
      }
      if (/^fat\b/.test(low) || /^total fat/.test(low)) { const v = pick(rest); if (v !== null && res.fat === null) { res.fat = v; found++; } }
      else if (/saturat/.test(low)) { const v = pick(rest); if (v !== null && res.satFat === null) res.satFat = v; }
      else if (/carbohydrat/.test(low)) { const v = pick(rest); if (v !== null && res.carbs === null) { res.carbs = v; found++; } }
      else if (/sugars?/.test(low)) { const v = pick(rest); if (v !== null && res.sugars === null) res.sugars = v; }
      else if (/fibre|fiber/.test(low)) { const v = pick(rest); if (v !== null && res.fibre === null) res.fibre = v; }
      else if (/^protein/.test(low)) { const v = pick(rest); if (v !== null && res.protein === null) { res.protein = v; found++; } }
      else if (/^salt/.test(low)) { const v = pick(rest); if (v !== null && res.salt === null) res.salt = v; }
      else if (/^sodium/.test(low) && res.salt === null) { const v = pick(rest); if (v !== null) res.salt = round(v * 2.5 / (v > 10 ? 1000 : 1), 2); }
      if (res.servingG === null) {
        for (const m of l.matchAll(/(?:per|serving|portion)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)) {
          const v = parseFloat(m[1]);
          if (v !== 100) { res.servingG = v; break; }
        }
      }
    }
    // Sanity: a kcal line often includes kJ first; if kcal looks like a kJ value, convert.
    if (res.kcal !== null && res.kcal > 900 && res.fat !== null) res.kcal = Math.round(res.kcal / 4.184);
    res.confidence = found / 4;
    return res;
  }


  /* ---------- Weight forecast ---------- */
  const KCAL_PER_KG = 7700;

  // Smoothed starting weight: mean of readings in the last 7 days (falls back to the latest reading).
  function smoothedWeight(weights, todayKey) {
    if (!weights || !weights.length) return null;
    const from = addDays(todayKey, -6);
    const recent = weights.filter((w) => w.date >= from && w.date <= todayKey);
    const use = recent.length ? recent : [weights[weights.length - 1]];
    return use.reduce((a, w) => a + w.kg, 0) / use.length;
  }

  // Average logged kcal over the last `days` days that have at least one entry (today excluded as it may be incomplete).
  function averageIntake(diary, todayKey, days = 14) {
    let total = 0, n = 0;
    for (let i = 1; i <= days; i++) {
      const k = addDays(todayKey, -i);
      const list = diary[k];
      if (list && list.length) { total += list.reduce((a, e) => a + (e.kcal || 0), 0); n++; }
    }
    return n >= 3 ? { kcal: total / n, days: n } : null;
  }

  // Project weight forward `days` days given a daily calorie intake. Maintenance is re-derived each day
  // from the projected weight (so the curve flattens as weight falls). Returns [{ date, kg }].
  function projectWeight(startKg, profile, dailyKcal, todayKey, days = 30) {
    if (!startKg || !dailyKcal) return [];
    const act = (ACTIVITY[profile.activity] || ACTIVITY.light).factor;
    const out = [{ date: todayKey, kg: round(startKg, 2) }];
    let kg = startKg;
    for (let i = 1; i <= days; i++) {
      const b = bmr(Object.assign({}, profile, { weightKg: kg }));
      if (b === null) return [];
      const maintenance = b * act;
      kg += (dailyKcal - maintenance) / KCAL_PER_KG;
      out.push({ date: addDays(todayKey, i), kg: round(kg, 2) });
    }
    return out;
  }

  /* ---------- Dates ---------- */
  function dateKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear(), m = String(x.getMonth() + 1).padStart(2, '0'), day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return dateKey(dt);
  }

  return { ACTIVITY, GOALS, PRESETS, macrosFor, splitOf, kcalOfMacros, rebalance, healthyWeightRange, KCAL_PER_KG, smoothedWeight, averageIntake, projectWeight, bmr, calcTargets, bmi, bmiCategory, scale, scaleExact, sum, fromOFF, parseCofidRows, parseLabelText, dateKey, addDays, round, num };
});
