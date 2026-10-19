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
    ).toEqual({ savePath: SAVE, contentLayout: "NoSubfolder", contentIsFile: true });
  });

  it("单文件种的那个文件装在子目录里 → 目标是它所在那一层，不是 save_path", () => {
    // 用户 2026-10-19 第三屏：基准的内容面板是「文件夹 + 一个 .mp4」（`content_path` 比 `save_path`
    // 深两层，最后那一段是文件名），要挂的那站是裸文件。v0.113.1 只认不带目录的那一半，
    // 这一档判不出 ⇒ 走老路把裸文件放到 `save_path`，而数据在里面的文件夹里 ⇒ 0% 丢失文件。
    expect(
      reseedTargetDirOf({
        savePath: SAVE,
        contentPath: `${SAVE}/示例影片2/示例影片2.mp4`,
        filePaths: ["示例影片2/示例影片2.mp4"],
      }),
    ).toEqual({ savePath: `${SAVE}/示例影片2`, contentLayout: "NoSubfolder", contentIsFile: true });
  });

  it("再往里几层也一样：切掉的是文件名那一段", () => {
    expect(
      reseedTargetDirOf({ savePath: "/d/pt", contentPath: "/d/pt/a/b/c.mkv", filePaths: ["a/b/c.mkv"] }),
    ).toEqual({ savePath: "/d/pt/a/b", contentLayout: "NoSubfolder", contentIsFile: true });
  });

  it("切出来的那一层保持下载器报的原样写法（反斜杠不折成斜杠）", () => {
    expect(
      reseedTargetDirOf({
        savePath: "D:\\PT\\movies",
        contentPath: "D:\\PT\\movies\\示例影片\\示例影片.mkv",
        filePaths: ["示例影片/示例影片.mkv"],
      }),
    ).toEqual({ savePath: "D:\\PT\\movies\\示例影片", contentLayout: "NoSubfolder", contentIsFile: true });
  });

  it("单文件种那一档不认「清单里那条名字对不上」——判不出就不动", () => {
    // 名字不同 ⇒ content_path 指的不是清单里那个文件，这一档的形状就不成立了
    expect(
      reseedTargetDirOf({ savePath: SAVE, contentPath: `${SAVE}/ToyStory.4.2019.mkv`, filePaths: ["别的片子.mkv"] }),
    ).toBeNull();
    // 带子目录时同理：清单那条与 content_path 对不上 ⇒ 不动
    expect(
      reseedTargetDirOf({
        savePath: SAVE,
        contentPath: `${SAVE}/Dir/Dir.mp4`,
        filePaths: ["别的目录/别的片子.mp4"],
      }),
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
    // 这一档 `content_path` 指的是一个**目录**（清单里那条 `ROOT/DISC1/a.mkv` 在它里面），
    // 既不是④（那个文件）也不是③（直接子项）⇒ 判不出就不动，别替他猜哪一层是数据
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

  it("③ 那一档不写 contentIsFile：基准的 content_path 是个目录，不该被当成文件", () => {
    const next = applyReseedTargetDir(task(), { ...DIR });
    expect(next.baseLocal?.contentIsFile).toBeUndefined();
  });

  it("④ 那一档要同时把「那是个文件」记进任务（目录一致性那道判据自己分不开）", () => {
    const next = applyReseedTargetDir(task(), {
      savePath: `${SAVE}/${ROOT}`,
      contentLayout: "NoSubfolder",
      contentIsFile: true,
    });
    expect(next.baseLocal?.savePath).toBe(`${SAVE}/${ROOT}`);
    expect(next.baseLocal?.contentIsFile).toBe(true);
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

  it("基准的文件装在子目录里：任务目录 = 它的父目录时认（要带着 contentIsFile 才认）", () => {
    // v0.114.1 那一档把目标定成 `save_path/子目录`（数据是 `save_path/子目录/文件`）。
    // 而下载器报的 save_path 是再上一层，content_path 又比任务目录多一段文件名 ——
    // 两格都不等于任务目录，不补这一支就会在一条已经对了的任务上挂出永久的「目录不一致」。
    const live = { savePath: SAVE, contentPath: `${SAVE}/${ROOT}/${ROOT}.mp4` };
    expect(pickBaseDataPath(live, `${SAVE}/${ROOT}`, true)).toBe(`${SAVE}/${ROOT}`);
  });

  it("没记 contentIsFile 时不许拿父目录当一致：那是一条真的不一致", () => {
    // 基准是「一个文件装在 `/d/pt/a` 里」而任务目录写的是 `/d/pt`（多文件种的顶层目录也长这样：
    // content_path 是 save_path 的子项）。这时 content_path 的父目录恰好等于任务目录，
    // 不看那道标记就会把一条真的「不一致」判成「一致」—— 该给的提示和该拦的发送一起被放掉。
    const live = { savePath: "/d/pt", contentPath: "/d/pt/a/x.mkv" };
    expect(pickBaseDataPath(live, "/d/pt")).toBe("/d/pt");
    expect(pickBaseDataPath(live, "/d/pt", false)).toBe("/d/pt");
    // 反过来，任务目录记着「那是个文件」时同一份数据判成一致（= ④ 那一档建出来的任务）
    expect(pickBaseDataPath(live, "/d/pt/a", true)).toBe("/d/pt/a");
    // 这一条才是上面那道标记的判据：同一份数据、同一个任务目录，没记就**不许**认
    expect(pickBaseDataPath(live, "/d/pt/a")).toBe("/d/pt");
  });

  it("父目录那一支只认紧邻的上一层，不替他猜更深的目录", () => {
    const live = { savePath: "/d/pt", contentPath: "/d/pt/a/b/x.mkv" };
    expect(pickBaseDataPath(live, "/d/pt/a/b", true)).toBe("/d/pt/a/b");
    expect(pickBaseDataPath(live, "/d/pt/a", true)).toBe("/d/pt");
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
