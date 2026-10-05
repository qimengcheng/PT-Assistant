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

// ⚠️ antdv-next 的 AutoComplete 传字符串数组（string[]）options 会渲染成空控件
// （顶部下载器那个传 {value,label} 对象数组就是正常的），这里统一对象化
const suggestFolderOptions = computed(() => suggestFolders.value.map((v) => ({ value: v, label: v })));
const suggestTagOptions = computed(() => suggestTags.value.map((v) => ({ value: v, label: v })));

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

// antd 的 Select/AutoComplete 绑定的是标量，这里用 id 作为 v-model 的值，
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

function restoreAddTorrentOptions(downloader?: IDownloaderMetadata) {
  addTorrentOptions.value.localDownload = true;
  addTorrentOptions.value.addAtPaused = !(downloader?.feature?.DefaultAutoStart ?? true);
  addTorrentOptions.value.savePath = "";
  addTorrentOptions.value.label = "";
  addTorrentOptions.value.advanceAddTorrentOptions = downloader?.advanceAddTorrentOptions ?? {};
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

  return sendToDownloader();
}

function dialogEnter() {
  // 如果是默认下载发送，则直接设置为快速发送到客户端模式
  if (isDefaultSend) {
    const downloader = metadataStore.downloaders[metadataStore.defaultDownloader.id!];
    restoreAddTorrentOptions(downloader);
    quickSendToClient.value = true;

    // 加载默认下载器设置中的 folder, tags 信息
    selectedDownloader.value = downloader;
    addTorrentOptions.value.savePath = metadataStore.defaultDownloader.folder ?? "";
    addTorrentOptions.value.label = metadataStore.defaultDownloader.tags ?? "";

    // 直接调用发送函数
    sendToDownloader();
  } else {
    restoreAddTorrentOptions(); // 先重置所有选项，然后如果需要则从uiStore中获取历史情况
    quickSendToClient.value = configStore.download.useQuickSendToClient;

    // 如果不是快速发送到客户端模式，则尝试设置默认下载器
    if (!quickSendToClient.value) {
      const lastDownloaderId = metadataStore.lastDownloader?.id;
      selectedDownloader.value = lastDownloaderId // 如果有上次选择的下载器，则直接使用
        ? metadataStore.downloaders[lastDownloaderId]
        : sortedEnabledDownloadersBySite.value.length === 1 // 如果只有一个启用的下载器，则直接使用
          ? sortedEnabledDownloadersBySite.value[0]
          : null;

      // 将上一次的下载器选项通过 toMerged 合并到当前选项中，而不是直接覆盖
      addTorrentOptions.value = toMerged(
        addTorrentOptions.value,
        metadataStore.lastDownloader?.options ?? {},
      ) as Required<Omit<CAddTorrentOptions, "localDownloadOption">>;
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
        <a-row>
          <a-col :span="24">
            <!-- 下载器是固定列表，不需要自由输入：用 Select 而非 AutoComplete。
                 AutoComplete（combobox 模式）选中后输入框显示的是选项的 value，
                 也就是下载器那串随机 id，option-label-prop 在这种组件里不接管显示，
                 用户看到的就是「osuXXXX_...」这种编号。Select 单选时输入框固定显示 label。 -->
            <a-select
              v-model:value="selectedDownloaderId"
              :options="downloaderOptions"
              show-search
              option-filter-prop="label"
              :placeholder="t('SentToDownloaderDialog.selectDownloader')"
              allow-clear
              style="width: 100%"
              @change="onDownloaderChange"
            >
              <template #option="opt">
                <!-- 同上的 a-list-item-meta，antdv-next 无此组件，改普通 flex 容器 -->
                <div class="downloader-option">
                  <img class="downloader-avatar" :src="getDownloaderIcon(opt.raw.type)" :alt="opt.raw.type" />
                  <span class="downloader-option-label" :title="opt.label">{{ opt.label }}</span>
                  <a-tag color="blue">{{ opt.raw.type }}</a-tag>
                </div>
              </template>
            </a-select>
          </a-col>
        </a-row>

        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item :label="t('SentToDownloaderDialog.savePath')" :extra="t('SentToDownloaderDialog.savePathHint')">
              <a-auto-complete
                v-model:value="addTorrentOptions.savePath"
                :options="suggestFolderOptions"
                :placeholder="t('SentToDownloaderDialog.savePathHint')"
                allow-clear
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('SentToDownloaderDialog.label')" :extra="t('SentToDownloaderDialog.labelHint')">
              <a-auto-complete
                v-model:value="addTorrentOptions.label"
                :options="suggestTagOptions"
                :placeholder="t('SentToDownloaderDialog.labelHint')"
                allow-clear
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item :label="t('SentToDownloaderDialog.localRelay')" :colon="false">
              <a-switch
                v-model:checked="addTorrentOptions.localDownload"
                :disabled="!configStore.download.allowDirectSendToClient"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('SentToDownloaderDialog.pauseOnAdd')" :colon="false">
              <a-switch v-model:checked="addTorrentOptions.addAtPaused" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row>
          <a-col :span="24" style="padding: 0">
            <!-- Collapse 没有 `disabled` prop，写上去会变成根 div 上的裸 HTML 属性、毫无作用；
                 开关折叠用 `collapsible: 'disabled'`。见 scripts/check-dead-props.mjs -->
            <a-collapse
              ghost
              :collapsible="!((selectedDownloaderMetadata?.advanceAddTorrentOptions ?? []).length > 0) ? 'disabled' : undefined"
            >
              <a-collapse-panel key="1" :header="t('common.advancedSettings')">
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
          </a-col>
        </a-row>
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
.downloader-option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.downloader-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.downloader-option-label {
  flex: 1;
  min-width: 0;
}
</style>
