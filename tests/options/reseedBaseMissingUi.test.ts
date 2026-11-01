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
const autoReseed = read("src/entrypoints/background/utils/autoReseed.ts");

/** 只声明这一族走到的那三层，别的键不管 —— 用了 `any` 反而会把「键不存在」读成 `undefined` 之外的东西 */
type LocaleSlice = {
  KeepUploadTask: { pathMismatch: Record<string, string> };
  SearchEntity: { KeepUploadDialog: { localBase: Record<string, string> } };
};
const zh = JSON.parse(read("src/locales/zh_CN.json")) as LocaleSlice;
const en = JSON.parse(read("src/locales/en.json")) as LocaleSlice;

/** 不在场那一支：从它的 `v-if` 起到 `<template v-else>` 为止的那一段模板 */
function absentBranch() {
  const from = page.indexOf('v-if="record.task.baseLocal?.missingInClient"');
  const to = page.indexOf("<template v-else>", from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return page.slice(from, to);
}

describe("辅种任务那一格：不在场就说不在场", () => {
  it("两种说法分开，「目录不一致 + 正在搬」整族留在 v-else 里", () => {
    expect(absentBranch()).toContain('KeepUploadTask.pathMismatch.baseMissing"');
    expect(page).toMatch(/<template v-else>[\s\S]{0,1200}KeepUploadTask\.pathMismatch\.short"/);
  });

  it("不在场那一支只留「改用本地那份的目录」，不画那颗要发不存在 id 的移动键", () => {
    // 这一支里唯一还能点得动的出路就是它：那颗键只改记录，不碰下载器
    expect(absentBranch()).toContain("useLocalBasePath(record.task)");
    // ⚠️ 反过来那颗移动键必须留在 v-else 里：它 `setClientTorrentLocation` 发的是基准那条的 id
    const later = page.slice(page.indexOf("<template v-else>"));
    expect(later).toContain("moveLocalBaseToTaskPath(record.task)");
    expect(absentBranch()).not.toContain("moveLocalBaseToTaskPath(record.task)");
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

  it("那两句说明指的键，必须真是这一格里画得出来的那颗", () => {
    // v0.131.0 那一版写的是「请在下面的条目行点「设为基准种子」」，而那颗键对 baseLocal 这种任务
    // 整列是**禁用**的（下面那条 :disabled 判据就是它）—— 等于把人指到一个按不动的键上。
    for (const key of ["baseMissingTip", "sendBlockedBaseMissing"]) {
      // 指的名字要与界面那颗的**值**逐字同值，不是我自己印象里的那个词
      expect(zh.KeepUploadTask.pathMismatch[key]).toContain(zh.KeepUploadTask.pathMismatch.useBase);
      expect(en.KeepUploadTask.pathMismatch[key]).toContain(en.KeepUploadTask.pathMismatch.useBase);
      expect(zh.KeepUploadTask.pathMismatch[key]).not.toContain("设为基准种子");
      expect(en.KeepUploadTask.pathMismatch[key]).not.toContain("Set as base torrent");
    }
    expect(page).toMatch(/:disabled="record\.index === 0 \|\| !!record\.task\.baseLocal/);
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

describe("后台那一轮：不在场就不催「立刻重查」", () => {
  it("催那一趟的前提是「有人会把新路径报回来」，基准不在场时这条不成立", () => {
    // 否则每一轮都白读一遍下载器列表，而结论一个字都不会变
    expect(autoReseed).toMatch(
      /if \(task\.baseLocal\?\.moveToTaskPath && !task\.baseLocal\.missingInClient\) quickRecheckPending = true/,
    );
    // 而「把实时路径写回任务」那一步仍然照跑 —— 那正是界面那句改口的来路
    expect(autoReseed).toMatch(/if \(torrents\) await persistBaseLocalPath\(task, torrents, categories\);/);
  });
});

describe("两份 locale 的键必须成对（防线③看不见动态键，这一族是字面键，让它替我们查一遍）", () => {
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
