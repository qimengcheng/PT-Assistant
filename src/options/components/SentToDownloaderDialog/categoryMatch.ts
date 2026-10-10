/**
 * 「按种子自己的分类，从下载器的分类目录里挑一条」的判据。
 *
 * 弹窗调的是 `resolveCategoryFolder`：先看用户记住的关联（`categoryAssoc`），再看
 * `matchCategoryFolder` 那三档；两半都没挑出来时把种子的分类（原样叫法 `category` /
 * 折类名 `kind`）带回去，界面上「要不要新建分类 / 关联到已有分类」那句提示靠它。
 *
 * 「这批种子算不算同一类」有两种成立方式（`sharedCategory`）：原样叫法一字不差，
 * 或者各站写法不同但折到同一个规范类别 —— 辅种那一屏挑的正是同一部内容在 8 个站上的 8 条，
 * 只认前一种会让整个匹配在多站点场景下恒不生效（v0.65.1 修的就是这个）。
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
 * 选中种子这一批共有的分类，两种「共有」都算：
 *  - `raw`：原样叫法一字不差（只勾一条、或几条恰好同站同写法）；
 *  - `kind`：原样叫法不同、但**折到同一个规范类别**。
 *
 * 为什么必须有 `kind` 这一半（v0.65.1 修的）：辅种那一屏天生是「同一部内容在 8 个站点上的 8 条」，
 * 而 `ITorrent.category` 存的是各站原样写法 —— NexusPHP 族直接取分类链接里 `img` 的 title/alt
 * （`packages/site/schemas/NexusPHP.ts:418-431`），所以 8 个站就是 8 种写法（`电影` / `Movies` /
 * `Movies/电影` / `Movie(电影)`…）。只认「一字不差」时这一批永远判成「没有共有分类」，
 * 三档匹配整个不跑 —— 界面上表现成「选了 8 条电影，保存路径却还是上次那个 category:剧集」。
 * 搜索结果表格里那列显示的「电影」是折类后的统一名，不是原值，两边对不上就是这么来的。
 *
 * 两种都不成立时返回全 null：**不取多数派**，这一版弹窗对整批种子用的是同一个 savePath。
 */
/**
 * 这一批里出现过的分类**原样叫法**（去首尾空白、去空、去重，保持首次出现顺序）。
 * 「共有」的两种判定和「记住关联」要写的条目都以它为准 —— 界面那边问完一次要**逐条 raw 都记下**，
 * 否则下一批同样的组合又被 `assocForBatch` 判成「没记全」，会反复问。
 */
export function batchCategoryRaws(items: readonly ICategorySource[]): string[] {
  return [...new Set(items.map((item) => String(item.category ?? "").trim()).filter(Boolean))];
}

export function sharedCategory(
  items: readonly ICategorySource[],
  siteMapOf: (siteId: string) => Record<string, string> | undefined = () => undefined,
): { raw: string | null; kind: TCategoryKind | null } {
  const raws = batchCategoryRaws(items);
  if (raws.length === 0) return { raw: null, kind: null };

  // 折类是按「每一条各自的站点覆盖表」算的，所以逐条折再去重，不能只折 raws（那会丢掉 site 维度）
  const kinds = new Set<TCategoryKind>(
    items
      .filter((item) => String(item.category ?? "").trim() !== "")
      .map((item) => categorizeCategory(String(item.category).trim(), siteMapOf(item.site ?? ""))),
  );
  const [only] = [...kinds];
  const kind = kinds.size === 1 && only !== "other" ? only : null;

  return { raw: raws.length === 1 ? raws[0] : null, kind };
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

  const { raw, kind } = sharedCategory(items, siteMapOf);
  if (!raw && !kind) return null;
  const lower = raw?.toLowerCase() ?? "";

  // ①② 比的就是那串字本身，所以只在整批写法一致时判
  let hit: typeof candidates = [];
  if (raw) {
    // ① 一模一样
    hit = candidates.filter((c) => c.name.toLowerCase() === lower);

    // ② 分类名是原样叫法里的一段，多段命中取最长那条
    if (hit.length === 0) {
      const partly = candidates.filter((c) => lower.includes(c.name.toLowerCase()));
      if (partly.length > 0) {
        const longest = Math.max(...partly.map((c) => c.name.length));
        hit = partly.filter((c) => c.name.length === longest);
      }
    }
  }

  // ③ 折成规范类别再比 —— 整批写法不一致时（多站点同一内容）这是唯一还能用的一档
  if (hit.length === 0 && kind) hit = candidates.filter((c) => categorizeCategory(c.name) === kind);

  return hit.length === 1 ? hit[0].folder : null;
}

/** 「记住的关联」表：折过小写的原样叫法 → 该下载器的分类目录（带前缀原样串） */
export type TCategoryAssocMap = Record<string, string>;

/**
 * 关联表的键。折小写 + 去首尾空白和三档判据里 ①② 的比法是同一条（`Movies` 与 `movies`
 * 本来就当同一类内容），不然用户记下的那条会因为大小写差一点而重新变成「没匹配上」。
 */
export function categoryAssocKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 「新建分类」要写进保存路径的那条值：前缀原样带上，发送时才由下载器适配层换成真分类 */
export function newCategoryFolder(raw: string): string {
  return `${CATEGORY_FOLDER_PREFIX}${raw.trim()}`;
}

/**
 * 一条保存路径「自己声称属于哪类内容」：带 `category:` 前缀的按前缀后面那段折类。
 * 两类返回 null，也就是**不表态**，谈不上和某批种子矛盾：
 *  - 按盘符列出来的具体路径（`/volume1/downloads`）；
 *  - 折不出类别的那条（`other`）。
 */
export function folderCategoryKind(folder: string): TCategoryKind | null {
  if (!folder.startsWith(CATEGORY_FOLDER_PREFIX)) return null;
  const name = folder.slice(CATEGORY_FOLDER_PREFIX.length).trim();
  if (!name) return null;
  const kind = categorizeCategory(name);
  return kind === "other" ? null : kind;
}

/**
 * 只有 qBittorrent 认 `category:` 前缀（`packages/downloader/entity/qBittorrent.ts` 的
 * `category_prefix`：命中前缀会转成 `autoTMM = true` + `category = 前缀后面那段`，
 * 分类不存在时由 qBittorrent 在添加种子那一刻建出来）。别的下载器会把整串当成路径，
 * 所以「新建分类」这个动作对它们没有意义，提示也就不要立。
 */
export function supportsCategoryFolders(type?: string): boolean {
  return type === "qBittorrent";
}

/** 这一条目录是从哪来的：用户记住的关联 / 三档判据命中 */
export type TCategoryHitSource = "assoc" | "match";

export interface ICategoryResolution {
  folder: string | null;
  source: TCategoryHitSource | null;
  /** 种子的分类原样叫法；整批写法不一致时为 null（那种批次没有共用的原样串，只有 `kind`） */
  category: string | null;
  /**
   * 整批折到的规范类别。写法各站不同但都是同一类内容时（辅种那一屏的常态）它仍然有值，
   * 而 `category` 是 null —— 界面上要拿它当「这批是什么」的依据时用这个，别用 category。
   */
  kind: TCategoryKind | null;
}

/**
 * 「记住的关联」在这一批上的结论：整批每个不同的原样叫法都得有记录，**而且都指向同一条目录**才算。
 * 只有一半站点记过就照它填，等于替没记过的那些站做主。
 */
function assocForBatch(items: readonly ICategorySource[], assoc?: TCategoryAssocMap): string | null {
  if (!assoc) return null;
  const raws = batchCategoryRaws(items);
  if (raws.length === 0) return null;
  const hits = raws.map((raw) => assoc[categoryAssocKey(raw)]);
  const first = hits[0];
  if (!first || !hits.every((h) => h === first)) return null;
  return first;
}

/**
 * 弹窗打开 / 换下载器时那一次完整判定：**记住的关联优先于三档判据**。
 *
 * 关联值不要求还留在 `folders` 里 —— 那份列表只是「推荐目录」的候选（用户自己维护、
 * 也可能一直没同步），而 qBittorrent 对不存在分类的 add 会自建。真被删了也能自愈。
 *
 * 没定下来目录时把 `category` / `kind` 带回去，界面上那句「要不要新建分类」就靠它。
 */
export function resolveCategoryFolder(
  folders: readonly string[],
  items: readonly ICategorySource[],
  assoc?: TCategoryAssocMap,
  siteMapOf?: (siteId: string) => Record<string, string> | undefined,
): ICategoryResolution {
  const { raw, kind } = sharedCategory(items, siteMapOf);
  const nothing: ICategoryResolution = { folder: null, source: null, category: null, kind: null };
  if (!raw && !kind) return nothing;

  const remembered = assocForBatch(items, assoc);
  if (remembered) return { folder: remembered, source: "assoc", category: raw, kind };

  const folder = matchCategoryFolder(folders, items, siteMapOf);
  return folder
    ? { folder, source: "match", category: raw, kind }
    : { folder: null, source: null, category: raw, kind };
}
