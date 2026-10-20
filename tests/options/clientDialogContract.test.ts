/**
 * 「连接配置」那一族对话框（站点 / 备份服务器 / 下载器）的契约。
 *
 * 来由：`simplify-audit-2026-10-20.md` 提议把这一族抽成通用壳（它给的行号与同构度实测都对），
 * 但实测下来两侧的差异不是它说的那三处，而是八处结构性差异，抽壳要往壳里塞七八个旋钮 ——
 * 那正是同一份报告用来否决 `SetBase` 那几个 Window 的理由（「把可读性换成行数」）。
 * 所以这里**不抽壳**，改成把它指出的四处真漂移逐条钉住：
 * ① 备份那一屏整片借用下载器命名空间的文案（六把键）—— 归位成自己的键，句子仍是原话，
 *    界面一字未变（术语取向「下载服务器 vs 下载器」另说，见 `simplify-audit-review-2026-10-20.md` §7）；
 * ② Editor 上抛表单有效性的名字三家三种拼法，其中两家靠 Vue `emit()` 的 hyphenate 兜底才响；
 * ③ 两份 `siteCategoryMaps` 与两个 EditDialog 的「取不到就关窗 + 深拷贝」守卫各写一遍；
 * ④ 链接消息 `@:` 是防线③ 看不见的那一族（它只查字面 `t("a.b.c")`）。
 *
 * vitest 是 node 环境（没有 DOM、组件渲染不出来），所以模板侧的形状只能按源码文本断言
 * —— 与 `tests/options/levelPanelBox.test.ts`、`tests/shared/rebaseOldBase.test.ts` 同一做法。
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 只用得上这两族键，其余按 unknown 走（`any` 在我方代码里连 warning 都不许留，见 AGENTS §2.1 防线⑬） */
interface ILocale {
  SetDownloader: { add: Record<string, unknown> };
  SetBackup: { AddDialog: Record<string, unknown>; Editor: Record<string, unknown> };
}

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

const locale = (file: string) => JSON.parse(read(`src/locales/${file}.json`)) as ILocale;

/** 递归取某目录下指定后缀的文件（相对仓库根的路径），用来扫全仓而不是手挑几个文件 */
function walk(relDir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(`../../${relDir}`, import.meta.url), { withFileTypes: true })) {
    const child = `${relDir}${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(`${child}/`, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(child);
  }
  return out.sort();
}

/** 只留代码行：注释里写的反例不该被当成事实命中（这一族已经两次栽在「注释喂出假 PASS」上） */
function codeLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("借来的文案要归位", () => {
  it("SetBackup 那几份文件里不许再出现「SetDownloader.」这种跨命名空间取词", () => {
    for (const file of walk("src/options/views/Settings/SetBackup/", [".vue"])) {
      expect(codeLines(read(file)), `${file} 里还指着下载器的键`).not.toMatch(/["'(]SetDownloader\./);
    }
  });

  for (const [file, dl] of [
    ["zh_CN", "下载器"],
    ["en", "downloader"],
  ] as const) {
    it(`${file}：备份那一屏改用自己的键，且六把都在`, () => {
      const j = locale(file);
      // 借来的那两句归位之后，备份侧必须有自己的六把键；缺一把就画出键路径（防线③ 只查字面 t()）
      for (const key of ["noneSelectNotice", "newType"]) expect(typeof j.SetBackup.AddDialog[key]).toBe("string");
      for (const key of ["name", "nameTip", "uid", "uidPlaceholder"]) expect(typeof j.SetBackup.Editor[key]).toBe("string");
      // 术语取向（全站还有 29 处写「下载服务器」）不由这条判据替用户定：这里只保证键归位、句子仍是原话
      expect(String(j.SetBackup.Editor.name)).not.toContain(dl);
    });
  }

  it("SetDownloader.add 里只留代码真用到的那四把键（step.* 那两把死键不许长回来）", () => {
    const used = new Set<string>();
    for (const file of walk("src/", [".vue", ".ts"])) {
      for (const match of read(file).matchAll(/SetDownloader\.add\.([A-Za-z0-9_]+)/g)) used.add(match[1]);
    }
    expect([...used].sort()).toEqual(["NoneSelectNotice", "newType", "selectPlaceholder", "title"]);
    expect(Object.keys(locale("zh_CN").SetDownloader.add).sort()).toEqual([...used].sort());
    expect(locale("en").SetDownloader.add.step).toBeUndefined();
  });
});

describe("Editor 上抛表单有效性只有一个名字", () => {
  /**
   * 声明侧写 `(e: "update:form-valid", …)`，模板侧听 `@update:form-valid`，两侧必须逐字相同。
   * 两条实测来的口径，都是反证撞出来的：
   * ① 名字那一段必须允许连字符**和下划线**：`[a-z]*[Vv]alid` 对 `form-valid` 从头就匹配不上
   *    （`-` 不在 `[a-z]` 里），于是「一个都没扫到」看着像「没有分叉」，其实是量具哑了；
   * ② 引号两种都得认 —— 只认双引号时漏掉了 `emits('update:configValid', …)` 那一处
   *    （写在模板的事件处理里，全篇单引号），它是靠防线 ⑬ 的 `vue/require-explicit-emits`
   *    才顶出来的，这条判据当时报的是「声明侧只有一种拼法」；
   * ③ 名字用**命名捕获组**读（`match.groups.name`），不读 `match[1]`：引号那组 `(?<q>…)` 自己
   *    也占一个序号，命名组不会把它移出编号表，`match[1]` 拿到的是引号 —— 症状是
   *    「声明侧只拼出 `"` 与 `'` 两种」，看着像判据抓住了分叉。
   */
  const NAME = "(?<name>[A-Za-z_-]*[Vv]alid[A-Za-z_-]*)";
  const collect = (pattern: RegExp) => {
    const found = new Map<string, string[]>();
    for (const file of walk("src/", [".vue"])) {
      for (const match of codeLines(read(file)).matchAll(pattern)) {
        const name = match.groups!.name;
        found.set(name, [...(found.get(name) ?? []), file]);
      }
    }
    return found;
  };
  const declared = collect(new RegExp(`(?<q>["'])update:${NAME}\\k<q>`, "g"));
  const listened = collect(new RegExp(`@update:${NAME}`, "g"));
  /** 一个文件里声明与上抛各出现一次，所以「几个 Editor」要按去重后的文件数判，不能按出现次数 */
  const filesOf = (map: Map<string, string[]>) => [...new Set(map.get("form-valid") ?? [])].sort();

  it("声明侧只有 form-valid 这一种拼法，且正是那三个 Editor", () => {
    expect([...declared.keys()]).toEqual(["form-valid"]);
    expect(filesOf(declared)).toEqual([
      "src/options/views/Settings/SetBackup/Editor.vue",
      "src/options/views/Settings/SetDownloader/Editor.vue",
      "src/options/views/Settings/SetSite/Editor.vue",
    ]);
  });

  it("监听侧也只有 form-valid 这一种拼法，且六个调用点一个都不能少", () => {
    expect([...listened.keys()]).toEqual(["form-valid"]);
    expect(new Set(listened.get("form-valid")).size).toBe(6);
  });

  it("每个上抛有效性的 Editor 都在自己那一目录里有人听（发着没人听 = 静默失效）", () => {
    const editors = filesOf(declared);
    expect(editors).toHaveLength(3);
    const listeners = new Set(listened.get("form-valid") ?? []);
    for (const editor of editors) {
      const dir = editor.replace(/Editor\.vue$/, "");
      expect([...listeners].some((file) => file.startsWith(dir)), `${dir} 里没人听 Editor 上抛的有效性`).toBe(true);
    }
  });
});

describe("那条「取不到就关窗、必须深拷贝」的守卫不许只有一侧有", () => {
  for (const file of [
    "src/options/views/Settings/SetBackup/EditDialog.vue",
    "src/options/views/Settings/SetDownloader/EditDialog.vue",
  ]) {
    it(`${file.slice(file.lastIndexOf("/") + 1, -".vue".length)}（${file.split("/").at(-2)}）：dialogEnter 里两半都要在`, () => {
      const body = /function dialogEnter\(\)[\s\S]*?\n\}/.exec(read(file));
      expect(body, `${file} 找不到 dialogEnter 本体`).toBeTruthy();
      // 脏 id（配置已被删）时不关窗 = 挂一个空 Editor，点确定落库一条空记录
      expect(body![0]).toContain("if (!stored)");
      expect(body![0]).toContain("showDialog.value = false;");
      // 浅拷贝 = 用户改一个嵌套字段再点「取消」，store 里那条已经被改走了
      expect(body![0]).toContain("cloneDeep(stored)");
    });
  }
});

describe("两份 siteCategoryMaps 必须逐字相同", () => {
  /**
   * 抽成共用单元要动的正是辅种那两个最常被改的文件，收益 8 行；
   * 所以这里钉「不许分叉」而不是「必须一份」：谁改了其中一处而另一处没跟上就红。
   */
  const block = (file: string) => /const siteCategoryMaps = computed\(\(\) => \{[\s\S]*?\n\}\);/.exec(read(file))?.[0];

  it("两处都找得到这一块，且一字不差", () => {
    const dialog = block("src/options/views/Overview/SearchEntity/KeepUploadDialog.vue");
    const task = block("src/options/views/Overview/KeepUploadTask/Index.vue");
    expect(dialog, "辅种检测弹窗里那一块不见了").toBeTruthy();
    expect(task, "辅种任务页里那一块不见了").toBeTruthy();
    expect(dialog).toBe(task);
  });
});

describe("链接消息「@:」必须解析得到（防线③ 只看字面 t()，看不见这种）", () => {
  const dig = (node: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>(
      (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
      node,
    );

  for (const file of ["zh_CN", "en"]) {
    it(`${file}.json 里每一处 @: 都指得到一个字符串`, () => {
      const raw = JSON.parse(read(`src/locales/${file}.json`)) as Record<string, unknown>;
      const broken: string[] = [];
      let total = 0;
      const visit = (node: Record<string, unknown>, path: string) => {
        for (const [key, value] of Object.entries(node)) {
          const at = path ? `${path}.${key}` : key;
          if (typeof value === "string") {
            for (const match of value.matchAll(/@:([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g)) {
              total += 1;
              if (typeof dig(raw, match[1]) !== "string") broken.push(`${at} -> @:${match[1]}`);
            }
          } else if (value && typeof value === "object") {
            visit(value as Record<string, unknown>, at);
          }
        }
      };
      visit(raw, "");
      // 总数也要判：一条链接都没有时上面那段同样"零失败"，那是空转不是通过
      expect(total, `${file}.json 里一处链接消息都没有，这条判据在空转`).toBeGreaterThan(30);
      expect(broken).toEqual([]);
    });
  }
});
