import type {NutritionTargetMetadata,NutritionField} from './nutrition-types';
export type * from './nutrition-types';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Nutrients = { energyKcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null; sugarG: number | null; sodiumMg: number | null; calciumMg: number | null; ironMg: number | null; potassiumMg: number | null; vitaminCMg: number | null };
export interface Item { name: string; grams: number; nutrients: Nutrients; source: 'manual' | 'photo' | 'chat'; estimated: boolean; nutritionSource: string; photoId: string | null; note: string }
export interface Entry extends Item { id: string; date: string; meal: Meal; createdAt: string; updatedAt: string }
export interface Food { favorite?:boolean; id: string; name: string; emoji: string; servingGrams: number; source: string; nutrientsPer100g: Nutrients }
export interface Settings { dailyGoal: number | null; chatModel: string; visionModel: string }
export interface Profile { heightCm: number; weightKg: number; age: number; sex: 'male' | 'female' | 'undisclosed'; goal: 'lose' | 'gain' | 'maintain' | 'recompose'; activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive' | null; targetWeightKg: number | null; updatedAt?: string; weightDate?: string }
export interface NutritionTarget extends NutritionTargetMetadata { id?: string; nutrients: Nutrients; waterMl: number | null; explanation: string; startDate?: string; date?: string; scope?: 'day' | 'future'; source?: 'manual' | 'ollama' | 'rule_kb'; createdAt?: string }
export const measurementLabels = { weightKg: ['体重','kg'], bodyFatPct: ['体脂率','%'], chestCm: ['胸围','cm'], waistCm: ['腰围','cm'], armCm: ['上臂围','cm'], hipCm: ['臀围','cm'], thighCm: ['大腿围','cm'], calfCm: ['小腿围','cm'], waterMl: ['饮水','ml'], steps: ['步数','步'], exerciseMinutes: ['运动时长','分钟'], exerciseKcal: ['运动消耗','kcal'] } as const;
export type MeasurementKey = keyof typeof measurementLabels;
export type Measurement = { [key in MeasurementKey]: number | null } & { date: string; updatedAt?: string; measurementConditions?: NutritionField<'morning_fasted'|'consistent_other'|'inconsistent'> };
export const emptyMeasurement = (date: string): Measurement => ({ date, ...Object.fromEntries(Object.keys(measurementLabels).map(key => [key,null])) }) as Measurement;
export interface DayData { exercises?: {id:string;date:string;createdAt:string;items:{name:string;details:string;energyKcal:number|null;basis:string}[]}[]; bodyProfile?: any; measurement: Measurement; history: Measurement[]; target: NutritionTarget | null }
export interface CalendarDay { date: string; entries?: number; body?: boolean; bodyProfile?: boolean; target?: boolean }
export interface Connection { base: string; token: string; serverId?: string }
export interface Draft { date: string; meal: Meal; items: Item[] }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; entryIds: string[]; records?: Entry[]; draft?: Draft | null; pinned?:boolean; sendState?:'queued'|'sent'|'error' }
export const blankNutrients = (): Nutrients => ({ energyKcal: null, proteinG: null, carbsG: null, fatG: null, fiberG: null, sugarG: null, sodiumMg: null, calciumMg: null, ironMg: null, potassiumMg: null, vitaminCMg: null });
export const mealNames: Record<Meal, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
export const nutrientLabels: Record<keyof Nutrients, [string, string]> = { energyKcal: ['热量', 'kcal'], proteinG: ['蛋白质', 'g'], carbsG: ['碳水', 'g'], fatG: ['脂肪', 'g'], fiberG: ['膳食纤维', 'g'], sugarG: ['总糖', 'g'], sodiumMg: ['钠', 'mg'], calciumMg: ['钙', 'mg'], ironMg: ['铁', 'mg'], potassiumMg: ['钾', 'mg'], vitaminCMg: ['维生素 C', 'mg'] };
export const uid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export const scaleNutrients = (nutrients: Nutrients, ratio: number): Nutrients => Object.fromEntries(Object.entries(nutrients).map(([key, value]) => [key, value === null ? null : value * ratio])) as Nutrients;
