/**
 * 「哪些站点的分类算空白、可以回填」（`src/shared/siteGroupsBackfill.ts`）。
 *
 * 这条判据决定要不要写用户数据：判宽了会把用户自己填过的分组盖掉（丢了找不回来），
 * 判窄了那 28 个站补完定义仍然空着。而它住在 import 了 340 个站点定义的 store 里，
 * 模板与异步路径上的表达式没有任何防线 —— 所以判据单独拆成零依赖纯函数并在这里钉住。
 */
import { describe, expect, it } from "vitest";

import { siteIdsNeedingGroups } from "@/shared/siteGroupsBackfill.ts";

describe("空的定义", () => {
  it("groups 这个键压根没有：算空白", () => {
    expect(siteIdsNeedingGroups({ mteam: {} })).toEqual(["mteam"]);
  });

  it("groups 是 undefined：算空白（老版本写进存储过的形状）", () => {
    expect(siteIdsNeedingGroups({ mteam: { groups: undefined } })).toEqual(["mteam"]);
  });

  it("groups 是空数组：算空白（定义当时没有 tags 时被抄进来的默认值）", () => {
    expect(siteIdsNeedingGroups({ ptcafe: { groups: [] } })).toEqual(["ptcafe"]);
  });
});

describe("不许动的定义", () => {
  it("只要有一个分组就算用户填过，一个都不许盖", () => {
    expect(siteIdsNeedingGroups({ ptcafe: { groups: ["我自己的分组"] } })).toEqual([]);
  });

  it("用户填过多组、其中含空串之类的怪值，也照样算填过", () => {
    expect(siteIdsNeedingGroups({ ptcafe: { groups: [""] } })).toEqual([]);
  });

  it("整条配置是 undefined（Record 里挂了个空位）：跳过，不报也不写", () => {
    expect(siteIdsNeedingGroups({ ptcafe: undefined })).toEqual([]);
  });
});

describe("一批站点里挑出该补的那几条", () => {
  it("只返回空的那些，顺序跟存储里的顺序一致", () => {
    expect(
      siteIdsNeedingGroups({
        alingpt: { groups: [] },
        mteam: { groups: ["影视"] },
        ptcafe: {},
        pandapt: { groups: [] },
      }),
    ).toEqual(["alingpt", "ptcafe", "pandapt"]);
  });

  it("一个都不缺时返回空数组（回填就此什么都不写）", () => {
    expect(
      siteIdsNeedingGroups({
        mteam: { groups: ["影视"] },
        byr: { groups: ["综合"] },
      }),
    ).toEqual([]);
  });
});
