import {z} from 'zod';
export const recoveryKindSchema=z.enum(['arguments','protocol','transport','script','environment','source','capability','job-pending','operation-unknown','permission','budget','science-scope','acceptance','step-selection','plan-required','receipt-exists','cancelled','internal']);
export const recoveryFaultSchema=z.strictObject({
 kind:recoveryKindSchema,phase:z.enum(['rejected','completed','pending','unknown']),
 next:z.enum(['correct-arguments','repair-response','inspect-script','check-environment','supplement-source','discover-capability','query-original','reconcile','stop','verify-delivery','select-step','plan','inspect-receipt']),
 dispatched:z.literal(false).optional(),tool:z.string().max(128).optional(),receiptId:z.string().max(256).optional(),
 issues:z.array(z.strictObject({path:z.string().max(256),code:z.string().max(80),expected:z.string().max(256)})).max(8).optional(),
 parameters:z.record(z.string(),z.unknown()).optional(),
});
export type RecoveryFault=z.infer<typeof recoveryFaultSchema>;
export type RecoveryKind=z.infer<typeof recoveryKindSchema>;
export const recoveryLabels:Record<RecoveryKind,{zh:string;en:string}>={
 arguments:{zh:'工具参数需要修正',en:'Tool arguments rejected'},protocol:{zh:'模型响应格式无效',en:'Invalid model response'},
 transport:{zh:'模型服务或网关连接失败',en:'Model service or gateway connection failed'},
 script:{zh:'脚本运行失败',en:'Script failed'},environment:{zh:'受管环境需要检查',en:'Check managed environment'},
 source:{zh:'研究来源不足',en:'Missing source evidence'},capability:{zh:'当前能力尚不可用',en:'Capability unavailable'},
 'job-pending':{zh:'原计算尚未结束',en:'Original job pending'},'operation-unknown':{zh:'原操作结果待核对',en:'Original result unknown'},
 permission:{zh:'操作超出本轮授权',en:'Permission boundary'},budget:{zh:'恢复或运行预算已用尽',en:'Recovery or task budget exhausted'},
 'science-scope':{zh:'超出支持的物理范围',en:'Unsupported physical scope'},acceptance:{zh:'交付尚未通过核验',en:'Delivery not verified'},
 'step-selection':{zh:'需要选择已就绪步骤',en:'Select a ready step'},'plan-required':{zh:'需要绑定研究方法',en:'Research method required'},
 'receipt-exists':{zh:'已有真实回执',en:'Verified receipt exists'},cancelled:{zh:'任务已停止',en:'Task stopped'},internal:{zh:'操作失败，结果需要检查',en:'Inspect failed operation'},
};
export const recoveryBudgetSchema=z.strictObject({corrections:z.number().int().nonnegative(),total:z.number().int().nonnegative(),progress:z.array(z.string()).max(64),lastFault:recoveryFaultSchema});
