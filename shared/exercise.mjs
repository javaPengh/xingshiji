import {z} from 'zod';
import {dateSchema} from './dates.mjs';
export const exerciseItemSchema=z.strictObject({name:z.string().trim().min(1).max(120),details:z.string().trim().min(1).max(2000),energyKcal:z.number().int().nonnegative().max(30000).nullable(),basis:z.string().trim().min(1).max(2000)});
export const exerciseOutputSchema=z.strictObject({items:z.array(exerciseItemSchema).max(30)});
export const exerciseProfileSchema=z.strictObject({weightKg:z.number().positive().nullable(),heightCm:z.number().positive().nullable(),ageYears:z.number().positive().nullable(),sex:z.enum(['male','female']).nullable()});
export const exerciseRecordSchema=z.strictObject({id:z.string().uuid(),date:dateSchema,createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),items:z.array(exerciseItemSchema).min(1).max(30),bodyProfile:exerciseProfileSchema,sourceText:z.string().max(6000)});
export function isExerciseRequest(text){
 if(!text)return false;
 const explicit=/(运动|训练|锻炼).{0,6}(消耗|热量|记录)|记录.{0,12}(运动|训练|锻炼)/.test(text);
 const activity=/(侧平举|划船|卧推|深蹲|硬拉|推举|引体|俯卧撑|卷腹|举铁|跑步|跑了|慢跑|步行|走路|散步|快走|爬坡|爬楼|骑行|骑车|游泳|跳绳|椭圆机|波比|平板支撑|瑜伽|普拉提|打球|篮球|足球|羽毛球|乒乓球|网球|健身|力量训练|有氧|抗阻|练胸|练腿|练背|练肩|腿举|臀推|弯举|飞鸟|高位下拉|滑雪|登山|徒步|攀岩|拳击|开合跳|跳操|跳舞|拉伸|推胸|训练|锻炼)/.test(text);
 if(!explicit&&/(吃|喝|饮食|餐食|摄入)/.test(text))return false;
 return explicit||(activity&&/(消耗|热量|大卡|卡路里|\d|记录|记下|记一下)/.test(text));
}
export const shouldRecordExercise=text=>/(记录|记下|记一下|记一笔|记上|记到)/.test(text)&&!/(不要.{0,3}记|不记录|不需要.{0,3}记|无需.{0,3}记|不用.{0,3}记|别.{0,3}记|先不.{0,3}记|暂不.{0,3}记|怎么.{0,6}记录|如何.{0,6}记录|打算|计划|假如|如果|准备|明天|后天)/.test(text);
export function exerciseSummary(items){const known=items.filter(i=>i.energyKcal!==null);return {energyKcal:known.length?known.reduce((sum,i)=>sum+i.energyKcal,0):null,unknown:items.length-known.length,count:items.length};}
export function exerciseReply(items,recorded=false){const s=exerciseSummary(items);if(!items.length)return '未识别到可记录的运动项目。';return `${recorded?'已记录':'本次识别到'}${s.count}项运动，${s.energyKcal===null?'消耗暂无法估算':`估算消耗${s.unknown?'已知部分':''}约${s.energyKcal}大卡`}${s.unknown?`，其中${s.unknown}项待估算`:''}。\n${items.map(i=>`${i.name}：${i.energyKcal===null?'暂无法估算':`约${i.energyKcal}大卡`}；${i.details}`).join('\n')}`;}
