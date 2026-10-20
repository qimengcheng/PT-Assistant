/**
 * 图床判据的断言（`src/shared/imageHost/`）。
 *
 * 这里不打桩任何网络：`providers.ts` 的职责就是「配置 → 请求描述」与「响应 → 地址」这两次
 * 纯转换，而这两处恰恰是最容易错、也最贵的地方 —— 传错字段名或取错路径，用户在界面上
 * 只会看到「图床没有返回图片地址」，然后开始怀疑自己的 key。
 */
import { describe, expect, it } from "vitest";

import type { IImageHostMetadata } from "@/shared/imageHost/types.ts";
import {
  buildImageHostRequest,
  extractUploadedUrl,
  getImageHostPreset,
  listImageHostPresets,
  normalizeEndpoint,
  pickByPath,
} from "@/shared/imageHost/providers.ts";
import { replaceImageUrls, replaceUrlList } from "@/shared/imageHost/rewrite.ts";

function host(overrides: Partial<IImageHostMetadata>): IImageHostMetadata {
  return { id: "h1", type: "imgbb", name: "test", enabled: true, ...overrides };
}

describe("图床预设", () => {
  it("每个类型都有字段清单，自建类必须能填地址", () => {
    const presets = listImageHostPresets();
    expect(presets.length).toBeGreaterThanOrEqual(7);
    for (const preset of presets) {
      expect(preset.name).not.toBe("");
      expect(preset.fields.length).toBeGreaterThan(0);
      expect(preset.needEndpoint).toBe(preset.fields.some((f) => f.key === "endpoint"));
    }
  });

  it("查不到的类型返回 undefined，不抛错（存档里可能是旧版本的类型）", () => {
    expect(getImageHostPreset("imgbb")).toBeTruthy();
    expect(getImageHostPreset("nope" as never)).toBeUndefined();
    expect(getImageHostPreset(undefined)).toBeUndefined();
  });

  it("地址归一：补协议、去尾斜杠", () => {
    expect(normalizeEndpoint("img.example.com")).toBe("https://img.example.com");
    expect(normalizeEndpoint("https://img.example.com///")).toBe("https://img.example.com");
    expect(normalizeEndpoint("  http://a.b/c/ ")).toBe("http://a.b/c");
    expect(normalizeEndpoint("")).toBe("");
    expect(normalizeEndpoint(undefined)).toBe("");
  });
});

describe("buildImageHostRequest", () => {
  it("imgbb：key 进 query，文件字段是 image", () => {
    const spec = buildImageHostRequest(host({ type: "imgbb", apiKey: "k 1" }));
    expect(spec.url).toBe("https://api.imgbb.com/1/upload?key=k%201");
    expect(spec.fileField).toBe("image");
    expect(spec.headers).toEqual({});
    expect(spec.urlPath).toBe("data.url");
  });

  it("smms：token 原样放 Authorization（不猜 Bearer 前缀）", () => {
    const spec = buildImageHostRequest(host({ type: "smms", apiKey: "abc123" }));
    expect(spec.url).toBe("https://sm.ms/api/v2/upload");
    expect(spec.fileField).toBe("smfile");
    expect(spec.headers).toEqual({ Authorization: "abc123" });
  });

  it("imgur：自动补 Client-ID，已经带了就不重复补", () => {
    expect(buildImageHostRequest(host({ type: "imgur", apiKey: "abc" })).headers.Authorization).toBe(
      "Client-ID abc",
    );
    expect(buildImageHostRequest(host({ type: "imgur", apiKey: "Client-ID abc" })).headers.Authorization).toBe(
      "Client-ID abc",
    );
  });

  it("chevereto：地址拼 /api/1/upload，key 走 X-API-Key", () => {
    const spec = buildImageHostRequest(host({ type: "chevereto", endpoint: "img.example.com/", apiKey: "kk" }));
    expect(spec.url).toBe("https://img.example.com/api/1/upload");
    expect(spec.fileField).toBe("source");
    expect(spec.fields).toEqual({ format: "json" });
    expect(spec.headers).toEqual({ "X-API-Key": "kk" });
    // 没填 key 也能拼出请求（有些自建站没开 API 鉴权）
    expect(buildImageHostRequest(host({ type: "chevereto", endpoint: "https://a.b" })).headers).toEqual({});
  });

  it("lsky：Bearer 前缀只补一次", () => {
    const spec = buildImageHostRequest(host({ type: "lsky", endpoint: "https://a.b", apiKey: "tk" }));
    expect(spec.url).toBe("https://a.b/api/v1/upload");
    expect(spec.headers.Authorization).toBe("Bearer tk");
    const again = buildImageHostRequest(host({ type: "lsky", endpoint: "https://a.b", apiKey: "Bearer tk" }));
    expect(again.headers.Authorization).toBe("Bearer tk");
  });

  it("easyimage：token 进表单字段，没有 token 就不带这个字段", () => {
    const withToken = buildImageHostRequest(host({ type: "easyimage", endpoint: "https://a.b", apiKey: "t" }));
    expect(withToken.fields).toEqual({ token: "t" });
    expect(withToken.fileField).toBe("image");
    const noToken = buildImageHostRequest(host({ type: "easyimage", endpoint: "https://a.b" }));
    expect(noToken.fields).toEqual({});
  });

  it("custom：地址用原样，文件字段可换，{apiKey} 在鉴权头与表单字段里都能用", () => {
    const spec = buildImageHostRequest(
      host({
        type: "custom",
        endpoint: "https://img.example.com/api/upload",
        apiKey: "SECRET",
        options: {
          fileField: "photo",
          urlPath: "result.0.url",
          headerName: "X-Token",
          headerValue: "Bearer {apiKey}",
          extraFields: '{"album": "pt", "token": "{apiKey}"}',
        },
      }),
    );
    expect(spec.url).toBe("https://img.example.com/api/upload");
    expect(spec.fileField).toBe("photo");
    expect(spec.headers).toEqual({ "X-Token": "Bearer SECRET" });
    expect(spec.fields).toEqual({ album: "pt", token: "SECRET" });
    expect(spec.urlPath).toBe("result.0.url");
  });

  it("custom：坏掉的 JSON 与空键都当没填，不挡住上传", () => {
    const spec = buildImageHostRequest(
      host({ type: "custom", endpoint: "https://a.b", options: { extraFields: "{不是 JSON", headerName: "  " } }),
    );
    expect(spec.fields).toEqual({});
    expect(spec.headers).toEqual({});
    expect(spec.fileField).toBe("file");
  });

  it("缺必填项抛错：key 没填与 key 填错在界面上必须能分清", () => {
    expect(() => buildImageHostRequest(host({ type: "imgbb", apiKey: "  " }))).toThrow(/API Key/);
    expect(() => buildImageHostRequest(host({ type: "lsky", endpoint: "", apiKey: "x" }))).toThrow(/地址/);
    expect(() => buildImageHostRequest(undefined)).toThrow(/不存在/);
  });
});

describe("pickByPath", () => {
  const payload = { data: { links: { url: "u1" } }, list: [{ url: "u2" }, { url: "u3" }], image: { url: "u4" } };

  it("点路径与数组下标都认", () => {
    expect(pickByPath(payload, "data.links.url")).toBe("u1");
    expect(pickByPath(payload, "list[1].url")).toBe("u3");
    expect(pickByPath(payload, "list.0.url")).toBe("u2");
  });

  it("取不到返回 undefined，不抛错", () => {
    expect(pickByPath(payload, "data.nope.url")).toBeUndefined();
    expect(pickByPath(payload, "list[9].url")).toBeUndefined();
    expect(pickByPath(null, "a")).toBeUndefined();
    expect(pickByPath(payload, "")).toBe(payload);
  });
});

describe("extractUploadedUrl", () => {
  it("按给定路径取", () => {
    const body = JSON.stringify({ data: { url: "https://i.example.com/a.png" } });
    expect(extractUploadedUrl(body, { urlPath: "data.url" })).toBe("https://i.example.com/a.png");
  });

  it("路径变了也能靠常见路径找到（图床改版最常见的一击）", () => {
    const body = JSON.stringify({ success: true, image: { display_url: "https://i.example.com/b.jpg" } });
    expect(extractUploadedUrl(body, { urlPath: "data.url" })).toBe("https://i.example.com/b.jpg");
  });

  it("认不出字段时退到正文里第一个图片链接", () => {
    const body = JSON.stringify({ weird: { nested: ["https://i.example.com/c.webp"] } });
    expect(extractUploadedUrl(body, { urlPath: "nope" })).toBe("https://i.example.com/c.webp");
  });

  it("取到的东西不是 http 地址就当没取到", () => {
    const body = JSON.stringify({ data: { url: "javascript:alert(1)" } });
    expect(extractUploadedUrl(body, { urlPath: "data.url" })).toBeUndefined();
  });

  it("返回 HTML（鉴权失败页）时不从正文里捞 URL", () => {
    const html = "<html><body><img src=\"https://x.y/logo.png\" /></body></html>";
    expect(extractUploadedUrl(html, { urlPath: "data.url" })).toBeUndefined();
  });

  it("只返回文件名时按模板拼完整地址（ptpimg 那类接口的形状）", () => {
    const body = JSON.stringify([{ code: "abc123.png", ext: "png" }]);
    expect(
      extractUploadedUrl(body, { urlPath: "[0].code", urlTemplate: "https://img.example.com/{value}" }),
    ).toBe("https://img.example.com/abc123.png");
  });

  it("模板拼出来的不是 http 地址就不认（防往简介里塞一段乱七八糟的字符串）", () => {
    const body = JSON.stringify({ code: "abc" });
    expect(extractUploadedUrl(body, { urlPath: "code", urlTemplate: "{value}" })).toBeUndefined();
  });
});

describe("replaceImageUrls", () => {
  const map = { "https://src.example.com/a.jpg": "https://img.example.com/a.jpg" };

  it("HTML 属性里的地址会被换掉", () => {
    expect(replaceImageUrls('<img src="https://src.example.com/a.jpg" />', map)).toBe(
      '<img src="https://img.example.com/a.jpg" />',
    );
  });

  it("BBCode 与裸链接同样换", () => {
    expect(replaceImageUrls("[img]https://src.example.com/a.jpg[/img]", map)).toBe(
      "[img]https://img.example.com/a.jpg[/img]",
    );
  });

  it("带查询串的地址在 HTML 里是 &amp; 形态，也要认出来", () => {
    const queryMap = { "https://src.example.com/a.jpg?x=1&y=2": "https://img.example.com/a.jpg" };
    expect(replaceImageUrls('<img src="https://src.example.com/a.jpg?x=1&amp;y=2">', queryMap)).toBe(
      '<img src="https://img.example.com/a.jpg">',
    );
  });

  it("没在映射里的图一个字节都不动（源站简介里的 BBCode 排版要原样保留）", () => {
    const html = '<b>标题</b>\n[img]https://other.example.com/z.png[/img]\n<img src="https://src.example.com/a.jpg">';
    const out = replaceImageUrls(html, map);
    expect(out).toContain("[img]https://other.example.com/z.png[/img]");
    expect(out).toContain("<b>标题</b>");
    expect(out).toContain("https://img.example.com/a.jpg");
  });

  it("空 map / 同址映射直接原样返回", () => {
    expect(replaceImageUrls("x", {})).toBe("x");
    expect(replaceImageUrls("https://a.b/c.png", { "https://a.b/c.png": "https://a.b/c.png" })).toBe(
      "https://a.b/c.png",
    );
  });

  it("列表替换按 map 换，没映射的保持原样", () => {
    expect(replaceUrlList(["https://src.example.com/a.jpg", "https://other/z.png"], map)).toEqual([
      "https://img.example.com/a.jpg",
      "https://other/z.png",
    ]);
  });
});
