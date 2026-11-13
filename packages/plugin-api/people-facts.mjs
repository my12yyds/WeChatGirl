const normalize=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
const sensitive=/密码|验证码|令牌|token|api.?key|身份证|银行卡|手机号|电话号码|住址|疾病|抑郁|诊断|政治|政党|宗教|性取向|性癖|自杀|健康|血型|收入|工资|[\d]{7,}|https?:|[<>{}\[\]`]/i;
const eventTime=/(?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|(?:下周|上周|本周|这周|周|星期)[一二三四五六日天]|前天|昨天|今天|明天|后天)(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?(?:\s*(?:\d{1,2}|[一二两三四五六七八九十]{1,3})(?:点半?|:\d{2}))?/u;
const activity=/(?:打游戏|打完(?:了)?游戏|打球|踢球|羽毛球|篮球|足球|聚餐|聚会|吃饭|吃了饭|看电影|看完(?:了)?电影|看演出|开会|复盘|面试|考试|旅行|旅游|露营|爬山|徒步|跑步|骑行|演出|比赛|见面|拍照|排练|约饭|发布|上线|交付|报名|搬家|毕业|入职|庆祝|参观|参赛)/u;
const sameActivity={约饭:'聚餐',吃饭:'聚餐',吃了饭:'聚餐',旅游:'旅行',看演出:'演出',看电影:'电影',看完电影:'电影',看完了电影:'电影',打完游戏:'打游戏',打完了游戏:'打游戏'};
const ownEvent=/(?:^|[，,\s])(?:我(?!的|朋友|同事|同学|室友|家人|爸|妈|哥|姐|弟|妹|对象|老板|队友|邻居)|咱们|咱俩)|(?:一起|咱们).{0,20}(?:定了|说定了)/u;
const DAY=86400000;

function episodeDay(when,at,state){
 if(!when)return '';
 const local=new Date(at+8*3600000),today=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
 const explicit=when.match(/^(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})/);
 if(explicit){
  const iso=new Date(Date.UTC(+explicit[1],+explicit[2]-1,+explicit[3])).toISOString().slice(0,10);
  return iso===`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`?iso:'';
 }
 const relative={前天:-2,昨天:-1,今天:0,明天:1,后天:2}[when.slice(0,2)];
 if(relative!==undefined)return new Date(today+relative*DAY).toISOString().slice(0,10);
 const week=when.match(/^(下周|上周|本周|这周|周|星期)([一二三四五六日天])/);
 if(!week)return '';
 const weekday='一二三四五六日'.indexOf(week[2].replace('天','日'));
 let offset=weekday-(local.getUTCDay()+6)%7;
 if(week[1]==='下周')offset+=7;
 if(week[1]==='上周')offset-=7;
 if(['周','星期'].includes(week[1])){
  if(offset<0&&state==='planned')offset+=7;
  if(offset>0&&state==='completed')offset-=7;
 }
 return new Date(today+offset*DAY).toISOString().slice(0,10);
}

export function conversationEpisodes(text,at){
 if(typeof text!=='string'||sensitive.test(text)||/[?？“”「」"']|假如|假设|如果|比如|例如|据说|听说|他说|她说|(?:别人|朋友|同事|同学|室友)说|转发|引用|可能|也许|大概|恐怕|要不要|要不|能不能|去不去|不知道|开玩笑|梦见|别记|不要记|不许记|忘记|管理员|系统指令|提示词/u.test(text))return [];
 const episodes=[];
 for(const raw of text.split(/[。！!；;\n]/u)){
  const sentence=raw.trim();
  if(sentence.length<5||sentence.length>160||/(?:吗|么|呢|吧)[，,\s]*$/u.test(sentence))continue;
  const mention=sentence.match(activity)?.[0];
  if(!mention)continue;
  const topic=sameActivity[mention]??mention;
  const when=sentence.match(eventTime)?.[0]??'';
  const afterDate=when?sentence.slice(sentence.indexOf(when)+when.length).trim():'';
  const firstPerson=ownEvent.test(sentence)||!!afterDate&&ownEvent.test(afterDate);
  const cancelled=/取消了?|改期了|不去(?:了|参加)|不办了|不开了|不打了|不聚了|不看了|不去了/u.test(sentence);
  const declined=/没(?:有)?(?:去|参加|做|看|打|完成)|还没|未完成|不(?:打算|想|会|去|参加|做|看|打)|去不了|不能去/u.test(sentence);
  const past=/昨天|前天|上周|刚刚|刚才|上次/u.test(when||sentence);
  const completed=/(?:已经|刚刚|刚才).{0,18}(?:完了|结束|了|成功|回来)|完成了|结束了|举行了|上线了|发布了|交付了|看完了|打完了|考完了|跑完了|回来了|(?:去|吃|看|打|开|参加)了/u.test(sentence)||!!when&&sentence.endsWith(mention+'了');
  const planned=/约好|说定了|定了|计划|准备|打算/u.test(sentence)||!!when&&/(?:一起|会去|要去|去|参加|开始)/u.test(sentence.slice(sentence.indexOf(when)+when.length));
  let state;
  if(cancelled&&(firstPerson||when))state='cancelled';
  else if(!declined&&firstPerson&&(past||completed)&&!/(?:打算|准备|计划|想去|想要|要去|会去|差点)/u.test(sentence))state='completed';
  else if(!declined&&when&&(firstPerson||/约好了|说定了|就这么定了/u.test(sentence))&&planned&&!past)state='planned';
  if(!state)continue;
  const day=episodeDay(when,at,state);
  if(when&&!day)continue;
  const sourceDay=episodeDay('今天',at,state);
  if(day&&(state==='planned'&&day<sourceDay||state==='completed'&&day>sourceDay))continue;
  episodes.push({text:sentence,topic,when,day,state});
 }
 return episodes.slice(0,3);
}
export function sharingConfirmed(text){return !/[?？]|能不能|可不可以|是否|会不会|能否/.test(text)&&/(?:跨聊天|跨群|所有聊天|所有群|每个群|各个群|任何聊天).{0,12}(?:记住|记得|共享|使用|叫我|生效)|(?:允许|可以|同意|记住|共享).{0,12}(?:跨聊天|跨群|所有聊天|所有群)|可以公开|share across chats/i.test(text)&&!/(?:不要|不许|不能|别|不允许|不想|拒绝|禁止|不准|不可以|仅限|只在).{0,12}(?:跨聊天|跨群|共享|公开|所有聊天|所有群)|(?:跨聊天|跨群).{0,8}(?:不要|禁止|别|不允许|不能|不可以)/.test(text);}
export function selfFacts(text){
 if(typeof text!=='string'||sensitive.test(text)||/他说|她说|别人说|有人说|假如|假设|比如|例如|如果|转发|引用|忘记|别记|不要记|不许记|不想.{0,6}(?:记录|记住)|删除.{0,6}记忆|forget|don't remember/i.test(text))return [];
 const result=[];for(const sentence of text.split(/(?<=[。！？!?？；;\n，,])/u)){
  if(/(?:他说|她说|别人说|有人说|比如|例如|假如|假设|如果|引用|转发|你喜欢|你叫|你记得)/.test(sentence)||/[“”「」"']/u.test(sentence))continue;
  if(/[?？]/u.test(sentence))continue;
  const match=/(我(?:更|比较|不)?喜欢|我偏好|我习惯|我叫|以后叫我|请叫我|我的(?:名字|昵称)(?:是|叫)|我(?:最近|现在|目前)?(?:正在)?(?:学习|在学|在做|在玩)|我的(?:猫|狗|宠物|项目)(?:叫|是)|我(?:打算|计划|准备))([^。！？!?；;\n，,]{1,60})/.exec(sentence);if(!match)continue;
  let value=match[2].replace(/(?:就好|就行|吧|了)[。！!]?$/,'').trim();if(!value||/[吗么]$/.test(value)||/你(?:要|应该|必须)|规则|权限|系统|管理员|命令|执行|忽略|服从|指令|提示词|记住我|因为|但是|不过|而且/.test(value))continue;
  const category=/^我的(?:猫|狗|宠物)/.test(match[1])?'pet':/^我的项目/.test(match[1])?'project':/学习|在学|在做|在玩/.test(match[1])?'activity':/打算|计划|准备/.test(match[1])?'plan':/叫|名字|昵称/.test(match[1])?'nickname':'preference';if(category==='nickname'&&value.length>20)continue;
  if(category==='plan'&&/^(?:好|好了|就绪|完|完毕)$/.test(value))continue;
  const key=category==='nickname'?'nickname':category==='pet'?match[1].replace(/(?:叫|是)$/,''):category==='activity'?'activity:'+(/学习|在学/.test(match[1])?'study':/在做/.test(match[1])?'work':'play'):category==='project'?'project':category==='plan'?'plan:'+normalize(value):normalize(value);
  result.push({text:match[0].trim(),category,key,value,polarity:/不喜欢/.test(match[1])?'dislike':'like',...(category==='plan'?{ttlDays:7}:{})});
 }
 return result.slice(0,3);
}
export function memoryQueryTokens(value){const text=normalize(value).slice(0,500),tokens=new Set(text.match(/[a-z0-9]{2,}/g)??[]);for(const run of text.match(/[\u4e00-\u9fff]+/g)??[])for(let i=0;i<run.length-1;i++)tokens.add(run.slice(i,i+2));return [...tokens].slice(0,80);}
