const DAY=86400000;
const categories={event:'聊天事件',nickname:'昵称',preference:'偏好',pet:'宠物',project:'项目',activity:'活动',plan:'计划',fact:'事实'};
const eventStates={planned:'已约定',completed:'已发生',cancelled:'已取消'};
export const demoChats={'demo:camp':'演示 · 周末出游群','demo:work':'演示 · 创作群','demo:private':'演示 · 好友对话'};
const patterns=['nickname','preference','pet','project','activity','planned','completed','cancelled'];
const conversations=[
  ['海盐','demo:camp',['以后叫我海盐','我更喜欢喝乌龙茶','我的猫叫芝麻','我在做一张露营手绘地图','我最近在学辨认星座','周六我们去营地，说定了','昨天我们去山顶看日出了','原来约好的夜间徒步取消了']],
  ['小桃','demo:private',['我叫小桃','我习惯早上喝美式','我的狗叫团子','我的项目是手写食谱','我最近在学做酸面包','周日一起试做披萨','昨天我把面包烤好了','周五的甜点课取消了']],
  ['山茶','demo:work',['以后叫我山茶','我偏好用冷色画插图','我的猫叫栗子','我的项目是一本城市速写册','我在学水彩画','下周六一起去画展，说定了','昨天我画完了第一张插图','原定的画室聚会取消了']],
  ['暮云','demo:camp',['我叫暮云','我喜欢阴天骑行','我的狗叫馒头','我在做一份骑行路线册','我最近在练长距离骑行','周日我们去湖边骑行','昨天我骑完了沿江路线','山路骑行取消了']],
  ['松露','demo:work',['以后叫我松露','我喜欢听民谣写代码','我的猫叫拿铁','我在做一个本地播放器','我最近在学做混音','周五一起试听新版，说定了','昨天我发了播放器测试版','原定的录音排练取消了']],
  ['白柚','demo:private',['我叫白柚','我比较喜欢纸质书','我的狗叫麦芽','我的项目叫街角书单','我在学摄影','明天一起去旧书店','昨天我去看了电影','约好的周末拍照取消了']]
];
const id=n=>(Math.imul(n,2654435761)>>>0).toString(16).padStart(8,'0').padEnd(64,'0');

export function makeDemoNotes(now=Date.now()){
  return conversations.flatMap(([name,chat,texts],person)=>texts.map((text,index)=>{
    const pattern=patterns[index],isEvent=index>=5,at=now-(index+person*2)*DAY;
    const status=index===4&&person>=4?(person===4?'forgotten':'expired'):'active';
    const eventAt=index===5?now+(person+1)*DAY:at-DAY;
    const day=new Date(eventAt+8*3600000).toISOString().slice(0,10);
    const content=index===5?text.replace(/^(?:下周六|周六|周日|周五|明天)/,day+' '):text;
    return {id:id(100+person*texts.length+index),personId:id(person+1),name,chat,text:content,category:isEvent?'event':pattern,status,
      visibility:'chat',pinned:index===person||index===5&&person%2===0,at,expiresAt:status==='expired'?now-DAY:now+30*DAY,
      recalledAt:status==='active'&&(index+person)%4===0?now-3600000:0,
      ...(isEvent?{event:{state:pattern,day,when:'',observedAt:at}}:{})};
  }));
}

export function demoSnapshot(notes,params){
  const chat=params.get('conversationKey'),category=params.get('category'),eventState=params.get('eventState');
  const status=params.get('status')??'all',query=(params.get('query')??'').trim().normalize('NFKC').toLocaleLowerCase();
  const matched=notes.filter(note=>(!chat||note.chat===chat)&&(!category||note.category===category)&&
    (!eventState||note.event?.state===eventState)&&(status==='all'||note.status===status)&&
    (!query||[note.name,note.text,categories[note.category],note.event?.day??'',eventStates[note.event?.state]??''].some(text=>text.normalize('NFKC').toLocaleLowerCase().includes(query))));
  return {notes:matched.slice(0,Number(params.get('limit')??320)),total:matched.length,chats:Object.keys(demoChats),categories,eventStates,
    people:new Set(matched.map(note=>note.personId)).size,events:matched.filter(note=>note.event).length,recalled:matched.filter(note=>note.recalledAt).length};
}
