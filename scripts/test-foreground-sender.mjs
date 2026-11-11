import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HookOneBot} from './hook-onebot.mjs';import {TextDeliveryStore} from './text-delivery-store.mjs';import {validateTextTransport} from './foreground-sender.mjs';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whale-transport-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let submitted=false;const calls={native:0,foreground:0};
 const hook=Object.create(HookOneBot.prototype);Object.assign(hook,{directory:dir,project:{wechat:{textTransport:{mode:'foreground'}}},targetsSending:new Set(),hook:{wechatExecutable:'state/Weixin.exe'},status:{confirmed_sends:0},textDeliveries:new TextDeliveryStore(dir),ownWxid:'self',pollMs:1,receiptOverride:5,reload(){},allowed(){return true;},async checkNative(){return {account:'account'};},async resolveTarget(){return 'recipient';},async reader(){return {sessions:[{username:'recipient',displayName:'Test',conversationId:42}]};},async messages(){return submitted?[{localId:2,isSend:true,localType:1,serverId:'1234',createTime:Date.now()/1000,fullText:'hello'}]:[];},async native(){calls.native++;submitted=true;return {ret:0};},foreground:{async send(body,before){await before();calls.foreground++;submitted=true;assert.equal(body.name,'Test');assert.equal(body.executable,path.join(dir,'state/Weixin.exe'));return {accepted:true};}}});return {hook,calls};
}
test('native default and foreground selection use the same durable receipt',async t=>{
 const {hook,calls}=fixture(t);await hook.send('private','42','hello','a');assert.deepEqual(calls,{native:0,foreground:1});
 hook.project.wechat.textTransport.mode='native';await hook.send('private','42','hello','a');assert.deepEqual(calls,{native:0,foreground:1});
 hook.messages=async()=>[];hook.native=async()=>{calls.native++;hook.messages=async()=>[{localId:3,isSend:true,localType:1,serverId:'1235',createTime:Date.now()/1000,fullText:'hello'}];return {ret:0};};
 await hook.send('private','42','hello','b');assert.equal(calls.native,1);
});
test('uncertain UI submission never falls back or resubmits after switching',async t=>{
 const {hook,calls}=fixture(t);hook.messages=async()=>[];hook.foreground.send=async()=>{calls.foreground++;return {accepted:false};};
 await assert.rejects(hook.send('private','42','hello','a'),/UNCONFIRMED/);hook.project.wechat.textTransport.mode='native';
 await assert.rejects(hook.send('private','42','hello','a'),/UNCONFIRMED/);assert.deepEqual(calls,{native:0,foreground:1});
});
test('duplicate names and revoked permissions block foreground submission',async t=>{
 const {hook,calls}=fixture(t);hook.reader=async()=>({sessions:[{username:'recipient',displayName:'Test',conversationId:42},{username:'another',displayName:'Test',conversationId:84}]});
 await assert.rejects(hook.send('private','42','hello','a'),/AMBIGUOUS/);assert.equal(calls.foreground,0);
 const b=fixture(t);b.hook.foreground.send=async(body,before)=>{b.hook.allowed=()=>false;await before();b.calls.foreground++;};
 await assert.rejects(b.hook.send('private','42','hello','a'),/UNCONFIRMED/);assert.equal(b.calls.foreground,0);
});
test('invalid transport modes rejected; native remains the default',()=>{validateTextTransport(undefined);validateTextTransport({mode:'native'});assert.throws(()=>validateTextTransport({mode:'auto'}));});
test('a definitive foreground failure retains its reason and is not replayed',async t=>{
 const {hook,calls}=fixture(t);
 hook.foreground.send=async()=>{calls.foreground++;return {accepted:false,attempted:false,code:'FOREGROUND_SEND_BUTTON_UNAVAILABLE'};};
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(hook.send('private','42','hello','a'),/FOREGROUND_SEND_BUTTON_UNAVAILABLE/);
 assert.deepEqual(calls,{native:0,foreground:1});
});
test('4.1.15.13 quote delivery requires the exact original server ID and submits only once',async t=>{
 const {hook,calls}=fixture(t);
 hook.project.hook={expectedVersion:'4.1.15.13'};
 hook.project.wechat.textTransport={mode:'native',compatibilityMedia:true};
 const rows=[{localId:1,localType:1,serverId:'1234',fullText:'original'}];
 hook.messages=async()=>rows;
 hook.foreground.send=async(body,before)=>{
  await before();calls.foreground++;assert.equal(body.quote,'original');
  const row={isSend:true,localType:49,createTime:Date.now()/1000};
  rows.push({...row,localId:2,serverId:'1235',quoteReceipt:{sourceId:'999',text:'hello'}},
    {...row,localId:3,serverId:'1236',quoteReceipt:{sourceId:'1234',text:'hello'}});
  return {accepted:true,attempted:true};
 };
 const send=()=>hook.send('private','42','hello','quote-1',null,undefined,'1234');
 assert.equal((await send()).message_id,3);
 assert.equal((await send()).reused,true);
 await assert.rejects(hook.send('private','42','hello','quote-1',null,undefined,'1235'),/TEXT_DELIVERY_ID_CONFLICT/);
 assert.deepEqual(calls,{foreground:1,native:0});
});
