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
