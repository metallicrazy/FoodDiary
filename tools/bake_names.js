// Bakes the plain-English food names into data/cofid.json and data/cofid.js (1.21.0).
// Before, the app renamed all ~2,800 UK foods on every launch (a noticeable pause on phones).
// RUN THIS WHENEVER js/names.js OR data/cofid.json CHANGES:   node tools/bake_names.js
// (and bump DATA in sw.js so phones download the new list). The test suite checks the file is up to date.
const fs = require('fs');
const path = require('path');
const Names = require('../js/names.js');
const dir = path.join(__dirname, '..', 'data');
const src = JSON.parse(fs.readFileSync(path.join(dir, 'cofid.json'), 'utf8'));
const out = [];
for (const f of src) {
  const cofidName = f.cofidName || f.name;               // original CoFID name (kept for search and ranking)
  if (/weighed with/i.test(cofidName)) continue;         // hidden in the app anyway (weighed before peeling)
  const o = {};
  for (const [k, v] of Object.entries(f)) { if (k === 'cofidName') continue; o[k] = v; if (k === 'name') o.cofidName = cofidName; }
  o.name = Names.friendly(cofidName);
  out.push(o);
}
const json = JSON.stringify(out);
fs.writeFileSync(path.join(dir, 'cofid.json'), json);
fs.writeFileSync(path.join(dir, 'cofid.js'), 'window.__COFID=' + json + ';');
console.log(`Baked ${out.length} foods (${src.length - out.length} hidden variants dropped).`);
