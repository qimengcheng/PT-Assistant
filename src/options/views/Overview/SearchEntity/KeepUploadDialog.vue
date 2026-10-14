<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { type TableColumnsType } from "antdv-next";
import {
  CheckOutlined,
  CloseOutlined,
  FolderAddOutlined,
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
import { countText, toCount } from "@/shared/torrentCount.ts";
import {
  allBasesTooLow,
  pickBaseRecommendations,
  pickDefaultBaseId,
  reseedRatioVerdict,
  type TReseedRecommendKind,
} from "@/shared/reseedRecommend.ts";
import { detectBasePathMismatch, isCategorySavePath, type IClientCategory } from "@/shared/reseedPath.ts";
import { pickRelocateCohort } from "@/shared/reseedMoveCohort.ts";
import { moveReseedCohort } from "@/options/utils/reseedMove.ts";
import { invalidateCategoryTable, loadCategoryTable } from "@/options/utils/categoryPaths.ts";
import { isFreeTorrent } from "@/shared/torrentFree.ts";
import type { TRatioImpact } from "@/shared/ratioGuard.ts";
import type { TCategoryKind } from "@/shared/category.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import SiteRatioPopover from "@/options/components/SiteRatioPopover.vue";
import KeepUploadUsageDialog from "@/options/components/KeepUploadUsageDialog.vue";
import {
  CATEGORY_FOLDER_PREFIX,
  folderCategoryKind,
  resolveCategoryFolder,
  supportsCategoryFolders,
} from "@/options/components/SentToDownloaderDialog/categoryMatch.ts";
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

/**
 * 一条的结论档位（`statusText` 的那九个键）。
 *
 * 存档位而不是存文案：locale 是活值，把 `t()` 的结果留在条目上，切语言之后行里挂的还是旧文案，
 * 而下面那行汇总要**按档位分桶计数** —— 照文案比就会在切语言当场把每一条都算进「未通过」。
 *
 * `failed` / `downloadFailed` / `noBase` 是三件事，不许互相顶：内容不是同一份 / 这一条自己的
 * 种子文件没下下来 / 数据拿到了但没有参照物可比。原先后两种都被写成 `failed`，
 * 于是一整屏「验证失败」看着像「这五个站都不是同一份数据」，而真因是五个 .torrent 都没下到
 * （用户 2026-10-14 报的）。
 */
type TVerifyStatus =
  | "downloading"
  | "waiting"
  | "downloaded"
  | "success"
  | "failed"
  | "downloadFailed"
  | "missingFiles"
  | "needManual"
  | "noBase";

interface IVerifiedItem {
  id: string; // Map key
  data: ITorrent;
  torrent: ITorrentInfoForVerification | null;
  loading: boolean;
  verified: boolean;
  status: TVerifyStatus;
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
/**
 * 建完任务后要不要让后台每分钟自己往下走（发基准 → 等下完 → 发其余 → 盯状态）。
 * 默认开（他 2026-10-10 原话「有个自动辅种的开关（默认打开）」）—— 这一屏本来就是「我要把这批
 * 种子挂到别的站去」，而挂上以后没人守着点按钮才是想要的结果。
 */
const autoReseed = ref(true);
const suggestedSavePaths = computed(() => metadataStore.downloaders[selectedDownloaderId.value]?.suggestFolders ?? []);
const suggestedLabels = computed(() => metadataStore.downloaders[selectedDownloaderId.value]?.suggestTags ?? []);

/** a-select 的 options 形如 { value, label }（原 Vuetify 的 item-value / item-title） */
const downloaderOptions = computed(() =>
  metadataStore.getSortedEnabledDownloaders.map((d) => ({ value: d.id, label: d.name })),
);

/** a-auto-complete 的 options 走的是 SelectProps.options，形如 { value, label } */
const savePathOptions = computed(() => suggestedSavePaths.value.map((x) => ({ value: x, label: x })));
const labelOptions = computed(() => suggestedLabels.value.map((x) => ({ value: x, label: x })));

/**
 * 「增加分类」这颗按钮的可见性。只有 qBittorrent 认 `category:` 前缀（判据在
 * `categoryMatch.ts` 的 `supportsCategoryFolders`，与「发送到下载器」共用同一份），
 * 别的下载器会把整串当成路径 —— 给它们立一个「建分类」的入口是骗人。
 */
const canCreateCategory = computed(() =>
  supportsCategoryFolders(metadataStore.downloaders[selectedDownloaderId.value]?.type),
);

const showCategoryDialog = ref(false);
const newCategoryName = ref("");
const newCategoryPath = ref("");
const categorySaving = ref(false);

/**
 * 「该分类的目录」那一栏的候选：只列这台下载器记住的**普通路径**。
 * `category:` 那些不是目录 —— qBittorrent 的分类目录只能是一个真实路径，把前缀串填进去等于
 * 绕回原处（而且它会被当成一个叫 `category:xxx` 的真目录名建出来）。
 */
const plainPathOptions = computed(() =>
  suggestedSavePaths.value.filter((x) => !isCategorySavePath(x)).map((x) => ({ value: x, label: x })),
);

/**
 * 打开时把目录替他填成「最可能对的那一个」：这一栏此刻写的是普通路径就用它，否则用基准那条
 * 在下载器里的实际目录。理由不是省事 —— 辅种走的是跳过校验挂盘上现成的数据，新分类的目录
 * 指不到数据所在处的话，挂上去就是一条永远 0% 的死种。
 */
function openCategoryDialog() {
  newCategoryName.value = "";
  const typed = savePath.value.trim();
  newCategoryPath.value =
    typed !== "" && !isCategorySavePath(typed) ? typed : (chosenLocalBase.value?.entry.savePath ?? "");
  showCategoryDialog.value = true;
}

/**
 * 建一条分类。三件事按顺序做，少一件界面上就是假状态：
 *  1. 真去下载器建（不建的话这一串只是个名字，qBittorrent 会在添加种子那一刻顺手建出
 *     **没有目录**的分类，正好落进上面说的那个坑）；
 *  2. 丢掉那份页面级分类表缓存 —— 「基准在不在任务目录」的判定拿它翻 `category:新名字`，
 *     不清就会在刚建完的分类上挂一条「判不出/目录不一致」；
 *  3. 记进这台下载器的建议目录并选中它（与「发送到下载器」里删推荐路径同一份写法）。
 */
async function submitCategoryDialog() {
  const name = newCategoryName.value.trim();
  if (name === "") {
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.categoryNameRequired"), { color: "warning" });
    return;
  }
  const downloader = metadataStore.downloaders[selectedDownloaderId.value];
  if (!downloader) return;

  categorySaving.value = true;
  try {
    const created = await sendMessage("createTorrentCategory", {
      downloaderId: downloader.id,
      name,
      savePath: newCategoryPath.value.trim(),
    });
    // false 只表示这台客户端没有分类概念（基类默认实现）；连不上、被拒都是抛错，走下面那支
    if (!created) {
      runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.categoryUnsupported"), { color: "error" });
      return;
    }
    invalidateCategoryTable(downloader.id);
    const folder = `${CATEGORY_FOLDER_PREFIX}${name}`;
    const remembered = downloader.suggestFolders ?? [];
    if (!remembered.includes(folder)) {
      await metadataStore.addDownloader({ ...downloader, suggestFolders: [...remembered, folder] });
    }
    savePath.value = folder;
    showCategoryDialog.value = false;
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.categoryCreated", { name }), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(
      t("SearchEntity.KeepUploadDialog.categoryFailed", { msg: e instanceof Error ? e.message : String(e) }),
      { color: "error" },
    );
  } finally {
    categorySaving.value = false;
  }
}

/** 站点自己的分类覆盖表（ISiteUserConfig.categoryMap），与「发送到下载器」读同一份 */
const siteCategoryMaps = computed(() => {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, cfg] of Object.entries(metadataStore.sites ?? {})) {
    const map = cfg.categoryMap;
    if (map && Object.keys(map).length) out[id] = map;
  }
  return out;
});

/**
 * 按这几条种子自己的分类预选保存路径。他 2026-10-09：「辅种的时候应该自动选择分类，现在还没有这个功能」——
 * 辅种发送走的是页内手写的 `sendMessage("downloadTorrent")`，不经过 sendTorrentToDownloader，
 * 所以 v0.45.0 给「发送到下载器」做的预选一直盖不到这里，这一栏只能手填。
 *
 * 判据整个复用 categoryMatch.ts（同一档剩两条候选就不猜、认分类前缀的只有 qBittorrent 那套规则），
 * 这里不另写一份字符串匹配（AGENTS §3.8）。
 */
function applyAutoCategoryPath() {
  const d = metadataStore.downloaders[selectedDownloaderId.value];
  if (!d) return;
  const res = resolveCategoryFolder(
    d.suggestFolders ?? [],
    torrentItems,
    d.categoryAssoc,
    (siteId) => siteCategoryMaps.value[siteId],
  );
  if (res.folder) {
    savePath.value = res.folder;
    return;
  }
  dropContradictingCategoryPath(res.kind);
}

/**
 * 没挑出目录时**不是**一律不动当前值：那一栏留着的是「上次记住的那条」，而它可能是别的分类
 * （他 2026-10-10 的截图：勾了 8 条电影，这一格写着 `category:剧集`）。这种旧值比空白更坏 ——
 * 它看着像刚刚为这批挑好的，发送时就把电影塞进剧集的分类里。
 *
 * 所以只撤「自己也表过态、且和本批折出的类别不同」的那一种：具体路径（`/volume1/…`）不表态，
 * 折不出类别的也不表态，两者都按原样留着 —— 那是「记住的上次路径」，比空白好用。
 * 退回顺序和弹窗初次打开时那条一样：下载器默认目录；默认目录自己也矛盾时留空，
 * 发送时那边是 `savePath || undefined`，等于让下载器用它自己的默认。
 */
function dropContradictingCategoryPath(kind: TCategoryKind | null) {
  if (!kind) return;
  const current = folderCategoryKind(savePath.value);
  if (current === null || current === kind) return;

  const fallback = metadataStore.defaultDownloader?.folder ?? "";
  const fallbackKind = folderCategoryKind(fallback);
  savePath.value = fallbackKind === null || fallbackKind === kind ? fallback : "";
}

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
// 3) **单条、多条都代选**（2026-10-09 用户口径：「像这种明显已经有在做种的种子的时候，一起添加辅种的
//    时候，这个正在做种的就应该自动成为基准才对啊」）。原先只在单条时代选，理由是「替他换会把他没选的
//    种子当基准用」—— 那条顾虑在第 2 层命中的前提下不成立：文件清单一致就是同一份数据的证据，
//    而下载器那条只当参照物、不进 items，不会被重复发一遍。第 1 层的「疑似」照旧留给人挑（规矩 2）。
watch(baseCandidates, (list) => {
  const before = localBaseHash.value;
  if (!list.some((c) => c.entry.hash === before)) localBaseHash.value = "";
  if (!localBaseTouched.value && !localBaseHash.value) {
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

/**
 * 基准那份数据实际躺在哪，和底部那一栏挑的辅种目录是不是同一个地方。
 *
 * 为什么要在建任务这一屏就问：基准取自下载器时数据已经在盘上，发出去的每一条都带
 * `skip_checking`（等于告诉下载器「不用查，盘上就有」）。数据在 A、任务目录是 B，
 * 下载器按 B 去找当然找不到 —— 用户 2026-10-11 那条「本地已有，直接推了其他种子，结果失败了」
 * 就是这个形状，而失败发生在下载器那边，界面上只看得到一条没原因的失败。
 * 判得出/判不出的边界写在 `src/shared/reseedPath.ts`，其中一条要在这里现取数据才判得了：
 * 底部那一栏允许写 `category:电影`（分类而不是目录），得先问下载器那个分类落到哪。
 */
const categoryTable = ref<Record<string, IClientCategory> | null>(null);

// 只有那一格真是分类写法时才去取分类表；取回来时路径可能已经被改了，所以要认回来那一份才算数
watch(
  [selectedDownloaderId, savePath],
  async ([id, path]) => {
    if (!isCategorySavePath(path)) {
      categoryTable.value = null;
      return;
    }
    const table = await loadCategoryTable(id);
    if (selectedDownloaderId.value === id && savePath.value === path) categoryTable.value = table;
  },
  { immediate: true },
);

const basePathMismatch = computed(() =>
  useLocalBase.value
    ? detectBasePathMismatch({
        basePath: chosenLocalBase.value?.entry.savePath,
        taskPath: savePath.value,
        categories: categoryTable.value,
      })
    : null,
);

/** 已经点过「把本地文件移过去」；搬没搬完不看它，看基准此刻的实际路径（下面那条提示会自己消失） */
const baseMoveRequested = ref(false);
const baseMoving = ref(false);

// 换基准、改目录都可能让上一次那个「搬过去」不再对应现在的目标 —— 标记退回未请求，重新问一遍
watch([localBaseHash, savePath], () => {
  baseMoveRequested.value = false;
});

/** 处置一：辅种改用本地那份所在的目录（不动盘上的东西，只改任务挑的目录） */
function useLocalBasePath() {
  const mismatch = basePathMismatch.value;
  if (!mismatch) return;
  savePath.value = mismatch.basePath;
}

/**
 * 处置二：让下载器把本地那份搬到任务目录。
 *
 * 这里只**发起**搬运，不当它已经搬完：几十万行的数据在 NAS 上要跑几分钟，而发送那道闸
 * 看的是基准的实际路径（`baseLocal.savePath`，回查时按下载器报的刷新），搬完才放行。
 * 所以点完之后的提示是「正在搬」而不是把警告撤掉 —— 撤掉等于谎报。
 *
 * ⚠️ 一起搬的不止基准：同一份内容在下载器里往往是好几条种子（每站一条，共用盘上同一个文件夹），
 * 只搬基准会把那个文件夹从其余那几条脚下抽走，第二天开下载器一排「丢失文件」
 * （用户 2026-10-14 在辅种任务页报的，这一屏是同一个洞）。哪些算相关由
 * `@/shared/reseedMoveCohort.ts` 判，与那一屏共用一份。
 */
async function moveLocalBaseToTaskPath() {
  const mismatch = basePathMismatch.value;
  const hash = chosenLocalBase.value?.entry.hash;
  if (!mismatch || !hash || baseMoving.value) return;

  baseMoving.value = true;
  try {
    const downloaderId = selectedDownloaderId.value;
    const cohort = pickRelocateCohort({
      // 这份索引就是该下载器的全部种子（基准候选是从它里挑的），不必再取一遍列表
      torrents: (localIndex.value?.entries ?? []).map((x) => ({ hash: x.hash, name: x.name, savePath: x.savePath })),
      baseHash: hash,
      oldPath: mismatch.basePath,
      newPath: mismatch.taskPath,
    });

    const moved = await sendMessage("setClientTorrentLocation", {
      downloaderId,
      // 基准先走：真挪文件的是它，后面那几条只是把落点改过来
      id: cohort.hashes[0],
      // 取 mismatch 里那一份，不是输入框的原样：那一格可以写 `category:电影`，那是分类不是目录，
      // 原样发过去会被下载器当场拒掉（用户 2026-10-11 报的 409）。判据已经把它翻成真实目录了。
      location: mismatch.taskPath,
    });
    if (moved === false) {
      // false 只表示这台客户端没有移动数据的能力（各驱动的默认实现），不是搬输了
      runtimeStore.showSnakebar(t("KeepUploadTask.pathMismatch.unsupported"), { color: "warning" });
      return;
    }

    const { failed } = await moveReseedCohort(downloaderId, cohort.hashes.slice(1), mismatch.taskPath);

    baseMoveRequested.value = true;
    runtimeStore.showSnakebar(
      cohort.hashes.length > 1
        ? t("KeepUploadTask.pathMismatch.moveSentCohort", { n: cohort.hashes.length })
        : t("KeepUploadTask.pathMismatch.moveSent"),
      { color: "success" },
    );
    if (failed > 0) {
      runtimeStore.showSnakebar(t("KeepUploadTask.pathMismatch.moveCohortPartial", { n: failed }), {
        color: "warning",
        timeout: 12,
      });
    }
  } catch (e) {
    runtimeStore.showSnakebar(
      t("KeepUploadTask.pathMismatch.moveFailed", { reason: e instanceof Error ? e.message : String(e) }),
      { color: "error" },
    );
  } finally {
    baseMoving.value = false;
  }
}

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

/**
 * 候选列表的列。原先这一整块是自由布局的 flex 行（站点名长短不一 → 每行的标题起点都在漂，
 * 大小/文件数/状态挤成第二行一坨），他 2026-10-09 要求改成表格。
 *
 * 「基准 / 其他」做成一列而不是两行小标题：表格没有分组行，而这一列还有个额外好处 ——
 * 点「设为基准种子」时能看到那颗标记真的挪到了另一行上。
 * 基准取自下载器（`useLocalBase`）或只勾一条时，列表里没有基准这一说，整列撤掉，
 * 留一列一模一样的「其他」标签是噪声。
 */
/**
 * 基准 = `verifiedItemsOrder` 的第一条。表头排序会改**渲染序**（`#bodyCell` 的 `index`），
 * 但基准从来只由那个数组的头一项决定 —— 所以凡判「这一条是不是基准」一律按 id 比。
 * 原来这几处写的是 `index === 0` / `index > 0`：在没有排序的表格里两者等价，
 * 这次给「做种 / 下载」加了排序，照旧写法会把「基准」标签画到排序后的第一行上，
 * 而它其实只是做种人数最少的那一条。
 */
const baseId = computed(() => verifiedItemsOrder.value[0] ?? "");
const baseItem = computed(() => verifiedItems.value.get(baseId.value) ?? null);

/**
 * 「能当基准的候选」这一份清单，三个出口共用：两组推荐、默认基准挪哪一条、那句退让提示。
 *
 * 只在这张表真的靠「列表第一条」当基准时才有意义：基准取自下载器（`useLocalBase`）或只勾一条时
 * 列表里没有「当基准」这一说 —— 跟角色列同一判据（所以那一列撤掉时这三样也一起撤，
 * 用户 2026-10-11 定的适用范围就是「只拦列表里挑基准那条路」）。
 * 还要过一道 `!!item.torrent`：没拿到种子文件的那一条点不动，推荐它等于给一颗死按钮。
 */
const listBaseCandidates = computed(() => {
  if (isSingleMode.value || useLocalBase.value) return [];
  return includedItems.value
    .filter((item) => !!item.torrent)
    .map((item) => ({
      id: item.id,
      seeders: item.data.seeders,
      tags: item.data.tags,
      ratio: metadataStore.lastUserInfo?.[item.data.site]?.ratio,
    }));
});

/** 这一条所在站的分享率报不报得出、低于不低于 1（判据在 `@/shared/reseedRecommend.ts`） */
function ratioVerdictOf(item: IVerifiedItem) {
  return reseedRatioVerdict(metadataStore.lastUserInfo?.[item.data.site]?.ratio);
}

/**
 * 站点那一格悬停时，「下完这一条之后」要不要真算 —— 判的是这一条在当前流程里会不会被下载。
 *
 * 辅种只有**基准那一条**要真下一次（其余是跳过校验直接算完成），基准取自下载器时那一条
 * 已经在里面了、整批都不下。把 15 GiB 记到不会下的那几条头上，就是凭空吓人。
 * 顺序不能换：`useLocalBase` 时角色列整列撤掉、`baseId` 不再指列表里的某一条，所以先判它。
 */
function siteRatioImpact(item: IVerifiedItem): TRatioImpact {
  if (useLocalBase.value) return "localBase";
  if (item.id !== baseId.value) return "skipCheck";
  if (isFreeTorrent(item.data.tags)) return "free";
  const size = item.data.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "noSize";
  return "download";
}

// 角色列那颗标签的两截文字。写成函数而不是在模板里摆两个三元：
// `:title="x === "low" ? …"` 这种嵌套双引号会把模板解析炸掉（实测 TS1003），抽出来顺带去掉重复判断。
const ratioTagLabels = computed<Record<"low" | "unknown", { text: string; tip: string }>>(() => ({
  low: { text: t("SearchEntity.KeepUploadDialog.baseRatio.low"), tip: t("SearchEntity.KeepUploadDialog.baseRatio.lowTip") },
  unknown: {
    text: t("SearchEntity.KeepUploadDialog.baseRatio.unknown"),
    tip: t("SearchEntity.KeepUploadDialog.baseRatio.unknownTip"),
  },
}));

/** 这一行那颗分享率标签（文字 + 悬停说明）。达标的那一档模板不会走到这里 */
function ratioTag(item: IVerifiedItem) {
  return ratioTagLabels.value[ratioVerdictOf(item) === "low" ? "low" : "unknown"];
}

/**
 * 一个达标的都没有 —— 那一行退让提示的判据（措辞见 locale 里的 baseRatio.allLow） */
const allBaseRatiosLow = computed(() => allBasesTooLow(listBaseCandidates.value));

/**
 * 两组推荐基准（做种最多 / 免费里做种最多），判据在 `@/shared/reseedRecommend.ts`。
 * 分享率那一档已经在 `listBaseCandidates` 里带着，由判据自己筛。
 */
const recommendations = computed(() => {
  const list = pickBaseRecommendations(listBaseCandidates.value);
  // 站点名在这里一起算好：SiteName 那一栏要它，而按钮里没有可靠的 index/id 反查
  return list.map((r) => ({ ...r, site: verifiedItems.value.get(r.id)?.data.site ?? "" }));
});

/** 这一条是不是被推荐当基准的那两条之一（角色列第二行的小标签用它） */
function recommendOf(item: IVerifiedItem) {
  return recommendations.value.find((r) => r.id === item.id);
}

/** 键是字面量写死的两条（不用 `t("前缀" + kind)`）：防线③看不见拼出来的键（AGENTS §3.4） */
const recommendKindText = computed<Record<TReseedRecommendKind, string>>(() => ({
  mostSeeders: t("SearchEntity.KeepUploadDialog.recommend.mostSeeders"),
  mostSeedersFree: t("SearchEntity.KeepUploadDialog.recommend.mostSeedersFree"),
}));
const recommendKindShort = computed<Record<TReseedRecommendKind, string>>(() => ({
  mostSeeders: t("SearchEntity.KeepUploadDialog.recommend.mostSeedersShort"),
  mostSeedersFree: t("SearchEntity.KeepUploadDialog.recommend.mostSeedersFreeShort"),
}));
const recommendKindHint = computed<Record<TReseedRecommendKind, string>>(() => ({
  mostSeeders: t("SearchEntity.KeepUploadDialog.recommend.mostSeedersHint"),
  mostSeedersFree: t("SearchEntity.KeepUploadDialog.recommend.mostSeedersFreeHint"),
}));

/** 角色 96：这一列现在要容得下第二行的推荐短标签（英文 "Free top" 47px + 内衬 16 + 余量） */
const columns = computed<TableColumnsType<IVerifiedItem>>(() => {
  const cols: TableColumnsType<IVerifiedItem> = [];
  if (!isSingleMode.value && !useLocalBase.value) {
    cols.push({ title: t("SearchEntity.KeepUploadDialog.columns.role"), key: "role", align: "center", width: 96 });
  }
  return [
    ...cols,
    { title: t("SearchEntity.KeepUploadDialog.columns.site"), key: "site", width: 124 },
    // 唯一不给 width 的那一列：fixed 布局下它吃剩余宽度（给每一列都钉死宽度会被按比例一起放大）
    { title: t("SearchEntity.KeepUploadDialog.columns.title"), key: "title", ellipsis: true },
    { title: t("SearchEntity.KeepUploadDialog.columns.size"), key: "size", align: "right", width: 92 },
    { title: t("SearchEntity.KeepUploadDialog.columns.files"), key: "files", align: "center", width: 72 },
    // 做种 / 下载：挑基准的两个主要信息，所以给排序。表头宽 = 文字 + 箭头 1em+4 + small 档内衬 16×2
    // → 英文 "Seeders"/"Leechers" 要 80 上下，取 88。
    {
      title: t("SearchEntity.KeepUploadDialog.columns.seeders"),
      key: "seeders",
      align: "right",
      width: 88,
      sorter: (a, b) => (toCount(a.data.seeders) ?? -1) - (toCount(b.data.seeders) ?? -1),
    },
    {
      title: t("SearchEntity.KeepUploadDialog.columns.leechers"),
      key: "leechers",
      align: "right",
      width: 88,
      sorter: (a, b) => (toCount(a.data.leechers) ?? -1) - (toCount(b.data.leechers) ?? -1),
    },
    { title: t("SearchEntity.KeepUploadDialog.columns.status"), key: "status", width: 150 },
    { title: t("common.action"), key: "action", align: "center", width: 170 },
  ];
});

/**
 * 能不能把某一条挪成基准：只有「基准取自列表第一条」那条路有意义，它得已经拿到种子信息，
 * 而且所在站的分享率不能明确低于 1（基准那一条要真下一遍，会把这一站的分享率继续往下拉）。
 * 报不出分享率的照旧可挑 —— 判不出就不假装知道，见 `reseedRatioVerdict`。
 */
function canPromote(item: IVerifiedItem): boolean {
  return (
    item.id !== baseId.value &&
    !isSingleMode.value &&
    !useLocalBase.value &&
    !!item.torrent &&
    ratioVerdictOf(item) !== "low"
  );
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
  noBase: t("SearchEntity.KeepUploadDialog.status.noBase"),
}));

/**
 * 档位 → 当前语言的文案（状态那一列和那颗 tooltip 都读它）。
 *
 * 写成函数而不是在模板里直接 `statusText[record.status]`：`#bodyCell` 的 record 是 any，
 * 拿 any 去索引上面那个字面量对象会被判成隐式 any（TS7053）。
 */
function statusLabel(item: IVerifiedItem): string {
  return statusText.value[item.status];
}

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
    console.error("[PT-Assistant] 读取本地指纹索引失败", e);
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

/**
 * 分享率明确低于 1 的那一条不能当基准，所以列表头一项落在它身上时，把第一条能当的挪到最前。
 *
 * 为什么可以放心代换：这类行压根没有「设为基准种子」那颗按钮（见 `canPromote`），
 * 用户没法显式选它 —— 它排在头一位只可能是勾选顺序带进来的。
 * 全都低于 1 时 `pickDefaultBaseId` 退回头一条，这个 watch 因此不动手，界面另有那句提示。
 *
 * ⚠️ 这一段必须排在 `includedItems` **之后**：`immediate: true` 会在 setup 里就把
 * `listBaseCandidates` 求一遍值，而那份 computed 读的就是 `includedItems` —— 放在它上面是
 * `ReferenceError: Cannot access 'includedItems' before initialization`（整个弹窗炸掉，
 * 台架实测到的；computed 本身写在那儿没事，因为它要到渲染才第一次求值）。
 */
watch(
  listBaseCandidates,
  (list) => {
    const want = pickDefaultBaseId(list);
    if (want && want !== baseId.value) setItemBase(want);
  },
  // immediate：候选在挂载时就可能已经齐了（重开弹窗、缓存命中），不等一次变化才挪
  { immediate: true },
);

/**
 * 表格上方那行汇总的分档计数 —— 各档之和恒等于 `total`，也就是表里的行数。
 *
 * 主数字取「指纹判定通过」那一档，不是 `verified` 的条数：`verified` 里还混着基准免检那条和用户点
 * 「+」认下的那条，它们的状态列写的都不是「验证通过」，拿它当主数字，用户照着状态列数一遍就对不上。
 * 而 `verified` 那条数才是「创建任务」实际会带走的条数 —— 所以它拆成「基准 / 人工确认」两档摆在同一行里，
 * 两个数都在场、各说各的话。
 *
 * 分桶读的是 `item.status` 这个档位而不是界面文案：文案由 locale 现算，切语言后旧文案还留在条目上，
 * 按文案比会把每一条都算进「未通过」。
 */
const verifySummary = computed(() => {
  const items = includedItems.value;
  const acc = { total: items.length, passed: 0, base: 0, confirmed: 0, needManual: 0, checking: 0, failed: 0 };
  for (const item of items) {
    if (item.loading || item.status === "downloading" || item.status === "waiting") {
      acc.checking += 1;
    } else if (item.status === "success") {
      acc.passed += 1;
    } else if (item.verified && item.status === "downloaded") {
      acc.base += 1;
    } else if (item.verified) {
      // 用户点「添加到辅种列表」认下的：算进任务，但机器判定那两档（通过 / 未通过）不动它
      acc.confirmed += 1;
    } else if (item.status === "needManual") {
      acc.needManual += 1;
    } else {
      acc.failed += 1;
    }
  }
  return acc;
});

/** 主数字之外的几档：只列非零的，一条都没有就不占位 */
const verifyBuckets = computed(() => {
  const s = verifySummary.value;
  const buckets: { key: string; text: string; bad?: boolean }[] = [];
  if (s.base) {
    buckets.push({ key: "base", text: t("SearchEntity.KeepUploadDialog.verifySummary.base", { n: s.base }) });
  }
  if (s.confirmed) {
    buckets.push({
      key: "confirmed",
      text: t("SearchEntity.KeepUploadDialog.verifySummary.confirmed", { n: s.confirmed }),
    });
  }
  if (s.needManual) {
    buckets.push({
      key: "needManual",
      text: t("SearchEntity.KeepUploadDialog.verifySummary.needManual", { n: s.needManual }),
    });
  }
  if (s.failed) {
    buckets.push({
      key: "failed",
      text: t("SearchEntity.KeepUploadDialog.verifySummary.failed", { n: s.failed }),
      bad: true,
    });
  }
  if (s.checking) {
    buckets.push({ key: "checking", text: t("SearchEntity.KeepUploadDialog.verifySummary.checking", { n: s.checking }) });
  }
  return buckets;
});

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
  // 作废上一轮还在飞的等待回调（换基准 / 重开弹窗时它们还在每 200ms 轮询）
  cancelAllPendingVerifications();
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
  applyAutoCategoryPath();

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
      status: "downloading",
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
    item.status = "waiting";
    return result;
  } catch (e) {
    // 边界检查：确保项仍然存在
    const item = verifiedItems.value.get(id);
    if (item) {
      item.status = "downloadFailed";
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
      item.status = "success";
    } else {
      item.status = verdict === "unknown" ? "needManual" : "failed";
    }
    applyLocalDecision(item);
    return;
  }

  if (item === listItemBase.value) {
    item.verified = true;
    item.status = "downloaded";
    applyLocalDecision(item);
    return;
  }

  const base = baseTorrent.value;
  if (!base || !listItemBase.value?.verified) {
    // 走到这里说明这一条的数据是拿到手的，只是没有参照物 —— 不是「比过、不是同一份」
    item.status = "noBase";
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
  } else if (baseMatch.verdict === "different") {
    // 指纹已判定「不是同一份」，绝不能落到legacy 兜底 —— legacyVerify 只比总长度与
    // 文件齐全与否，异种数据同样可能通过，标成 verified 会被当成同数据辅种
    // （做种校验失败 / H&R 风险）。
    item.verified = false;
    item.verifiedBy = undefined;
  } else {
    // 只有「判不出结论」（absent / unavailable，指纹算不出来）才退回逐条比对文件清单。
    // 注意 candidate 也归到这里：它表示「疑似」，不是确认，由文件清单再兜一层。
    item.verified = legacyVerify(info, base);
    item.verifiedBy = "legacy";
  }

  item.status = item.verified
    ? "success"
    : // 没通过时顺手说明原因：是「基准种子更大、本地缺文件」还是压根不是同一份数据
      hasAllFilesOf(info, base)
      ? "missingFiles"
      : "failed";
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

/**
 * 验证轮次的世代号：每次重置（换基准 / 清空列表 / 卸载）就 +1，
 * 让上一轮还在飞的 `setTimeout` 全部作废。
 */
let verificationRound = 0;

/** 每个 id 至多一个在飞的等待定时器，卸载时统一清掉 */
const pendingVerificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelAllPendingVerifications() {
  verificationRound++;
  for (const timer of pendingVerificationTimers.values()) {
    clearTimeout(timer);
  }
  pendingVerificationTimers.clear();
}

onUnmounted(cancelAllPendingVerifications);

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
    // 这一条自己就没下到种子文件 —— 写成「验证失败」会把人指向「内容不是同一份」，
    // 而真因是拿不到文件。`getTorrent` 的 catch 已经标过这一档，这里再显式写一次是因为
    // `reDownload` 会先把状态置成「正在下载种子信息」，不写就停在那一档上。
    item.verified = false;
    item.status = "downloadFailed";
    return;
  }

  // 等待基准种子下载完成
  const baseItem = verifiedItems.value.get(verifiedItemsOrder.value[0]);
  if (baseItem?.loading) {
    // ⚠️ 这个递归 setTimeout 原来既不保存句柄也不带世代号：
    //  - 卸载 / 关闭弹窗 / 清空列表之后，旧回调照样醒来继续跑，
    //    每 200ms 一次直到基准种子的 loading 变 false —— 而那时 map 里
    //    那条早就没了，函数开头的 !item 提前 return 才把它拦住，
    //    但那是「靠数据消失兜底」，不是有意的取消；
    //  - 更糟的是「换基准」/「清空列表」后同一个 id 重新加进来时，
    //    上一轮的回调与新一轮的判定会互相覆盖 verified / status。
    // 这里记住句柄用于卸载时清干净，并让每轮携带一个世代号，
    // 世代一变（旧一轮）就不再续排。
    const myRound = verificationRound;
    pendingVerificationTimers.set(
      id,
      setTimeout(() => {
        pendingVerificationTimers.delete(id);
        if (myRound !== verificationRound) return;
        verification(torrent, id);
      }, 200),
    );
    return;
  }

  item.loading = false;
  // 先把这一趟拿到手的数据存下，再判基准在不在。原先的顺序是「基准不可用就直接 return」，
  // `item.torrent` 留空 —— 而 `recompareAll` 开头就是 `if (!item.torrent) return`，
  // 于是之后换基准、改挑下载器里那条当基准，全都跳过这一条，它只能停在失败档等手动重下。
  if (torrent) item.torrent = torrent;

  if (!torrent) {
    // 这一条自己的种子文件就没下下来，跟「内容不是同一份」不是一回事
    item.verified = false;
    item.status = "downloadFailed";
    return;
  }
  if (!baseItem?.verified) {
    // 数据是好的，只是场上没有参照物可比 —— 不能报成「验证失败」
    item.verified = false;
    item.status = "noBase";
    return;
  }
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
  item.status = "downloading";

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
  // 换了一台下载器，它的分类目录是另一套；清完立刻按种子分类重新预选
  applyAutoCategoryPath();
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
/**
 * 这一条就是基准本身 —— 下载器里已经挂着它，不是「要辅种的条目」。
 *
 * 用的不是新判据，是界面上已经画出来给用户看的那一颗「同站已挂」徽标（`localDecision.reason`
 * 由指纹层按「命中的本地条目已挂在这个站上」判的），外加一条更硬的：infoHash 与所选基准相同。
 * 私有站 announce 里带 passkey，同一份内容两次下载算出的 hash 可以不一样，所以只认 hash 会漏 ——
 * 用户截图那一行写的是「文件清单指纹一致」而不是「infoHash 一致」，走的正是徽标那一条。
 */
function isTheBaseItself(item: IVerifiedItem): boolean {
  if (!useLocalBase.value) return false;
  if (item.localDecision?.reason === "same-site-already") return true;
  const base = chosenLocalBase.value?.entry.hash;
  const own = item.torrent?.infoHash;
  return !!base && !!own && String(own).toLowerCase() === String(base).toLowerCase();
}

async function createKeepUploadTask() {
  if (!canCreateTask.value || !selectedDownloaderId.value) return;

  const verifiedList = includedItems.value.filter((item) => item.verified);
  if (verifiedList.length === 0) {
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.noVerifiedItem"), { color: "error" });
    return;
  }

  /**
   * 验证通过的那几条全是「下载器里已经挂着的那一份」时拒建（用户 2026-10-12 的要求）：
   * 这种任务一条都不用它辅 —— 基准取自下载器时，后台把 `items` 里每一条都当成要挂上去的辅种
   * （`allOthers = task.items`，见 `KeepUploadTask/autoReseed.ts`），于是建出来是一条空任务，
   * 界面上是「种子数 1、唯一那条就是基准本身」。
   * 这里**只拦创建**，不改 `items` 的组成 —— 哪些行该进任务是另一件事，没在这次范围里。
   */
  if (verifiedList.every((item) => isTheBaseItself(item))) {
    runtimeStore.showSnakebar(t("SearchEntity.KeepUploadDialog.noReseedTarget"), { color: "error" });
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
      // 自动辅种：建完任务后由后台每分钟替人往下走那条链（判据在 `KeepUploadTask/autoReseed.ts`）。
      // 这里**必须显式写值**：任务页/后台判的是 `=== true`，写成 undefined 的旧任务不会被突然
      // 开始自动发种子（那等于给存量用户开了一个他们从没同意的开关）。
      autoReseed: autoReseed.value,
      // 单条模式：基准是下载器里那条，不在 items 里。任务页靠这个标记决定
      // 「发送基准种子」那两颗要不要出现，并把基准的名字显示出来。
      baseLocal: chosenLocalBase.value
        ? {
            hash: chosenLocalBase.value.entry.hash,
            name: chosenLocalBase.value.entry.name,
            savePath: chosenLocalBase.value.entry.savePath,
            // 用户挑的是「把本地那份搬过来」时带上这一项：任务页据此把提示写成「正在搬」而不是
            // 「请选一种处置」。它不是发送闸门 —— 那道闸看基准的实际路径，见 `shared/reseedPath.ts`
            moveToTaskPath: baseMoveRequested.value || undefined,
          }
        : undefined,
      items: verifiedList.map((item) => ({
        site: item.data.site,
        // 这一站的种子 id 要一起记下来：有 7 个站靠它换下载链接（yemapt / mteam 那批），
        // 少了它发送会失败，而站点回的是不带原因的 `{success:false}`，看着像账号或网络坏了。
        // 判据在 IKeepUploadTaskItem.id 那条注释。
        id: item.data.id,
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
    // 催后台立刻走一轮自动辅种。不催的话这条新任务要等下一次定时（最多 1 分钟）才被看到，
    // 用户视角就是「勾了自动辅种，基准却过了一分钟才推下去」。
    // fire-and-forget：这一趟要等下载器回包（几秒），弹窗不该为它停在「创建中」。
    if (autoReseed.value) void sendMessage("runAutoReseedTick", undefined).catch(() => {});
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
  <a-modal v-model:open="showDialog" :title="t('SearchEntity.KeepUploadDialog.title')" :width="1280" :mask="{ closable: false }">
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

    <!-- 「增加分类」的那张表单，同样挂在本弹窗默认插槽里（上一条注释的那条理由对它一样成立）。
         它必须真去下载器建一条带目录的分类，不能只把 `category:新名字` 填进保存路径就完事：
         qBittorrent 是在添加种子那一刻顺手建出缺失的分类，那条建出来**没有目录**，而辅种走的是
         跳过校验、直接挂盘上现成的数据 —— 目录对不上就是一条永远 0% 的死种。 -->
    <a-modal
      v-model:open="showCategoryDialog"
      :title="t('SearchEntity.KeepUploadDialog.addCategory')"
      :width="480"
      :ok-text="t('common.dialog.ok')"
      :cancel-text="t('common.dialog.cancel')"
      :confirm-loading="categorySaving"
      @ok="submitCategoryDialog"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('SearchEntity.KeepUploadDialog.categoryName')">
          <a-input v-model:value="newCategoryName" />
        </a-form-item>
        <a-form-item
          :label="t('SearchEntity.KeepUploadDialog.categoryPath')"
          :extra="t('SearchEntity.KeepUploadDialog.categoryPathHint')"
        >
          <a-auto-complete v-model:value="newCategoryPath" :options="plainPathOptions" style="width: 100%" />
        </a-form-item>
      </a-form>
    </a-modal>

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

    <!-- 基准在 A、这一批要挂到 B：下载器在 B 里找不到数据，发出去必然失败，所以在这里就问一句，
         而不是等下载器那边报一条没原因的失败。两条路径都写出来，是因为它们分别显示在两个地方
         （基准那一栏的下拉里、底部那一栏的输入框里），不并排就看不出「不一样」在哪。 -->
    <a-alert
      v-if="basePathMismatch"
      class="path-mismatch mb-2"
      type="warning"
      show-icon
      :message="t('KeepUploadTask.pathMismatch.title')"
    >
      <template #description>
        <div class="path-mismatch-lines">
          <div>
            <!-- 写的是判据算出来的那一份，不是输入框里的原样：输入框可以写 `category:电影`
                 （分类而不是目录），而这一行要跟下面那行基准目录比得出高低，也必须跟
                 「移到任务目录」真发出去的那一份一致。 -->
            {{ t("KeepUploadTask.pathMismatch.taskPath", { path: basePathMismatch.taskPath }) }}
          </div>
          <div>
            {{ t("KeepUploadTask.pathMismatch.basePath", { path: basePathMismatch.basePath }) }}
          </div>
          <div>
            {{ baseMoveRequested ? t("KeepUploadTask.pathMismatch.moving") : t("KeepUploadTask.pathMismatch.detail") }}
          </div>
        </div>
      </template>
      <template v-if="!baseMoveRequested" #action>
        <a-space>
          <a-button size="small" :disabled="baseMoving" @click="useLocalBasePath">
            {{ t("KeepUploadTask.pathMismatch.useBase") }}
          </a-button>
          <a-button size="small" :loading="baseMoving" @click="moveLocalBaseToTaskPath">
            {{ t("KeepUploadTask.pathMismatch.moveBase") }}
          </a-button>
        </a-space>
      </template>
    </a-alert>

    <!-- 两组推荐基准（他 2026-10-10：「要给出2组推荐的种子作为基准，一组是做种人数最多的，
         一组是免费的里面做种人数最多的」）。放在表格正上方而不是并到「基准种子」那一栏里：
         那一栏挑的是**下载器里**的种子，这两颗挑的是**列表里**的种子，两种来路混一排会读成同一个下拉。
         一条都推荐不出来时整行不出（不摆两颗空按钮）；两组指向同一条时只出一颗。 -->
    <div v-if="recommendations.length" class="recommend-row mb-2">
      <span class="recommend-label">{{ t("SearchEntity.KeepUploadDialog.recommend.label") }}</span>
      <a-tooltip
        v-for="r in recommendations"
        :key="r.kind"
        :title="r.id === baseId ? t('SearchEntity.KeepUploadDialog.recommend.alreadyBase') : recommendKindHint[r.kind]"
      >
        <!-- 站点名走 SiteName 组件而不是字符串拼接：真名要异步取（siteNameMap 没命中时它自己回落），
             在 computed 里直接写 `siteNameMap?.[site] ?? site` 会把内部 id 画到按钮上（AGENTS §3.5）。 -->
        <a-button size="small" :disabled="r.id === baseId" @click="setItemBase(r.id)">
          <span class="recommend-text">
            <span class="recommend-kind">{{ recommendKindText[r.kind] }}</span>
            <SiteName :site-id="r.site" tag="span" class="recommend-site" />
            <span class="recommend-count">{{ t("SearchEntity.KeepUploadDialog.recommend.seedersCount", { n: r.seeders }) }}</span>
          </span>
        </a-button>
      </a-tooltip>
    </div>

    <!-- 一个达标的都没有时规则退让（照旧拿列表第一条当基准），但要说清为什么退让 ——
         否则他刚看到那一行的「低分享率」标记，转头又发现被标着的这条就是基准，两句互相矛盾。 -->
    <a-alert v-if="allBaseRatiosLow" class="mb-2" type="warning" show-icon>
      <template #message>{{ t("SearchEntity.KeepUploadDialog.baseRatio.allLow") }}</template>
    </a-alert>

    <!-- 汇总那一行：这张表里现在有几条判定通过、还剩几条要人处理。放在表格正上方（而不是弹窗标题里）
         是因为它数的就是下面这些行；数字怎么分档见 `verifySummary` 的注释。
         一条都还没有时整行不出 —— 空表下面挂一句「验证通过 0 / 共 0 条」是新 bug，不是信息。 -->
    <div v-if="verifySummary.total" class="verify-summary mb-2">
      <span class="verify-summary-main">
        {{ t("SearchEntity.KeepUploadDialog.verifySummary.pass", { n: verifySummary.passed, total: verifySummary.total }) }}
      </span>
      <span
        v-for="bucket in verifyBuckets"
        :key="bucket.key"
        class="verify-summary-bucket text-body-small"
        :class="bucket.bad ? 'text-red' : 'text-grey'"
      >
        {{ bucket.text }}
      </span>
    </div>

    <!-- 这里不再自己当滚动容器（原先是 `style="max-height: 80vh"` + 下面那条 overflow-y）：
         弹窗 body 已经由 v0.42.4 那条 flex 链负责限高与滚动，两层都在滚就是双竖向滚动条。 -->
    <div class="keep-upload-list">
      <!-- 表格而不是逐行 flex：站点名长短不一会让每行的标题起点都在漂，大小/文件数/状态
           又挤成第二行一坨（他 2026-10-09：「这个地方用表格啊，现在这样歪歪扭扭的好看吗」）。
           不给 scroll.x：弹窗里再挂一条横向滚动条是双重滚动，标题列自己有截断 + 悬停全文。 -->
      <a-table
        bordered
        size="small"
        row-key="id"
        :columns="columns"
        :data-source="includedItems"
        :pagination="false"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'role'">
            <a-tag :color="record.id === baseId ? 'blue' : 'default'">
              {{ record.id === baseId ? t("SearchEntity.KeepUploadDialog.baseTorrent") : t("SearchEntity.KeepUploadDialog.otherTorrent") }}
            </a-tag>
            <!-- 推荐的两条在表里也要认得出来：上面那排按钮写的是站名 + 做种数，而这一屏里几条同站、
                 同大小的结果并排，光靠站名对不到具体哪一行。包成一个 flex 列，两颗标签不零间距贴边。 -->
            <div v-if="recommendOf(record)" class="role-recommend">
              <a-tag color="gold">{{ recommendKindShort[recommendOf(record)!.kind] }}</a-tag>
            </div>
            <!-- 分享率那一档为什么标在角色列：它说的就是「这一条能不能当基准」，与上面那颗标记同一件事。
                 低于 1 的行没有「设为基准种子」（见 canPromote），不标一下就成了静默消失。 -->
            <div v-if="ratioVerdictOf(record) !== 'ok'" class="role-recommend role-ratio">
              <a-tag :color="ratioVerdictOf(record) === 'low' ? 'volcano' : 'default'" :title="ratioTag(record).tip">
                {{ ratioTag(record).text }}
              </a-tag>
            </div>
          </template>

          <!-- 图标旁边必须带上站点名：不少站点的 favicon 长得一样（他截图里 SBPT 和「库非」
               两颗都是同一个蓝底 N），只有图标就分不出这一条是哪个站。
               悬停出账户数与「下完这一条之后」（用户 2026-10-11 指着这一列提的）。 -->
          <template v-else-if="column.key === 'site'">
            <SiteRatioPopover
              :site-id="record.data.site"
              :size="record.data.size"
              :impact="siteRatioImpact(record)"
            >
              <div class="d-flex align-center ga-1 site-cell">
                <SiteFavicon :site-id="record.data.site" :size="18" />
                <SiteName
                  :site-id="record.data.site"
                  tag="span"
                  class="text-body-small text-grey text-truncate flex-1-1-0"
                />
              </div>
            </SiteRatioPopover>
          </template>

          <template v-else-if="column.key === 'title'">
            <div class="text-truncate">
              <!-- 刻意不用 a-typography 的 ellipsis：它要把子节点折成纯文本去量宽度，
                   里面的 <a> 会整个丢掉（文字照样显示、只是点不动）。见 AGENTS §3.4。 -->
              <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                <template #content>
                  <div class="reveal-text">{{ record.data.title }}</div>
                </template>
                <a :href="record.data.link" target="_blank" rel="noopener noreferrer nofollow" class="list-link">
                  {{ record.data.title }}
                </a>
              </a-popover>
            </div>
            <div v-if="localBadges(record).length" class="d-flex ga-1 mt-1 flex-wrap">
              <!-- 这里原本给 a-tag 传了 `bordered`，已删。注意它**不是死属性**（早先注释这么写是错的）：
                   Tag 声明了 bordered?: boolean 且无 @deprecated，hooks/useColor.js:16 真读它，
                   语义是降级（false → 强制 filled）—— 它造不出描边，要描边请用 variant="outlined" -->
              <a-tag v-for="badge in localBadges(record)" :key="badge.key" :color="badge.color" :title="badge.title">
                {{ badge.text }}
              </a-tag>
              <span
                v-for="site in record.localMatch?.match?.sites ?? []"
                :key="site"
                class="text-body-small text-grey"
              >
                <SiteName :site-id="site" tag="span" />
              </span>
            </div>
          </template>

          <template v-else-if="column.key === 'size'">
            {{ formatSize(record.data.size ?? 0) }}
          </template>

          <template v-else-if="column.key === 'files'">
            {{ getFileCount(record) }}
          </template>

          <!-- 判不出就是空格，不写 0：0 会上报「这个站说没人做种」，而实情是站点没给这一格
               （同一口径见 @/shared/torrentCount.ts 的 countText） -->
          <template v-else-if="column.key === 'seeders'">
            {{ countText(record.data.seeders) }}
          </template>

          <template v-else-if="column.key === 'leechers'">
            {{ countText(record.data.leechers) }}
          </template>

          <!-- 判定依据单独一行：它决定这条结论有多硬，混在状态后面会被当成状态的一部分读掉 -->
          <template v-else-if="column.key === 'status'">
            <div>{{ statusLabel(record) }}</div>
            <div v-if="verifiedByText(record)" class="text-body-small text-grey">{{ verifiedByText(record) }}</div>
          </template>

          <template v-else-if="column.key === 'action'">
            <!-- 「有参照物可比」的两种来路：基准取列表第一条时要求它已经验证通过（所以除它以外的行才比得了，
                 判据是 id 而不是渲染序 —— 这一列现在能按做种/下载排序）；
                 基准取下载器那条时参照物一直在，第一条也允许人工确认 / 重下 -->
            <a-button
              v-if="!record.loading && !record.verified && (useLocalBase || (record.id !== baseId && baseItem?.verified))"
              type="text"
              size="small"
              :title="t('SearchEntity.KeepUploadDialog.addToKeepUpload')"
              @click.stop="addToVerified(record.id)"
            >
              <template #icon><PlusOutlined /></template>
            </a-button>

            <a-button
              v-if="!record.loading && !record.torrent && (useLocalBase || (record.id !== baseId && baseItem?.verified))"
              type="text"
              size="small"
              :title="t('SearchEntity.KeepUploadDialog.redownload')"
              @click.stop="reDownload(record.id)"
            >
              <template #icon><SyncOutlined /></template>
            </a-button>

            <!-- 原先是一颗向上的箭头图标，悬停才有说明：行右侧同时挂着三颗图标钮，
                 「向上」看不出是「把这一条挪成基准」，所以直接写成文字。 -->
            <a-button
              v-if="canPromote(record)"
              type="link"
              size="small"
              :title="t('SearchEntity.KeepUploadDialog.setAsBase')"
              @click.stop="setItemBase(record.id)"
            >
              {{ t("SearchEntity.KeepUploadDialog.setAsBase") }}
            </a-button>

            <a-tooltip :title="statusLabel(record)">
              <a-button type="text" size="small" :loading="record.loading">
                <template v-if="record.verified" #icon>
                  <CheckOutlined style="color: #52c41a" />
                </template>
                <template v-else #icon>
                  <CloseOutlined
                    style="color: #ff4d4f"
                    :title="t('SearchEntity.KeepUploadDialog.removeFromKeepUpload')"
                    @click.stop="removeVerifiedItem(record.id)"
                  />
                </template>
              </a-button>
            </a-tooltip>
          </template>
        </template>
      </a-table>
    </div>

    <template #footer>
      <div class="d-flex align-center ga-2 create-row">
        <!-- 这一排故意不写 size="small"：旁边那颗「创建任务」是默认档 32px，三颗输入框 24px
             挨着它就是一行两样高（他 2026-10-10：「这三个控件高度不够啊，不应该用 small」）。
             AGENTS §3.4 那条「弹层里照旧 small」的例外盖的是 popover 面板 / 筛选面板那种
             自成一行紧凑控件的地方，不盖「和默认档主操作并排」的这一排。 -->
        <template v-if="showCreateRow">
          <a-select
            v-model:value="selectedDownloaderId"
            :options="downloaderOptions"
            :placeholder="t('SearchEntity.KeepUploadDialog.setSavePath')"
            style="flex: 0 1 200px; min-width: 160px"
            :popup-match-select-width="false"
            @change="resetDownloadOptions"
          />
          <a-auto-complete
            v-model:value="savePath"
            :options="savePathOptions"
            :placeholder="t('KeepUploadTask.savePath')"
            style="flex: 1 1 300px; min-width: 220px"
            :popup-match-select-width="false"
          />
          <!-- 候选只列下载器**已经有**的分类，想用一个新的原先得离开这个界面去建、再回来重开
               （用户 2026-10-13 要求在这里加一颗）。只在认 `category:` 前缀的那台下载器上出现。 -->
          <a-tooltip v-if="canCreateCategory" :title="t('SearchEntity.KeepUploadDialog.addCategoryHint')">
            <a-button :loading="categorySaving" @click="openCategoryDialog">
              <template #icon><FolderAddOutlined /></template>
              {{ t("SearchEntity.KeepUploadDialog.addCategory") }}
            </a-button>
          </a-tooltip>
          <a-auto-complete
            v-model:value="torrentLabel"
            :options="labelOptions"
            :placeholder="t('SentToDownloaderDialog.label')"
            style="flex: 0 1 200px; min-width: 160px"
            :popup-match-select-width="false"
          />
          <a-tooltip :title="t('SearchEntity.KeepUploadDialog.autoReseedHint')">
            <span class="auto-reseed">
              <a-switch v-model:checked="autoReseed" size="small" />
              <span class="auto-reseed-label">{{ t("SearchEntity.KeepUploadDialog.autoReseed") }}</span>
            </span>
          </a-tooltip>
          <a-button
            type="primary"
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
/* 底部这一排原先三颗都写死 `max-width: 200px`、没有下限：台架在 1024 弹窗里量到保存路径
   实际只有 106px 宽，四条候选全被截（`category:华语电影-2024年合集` 要 191px、
   带 `$torrent.siteName$/$torrent.title$` 宏的那条要 321px），而下拉面板默认跟输入框同宽，
   于是面板里也一样看不全。改成「有下限 + 可生长 + 放不下就整排换行」，
   面板另走 popup-match-select-width=false 按内容定宽。
   换行而不是压缩：这一排里三颗都是要读得清具体名称的候选，压谁都是把问题留下。
   ⚠️ 那三颗的尺寸写在**行内 style**，不是忘了收成 class：antdv 的 Select / AutoComplete
   根元素拿不到本组件的 `data-v-*`（台架实测 class 落上去了、scope 属性是空的），
   scoped 规则选不中它们。 */
.create-row {
  flex-wrap: wrap;
}

/* 「自动辅种」那颗开关和它的标签包成一个元素再走 flex：a-switch 的轨道 16px 高、汉字 13px，
   并排写在流里是两个不同的对齐基准（一个按行盒、一个按基线），看着就是没居中。
   整块自己是一个 flex item，纵向居中由 .create-row 的 align-center 管。 */
.auto-reseed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

/* 站点那一栏：图标不参与收缩，站名吃掉剩下的宽度并截断（列宽是钉死的，
   让长站名出省略号比把它整栏撑宽、把标题列挤没更可读）。 */
.site-cell {
  min-width: 0;
}

/* 那两条路径可能很长（NAS 上七八十字符很常见），不给 break 会把整个弹窗撑出横向滚动条。 */
.path-mismatch-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}

/* 推荐那一排：标签 + 两颗按钮。整排可换行 —— 按钮里带站名，窄窗口下压谁都是把话说一半。
   这颗 a-button 用 small 档：这一排里没有默认档控件并排（「创建任务」那颗在 footer，
   隔着一整张表），AGENTS §3.4 那条「同一行里不许谁单独降档」在这里不成立。 */
.recommend-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* 汇总那一行：一句主数字 + 若干灰色分档。用文字而不是标签/按钮 —— 两颗 a-tag 并排会让人去点它，
   而这里没有任何可点的动作。行间距 12px：这些句子是一回事，读的时候要连着扫成一行。
   `align-items: baseline` 让主数字（默认 13px）和小字档同一条基线，不然混字号会看着一高一低。 */
.verify-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
}

.verify-summary-main {
  font-weight: 500;
}

.recommend-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}

/* 一颗按钮里三段文字（判据 / 站名 / 做种数）：Button 的 gap 只在「图标 + 文字」那档生效，
   三个裸 span 之间不会有缝，所以自己包一层 flex 给间距。 */
.recommend-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.recommend-kind {
  white-space: nowrap;
}

.recommend-site {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommend-count {
  color: rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}

/* 角色列第二行的推荐短标签：跟上面的「基准 / 其他」之间留 2px，不零间距贴边 */
.role-recommend {
  display: flex;
  justify-content: center;
  margin-top: 2px;
}

/* 标题那一格：黑字、悬停变绿（沿用改成表格之前的观感，只把截断从 a-typography 换成 CSS） */
.list-link {
  color: #000;
  text-decoration: none;
}

.list-link:hover {
  color: #008c00;
}

/* 悬停浮层里的全文：换行铺开 + 宽度上限，同 TorrentTitleTd.vue 那一条 */
.reveal-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
