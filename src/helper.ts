// 此处放置一些全局都可以用的助手函数、常量定义

// 仓库相关
// ⚠️ 这里是本项目自己的仓库，不是上游 pt-plugins/PT-depiler。
// 该常量被 About/SpecialThank、About/TechnologyStack、SetSite / SetDownloader / SetBackup
// 的「源码 / 文档」入口共同使用 ——
// 指向错仓库会让所有这些入口一起跳到别人的项目去。
export const REPO_NAME = "qimengcheng/PT-Assistant";
export const REPO_URL = `https://github.com/${REPO_NAME}`;
export const REPO_API = `https://api.github.com/repos/${REPO_NAME}`;

// 上游项目的社群入口，本项目不继承（当前全项目无引用，留着仅作记录）
export const GROUP_TELEGRAM = "https://t.me/joinchat/NZ9NCxPKXyby8f35rn_QTw";
export const GROUP_QQ = "https://jq.qq.com/?_wv=1027&k=7d6xEo0L";

// 环境相关
export const isProd = import.meta.env.PROD;
export const isDebug = !isProd;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
