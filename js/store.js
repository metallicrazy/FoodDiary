/* FoodDiary — persistence. Small state in localStorage, large blobs (CoFID, photos) in IndexedDB. */
const Store = (() => {
  'use strict';
  const LS_KEY = 'fooddiary.v1';

  const defaults = () => ({
    version: 1,
    profile: { name: '', sex: 'male', age: null, heightCm: null, weightKg: null, activity: 'light', goal: 'maintain' },
    targets: { kcal: 2000, protein: 175, carbs: 100, fat: 100, auto: true, preset: 'lowcarb', ketoCarbs: 25 },
    diary: {},          // dateKey -> [entry]
    weights: [],        // [{ date, kg }]
    customFoods: [],    // [food]
    recipes: [],        // [{ id, name, servings, ingredients:[{foodSnapshot, grams}], per100: {...}, totalG }]
    favourites: [],     // [foodId]
    recents: [],        // [food snapshot] (max 30)
    cache: {},          // barcode -> food (OFF lookups)
    cofidLoadedAt: null,
    onboarded: false
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      const d = defaults();
      const merged = Object.assign(d, parsed);
      merged.targets = Object.assign(defaults().targets, parsed.targets || {});
      merged.profile = Object.assign(defaults().profile, parsed.profile || {});
      return merged;
    } catch (e) {
      console.warn('State load failed, starting fresh', e);
      return defaults();
    }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
      catch (e) { console.error('Save failed', e); if (typeof UI !== 'undefined' && UI.toast) UI.toast('Storage full – try removing product photos from custom foods'); }
    }, 50);
  }

  /* ---- IndexedDB key-value ---- */
  const DB_NAME = 'fooddiary', STORE = 'kv';
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function kvGet(key) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
      });
    } catch (e) { console.warn('kvGet', e); return undefined; }
  }
  async function kvSet(key, value) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      tx.onsuccess = () => res(true); tx.onerror = () => rej(tx.error);
    });
  }

  /* ---- Diary ---- */
  function entries(dateKey) { return state.diary[dateKey] || []; }
  function addEntry(dateKey, entry) {
    if (!state.diary[dateKey]) state.diary[dateKey] = [];
    entry.id = entry.id || uid();
    entry.time = entry.time || new Date().toISOString();
    state.diary[dateKey].push(entry);
    pushRecent(entry.food);
    save();
    return entry;
  }
  function updateEntry(dateKey, id, patch) {
    const e = entries(dateKey).find((x) => x.id === id);
    if (e) { Object.assign(e, patch); save(); }
    return e;
  }
  function removeEntry(dateKey, id) {
    state.diary[dateKey] = entries(dateKey).filter((x) => x.id !== id);
    if (!state.diary[dateKey].length) delete state.diary[dateKey];
    save();
  }

  /* ---- Recents / favourites ---- */
  function pushRecent(food) {
    if (!food) return;
    const slim = slimFood(food);
    state.recents = [slim, ...state.recents.filter((f) => f.id !== slim.id)].slice(0, 30);
    save();
  }
  function slimFood(f) {
    const { id, source, barcode, name, brand, quantity, servingG, servingLabel, image, kcal, protein, carbs, fat, sugars, satFat, fibre, salt } = f;
    return { id, source, barcode, name, brand, quantity, servingG, servingLabel, image, kcal, protein, carbs, fat, sugars, satFat, fibre, salt };
  }
  function toggleFavourite(food) {
    const i = state.favourites.findIndex((f) => f.id === food.id);
    if (i >= 0) state.favourites.splice(i, 1); else state.favourites.unshift(slimFood(food));
    save();
    return i < 0;
  }
  const isFavourite = (id) => state.favourites.some((f) => f.id === id);

  /* ---- Custom foods & recipes ---- */
  function saveCustomFood(food) {
    food.id = food.id || 'custom:' + uid();
    food.source = 'custom';
    const i = state.customFoods.findIndex((f) => f.id === food.id);
    if (i >= 0) state.customFoods[i] = food; else state.customFoods.unshift(food);
    save();
    return food;
  }
  function deleteCustomFood(id) { state.customFoods = state.customFoods.filter((f) => f.id !== id); save(); }
  function saveRecipe(r) {
    r.id = r.id || 'recipe:' + uid();
    const i = state.recipes.findIndex((x) => x.id === r.id);
    if (i >= 0) state.recipes[i] = r; else state.recipes.unshift(r);
    save();
    return r;
  }
  function deleteRecipe(id) { state.recipes = state.recipes.filter((f) => f.id !== id); save(); }

  /* ---- Weight ---- */
  function logWeight(dateKey, kg) {
    state.weights = state.weights.filter((w) => w.date !== dateKey);
    state.weights.push({ date: dateKey, kg });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    state.profile.weightKg = kg;
    save();
  }
  function latestWeight() { return state.weights.length ? state.weights[state.weights.length - 1] : null; }

  /* ---- Backup ---- */
  function exportJSON() {
    const copy = JSON.parse(JSON.stringify(state));
    delete copy.cache;
    return JSON.stringify({ app: 'FoodDiary', exportedAt: new Date().toISOString(), data: copy }, null, 1);
  }
  function importJSON(text) {
    const obj = JSON.parse(text);
    const data = obj && obj.app === 'FoodDiary' ? obj.data : obj;
    if (!data || !data.diary) throw new Error('Not a FoodDiary backup');
    state = Object.assign(defaults(), data);
    save();
  }
  function reset() { state = defaults(); save(); }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  return {
    get state() { return state; }, save, kvGet, kvSet,
    entries, addEntry, updateEntry, removeEntry,
    pushRecent, toggleFavourite, isFavourite, slimFood,
    saveCustomFood, deleteCustomFood, saveRecipe, deleteRecipe,
    logWeight, latestWeight, exportJSON, importJSON, reset, uid
  };
})();
