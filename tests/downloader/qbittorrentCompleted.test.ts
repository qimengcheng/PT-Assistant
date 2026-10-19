/**
 * qBittorrent 那条「这条种子的数据全不全」的判据（`isFullyDownloaded`）与它在列表映射里的接线。
 *
 * 为什么值得单独钉：辅种那一路全部消费者（可辅种标记、扫描范围、基准清单、后台第 4 档、指纹本地索引）
 * 吃的都是驱动报出来的 `isCompleted`，而 qBittorrent 的 `progress` 只按**选定要下载**的那些文件算
 * （官方 WebAPI：`size` = "Total size of files selected for download"、
 * `total_size` = "Total size of all files in this torrent (including unselected ones)"）。
 * 于是「只勾了一部分文件」的种子会报 100% 而被当成已下完的基准 —— 推到别的站就是 0% 下不动
 * （用户 2026-10-19 那张截图：选定 13.93 GiB / 整条 679.51 GiB / 进度 100% / 可用性 16.1%）。
 *
 * 下面那一族 `getAllTorrents` 的用例是**接线证明**：只测纯函数不够 —— 判据写对了但映射没用它，
 * 界面上什么都不会变（这一族错都不报错）。网络那一层只顶掉 `getSyncData`，映射本体是真身。
 */
import { describe, expect, it } from "vitest";

import QBittorrent, { isFullyDownloaded } from "@ptd/downloader/entity/qBittorrent.ts";

const GiB = 1024 ** 3;

/** 一颗 `/sync/maindata` 回出来的种子：默认「整条都选了且下完了」，各用例只改自己吃的那几个字段 */
interface RawTorrent {
  progress: number;
  size: number;
  total_size: number;
  [key: string]: unknown;
}

function rawTorrent(over: Partial<RawTorrent> = {}): RawTorrent {
  return {
    name: "Wii中文游戏全集",
    hash: "ABC",
    added_on: 1_700_000_000,
    state: "uploading",
    save_path: "/data/wii",
    tracker: "https://tracker.example/announce",
    category: "",
    ratio: 1.2,
    progress: 1,
    size: 679.51 * GiB,
    total_size: 679.51 * GiB,
    ...over,
  };
}

/** 只桩掉网络那一步（`getSyncData`），映射本体照真身跑 */
async function mapOne(over: Partial<RawTorrent> = {}) {
  const client = new QBittorrent({ id: "qb1" });
  const stubbed = client as unknown as {
    getSyncData: () => Promise<{ torrents: Record<string, RawTorrent> }>;
  };
  stubbed.getSyncData = async () => ({ torrents: { ABC: rawTorrent(over) } });
  const [row] = await client.getAllTorrents();
  return row;
}

describe("isFullyDownloaded：整条都在才算「下完」", () => {
  it("整条都选了、progress 到 1 → 算下完", () => {
    expect(isFullyDownloaded(rawTorrent())).toBe(true);
  });

  it("只选了 13.93 / 679.51 GiB 而 progress 报 1 → 不算（他截图那一档）", () => {
    expect(isFullyDownloaded(rawTorrent({ size: 13.93 * GiB }))).toBe(false);
  });

  it("差一个字节也算没选全（部分选择的边界不放宽）", () => {
    const whole = 100 * GiB;
    expect(isFullyDownloaded(rawTorrent({ size: whole - 1, total_size: whole }))).toBe(false);
  });

  it("没到 100% 时与选择无关，一律不算", () => {
    expect(isFullyDownloaded(rawTorrent({ progress: 0.5 }))).toBe(false);
  });

  it("两个尺寸报不出来（旧版 WebAPI 没有 total_size、或元数据还没取到）→ 放行，不许误拦", () => {
    // 这一档是硬闸的反面：误拦会把用户**本地真有数据**的那些一起挡掉，比少判一条严重得多
    expect(isFullyDownloaded(rawTorrent({ total_size: undefined }))).toBe(true);
    expect(isFullyDownloaded(rawTorrent({ total_size: 0 }))).toBe(true);
    expect(isFullyDownloaded(rawTorrent({ size: undefined }))).toBe(true);
  });

  it("size 反而大于 total_size（数据自相矛盾）→ 不误拦，按下了算", () => {
    expect(isFullyDownloaded(rawTorrent({ size: 2 * GiB, total_size: GiB }))).toBe(true);
  });
});

describe("getAllTorrents 的映射真的用它（判据对但没接线 = 界面什么都不变）", () => {
  it("部分选择的那条：isCompleted 为假，而进度仍照实报 100（圆环不该骗人，但基准不能拿它当已下完）", async () => {
    const row = await mapOne({ size: 13.93 * GiB });
    expect(row.isCompleted).toBe(false);
    expect(row.progress).toBeCloseTo(100, 6);
    expect(row.totalSize).toBe(679.51 * GiB);
  });

  it("整条都选了的那条：isCompleted 为真", async () => {
    const row = await mapOne();
    expect(row.isCompleted).toBe(true);
  });

  it("还在下的那条：isCompleted 为假（这一半本来就没坏，钉住它不许被新判据带偏）", async () => {
    const row = await mapOne({ progress: 0.3, size: 0.3 * GiB, total_size: GiB });
    expect(row.isCompleted).toBe(false);
  });
});
