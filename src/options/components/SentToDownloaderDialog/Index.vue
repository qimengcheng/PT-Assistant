<script setup lang="ts">
import { reactive, ref, computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toMerged } from "es-toolkit";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  EditOutlined,
  EllipsisOutlined,
  LinkOutlined,
} from "@antdv-next/icons";

import { type ITorrent } from "@ptd/site";
import {
  type CAddTorrentOptions,
  getDownloaderIcon as getDownloaderIconRaw,
  getDownloaderMetaData,
} from "@ptd/downloader";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { usePromptInDialog } from "@/options/components/usePromptInDialog.ts";
import type { IDownloaderMetadata } from "@/shared/types.ts";

import {
  CATEGORY_FOLDER_PREFIX,
  categoryAssocKey,
  newCategoryFolder,
  resolveCategoryFolder,
  supportsCategoryFolders,
} from "./categoryMatch.ts";
import { sendTorrentToDownloader } from "./utils.ts";

const showDialog = defineModel<boolean>();
const { torrentItems, isDefaultSend } = defineProps<{
  torrentItems: ITorrent[];
  isDefaultSend?: boolean;
}>();
const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();
// 依赖 <a-app> 祖先：选项页在 entrypoints/options/App.vue 里包，content 在 content-script/app/App.vue 里包
const { promptInDialog } = usePromptInDialog();

const isSending = ref(false);
const quickSendToClient = ref<boolean>(false);
const selectedDownloader = ref<IDownloaderMetadata | null>(null);
const selectedDownloaderMetadata = shallowRef();
const addTorrentOptions = ref<Required<Omit<CAddTorrentOptions, "localDownloadOption">>>({
  localDownload: true,
  addAtPaused: false,
  savePath: "",
  label: "",
  uploadSpeedLimit: 0,
  advanceAddTorrentOptions: {},
});

const suggestFolders = computed(() => selectedDownloader.value?.suggestFolders ?? []);
const suggestTags = computed(() => selectedDownloader.value?.suggestTags ?? []);

/**
 * 分段按钮里的两个哨兵值，代表候选列表之外的两种状态：不指定（走下载器自己的默认值）、
 * 手动输入。前缀 `::` 保证不会和真实路径/标签撞车，也不含 `$...$` / `<...>` 模板，
 * 所以不会被 utils.ts 的动态替换分支误当成待展开的值。
 */
const CHOICE_DEFAULT = "::default::";
const CHOICE_CUSTOM = "::custom::";

/**
 * 「分段按钮 + 不指定 + 手动输入」在保存路径和种子标签上是同一份逻辑，
 * 只差绑哪个字段、候选从哪来，所以抽成工厂。
 * 返回值过一层 reactive：裸对象上的 ref 属性在模板里不会自动解包，v-model 绑不上去。
 */
function createChoiceField(getValue: () => string, setValue: (v: string) => void, candidates: () => string[]) {
  const choice = ref<string>(CHOICE_DEFAULT);
  const custom = ref("");

  /** 依据字段当前值反推该选中哪一项：空 → 不指定，命中候选 → 该项，否则 → 手动输入 */
  function sync() {
    const value = getValue();
    if (!value) {
      choice.value = CHOICE_DEFAULT;
      custom.value = "";
    } else if (candidates().includes(value)) {
      choice.value = value;
      custom.value = "";
    } else {
      choice.value = CHOICE_CUSTOM;
      custom.value = value;
    }
  }

  watch(choice, (next) => {
    if (next === CHOICE_DEFAULT) setValue("");
    else if (next === CHOICE_CUSTOM) setValue(custom.value);
    else setValue(next);
  });

  // 手动输入模式下，输入框的内容就是最终值
  watch(custom, (value) => {
    if (choice.value === CHOICE_CUSTOM) setValue(value);
  });

  return reactive({ choice, custom, sync });
}

const savePathField = createChoiceField(
  () => addTorrentOptions.value.savePath,
  (v) => (addTorrentOptions.value.savePath = v),
  () => suggestFolders.value,
);
const labelField = createChoiceField(
  () => addTorrentOptions.value.label,
  (v) => (addTorrentOptions.value.label = v),
  () => suggestTags.value,
);

interface IChoiceItem {
  value: string;
  label: string;
  /** 路径用等宽字体，标签不用 */
  mono?: boolean;
  /** 只有真实的推荐目录可删，两个哨兵项不是配置内容 */
  deletable?: boolean;
}
interface IChoiceGroup {
  /** 空串表示这一组不显示标题 */
  title: string;
  items: IChoiceItem[];
}

const toTagItem = (v: string): IChoiceItem => ({ value: v, label: v });

const pathGroups = computed<IChoiceGroup[]>(() => {
  const toPath = (v: string): IChoiceItem => ({ value: v, label: v, mono: true, deletable: true });
  const category = suggestFolders.value.filter((f) => f.startsWith(CATEGORY_FOLDER_PREFIX)).map(toPath);
  const other = suggestFolders.value.filter((f) => !f.startsWith(CATEGORY_FOLDER_PREFIX)).map(toPath);

  // 四类各占一行：默认路径和手动输入不混进候选堆里，它们不是"某个目录"
  const groups: IChoiceGroup[] = [
    { title: "", items: [{ value: CHOICE_DEFAULT, label: t("SentToDownloaderDialog.defaultPath") }] },
  ];
  if (category.length > 0) groups.push({ title: t("SentToDownloaderDialog.categoryGroup"), items: category });
  if (other.length > 0) {
    groups.push({ title: category.length > 0 ? t("SentToDownloaderDialog.otherGroup") : "", items: other });
  }
  groups.push({ title: "", items: [{ value: CHOICE_CUSTOM, label: t("SentToDownloaderDialog.manualInput") }] });
  return groups;
});

const labelItems = computed<IChoiceItem[]>(() => [
  { value: CHOICE_DEFAULT, label: t("SentToDownloaderDialog.noLabel") },
  ...suggestTags.value.map(toTagItem),
  { value: CHOICE_CUSTOM, label: t("SentToDownloaderDialog.manualInput") },
]);

/**
 * 打开弹窗 / 换下载器时，按种子自己的分类预选一条「分类目录」
 * （用户 2026-10-08：「点击发送到下载器时，自动按种子的分类匹配下载路径的分类目录」）。
 * 判据与「同档多解就不猜」那套规则在 categoryMatch.ts（那里能直接跑断言）。
 *
 * 2026-10-09 又加了一半：三档都没挑出来时不再静默走过，而是问用户「新建分类」还是
 * 「关联到已有分类」，并把他选的记到这台下载器的 `categoryAssoc` 里（记住的那条优先于三档）。
 */
const siteCategoryMaps = computed(() => {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, cfg] of Object.entries(metadataStore.sites ?? {})) {
    const map = cfg.categoryMap;
    if (map && Object.keys(map).length) out[id] = map;
  }
  return out;
});

interface ICategoryDecision {
  /** 种子的分类原样叫法 */
  raw: string;
  /** 已经定下来的目录（带前缀原样串），还没定下来是 null */
  folder: string | null;
  /** folder 来自用户记住的关联，不是三档判据 */
  fromMemory: boolean;
  /** 「忽略」按这一条记，含下载器 id */
  promptKey: string;
  /** 值得问用户「要不要新建分类」 */
  needPrompt: boolean;
}

/** 命中就把它填成保存路径；没命中不动当前值（沿用上次记住的那一档 / 下载器默认） */
function applyAutoCategoryPath(downloader?: IDownloaderMetadata) {
  const d = downloader ?? selectedDownloader.value;
  const res = resolveCategoryFolder(
    d?.suggestFolders ?? [],
    torrentItems,
    d?.categoryAssoc,
    (siteId) => siteCategoryMaps.value[siteId],
  );
  if (res.folder) addTorrentOptions.value.savePath = res.folder;

  const raw = res.category;
  categoryDecision.value = raw
    ? {
        raw,
        folder: res.folder,
        fromMemory: res.source === "assoc",
        // 带上下载器 id：「忽略」只对本台生效，换一台该重新问
        promptKey: `${d?.id ?? ""}::${raw}`,
        // 认分类前缀的只有 qBittorrent，别处的「新建分类」是个假动作（整串会被当路径）
        needPrompt: !res.folder && supportsCategoryFolders(d?.type),
      }
    : null;
}

/**
 * 这一趟分类判定的结论，界面上那两条提示都由它派生：
 * 命中了记住的关联 → 一条说明（附「不再记住」）；谁都没挑出来而这个下载器又认分类前缀
 * → 问用户「新建分类」还是「关联到已有分类」。
 */
const categoryDecision = ref<ICategoryDecision | null>(null);

/** 用户按过「忽略」的那一条（按 promptKey 记），本次打开之内不再重复问 */
const dismissedPromptKey = ref("");

/** 「记住这个关联」的勾选，默认记住 —— 用户原话就是「并记住这个关联」 */
const rememberCategoryAssoc = ref(true);

const showCategoryPrompt = computed(
  () => !!categoryDecision.value?.needPrompt && dismissedPromptKey.value !== categoryDecision.value.promptKey,
);

/** 「关联到已有分类」的候选：只有带前缀那几条是分类，按盘符列的具体路径不算 */
const categoryFolderCandidates = computed(() =>
  (selectedDownloader.value?.suggestFolders ?? [])
    .filter((f) => f.startsWith(CATEGORY_FOLDER_PREFIX))
    .filter((f) => f.slice(CATEGORY_FOLDER_PREFIX.length).trim() !== ""),
);

/** 用户挑定一条目录（新建的那条也算）：填进保存路径，勾了「记住」就写进这台下载器的关联表 */
async function chooseCategoryFolder(folder: string) {
  const decision = categoryDecision.value;
  if (!decision) return;
  addTorrentOptions.value.savePath = folder;
  const remember = rememberCategoryAssoc.value;
  if (remember) await writeCategoryAssoc(decision.raw, folder);
  dismissedPromptKey.value = "";
  // 记住过就改挂那条「按你记住的关联」的说明（它带着「不再记住」，是唯一的反悔入口）；
  // 没记住就整条收掉，这次的选择仍然是有效的，只是下次还要再问。
  categoryDecision.value = { ...decision, folder, fromMemory: remember, needPrompt: false };
  syncChoiceFields();
}

async function writeCategoryAssoc(raw: string, folder: string) {
  const current = selectedDownloader.value;
  if (!current) return;
  await metadataStore.addDownloader({
    ...current,
    categoryAssoc: { ...(current.categoryAssoc ?? {}), [categoryAssocKey(raw)]: folder },
  });
  // addDownloader 写进 store 的是新对象，本地引用得跟过去，否则读到的还是旧的那份
  selectedDownloader.value = metadataStore.downloaders[current.id] ?? null;
}

/** 忘掉这条关联，并立刻重新判一次：可能落到三档命中（安静填上），也可能变成要问用户 */
async function forgetCategoryAssoc() {
  const current = selectedDownloader.value;
  const decision = categoryDecision.value;
  if (!current || !decision) return;
  const next = { ...(current.categoryAssoc ?? {}) };
  delete next[categoryAssocKey(decision.raw)];
  await metadataStore.addDownloader({ ...current, categoryAssoc: next });
  selectedDownloader.value = metadataStore.downloaders[current.id] ?? null;
  applyAutoCategoryPath();
  syncChoiceFields();
}

function dismissCategoryPrompt() {
  if (categoryDecision.value) dismissedPromptKey.value = categoryDecision.value.promptKey;
}

/** 高级设置面板默认展开：这里存的是 a-collapse 的 activeKey */
const advancedActiveKeys = ref<string[]>(["advanced"]);

/** 编辑推荐目录：打开后每个候选变成带叉的可删块，选择功能整排停掉 */
const editingPaths = ref(false);

const currentSiteIds = computed(() => [...new Set(torrentItems.map((t) => t.site).filter(Boolean))]);
const enabledDownloadersBySite = computed(() => {
  const ids = currentSiteIds.value;
  if (ids.length === 0) return metadataStore.getEnabledDownloaders;
  const sets = ids.map((id) => new Set(metadataStore.getEnabledDownloadersBySite(id).map((d) => d.id)));
  const intersection = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
  return metadataStore.getEnabledDownloaders.filter((d) => intersection.has(d.id));
});
const sortedEnabledDownloadersBySite = computed(() =>
  [...enabledDownloadersBySite.value].sort((a, b) => (b.sortIndex ?? 0) - (a.sortIndex ?? 0)),
);

const downloaderTitle = (downloader: IDownloaderMetadata) => `${downloader.name} [${downloader.address}]`;
const getDownloaderIcon = (x: string) => chrome.runtime.getURL(getDownloaderIconRaw(x));

// 单选列表绑的是标量，这里用 id 作为 v-model 的值，
// 再映射回 metadataStore.downloaders 里的完整对象，保持下游逻辑不变。
const selectedDownloaderId = computed<string | undefined>({
  get: () => selectedDownloader.value?.id,
  set: (id) => {
    selectedDownloader.value = id ? (metadataStore.downloaders[id] ?? null) : null;
  },
});

const downloaderOptions = computed(() => sortedEnabledDownloadersBySite.value.map((d) => ({ value: d.id, raw: d })));

function onDownloaderChange() {
  restoreAddTorrentOptions(selectedDownloader.value ?? undefined);
  // 分类目录是每个下载器自己配的一批，换了就按新那批重新预选一次
  applyAutoCategoryPath();
  syncChoiceFields();
}

/** 字段值被程序改过（重置、合并上次的选择）之后，把两个分段按钮的选中态对齐回去 */
function syncChoiceFields() {
  savePathField.sync();
  labelField.sync();
}

/** 就地删掉某条推荐目录：改的是该下载器的配置，和去设置页里删一行等价 */
async function removeSuggestedPath(path: string) {
  const current = selectedDownloader.value;
  if (!current) return;
  const next = (current.suggestFolders ?? []).filter((f) => f !== path);
  await metadataStore.addDownloader({ ...current, suggestFolders: next });
  // addDownloader 写进 store 的是新对象，本地引用得跟过去，否则 suggestFolders 还读旧的
  selectedDownloader.value = metadataStore.downloaders[current.id] ?? null;
  // 删掉的如果正是当前选中那条，退到「手动输入」并留着已填的值，不要静默清空
  syncChoiceFields();
}

function restoreAddTorrentOptions(downloader?: IDownloaderMetadata) {
  addTorrentOptions.value.localDownload = true;
  addTorrentOptions.value.addAtPaused = !(downloader?.feature?.DefaultAutoStart ?? true);
  addTorrentOptions.value.savePath = "";
  addTorrentOptions.value.label = "";
  addTorrentOptions.value.advanceAddTorrentOptions = downloader?.advanceAddTorrentOptions ?? {};
  syncChoiceFields();
}

watch(selectedDownloader, (value) => {
  if (value?.type) {
    getDownloaderMetaData(value.type).then((v) => (selectedDownloaderMetadata.value = v));
  } else {
    selectedDownloaderMetadata.value = null;
  }
});

async function sendToDownloader() {
  if (!selectedDownloader.value?.id) {
    runtimeStore.showSnakebar(t("SentToDownloaderDialog.selectDownloaderFirst"), { color: "error" });
    return;
  }

  // 保存此次选择记录（默认推送不保存）
  if (!isDefaultSend && configStore.download.saveLastDownloader) {
    // noinspection ES6MissingAwait
    metadataStore.setLastDownloader({
      id: selectedDownloader.value.id,
      options: addTorrentOptions.value,
    });
  }

  isSending.value = true;

  sendTorrentToDownloader(torrentItems, selectedDownloader.value.id, addTorrentOptions.value, promptInDialog).finally(
    () => {
      isSending.value = false;
      showDialog.value = false;
      emit("done");
    },
  );
}

function quickSendToDownloader(downloader: IDownloaderMetadata, path: string = "", label?: string) {
  selectedDownloader.value = downloader;

  // 设置下载推送选项
  addTorrentOptions.value.localDownload = true;
  addTorrentOptions.value.addAtPaused = !(downloader.feature?.DefaultAutoStart ?? true);
  addTorrentOptions.value.advanceAddTorrentOptions = downloader.advanceAddTorrentOptions ?? {};

  if (path) {
    addTorrentOptions.value.savePath = path;
  }
  if (label) {
    addTorrentOptions.value.label = label;
  }
  syncChoiceFields();

  return sendToDownloader();
}

function dialogEnter() {
  // 每次打开都回到初始形态：初值只保第一次，用户手动折叠过 / 进过编辑态会残留
  advancedActiveKeys.value = ["advanced"];
  editingPaths.value = false;
  categoryDecision.value = null;
  dismissedPromptKey.value = "";

  // 如果是默认下载发送，则直接设置为快速发送到客户端模式
  if (isDefaultSend) {
    const downloader = metadataStore.downloaders[metadataStore.defaultDownloader.id!];
    restoreAddTorrentOptions(downloader);
    quickSendToClient.value = true;

    // 加载默认下载器设置中的 folder, tags 信息
    selectedDownloader.value = downloader;
    addTorrentOptions.value.savePath = metadataStore.defaultDownloader.folder ?? "";
    addTorrentOptions.value.label = metadataStore.defaultDownloader.tags ?? "";
    syncChoiceFields();

    // 直接调用发送函数
    sendToDownloader();
  } else {
    restoreAddTorrentOptions(); // 先重置所有选项，然后如果需要则从uiStore中获取历史情况
    quickSendToClient.value = configStore.download.useQuickSendToClient;

    // 如果不是快速发送到客户端模式，则尝试设置默认下载器
    if (!quickSendToClient.value) {
      // 上次的下载器必须在本次的候选里：单选列表只会渲染候选，选中一个不在列表里的 id
      // 会让界面看起来一个都没勾上，而「完成」按钮又是可点的。
      const candidates = sortedEnabledDownloadersBySite.value;
      const lastId = metadataStore.lastDownloader?.id;
      const remembered = lastId ? candidates.find((d) => d.id === lastId) : undefined;
      selectedDownloader.value = remembered ?? (candidates.length === 1 ? candidates[0] : null);

      // 将上一次的下载器选项通过 toMerged 合并到当前选项中，而不是直接覆盖
      addTorrentOptions.value = toMerged(
        addTorrentOptions.value,
        metadataStore.lastDownloader?.options ?? {},
      ) as Required<Omit<CAddTorrentOptions, "localDownloadOption">>;
      // 排在合并之后：这一档要盖过「记住上次选项」里那条路径 —— 上次的种子和这次不一定是同一类内容
      applyAutoCategoryPath();
      syncChoiceFields();
    }
  }
}

function dialogLeave() {
  restoreAddTorrentOptions(); // 先重置所有选项，然后从uiStore中获取历史情况
  emit("cancel");
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SentToDownloaderDialog.title', [torrentItems.length])"
    :width="800"
    :mask="{ closable: !isSending }"
    :closable="!isSending"
    :keyboard="!isSending"
    :after-open-change="(open: boolean) => open && dialogEnter()"
    :after-close="dialogLeave"
  >

    <!-- Alert 只读 title / message / description 这几个具名插槽，默认插槽的内容进不了界面
         （实测：挂一个 <a-alert>{{ x }}</a-alert> 量到 .ant-alert 里文字是空串）。
         下面三处原本就是这么写的，所以「正在发送」「没有可用下载器」一直是只剩图标的空条。 -->
    <a-alert v-if="isSending" type="info" show-icon>
      <template #message>
        {{
          t("SentToDownloaderDialog.isSending", {
            name: selectedDownloader?.name,
            address: selectedDownloader?.address,
          })
        }}
      </template>
    </a-alert>

    <a-form v-else layout="vertical">
      <!-- 快速下载选项 -->
      <div v-if="quickSendToClient" style="padding: 0">
        <!--
          这里原来写的是 <a-list>/<a-list-item>/<a-list-item-meta>：antdv-next 1.5.6 根本没有这些
          组件（根入口导出的是虚拟滚动的 `Listy`，全量 install 注册名里也只有 AListy），
          未注册的标签会被 Vue 当原生未知元素渲染，而命名插槽（#avatar/#extra/#title）的内容
          在原生元素上根本挂不上去 —— 结果这一栏是一片可以点击的空白。
          与 MyClient/ClientStatusDialog.vue、TorrentDetailDialog.vue 同样的处理：改普通 div + scoped 样式。
        -->
        <div v-if="sortedEnabledDownloadersBySite.length > 0" class="quick-send-list">
          <template v-for="downloader in sortedEnabledDownloadersBySite" :key="downloader.id">
            <div
              v-for="path in ['', ...(downloader.suggestFolders ?? [])]"
              :key="`${downloader.id}::${path}`"
              class="quick-send-item"
              style="cursor: pointer"
              @click="() => quickSendToDownloader(downloader, path)"
            >
              <div class="quick-send-item-main">
                <img class="downloader-avatar" :src="getDownloaderIcon(downloader.type)" :alt="downloader.type" />
                <div class="quick-send-item-body">
                  <!-- 名字与保存路径都是「截断 + 悬停看全文」，全文揭示统一走 a-popover
                       （原生 title 的样式页面控制不了）。delay 与 TorrentTitleTd 同档 0.4s，
                       理由见那边注释。这两处 div 必须是 .quick-send-item-body 的直接子节点：
                       a-popover 不生成包装元素，触发事件直接 clone 到子节点上。 -->
                  <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                    <template #content>
                      <div class="reveal-text">{{ downloaderTitle(downloader) }}</div>
                    </template>
                    <div class="quick-send-item-title">{{ downloaderTitle(downloader) }}</div>
                  </a-popover>
                  <a-popover v-if="path" trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                    <template #content>
                      <div class="reveal-text">{{ path }}</div>
                    </template>
                    <div class="quick-send-item-subtitle">{{ path }}</div>
                  </a-popover>
                </div>
              </div>

              <div v-if="(downloader.suggestTags ?? []).length > 0" class="quick-send-item-extra" @click.stop>
                <a-dropdown trigger="click">
                  <a-tooltip :title="t('SentToDownloaderDialog.moreOptions')">
                    <a-button type="text" size="small">
                      <template #icon><EllipsisOutlined /></template>
                    </a-button>
                  </a-tooltip>
                  <template #popupRender>
                    <a-menu>
                      <!-- ⚠️ 这里不能写 @click.stop：@v-c/menu 回调 props.onClick 时传的是
                           info 对象（{key, keyPath, item, domEvent}）而不是原生事件，
                           .stop 会对它调 stopPropagation() → TypeError → handler 根本不执行，
                           而且异常在它自己的 onItemClick 之前抛出，连下拉都不会关。
                           浮层挂在 shadowRoot 的 contentOverlay 里、不在本行的 DOM 子树内，
                           本来也不需要挡冒泡。 -->
                      <a-menu-item
                        v-for="tag in downloader.suggestTags"
                        :key="tag"
                        @click="() => quickSendToDownloader(downloader, path, tag)"
                      >
                        {{ tag }}
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </div>
            </div>
          </template>
        </div>
        <a-alert v-else type="warning" show-icon>
          <template #message>
            {{
              currentSiteIds.length > 0 && configStore.download.allowDownloaderFilterForSite
                ? t("SentToDownloaderDialog.noDownloaderForSite")
                : t("SentToDownloaderDialog.noDownloader")
            }}
          </template>
        </a-alert>
      </div>

      <!-- 普通下载选项 -->
      <div v-else style="padding-bottom: 0">
        <a-alert v-if="downloaderOptions.length === 0" type="warning" show-icon style="margin-bottom: 12px">
          <template #message>
            {{
              currentSiteIds.length > 0 && configStore.download.allowDownloaderFilterForSite
                ? t("SentToDownloaderDialog.noDownloaderForSite")
                : t("SentToDownloaderDialog.noDownloader")
            }}
          </template>
        </a-alert>

        <a-form-item v-if="downloaderOptions.length > 0" :label="t('SentToDownloaderDialog.selectDownloader')">
          <!-- 下载器是固定列表且数量少，用分段按钮直出全部候选，
               不再套一层 Select 下拉：下拉要点开才能看见有哪些、当前选的是哪个。
               地址整串写进按钮会把那一段撑得极宽，收进名字后面那个图标的悬浮提示里。 -->
          <a-radio-group
            v-model:value="selectedDownloaderId"
            size="small"
            button-style="solid"
            class="choice-group"
            @change="onDownloaderChange"
          >
            <a-radio-button v-for="opt in downloaderOptions" :key="opt.value" :value="opt.value">
              <span class="choice-with-icon">
                <img class="downloader-avatar" :src="getDownloaderIcon(opt.raw.type)" :alt="opt.raw.type" />
                <span>{{ opt.raw.name }}</span>
                <a-tooltip :title="opt.raw.address">
                  <LinkOutlined class="choice-address-icon" />
                </a-tooltip>
                <a-tag color="blue">{{ opt.raw.type }}</a-tag>
              </span>
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="downloaderOptions.length > 0">
          <template #label>
            <span class="field-label">
              {{ t("SentToDownloaderDialog.savePath") }}
              <a-tooltip
                :title="editingPaths ? t('SentToDownloaderDialog.finishEdit') : t('SentToDownloaderDialog.editPaths')"
              >
                <a-button type="text" size="small" @click="editingPaths = !editingPaths">
                  <template #icon>
                    <CheckOutlined v-if="editingPaths" />
                    <EditOutlined v-else />
                  </template>
                </a-button>
              </a-tooltip>
            </span>
          </template>

          <div v-for="(grp, gi) in pathGroups" :key="gi" class="choice-block">
            <div v-if="grp.title" class="choice-group-title">{{ grp.title }}</div>
            <!-- 编辑态：候选变成带叉的块，整排停掉选择，此时点块体不改变当前选择。
                 默认路径 / 手动输入不是配置内容，所以不给叉、并压暗。 -->
            <div v-if="editingPaths" class="choice-group edit-chip-row">
              <span
                v-for="item in grp.items"
                :key="item.value"
                class="edit-chip"
                :class="{ 'edit-chip-locked': !item.deletable }"
              >
                <span class="choice-mono">{{ item.label }}</span>
                <a-tooltip v-if="item.deletable" :title="t('SentToDownloaderDialog.removePath')">
                  <CloseOutlined class="edit-chip-close" @click.stop="removeSuggestedPath(item.value)" />
                </a-tooltip>
              </span>
            </div>
            <!-- 每组是一个独立的 a-radio-group，但绑同一个值：选中项落在哪一组，
                 另一组就整体不亮，跨组互斥由受控模式本身保证，不依赖原生 radio 的 name。 -->
            <a-radio-group
              v-else
              v-model:value="savePathField.choice"
              size="small"
              button-style="solid"
              class="choice-group"
            >
              <a-radio-button v-for="item in grp.items" :key="item.value" :value="item.value">
                <!-- 路径是 .choice-mono 那三条 ellipsis 之一，全文同样换 a-popover -->
                <a-popover v-if="item.mono" trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                  <template #content>
                    <div class="reveal-text">{{ item.label }}</div>
                  </template>
                  <span class="choice-mono">{{ item.label }}</span>
                </a-popover>
                <template v-else>{{ item.label }}</template>
              </a-radio-button>
            </a-radio-group>
          </div>
          <!-- 手输项单独占一行：嵌进按钮里会让那一段比别的宽出一截。
               占位符（$torrent.title$ / <...>）在发送时才展开，见 utils.ts。 -->
          <a-input
            v-if="!editingPaths && savePathField.choice === CHOICE_CUSTOM"
            v-model:value="savePathField.custom"
            size="small"
            class="choice-input"
            :placeholder="t('SentToDownloaderDialog.customPathPlaceholder')"
          />

          <!-- 三档判据和「记住的关联」都没挑出来，而这个下载器认 `category:` 前缀：不再静默走过，
               问用户「新建分类」还是「关联到已有分类」。新建那条不需要额外调 API —— 保存路径填成
               `category:叫法`，发送时 qBittorrent 适配层会转成 autoTMM + category，分类不存在就由
               客户端在添加种子时建出来。 -->
          <a-alert
            v-if="showCategoryPrompt"
            type="warning"
            show-icon
            closable
            class="category-notice"
            @close="dismissCategoryPrompt"
          >
            <template #message>
              {{ t("SentToDownloaderDialog.categoryNoMatch", { category: categoryDecision?.raw ?? "" }) }}
            </template>
            <template #description>
              <div class="category-actions">
                <a-button
                  type="primary"
                  size="small"
                  @click="chooseCategoryFolder(newCategoryFolder(categoryDecision?.raw ?? ''))"
                >
                  {{ t("SentToDownloaderDialog.categoryCreate", { category: categoryDecision?.raw ?? "" }) }}
                </a-button>
                <a-dropdown v-if="categoryFolderCandidates.length > 0" trigger="click">
                  <a-button size="small">{{ t("SentToDownloaderDialog.categoryLink") }}</a-button>
                  <template #popupRender>
                    <a-menu>
                      <!-- ⚠️ 这里不能写 @click.stop：a-menu-item 的 onClick 回调传的是 info 对象
                           而不是原生事件（见上面「更多选项」那处注释）。 -->
                      <a-menu-item
                        v-for="folder in categoryFolderCandidates"
                        :key="folder"
                        @click="chooseCategoryFolder(folder)"
                      >
                        <span class="choice-mono">{{ folder }}</span>
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
                <div class="switch-item">
                  <a-switch v-model:checked="rememberCategoryAssoc" size="small" />
                  <span class="switch-label">{{ t("SentToDownloaderDialog.categoryRemember") }}</span>
                </div>
              </div>
            </template>
          </a-alert>

          <!-- 已经按记住的关联填上了：这条说明同时是唯一的反悔入口 —— 记错了又没人能在别处删掉它，
               不给「不再记住」就等于一次点击永久生效。 -->
          <a-alert v-else-if="categoryDecision?.fromMemory" type="info" show-icon class="category-notice">
            <template #message>
              <div class="category-remembered">
                <span>
                  {{
                    t("SentToDownloaderDialog.categoryRemembered", {
                      category: categoryDecision?.raw ?? "",
                      folder: categoryDecision?.folder ?? "",
                    })
                  }}
                </span>
                <a-button type="link" size="small" @click="forgetCategoryAssoc">
                  {{ t("SentToDownloaderDialog.categoryForget") }}
                </a-button>
              </div>
            </template>
          </a-alert>
        </a-form-item>

        <a-form-item v-if="downloaderOptions.length > 0" :label="t('SentToDownloaderDialog.label')">
          <a-radio-group v-model:value="labelField.choice" size="small" button-style="solid" class="choice-group">
            <a-radio-button v-for="item in labelItems" :key="item.value" :value="item.value">
              {{ item.label }}
            </a-radio-button>
          </a-radio-group>
          <a-input
            v-if="labelField.choice === CHOICE_CUSTOM"
            v-model:value="labelField.custom"
            size="small"
            class="choice-input"
            :placeholder="t('SentToDownloaderDialog.labelHint')"
          />
        </a-form-item>

        <div v-if="downloaderOptions.length > 0" class="switch-bar">
          <div class="switch-item">
            <a-switch
              v-model:checked="addTorrentOptions.localDownload"
              size="small"
              :disabled="!configStore.download.allowDirectSendToClient"
            />
            <span class="switch-label">{{ t("SentToDownloaderDialog.localRelay") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="addTorrentOptions.addAtPaused" size="small" />
            <span class="switch-label">{{ t("SentToDownloaderDialog.pauseOnAdd") }}</span>
          </div>
        </div>

        <a-collapse
          v-if="downloaderOptions.length > 0"
          v-model:active-key="advancedActiveKeys"
          ghost
          :collapsible="!((selectedDownloaderMetadata?.advanceAddTorrentOptions ?? []).length > 0) ? 'disabled' : undefined"
        >
          <!-- Collapse 没有 `disabled` prop，写上去会变成根 div 上的裸 HTML 属性、毫无作用；
               开关折叠用 `collapsible: 'disabled'`。见 scripts/check-dead-props.mjs -->
          <a-collapse-panel key="advanced" :header="t('common.advancedSettings')">
            <div class="advanced-grid">
              <a-form-item
                v-for="opt in selectedDownloaderMetadata?.advanceAddTorrentOptions ?? []"
                :key="opt.key"
                :label="opt.name"
                :extra="opt.description"
                :colon="false"
              >
                <a-switch v-model:checked="addTorrentOptions.advanceAddTorrentOptions![opt.key]" size="small" />
              </a-form-item>
            </div>
          </a-collapse-panel>
        </a-collapse>
      </div>
    </a-form>

    <template #footer>
      <div style="display: flex; align-items: center">
        <a-tooltip :title="t('SentToDownloaderDialog.moreOptions')">
          <a-button type="text" @click="quickSendToClient = !quickSendToClient">
            <template #icon><AppstoreOutlined /></template>
          </a-button>
        </a-tooltip>

        <div style="flex: 1"></div>

        <a-button :disabled="isSending" type="text" @click="showDialog = false">
          <template #icon><CloseCircleOutlined /></template>
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </a-button>
        <a-button
          :disabled="!selectedDownloader || quickSendToClient"
          :loading="isSending"
          danger
          type="text"
          @click="sendToDownloader"
        >
          <template #icon><CheckCircleOutlined /></template>
          <span class="ml-1">{{ t("common.dialog.ok") }}</span>
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.downloader-avatar {
  width: 24px;
  height: 24px;
  flex: none;
}

// 原本由 a-list / a-list-item 承担的版式，色值对齐 antd 的 token（文字 0.88 / 次要 0.45 / 分隔线 0.06）
.quick-send-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(5, 5, 5, 0.06);

  &:last-child {
    border-bottom: none;
  }
}

.quick-send-item-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.quick-send-item-body {
  min-width: 0;
}

.quick-send-item-title {
  color: rgba(0, 0, 0, 0.88);
}

.quick-send-item-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.quick-send-item-title,
.quick-send-item-subtitle,
.choice-mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* popover 里的全文：换成多行 + 宽度上限（与 TorrentTitleTd 同一份写法）。
   路径串常有无空格长段，overflow-wrap 用 anywhere 才断得开。 */
.reveal-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}

// 分段按钮组：antd 的 group 默认 inline-block，候选一多就一路撑破弹窗右边界，
// 改成 block + 100% 让它按行铺开
.choice-group {
  display: block;
  width: 100%;
}

.choice-block + .choice-block {
  margin-top: 10px;
}

.choice-group-title {
  margin-bottom: 4px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

// 手输框紧跟在「手动输入」那一行按钮之后，不留间距会和按钮贴在一起
.choice-input {
  margin-top: 8px;
}

.choice-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

// 只压透明度、不写死颜色：选中态是实心 primary 底 + 白字，
// 写死深灰会在蓝底上糊掉，而 opacity 两种状态下都跟着文字色走
.choice-address-icon {
  opacity: 0.55;
}

.choice-mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

// 两个开关并成一条，省掉 a-form-item 上下各一段的垂直留白
.switch-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 4px 0 12px;
}

.switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.88);
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

// 编辑态的候选块：叉探在右上角，所以行与行之间留 10px 让出位置，
// 否则上一行的叉会压住下一行的块
.edit-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 10px;
}

.edit-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border: 1px solid rgba(5, 5, 5, 0.12);
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
}

// 默认路径 / 手动输入不是可删的配置项
.edit-chip-locked {
  opacity: 0.45;
}

.edit-chip .choice-mono {
  max-width: 320px;
}

.edit-chip-close {
  position: absolute;
  top: -5px;
  right: -5px;
  padding: 2px;
  border-radius: 50%;
  background: #fff;
  color: rgba(0, 0, 0, 0.45);
  font-size: 10px;
  cursor: pointer;

  &:hover {
    color: #ff4d4f;
  }
}

// 高级设置里的下载器专有项排两列：一列时 label 短、开关靠右，整块高度白涨
.advanced-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
}

// 分类那两条提示挂在「保存路径」的候选底下，和上面的按钮行留 10px 缝（全站口径：不许零间距贴边）
.category-notice {
  margin-top: 10px;
}

// 「新建分类」/「关联到已有分类」/「记住这个关联」排一行，窄窗口下换行而不是把按钮压扁
.category-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 8px;
}

// 说明文字和「不再记住」那颗链接之间也要有缝
.category-remembered {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
