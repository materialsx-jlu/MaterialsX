import { AgentError } from '../../contracts/src/agent.js';
import type { AlphaRequest, AlphaTask, CloudCatalog } from '../../contracts/src/platform.js';
/** A terminal stream alone cannot authorize tools or claim paid completion. */
export function assertPlatformReceipt(receipt: AlphaRequest, requestId: string, task: AlphaTask, catalog: CloudCatalog, wireUsage?: unknown) {
    const price = task.billingMode === 'paid-credits' ? catalog.paidPricing : task.billingMode === 'test-credits' ? catalog.testPricing : null;
    const mxModel = task.billingMode === 'mx-points' ? catalog.items.find(item => item.id === task.modelId && item.accessMode === 'mx-points') : null;
    if (receipt.id !== requestId || receipt.taskId !== task.id || receipt.modelId !== task.modelId || receipt.billingMode !== task.billingMode ||
        price && (receipt.routeVersionId !== price.routeVersionId || receipt.salesPriceVersionId !== price.id) ||
        task.billingMode === 'mx-points' && (!mxModel || receipt.routeVersionId !== mxModel.routeVersionId || receipt.salesPriceVersionId !== mxModel.salesPriceVersionId))
        throw new AgentError('RECONCILIATION_REQUIRED', '平台回执身份或计费版本不匹配；不会重复调用供应商 / Receipt identity or price mismatch');
    if (receipt.execution === 'failed' && receipt.terminalReceived) {
        if (receipt.errorCode === 'TASK_BUDGET_EXCEEDED') throw new AgentError('BUDGET_EXCEEDED', '供应商返回的输出 Token 超过本次请求上限；真实用量已保留，未自动重试 / Supplier output exceeded request limit');
        throw new AgentError('EXECUTION_FAILED', '供应商已确认请求失败；未执行该响应的工具 / Confirmed supplier failure');
    }
    if (wireUsage !== undefined) {
        const raw = wireUsage as any;
        if (!raw || raw.input_tokens !== receipt.usage?.inputTokens || raw.output_tokens !== receipt.usage?.outputTokens || raw.input_tokens_details?.cached_tokens !== undefined && raw.input_tokens_details.cached_tokens !== receipt.usage?.cachedInputTokens)
            throw new AgentError('RECONCILIATION_REQUIRED', '平台流用量与账本回执不一致 / Stream and receipt usage mismatch');
    }
    if (!receipt.dispatched || receipt.execution !== 'completed' || !receipt.terminalReceived || receipt.usage?.inputTokens == null || receipt.usage.outputTokens == null ||
        (task.billingMode === 'alpha-test' ? receipt.settlement !== 'not_billed' : receipt.settlement !== 'settled'))
        throw new AgentError('RECONCILIATION_REQUIRED', '平台响应未完成或用量待核对；不会重复调用供应商 / Unconfirmed usage');
}
