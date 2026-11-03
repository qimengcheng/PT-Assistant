/**
 * 「把这条任务的数据移到我说的那个目录」那三道判据。
 *
 * 这三道每一条都会决定**要不要往用户数据上写东西**（发 `setLocation`、改任务的 `savePath`），
 * 所以判错一档不是显示不对，是搬错东西。按本仓口径判据收在 `src/shared/` 才有 Node 断言，
 * 也就才进得了反证。
 */
import { describe, expect, it } from "vitest";

import { judgeMoveTarget, pickLivePath, pickMoveBaseHash } from "@/shared/reseedMoveTarget.ts";

describe("pickMoveBaseHash：要挪的是下载器里哪一条", () => {
  it("baseLocal 型认 baseLocal.hash", () => {
    expect(pickMoveBaseHash({ baseLocal: { hash: "AA" }, items: [{ hash: "bb" }] })).toEqual({ hash: "AA" });
  });

  it("列表基准型认 items[0].hash（与发送那一步同一个口径）", () => {
    expect(pickMoveBaseHash({ items: [{ hash: "cc" }, { hash: "dd" }] })).toEqual({ hash: "cc" });
  });

  it("baseLocal 在位而 hash 是空串时**不许**退到 items[0]", () => {
    // items[0] 是待辅条目，不是数据所在。拿它的 hash 去发 setLocation 等于把 B 站那条
    // 当成 A 那份数据搬走 —— 比"这条判不出"坏得多。
    //
    // ⚠️ 空串这一档是**唯一能测出来**的那一档：反证里把实现改成 `baseLocal?.hash || items[0]?.hash`
    // 时，`"  "` 那一条两种写法结论相同（`||` 对空格串不短路，随后 trim 才判空），只有 `""` 会让
    // `||` 真的退到 items[0]。同一形状本仓记过：夹具要给在两道判据的**差集**里，不然反证报绿
    // 既可能是断言太弱，也可能是那道守卫本来就冗余 —— 这两个结论必须分得开。
    expect(pickMoveBaseHash({ baseLocal: { hash: "" }, items: [{ hash: "cc" }] })).toEqual({ block: "noHash" });
    expect(pickMoveBaseHash({ baseLocal: { hash: "  " }, items: [{ hash: "cc" }] })).toEqual({ block: "noHash" });
    expect(pickMoveBaseHash({ baseLocal: { hash: null }, items: [{ hash: "cc" }] })).toEqual({ block: "noHash" });
  });

  it("baseLocal 显式为 null 时退回 items[0]（那是列表基准型任务的写法）", () => {
    expect(pickMoveBaseHash({ baseLocal: null, items: [{ hash: "ee" }] })).toEqual({ hash: "ee" });
  });

  it("两边都没有 → noHash，而不是拿空串去匹配", () => {
    expect(pickMoveBaseHash({ baseLocal: {}, items: [{}] })).toEqual({ block: "noHash" });
    expect(pickMoveBaseHash({ items: [] })).toEqual({ block: "noHash" });
  });

  it("hash 记成数字时收口成串（各家 id 类型不同，见 `CTorrent.id`）", () => {
    expect(pickMoveBaseHash({ items: [{ hash: 12345 }] })).toEqual({ hash: "12345" });
  });
});

describe("pickLivePath：那条种子此刻在哪个目录", () => {
  it("找到就报它的目录（原样串，只做 trim）", () => {
    expect(pickLivePath([{ infoHash: "aa", savePath: " D:/pt/电影 " }], "AA")).toEqual({ path: "D:/pt/电影" });
  });

  it("大小写不同也认得出来（infoHash 一律按小写比）", () => {
    expect(pickLivePath([{ infoHash: "AbCd", savePath: "/x" }], "abcd")).toEqual({ path: "/x" });
  });

  it("列表里没有这一条 = notFound（这是「它不在下载器」，与「连不上」是两句话）", () => {
    expect(pickLivePath([{ infoHash: "aa", savePath: "/x" }], "bb")).toEqual({ block: "notFound" });
  });

  it("种子在、但这台没报 save_path → 仍是找到，path 是空串", () => {
    // 这一档不许并进 notFound：种子的确在，setLocation 发得出也挪得动，只是比不出"是不是已经在目标"。
    expect(pickLivePath([{ infoHash: "aa" }, { infoHash: "bb", savePath: null }], "aa")).toEqual({ path: "" });
    expect(pickLivePath([{ infoHash: "bb", savePath: null }], "bb")).toEqual({ path: "" });
  });

  it("递进来的 hash 是空串 → notFound，不许去匹配同样没报 infoHash 的那条", () => {
    // 匹配上就是凭空造出一个「找到了」，随后会往一个不认识的 id 发搬运
    expect(pickLivePath([{ infoHash: "", savePath: "/x" }], "  ")).toEqual({ block: "notFound" });
  });

  it("空列表 → notFound（这台上一条都没有）", () => {
    expect(pickLivePath([], "aa")).toEqual({ block: "notFound" });
  });
});

describe("judgeMoveTarget：人填的那一串能不能当移动目标", () => {
  it("没填、只有空格 → empty", () => {
    expect(judgeMoveTarget({ raw: "", currentPath: "/x" })).toEqual({ kind: "empty" });
    expect(judgeMoveTarget({ raw: "   \t ", currentPath: "/x" })).toEqual({ kind: "empty" });
  });

  it("`category:xxx` → category：那是分类名，setLocation 只认目录", () => {
    expect(judgeMoveTarget({ raw: "category:电影", currentPath: "/x" })).toEqual({ kind: "category" });
    expect(judgeMoveTarget({ raw: "  category: 电影", currentPath: "/x" })).toEqual({ kind: "category" });
  });

  it("带发送时才展开的占位符 → placeholder（展开后每条各是一个目录，不是一个目录）", () => {
    expect(judgeMoveTarget({ raw: "D:/pt/$torrent.title$", currentPath: "/x" })).toEqual({ kind: "placeholder" });
    expect(judgeMoveTarget({ raw: "D:/pt/<...>", currentPath: "/x" })).toEqual({ kind: "placeholder" });
  });

  it("数据已经在目标目录 → ok 且 needRelocate 为假（这一趟只该改记录，不该白发一圈搬运）", () => {
    expect(judgeMoveTarget({ raw: "D:/pt/电影", currentPath: "D:\\pt\\电影\\" })).toMatchObject({
      kind: "ok",
      needRelocate: false,
    });
  });

  it("同一处的几种写法都判成「已经在」：反斜杠、重复斜杠、尾斜杠、盘符大小写", () => {
    for (const current of ["d:\\pt\\电影", "D:/pt//电影/", "  D:/pt/电影  "]) {
      expect(judgeMoveTarget({ raw: "D:/pt/电影", currentPath: current }), `比较的是 ${current}`).toMatchObject({
        kind: "ok",
        needRelocate: false,
      });
    }
  });

  it("UNC 路径：前导的两个斜杠不许被折叠成一个（那是服务器名不是目录）", () => {
    expect(judgeMoveTarget({ raw: "//NAS/share/pt", currentPath: "\\\\NAS\\share\\pt\\" })).toMatchObject({
      kind: "ok",
      needRelocate: false,
    });
    // 而折叠过的那一份与它不是同一处 —— 判成同一处就是把一条真的不一致放过去
    expect(judgeMoveTarget({ raw: "//NAS/share/pt", currentPath: "/NAS/share/pt" })).toMatchObject({
      kind: "ok",
      needRelocate: true,
    });
  });

  it("Linux 的 `/vol1/A` 与 `/vol1/a` 是两个目录，不许判成同一处", () => {
    expect(judgeMoveTarget({ raw: "/vol1/A", currentPath: "/vol1/a" })).toMatchObject({
      kind: "ok",
      needRelocate: true,
    });
  });

  it("这台没报出当前目录时照发（保守：确实在那儿但不能因为比不出来就拒绝移动）", () => {
    expect(judgeMoveTarget({ raw: "/data/pt", currentPath: "" })).toEqual({
      kind: "ok",
      path: "/data/pt",
      needRelocate: true,
    });
    expect(judgeMoveTarget({ raw: "/data/pt" })).toEqual({ kind: "ok", path: "/data/pt", needRelocate: true });
  });

  it("返回的 path 是**原样**那一串：不折叠分隔符、不去尾斜杠、不改大小写", () => {
    // 它会被写进任务的 savePath、会显示在界面上、也会发给下载器，保持他写的写法最不容易在别处对不上账
    expect(judgeMoveTarget({ raw: "  D:\\PT\\电影\\  ", currentPath: "/elsewhere" })).toEqual({
      kind: "ok",
      path: "D:\\PT\\电影\\",
      needRelocate: true,
    });
  });
});
