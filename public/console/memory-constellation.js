import {TAU,armAngle,galaxyProjection,createGalaxyRenderer} from './memory-galaxy.mjs';
import {demoChats,makeDemoNotes,demoSnapshot} from './memory-constellation-demo.mjs';

const palette={event:'#ffd27e',nickname:'#e6a6ff',preference:'#ffabd3',pet:'#f3e68e',project:'#a5aaff',activity:'#72dfda',plan:'#83cbff',fact:'#d3e3ff',member:'#9cddb6',summary:'#7cbbff',journal:'#f5a5b7'};
const eventPalette={planned:'#ffd27e',completed:'#8df7b8',cancelled:'#ff9f8e'};
const inactivePalette={expired:'#8a9ab7',forgotten:'#9f88ad'};
const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const short=(text,length)=>Array.from(text).slice(0,length).join('')+(Array.from(text).length>length?'…':'');
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const keyNumber=key=>parseInt(key.slice(0,8),16)/0xffffffff;
const nodeStatus={active:'有效',forgotten:'已忘记或被替代',expired:'已过期'};
const appearanceKey='wechatgirl.constellation.appearance';

export function starStyle(note){
  const color=inactivePalette[note.status]??eventPalette[note.event?.state]??palette[note.category]??palette.fact;
  if(note.status!=='active')return {color,radius:2.8,level:'沉寂',reason:nodeStatus[note.status],dust:2};
  if(note.pinned)return {color,radius:8.2,level:'核心',reason:'已手动置顶',dust:10};
  if(note.recalledAt)return {color,radius:6.2,level:'重要',reason:'最近被召回',dust:7};
  if(note.event?.state==='planned'||['nickname','pet','project'].includes(note.category)){
    return {color,radius:5.2,level:'重要',reason:note.event?'待履行的约定':'长期人物资料',dust:5};
  }
  return {color,radius:3.8,level:'普通',reason:'一般记录',dust:3};
}

function initialAppearance(){
  try{return localStorage.getItem(appearanceKey)==='simple'?'simple':'effects';}catch{return 'effects';}
}

export function constellationMarkup(){
  return `<section class="constellation" data-constellation data-appearance="${initialAppearance()}">
    <header class="constellation-heading">
      <button type="button" class="button" data-star-back>← 返回</button>
      <div class="constellation-switch" aria-label="记忆浏览方式"><button type="button" data-star-mode="graph" aria-pressed="true">关系星图</button><button type="button" data-star-mode="timeline" aria-pressed="false">事件时间线</button></div>
      <div class="actions">
        <button class="button" type="button" data-star-filter aria-controls="star-filters" aria-expanded="false">筛选</button>
        <button class="button" type="button" data-star-inspector aria-controls="star-inspector" aria-expanded="false">记忆列表</button>
        <button class="button" type="button" data-star-demo aria-pressed="false">演示星系</button>
        <div class="constellation-switch constellation-appearance" aria-label="星图外观"><button type="button" data-star-appearance="effects">特效</button><button type="button" data-star-appearance="simple">极简</button></div>
        <button class="button" type="button" data-plugin-settings="people-memory">记录设置</button>
      </div>
    </header>
    <form id="star-filters" class="constellation-filters" data-star-filters hidden>
      <label class="field">聊天范围<select name="chat"><option value="">全部允许的聊天</option></select></label>
      <label class="field">搜索记忆<input name="query" type="search" maxlength="80" placeholder="人物或记忆内容"></label>
      <label class="field">记忆类型<select name="category"><option value="">全部类型</option></select></label>
      <label class="field" data-star-event-filter hidden>事件进展<select name="eventState"><option value="">全部进展</option></select></label>
      <label class="field">记录状态<select name="status"><option value="active">有效记忆</option><option value="all">全部状态</option><option value="forgotten">已忘记或被替代</option><option value="expired">已过期</option></select></label>
    </form>
    <div class="constellation-workspace">
      <div class="constellation-stats"><strong data-star-count>记忆星图</strong><p class="constellation-summary" data-star-summary aria-live="polite">正在读取记忆…</p></div>
      <div class="constellation-map">
        <div class="constellation-tools" aria-label="星图视角">
          <button type="button" class="button small" data-star-view="in" aria-label="放大">+</button>
          <button type="button" class="button small" data-star-view="out" aria-label="缩小">−</button>
          <button type="button" class="button small" data-star-view="top">俯视</button>
          <button type="button" class="button small" data-star-view="edge">侧视</button>
          <button type="button" class="button small" data-star-view="reset">重置视角</button>
          <button type="button" class="button small" data-star-view="rotate" aria-pressed="false">缓慢旋转</button>
        </div>
        <canvas data-star-galaxy aria-hidden="true" hidden></canvas>
        <canvas data-star-canvas aria-hidden="true"></canvas>
        <div class="constellation-tooltip" data-star-tooltip hidden></div>
        <p class="constellation-map-hint">拖动或缩放 · 大星更重要 · 光环表示最近召回</p>
        <div class="constellation-legend" data-star-legend aria-label="记忆类型图例"></div>
      </div>
      <div class="constellation-timeline" data-star-timeline hidden aria-label="事件时间线"></div>
      <div class="constellation-empty" data-star-empty hidden></div>
      <aside id="star-inspector" class="constellation-inspector" aria-label="记忆详情和列表" hidden>
        <header class="constellation-inspector-heading"><strong>记忆详情</strong><button type="button" class="button small" data-star-close aria-label="关闭记忆详情">×</button></header>
        <div data-star-detail class="constellation-detail"><h3>记忆详情</h3><p>选择星点或下方列表中的记忆。</p></div>
        <h3 class="constellation-list-heading">记忆列表</h3>
        <div class="constellation-list" data-star-list aria-label="记忆列表"></div>
      </aside>
    </div>
    <div class="constellation-footer">
      <span data-star-capture>聊天事件由鲸鱼娘从已授权的日常聊天自动记录。</span>
      <div class="actions" data-star-pages hidden><button class="button small" data-star-page="previous">上一批</button><span data-star-range></span><button class="button small" data-star-page="next">下一批</button></div>
      <div class="actions"><label>最多显示 <select data-star-limit><option value="80">80 条</option><option value="160">160 条</option><option value="320" selected>320 条</option></select></label><button class="button small" type="button" data-star-refresh>刷新记忆</button></div>
    </div>
  </section>`;
}

function makeScene(notes){
  const people=new Map();
  for(const note of notes){
    if(!people.has(note.personId))people.set(note.personId,[]);
    people.get(note.personId).push(note);
  }
  const names=new Map();
  for(const items of people.values()){
    const name=items[0].name;
    names.set(name,(names.get(name)??0)+1);
  }
  const centers=[],stars=[];
  [...people.keys()].sort().forEach((id,index)=>{
    const items=people.get(id),count=people.size;
    const radius=count===1?.21:.15+Math.sqrt((index+.5)/count)*.62;
    const angle=armAngle(index%3,radius)+(keyNumber(id)-.5)*.46;
    const name=items[0].name;
    const center={id,name:names.get(name)>1?short(name,7)+' · '+id.slice(-4):name,
      x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,z:(keyNumber(id)-.5)*.19};
    centers.push(center);
    [...items].sort((a,b)=>a.id.localeCompare(b.id)).forEach((note,j)=>{
      const theta=j*2.399963+keyNumber(id)*6.28;
      const orbit=(.052+Math.sqrt((j+1)/items.length)*.13)*(count<=3?1.45:1);
      const style=starStyle(note),offset=keyNumber(note.id);
      const star={note,center,style,x:center.x+Math.cos(theta)*orbit,y:center.y+Math.sin(theta)*orbit,z:center.z+(offset-.5)*.18};
      star.dust=Array.from({length:style.dust},(_,i)=>{
        const angle=i*2.399963+offset*TAU,spread=.014+Math.sqrt((i+1)/style.dust)*.053;
        return {x:star.x+Math.cos(angle)*spread,y:star.y+Math.sin(angle)*spread,z:star.z+Math.sin(i*1.8)*spread};
      });
      stars.push(star);
    });
  });
  return {centers,stars};
}

function starCanvas(canvas,galaxy,tooltip,onSelect,onMotion){
  const g=canvas.getContext('2d');
  if(!g)return {set(){},select(){},view(){},appearance(){},visible(){},dispose(){}};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let scene=makeScene([]),hit=[],active='',hovered='',width=1,height=1,pitch=.97,yaw=.44,zoom=1,frame=0,gesture=null;
  let renderer,cameraMove,density=1,effects=false,rotation=true,visible=true,elapsed=0,previous=0,dirty=true;
  const spinning=()=>visible&&effects&&rotation&&!reduced.matches;
  const animate=()=>spinning()&&!document.hidden&&!gesture&&!hovered;
  function draw(now){
    frame=0;
    const moving=animate();
    if(!dirty&&!cameraMove&&(!moving||now-previous<32)){if(moving)queue();return;}
    if(moving&&previous)elapsed+=Math.min(now-previous,75)/1000;
    previous=moving?now:0;dirty=false;
    if(cameraMove){
      const progress=reduced.matches?1:clamp((now-cameraMove.start)/380,0,1);
      pitch=cameraMove.from+(cameraMove.to-cameraMove.from)*(1-(1-progress)**3);
      if(progress===1)cameraMove=null;
    }
    g.clearRect(0,0,width,height);
    for(let i=0;i<(effects?415:55);i++){
      const pulse=effects ? .78+.22*Math.sin(elapsed*.8+i*1.71) : 1;
      g.fillStyle=`rgba(211,223,255,${(.13+(i%7)*.068)*pulse})`;
      const x=(i*.61803398875%1)*width,y=(i*.754877666+i*i*.013573%1)%1*height;
      const size=i%19===0?2.2:i%4===0?1.4:.9;
      g.fillRect(x,y,size,size);
      if(effects&&i%29===0){
        g.fillStyle=`rgba(211,196,255,${.21*pulse})`;
        g.fillRect(x-3,y+.4,8,.8);g.fillRect(x+.4,y-3,.8,8);
      }
    }
    const camera=galaxyProjection(width,height,zoom,yaw+elapsed*TAU/145,pitch);
    const project=camera.point;
    if(effects){
      renderer??=createGalaxyRenderer(galaxy,paint);
      renderer.draw(g,camera,width,height,density);
      const core=project({x:0,y:0,z:0}),radius=Math.max(10,camera.scale*.21);
      const glow=g.createRadialGradient(core.x,core.y,0,core.x,core.y,radius);
      glow.addColorStop(0,'#fff3cb80');glow.addColorStop(.24,'#e9adff43');glow.addColorStop(1,'#9040cc00');
      g.fillStyle=glow;g.fillRect(core.x-radius,core.y-radius,radius*2,radius*2);
    }
    const centers=new Map(scene.centers.map(c=>[c.id,project(c)]));
    hit=scene.stars.map(star=>({...star,...project(star)})).sort((a,b)=>a.depth-b.depth);
    const focus=hit.find(item=>item.note.id===(hovered||active))?.center.id;
    const highlighted=hit.find(item=>item.note.id===(hovered||active));
    if(highlighted?.note.related?.length){
      const related=new Map(highlighted.note.related.map(row=>[row.id,row.reason]));
      for(const star of hit){
        if(!related.has(star.note.id))continue;
        g.strokeStyle=related.get(star.note.id)==='同一聊天'?'#83cbff99':'#ffd27ecc';g.lineWidth=1.15;
        g.beginPath();g.moveTo(highlighted.x,highlighted.y);g.lineTo(star.x,star.y);g.stroke();
      }
    }
    for(const star of hit){
      const c=centers.get(star.center.id),selected=star.note.id===(hovered||active);
      g.beginPath();g.moveTo(c.x,c.y);g.lineTo(star.x,star.y);
      g.strokeStyle=selected?'#ddd5ff':focus&&star.center.id!==focus?'rgba(130,120,204,.12)':star.note.recalledAt?'rgba(163,160,255,.65)':'rgba(153,148,232,.31)';
      g.lineWidth=selected?1.7:.8;g.stroke();
      if(effects&&(selected||star.note.recalledAt||(!focus&&keyNumber(star.note.id)<.18))){
        const travel=(elapsed*.37+keyNumber(star.note.id))%1;
        const x=c.x+(star.x-c.x)*travel,y=c.y+(star.y-c.y)*travel;
        g.globalAlpha=.25+.66*Math.sin(travel*Math.PI);g.fillStyle=star.style.color;
        g.beginPath();g.arc(x,y,selected?2.2:1.45,0,TAU);g.fill();g.globalAlpha=1;
      }
    }
    for(const person of scene.centers){
      const p=centers.get(person.id);
      g.strokeStyle='rgba(187,169,255,.53)';g.lineWidth=1;g.beginPath();g.arc(p.x,p.y,9,0,Math.PI*2);g.stroke();
      if(effects){g.shadowColor='#b19bff';g.shadowBlur=16;}
      g.fillStyle='#f2eaff';g.beginPath();g.arc(p.x,p.y,5,0,TAU);g.fill();g.shadowBlur=0;
      if(scene.centers.length<=9||person.id===focus){
        g.font='600 12px system-ui';g.fillText(short(person.name,12),p.x+9,p.y-7);
      }
    }
    for(const {note,x,y,style,dust,center,factor} of hit){
      const {color,radius}=style,size=radius*factor;
      const selected=note.id===(hovered||active);
      const opacity=note.status!=='active'||focus&&center.id!==focus ? .48 : 1;
      g.fillStyle=color;
      if(effects){
        g.globalAlpha=.42*opacity;
        for(const point of dust){const p=project(point);g.fillRect(p.x,p.y,1.35,1.35);}
        if(size>=5||hit.length<120){g.shadowColor=color;g.shadowBlur=size>=5?15:7;}
      }
      g.globalAlpha=opacity;
      if(note.recalledAt||selected){
        g.strokeStyle=color;g.lineWidth=1;g.beginPath();g.arc(x,y,size+5,0,TAU);g.stroke();
        if(effects){
          const wave=(elapsed*.52+keyNumber(note.id))%1;
          g.globalAlpha*=.62*(1-wave);g.beginPath();g.arc(x,y,size+7+wave*15,0,TAU);g.stroke();g.globalAlpha=opacity;
          if(selected||note.pinned){
            const ray=size+7;
            g.globalAlpha=.42*opacity;g.beginPath();g.moveTo(x-ray,y);g.lineTo(x+ray,y);g.moveTo(x,y-ray);g.lineTo(x,y+ray);g.stroke();g.globalAlpha=opacity;
          }
          g.shadowColor=color;g.shadowBlur=13;
        }
      }
      g.fillStyle=color;g.beginPath();
      if(note.event){g.moveTo(x,y-size);g.lineTo(x+size,y);g.lineTo(x,y+size);g.lineTo(x-size,y);g.closePath();}
      else g.arc(x,y,size,0,Math.PI*2);
      g.fill();g.shadowBlur=0;g.globalAlpha=1;
    }
    if(moving||cameraMove)queue();
  }
  function queue(){if(!frame&&visible&&!document.hidden)frame=requestAnimationFrame(draw);}
  function paint(){dirty=true;queue();}
  function motion(){previous=0;onMotion(spinning(),reduced.matches);paint();}
  function size(){
    const box=canvas.getBoundingClientRect();density=Math.min(devicePixelRatio||1,1.75);
    width=Math.max(1,box.width);height=Math.max(1,box.height);
    canvas.width=Math.round(width*density);canvas.height=Math.round(height*density);
    galaxy.width=canvas.width;galaxy.height=canvas.height;
    g.setTransform(density,0,0,density,0,0);paint();
  }
  const observer=new ResizeObserver(size);observer.observe(canvas);size();
  const lifecycle=new AbortController(),options={signal:lifecycle.signal};
  document.addEventListener('visibilitychange',motion,options);
  reduced.addEventListener('change',motion,options);
  function locate(event){
    const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
    const closest=hit.reduce((best,item)=>{
      const distance=Math.hypot(item.x-x,item.y-y);
      return distance<Math.max(11,item.style.radius*item.factor+5)&&(!best||distance<=best.distance)?{item,distance}:best;
    },null);
    return {item:closest?.item,x,y};
  }
  function clearHover(){hovered='';tooltip.hidden=true;canvas.style.cursor='';paint();}
  function moveCamera(to){
    if(reduced.matches){pitch=to;cameraMove=null;}
    else cameraMove={from:pitch,to,start:performance.now()};
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    cameraMove=null;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,yaw,pitch,drag:false};
    canvas.setPointerCapture(event.pointerId);paint();
  },options);
  canvas.addEventListener('pointermove',event=>{
    if(!gesture){
      const {item,x,y}=locate(event);
      if(!item){if(hovered)clearHover();return;}
      hovered=item.note.id;tooltip.textContent=item.note.name+' · '+item.style.level+' · '+short(item.note.text,30);
      tooltip.hidden=false;tooltip.style.left=clamp(x+12,8,Math.max(8,width-tooltip.offsetWidth-8))+'px';
      tooltip.style.top=Math.max(48,y-37)+'px';canvas.style.cursor='pointer';paint();return;
    }
    if(gesture.id!==event.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.drag&&Math.hypot(dx,dy)<5)return;
    gesture.drag=true;if(hovered)clearHover();
    yaw=gesture.yaw+dx*.009;pitch=clamp(gesture.pitch+dy*.008,-1.56,1.56);paint();
  },options);
  canvas.addEventListener('pointerup',event=>{
    if(gesture?.id!==event.pointerId)return;
    if(!gesture.drag){
      const {item}=locate(event);
      if(item)onSelect(item.note.id);
    }
    gesture=null;paint();
  },options);
  canvas.addEventListener('lostpointercapture',()=>{gesture=null;paint();},options);
  canvas.addEventListener('pointerleave',clearHover,options);
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();zoom=clamp(zoom*Math.exp(-event.deltaY*.0012),.5,3.5);paint();
  },{...options,passive:false});
  return {
    set(notes){scene=makeScene(notes);clearHover();},
    select(id){active=id;paint();},
    appearance(mode){effects=mode==='effects';galaxy.hidden=!effects;motion();},
    visible(value){visible=value;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}motion();},
    view(action){
      if(action==='reset'){moveCamera(.97);yaw=.44;zoom=1;elapsed=0;}
      if(action==='top')moveCamera(0);
      if(action==='edge')moveCamera(1.54);
      if(action==='in'||action==='out')zoom=clamp(zoom*(action==='in'?1.24:1/1.24),.5,3.5);
      if(action==='rotate'){rotation=!rotation;motion();}
      paint();
    },
    dispose(){observer.disconnect();lifecycle.abort();renderer?.dispose();if(frame)cancelAnimationFrame(frame);}
  };
}

export function mountConstellation(root,{api,esc,names}){
  const select=(selector)=>root.querySelector(selector);
  const form=select('[data-star-filters]'),summary=select('[data-star-summary]');
  const detail=select('[data-star-detail]'),list=select('[data-star-list]'),empty=select('[data-star-empty]');
  const limit=select('[data-star-limit]'),legend=select('[data-star-legend]');
  const capture=select('[data-star-capture]');
  const map=select('.constellation-map'),timeline=select('[data-star-timeline]');
  const inspector=select('#star-inspector'),inspectorButton=select('[data-star-inspector]');
  const filterButton=select('[data-star-filter]'),rotateButton=select('[data-star-view="rotate"]'),demoButton=select('[data-star-demo]');
  const categoryLabel=fieldsLabel('category'),eventFilter=select('[data-star-event-filter]');
  const fields=form.elements;
  let data=null,scope='',revision='',selected='',mode='graph',controller,timer,searchTimer;
  let samples=null,realFilters=null,offset=0;
  const scene=starCanvas(select('[data-star-canvas]'),select('[data-star-galaxy]'),select('[data-star-tooltip]'),choose,(spinning,reduced)=>{
    rotateButton.disabled=reduced;
    rotateButton.title=reduced?'系统已启用减少动态效果':'';
    rotateButton.setAttribute('aria-pressed',String(spinning));
  });
  function appearance(mode){
    root.dataset.appearance=mode;
    for(const button of root.querySelectorAll('[data-star-appearance]'))button.setAttribute('aria-pressed',String(button.dataset.starAppearance===mode));
    rotateButton.hidden=mode==='simple';
    scene.appearance(mode);
  }
  function showInspector(open){
    inspector.hidden=!open;
    inspectorButton.setAttribute('aria-expanded',String(open));
    if(!open&&inspector.contains(document.activeElement))inspectorButton.focus({preventScroll:true});
  }
  appearance(root.dataset.appearance);
  function fieldsLabel(name){return form.elements[name].closest('label');}
  const chatName=key=>demoChats[key]??names.get(key)??(key.includes(':group:')?'群聊':'好友')+' · '+key.split(':').at(-1).slice(-4);
  const find=id=>data?.notes.find(note=>note.id===id);
  const colorSwatches=panel=>panel.querySelectorAll('[data-star-color]').forEach(swatch=>swatch.style.setProperty('--star-color',swatch.dataset.starColor));

  function choose(id){
    if(!find(id))return;
    selected=id;scene.select(id);showDetail();showInspector(true);
    for(const button of list.querySelectorAll('[data-star-id]'))button.setAttribute('aria-pressed',String(button.dataset.starId===id));
    for(const button of timeline.querySelectorAll('[data-star-id]'))button.setAttribute('aria-pressed',String(button.dataset.starId===id));
  }
  function showDetail(){
    const note=find(selected);
    if(!note){detail.innerHTML='<p>选择星点或下方列表中的记忆。</p>';return;}
    const style=starStyle(note);
    detail.innerHTML=`<p class="constellation-note-type"><i class="constellation-swatch" data-star-color="${style.color}"></i> ${samples?'演示 · ':''}${esc(data.categories[note.category])} · ${nodeStatus[note.status]}${note.pinned?' · 已置顶':''}</p>
      <h3>${esc(note.name)}${note.readOnly?'':` <small>· ${esc(note.personId.slice(-6))}</small>`}</h3><p class="constellation-note-text">${esc(note.text)}</p>
      <dl><div><dt>星点等级</dt><dd>${style.level} · ${style.reason}</dd></div><div><dt>来源聊天</dt><dd>${esc(chatName(note.chat))}</dd></div><div><dt>使用范围</dt><dd>${note.visibility==='person'?'本人允许跨聊天':'仅来源聊天'}</dd></div>
      ${note.event?`<div><dt>事件进展</dt><dd>${esc(data.eventStates[note.event.state])}</dd></div><div><dt>事件时间</dt><dd>${esc(note.event.day||'日期未提及')}${note.event.when?' · '+esc(note.event.when):''}</dd></div><div><dt>观察时间</dt><dd>${date(note.event.observedAt)}</dd></div>`:''}
      <div><dt>更新时间</dt><dd>${date(note.at)}</dd></div>${note.origin?`<div><dt>记录依据</dt><dd>${esc(note.origin)}</dd></div>`:''}${note.expiresAt?`<div><dt>有效期至</dt><dd>${date(note.expiresAt)}</dd></div>`:''}
      ${note.recalledAt?`<div><dt>最近选中</dt><dd>${date(note.recalledAt)}</dd></div>`:''}</dl>
      <div class="actions">${note.status==='active'&&!note.readOnly?`<button type="button" class="button small" data-star-pin>${note.pinned?'取消置顶':'置顶'}</button>`:''}
      ${samples?'':`<a class="text-link" href="#memory/${({member:'members',summary:'summaries',journal:'notebook'})[note.category]??'people'}">查看来源记录</a>`}</div>
      ${note.related?.length?`<div class="constellation-related"><h3>关联记忆</h3>${note.related.map(item=>`<button class="button small" data-star-related="${esc(item.id)}" data-offset="${item.offset}"><strong>${esc(item.reason)}</strong> ${esc(item.text)}</button>`).join('')}</div>`:''}`;
    colorSwatches(detail);
  }
  function options(field,items,defaultLabel){
    const current=field.value;
    field.replaceChildren(new Option(defaultLabel,''),...items.map(([key,label])=>new Option(label,key)));
    if(items.some(([key])=>key===current))field.value=current;
  }
  function showTimeline(){
    if(mode!=='timeline'){timeline.replaceChildren();return;}
    const groups=new Map();
    for(const note of data.notes){
      if(!note.event)continue;
      const day=note.event.day||'日期未提及';
      if(!groups.has(day))groups.set(day,[]);
      groups.get(day).push(note);
    }
    timeline.innerHTML=[...groups].sort(([a],[b])=>/^\d/.test(a)&&/^\d/.test(b)?b.localeCompare(a):/^\d/.test(a)?-1:1).map(([day,notes])=>`<section class="constellation-day"><h3>${esc(day)}</h3>${notes.map(note=>`<button type="button" data-star-id="${esc(note.id)}" aria-pressed="${note.id===selected}"><span class="constellation-event-state" data-state="${esc(note.event.state)}">${esc(data.eventStates[note.event.state])}</span><strong>${esc(note.text)}</strong><small>${esc(note.name)} · ${esc(chatName(note.chat))}</small></button>`).join('')}</section>`).join('');
  }
  function paint(){
    const focusedHost=[list,timeline].find(node=>node.contains(document.activeElement));
    const focused=focusedHost?document.activeElement.dataset.starId:'';
    options(fields.chat,data.chats.map(key=>[key,chatName(key)]),samples?'全部演示聊天':'全部允许的聊天');
    options(fields.category,Object.entries(data.categories),'全部类型');
    options(fields.eventState,Object.entries(data.eventStates),'全部进展');
    const colors=new Map();
    for(const note of data.notes){
      const label=note.status!=='active'?nodeStatus[note.status]:note.event?data.eventStates[note.event.state]:data.categories[note.category];
      if(label)colors.set(label,starStyle(note).color);
    }
    legend.hidden=!colors.size;
    legend.innerHTML=[...colors].map(([label,color])=>`<span><i data-star-color="${color}"></i>${esc(label)}</span>`).join('');
    colorSwatches(legend);
    select('[data-star-count]').textContent=(samples?'演示 · ':'')+data.total+(mode==='timeline'?' 件事件':' 颗记忆');
    summary.textContent=data.people+' 位人物 · '+(mode==='graph'?data.events+' 件事件 · ':'')+data.recalled+' 条最近召回'+(data.total>data.notes.length?'（显示 '+data.notes.length+' 条）':'');
    capture.textContent=samples?'演示记录仅在本页有效。':data.autoEvents?'从已授权的日常聊天自动记录事件。':'当前范围未开启自动事件记录。可在「记录设置」开启。';
    if(!samples&&data.unavailable?.length)capture.textContent='暂时无法读取：'+data.unavailable.map(key=>data.categories[key]).join('、');
    const perPage=Number(limit.value);
    select('[data-star-pages]').hidden=samples||data.total<=perPage;
    select('[data-star-range]').textContent=`${data.total?offset+1:0}–${offset+data.notes.length} / ${data.total}`;
    select('[data-star-page="previous"]').disabled=offset===0;
    select('[data-star-page="next"]').disabled=offset+perPage>=data.total;
    empty.hidden=!!data.notes.length;
    empty.textContent=fields.query.value||fields.category.value||fields.eventState.value||fields.status.value!=='active'?'没有匹配的记录':mode==='timeline'?'这个范围还没有自动记录的事件。聊天中的明确约定和经历会显示在这里。':'这个范围还没有记忆。开启人物记忆并授权聊天后，日常交流中的记录会出现在这里。';
    if(!find(selected))selected='';
    scene.set(data.notes);scene.select(selected);showDetail();showTimeline();
    list.innerHTML=data.notes.map(note=>{
      const style=starStyle(note);
      return `<button type="button" data-star-id="${esc(note.id)}" aria-pressed="${note.id===selected}"><i data-star-color="${style.color}"></i><span><strong>${esc(note.name)}</strong><small>${esc(short(note.text,35))}</small></span><em>${style.level}</em></button>`;
    }).join('');
    colorSwatches(list);
    if(focused)[...focusedHost.querySelectorAll('[data-star-id]')].find(button=>button.dataset.starId===focused)?.focus({preventScroll:true});
  }
  function requestParams(){
    return new URLSearchParams({...(scope?{scope}:{}),...(revision?{revision}:{}),conversationKey:fields.chat.value,
      query:fields.query.value,status:fields.status.value,category:mode==='timeline'?'event':fields.category.value,
      eventState:mode==='timeline'?fields.eventState.value:'',limit:limit.value,offset:String(offset)});
  }
  async function refresh({reset=false,quiet=false}={}){
    if(samples){if(!quiet){data=demoSnapshot(samples,requestParams());paint();}return;}
    if(reset)revision='';
    if(quiet&&(document.hidden||controller))return;
    controller?.abort();
    const pending=new AbortController();controller=pending;
    if(!quiet)summary.textContent='正在读取记忆…';
    try{
      const result=await api('/api/memory/constellation?'+requestParams(),undefined,true,{signal:pending.signal});
      if(pending.signal.aborted||!root.isConnected)return;
      scope=result.scope;revision=result.revision;
      if(!result.unchanged){
        if(offset&&offset>=result.total){offset=Math.max(0,Math.floor((result.total-1)/Number(limit.value))*Number(limit.value));return refresh({reset:true});}
        data=result;paint();
      }
    }catch(error){
      if(pending.signal.aborted||!root.isConnected)return;
      data=null;selected='';revision='';scene.set([]);list.replaceChildren();timeline.replaceChildren();legend.hidden=true;showDetail();
      empty.hidden=false;empty.textContent=error.message;
      select('[data-star-count]').textContent='记忆星图';summary.textContent='暂时无法读取星图。';
      if(error.status===409)scope='';
      if(error.status===409||error.status===403)fields.chat.value='';
    }finally{if(controller===pending)controller=null;}
  }
  const update=()=>{offset=0;void refresh({reset:true});};
  function toggleDemo(){
    controller?.abort();controller=null;
    clearTimeout(searchTimer);
    const fieldsList=['chat','query','category','eventState','status'];
    if(samples){
      samples=null;
      options(fields.chat,realFilters.chats.map(key=>[key,chatName(key)]),'全部允许的聊天');
      for(const key of fieldsList)fields[key].value=realFilters.values[key];
      limit.value=realFilters.limit;realFilters=null;
    }else{
      realFilters={chats:data?.chats??[],values:Object.fromEntries(fieldsList.map(key=>[key,fields[key].value])),limit:limit.value};
      for(const key of fieldsList)fields[key].value=key==='status'?'all':'';
      limit.value='320';samples=makeDemoNotes();
    }
    demoButton.setAttribute('aria-pressed',String(!!samples));
    demoButton.textContent=samples?'退出演示':'演示星系';
    data=null;selected='';scene.set([]);scene.select('');legend.hidden=true;
    list.replaceChildren();timeline.replaceChildren();empty.hidden=true;showDetail();showInspector(false);
    select('[data-star-count]').textContent='记忆星图';update();
  }
  form.onsubmit=event=>{event.preventDefault();update();};
  form.onchange=event=>{if(event.target!==fields.query)update();};
  fields.query.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(update,200);};
  limit.onchange=update;
  root.onclick=async event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button===demoButton)toggleDemo();
    if(button.dataset.starPage){offset=Math.max(0,offset+Number(limit.value)*(button.dataset.starPage==='next'?1:-1));selected='';void refresh({reset:true});}
    if(button.dataset.starRelated){
      if(find(button.dataset.starRelated))choose(button.dataset.starRelated);
      else {offset=Number(button.dataset.offset);selected=button.dataset.starRelated;void refresh({reset:true});}
    }
    if(button.hasAttribute('data-star-refresh'))update();
    if(button===filterButton){form.hidden=!form.hidden;button.setAttribute('aria-expanded',String(!form.hidden));}
    if(button===inspectorButton)showInspector(inspector.hidden);
    if(button.hasAttribute('data-star-close'))showInspector(false);
    if(button.dataset.starAppearance){
      appearance(button.dataset.starAppearance);
      try{localStorage.setItem(appearanceKey,button.dataset.starAppearance);}catch{/* Keep the choice for this view. */}
    }
    if(button.dataset.starMode&&button.dataset.starMode!==mode){
      mode=button.dataset.starMode;
      const inTimeline=mode==='timeline';
      for(const tab of root.querySelectorAll('[data-star-mode]'))tab.setAttribute('aria-pressed',String(tab===button));
      map.hidden=inTimeline;timeline.hidden=!inTimeline;categoryLabel.hidden=inTimeline;eventFilter.hidden=!inTimeline;
      scene.visible(!inTimeline);
      data=null;selected='';list.replaceChildren();timeline.replaceChildren();empty.hidden=true;showDetail();update();
    }
    if(button.dataset.starId)choose(button.dataset.starId);
    if(button.dataset.starView)scene.view(button.dataset.starView);
    if(button.hasAttribute('data-star-pin')){
      const note=find(selected);if(!note||note.readOnly)return;
      if(samples){note.pinned=!note.pinned;paint();return;}
      button.disabled=true;
      try{
        await api('/api/memory/people',{scope,id:note.id,revision:note.revision,action:note.pinned?'unpin':'pin'});
        if(root.isConnected)await refresh({reset:true});
      }catch(error){if(root.isConnected)summary.textContent=error.message;}
      finally{button.disabled=false;}
    }
  };
  root.onkeydown=event=>{if(event.key==='Escape'&&!inspector.hidden)showInspector(false);};
  timer=setInterval(()=>{if(!root.isConnected){dispose();return;}void refresh({quiet:true});},8000);
  update();
  function dispose(){clearInterval(timer);clearTimeout(searchTimer);controller?.abort();scene.dispose();}
  return dispose;
}
