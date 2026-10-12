/**
 * 站点解析的安全取值助手（`packages/site/utils/safeParse.ts`）。
 *
 * 这份从 `.tmp-build/safe-parse-test.mjs` 搬进来（期望值是那次独立重跑出来的，不抄作者的说法）。
 * 它测的是上游平移件里**本仓新增**的那一个文件：这两个助手存在的意义就是「页面格式一变，
 * 只让那一行为空，别把整页搜索带走」，所以坏输入的用例比正常用例重要。
 */
import { describe, expect, it } from "vitest";

import { afterColon, captureOr } from "@ptd/site/utils/safeParse.ts";

describe("afterColon：取第一个冒号之后的部分", () => {
  it.each([
    ["普通写法", "Uploaded: 1.2 GB", "1.2 GB"],
    ["冒号后没空格", "Uploaded:1.2 GB", "1.2 GB"],
    // 这条就是原来 split(":")[1] 会把比例算错的那一处
    ["值里带冒号（比例）", "Ratio: 1:2", "1:2"],
    ["没有冒号", "Uploaded", ""],
    ["只有冒号", ":", ""],
    ["冒号后为空", "Uploaded: ", ""],
    ["空串", "", ""],
    ["null", null, ""],
    ["undefined", undefined, ""],
    // 全角「：」一律当没有冒号：猜着归一化会掩盖真正的格式变化
    ["全角冒号当没有冒号", "上传：1.2 GB", ""],
    ["冒号前也有冒号", "a:b: c", "b: c"],
    ["两端空白都去掉", "X:   1 TB  ", "1 TB"],
  ])("%s", (_label, input, want) => {
    expect(afterColon(input as string | null | undefined)).toBe(want);
  });
});

describe("captureOr：取第一个捕获组，不匹配时给空串而不是抛", () => {
  const re = /torrents\.php\?id=(\d+)/;
  it("命中", () => {
    expect(captureOr("https://x/torrents.php?id=123&a=b", re)).toBe("123");
  });
  it("不命中给空串（`match(re)![1]` 那种写法在这里会抛 TypeError）", () => {
    expect(captureOr("https://x/other", re)).toBe("");
  });
  it("null / 空串都不抛", () => {
    expect(captureOr(null, re)).toBe("");
    expect(captureOr("", re)).toBe("");
  });
});
