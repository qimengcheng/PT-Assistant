/**
 * catch 到东西之后取一句能显示的话。
 *
 * 为什么单独一处：三片代码（原生通信桥、原生桥设置窗、媒体服务器页）都在写
 * `catch (e: any) { lastError = e?.message ?? String(e) }` —— 那个 `any` 会顺着
 * 形参一路带进界面，而这里真正要的判据只有三档：Error 取 message、
 * 带 message 字段的普通对象也认（chrome 运行时抛过这种）、其余原样字符串化。
 */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message);
  return String(e);
}
