/**
 * 「把这条任务的数据移到**我指定的**目录」那三道判据。
 *
 * 为什么单独成模块（而不是写在 `KeepUploadTask/MoveTaskPathDialog.vue` 或页面里）：
 * 这三道都是**会不会往用户数据上写东西**的判断 —— 判错一档就是发一圈 `setLocation`、
 * 或者把任务的 `savePath` 改成一个根本不是目录的串。按本仓的口径，判据住 SFC 就进不了
 * Node 断言、也就进不了反证，所以收在这里。
 *
 * 与那颗既有的「把本地文件移到任务目录」的分工（`Index.vue` 的 `moveLocalBaseToTaskPath`）：
 * 那一颗的方向是**写死的**（只能往 `downloadOptions.savePath` 那一个方向挪），且只在
 * `detectBasePathMismatch` 判出不一致时才画得出来。这三道判据服务的是另一件事 ——
 * 目录本来就一致时也想挪，以及挪去第三个目录。搬运本体（带上同内容那几条副本）两处共用，
 * 见 `@/options/utils/reseedMove.ts` 的 `relocateTaskBase`。
 */
import { hasPathPlaceholder, isCategorySavePath, isSameTorrentPath } from "./reseedPath.ts";

/** 这一条任务里「数据所在那一条」在下载器里的凭证从哪来（结构型，方便造夹具） */
export interface IMoveTargetTask {
  baseLocal?: { hash?: string | null; missingInClient?: boolean } | null;
  items: readonly { hash?: string | number | null }[];
}

/**
 * 这一批要挪的那一条种子 = 基准那条。
 *
 * 两种基准形状都认，与发送那一步**同一个口径**（那边按 `items[0]` 认列表基准，
 * 见 `Index.vue` 的 `baseEntry` 与 `recheckSeeding` 里的 `baseHash`）：
 * - `baseLocal` 型：数据是下载器里已有的那一条，认 `baseLocal.hash`；
 * - 列表基准型：基准就是 `items[0]`，认它的 hash。
 *
 * ⚠️ `baseLocal` 在位而 hash 是空串时**不许退到 `items[0]`**：那是待辅条目，不是数据所在，
 * 拿它的 hash 去发 `setLocation` 等于把 B 站那条种子当成 A 那份数据搬走。
 * （同一形状见 `reseedPath.ts` 的 `refreshBaseLocalPaths`：「空串会去匹配同样没报 infoHash
 * 的那条，那是凭空造出来的『找到了』」。）
 *
 * `missingInClient` 这一位**不在这里判**：它是上一次查出来的结论，会过期；这一族每次都是
 * 现查列表，那条到底还在不在由 {@link pickLivePath} 当场认。
 */
export function pickMoveBaseHash(task: IMoveTargetTask): { hash: string } | { block: "noHash" } {
  // ⚠️ 先取再判，不许 `String(task.baseLocal?.hash)`：那样 undefined 会折成 `"undefined"` 那五个字符，
  // 一个看起来完全像合法 hash 的串 —— 随后它会被发进 `setLocation` 当种子 id，而界面上什么都看不出来。
  // （同一形状本仓记过：`foundId ?? oldHash` 那一次是"判的是 A、删的是 B"，这次是"缺的是空、取的是字面量"。）
  const raw = task.baseLocal ? task.baseLocal.hash : task.items[0]?.hash;
  const hash = String(raw ?? "").trim();
  return hash ? { hash } : { block: "noHash" };
}

/** 下载器列表里这一处用得上的两点（`CTorrent` 的子集） */
export interface IMoveTorrentEntry {
  infoHash?: string | null;
  savePath?: string | null;
}

/**
 * 那条种子**此刻**在哪个目录。
 *
 * `notFound` 说的是「列表拿到了，而里面没有这一条」= 它已经不在下载器里了，没有可挪的数据。
 * 它跟「连不上那台下载器」是两件事 —— 后者由调用方 catch 掉另给一句，**不许套同一档文案**
 * （本仓反复记过的那条：「查不了」≠「没有」）。
 *
 * 找得到但 `path` 是空串 = 那条在、但这台下载器没报 `save_path`（旧版会这样）。这一档不拦：
 * 种子确实在，`setLocation` 照发能挪；只是比不出「是不是已经在目标目录」，所以
 * {@link judgeMoveTarget} 会判成「要挪」。
 */
export function pickLivePath(
  torrents: readonly IMoveTorrentEntry[],
  hash: string,
): { path: string } | { block: "notFound" } {
  const want = String(hash ?? "").trim().toLowerCase();
  if (!want) return { block: "notFound" };
  const found = torrents.find((x) => String(x.infoHash ?? "").trim().toLowerCase() === want);
  if (!found) return { block: "notFound" };
  return { path: String(found.savePath ?? "").trim() };
}

/**
 * 人填的那一串能不能当移动目标。三档拒绝各给一句不同的出路，因为**修法不一样**：
 * - `empty`：没填；
 * - `category`：那是 `category:电影` 这种**分类名**，不是目录。既有那颗「移到任务目录」
 *   会先按分类表把它翻成真实目录再发（`detectBasePathMismatch` 里那一步），而这里是要发给
 *   人看的目录串，翻出来的那份由下载器决定、不是他填的 ⇒ 直接拒，让他填真实目录；
 * - `placeholder`：`$torrent.title$` / `<…>` 那种发送时才展开的宏，展开后每条各是一个目录，
 *   拿它当"一个目录"发出去是往下载器写一个它自己也不认识的串。
 *
 * 返回的 `path` 是**原样串**（只做 trim，不折叠分隔符）：它会被写进任务的 `savePath`、
 * 会显示在界面上、也会发给下载器，保持他写的那种写法比折成归一形状更不容易在别处对不上账
 * （同一取舍见 `reseedPath.ts` 的 `parentTorrentPath` 与 `detectBasePathMismatch`）。
 *
 * `needRelocate` = 数据此刻**不在**那个目录，所以要发 `setLocation`。已经在的话这一趟
 * 只把任务的 `savePath` 改成它 —— 那正是那颗既有的「改用本地那份的目录」做的事，
 * 我们照他的填写顺手做掉，而不是让他再点另一颗键、或点了什么反应都没有。
 */
export type TMoveTargetVerdict =
  | { kind: "ok"; path: string; needRelocate: boolean }
  | { kind: "empty" }
  | { kind: "category" }
  | { kind: "placeholder" };

export function judgeMoveTarget(input: { raw?: string | null; currentPath?: string | null }): TMoveTargetVerdict {
  const raw = String(input.raw ?? "").trim();
  if (!raw) return { kind: "empty" };
  if (isCategorySavePath(raw)) return { kind: "category" };
  if (hasPathPlaceholder(raw)) return { kind: "placeholder" };
  return { kind: "ok", path: raw, needRelocate: !isSameTorrentPath(raw, input.currentPath) };
}
