<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue';
import {ElMessageBox} from 'element-plus';
import QRCode from 'qrcode';
import type {z} from 'zod';
import type {mx03ProductsResponseSchema,mx03RetailCatalogSchema,mx03WalletSchema,mx03OrdersResponseSchema,mx03PointOrderSchema,mx03PointRefundSchema,mx03RefundsResponseSchema,mx03UsageRowsSchema} from '../../../../../packages/contracts/src/mx-v03.js';
type Products=z.infer<typeof mx03ProductsResponseSchema>;
type Prices=z.infer<typeof mx03RetailCatalogSchema>;
type Wallet=z.infer<typeof mx03WalletSchema>;
type Orders=z.infer<typeof mx03OrdersResponseSchema>;
type Order=z.infer<typeof mx03PointOrderSchema>;
type Refund=z.infer<typeof mx03PointRefundSchema>;
type Refunds=z.infer<typeof mx03RefundsResponseSchema>;
type Usage=z.infer<typeof mx03UsageRowsSchema>;
const products=ref<Products|null>(null),prices=ref<Prices|null>(null),wallet=ref<Wallet|null>(null),orders=ref<Orders|null>(null),refund=ref<Refund|null>(null);
const usage=ref<Usage|null>(null);
const refundOrder=ref(''),refunds=ref<Refunds|null>(null);
const busy=ref(false),loading=ref(false),error=ref(''),loadError=ref(''),pendingKeys=new Map<string,string>();
const selectedOrderId=ref(''),selectedOrderDetail=ref<Order|null>(null),qr=ref(''),qrError=ref('');
let qrLoading=false;
const checkoutEl=ref<HTMLElement|null>(null);
const selectedOrder=computed(()=>selectedOrderDetail.value?.id===selectedOrderId.value?selectedOrderDetail.value:orders.value?.items.find(item=>item.id===selectedOrderId.value));
const checkoutCode=computed(()=>selectedOrder.value?.channel==='wechat'&&selectedOrder.value.state==='pending'&&!selectedOrder.value.closeRequested&&selectedOrder.value.checkoutState==='ready'&&Date.parse(selectedOrder.value.expiresAt)>Date.now()?selectedOrder.value.codeUrl:null);
const activePendingOrders=computed(()=>orders.value?.items.filter(item=>item.state==='pending'&&Date.parse(item.expiresAt)>Date.now())??[]);
const reusableOrder=(productId:string)=>activePendingOrders.value.find(item=>item.productVersionId===productId&&item.channel==='wechat'&&!item.closeRequested&&Date.parse(item.expiresAt)>Date.now()+60_000&&(item.checkoutState==='not_started'||item.checkoutState==='submitting'||item.checkoutState==='ready'&&!!item.codeUrl));
const pendingFullFor=(productId:string)=>activePendingOrders.value.length>=3&&!reusableOrder(productId);
async function ensureQr(){
  const code=checkoutCode.value;
  if(!code||qr.value||qrLoading)return;
  if(!/^weixin:\/\/wxpay\/[^\s]{1,2000}$/.test(code)){qrError.value='支付渠道返回的付款码无效，请联系客服核对该订单';return}
  qrLoading=true;qrError.value='';
  try{const value=await QRCode.toDataURL(code,{width:272,margin:4,errorCorrectionLevel:'M'});if(checkoutCode.value===code)qr.value=value}
  catch{if(checkoutCode.value===code)qrError.value='二维码生成失败，正在自动重试；也可点击刷新数据'}
  finally{qrLoading=false;if(checkoutCode.value!==code)void ensureQr()}
}
watch(checkoutCode,()=>{qr.value='';qrError.value='';void ensureQr()});
let refreshTimer:ReturnType<typeof setInterval>|undefined;
const yuan=(fen:string)=>{const n=BigInt(fen);return `${n/100n}.${(n%100n).toString().padStart(2,'0')}`};
const tokenCount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value.toLocaleString('zh-CN'):'待核对';
const usageState=(value:string)=>({reserved:'预留中',settled:'已结算',released:'已释放',reconciliation_pending:'待核对'}[value]??value);
async function load(){if(loading.value)return;loading.value=true;try{
  const requestedOrderId=selectedOrderId.value;
  const [p,w,o,u,price,detail]=await Promise.allSettled([window.materialsx.getMxProducts(),window.materialsx.getMxWallet(),window.materialsx.getMxOrders(),window.materialsx.getMxUsage(),window.materialsx.getMxPrices(),requestedOrderId?window.materialsx.getMxOrder(requestedOrderId):Promise.resolve(null)]);
  if(p.status==='fulfilled')products.value=p.value;if(w.status==='fulfilled')wallet.value=w.value;if(o.status==='fulfilled')orders.value=o.value;if(u.status==='fulfilled')usage.value=u.value;if(price.status==='fulfilled')prices.value=price.value;
  if(requestedOrderId===selectedOrderId.value&&detail.status==='fulfilled'&&detail.value)selectedOrderDetail.value=detail.value;
  loadError.value=w.status==='rejected'?'MX 钱包暂不可读取，请确认登录和服务连接':requestedOrderId&&detail.status==='rejected'?'付款订单状态暂不可读取，正在重试；请勿重复创建订单':'';
  await ensureQr();
}catch(e){loadError.value=e instanceof Error?e.message:'MX 点数服务暂不可用'}finally{loading.value=false}}
async function create(productId:string){if(busy.value)return;const product=products.value?.items.find(p=>p.id===productId&&p.enabled);if(!product)return;
  const existing=reusableOrder(productId);
  if(existing){selectedOrderId.value=existing.id;selectedOrderDetail.value=existing;await nextTick();checkoutEl.value?.scrollIntoView({behavior:'smooth',block:'center'});void load();return}
  busy.value=true;error.value='';const key=pendingKeys.get(productId)??crypto.randomUUID();pendingKeys.set(productId,key);
  try{const order=await window.materialsx.createMxOrder(productId,key);selectedOrderId.value=order.id;selectedOrderDetail.value=order;pendingKeys.delete(productId);busy.value=false;await nextTick();checkoutEl.value?.scrollIntoView({behavior:'smooth',block:'center'});void load()}catch(e){busy.value=false;error.value=e instanceof Error&&e.message.includes('(409)')?'当前待付订单已达上限或状态发生变化；请先查看已有订单，待付款、过期或渠道核对后再试':e instanceof Error?e.message:'订单状态未知，请刷新订单核对，不要重复提交';void load()}}
async function requestRefund(orderId:string){if(busy.value)return;let reason:string;
  try{const result=await ElMessageBox.prompt('请输入退款原因。申请后由计费后台核对并处理。','申请退款',{inputValidator:v=>v.trim().length>0&&v.length<=256||'请输入 1–256 字的原因',confirmButtonText:'提交申请',cancelButtonText:'取消'});reason=result.value.trim()}catch{return}
  busy.value=true;error.value='';const key=pendingKeys.get(orderId)??crypto.randomUUID();pendingKeys.set(orderId,key);
  try{refund.value=await window.materialsx.requestMxRefund(orderId,reason,key);pendingKeys.delete(orderId);busy.value=false;await load();await openRefunds(orderId)}catch(e){busy.value=false;error.value=e instanceof Error?e.message:'退款申请状态未知，请联系管理员核对'}}
async function cancelOrder(orderId:string){if(busy.value)return;busy.value=true;error.value='';
  try{const order=await window.materialsx.cancelMxOrder(orderId);if(selectedOrderId.value===orderId)selectedOrderDetail.value=order;await load()}
  catch(e){error.value=e instanceof Error?e.message:'取消请求状态未知，请刷新订单核对'}finally{busy.value=false}}
async function openRefunds(orderId:string){refundOrder.value=orderId;try{refunds.value=await window.materialsx.getMxRefunds(orderId)}catch{refunds.value=null;error.value='退款记录暂不可读取，请稍后刷新'}}
onMounted(()=>{void load();refreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&(selectedOrderId.value||orders.value?.items.some(item=>item.state==='pending')))void load()},5000)});
onUnmounted(()=>{if(refreshTimer)clearInterval(refreshTimer)});
</script>
<template>
<section class="mx-panel" aria-label="MX 点数">
  <div class="mx-top"><div><span class="eyebrow">MX POINTS</span><h2>MX 点数</h2><p>1 元 = 10 MX 点。余额、预留与实际消耗以平台账本为准。</p></div><button class="secondary-button" :disabled="loading" @click="load">{{loading?'正在刷新…':'刷新数据'}}</button></div>
  <p v-if="error" class="mx-error" role="alert">{{error}}</p>
  <p v-if="loadError" class="mx-error" role="alert">{{loadError}}</p>
  <div class="mx-balances" v-if="wallet"><div><small>可用</small><strong>{{wallet.available}}</strong></div><div><small>预留</small><strong>{{wallet.held}}</strong></div><div><small>已消耗</small><strong>{{wallet.consumed}}</strong></div><div><small>退款冻结</small><strong>{{wallet.refundFrozen}}</strong></div></div>
  <p v-else>余额暂不可读取。</p>
  <div class="mx-section-heading"><div><h3>充值档位</h3><p v-if="products&&!products.salesEnabled&&!products.testMode">充值暂未开放，开放状态以服务端为准。</p><p v-else-if="products?.testMode">当前为测试订单，不发生真实付款。</p><p v-else>选择金额后使用微信扫码付款；到账后自动发放 MX 点。</p></div></div>
  <p v-if="activePendingOrders.length>=3" class="mx-error" role="status">当前已有 3 笔有效待付订单。可在下方取消不需要的待付订单；渠道确认关闭后即可创建新档位。</p>
  <div class="mx-products"><article v-for="product in products?.items??[]" :key="product.id"><span class="mx-product-label">{{product.testOnly?'测试档位':'固定档位'}}</span><strong>¥{{yuan(product.amountFen)}}</strong><span>{{product.points}} MX 点</span><button class="primary-button" :disabled="busy||!product.enabled||(!products?.salesEnabled&&!products?.testMode)||pendingFullFor(product.id)" @click="create(product.id)">{{busy?'正在读取订单…':pendingFullFor(product.id)?'待付订单已满':product.testOnly?'创建测试订单':'充值 MX 点'}}</button></article></div>
  <article v-if="selectedOrder?.state==='pending'&&selectedOrder.channel==='wechat'" ref="checkoutEl" class="mx-checkout" aria-live="polite"><div><span class="eyebrow">WECHAT PAY</span><h3>{{selectedOrder.closeRequested?'正在取消订单':'微信扫码支付'}}</h3><p>订单 {{selectedOrder.id}} · ¥{{yuan(selectedOrder.amountFen)}} · {{selectedOrder.points}} MX 点</p><p v-if="selectedOrder.closeRequested">正在向支付渠道确认关闭；若付款已经完成，MX 点仍会正常到账。</p><p v-else>付款后会自动刷新状态。若未到账，请先查询原订单，勿重复付款。</p><p v-if="selectedOrder.checkoutState==='unknown'&&!selectedOrder.closeRequested" class="mx-error">支付渠道状态待核对，请查询原订单，勿重复付款。</p></div><img v-if="qr" :src="qr" width="272" height="272" alt="MX 点微信付款二维码" /><p v-else-if="selectedOrder.closeRequested">取消请求已提交，正在核对渠道状态。</p><p v-else-if="Date.parse(selectedOrder.expiresAt)<=Date.now()" class="mx-error">该订单已过期，请重新点击充值获取新二维码；旧订单仍会继续核对。</p><p v-else-if="qrError" class="mx-error">{{qrError}}</p><p v-else>{{selectedOrder.checkoutState==='ready'?'二维码正在生成，请稍候':'正在向微信获取付款二维码，页面将自动刷新。'}}</p></article>
  <div class="mx-section-heading"><div><h3>模型零售价</h3><p>按四类 Token 的实际用量计费。购买 MX 点后，只能使用服务端已开放的模型。</p></div><small v-if="prices">{{prices.versionId}} · {{prices.status==='approved'?'已审核':'草稿，未开放销售'}}</small></div>
  <p v-if="prices">单位为 MX 点 / 百万 Token。字段依次为输入、输出、缓存读取、缓存写入；不同输入量可能使用不同档位。</p><p v-else>价格目录暂不可读取；请勿按旧积分价格估算 MX 点用量。</p>
  <div class="mx-table" v-if="prices"><table><thead><tr><th>模型</th><th>输入区间起点</th><th>输入</th><th>输出</th><th>缓存读</th><th>缓存写</th><th>官方价对比</th></tr></thead><tbody><template v-for="model in prices.models" :key="model.id"><tr v-for="tier in model.tiers" :key="tier.id"><td>{{model.id}}</td><td>{{tier.minInputTokens}}</td><td>{{tier.mxPointsPer1m[0]}}</td><td>{{tier.mxPointsPer1m[1]}}</td><td>{{tier.mxPointsPer1m[2]}}</td><td>{{tier.mxPointsPer1m[3]}}</td><td>约 {{model.retailVsOfficialPercentApprox}}%</td></tr></template></tbody></table></div>
  <div class="mx-section-heading"><h3>订单与退款</h3></div><div class="mx-table"><table><thead><tr><th>订单</th><th>金额 / 点数</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="order in orders?.items??[]" :key="order.id"><td>{{order.id}}<small>{{new Date(order.createdAt).toLocaleString('zh-CN')}}</small></td><td>¥{{yuan(order.amountFen)}} / {{order.points}} 点</td><td>{{order.channel==='test'?'测试 · ':''}}{{order.state==='pending'?(order.closeRequested?'取消中':Date.parse(order.expiresAt)<=Date.now()?'已过期 · 待渠道核对':'待付款'):order.state}}<small v-if="order.checkoutState==='unknown'&&!order.closeRequested">支付状态待核对</small></td><td><button class="secondary-button" :disabled="busy" @click="selectedOrderId=order.id;selectedOrderDetail=order;load()">{{order.state==='pending'&&!order.closeRequested&&Date.parse(order.expiresAt)>Date.now()?'查看付款':'查询状态'}}</button><button v-if="order.state==='pending'" class="secondary-button" :disabled="busy||order.closeRequested" @click="cancelOrder(order.id)">{{order.closeRequested?'取消中':'取消订单'}}</button><button class="secondary-button" :disabled="busy" @click="openRefunds(order.id)">退款记录</button><button v-if="order.state==='paid'" class="secondary-button" :disabled="busy" @click="requestRefund(order.id)">申请退款</button></td></tr></tbody></table><p v-if="!orders?.items.length">暂无 MX 订单</p></div><p v-if="refund">退款申请 {{refund.id}} · {{refund.approval}} / {{refund.execution}}</p><div v-if="refundOrder"><h4>订单 {{refundOrder }} 的退款</h4><p v-for="item in refunds?.items??[]" :key="item.id">{{item.id}} · ¥{{yuan(item.amountFen)}} · {{item.approval}} / {{item.execution}}</p><p v-if="refunds&&!refunds.items.length">无退款记录</p></div>
  <div class="mx-section-heading"><div><h3>MX 任务明细</h3><p>每笔请求单独展示点数预留、终态用量与计费证据。</p></div></div>
  <div v-if="usage?.items.length" class="mx-usage-list"><article v-for="row in usage.items" :key="row.requestId" class="mx-usage-card"><div class="mx-usage-heading"><div><strong>{{row.modelId}}</strong><small>请求 {{row.requestId}} · 任务 {{row.taskId??'未关联'}}</small></div><span class="mx-usage-state">{{usageState(row.state)}}</span></div><div class="mx-usage-metrics"><div><small>预留</small><strong>{{row.reservedPoints}} 点</strong></div><div><small>实际扣减</small><strong>{{row.chargedPoints??'待核对'}}{{row.chargedPoints===null?'':' 点'}}</strong></div><div><small>普通输入 / 输出</small><strong>{{tokenCount(row.usage?.inputTokens)}} / {{tokenCount(row.usage?.outputTokens)}}</strong></div><div><small>缓存读 / 写</small><strong>{{tokenCount(row.usage?.cacheReadTokens)}} / {{tokenCount(row.usage?.cacheCreateTokens)}}</strong></div></div><div class="mx-usage-evidence"><span>路由 {{row.routeVersionId}}</span><span>价格 {{row.retailPriceVersionId}}</span><span>用量证据 {{row.usageEvidenceRef??'待核对'}}</span></div></article></div>
  <p v-else class="mx-empty">暂无 MX 计费请求</p>
</section>
</template>
<style scoped>
.mx-panel{display:grid;gap:22px;min-width:0;color:var(--text)}
.mx-top,.mx-section-heading{display:flex;justify-content:space-between;align-items:start;gap:16px}
.mx-top h2{margin:5px 0 6px;font-size:22px;line-height:1.3;letter-spacing:-.02em}
.mx-panel p{margin:4px 0;color:var(--muted);font-size:13px;line-height:1.6}
.mx-panel h3{margin:0 0 6px;font-size:16px;line-height:1.35;font-weight:650}
.mx-section-heading{padding-top:6px;border-top:1px solid var(--line)}
.mx-section-heading>small{color:var(--muted);font-size:11px;text-align:right;overflow-wrap:anywhere}
.mx-balances,.mx-products{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.mx-balances>div,.mx-products>article{display:grid;align-content:start;gap:7px;min-width:0;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--catalog-surface)}
.mx-balances>div:first-child{border-color:var(--accent);background:var(--accent-bg)}
.mx-balances strong,.mx-products strong{font-size:24px;line-height:1.25;font-variant-numeric:tabular-nums}
.mx-balances small,.mx-product-label{color:var(--muted);font-size:12px}
.mx-products>article>span:not(.mx-product-label){font-size:13px;color:var(--muted)}
.mx-products button{justify-content:center;margin-top:10px;min-height:36px}
.mx-product-confirm{display:grid;gap:8px;margin-top:8px;padding-top:12px;border-top:1px solid var(--line)}
.mx-product-confirm p{margin:0;font-size:12px;line-height:1.5}
.mx-product-confirm button{margin-top:0}
.mx-checkout{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:20px;border:1px solid var(--accent);border-radius:12px;background:var(--accent-bg)}
.mx-checkout img{flex:none;max-width:42%;height:auto;border-radius:10px;background:#fff}
.mx-table{min-width:0;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--catalog-surface)}
.mx-table table{width:100%;border-collapse:collapse;font-size:12px}
.mx-table th,.mx-table td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
.mx-table th{color:var(--muted);font-weight:600;background:var(--panel-2)}
.mx-table tr:last-child td{border-bottom:0}
.mx-table td small{display:block;margin-top:5px;color:var(--muted);font-size:11px}
.mx-table button{margin:0 6px 5px 0}
.mx-usage-list{display:grid;gap:12px}
.mx-usage-card{min-width:0;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--catalog-surface)}
.mx-usage-heading{display:flex;align-items:start;justify-content:space-between;gap:14px}
.mx-usage-heading strong{font-size:15px}.mx-usage-heading small{display:block;margin-top:6px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.mx-usage-state{flex:none;padding:5px 9px;border-radius:999px;background:var(--accent-bg);color:var(--accent-strong);font-size:11px}
.mx-usage-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:18px}
.mx-usage-metrics>div{min-width:0;padding:12px;border-radius:9px;background:var(--panel-2)}
.mx-usage-metrics small{display:block;margin-bottom:5px;color:var(--muted);font-size:11px}
.mx-usage-metrics strong{display:block;font-size:13px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mx-usage-evidence{display:flex;flex-wrap:wrap;gap:5px 16px;margin-top:15px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.mx-empty{padding:22px;border:1px dashed var(--line);border-radius:12px;text-align:center}
.mx-error{color:var(--danger)!important}
@media(max-width:850px){.mx-balances,.mx-products{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:850px){.mx-usage-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.mx-top,.mx-checkout{flex-direction:column}.mx-checkout img{max-width:100%}}
</style>
