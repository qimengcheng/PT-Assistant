/**
 * 转载发布这条链的三段判据：种子清洗、控件折算、初值猜测。
 *
 * 它们都不需要 DOM，所以住 `environment: node`（见 vitest.config.ts）。
 * 判错的现场分别是：种子被换成另一颗（infoHash 变了）、界面上冒出 20 个没用的控件、
 * 种子被发到错误的板块 —— 都是「不抛错但结果错」，只能靠断言钉住。
 */
import { describe, expect, it } from "vitest";
import bencode from "bencode";

import { cleanTorrentBytes } from "@/shared/upload/cleanTorrent.ts";
import {
  composeDescription,
  extractExternalIds,
  extractImageUrlsFromText,
  extractMediaInfo,
  isDescriptionFieldName,
  isScreenshotUrl,
} from "@/shared/upload/description.ts";
import { describeUploadFields, type IRawUploadControl } from "@/shared/upload/formFields.ts";
import {
  buildInitialValues,
  findEmptyRequiredFields,
  matchCategoryOption,
} from "@/shared/upload/uploadMatch.ts";
import type { ISourceDescription, IUploadField } from "@/shared/upload/types.ts";

/** 造一颗最小可用的私有站种子；pieces 用二进制，专门用来抓「编码把二进制弄坏」 */
function makeTorrent(overrides: Record<string, unknown> = {}) {
  const pieces = new Uint8Array(20).map((_, i) => (i * 13 + 7) % 256);
  const torrent: Record<string, unknown> = {
    announce: "https://src.example.org/announce.php?passkey=SRCKEY",
    "announce-list": [["https://src.example.org/announce.php?passkey=SRCKEY"]],
    comment: "source site promo",
    "created by": "mktorrent 1.1",
    info: {
      name: "Some.Movie.2024.1080p.WEB-DL",
      "piece length": 1048576,
      pieces,
      length: 12345,
      source: "SRC",
    },
    ...overrides,
  };
  return { torrent, bytes: bencode.encode(torrent), pieces };
}

describe("cleanTorrentBytes", () => {
  it("删掉源站 tracker 与宣传字段，只留 info 与中性元数据", async () => {
    const { bytes } = makeTorrent();
    const result = await cleanTorrentBytes(bytes);

    const decoded = bencode.decode(result.bytes);
    expect(decoded.announce).toBeUndefined();
    expect(decoded["announce-list"]).toBeUndefined();
    expect(decoded.comment).toBeUndefined();
    // created by 是中性信息，有些站的审核脚本会读，不能顺手删
    expect(Buffer.from(decoded["created by"]).toString()).toBe("mktorrent 1.1");

    expect(result.removed).toEqual(expect.arrayContaining(["announce", "announce-list", "comment"]));
  });

  it("info 段逐字节不变，infoHash 与源种子一致", async () => {
    const { bytes, torrent } = makeTorrent();
    const sourceHash = await sha1Hex(bencode.encode(torrent.info));

    const result = await cleanTorrentBytes(bytes);
    const decoded = bencode.decode(result.bytes);

    expect(Buffer.from(bencode.encode(decoded.info)).equals(Buffer.from(bencode.encode(torrent.info)))).toBe(true);
    expect(result.infoHash).toBe(sourceHash);
  });

  it("pieces 的二进制不被破坏（decode 不能传 encoding）", async () => {
    const { bytes, pieces } = makeTorrent();
    const result = await cleanTorrentBytes(bytes);
    const decoded = bencode.decode(result.bytes);

    expect(Buffer.from(decoded.info.pieces).equals(Buffer.from(pieces))).toBe(true);
  });

  it("默认保留 info.source，显式关闭时才删掉并记账", async () => {
    const { bytes } = makeTorrent();

    const kept = await cleanTorrentBytes(bytes);
    expect(Buffer.from(bencode.decode(kept.bytes).info.source).toString()).toBe("SRC");

    const stripped = await cleanTorrentBytes(bytes, { keepSourceTag: false });
    expect(bencode.decode(stripped.bytes).info.source).toBeUndefined();
    expect(stripped.removed).toContain("info.source");
    // 清站标就等于换了一颗种子，infoHash 必须跟着变 —— 界面靠它告诉人「这次不是同一颗」
    expect(stripped.infoHash).not.toBe(kept.infoHash);
  });

  it("不是种子、或没有 info 段时抛错（不静默产出坏文件）", async () => {
    const notBencode = new Uint8Array([1, 2, 3, 4]);

    await expect(cleanTorrentBytes(notBencode)).rejects.toThrow();
    await expect(cleanTorrentBytes(bencode.encode({ announce: "https://x" }))).rejects.toThrow(/info/);
  });
});

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function control(partial: Partial<IRawUploadControl> & { name: string }): IRawUploadControl {
  return { tag: "input", type: "text", label: partial.name, required: false, ...partial };
}

describe("describeUploadFields", () => {
  it("忽略没有 name 的控件与按钮类 input", () => {
    const { fields } = describeUploadFields([
      control({ name: "", type: "text" }),
      control({ name: "submit", type: "submit" }),
      control({ name: "preview", type: "button" }),
      control({ name: "name", type: "text", label: "标题" }),
    ]);

    expect(fields.map((f) => f.name)).toEqual(["name"]);
  });

  it("同名 radio 合成一条字段，并认页面选中的那个默认值", () => {
    const { fields } = describeUploadFields([
      control({ name: "anon", type: "radio", value: "0", label: "否", checked: true }),
      control({ name: "anon", type: "radio", value: "1", label: "是" }),
    ]);

    expect(fields).toHaveLength(1);
    const field = fields[0];
    expect(field.kind).toBe("radio");
    expect(field.options).toEqual([
      { value: "0", label: "否" },
      { value: "1", label: "是" },
    ]);
    expect(field.initialValue).toBe("0");
  });

  it("同名的重复文本控件只留第一条（站点自己的隐藏副本不算第二份数据）", () => {
    const { fields } = describeUploadFields([
      control({ name: "name", type: "text", value: "第一条" }),
      control({ name: "name", type: "text", value: "第二条" }),
    ]);

    expect(fields).toHaveLength(1);
    expect(fields[0].initialValue).toBe("第一条");
  });

  it("select 的多选会进 warnings（P0 只提交第一个值）", () => {
    const { fields, warnings } = describeUploadFields([
      control({
        name: "tags",
        tag: "select",
        type: "select",
        multiple: true,
        options: [{ value: "a", label: "A" }],
      }),
    ]);

    expect(fields).toHaveLength(1);
    expect(warnings.join()).toContain("多选");
  });

  it("多个 file 控件只留第一个", () => {
    const { fields } = describeUploadFields([
      control({ name: "file", type: "file" }),
      control({ name: "file2", type: "file" }),
    ]);

    expect(fields.map((f) => f.name)).toEqual(["file"]);
    expect(fields[0].kind).toBe("file");
  });
});

describe("matchCategoryOption / buildInitialValues", () => {
  it("源站「电影」能匹配到目标站的 Movies", () => {
    const options = [
      { value: "401", label: "电影" },
      { value: "402", label: "电视剧" },
    ];

    expect(matchCategoryOption(options, "Movies")?.value).toBe("401");
  });

  it("折不出语义时不猜（返回 undefined，让用户手选）", () => {
    expect(matchCategoryOption([{ value: "1", label: "其他" }], "401")).toBeUndefined();
  });

  it("hidden 原样回传、标题带源值、分类用匹配值覆盖站点默认值", () => {
    const fields: IUploadField[] = [
      { name: "token", kind: "hidden", label: "token", required: false, initialValue: "abc" },
      { name: "name", kind: "text", label: "标题", required: true },
      { name: "teamname", kind: "text", label: "制作组", required: false },
      { name: "cat", kind: "select", label: "类型", required: true, options: [{ value: "401", label: "电影" }] },
    ];

    const values = buildInitialValues(fields, { title: "My.Title", category: "电影" });

    expect(values.token).toBe("abc");
    expect(values.name).toBe("My.Title");
    // teamname 不含 name 的整名匹配，不能被标题污染
    expect(values.teamname).toBe("");
    expect(values.cat).toBe("401");
  });

  it("必填预检只报真正空着的字段名", () => {
    const fields: IUploadField[] = [
      { name: "name", kind: "text", label: "标题", required: true },
      { name: "cat", kind: "select", label: "类型", required: true },
      { name: "descr", kind: "textarea", label: "简介", required: false },
    ];

    expect(findEmptyRequiredFields(fields, { name: "有值", cat: "" })).toEqual(["类型"]);
  });

  it("简介格只收 `descr` 这一族，`small_descr`（副标题）不能中招", () => {
    const fields: IUploadField[] = [
      { name: "name", kind: "text", label: "标题", required: true },
      { name: "small_descr", kind: "text", label: "副标题", required: false },
      { name: "descr", kind: "textarea", label: "简介", required: false },
    ];

    const values = buildInitialValues(fields, { title: "My.Title", description: "<b>简介正文</b>" });

    expect(values.small_descr).toBe("");
    expect(values.descr).toBe("<b>简介正文</b>");
  });

  it("没抓到简介时不吃掉目标站自己的默认模板", () => {
    const fields: IUploadField[] = [
      { name: "descr", kind: "textarea", label: "简介", required: false, initialValue: "站点模板：请填写..." },
    ];

    expect(buildInitialValues(fields, { description: "" }).descr).toBe("站点模板：请填写...");
  });
});

describe("isScreenshotUrl", () => {
  it("认得出截图", () => {
    expect(isScreenshotUrl("https://imgbox.com/abc/My.Movie.2024.1080p.jpg")).toBe(true);
    expect(isScreenshotUrl("https://src.example.org/attachments/2024/05/shot01.png")).toBe(true);
  });

  it("表情、图标、间距图一律不算（简介里满地都是）", () => {
    expect(isScreenshotUrl("https://src.example.org/pic/smilies/smile.gif")).toBe(false);
    expect(isScreenshotUrl("https://src.example.org/pic/logo.png")).toBe(false);
    expect(isScreenshotUrl("https://src.example.org/pic/spacer.gif")).toBe(false);
    expect(isScreenshotUrl("https://src.example.org/pic/btn_upload.gif")).toBe(false);
  });

  it("data: 内联图与空地址不交出去", () => {
    expect(isScreenshotUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isScreenshotUrl("   ")).toBe(false);
  });
});

const MEDIAINFO_SAMPLE = [
  "General",
  "Unique ID                                : 12345678901234567890",
  "Complete name                            : Some.Movie.2024.1080p.WEB-DL.mkv",
  "Format                                   : Matroska",
  "Format version                           : Version 4",
  "",
  "Video",
  "ID                                       : 1",
  "Format                                   : AVC",
  "Width                                    : 1920 pixels",
  "Height                                   : 1080 pixels",
].join("\n");

describe("extractMediaInfo", () => {
  it("从纯文本里把 mediainfo 整段抠出来", () => {
    const text = `这是简介正文。\n\n${MEDIAINFO_SAMPLE}\n\n截图见下。`;
    const found = extractMediaInfo(text);

    expect(found).toBeDefined();
    expect(found).toContain("Complete name");
    expect(found).toContain("Height                                   : 1080 pixels");
    // 正文不该被卷进来
    expect(found).not.toContain("这是简介正文");
  });

  it("普通带冒号的句子不当成 mediainfo（中文简介里满地都是）", () => {
    const text = "导演: 张艺谋\n主演: 某某某\n类型: 剧情\n地区: 中国大陆\n年份: 2024";
    expect(extractMediaInfo(text)).toBeUndefined();
  });

  it("只有对齐的行、没有分段标题时也不认（半截表格不如不填）", () => {
    const text = [
      "Format                                   : Matroska",
      "Width                                    : 1920 pixels",
      "Height                                   : 1080 pixels",
    ].join("\n");
    expect(extractMediaInfo(text)).toBeUndefined();
  });
});

describe("extractImageUrlsFromText", () => {
  it("BBCode 与裸链接都收", () => {
    const text =
      "看图：[img]https://imgbox.com/a/1.jpg[/img] 还有 https://imgbox.com/a/2.png 直接贴着";
    const urls = extractImageUrlsFromText(text);

    expect(urls).toEqual(["https://imgbox.com/a/1.jpg", "https://imgbox.com/a/2.png"]);
  });

  it("带参数的链接不被截断", () => {
    expect(extractImageUrlsFromText("https://x.com/a.jpg?w=1920&h=1080")).toEqual([
      "https://x.com/a.jpg?w=1920&h=1080",
    ]);
  });
});

describe("extractExternalIds", () => {
  it("IMDb 与豆瓣条目号", () => {
    const ids = extractExternalIds(
      '见 <a href="https://www.imdb.com/title/tt1234567/">IMDb</a> 与 https://movie.douban.com/subject/1292052/',
    );

    expect(ids.imdbId).toBe("tt1234567");
    expect(ids.doubanId).toBe("1292052");
  });

  it("没有就给不出（不猜）", () => {
    expect(extractExternalIds("没有任何外链的简介")).toEqual({});
  });
});

function makeDescription(overrides: Partial<ISourceDescription> = {}): ISourceDescription {
  return {
    descrHtml: "<p>源站简介正文</p>",
    screenshots: [],
    pageUrl: "https://src.example.org/details.php?id=1",
    warnings: [],
    ...overrides,
  };
}

describe("composeDescription", () => {
  it("正文 + 截图 + mediainfo 按这个顺序拼，图片走 <img>", () => {
    const out = composeDescription(
      makeDescription({
        screenshots: ["https://imgbox.com/a/1.jpg", "https://imgbox.com/a/2.jpg"],
        mediaInfo: MEDIAINFO_SAMPLE,
      }),
    );

    expect(out).toContain("<p>源站简介正文</p>");
    expect(out).toContain('<img src="https://imgbox.com/a/1.jpg"');
    expect(out).toContain("<pre>General");
    // 顺序：正文在截图前，截图在 mediainfo 前
    expect(out.indexOf("源站简介正文")).toBeLessThan(out.indexOf("1.jpg"));
    expect(out.indexOf("1.jpg")).toBeLessThan(out.indexOf("<pre>General"));
  });

  it("正文里已经有的截图与 mediainfo 不重复追加（重复会让帖子像机器发的）", () => {
    const out = composeDescription(
      makeDescription({
        descrHtml: '<p>正文</p><img src="https://imgbox.com/a/1.jpg" /><pre>General\nFormat : Matroska</pre>',
        screenshots: ["https://imgbox.com/a/1.jpg"],
        mediaInfo: "General\nFormat                                   : Matroska",
      }),
    );

    expect(out.match(/1\.jpg/g)).toHaveLength(1);
    expect(out.match(/General/g)).toHaveLength(1);
  });

  it("mediainfo 里的尖括号要转义，否则会把 <pre> 撑破", () => {
    const out = composeDescription(makeDescription({ mediaInfo: "Title                                    : a<b>c" }));
    expect(out).toContain("a&lt;b&gt;c");
  });

  it("空简介源也产出空串（不凭空造一句话占位）", () => {
    expect(composeDescription(makeDescription({ descrHtml: "" }))).toBe("");
  });
});

describe("isDescriptionFieldName", () => {
  it("整名匹配，副标题与相近字段不中招", () => {
    expect(isDescriptionFieldName("descr")).toBe(true);
    expect(isDescriptionFieldName("Description")).toBe(true);
    expect(isDescriptionFieldName("release_desc")).toBe(true);
    expect(isDescriptionFieldName("small_descr")).toBe(false);
    expect(isDescriptionFieldName("descr_url")).toBe(false);
  });
});
