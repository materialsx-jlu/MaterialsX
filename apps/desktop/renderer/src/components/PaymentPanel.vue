<script setup lang="ts">
import {onMounted,onUnmounted,ref,computed,watch} from "vue";
import QRCode from "qrcode";
import type {PaymentPlans,PaymentOrder,PaymentRefund,SubscriptionPeriod} from "../../../../../packages/contracts/src/platform.js";
const props=withDefaults(defineProps<{locale?:"zh"|"en"}>(),{locale:"zh"});
const t=(zh:string,en:string)=>props.locale==="zh"?zh:en;
const emit=defineEmits<{updated:[]}>();
const plans=ref<PaymentPlans|null>(null),orders=ref<PaymentOrder[]>([]),periods=ref<SubscriptionPeriod[]>([]),selected=ref<PaymentOrder|null>(null),refunds=ref<PaymentRefund[]>([]),cursor=ref<string|null>(null),busy=ref(false),message=ref(""),refundFen=ref(""),reason=ref("");
const salesPaused=ref(false),qr=ref(""),now=ref(Date.now());
const formalLive=computed(()=>plans.value?.mode==="wechat-native"&&plans.value.formalSalesEnabled);
const livePilot=computed(()=>plans.value?.mode==="wechat-pilot");
const checkoutCode=computed(()=>selected.value?.channel==="wechat"&&selected.value.state==="pending"&&!selected.value.closeRequested&&new Date(selected.value.expiresAt).getTime()>now.value?selected.value.codeUrl:null);
watch(checkoutCode,async code=>{qr.value="";if(!code||!/^weixin:\/\/wxpay\/[^\s]{1,2000}$/.test(code))return;try{const result=await QRCode.toDataURL(code,{width:280,margin:4,errorCorrectionLevel:"M"});if(checkoutCode.value===code)qr.value=result}catch{message.value=t("二维码生成失败，请刷新订单。","QR generation failed. Refresh the order.")}}, {immediate:true});
let timer:ReturnType<typeof setInterval>|undefined;
const purchaseKeys=new Map<string,string>();const refundKeys=new Map<string,string>();
const states=computed<Record<string,string>>(()=>({pending:t("待付款","Awaiting payment"),paid:t("已付款","Paid"),closed:t("已关闭","Closed"),refund_pending:t("退款执行中","Refund in progress"),partially_refunded:t("部分退款","Partially refunded"),refunded:t("已退款","Refunded"),requested:t("待审批","Requested"),reviewing:t("审核中","Reviewing"),approved:t("已批准","Approved"),rejected:t("已拒绝","Rejected"),not_started:t("尚未提交渠道","Not submitted"),submitting:t("提交渠道中","Submitting"),succeeded:t("退款成功","Refund succeeded"),failed:t("退款失败","Refund failed"),active:t("生效中","Active"),expired:t("已到期","Expired"),canceled:t("已取消","Canceled"),suspended:t("已暂停","Suspended")}));
const periodStates=computed<Record<string,string>>(()=>({...states.value,pending:t("待生效","Scheduled")}));const executionStates=computed<Record<string,string>>(()=>({...states.value,pending:t("渠道处理中","Channel processing")}));
function fen(value:string){const n=BigInt(value);return `${n/100n}.${(n%100n).toString().padStart(2,"0")}`}
async function detail(order:PaymentOrder){selected.value=order;refunds.value=[];refundFen.value=(BigInt(order.amountFen)-BigInt(order.refundedFen)).toString();reason.value="";refunds.value=(await window.materialsx.getPaymentRefunds(order.id)).items}
async function refresh(){const [p,page,sub,s]=await Promise.all([window.materialsx.getPaymentPlans(),window.materialsx.getPaymentOrders(),window.materialsx.getSubscriptionPeriods(),window.materialsx.getWorkspaceStatus()]);salesPaused.value=s.controls.salesPaused;plans.value=p;orders.value=page.items;cursor.value=page.nextCursor;periods.value=sub.items;if(selected.value){const fresh=orders.value.find(o=>o.id===selected.value?.id);if(fresh){selected.value=fresh;refunds.value=(await window.materialsx.getPaymentRefunds(fresh.id)).items}}emit('updated')}
async function action(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;message.value="";try{await fn()}catch{message.value=t("操作未完成，请检查登录和服务连接后刷新。提交结果不明时请保留原订单，勿重复创建。","Operation incomplete. Check sign-in and connection, then refresh. Keep the existing order if the outcome is unknown.")}finally{busy.value=false}}
async function buy(id:string){await action(async()=>{if((plans.value?.mode!=="test"&&plans.value?.mode!=="wechat-pilot"&&!formalLive.value)||salesPaused.value)return;const key=purchaseKeys.get(id)??crypto.randomUUID();purchaseKeys.set(id,key);const order=await window.materialsx.createPaymentOrder(id,key);purchaseKeys.delete(id);await refresh();await detail(order);message.value=order.channel==="wechat"?t("已创建真实支付订单，请核对金额后微信扫码。付款验签后自动到账。","Real payment order created. Check the amount and scan with WeChat. Credits arrive after verified payment."):t("已创建测试订单。没有发生扣款；仅管理员可在测试后台模拟付款。","Test order created. No money was charged. Only an administrator may simulate payment.")})}
async function applyRefund(){await action(async()=>{const order=selected.value;if(!order)return;if(!/^[1-9][0-9]{0,18}$/.test(refundFen.value)||BigInt(refundFen.value)>BigInt(order.amountFen)-BigInt(order.refundedFen)||!reason.value.trim()){message.value=t("请填写可退范围内的正整数金额（分）和退款原因。","Enter a positive integer in CNY fen within the refundable amount, and a refund reason.");return};const request={amountFen:refundFen.value,reason:reason.value.trim()};const fingerprint=JSON.stringify([order.id,request]);const key=refundKeys.get(fingerprint)??crypto.randomUUID();refundKeys.set(fingerprint,key);await window.materialsx.requestPaymentRefund(order.id,request,key);refundKeys.delete(fingerprint);await refresh();message.value=t("退款申请已提交，等待人工核算和审批。退款成功后回收对应积分。","Refund requested, awaiting manual review and approval. Corresponding credits are recovered after channel success.")})}
async function closeOrder(){await action(async()=>{if(!selected.value)return;selected.value=await window.materialsx.closePaymentOrder(selected.value.id,crypto.randomUUID());message.value=t("已申请关闭，需等待渠道查询确认；若已支付仍会如实记账。","Closure requested; awaiting channel confirmation. A completed payment will still be recorded.")})}
async function queryOrder(){await action(async()=>{if(!selected.value)return;await window.materialsx.queryPaymentOrder(selected.value.id,crypto.randomUUID());message.value=t("已请求渠道查询，请稍后刷新。","Channel query requested. Refresh shortly.")})}
async function more(){await action(async()=>{if(!cursor.value)return;const page=await window.materialsx.getPaymentOrders(cursor.value);orders.value.push(...page.items);cursor.value=page.nextCursor})}
async function exportOrders(){await action(async()=>{let next:string|undefined;let pages=0;do{const v=await window.materialsx.exportPaymentOrders(next);if(!v.saved)return;pages++;next=v.nextCursor??undefined;if(next&&!confirm(t("还有更多历史订单，继续保存下一页 CSV？","More historical orders exist. Save the next CSV page?")))break}while(next);message.value=t(`已保存 ${pages} 页订单记录，每页最多 50 条。`,`Saved ${pages} pages, up to 50 orders per page.`)})}
onMounted(()=>{void action(refresh);timer=setInterval(()=>{now.value=Date.now();if(!busy.value&&document.visibilityState==='visible'&&orders.value.some(o=>o.state==='pending'||o.state==='refund_pending'))void action(refresh)},5000)});
onUnmounted(()=>{if(timer)clearInterval(timer)});
</script>
<template>
<section class="payment-panel catalog-panel">
 <div class="heading catalog-panel-heading"><h3>{{t("平台订阅与订单","Platform subscriptions and orders")}}</h3><button class="secondary-button" :disabled="busy" @click="action(refresh)">{{t("刷新","Refresh")}}</button><button class="secondary-button" :disabled="busy" @click="exportOrders">{{t("导出订单 CSV","Export orders CSV")}}</button></div>
 <p v-if="livePilot">{{t("真实支付联调：仅授权的本机账户可支付一次 ¥1，到账 1000 积分并激活一个自然月订阅。真实积分与测试额度分开；模型付费消耗尚未开启。","Real payment pilot: the authorized local account can pay ¥1 once for 1000 credits and one calendar month. Paid credits are separate from test credits; paid model usage is not enabled.")}}</p>
 <p v-else>{{t("当前新收款未开放。已完成的微信联调订单和订阅仍可查询，真实积分单独显示；测试订单不产生真实支付。开票与报销服务尚未提供。","New payments are disabled. Existing WeChat pilot orders and subscriptions remain visible, with paid credits recorded separately. Test orders are synthetic. Invoicing is unavailable.")}}</p>
 <p v-if="salesPaused">{{t("新订单已暂停，原有订单仍可查询和退款。","New orders are paused. Existing orders remain queryable and refundable.")}}</p>
 <p v-if="message" class="status" role="status">{{message}}</p>
 <div v-if="plans" class="products catalog-grid"><article v-for="p in plans.items" :key="p.id" class="payment-product"><strong>{{p.name}}</strong><p>{{p.kind==='subscription'?t("月度订阅 · 手动续费","Monthly subscription \u00b7 manual renewal"):t("积分包","Credit pack")}} · {{p.credits}} {{p.testOnly?"test-credit":t("积分","paid-credit")}}</p><b>{{p.testOnly?t("测试标价","Test price"):t("实付金额","Amount payable")}} ¥{{fen(p.priceFen)}}</b><p>{{p.kind==='subscription'?t("自然月账期，续费从下一账期开始，额度到生效时间才可使用。","Calendar-month periods; renewal starts next period. Credits become available at period start."):t(`${p.validDays} 天有效，按批次管理。`,`${p.validDays} days validity, managed by grant.`)}}</p><small>{{t("退款规则","Refund policy")}} {{p.refundPolicyVersion}} · {{t("仅回收原订单未消耗积分","Recovers unused credits from the original order only")}}</small><button class="primary-button" :disabled="busy||(plans.mode!=='test'&&plans.mode!=='wechat-pilot'&&!formalLive)||salesPaused||(livePilot&&!p.testOnly&&orders.some(o=>o.product.id===p.id))" @click="buy(p.id)">{{p.testOnly?t("创建测试订单","Create test order"):t(`微信支付 ¥${fen(p.priceFen)}`,`Pay ¥${fen(p.priceFen)} with WeChat`)}}</button></article></div>
 <p v-if="plans&&!plans.items.length">{{t("尚未发布套餐。套餐由服务端发布，价格和规则随订单保存。","No plans published. Server-issued prices and policies are frozen in each order.")}}</p>
 <div v-if="periods.length"><h4>{{t("订阅账期","Subscription periods")}}</h4><p v-for="p in periods" :key="p.orderId">{{p.productId}} · {{periodStates[p.state]}} · {{new Date(p.startsAt).toLocaleString()}} {{t("至","to")}} {{new Date(p.endsAt).toLocaleString()}}</p></div>
 <h4>{{t("订单记录","Order history")}}</h4><div v-for="o in orders" :key="o.id" class="order"><button class="secondary-button" :disabled="busy" @click="action(()=>detail(o))">{{o.product.name}} · {{states[o.state]}}</button><span>¥{{fen(o.amountFen)}} · {{t("已退","Refunded")}} ¥{{fen(o.refundedFen)}} · {{o.channel==='wechat'?t("微信真实支付","Real WeChat payment"):t("测试订单","Test order")}}</span><small>{{o.id}}</small></div>
 <p v-if="!orders.length">{{t("暂无订单。","No orders.")}}</p><button v-if="cursor" :disabled="busy" class="secondary-button" @click="more">{{t("更多历史订单","More orders")}}</button>
 <article v-if="selected" class="detail"><h4>{{t("订单","Order")}} {{selected.id}}</h4><p>{{states[selected.state]}} · {{t("创建于","Created")}} {{new Date(selected.createdAt).toLocaleString()}} · {{t("待付截止","Payment deadline")}} {{new Date(selected.expiresAt).toLocaleString()}}</p>
 <div v-if="selected.channel==='wechat'&&selected.state==='pending'" class="checkout"><p>{{t("微信扫码支付","Scan with WeChat")}} ¥{{fen(selected.amountFen)}} · {{selected.product.credits}} {{t("积分","credits")}}</p><img v-if="qr" :src="qr" :alt="t('微信付款二维码','WeChat payment QR code')" width="280" height="280" /><p v-else>{{t("等待付款二维码，或订单已过期/正在关闭，请刷新订单状态。","Awaiting QR code, or order expired/closing. Refresh order status.")}}</p></div>
 <p v-if="selected.channel==='test'&&selected.state==='pending'">{{t("这是测试订单，不提供付款二维码。关闭窗口或刷新页面不会发放积分。查询与渠道通知由服务端核验。","This is a test order without a payment QR code. Closing or refreshing the page does not grant credits. The server verifies queries and channel notifications.")}}</p>
 <button v-if="selected.state==='pending'||selected.state==='refund_pending'" :disabled="busy" class="secondary-button" @click="queryOrder">{{t("请求服务端查询","Request channel query")}}</button>
 <button v-if="selected.state==='pending'" :disabled="busy||selected.closeRequested" class="secondary-button" @click="closeOrder">{{selected.closeRequested?t("等待关闭确认","Awaiting closure"):t("取消待付订单","Cancel unpaid order")}}</button>
 <form v-if="selected.state==='paid'||selected.state==='partially_refunded'" @submit.prevent="applyRefund"><h4>{{t("申请退款","Request refund")}}</h4><label>{{t("退款金额（人民币分）","Refund amount (CNY fen)")}}<input v-model="refundFen" :readonly="selected.product.refundRule==='unused-full-v1'" inputmode="numeric" pattern="[1-9][0-9]*" required /></label><label>{{t("原因","Reason")}}<textarea v-model="reason" maxlength="256" required /></label><p v-if="selected.product.refundRule==='unused-full-v1'">{{t("仅支持完全未使用订单全额退款。任何预留或消费都将阻止批准；订阅退款成功后终止对应权益。","Only fully unused orders qualify for full refunds. Any hold or consumption blocks approval; the related subscription ends after refund success.")}}</p><p v-else>{{t("联调退款规则：积分包按累计退款比例向上取整；订阅仅支持未消耗、没有后续续费账期的全额退款。任务预留或待核对时暂停批准。","Pilot policy: credit packs use cumulative proportional rounding up. Subscriptions permit only unused full refunds without subsequent renewals. Holds or pending reconciliation block approval.")}}</p><button :disabled="busy" class="secondary-button">{{t("提交申请","Submit request")}}</button></form>
 <div v-for="r in refunds" :key="r.id" class="refund"><strong>¥{{fen(r.amountFen)}} · {{states[r.approval]}} · {{executionStates[r.execution]??r.execution}}</strong><p>{{r.reason}} · {{t("本次核算","Reviewed credits")}} {{r.frozenCredits}} {{selected.channel==='wechat'?"paid-credit":"test-credit"}}</p><small>{{r.id}}</small></div>
 </article>
</section>
</template>
<style scoped>
.checkout img { display: block; max-width: 100%; height: auto; background: #fff; border-radius: 8px; }
.payment-panel.embedded { padding: 0; margin: 16px 0 0; border: 0; background: transparent; }
.products { margin: 18px 0; }
.payment-product { min-width: 0; padding: 15px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel-2); }
.payment-product > strong { font-size: 12px; }
.payment-product > b { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.products button { display: flex; margin-top: 16px; }
p { color: var(--muted); line-height: 1.65; font-size: 11px; }
small { display: block; color: var(--dim); line-height: 1.65; font-size: 9px; }
h4 { margin: 20px 0 10px; font-size: 12px; font-weight: 600; }
.status { padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); }
.order { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; }
.order, .refund { border-top: 1px solid var(--line); padding: 12px 0; font-size: 11px; }
.order small { width: 100%; overflow-wrap: anywhere; }
.detail { margin-top: 18px; padding: 15px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel-2); overflow-wrap: anywhere; }
.detail > h4:first-child { margin-top: 0; }
.detail > button + button { margin-left: 8px; }
label { display: block; margin: 12px 0; color: var(--muted); font-size: 11px; }
input, textarea { display: block; width: min(100%, 420px); padding: 9px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--catalog-background); color: var(--text); font-size: 11px; margin-top: 6px; }
input:focus, textarea:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
textarea { min-height: 70px; resize: vertical; }
</style>
