import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {PeopleMemory} from '../packages/plugin-api/people-memory.mjs';import {filterMemoryOverrides,continuityContext} from '../packages/dsh-social-bridge-plugin/continuity-memory.mjs';import {HistoryStore} from '../packages/dsh-social-bridge-plugin/history-store.mjs';import {memoryEvaluationPrompt,MEMORY_CASES,scoreMemoryAnswer} from '../packages/dsh-social-bridge-plugin/memory-evaluation.mjs';
import {createPeopleConsole} from './people-console.mjs';import {createMemoryEvaluation} from './memory-evaluation-console.mjs';import {createConsole} from './console-server.mjs';
import {conversationEpisodes} from '../packages/plugin-api/people-facts.mjs';
import {consoleRoute} from '../public/console/layout-model.mjs';
import {starStyle} from '../public/console/memory-constellation.js';
import {galaxyProjection} from '../public/console/memory-galaxy.mjs';
import {makeDemoNotes,demoSnapshot} from '../public/console/memory-constellation-demo.mjs';
import {constellationSnapshot} from './memory-constellation.mjs';
import {FishNotebookStore} from '../packages/dsh-social-bridge-plugin/fish-notebook-store.mjs';
const account='a'.repeat(64),key='wechat:private:1',hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const turn=(text)=>({conversationKey:key,peopleObservations:[{senderId:'wxid_alice',name:'小桃',text,at:Date.now(),evidenceId:hash(text)}]});

test('galaxy perspective changes with depth and priority controls the appearance of stars',()=>{
 const camera=galaxyProjection(1200,720,1,.7,0);
 const close=camera.point({x:.37,y:-.22,z:-.4}),far=camera.point({x:.37,y:-.22,z:.4});
 assert(close.factor>far.factor&&close.x-600>far.x-600);
 const edge=galaxyProjection(1200,720,1,.7,Math.PI/2);
 assert.notEqual(edge.point({x:.37,y:-.22,z:-.4}).y,edge.point({x:.37,y:-.22,z:.4}).y);
 const base={category:'event',status:'active',event:{state:'completed'}};
 const normal=starStyle(base),recalled=starStyle({...base,recalledAt:10}),pinned=starStyle({...base,pinned:true}),expired=starStyle({...base,pinned:true,status:'expired'});
 assert(pinned.radius>recalled.radius&&recalled.radius>normal.radius&&normal.radius>expired.radius);
 assert.equal(new Set(['planned','completed','cancelled'].map(state=>starStyle({...base,event:{state}}).color)).size,3);
 assert.notEqual(expired.color,normal.color);
});

test('galaxy demo supplies 48 distinct local fixtures and applies timeline and chat filters',()=>{
 const notes=makeDemoNotes(Date.UTC(2026,10,12));
 const all=demoSnapshot(notes,new URLSearchParams());
 assert.equal(all.total,48);assert.equal(all.people,6);assert.equal(new Set(notes.map(note=>note.id)).size,48);
 assert(notes.every(note=>note.chat.startsWith('demo:')));
 assert.equal(demoSnapshot(notes,new URLSearchParams({category:'event',eventState:'cancelled',conversationKey:'demo:camp'})).total,2);
 assert.equal(demoSnapshot(notes,new URLSearchParams({status:'active'})).total,46);
});

test('constellation paginates older memories and links sources only by chat, confirmed identity, or dated topic',()=>{
 const p=hash('person'),q=hash('other'),memberId=hash('confirmed member'),other='wechat:group:2';
 const note=(id,chat,text)=>({id:hash(id),chat,text,at:1,status:'active',visibility:'chat'});
 const event={day:'2026-11-13',topic:'露营',state:'planned'};
 const people=[{id:p,names:['同名'],archiveIds:[memberId],notes:[{...note('event1',other,'露营约定'),episode:event},...Array.from({length:325},(_,i)=>note('n'+i,key,'我喜欢画画'))]},
  {id:q,names:['同名'],notes:[{...note('event2',other,'露营安排'),episode:event}]}];
 const extra=[{...note('member',other,'互动观察'),memberId,name:'同名',category:'member'},{...note('summary',other,'保存摘要'),name:'摘要',category:'summary'},{...note('private','wechat:private:999','隐藏文本'),name:'摘要',category:'summary'}];
 const options={account,catalog:{people,usage:{}},allowedChats:new Set([key,other]),activeChats:new Set([key,other]),extra};
 const page=constellationSnapshot({...options,params:new URLSearchParams({limit:'320',offset:'320'})});
 assert.equal(page.total,329);assert.equal(page.notes.length,9);assert(!JSON.stringify(page).includes('隐藏文本'));
 const group=constellationSnapshot({...options,params:new URLSearchParams({conversationKey:other,limit:'320'})});
 assert.equal(group.notes.find(n=>n.category==='member').personId,p);
 assert(group.notes.find(n=>n.id===hash('event1')).related.some(n=>n.id===hash('event2')&&n.reason==='同日同类事件'));
 assert(!group.notes.find(n=>n.id===hash('event2')).related.some(n=>n.reason==='同一人物'));
 assert(!JSON.stringify(group).includes(memberId));
});

test('constellation reads persisted summaries and journals without loading DSH',async t=>{
 const f=fixture(t),history=new HistoryStore(f.root,account);
 history.db.prepare('INSERT INTO checkpoints(chat,at,text,source_hash) VALUES(?,?,?,?)').run(key,Date.now(),'测试摘要',hash('checkpoint'));
 history.close();
 const notebook=new FishNotebookStore(f.root,account),day='2026-11-13',persona={personaName:'测试角色',persona:'测试'};
 notebook.write({id:notebook.id(day,persona),date:day,personaName:persona.personaName,personaDigest:hash(persona.persona),version:1,
   accountScope:account,conversationKey:key,createdAt:Date.now(),sourceCount:3,text:'测试日记',visitors:{}});
 const view=createPeopleConsole({root:f.root,configFor:()=>f.config,plugin:async()=>{throw Error('DSH must not be called');}});
 const data=await view.constellation(new URLSearchParams());
 assert.deepEqual(data.unavailable,[]);
 const summary=data.notes.find(note=>note.category==='summary'),journal=data.notes.find(note=>note.category==='journal');
 assert.equal(summary.text,'测试摘要');assert.equal(journal.text,'测试日记');
 assert(summary.related.some(note=>note.id===journal.id&&note.reason==='同一聊天'));
 assert.equal(journal.readOnly,true);
});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'memory-workbench-'));fs.mkdirSync(path.join(root,'state/weflow'),{recursive:true});fs.writeFileSync(path.join(root,'state/weflow/active-account.json'),JSON.stringify({id:account}));fs.mkdirSync(path.join(root,'config'));const config=JSON.parse(fs.readFileSync(new URL('../config/wechatagent.example.json',import.meta.url),'utf8'));config.wechat.whitelist={private:['1'],groups:[]};fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify(config));fs.writeFileSync(path.join(root,'config/plugins.json'),JSON.stringify({version:1,plugins:{'people-memory':{enabled:true,permissions:['people_memory'],chats:[key],settings:{}}}}));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const memory=new PeopleMemory({root,accountScope:hash(account),accountId:account});memory.capture(turn('跨聊天都记住，我的猫叫奶糖'));return {root,memory,config,note:()=>memory.managementCatalog().people[0].notes[0]};}

test('owner corrections retain versions, revoke sharing, check revisions and suppress stale archive evidence',t=>{
 const f=fixture(t),old=f.note();f.memory.manage({id:old.id,revision:old.revision,action:'edit',text:'我的猫叫团子'});const next=f.note();assert.equal(next.version,2);assert.equal(next.visibility,'chat');assert.equal(next.history[0].text,'我的猫叫奶糖');assert.throws(()=>f.memory.manage({id:old.id,revision:old.revision,action:'pin'}),/REVISION/);assert.equal(f.memory.recall(turn('我的猫叫什么'))[0].notes[0].text,'我的猫叫团子');
 const overrides=f.memory.overrides(turn('我的猫叫什么')),person=hash('wxid_alice');assert(filterMemoryOverrides([{personId:person,text:'我的猫叫奶糖'}],overrides)[0].memoryRedacted);assert.equal(filterMemoryOverrides([{personId:hash('someone-else'),text:'我的猫叫奶糖'}],overrides)[0].text,'我的猫叫奶糖');
 const store=new HistoryStore(f.root,account);try{store.append(key,{id:'1',sender_id:'1',sender_wxid:'wxid_alice',sender_name:'小桃',timestamp:Date.now()/1000,text:'我的猫叫奶糖'});const context=continuityContext(store,key,{summaryChars:3200},{overrides,observations:turn('你记得吗').peopleObservations,accountId:account});assert(context.includes('团子'));assert(!context.includes('奶糖'));}finally{store.close();}
});

test('pin, forget, restore and source revocation preserve tombstones; locks fail safely and recover dead owners',t=>{
 const f=fixture(t);let n=f.note();f.memory.manage({id:n.id,revision:n.revision,action:'pin'});assert(f.note().pinned);n=f.note();f.memory.manage({id:n.id,revision:n.revision,action:'forget'});assert.equal(f.note().status,'forgotten');f.memory.capture(turn('跨聊天都记住，我的猫叫奶糖'));assert.equal(f.note().status,'forgotten');n=f.note();f.memory.manage({id:n.id,revision:n.revision,action:'restore'});assert.equal(f.note().status,'active');
 const lock=f.memory.file()+'.lock';fs.writeFileSync(lock,String(process.pid));assert.throws(()=>f.memory.capture(turn('我喜欢音乐')),/BUSY/);fs.writeFileSync(lock,'999999999');f.memory.capture(turn('我喜欢音乐'));assert(!fs.existsSync(lock));
});

test('management API rejects stale accounts, unauthorized origins and invalid actions; diagnostics only project safe metadata',async t=>{
 const f=fixture(t),api=createPeopleConsole({root:f.root,configFor:()=>f.config,plugin:async route=>route==='/health'?{ok:true,projectRoot:f.root,memoryContinuity:'layered-archive-v1',memoryWorkbench:'fact-management-v1',pluginHostFeatures:['people-memory-config-v1'],secret:'private-token'}:{sessions:[{conversationKey:key,memoryDiagnostics:{at:123,recentRecords:40,recentChars:8000,personNotes:2,rawText:'never return'}}]}});assert.equal(api.snapshot().stats.notes,1);assert.throws(()=>api.change({scope:'b'.repeat(64),id:f.note().id,revision:f.note().revision,action:'pin'}),/账号/);const d=await api.diagnostics();assert(d.dsh.loadedCurrentKernel);assert(!JSON.stringify(d).includes('private-token'));assert(!JSON.stringify(d).includes('never return'));f.config.wechat.whitelist.private=[];assert.throws(()=>api.change({scope:account,id:f.note().id,revision:f.note().revision,action:'pin'}),/范围/);
});

test('real HTTP endpoints enforce the console token and expose the management route',async t=>{
 const f=fixture(t),app=createConsole({root:f.root,port:0,fetchImpl:async()=>{throw Error('no real network');}});await app.start();t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port,info=await(await fetch(base+'/api/info')).json();assert.equal((await fetch(base+'/api/memory/people')).status,401);const headers={'x-console-token':info.token,'Content-Type':'application/json'};const data=await(await fetch(base+'/api/memory/people',{headers})).json();assert.equal(data.people.length,1);const n=data.people[0].notes[0];assert.equal((await fetch(base+'/api/memory/people',{method:'POST',headers,body:JSON.stringify({scope:account,id:n.id,revision:n.revision,action:'pin'})})).status,200);
});

test('constellation retains identity, scopes shared recalls and hides raw evidence',async t=>{
 const f=fixture(t),other='wechat:private:2';
 f.config.wechat.whitelist.private=['1','2'];
 fs.writeFileSync(path.join(f.root,'config/plugins.json'),JSON.stringify({version:1,plugins:{'people-memory':{enabled:true,permissions:['people_memory'],chats:[key,other],settings:{}}}}));
 f.memory.capture({...turn('我喜欢唱歌'),conversationKey:other});
 const b=turn('我喜欢游泳');
 b.peopleObservations[0].senderId='wxid_another';
 f.memory.capture(b);
 f.memory.recall({...turn('还记得我的猫吗'),conversationKey:other});
 const view=createPeopleConsole({root:f.root,configFor:()=>f.config,plugin:async()=>{}});
 const snapshot=await view.constellation(new URLSearchParams());
 assert.equal(snapshot.people,2);
 assert.equal(snapshot.total,3);
 assert(!JSON.stringify(snapshot).includes('evidenceId'));
 assert(!JSON.stringify(snapshot).includes('contextBatch'));
 const single=new URLSearchParams({scope:account,conversationKey:other});
 const graph=await view.constellation(single);
 assert.equal(graph.total,2);
 assert(graph.notes.some(note=>note.category==='pet'&&note.chat===key&&note.recalledAt));
 assert(!graph.notes.some(note=>note.text.includes('游泳')));
 single.set('revision',graph.revision);
 assert.equal((await view.constellation(single)).unchanged,true);
 f.config.wechat.whitelist.private=['2'];
 assert.equal((await view.constellation(single)).total,1);
 await assert.rejects(view.constellation(new URLSearchParams({conversationKey:key})),/允许/);
 await assert.rejects(view.constellation(new URLSearchParams({scope:'b'.repeat(64)})),/账号/);
});

test('ordinary chat produces source-bound events, updates one event, and respects identity and retention settings',async t=>{
 const f=fixture(t),now=Date.parse('2026-11-12T23:50:00+08:00');
 const memory=new PeopleMemory({root:f.root,accountScope:hash(account),accountId:account,now:()=>now+3600000});
 const episode=(text,after=0)=>{const item=turn(text);item.peopleObservations[0].at=now+after;return item;};
 const planned=episode('明天我们去露营，说定了');
 const completed=episode('昨天我去看电影了');
 assert.equal(memory.capture(planned,{episodesOnly:true}).saved,1);
 assert.equal(memory.capture(completed,{episodesOnly:true}).saved,1);
 for(const text of ['要不要明天一起露营？','如果明天我们去露营就好了','他说昨天去露营了','昨天我的朋友去露营了','不要记住我昨天去露营了','我昨天计划去露营','我昨天没去露营','明天我不去看电影','明天我去露营，手机号12345678900'])assert.deepEqual(conversationEpisodes(text,now),[],text);
 assert.equal(conversationEpisodes('今天我去爬山了',now)[0].state,'completed');
 const cancel=episode('明天的露营取消了',1000),sameName=structuredClone(cancel);
 sameName.peopleObservations[0].senderId='wxid_other';
 assert.equal(memory.capture(sameName,{episodesOnly:true}).saved,0);
 assert.equal(memory.capture({...cancel,conversationKey:'wechat:group:2'},{episodesOnly:true}).saved,0);
 assert.equal(memory.capture(cancel,{episodesOnly:true}).saved,1);
 assert.equal(memory.capture(cancel,{episodesOnly:true}).saved,0);
 assert.equal(memory.capture(planned,{episodesOnly:true}).saved,0);
 const notes=memory.managementCatalog().people.flatMap(person=>person.notes).filter(note=>note.episode);
 assert.deepEqual(notes.map(note=>[note.episode.day,note.episode.state,note.visibility]),[['2026-11-13','cancelled','chat'],['2026-11-11','completed','chat']]);
 assert.equal(notes[0].history.at(-1).episodeState,'planned');
 assert(memory.recall(episode('露营怎么安排')).some(person=>person.notes.some(note=>note.text.includes('已取消'))));
 assert(!memory.recall({...episode('露营怎么安排'),conversationKey:'wechat:group:2'}).some(person=>person.notes.some(note=>note.text.includes('露营'))));
 const disabled=new PeopleMemory({root:f.root,accountScope:hash(account),accountId:account,now:()=>now,settings:{rememberPlan:false}});
 assert.equal(disabled.capture(episode('昨天我去爬山了'),{episodesOnly:true}).saved,0);
 const graph=await createPeopleConsole({root:f.root,configFor:()=>f.config,now:()=>now+3600000}).constellation(new URLSearchParams({category:'event',eventState:'cancelled'}));
 assert.equal(graph.total,1);assert.equal(graph.notes[0].event.state,'cancelled');assert(!JSON.stringify(graph).includes('updatedFrom'));
 assert.deepEqual(consoleRoute('#constellation'),{page:'constellation'});
 assert.deepEqual(consoleRoute('#memory/constellation'),{page:'constellation'});
 assert.deepEqual(consoleRoute('#memory'),{page:'memory',section:'people'});
});

test('incoming events can reuse expired slots while preserving pinned events and forgotten evidence',t=>{
 const {root}=fixture(t),accountId=hash('episode capacity');
 let now=Date.parse('2026-11-12T19:30:00+08:00');
 const memory=new PeopleMemory({root,accountScope:accountId,accountId,now:()=>now,settings:{maxNotesPerPerson:16,planRetentionDays:1}});
 const incoming=text=>{const item=turn(text);item.peopleObservations[0].at=now;return memory.capture(item,{episodesOnly:true});};
 for(let i=0;i<16;i++)assert.equal(incoming(`昨天我去露营了，第 ${i} 次`).saved,1);
 const [pinned,forgotten]=memory.managementCatalog().people[0].notes;
 memory.manage({id:pinned.id,revision:pinned.revision,action:'pin'});
 memory.forget(forgotten.id);
 assert.equal(incoming('昨天我去爬山了').saved,0);
 now+=2*86400000;
 assert.equal(incoming('昨天我去爬山了').saved,1);
 const notes=memory.managementCatalog().people[0].notes;
 assert.equal(notes.length,16);assert(notes.some(note=>note.id===pinned.id&&note.pinned));assert(notes.some(note=>note.id===forgotten.id&&note.status==='forgotten'));
});

test('100/500-message synthetic probes use actual memory projections and score strictly',()=>{
 for(const turns of [100,500])for(const spec of MEMORY_CASES){const data=memoryEvaluationPrompt(spec.id,turns);assert(data.prompt.length<32000);assert.equal(data.turns,turns);assert(scoreMemoryAnswer(spec,JSON.stringify({[spec.field]:spec.expected})).passed);assert(!scoreMemoryAnswer(spec,'这是一个猜测').passed);if(['privacy','denied-sharing'].includes(spec.id))assert(!data.prompt.includes('奶糖'));}
 assert.throws(()=>memoryEvaluationPrompt('arbitrary',500));assert.throws(()=>memoryEvaluationPrompt('recall',999999));
});

test('evaluation requires explicit allowance, performs five fake probes, and cancels without real sends',async t=>{
 const f=fixture(t);let calls=0;const api=createMemoryEvaluation({root:f.root,configFor:()=>f.config,plugin:async(route,body)=>{if(route==='/health')return {memoryEvaluation:'synthetic-probe-v1',memoryEvaluationTransport:'authenticated-rpc-v2'};calls++;const spec=MEMORY_CASES.find(s=>s.id===body.scenario);return {model:{provider:'fake',model:'test'},text:JSON.stringify({[spec.field]:spec.expected})};}});assert.throws(()=>api.start({scope:account,conversationKey:key,turns:100,confirmed:false}),/确认/);api.start({scope:account,conversationKey:key,turns:100,confirmed:true});for(let i=0;i<30&&api.snapshot().state==='running';i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(api.snapshot().state,'completed');assert.equal(calls,5);assert(api.snapshot().results.every(row=>row.passed));
 const slow=createMemoryEvaluation({root:f.root,configFor:()=>f.config,plugin:async(route,body,{signal}={})=>{if(route==='/health')return {memoryEvaluation:'synthetic-probe-v1',memoryEvaluationTransport:'authenticated-rpc-v2'};return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});const job=slow.start({scope:account,conversationKey:key,turns:500,confirmed:true});slow.cancel({scope:account,id:job.id});await new Promise(resolve=>setImmediate(resolve));assert.equal(slow.snapshot().state,'cancelled');
 const restarted=createMemoryEvaluation({root:f.root,configFor:()=>f.config,plugin:async()=>{throw Error('must not auto retry');}});assert.equal(restarted.snapshot().state,'cancelled');assert.equal(restarted.snapshot().id,job.id);
});

test('diagnostics require configurable plugin support and the matching workspace before reporting ready',async t=>{
 const f=fixture(t);let health={ok:true,projectRoot:f.root,memoryContinuity:'layered-archive-v1',memoryWorkbench:'fact-management-v1'};
 const api=createPeopleConsole({root:f.root,configFor:()=>f.config,plugin:async route=>route==='/health'?health:{sessions:[]}});
 let d=await api.diagnostics();assert(!d.dsh.loadedCurrentKernel);assert(!d.dsh.configurablePlugin);assert.match(d.message,/可配置/);
 health.pluginHostFeatures=['people-memory-config-v1'];assert((await api.diagnostics()).dsh.loadedCurrentKernel);
 health.projectRoot=path.join(f.root,'another-workspace');d=await api.diagnostics();assert(!d.dsh.loadedCurrentKernel);assert.match(d.message,/目录/);
 delete health.projectRoot;assert(!(await api.diagnostics()).dsh.loadedCurrentKernel);
});
