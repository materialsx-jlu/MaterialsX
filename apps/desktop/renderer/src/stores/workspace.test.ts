import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinia,setActivePinia} from 'pinia';
import {useWorkspaceStore} from './workspace.js';
import type {MessageStreamEvent} from '../../../../../packages/contracts/src/desktop.js';

test('late stream events from a fast host reply cannot duplicate persisted messages or disrupt the next turn',async()=>{
  let receive!:(event:MessageStreamEvent)=>void,turn=0,firstStream='';
  const project={id:'project',name:'fixture',path:'/fixture',createdAt:new Date().toISOString()};
  const conversation={id:'conversation',projectId:project.id,title:'fixture',createdAt:project.createdAt,updatedAt:project.createdAt};
  const bootstrap={appVersion:'fixture',platform:'fixture',projects:[project],conversations:[conversation],settings:{},skills:[],models:[],connections:[],runs:[]};
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const originalFrame=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');
  const originalCancel=Object.getOwnPropertyDescriptor(globalThis,'cancelAnimationFrame');
  const emit=(streamId:string,type:MessageStreamEvent['type'],sequence:number,extra={})=>receive({conversationId:conversation.id,streamId,type,sequence,...extra});
  try{
    Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,value:()=>1});
    Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:()=>{}});
    Object.defineProperty(globalThis,'window',{configurable:true,value:{materialsx:{
      onMessageStream:(handler:typeof receive)=>{receive=handler},bootstrap:async()=>bootstrap,listMessages:async()=>[],createConversation:async()=>conversation,
      sendMessage:async(input:{streamToken:string})=>{
        const streamId=`stream:${conversation.id}:${input.streamToken}`;turn++;
        if(turn===1)firstStream=streamId;
        else {emit(firstStream,'start',0);emit(firstStream,'delta',1,{delta:'old'});emit(streamId,'start',0);emit(streamId,'delta',1,{delta:'new'});}
        return [{id:`persisted-${turn}`,conversationId:conversation.id,role:'assistant',content:`answer-${turn}`,status:'complete',createdAt:project.createdAt}];
      },
    }}});
    setActivePinia(createPinia());const store=useWorkspaceStore();await store.initialize();await store.sendMessage('Skill installation question');
    emit(firstStream,'start',0);emit(firstStream,'delta',1,{delta:'late'});emit(firstStream,'complete',2,{content:'answer-1'});
    assert.equal(store.messages.length,1);assert.equal(store.messages[0]!.id,'persisted-1');assert.equal(store.messages[0]!.content,'answer-1');
    await store.sendMessage('Next question');assert.equal(store.messages.length,1);assert.equal(store.messages[0]!.content,'answer-2');
  }finally{
    for(const [name,old] of [['window',originalWindow],['requestAnimationFrame',originalFrame],['cancelAnimationFrame',originalCancel]] as const)
      if(old)Object.defineProperty(globalThis,name,old);else Reflect.deleteProperty(globalThis,name);
  }
});
