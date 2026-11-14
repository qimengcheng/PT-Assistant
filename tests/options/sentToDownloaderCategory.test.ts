/**
 * 「发送到下载器」弹窗的分类取数 / 缺分类时自动弹出预填新建表单。
 *
 * vitest 是 node 环境（没有 DOM，弹窗渲染不出来），所以和 `moveTaskPathUi.test.ts` 同一份写法：
 *  - 纯判据直接 import `categoryMatch.ts`（判据本体住 src/，测试不抄第二份实现）；
 *  - 界面接线按源码文本钉：判据写对了、弹窗没接上，这类静默失效只有这一层抓得住。
 *
 * 去掉注释再断言：这个仓库已经两次栽在「注释里写的反例喂出假 PASS」上。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  autoCreateCategoryName,
  categoryFolderName,
  categoryFoldersFromTable,
  categorySavePathOf,
  joinCategoryPath,
  mergeCategoryFolders,
  newCategoryFolder,
} from "@/options/components/SentToDownloaderDialog/categoryMatch.ts";

const read = (rel: string) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 只留代码行：HTML 注释、块注释、整行 // 注释里的反例都不算数 */
function codeLines(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*/gm, "");
}

describe("下载器实时分类表 → 保存路径候选", () => {
  it("qBittorrent 报回来的分类表逐条转成 category: 前缀，空名跳过", () => {
    expect(
      categoryFoldersFromTable({
        电影: { savePath: "/volume1/电影" },
        剧集: { savePath: "" },
        "  ": { savePath: "/volume1/x" },
      }),
    ).toEqual(["category:电影", "category:剧集"]);
  });

  it("取不到分类表时是空数组，不是一条伪造的候选项", () => {
    expect(categoryFoldersFromTable(null)).toEqual([]);
    expect(categoryFoldersFromTable(undefined)).toEqual([]);
  });

  it("合并只追加没见过的：手工项原有顺序与模板原样保留", () => {
    expect(
      mergeCategoryFolders(
        ["/volume1/$torrent.title$", "category:电影"],
        ["category:电影", "category:综艺"],
      ),
    ).toEqual(["/volume1/$torrent.title$", "category:电影", "category:综艺"]);
  });

  it("同一串不会被写回两遍（去重是写回 suggestFolders 的前提）", () => {
    const live = categoryFoldersFromTable({ 电影: { savePath: "/volume1/电影" } });
    expect(mergeCategoryFolders(live, live)).toEqual(live);
  });
});

describe("选中分类目录时显示的下载路径", () => {
  const table = { 电影: { savePath: "/volume1/电影" }, 综艺: { savePath: "" } };

  it("有真实目录就返回原样，不带前缀的具体路径不表态", () => {
    expect(categorySavePathOf("category:电影", table)).toBe("/volume1/电影");
    expect(categoryFolderName("/volume1/电影")).toBeNull();
  });

  it("分类没设 savePath / 查不到 / 表没取到都返回 null —— 由界面说「默认目录下的分类文件夹」", () => {
    expect(categorySavePathOf("category:综艺", table)).toBeNull();
    expect(categorySavePathOf("category:动漫", table)).toBeNull();
    expect(categorySavePathOf("category:电影", null)).toBeNull();
  });

  it("空分类名不算命中，新建出来的串不带首尾空白", () => {
    expect(categoryFolderName("category:")).toBeNull();
    expect(categoryFolderName("category:  电影  ")).toBe("电影");
    expect(newCategoryFolder("  综艺  ")).toBe("category:综艺");
  });
});

describe("新建分类表单的默认目录：默认下载路径 + 分类名", () => {
  it("分隔符跟着默认路径走：Windows 反斜杠 / Linux 正斜杠各拼各的", () => {
    expect(joinCategoryPath("D:\\Downloads", "综艺")).toBe("D:\\Downloads\\综艺");
    expect(joinCategoryPath("/volume1/downloads", "电影")).toBe("/volume1/downloads/电影");
  });

  it("默认路径末尾已有的分隔符不重复拼", () => {
    expect(joinCategoryPath("/volume1/downloads/", "电影")).toBe("/volume1/downloads/电影");
    expect(joinCategoryPath("D:\\Downloads\\", "综艺")).toBe("D:\\Downloads\\综艺");
  });

  it("默认路径取不到就留空（界面走 autoTMM 兜底），不拼一条只有分类名的假路径", () => {
    expect(joinCategoryPath("", "电影")).toBe("");
    expect(joinCategoryPath(null, "电影")).toBe("");
    expect(joinCategoryPath(undefined, "电影")).toBe("");
  });

  it("分类名首尾空白去掉再拼", () => {
    expect(joinCategoryPath("/downloads", "  综艺  ")).toBe("/downloads/综艺");
  });
});

describe("弹窗接线：实时取数 → 写回配置 → 自动预选", () => {
  const code = codeLines(read("src/options/components/SentToDownloaderDialog/Index.vue"));

  it("分类表来自下载器消息，且每次打开都先清缓存再取", () => {
    expect(code).toContain('from "@/options/utils/categoryPaths.ts"');
    expect(code).toContain("invalidateCategoryTable(d.id)");
    expect(code).toContain("loadCategoryTable(d.id)");
  });

  it("拉到的分类写回这台下载器的 suggestFolders，写回后本地引用跟着更新", () => {
    expect(code).toContain("mergeCategoryFolders(current.suggestFolders ?? [], categoryFoldersFromTable(table))");
    expect(code).toContain("metadataStore.addDownloader({ ...current, suggestFolders: merged })");
    expect(code).toContain("selectedDownloader.value = metadataStore.downloaders[d.id] ?? selectedDownloader.value");
  });

  it("打开弹窗与换下载器都先拉数再预选，顺序不反", () => {
    expect(code).toContain("void refreshCategorySelection()");
    expect(code).toContain("await syncLiveCategories(downloader)");
    expect(code).toContain("applyAutoCategoryPath()");
    // 两处调用点：dialogEnter 的普通模式 + onDownloaderChange
    expect(code.match(/void refreshCategorySelection\(\)/g)?.length).toBe(2);
  });

  it("三档匹配读的是「手工候选 + 实时候选」的合并集，不是只有手工那份", () => {
    expect(code).toContain("mergeCategoryFolders(");
    expect(code).toContain("categoryFoldersFromTable(d?.id === selectedDownloader.value?.id ? liveCategoryTable.value : null)");
  });

  it("界面把选中分类的真实下载目录说出来（不是把 category: 假路径当目录）", () => {
    expect(code).toContain("categorySavePathOf(addTorrentOptions.value.savePath, liveCategoryTable.value)");
    expect(code).toContain('t("SentToDownloaderDialog.categoryPathOf"');
  });
});

describe("没有对应分类时该不该弹新建（用户 2026-11-14：如果本身没有就提示用户新建）", () => {
  it("分类表真的取到了、表里没这条 → 返回要建的名字", () => {
    expect(autoCreateCategoryName({}, "剧集")).toBe("剧集");
    expect(autoCreateCategoryName({ 电影: { savePath: "/volume1/电影" } }, "  综艺  ")).toBe("综艺");
  });

  it("表里已有同名就不重复建，首尾空白按同一个名字看", () => {
    expect(autoCreateCategoryName({ 剧集: { savePath: "" } }, "剧集")).toBeNull();
    expect(autoCreateCategoryName({ " 剧集 ": { savePath: "" } }, "剧集")).toBeNull();
  });

  it("分类没取到（接口失败 / 不支持）绝不拿「没取到」当「确实没有」", () => {
    expect(autoCreateCategoryName(null, "剧集")).toBeNull();
    expect(autoCreateCategoryName(undefined, "剧集")).toBeNull();
  });

  it("这批种子没报分类就没名字可建，大小写不同按两条分类算", () => {
    expect(autoCreateCategoryName({}, "")).toBeNull();
    expect(autoCreateCategoryName({}, "   ")).toBeNull();
    expect(autoCreateCategoryName({}, null)).toBeNull();
    expect(autoCreateCategoryName({ movie: { savePath: "" } }, "Movie")).toBe("Movie");
  });
});

describe("弹窗接线：缺分类时自动弹出预填新建表单（用户 2026-11-14：提示用户新建，目录预填默认路径/分类名）", () => {
  const code = codeLines(read("src/options/components/SentToDownloaderDialog/Index.vue"));

  it("判完三档、对齐分段按钮之后跑自动弹窗，打开弹窗 / 换下载器都走这一条", () => {
    expect(code).toContain("autoOpenCategoryDialogIfNeeded()");
    const refresh = code.slice(code.indexOf("async function refreshCategorySelection"));
    const pick = refresh.slice(0, refresh.indexOf("}"));
    expect(pick.indexOf("await syncLiveCategories(downloader)")).toBeLessThan(pick.indexOf("applyAutoCategoryPath()"));
    expect(pick.indexOf("applyAutoCategoryPath()")).toBeLessThan(pick.indexOf("autoOpenCategoryDialogIfNeeded()"));
  });

  it("自动弹窗复用 openCategoryDialog，不再静默调 createTorrentCategory 写下载器", () => {
    const auto = code.slice(code.indexOf("function autoOpenCategoryDialogIfNeeded"));
    const body = auto.slice(0, auto.indexOf("\n}"));
    expect(body).toContain("openCategoryDialog()");
    expect(body).toContain("autoCreateCategoryName(liveCategoryTable.value, decision.name)");
    expect(body).not.toContain('sendMessage("createTorrentCategory"');
  });

  it("闸口齐全：只在需要提示时、没被忽略、分类表真取到、同一台同一名只弹一次", () => {
    const auto = code.slice(code.indexOf("function autoOpenCategoryDialogIfNeeded"));
    const body = auto.slice(0, auto.indexOf("\n}"));
    expect(body).toContain("decision?.needPrompt");
    expect(body).toContain("dismissedPromptKey.value === decision.promptKey");
    expect(body).toContain("autoOpenedCategoryKeys.has(key)");
    expect(body).toContain("autoOpenedCategoryKeys.add(key)");
  });

  it("新建表单目录预填「默认下载路径/分类名」，默认路径来自下载器消息", () => {
    expect(code).toContain('sendMessage("getClientDefaultSavePath"');
    const open = code.slice(code.indexOf("function openCategoryDialog"));
    const body = open.slice(0, open.indexOf("showCategoryDialog.value = true"));
    expect(body).toContain("joinCategoryPath(defaultSavePath.value, name)");
  });

  it("自动弹出来的表单顶部说一句为什么弹（Alert 正文走 #message）", () => {
    expect(code).toContain("categoryDialogAutoOpened && newCategoryName");
    expect(code).toContain('t("SentToDownloaderDialog.categoryMissingNotice"');
  });

  it("自动流程卡住时界面上有状态说明，不再静默退回「默认路径 / 手动输入」", () => {
    expect(code).toContain("const categoryStatusText = computed(");
    expect(code).toContain('<span v-if="categoryStatusText" class="category-loading">');
    expect(code).toContain("categorySyncFailed.value = true");
    expect(code).toContain("categoryNoInfo.value = !name && torrentItems.length > 0");
  });
});

describe("弹窗接线：一键新建是真去下载器建分类", () => {
  const code = codeLines(read("src/options/components/SentToDownloaderDialog/Index.vue"));

  it("「增加分类」入口只在认 category: 前缀的下载器上出现", () => {
    expect(code).toContain("supportsCategoryFolders(selectedDownloader.value?.type)");
    expect(code).toContain("@click=\"openCategoryDialog\"");
  });

  it("提交时真调 createTorrentCategory，名字和目录都来自表单（目录可留空）", () => {
    expect(code).toContain('sendMessage("createTorrentCategory"');
    expect(code).toContain("name,");
    expect(code).toContain("savePath: newCategoryPath.value.trim()");
    expect(code).toContain("invalidateCategoryTable(current.id)");
  });

  it("建完写回候选、选中新分类，并失效缓存重取一次真路径", () => {
    expect(code).toContain("newCategoryFolder(name)");
    expect(code).toContain("await chooseCategoryFolder(folder)");
    expect(code).toContain("void syncLiveCategories()");
  });

  it("黄色提示里那颗「新建分类」不再只是把字符串填进路径", () => {
    expect(code).not.toContain("chooseCategoryFolder(newCategoryFolder(");
    expect(code.match(/@click="openCategoryDialog"/g)?.length).toBe(2);
  });

  it("新建表单里目录留空是允许的，且说明它意味着默认目录下的分类文件夹", () => {
    expect(code).toContain('v-model:value="newCategoryPath"');
    expect(code).toContain(":extra=\"t('SentToDownloaderDialog.categoryPathHint')\"");
    const zh = JSON.parse(read("src/locales/zh_CN.json")) as {
      SentToDownloaderDialog: { categoryPathHint: string };
    };
    expect(zh.SentToDownloaderDialog.categoryPathHint).toContain("留空");
  });

  it("两份 locale 的新增键齐全且对称", () => {
    const keys = [
      "addCategory",
      "addCategoryHint",
      "categoryCreated",
      "categoryDefaultFolder",
      "categoryFailed",
      "categoryFetchFailed",
      "categoryMissingNotice",
      "categoryName",
      "categoryNameRequired",
      "categoryNoInfo",
      "categoryPath",
      "categoryPathHint",
      "categoryPathOf",
      "categoryUnsupported",
      "loadingCategories",
    ];
    for (const file of ["zh_CN", "en"]) {
      const section = (
        JSON.parse(read(`src/locales/${file}.json`)) as {
          SentToDownloaderDialog: Record<string, string>;
        }
      ).SentToDownloaderDialog;
      for (const key of keys) expect(typeof section[key], `${file}.json 缺 ${key}`).toBe("string");
    }
  });
});

describe("弹窗接线：快速发送切回普通模式要补跑下载器初始化（用户 2026-11-14：快速模式打开后切普通，分类 UI 整个不出）", () => {
  const code = codeLines(read("src/options/components/SentToDownloaderDialog/Index.vue"));

  it("切换键走 toggleQuickSend，不再是裸翻转", () => {
    expect(code).toContain('@click="toggleQuickSend"');
    expect(code).not.toContain('@click="quickSendToClient = !quickSendToClient"');
  });

  it("切回普通模式且还没选下载器时补跑初始化", () => {
    const fn = code.slice(code.indexOf("function toggleQuickSend"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("quickSendToClient.value = !quickSendToClient.value");
    expect(body).toContain("!selectedDownloader.value");
    expect(body).toContain("initDownloaderSelection()");
  });

  it("普通模式打开与切换补跑共用同一份初始化，且含分类预选", () => {
    const fn = code.slice(code.indexOf("function initDownloaderSelection"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("selectedDownloader.value = remembered");
    expect(body).toContain("void refreshCategorySelection()");
    expect(code).toContain("if (!quickSendToClient.value) initDownloaderSelection()");
  });
});
