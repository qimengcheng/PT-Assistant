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
        return Promise.reject(`因取消输入 ${key} 中的 <...> 的内容而停止推送`); // 用户取消输入，则跳过该任务
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

  return new Promise(async (resolve) => {
    const promises = [];

    for (const torrent of torrentItems) {
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

      promises.push(
        sendMessage("downloadTorrent", {
          torrent,
          downloaderId: downloaderId,
          addTorrentOptions: realAddTorrentOptions as CAddTorrentOptions,
        }).catch((x) => {
          runtimeStore.showSnakebar(`[${torrent.title}] 发送到下载器失败！错误信息： ${x}`, { color: "error" });
        }),
      );
    }

    Promise.all(promises)
      .then((status) => {
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
      })
      .catch((x) => {
        runtimeStore.showSnakebar("有任务发送到下载器失败，请在下载历史页面重试", { color: "error" });
      })
      .finally(() => {
        resolve();
      });
  });
}
