import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/usda-reference-foods.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const names = {
  173424: ['鸡蛋（煮熟）', '🥚', 50],
  168878: ['长粒白米饭（熟，强化）', '🍚', 150],
  171477: ['鸡胸肉（烤熟，去皮）', '🍗', 100],
  171265: ['全脂牛奶（含维生素D）', '🥛', 250],
  171688: ['苹果（带皮）', '🍎', 150],
  169967: ['西兰花（水煮，无盐）', '🥦', 100],
};
const ids = { energyKcal: 1008, proteinG: 1003, carbsG: 1005, fatG: 1004, fiberG: 1079, sugarG: 2000, sodiumMg: 1093, calciumMg: 1087, ironMg: 1089, potassiumMg: 1092, vitaminCMg: 1162 };
const foods = raw.filter(food => names[food.fdcId]).map(food => {
  const [name, emoji, servingGrams] = names[food.fdcId];
  const nutrientsPer100g = Object.fromEntries(Object.entries(ids).map(([key, id]) => {
    const value = food.foodNutrients.find(item => item.nutrient.id === id);
    return [key, value?.amount ?? null];
  }));
  return { id: `usda-${food.fdcId}`, name, emoji, servingGrams, nutrientsPer100g, source: `USDA FoodData Central ${food.fdcId}，SR Legacy；每100克可食部分参考值` };
});
fs.writeFileSync(new URL('../shared/foods.seed.json', import.meta.url), JSON.stringify(foods, null, 2));
console.log(`Prepared ${foods.length} reference foods with exact USDA nutrient IDs and unknown values preserved.`);
