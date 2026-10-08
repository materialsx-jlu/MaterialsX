import {ipcMain} from 'electron';
import {mx03ProductsResponseSchema,mx03OrdersResponseSchema,mx03RefundsResponseSchema,mx03PointOrderSchema,mx03PointRefundSchema,mx03WalletSchema,mx03RetailCatalogSchema,mx03UsageRowsSchema} from '../../../packages/contracts/src/mx-v03.js';

type Transport={platformRequest(path:string,init?:RequestInit):Promise<Response>};
const identifier=(value:unknown):string=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(value))throw new Error('无效的 MX 点数参数');
  return value;
};
export function registerMxPointsIpc(transport:Transport):void{
  const get=async(path:string)=>{
    const response=await transport.platformRequest(path);
    if(!response.ok)throw new Error(`MX 点数服务不可用 (${response.status})`);
    return response.json();
  };
  ipcMain.handle('mx:products',async()=>mx03ProductsResponseSchema.parse(await get('/v1/mx-points/products')));
  ipcMain.handle('mx:prices',async()=>mx03RetailCatalogSchema.parse(await get('/v1/mx-points/prices')));
  ipcMain.handle('mx:wallet',async()=>mx03WalletSchema.parse(await get('/v1/mx-points/wallet')));
  ipcMain.handle('mx:usage',async()=>mx03UsageRowsSchema.parse(await get('/v1/mx-points/usage')));
  ipcMain.handle('mx:orders',async()=>mx03OrdersResponseSchema.parse(await get('/v1/mx-points/orders')));
  ipcMain.handle('mx:order',async(_event,id:unknown)=>mx03PointOrderSchema.parse(await get(`/v1/mx-points/orders/${identifier(id)}`)));
  ipcMain.handle('mx:refunds',async(_event,id:unknown)=>mx03RefundsResponseSchema.parse(await get(`/v1/mx-points/orders/${identifier(id)}/refunds`)));
  ipcMain.handle('mx:refund',async(_event,id:unknown)=>mx03PointRefundSchema.parse(await get(`/v1/mx-points/refunds/${identifier(id)}`)));
  ipcMain.handle('mx:create',async(_event,input:{productId:unknown;key:unknown})=>{
    const products=mx03ProductsResponseSchema.parse(await get('/v1/mx-points/products'));
    const productId=identifier(input?.productId);
    if(!products.items.some(p=>p.id===productId&&p.enabled)||(!products.salesEnabled&&!products.testMode))throw new Error('MX 点数购买尚未开放');
    const response=await transport.platformRequest('/v1/mx-points/orders',{method:'POST',headers:{'Idempotency-Key':identifier(input.key)},body:JSON.stringify({productVersionId:productId})});
    if(!response.ok)throw new Error(`MX 点数订单未创建 (${response.status})`);
    return mx03PointOrderSchema.parse(await response.json());
  });
  ipcMain.handle('mx:cancel',async(_event,orderId:unknown)=>{
    const id=identifier(orderId);
    const response=await transport.platformRequest(`/v1/mx-points/orders/${id}/cancel`,{method:'POST',headers:{'Idempotency-Key':`cancel:${id}`}});
    if(!response.ok)throw new Error(`MX 待付订单取消失败 (${response.status})`);
    return mx03PointOrderSchema.parse(await response.json());
  });
  ipcMain.handle('mx:request-refund',async(_event,input:{orderId:unknown;reason:unknown;key:unknown})=>{
    const orderId=identifier(input?.orderId);
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>256)throw new Error('请填写退款原因');
    const response=await transport.platformRequest(`/v1/mx-points/orders/${orderId}/refunds`,{method:'POST',headers:{'Idempotency-Key':identifier(input.key)},body:JSON.stringify({reason:input.reason.trim()})});
    if(!response.ok)throw new Error(`MX 点数退款申请未提交 (${response.status})`);
    return mx03PointRefundSchema.parse(await response.json());
  });
}
