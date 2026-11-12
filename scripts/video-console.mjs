import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {configuration,scanPlugins} from '../packages/plugin-api/catalog.mjs';
import {validModelId} from '../packages/dsh-social-bridge-plugin/model-routing.mjs';

const exec=promisify(execFile);
export const VIDEO_INPUT_LIMIT=32*1024*1024;
const OUTPUT_LIMIT=24*1024*1024;
const MAX_SECONDS=180;
const fault=(message,status=400)=>Object.assign(new Error(message),{status});
const formats={mp4:'mov',mov:'mov',m4v:'mov',webm:'matroska',mkv:'matroska'};
const ffmpegArgs=['-hide_banner','-nostdin','-protocol_whitelist','file','-max_alloc','134217728'];
const readConfig=async root=>JSON.parse((await fs.readFile(path.join(root,'config/wechatagent.json'),'utf8')).replace(/^\uFEFF/,''));

function checkedFormat(format,bytes){
  if(!Object.hasOwn(formats,format)||bytes.length<16||bytes.length>VIDEO_INPUT_LIMIT)throw fault('请选择 32 MB 以内的 MP4、MOV、M4V、WebM 或 MKV 视频。');
  const mov=formats[format]==='mov';
  if(mov?bytes.subarray(4,8).toString()!=='ftyp':!bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))throw fault('文件内容与视频格式不匹配。请先用播放器打开原视频检查。');
  return mov?['-f','mov','-enable_drefs','0']:['-f','matroska'];
}

function metadata(log){
  const input=log.split('Output #')[0];
  const duration=/Duration: (\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(input);
  const stream=input.split('\n').find(line=>/Stream #\d+:\d+.*Video:/.test(line)&&!/attached pic/i.test(line));
  const size=stream?.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const seconds=duration?Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]):0;
  if(!size||!seconds)throw fault('无法核对视频轨道或时长。请尝试重新导出为标准 MP4。');
  if(seconds>MAX_SECONDS||Number(size[1])*Number(size[2])>4096*2160)throw fault('视频需在 3 分钟以内，画面分辨率最高约为 4K。请先截取所需片段。');
  return {seconds,width:Number(size[1]),height:Number(size[2])};
}

async function pluginSettings(root,key){
  const project=await readConfig(root);
  const match=/^wechat:(private|group):([1-9]\d{0,15})$/.exec(key??'');
  const allowed=match&&project.wechat?.whitelist?.[match[1]==='group'?'groups':'private']?.some(id=>String(id)===match[2]);
  const saved=configuration(root);
  const record=saved.config.plugins['video-workbench'];
  const item=scanPlugins(root).find(plugin=>plugin.id==='video-workbench'&&!plugin.invalid);
  if(!item||!record?.enabled)throw fault('请先安装并启用视频处理插件。',403);
  if(!allowed||record.chats!==null&&!record.chats?.includes(key))throw fault('请在“插件与聊天”授权所选聊天使用视频处理。',403);
  const settings={...item.settings,...record.settings};
  const selection=project.dsh?.chats?.[key]??project.dsh;
  return {settings,selection,revision:JSON.stringify([saved.revision,item.revision,selection,project.dsh?.visionFallback])};
}

export function createVideoConsole({root,describe,executable=path.join(root,'state/voice/tools/ffmpeg.exe'),run=exec}){
  let busy=false;
  return async function processVideo(bytes,{action,format,key,signal}){
    if(!['compress','recognize'].includes(action))throw fault('请选择压缩或识别。');
    const inputArgs=checkedFormat(format,bytes);
    if(busy)throw fault('已有视频正在处理，请稍后再试。',409);
    busy=true;
    let folder;
    try{
      const initial=await pluginSettings(root,key);
      const recheck=async()=>{signal?.throwIfAborted();if((await pluginSettings(root,key)).revision!==initial.revision)throw fault('视频插件设置或聊天权限已变化，请重新处理。',409);};
      if(!await fs.stat(executable).then(stat=>stat.isFile(),()=>false))throw fault('缺少本机 FFmpeg。请在语音音色页导入语音组件后重试。',503);
      folder=await fs.mkdtemp(path.join(os.tmpdir(),'wechatgirl-video-'));
      const input=path.join(folder,'source.'+format);
      await fs.writeFile(input,bytes,{flag:'wx',mode:0o600,signal});
      const invoke=async(args,timeout)=>{
        try{return await run(executable,[...ffmpegArgs,...inputArgs,'-threads','2','-i',input,...args],{cwd:folder,timeout,signal,windowsHide:true,maxBuffer:256*1024});}
        catch(error){if(signal?.aborted)throw signal.reason;throw fault(error.killed?'本机视频处理超时。请缩短片段或降低分辨率。':'FFmpeg 无法解码或处理视频。请检查原文件，或重新导出为标准 MP4。');}
      };
      const probe=await invoke(['-map','0:V:0','-t','0','-f','null','-'],15000);
      const info=metadata(probe.stderr);
      await recheck();
      const {settings}=initial;
      if(action==='compress'){
        const height=[480,720,1080].includes(settings.resolution)?settings.resolution:720;
        const output=path.join(folder,'compressed.mp4');
        const bitrate=Math.max(180,Math.min(2400,Math.floor(19*1024*1024*8/info.seconds/1000)-96));
        await invoke(['-loglevel','error','-map','0:V:0','-map','0:a:0?','-map_metadata','-1','-map_chapters','-1',
          '-vf',`scale=w='min(iw,${height*16/9})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          '-fpsmax','30','-c:v','libx264','-pix_fmt','yuv420p','-preset','fast','-crf',String(Number.isSafeInteger(settings.quality)&&settings.quality>=20&&settings.quality<=34?settings.quality:26),
          '-maxrate',bitrate+'k','-bufsize',bitrate*2+'k','-threads','2','-c:a','aac','-b:a','96k','-movflags','+faststart',output],85000);
        await recheck();
        const size=(await fs.stat(output)).size;
        if(!size||size>OUTPUT_LIMIT)throw fault('压缩结果超出 24 MB，请降低分辨率或缩短片段。');
        return {...info,sourceBytes:bytes.length,size,smaller:size<bytes.length,video:(await fs.readFile(output)).toString('base64')};
      }
      const parser=settings.visionModel;
      const explicit=parser&&Object.keys(parser).length>0;
      if(explicit&&(!validModelId(parser.provider)||!validModelId(parser.model)))throw fault('请重新选择视频识别模型，或选择跟随聊天与图片分流。');
      const frames=[4,6,8].includes(settings.sampleFrames)?settings.sampleFrames:6;
      const output=path.join(folder,'frames.jpg');
      await invoke(['-loglevel','error','-map','0:V:0','-an','-vf',
        `fps=${frames}/${info.seconds}:round=up,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=2x${frames/2}`,
        '-frames:v','1','-threads','1','-q:v','4',output],35000);
      await recheck();
      const image=await fs.readFile(output);
      if(image.length>768*1024)throw fault('抽帧结果过大，请减少抽帧数量。');
      const result=await describe({b64:image.toString('base64'),mime:'image/jpeg',video:{seconds:info.seconds,frames},selection:initial.selection,...(explicit?{parser}:{}),signal});
      await recheck();
      return {...info,frames,text:result.text,model:result.parserModel};
    }finally{
      if(folder)await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});
      busy=false;
    }
  };
}
