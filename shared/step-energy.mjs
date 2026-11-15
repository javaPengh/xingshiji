// User-approved approximation: 0.7 m/step; net level-walking cost 0.5 kcal/kg/km.
// Display estimate only: never add it to dietary targets or exercise records.
export function estimateStepEnergy(steps,weightKg){
 const validSteps=Number.isSafeInteger(steps)&&steps>=0&&steps<=200000;
 const validWeight=typeof weightKg==='number'&&Number.isFinite(weightKg)&&weightKg>=20&&weightKg<=500;
 const distanceKm=validSteps?steps*0.7/1000:null;
 return {steps:validSteps?steps:null,weightKg:validWeight?weightKg:null,distanceKm,energyKcal:distanceKm!==null&&validWeight?Math.round(weightKg*distanceKm*0.5):null};
}
