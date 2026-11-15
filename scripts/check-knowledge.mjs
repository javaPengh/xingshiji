import {loadNutritionKnowledge} from '../server/nutrition-knowledge.mjs';
const bundle=loadNutritionKnowledge();
console.log(JSON.stringify({passed:true,kind:'frozen_runtime_knowledge',version:bundle.manifest.version,contentHash:bundle.manifest.contentHash}));
