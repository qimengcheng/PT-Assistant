<script setup lang="ts">
import { computed, shallowRef, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { pickBy } from "es-toolkit";
import { isEmpty } from "es-toolkit/compat";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  ImportOutlined,
  QuestionCircleOutlined,
  ToolOutlined,
} from "@antdv-next/icons";
import { EResultParseStatus, ISiteMetadata, ISiteUserConfig, TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useResetableRef } from "@/options/directives/useResetableRef.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import CheckSwitchButton from "@/options/components/CheckSwitchButton.vue";

import { getCanAddedSiteMetadata } from "./utils.ts";

const showDialog = defineModel<boolean>();

interface IImportStatus {
  isWorking: boolean;
  toWork: TSiteID[];
  working: TSiteID;
  success: TSiteID[];
  failed: TSiteID[];
}

const { ref: importStatus, reset: resetImportStatus } = useResetableRef<IImportStatus>(() => ({
  isWorking: false,
  toWork: [],
  working: "",
  success: [],
  failed: [],
}));

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

// 获取所有能添加的站点
const canAddSites = shallowRef<Record<TSiteID, ISiteMetadata>>({});

const realCanAutoAddSiteId = computed(() =>
  Object.values(canAddSites.value)
    .filter((x) => !x.userInputSettingMeta && x.type === "private")
    .map((x) => x.id),
);

/**
 * 旧版返回 mdi-xxx 字符串图标，antdv-next 要求组件对象；
 * 分支条件与旧版逐条对应（helper/close/wrench/check/alert/pencil）。
 */
const statusIconPropComputed = (site: TSiteID) =>
  computed(() => {
    let progressIcon: Component = QuestionCircleOutlined; // 默认 progress-helper
    let progressColor = "grey";
    let progressTitle = "";
    if (canAddSites.value[site]?.userInputSettingMeta) {
      progressIcon = CloseCircleOutlined; // 需要手动添加 (progress-close)
      progressColor = "purple";
      progressTitle = t("SetSite.oneClickImportDialog.status.manual");
    } else if (importStatus.value.working === site) {
      progressIcon = ToolOutlined; // 正在尝试中 (progress-wrench)
      progressColor = "blue";
      progressTitle = t("SetSite.oneClickImportDialog.status.trying");
    } else if (importStatus.value.success.includes(site)) {
      progressIcon = CheckCircleOutlined; // 已添加成功 (progress-check)
      progressColor = "green";
      progressTitle = t("SetSite.oneClickImportDialog.status.success");
    } else if (importStatus.value.failed.includes(site)) {
      progressIcon = ExclamationCircleOutlined; // 添加失败 (progress-alert)
      progressColor = "red";
      progressTitle = t("SetSite.oneClickImportDialog.status.failed");
    } else if (importStatus.value.toWork.includes(site)) {
      progressIcon = EditOutlined; // 已选择 (progress-pencil)
      progressColor = "";
      progressTitle = t("SetSite.oneClickImportDialog.status.selected");
    }

    return {
      icon: progressIcon,
      color: progressColor,
      title: progressTitle,
    };
  });

async function doAutoImport() {
  importStatus.value.isWorking = true;
  importStatus.value.failed = [];

  // 遍历所有需要添加的站点，在遍历过程中我们不更新 siteHostMap 和 siteNameMap
  for (const site of importStatus.value.toWork) {
    if (importStatus.value.success.includes(site)) {
      continue; // 如果已经添加成功，则跳过
    }

    importStatus.value.working = site;

    try {
      let isThisSiteSuccess = false;

      // 拿到 siteMetadata, siteUserConfig
      const siteMetadata = canAddSites.value[site] as ISiteMetadata;
      const siteUserConfig = (await metadataStore.getSiteUserConfig(site, true)) as ISiteUserConfig;

      // 对于 public 站点，不需要额外测试是否能够搜索
      if (siteMetadata.type === "public") {
        // 直接将该站点设置存入 metadataStore
        await metadataStore.addSite(site, siteUserConfig, { reBuildMap: false }); // 抑制 site{Name, Host}Map 更新
        isThisSiteSuccess = true;
      } else {
        // 遍历所有 private site 预设的 urls ，找到用户实际使用的 url
        for (const siteUrl of siteMetadata.urls) {
          siteUserConfig.url = siteUrl;
          // 临时将该设置存入 metadataStore
          await metadataStore.addSite(site, siteUserConfig, { reBuildMap: false });
          const { status: testStatus } = await sendMessage("getSiteSearchResult", { siteId: site });
          if (testStatus === EResultParseStatus.success) {
            isThisSiteSuccess = true; // 如果搜索成功，说明该站点可以自动添加
            break;
          }
        }
      }

      if (isThisSiteSuccess) {
        importStatus.value.success.push(site);
      } else {
        importStatus.value.failed.push(site);
        // 如果搜索失败，说明该站点不能自动添加，移除在 metadataStore 中临时添加的配置项
        await metadataStore.removeSite(site, { reBuildMap: false });
      }
    } catch (e) {
      importStatus.value.failed.push(site);
    }
  }

  importStatus.value.working = "";
  importStatus.value.isWorking = false;
  importStatus.value.toWork = [];

  // 所有导入完成，重构 site{Host, Name}Map
  await metadataStore.buildSiteMapCache(true);

  runtimeStore.showSnakebar(
    t("SetSite.oneClickImportDialog.importComplete", { count: importStatus.value.success.length }),
    { color: "success" },
  );
}

async function dialogEnter() {
  resetImportStatus(); // 重置状态
  const allCanAddedSite = await getCanAddedSiteMetadata(); // 加载待添加站点
  canAddSites.value = pickBy(allCanAddedSite, (site) => site.isDead !== true) as Record<string, ISiteMetadata>;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :width="1000"
    :closable="false"
    :mask="{ closable: !importStatus.isWorking }"
    :keyboard="!importStatus.isWorking"
    :body-style="{ maxHeight: '72vh', overflowY: 'auto' }"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >
    <template #title>
      <div class="dialog-title">
        <span>{{ t("SetSite.oneClickImportDialog.title") }}</span>
        <div class="dialog-title-spacer" />
        <a-button
          size="small"
          type="text"
          :title="t('common.dialog.close')"
          :disabled="importStatus.isWorking"
          @click="showDialog = false"
        >
          <template #icon>
            <CloseOutlined />
          </template>
        </a-button>
      </div>
    </template>

    <a-alert class="mb-2" type="warning" show-icon :message="t('SetSite.oneClickImportDialog.alert1')" />

    <a-alert class="mb-1" type="info" :message="t('SetSite.oneClickImportDialog.alert2')">
      <template #description>
        <span>
          {{
            t("SetSite.oneClickImportDialog.stats", {
              count: importStatus.toWork.length,
              success: importStatus.success.length,
              failed: importStatus.failed.length,
            })
          }}
        </span>
        <span v-if="importStatus.isWorking">
          {{ t("SetSite.oneClickImportDialog.trying", { name: canAddSites[importStatus.working].name }) }}
        </span>
      </template>
      <template #action>
        <a-space :size="4">
          <CheckSwitchButton v-model="importStatus.toWork" :all="realCanAutoAddSiteId" />
        </a-space>
      </template>
    </a-alert>

    <a-skeleton v-if="isEmpty(canAddSites)" active :paragraph="{ rows: 8 }" class="site-skeleton" />
    <a-checkbox-group v-else v-model:value="importStatus.toWork" class="site-grid">
      <a-row :gutter="8">
        <a-col v-for="site in canAddSites" :key="site.id" :span="24" :sm="12" :md="8" class="site-col">
          <div class="site-card">
            <a-checkbox
              :value="site.id"
              :indeterminate="!!site.userInputSettingMeta || importStatus.success.includes(site.id)"
              :disabled="
                !!site.userInputSettingMeta || importStatus.isWorking || importStatus.success.includes(site.id)
              "
            />
            <SiteFavicon :site-id="site.id" :size="28" class="mr-2" flush-on-click />
            <div class="site-card-main">
              <div class="text-ellipsis">
                <b>{{ site.name ?? "" }}</b>
                <!-- 站点类型 -->
              </div>
              <a-tag :color="site.type === 'private' ? 'blue' : 'default'">
                {{ site.schema ?? (site.type === "private" ? "AbstractPrivateSite" : "AbstractBittorrentSite") }}
              </a-tag>
            </div>
            <a :href="site.urls[0]" target="_blank" rel="noopener noreferrer nofollow">
              <a-tooltip :title="statusIconPropComputed(site.id).value.title">
                <component
                  :is="statusIconPropComputed(site.id).value.icon"
                  :style="{ color: statusIconPropComputed(site.id).value.color }"
                  class="status-icon"
                />
              </a-tooltip>
            </a>
          </div>
        </a-col>
      </a-row>
    </a-checkbox-group>

    <template #footer>
      <a-button size="small" type="text" danger :disabled="importStatus.isWorking" @click="showDialog = false">
        <template #icon>
          <CloseCircleOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
      </a-button>

      <a-button size="small" type="text" color="green" :disabled="importStatus.isWorking" @click="doAutoImport">
        <template #icon>
          <ImportOutlined />
        </template>
        <span class="ml-1">{{ t("common.import") }}</span>
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.dialog-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-title-spacer {
  flex: 1 1 0;
}

.site-skeleton {
  padding: 12px;
}

.site-grid {
  display: block;
  overflow-x: hidden;
  overflow-y: hidden;
  padding: 12px;
}

.site-col {
  padding-bottom: 8px;
}

.site-card {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background-color: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 6px;
}

.site-card-main {
  flex: 1 1 0;
  min-width: 0;
  margin-right: 8px;
}

.status-icon {
  font-size: 28px;
}
</style>
