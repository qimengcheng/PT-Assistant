/**
 * 内置图床的判据层：预设字段、请求怎么拼、响应里的地址怎么取。
 *
 * 全部是纯数据 + 纯函数（不碰 fetch、不碰 DOM），所以能直接在 Node 里断言。
 * 真正的请求在 `entrypoints/offscreen/utils/imageHost.ts`。
 *
 * ## 为什么不给每个图床写一个函数
 *
 * 图床之间真正的差别只有四处：地址、文件字段名、怎么带凭证、响应里地址在哪。
 * 写成一份请求描述就能让设置页用同一套逻辑渲染表单、做「测试上传」，
 * 也让 `custom`（长尾兜底）和内置档走同一条代码路径 —— 少一条路径就少一处会分叉的口径。
 *
 * ## 关于 `custom`
 *
 * 「图床都支持」的务实解：内置常见的 6 家，剩下的（各种聚合图床、私有接口、自建改版）
 * 用 `custom` 覆盖 —— 用户填地址、文件字段名、一个鉴权头、要取地址的 JSON 路径。
 * 取不到路径时还有一层兜底（常见路径 + 正文里第一个图片链接），
 * 所以多数自建站连路径都不用填。
 */
import type { IImageHostMetadata, IImageHostRequestSpec, TImageHostType } from "./types.ts";

/** 一个可填字段。`key` 直接对应存储里那一项（`apiKey` / `endpoint` / `options.xxx`） */
export interface IImageHostFieldSpec {
  key: string;
  /** i18n 后缀，完整键是 `SetImageHost.field.<labelKey>` */
  labelKey: string;
  type: "text" | "password" | "textarea";
  required: boolean;
  /** 输入框占位（地址这类给个样例值，比一句「请输入」有用） */
  placeholder?: string;
  /** 完整 i18n 键，一行说明（申请地址 / 填什么格式） */
  hintKey?: string;
}

export interface IImageHostPreset {
  type: TImageHostType;
  /** 品牌名，不翻译 */
  name: string;
  fields: IImageHostFieldSpec[];
  /** 这个档是不是「自建 / 任意地址」——决定列表里那列地址要不要显示成必填 */
  needEndpoint: boolean;
}

const ENDPOINT_FIELD: IImageHostFieldSpec = {
  key: "endpoint",
  labelKey: "endpoint",
  type: "text",
  required: true,
  placeholder: "https://img.example.com",
  hintKey: "SetImageHost.hint.endpoint",
};

const API_KEY_REQUIRED: IImageHostFieldSpec = {
  key: "apiKey",
  labelKey: "apiKey",
  type: "password",
  required: true,
  hintKey: "SetImageHost.hint.apiKey",
};

const API_KEY_OPTIONAL: IImageHostFieldSpec = { ...API_KEY_REQUIRED, required: false };

const PRESETS: Record<TImageHostType, IImageHostPreset> = {
  imgbb: {
    type: "imgbb",
    name: "ImgBB",
    needEndpoint: false,
    fields: [{ ...API_KEY_REQUIRED, hintKey: "SetImageHost.hint.imgbbKey" }],
  },
  smms: {
    type: "smms",
    name: "SM.MS",
    needEndpoint: false,
    fields: [{ ...API_KEY_REQUIRED, hintKey: "SetImageHost.hint.smmsKey" }],
  },
  imgur: {
    type: "imgur",
    name: "Imgur",
    needEndpoint: false,
    fields: [{ ...API_KEY_REQUIRED, hintKey: "SetImageHost.hint.imgurKey" }],
  },
  chevereto: {
    type: "chevereto",
    name: "Chevereto",
    needEndpoint: true,
    fields: [ENDPOINT_FIELD, { ...API_KEY_OPTIONAL, hintKey: "SetImageHost.hint.cheveretoKey" }],
  },
  lsky: {
    type: "lsky",
    name: "兰空图床 Lsky",
    needEndpoint: true,
    fields: [ENDPOINT_FIELD, { ...API_KEY_REQUIRED, hintKey: "SetImageHost.hint.lskyKey" }],
  },
  easyimage: {
    type: "easyimage",
    name: "简单图床 EasyImage",
    needEndpoint: true,
    fields: [ENDPOINT_FIELD, { ...API_KEY_OPTIONAL, hintKey: "SetImageHost.hint.easyimageKey" }],
  },
  custom: {
    type: "custom",
    name: "自定义",
    needEndpoint: true,
    fields: [
      { ...ENDPOINT_FIELD, hintKey: "SetImageHost.hint.customEndpoint" },
      { ...API_KEY_OPTIONAL, hintKey: "SetImageHost.hint.customKey" },
      {
        key: "options.fileField",
        labelKey: "fileField",
        type: "text",
        required: false,
        placeholder: "file",
        hintKey: "SetImageHost.hint.customFileField",
      },
      {
        key: "options.urlPath",
        labelKey: "urlPath",
        type: "text",
        required: false,
        placeholder: "data.url",
        hintKey: "SetImageHost.hint.customUrlPath",
      },
      {
        key: "options.urlTemplate",
        labelKey: "urlTemplate",
        type: "text",
        required: false,
        placeholder: "https://img.example.com/{value}",
        hintKey: "SetImageHost.hint.customUrlTemplate",
      },
      {
        key: "options.headerName",
        labelKey: "headerName",
        type: "text",
        required: false,
        placeholder: "Authorization",
      },
      {
        key: "options.headerValue",
        labelKey: "headerValue",
        type: "text",
        required: false,
        placeholder: "Bearer {apiKey}",
        hintKey: "SetImageHost.hint.customHeaderValue",
      },
      {
        key: "options.extraFields",
        labelKey: "extraFields",
        type: "textarea",
        required: false,
        placeholder: '{"token": "{apiKey}"}',
        hintKey: "SetImageHost.hint.customExtraFields",
      },
    ],
  },
};

export const IMAGE_HOST_TYPES: TImageHostType[] = Object.keys(PRESETS) as TImageHostType[];

export function listImageHostPresets(): IImageHostPreset[] {
  return IMAGE_HOST_TYPES.map((type) => PRESETS[type]);
}

export function getImageHostPreset(type: TImageHostType | undefined): IImageHostPreset | undefined {
  return type ? PRESETS[type] : undefined;
}

/** 地址归一：补协议、去尾斜杠。用户粘 `img.example.com/` 这种形式是常态 */
export function normalizeEndpoint(raw: string | undefined): string {
  const text = (raw ?? "").trim().replace(/\/+$/, "");
  if (text === "") return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

/** `{apiKey}` 这类占位替换；没给值就替换成空串（而不是留着花括号让请求坏掉） */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

/** 从 `options.fileField` / `options.urlPath` 这类扁平键里取值 */
function readOption(options: Record<string, string> | undefined, key: string): string {
  return ((options ?? {})[key] ?? "").trim();
}

/** 额外表单字段：JSON 文本。解析不了就当没填（不因为一个花括号挡住整个上传） */
function parseExtraFields(raw: string): Record<string, string> {
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 配置 → 一次上传请求。
 *
 * 缺必填项时抛错（而不是拼一个注定失败的请求）：设置页要把这句话原样显示出来，
 * 「key 没填」与「key 填错了」在界面上必须能分清。
 */
export function buildImageHostRequest(host: IImageHostMetadata | undefined): IImageHostRequestSpec {
  if (!host) throw new Error("图床配置不存在");

  const preset = PRESETS[host.type];
  if (!preset) throw new Error(`不认识的图床类型：${host.type}`);

  const endpoint = normalizeEndpoint(host.endpoint);
  const apiKey = (host.apiKey ?? "").trim();
  const vars = { apiKey };

  if (preset.needEndpoint && endpoint === "") throw new Error("这个图床要填站点地址");

  switch (host.type) {
    case "imgbb":
      if (!apiKey) throw new Error("ImgBB 需要 API Key");
      return {
        url: `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
        fileField: "image",
        fields: {},
        headers: {},
        urlPath: "data.url",
        fallbackFindUrl: true,
      };

    case "smms":
      if (!apiKey) throw new Error("SM.MS 需要 API Token");
      return {
        url: "https://sm.ms/api/v2/upload",
        fileField: "smfile",
        fields: {},
        // sm.ms 的 token 直接放 Authorization，不带 Bearer 前缀（粘错前缀的人多半也把整串复制进来了，
        // 那种情况下带上原样提交反而能过，所以这里不猜、只做去空白）
        headers: { Authorization: apiKey },
        urlPath: "data.url",
        fallbackFindUrl: true,
      };

    case "imgur":
      if (!apiKey) throw new Error("Imgur 需要 Client ID");
      return {
        url: "https://api.imgur.com/3/image",
        fileField: "image",
        fields: {},
        headers: {
          Authorization: /^client-id\s/i.test(apiKey) ? apiKey : `Client-ID ${apiKey}`,
        },
        urlPath: "data.link",
        fallbackFindUrl: true,
      };

    case "chevereto":
      return {
        url: `${endpoint}/api/1/upload`,
        fileField: "source",
        fields: { format: "json" },
        // v4 用 X-API-Key；v3 的 key 走表单字段，两个都带上，哪版都能用
        headers: apiKey ? { "X-API-Key": apiKey } : {},
        urlPath: "image.url",
        fallbackFindUrl: true,
      };

    case "lsky":
      if (!apiKey) throw new Error("兰空图床需要 API Token");
      return {
        url: `${endpoint}/api/v1/upload`,
        fileField: "file",
        fields: {},
        headers: {
          Authorization: /^bearer\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        urlPath: "data.links.url",
        fallbackFindUrl: true,
      };

    case "easyimage":
      return {
        url: `${endpoint}/api/index.php`,
        fileField: "image",
        fields: apiKey ? { token: apiKey } : {},
        headers: {},
        urlPath: "url",
        fallbackFindUrl: true,
      };

    case "custom": {
      const headerName = readOption(host.options, "headerName");
      const headerValue = interpolate(readOption(host.options, "headerValue"), vars);
      const extra = parseExtraFields(readOption(host.options, "extraFields"));
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(extra)) fields[key] = interpolate(value, vars);

      return {
        url: endpoint,
        fileField: readOption(host.options, "fileField") || "file",
        fields,
        headers: headerName && headerValue ? { [headerName]: headerValue } : {},
        urlPath: readOption(host.options, "urlPath") || undefined,
        urlTemplate: readOption(host.options, "urlTemplate") || undefined,
        fallbackFindUrl: true,
      };
    }
  }
}

/** 取不到 `urlPath` 时按这个顺序找：这几条覆盖了绝大多数图床的返回壳 */
const FALLBACK_URL_PATHS = [
  "data.url",
  "data.link",
  "data.links.url",
  "data.image.url",
  "image.url",
  "image.display_url",
  "url",
  "link",
  "links.url",
  "data.0.url",
];

/** `a.b[0].c` 这种路径取值。取不到返回 undefined，不抛错 */
export function pickByPath(payload: unknown, path: string): unknown {
  let cursor: unknown = payload;
  for (const rawSegment of path.split(".")) {
    if (cursor === null || cursor === undefined) return undefined;
    const segment = rawSegment.trim();
    if (segment === "") continue;
    const indexMatch = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    const key = indexMatch?.[1] ?? segment;
    const indexes = indexMatch?.[2] ?? "";

    if (key !== "") {
      if (typeof cursor !== "object") return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    for (const indexText of indexes.match(/\[\d+\]/g) ?? []) {
      const index = Number(indexText.slice(1, -1));
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[index];
    }
  }
  return cursor;
}

function asHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  return text;
}

/**
 * 从上传接口的响应里取出图片地址。
 *
 * 顺序：给定路径 → 一组常见路径 → 正文里第一个图片链接。
 * 最后那一层是给「接口把地址塞在没见过的字段里」用的 —— 拿不到地址就等于这次白传了，
 * 多试一步比让人自己去后台翻强。取不到就返回 undefined，由调用方报错并贴出响应正文。
 */
export function extractUploadedUrl(
  rawBody: string,
  spec: Pick<IImageHostRequestSpec, "urlPath" | "urlTemplate">,
): string | undefined {
  let payload: unknown;
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      payload = JSON.parse(trimmed);
    } catch {
      payload = undefined;
    }
  }

  if (payload !== undefined) {
    if (spec.urlPath) {
      const hit = asHttpUrl(pickByPath(payload, spec.urlPath));
      if (hit) return hit;

      // 返回的是编码/文件名而不是完整地址：按模板拼一个
      const piece = pickByPath(payload, spec.urlPath);
      if (spec.urlTemplate && (typeof piece === "string" || typeof piece === "number")) {
        const built = spec.urlTemplate.replace(/\{value\}/g, String(piece).trim());
        const templateHit = asHttpUrl(built);
        if (templateHit) return templateHit;
      }
    }
    for (const path of FALLBACK_URL_PATHS) {
      const hit = asHttpUrl(pickByPath(payload, path));
      if (hit) return hit;
    }
  }

  // 正文兜底：只在「返回的是 JSON 但我们没认出来」时用，避免把 HTML 页面里的脚本地址当成图
  if (payload !== undefined) {
    const match = /https?:\/\/[^\s"'<>\\]+?\.(?:png|jpe?g|gif|webp|bmp|avif)(?:\?[^\s"'<>\\]*)?/i.exec(trimmed);
    if (match) return match[0];
  }

  return undefined;
}
