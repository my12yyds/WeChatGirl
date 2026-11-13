import crypto from 'node:crypto';
import {selfFacts} from '../packages/plugin-api/people-facts.mjs';

const categories={event:'聊天事件',nickname:'昵称',preference:'偏好',pet:'宠物',project:'项目',activity:'活动',plan:'计划',fact:'事实',member:'群友观察',summary:'聊天摘要',journal:'日记'};
const eventStates={planned:'已约定',completed:'已发生',cancelled:'已取消'};
const hex=/^[a-f0-9]{64}$/;
const validStatus=new Set(['active','all','forgotten','expired']);
const fault=(message,status=400)=>Object.assign(Error(message),{status});

const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function constellationSnapshot({account,catalog,allowedChats,activeChats,allowCrossChat,autoEvents,params,extra=[],unavailable=[]}){
  const chat=params.get('conversationKey')??'';
  if(chat&&!allowedChats.has(chat))throw fault('请选择当前允许的聊天。',403);
  const query=(params.get('query')??'').trim().normalize('NFKC').toLocaleLowerCase();
  const status=params.get('status')??'active';
  const category=params.get('category')??'';
  const eventState=params.get('eventState')??'';
  const limit=Number(params.get('limit')??160);
  const offset=Number(params.get('offset')??0);
  if(query.length>80||!validStatus.has(status)||category&&!Object.hasOwn(categories,category)||eventState&&!Object.hasOwn(eventStates,eventState)||
    !Number.isSafeInteger(limit)||limit<1||limit>320||!Number.isSafeInteger(offset)||offset<0)throw fault('星图筛选条件无效。');
  const recalled=new Map();
  for(const [source,usage] of Object.entries(catalog.usage)){
    if(!activeChats.has(source)||chat&&source!==chat||!Number.isSafeInteger(usage.lastRecallAt)||
       !Array.isArray(usage.recalledNoteIds))continue;
    for(const id of usage.recalledNoteIds.slice(0,40)){
      if(!hex.test(id))continue;
      if(!recalled.has(id))recalled.set(id,new Map());
      recalled.get(id).set(source,usage.lastRecallAt);
    }
  }
  const matches=[];
  const identities=new Map(),topics=new Map();
  for(const person of catalog.people){
    const name=person.names[0]||'未命名人物';
    for(const id of Array.isArray(person.archiveIds)?person.archiveIds:[]){
      if(hex.test(id))identities.set(id,identities.has(id)?null:person.id);
    }
    for(const note of person.notes){
      if(!allowedChats.has(note.chat)||status!=='all'&&note.status!==status)continue;
      const mayShare=allowCrossChat&&note.status==='active'&&note.visibility==='person'&&activeChats.has(note.chat);
      const hits=recalled.get(note.id);
      const shownInChat=!chat||note.chat===chat||mayShare&&hits?.has(chat);
      if(!shownInChat)continue;
      const event=note.episode&&Object.hasOwn(eventStates,note.episode.state)?{
        state:note.episode.state,day:/^\d{4}-\d{2}-\d{2}$/.test(note.episode.day)?note.episode.day:'',
        when:typeof note.episode.when==='string'?note.episode.when.slice(0,48):'',
        observedAt:Number.isSafeInteger(note.episode.observedAt)?note.episode.observedAt:0
      }:null;
      const fact=event?null:selfFacts(note.text)[0];
      const type=event?'event':fact?.category??'fact';
      if(category&&type!==category)continue;
      if(eventState&&event?.state!==eventState)continue;
      if(query&&![...person.names,note.text,categories[type],...(event?[event.day,eventStates[event.state]]:[])].some(value=>value.normalize('NFKC').toLocaleLowerCase().includes(query)))continue;
      const recalledAt=note.status==='active'&&activeChats.has(note.chat)&&hits
        ?mayShare?Math.max(...hits.values()):hits.get(note.chat)??0:0;
      matches.push({id:note.id,personId:person.id,name,text:note.text,category:type,chat:note.chat,status:note.status,
        visibility:note.visibility,pinned:note.pinned===true,at:note.modifiedAt??note.at,expiresAt:note.expiresAt,recalledAt,revision:note.revision,...(event?{event}:{})});
      const topic=event?.day&&typeof note.episode.topic==='string'?['event',event.day,note.episode.topic]:null;
      if(topic)topics.set(note.id,hash([note.chat,...topic]));
    }
  }
  for(const note of extra){
    if(!allowedChats.has(note.chat)||chat&&note.chat!==chat||eventState||!['active','all'].includes(status)||category&&note.category!==category)continue;
    if(query&&![note.name,note.text,categories[note.category]].some(value=>value.normalize('NFKC').toLocaleLowerCase().includes(query)))continue;
    matches.push({...note,memberId:undefined,personId:note.memberId?identities.get(note.memberId)??hash(['group-member',note.chat,note.memberId]):hash(['chat',note.chat]),
      status:'active',visibility:'chat',readOnly:true,recalledAt:0});
  }
  matches.sort((a,b)=>(category==='event'?(b.event?.day??'').localeCompare(a.event?.day??''):b.recalledAt-a.recalledAt||Number(b.pinned)-Number(a.pinned))||b.at-a.at||a.id.localeCompare(b.id));
  const notes=matches.slice(offset,offset+limit);
  const byPerson=new Map(),byChat=new Map(),byTopic=new Map(),positions=new Map(matches.map((note,index)=>[note.id,index]));
  for(const note of matches)for(const [index,key] of [[byPerson,note.personId],[byChat,note.chat],[byTopic,topics.get(note.id)]]){
    if(!key||index.get(key)?.length>=9)continue;
    if(!index.has(key))index.set(key,[]);
    index.get(key).push(note);
  }
  for(const note of notes){
    const related=new Map();
    for(const [reason,rows] of [['同日同类事件',byTopic.get(topics.get(note.id))],['同一人物',!['summary','journal'].includes(note.category)?byPerson.get(note.personId):null],['同一聊天',byChat.get(note.chat)]]){
      for(const other of (rows??[]).filter(other=>other.id!==note.id&&!related.has(other.id)).slice(0,3)){
        related.set(other.id,{id:other.id,name:other.name,text:other.text.slice(0,65),reason,offset:Math.floor(positions.get(other.id)/limit)*limit});
      }
    }
    note.related=[...related.values()];
  }
  const data={scope:account,chats:[...allowedChats],activeChats:[...activeChats],autoEvents:!!autoEvents&&(chat?activeChats.has(chat):activeChats.size>0),notes,total:matches.length,
    offset,unavailable,people:new Set(matches.filter(note=>!['summary','journal'].includes(note.category)).map(note=>note.personId)).size,events:matches.filter(note=>note.event).length,recalled:matches.filter(note=>note.recalledAt).length,categories,eventStates};
  const revision=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return params.get('revision')===revision?{scope:account,revision,unchanged:true}:{...data,revision};
}
