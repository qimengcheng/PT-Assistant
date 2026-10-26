/**
 * qBittorrent 那条「下载器报的状态 → 界面那一格」的映射表。
 *
 * 为什么要钉这张表：它是**兜底静默**的形状 —— 表里少一个名字，`switch` 落到 default 就交回
 * `unknown`，界面画成灰色那颗「未知」，不报错、不进 vue-tsc、不进构建。更糟的是操作列：
 * 那颗暂停/恢复键的 `v-if` 只认 downloading/seeding/paused/error（`Index.vue:1408`），
 * 于是这一行**两颗键都没有**，用户在界面上对它做任何事都做不到（用户 2026-10-26 那张截图）。
 *
 * 触发这一次的具体缺口：qBittorrent 5.0（WebAPI 2.11.0）把 `pausedUP` / `pausedDL` 改名成
 * `stoppedUP` / `stoppedDL`，并加了 `forcedMetaDL`。同一次改名在 `pauseTorrent` 那一步是处理过的
 * （端点换成 `/torrents/stop`），状态这一半漏了 —— 而仓里另一处（辅种那一路的
 * `KeepUploadTask/seedVerify.ts:92`）早就把两个写法并列认了，所以这不是"上游没改"，是**同一份
 * 事实只在一处被回收**。
 *
 * 下面全部走真 `getAllTorrents()`（只顶掉 `getSyncData` 那一层网络），映射本体是真身：
 * 只测那张表的话，改对了表却忘了接线，界面上一个字都不会变。
 */
import { describe, expect, it } from "vitest";

import { CTorrentState } from "@ptd/downloader/types.ts";
import QBittorrent from "@ptd/downloader/entity/qBittorrent.ts";

interface RawTorrent {
  [key: string]: unknown;
}

/** 只桩掉网络那一步，其余照真身跑 */
async function mapOne(state: string): Promise<{ state: CTorrentState; stateRaw?: string }> {
  const client = new QBittorrent({ id: "qb1" });
  const stubbed = client as unknown as { getSyncData: () => Promise<{ torrents: Record<string, RawTorrent> }> };
  stubbed.getSyncData = async () => ({
    torrents: {
      ABC: {
        name: "以法之名.In.the.Name.of.Justice.2025.S01.2160p",
        hash: "ABC",
        added_on: 1_700_000_000,
        state,
        save_path: "G:\\TVSeries",
        tracker: "https://tracker.example/announce",
        category: "",
        ratio: 5.05,
        progress: 1,
        size: 35.21 * 1024 ** 3,
        total_size: 35.21 * 1024 ** 3,
      },
    },
  });
  const [row] = await client.getAllTorrents();
  return row;
}

async function mapState(state: string): Promise<CTorrentState> {
  return (await mapOne(state)).state;
}

describe("qBittorrent 状态映射：5.0 改名的那一档", () => {
  it("stoppedUP（5.0 的 pausedUP）→ 已暂停，不再落进未知", async () => {
    expect(await mapState("stoppedUP")).toBe(CTorrentState.paused);
  });

  it("stoppedDL（5.0 的 pausedDL）→ 已暂停", async () => {
    expect(await mapState("stoppedDL")).toBe(CTorrentState.paused);
  });

  it("forcedMetaDL（5.0 新增）→ 下载中，与 metaDL 同一档", async () => {
    expect(await mapState("forcedMetaDL")).toBe(CTorrentState.downloading);
  });

  /** 改名是"新增"不是"替换"：4.x 那两串仍在报，认新不许丢旧 */
  it("旧写法 pausedUP / pausedDL 照旧是已暂停", async () => {
    expect(await mapState("pausedUP")).toBe(CTorrentState.paused);
    expect(await mapState("pausedDL")).toBe(CTorrentState.paused);
  });

  it("表里真没有的名字仍然交回未知（不许顺手猜一个档）", async () => {
    expect(await mapState("someBrandNewState")).toBe(CTorrentState.unknown);
  });

  it("qBittorrent 自己那个 \"unknown\" 走的是错误档，不是界面的未知（两件事别混）", async () => {
    expect(await mapState("unknown")).toBe(CTorrentState.error);
  });

  it("做种中/下载中/检查中三档没被这次改动带歪", async () => {
    expect(await mapState("stalledUP")).toBe(CTorrentState.seeding);
    expect(await mapState("uploading")).toBe(CTorrentState.seeding);
    expect(await mapState("stalledDL")).toBe(CTorrentState.downloading);
    expect(await mapState("checkingUP")).toBe(CTorrentState.checking);
  });
});

/**
 * `stateRaw` 这一格是「界面那句说明」的输入，不是调试字段。
 *
 * 为什么单独钉：归一表没命中的那一档，界面上原先只剩「未知」两个字，而「是哪个值没进表」
 * 只有下载器知道 —— 这一次（qBittorrent 5.0 改名）就是靠猜猜了两轮。
 * 判据不许在界面里读 `raw` 的各家键名（`packages/downloader/types.ts` 那条口径），
 * 所以原文要由**产出这一格的驱动**逐字转一份出来。
 */
describe("qBittorrent 状态原文（stateRaw）", () => {
  it("认不出的名字：原文逐字带出来，界面才知道该补哪一档", async () => {
    expect((await mapOne("someBrandNewState")).stateRaw).toBe("someBrandNewState");
  });

  it("认得出的名字也照样带原文（这一格是「原样」，不是只在坏档才填）", async () => {
    expect((await mapOne("stoppedUP")).stateRaw).toBe("stoppedUP");
  });
});
