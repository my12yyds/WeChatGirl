export function setup(api) {
  api.registerTool({
    id:'status',
    description:'查看视频工作台是否可用。视频需由用户在控制台选择，聊天中不能按路径读取本机视频。',
    parameters:{type:'object',properties:{},additionalProperties:false},
    execute:async()=>({content:'可在 WeChatGirl 能力目录打开“视频压缩与识别”，选择本机视频并处理。'})
  });
}
