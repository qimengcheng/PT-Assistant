/**
 * 站点分享率的**取数**（`src/options/utils/siteRatio.ts` 的 `siteCurrentRatio`）。
 *
 * 为什么这一份要进 Vitest：v0.105.2 把「分享率低于 1 不能当基准」做成硬闸之后，用户 2026-10-15
 * 那一屏是「我的数据明明写着 NovaHD 0.21，辅种检测里每一行都标分享率未知」。根因不在判据，
 * 在取数 —— 辅种那边直读 `lastUserInfo[site].ratio`，而 NexusPHP 那一族根本不报这个字段（解析器
 * 只有 uploaded / downloaded），原值是 `undefined`；「我的数据」那一格却是显示前按上下行现算的。
 * 两处读法不同，闸就整个空转。
 *
 * 每条都配一个「老口径（直读原值）会得到什么」的对照，否则用例等于没钉住这次的分叉。
 * 数值一律合成，不写真实账号的流量。
 */
import { describe, expect, it } from "vitest";

import { siteCurrentRatio } from "@/options/utils/siteRatio.ts";
import { reseedRatioVerdict } from "@/shared/reseedRecommend.ts";

import type { IStoredUserInfo } from "@/shared/types.ts";

/** NexusPHP 那一族的账户：只有上下行，没有 ratio */
const noRatioField: Partial<IStoredUserInfo> = { uploaded: 2e9, downloaded: 1e10 };

describe("siteCurrentRatio：与「我的数据」同一份派生", () => {
  it("站点报了 ratio 就用报的数，不拿上下行覆盖它", () => {
    expect(siteCurrentRatio({ uploaded: 2e9, downloaded: 1e10, ratio: 7.5 })).toBe(7.5);
  });

  it("站点没报 ratio 时按 上传量 ÷ 下载量 现算（这条就是那次分叉）", () => {
    expect(siteCurrentRatio(noRatioField)).toBeCloseTo(0.2, 10);
    // 对照：直读原值读到的是 undefined，判据因此报「未知」
    expect(noRatioField.ratio).toBeUndefined();
    expect(reseedRatioVerdict(noRatioField.ratio)).toBe("unknown");
    expect(reseedRatioVerdict(siteCurrentRatio(noRatioField))).toBe("low");
  });

  it("有上传没下载 → Infinity，是达标里最好的一档，不是缺失", () => {
    expect(siteCurrentRatio({ uploaded: 5e9, downloaded: 0 })).toBe(Infinity);
    expect(reseedRatioVerdict(siteCurrentRatio({ uploaded: 5e9, downloaded: 0 }))).toBe("ok");
  });

  it("上下行都是 0 → -Infinity（fixRatio 的「报不出」哨兵），不许读成低", () => {
    expect(siteCurrentRatio({ uploaded: 0, downloaded: 0 })).toBe(-Infinity);
    expect(reseedRatioVerdict(siteCurrentRatio({ uploaded: 0, downloaded: 0 }))).toBe("unknown");
  });

  it("账户整个没取到 → undefined，不是 0", () => {
    expect(siteCurrentRatio(undefined)).toBeUndefined();
    expect(reseedRatioVerdict(siteCurrentRatio(undefined))).toBe("unknown");
  });

  it("刷过但一个数都没拿到（空对象）也判不出", () => {
    expect(reseedRatioVerdict(siteCurrentRatio({}))).toBe("unknown");
  });
});
