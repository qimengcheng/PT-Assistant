/**
 * 图床转存：把源站简介里的截图拉到本地、再传到用户配置的图床，回一个可替换的新地址。
 *
 * ## 为什么需要它
 *
 * 源站的截图基本挂在源站自己的域名下（NexusPHP 的 `attachments/…`）。转载到别的站以后，
 * 图片请求带的是**目标站**的 referer，源站一开防盗链就是一片裂图 —— 这不是排版问题，
 * 是「帖子看起来像废帖」。所以转种的最后一步是换链接。
 *
 * ## 为什么要住在 offscreen
 *
 * 上图床是跨域 POST + FormData + Blob，取图还要能带源站 cookie。options 页面能做，
 * 但那里是 UI 线程：十几张图串行上传会把页面卡住，而且窗口一关就断。offscreen 文档
 * 天生干这个（AGENTS §3.2）。
 *
 * ## 取图的三次尝试（顺序是有意的）
 *
 * 1. `credentials: "omit"` —— 绝大多数源站截图本来就托管在第三方图床，不带 cookie 最干净
 * 2. `credentials: "include"` —— 少数图床要登录态才给图
 * 3. 走站点请求层（带站点 cookie + 站点自定义头）—— 源站自家附件
 *
 * 每次都校验 `content-type` 是 `image/*`：防盗链站点对图片请求常常回一个 **200 的 HTML**
 * （登录页 / 提示页），只看状态码会把一张 HTML 当成图传上图床，最后在目标站显示成裂图。
 */
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";
import type {
  IImageHostMetadata,
  IImageHostRequestSpec,
  IImageHostTestResult,
  IImageHostUploadItem,
  IImageHostUploadRequest,
} from "@/shared/imageHost/types.ts";
import { IMAGE_HOST_TEST_PNG_BASE64 } from "@/shared/imageHost/types.ts";
import { buildImageHostRequest, extractUploadedUrl } from "@/shared/imageHost/providers.ts";

import { onMessage } from "@/messages.ts";
import { extStore } from "@/storage.ts";
import { textSummary } from "./html.ts";
import { logger } from "./logger.ts";
import { getSiteInstance } from "./site.ts";

/**
 * 已经传过的图：`<hostId>\u0000<sourceUrl>` → 新地址。
 *
 * 为什么要有：简介里的同一张图常被引用两次（正文一次、截图区一次），
 * 而「转存」按钮人会手贱点两遍。缓存让它天然幂等，也省掉图床那边的重复上传。
 * 只活在这个 offscreen 文档的生命周期里 —— 不落盘，因为它没有任何长期价值。
 */
const uploadedCache = new Map<string, string>();

async function getImageHostConfig(hostId: string): Promise<IImageHostMetadata> {
  const metadata = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema | null;
  const host = metadata?.imageHosts?.[hostId];
  if (!host) throw new Error(`图床配置不存在（可能刚被删掉）：${hostId}`);
  return host;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 从 URL 里猜个文件名：不少图床按扩展名决定存储格式，全叫 `blob` 会丢后缀 */
function guessFileName(url: string, contentType: string): string {
  const extFromMime = /image\/(png|jpe?g|gif|webp|bmp|avif)/i.exec(contentType)?.[1]?.toLowerCase();
  const base = (() => {
    try {
      const path = new URL(url).pathname;
      return decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    } catch {
      return "";
    }
  })();
  const cleaned = base.replace(/[^\w.-]/g, "_").slice(0, 80);
  if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(cleaned)) return cleaned;
  return `${cleaned || "image"}.${extFromMime ?? "jpg"}`;
}

interface IFetchedImage {
  bytes: Uint8Array;
  contentType: string;
}

async function fetchImageBytes(url: string, siteId?: string): Promise<IFetchedImage> {
  const errors: string[] = [];

  for (const credentials of ["omit", "include"] as const) {
    try {
      const response = await fetch(url, { credentials });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok) {
        errors.push(`HTTP ${response.status}`);
        continue;
      }
      if (!/^image\//i.test(contentType)) {
        // 200 的 HTML 多半是防盗链或登录页，不能当图传上去
        errors.push(`返回的不是图片（${contentType || "无 content-type"}）`);
        continue;
      }
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // 源站自家附件：直连拿不到就借站点的请求层（带 cookie 与站点自定义头）
  if (siteId) {
    try {
      const site = await getSiteInstance(siteId);
      const response = await site.request({ url, method: "get", responseType: "arraybuffer" });
      const data: unknown = response.data;
      if (data instanceof ArrayBuffer) return { bytes: new Uint8Array(data), contentType: "image/jpeg" };
      if (data instanceof Uint8Array) return { bytes: data, contentType: "image/jpeg" };
      errors.push("站点请求层取回的不是二进制");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  throw new Error(`取不到这张图：${errors.join("；")}`);
}

async function uploadOne(spec: IImageHostRequestSpec, file: IFetchedImage, fileName: string): Promise<string> {
  const form = new FormData();
  form.append(spec.fileField, new Blob([file.bytes as BlobPart], { type: file.contentType }), fileName);
  for (const [key, value] of Object.entries(spec.fields)) form.append(key, value);

  // 刻意不设 Content-Type：手动设了它，multipart 的 boundary 会被丢掉，接口只会回 400
  const response = await fetch(spec.url, { method: "POST", body: form, headers: spec.headers });
  const body = await response.text();
  const url = extractUploadedUrl(body, spec);

  if (!url) {
    // 把响应正文摘要贴出来：图床的鉴权错误（key 过期 / 额度用完）都在正文里写着
    throw new Error(`图床没有返回图片地址（HTTP ${response.status}）：${textSummary(body, 240) || "响应为空"}`);
  }
  return url;
}

/** 转存一张。失败不抛错，把原因塞进返回值的 `error` —— 一张失败不该拖垮整批 */
export async function uploadImageToHost(request: IImageHostUploadRequest): Promise<IImageHostUploadItem> {
  const sourceUrl = (request.url ?? "").trim();
  if (sourceUrl === "") return { sourceUrl, error: "空地址" };

  try {
    const host = await getImageHostConfig(request.hostId);
    const cacheKey = `${host.id}\u0000${sourceUrl}`;
    const cached = uploadedCache.get(cacheKey);
    if (cached) return { sourceUrl, url: cached, cached: true };

    const spec = buildImageHostRequest(host);
    const file = await fetchImageBytes(sourceUrl, request.siteId);
    const url = await uploadOne(spec, file, guessFileName(sourceUrl, file.contentType));
    uploadedCache.set(cacheKey, url);

    logger({
      msg: `[图床] 已转存一张到 ${host.name}`,
      data: { from: sourceUrl, to: url },
    });
    return { sourceUrl, url };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger({ msg: `[图床] 转存失败：${sourceUrl}`, data: { error } });
    return { sourceUrl, error };
  }
}

/** 设置页的「测试上传」：拿内置的 1×1 PNG 试一次，验证地址与凭证 */
export async function testImageHost(hostId: string): Promise<IImageHostTestResult> {
  try {
    const host = await getImageHostConfig(hostId);
    const spec = buildImageHostRequest(host);
    const url = await uploadOne(
      spec,
      { bytes: base64ToBytes(IMAGE_HOST_TEST_PNG_BASE64), contentType: "image/png" },
      "pt-assistant-test.png",
    );
    return { ok: true, url, message: "上传成功" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

onMessage("uploadImageToHost", async ({ data }) => await uploadImageToHost(data));

onMessage("testImageHost", async ({ data: hostId }) => await testImageHost(hostId));
