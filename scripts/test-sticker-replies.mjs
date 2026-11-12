import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
import {MessageBuffer,replyDeliveryParts} from '../components/qq-bridge/src/core/message-buffer.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {WechatOneBotAdapter} from '../components/qq-bridge/src/adapters/wechat/wechat-onebot-adapter.js';
import {HookOneBot} from './hook-onebot.mjs';
import {TextDeliveryStore} from './text-delivery-store.mjs';
import {createStickerManagerUI} from '../public/console/sticker-manager.js';
import {foregroundFavoriteId} from '../packages/wechat-send-policy.mjs';
import {bindMemeLibrary} from '../packages/dsh-social-bridge-plugin/meme-library.mjs';
const ids=Array.from({length:8},(_,i)=>(i+1).toString(16).repeat(64)),refs=Object.fromEntries(ids.map((id,i)=>['S'+(i+1),id]));
const tags=ids.map((_,i)=>'[STICKER:S'+(i+1)+']').join('\n\n');
function nativeStickerFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sticker-receipts-')),hook=Object.create(HookOneBot.prototype),rows=[];let sends=0;Object.assign(hook,{directory:root,stickerStateFile:path.join(root,'pending.json'),stickerPending:new Map(),targetsSending:new Set(),textDeliveries:new TextDeliveryStore(path.join(root,'receipts')),status:{native_sticker_send:true,confirmed_sends:0},project:{wechat:{textTransport:{mode:'native'},stickers:{enabled:true}}},hook:{maxConcurrentSends:4},receiptOverride:1,pollMs:1,reload(){},allowed:()=>true,checkNative:async()=>({account:'test-account'}),resolveTarget:async()=> 'test-wxid',reader:async()=>({id:ids[0],conversationKey:'wechat:private:123',fields:{md5:'a'.repeat(32)},path:'fixture.gif'}),messages:async()=>[...rows],native:async()=>{sends++;rows.push({localId:sends,serverId:String(sends),createTime:Math.floor(Date.now()/1000),isSend:true,localType:47,stickerMd5:'a'.repeat(32)});return {ret:0};}});t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {hook,rows,sends:()=>sends};}
test('replaying an old sticker receipt cannot clear a newer attempt for the same GIF',async t=>{const f=nativeStickerFixture(t);const first=await f.hook.sendSticker('private','123',ids[0],'delivery-A');const pending={id:ids[0],deliveryId:'delivery-B',account:'test-account',wxid:'test-wxid',md5:'a'.repeat(32),baseline:new Set(),started:Math.floor(Date.now()/1000)};f.hook.stickerPending.set('private:123',pending);assert.equal((await f.hook.sendSticker('private','123',ids[0],'delivery-A')).message_id,first.message_id);assert.equal(f.hook.stickerPending.get('private:123'),pending);await assert.rejects(f.hook.sendSticker('private','123',ids[0],'delivery-C'),/STICKER_PREVIOUS_DELIVERY_UNCONFIRMED/);assert.equal(f.hook.stickerPending.get('private:123'),pending);assert.equal(f.sends(),1);assert.equal(f.hook.textDeliveries.get(f.hook.textDeliveries.key('private','123','delivery-C','')),null);});
test('successive replies may send the same sticker once for each distinct delivery ID',async t=>{const f=nativeStickerFixture(t),first=await f.hook.sendSticker('private','123',ids[0],'delivery-A'),second=await f.hook.sendSticker('private','123',ids[0],'delivery-B');assert.equal(first.message_id,1);assert.equal(second.message_id,2);assert.equal((await f.hook.sendSticker('private','123',ids[0],'delivery-B')).reused,true);assert.equal(f.sends(),2);assert.equal(f.hook.stickerPending.size,0);});
test('offline sticker library shows recovery controls and never mounts stale thumbnails',async t=>{const previous=globalThis.document;globalThis.document={addEventListener(){},querySelectorAll(){throw Error('must not mount stale thumbnails');}};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});const ui=createStickerManagerUI({api:async()=>{throw Object.assign(Error('读取服务未启动'),{status:503});},escapeHtml:value=>String(value),icon:()=>'',state:{page:'stickers'}});const html=await ui.page();assert(html.includes('data-action="start"'));assert(html.includes('data-sticker-diagnostics'));assert(!html.includes('data-sticker-import'));ui.mount();});
async function until(check){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)throw Error('Timed out waiting for simulated delivery');await new Promise(resolve=>setTimeout(resolve,10));}}
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sticker-delivery-')),file=path.join(root,'messages.json'),buffer=new MessageBuffer(file),texts=[],images=[],logs=[];
 const engine=new SocialEngine({buffer,decide:async()=> 'RESPOND: '+tags,send:async(message,text)=>{texts.push(text);return {delivered:'confirmed'};},sendSticker:async(message,id,meta)=>{images.push({id,...meta});return {delivered:'confirmed'};},stickerChoicesFor:async()=>ids.map(id=>({id,description:'测试表情',tags:['开心']})),minIntervalMs:0,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,batchMs:1,log:line=>logs.push(line),...options});
 t.after(()=>{engine.stop();assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const receive=(text,id='test-1')=>engine.receive({platform:'wechat',kind:'private',conversation_id:'123',sender_id:'123',self_id:'456',message_id:id,text,timestamp:Date.now()/1000});
 return {root,file,buffer,engine,texts,images,logs,receive};
}
test('multiple sticker replies and captions parse without leaking control tokens into text',()=>{
 const result=parseSocialDecision('RESPOND: 来啦\n'+tags,refs,{allowStickerCaption:true});assert.equal(result.text,'来啦');assert.deepEqual(result.stickerIds,ids);
 assert.deepEqual(parseSocialDecision(tags,refs).stickerIds,ids);
 assert.deepEqual(parseSocialDecision('RESPOND: [STICKER:S1]',refs),{decision:'STICKER',text:'',stickerId:ids[0]});
 for(const text of ['RESPOND: [STICKER:S9]','RESPOND: '+tags+'\n[STICKER:S1]','RESPOND: <think>private reasoning</think>\n'+tags,'RESPOND: 正文\n[STICKER:S1]\n陌生内容\n[STICKER:S2]'])assert.equal(parseSocialDecision(text,refs,{allowStickerCaption:true}).decision,'INVALID');
});
test('each image has a distinct durable delivery identity and batches survive restart',t=>{
 const f=fixture(t),result=parseSocialDecision('RESPOND: '+tags,refs),deliveryId='a'.repeat(64),parts=replyDeliveryParts(result,deliveryId);
 assert.equal(new Set(parts.map(part=>part.deliveryId)).size,8);assert.deepEqual(replyDeliveryParts(result,deliveryId),parts);
 const message={platform:'wechat',kind:'private',conversation_id:'123'};f.buffer.append({...message,text:'表情',sender_id:'123'});
 f.buffer.rememberReply('wechat:private:123',{result,deliveryId,parts,throughId:'through',message});
 const restored=new MessageBuffer(f.file);assert.equal(restored.pendingReplies.get('wechat:private:123').parts.length,8);
 const single=replyDeliveryParts({decision:'RESPOND',text:'文字',stickerId:ids[0]},deliveryId);assert.equal(single.length,2);
});
test('eight authorized stickers reach the media lane once each and do not hold the conversation lock',async t=>{
 const f=fixture(t);f.receive('发8个表情包');await until(()=>f.images.length===8&&f.buffer.mediaReplies.size===0);
 assert.equal(new Set(f.images.map(image=>image.deliveryId)).size,8);assert.deepEqual(f.images.map(image=>image.id),ids);assert.equal(f.engine.running.size,0);assert.equal(f.buffer.pendingReplies.size,0);assert(!f.logs.some(line=>line.includes('INVALID_DECISION')));
});
test('foreground favorites remain selectable without vision or saved sticker labels',async t=>{
 let request;
 const f=fixture(t,{stickerPolicyFor:()=>({enabled:true,labelCache:false}),stickerChoicesFor:async()=>[{id:foregroundFavoriteId,source:'favorite'}],
   decide:async(_key,prompt,metadata)=>{request={prompt,metadata};return 'RESPOND: [STICKER:S1]';}});
 f.receive('发个表情包');await until(()=>f.images.length===1);
 assert.equal(f.images[0].id,foregroundFavoriteId);
 assert.match(request.prompt,/微信收藏表情/);
 assert(!(request.metadata?.images??[]).some(image=>image.id===foregroundFavoriteId));
});
test('DSH can collect a meme on 4.1.15.13 without promising native delivery',async t=>{
 const f=fixture(t),tools=new Map(),key='wechat:private:123';
 const candidateId='a'.repeat(32),id='b'.repeat(64);
 fs.mkdirSync(path.join(f.root,'config'));
 fs.writeFileSync(path.join(f.root,'config/wechatagent.json'),JSON.stringify({
   hook:{expectedVersion:'4.1.15.13'},
   wechat:{whitelist:{private:['123']},textTransport:{mode:'native',compatibilityStickers:true,stickerImageFallback:false},memeLibrary:{enabled:true}},
 }));
 const turn={controller:new AbortController(),calls:0,choices:[]};
 const dispose=bindMemeLibrary({tools:{register:tool=>{tools.set(tool.name,tool);return ()=>tools.delete(tool.name);}}},
   {search:async()=>[{candidateId}],select:async()=>({id,description:'测试素材',collection:'saved'})},f.root,key,()=>turn);
 t.after(dispose);
 await tools.get('wechat_meme_search').execute({query:'测试'});
 const selected=await tools.get('wechat_meme_select').execute({candidateId});
 const result=JSON.parse(selected.content);
 assert.equal(selected.isError,false);
 assert.equal(result.collection,'saved');
 assert.equal(result.canSend,false);
 assert.equal(result.reply,undefined);
 assert.deepEqual(turn.choices,[]);
});
test('foreground sticker rejection keeps the reason and uncertain clicks only recheck receipts',async t=>{
 const {hook,rows}=nativeStickerFixture(t);
 hook.project={hook:{expectedVersion:'4.1.15.13'},wechat:{textTransport:{mode:'native',compatibilityStickers:true}}};
 hook.hook.wechatExecutable='Weixin.exe';
 hook.foregroundTarget=async()=>({username:'test-wxid',displayName:'测试聊天'});
 let submits=0;
 hook.foreground={send:async(_body,before)=>{await before();submits++;return submits===1
   ?{accepted:false,attempted:false,code:'FOREGROUND_FAVORITES_EMPTY'}:{accepted:false,attempted:true};}};
 const send=(id,receiptOnly=false)=>hook.sendSticker('private','123',foregroundFavoriteId,id,null,receiptOnly);
 await assert.rejects(send('delivery-A'),/FOREGROUND_FAVORITES_EMPTY/);
 await assert.rejects(send('delivery-A'),/FOREGROUND_FAVORITES_EMPTY/);
 await assert.rejects(send('delivery-B'),/STICKER_DELIVERY_UNCONFIRMED/);
 hook.project.wechat.textTransport.compatibilityStickers=false;
 rows.push({localId:3,isSend:true,localType:47,serverId:'3',createTime:Math.floor(Date.now()/1000)});
 assert.equal((await send('delivery-B',true)).message_id,3);
 assert.equal(submits,2);
});
test('a previously saved image fallback cannot turn a new sticker into an image',async t=>{
 const {hook,sends}=nativeStickerFixture(t);
 hook.project.hook={expectedVersion:'4.1.15.13'};
 hook.project.wechat.textTransport.stickerImageFallback=true;
 hook.status.native_sticker_send=false;
 hook.status.native_image_send=true;
 hook.reader=async()=>assert.fail('An unavailable native sticker must not load an image');
 assert.deepEqual(await hook.stickerList('private','123'),{enabled:false,stickers:[]});
 await assert.rejects(hook.sendSticker('private','123',ids[0],'new-sticker'),/NATIVE_STICKER_UNAVAILABLE/);
 assert.equal(sends(),0);
 assert.equal(hook.stickerPending.size,0);
});
test('4.1.15.13 sends a GIF to the native sticker endpoint and matches its sticker receipt',async t=>{
 const {hook,rows}=nativeStickerFixture(t);
 const md5='d'.repeat(32);
 hook.hook.expectedVersion='4.1.15.13';
 hook.reader=async route=>{
   assert.match(route,/&format=gif-41513$/);
   return {id:ids[0],conversationKey:'wechat:private:123',fields:{md5,len:80},path:'fixture.gif'};
 };
 hook.native=async(route,body)=>{
   assert.equal(route,'/SendStickerMsg');
   assert.equal(body.path,'fixture.gif');
   assert.equal(body.sticker.md5,md5);
   const receipt={isSend:true,serverId:'9',createTime:Math.floor(Date.now()/1000)};
   rows.push({...receipt,localId:1,localType:3,imageMd5:md5},{...receipt,localId:2,localType:47,stickerMd5:md5});
   return {ret:0};
 };
 const result=await hook.sendSticker('private','123',ids[0],'native-gif');
 assert.equal(result.message_id,2);
 assert.equal(result.media_type,'wechat-sticker');
});
test('an in-flight pre-upgrade image may only be reconciled against its original receipt',async t=>{
 const {hook,rows}=nativeStickerFixture(t);
 const imageMd5='b'.repeat(32);
 hook.project.hook={expectedVersion:'4.1.15.13'};
 hook.status.native_sticker_send=false;hook.status.native_image_send=true;
 const started=Math.floor(Date.now()/1000);
 hook.stickerPending.set('private:123',{id:ids[0],mode:'image',md5:imageMd5,account:'test-account',wxid:'test-wxid',deliveryId:'image-delivery',baseline:new Set(),started});
 hook.native=async()=>assert.fail('A pre-upgrade image must never be resent');
 rows.push({localId:1,isSend:true,localType:3,serverId:'1',createTime:started,imageMd5:'c'.repeat(32)});
 await assert.rejects(hook.sendSticker('private','123',ids[0],'image-delivery',null,true),/STICKER_DELIVERY_UNCONFIRMED/);
 rows.push({...rows[0],localId:2,serverId:'2',imageMd5});
 const result=await hook.sendSticker('private','123',ids[0],'image-delivery',null,true);
 assert.equal(result.message_id,2);
 assert.equal(result.media_type,'wechat-image');assert.equal(result.selection,'sticker-first-frame');
});
test('failed media receipt does not prevent a later text reply',async t=>{
 let decisions=0;const f=fixture(t,{decide:async()=>++decisions===1?'RESPOND: [STICKER:S1]':'RESPOND: 我在',sendSticker:async()=>{throw Object.assign(Error('failed'),{code:'NATIVE_SEND_REJECTED'});}});
 f.receive('发个表情');await until(()=>f.logs.some(line=>line.includes('media_failed')));f.receive('为什么不回复','test-2');await until(()=>f.texts.includes('我在'));assert.equal(f.buffer.pendingReplies.size,0);
});
test('unusable corrected output produces a local failure notice without exposing reasoning',async t=>{
 const f=fixture(t,{decide:async()=>'<think>private reasoning must not be sent</think>'});f.receive('你好');await until(()=>f.texts.length===1);assert.equal(f.texts[0],'这次回复没能正常生成，请再发一次。');assert(!f.texts[0].includes('private reasoning'));assert(f.logs.some(line=>line.includes('format_fallback')));
});
test('multi-image queue uses the real OneBot adapter deadline validation before simulated native sends',async t=>{
 const sent=[],deadlines=[],hook=Object.create(HookOneBot.prototype);
 Object.assign(hook,{activeActions:0,status:{failed_sends:0},reload(){},allowed(){return true;},async sendSticker(kind,target,id,deliveryId,proactive,receiptOnly,deferReceipt,deadlineAt){sent.push({id,deliveryId});deadlines.push(deadlineAt);return {receipt:'wechat-server-id',media_type:'wechat-sticker',message_id:sent.length,delivered:'database-confirmed'};}});
 const adapter=new WechatOneBotAdapter();
 adapter.server.action=async(action,params)=>{const response=await hook.action({action,params});if(response.status!=='ok')throw Object.assign(Error(response.message),{code:response.message});return response;};
 // The old implementation forwarded its ten-minute queue expiry and is
 // deliberately rejected by the actual HookOneBot.action validator here.
 const invalid=await hook.action({action:'send_private_msg',params:{user_id:123,message:[{type:'wechat_sticker',data:{id:ids[0]}}],wechatagent_deadline_at:Date.now()+600000}});
 assert.equal(invalid.message,'INVALID_DELIVERY_DEADLINE');assert.equal(sent.length,0);
 const f=fixture(t,{sendSticker:(message,id,options)=>adapter.sendSticker({kind:message.kind,target:message.conversation_id,id,...options})});
 const started=Date.now();f.receive('发8个表情');await until(()=>sent.length===8&&f.buffer.mediaReplies.size===0);
 assert.equal(new Set(sent.map(item=>item.deliveryId)).size,8);assert(deadlines.every(deadline=>deadline>started&&deadline<=Date.now()+45000));
 assert(!f.logs.some(line=>line.includes('media_failed')));assert.equal(adapter.stats.sends,8);
});
