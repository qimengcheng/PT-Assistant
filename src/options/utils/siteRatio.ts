/**
 * 站点「现在的分享率」——凡是要拿它做判断或显示，都从这一处取。
 *
 * 为什么不能直接读 `metadataStore.lastUserInfo[site].ratio`：那是站点解析器报出来的**原值**，
 * 而 NexusPHP 那一族（NovaHD 在内）根本不报 `ratio`，只报 `uploaded` / `downloaded`，
 * 库里存的就是 `undefined`。「我的数据」那一列之所以有数，是因为它在显示前走 `fixRatio`：
 * 站点报了就用报的，没报就按 上传量 ÷ 下载量 现算。
 *
 * 辅种检测那边原先只读原值，于是同一个站在两处一个写着 0.21、一个写着「分享率未知」
 * （用户 2026-10-15 报的），而 v0.105.2 那道「低于 1 不能当基准」的闸因为拿不到数整个空转。
 *
 * 算式只有 `@ptd/site` 那一份，这里不复写第二遍；「什么算低于 1」的判据仍在
 * `@/shared/reseedRecommend.ts`，这一层只管把数取出来。
 */
import { fixRatio } from "@ptd/site/utils/level.ts";

import type { IStoredUserInfo } from "@/shared/types.ts";

/**
 * 该站现在的分享率，口径与「我的数据」那一列同一个数。
 *
 * 参数写 `Partial` 是因为这一份账户在库里可能压根不完整（刷过但只拿到几个字段），
 * 「我的数据」那一侧也是同一写法（`fixUserInfo(siteUserInfoData)` 吃的就是 Partial）。
 * 账户整个没取到过（从没刷过用户信息）时返回 `undefined` 而不是 0 —— 判不出与「真的是 0」
 * 是两件事，交给调用方按「未知」处理。
 */
export function siteCurrentRatio(account: Partial<IStoredUserInfo> | undefined): number | undefined {
  if (!account) return undefined;
  return fixRatio(account);
}
