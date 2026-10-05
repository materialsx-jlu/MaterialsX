import {ticketsSchema,ticketSchema,costsSchema,alertsSchema,readinessSchema,statementInputSchema,ticketReplySchema,enrollmentsSchema} from '../../../packages/contracts/src/lifecycle.js';
import {z} from 'zod';
import {opsFinanceSchema,workspaceStatusSchema,opsUsersSchema,opsAuditSchema,releasesSchema,billingOverviewSchema,pendingBillingSchema,refundPreviewSchema,reconciliationPreviewSchema,alphaRequestSchema,workspaceControlsSchema,releaseResultSchema} from '../../../packages/contracts/src/platform.js';
export type Finance=z.infer<typeof opsFinanceSchema>;
let csrf='';export class OpsError extends Error{constructor(readonly code:string,readonly requestId:string|null){super(code)}}
export function clearSession(){csrf=''}
// Same-origin, explicit operations only. Neither API credentials nor bearer tokens enter this module.
async function request<T>(path:string,schema:z.ZodType<T>,body?:unknown,key?:string):Promise<T>{
 if(!/^(support(?:\/[A-Za-z0-9_.:-]+\/reply|\/attachments\/[A-Za-z0-9_.:-]+)?|procurement|alerts(?:\/[A-Za-z0-9_.:-]+\/acknowledge)?|readiness|beta(?:\/[A-Za-z0-9_.:-]+)?|auth-config|session|login|logout|overview|pending|verify|preview|reconcile|users(?:\/[A-Za-z0-9_.:-]+\/status)?|audit|controls|releases|finance(?:\/(preview|decision|recheck|simulate))?)(\?cursor=[A-Za-z0-9_.:-]+)?$/.test(path))throw new OpsError('VALIDATION_ERROR',null);
 const res=await fetch('/ops/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(body!==undefined?{'X-CSRF-Token':csrf}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const raw:unknown=await res.json();if(!res.ok){if(res.status===401)clearSession();const err=z.object({error:z.object({code:z.string(),requestId:z.string().optional()})}).safeParse(raw);throw new OpsError(err.success?err.data.error.code:'SERVICE_UNAVAILABLE',err.success?err.data.error.requestId??null:null)};return schema.parse(raw)
}
const session=z.strictObject({csrf:z.string().length(43)}),login=session.extend({expiresIn:z.number().int()});
export const ops={
 authConfig:()=>request("auth-config",z.strictObject({totpRequired:z.boolean()})),
 tickets:(cursor?:string)=>request('support'+(cursor?'?cursor='+cursor:''),ticketsSchema),
 replyTicket:(id:string,input:unknown,key:string)=>request(`support/${id}/reply`,ticketSchema,ticketReplySchema.parse(input),key),
 supportAttachment:(id:string)=>request(`support/attachments/${id}`,z.strictObject({text:z.string().max(32768)})),
 costs:()=>request('procurement',costsSchema),
 importCosts:(input:unknown,key:string)=>request('procurement',z.strictObject({imported:z.literal(true)}),statementInputSchema.parse(input),key),
 alerts:()=>request('alerts',alertsSchema),
 acknowledgeAlert:(id:string,reason:string,key:string)=>request(`alerts/${id}/acknowledge`,z.strictObject({acknowledged:z.literal(true)}),{reason},key),
 readiness:()=>request('readiness',readinessSchema),
 enrollments:()=>request('beta',enrollmentsSchema),
 enroll:(id:string,input:{state:'active'|'revoked';reason:string;expectedVersion:string},key:string)=>request(`beta/${id}`,z.strictObject({enrolled:z.literal(true)}),input,key),
 async session(){const v=await request('session',session);csrf=v.csrf},
 async login(input:{email:string;password:string;otp:string}){const v=await request('login',login,input);csrf=v.csrf},
 async logout(){await request('logout',z.strictObject({loggedOut:z.literal(true)}),{});clearSession()},
 status:()=>request('controls',workspaceStatusSchema),overview:()=>request('overview',billingOverviewSchema),pending:()=>request('pending',pendingBillingSchema),finance:()=>request('finance',opsFinanceSchema),
 users:(cursor?:string)=>request('users'+(cursor?'?cursor='+encodeURIComponent(cursor):''),opsUsersSchema),audit:(cursor?:string)=>request('audit'+(cursor?'?cursor='+cursor:''),opsAuditSchema),releases:()=>request('releases',releasesSchema),
 setStatus:(id:string,body:unknown,key:string)=>request(`users/${id}/status`,z.strictObject({id:z.string(),status:z.enum(['active','suspended']),version:z.string()}),body,key),
 controls:(body:unknown,key:string)=>request('controls',workspaceControlsSchema,body,key),release:(body:unknown,key:string)=>request('releases',releaseResultSchema,body,key),
 refundPreview:(refundId:string)=>request('finance/preview',refundPreviewSchema,{refundId}),refundDecision:(body:unknown,key:string)=>request('finance/decision',z.strictObject({accepted:z.literal(true)}),body,key),
 recheck:(body:unknown,key:string)=>request('finance/recheck',z.strictObject({scheduled:z.literal(true)}),body,key),simulate:(orderId:string)=>request('finance/simulate',z.strictObject({syntheticPayment:z.literal(true)}),{orderId},orderId),
 preview:(body:unknown)=>request('preview',reconciliationPreviewSchema,body),reconcile:(body:unknown,key:string)=>request('reconcile',alphaRequestSchema,body,key),verify:()=>request('verify',z.strictObject({verified:z.literal(true),grants:z.number().int()})),
};
