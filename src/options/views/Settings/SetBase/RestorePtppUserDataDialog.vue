<script setup lang="ts">
/**
 * PT-Plugin-Plus 用户数据导入对话框（antdv-next 实现）。
 * 解析 PTPP dump 的用户信息，按内置站点定义映射 host → siteId，
 * 逐站点勾选后写入 userInfo storage（可选覆盖已有数据）。
 * 平移自 PT-depiler views/Settings/SetBase/RestorePtppUserDataDialog.vue。
 */
import { computed, ref, shallowRef } from "vue";
import { Modal, message } from "antdv-next";
import {
  definitionList,
  EResultParseStatus,
  getHostFromUrl,
  parseSizeString,
  parseValidTimeString,
  type IUserInfo,
  type TSiteHost,
  type TSiteID,
} from "@ptd/site";
import { omit } from "es-toolkit";
import { isEmpty } from "es-toolkit/compat";

import { sendMessage } from "@/messages.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import type { IPtppDumpUserInfo, IPtppUserInfo, TUserInfoStorageSchema } from "@/shared/types.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

const showDialog = defineModel<boolean>();
const { ptppUserData } = defineProps<{
  ptppUserData: IPtppDumpUserInfo;
}>();

const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const parsePtppSize = (v: any) => (typeof v == "string" ? parseSizeString(v) : v);

type TUserInfoTransferFull = { key: keyof IUserInfo; format?: (v: any) => any };

type TUserInfoTransfer =
  | false // 不导入
  | undefined // 按照原 key 导入
  | keyof IUserInfo // 按新的 key 导入
  | TUserInfoTransferFull; // 导入到新的 key 中，并使用 format 对原始数据进行转换

/** 将 PTPP 的用户信息字段转换为本扩展格式；未列出的字段按原 key 导入 */
const userInfoTransferMap = {
  trueDownloaded: { key: "trueDownloaded", format: parsePtppSize },
  totalTraffic: { key: "totalTraffic", format: parsePtppSize },
  seedingPoints: "seedingBonus",
  averageSeedtime: "averageSeedingTime",
  bonusPage: false,
  unsatisfiedsPage: false,
  unsatisfieds: { key: "hnrUnsatisfied", format: (v) => Number(v) },
  prewarn: "hnrPreWarning",
  lastUpdateTime: "updateAt",
  lastUpdateStatus: {
    key: "status",
    format: (v) => (v === "success" ? EResultParseStatus.success : EResultParseStatus.unknownError),
  },
  isLogged: false,
  isLoading: false,
  lastErrorMsg: false,
  joinTime: {
    key: "joinTime",
    format: (v: any) => {
      if (typeof v === "number") {
        if (v > 1e12) return v; // 13位时间戳
        if (v > 1e9) return v * 1000; // 10位时间戳转13位
      }
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
        return parseValidTimeString(v);
      }
      return v;
    },
  },
} as Record<keyof IPtppUserInfo, TUserInfoTransfer>;

const isImporting = ref<boolean>(false);
const toImportSite = ref<string[]>([]);

// 自行维护「host → siteId」映射（siteHostMap 只含已添加站点，这里要覆盖全部内置定义）
const allSupportedSiteHostMap = shallowRef<Record<TSiteHost, TSiteID>>({});

const allSupportedSiteHost = computed(() =>
  Object.keys(ptppUserData)
    .map((x) => ({ site: allSupportedSiteHostMap.value[x], host: x }))
    .filter((x) => !!x.site)
    .map((x) => x.host),
);

const overwriteExistUserInfo = ref<boolean>(false);

function statusInfo(host: string) {
  if (!allSupportedSiteHost.value.includes(host)) {
    return { color: "default", title: "该站点不在 340 个内置定义中，无法导入" };
  }
  if (toImportSite.value.includes(host)) {
    return { color: "blue", title: "已选择导入" };
  }
  return { color: "default", title: "" };
}

function transferUserInfo(userInfo: IPtppUserInfo) {
  const newUserInfo = {} as IUserInfo;
  for (const [key, value] of Object.entries(userInfo)) {
    if (userInfoTransferMap[key as keyof IPtppUserInfo]) {
      const transfer = userInfoTransferMap[key as keyof IPtppUserInfo];
      if (transfer === false) {
        continue;
      } else if (transfer === undefined) {
        newUserInfo[key] = value;
      } else if (typeof transfer === "string") {
        newUserInfo[transfer] = value;
      } else {
        const { key, format = undefined } = transfer as TUserInfoTransferFull;
        newUserInfo[key as keyof IPtppUserInfo] = format ? format(value) : value;
      }
    } else {
      newUserInfo[key] = value;
    }
  }
  return newUserInfo;
}

async function doImport() {
  if (isEmpty(metadataStore.sites)) {
    // ⚠️ MV3 扩展页面原生 confirm() 静默失效，改用 antdv Modal.confirm
    Modal.confirm({
      title: "尚未添加任何站点",
      content: "当前未添加任何站点，导入的用户数据将只写入存储（站点记录不会建立）。是否继续？",
      okText: "继续导入",
      cancelText: "取消",
      onOk: () => doImportInternal(),
    });
    return;
  }
  await doImportInternal();
}

async function doImportInternal() {
  isImporting.value = true;

  // 暂停后端刷新数据的任务
  const autoReflushStatus = configStore.userInfo.autoReflush.enabled;

  try {
    if (autoReflushStatus) {
      configStore.userInfo.autoReflush.enabled = false;
      await configStore.$save();
    }

    // 读出目前所有的 userInfo
    const userInfoStorage = ((await sendMessage("getExtStorage", "userInfo")) as TUserInfoStorageSchema) ?? {};

    // 开始转换数据
    for (const [host, data] of Object.entries(ptppUserData)) {
      if (toImportSite.value.includes(host)) {
        const siteId = allSupportedSiteHostMap.value[host];
        userInfoStorage[siteId] ??= {} as any;

        // 仅处理 lastUpdateStatus 为 success，且历史时间大于当前存储的时间（帮助导入 isDead 站点）
        const latestUserInfo = data.latest ?? {};
        if (
          overwriteExistUserInfo.value &&
          latestUserInfo?.lastUpdateStatus === "success" &&
          (latestUserInfo?.lastUpdateTime ?? -1) > (metadataStore.lastUserInfo[siteId]?.updateAt ?? 0)
        ) {
          metadataStore.lastUserInfo[siteId] = { ...transferUserInfo(latestUserInfo), site: siteId };
        }

        for (const [date, userData] of Object.entries(omit(data, ["latest"]))) {
          if (typeof userInfoStorage[siteId][date] == "undefined" || overwriteExistUserInfo.value) {
            userInfoStorage[siteId][date] = { ...transferUserInfo(userData as IPtppUserInfo), site: siteId };
          }
        }
      }
    }

    // 更新 userInfo
    await sendMessage("setExtStorage", { key: "userInfo", value: userInfoStorage });
    await metadataStore.$save();

    runtimeStore.showSnakebar("PT-Plugin-Plus 用户数据导入成功", { color: "success" });

    setTimeout(() => (showDialog.value = false), 5e3);
  } catch (e) {
    console.error("导入失败", e);
    runtimeStore.showSnakebar("PT-Plugin-Plus 用户数据导入失败", { color: "error" });
  } finally {
    // 恢复自动刷新的状态
    configStore.userInfo.autoReflush.enabled = autoReflushStatus;
    await configStore.$save();

    isImporting.value = false;
  }
}

async function entryDialog() {
  // 构造 allSupportedSiteHostMap（host → siteId）
  const siteHostMap: Record<TSiteHost, TSiteID> = {};
  for (const siteId of definitionList) {
    // 用户自定义的 url
    if (metadataStore.sites[siteId]?.url) {
      siteHostMap[getHostFromUrl(metadataStore.sites[siteId].url)] = siteId;
    }

    // 站点定义中的 urls
    const urls = await metadataStore.getSiteMergedMetadata(siteId, "urls", []);
    if (urls.length > 0) {
      for (const url of urls) {
        siteHostMap[getHostFromUrl(url)] = siteId;
      }
    }

    // 站点定义中的 legacyUrls
    const legacyUrls = (await metadataStore.getSiteMergedMetadata(siteId, "legacyUrls", []))!;
    if (legacyUrls.length > 0) {
      for (const url of legacyUrls) {
        siteHostMap[getHostFromUrl(url)] = siteId;
      }
    }
  }

  allSupportedSiteHostMap.value = siteHostMap;

  toImportSite.value = allSupportedSiteHost.value;
}

function toggleAll(checked: boolean) {
  toImportSite.value = checked ? [...allSupportedSiteHost.value] : [];
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    title="导入 PT-Plugin-Plus 用户数据"
    width="800px"
    :confirm-loading="isImporting"
    ok-text="导入"
    cancel-text="取消"
    @after-open="entryDialog"
    @ok="doImport"
  >
    <a-space class="mb-2" style="width: 100%; justify-content: space-between">
      <a-alert type="info" show-icon message="勾选要导入用户数据的站点" style="flex: 1" />
      <a-space>
        <a-button size="small" @click="toggleAll(true)">全选</a-button>
        <a-button size="small" @click="toggleAll(false)">全不选</a-button>
      </a-space>
    </a-space>

    <a-row :gutter="[8, 8]">
      <a-col v-for="(data, host) in ptppUserData" :key="host" :span="12">
        <div class="site-card" :class="{ unsupported: !allSupportedSiteHost.includes(host as string) }">
          <a-checkbox
            v-model:checked="toImportSite"
            :value="host"
            :disabled="!allSupportedSiteHost.includes(host as string)"
          />
          <span class="site-host">{{ host }}</span>
          <template v-if="allSupportedSiteHost.includes(host as string)">
            <span class="arrow">→</span>
            <SiteFavicon :site-id="allSupportedSiteHostMap[host as string]" />
            <SiteName :site-id="allSupportedSiteHostMap[host as string]" class="site-name" />
          </template>
          <a-tooltip :title="statusInfo(host as string).title">
            <a-tag :color="statusInfo(host as string).color" style="margin-left: auto">
              {{ Object.keys(data).length - 1 }} 条记录
            </a-tag>
          </a-tooltip>
        </div>
      </a-col>
    </a-row>

    <div class="overwrite-row">
      <a-switch v-model:checked="overwriteExistUserInfo" size="small" :disabled="isImporting" />
      <span class="label">覆盖本地已有的用户信息</span>
    </div>
  </a-modal>
</template>

<style scoped>
.mb-2 {
  margin-bottom: 8px;
}

.site-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  background: #fafafa;
  min-width: 0;
}

.site-card.unsupported {
  opacity: 0.55;
}

.site-host {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arrow {
  color: #999;
}

.site-name {
  font-weight: 600;
  white-space: nowrap;
}

.overwrite-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.overwrite-row .label {
  font-size: 13px;
}
</style>
