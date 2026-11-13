import {downloadLinks} from './download-links.mjs';

export function startUpdateUI({api,toast}) {
  const button=document.querySelector('#check-updates'),banner=document.querySelector('#update-banner');
  if(!button||!banner)return;
  const show=(result,manual)=>{
    if(result.status!=='available'&&!manual)return;
    document.querySelector('#update-message').textContent=result.status==='available'?'发现 '+result.latestVersion+(result.sameVersionBuild?' 的更新构建':' 新版本')+'，可下载后运行安装包更新。':'选择 WeChatGirl 安装包的下载来源。';
    document.querySelector('#update-download').innerHTML=downloadLinks(result.downloadUrl);
    document.querySelector('#update-notes').href=result.releaseUrl;
    banner.hidden=false;
  };
  const check=async manual=>{
    button.disabled=true;
    try{const result=await api(manual?'/api/updates/check':'/api/updates',manual?{}:undefined);show(result,manual);
      if(manual)toast(result.status==='available'?'发现更新，下载入口已显示。':result.status==='up_to_date'?'当前已是最新版本。':result.status==='not_published'?'无法读取发行记录；私有仓库请登录 GitHub 查看更新。':'暂时无法连接更新服务，请稍后再试。');
    }catch{if(manual){show({releaseUrl:'https://github.com/my12yyds/WeChatGirl/releases/latest'},true);toast('更新检查暂时不可用，仍可打开下载页面。');}}
    finally{button.disabled=false;}
  };
  button.addEventListener('click',()=>check(true));
  document.querySelector('#dismiss-update').addEventListener('click',()=>{banner.hidden=true;});
  void check(false);
}
