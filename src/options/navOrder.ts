/**
 * 左侧导航的「用户自定义顺序」。单独成模块的理由和其它判据一样：能直接拿 Node 跑断言
 * （`.tmp-build/nav-order-test.mjs`），而这两条性质恰恰是最容易写错、错了又最难看出来的。
 *
 * 1. **合并不替换**。存下来的那份只是历史某一刻的完整列表；新版本加了页面、或者用户打开了
 *    开发者模式那两项，那些没被记过的必须补在后面 —— 按存的列表直接筛会把它们整个变没，
 *    而「文件在、路由在、菜单里没有」正是本仓库反复踩过的那类静默失效。
 * 2. **存 path，不存下标**。下标在开发者模式那两项出现/消失时会整体错位。
 */

export interface INavOrderItem {
  path: string;
}

/**
 * 按 `order` 里记的 path 顺序排 `items`；`order` 里没有的那条（新页面 / 刚打开的调试项）
 * 按它们原本的样子接在后面。`order` 里那些已经不存在于 `items` 的 path 被丢掉，
 * 所以这份函数可以反复喂同一份旧存档而不会越长越大。
 */
export function orderNavByPaths<T extends INavOrderItem>(items: readonly T[], order: readonly string[] | undefined): T[] {
  if (!order || order.length === 0) return [...items];
  const left = new Map(items.map((item) => [item.path, item]));
  const picked: T[] = [];
  for (const path of order) {
    const hit = left.get(path);
    if (hit) {
      picked.push(hit);
      left.delete(path);
    }
  }
  // 没被记过的那些照原顺序补在后面（不是丢掉）
  for (const item of items) if (left.has(item.path)) picked.push(item);
  return picked;
}

/**
 * 把 `from` 挪到 `to` 那一格上：`from` 占到 `to` 原来的位置，`to` 及中间那些往后让一格。
 * 传进来的必须是**界面上此刻显示的那份顺序**（含刚补出来的新项），不是存档原样 ——
 * 否则第一次拖动时存档还是空的，这一挪就把所有项都丢了。
 */
export function moveNavItem(order: readonly string[], from: string, to: string): string[] {
  // 两条都得先确认在场再动手：原先写成「先 splice 掉 from，再找 to」，目标不在场时就返回了一份
  // 少了 from 的表 —— 看着像"什么都没发生"，实际把那条从菜单里删掉了
  const fromAt = order.indexOf(from);
  if (fromAt < 0 || from === to || !order.includes(to)) return [...order];
  const list = [...order];
  list.splice(fromAt, 1);
  // 在**去掉 from 之后**的那份里找落点：于是「拖到谁身上」= 占到谁那一格，中间那些往后让一格
  list.splice(list.indexOf(to), 0, from);
  return list;
}

/**
 * 用户调过的顺序要不要写回存档。
 *
 * 没动过时存档是空的，界面上那份就是默认顺序 —— 那种状态下不该因为一次「拖回原位」
 * 就凭空存一份完整列表（那会让「恢复默认」以后再也判不出他到底调没调过）。
 */
export function navOrderChanged(defaultOrder: readonly string[], next: readonly string[]): boolean {
  return next.join("\n") !== defaultOrder.join("\n");
}
