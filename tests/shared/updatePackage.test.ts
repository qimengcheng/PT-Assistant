import { describe, expect, it } from "vitest";

import {
  UPDATE_PACKAGE_SOURCES,
  isReleaseAssetUrl,
  updatePackageCandidates,
  updateSourceLabel,
  verifyUpdatePackage,
  type IUpdatePackageExpectation,
} from "@/shared/updatePackage.ts";

const GITHUB_ASSET = "https://github.com/qimengcheng/PT-Assistant/releases/download/v0.122.0/PT-Assistant-0.122.0-chrome.zip";
const RELEASE_PAGE = "https://github.com/qimengcheng/PT-Assistant/releases/tag/v0.122.0";

/** 一条真会验过的摘要（小写 hex）：逐字抄自 GitHub API 给 v0.121.0 chrome 包的那条 digest */
const SHA = "844b5d158c769782a59ab2c2d2aa46de437d928090f8d7bb0efdff7b1e54665b";

const exp = (over: Partial<IUpdatePackageExpectation> = {}): IUpdatePackageExpectation => ({
  size: 6813221,
  sha256: SHA,
  from: "github",
  ...over,
});

describe("档序：镜像在前、原链殿后（用户 2026-10-22 定的先后）", () => {
  it("三条候选逐字是 ghproxy.net → gh-proxy.com → GitHub 原链", () => {
    expect(updatePackageCandidates(GITHUB_ASSET)).toEqual([
      `https://ghproxy.net/${GITHUB_ASSET}`,
      `https://gh-proxy.com/${GITHUB_ASSET}`,
      GITHUB_ASSET,
    ]);
  });

  it("表里就这两台镜像，且顺序不许被 sort 之类的改动打乱", () => {
    expect([...UPDATE_PACKAGE_SOURCES]).toEqual(["https://ghproxy.net/", "https://gh-proxy.com/"]);
  });

  it("不是资产直链（备用通道给的 Release 网页）就原样一条：不许给网页拼镜像前缀", () => {
    expect(updatePackageCandidates(RELEASE_PAGE)).toEqual([RELEASE_PAGE]);
  });

  it("显示名取域名：镜像那两档各报自己的域名", () => {
    expect(updateSourceLabel(`https://gh-proxy.com/${GITHUB_ASSET}`)).toBe("gh-proxy.com");
    expect(updateSourceLabel(GITHUB_ASSET)).toBe("github.com");
  });
});

describe("什么算「真资产直链」", () => {
  it("GitHub 原链与镜像前缀式都认", () => {
    expect(isReleaseAssetUrl(GITHUB_ASSET)).toBe(true);
    expect(isReleaseAssetUrl(`https://gh-proxy.com/${GITHUB_ASSET}`)).toBe(true);
  });

  it("Release 网页 / tag 页不认：把它交给下载管理器会存下一个名字像 zip 的 HTML", () => {
    expect(isReleaseAssetUrl(RELEASE_PAGE)).toBe(false);
    expect(isReleaseAssetUrl("https://github.com/qimengcheng/PT-Assistant/releases/latest")).toBe(false);
  });

  it("前缀式的内层必须仍是 GitHub 原链：任意主机 + 任意 .zip 不认", () => {
    expect(isReleaseAssetUrl("https://evil.example/https://other.example/x/y/releases/download/v/z.zip")).toBe(false);
    expect(isReleaseAssetUrl("https://evil.example/x/y/releases/download/v1/z.zip")).toBe(false);
  });
});

/** zip 的文件头：`PK\x03\x04`（有文件）与 `PK\x05\x06`（空包） */
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const EMPTY_ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
/** 一段 HTML 的头（`<!doctype`）—— 镜像回错误页那一族的形状 */
const HTML_HEAD = new Uint8Array([0x3c, 0x21, 0x64, 0x6f]);

const ok6813221 = (over: Partial<{ bytes: number; head: Uint8Array; sha256: string }> = {}) => ({
  bytes: 6813221,
  head: ZIP_HEAD,
  sha256: SHA,
  ...over,
});

describe("落地之前的包校验", () => {
  it("字节数、文件头与摘要全对上 → 放行", () => {
    expect(verifyUpdatePackage(exp(), ok6813221())).toBe("ok");
  });

  it(
    "「是不是 zip」判的是文件头，不是算出来的摘要串：真包的摘要开头未必像 zip（这条就是那处写错的回归位）",
    () => {
      // 用的正是 GitHub 给 v0.121.0 chrome 包的那条真摘要，它开头是 844b —— 拿它去比 504b 会误判
      expect(SHA.startsWith("504b")).toBe(false);
      expect(verifyUpdatePackage(exp(), ok6813221())).toBe("ok");
    },
  );

  it("摘要给大写也放行（GitHub 那条是小写，但比较不许因此判成被换包）", () => {
    expect(verifyUpdatePackage(exp({ sha256: SHA.toUpperCase() }), ok6813221())).toBe("ok");
  });

  it("压根没有摘要 → noDigest，不去比字节", () => {
    expect(verifyUpdatePackage(exp({ sha256: "" }), ok6813221())).toBe("noDigest");
  });

  it(
    "摘要来自镜像 → 不认，**即使字节摘要逐字相等**：拿镜像给的锚验镜像送的字节，换包检不出来",
    () => {
      expect(verifyUpdatePackage({ size: 30, sha256: SHA, from: "mirror" }, ok6813221({ bytes: 30 }))).toBe(
        "untrustedDigest",
      );
      expect(verifyUpdatePackage(exp({ from: "html" }), ok6813221())).toBe("untrustedDigest");
    },
  );

  it("字节数与记录不符 → sizeMismatch（先判长度，别把半包说成被换包）", () => {
    expect(verifyUpdatePackage(exp(), ok6813221({ bytes: 4000000 }))).toBe("sizeMismatch");
  });

  it("size 报不出（0）时不许当「字节数不符」：那是哨兵不是数据", () => {
    // 摘要当然对不上（夹具给的是另一串），所以这一条要报 digestMismatch 而不是 sizeMismatch ——
    // 判据把「不知道多大」误判成「大小不符」的话，界面会说「包不完整」，而根本无从谈下没下完。
    expect(verifyUpdatePackage({ size: 0, sha256: SHA, from: "github" }, ok6813221({ bytes: 12345, sha256: "f".repeat(64) }))).toBe(
      "digestMismatch",
    );
  });

  it(
    "200 但送的不是 zip → notZip，且这一档排在摘要比对之前（否则界面把「镜像没在传包」说成「包被换过」）",
    () => {
      // 字节数刻意与记录一致、摘要也当然对不上 —— 若把 notZip 挪到摘要之后，这一条会变 digestMismatch
      expect(verifyUpdatePackage(exp(), ok6813221({ head: HTML_HEAD }))).toBe("notZip");
    },
  );

  it("zip 头认空包那种（PK\\x05\\x06）", () => {
    const emptySha = "0".repeat(64);
    expect(verifyUpdatePackage({ size: 22, sha256: emptySha, from: "github" }, { bytes: 22, head: EMPTY_ZIP_HEAD, sha256: emptySha })).toBe(
      "ok",
    );
  });

  it("文件头是 zip、摘要不符 → digestMismatch", () => {
    expect(verifyUpdatePackage(exp(), ok6813221({ sha256: "f".repeat(64) }))).toBe("digestMismatch");
  });
});
