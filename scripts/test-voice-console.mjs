import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createVoiceConsole} from './voice-console.mjs';import {pcmToWav} from '../packages/voice-studio/singing.mjs';import {VoiceJobs} from '../packages/voice-studio/jobs.mjs';
import {CustomVoices} from '../packages/voice-studio/voices.mjs';import {VOICE_PRESETS} from '../public/console/music.js';
const key='wechat:private:123';
test('service preview uses the selected direct voice rather than silently reverting to the builtin',async t=>{
 const root=fixture(t),voices=new CustomVoices(root);const saved=voices.change({action:'save',revision:voices.snapshot().revision,...VOICE_PRESETS.reference});voices.change({action:'activate',revision:saved.revision,id:saved.voices[0].id});fs.mkdirSync(path.join(root,'state/voice/references'),{recursive:true});const pcm=Buffer.alloc(48000);fs.writeFileSync(path.join(root,'state/voice/references/cute.wav'),pcmToWav(pcm));const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:19881/v1/audio/speech');assert.equal(options.body.get('cfg_scale'),'1');return new Response(pcm,{headers:{'x-sample-rate':'24000'}});};
 const result=await createVoiceConsole(root).previewEngine({text:'测试当前默认音色'});assert.deepEqual(Buffer.from(result.b64,'base64'),pcmToWav(pcm));assert.equal(calls,1);assert.equal(new VoiceJobs(root).list().length,0);
});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-console-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'state/weflow'),{recursive:true});fs.writeFileSync(path.join(root,'state/weflow/active-account.json'),JSON.stringify({id:'a'.repeat(64)}));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({ports:{adapter:19001},wechat:{whitelist:{private:['123'],groups:[]}}}));fs.writeFileSync(path.join(root,'config/plugins.json'),JSON.stringify({version:1,plugins:{'voice-studio':{enabled:true,generation:'generation',permissions:['voice','storage'],chats:[key],settings:{breezePort:19881}}}}));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('built-in audition succeeds without the conversion queue when chat voice conversion is enabled',async t=>{
 const root=fixture(t),configFile=path.join(root,'config/plugins.json');
 const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 config.plugins['voice-studio'].settings.feiyuTimbre=true;
 fs.writeFileSync(configFile,JSON.stringify(config));
 const pcm=Buffer.alloc(48000),references=path.join(root,'state/voice/references');
 fs.mkdirSync(references,{recursive:true});
 fs.writeFileSync(path.join(references,'cute.wav'),pcmToWav(pcm));
 t.mock.method(globalThis,'fetch',async url=>{
  assert.equal(url,'http://127.0.0.1:19881/v1/audio/speech');
  return new Response(pcm,{headers:{'x-sample-rate':'24000'}});
 });
 const result=await createVoiceConsole(root).previewEngine({text:'本机试听',style:'cute'});
 assert.deepEqual(Buffer.from(result.b64,'base64'),pcmToWav(pcm));
 assert.equal(fs.existsSync(path.join(root,'state/voice/outgoing')),false);
});
test('audio import stores only normalized bounded WAV with a content-derived song id',async t=>{const root=fixture(t),pcm=Buffer.alloc(48000),api=createVoiceConsole(root,{resample:async()=>pcm});const result=await api.importSong({title:'测试歌曲',b64:pcmToWav(pcm).toString('base64')});assert.match(result.id,/^[a-f0-9]{24}$/);assert.equal(new VoiceJobs(root).songs()[0].title,'测试歌曲');assert.equal(fs.readFileSync(path.join(root,'state/voice/songs',result.id+'.wav')).length,48044);await assert.rejects(api.importSong({title:'无效',b64:Buffer.from('not wav').toString('base64')}));const long=createVoiceConsole(root,{resample:async()=>Buffer.alloc(48000*61)});await assert.rejects(long.importSong({title:'过长',b64:pcmToWav(pcm).toString('base64')}),/60/);});
test('console test sends only through the authorized durable queue and rejects other chats',t=>{const root=fixture(t),api=createVoiceConsole(root);assert.throws(()=>api.test({key:'wechat:private:999',style:'cute',text:'你好'}),/授权/);const job=api.test({key,style:'cute',text:'你好'});assert.equal(job.state,'queued');assert.equal(new VoiceJobs(root).list().length,1);assert.throws(()=>api.test({key,style:'cute',text:'你好',path:'secret'}));});
test('status exposes readiness and bounded task summaries without returning service credentials',async t=>{const root=fixture(t),keyFile=path.join(root,'state/voice/feiyu-service/server/.runtime/voice-service/api_key.txt');fs.mkdirSync(path.dirname(keyFile),{recursive:true});fs.writeFileSync(keyFile,'private-token-for-test-only');const api=createVoiceConsole(root,{fetcher:async url=>Response.json(url.includes('/health')?{status:'ok',sample_rate:24000}:url.includes('/capabilities')?{rvc:[{available:true}],singing:{available:true},secret:'must-not-leak'}:{native_voice_send:false})}),status=await api.snapshot();assert.equal(status.speech,true);assert.equal(status.cover,true);assert.equal(status.score,true);assert.equal(status.nativeVoice,false);assert(!JSON.stringify(status).includes('private-token'));assert(!JSON.stringify(status).includes('must-not-leak'));});
