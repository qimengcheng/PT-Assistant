/**
 * 「我的数据 → 等级」悬停浮层的判据。
 *
 * 来由（用户 2026-10-20 三轮）：
 * ① 「点击这个地方的时候会弹一个新的框，但是鼠标没有在框上，所以框会马上消失…应该是在原地展开」
 *    —— 台架量到展开瞬间浮层**上边缘没动、下边缘长了 235.4px**，视口 900 那一档底边落到 1113.4；
 * ② 「这个还是会换方向，你统一到右边不就不会跳变了？而且展开的时候应该是有动画的，不能这么硬切」
 *    —— 收起态实测挂在触发元素左边（x 60→630），展开后挂到右边（x 590→1500），
 *    那是 antd 的横向避让按「当下这份宽度」两次判出了两个方向；
 * ③ 「下面的肯定一开始就是往上的啊」—— ②那一版把纵向也一并「统一」成朝下，贴窗口底的那几行
 *    只把画幅压到最低 120px。朝向必须在开合那一刻按两侧剩余比出来，而不是压扁其中一侧。
 *
 * 所以钉四件事：
 * A. `levelPanelBoxSize` 那几道钳（宽 860/320、高 420/120）—— 撤掉任何一道都不报错，
 *    只把浮层顶出窗口或压成一格看不全的框；
 * B. **朝向与画幅同源**：`maxHeight` 必须来自被选中的那一侧，`growUp` 与它一次算出；
 * C. **模板里的先后与那几个参数**：锚点必须左侧对齐、避让必须整个关掉、开合必须走 mergedOpen、
 *    朝上那一档那颗键必须换到列表之后。这些只能按源码文本验（vitest 是 node 环境，DOM 里没有
 *    组件可渲染），而它们恰恰最容易被「顺手排版 / 换个 placement」改回去 —— 改回去不报错、
 *    不进 vue-tsc，只在界面上表现为「点了会跳一下」；
 * D. 展开必须走那颗键的 `toggleLevels`（里面才有那段高度动画），不许退回行内直接翻布尔。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { levelPanelBoxSize } from "@/options/views/Overview/MyData/levelPanelBox.ts";

/** 默认摆在窗口上半部的一格（朝下开），各用例只改自己要的那条边 */
const box = (trigger: Partial<{ left: number; top: number; bottom: number }>, vw = 2008, vh = 900) =>
  levelPanelBoxSize({ left: 100, top: 100, bottom: 120, ...trigger }, vw, vh);

/** 摆在窗口下半部的一格：上方 676、下方只有 156 —— ③那几行的形状 */
const nearBottom = { top: 700, bottom: 720 };

describe("浮层画幅：高度与朝向同源", () => {
  it("下方宽时朝下开，封顶在 420，不照剩余空间给到 756", () => {
    const r = box({});
    expect(r.growUp).toBe(false);
    expect(r.maxHeight).toBe(420);
  });

  it("贴着窗口底的那一行一开始就朝上 —— 而不是照旧朝下压成一截短框", () => {
    const r = box(nearBottom);
    expect(r.growUp).toBe(true);
    // 朝上那侧的剩余是 700 − 24 = 676，够 420 的顶
    expect(r.maxHeight).toBe(420);
  });

  it("朝上时画幅按**上方**剩余收，不是照抄下方那一侧", () => {
    // 上方 240 − 24 = 216（比下方的 56 宽），下方那个数若被误用会收成 120
    const r = box({ top: 240, bottom: 260 }, 2008, 340);
    expect(r.growUp).toBe(true);
    expect(r.maxHeight).toBe(216);
  });

  it("两侧都不宽时取宽的那一侧，但一侧再窄也留 120", () => {
    // 上方 96 对下方 76 ⇒ 朝上；两侧都低于 120 ⇒ 仍给 120（宁可伸出视口也不画成一格）
    const r = box({ top: 120, bottom: 140 }, 2008, 240);
    expect(r.growUp).toBe(true);
    expect(r.maxHeight).toBe(120);
  });

  it("两侧一样宽时不翻面 —— 保持默认朝下，免得同一格每次开都换一个方向", () => {
    // 上方 414 对下方 414
    const r = box({ top: 438, bottom: 462 });
    expect(r.growUp).toBe(false);
    expect(r.maxHeight).toBe(414);
  });

  it("上限那道临界值取得到，再少 1px 就照实收", () => {
    // 下方剩余正好 420（900 − 456 − 24）；bottom 再往下 1px 就成了 419
    expect(box({ top: 100, bottom: 456 }).maxHeight).toBe(420);
    expect(box({ top: 100, bottom: 457 }).maxHeight).toBe(419);
  });
});

describe("浮层画幅：宽度", () => {
  it("右侧空间充足时封顶在 860", () => {
    expect(box({}).maxWidth).toBe(860);
  });

  it("靠右的格子按右侧真实剩余收 —— 收窄而不是换到左边去", () => {
    // 2008 − 1500 − 24
    expect(box({ left: 1500 }).maxWidth).toBe(484);
  });

  it("贴着右边缘也留得住一条等级串，最低 320", () => {
    expect(box({ left: 1990 }).maxWidth).toBe(320);
    expect(box({ left: 3000 }).maxWidth).toBe(320);
  });

  it("朝上那一档横向仍锚左边缘 —— 换朝向不该把左右也换掉", () => {
    // 2008 − 1500 − 24：朝上时仍然只看「left 到视口右沿」这一段
    expect(box({ ...nearBottom, left: 1500 }).maxWidth).toBe(484);
  });
});

describe("浮层在模板里的形状", () => {
  // 这里读的是文件本身，不是 import：别名规则管的是判据的引用，而模板顺序这种东西 import 不进来
  const sfc = readFileSync(
    new URL("../../src/options/views/Overview/MyData/UserLevelRequirementsTd.vue", import.meta.url),
    "utf8",
  );

  it("那颗键排在等级列表之前 —— 朝下那一档钉的是上边缘，键得贴着它", () => {
    const toggle = sfc.indexOf(`class="level-requirement-toggle"`);
    const list = sfc.indexOf(`v-for="userLevel in visibleLevelRequirements"`);
    expect(toggle).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(list);
  });

  it("朝上那一档把那颗键换到列表之后 —— DOM 不动，用 CSS order 换视觉先后", () => {
    const up = /\/\*[\s\S]*?\*\/\s*\.level-requirement-panel--up \{([\s\S]*?)\n\}/.exec(sfc);
    expect(up, "找不到 .level-requirement-panel--up 那一段").toBeTruthy();
    const orderOf = (cls: string) => {
      const m = new RegExp(`\\.level-requirement-${cls} \\{\\s*\\n\\s*order: (\\d+);`).exec(up![1]);
      return m ? Number(m[1]) : Number.NaN;
    };
    const listOrder = orderOf("list");
    const toggleOrder = orderOf("toggle");
    expect(listOrder).toBeGreaterThan(0);
    expect(toggleOrder).toBeGreaterThan(listOrder);
    // 不写这一条的话整列会被 max-height 压扁而不是滚起来
    expect(up![1]).toMatch(/> \* \{\s*\n\s*flex-shrink: 0;/);
  });

  it("朝上那一档那颗键还要钉在滚动区下沿 —— 它在这一档是内容末尾，溢出了就点不回去", () => {
    const up = /\.level-requirement-panel--up \{([\s\S]*?)\n\}/.exec(sfc);
    expect(up, "找不到 .level-requirement-panel--up 那一段").toBeTruthy();
    expect(up![1]).toMatch(
      /\.level-requirement-toggle \{\s*\n\s*order: 3;\s*\n\s*(?:\/\*[\s\S]*?\*\/\s*)?position: sticky;\s*\n\s*bottom: 0;\s*\n\s*background: #fff;/,
    );
    // 朝下那一档不需要这一条（键本来就在内容开头），别把它推广过去
    const base = /\.level-requirement-toggle \{\s*\n\s*display: block;([\s\S]*?)\n\}/.exec(sfc);
    expect(base, "找不到那颗键的基础样式那一块").toBeTruthy();
    expect(base![1]).not.toContain("position: sticky");
  });

  it("朝向由那份判据一次性给出来，不在组件里再量一遍视口", () => {
    expect(sfc).toContain("const growUp = computed(() => panelBox.value?.growUp ?? false)");
    // 视口与位置各只许读一次：读第二次就是「方向与画幅分了两回判」的开始
    expect(sfc.match(/getBoundingClientRect\(\)/g)?.length).toBe(1);
    expect(sfc.match(/window\.innerHeight/g)?.length).toBe(1);
  });

  it("锚点左侧对齐、上下随朝向，且避让整个关掉 —— 这几半缺一个就会换方向", () => {
    expect(sfc).toContain(`:placement="growUp ? 'topLeft' : 'bottomLeft'"`);
    expect(sfc).toContain(':auto-adjust-overflow="false"');
    expect(sfc).toContain(`'level-requirement-panel--up': growUp`);
    expect(sfc).not.toContain("bottomRight");
    expect(sfc).not.toContain("topRight");
  });

  it("开合交给 mergedOpen，展开态由它钉住（不许退回组件自管）", () => {
    expect(sfc).toContain(':open="mergedOpen"');
    expect(sfc).toContain('@open-change="onOpenChange"');
  });

  it("画幅由那份判据喂进去，不是只留 CSS 里那两条常数", () => {
    expect(sfc).toContain("maxWidth: panelBox ? `${panelBox.maxWidth}px` : undefined");
    expect(sfc).toContain("maxHeight: panelBox ? `${panelBox.maxHeight}px` : undefined");
  });

  it("展开走 toggleLevels（那段高度动画在它里面），不许行内直接翻布尔", () => {
    expect(sfc).toContain('@click="toggleLevels"');
    expect(sfc).not.toContain('@click="showAllLevels = !showAllLevels"');
  });

  it("列表那一层必须裁掉溢出 —— 动画过程中高度小于内容，不裁就先把下面的等级露出来", () => {
    expect(sfc).toContain('class="level-requirement-list"');
    expect(sfc).toMatch(/\.level-requirement-list \{\s*\n\s*overflow: hidden;/);
  });
});
