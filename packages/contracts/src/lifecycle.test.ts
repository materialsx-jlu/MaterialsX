import {test} from 'node:test';import assert from 'node:assert/strict';
import {newTicketSchema,attachmentInputSchema,statementInputSchema} from './lifecycle.js';
test('support cannot inject account authority and attachments require explicit consent',()=>{
 const body={subject:'Fixture',category:'usage',body:'Question',referenceId:''};assert.ok(newTicketSchema.safeParse(body).success);assert.equal(newTicketSchema.safeParse({...body,accountId:'foreign-user'}).success,false);assert.equal(attachmentInputSchema.safeParse({name:'fixture',text:'fixture'}).success,false);
});
test('procurement uses exact string units and original evidence without user charge authority',()=>{const line={requestId:'request',routeVersionId:'route',sourceRef:'statement',sourceSha256:'a'.repeat(64),costMicrofen:'1234567',reason:'fixture'};assert.ok(statementInputSchema.safeParse({lines:[line]}).success);for(const bad of [{costMicrofen:1234567},{chargedCredits:'100'},{sourceSha256:'unknown'},{costMicrofen:'1.23'}])assert.equal(statementInputSchema.safeParse({lines:[{...line,...bad}]}).success,false)});
