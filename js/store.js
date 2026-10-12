/* FoodDiary — persistence.
   The diary, foods, recipes and settings live in localStorage (one JSON document, ~1 MB per year of use).
   Photos (your custom food / recipe photos) live in IndexedDB, ONE copy each, keyed 'photo:<id>'; everything else
   refers to them as image: 'photo:<id>'. (Before 1.20.0 every diary entry carried its own full copy of the photo,
   which would fill localStorage's ~5 MB limit within months.) Safety copies and an imported CoFID file also live in IndexedDB. */
const Store = (() => {
  'use strict';
  const LS_KEY = 'fooddiary.v1';

  const DATA_VERSION = 2; // 2 = photos stored once in IndexedDB (1.20.0)
  const defaults = () => ({
    version: 1,
    dataVersion: DATA_VERSION,
    profile: { name: '', sex: 'male', age: null, heightCm: null, weightKg: null, activity: 'light', goal: 'maintain', targetBmi: 24.9, startWeightKg: null, startDate: null },
    targets: { kcal: 2000, protein: 175, carbs: 100, fat: 100, auto: true, preset: 'lowcarb', ketoCarbs: 25 },
    diary: {},          // dateKey -> [entry]
    weights: [],        // [{ date, kg }]
    customFoods: [],    // [food]
    recipes: [],        // [{ id, name, servings, ingredients:[{foodSnapshot, grams}], per100: {...}, totalG }]
    favourites: [],     // [foodId]
    recents: [],        // [food snapshot] (max 30)
    cache: {},          // barcode -> food (OFF lookups)
    cofidLoadedAt: null,
    showForecast: true,
    burnDismissed: null, // { kcal, date } — 'Not now' on a lower-target suggestion (1.22.0)
    recipeDraft: null,  // unsaved recipe being built/edited (auto-saved, 1.18.0)
    lastBackupAt: null,      // ISO time of the last 'Back up to file' that completed (1.23.0)
    backupSnoozeUntil: null, // dateKey — ✕ on the Today backup reminder hides it until then (1.23.0)
    picks: {},          // normalised search text -> food the user added for it last time (1.18.0)
    recipeCategories: [],    // [{ id, name }] user-made recipe categories, kept in A–Z order (1.25.0)
    recipeFilter: null,      // category id the Recipes tab opens on; null = All recipes (1.25.0)
    onboarded: false
  });

  let state = load();

  function normalise(parsed) {
    const merged = Object.assign(defaults(), parsed);
    delete merged.checkinDone; // Monday check-in removed in 1.24.0
    merged.targets = Object.assign(defaults().targets, parsed.targets || {});
    merged.profile = Object.assign(defaults().profile, parsed.profile || {});
    // Recipe categories (1.25.0): tidy up anything that points at a category that no longer exists.
    if (!Array.isArray(merged.recipeCategories)) merged.recipeCategories = [];
    const catIds = new Set(merged.recipeCategories.map((c) => c.id));
    for (const r of merged.recipes || []) if (r.categoryId && !catIds.has(r.categoryId)) delete r.categoryId;
    if (merged.recipeFilter && (merged.recipeFilter === 'none' ? !catIds.size : !catIds.has(merged.recipeFilter))) merged.recipeFilter = null; // 'none' = No category
    merged.dataVersion = parsed.dataVersion || 1; // data saved before 1.20.0 has no dataVersion
    if (!merged.profile.startWeightKg && merged.weights && merged.weights.length) { merged.profile.startWeightKg = merged.weights[0].kg; merged.profile.startDate = merged.weights[0].date; }
    return merged;
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaults();
      return normalise(JSON.parse(raw));
    } catch (e) {
      console.warn('State load failed, starting fresh', e);
      return defaults();
    }
  }

  // Write the whole document now. Returns true on success. Never throws.
  function writeNow() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; }
    catch (e) {
      console.error('Save failed', e);
      if (typeof UI !== 'undefined' && UI.toast) UI.toast('Couldn\u2019t save – phone storage is full. Make a backup now: Me → Back up to file.', 6000);
      return false;
    }
  }
  // Debounced save. Any photo that is still embedded (a new photo, or a restored old backup) is first stored once
  // in IndexedDB and replaced by a reference — only after it has been written AND read back successfully.
  // 1.21.0: `delay` lets busy-but-unimportant changes (the recipe draft, saved on every keystroke) wait until typing
  // pauses, so the whole diary isn't rewritten for each letter. An earlier deadline always wins, and everything
  // pending is written straight away when the app is hidden or closed (see the listeners below).
  let saveTimer = null, saveDue = 0, flushing = false, flushAgain = false;
  function save(delay = 50) {
    const due = Date.now() + delay;
    if (saveTimer && saveDue <= due) return;
    clearTimeout(saveTimer); saveDue = due;
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, delay);
  }
  function flushPending() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; flush(); } }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPending);
  }
  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (flushing) { flushAgain = true; return; }
    flushing = true;
    try {
      if (photosReady && hasInline(state)) { try { await externalise(state); } catch (e) { console.warn('Photo storage failed; keeping photos embedded for now', e); } }
      writeNow();
    } finally {
      flushing = false;
      if (flushAgain) { flushAgain = false; flush(); }
    }
  }

  /* ---- IndexedDB key-value ---- */
  const DB_NAME = 'fooddiary', STORE = 'kv';
  let dbPromise = null;
  function idb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); dbPromise = null; }; resolve(db); };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function kvGet(key) {
    try { const db = await idb(); return await reqP(db.transaction(STORE, 'readonly').objectStore(STORE).get(key)); }
    catch (e) { console.warn('kvGet', e); return undefined; }
  }
  async function kvSet(key, value) { const db = await idb(); await reqP(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)); return true; }
  async function kvDel(key) { const db = await idb(); await reqP(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key)); return true; }
  // All keys/values whose key starts with `prefix`
  async function kvPrefix(prefix) {
    const db = await idb();
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const st = db.transaction(STORE, 'readonly').objectStore(STORE);
    const [keys, values] = await Promise.all([reqP(st.getAllKeys(range)), reqP(st.getAll(range))]);
    return keys.map((k, i) => [k, values[i]]);
  }

  /* ---- Photos: stored once, referenced everywhere (1.20.0) ---- */
  const photoMem = new Map(); // id -> data URL (all photos are small 256 px JPEGs, so they're kept in memory for instant display)
  let photosReady = false;
  const isInline = (v) => typeof v === 'string' && v.startsWith('data:image');
  const isRef = (v) => typeof v === 'string' && v.startsWith('photo:');
  // Same picture → same id, so the hundreds of old copies collapse to one stored photo.
  function photoId(url) {
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0') + url.length.toString(36);
  }
  async function loadPhotos() {
    try { for (const [k, v] of await kvPrefix('photo:')) photoMem.set(k.slice(6), v); photosReady = true; }
    catch (e) { console.warn('Could not read photos', e); }
    return photoMem.size;
  }
  // Store one photo; resolves to its reference only after it has been written and read back intact.
  async function putPhoto(url) {
    const id = photoId(url);
    if (photoMem.get(id) === url) return 'photo:' + id;
    await kvSet('photo:' + id, url);
    if ((await kvGet('photo:' + id)) !== url) throw new Error('Photo did not save correctly');
    photoMem.set(id, url);
    return 'photo:' + id;
  }
  // What to put in <img src>: a stored photo's data, or a normal web address. null if a stored photo is missing.
  function photoSrc(v) { if (!v) return null; if (isRef(v)) return photoMem.get(v.slice(6)) || null; return v; }
  // Walk every `image` value anywhere in a data tree.
  function eachImage(obj, fn) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { for (const x of obj) eachImage(x, fn); return; }
    for (const k in obj) {
      const v = obj[k];
      if (k === 'image' && typeof v === 'string') { const r = fn(v); if (r !== undefined) obj[k] = r; }
      else if (v && typeof v === 'object') eachImage(v, fn);
    }
  }
  function hasInline(obj) { let found = false; eachImage(obj, (v) => { if (isInline(v)) found = true; }); return found; }
  // Store every embedded photo once and replace the copies with references. Returns Map(dataURL -> ref) of what was stored.
  async function externalise(obj) {
    const urls = new Set(); eachImage(obj, (v) => { if (isInline(v)) urls.add(v); });
    const map = new Map();
    for (const u of urls) map.set(u, await putPhoto(u));
    eachImage(obj, (v) => (map.has(v) ? map.get(v) : undefined));
    return map;
  }
  // The reverse (used to check the upgrade, and to undo it if anything looks wrong)
  function internalise(obj) { eachImage(obj, (v) => (isRef(v) && photoMem.has(v.slice(6)) ? photoMem.get(v.slice(6)) : undefined)); }
  function counts(s) {
    let entries = 0, photos = 0; const ids = new Set();
    for (const k in (s.diary || {})) entries += (s.diary[k] || []).length;
    eachImage(s, (v) => { if (isInline(v) || isRef(v)) { photos++; ids.add(isRef(v) ? v.slice(6) : photoId(v)); } });
    return { days: Object.keys(s.diary || {}).length, entries, recipes: (s.recipes || []).length, customFoods: (s.customFoods || []).length,
      weights: (s.weights || []).length, favourites: (s.favourites || []).length, recents: (s.recents || []).length, photoCopies: photos, uniquePhotos: ids.size };
  }
  const SAFETY_UPGRADE = 'safety:before-1.20', SAFETY_RESTORE = 'safety:before-restore';
  // Automatic weekly copy on the phone (1.23.0): taken on the first launch at least 7 days after the last one; the
  // previous week's copy is kept too, so a problem noticed a few days late can still be undone. ~2 × the diary size.
  const SAFETY_WEEKLY = 'safety:weekly', SAFETY_WEEKLY_PREV = 'safety:weekly-prev';
  async function weeklyCopy() {
    try {
      const cur = await kvGet(SAFETY_WEEKLY);
      if (cur && Date.now() - Date.parse(cur.savedAt) < 7 * 864e5) return false;
      // Copies what is already saved (no extra write at start-up; at most the last second of changes is left out).
      const json = localStorage.getItem(LS_KEY);
      if (!json) return false;
      if (cur) await kvSet(SAFETY_WEEKLY_PREV, cur);
      await putSafetyCopy(SAFETY_WEEKLY, json);
      return true;
    } catch (e) { console.warn('Weekly copy skipped', e); return false; }
  }
  async function putSafetyCopy(key, json) {
    await kvSet(key, { savedAt: new Date().toISOString(), data: json });
    const back = await kvGet(key);
    if (!back || back.data !== json) throw new Error('Safety copy did not save correctly');
  }

  // One-time upgrade of data saved before 1.20.0. Never leaves data half-changed:
  // 1) untouched safety copy  2) photos stored + read back  3) upgraded copy must turn back into the original exactly
  // 4) switch over  5) read back from storage and recount. Any failure → keep the existing data as it was; retry next launch.
  async function upgrade() {
    await loadPhotos();
    if (!photosReady) return { upgraded: false, reason: 'storage-unavailable' };
    if ((state.dataVersion || 1) >= DATA_VERSION) { if (hasInline(state)) save(); return { upgraded: false }; }
    const beforeJSON = JSON.stringify(state);
    const before = counts(state);
    try {
      if (!(await kvGet(SAFETY_UPGRADE))) await putSafetyCopy(SAFETY_UPGRADE, localStorage.getItem(LS_KEY) || beforeJSON);
      const copy = JSON.parse(beforeJSON);
      const map = await externalise(copy);
      const check = JSON.parse(JSON.stringify(copy)); internalise(check);
      if (JSON.stringify(check) !== beforeJSON) throw new Error('Upgraded data did not match the original');
      eachImage(state, (v) => (map.has(v) ? map.get(v) : undefined)); // same change, applied to the live data
      state.dataVersion = DATA_VERSION;
      if (!writeNow()) throw new Error('Could not save the upgraded data');
      const back = JSON.parse(localStorage.getItem(LS_KEY));
      const after = counts(back);
      const ok = ['days', 'entries', 'recipes', 'customFoods', 'weights', 'favourites', 'recents', 'photoCopies'].every((k) => after[k] >= before[k]);
      let missing = 0; eachImage(back, (v) => { if (isInline(v) || (isRef(v) && !photoMem.has(v.slice(6)))) missing++; });
      if (!ok || missing) throw new Error('Saved data did not check out');
      return { upgraded: true, before, after };
    } catch (e) {
      console.error('Upgrade postponed', e);
      internalise(state); // undo the photo change on the live data (keeps anything added meanwhile)
      state.dataVersion = 1;
      writeNow();
      return { upgraded: false, reason: String(e && e.message || e) };
    }
  }

  /* ---- Diary ---- */
  function entries(dateKey) { return state.diary[dateKey] || []; }
  function addEntry(dateKey, entry) {
    if (!state.diary[dateKey]) state.diary[dateKey] = [];
    entry.id = entry.id || uid();
    entry.time = entry.time || new Date().toISOString();
    state.diary[dateKey].push(entry);
    if (!entry.quick) pushRecent(entry.food); // quick-add entries (1.23.0) aren't foods to re-add
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
    const { id, source, barcode, name, cofidName, brand, quantity, servingG, servingLabel, image, kcal, protein, carbs, fat, sugars, satFat, fibre, salt, unitName, unitG } = f;
    return { id, source, barcode, name, cofidName, brand, quantity, servingG, servingLabel, image, kcal, protein, carbs, fat, sugars, satFat, fibre, salt, unitName, unitG };
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

  /* ---- Recipe categories (1.25.0). A recipe has at most one: recipe.categoryId. ---- */
  const sortCats = () => state.recipeCategories.sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }));
  const catByName = (name) => state.recipeCategories.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  // Returns the category (an existing one if the name is already used, ignoring case), or null for a blank name.
  function addRecipeCategory(name) {
    name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) return null;
    const existing = catByName(name);
    if (existing) return existing;
    const c = { id: 'cat:' + uid(), name };
    state.recipeCategories.push(c); sortCats(); save();
    return c;
  }
  // false if the new name is blank or already used by another category.
  function renameRecipeCategory(id, name) {
    name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const c = state.recipeCategories.find((x) => x.id === id);
    if (!c || !name) return false;
    const other = catByName(name);
    if (other && other.id !== id) return false;
    c.name = name; sortCats(); save();
    return true;
  }
  // Deleting a category never deletes recipes: they (and an unsaved draft) just lose the category.
  function deleteRecipeCategory(id) {
    state.recipeCategories = state.recipeCategories.filter((c) => c.id !== id);
    let n = 0;
    for (const r of state.recipes) if (r.categoryId === id) { delete r.categoryId; n++; }
    if (state.recipeDraft && state.recipeDraft.categoryId === id) delete state.recipeDraft.categoryId;
    if (state.recipeFilter === id || (state.recipeFilter === 'none' && !state.recipeCategories.length)) state.recipeFilter = null;
    save();
    return n;
  }
  const recipeCategory = (id) => (id && state.recipeCategories.find((c) => c.id === id)) || null;

  /* ---- Weight ---- */
  function logWeight(dateKey, kg) {
    state.weights = state.weights.filter((w) => w.date !== dateKey);
    state.weights.push({ date: dateKey, kg });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    state.profile.weightKg = state.weights[state.weights.length - 1].kg; // current weight = latest reading
    if (state.profile.startDate === dateKey) state.profile.startWeightKg = kg; // same day as the start: it IS the starting reading
    save();
  }
  // Starting weight: set once, becomes the first reading. Re-setting (a correction) rewrites that first reading.
  function setStartWeight(kg, dateKey) {
    const p = state.profile;
    if (p.startWeightKg && p.startDate) state.weights = state.weights.filter((w) => w.date !== p.startDate);
    p.startWeightKg = kg; p.startDate = p.startDate || dateKey;
    state.weights = state.weights.filter((w) => w.date !== p.startDate);
    state.weights.push({ date: p.startDate, kg });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    p.weightKg = state.weights[state.weights.length - 1].kg;
    save();
  }
  function latestWeight() { return state.weights.length ? state.weights[state.weights.length - 1] : null; }

  /* ---- Backup ---- */
  // Format 2 (1.20.0): the data with photo references, plus each photo once under `photos`. Restore still accepts
  // format-1 backups (photos embedded in every entry) and converts them.
  function exportJSON() {
    const copy = JSON.parse(JSON.stringify(state));
    delete copy.cache;
    const photos = {};
    eachImage(copy, (v) => { if (isRef(v) && photoMem.has(v.slice(6))) photos[v.slice(6)] = photoMem.get(v.slice(6)); });
    return JSON.stringify({ app: 'FoodDiary', format: 2, exportedAt: new Date().toISOString(), data: copy, photos }, null, 1);
  }
  async function importJSON(text) {
    const obj = JSON.parse(text);
    const data = obj && obj.app === 'FoodDiary' ? obj.data : obj;
    if (!data || !data.diary) throw new Error('Not a FoodDiary backup');
    const previous = state;
    await putSafetyCopy(SAFETY_RESTORE, JSON.stringify(previous)); // what was on the phone before the restore
    const next = normalise(JSON.parse(JSON.stringify(data)));
    if (obj && obj.photos) { // format 2: store each photo, then point the data at it
      const remap = new Map();
      for (const [id, url] of Object.entries(obj.photos)) if (isInline(url)) remap.set('photo:' + id, await putPhoto(url));
      eachImage(next, (v) => (remap.has(v) ? remap.get(v) : undefined));
    }
    await externalise(next); // format 1: photos embedded everywhere
    next.dataVersion = DATA_VERSION;
    state = next;
    if (!writeNow()) { state = previous; writeNow(); throw new Error('not enough storage on this phone'); }
    return counts(state);
  }
  // Erase everything on this device, including stored photos and safety copies.
  async function reset() {
    state = defaults(); writeNow();
    photoMem.clear();
    try { for (const [k] of await kvPrefix('photo:')) await kvDel(k); for (const [k] of await kvPrefix('safety:')) await kvDel(k); } catch (e) { console.warn(e); }
  }
  // Safety copies (for "download the copy saved before…")
  async function safetyCopy(which) { const v = await kvGet({ restore: SAFETY_RESTORE, weekly: SAFETY_WEEKLY, 'weekly-prev': SAFETY_WEEKLY_PREV }[which] || SAFETY_UPGRADE); return v || null; }

  // Ask the browser not to clear this app's storage when the phone runs low on space.
  async function protectStorage() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) { return null; }
  }
  async function storageProtected() { try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { return null; } }

  /* ---- Recipe draft (auto-save) ---- */
  function saveDraft(r) { state.recipeDraft = Object.assign(JSON.parse(JSON.stringify(r)), { draftSavedAt: new Date().toISOString() }); save(1000); }
  function clearDraft() { if (state.recipeDraft) { state.recipeDraft = null; save(); } }

  /* ---- Remembered picks: search text -> chosen food ---- */
  // "Eggs", " egg " and "EGG" share one memory; a trailing plural s is ignored.
  function pickKey(q) {
    let k = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (k.length > 3 && k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1);
    return k;
  }
  function rememberPick(q, food) {
    const k = pickKey(q); if (!k || !food || !food.id) return;
    if (!state.picks) state.picks = {};
    delete state.picks[k];
    state.picks[k] = slimFood(food);
    const keys = Object.keys(state.picks);
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((x) => delete state.picks[x]); // oldest first
    save();
  }
  function pickFor(q) { const k = pickKey(q); return (state.picks && k && state.picks[k]) || null; }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  return {
    get state() { return state; }, save, kvGet, kvSet,
    entries, addEntry, updateEntry, removeEntry,
    pushRecent, toggleFavourite, isFavourite, slimFood,
    saveCustomFood, deleteCustomFood, saveRecipe, deleteRecipe, addRecipeCategory, renameRecipeCategory, deleteRecipeCategory, recipeCategory,
    logWeight, setStartWeight, latestWeight, exportJSON, saveDraft, clearDraft, pickKey, rememberPick, pickFor, importJSON, reset, uid,
    upgrade, loadPhotos, photoSrc, putPhoto, counts, safetyCopy, weeklyCopy, protectStorage, storageProtected, flush, DATA_VERSION
  };
})();
