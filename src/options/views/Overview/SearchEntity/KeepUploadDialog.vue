<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SyncOutlined,
} from "@antdv-next/icons";

import type { ITorrent } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import type { ITorrentInfoForVerification } from "@/messages.ts";
import type { IKeepUploadTask, IKeepUploadTaskItem, IKeepUploadTaskDownloadOptions } from "@/shared/types.ts";
import {
  buildFingerprintIndexLookup,
  decideFingerprintAction,
  diffFileLists,
  matchLocalFingerprint,
  type IFingerprintComparable,
  type IFingerprintIndexLookup,
  type IFingerprintMatchResult,
  type IFingerprintPolicyDecision,
  type ILocalFingerprintIndex,
  type ILocalTorrentFingerprintEntry,
} from "@/shared/fingerprint/index.ts";
import { formatSize } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import { useConfirmDanger } from "@/options/components/useConfirmDanger.ts";

const showDialog = defineModel<boolean>();
const { torrentItems } = defineProps<{
  torrentItems: ITorrent[];
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

/** 判定依据（第 2/3 层指纹，或退回旧的文件逐条比对） */
type TVerifiedBy = "infoHash" | "pieces" | "files" | "legacy";

interface IVerifiedItem {
  id: string; // Map key
  data: ITorrent;
  torrent: ITorrentInfoForVerification | null;
  loading: boolean;
  verified: boolean;
  status: string;
  error: boolean;
  /** 与基准种子的比对结论 */
  baseMatch?: IFingerprintMatchResult;
  /** 与基准种子比对时是靠哪一层判定通过的 */
  verifiedBy?: TVerifiedBy;
  /** 与下载器里已有种子的比对结论 */
  localMatch?: IFingerprintMatchResult;
  /** 保守决策：add / review / exclude */
  localDecision?: IFingerprintPolicyDecision;
}

const verifiedItems = ref<Map<string, IVerifiedItem>>(new Map());
const verifiedItemsOrder = ref<string[]>([]); // 保持顺序
const baseTorrent = ref<ITorrentInfoForVerification | null>(null);
const verifiedCount = ref(0);
const creating = ref(false);

// ── 本地种子指纹索引 ──
const localIndex = ref<ILocalFingerprintIndex | null>(null);
const indexLoading = ref(false);
const indexSupported = ref(true);
/** 勾上后，把「本地已有 / 同站已挂」的条目排除出辅种列表（默认关，绝不静默替用户做决定） */
const excludeLocalDuplicates = ref(false);
const localLookup = computed<IFingerprintIndexLookup>(() => buildFingerprintIndexLookup(localIndex.value));

// 下载选项
const selectedDownloaderId = ref<string>("");
const savePath = ref("");
const torrentLabel = ref("");
const suggestedSavePaths = computed(() => metadataStore.downloaders[selectedDownloaderId.value]?.suggestFolders ?? []);
const suggestedLabels = computed(() => metadataStore.downloaders[selectedDownloaderId.value]?.suggestTags ?? []);

/** a-select 的 options 形如 { value, label }（原 Vuetify 的 item-value / item-title） */
const downloaderOptions = computed(() =>
  metadataStore.getSortedEnabledDownloaders.map((d) => ({ value: d.id, label: d.name })),
);

/** a-auto-complete 的 options 走的是 SelectProps.options，形如 { value, label } */
const savePathOptions = computed(() => suggestedSavePaths.value.map((x) => ({ value: x, label: x })));
const labelOptions = computed(() => suggestedLabels.value.map((x) => ({ value: x, label: x })));

// 是否可以创建任务
const canCreateTask = computed(() => {
  return includedVerifiedCount.value > 1 && selectedDownloaderId.value;
});

// 状态文本
const statusText = {
  downloading: t("SearchEntity.KeepUploadDialog.status.downloading"),
  waiting: t("SearchEntity.KeepUploadDialog.status.waiting"),
  downloaded: t("SearchEntity.KeepUploadDialog.status.downloaded"),
  success: t("SearchEntity.KeepUploadDialog.status.success"),
  failed: t("SearchEntity.KeepUploadDialog.status.failed"),
  downloadFailed: t("SearchEntity.KeepUploadDialog.status.downloadFailed"),
  missingFiles: t("SearchEntity.KeepUploadDialog.status.missingFiles"),
};

// 打开对话框时初始化
watch(showDialog, (val) => {
  if (val) {
    startVerification();
  }
});

// 切换下载器后本地索引就换了，跟着重建
watch(selectedDownloaderId, () => {
  if (showDialog.value) {
    void loadLocalIndex();
  }
});

/**
 * 读取下载器里的本地种子指纹索引。
 *
 * 这一步会让 offscreen 逐个种子取文件清单（O(n) 次本地请求），所以：
 * - 不阻塞辅种检测本身，失败只提示、不中断；
 * - offscreen 侧有 30 分钟缓存，这里重复打开对话框基本是零成本。
 */
async function loadLocalIndex(refresh = false) {
  if (!selectedDownloaderId.value) {
    localIndex.value = null;
    indexSupported.value = true;
    return;
  }

  indexLoading.value = true;
  try {
    const index = await sendMessage("getLocalFingerprintIndex", {
      downloaderId: selectedDownloaderId.value,
      refresh,
    });
    localIndex.value = index;
    indexSupported.value = true;
    // 索引是异步到的，补算一遍本地比对结论
    refreshLocalDecisions();
  } catch (e) {
    console.error("[PTD] load local fingerprint index failed", e);
    localIndex.value = null;
    indexSupported.value = false;
  } finally {
    indexLoading.value = false;
  }
}

const localIndexText = computed(() => {
  if (indexLoading.value) return t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.loading");
  if (!selectedDownloaderId.value) return t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.needDownloader");
  if (!indexSupported.value) return t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.unavailable");

  const index = localIndex.value;
  if (!index) return t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.unavailable");

  return t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.ready", [
    index.totalTorrents,
    localLookup.value.comparableCount,
  ]);
});

/** 把「本地已有 / 同站已挂」的条目从待辅种列表里摘掉 */
const excludedIds = computed(() => {
  if (!excludeLocalDuplicates.value) return new Set<string>();
  return new Set(
    Array.from(verifiedItems.value.values())
      .filter((item) => item.verified && item.localDecision?.action === "exclude")
      .map((item) => item.id),
  );
});

/** 参与辅种的条目（勾选排除时，被指纹判定为本地已有的条目会被剔掉） */
const includedItems = computed(() =>
  verifiedItemsOrder.value
    .map((id) => verifiedItems.value.get(id))
    .filter((item): item is IVerifiedItem => !!item && !excludedIds.value.has(item.id)),
);

const includedVerifiedCount = computed(() => includedItems.value.filter((item) => item.verified).length);

/** 逐条重算「与本地已有种子的比对」，索引异步到达后补调用 */
function refreshLocalDecisions() {
  const lookup = localLookup.value;
  if (lookup.entries.length === 0) return;

  verifiedItems.value.forEach((item) => {
    if (!item.torrent) return;
    const match = matchLocalFingerprint(toComparable(item.torrent), lookup, { requireCompleted: true });
    item.localMatch = match;
    item.localDecision = decideFingerprintAction({ match, site: item.data.site });
  });
}

/** 站点侧种子的三层指纹，归一到与本地条目可比的形状 */
function toComparable(info: ITorrentInfoForVerification): IFingerprintComparable {
  return {
    titleKey: info.titleKey,
    files: info.filesFingerprint ?? null,
    pieces: info.piecesSample ?? null,
    name: info.name,
    size: info.length,
  };
}

/** 把「已经知道内容的种子」（基准种子）包成本地条目，好让比对逻辑只有一条路径 */
function toComparableEntry(info: ITorrentInfoForVerification): ILocalTorrentFingerprintEntry {
  return {
    hash: info.infoHash,
    name: info.name,
    size: info.length,
    progress: 100,
    isCompleted: true,
    trackerHosts: [],
    sites: [],
    ratioLimit: -2,
    seedingTimeLimit: -2,
    titleKey: info.titleKey ?? "",
    files: info.filesFingerprint ?? null,
    pieces: info.piecesSample ?? null,
  };
}

function startVerification() {
  verifiedItems.value = new Map();
  verifiedItemsOrder.value = [];
  baseTorrent.value = null;
  verifiedCount.value = 0;
  localIndex.value = null;
  indexSupported.value = true;
  excludeLocalDuplicates.value = false;

  const remembered = configStore.download.saveLastDownloader ? metadataStore.lastKeepUpload : undefined;
  const rememberedDownloaderExists = remembered?.downloaderId && metadataStore.downloaders[remembered.downloaderId];
  selectedDownloaderId.value = rememberedDownloaderExists
    ? remembered.downloaderId!
    : metadataStore.defaultDownloader?.id || "";
  savePath.value = rememberedDownloaderExists
    ? remembered?.savePath || ""
    : metadataStore.defaultDownloader?.folder || "";
  torrentLabel.value = rememberedDownloaderExists
    ? remembered?.label || ""
    : metadataStore.defaultDownloader?.tags || "";

  // 本地指纹索引与辅种检测并行，两者互不阻塞
  void loadLocalIndex();

  torrentItems.forEach((item) => {
    const id = crypto.randomUUID();

    // 下载链接可能需要后台根据站点和种子 ID 动态解析，不能在此处过滤未提供 link 的选中项。
    verifiedItems.value.set(id, {
      id,
      data: item,
      torrent: null,
      loading: true,
      verified: false,
      status: statusText.downloading,
      error: false,
    });
    verifiedItemsOrder.value.push(id);

    getTorrent(item, id)
      .then((result) => {
        verification(result, id);
      })
      .catch(() => {
        verification(null, id);
      });
  });
}

async function getTorrent(torrent: ITorrent, id: string): Promise<ITorrentInfoForVerification | null> {
  try {
    const result = await sendMessage("getTorrentInfoForVerification", torrent);
    // 边界检查：确保项仍然存在
    const item = verifiedItems.value.get(id);
    if (!item) return null;
    item.status = statusText.waiting;
    return result;
  } catch (e) {
    // 边界检查：确保项仍然存在
    const item = verifiedItems.value.get(id);
    if (item) {
      item.status = statusText.downloadFailed;
      item.error = true;
    }
    throw e;
  }
}

function verification(torrent: ITorrentInfoForVerification | null, id: string) {
  // 边界检查：确保项仍然存在
  const item = verifiedItems.value.get(id);
  if (!item) return;

  const isFirstItem = verifiedItemsOrder.value[0] === id;

  if (isFirstItem) {
    // 第一个种子作为基准种子
    if (!baseTorrent.value) {
      baseTorrent.value = torrent;
      item.loading = false;

      if (torrent) {
        item.torrent = torrent;
        item.verified = true;
        item.status = statusText.downloaded;
        verifiedCount.value++;
        applyLocalDecision(item);
      } else {
        item.verified = false;
        item.status = statusText.failed;
      }
    }
  } else {
    // 等待基准种子下载完成
    const baseItem = verifiedItems.value.get(verifiedItemsOrder.value[0]);
    if (baseItem?.loading) {
      setTimeout(() => verification(torrent, id), 200);
      return;
    }

    const result: Partial<IVerifiedItem> = {
      loading: false,
    };

    if (!baseItem?.verified) {
      result.status = statusText.failed;
    }

    if (!torrent || !baseItem?.verified) {
      Object.assign(item, result);
      return;
    }

    const baseTorrentInfo = baseTorrent.value!;

    // ── 与基准种子的比对：三层指纹 ──
    // 把基准种子当成「本地已知的一条数据」，比对逻辑就只剩一条代码路径，
    // 而且基准种子和候选种子都带 piece 哈希，第 3 层在这里是真能用的。
    const baseLookup = buildFingerprintIndexLookup([toComparableEntry(baseTorrentInfo)]);
    const baseMatch = matchLocalFingerprint(toComparable(torrent), baseLookup);
    result.baseMatch = baseMatch;

    if (torrent.infoHash && baseTorrentInfo.infoHash && torrent.infoHash === baseTorrentInfo.infoHash) {
      // infohash 完全相同 —— 是同一个种子，不用再往下比
      result.verified = true;
      result.verifiedBy = "infoHash";
    } else if (baseMatch.verdict === "identical") {
      // 第 2 层（文件清单指纹）一致；抽样也对得上就是第 3 层确认过
      result.verified = true;
      result.verifiedBy = baseMatch.pieces === "match" ? "pieces" : "files";
    } else {
      // 判不出来（比如两边都没算出指纹）时，才退回逐条比对文件清单
      result.verified = legacyVerify(torrent, baseTorrentInfo);
      result.verifiedBy = "legacy";
    }

    result.torrent = torrent;
    if (result.verified) {
      verifiedCount.value++;
    }

    if (!result.status) {
      result.status = result.verified
        ? statusText.success
        : // 没通过时顺手说明原因：是「基准种子更大、本地缺文件」还是压根不是同一份数据
          hasAllFilesOf(torrent, baseTorrentInfo)
          ? statusText.missingFiles
          : statusText.failed;
    }

    Object.assign(item, result);
    applyLocalDecision(item);
  }
}

/** 指纹算不出来时的兜底：逐条比对文件清单（要求总大小一致） */
function legacyVerify(torrent: ITorrentInfoForVerification, base: ITorrentInfoForVerification): boolean {
  if (torrent.length !== base.length) return false;
  return hasAllFilesOf(torrent, base);
}

/** 候选种子的每个文件是否都能在基准种子里找到（不要求顺序一致） */
function hasAllFilesOf(torrent: ITorrentInfoForVerification, base: ITorrentInfoForVerification): boolean {
  if (torrent.files.length === 0) return false;
  const { missing } = diffFileLists({ rootName: torrent.name, files: torrent.files }, {
    rootName: base.name,
    files: base.files,
  });
  return missing.length === 0;
}

/** 算一遍「与本地已有种子」的结论，并套用保守决策 */
function applyLocalDecision(item: IVerifiedItem) {
  if (!item.torrent || localLookup.value.entries.length === 0) return;
  const match = matchLocalFingerprint(toComparable(item.torrent), localLookup.value, { requireCompleted: true });
  item.localMatch = match;
  item.localDecision = decideFingerprintAction({ match, site: item.data.site });
}

// MV3 扩展页面禁用原生 confirm()（静默返回 false）——原来这里恒为 false，
// 「标记已校验」按钮点了永远不生效。改走 App 上下文的 modal。
const { confirmDanger } = useConfirmDanger();

async function addToVerified(id: string) {
  if (!(await confirmDanger(t("SearchEntity.KeepUploadDialog.addToKeepUploadConfirm"), "primary"))) {
    return;
  }

  const item = verifiedItems.value.get(id);
  if (item) {
    item.verified = true;
    verifiedCount.value++;
    applyLocalDecision(item);
  }
}

function removeVerifiedItem(id: string) {
  const item = verifiedItems.value.get(id);
  if (!item) return;
  if (item.verified) {
    verifiedCount.value--;
  }
  verifiedItems.value.delete(id);
  verifiedItemsOrder.value = verifiedItemsOrder.value.filter((itemId) => itemId !== id);
}

function reDownload(id: string) {
  const item = verifiedItems.value.get(id);
  if (!item) return;
  item.loading = true;
  item.status = statusText.downloading;

  getTorrent(item.data, id)
    .then((result) => {
      verification(result, id);
    })
    .catch(() => {
      verification(null, id);
    });
}

function closeDialog() {
  showDialog.value = false;
}

function resetDownloadOptions() {
  savePath.value = "";
  torrentLabel.value = "";
}

// 获取种子文件数量
function getFileCount(item: IVerifiedItem): number | string {
  return item.torrent?.files?.length ?? "N/A";
}

/** 与基准种子比对时是靠哪一层判定的（展示给用户，便于判断这条结论有多硬） */
function verifiedByText(item: IVerifiedItem): string | null {
  switch (item.verifiedBy) {
    case "infoHash":
      return t("SearchEntity.KeepUploadDialog.fingerprint.verifiedBy.infoHash");
    case "pieces":
      return t("SearchEntity.KeepUploadDialog.fingerprint.verifiedBy.pieces");
    case "files":
      return t("SearchEntity.KeepUploadDialog.fingerprint.verifiedBy.files");
    case "legacy":
      return t("SearchEntity.KeepUploadDialog.fingerprint.verifiedBy.legacy");
    default:
      return null;
  }
}

/** 本地比对徽标：本地已有 / 同站已挂 / 仅标题疑似 */
interface IFingerprintBadge {
  key: string;
  color: string;
  text: string;
  title?: string;
}

function localBadges(item: IVerifiedItem): IFingerprintBadge[] {
  const decision = item.localDecision;
  const match = item.localMatch;
  if (!decision || !match) return [];

  // 提示：第 2 层命中但没有 piece 证据，建议抽样验一下 piece
  const suggestTitle = decision.suggestPieceVerify
    ? t("SearchEntity.KeepUploadDialog.fingerprint.suggestPieceVerify")
    : undefined;

  const siteNames = (match.match?.sites ?? []).map(
    (site) => metadataStore.siteNameMap?.[site] ?? metadataStore.getSiteName(site),
  );

  switch (decision.reason) {
    case "local-identical":
      return [{ key: "local-identical", color: "orange", text: t("SearchEntity.KeepUploadDialog.fingerprint.local.identical"), title: suggestTitle }];
    case "same-site-already":
      return [
        {
          key: "same-site",
          color: "purple",
          text: t("SearchEntity.KeepUploadDialog.fingerprint.local.sameSite"),
          title: siteNames.join("、") || suggestTitle,
        },
      ];
    case "title-only-candidate":
      return [{ key: "candidate", color: "blue", text: t("SearchEntity.KeepUploadDialog.fingerprint.local.candidate"), title: suggestTitle }];
    default:
      return [];
  }
}

// 创建辅种任务
async function createKeepUploadTask() {
  if (!canCreateTask.value || !selectedDownloaderId.value) return;

  const verifiedList = includedItems.value.filter((item) => item.verified);
  if (verifiedList.length === 0) {
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.noVerifiedItem"), { color: "error" });
    return;
  }

  creating.value = true;

  try {
    const downloader = metadataStore.downloaders[selectedDownloaderId.value];
    const downloadOptions: IKeepUploadTaskDownloadOptions = {
      downloaderId: selectedDownloaderId.value,
      savePath: savePath.value || undefined,
      clientName: downloader?.name || selectedDownloaderId.value,
      addTorrentOptions: {
        label: torrentLabel.value || undefined,
      },
    };

    const task: IKeepUploadTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      time: Date.now(),
      title: verifiedList[0].data.title || "Unknown",
      size: verifiedList[0].data.size || 0,
      downloadOptions,
      items: verifiedList.map((item) => ({
        site: item.data.site,
        title: item.data.title || "",
        subTitle: item.data.subTitle,
        category: item.data.category,
        link: item.data.url || "", // ITorrent.url = 详情页链接
        url: item.data.link || "", // ITorrent.link = 下载链接
        size: item.data.size || 0,
        seeders: item.data.seeders,
        leechers: item.data.leechers,
      })) as IKeepUploadTaskItem[],
    };

    await sendMessage("createKeepUploadTask", task);
    if (configStore.download.saveLastDownloader) {
      metadataStore.lastKeepUpload = {
        downloaderId: selectedDownloaderId.value,
        savePath: savePath.value || undefined,
        label: torrentLabel.value || undefined,
      };
      await metadataStore.$save();
    }
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.createSuccess"), { color: "success" });
    closeDialog();
  } catch (e) {
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.createError"), { color: "error" });
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <a-modal v-model:open="showDialog" :title="t('SearchEntity.KeepUploadDialog.title')" :width="1024" :mask="{ closable: false }">
    <!-- 「怎么用」入口原先挂在 #title 插槽里，会和右上角相撞，移到内容区顶部 -->
    <div class="d-flex justify-end">
      <a-tooltip :title="t('common.howToUse')">
        <a-button
          type="text"
          href="https://github.com/pt-plugins/PT-Plugin-Plus/wiki/keep-upload-task"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <template #icon><QuestionCircleOutlined /></template>
        </a-button>
      </a-tooltip>
    </div>

    <!-- 本地指纹索引：决定「哪些条目本地已经有了」，是辅种前的最后一道保守检查 -->
    <div class="d-flex align-center ga-2 mb-2">
      <span class="text-body-small text-grey">{{ localIndexText }}</span>
      <a-tooltip :title="t('SearchEntity.KeepUploadDialog.fingerprint.localIndex.refresh')">
        <a-button type="text" size="small" :loading="indexLoading" @click="loadLocalIndex(true)">
          <template #icon><SyncOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-checkbox
        v-if="localLookup.entries.length > 0"
        v-model:checked="excludeLocalDuplicates"
        class="text-body-small"
      >
        {{ t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.excludeLocal", [excludedIds.size]) }}
      </a-checkbox>
    </div>

    <div class="keep-upload-list" style="max-height: 80vh">
      <template v-for="(item, index) in includedItems" :key="item.id">
        <div v-if="index === 0" class="text-body-small text-grey mb-1">
          {{ t("SearchEntity.KeepUploadDialog.baseTorrent") }}
        </div>
        <div v-if="index === 1" class="text-body-small text-grey mb-1">
          {{ t("SearchEntity.KeepUploadDialog.otherTorrent") }}
        </div>
        <div class="d-flex align-center py-1">
          <SiteFavicon :site-id="item.data.site" :size="18" class="mr-2" />

          <div class="flex-1-1-0 text-truncate">
            <div class="list-item text-body-medium">
              <!-- 标题可能很长：ellipsis.tooltip 补上原先缺的悬停提示（原先只有截断、没有 :title） -->
              <a-typography-text :ellipsis="{ tooltip: item.data.title }">
                <a :href="item.data.link" target="_blank" rel="noopener noreferrer nofollow">
                  {{ item.data.title }}
                </a>
              </a-typography-text>
            </div>
            <div class="text-body-small">
              {{ t("SearchEntity.KeepUploadDialog.size") }}{{ formatSize(item.data.size ?? 0) }},
              {{ t("SearchEntity.KeepUploadDialog.fileCount") }}{{ getFileCount(item) }},
              {{ t("SearchEntity.KeepUploadDialog.status.label") }}{{ item.status }}
              <span v-if="verifiedByText(item)" class="text-grey">
                （{{ verifiedByText(item) }}）
              </span>
            </div>
            <div v-if="localBadges(item).length" class="d-flex ga-1 mt-1 flex-wrap">
              <!-- 这里原本给 a-tag 传了 `bordered` 属性，antdv-next 1.5.6 下它是死属性（false 同样渲染 filled），已删 -->
              <a-tag v-for="badge in localBadges(item)" :key="badge.key" :color="badge.color" :title="badge.title">
                {{ badge.text }}
              </a-tag>
              <span
                v-for="site in item.localMatch?.match?.sites ?? []"
                :key="site"
                class="text-body-small text-grey"
              >
                <SiteName :site-id="site" tag="span" />
              </span>
            </div>
          </div>

          <div class="d-flex ga-1">
            <a-button
              v-if="
                includedItems[0]?.verified &&
                !item.loading &&
                !item.verified &&
                index > 0
              "
              type="text"
              :title="t('SearchEntity.KeepUploadDialog.addToKeepUpload')"
              @click.stop="addToVerified(item.id)"
            >
              <template #icon><PlusOutlined /></template>
            </a-button>

            <a-button
              v-if="
                includedItems[0]?.verified &&
                !item.loading &&
                !item.torrent &&
                index > 0
              "
              type="text"
              :title="t('SearchEntity.KeepUploadDialog.redownload')"
              @click.stop="reDownload(item.id)"
            >
              <template #icon><SyncOutlined /></template>
            </a-button>

            <a-tooltip :title="item.status">
              <a-button
                type="text"
                :loading="item.loading"
              >
                <template v-if="item.verified" #icon>
                  <CheckOutlined style="color: #52c41a" />
                </template>
                <template v-else #icon>
                  <CloseOutlined
                    style="color: #ff4d4f"
                    :title="t('SearchEntity.KeepUploadDialog.removeFromKeepUpload')"
                    @click.stop="removeVerifiedItem(item.id)"
                  />
                </template>
              </a-button>
            </a-tooltip>
          </div>
        </div>
        <a-divider v-if="index > 0" class="ml-4" />
      </template>
    </div>

    <template #footer>
      <div class="d-flex align-center">
        <template v-if="includedVerifiedCount > 1">
          <a-select
            v-model:value="selectedDownloaderId"
            :options="downloaderOptions"
            size="small"
            :placeholder="t('SearchEntity.KeepUploadDialog.setSavePath')"
            style="max-width: 200px"
            @change="resetDownloadOptions"
          />
          <a-auto-complete
            v-model:value="savePath"
            :options="savePathOptions"
            size="small"
            :placeholder="t('KeepUploadTask.savePath')"
            style="max-width: 200px"
          />
          <a-auto-complete
            v-model:value="torrentLabel"
            :options="labelOptions"
            size="small"
            :placeholder="t('SentToDownloaderDialog.label')"
            style="max-width: 200px"
          />
          <a-button
            type="text"
            :loading="creating"
            :disabled="!canCreateTask"
            @click="createKeepUploadTask"
          >
            <template #icon><SaveOutlined /></template>
            {{ t("SearchEntity.KeepUploadDialog.create") }}
          </a-button>
        </template>
        <div class="flex-1-1-0" />
        <a-button danger type="text" @click="closeDialog">
          {{ t("common.dialog.close") }}
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.keep-upload-list {
  overflow-y: auto;
}

.list-item {
  a {
    color: #000;
    text-decoration: none;
  }

  a:hover {
    color: #008c00;
  }
}
</style>
