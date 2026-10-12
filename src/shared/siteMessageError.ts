/**
 * 把「那一趟为什么失败」压成一句能进界面的话。
 *
 * 为什么要这一道：站内信读失败时界面上原来只有一句猜测（「可能是登录态失效，或站点改版」），
 * 而真实原因（超时 / 401 / DNS 挂了 / 解析没找到表格）本来就在抛出的那个 Error 里 —— 用户 2026-10-12
 * 要的就是把它带进提示。问题是错误串里可能嵌着**带 passkey 的请求地址**：NexusPHP 的取信地址形如
 * `messages.php?passkey=xxxx`，axios 的报错文案会把它整串带出来。界面是会被截图、会被贴到群里的地方，
 * 所以过一道清洗再交给界面，而不是把原值塞进返回值。
 */

/** 像凭据的那几个参数名：值一律换成 `***` */
const CRED_PAIR = /\b(passkey|pid|authkey|auth|token|secret|password|uid)\b(\s*[=:]\s*)([^&\s"'<]+)/gi;

/** URL 上的查询串（`?` 之后到下一个空白/引号/尖括号之前） */
const QUERY = /\?[^&\s"'<>]*(?:&[^&\s"'<>]*)*/g;

/** 界面上一句说明吃不下太长；截断后补省略号 */
const MAX_LEN = 160;

/**
 * 清洗一条错误：先抹掉查询串（那里面最可能整段是凭据），再把剩下形如 `passkey=xxx` 的
 * 键值对逐个打码，最后折空白、截断。
 *
 * 认不出形状的一律照原样保留（除了长度截断）：这是给人看的诊断信息，
 * 不该为了好看去改写它 —— 那会把「timeout of 5000ms exceeded」这种真话弄没。
 */
export function sanitizeSiteMessageError(raw: unknown, maxLen: number = MAX_LEN): string {
  let text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");
  text = text.replace(QUERY, "?***").replace(CRED_PAIR, "$1$2***");
  // 折叠成一行：错误串里常带换行（堆栈、站点返回的 HTML 片段），界面那一格不吃多行
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxLen) text = `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  return text;
}
