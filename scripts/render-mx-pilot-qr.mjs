#!/usr/bin/env node
// Render only the authorized, unexpired ¥10 MX pilot order locally.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import QRCode from 'qrcode';

const source=resolve('runtime/v03/mx-pilot-10cny.json');
const target=resolve('runtime/v03/mx-pilot-10cny-qr.png');
const info=await lstat(source);
if(!info.isFile()||info.isSymbolicLink()||info.size>65536||(info.mode&0o077)!==0)throw Error('Private MX pilot journal required');
const journal=JSON.parse(await readFile(source,'utf8'));
const order=journal.order??{},code=order.codeUrl??'';
if(journal.productId!=='mx-cny-10-v1'||order.productVersionId!=='mx-cny-10-v1'||order.amountFen!=='1000'||
   order.points!=='100'||order.state!=='pending'||!code.startsWith('weixin://wxpay/')||code.length>2048||
   !Number.isFinite(Date.parse(order.expiresAt))||Date.parse(order.expiresAt)<=Date.now())throw Error('No unexpired ¥10 MX payment QR is available');
const png=await QRCode.toBuffer(code,{type:'png',errorCorrectionLevel:'M',scale:12,margin:4});
await writeFile(target,png,{mode:0o600,flag:'wx'});
console.log('Private ¥10 MX QR rendered locally; checkout URL not logged');
