import {z} from 'zod';
/** Bounded source-derived proposals; novel process routes require an explicit research plan. */
export const preparationOption=z.enum(['follow_source','check_dispersion','check_viscosity','trial_coating','repeat_batches']);
export const verificationOption=z.enum(['composition','dispersion','optics','cooling','adhesion','durability','repeatability']);
export const preparationText:Record<z.infer<typeof preparationOption>,string>={
 follow_source:'按本次建议用量表备料，以原文的混合、加料和涂覆顺序作为小试起点。修改配比后，原文参数不能直接视为已验证条件；未记录的转速、设备、电场和新增用量需要另行制定方案。',
 check_dispersion:'先检查分散均匀性、团聚和沉降；分散方法与条件需要依据来源及实际设备确认，不擅自添加外部电场。',
 check_viscosity:'涂覆前检查黏度与施工适应性。补加溶剂或水时，应先修订建议用量表并记录实际加入量，不能在工艺文字中隐含额外用量。',
 trial_coating:'先在小试基材上比较成膜、厚度与附着；基材处理和干燥条件以原文作参考，未记录条件需确认后再安排。',
 repeat_batches:'分别制备独立批次并记录实际配比、过程条件及异常，评估可重复性；不将重复测量当作独立制备批次。',
};
export const verificationText:Record<z.infer<typeof verificationOption>,string>={
 composition:'核对组分身份、原单位、实际加入量与乳液固含量/密度；资料不全时不计算或宣称准确的干态体积分数。',
 dispersion:'检查分散状态、团聚、沉降与储存稳定性，保留测试方法和原始记录。',
 optics:'分别测量太阳光谱反射和红外发射，记录仪器、波段、膜厚和测试条件；两者不能混作同一指标。',
 cooling:'在有对照的热平衡测试中记录辐照、天气、温湿度、风速及表面温度等条件；温差不能直接当作冷却功率，不预设性能保证。',
 adhesion:'评估涂层附着、成膜和机械完整性，记录基材、测试方法与原始结果。',
 durability:'评估耐水、耐候及老化前后的变化，测试条件和合格门槛需另行确定。',
 repeatability:'比较独立制备批次，保留原始测量及误差信息，避免将单次结果宣称为稳定性能。',
};
