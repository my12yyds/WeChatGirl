import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {windowsPowerShellExecutable,windowsPowerShellEnvironment} from './console-process.mjs';
import {hookProfile} from './hook-profiles.mjs';
const execute=promisify(execFile);
export const BUNDLED_WECHAT_VERSION='4.1.15.13';
export function clientCatalog(result){
  const clients=(result.clients??[]).map(row=>{
    const profile=hookProfile(row.version),supported=!!profile;
    const intact=row.architecture==='x64'&&row.signed===true&&row.coreSigned===true&&row.coreVersion===row.version;
    const current=profile?.loader==='explicit-text';
    const nativeReady=current?result.currentReady===true:result.nativeReady===true;
    const canLaunch=supported&&intact&&nativeReady;
    const status=!supported?'此版本没有匹配组件，请使用内置匹配版。':
      !intact?'客户端文件、架构或腾讯签名不匹配。':
      !nativeReady?'匹配的发送组件未准备完成。':
      current?'支持文字、群 @ 和图片。原生语音和图库表情需检查对应发送组件是否就绪。普通文件可启用前台兼容发送。':'版本、核心文件、腾讯签名及发送组件均匹配。支持指定图库表情原生发送。';
    return {...row,supported,intact,canLaunch,tool:canLaunch?'wechat-hook-'+row.version:null,status};
  });
  return {expectedVersion:BUNDLED_WECHAT_VERSION,clients,bundled:clients.find(row=>row.bundled)??null,
    conflict:clients.some(row=>row.running&&!row.bundled),message:'内置匹配版独立保存，不替换系统微信；首次使用仍需登录。其他微信正在运行时，请先保存工作并从其托盘退出。'};
}
export function createClientDetector(root,{scan,now=Date.now}={}){
  let pending,cached,at=0;
  scan??=async()=>{const {stdout}=await execute(windowsPowerShellExecutable(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./wechat-clients.ps1',import.meta.url)),'-Root',root],{cwd:root,windowsHide:true,shell:false,env:windowsPowerShellEnvironment(),encoding:'utf8',timeout:20000,maxBuffer:256*1024});return JSON.parse(stdout.replace(/^\uFEFF/,''));};
  return {inspect({force=false}={}){if(pending)return pending;if(!force&&cached&&now()-at<15000)return Promise.resolve(cached);pending=Promise.resolve().then(scan).then(result=>{cached=clientCatalog(result);at=now();return cached;}).finally(()=>{pending=null;});return pending;}};
}
