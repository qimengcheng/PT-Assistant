import type { ITorrent } from "@ptd/site";
import type { TDownloaderKey } from "@/shared/types/storages/metadata.ts";
import type { CAddTorrentOptions } from "@ptd/downloader";
import { formatDate } from "@/options/utils.ts";
import { type TPromptInDialog } from "@/options/components/appDialog.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { sendMessage } from "@/messages.ts";

export async function sendTorrentToDownloader(
  torrentItems: ITorrent[],
  downloaderId: TDownloaderKey,
  addTorrentOptions: CAddTorrentOptions,
  // 本组件被选项页与 content script 共用，而原生 prompt() 在 MV3 扩展页面是禁用的
  // （静默返回 null → 下面的取消分支恒成立，`<...>` 占位符功能整个失效），
  // 所以输入框由调用方注入。
  promptInDialog: TPromptInDialog,
): Promise<void> {
  const runtimeStore = useRuntimeStore();
  const metadataStore = useMetadataStore();

  // 预处理自定义输入
  for (const key of ["savePath", "label"] as (keyof typeof addTorrentOptions)[]) {
    if ((addTorrentOptions[key] as string).includes("<...>")) {
      // 此处允许空字符 ""， 但不允许用户取消（即取消动态替换操作则认为取消推送任务）
      const userInput = await promptInDialog(
        i18nInstance.global.t("SentToDownloaderDialog.placeholderInput", [key]),
        "",
        { allowEmpty: true },
      );
      if (userInput !== null) {
        // @ts-ignore
        addTorrentOptions[key] = (addTorrentOptions[key] as string).replace("<...>", userInput.trim());
      } else {
        // 用户取消输入 → 整个推送取消。原先走 Promise.reject，而调用方只挂了 finally，
        // 结果是「照样关窗 + emit done」，还多一条 unhandled rejection。改成早退并提示。
        runtimeStore.showSnakebar(
          i18nInstance.global.t("SentToDownloaderDialog.canceledInput", [key]),
          { color: "warning" },
        );
        return;
      }
    }
  }

  // 预构造动态替换映射表
  const nowDate = new Date();
  const baseReplaceMap: Record<string, string> = {
    "date:YYYY": formatDate(nowDate, "yyyy"),
    "date:MM": formatDate(nowDate, "MM"),
    "date:DD": formatDate(nowDate, "dd"),
  };

  // 搜索相关动态替换
  if (runtimeStore.search.searchKey !== "") {
    baseReplaceMap["search:keyword"] = runtimeStore.search.searchKey;
  }

  if (runtimeStore.search.searchPlanKey !== "") {
    baseReplaceMap["search:plan"] = metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey);
  }

  // ⚠️ 这里必须是普通 async 函数而不是 `new Promise(async …)`：
  // 原来的 executor 里 await（metadataStore.getSiteName），一旦它在循环中 reject，
  // 外层 Promise 既不 resolve 也不 reject —— 调用方 Index.vue 的 isSending 永久 true，
  // 弹窗的 mask/closable/keyboard 全锁住，只能刷新页面。
  // 约定：这个函数**永远不抛**（调用方只挂了 finally，靠 reject 走不通），
  // 取消输入也走 early return + 提示。
  const buildOptionsForTorrent = async (torrent: ITorrent): Promise<Partial<CAddTorrentOptions>> => {
    const realAddTorrentOptions: Partial<CAddTorrentOptions> = { ...addTorrentOptions };

    const replaceMap: Record<string, string> = {
      "torrent.title": torrent.title ?? "",
      "torrent.subTitle": torrent.subTitle ?? "",
      "torrent.category": (torrent.category as string) ?? "",
      ...baseReplaceMap,
    };

    if (torrent.site) {
      replaceMap["torrent.site"] = torrent.site;
      replaceMap["torrent.siteName"] = await metadataStore.getSiteName(torrent.site);
    }

    for (const key of ["savePath", "label"] as (keyof typeof realAddTorrentOptions)[]) {
      if (realAddTorrentOptions[key]) {
        if (realAddTorrentOptions[key] === "") {
          delete realAddTorrentOptions[key];
        } else {
          for (const [replaceKey, value] of Object.entries(replaceMap)) {
            // @ts-ignore
            realAddTorrentOptions[key] = (realAddTorrentOptions[key]! as string).replace(`$${replaceKey}$`, value);
          }
        }
      }
    }

    return realAddTorrentOptions;
  };

  const optionsList = await Promise.all(
    torrentItems.map((torrent) =>
      buildOptionsForTorrent(torrent).catch(() => null),
    ),
  );

  const promises = torrentItems.map((torrent, i) => {
    const realAddTorrentOptions = optionsList[i];
    if (!realAddTorrentOptions) return Promise.resolve(undefined);
    return sendMessage("downloadTorrent", {
      torrent,
      downloaderId: downloaderId,
      addTorrentOptions: realAddTorrentOptions as CAddTorrentOptions,
    }).catch((x) => {
      runtimeStore.showSnakebar(`[${torrent.title}] 发送到下载器失败！错误信息： ${x}`, { color: "error" });
    });
  });

  const status = (await Promise.all(promises)).filter((x) => x !== undefined);

  if (status.length > 0) {
    const pendingCount = status.filter((x) => x?.downloadStatus === "pending").length;
    const failedCount = status.filter((x) => x?.downloadStatus === "failed").length;
    const color = failedCount > 0 ? "warning" : "success";

    runtimeStore.showSnakebar(
      `成功发送 ${status.length - failedCount} 个任务到下载器` +
        (pendingCount > 0 ? `（${pendingCount}在下载队列中）` : "") +
        (failedCount > 0 ? `，有 ${failedCount} 个任务发送失败` : ""),
      { color },
    );
  } else {
    runtimeStore.showSnakebar("似乎并没有任务发送到下载器", { color: "warning" });
  }
}
