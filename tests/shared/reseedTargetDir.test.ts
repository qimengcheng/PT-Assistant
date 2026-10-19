/**
 * 一键辅种「把目标定到数据实际所在那一层 + 不创建子文件夹」的判据。
 *
 * 吃的形状按用户 2026-10-19 那一屏摆：基准的数据在 `…/玩具总动员4.ToyStory.4.2019…/` 里，
 * 而要挂的站点种子自带 `…/Toy Story 4 2019 BluRay …/` —— 两份内容一字不差、目录名不同。
 *
 * 危险全在「`content_path` 是目录还是文件」这一格上：把它当目录发下去，下载器会新建一个叫
 * `xxx.mkv` 的**目录**并把整条重下一遍，那比原来那个 0% 坏得多。所以两种打包形状（目录种 /
 * 单文件种）**各占一条正例、也各占一条反例**（清单对不上、清单不止一条），反例一律判「不动」。
 */
import { describe, expect, it } from "vitest";

import { applyReseedTargetDir, reseedTargetDirOf } from "@/shared/reseedTargetDir.ts";
import { pickBaseDataPath } from "@/shared/reseedPath.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";

/** 他那一屏的真形状（路径与文件名都是合成值，只借形状） */
const SAVE = "/downloads/pt";
const ROOT = "玩具总动员4.ToyStory.4.2019.BluRay.2160p.x265.10bit.HDR.3Audio.mUHD-FRDS";
const FILES = [`${ROOT}/cover.jpg`, `${ROOT}/ToyStory.4.2019.mkv`, `${ROOT}/ToyStory.4.2019.nfo`];

describe("reseedTargetDirOf · 数据目录那一层", () => {
  it("多文件种：content_path 是 save_path 的直接子项且清单都在那一段下 → 目标下沉到它", () => {
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}`, filePaths: FILES })).toEqual({
      savePath: `${SAVE}/${ROOT}`,
      contentLayout: "NoSubfolder",
    });
  });

  it("数据摊在保存目录里（content_path 等于 save_path）→ 目标不动，但布局照样要换", () => {
    // 这一档不需要文件清单：单文件种的 content_path 必然多一段文件名，落不到这里
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: SAVE, filePaths: [] })).toEqual({
      savePath: SAVE,
      contentLayout: "NoSubfolder",
    });
  });

  it("单文件种：清单就那一条、且名字正好是 content_path 多出来的一段 → 目标是 save_path", () => {
    // 用户 2026-10-19 第二屏：同一份 20.09 GiB 的 .mkv，一条以文件打包（`content_path` 就是那个
    // 文件本身）、一条以目录打包。v0.111.0 只认「顶层目录」那一档，这一条被判成「不动」，
    // 于是新副本照旧在隔壁另起一个空目录、0% 下不动。
    // 注意返回的是 **save_path**，不是 content_path —— 后者是个文件名，拿它当目录发下去，
    // 下载器会新建一个叫 `xxx.mkv` 的目录并把整条重下一遍。
    expect(
      reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/ToyStory.4.2019.mkv`, filePaths: ["ToyStory.4.2019.mkv"] }),
    ).toEqual({ savePath: SAVE, contentLayout: "NoSubfolder" });
  });

  it("单文件种那一档不认「清单里那条名字对不上」——判不出就不动", () => {
    // 名字不同 ⇒ content_path 指的不是清单里那个文件，这一档的形状就不成立了
    expect(
      reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/ToyStory.4.2019.mkv`, filePaths: ["别的片子.mkv"] }),
    ).toBeNull();
    // 两条 ⇒ 那是多文件种，而它的清单又都不在某个顶层目录下 ⇒ 判不出，不动
    expect(
      reseedTargetDirOf({
        savePath: SAVE,
        contentPath: `${SAVE}/ToyStory.4.2019.mkv`,
        filePaths: ["ToyStory.4.2019.mkv", "ToyStory.4.2019.nfo"],
      }),
    ).toBeNull();
  });

  it("拿不到文件清单 → 不动（宁可辅不上，不许替他造一份重复数据）", () => {
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}`, filePaths: [] })).toBeNull();
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}`, filePaths: null })).toBeNull();
  });

  it("清单里有一条不在那个顶层目录下 → 说明那一层不是它，不动", () => {
    expect(
      reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}`, filePaths: [...FILES, "subs/chs.srt"] }),
    ).toBeNull();
  });

  it("content_path 不在 save_path 里面（两格互相矛盾）→ 判不出，不动", () => {
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: `/elsewhere/${ROOT}`, filePaths: FILES })).toBeNull();
    // 清单里那一段是**相对 save_path** 的：`ther/a.mkv` 说的是 `/d/pt/ther/a.mkv`，而 content_path
    // 报的是 `/d/other` —— 两格互相矛盾。少了「content_path 必须在 save_path 里面」那道守卫，
    // 判据会把清单第一段当成 content_path 的尾巴去比（`/d/other` 去掉 `/d/pt/` 剩下的正好是 `ther`），
    // 于是把目标定到一个跟这份数据毫无关系的目录上。
    expect(reseedTargetDirOf({ savePath: "/d/pt", contentPath: "/d/other", filePaths: ["ther/a.mkv"] })).toBeNull();
    // 这一档是那道守卫唯一独立可观测的形状：`content.slice(save.length + 1)` 折出来的那一段
    // 恰好与清单首段撞上了（`/a/bcde` 去掉前 6 个字符剩下的正是 `e`），只比清单就会放行。
    // 少了「必须在 save_path 里面」这一道，目标会被定到一个只是**字面上接着**保存目录的兄弟目录上。
    expect(reseedTargetDirOf({ savePath: "/a/bc", contentPath: "/a/bcde", filePaths: ["e/a.mkv"] })).toBeNull();
  });

  it("content_path 还往下一层 → 不是「顶层目录」那一档，不动", () => {
    // 这一条同时也是「以 `子目录/文件` 打包的单文件种」那一档：它落在 ④ 之前，照旧判不出。
    // 已知没覆盖的形状，按「判不出就不动」交回去（不是缺陷，是不替他猜目录）
    expect(
      reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}/DISC1`, filePaths: [`${ROOT}/DISC1/a.mkv`] }),
    ).toBeNull();
  });

  it("下载器压根没报 content_path（别的客户端、老版本）→ 不动", () => {
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: undefined, filePaths: FILES })).toBeNull();
    expect(reseedTargetDirOf({ savePath: SAVE, contentPath: "", filePaths: FILES })).toBeNull();
    expect(reseedTargetDirOf({ savePath: "", contentPath: `${SAVE}/${ROOT}`, filePaths: FILES })).toBeNull();
  });

  it("Windows 反斜杠与尾部斜杠都认，写回的仍是下载器报的那一份原样", () => {
    expect(
      reseedTargetDirOf({
        savePath: "D:\\PT\\movies\\",
        contentPath: "D:\\PT\\movies\\玩具总动员4",
        filePaths: ["玩具总动员4/a.mkv", "玩具总动员4/b.jpg"],
      }),
    ).toEqual({ savePath: "D:\\PT\\movies\\玩具总动员4", contentLayout: "NoSubfolder" });
  });
});

function task(over: Partial<IKeepUploadTask> = {}): IKeepUploadTask {
  return {
    id: "t1",
    time: 0,
    title: "Toy Story 4 2019 BluRay 2160p x265 10bit HDR 3Audio mUHD-FRDS",
    size: 0,
    downloadOptions: { downloaderId: "qb1", savePath: SAVE, clientName: "QB" },
    items: [{ site: "pandapt", id: "1", title: "t", link: "", url: "", size: 0 }],
    baseLocal: { hash: "abc", name: "玩具总动员4", savePath: SAVE },
    ...over,
  } as IKeepUploadTask;
}

const DIR = { savePath: `${SAVE}/${ROOT}`, contentLayout: "NoSubfolder" } as const;

describe("applyReseedTargetDir · 三处一起改", () => {
  it("目录、baseLocal 那一份快照、发送时铺开的布局同时改", () => {
    const next = applyReseedTargetDir(task(), { ...DIR });
    expect(next.downloadOptions.savePath).toBe(`${SAVE}/${ROOT}`);
    expect(next.baseLocal?.savePath).toBe(`${SAVE}/${ROOT}`);
    expect(next.downloadOptions.addTorrentOptions?.advanceAddTorrentOptions).toEqual({ contentLayout: "NoSubfolder" });
  });

  it("不碰任务上已有的那一份标签（v0.110.2 那条不许被这次带掉）", () => {
    const next = applyReseedTargetDir(
      task({ downloadOptions: { downloaderId: "qb1", savePath: SAVE, addTorrentOptions: { label: "PTBar" } } }),
      { ...DIR },
    );
    expect(next.downloadOptions.addTorrentOptions?.label).toBe("PTBar");
    expect(next.downloadOptions.addTorrentOptions?.advanceAddTorrentOptions).toEqual({ contentLayout: "NoSubfolder" });
  });

  it("判不出时原样返回：不写空布局、也不留一个空对象", () => {
    const source = task();
    expect(applyReseedTargetDir(source, null)).toBe(source);
    expect(source.downloadOptions.addTorrentOptions).toBeUndefined();
  });

  it("没有 baseLocal 的任务不硬造这一项", () => {
    const source = task();
    delete source.baseLocal;
    const next = applyReseedTargetDir(source, { ...DIR });
    expect(next.baseLocal).toBeUndefined();
    expect(next.downloadOptions.savePath).toBe(`${SAVE}/${ROOT}`);
  });

  it("改的是副本，传进去那条不动（它来自一个 computed）", () => {
    const source = task();
    applyReseedTargetDir(source, { ...DIR });
    expect(source.downloadOptions.savePath).toBe(SAVE);
    expect(source.baseLocal?.savePath).toBe(SAVE);
  });
});

describe("pickBaseDataPath · 只许把「不一致」判成「一致」", () => {
  it("content_path 等于任务目录时认它（这一档改前会误报目录不一致）", () => {
    expect(pickBaseDataPath({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}` }, `${SAVE}/${ROOT}`)).toBe(
      `${SAVE}/${ROOT}`,
    );
  });

  it("save_path 等于任务目录时照旧用它 —— 存量任务结论一字不变", () => {
    expect(pickBaseDataPath({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}` }, SAVE)).toBe(SAVE);
  });

  it("单文件种那一条：任务目录 = save_path 时用它，不会反过来被判成目录不一致", () => {
    // v0.113.1 那一档把目标写成 save_path（数据就摊在那儿），而 content_path 是里面的**文件名**。
    // 这道闸若不分先后地先认 content_path，「一致」就会被判成「不一致」，后台那道硬闸当场停发。
    expect(pickBaseDataPath({ savePath: SAVE, contentPath: `${SAVE}/Zootopia.2.2025.mkv` }, SAVE)).toBe(SAVE);
  });

  it("两边都不等于任务目录 → 仍报 save_path，与改前同一条结论", () => {
    expect(pickBaseDataPath({ savePath: SAVE, contentPath: `${SAVE}/${ROOT}` }, "/somewhere/else")).toBe(SAVE);
  });

  it("下载器没报 content_path / 连不上时退回原口径", () => {
    expect(pickBaseDataPath({ savePath: SAVE }, `${SAVE}/${ROOT}`)).toBe(SAVE);
    expect(pickBaseDataPath(undefined, SAVE)).toBeUndefined();
  });

  it("分隔符与尾部斜杠不同也算同一处", () => {
    expect(pickBaseDataPath({ savePath: "D:\\PT", contentPath: "D:/PT/movies/玩具总动员4/" }, "D:/PT/movies/玩具总动员4")).toBe(
      "D:/PT/movies/玩具总动员4/",
    );
  });
});
