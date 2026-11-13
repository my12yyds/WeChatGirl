export const QUARK_DOWNLOAD_URL='https://pan.quark.cn/s/b57dd69d37af';

export function downloadLinks(githubUrl){
  const fallback='https://github.com/my12yyds/WeChatGirl/releases/latest';
  let github=fallback;
  try{
    const url=new URL(githubUrl);
    if(url.origin==='https://github.com'&&!url.username&&!url.password&&/^\/my12yyds\/WeChatGirl\/releases\/(?:latest|download\/v[\w.-]+\/[\w.-]+)$/.test(url.pathname)){
      github=url.origin+url.pathname;
    }
  }catch{/* The public release list is always available as a fallback. */}
  return `<a class="button small primary" href="${QUARK_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer">夸克网盘下载</a><a class="button small" href="${github}" target="_blank" rel="noopener noreferrer">GitHub 下载</a>`;
}
