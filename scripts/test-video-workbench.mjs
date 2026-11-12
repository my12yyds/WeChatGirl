import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createVideoConsole} from './video-console.mjs';
import {atomicJson,configuration,updatePlugin,packageFiles} from '../packages/plugin-api/catalog.mjs';
import {PluginInstaller} from '../packages/plugin-api/installer.mjs';
import {packZip} from '../packages/plugin-api/zip.mjs';

const executable=process.env.VIDEO_TEST_FFMPEG;
const key='wechat:private:123';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechatgirl-video-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  atomicJson(path.join(root,'config/wechatagent.json'),{wechat:{whitelist:{private:['123','456']}},dsh:{provider:'fixture',model:'vision'}});
  const installer=new PluginInstaller(root);
  const preview=installer.inspect({name:'video-workbench.zip',zip:packZip(packageFiles(path.resolve('optional-extensions/video-workbench'))).toString('base64')});
  installer.install(preview);
  installer.dispose();
  const save=(enabled,visionModel={})=>updatePlugin(root,'video-workbench',{revision:configuration(root).revision,enabled,permissions:[],chats:[key],settings:{resolution:480,quality:30,sampleFrames:4,visionModel}});
  save(true);
  return {root,save};
}

test('video routes reject wrong formats and chats before running any external tool',async t=>{
  const {root}=fixture(t);
  const handler=createVideoConsole({root,run:()=>assert.fail('FFmpeg should not run')});
  await assert.rejects(handler(Buffer.alloc(16),{action:'compress',format:'mp4',key}),/格式不匹配/);
  const video=Buffer.alloc(16);video.write('ftyp',4);
  await assert.rejects(handler(video,{action:'recognize',format:'mp4',key:'wechat:private:456'}),/授权/);
});

test('real FFmpeg compresses a video and sends only the JPEG sheet to the recognition callback',{skip:!executable},async t=>{
  const {root,save}=fixture(t),source=path.join(root,'sample.mp4');
  save(true,{provider:'alternate',model:'video-vision'});
  execFileSync(executable,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=960x540:rate=25',
    '-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-preset','ultrafast','-crf','16','-c:a','aac',source],{windowsHide:true,timeout:20000});
  const bytes=fs.readFileSync(source);
  let called=0;
  const handler=createVideoConsole({root,executable,describe:async payload=>{
    called++;
    assert.deepEqual(payload.video,{seconds:2,frames:4});
    assert.equal(payload.mime,'image/jpeg');
    const jpeg=Buffer.from(payload.b64,'base64');
    assert(jpeg[0]===255&&jpeg[1]===216);
    assert.equal(payload.selection.model,'vision');
    assert.deepEqual(payload.parser,{provider:'alternate',model:'video-vision'});
    return {text:'测试图案',parserModel:{provider:'fixture',model:'vision'}};
  }});
  const compressed=await handler(bytes,{action:'compress',format:'mp4',key});
  assert(compressed.smaller);assert.equal(called,0);
  assert.equal(Buffer.from(compressed.video,'base64').subarray(4,8).toString(),'ftyp');
  const recognized=await handler(bytes,{action:'recognize',format:'mp4',key});
  assert.equal(recognized.text,'测试图案');assert.equal(called,1);
});
