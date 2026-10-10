<script setup lang="ts">
import { computed, provide, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LeftOutlined,
  QuestionCircleOutlined,
  RightOutlined,
} from "@antdv-next/icons";
import { type ISiteMetadata, type ISiteUserConfig, type TSiteID } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { getCanAddedSiteMetadata } from "./utils.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import Editor from "./Editor.vue";

import { REPO_URL } from "~/helper.ts";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const currentStep = ref<0 | 1>(0);
const selectedSiteId = ref<TSiteID | null>(null);
const storedSiteUserConfig = ref<ISiteUserConfig>({});
const isFormValid = ref<boolean>(false);

provide("storedSiteUserConfig", storedSiteUserConfig);

function resetDialog() {
  currentStep.value = 0;
  selectedSiteId.value = null;
  storedSiteUserConfig.value = {};
}

const showDeadSite = ref<boolean>(false);
const allUnAddedSites = shallowRef<ISiteMetadata[]>([]);
const canAddSites = computed(() =>
  allUnAddedSites.value.filter((site) => (showDeadSite.value && site.isDead) || !site.isDead),
);

async function loadCanAddSites() {
  // Load the sites that can be added
  const sites = await getCanAddedSiteMetadata();
  allUnAddedSites.value = Object.values(sites);
}

async function saveSite() {
  await metadataStore.addSite(selectedSiteId.value!, storedSiteUserConfig.value!);
  showDialog.value = false;
}

// 下面两个纯渲染辅助函数只服务 a-select 的插槽，替代 Vuetify 的 item-title/item-value/filter-keys 配置
const siteOptions = computed(() =>
  canAddSites.value.map((site) => ({ value: site.id, label: site.name, site })),
);

function findCanAddSite(id: string | number): ISiteMetadata | undefined {
  return canAddSites.value.find((site) => site.id === id);
}

function filterSiteOption(input: string, option?: { site?: ISiteMetadata }): boolean {
  if (!input) return true;
  const site = option?.site;
  if (!site) return false;
  // 与旧版 filter-keys: ["raw.name", "raw.urls", "raw.aka"] 等价
  const haystack = [site.name, ...(site.aka ?? []), ...(site.urls ?? [])].join(" ").toLowerCase();
  return haystack.includes(input.toLowerCase());
}
</script>

<template>
  <!-- ⚠️ 原来这里写 :styles="{ body: { maxHeight: '…vh', overflowY: 'auto' } }"，
       把 style.css 那套布局算出来的 body 高度覆盖成了手写常数（AGENTS.md §3.4 点名的
       那一族）。body 的高度交给全局规则算即可。 -->
  <a-modal
    v-model:open="showDialog"
    :title="t('SetSite.add.title')"
    :width="800"
    :closable="false"
    :after-open-change="(open: boolean) => (open ? loadCanAddSites() : resetDialog())"
  >
    <!-- wiki 入口原先挂在 #title 插槽里（富标题会和右上角相撞），移到内容区顶部 -->
    <div class="d-flex justify-end">
      <a-tooltip :title="t('layout.header.wiki')">
        <a-button
          size="small"
          type="text"
          color="green"
          :href="`${REPO_URL}/wiki/config-site`"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          <template #icon>
            <QuestionCircleOutlined />
          </template>
        </a-button>
      </a-tooltip>
    </div>

    <!-- 选取可添加的站点 -->
    <div v-if="currentStep === 0">
      <a-select
        v-model:value="selectedSiteId"
        :autofocus="true"
        :show-search="true"
        :options="siteOptions"
        :filter-option="filterSiteOption"
        :popup-match-select-width="false"
        :placeholder="selectedSiteId ? '' : t('SetSite.add.selectSitePlaceholder')"
        class="site-select"
      >
        <template #labelRender="{ value }">
          <SiteFavicon :site-id="String(value)" :size="18" class="mr-2" flush-on-no-image />
          <span :class="{ 'line-through': findCanAddSite(value)?.isDead }">
            {{ findCanAddSite(value)?.name ?? "" }}
          </span>
        </template>
        <template #optionRender="{ option }">
          <div class="site-option">
            <SiteFavicon :site-id="option.data.site.id" :size="24" class="mr-2" />
            <div class="site-option-main">
              <div>
                <b :class="{ 'line-through': option.data.site.isDead }">{{ option.data.site.name ?? "" }}</b>
                <!-- 站点类型 -->
                <a-tag :color="option.data.site.type === 'private' ? 'blue' : 'default'" class="ml-2">
                  {{
                    option.data.site.schema ??
                    (option.data.site.type === "private" ? "AbstractPrivateSite" : "AbstractBittorrentSite")
                  }}
                </a-tag>
                <a-tag v-if="option.data.site.version" color="green" class="ml-2">
                  v{{ option.data.site.version }}
                </a-tag>
              </div>
              <!-- 站点描述可能很长：ellipsis.tooltip 一步拿到截断 + 悬停完整文案 -->
              <a-typography-text
                class="site-option-desc"
                :ellipsis="{ tooltip: option.data.site.description ?? '' }"
              >
                {{ option.data.site.description ?? "" }}
              </a-typography-text>
            </div>
            <div class="site-option-tags">{{ option.data.site.tags?.join(", ") ?? "" }}</div>
          </div>
        </template>
      </a-select>
      <div class="site-hint">
        {{ canAddSites.find((i: ISiteMetadata) => i.id === selectedSiteId)?.description ?? "" }}
      </div>
    </div>
    <!-- 具体配置站点 -->
    <div v-else>
      <Editor ref="editor" v-model="selectedSiteId!" @update:form-valid="(v: boolean) => (isFormValid = v)" />
    </div>

    <template #footer>
      <a-flex align="center" gap="small">
        <!-- component="label" 保住「点文字也能拨动开关」，布局交给 a-flex -->
        <a-flex v-if="currentStep === 0" component="label" align="center" gap="small" class="switch-row">
          <a-switch v-model:checked="showDeadSite" size="small" />
          <span>{{ t("SetSite.AddDialog.showDeadSite") }}</span>
        </a-flex>

        <!-- 步骤 2 时左侧开关整体消失，所以右侧按钮组自己吃掉剩余宽度再右对齐，
             不能靠外层 justify="space-between"（只剩一个子元素时会贴到左边跑位） -->
        <a-flex flex="auto" justify="flex-end" align="center" gap="small">
          <a-button size="small" type="text" danger @click="showDialog = false">
            <template #icon>
              <CloseCircleOutlined />
            </template>
            <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
          </a-button>
          <a-button v-if="currentStep === 1" size="small" type="text" color="blue" @click="currentStep = 0">
            <template #icon>
              <LeftOutlined />
            </template>
            <span class="ml-1">{{ t("common.dialog.prev") }}</span>
          </a-button>
          <a-button
            v-if="currentStep === 0"
            size="small"
            type="text"
            color="blue"
            :disabled="selectedSiteId == null"
            @click="currentStep = 1"
          >
            <span>{{ t("common.dialog.next") }}</span>
            <RightOutlined class="ml-1" />
          </a-button>
          <a-button v-if="currentStep === 1" size="small" type="primary" :disabled="!isFormValid" @click="saveSite">
            <template #icon>
              <CheckCircleOutlined />
            </template>
            <span class="ml-1">{{ t("common.dialog.ok") }}</span>
          </a-button>
        </a-flex>
      </a-flex>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.site-select {
  width: 100%;
}

.site-hint {
  min-height: 22px;
  margin-top: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.line-through {
  text-decoration: line-through;
}

.site-option {
  display: flex;
  align-items: center;
}

.site-option-main {
  flex: 1 1 0;
  min-width: 0;
}

.site-option-desc {
  max-width: 500px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.site-option-tags {
  margin-left: 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  /* 弹层宽度改成由内容决定之后，tags 是整串 join 出来的、不设上限会把弹层撑到屏幕外 */
  max-width: 220px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.switch-row {
  cursor: pointer;
}
</style>
