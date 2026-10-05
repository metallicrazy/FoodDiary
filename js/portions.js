/* FoodDiary — built-in UK portion sizes for generic (CoFID) foods that have no serving data.
   Weights follow typical UK guidance (PHE / British Dietetic Association portion tables) and are
   deliberately "medium" values. Matching is by food-name pattern; first match wins, so put specific
   patterns before general ones. Each entry: { match: RegExp, unit: 'egg', plural: 'eggs', g: 58 } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Portions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NO_S = { tbsp: 'tbsp', tsp: 'tsp', single: 'singles', half: 'halves', 'small can': 'small cans', 'half can': 'half cans' };
  const P = (match, unit, g, plural) => ({ match, unit, g, plural: plural || NO_S[unit] || unit + 's' });

  const TABLE = [
    // Eggs
    P(/^eggs?, chicken, (whole|boiled|poached|fried|scrambled)/i, 'egg', 58),
    P(/^eggs?, chicken/i, 'egg', 58),
    P(/^eggs?, duck/i, 'egg', 70),
    // Bread & bakery
    P(/^bread, .*thick/i, 'slice', 44),
    P(/^bread, .*(sliced|medium)/i, 'slice', 36),
    P(/^bread, (white|brown|wholemeal|granary|seeded|wheatgerm|rye)/i, 'slice', 36),
    P(/^bread rolls?/i, 'roll', 60),
    P(/^bagels?/i, 'bagel', 85),
    P(/^croissants?/i, 'croissant', 60),
    P(/^crumpets?/i, 'crumpet', 40),
    P(/^pitta/i, 'pitta', 60),
    P(/^tortilla, wheat|^wraps?, /i, 'wrap', 64),
    P(/^naan/i, 'naan', 130),
    P(/^scones?/i, 'scone', 48),
    P(/^muffins?, english/i, 'muffin', 67),
    P(/^muffins?/i, 'muffin', 85),
    P(/^crackers?|^crispbread|^rice cakes?|^oatcakes?/i, 'cracker', 8),
    // Biscuits & cakes
    P(/^biscuits?, digestive/i, 'biscuit', 15),
    P(/^biscuits?, rich tea/i, 'biscuit', 8),
    P(/^biscuits?, shortbread/i, 'biscuit', 20),
    P(/^biscuits?/i, 'biscuit', 12),
    P(/^cakes?, |^sponge cake/i, 'slice', 65),
    P(/^doughnuts?/i, 'doughnut', 75),
    // Dairy
    P(/^cheese, .*slices?/i, 'slice', 20),
    P(/^cheese, cheddar|^cheese, red leicester|^cheese, double gloucester|^cheese, edam|^cheese, gouda|^cheese, stilton|^cheese, brie|^cheese, camembert|^cheese, feta|^cheese, halloumi/i, 'piece', 30, 'pieces'),
    P(/^yogurt|^yoghurt|^fromage frais/i, 'pot', 125),
    P(/^butter|^margarine|^spread, (fat|low|reduced)/i, 'tsp', 5),
    P(/^milk, /i, 'glass', 200, 'glasses'),
    P(/^cream, /i, 'tbsp', 15),
    // Meat & fish
    P(/^bacon rashers?, (back|middle)/i, 'rasher', 25),
    P(/^bacon rashers?, streaky/i, 'rasher', 18),
    P(/^bacon rashers?/i, 'rasher', 25),
    P(/^sausages?, (pork|beef|premium|low fat|reduced fat).*chipolata|^chipolata/i, 'chipolata', 30),
    P(/^sausages?, /i, 'sausage', 57),
    P(/^sausage rolls?/i, 'roll', 60),
    P(/^burgers?|^beefburgers?/i, 'burger', 90),
    P(/^chicken, breast/i, 'breast', 150),
    P(/^chicken, (drumsticks?|thighs?|wings?)/i, 'piece', 60, 'pieces'),
    P(/^fish fingers?/i, 'finger', 28),
    P(/^salmon, .*(fillet|steak)|^cod, .*fillet|^haddock, .*fillet|^fish, .*fillet/i, 'fillet', 130),
    P(/^tuna, canned/i, 'small can', 100, 'small cans'),
    P(/^ham, |^chicken, .*slices?|^turkey, .*slices?/i, 'slice', 25),
    // Fruit
    P(/^apples?, (eating|dessert|cooking)|^apples?, raw|^apples?, flesh/i, 'apple', 150),
    P(/^bananas?/i, 'banana', 120),
    P(/^oranges?, /i, 'orange', 160),
    P(/^satsumas?|^clementines?|^mandarins?|^tangerines?/i, 'fruit', 70, 'fruits'),
    P(/^pears?, /i, 'pear', 160),
    P(/^peaches?|^nectarines?/i, 'fruit', 120, 'fruits'),
    P(/^plums?/i, 'plum', 55),
    P(/^kiwi/i, 'kiwi', 60),
    P(/^grapes?/i, 'handful', 80),
    P(/^strawberr|^raspberr|^blueberr|^blackberr/i, 'handful', 80),
    P(/^avocado/i, 'half', 75, 'halves'),
    P(/^dates|^apricots?, dried|^prunes|^raisins|^sultanas|^dried fruit/i, 'tbsp', 25),
    // Veg & sides
    P(/^potatoes?, (new|baby)/i, 'potato', 50, 'potatoes'),
    P(/^potatoes?, old, (baked|jacket)/i, 'jacket potato', 180, 'jacket potatoes'),
    P(/^potatoes?, old, (boiled|roast)/i, 'potato', 90, 'potatoes'),
    P(/^tomatoes?, (raw|standard|salad)/i, 'tomato', 80, 'tomatoes'),
    P(/^tomatoes?, cherry/i, 'tomato', 15, 'tomatoes'),
    P(/^carrots?/i, 'carrot', 80),
    P(/^onions?, raw|^onions?, (fried|boiled)/i, 'onion', 110),
    P(/^peppers?, (capsicum|sweet|red|green|yellow)/i, 'pepper', 160),
    P(/^mushrooms?/i, 'handful', 50),
    P(/^broccoli|^cauliflower|^cabbage|^spinach|^kale|^green beans|^peas|^sweetcorn|^carrots, |^mixed vegetables|^brussels/i, 'tbsp', 30),
    P(/^corn on the cob|^sweetcorn, on-the-cob/i, 'cob', 125),
    P(/^beans, baked/i, 'half can', 200, 'half cans'),
    P(/^rice, .*(boiled|cooked)|^pasta, .*(boiled|cooked)|^spaghetti, .*(boiled|cooked)|^noodles, .*(boiled|cooked)|^couscous, .*cooked|^quinoa, .*cooked/i, 'tbsp', 40),
    // Nuts, spreads, condiments
    P(/^nuts?, |^almonds|^cashew|^peanuts|^walnuts|^brazil|^hazelnuts|^pistachio|^pecan|^mixed nuts/i, 'handful', 30),
    P(/^peanut butter|^nut butter|^chocolate spread|^jam|^marmalade|^honey|^marmite|^yeast extract/i, 'tsp', 7),
    P(/^mayonnaise|^salad cream|^ketchup|^tomato ketchup|^brown sauce|^mustard|^salad dressing|^dressing, /i, 'tbsp', 15),
    P(/^oil, |^olive oil|^rapeseed oil|^vegetable oil|^sunflower oil/i, 'tbsp', 11),
    P(/^sugar, |^golden syrup|^maple syrup/i, 'tsp', 4),
    P(/^hummus|^houmous/i, 'tbsp', 30),
    // Cereal
    P(/^porridge oats|^oats, |^muesli|^granola|^cereal, |^cornflakes|^bran flakes|^weetabix|^shredded wheat/i, 'serving', 40),
    // Drinks
    P(/^tea, |^coffee, /i, 'mug', 250),
    P(/^beer|^lager|^cider|^ale|^stout|^bitter/i, 'pint', 568),
    P(/^wine, /i, 'glass', 175, 'glasses'),
    P(/^spirits?, |^vodka|^gin\b|^whisky|^rum\b|^brandy\b/i, 'single', 25),
    P(/^juice|^smoothie|^squash, |^cola|^lemonade|^soft drink/i, 'glass', 200, 'glasses'),
    // Snacks
    P(/^crisps|^potato crisps/i, 'bag', 25),
    P(/^chocolate, milk|^chocolate, plain|^chocolate, white/i, 'square', 10),
    P(/^chocolate bar|^mars bar|^snickers|^kit ?kat|^twix/i, 'bar', 45),
    P(/^ice cream/i, 'scoop', 60),
  ];

  // Names that look like a unit food but are really a dish, drink or ingredient form.
  const EXCLUDE = /homemade|recipe|sauce|soup|curry|casserole|stew|pie\b|pudding|crumble|cake|bread, (banana|malt)|juice|smoothie|dried|ground|powder|flour|concentrate|chips\b|crisps|^banana (bread|split)|^brandy snaps|^ginger/i;
  const ALLOW_DESPITE_EXCLUDE = /^(bread|biscuits?|burger|sausages?|crackers?|scones?|muffins?|cakes?, |doughnuts?|potato crisps|crisps|dates|apricots?, dried|prunes|raisins|sultanas|dried fruit|tortilla, wheat)/i;

  // Return { unit, plural, g } for a CoFID food name, or null.
  function forName(name) {
    if (!name) return null;
    if (EXCLUDE.test(name) && !ALLOW_DESPITE_EXCLUDE.test(name)) return null;
    for (const p of TABLE) if (p.match.test(name)) return { unit: p.unit, plural: p.plural, g: p.g };
    return null;
  }

  return { TABLE, forName };
});
