import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scienceInputGuidance} from './science-input-guidance.js';
const request='自动选择合适的机器学习势，优先使用已安装模型，执行最多 3 步固定晶胞弛豫，输出能量、原子受力、收敛状态、报告和 3D 结构。';
const scope={projectId:'project',conversationId:'conversation',structureId:'si',permission:'relaxation' as const,domain:'inorganic-crystals' as const,mode:'exploratory' as const};
const analysis={projectId:'project',conversationId:'conversation',structureId:'si',permission:'relaxation' as const,maxSteps:3,maxDownloadBytes:0};
test('copied automatic prompt requests structure setup rather than inventing a target or calling a model',()=>{
  assert.match(scienceInputGuidance(request)!,/需要先选择/);
  assert.match(scienceInputGuidance(request)!,/本轮尚未运行计算/);
  assert.equal(scienceInputGuidance(request,scope,analysis),null);
  assert(scienceInputGuidance(request,scope,{...analysis,structureId:'other'}));
  assert(scienceInputGuidance(request,scope,{...analysis,permission:'singlepoint'}));
  assert.match(scienceInputGuidance('Automatically choose a potential and run a fixed-cell relaxation')!,/Choose the atomic structure/);
});
test('ordinary science advice and other automatic research tasks remain available',()=>{
  for(const request of ['机器学习势有什么作用？','MaterialsX 会自动调用对应的机器学习势解决模拟问题吗？','自动选择统计方法，执行分析','如何设计水性制冷涂料','搜索 MOOS 配方'])assert.equal(scienceInputGuidance(request),null);
});
