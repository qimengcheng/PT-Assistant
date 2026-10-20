/**
 * 「我的数据 → 等级」悬停浮层的三条判据。
 *
 * 来由（用户 2026-10-20 两轮）：
 * ① 「点击这个地方的时候会弹一个新的框，但是鼠标没有在框上，所以框会马上消失…应该是在原地展开」
 *    —— 台架量到展开瞬间浮层**上边缘没动、下边缘长了 235.4px**，视口 900 那一档底边落到 1113.4；
 * ② 「这个还是会换方向，你统一到右边不就不会跳变了？而且展开的时候应该是有动画的，不能这么硬切」
 *    —— 收起态实测挂在触发元素左边（x 60→630），展开后挂到右边（x 590→1500），
 *    那是 antd 的横向避让按「当下这份宽度」两次判出了两个方向。
 *
 * 所以钉三件事：
 * A. `levelPanelBoxSize` 那几道钳（宽 860/320、高 420/120）—— 撤掉任何一道都不报错，
 *    只把浮层顶出窗口或压成一格看不全的框；
 * B. **模板里的先后与那几个参数**：展开键必须排在列表之前、锚点必须是左上角、避让必须整个关掉、
 *    开合必须走 mergedOpen。这些只能按源码文本验（vitest 是 node 环境，DOM 里没有组件可渲染），
 *    而它们恰恰最容易被「顺手排版 / 换个 placement」改回去 —— 改回去不报错、不进 vue-tsc，
 *    只在界面上表现为「点了会跳一下」。
 * C. 展开必须走那颗键的 `toggleLevels`（里面才有那段高度动画），不许退回行内直接翻布尔。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { levelPanelBoxSize } from "@/options/views/Overview/MyData/levelPanelBox.ts";

const box = (left: number, bottom: number, vw = 2008, vh = 900) => levelPanelBoxSize({ left, bottom }, vw, vh);

describe("浮层画幅：高度", () => {
  it("下方空间充足时封顶在 420，不照剩余空间给到 776", () => {
    expect(box(100, 100).maxHeight).toBe(420);
  });

  it("空间不够时按触发元素下方的真实剩余收，而不是照抄 420", () => {
    // 900 − 700 − 24
    expect(box(100, 700).maxHeight).toBe(176);
  });

  it("贴着窗口底也不许收成负数，最低留 120", () => {
    expect(box(100, 890).maxHeight).toBe(120);
    expect(box(100, 2000).maxHeight).toBe(120);
  });

  it("上限那一道的临界值取得到", () => {
    expect(box(100, 456).maxHeight).toBe(420);
  });
});

describe("浮层画幅：宽度", () => {
  it("右侧空间充足时封顶在 860", () => {
    expect(box(100, 100).maxWidth).toBe(860);
  });

  it("靠右的格子按右侧真实剩余收 —— 收窄而不是换到左边去", () => {
    // 2008 − 1500 − 24
    expect(box(1500, 100).maxWidth).toBe(484);
  });

  it("贴着右边缘也留得住一条等级串，最低 320", () => {
    expect(box(1990, 100).maxWidth).toBe(320);
    expect(box(3000, 100).maxWidth).toBe(320);
  });
});

describe("浮层在模板里的形状", () => {
  // 这里读的是文件本身，不是 import：别名规则管的是判据的引用，而模板顺序这种东西 import 不进来
  const sfc = readFileSync(
    new URL("../../src/options/views/Overview/MyData/UserLevelRequirementsTd.vue", import.meta.url),
    "utf8",
  );

  it("那颗键排在等级列表之前 —— 列表从它下面长出来，键的 y 才不动", () => {
    const toggle = sfc.indexOf(`class="level-requirement-toggle"`);
    const list = sfc.indexOf(`v-for="userLevel in visibleLevelRequirements"`);
    expect(toggle).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(list);
  });

  it("锚点是左上角，且避让整个关掉 —— 这两半缺一个就会换方向", () => {
    expect(sfc).toContain('placement="bottomLeft"');
    expect(sfc).toContain(':auto-adjust-overflow="false"');
    expect(sfc).not.toContain("bottomRight");
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
