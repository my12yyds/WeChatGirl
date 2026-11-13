import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createUpdateChecker,UPDATE_REPOSITORY} from './update-check.mjs';
import {downloadLinks,QUARK_DOWNLOAD_URL} from '../public/console/download-links.mjs';

test('manual downloads place Quark first and preserve the registered GitHub attachment',()=>{
  const asset='https://github.com/my12yyds/WeChatGirl/releases/download/v0.5.10/WeChatGirl-plugins-all-0.5.10.zip';
  const links=downloadLinks(asset);
  assert(links.indexOf(QUARK_DOWNLOAD_URL)>=0&&links.indexOf(QUARK_DOWNLOAD_URL)<links.indexOf(asset));
  assert.match(downloadLinks('https://example.invalid/fake.exe'),/github\.com\/my12yyds\/WeChatGirl\/releases\/latest/);
  assert.doesNotMatch(downloadLinks('https://example.invalid/fake.exe'),/example\.invalid/);
});

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechatgirl-update-repo-'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.5.1'}));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('repository rename uses canonical API and download URLs for an available update',async t=>{
  assert.equal(UPDATE_REPOSITORY,'my12yyds/WeChatGirl');
  const download='https://github.com/my12yyds/WeChatGirl/releases/download/v0.5.2/WeChatGirl-Setup-0.5.2-x64.exe';
  const check=createUpdateChecker({root:fixture(t),fetchImpl:async url=>{assert.equal(url,'https://api.github.com/repos/my12yyds/WeChatGirl/releases/latest');return {ok:true,status:200,json:async()=>({tag_name:'v0.5.2',assets:[{name:'WeChatGirl-Setup-0.5.2-x64.exe',state:'uploaded',browser_download_url:download}]})};}});
  const result=await check.check();assert.equal(result.status,'available');assert.equal(result.downloadUrl,download);
});
test('renamed repository still rejects an installer download from another location',async t=>{
  const check=createUpdateChecker({root:fixture(t),fetchImpl:async()=>({ok:true,status:200,json:async()=>({tag_name:'v0.5.2',assets:[{name:'WeChatGirl-Setup-0.5.2-x64.exe',state:'uploaded',browser_download_url:'https://example.invalid/WeChatGirl.exe'}]})})});
  const result=await check.check();assert.notEqual(result.status,'available');assert.equal(result.downloadUrl,undefined);
});
