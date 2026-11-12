import { spawn } from 'node:child_process';
import path from 'node:path';

export function windowsPowerShellEnvironment(env = process.env) {
  const result = { ...env };
  for (const key of Object.keys(result)) if (key.toLowerCase() === 'psmodulepath') delete result[key];
  const systemRoot = env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows';
  const modules = [path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')];
  if (env.ProgramFiles) modules.push(path.win32.join(env.ProgramFiles, 'WindowsPowerShell', 'Modules'));
  result.PSModulePath = modules.join(';');
  return result;
}

export function windowsPowerShellExecutable(env = process.env) {
  return path.win32.join(env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// A persistent service started by PowerShell can inherit a pipe handle even
// after the launcher exits. Its pipes must not define the task's lifetime.
export function runConsoleCommand(spec, onOutput, { cwd, env = process.env, timeoutMs = 180000, drainMs = 150 } = {}) {
  return new Promise(resolve => {
    const processEnv = /(?:^|[\\/])powershell\.exe$/i.test(spec.exe) ? windowsPowerShellEnvironment(env) : env;
    const child = spawn(spec.exe, spec.args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...processEnv, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' } });
    let done = false, drainTimer;
    const finish = code => {
      if (done) return;
      done = true; clearTimeout(deadline); clearTimeout(drainTimer);
      child.stdout?.destroy(); child.stderr?.destroy(); resolve(code);
    };
    const deadline = setTimeout(() => {
      onOutput('\n操作等待超时，请查看连接检查与运行日志后重试。\n');
      child.kill(); finish(124);
    }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', onOutput); child.stderr.on('data', onOutput);
    child.once('error', error => { onOutput(error.message); finish(1); });
    child.once('exit', code => {
      clearTimeout(deadline);
      // Let queued output drain, with a bound independent of descendants.
      drainTimer = setTimeout(() => finish(code ?? 1), drainMs);
    });
    child.once('close', code => finish(code ?? 1));
  });
}

export function taskFailureMessage(output, code) {
  const importError = /\[DSH_IMPORT_(?:RUNNING|UNSUPPORTED|BUNDLE_INVALID|FAILED)\] ([^\r\n]+)/.exec(output);
  if (importError) return importError[1];
  if (/DSH_NOT_CONFIGURED/.test(output)) return '请先在“首次配置”点击“下载安装 DSH”，安装后选择 DSH 程序位置并保存设置。';
  if (/DSH_PLUGIN_NOT_READY/.test(output)) return 'DSH 桥接插件未启动。请在 DSH 连接设置核对本项目插件；若已启用，检查是否有另一套 WeChatGirl 使用相同组件 ID 覆盖了配置，修正后从托盘完整退出并重开 DSH。';
  if (/DSH_PLUGIN_AUTH_FAILED/.test(output)) return 'DSH 插件凭据与当前项目不匹配。请重新准备连接配置，从托盘退出并重开 DSH，再刷新模型。';
  if (/DSH_PLUGIN_WRONG_PROJECT/.test(output)) return 'DSH 加载的是另一套 WeChatGirl。请在 DSH 停用旧项目插件，导入当前项目插件，再完整重开 DSH。';
  const port=/\bport=(\d{1,5})\b/.exec(output)?.[1],portLabel=port?'端口 '+port:'配置端口';
  if (/ADAPTER_PORT_IN_USE|SERVICE_PORT_IN_USE|SERVICE_PORT_OWNER_MISMATCH/.test(output)) return portLabel+' 已被其他进程占用或绑定。点击“检查占用进程”，核对路径和 PID，经再次确认后处理；也可在连接设置中修改端口。';
  if (/ADAPTER_PORT_DENIED|SERVICE_PORT_DENIED/.test(output)) return 'Windows 拒绝绑定'+portLabel+'，可能涉及系统保留端口或访问限制。请在连接设置中更换该端口再重试；没有监听进程也可能无法使用。';
  if (/SERVICE_PORT_INSPECTION_FAILED/.test(output)) return '无法核对'+portLabel+'的进程归属，启动已停止。请完整退出并重新打开应用，仍失败时查看启动日志。';
  if (/ADAPTER_IDENTITY_MISMATCH/.test(output)) return portLabel+'未返回本实例的适配器身份，可能仍在运行旧版服务。请先重启本实例服务；持续冲突时检查占用进程。';
  if (/READER_NOT_LISTENING|READER_HEALTH_TIMEOUT|READER_CONNECTION_RESET|READER_HEALTH_INVALID_RESPONSE|READER_HEALTH_FAILED/.test(output)) return '适配器无法连接微信读取服务（'+portLabel+'）。请查看 reader.stderr.log 中的状态，并停止后重新启动助手服务；这一步尚未确认微信发送组件异常。';
  if (/HOOK_CONNECTION_RESET|HOOK_HEALTH_FAILED/.test(output)) return '微信发送组件连接被中断或检查失败（'+portLabel+'）。请查看 hook-init.log；持续失败时使用“修复微信连接”。';
  if (/ADAPTER_LISTEN_FAILED|ADAPTER_START_FAILED/.test(output)) return '应用适配器未能启动。下方日志已保留失败阶段和系统错误码，请结合 adapter.stderr.log 检查。';
  if (/SERVICE_START_TIMEOUT/.test(output)) return portLabel+'对应的本实例服务未在期限内准备完成。请查看该服务日志，或重启本实例后重试。';
  if (/READER_PORT_UNAVAILABLE/.test(output)) return '读取服务端口已被占用或被 Windows 拒绝。请在连接设置中修改微信读取端口，再启动服务；端口可能被未监听的其他程序占用。';
  if (/port is used by another installation|port is already in use|EADDRINUSE|address already in use/i.test(output)) return '配置端口已被占用。点击“检查占用进程”，核对程序后可选择停止，再重试。';
  if (/Another desktop WeChat is running|WECHAT_MULTIPLE/i.test(output)) return '检测到其他微信客户端。点击“检查占用进程”，确认并停止对应微信后，再打开匹配微信。';
  if (/HOOK_CLIENT_UNHEALTHY|HOOK_INITIALIZATION_TIMEOUT|HOOK_NOT_LISTENING/.test(output)) return '微信发送组件尚未就绪。可稍后重试；持续失败时点击“修复微信连接”，核对进程并再次确认后重开匹配微信。详情见 hook-init.log。';
  if (/HOOK_AUTH_FAILED|HOOK_PORT_OWNER_MISMATCH/.test(output)) return '微信发送端口或令牌与当前客户端不一致。请检查占用进程和 hook-init.log；可通过“修复微信连接”重新打开匹配微信。';
  if (/HOOK_HEALTH_TIMEOUT/.test(output)) return '微信发送组件响应超时，请稍后重试；持续失败时查看 hook-init.log。';
  if (/HOOK_HEALTH_INVALID_RESPONSE/.test(output)) return '微信发送端口返回了无效响应，可能被其他程序占用；请检查 hook-init.log 和发送端口。';
  if (/ACCOUNT_SWITCH_REQUIRES_DSH_RESTART/.test(output)) return '账号已切换。请从 DSH 托盘完整退出并重新打开，再启动助手服务。';
  if (code === 124) return '操作等待超时。请查看连接检查与日志，确认当前服务状态后重试。';
  if (/ModuleNotFoundError|ImportError|DLL load failed|需要 sqlcipher3/i.test(output)) return '读取组件缺失或无法加载。请重新安装更新后的安装包，然后在首次配置中点击“验证内置环境”。';
  if (/Selected account database directory is unavailable/i.test(output)) return '找不到所选账号的数据库目录。请在首次配置中自动查找账号，或重新选择包含 db_storage 的账号文件夹。';
  if (/Selected account database credential verification failed/i.test(output)) return '密钥与当前账号数据库不匹配。请在首次配置中点击“一键连接并验证”重新获取。';
  if (/Windows current-user credential decryption failed|Legacy secret requires/i.test(output)) return '已有凭据无法在当前电脑或 Windows 用户下读取。请在首次配置中点击“一键连接并验证”重新获取。';
  if (/Contact database could not be read|One or more message shards could not be read/i.test(output)) return '微信数据库尚未完整同步或暂时无法读取。请在微信打开几个聊天，等待同步后重新连接并验证。';
  if (/Reader initialization failed: (?:KeyError|FileNotFoundError)/i.test(output)) return '数据库读取设置尚未完成。请在首次配置中选择账号并点击“一键连接并验证”。';
  if (/reader exited/i.test(output)) return '数据库读取器未能启动。请在首次配置中重新连接并验证微信；下方会显示读取器的具体错误。';
  if (/HOOK_COMPONENT_UPDATE_PENDING/.test(output)) return '发送组件已更新。点击“修复微信连接”，核对并再次确认后重开匹配微信以应用更新。';
  if (/CouldNotAutoloadMatchingModule|Microsoft\.PowerShell\.Security.*module|Get-AuthenticodeSignature.*ObjectNotFound/is.test(output)) return 'Windows PowerShell 安全模块未能加载。请退出应用后重新打开更新后的 WeChatGirl.exe。';
  if (/WECHAT_LAUNCH_EXITED/i.test(output)) return '微信启动后已退出。若微信提示必须升级，当前固定版本的发送组件需要重新适配；请保留完整微信提示。';
  if (/HOOK_VERSION_MISMATCH|HOOK_PROFILE_MISMATCH|Client version mismatch|Native text component hash\/profile mismatch/i.test(output)) return '微信版本与发送组件不匹配，请在连接设置中选择匹配的微信程序。';
  if (/HOOK_LOGIN_REQUIRED/i.test(output)) return '发送组件已连接，但微信尚未打开账号数据库。请完成登录并等待聊天同步，然后重试。';
  if (/HOOK_MULTIPLE_ACCOUNT_DATABASES/i.test(output)) return '匹配微信进程仍打开多个账号的数据库。点击“修复微信连接”，核对并再次确认后重开匹配微信，再登录目标账号。';
  if (/HOOK_ACCOUNT_MISMATCH/i.test(output)) return '微信当前账号与所选数据库不一致。请重新选择当前账号，或在微信切换到所选账号后重试。';
  if (/HOOK_ACCOUNT_METADATA_INVALID/i.test(output)) return '微信发送组件未提供有效账号信息。请检查组件版本或使用“修复微信连接”。';
  if (/HOOK_ACCOUNT_NOT_READY/i.test(output)) return '微信账号数据库尚未与读取设置匹配。请确认登录了对应账号，并等待聊天同步完成。';
  if (/WeChat-Hook is not ready|BACKEND_UNAVAILABLE|Matching WeChat client missing/i.test(output)) return '匹配微信尚未就绪。点击“打开微信”，登录配置的账号后再启动。';
  if (/Install the DSH plugin|Fully.*reopen DSH|ECONNREFUSED.*11230/i.test(output)) return 'DSH 插件尚未就绪。打开 DSH，启用本项目插件并完整重开后再启动。';
  if (/Invalid project configuration|configuration.*failed/i.test(output)) return '项目配置无效，请检查连接设置与人格文件。';
  return '操作未完成，请查看下方详细信息，修正配置后重试。';
}

const deliveryHints={
  NATIVE_STICKER_UNAVAILABLE:'当前微信未加载支持指定表情的组件。请在配置向导检查微信与发送组件，再从托盘完整退出并重开匹配微信。4.1.15.13 也可开启“兼容发送收藏表情”。',
  HOOK_STICKER_DISABLED_IN_FOREGROUND:'前台发送只能选用微信收藏表情。请先在微信添加收藏，或使用支持指定表情的 Hook 版本。',
  STICKER_SENDING_DISABLED:'此聊天已关闭表情回复。请在“聊天”检查该会话的表情发送开关。',
  STICKER_BINDING_INVALID:'表情来源或账号与当前聊天不匹配。请刷新表情池，重新选用当前账号的素材。',
  STICKER_DELIVERY_EXPIRED:'表情等待发送超时。请先处理正在进行的前台发送或微信弹窗，再发起一次新请求。',
  NATIVE_STICKER_REJECTED:'微信拒绝了这张表情。请核对发送组件和表情来源，再用另一张表情测试。',
  FOREGROUND_STICKER_PANEL_UNAVAILABLE:'未找到微信表情面板。请解锁桌面，打开匹配微信，在聊天里确认可以手动打开表情面板。',
  FOREGROUND_FAVORITES_TAB_UNAVAILABLE:'未找到可操作的收藏表情标签。请打开微信表情面板，检查“收藏”或“添加的表情”。',
  FOREGROUND_FAVORITES_EMPTY:'没有找到可见的收藏表情。请在微信收藏至少一张表情，打开收藏标签确认它能显示。',
  FOREGROUND_FAVORITE_NOT_CLICKED:'收藏表情被遮挡或无法点击。请把微信窗口移到前台并保持可见。',
  FOREGROUND_DRAFT_PRESENT:'聊天输入框有草稿或无法核对草稿。请先处理现有草稿，再试发送。',
  FOREGROUND_WINDOW_AMBIGUOUS:'找不到唯一的匹配微信窗口。请打开已绑定的微信，并从托盘退出多余客户端。',
  FOREGROUND_FOCUS_CHANGED:'发送期间微信失去焦点。请解锁桌面，保持微信窗口在前台后重试。',
  FOREGROUND_UI_UNAVAILABLE:'无法操作微信窗口。请解锁桌面，确保两个程序使用相同权限，并检查前台组件。',
  TARGET_MAPPING_AMBIGUOUS_OR_MISSING:'找不到唯一的目标聊天。请给同名好友或群设置可区分的备注，再重新选择。',
  CONVERSATION_NOT_ALLOWED:'目标聊天没有发送权限。请在“聊天”添加目标并保存授权。',
  SENDER_BUSY:'发送队列正忙。请等当前消息或语音投递结束后再试。',
};

export function deliveryFailureHint(code){
  if(!/^[A-Z][A-Z0-9_]{2,79}$/.test(code??'')||code==='PROACTIVE_CONTEXT_CHANGED')return '';
  if(Object.hasOwn(deliveryHints,code))return deliveryHints[code];
  if(/(?:DELIVERY|SUBMISSION|RECEIPT).*UNCONFIRMED|RECEIPT_STATE_UNAVAILABLE/.test(code))return '微信可能已收到提交，但程序尚未核验回执。请先到目标聊天确认，再决定是否重发。';
  if(/ACCOUNT_MISMATCH|HOOK_(?:AUTH_FAILED|LOGIN_REQUIRED|NOT_LISTENING|VERSION_MISMATCH)/.test(code))return '微信发送账号或组件未核验。请在配置向导重新连接并验证当前登录的微信。';
  if(code==='BACKEND_UNAVAILABLE')return '发送服务暂不可用。请在连接诊断检查微信账号、消息桥接及发送组件。';
  return '请打开连接诊断检查当前发送模式和服务状态，并用下方错误码定位。';
}
