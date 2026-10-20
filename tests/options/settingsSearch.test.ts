/**
 * 「设置 → 搜索设置项」的判据。
 *
 * 两半分开钉：纯函数那半（什么算命中、怎么排、怎么切高亮）直接 import 真源码跑；
 * DOM 那一半（选择器、动画收尾方式、搜索框档位）vitest 是 node 环境、组件渲染不出来，
 * 只能按源码文本断言 —— 与 `levelPanelBox.test.ts`、`clientDialogContract.test.ts` 同一做法。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  HINT_SELECTOR,
  LABEL_SELECTOR,
  ROW_SELECTOR,
  queryTokens,
  rankOf,
  readSettingRows,
  searchSettingRows,
  splitHighlight,
  type ISettingRow,
} from "@/options/views/Settings/SetBase/settingsSearch.ts";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

const SRC = "src/options/views/Settings/SetBase/settingsSearch.ts";
const PAGE = "src/options/views/Settings/SetBase/Index.vue";

/** 造一行。`sectionOrder`/`domOrder` 给默认值，断言里只点名承重的那个 */
const row = (over: Partial<ISettingRow> & { label: string }): ISettingRow => ({
  hint: undefined,
  sectionKey: "search",
  kind: "item",
  sectionOrder: 0,
  domOrder: 0,
  ...over,
});

describe("什么算命中", () => {
  it("名称开头 0 / 名称含 1 / 只在说明里 2", () => {
    expect(rankOf(row({ label: "自动刷新用户信息" }), ["自动"])).toBe(0);
    expect(rankOf(row({ label: "搜索时自动加载首屏" }), ["自动"])).toBe(1);
    expect(rankOf(row({ label: "刷新间隔", hint: "单位：小时" }), ["小时"])).toBe(2);
    expect(rankOf(row({ label: "刷新间隔", hint: "单位：小时" }), ["分钟"])).toBeNull();
  });

  it("多词是 AND，不要求连成一片", () => {
    const r = row({ label: "自动刷新用户信息" });
    expect(rankOf(r, ["自动", "刷新"])).toBe(0);
    expect(rankOf(r, ["自动", "不存在"])).toBeNull();
    // 一个词在名称、另一个只在说明：仍然命中，但掉到 2（它不是「名称含全部词」）
    expect(rankOf(row({ label: "间隔刷新", hint: "每小时一次" }), ["刷新", "小时"])).toBe(2);
  });

  it("大小写与首尾空白不参与判据（英文界面要点两下才对上）", () => {
    expect(queryTokens("  Auto   Refresh ")).toEqual(["auto", "refresh"]);
    // 大小写是在 queryTokens 那一层收的，所以这条要从 searchSettingRows 走一遍才算数
    const rows = [row({ label: "auto 大小写无所谓" }), row({ label: "Auto refresh user info" })];
    expect(searchSettingRows(rows, "AUTO").map((h) => [h.label, h.rank])).toEqual([
      ["auto 大小写无所谓", 0],
      ["Auto refresh user info", 0],
    ]);
    expect(searchSettingRows(rows, "  auto   REFRESH ").map((h) => h.label)).toEqual(["Auto refresh user info"]);
  });
});

describe("命中了怎么排", () => {
  /**
   * ⚠️ 夹具必须是「排完才会变序」的形状：给一份已经排好的输入，`rows.sort()` 这种
   * 就地改传进来那一份的坏法完全测不出来（v0.114.3 那条反证就是这么第一次全绿的）。
   */
  const rows = [
    row({ label: "丙自动项", sectionKey: "advanced", sectionOrder: 7, domOrder: 0 }),
    row({ label: "乙自动项", sectionKey: "download", sectionOrder: 1, domOrder: 3 }),
    row({ label: "自动", sectionKey: "search", kind: "section", sectionOrder: 0, domOrder: -1 }),
    // 名称里「不含」这两个字、只有说明含 —— 这一条才是 rank 2
    row({ label: "甲只看说明", hint: "自动", sectionKey: "search", sectionOrder: 0, domOrder: 2 }),
  ];
  const snapshot = JSON.stringify(rows);

  it("档位优先，同档按页面先后，再同按 DOM 先后", () => {
    const hits = searchSettingRows(rows, "自动");
    expect(hits.map((h) => [h.label, h.rank])).toEqual([
      ["自动", 0],
      ["乙自动项", 1],
      ["丙自动项", 1],
      ["甲只看说明", 2],
    ]);
  });

  it("不许就地排传进来那一份", () => {
    searchSettingRows(rows, "自动");
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("空查询返回空表，而不是「全都命中」", () => {
    expect(searchSettingRows(rows, "")).toEqual([]);
    expect(searchSettingRows(rows, "   ")).toEqual([]);
  });
});

describe("节标题也是一条结果", () => {
  it("搜节名能命中节自己，且排在同节同档的格子之前", () => {
    const rows = [
      row({ label: "账号刷新间隔", sectionKey: "account", sectionOrder: 3, domOrder: 0 }),
      row({ label: "账号与流量", sectionKey: "account", kind: "section", sectionOrder: 3, domOrder: -1 }),
    ];
    const hits = searchSettingRows(rows, "账号");
    expect(hits.map((h) => h.kind)).toEqual(["section", "item"]);
  });
});

describe("命中片段怎么切给界面", () => {
  const join = (segs: ReturnType<typeof splitHighlight>) => segs.map((s) => s.text).join("");

  it("拼回去必须等于原文（任何一档都不许吞字）", () => {
    for (const [text, query] of [
      ["自动刷新用户信息", "自动"],
      ["Auto refresh", "auto"],
      ["启用快速推送后自动开始", "自动 快速"],
      [" nothing here", "查不到"],
      ["", "自动"],
    ] as const) {
      expect(join(splitHighlight(text, query))).toBe(text);
    }
  });

  it("命中的那一段标 hit，其余标 plain", () => {
    expect(splitHighlight("自动刷新用户信息", "刷新")).toEqual([
      { text: "自动", hit: false },
      { text: "刷新", hit: true },
      { text: "用户信息", hit: false },
    ]);
  });

  it("两个词撞在同一处时只切一段，不出现两块同色", () => {
    expect(splitHighlight("自动刷新", "自动 刷新")).toEqual([{ text: "自动刷新", hit: true }]);
    // 相交但不重合：「自动刷」与「刷新」
    expect(splitHighlight("自动刷新", "自动刷 刷新")).toEqual([{ text: "自动刷新", hit: true }]);
  });

  it("不命中时整段是一个 plain（不是空表，标题照样要显示）", () => {
    expect(splitHighlight("队列并发数", "烟花")).toEqual([{ text: "队列并发数", hit: false }]);
  });
});

describe("DOM 那一侧读的是实测过的形状", () => {
  const src = read(SRC);

  it("三类行容器一个都不能少（开关格 / 表单项 / 分组标题）", () => {
    for (const one of [".switch-item", ".ant-form-item", ".group-title"]) {
      expect(ROW_SELECTOR, `ROW_SELECTOR 里没有 ${one}`).toContain(one);
    }
  });

  it("标签与说明的子选择器钉住 antd 的真实类名", () => {
    // `.ant-form-item-extra` 来自 dist/form/FormItemInput.js 的 `${baseClassName}-extra`
    expect(HINT_SELECTOR).toBe(".ant-form-item-extra");
    expect(LABEL_SELECTOR).toContain(".ant-form-item-label label");
    expect(LABEL_SELECTOR).toContain(".label");
  });

  it("只认叶子那一层，表单项套表单项不会数两次", () => {
    expect(src).toMatch(/if \(el\.querySelector\(ROW_SELECTOR\)\) return;/);
  });

  it("读来的文字要压掉折行与连续空白，且三处读取都过它", () => {
    // ⚠️ 断言要钉在 clean 本体上：`queryTokens` 里也有同一串 `.replace(/\\s+/g, " ")`，
    // 只对整个文件 match 一次的话，把 clean 改坏照样全绿（反证第一次就是这么漏的）。
    const cleanBody = /function clean\(text[\s\S]*?\n\}/.exec(src);
    expect(cleanBody, "找不到 clean 本体").toBeTruthy();
    expect(cleanBody![0]).toMatch(/\.replace\(\/\\s\+\/g, " "\)/);
    expect(src).toMatch(/const title = clean\(/);
    expect(src).toMatch(/const label = clean\(/);
    expect(src).toMatch(/const hint = clean\(/);
  });

  it("整份索引每行都带 kind，节自己那一条是真的 push 出来的", () => {
    expect(src).toContain('kind: "item"');
    // 写成正则而不是两个 toContain：`if (false) out.push({… kind: "section" …})` 那种
    // 「字符串还在、动作已经关掉」的改法，靠字符串比对是测不出来的
    expect(src).toMatch(/if \(title\) out\.push\(\{[^}]*kind: "section"[^}]*domOrder: -1/);
  });

  it("空词表在 rankOf 这一层就判不命中（它与 searchSettingRows 的早退是两道各挡一路的闸）", () => {
    expect(rankOf(row({ label: "任何一条" }), [])).toBeNull();
  });

  // 反「空转」：上面四条都是字符串比对，这条确认那个函数真的能被调用到（签名没被我改歪）
  it("readSettingRows 存在且吃 (box, sectionOrder) 两个参数", () => {
    expect(typeof readSettingRows).toBe("function");
    expect(readSettingRows.length).toBe(2);
  });
});

describe("页面那一侧的形状", () => {
  const page = read(PAGE);
  /** 搜索框那一段模板：从 a-input 到它自己闭合 */
  const inputBlock = /<a-input\n[\s\S]*?<\/a-input>/.exec(page)?.[0] ?? "";

  it("搜索框不降档：这一列窄屏那档要跟目录按钮横排，降档就是 24 挨着 32", () => {
    expect(inputBlock, "找不到搜索框那一整块").toBeTruthy();
    expect(inputBlock).not.toContain('size="small"');
  });

  it("索引是现扫的，不在挂载时建一份留着", () => {
    expect(page).toContain("searchSettingRows(readSettingRows(");
    // 挂载钩子里不许出现「建索引」那一步（渲染一变就过期）
    expect(/onMounted\(\(\) => \{[\s\S]*?\n\}\)/.exec(page)?.[0]).not.toMatch(/readSettingRows/);
  });

  /**
   * 「现扫」这句话的另一半，缺了它就是假话：computed 只跟着**响应式数据**重算，
   * 而 readSettingRows 吃的是 DOM —— 拨一下上一级开关，那一组格子进/出 DOM，
   * 结果列表却不会自己重算（台架实测：不重新输入就一直停在 0 条）。
   * 所以必须由这一页本来就挂着的配置订阅踢一次，三条都要钉住，少一条都不成立：
   * ① searchHits 真把那份版本号读进去当依赖；② 踢在类型过滤之前（跨上下文同步也改渲染）；
   * ③ 踢在 nextTick 之后（同一次 flush 里子窗口还没画完，重扫读到的还是旧 DOM）。
   */
  it("渲染一变，结果列表要由配置订阅踢一次重扫", () => {
    const hits = /const searchHits = computed[\s\S]*?\n\}\);/.exec(page);
    expect(hits, "找不到 searchHits").toBeTruthy();
    expect(hits![0]).toContain("void rowsVersion.value;");

    const sub = /stopConfigWatch = configStore\.\$subscribe\(\s*\(mutation\)[\s\S]*?\n {2}\);/.exec(page);
    expect(sub, "找不到那条订阅").toBeTruthy();
    const bump = sub![0].indexOf("rowsVersion.value++");
    const filter = sub![0].indexOf("MutationType.direct");
    // 先各自确认锚点在（indexOf 找不到是 -1，-1 排在任何位置前面，会让「先后」这条判据反过来通过）
    expect(bump, "订阅里没有那次重扫的踢动").toBeGreaterThan(-1);
    expect(filter, "订阅里没有类型过滤").toBeGreaterThan(-1);
    expect(bump).toBeLessThan(filter);
    expect(sub![0]).toMatch(/nextTick\(\(\) => rowsVersion\.value\+\+\)/);
  });

  it("换点另一条时把上一条的高亮 class 一起摘掉", () => {
    const flash = /function flashRow\(el: HTMLElement\)[\s\S]*?\n\}/.exec(page);
    expect(flash, "找不到 flashRow").toBeTruthy();
    expect(flash![0]).toMatch(/querySelectorAll<HTMLElement>\("\.set-search-flash"\)[\s\S]*classList\.remove/);
  });

  it("回车跳第一条、Esc 清空，两支都在", () => {
    const handler = /function onSearchKeydown\(e: KeyboardEvent\)[\s\S]*?\n\}/.exec(page);
    expect(handler, "找不到 onSearchKeydown").toBeTruthy();
    expect(handler![0]).toContain('"Escape"');
    expect(handler![0]).toContain('"Enter"');
  });

  it("高亮收尾不挂在动画事件上（那个事件有几种情况下不会来）", () => {
    const flash = /function flashRow\(el: HTMLElement\)[\s\S]*?\n\}/.exec(page);
    expect(flash, "找不到 flashRow").toBeTruthy();
    expect(flash![0]).not.toMatch(/animationend|addEventListener/);
    // 重头播靠一次强制布局重算，少了它连点同一条不会闪第二次
    expect(flash![0]).toContain("void el.offsetWidth");
  });

  it("动画是一次性的且不写 fill-mode，摘不掉 class 也不会留末态", () => {
    expect(page).toMatch(/animation: set-search-flash 900ms ease-out 1;/);
    expect(page).not.toMatch(/animation.*forwards/);
  });

  it("点结果要先确认那颗元素还在（列出来之后 DOM 又变了那一档）", () => {
    const jump = /function jumpToHit\(hit[^\n]*\{[\s\S]*?\n\}/.exec(page);
    expect(jump, "找不到 jumpToHit").toBeTruthy();
    expect(jump![0]).toContain("hit.el.isConnected");
    // 早退必须写全：掉了它就会在没跳成的那条上继续排后面的定时器
    expect(jump![0]).toMatch(/return;/);
  });
});

describe("文案两侧齐全，且带占位符的那把在调用点传了参", () => {
  const keys = ["searchPlaceholder", "searchCount", "searchEmpty", "searchEmptyHint"];
  const page = read(PAGE);
  const indexKeys = Object.fromEntries(
    ["zh_CN", "en"].map((file) => {
      const j = JSON.parse(read(`src/locales/${file}.json`)) as { SetBase: { Index: Record<string, string> } };
      return [file, j.SetBase.Index];
    }),
  ) as Record<string, Record<string, string>>;

  for (const file of ["zh_CN", "en"]) {
    it(`${file}：四把键都在且非空`, () => {
      for (const key of keys) expect(indexKeys[file][key], `${key} 缺失`).toBeTruthy();
      expect(indexKeys[file].searchCount).toContain("{count}");
    });
  }

  it("searchCount 那个 {count} 真的传了参（少了会画成「命中  项」）", () => {
    expect(page).toMatch(/t\("SetBase\.Index\.searchCount", \{ count: searchHits\.length \}\)/);
    // 其余三把都是无参调用：键里不许有占位符
    for (const key of keys.filter((k) => k !== "searchCount")) {
      for (const file of ["zh_CN", "en"]) {
        expect(indexKeys[file][key], `${file} ${key}`).not.toMatch(/\{[A-Za-z]/);
      }
    }
  });
});
