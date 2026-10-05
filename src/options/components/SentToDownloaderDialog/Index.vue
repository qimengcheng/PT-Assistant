<script setup lang="ts">
import { ref, computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toMerged } from "es-toolkit";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EllipsisOutlined,
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

// ⚠️ antdv-next 的 AutoComplete 传字符串数组（string[]）options 会渲染成空控件，这里统一对象化
const suggestTagOptions = computed(() => suggestTags.value.map((v) => ({ value: v, label: v })));

/**
 * 保存路径用单选列表，两个哨兵值代表列表外的两种状态：
 * 不指定（交给下载器自己的默认目录）与手动输入。
 * 前缀 `::` 保证不会和真实路径撞车，也不含 `$...$` / `<...>` 模板，
 * 所以不会被 utils.ts 的动态替换分支误当成待展开的路径。
 */
const PATH_DEFAULT = "::default::";
const PATH_CUSTOM = "::custom::";
const savePathChoice = ref<string>(PATH_DEFAULT);
const customSavePath = ref("");

/** 高级设置面板默认展开：这里存的是 a-collapse 的 activeKey */
const advancedActiveKeys = ref<string[]>(["advanced"]);

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

const downloaderOptions = computed(() =>
  sortedEnabledDownloadersBySite.value.map((d) => ({ value: d.id, label: downloaderTitle(d), raw: d })),
);

function onDownloaderChange() {
  restoreAddTorrentOptions(selectedDownloader.value ?? undefined);
}

/** 依据已定下的 savePath 反推单选态：空 → 默认路径，命中推荐目录 → 该项，否则 → 手动输入 */
function syncSavePathChoice() {
  const path = addTorrentOptions.value.savePath;
  if (!path) {
    savePathChoice.value = PATH_DEFAULT;
    customSavePath.value = "";
  } else if (suggestFolders.value.includes(path)) {
    savePathChoice.value = path;
    customSavePath.value = "";
  } else {
    savePathChoice.value = PATH_CUSTOM;
    customSavePath.value = path;
  }
}

watch(savePathChoice, (choice) => {
  if (choice === PATH_DEFAULT) addTorrentOptions.value.savePath = "";
  else if (choice === PATH_CUSTOM) addTorrentOptions.value.savePath = customSavePath.value;
  else addTorrentOptions.value.savePath = choice;
});

// 手动输入模式下，输入框的内容就是最终路径
watch(customSavePath, (value) => {
  if (savePathChoice.value === PATH_CUSTOM) addTorrentOptions.value.savePath = value;
});

function restoreAddTorrentOptions(downloader?: IDownloaderMetadata) {
  addTorrentOptions.value.localDownload = true;
  addTorrentOptions.value.addAtPaused = !(downloader?.feature?.DefaultAutoStart ?? true);
  addTorrentOptions.value.savePath = "";
  addTorrentOptions.value.label = "";
  addTorrentOptions.value.advanceAddTorrentOptions = downloader?.advanceAddTorrentOptions ?? {};
  syncSavePathChoice();
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
  syncSavePathChoice();

  return sendToDownloader();
}

function dialogEnter() {
  // 每次打开都展开：初值只能保证第一次，用户上次手动折叠过会残留
  advancedActiveKeys.value = ["advanced"];

  // 如果是默认下载发送，则直接设置为快速发送到客户端模式
  if (isDefaultSend) {
    const downloader = metadataStore.downloaders[metadataStore.defaultDownloader.id!];
    restoreAddTorrentOptions(downloader);
    quickSendToClient.value = true;

    // 加载默认下载器设置中的 folder, tags 信息
    selectedDownloader.value = downloader;
    addTorrentOptions.value.savePath = metadataStore.defaultDownloader.folder ?? "";
    addTorrentOptions.value.label = metadataStore.defaultDownloader.tags ?? "";
    syncSavePathChoice();

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
      syncSavePathChoice();
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

    <a-alert v-if="isSending" type="info" show-icon>
      {{
        t("SentToDownloaderDialog.isSending", {
          name: selectedDownloader?.name,
          address: selectedDownloader?.address,
        })
      }}
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
                  <div class="quick-send-item-title" :title="downloaderTitle(downloader)">
                    {{ downloaderTitle(downloader) }}
                  </div>
                  <div v-if="path" class="quick-send-item-subtitle" :title="path">{{ path }}</div>
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
                      <a-menu-item
                        v-for="tag in downloader.suggestTags"
                        :key="tag"
                        @click.stop="() => quickSendToDownloader(downloader, path, tag)"
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
          {{
            currentSiteIds.length > 0 && configStore.download.allowDownloaderFilterForSite
              ? t("SentToDownloaderDialog.noDownloaderForSite")
              : t("SentToDownloaderDialog.noDownloader")
          }}
        </a-alert>
      </div>

      <!-- 普通下载选项 -->
      <div v-else style="padding-bottom: 0">
        <a-alert v-if="downloaderOptions.length === 0" type="warning" show-icon style="margin-bottom: 12px">
          {{
            currentSiteIds.length > 0 && configStore.download.allowDownloaderFilterForSite
              ? t("SentToDownloaderDialog.noDownloaderForSite")
              : t("SentToDownloaderDialog.noDownloader")
          }}
        </a-alert>

        <a-form-item v-if="downloaderOptions.length > 0" :label="t('SentToDownloaderDialog.selectDownloader')">
          <!-- 下载器是固定列表且数量少，用分段按钮直出全部候选（带图标与类型），
               不再套一层 Select 下拉：下拉要点开才能看见有哪些、当前选的是哪个。 -->
          <a-radio-group
            v-model:value="selectedDownloaderId"
            size="small"
            class="choice-group"
            @change="onDownloaderChange"
          >
            <a-radio-button v-for="opt in downloaderOptions" :key="opt.value" :value="opt.value">
              <span class="choice-with-icon">
                <img class="downloader-avatar" :src="getDownloaderIcon(opt.raw.type)" :alt="opt.raw.type" />
                <span class="choice-text" :title="opt.label">{{ opt.label }}</span>
                <a-tag color="blue">{{ opt.raw.type }}</a-tag>
              </span>
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="downloaderOptions.length > 0" :label="t('SentToDownloaderDialog.savePath')">
          <a-radio-group v-model:value="savePathChoice" size="small" class="choice-group">
            <a-radio-button :value="PATH_DEFAULT">{{ t("SentToDownloaderDialog.defaultPath") }}</a-radio-button>
            <a-radio-button v-for="folder in suggestFolders" :key="folder" :value="folder">
              <span class="choice-mono" :title="folder">{{ folder }}</span>
            </a-radio-button>
            <a-radio-button :value="PATH_CUSTOM">{{ t("SentToDownloaderDialog.customPath") }}</a-radio-button>
          </a-radio-group>
          <!-- 手输项单独占一行：嵌进按钮里会让那一段比别的宽出一截。
               占位符（$torrent.title$ / <...>）在发送时才展开，见 utils.ts。 -->
          <a-input
            v-if="savePathChoice === PATH_CUSTOM"
            v-model:value="customSavePath"
            size="small"
            :placeholder="t('SentToDownloaderDialog.customPathPlaceholder')"
            style="margin-top: 8px"
          />
        </a-form-item>

        <a-form-item
          v-if="downloaderOptions.length > 0"
          :label="t('SentToDownloaderDialog.label')"
          :extra="t('SentToDownloaderDialog.labelHint')"
        >
          <a-auto-complete
            v-model:value="addTorrentOptions.label"
            :options="suggestTagOptions"
            :placeholder="t('SentToDownloaderDialog.labelHint')"
            allow-clear
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
            <a-form-item
              v-for="opt in selectedDownloaderMetadata?.advanceAddTorrentOptions ?? []"
              :key="opt.key"
              :label="opt.name"
              :extra="opt.description"
              :colon="false"
            >
              <a-switch v-model:checked="addTorrentOptions.advanceAddTorrentOptions![opt.key]" />
            </a-form-item>
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
.choice-text,
.choice-mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 分段按钮组：antd 的 group 默认 inline-block，候选一多就一路撑破弹窗右边界，
// 改成 block + 100% 让它按行铺开
.choice-group {
  display: block;
  width: 100%;
}

.choice-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 420px;
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
</style>
