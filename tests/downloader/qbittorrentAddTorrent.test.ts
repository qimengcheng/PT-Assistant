/**
 * qBittorrent 发送那一圈到底把 `contentLayout` 发没发出去。
 *
 * 为什么要有这一族（与 v0.110.4 那条同一课）：判据住在 `src/shared/reseedTargetDir.ts`，
 * 但**那个串要落到 `/torrents/add` 的表单里才有用**。只测纯函数时，把驱动里那三行删掉
 * 一样全绿 —— 而它坏起来是静默的：qBittorrent 认不出的值会退回「原始」布局，
 * 界面上照旧是那条 0% 已停止，与改之前一字不差。
 */
import { describe, expect, it } from "vitest";

import QBittorrent from "@ptd/downloader/entity/qBittorrent";
import type { CAddTorrentOptions } from "@ptd/downloader";

/** 只桩掉网络那一层：`addTorrent` 本体（拼表单那一段）是驱动真身 */
async function formOf(options: Partial<CAddTorrentOptions>): Promise<FormData> {
  const client = new QBittorrent({ id: "qb1" });
  let form: FormData | undefined;
  const stub = client as unknown as {
    request: (url: string, config: { data?: FormData }) => Promise<{ data: unknown }>;
  };
  stub.request = async (_url, config) => {
    form = config.data;
    return { data: "Ok." };
  };
  // 走 magnet 那一条支路：`localDownload` 关掉才不会去下 .torrent 文件
  await client.addTorrent("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567", options);
  if (!form) throw new Error("addTorrent 压根没发出请求");
  return form;
}

describe("qBittorrent · /torrents/add 的 contentLayout", () => {
  it("报得出真名时原样发出去", async () => {
    const form = await formOf({
      addAtPaused: false,
      savePath: "/downloads/pt/玩具总动员4",
      advanceAddTorrentOptions: { contentLayout: "NoSubfolder" },
    });
    expect(form.get("contentLayout")).toBe("NoSubfolder");
    expect(form.get("savepath")).toBe("/downloads/pt/玩具总动员4");
  });

  it("认不出的串一律不发（发过去会被它静默退回「原始」，不如不发）", async () => {
    const form = await formOf({ addAtPaused: false, advanceAddTorrentOptions: { contentLayout: "NoCreateSubfolder" } });
    expect(form.get("contentLayout")).toBeNull();
  });

  it("没设这一项时表单里不出现这一格", async () => {
    const form = await formOf({ addAtPaused: false });
    expect(form.get("contentLayout")).toBeNull();
  });

  it("三个真名都放行：Original 也要能显式发（它是那一份枚举的一个成员，不是「没设」）", async () => {
    for (const value of ["Original", "Subfolder", "NoSubfolder"]) {
      const form = await formOf({ addAtPaused: false, advanceAddTorrentOptions: { contentLayout: value } });
      expect(form.get("contentLayout")).toBe(value);
    }
  });
});
