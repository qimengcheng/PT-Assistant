/**
 * 图床（图片转存）这条链上的数据形状。
 *
 * 为什么要做这一层：源站简介里的截图基本都挂在**源站自己**的域名下（NexusPHP 的
 * `attachments/2024/05/xxx.jpg`），目标站渲染时图片请求带的是目标站的 referer，
 * 源站一开防盗链就是一片裂图。转载的人常规做法是先把图转存到自己图床，再把链接替换掉。
 *
 * 这里的类型要同时喂三处：offscreen（真发请求）、options 设置页（渲染表单）、
 * 转种对话框（挑图床 + 显示结果），所以全部是**可结构化克隆的纯数据**。
 */

export type TImageHostKey = string;

/**
 * 支持的内置图床。最后那个 `custom` 是长尾兜底 —— 图床生态太长（自建 Chevereto / 兰空 /
 * 简单图床、各种聚合图床、私有接口），逐个写适配器必然过时，所以给一个「自己填地址 +
 * 文件字段 + 取 URL 的路径」的通用档，剩下的靠它覆盖。
 */
export type TImageHostType = "imgbb" | "smms" | "imgur" | "chevereto" | "lsky" | "easyimage" | "custom";

/**
 * 存进 metadata 的一份图床配置。
 *
 * 凭证（`apiKey`）与站点 cookie 一样落在这台机器的扩展存储里，并会随「metadata」字段
 * 出现在备份包里 —— 与站点 cookie 同一笔账，不要指望它比 cookie 更安全。
 */
export interface IImageHostMetadata {
  id: TImageHostKey;
  type: TImageHostType;
  /** 显示名，同类型可以加多个（两个不同的自建 Chevereto） */
  name: string;
  enabled: boolean;
  /** 站点地址，自建类必填 */
  endpoint?: string;
  /** 凭证：API Key / Token / Client ID，各站叫法不同 */
  apiKey?: string;
  /** 长尾扩展（`custom` 的文件字段名、取地址路径、鉴权头、额外表单字段） */
  options?: Record<string, string>;
  lastUploadAt?: number;
  /** 上一次失败的原文，设置页原样显示，方便对着报错改 key */
  lastError?: string;
}

/**
 * 一次上传请求的构成（纯数据，`buildImageHostRequest` 的产物）。
 *
 * 刻意不写成「每个图床一个函数」：把它压成一份请求描述，设置页才能用同一套逻辑做
 * 「测试上传」，判据也能直接在 Node 里断言（见 `tests/shared/imageHost.test.ts`）。
 */
export interface IImageHostRequestSpec {
  url: string;
  /** 上传文件的表单字段名（各站叫 `image` / `smfile` / `source` / `file`…） */
  fileField: string;
  /** 额外的普通表单字段（如 EasyImage 的 `token`、Chevereto 的 `format`） */
  fields: Record<string, string>;
  /** 请求头。**不许带 Content-Type** —— 手动设了它 FormData 的 boundary 会丢 */
  headers: Record<string, string>;
  /** 从响应 JSON 里取图片地址的点路径，例如 `data.url` */
  urlPath?: string;
  /**
   * 有些图床返回的是**文件名/编码**而不是完整地址（`[{"code":"abc.png","ext":"png"}]`），
   * 这时要自己拼：模板里 `{value}` 会被上面取到的值替换。给空就表示返回值本身就是地址。
   */
  urlTemplate?: string;
  /** 取不到 `urlPath` 时，退到「常见路径 + 正文里第一个图片链接」去找 */
  fallbackFindUrl: boolean;
}

/**
 * 一次「把这一张图转存到某个图床」的请求。
 *
 * 刻意是**单张**而不是一批：界面上要看得见「3/12」这种进度，也要能一张失败一张报错，
 * 一批发过去只会得到一个「有几张没过」的笼统结论。offscreen 侧带缓存，重复调用不会重复上传。
 */
export interface IImageHostUploadRequest {
  hostId: TImageHostKey;
  /** 源图绝对地址 */
  url: string;
  /**
   * 源站 id。**只用来兜底取图**：源站自家域名下的附件常常要登录态才给下载，
   * 直连拿不到时回退到站点的请求层（带 cookie）。
   */
  siteId?: string;
}

export interface IImageHostUploadItem {
  sourceUrl: string;
  /** 转存后的地址；失败时为空 */
  url?: string;
  /** 命中缓存（这一轮之前已经传过同一张），没有真的再发一次请求 */
  cached?: boolean;
  /** 失败原因，原样给人看 */
  error?: string;
}

/** 设置页「测试上传」的产物：成功时带回图片地址，用来让人点开确认 */
export interface IImageHostTestResult {
  ok: boolean;
  url?: string;
  message: string;
}

/**
 * 1×1 透明 PNG。
 *
 * 设置页的「测试上传」用它，**不拿用户的任何一张真实截图**去试：测的是 key 能不能用，
 * 不该顺带把源站的图传到第三方去。
 */
export const IMAGE_HOST_TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
