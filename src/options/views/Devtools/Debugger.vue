<script setup lang="ts">
import { computed, ref } from "vue";
import { App } from "antdv-next";
import { useI18n } from "vue-i18n";
import * as estoolkit from "es-toolkit";
import * as datefns from "date-fns";
import axios from "axios";
import Sizzle from "sizzle";
import {
  definitionList,
  getDefinedSiteMetadata,
  getFavicon,
  getSite as createSiteInstance,
  type TSiteID,
} from "@ptd/site";

import { getDownloader } from "@ptd/downloader";
import { getMediaServer } from "@ptd/mediaServer";
import { getBackupServer } from "@ptd/backupServer";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { sendMessage } from "@/messages.ts";
import { clearFaviconCaches } from "@/options/components/SiteFavicon/utils.ts";
import { clearArchive, clearSiteArchive } from "@/shared/userInfoArchive.ts";

import { setupReplaceUnsafeHeader } from "~/extends/axios/replaceUnsafeHeader.ts";
import { setupRetryWhenCloudflareBlock } from "~/extends/axios/retryWhenCloudflareBlock.ts";
import { extStore } from "@/storage.ts";

setupRetryWhenCloudflareBlock(setupReplaceUnsafeHeader(axios));

const { t } = useI18n();
const { modal, message } = App.useApp();

function enableLibrary() {
  (window as any).axios = axios;
  (window as any).Sizzle = Sizzle;
  (window as any)._ = estoolkit;
  (window as any).datefns = datefns;
  (window as any).sendMessage = sendMessage;
  console.log("开发库已启用");
}

const selectedSite = ref<TSiteID>("");
const useCustomerConfig = ref<boolean>(true);

const clearSiteTarget = ref<TSiteID>("all");
const siteSelectItems = computed(() => [
  { label: t("Debugger.siteAll"), value: "all" },
  ...definitionList.map((x) => ({ label: x, value: x })),
]);

// 站点 id 下拉（旧实现直接把字符串数组丢给 v-autocomplete，antd Select 需要 {label,value}）
const siteIdOptions = computed(() => definitionList.map((x) => ({ label: x, value: x })));

const piniaStoreContent = import.meta.glob<Record<string, Function>>("@/options/stores/*.ts");
const piniaStoreName: Array<{ label: string; value: string }> = Object.keys(piniaStoreContent).map((x) => ({
  label: x.replace(/^.+\//, "").replace(/\.ts$/, ""),
  value: x,
}));
const selectedPiniaStore = ref();

const metadataStore = useMetadataStore();

const simpleServer = ref<Record<string, { selected: string; piniaKey: keyof typeof metadataStore; getFn: Function }>>({
  Downloader: { selected: "", piniaKey: "downloaders", getFn: getDownloader },
  MediaServer: { selected: "", piniaKey: "mediaServers", getFn: getMediaServer },
  BackupServer: { selected: "", piniaKey: "backupServers", getFn: getBackupServer },
});

/** 把 metadataStore.getXxxs 的 getter 结果转成 antd Select 需要的 {label,value} */
function serverOptions(serverType: string) {
  const list = metadataStore[`get${serverType}s` as keyof typeof metadataStore] as unknown as
    | Array<{ id: string; name: string }>
    | undefined;
  return (list ?? []).map((x) => ({ label: x.name, value: x.id }));
}

async function getSiteMetadata() {
  return await getDefinedSiteMetadata(selectedSite.value);
}

async function getSiteConfig() {
  return await metadataStore.getSiteUserConfig(selectedSite.value, useCustomerConfig.value);
}

async function getSiteInstance() {
  let customerConfig = {};
  if (useCustomerConfig.value) {
    customerConfig = await getSiteConfig();
  }

  return await createSiteInstance(selectedSite.value, customerConfig);
}

async function getSiteFavicon() {
  const siteInstance = await getSiteInstance();
  return await getFavicon(siteInstance.metadata);
}

async function getPiniaStore(storeName: string) {
  const storeModule = await piniaStoreContent[storeName]();
  const storeFunction = Object.keys(storeModule).filter((f) => /use.+Store/.test(f));
  if (storeFunction.length > 0) {
    return storeModule[storeFunction[0]]();
  }
}

const log = async (v: any) => {
  console.log(await v);
};

interface resetItem {
  id?: string;
  title: string;
  subTitle?: string;
  resetFn: () => Promise<void>;
}

const resetItems = computed<resetItem[]>(() => [
  {
    title: t("Debugger.resetItems.resetSystemSettings"),
    subTitle: t("Debugger.resetItems.resetSystemSettingsDesc"),
    resetFn: async () => {
      const configStore = useConfigStore();
      configStore.$reset();
      await configStore.$save();
    },
  },
  {
    title: t("Debugger.resetItems.clearUserConfig"),
    subTitle: t("Debugger.resetItems.clearUserConfigDesc"),
    resetFn: async () => {
      const metadataStore = useMetadataStore();
      metadataStore.$reset();
      await metadataStore.$save();
    },
  },
  {
    id: "clearSiteData",
    title: t("Debugger.resetItems.clearSiteData"),
    subTitle: t("Debugger.resetItems.clearSiteDataDesc"),
    resetFn: async () => {
      const metadataStore = useMetadataStore();
      if (clearSiteTarget.value === "all") {
        // 清空所有站点数据
        metadataStore.lastUserInfo = {};
        await clearArchive();
      } else {
        // 清空指定站点数据
        if (metadataStore.lastUserInfo[clearSiteTarget.value]) delete metadataStore.lastUserInfo[clearSiteTarget.value];
        await clearSiteArchive(clearSiteTarget.value);
      }
      await metadataStore.$save();
    },
  },
  {
    title: t("Debugger.resetItems.clearDownloadHistory"),
    resetFn: async () => {
      await sendMessage("clearDownloadHistory", undefined);
    },
  },
  {
    title: t("Debugger.resetItems.clearFaviconCache"),
    // 必须走 store 侧的 clearFaviconCaches：它同时清 options 的内存缓存和 IndexedDB。
    // 原来只发 sendMessage("clearSiteFaviconCache") 清库，本页面内存里那份还在，
    // 清完图标照旧显示，得整页重载才见效。
    resetFn: async () => {
      await clearFaviconCaches();
    },
  },
  {
    title: t("Debugger.resetItems.clearMediaCache"),
    resetFn: async () => {
      await sendMessage("clearSocialInformationCache", undefined);
    },
  },
  {
    title: t("Debugger.resetItems.clearSearchSnapshot"),
    subTitle: t("Debugger.resetItems.clearSearchSnapshotDesc"),
    resetFn: async () => {
      const metadataStore = useMetadataStore();
      metadataStore.snapshots = {};
      await metadataStore.$save();
      await extStore.setItem("searchResultSnapshot", {});
    },
  },
]);

/**
 * 旧实现用原生 confirm/alert。MV3 扩展页里原生对话框不可靠（本项目 v0.4.2 已就 doRestore 踩过），
 * 统一换成 App.useApp() 的 modal.confirm + message。
 */
function resetFnWrapper(resetFn: resetItem["resetFn"]) {
  modal.confirm({
    title: t("Debugger.confirmReset"),
    content: t("Debugger.dangerWarning"),
    okType: "danger",
    onOk: async () => {
      await resetFn();
      message.success(t("Debugger.resetSuccess"));
    },
  });
}
</script>

<template>
  <!-- 原来 alert + card 是两个根节点，.content 的高度链没有可挂的根，
       所以白面高度只等于内容、下面一整片是灰底。包一层 .page-fill，
       再让那张卡吃满剩余高度（.page-fill > .ant-card.page-fill-grow 会把它变成 flex 列）。 -->
  <div class="page-fill">
    <a-alert
      class="debugger-warning"
      type="warning"
      show-icon
      :title="t('Debugger.title')"
      :description="t('Debugger.consoleOutput')"
    />

    <a-card size="small" class="page-fill-grow">
      <a-descriptions class="debugger-desc" :column="1" :colon="false">
        <a-descriptions-item :label="t('Debugger.enableLibrary')">
          <div class="debugger-row">
            <a-button @click="enableLibrary">{{ t("common.enable") }}</a-button>
            <span class="debugger-hint">{{ t("Debugger.libraryList") }}</span>
          </div>
        </a-descriptions-item>

        <a-descriptions-item :label="t('Debugger.debugBuiltinSite')">
          <div class="debugger-row">
            <a-select
              v-model:value="selectedSite"
              class="debugger-select"
              :options="siteIdOptions"
              :placeholder="'site'"
              show-search
              allow-clear
              option-filter-prop="label"
            />
            <a-checkbox v-model:checked="useCustomerConfig">{{ t("Debugger.mergeUserConfig") }}</a-checkbox>
            <a-button :disabled="!selectedSite" @click="log(getSiteMetadata())">
              {{ t("Debugger.outputSiteDefinition") }}
            </a-button>
            <a-button :disabled="!selectedSite" @click="log(getSiteConfig())">
              {{ t("Debugger.outputUserConfig") }}
            </a-button>
            <a-button :disabled="!selectedSite" @click="log(getSiteInstance())">
              {{ t("Debugger.outputSiteInstance") }}
            </a-button>
            <a-button :disabled="!selectedSite" @click="log(getSiteFavicon())">
              {{ t("Debugger.outputFavicon") }}
            </a-button>
          </div>
        </a-descriptions-item>

        <a-descriptions-item
          v-for="(server, serverType) in simpleServer"
          :key="serverType"
          :label="t('Debugger.debug', { serverType })"
        >
          <div class="debugger-row">
            <a-select
              v-model:value="simpleServer[serverType].selected"
              class="debugger-select"
              :options="serverOptions(serverType)"
              :placeholder="serverType"
              show-search
              allow-clear
              option-filter-prop="label"
            />
            <span class="debugger-hint">{{ t("Debugger.addServerFirst", { serverType }) }}</span>
            <a-button
              :disabled="!server.selected"
              @click="
                // @ts-ignore
                log(metadataStore[server.piniaKey][server.selected])
              "
            >
              {{ t("Debugger.outputConfig") }}
            </a-button>
            <a-button
              :disabled="!server.selected"
              @click="
                // @ts-ignore
                log(server.getFn(metadataStore[server.piniaKey][server.selected]))
              "
            >
              {{ t("Debugger.outputInstance", { serverType }) }}
            </a-button>
          </div>
        </a-descriptions-item>

        <a-descriptions-item :label="t('Debugger.debugPinia')">
          <div class="debugger-row">
            <a-select
              v-model:value="selectedPiniaStore"
              class="debugger-select"
              :options="piniaStoreName"
              placeholder="piniaStore"
              show-search
              allow-clear
              option-filter-prop="label"
            />
            <a-button :disabled="!selectedPiniaStore" @click="log(getPiniaStore(selectedPiniaStore))">
              {{ t("Debugger.outputPinia") }}
            </a-button>
          </div>
        </a-descriptions-item>

        <a-descriptions-item :label="t('Debugger.pluginReset')">
          <div class="debugger-reset-wrap">
            <a-alert type="error" show-icon :title="t('Debugger.dangerWarning')" />
            <div class="debugger-reset">
              <div v-for="item in resetItems" :key="item.title" class="debugger-reset-item">
                <a-button danger @click="() => resetFnWrapper(item.resetFn)">{{ t("common.dialog.reset") }}</a-button>
                <div class="debugger-reset-text">
                  <div class="debugger-reset-title">{{ item.title }}</div>
                  <div v-if="item.subTitle" class="debugger-reset-subtitle">{{ item.subTitle }}</div>
                </div>
                <a-select
                  v-if="item.id === 'clearSiteData'"
                  v-model:value="clearSiteTarget"
                  class="debugger-reset-select"
                  :options="siteSelectItems"
                  :placeholder="t('Debugger.selectSite')"
                  show-search
                  option-filter-prop="label"
                />
              </div>
            </div>
          </div>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<style scoped lang="scss">
.debugger-warning {
  margin-bottom: 10px;
}

// 原来手写 <table> 时标签列钉死 160px；a-descriptions 的 label 单元格默认按内容自适应，
// 长内容行会把标签列挤宽，这里把宽度钉回去。
.debugger-desc :deep(.ant-descriptions-item-label) {
  width: 160px;
  font-weight: 500;
}

.debugger-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.debugger-select {
  min-width: 220px;
}

.debugger-hint {
  color: rgba(0, 0, 0, 0.45);
  font-size: 0.8125rem;
}

/* 警告条与下面那排重置项必须**上下排、留 8px 缝**。
   不包这一层的话，a-descriptions（非 bordered）这一格里两个孩子是并排贴着的：
   2026-10-06 量过截图，警告条右边缘 x=394、第一颗「重置」按钮左边缘 x=397 —— 只差 3px。
   而且警告条被挤成 186px 宽的小胶囊（它本该占满内容列宽），看着像个标签。
   警告条自己不带外边距，间距全交给上面的 gap，所以这里不再单独给它加 margin-bottom。 */
.debugger-reset-wrap {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
}

.debugger-reset-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.debugger-reset-text {
  min-width: 0;
  flex: 1;
}

.debugger-reset-title {
  font-weight: 500;
}

.debugger-reset-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 0.8125rem;
}

.debugger-reset-select {
  min-width: 150px;
}
</style>
