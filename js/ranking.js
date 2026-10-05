/* FoodDiary — "human" ranking for UK (CoFID) food search.
   Pure module: scoreName(query, name, opts) → number (higher = better), plus a curated list of what
   people usually mean by everyday words so "egg" surfaces chicken eggs, not egg fu yung. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ranking = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // query word(s) → ordered regexes; first = most expected. Matched against the full CoFID name.
  const CURATED = {
    egg: [/^eggs, chicken, whole, boiled/i, /^eggs, chicken, whole, raw/i, /^eggs, chicken, fried/i, /^eggs, chicken, scrambled/i, /^eggs, chicken, poached/i, /^eggs, chicken, whole/i],
    eggs: 'egg',
    'boiled egg': [/^eggs, chicken, whole, boiled/i], 'fried egg': [/^eggs, chicken, fried/i], 'scrambled egg': [/^eggs, chicken, scrambled/i], 'poached egg': [/^eggs, chicken, poached/i],
    milk: [/^milk, semi-skimmed, pasteurised, average/i, /^milk, semi-skimmed, pasteurised/i, /^milk, whole, pasteurised, average/i, /^milk, whole, pasteurised/i, /^milk, skimmed, pasteurised, average/i, /^milk, skimmed, pasteurised/i],
    bread: [/^bread, white, sliced/i, /^bread, wholemeal, average/i, /^bread, wholemeal/i, /^bread, brown, average/i, /^bread, seeded/i, /^bread, white, average/i],
    toast: [/^bread, white, toasted/i, /^bread, wholemeal, toasted/i, /^bread, brown, toasted/i],
    butter: [/^butter, salted/i, /^butter, unsalted/i, /^butter, spreadable/i],
    cheese: [/^cheese, cheddar, english/i, /^cheese, cheddar/i, /^cheese, mozzarella/i, /^cheese, feta/i, /^cheese, brie/i],
    cheddar: [/^cheese, cheddar, english/i, /^cheese, cheddar/i],
    yogurt: [/^yogurt, greek style, plain/i, /^yogurt, whole milk, plain/i, /^yogurt, low fat, plain/i, /^yogurt, low fat, fruit/i, /^yogurt, greek style/i],
    yoghurt: 'yogurt',
    chicken: [/^chicken, breast, grilled without skin, meat only/i, /^chicken, breast, grilled/i, /^chicken, breast, raw, meat only/i, /^chicken, breast, roasted/i, /^chicken, breast/i, /^chicken, thigh/i, /^chicken, roasted, meat only/i],
    'chicken breast': [/^chicken, breast, grilled without skin, meat only/i, /^chicken, breast, grilled/i, /^chicken, breast, raw, meat only/i, /^chicken, breast/i],
    beef: [/^beef, mince, (stewed|raw)/i, /^beef, mince/i, /^beef, steak, (rump|sirloin|fillet)/i, /^beef, roast/i],
    mince: [/^beef, mince, (stewed|raw)/i, /^beef, mince/i, /^lamb, mince/i, /^pork, mince/i, /^turkey, mince/i],
    steak: [/^beef, steak, rump/i, /^beef, steak, sirloin/i, /^beef, steak, fillet/i, /^beef, (rump|sirloin|fillet) steak/i, /^beef, steak/i],
    pork: [/^pork, loin chops/i, /^pork, chops/i, /^pork, mince/i, /^pork, leg, roasted/i, /^pork, fillet/i],
    lamb: [/^lamb, loin chops/i, /^lamb, chops/i, /^lamb, mince/i, /^lamb, leg, roasted/i],
    bacon: [/^bacon rashers, back, grilled/i, /^bacon rashers, back, dry-fried/i, /^bacon rashers, back/i, /^bacon rashers, streaky, grilled/i],
    sausage: [/^sausages, pork, chilled, grilled/i, /^sausages, pork, .*grilled/i, /^sausages, pork/i, /^sausages, premium, grilled/i, /^sausages, beef, grilled/i],
    sausages: 'sausage',
    ham: [/^ham, (wafer thin|sliced|average)/i, /^ham, /i],
    turkey: [/^turkey, breast, (grilled|roasted|raw)/i, /^turkey, breast/i, /^turkey, mince/i],
    salmon: [/^salmon, (atlantic|farmed), .*(grilled|baked|steamed|raw)/i, /^salmon, .*(grilled|baked|steamed)/i, /^salmon, .*raw/i, /^salmon/i],
    tuna: [/^tuna, canned in brine, drained/i, /^tuna, canned in (spring water|brine)/i, /^tuna, canned/i, /^tuna, raw/i],
    cod: [/^cod, .*(baked|grilled|steamed|poached)/i, /^cod, .*raw/i, /^cod, /i],
    prawns: [/^prawns, king, (cooked|boiled)/i, /^prawns, .*(boiled|cooked)/i, /^prawns/i],
    fish: [/^cod, .*(baked|grilled)/i, /^salmon, .*(grilled|baked)/i, /^fish fingers, .*grilled/i, /^haddock, .*(baked|grilled|steamed)/i],
    rice: [/^rice, white, basmati, boiled/i, /^rice, white, (easy cook|long grain), boiled/i, /^rice, white, .*boiled/i, /^rice, brown, .*boiled/i, /^rice, white, basmati, raw/i],
    pasta: [/^pasta, white, dried, boiled/i, /^pasta, white, .*boiled/i, /^pasta, wholewheat, .*boiled/i, /^spaghetti, white, .*boiled/i, /^pasta, white, dried, raw/i],
    spaghetti: [/^spaghetti, white, .*boiled/i, /^spaghetti, wholemeal, .*boiled/i, /^spaghetti, white, .*raw/i],
    noodles: [/^noodles, egg, .*boiled/i, /^noodles, rice, .*boiled/i, /^noodles, .*boiled/i],
    potato: [/^potatoes, old, boiled in unsalted water/i, /^potatoes, old, boiled/i, /^potatoes, old, baked, flesh and skin/i, /^potatoes, old, mashed/i, /^potatoes, old, roast/i, /^potatoes, new/i],
    potatoes: 'potato',
    chips: [/^chips, (oven|straight cut|french fries)/i, /^chips, .*(oven|fried)/i, /^chips, /i],
    oats: [/^porridge oats, unfortified$/i, /^porridge oats/i, /^porridge, made with/i],
    porridge: [/^porridge, made with (semi-skimmed )?milk/i, /^porridge, made with/i, /^porridge oats, .*cooked/i, /^porridge oats/i],
    cereal: [/^cornflakes/i, /^bran flakes/i, /^weetabix/i, /^muesli/i, /^porridge oats/i],
    banana: [/^bananas, flesh only/i, /^bananas, raw/i],
    apple: [/^apples, eating, raw, flesh and skin/i, /^apples, eating, raw/i, /^apples, eating/i],
    orange: [/^oranges, flesh only/i, /^oranges, /i, /^orange juice, (chilled|freshly)/i],
    grapes: [/^grapes, average/i, /^grapes/i],
    strawberries: [/^strawberries, raw/i, /^strawberries/i], strawberry: 'strawberries',
    blueberries: [/^blueberries/i], raspberries: [/^raspberries, raw/i, /^raspberries/i],
    pear: [/^pears, average, raw/i, /^pears/i], peach: [/^peaches, raw/i, /^peaches/i],
    melon: [/^melon, (honeydew|cantaloupe|galia)/i, /^melon/i], mango: [/^mango, ripe, raw/i, /^mango/i],
    pineapple: [/^pineapple, raw/i, /^pineapple/i], kiwi: [/^kiwi fruit, .*raw/i],
    avocado: [/^avocado, average/i, /^avocado/i],
    tomato: [/^tomatoes, standard, raw/i, /^tomatoes, (standard|salad), raw/i, /^tomatoes, cherry, raw/i, /^tomatoes, .*raw/i],
    tomatoes: 'tomato',
    cucumber: [/^cucumber, raw/i], lettuce: [/^lettuce, average, raw/i, /^lettuce/i],
    onion: [/^onions, raw/i, /^onions, (fried|boiled)/i, /^onions/i], onions: 'onion',
    pepper: [/^peppers?, capsicum, (red|green|yellow), raw/i, /^peppers?, capsicum/i], peppers: 'pepper',
    carrot: [/^carrots, old, raw/i, /^carrots, old, boiled/i, /^carrots, .*raw/i, /^carrots/i], carrots: 'carrot',
    broccoli: [/^broccoli, green, boiled/i, /^broccoli, green, raw/i, /^broccoli/i],
    peas: [/^peas, frozen, boiled/i, /^peas, .*boiled/i, /^peas/i],
    beans: [/^beans, baked, canned in tomato sauce/i, /^beans, green, boiled/i, /^beans, kidney, canned/i],
    'baked beans': [/^beans, baked, canned in tomato sauce/i, /^beans, baked/i],
    mushrooms: [/^mushrooms, (white|common), raw/i, /^mushrooms, .*fried/i, /^mushrooms/i], mushroom: 'mushrooms',
    spinach: [/^spinach, (mature|baby), raw/i, /^spinach, .*boiled/i, /^spinach/i],
    sweetcorn: [/^sweetcorn, kernels, canned/i, /^sweetcorn/i],
    hummus: [/^hummus/i, /^houmous/i], houmous: 'hummus',
    'peanut butter': [/^peanut butter, smooth/i, /^peanut butter/i],
    nuts: [/^mixed nuts/i, /^almonds/i, /^cashew/i, /^peanuts, plain/i],
    almonds: [/^almonds$/i, /^almonds, /i], peanuts: [/^peanuts, plain/i, /^peanuts, roasted/i, /^peanuts/i],
    oil: [/^olive oil/i, /^rapeseed oil/i, /^sunflower oil/i, /^vegetable oil/i, /^oil, /i],
    'olive oil': [/^olive oil/i],
    sugar: [/^sugar, white/i, /^sugar, /i], honey: [/^honey/i], jam: [/^jam, fruit with edible seeds/i, /^jam/i],
    ketchup: [/^tomato ketchup/i], mayonnaise: [/^mayonnaise, retail, standard/i, /^mayonnaise/i], mayo: 'mayonnaise',
    coffee: [/^coffee, infusion, average/i, /^coffee, infusion, average, with (semi-skimmed|whole) milk/i, /^coffee, cappuccino, latte/i, /^coffee, powder, instant/i],
    latte: [/^coffee, cappuccino, latte/i], cappuccino: 'latte',
    tea: [/^tea, black, infusion, average/i, /^tea, black, infusion, average, with (semi-skimmed|whole) milk/i, /^tea, black, infusion/i, /^tea, green/i],
    juice: [/^orange juice, (chilled|freshly)/i, /^apple juice/i, /^orange juice/i],
    'orange juice': [/^orange juice, chilled/i, /^orange juice, freshly/i, /^orange juice/i],
    'apple juice': [/^apple juice/i],
    wine: [/^wine, red/i, /^wine, white, (dry|medium)/i, /^wine, white/i, /^wine, rose/i],
    beer: [/^beer, bitter, average/i, /^beer, bitter/i, /^lager, premium/i, /^lager, average/i],
    lager: [/^lager, average/i, /^lager, premium/i, /^lager, /i],
    cider: [/^cider, dry/i, /^cider, sweet/i, /^cider/i],
    crisps: [/^potato crisps, fried in sunflower oil/i, /^potato crisps/i],
    chocolate: [/^chocolate, milk/i, /^chocolate, plain/i, /^chocolate, white/i],
    biscuit: [/^biscuits, digestive, plain/i, /^biscuits, digestive/i, /^biscuits, rich tea/i, /^biscuits, chocolate/i], biscuits: 'biscuit',
    cake: [/^cake, sponge, with (butter icing|jam)/i, /^cake, (sponge|victoria|chocolate)/i, /^cake, /i],
    'ice cream': [/^ice cream, dairy, vanilla/i, /^ice cream, dairy/i, /^ice cream/i],
    pizza: [/^pizza, cheese and tomato, (retail|chilled)/i, /^pizza, cheese and tomato/i, /^pizza, pepperoni/i, /^pizza, /i],
    burger: [/^burger, beef, .*grilled/i, /^burger, beef/i, /^beefburgers, .*grilled/i],
    sandwich: [/^sandwich, (white|wholemeal) bread, (ham|cheese|chicken)/i, /^sandwich, /i],
    soup: [/^soup, (tomato|chicken|vegetable), canned/i, /^soup, /i],
    curry: [/^chicken tikka masala/i, /^curry, chicken/i, /^chicken curry/i, /^curry, /i],
    wrap: [/^tortilla, wheat, soft/i], tortilla: 'wrap',
    hummous: 'hummus', flour: [/^wheat flour, white, plain/i, /^wheat flour, white, self-raising/i, /^wheat flour, wholemeal/i, /^wheat flour/i],
    water: [/^water, tap/i, /^water, mineral/i, /^water/i],
    quinoa: [/^quinoa, .*boiled/i, /^quinoa/i], lentils: [/^lentils, red, .*boiled/i, /^lentils, green, .*boiled/i, /^lentils, .*boiled/i],
    chickpeas: [/^chickpeas, canned/i, /^chickpeas, .*boiled/i, /^chickpeas/i], tofu: [/^tofu, (steamed|firm)/i, /^tofu/i],
    bagel: [/^bagels, plain/i], croissant: [/^croissants/i], crumpet: [/^crumpets, toasted/i, /^crumpets/i],
    granola: [/^granola/i], muesli: [/^muesli, swiss style/i, /^muesli/i], weetabix: [/^weetabix/i], cornflakes: [/^cornflakes/i]
  };

  // Words that mark a composite dish or non-basic form. Demoted unless the query itself contains them.
  const DISH = /\b(homemade|takeaway|retail|recipe|dish|pie|curry|casserole|stew|soup|sauce|pudding|cake|bake|bhaji|fu yung|nog|salad|sandwich|roll|pizza|burger|pasty|lasagne|bolognese|risotto|paella|chow mein|fried rice)\b|,\s*with\s(?!skin|bone|fat)|\s+and\s+(?!skin|fat|bone|autumn|spring)|\s+in\s+(?!(un)?salted water|water|brine|oil|juice|syrup|tomato|sauce|flour|breadcrumbs|batter)/i;
  // Exotic / unusual variants that are rarely what a casual search means.
  const EXOTIC = /\b(duck|quail|goose|turkey eggs|ostrich|human|sheeps?|goats?|buffalo|camel|wild|red,|black,|glutinous|roughy|dried|powder|extract|concentrate|flavoured|fortified|unfortified|weighed with)\b/i;
  const BASIC = /\b(raw|boiled|average|whole|grilled|baked|fresh|pasteurised|semi-skimmed|plain|standard|sliced|flesh only|flesh and skin)\b/i;
  // As-eaten forms people usually log, vs. forms they rarely mean
  const AS_EATEN = /\b(boiled|grilled|baked|roasted|cooked|toasted|pasteurised|average)\b/i;
  const RARE_FORM = /\b(uht|dried|raw, extra|salted water)\b/i;

  function curatedFor(query) {
    const q = query.trim().toLowerCase();
    let v = CURATED[q];
    if (!v) { // try singular/plural
      if (q.endsWith('es') && CURATED[q.slice(0, -2)]) v = CURATED[q.slice(0, -2)];
      else if (q.endsWith('s') && CURATED[q.slice(0, -1)]) v = CURATED[q.slice(0, -1)];
      else if (CURATED[q + 's']) v = CURATED[q + 's'];
    }
    while (typeof v === 'string') v = CURATED[v];
    return v || null;
  }

  // Score a CoFID name for a query. `recent` = user has logged this food before.
  function scoreName(query, name, { recent = false, alias = '' } = {}) {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const lower = name.toLowerCase(), al = (alias || '').toLowerCase();
    let score = 0;
    for (const t of terms) {
      let i = lower.indexOf(t), src = lower;
      if (i < 0 && al) { i = al.indexOf(t); src = al; }
      if (i < 0) return -Infinity;
      const atStart = i === 0, wordStart = atStart || /[\s,(\/-]/.test(src[i - 1]);
      score += atStart ? 6 : wordStart ? 3 : 1;
    }
    // Typing the friendly phrase ("boiled egg", "white bread") should win outright
    if (al && terms.length > 1 && (al === q || al.startsWith(q + ' ') || al.startsWith(q + ','))) score += 10;
    else if (al && (al === q || al === q + 's')) score += 4;
    // Head of the name (before the first comma) equals the query, or its plural/singular → strong signal
    const head = lower.split(',')[0].trim();
    if (head === q || head === q + 's' || head === q + 'es' || head + 's' === q || head + 'es' === q) score += 6;
    // Demotions / promotions (only when the query doesn't ask for them)
    if (DISH.test(lower) && !DISH.test(q)) score -= 5;
    if (EXOTIC.test(lower) && !EXOTIC.test(q)) score -= 4;
    if (BASIC.test(lower)) score += 1;
    if (AS_EATEN.test(lower) && !AS_EATEN.test(q)) score += 1.5;
    if (/\braw\b/.test(lower) && !/\braw\b/.test(q) && /^(rice|pasta|spaghetti|noodles|potatoes|lentils|chickpeas|beans|quinoa|couscous|peas|broccoli|carrots|spinach|cabbage|cauliflower)\b/.test(lower)) score -= 2.5;
    if (RARE_FORM.test(lower) && !RARE_FORM.test(q)) score -= 1.5;
    // Mild preference for shorter names, but far weaker than before
    score -= Math.min(2, lower.length / 60);
    // Curated "what people mean" list
    const cur = curatedFor(q);
    if (cur) { const idx = cur.findIndex((re) => re.test(name)); if (idx >= 0) score += 30 - idx * 2; }
    if (recent) score += 8;
    return score;
  }

  return { CURATED, scoreName, curatedFor };
});
