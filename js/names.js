/* FoodDiary — plain-English names for UK (CoFID) foods.
   CoFID names are written for dietitians ("Oranges, flesh only", "Potatoes, old, boiled in unsalted water").
   friendly(name) → a short title a normal person would say ("Orange (peeled)", "Boiled potato").
   Rules cover every entry; OVERRIDES hand-write the common ones. Original names stay in the data for
   portion matching and ranking. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Names = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Exact original name → friendly title. Keep these the way people actually talk.
  const OVERRIDES = {
    'Eggs, chicken, whole, boiled': 'Boiled egg',
    'Eggs, chicken, whole, raw': 'Egg, raw',
    'Eggs, chicken, whole, poached': 'Poached egg',
    'Eggs, chicken, whole, fried in sunflower oil': 'Fried egg',
    'Eggs, chicken, whole, fried, without fat': 'Fried egg (no oil)',
    'Eggs, chicken, whole, scrambled, without milk': 'Scrambled egg (no milk)',
    'Eggs, chicken, scrambled, with semi-skimmed milk': 'Scrambled egg',
    'Eggs, chicken, white, raw': 'Egg white',
    'Eggs, chicken, yolk, raw': 'Egg yolk',
    'Milk, semi-skimmed, pasteurised, average': 'Semi-skimmed milk',
    'Milk, whole, pasteurised, average': 'Whole milk',
    'Milk, skimmed, pasteurised, average': 'Skimmed milk',
    'Milk, 1% fat, pasteurised': '1% fat milk',
    'Bread, white, sliced': 'White bread (sliced)',
    'Bread, white, average': 'White bread',
    'Bread, white, toasted': 'White toast',
    'Bread, wholemeal, average': 'Wholemeal bread',
    'Bread, wholemeal, toasted': 'Wholemeal toast',
    'Bread, brown, average': 'Brown bread',
    'Bread, brown, toasted': 'Brown toast',
    'Bread, seeded': 'Seeded bread',
    'Butter, salted': 'Butter (salted)',
    'Butter, unsalted': 'Butter (unsalted)',
    'Cheese, Cheddar, English': 'Cheddar cheese',
    'Cheese, Cheddar type, half fat': 'Cheddar, half fat',
    'Cheese, Mozzarella, fresh': 'Mozzarella',
    'Cheese, cottage, plain': 'Cottage cheese',
    'Yogurt, Greek style, plain': 'Greek yogurt (plain)',
    'Yogurt, Greek style, fruit': 'Greek yogurt (fruit)',
    'Yogurt, whole milk, plain': 'Natural yogurt (whole milk)',
    'Yogurt, low fat, plain': 'Natural yogurt (low fat)',
    'Yogurt, low fat, fruit': 'Fruit yogurt (low fat)',
    'Chicken, breast, grilled without skin, meat only': 'Chicken breast, grilled (no skin)',
    'Chicken, breast, grilled with skin, meat only': 'Chicken breast, grilled (skin removed after)',
    'Chicken, breast, grilled, meat and skin': 'Chicken breast, grilled (with skin)',
    'Chicken, breast, raw, meat only': 'Chicken breast, raw',
    'Chicken, breast, roasted, meat only': 'Chicken breast, roasted (no skin)',
    'Beef, mince, raw': 'Beef mince, raw',
    'Beef, mince, raw, extra lean': 'Beef mince, raw (extra lean)',
    'Beef, mince, stewed': 'Beef mince, cooked',
    'Bacon rashers, back, grilled': 'Back bacon, grilled',
    'Bacon rashers, back, dry-fried': 'Back bacon, fried',
    'Bacon rashers, back, raw': 'Back bacon, raw',
    'Bacon rashers, streaky, grilled': 'Streaky bacon, grilled',
    'Sausages, pork, chilled, grilled': 'Pork sausage, grilled',
    'Sausages, pork, chilled, fried in vegetable oil': 'Pork sausage, fried',
    'Sausages, pork, frozen, grilled': 'Pork sausage, grilled (from frozen)',
    'Sausages, pork, reduced fat, grilled': 'Pork sausage, reduced fat, grilled',
    'Sausages, premium, grilled': 'Premium sausage, grilled',
    'Rice, white, basmati, boiled in unsalted water': 'Basmati rice, boiled',
    'Rice, white, long grain, boiled in unsalted water': 'White rice, boiled',
    'Rice, white, basmati, raw': 'Basmati rice, dry',
    'Rice, brown, basmati, boiled in unsalted water': 'Brown basmati rice, boiled',
    'Rice, brown, wholegrain, boiled in unsalted water': 'Brown rice, boiled',
    'Pasta, white, dried, boiled in unsalted water': 'Pasta, boiled',
    'Pasta, white, dried, raw': 'Pasta, dry',
    'Pasta, wholewheat, dried, boiled in unsalted water': 'Wholewheat pasta, boiled',
    'Potatoes, old, boiled in unsalted water, flesh only': 'Boiled potato',
    'Potatoes, old, boiled in salted water, flesh only': 'Boiled potato (salted water)',
    'Potatoes, old, raw, flesh only': 'Potato, raw (peeled)',
    'Potatoes, old, baked, flesh and skin': 'Jacket potato (with skin)',
    'Potatoes, old, baked, flesh only': 'Jacket potato (no skin)',
    'Potatoes, old, mashed with butter': 'Mashed potato (with butter)',
    'Potatoes, old, roast, in vegetable oil': 'Roast potato',
    'Potatoes, new and salad, boiled in unsalted water, flesh and skin': 'New potatoes, boiled',
    'Porridge oats, unfortified': 'Porridge oats (dry)',
    'Porridge, made with whole milk': 'Porridge, made with whole milk',
    'Porridge, made with water': 'Porridge, made with water',
    'Bananas, flesh only': 'Banana',
    'Apples, eating, raw, flesh and skin': 'Apple',
    'Apples, eating, raw, flesh only': 'Apple (peeled)',
    'Oranges, flesh only': 'Orange (peeled)',
    'Grapes, average': 'Grapes',
    'Strawberries, raw': 'Strawberries',
    'Tomatoes, standard, raw': 'Tomato',
    'Tomatoes, cherry, raw': 'Cherry tomatoes',
    'Cucumber, raw': 'Cucumber',
    'Carrots, old, raw': 'Carrot, raw',
    'Carrots, old, boiled in unsalted water': 'Carrot, boiled',
    'Onions, raw': 'Onion, raw',
    'Broccoli, green, boiled in unsalted water': 'Broccoli, boiled',
    'Broccoli, green, raw': 'Broccoli, raw',
    'Peas, frozen, boiled in unsalted water': 'Peas, boiled (from frozen)',
    'Beans, baked, canned in tomato sauce': 'Baked beans',
    'Tuna, canned in brine, drained': 'Tuna (canned in brine)',
    'Tuna, canned in sunflower oil, drained': 'Tuna (canned in oil)',
    'Salmon, farmed, flesh only, baked': 'Salmon, baked',
    'Salmon, farmed, flesh only, grilled': 'Salmon, grilled',
    'Salmon, farmed, flesh only, raw': 'Salmon, raw',
    'Coffee, infusion, average': 'Coffee, black',
    'Coffee, infusion, average, with semi-skimmed milk': 'Coffee with semi-skimmed milk',
    'Coffee, infusion, average, with whole milk': 'Coffee with whole milk',
    'Coffee, cappuccino, latte': 'Latte / cappuccino',
    'Coffee, powder, instant': 'Instant coffee (dry)',
    'Tea, black, infusion, average': 'Tea, black',
    'Tea, black, infusion, average, with semi-skimmed milk': 'Tea with semi-skimmed milk',
    'Tea, black, infusion, average, with whole milk': 'Tea with whole milk',
    'Tea, green, infusion': 'Green tea',
    'Orange juice, chilled': 'Orange juice',
    'Orange juice, freshly squeezed, weighed as whole fruit': 'Orange juice, fresh (from whole oranges)',
    'Milk, semi-skimmed, pasteurised, summer and autumn': 'Semi-skimmed milk (summer)',
    'Milk, semi-skimmed, pasteurised, winter and spring': 'Semi-skimmed milk (winter)',
    'Milk, whole, pasteurised, summer and autumn': 'Whole milk (summer)',
    'Milk, whole, pasteurised, winter and spring': 'Whole milk (winter)',
    'Bacon rashers, back, grilled crispy': 'Back bacon, grilled crispy',
    'Bacon rashers, back, smoked, grilled': 'Back bacon, smoked, grilled',
    'Bacon rashers, back, dry-cured, grilled': 'Back bacon, dry-cured, grilled',
    'Orange juice, freshly squeezed': 'Orange juice, fresh',
    'Apple juice, clear, ambient and chilled': 'Apple juice',
    'Wine, red': 'Red wine', 'Wine, white, dry': 'White wine (dry)', 'Wine, white, medium': 'White wine (medium)', 'Wine, rose, medium': 'Rosé wine',
    'Beer, bitter, average (<4% ABV)': 'Bitter', 'Lager, average (4% ABV)': 'Lager', 'Lager, premium (5% ABV)': 'Lager, premium',
    'Potato crisps, fried in sunflower oil': 'Crisps', 'Potato crisps, low fat': 'Crisps, low fat',
    'Chocolate, milk': 'Milk chocolate', 'Chocolate, plain': 'Dark chocolate', 'Chocolate, white': 'White chocolate',
    'Biscuits, digestive, plain': 'Digestive biscuit', 'Biscuits, digestive, half coated in chocolate': 'Chocolate digestive', 'Biscuits, rich tea': 'Rich tea biscuit',
    'Olive oil': 'Olive oil', 'Peanut butter, smooth': 'Peanut butter (smooth)', 'Peanut butter, crunchy': 'Peanut butter (crunchy)',
    'Hummus': 'Hummus', 'Tomato ketchup': 'Ketchup', 'Mayonnaise, retail, standard': 'Mayonnaise',
    'Avocado, Hass, flesh only': 'Avocado (Hass)', 'Avocado, average': 'Avocado',
    'Wheat flour, white, plain': 'Plain flour', 'Wheat flour, white, self-raising': 'Self-raising flour',
    'Sugar, white': 'Sugar', 'Honey': 'Honey'
  };

  // Phrase rewrites applied to every name (case-insensitive, in order).
  const REWRITES = [
    [/\bboiled in unsalted water\b/g, 'boiled'],
    [/\bboiled in salted water\b/g, 'boiled (salted water)'],
    [/\bflesh and skin\b/g, 'with skin'],
    [/\bmeat and skin\b/g, 'with skin'],
    [/\bmeat only\b/g, 'no skin'],
    [/\blean and fat\b/g, 'lean & fat'],
    [/\blean only\b/g, 'lean'],
    [/\bwhole contents\b/g, 'incl. liquid'],
    [/\bdrained\b/g, 'drained'],
    [/\bpasteurised\b,?\s*/g, ''],
    [/\bunfortified\b,?\s*/g, ''],
    [/\binfusion\b,?\s*/g, ''],
    [/\bretail\b,?\s*/g, ''],
    [/,\s*average\b/g, ''],
    [/\bchilled\b,?\s*/g, ''],
    [/\bfrozen\b,?\s*/g, 'from frozen'],
    [/\bcanned in (brine|water|spring water)\b/g, 'canned'],
    [/\bdried,\s*boiled\b/g, 'boiled'],
    [/\bnew and salad\b/g, 'new'],
    [/\b(old|mature|standard|commercial|commerical|ambient)\b,?\s*/g, ''], // "old" = maincrop, etc.
    [/\bfried in (sunflower|vegetable|rapeseed|corn|blended) oil\b/g, 'fried in $1 oil'],
    [/\bhomemade\b/g, 'homemade'],
    [/\btakeaway\b/g, 'takeaway'],
    [/\bUK type\b,?\s*/g, ''],
    [/\s*\/\s*/g, ' / '],
    [/\s{2,}/g, ' '],
    [/,\s*,/g, ','],
    [/,\s*$/g, ''],
  ];

  // Head rewrites: dietitian heads → everyday heads
  const HEADS = { 'Bacon rashers': 'Bacon', 'Potato crisps': 'Crisps', 'Porridge oats': 'Porridge oats', 'Breakfast cereal': 'Cereal', 'Wheat flour': 'Flour', 'Beefburgers': 'Beefburger', 'Fish fingers': 'Fish fingers' };

  // Heads that are plural in CoFID but singular in speech
  const SINGULAR = { Eggs: 'Egg', Bananas: 'Banana', Apples: 'Apple', Oranges: 'Orange', Pears: 'Pear', Peaches: 'Peach', Plums: 'Plum', Tomatoes: 'Tomato', Potatoes: 'Potato', Carrots: 'Carrot', Onions: 'Onion', Sausages: 'Sausage', Burgers: 'Burger', Biscuits: 'Biscuit', Muffins: 'Muffin', Scones: 'Scone', Crumpets: 'Crumpet', Bagels: 'Bagel', Croissants: 'Croissant', Doughnuts: 'Doughnut', Avocados: 'Avocado', Lemons: 'Lemon', Limes: 'Lime', Kiwis: 'Kiwi', Mangoes: 'Mango', Peppers: 'Pepper', Mushrooms: 'Mushrooms', Nectarines: 'Nectarine', Apricots: 'Apricot', Cherries: 'Cherries', Figs: 'Fig' };

  // Cooking/prep words that read better in front: "Boiled potato" rather than "Potato, boiled"
  const FRONT = /^(boiled|grilled|fried|roast|roasted|baked|poached|scrambled|steamed|stewed|microwaved|toasted|mashed|dry-fried|barbecued|braised|casseroled|slow cooked)$/i;

  const FISH = /^(cod|haddock|salmon|trout|tuna|mackerel|halibut|plaice|sole|sea bass|bass|bream|hake|pollock|pollack|coley|whiting|herring|kipper|sardines?|pilchards?|anchov|monkfish|swordfish|skate|turbot|john dory|red mullet|mullet|snapper|tilapia|catfish|eel|whitebait|sprats?|lemon sole|dover sole|fish|prawns?|shrimps?|crab|lobster|scallops?|mussels?|oysters?|squid|octopus|shark|carp|perch|pike|dab|flounder|gurnard|ling|rock salmon|huss|dogfish|roe|caviar)\b/i;
  const MEAT = /^(chicken|turkey|duck|goose|beef|lamb|pork|veal|venison|rabbit|pheasant|partridge|grouse|pigeon|quail|mutton|goat|ham|bacon|gammon)\b/i;

  function friendly(name) {
    if (!name) return '';
    if (OVERRIDES[name]) return OVERRIDES[name];
    let s = name;
    s = s.replace(/\bflesh only\b/g, FISH.test(name) ? 'boneless' : MEAT.test(name) ? 'meat only' : 'peeled');
    for (const [re, rep] of REWRITES) s = s.replace(re, rep);
    let parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return name;
    let head = parts.shift();
    if (HEADS[head]) head = HEADS[head];
    if (SINGULAR[head]) head = SINGULAR[head];
    // Variety right after the head reads better in front for bacon: 'Bacon, streaky, grilled' → 'Streaky bacon, grilled'
    if (/^bacon$/i.test(head) && parts.length && /^(back|streaky|middle)$/i.test(parts[0])) { head = parts.shift().replace(/^./, (c) => c.toUpperCase()) + ' bacon'; }
    // Move a single cooking word to the front: "Potato, boiled" → "Boiled potato"
    const ci = parts.findIndex((p) => FRONT.test(p));
    if (ci >= 0 && parts.length <= 2) { const cook = parts.splice(ci, 1)[0].toLowerCase(); head = cook.charAt(0).toUpperCase() + cook.slice(1) + ' ' + head.charAt(0).toLowerCase() + head.slice(1); }
    // Qualifiers that read as brackets
    const brackets = [], tail = [];
    for (const p of parts) {
      if (/^(peeled|with skin|no skin|lean|lean & fat|drained|incl\. liquid|from frozen|canned|dry|raw|fresh|homemade|takeaway|salted|unsalted|sweetened|unsweetened|reduced fat|low fat|half fat|full fat|light|plain|boiled \(salted water\))$/i.test(p) || /%/.test(p)) brackets.push(p);
      else tail.push(p);
    }
    let out = head + (tail.length ? ', ' + tail.join(', ') : '') + (brackets.length ? ' (' + brackets.join(', ') + ')' : '');
    out = out.replace(/\s{2,}/g, ' ').replace(/\(\s*\)/g, '').trim();
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  return { OVERRIDES, friendly };
});
