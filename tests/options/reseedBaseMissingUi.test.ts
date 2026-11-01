/**
 * 「基准那条不在下载器里」这一位在界面上有没有真被用起来。
 *
 * 为什么单独一份（而不是并进 `tests/shared/reseedBasePresence.test.ts`）：本轮撞上的形状是
 * **判据写对了、全绿、界面上没接上**（v0.128.0 那条反证教训的第三型）。纯判据改坏了会红，
 * 但把 `page.baseLocal?.missingInClient` 那一行删掉，判据一条都不会红 —— 只有按源码文本
 * 钉住模板与调用点才分得开这两种坏法。
 *
 * 读源码文本前先归一化换行符：本仓工作区的换行不是常量（`core.autocrlf`，见 v0.122.x 那条）。
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const page = read("src/options/views/Overview/KeepUploadTask/Index.vue");
const dialog = read("src/options/views/Overview/SearchEntity/KeepUploadDialog.vue");
const offscreen = read("src/entrypoints/offscreen/utils/download.ts");

describe("辅种任务那一格：不在场就说不在场", () => {
  it("两种说法分开，且「目录不一致 + 正在搬 + 两颗处置键」整族留在 v-else 里", () => {
    expect(page).toMatch(
      /v-if="record\.task\.baseLocal\?\.missingInClient"[\s\S]{0,600}KeepUploadTask\.pathMismatch\.baseMissing"/,
    );
    expect(page).toMatch(/<template v-else>[\s\S]{0,1200}KeepUploadTask\.pathMismatch\.short"/);
    // 处置键画在 v-else 里面：不在场时点它们等于打在一条下载器里没有的种子上（移动要发那个 id）
    const elseAt = page.indexOf("<template v-else>", page.indexOf("pathMismatch.baseMissing"));
    expect(elseAt).toBeGreaterThan(-1);
    expect(page.indexOf("moveLocalBaseToTaskPath(record.task)")).toBeGreaterThan(elseAt);
    expect(page.indexOf("useLocalBasePath(record.task)")).toBeGreaterThan(elseAt);
  });

  it("发送那道闸的措辞跟着分档：不能再让人「在那一行选一种处置」", () => {
    expect(page).toMatch(
      /task\.baseLocal\?\.missingInClient\s*\?\s*t\("KeepUploadTask\.pathMismatch\.sendBlockedBaseMissing"\)\s*:\s*t\("KeepUploadTask\.pathMismatch\.sendBlocked"\)/,
    );
  });

  it("盯「搬完落地」那几趟遇到不在场当场结束，且那句「仍未移到任务目录」排在它之后（不会再被报出来）", () => {
    const at = page.indexOf("if (task.baseLocal?.missingInClient) return;");
    expect(at).toBeGreaterThan(-1);
    expect(page.indexOf("pathMismatch.moveTimeout")).toBeGreaterThan(at);
  });
});

describe("建任务那一路：问的是判据的产出", () => {
  it("在场性交给 resolveLiveLocalBase，三条出路各写各的", () => {
    expect(dialog).toMatch(/resolveLiveLocalBase\(\s*baseEntry,\s*localIndex\.value,\s*live\.map\(/);
    expect(dialog).toMatch(/resolved\.kind === "replaced"/);
    expect(dialog).toMatch(/resolved\.kind === "blocked"/);
    for (const key of ["goneAmbiguous", "goneNoLiveCopy", "goneNoEvidence", "goneSwapped"]) {
      expect(dialog).toContain(`SearchEntity.KeepUploadDialog.localBase.${key}`);
    }
  });

  it("换过基准时那句「正在搬」不许写 —— 那句说的得是他点过的那一条", () => {
    expect(dialog).toMatch(/baseMoveRequested\.value && !swappedBaseName \? true : undefined/);
  });

  it("取列表失败不许把建任务挡掉（「查不了」不是「没有」）", () => {
    expect(dialog).toMatch(/sendMessage\("getClientTorrents", selectedDownloaderId\.value\)\.catch\(\(\) => null\)/);
    expect(dialog).toMatch(/if \(live\) \{/);
  });
});

describe("删除那一路：让那份缓存当场作废", () => {
  it("删除成功后清的是整台下载器的本地指纹索引（消息里递的 id 各家含义不同，摘不干净）", () => {
    expect(offscreen).toMatch(/if \(deleteStatus\) \{[\s\S]{0,1200}await clearLocalFingerprintIndex\(downloaderId\)/);
  });
});

describe("两份 locale 的键必须成对（防线③看不见动态键，这一族是字面键，让它替我们查一遍）", () => {
  /** 只声明这一族走到的那三层，别的键不管 —— 用了 `any` 反而会把「键不存在」读成 `undefined` 之外的东西 */
  type LocaleSlice = {
    KeepUploadTask: { pathMismatch: Record<string, string> };
    SearchEntity: { KeepUploadDialog: { localBase: Record<string, string> } };
  };
  const zh = JSON.parse(read("src/locales/zh_CN.json")) as LocaleSlice;
  const en = JSON.parse(read("src/locales/en.json")) as LocaleSlice;

  for (const key of ["baseMissing", "baseMissingTip", "sendBlockedBaseMissing"]) {
    it(`KeepUploadTask.pathMismatch.${key} 两侧都在`, () => {
      expect(typeof zh.KeepUploadTask.pathMismatch[key]).toBe("string");
      expect(typeof en.KeepUploadTask.pathMismatch[key]).toBe("string");
    });
  }

  for (const key of ["goneAmbiguous", "goneNoLiveCopy", "goneNoEvidence", "goneSwapped"]) {
    it(`SearchEntity.KeepUploadDialog.localBase.${key} 两侧都在`, () => {
      expect(typeof zh.SearchEntity.KeepUploadDialog.localBase[key]).toBe("string");
      expect(typeof en.SearchEntity.KeepUploadDialog.localBase[key]).toBe("string");
    });
  }

  it("带插值的那几条，占位符与调用点传的参数对得上", () => {
    expect(zh.KeepUploadTask.pathMismatch.baseMissingTip).not.toMatch(/\{[a-z]+}/i);
    expect(zh.SearchEntity.KeepUploadDialog.localBase.goneAmbiguous).toContain("{n}");
    expect(zh.SearchEntity.KeepUploadDialog.localBase.goneSwapped).toContain("{name}");
  });
});
