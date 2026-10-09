<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowUpOutlined,
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
  autoSelectLocalBase,
  compareAgainstLocalBase,
  decideFingerprintAction,
  diffFileLists,
  matchLocalFingerprint,
  pickLocalBaseCandidates,
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
import KeepUploadUsageDialog from "@/options/components/KeepUploadUsageDialog.vue";
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
const creating = ref(false);
/** 「怎么用」说明弹窗的开关（它挂在本弹窗的默认插槽里，见模板那条注释） */
const showUsageDialog = ref(false);

/**
 * 只勾中一条时的「基准种子」—— 存的是下载器那条种子的 hash。
 *
 * 为什么要有这一档：常见情形是内容早就在下完的那颗种子里了，只想再挂上这一站。
 * 这种任务里没有第二条可以拿来当基准，所以基准只能从下载器的本地索引里挑。
 *
 * 存 hash 而不是整条 entry：换下载器、重建索引之后旧 hash 那条自然挑不中，
 * 选择会退回「未选」。拿一条已经不存在的种子当基准去辅种是必爆仓的。
 */
const localBaseHash = ref("");
/** 用户自己挑过之后就不再替他改（自动选中只在「一次都没挑过」时发生） */
const localBaseTouched = ref(false);

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

/** 只勾中一条 = 「下载器已经下完了，只要再挂这一站」那种辅种 */
const isSingleMode = computed(() => torrentItems.length === 1);

/**
 * 列表里排第一的那一条。
 *
 * 它有两种身份：没指定下载器基准时它就是基准（其余是「其他种子」）；
 * 只勾一条时它就是那唯一一条「要辅种的条目」。两种情形共用同一个取值处，
 * 因为「基准候选」要找的是**已经下载回来的**那份指纹，而不是列表页的大小约数。
 */
const listItemBase = computed(() => verifiedItems.value.get(verifiedItemsOrder.value[0]) ?? null);

/** 下载器里可能当基准的条目，按证据强度排好（files > 标题+大小 > 只大小） */
const baseCandidates = computed(() => {
  const info = listItemBase.value?.torrent;
  if (!info) return [];
  return pickLocalBaseCandidates(toComparable(info), localIndex.value);
});

/** a-select 的 options：{ value, label }。label 一律是人看得懂的名字，不放 hash（§3.5） */
const baseOptions = computed(() =>
  baseCandidates.value.map((c) => ({
    value: c.entry.hash,
    label: c.entry.savePath
      ? `${c.entry.name} · ${formatSize(c.entry.size)} · ${c.entry.savePath}`
      : `${c.entry.name} · ${formatSize(c.entry.size)}`,
  })),
);

/** 当前选中的那条候选（hash 已经不在候选里时是 null，下拉同时退回未选） */
const chosenLocalBase = computed(() => baseCandidates.value.find((c) => c.entry.hash === localBaseHash.value) ?? null);

/** 生效的基准来自下载器。它压过列表第一条 —— 数据本来就在本地，不必再下一遍 */
const useLocalBase = computed(() => !!chosenLocalBase.value);

// 索引与种子指纹谁后到都会重算候选。三条规矩：
// 1) 选中的那条没了就清空 —— 否则 a-select 会把一个内部 hash 显示在界面上；
// 2) 只有第 2 层（文件清单）命中才代用户选，第 1 层的「疑似」一律留给人挑；
// 3) **只在只勾一条时代选**。勾了多条时「列表第一条当基准」本来就是成立的老路径，
//    替用户改成下载器里那条会把他没选的种子当基准用，那是更难发现的错。
watch(baseCandidates, (list) => {
  const before = localBaseHash.value;
  if (!list.some((c) => c.entry.hash === before)) localBaseHash.value = "";
  if (isSingleMode.value && !localBaseTouched.value && !localBaseHash.value) {
    localBaseHash.value = autoSelectLocalBase(list)?.entry.hash ?? "";
  }
  // 代选一旦发生，那一条就从「免检的基准」变成「要和基准比的一条」，结论得重算
  if (localBaseHash.value !== before) recompareAll();
});

/** 下拉换了（含清空）之后所有条目的「与基准比对」结论都要重算 */
function onLocalBaseChange(hash?: string) {
  localBaseTouched.value = true;
  localBaseHash.value = hash ?? "";
  recompareAll();
}

/** 把列表里某一条挪到第一位当基准，其余条目的结论跟着重算 */
function setItemBase(id: string) {
  const index = verifiedItemsOrder.value.indexOf(id);
  if (index <= 0) return;
  const order = [...verifiedItemsOrder.value];
  order.unshift(order.splice(index, 1)[0]);
  verifiedItemsOrder.value = order;
  baseTorrent.value = verifiedItems.value.get(id)?.torrent ?? null;
  localBaseHash.value = "";
  localBaseTouched.value = true;
  recompareAll();
}

/** 基准那一档下面写的说明：靠哪一层选上的、要不要人复核 */
const localBaseHint = computed(() => {
  const c = chosenLocalBase.value;
  if (!c) {
    // 勾了多条又没选：这不是需要提醒的状态，列表第一条就是基准
    if (!isSingleMode.value) return t("SearchEntity.KeepUploadDialog.localBase.byList");
    if (indexLoading.value || listItemBase.value?.loading) return t("SearchEntity.KeepUploadDialog.localBase.working");
    if (baseCandidates.value.length > 0) return t("SearchEntity.KeepUploadDialog.localBase.pick");
    // 一条候选都没有，得分清是「下载器里确实没有」还是「压根没读到列表」——只有后者点重建才有救
    if ((localIndex.value?.entries.length ?? 0) === 0) return t("SearchEntity.KeepUploadDialog.localBase.noIndex");
    return t("SearchEntity.KeepUploadDialog.localBase.none");
  }
  if (c.pieces === "mismatch") return t("SearchEntity.KeepUploadDialog.localBase.piecesMismatch");
  if (c.tier === "files") return t("SearchEntity.KeepUploadDialog.localBase.byFiles");
  return t(
    c.tier === "titleSize" ? "SearchEntity.KeepUploadDialog.localBase.byTitleSize" : "SearchEntity.KeepUploadDialog.localBase.bySize",
  );
});

// 是否可以创建任务
const canCreateTask = computed(() => {
  if (!selectedDownloaderId.value) return false;
  // 只勾一条时基准只能来自下载器：没选定基准就没有参照物，建出来的任务会把那一条当成基准再下一遍
  if (isSingleMode.value && !useLocalBase.value) return false;
  return includedVerifiedCount.value >= (useLocalBase.value ? 1 : 2);
});

/**
 * 底部那一排（选下载器 / 路径 / 标签 / 创建）什么时候出现。
 *
 * 判据故意**不是**「够不够条件创建」：这一排里有选下载器那颗，而本地索引要先读到才谈得上挑基准 ——
 * 按结果藏起来会让用户挑完基准之后整排消失（看着像坏了），也没有入口去换下载器。
 * 所以只要有一条不用再等下载就出现，能不能点由 canCreateTask 管。
 */
const showCreateRow = computed(() => includedItems.value.some((item) => !item.loading));

/** 列表第一行上面那行小标题：基准从哪儿来，决定了「排在最前那条」到底是什么身份 */
const firstHeaderKey = computed(() => {
  if (isSingleMode.value) return "SearchEntity.KeepUploadDialog.reseedTarget";
  if (useLocalBase.value) return "SearchEntity.KeepUploadDialog.reseedTargets";
  return "SearchEntity.KeepUploadDialog.baseTorrent";
});

/** 能不能把某一条挪成基准：只有「基准取自列表第一条」那条路有意义，且它得已经拿到种子信息 */
function canPromote(index: number, item: IVerifiedItem): boolean {
  return index > 0 && !isSingleMode.value && !useLocalBase.value && !!item.torrent;
}

// 状态文本
// computed：标签里有 t()，setup 里一次性求值的话切语言不会重算
const statusText = computed(() => ({
  downloading: t("SearchEntity.KeepUploadDialog.status.downloading"),
  waiting: t("SearchEntity.KeepUploadDialog.status.waiting"),
  downloaded: t("SearchEntity.KeepUploadDialog.status.downloaded"),
  success: t("SearchEntity.KeepUploadDialog.status.success"),
  failed: t("SearchEntity.KeepUploadDialog.status.failed"),
  downloadFailed: t("SearchEntity.KeepUploadDialog.status.downloadFailed"),
  missingFiles: t("SearchEntity.KeepUploadDialog.status.missingFiles"),
  needManual: t("SearchEntity.KeepUploadDialog.status.needManual"),
}));

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
  // 基准就在下载器里时这条开关必须失效：那种任务的**每一条**都「本地已有」——
  // 那正是它成立的前提（拿已有的数据去挂这一站）。照原样排除会把整个列表清空。
  if (!excludeLocalDuplicates.value || useLocalBase.value) return new Set<string>();
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
  localIndex.value = null;
  indexSupported.value = true;
  excludeLocalDuplicates.value = false;
  localBaseHash.value = "";
  localBaseTouched.value = false;

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
      status: statusText.value.downloading,
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
    item.status = statusText.value.waiting;
    return result;
  } catch (e) {
    // 边界检查：确保项仍然存在
    const item = verifiedItems.value.get(id);
    if (item) {
      item.status = statusText.value.downloadFailed;
      item.error = true;
    }
    throw e;
  }
}

/**
 * 拿「当前基准」判某一条是不是同一份数据，结论直接写回这一条。
 *
 * 基准有两种来路，能用的层数不一样：
 * - **下载器里那条**（`useLocalBase`）：只有第 2 层可用 —— 本地索引带的是算好的文件清单
 *   指纹，不带原始文件清单，所以「逐条比对文件」那层兜底在这儿根本跑不起来。
 *   任何一边算不出指纹就是 unknown：**没有证据不等于不是同一份**，界面把它留给人确认
 *   （那颗「添加到辅种列表」就是出路），不能判死。
 * - **列表第一条**（默认）：三层指纹 + 逐条兜底全都能用，而且它自己就是参照物、免检。
 */
function applyBaseComparison(item: IVerifiedItem) {
  const info = item.torrent;
  if (!info) return;
  item.loading = false;
  item.verified = false;
  item.verifiedBy = undefined;
  item.baseMatch = undefined;

  if (useLocalBase.value) {
    const base = chosenLocalBase.value!.entry;
    const { verdict, pieces } = compareAgainstLocalBase(toComparable(info), base);
    if (verdict === "same") {
      item.verified = true;
      item.verifiedBy = pieces === "match" ? "pieces" : "files";
      item.status = statusText.value.success;
    } else {
      item.status = verdict === "unknown" ? statusText.value.needManual : statusText.value.failed;
    }
    applyLocalDecision(item);
    return;
  }

  if (item === listItemBase.value) {
    item.verified = true;
    item.status = statusText.value.downloaded;
    applyLocalDecision(item);
    return;
  }

  const base = baseTorrent.value;
  if (!base || !listItemBase.value?.verified) {
    item.status = statusText.value.failed;
    applyLocalDecision(item);
    return;
  }

  // ── 与基准种子的比对：三层指纹 ──
  // 把基准种子当成「本地已知的一条数据」，比对逻辑就只剩一条代码路径，
  // 而且基准种子和候选种子都带 piece 哈希，第 3 层在这里是真能用的。
  const baseLookup = buildFingerprintIndexLookup([toComparableEntry(base)]);
  const baseMatch = matchLocalFingerprint(toComparable(info), baseLookup);
  item.baseMatch = baseMatch;

  if (info.infoHash && base.infoHash && info.infoHash === base.infoHash) {
    // infohash 完全相同 —— 是同一个种子，不用再往下比
    item.verified = true;
    item.verifiedBy = "infoHash";
  } else if (baseMatch.verdict === "identical") {
    // 第 2 层（文件清单指纹）一致；抽样也对得上就是第 3 层确认过
    item.verified = true;
    item.verifiedBy = baseMatch.pieces === "match" ? "pieces" : "files";
  } else {
    // 兜底：逐条比对文件清单。
    // ⚠️ 这里收的是 verdict !== "identical"，**包含 "different"**（即已确定不是同一份，
    // 见 match.ts:146），而 legacyVerify 在长度一致且文件齐全时仍会返回 true、
    // 把一个「已判定不同」的结果标成 verified。所以别把它读成「只在无结论时才走」。
    item.verified = legacyVerify(info, base);
    item.verifiedBy = "legacy";
  }

  item.status = item.verified
    ? statusText.value.success
    : // 没通过时顺手说明原因：是「基准种子更大、本地缺文件」还是压根不是同一份数据
      hasAllFilesOf(info, base)
      ? statusText.value.missingFiles
      : statusText.value.failed;
  applyLocalDecision(item);
}

/**
 * 换基准之后重算每一条。
 *
 * 「换基准」有三条路：在下拉里选/清下载器那条、把列表里某条挪到第一位、以及索引晚到触发的代选。
 * 三条都不需要重新下载种子 —— 比的是已经拿到手的指纹。
 */
function recompareAll() {
  verifiedItems.value.forEach((item) => {
    if (!item.torrent || item.loading) return;
    applyBaseComparison(item);
  });
}

function verification(torrent: ITorrentInfoForVerification | null, id: string) {
  // 边界检查：确保项仍然存在
  const item = verifiedItems.value.get(id);
  if (!item) return;

  const isFirstItem = verifiedItemsOrder.value[0] === id;

  if (isFirstItem) {
    // 第一个种子作为基准种子
    if (baseTorrent.value) return;
    baseTorrent.value = torrent;
    item.loading = false;

    if (torrent) {
      item.torrent = torrent;
      applyBaseComparison(item);
      return;
    }
    item.verified = false;
    item.status = statusText.value.failed;
    return;
  }

  // 等待基准种子下载完成
  const baseItem = verifiedItems.value.get(verifiedItemsOrder.value[0]);
  if (baseItem?.loading) {
    setTimeout(() => verification(torrent, id), 200);
    return;
  }

  item.loading = false;
  if (!baseItem?.verified) {
    item.verified = false;
    item.status = statusText.value.failed;
    return;
  }
  if (!torrent) return;

  item.torrent = torrent;
  applyBaseComparison(item);
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
    applyLocalDecision(item);
  }
}

function removeVerifiedItem(id: string) {
  const wasBase = verifiedItemsOrder.value[0] === id;
  verifiedItems.value.delete(id);
  verifiedItemsOrder.value = verifiedItemsOrder.value.filter((itemId) => itemId !== id);
  // 删掉的正是基准时，剩下每一条比的都是「已经不在的那份数据」，必须按新基准重算
  if (wasBase) {
    baseTorrent.value = verifiedItems.value.get(verifiedItemsOrder.value[0])?.torrent ?? null;
    recompareAll();
  }
}

function reDownload(id: string) {
  const item = verifiedItems.value.get(id);
  if (!item) return;
  item.loading = true;
  item.status = statusText.value.downloading;

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
      subTitle: verifiedList[0].data.subTitle,
      size: verifiedList[0].data.size || 0,
      downloadOptions,
      // 单条模式：基准是下载器里那条，不在 items 里。任务页靠这个标记决定
      // 「发送基准种子」那两颗要不要出现，并把基准的名字显示出来。
      baseLocal: chosenLocalBase.value
        ? {
            hash: chosenLocalBase.value.entry.hash,
            name: chosenLocalBase.value.entry.name,
            savePath: chosenLocalBase.value.entry.savePath,
          }
        : undefined,
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
        // 验证阶段已经下载过这条的 .torrent，infoHash 就在手上；不记下来，任务页回查时
        // 只能把 .torrent 再下一遍
        hash: item.torrent?.infoHash,
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
    <!-- 「怎么用」入口原先挂在 #title 插槽里，会和右上角相撞，移到内容区顶部。
       它以前是 a-button 的 href，指向上游旧项目的 wiki；现在改为打开应用内说明弹窗。 -->
    <div class="d-flex justify-end">
      <a-tooltip :title="t('common.howToUse')">
        <a-button type="text" @click="showUsageDialog = true">
          <template #icon><QuestionCircleOutlined /></template>
        </a-button>
      </a-tooltip>
    </div>

    <!-- 必须挂在本弹窗的默认插槽里，不能当根级兄弟节点：台架量过（.tmp-build/bench-usage ?m=stack），
         兄弟摆法两颗 wrap 的 z-index 都是 1000，先后只由 DOM 顺序决定；挂进插槽才走 antd 的
         ZIndexProvider，内层拿到 1200。它自己仍是 portal 到 body，不会被本弹窗的滚动容器裁掉。 -->
    <KeepUploadUsageDialog v-model="showUsageDialog" />

    <!-- 本地指纹索引：决定「哪些条目本地已经有了」，是辅种前的最后一道保守检查 -->
    <div class="d-flex align-center ga-2 mb-2">
      <span class="text-body-small text-grey">{{ localIndexText }}</span>
      <a-tooltip :title="t('SearchEntity.KeepUploadDialog.fingerprint.localIndex.refresh')">
        <a-button type="text" size="small" :loading="indexLoading" @click="loadLocalIndex(true)">
          <template #icon><SyncOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-checkbox
        v-if="localLookup.entries.length > 0 && !useLocalBase"
        v-model:checked="excludeLocalDuplicates"
        class="text-body-small"
      >
        {{ t("SearchEntity.KeepUploadDialog.fingerprint.localIndex.excludeLocal", [excludedIds.size]) }}
      </a-checkbox>
    </div>

    <!-- 基准也可以不取列表第一条：下载器里已经有同一份数据时，用它当基准就不必再下一遍。
         只勾一条时这一栏是必需的（列表里没有第二条能当基准），多条时是可选的。 -->
    <div v-if="selectedDownloaderId" class="local-base-row mb-2">
      <div class="text-body-small text-grey mb-1">
        {{
          t(isSingleMode ? "SearchEntity.KeepUploadDialog.localBase.title" : "SearchEntity.KeepUploadDialog.localBase.optionalTitle")
        }}
      </div>
      <a-select
        :value="localBaseHash || undefined"
        :options="baseOptions"
        :loading="indexLoading"
        :placeholder="t('SearchEntity.KeepUploadDialog.localBase.placeholder')"
        allow-clear
        show-search
        option-filter-prop="label"
        style="width: 100%"
        @change="onLocalBaseChange"
      />
      <div class="text-body-small text-grey mt-1">{{ localBaseHint }}</div>
    </div>

    <div class="keep-upload-list" style="max-height: 80vh">
      <template v-for="(item, index) in includedItems" :key="item.id">
        <div v-if="index === 0" class="text-body-small text-grey mb-1">
          {{ t(firstHeaderKey) }}
        </div>
        <div v-if="index === 1 && !useLocalBase && !isSingleMode" class="text-body-small text-grey mb-1">
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
              <!-- 这里原本给 a-tag 传了 `bordered`，已删。注意它**不是死属性**（早先注释这么写是错的）：
                   Tag 声明了 bordered?: boolean 且无 @deprecated，hooks/useColor.js:16 真读它，
                   语义是降级（false → 强制 filled）—— 它造不出描边，要描边请用 variant="outlined" -->
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
            <!-- 「有参照物可比」的两种来路：基准取列表第一条时要求它已经验证通过（所以只有 index>0 比得了）；
                 基准取下载器那条时参照物一直在，第一条也允许人工确认 / 重下 -->
            <a-button
              v-if="!item.loading && !item.verified && (useLocalBase || (index > 0 && includedItems[0]?.verified))"
              type="text"
              :title="t('SearchEntity.KeepUploadDialog.addToKeepUpload')"
              @click.stop="addToVerified(item.id)"
            >
              <template #icon><PlusOutlined /></template>
            </a-button>

            <a-button
              v-if="!item.loading && !item.torrent && (useLocalBase || (index > 0 && includedItems[0]?.verified))"
              type="text"
              :title="t('SearchEntity.KeepUploadDialog.redownload')"
              @click.stop="reDownload(item.id)"
            >
              <template #icon><SyncOutlined /></template>
            </a-button>

            <a-button
              v-if="canPromote(index, item)"
              type="text"
              :title="t('SearchEntity.KeepUploadDialog.setAsBase')"
              @click.stop="setItemBase(item.id)"
            >
              <template #icon><ArrowUpOutlined /></template>
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
        <template v-if="showCreateRow">
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
