/**
 * 「按种子自己的分类，从下载器的分类目录里挑一条」的判据。
 *
 * 单独成模块只为了能直接跑断言（`.tmp-build/category-path-test.mjs` 用 Node 直接 import 这两个
 * 文件，不用 loader）：这段逻辑住在弹窗组件里时，验它得起一整个 vite 台架挂真弹窗 + 假 store。
 *
 * `category:` 这个前缀不是本模块发明的：它是 qBittorrent 那条「用分类作为保存位置」的约定
 * （`packages/downloader/entity/qBittorrent.ts` 的 `category_prefix`），发送时命中前缀会转成
 * `autoTMM = true` + `category = 前缀后面那段`，所以这里挑出来的必须原样带回前缀。
 */
import { categorizeCategory, type TCategoryKind } from "@/shared/category.ts";

/** `category:` 前缀的推荐目录单独成组：这批是分类目录，和按盘符列出来的具体路径不是一类东西 */
export const CATEGORY_FOLDER_PREFIX = "category:";

/** 一行的最小输入：站点 id + 该站的原样叫法（`ITorrent` 里就这两个字段用得上） */
export interface ICategorySource {
  site?: string;
  category?: string | number;
}

/**
 * 选中种子的分类原样叫法；一个都没有、或彼此不一致都返回 null。
 * 不一致时不取多数派：这一版弹窗对整批种子用的是同一个 savePath，猜一半错一半。
 */
export function sharedCategoryRaw(items: readonly ICategorySource[]): string | null {
  const raws = [...new Set(items.map((item) => String(item.category ?? "").trim()).filter(Boolean))];
  return raws.length === 1 ? raws[0] : null;
}

/**
 * 三档判据从严到宽；**同一档里剩下两条候选就返回 null** —— 宁可让他自己点，也不能把文件
 * 放进一个猜出来的目录：
 *  ① 站点的原样叫法与分类名一模一样（`电影` ↔ `category:电影`）；
 *  ② 分类名是原样叫法里的一段（站点写 `Movies/电影`，他建的分类叫 `电影`），
 *     几段都命中时取名字最长的那条（最长的那条最具体）；
 *  ③ 两边各折成规范类别再比（`TV Series` ↔ `category:剧集`）。折类走 `src/shared/category.ts`
 *     那套现成判据（含站点自己的 categoryMap 覆盖表），这里不再自己写一份字符串匹配
 *     （AGENTS §3.8）。折不出类别（`other`）的不参与 ③：那是「未知匹配未知」。
 *
 * @param folders 该下载器的推荐目录原样列表（带前缀的会参与匹配，其余忽略）
 * @param siteMapOf 站点 id → 该站的分类覆盖表（`ISiteUserConfig.categoryMap`），没有传 undefined
 */
export function matchCategoryFolder(
  folders: readonly string[],
  items: readonly ICategorySource[],
  siteMapOf: (siteId: string) => Record<string, string> | undefined = () => undefined,
): string | null {
  const candidates = folders
    .filter((f) => f.startsWith(CATEGORY_FOLDER_PREFIX))
    .map((f) => ({ folder: f, name: f.slice(CATEGORY_FOLDER_PREFIX.length).trim() }))
    .filter((c) => c.name !== "");
  if (candidates.length === 0) return null;

  const raw = sharedCategoryRaw(items);
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // ① 一模一样
  let hit = candidates.filter((c) => c.name.toLowerCase() === lower);

  // ② 分类名是原样叫法里的一段，多段命中取最长那条
  if (hit.length === 0) {
    const partly = candidates.filter((c) => lower.includes(c.name.toLowerCase()));
    if (partly.length > 0) {
      const longest = Math.max(...partly.map((c) => c.name.length));
      hit = partly.filter((c) => c.name.length === longest);
    }
  }

  // ③ 折成规范类别再比；同一批种子可能来自不同站点，各自的覆盖表都要参与
  if (hit.length === 0) {
    const kinds = new Set<TCategoryKind>(
      items
        .filter((item) => String(item.category ?? "").trim() === raw)
        .map((item) => categorizeCategory(raw, siteMapOf(item.site ?? ""))),
    );
    if (kinds.size === 1) {
      const [kind] = [...kinds];
      if (kind !== "other") hit = candidates.filter((c) => categorizeCategory(c.name) === kind);
    }
  }

  return hit.length === 1 ? hit[0].folder : null;
}
