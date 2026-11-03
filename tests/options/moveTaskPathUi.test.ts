/**
 * 「移到哪个目录」这一族在界面上有没有真被接起来。
 *
 * 为什么单独一份：本仓在这条上付过学费的形状是**判据写对了、全绿、界面上没接上**
 * （v0.128.0 / v0.117.0 那两条反证教训）。把 `verdict.needRelocate` 那一行删掉，
 * 纯判据那二十几条一个字都不红 —— 只有按源码文本钉住模板与调用点才分得开这两种坏法。
 *
 * ⚠️ 所有「比先后」的断言都先 `toBeGreaterThan(-1)`：`indexOf` 在锚点整个不存在时返回 -1，
 * 而 `-1` 小于场上任何位置 —— 那会让「那一整段被人删了」恰好成为判据的**通过**形状。
 *
 * 读源码文本前先归一化换行符：本仓工作区的换行不是常量（`core.autocrlf`，见 v0.122.x 那条）。
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const page = read("src/options/views/Overview/KeepUploadTask/Index.vue");
const dialog = read("src/options/views/Overview/KeepUploadTask/MoveTaskPathDialog.vue");
const mover = read("src/options/utils/reseedMove.ts");

type LocaleSlice = { KeepUploadTask: Record<string, Record<string, string>> & { editSavePath: string } };
const zh = JSON.parse(read("src/locales/zh_CN.json")) as LocaleSlice;
const en = JSON.parse(read("src/locales/en.json")) as LocaleSlice;
const movePath = () => zh.KeepUploadTask.movePath;

/** 「保存路径」那一格里画那颗键的那一段（从它的 `<div class="path-line">` 到 typography 收尾之后） */
function pathLineBranch() {
  const from = page.indexOf('<div class="path-line">');
  const to = page.indexOf("<!-- 基准不在任务里的那种任务", from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return page.slice(from, to);
}

/** 新入口那个函数的函数体（从签名到它自己那一行顶格的 `}`） */
function chosenBody() {
  const from = page.indexOf("async function moveTaskToChosenPath");
  expect(from).toBeGreaterThan(-1);
  return page.slice(from, page.indexOf("\n}\n", from) + 3);
}

/** 既有那颗「把本地文件移到任务目录」的函数体 */
function legacyBody() {
  const from = page.indexOf("async function moveLocalBaseToTaskPath");
  expect(from).toBeGreaterThan(-1);
  return page.slice(from, page.indexOf("/** 搬运请求本身出错", from));
}

describe("那颗键画在哪、怎么画", () => {
  it("与那个 typography 并排，不在它的默认插槽里", () => {
    // `:ellipsis` 会把子节点折成纯文本，元素整个丢掉（AGENTS §3.4），表现是文字照常显示而键点不动。
    const cell = pathLineBranch();
    const buttonStart = cell.indexOf("<a-button");
    expect(buttonStart).toBeGreaterThan(-1);
    // 抓真的那对标签（上面那段注释里刻意不写这个标签名，否则正则会被注释里的字面串喂出一条假通过）
    const seg = /<a-typography-text[\s\S]*?>([\s\S]*?)<\/a-typography-text>/.exec(cell);
    expect(seg).not.toBeNull();
    expect(seg![1]).not.toContain("<a-button");
    expect(cell.indexOf("</a-typography-text>")).toBeLessThan(buttonStart);
  });

  it("没有做成整格 @click（那一格下面还挂着两颗 link 键，会抢同一次点击）", () => {
    expect(pathLineBranch()).not.toMatch(/<div[^>]*@click/);
  });

  it("它借的那个键名两侧都在 —— 那是 v0.2.0 平移带进来后一直零引用的死键，这一版接上", () => {
    expect(typeof zh.KeepUploadTask.editSavePath).toBe("string");
    expect(typeof en.KeepUploadTask.editSavePath).toBe("string");
    expect(zh.KeepUploadTask.editSavePath).not.toBe(en.KeepUploadTask.editSavePath);
    expect(page).toContain("t('KeepUploadTask.editSavePath')");
  });

  it("点下去有反馈：那一趟现查目录要转圈，且用的是 loading 而不是 disabled", () => {
    // disabled 的元素收不到鼠标事件，「为什么点不动」就只存在于浮层里（v0.109.1 那条）
    expect(pathLineBranch()).toContain('size="small"');
    expect(pathLineBranch()).toContain(":loading=\"probingPath === record.task.id\"");
    expect(pathLineBranch()).not.toContain(":disabled");
    expect(pathLineBranch()).toContain("@click=\"openMovePathDialog(record.task)\"");
  });
});

describe("开门那三档各有各的一句话", () => {
  it("「没记 hash / 已经不在下载器 / 连不上」三句分开，不许并档", () => {
    // 后两句并成一句就是把一次网络故障报成用户把种子删了（本仓在这条上反复记过）
    const at = (key: string) => {
      const i = page.indexOf(`t("KeepUploadTask.movePath.${key}")`);
      expect(i, key).toBeGreaterThan(-1);
      return i;
    };
    const noHash = at("noHash");
    const unreachable = at("unreachable");
    const notFound = at("notFound");
    // 判 hash 在前（不用取网络），取数失败与「列表里没这条」在后
    expect(noHash).toBeLessThan(unreachable);
    expect(notFound).toBeGreaterThan(noHash);
    for (const key of ["noHash", "notFound", "unreachable"]) {
      expect(movePath()[key], key).toBeTruthy();
      expect(en.KeepUploadTask.movePath[key], key).toBeTruthy();
      // 这三句是 `t("…")` 不带参调用，文案里有占位符就会被插成空串
      expect(movePath()[key], key).not.toMatch(/\{[a-zA-Z]/);
    }
  });

  it("拿到目录才开弹窗，取不到就停在门外（不开一个「现在在：?」的空壳）", () => {
    const opener = page.slice(page.indexOf("async function openMovePathDialog"));
    const shown = opener.indexOf("moveDialog.value = true");
    expect(shown).toBeGreaterThan(-1);
    expect(opener.indexOf('moveCurrentPath.value = live.path')).toBeLessThan(shown);
    expect(opener.indexOf('if ("block" in live)')).toBeLessThan(shown);
  });
});

describe("弹窗只收串，判断与副作用都在页面", () => {
  it("挂上了，三个入参都递到，confirm 接到那个搬运函数", () => {
    const mount = page.slice(page.indexOf("<MoveTaskPathDialog"), page.indexOf("/>", page.indexOf("<MoveTaskPathDialog")));
    for (const prop of [":downloader-id", ":current-path", ":task-path", "@confirm=\"moveTaskToChosenPath\""]) {
      expect(mount, prop).toContain(prop);
    }
    expect(page).toContain('v-model="moveDialog"');
  });

  it("弹窗里跑的是同一份 judgeMoveTarget，没有自己再写一套字符串校验", () => {
    expect(dialog).toContain("judgeMoveTarget({ raw: target.value, currentPath: props.currentPath })");
    expect(dialog).not.toContain("PATH_PLACEHOLDER");
    expect(dialog).not.toMatch(/if\s*\(!target\.value\.trim\(\)\)/);
  });

  it("三档拒绝就地显示，且用的键两侧都在、都不带占位符", () => {
    expect(dialog).toContain("t(`KeepUploadTask.movePath.${rejected}`)");
    for (const key of ["empty", "category", "placeholder"]) {
      expect(movePath()[key], key).toBeTruthy();
      expect(en.KeepUploadTask.movePath[key], key).toBeTruthy();
      expect(movePath()[key], key).not.toMatch(/\{[a-zA-Z]/);
    }
  });

  it("候选目录把 `category:` 那种写法筛掉 —— 这一格要发的是 setLocation，它只认目录", () => {
    expect(dialog).toContain(".filter((x) => !isCategorySavePath(x))");
  });
});

describe("搬运那两档写回的形状", () => {
  it("这台没能力搬时一个字都不写回（改了记录就等于把一致的任务改成不一致，发送闸当场按住）", () => {
    const body = chosenBody();
    const bail = body.indexOf('if (outcome.kind === "unsupported") {');
    const write = body.indexOf("task.downloadOptions.savePath = verdict.path");
    expect(bail).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(bail);
    // 只比位置不够：把那道 if 改成 `if (false)` 之后位置一字没动，而早退整个没生效 ——
    // 这正是 v0.120.x 记过的那一型（「比先后」的写法对『整段不进入』单向漏判）。要捕获体自己含 return。
    const seg = /if \(outcome\.kind === "unsupported"\) \{([\s\S]{0,200}?)\n {6}\}/.exec(body);
    expect(seg).not.toBeNull();
    expect(seg![1]).toContain("return;");
  });

  it("数据本来就在目标目录时不置 moveToTaskPath —— 那一位说的是「正在搬」，没搬就不能说", () => {
    const body = chosenBody();
    expect(body).toContain("const willWatch = verdict.needRelocate && !!task.baseLocal;");
    expect(body).toContain("if (willWatch) task.baseLocal!.moveToTaskPath = true;");
    expect(body).toContain("if (willWatch) watchBaseMoveLanded(task.id);");
  });

  it("只有 baseLocal 型才盯落地（非 baseLocal 型没有那道目录闸，盯它是空转）", () => {
    // 盯梢那一族的载体是 `baseLocal.moveToTaskPath`，见 checkBaseMoveLanded 开头那一句早退；
    // 所以这一句必须**带条件**，不能无条件调用 —— 无条件那写法会在一趟没发任何搬运时也去盯。
    const body = chosenBody();
    expect(body.match(/watchBaseMoveLanded\(task\.id\);/g)?.length).toBe(1);
    expect(body).toContain("if (willWatch) watchBaseMoveLanded(task.id);");
  });

  it("成功后当场催一轮发送，不让他等下一分钟的定时器", () => {
    expect(chosenBody()).toContain("await advanceAutoReseed();");
  });

  it("四条成功措辞按「要不要挪 / 几条 / 几条不属这条任务」分档，且调用点都传了参", () => {
    const body = chosenBody();
    for (const key of ["alreadyThere", "sent", "sentCohort", "sentAll"]) {
      const call = `t("KeepUploadTask.movePath.${key}"`;
      expect(body, key).toContain(call);
      expect(movePath()[key], key).toMatch(/\{path\}/);
      // 防线③ 看得见字面调用，但这一族的分档是嵌套三元，容易少喂一个参数（"一键辅种（)"那一族）
      if (key === "sentAll") expect(movePath()[key]).toContain("{extra}");
    }
    expect(body).toContain("{ n: cohortSize, extra: outsideTaskCount, path: verdict.path }");
    expect(body).toContain("t(\"KeepUploadTask.movePath.partial\", { n: failed, path: verdict.path })");
    expect(movePath().partial).toMatch(/\{n\}.*\{path\}/);
  });
});

describe("抽共用之后，旧那颗键的行为一字未改", () => {
  it("仍置 moveToTaskPath、仍盯落地、仍催发送", () => {
    const body = legacyBody();
    expect(body).toContain("task.baseLocal!.moveToTaskPath = true;");
    expect(body).toContain("watchBaseMoveLanded(task.id);");
    expect(body).toContain("await advanceAutoReseed();");
  });

  it("那一趟不再在页面里展开第二遍 —— 搬运本体只有 `relocateTaskBase` 一份", () => {
    // 抄第二遍的成本本仓付过一次（v0.110.2「少搬一个字段」）：这里反过来钉「两个函数体里都不许再有那条消息」
    const body = legacyBody();
    expect(body).not.toContain('sendMessage("setClientTorrentLocation"');
    expect(body).toContain("relocateTaskBase({");
    expect(chosenBody()).not.toContain('sendMessage("setClientTorrentLocation"');
    expect(chosenBody()).toContain("relocateTaskBase({");
  });

  it("旧那一族的四条措辞仍然不带 {path}（它们说的是「任务目录」，本轮没改语义）", () => {
    for (const key of ["moveSent", "moveSentCohort", "moveSentAll", "moveCohortPartial"]) {
      expect(zh.KeepUploadTask.pathMismatch[key], key).toBeTruthy();
      expect(zh.KeepUploadTask.pathMismatch[key], key).not.toMatch(/\{path\}/);
    }
  });
});

describe("relocateTaskBase 那两条结构性判据", () => {
  it("基准先发，且 false（没能力）时其余那几条一个都不发", () => {
    // false 是各驱动的默认实现，不是搬输了：把它当成"这条失败、继续下一条"会往一台不认的
    // 下载器连发 N 次同样的请求，还会把"这台不支持"报成"搬了几条"
    const base = mover.indexOf('const moved = await sendMessage("setClientTorrentLocation"');
    const earlyReturn = mover.indexOf('if (moved === false) return { kind: "unsupported" };');
    const rest = mover.indexOf("await moveReseedCohort(");
    expect(base).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(base);
    expect(rest).toBeGreaterThan(earlyReturn);
    // 比位置只钉住了「先后」，钉不住「进不进得来」：把 `moved === false` 改成 `moved === null`
    // 之后三个位置一字没动，而那道早退永不生效（`setTorrentLocation` 返回的是 boolean）。逐字钉它。
    expect(mover).toContain('if (moved === false) return { kind: "unsupported" };');
  });

  it("列表拿不到时退回「只搬基准」，不猜一批不相干的 hash 出去改路径", () => {
    expect(mover).toContain("return only;");
    expect(mover).toContain("hashes: input.baseHash ? [input.baseHash] : []");
  });
});
