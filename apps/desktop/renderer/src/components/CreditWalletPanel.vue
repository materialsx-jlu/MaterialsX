<script setup lang="ts">
import {onMounted,ref,computed} from 'vue';
import type {CreditWallet,PlatformCreditEntry} from '../../../../../packages/contracts/src/platform.js';
const props=withDefaults(defineProps<{locale?:'zh'|'en';compact?:boolean}>(),{locale:'zh',compact:false});
const t=(zh:string,en:string)=>props.locale==='zh'?zh:en;
const wallet=ref<CreditWallet|null>(null),entries=ref<PlatformCreditEntry[]>([]),cursor=ref<string|null>(null),error=ref(''),busy=ref(false);
async function refresh(){busy.value=true;try{wallet.value=await window.materialsx.getCreditWallet();const page=await window.materialsx.getCreditLedger();entries.value=page.items;cursor.value=page.nextCursor;error.value=''}catch{wallet.value=null;entries.value=[];error.value='unavailable'}finally{busy.value=false}}
async function more(){if(!cursor.value)return;busy.value=true;try{const page=await window.materialsx.getCreditLedger(cursor.value);entries.value.push(...page.items);cursor.value=page.nextCursor}catch{error.value='unavailable'}finally{busy.value=false}}
const names=computed<Record<string,string>>(()=>({grant:t('积分发放','Credit grant'),reserve:t('调用预留','Call reservation'),settle:t('用量结算','Usage settlement'),release:t('未调用释放','No-call release'),waiver:t('平台承担','Platform waiver'),pending:t('待核对','Reconciliation pending'),refund_freeze:t('退款冻结','Refund freeze'),refund_release:t('退款冻结释放','Refund freeze release'),refund:t('退款积分回收','Refund credit recovery')}));
onMounted(refresh);
</script>
<template>
 <section class="credit-wallet-panel catalog-panel"><div class="heading catalog-panel-heading"><strong>{{t('平台额度 · PostgreSQL 账本','Platform credits · PostgreSQL ledger')}}</strong><button class="secondary-button" :disabled="busy" @click="refresh">{{t('刷新钱包','Refresh wallet')}}</button></div>
 <p>{{t('真实支付积分与 test-credit 测试额度分开记录；真实付费调用按 0.0001 积分精度结算。','Paid credits and test credits are separate. Paid calls settle to 0.0001 credit precision.')}}</p>
 <p v-if="error" role="status">{{t('请登录平台账户并连接 M5 服务，查看额度记录。','Sign in and connect to the M5 service to view credit records.')}}</p>
 <template v-if="wallet">
 <div v-if="wallet.purchased" class="wallet-group"><h4>{{t('真实支付积分','Paid credits')}}</h4><div class="totals"><div class="wallet-metric"><span>{{t('可用','Available')}}</span><b>{{wallet.purchased.availableCredits}}</b></div><div class="wallet-metric"><span>{{t('预留','Held')}}</span><b>{{wallet.purchased.heldCredits}}</b></div><div class="wallet-metric"><span>{{t('已消耗','Consumed')}}</span><b>{{wallet.purchased.consumedCredits}}</b></div><div class="wallet-metric"><span>{{t('退款冻结 / 回收','Refund frozen / returned')}}</span><b>{{wallet.purchased.refundFrozenCredits}} / {{wallet.purchased.returnedCredits}}</b></div></div></div>
 <div class="wallet-group"><h4>{{t('测试额度','Test credits')}} <small>test-credit</small></h4><div class="totals"><div class="wallet-metric"><span>{{t('可用','Available')}}</span><b>{{wallet.availableCredits}}</b></div><div class="wallet-metric"><span>{{t('预留','Held')}}</span><b>{{wallet.heldCredits}}</b></div><div class="wallet-metric"><span>{{t('已结算','Consumed')}}</span><b>{{wallet.consumedCredits}}</b></div><div class="wallet-metric"><span>{{t('退款冻结 / 回收','Refund frozen / returned')}}</span><b>{{wallet.refundFrozenCredits}} / {{wallet.returnedCredits}}</b></div></div></div>
 <p>{{t('待核对','Pending reconciliation')}} {{wallet.pendingRequests}} · {{t('日上限','Daily limit')}} {{wallet.dailyLimit??t('未授予','Not granted')}} · {{t('月上限','Monthly limit')}} {{wallet.monthlyLimit??t('未授予','Not granted')}} (UTC). {{t('未知用量保留预留；过期批次不会恢复为可用额度。','Unknown usage retains its hold. Expired grants do not become available again.')}}</p>
 <details :open="!props.compact"><summary>{{t("额度流水","Credit ledger")}} · {{entries.length}}</summary>
 <div class="ledger" v-for="entry in entries" :key="entry.id"><span>{{names[entry.kind]}} · {{entry.unit}} · {{new Date(entry.createdAt).toLocaleString(props.locale==='zh'?'zh-CN':'en-US')}}<small>{{entry.requestId??entry.grantId}}</small></span><span>{{t('授予','Granted')}} {{entry.grantedDelta}} / {{t('预留','Held')}} {{entry.heldDelta}} / {{t('消耗','Consumed')}} {{entry.consumedDelta}} / {{t('退款冻结','Refund frozen')}} {{entry.frozenDelta}} / {{t('回收','Returned')}} {{entry.returnedDelta}}</span></div>
 <p v-if="!entries.length">{{t('暂无平台额度记录。','No credit entries.')}}</p><button v-if="cursor" class="secondary-button" :disabled="busy" @click="more">{{t('加载更多记录','Load more entries')}}</button></details></template>
 </section>
</template>
<style scoped>
.wallet-group { margin: 18px 0; }
h4 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 12px; font-weight: 600; }
.totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.wallet-metric { min-width: 0; padding: 15px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel-2); }
.wallet-metric span { display: block; color: var(--muted); font-size: 10px; }
.wallet-metric b { display: block; margin-top: 12px; font-size: 21px; font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
p { color: var(--muted); line-height: 1.65; font-size: 11px; }
small { display: block; color: var(--dim); font-size: 9px; overflow-wrap: anywhere; }
.ledger { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 10px; padding: 12px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; line-height: 1.6; }
.ledger small { margin-top: 4px; }
summary { font-size: 11px; cursor: pointer; color: var(--muted); padding: 8px 0; }
@media (max-width: 1100px) { .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .totals { grid-template-columns: 1fr; } }
</style>
