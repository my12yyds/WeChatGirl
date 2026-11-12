import {MusicLibrary} from '../packages/voice-studio/library.mjs';
import {MusicPreferences} from '../packages/voice-studio/music-preferences.mjs';
import {resolveSpeechEngine,previewCosyVoice,cosyEngineSettings} from '../packages/voice-studio/cosyvoice.mjs';
import {SpeechApi} from '../packages/voice-studio/speech-api.mjs';
import {CustomVoices} from '../packages/voice-studio/voices.mjs';
import {synthesizeVoice} from '../packages/voice-studio/synthesis.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {sendingMode} from '../packages/wechat-send-policy.mjs';
import {VoiceJobs,voiceRequest} from '../packages/voice-studio/jobs.mjs';import {configuration,directory,atomicJson} from '../packages/plugin-api/catalog.mjs';import {wavToPcm} from '../packages/voice-studio/singing.mjs';
const fault=message=>Object.assign(Error(message),{status:400});
const wav=pcm=>{const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);};
export function createVoiceConsole(root,{fetcher=fetch,resample=wavToPcm}={}){
 let previewBusy=false;
 const jobs=()=>new VoiceJobs(root);
 async function endpoint(url,headers={}){try{const response=await fetcher(url,{headers,signal:AbortSignal.timeout(2000),redirect:'error'});return response.ok?await response.json():null;}catch{return null;}}
 async function preview(text,profile,styleOverride){
  if(previewBusy)throw Object.assign(fault('正在制作另一条试听，请稍后再试。'),{status:409});
  if(typeof text!=='string'||!text.trim()||text.length>100)throw fault('请填写100字以内的试听文字。');
  const settings=configuration(root).config.plugins['voice-studio']?.settings??{};
  const style=styleOverride??profile?.baseStyle??settings.defaultStyle??'cute';
  const signal=AbortSignal.timeout(120000);
  let engine;
  previewBusy=true;
  try{
    engine=resolveSpeechEngine(root,{style,profile});
    const pcm=await synthesizeVoice(root,voiceRequest({kind:'speech',style,text}),{
      ...settings,...(profile?{customVoiceProfile:profile}:{feiyuTimbre:false}),
      speechEngine:{mode:engine.mode,revision:engine.revision}
    },{signal,fetcher,previewOnly:true});
    return {b64:wav(pcm).toString('base64')};
  }catch(error){
    const code=error.code??error.message;
    const messages={
      SINGING_GENERATION_FAILED:'换声服务未能生成试听。请检查本机换声服务，或在这个音色中关闭额外换声。',
      VOICE_REFERENCE_NOT_READY:'找不到本机参考音频。请在语音音色页导入语音组件；自定义音色可重新上传参考录音。',
      COSY_ENGINE_SETTINGS_CHANGED:'专用引擎设置已改变，请重新试听。',
      COSY_ENGINE_NOT_READY:'专用肥鱼服务尚未启动，请检查模型和本机服务。',
      COSY_SYNTHESIS_UNAVAILABLE:'专用肥鱼合成失败，请检查本机服务或切换到 Breeze 试听。',
      VOICE_API_SETTINGS_CHANGED:'语音 API 配置已变化，请重新试听。',
      VOICE_API_HTTP_401:'API 密钥未通过验证，请重新保存密钥。',
      VOICE_API_HTTP_403:'语音 API 拒绝请求，请检查模型和账号权限。',
      VOICE_API_HTTP_404:'语音 API 路径或模型不存在，请核对接口地址、模型和音色 ID。',
      VOICE_API_HTTP_429:'语音 API 请求受限，请检查额度或稍后重试。',
      VOICE_API_WAV_REQUIRED:'语音 API 未返回 WAV，请核对接口是否支持 WAV 输出。',
      VOICE_API_CREDENTIAL_UNAVAILABLE:'无法解密 API 密钥，请在此电脑上重新填写并保存。',
      VOICE_SAMPLE_RATE_INVALID:'本地服务没有返回 24 kHz PCM，请核对 Breeze 模型和语音组件版本。',
      VOICE_AUDIO_INVALID:'合成服务返回空音频或音频损坏。请用短句重试，并检查所选模型。',
    };
    const connectionError=engine?.mode==='external'
      ?'无法连接外接语音 API。请检查服务地址、模型 ID、音色 ID 和网络。'
      :'无法连接或调用本机语音引擎。请在“运行环境与组件导入”检查语音组件，再启动或重启服务。';
    const message=signal.aborted?'试听超时。请先用一句短句重试；如音色启用了额外换声，请检查换声队列。'
      :messages[code]??(/^VOICE_SYNTHESIS_HTTP_\d{3}$/.test(code)?'本地 Breeze 拒绝合成（HTTP '+code.slice(-3)+'）。请检查所选模型和参考音频。':connectionError);
    throw fault(message);
  }finally{previewBusy=false;}
 }
 const engineView=()=>{const base=new SpeechApi(root).snapshot(),profile=new CustomVoices(root).selected(),settings=configuration(root).config.plugins['voice-studio']?.settings??{};return {...base,localEngine:resolveSpeechEngine(root,{base,profile,style:profile?.baseStyle??settings.defaultStyle??'cute'}).mode==='cosyvoice'?'cosyvoice':'breeze'};};
 return {
  musicPreferences:()=>new MusicPreferences(root).snapshot(),
  saveMusicPreferences:body=>{const result=new MusicPreferences(root).save(body);const cleanup=body.maxSongs!==undefined?new MusicLibrary(root).enforceLimit():{deleted:0};return {...result,cleanup};},
  deleteSongs:body=>{if(!body||Object.keys(body).some(k=>!['items','confirmed'].includes(k))||body.confirmed!==true)throw fault('请确认删除所选音乐。');return new MusicLibrary(root).remove(body.items);},
  async compareEngines(body){if(previewBusy)throw fault('正在制作另一条试听，请稍后再试。');if(!body||Object.keys(body).some(key=>key!=='text')||typeof body.text!=='string'||!body.text.trim()||body.text.length>100)throw fault('请填写100字以内的对比文字。');previewBusy=true;try{const control=cosyEngineSettings(root);if(!control.enabled||!control.allowComparison)throw Object.assign(Error('COSY_COMPARISON_DISABLED'),{code:'COSY_COMPARISON_DISABLED'});const settings=configuration(root).config.plugins['voice-studio']?.settings??{},signal=AbortSignal.timeout(120000);const start=Date.now();const pcm=await synthesizeVoice(root,voiceRequest({kind:'speech',style:'cute',text:body.text}),{breezePort:settings.breezePort??19881,feiyuTimbre:false,cutePitch:0,speechEngine:{mode:'local'}},{signal,fetcher,previewOnly:true});const breeze={b64:wav(pcm).toString('base64'),elapsedMs:Date.now()-start,seconds:pcm.length/48000};const next=Date.now(),cosy=await previewCosyVoice(root,body.text,'cute',{signal,fetcher});return {text:body.text,localOnly:true,wechatMessagesSent:0,breeze,cosyvoice:{b64:wav(cosy).toString('base64'),elapsedMs:Date.now()-next,seconds:cosy.length/48000}};}catch(error){throw fault(error.code==='COSY_COMPARISON_DISABLED'?'请先安装并启用原生肥鱼引擎插件，允许本机对比试听。':'对比试听未完成，请检查两个本地服务；没有向微信发送消息。');}finally{previewBusy=false;}},
  voices:()=>new CustomVoices(root).snapshot(),
  changeVoice:body=>new CustomVoices(root).change(body),
  engine:engineView,
  saveEngine:async body=>{await new SpeechApi(root).save(body);return engineView();},
  async previewVoice(body){if(!body||Object.keys(body).some(key=>!['id','text'].includes(key)))throw fault('试听参数无效。');const profile=new CustomVoices(root).snapshot().voices.find(voice=>voice.id===body.id);if(!profile)throw fault('请先保存并选择音色。');return preview(body.text,profile);},
  async previewEngine(body){if(!body||Object.keys(body).some(key=>!['text','style'].includes(key))||body.style!==undefined&&!['cute','natural','gentle'].includes(body.style))throw fault('试听参数无效。');return preview(body.text,body.style?null:new CustomVoices(root).selected(),body.style);},
  async snapshot(){const settings=configuration(root).config.plugins['voice-studio']?.settings??{},project=JSON.parse(fs.readFileSync(path.join(root,'config/wechatagent.json'),'utf8').replace(/^\uFEFF/,''));const keyFile=path.join(root,'state/voice/feiyu-service/server/.runtime/voice-service/api_key.txt');let key='';if(fs.existsSync(keyFile)&&!fs.lstatSync(keyFile).isSymbolicLink())key=fs.readFileSync(keyFile,'utf8').trim();
    let engine;try{const profile=new CustomVoices(root).selected();engine=resolveSpeechEngine(root,{profile,style:profile?.baseStyle??settings.defaultStyle??'cute'});}catch{engine={mode:'unavailable'};}
    const [speech,adapter,singing]=await Promise.all([endpoint('http://127.0.0.1:'+(engine.mode==='cosyvoice'?engine.port:settings.breezePort??19881)+'/health'),endpoint('http://127.0.0.1:'+project.ports.adapter+'/status'),key?endpoint('http://127.0.0.1:19882/v1/capabilities',{Authorization:'Bearer '+key}):null]);let recent=[];try{const store=jobs(),account=store.account();recent=store.list().filter(job=>job.accountScope===account).slice(-8).map(job=>{const value=store.public(job);if(['separate','conversion'].includes(job.progress?.stage)&&Number.isSafeInteger(job.progress?.part)&&Number.isSafeInteger(job.progress?.parts)&&job.progress.part>=1&&job.progress.part<=job.progress.parts&&job.progress.parts<=60)value.stageLabel+=' · '+job.progress.part+'/'+job.progress.parts;return value;});}catch{}
    const separator=path.join(root,'state/voice/engines/music/models/UVR-MDX-NET-Inst_HQ_3.onnx');
    const blocked=sendingMode(project)==='foreground';
    const versionWithoutVoice=project.hook?.expectedVersion==='4.1.15.13'&&adapter?.native_voice_send!==true;
    return {sendingMode:sendingMode(project),sendDisabledReason:blocked?'前台模式已停用原生语音与歌曲语音发送；切换到 Hook 模式后恢复。':versionWithoutVoice?'微信 4.1.15.13 的语音组件尚未通过就绪检查。请重开匹配客户端并检查组件。':adapter?.native_voice_send!==true?'尚未连接可发送语音的微信。请先绑定微信并启动服务；本机试听可在上方进行。':'',speechSource:engine.mode,speech:engine.mode==='external'?!!engine.baseUrl&&!!engine.model:engine.mode==='cosyvoice'?speech?.ok===true&&speech?.engine==='feiyu-cosyvoice3'&&speech?.sampleRate===24000:engine.mode==='local'&&speech?.status==='ok'&&speech?.sample_rate===24000,nativeVoice:!blocked&&adapter?.native_voice_send===true,feiyuTimbre:engine.mode==='local'&&settings.feiyuTimbre===true,cover:singing?.rvc?.some?.(item=>item?.available===true)||false,score:singing?.singing?.available===true,onlineSongs:settings.onlineSongs!==false,musicReady:fs.existsSync(separator)&&!fs.lstatSync(separator).isSymbolicLink(),songs:jobs().songs(),jobs:recent};
  },
  async importSong(body){
    if(!body||Object.keys(body).some(key=>!['title','b64'].includes(key))||typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>80||typeof body.b64!=='string'||body.b64.length>11300000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.b64))throw fault('请填写歌曲名称并选择有效音频。');
    const bytes=Buffer.from(body.b64,'base64');if(bytes.length>8*1024*1024||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')throw fault('请导入最长 60 秒的 WAV 人声音频。');
    const pcm=await resample(root,bytes,{signal:AbortSignal.timeout(30000)});if(!Buffer.isBuffer(pcm)||pcm.length<960||pcm.length>24000*2*60||pcm.length%2)throw fault('请使用60秒以内的有效人声音频。');const audio=wav(pcm),id=crypto.createHash('sha256').update(audio).digest('hex').slice(0,24),folder=directory(root,'state/voice/songs');const file=path.join(folder,id+'.wav');if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw fault('歌曲文件异常，请检查本机素材目录。');fs.writeFileSync(file,audio,{mode:0o600});atomicJson(path.join(folder,id+'.json'),{title:body.title.trim(),durationSeconds:pcm.length/48000,source:'owner-imported-vocal'});return {ok:true,id,title:body.title.trim()};
  },
  song(body){if(!body||Object.keys(body).some(key=>!['key','id','playbackMode'].includes(key))||typeof body.id!=='string'||!/^\d{1,16}$/.test(body.id)||!['preview','full'].includes(body.playbackMode))throw fault('请选择歌曲、聊天和发送模式。');const setting=configuration(root).config.plugins['voice-studio'];if(!setting?.enabled||!setting.permissions?.includes('voice'))throw fault('请先启用声音插件并授予语音权限。');if(setting.chats!==null&&!setting.chats?.includes(body.key))throw fault('请选择声音插件已经授权的聊天。');return jobs().queue({key:body.key,pluginId:'voice-studio',generation:setting.generation,batchId:crypto.randomUUID(),request:voiceRequest({kind:'song',style:setting.settings?.defaultStyle??'cute',sourceUrl:'https://music.163.com/song?id='+body.id,playbackMode:body.playbackMode})});},
  test(body){
    if(!body||Object.keys(body).some(key=>!['key','style','text'].includes(key)))throw fault('测试参数无效。');
    const setting=configuration(root).config.plugins['voice-studio'];
    if(!setting?.enabled||!setting.permissions?.includes('voice'))throw fault('请先启用声音工作室并授予“生成并发送微信语音”权限。');
    if(setting.chats!==null&&!setting.chats?.includes(body.key))throw fault('请在“插件与聊天”授权接收测试语音的好友或群，再保存。');
    try{return jobs().queue({key:body.key,pluginId:'voice-studio',generation:setting.generation,batchId:crypto.randomUUID(),builtinVoice:true,request:voiceRequest({kind:'speech',style:body.style,text:body.text})});}
    catch(error){
      const hints={
        VOICE_DISABLED_IN_FOREGROUND:'前台模式无法发送原生语音气泡。请在发送模式选择 Hook，或在本机试听。',
        VOICE_ACCESS_CHANGED:'聊天或插件权限已变化。请刷新页面并检查该聊天的授权。',
        VOICE_ACCOUNT_UNAVAILABLE:'微信账号未验证。请在配置向导连接并验证微信。',
        VOICE_QUEUE_FULL:'语音队列已满。请等待已有任务完成，或取消不需要的任务。',
      };
      throw fault(hints[error.code]??'无法加入测试队列。请检查微信绑定、语音设置和试听文字。');
    }
  }
 };
}
