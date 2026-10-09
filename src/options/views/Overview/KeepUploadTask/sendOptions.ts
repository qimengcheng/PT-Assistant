/**
 * 辅种任务页发给下载器那份选项里，和普通下载不一样的那一处：**跳过校验**。
 *
 * 单独成模块只为了能直接跑断言（`.tmp-build/keep-upload-send-test.mjs` 用 Node 直接 import，
 * 不用 loader）：住在组件里时，验它得起一整个 vite 台架挂真页面 + 假 store。
 *
 * 为什么这里可以跳、普通下载不可以：辅种任务在**建任务那一步**已经比过内容了 ——
 * `SearchEntity/KeepUploadDialog.vue` 走的是三层指纹（`src/shared/fingerprint/`），
 * 只有第 2 层（文件清单指纹）一致才自动选中基准，其余都要用户当场确认。
 * 所以发送时那一遍全量哈希不是在做判断，只是把几十 G 再读一遍（用户 2026-10-09：
 * 「发送到下载器必须是跳过校验，不然每一个都要校验半天」）。
 */
import type { CAddTorrentOptions } from "@ptd/downloader";

/** qBittorrent 那个高级选项的键名（`packages/downloader/entity/qBittorrent.ts:106`） */
export const SKIP_CHECKING_KEY = "skip_checking";

/**
 * 打上跳过校验。**故意不按下载器类型判**：qBittorrent 和 Deluge 都只遍历自己声明过的那批
 * 布尔键（`qBittorrent.ts:504-508`、`Deluge.ts:366-383`），别的客户端要么不读
 * `advanceAddTorrentOptions`，要么把这个不认识的键直接忽略 —— 传过去不会坏，
 * 只是不生效。用类型名建一张白名单反而会在新增下载器时静默漏掉它。
 *
 * 返回新对象，不改调用方传进来的那份（任务里存的 `downloadOptions.addTorrentOptions`
 * 是同一条引用，改坏了会跟着写回存储）。
 */
export function withReseedSkipChecking(options: CAddTorrentOptions): CAddTorrentOptions {
  return {
    ...options,
    advanceAddTorrentOptions: {
      ...(options.advanceAddTorrentOptions ?? {}),
      [SKIP_CHECKING_KEY]: true,
    },
  };
}

/**
 * 这一条到底该不该跳过校验（用户 2026-10-09：「点击发送基准种子的时候就别跳过校验了啊，
 * 都是基准种子了，那说明还没下嘛」）。
 *
 * 只有「列表第一条 + 基准不在下载器里」那一条是真要下全量的：跳过校验等于告诉 qBittorrent
 * 「数据我盘上已经有了」，于是那条基准可能挂着不完整的数据被当成 100%，而后面所有辅种都是拿
 * 这份错数据去挂的 —— 比慢一点校验严重得多。
 *
 * 基准来自下载器（baseLocal）那种任务不适用这条：那一条根本不会发送（界面那颗是灰的），
 * 发出去的每一条都是「内容已在盘上、只差再挂一站」，照旧跳过。
 */
export function skipCheckingFor(task: { baseLocal?: unknown }, item: unknown, firstListEntry: unknown): boolean {
  return !!task.baseLocal || item !== firstListEntry;
}
