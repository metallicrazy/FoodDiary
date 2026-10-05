/* FoodDiary — share recipes & custom foods as self-contained links (no server).
   The payload is JSON → UTF-8 → deflate-raw (when CompressionStream is available) → base64url,
   carried in the URL fragment: https://…/fooddiary/#share=<code>. A fragment never reaches a server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Share = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 1;

  /* ---- base64url ---- */
  function b64urlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    while (b64.length % 4) b64 += '=';
    const bin = (typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---- compression (optional) ---- */
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter(); w.write(bytes); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) { return null; }
  }
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  /* ---- payload shaping: keep only what the receiver needs ---- */
  const slimFood = (f) => {
    const o = { n: f.name, k: f.kcal, p: f.protein, c: f.carbs, f: f.fat };
    if (f.brand) o.b = f.brand;
    if (f.barcode) o.bc = f.barcode;
    if (f.servingG) o.sg = f.servingG;
    if (f.servingLabel) o.sl = f.servingLabel;
    if (f.unitName) { o.un = f.unitName; o.ug = f.unitG; }
    if (f.satFat != null) o.sf = f.satFat;
    if (f.sugars != null) o.su = f.sugars;
    if (f.fibre != null) o.fi = f.fibre;
    if (f.salt != null) o.sa = f.salt;
    if (f.image && /^https?:/.test(f.image)) o.im = f.image; // product photo URL only, never data URLs
    return o;
  };
  const unslimFood = (o, source) => ({
    id: source + ':' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    source, name: o.n, brand: o.b || '', barcode: o.bc || '', kcal: o.k, protein: o.p ?? 0, carbs: o.c ?? 0, fat: o.f ?? 0,
    servingG: o.sg ?? null, servingLabel: o.sl ?? null, unitName: o.un ?? null, unitG: o.ug ?? null,
    satFat: o.sf ?? null, sugars: o.su ?? null, fibre: o.fi ?? null, salt: o.sa ?? null, image: o.im || null
  });

  function packRecipe(r) {
    return { v: VERSION, t: 'recipe', name: r.name, servings: r.servings, totalG: r.totalG, per100: r.per100,
      ingredients: r.ingredients.map((i) => ({ g: i.grams, food: slimFood(i.food) })) };
  }
  function packFood(f) { return { v: VERSION, t: 'food', food: slimFood(f) }; }

  function unpack(payload) {
    if (!payload || payload.v !== VERSION || !payload.t) throw new Error('This link isn\u2019t a FoodDiary share.');
    if (payload.t === 'recipe') {
      if (!payload.name || !Array.isArray(payload.ingredients) || !payload.ingredients.length) throw new Error('The shared recipe is incomplete.');
      return { type: 'recipe', recipe: {
        name: payload.name, servings: Math.max(1, parseInt(payload.servings, 10) || 1), totalG: payload.totalG || null, per100: payload.per100,
        ingredients: payload.ingredients.map((i) => ({ grams: i.g, food: unslimFood(i.food, 'custom') }))
      } };
    }
    if (payload.t === 'food') {
      if (!payload.food || !payload.food.n || payload.food.k == null) throw new Error('The shared food is incomplete.');
      return { type: 'food', food: unslimFood(payload.food, 'custom') };
    }
    throw new Error('Unknown share type.');
  }

  /* ---- encode / decode ---- */
  async function encode(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const z = await deflate(bytes);
    return z && z.length < bytes.length ? 'z' + b64urlEncode(z) : 'j' + b64urlEncode(bytes);
  }
  async function decode(code) {
    code = String(code || '').trim();
    const m = code.match(/#share=([^&\s]+)/) || code.match(/[?&]share=([^&\s]+)/);
    if (m) code = decodeURIComponent(m[1]);
    const kind = code[0], body = code.slice(1);
    if (kind !== 'z' && kind !== 'j') throw new Error('That doesn\u2019t look like a FoodDiary share code.');
    let bytes = b64urlDecode(body);
    if (kind === 'z') bytes = await inflate(bytes);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return unpack(payload);
  }

  function shareUrl(code) {
    const base = (typeof location !== 'undefined') ? location.origin + location.pathname : '';
    return base + '#share=' + code;
  }

  return { VERSION, packRecipe, packFood, unpack, encode, decode, shareUrl };
});
