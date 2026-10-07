<script setup lang="ts">
import { computed, inject, onMounted, ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { set } from "es-toolkit/compat";
import { toMerged } from "es-toolkit";
import { DeleteOutlined, ExportOutlined, InfoCircleOutlined, PlusOutlined } from "@antdv-next/icons";
import type { SelectProps } from "antdv-next";

import type { ISiteMetadata, ISiteUserConfig, timezoneOffset, TSiteID, TSiteUrl } from "@ptd/site";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate, formValidateRules } from "@/options/utils.ts";
import { CATEGORY_KINDS, categoryKindLabelKey } from "@/shared/category.ts";

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const siteId = defineModel<TSiteID>({ default: "" });
const emit = defineEmits<{
  (e: "update:formValid", v: boolean): void;
}>();

const siteMetaData = ref<ISiteMetadata>({} as unknown as ISiteMetadata);

/**
 * EditDialog 通过 provide 注入的是一个 ref（旧代码把它的类型标成了 ISiteUserConfig
 * 但实际传的是 Ref，这里把类型修正为真实形状）。
 */
const siteUserConfig = inject<Ref<ISiteUserConfig>>("storedSiteUserConfig", ref({} as ISiteUserConfig));

const siteName = computed({
  get: () => siteUserConfig.value.merge?.name ?? siteMetaData.value.name,
  set: (value: string) => set(siteUserConfig.value, "merge.name", value),
});
const siteTimezoneOffset = computed({
  get: () => siteUserConfig.value.merge?.timezoneOffset ?? siteMetaData.value.timezoneOffset,
  set: (value: string) => set(siteUserConfig.value, "merge.timezoneOffset", value),
});
const customSiteUrl = ref<string>("");

/** 竞态令牌：快速切换站点时，先发后到的旧请求结果必须丢弃 */
let initToken = 0;

async function initSiteData(id: TSiteID, flush = false) {
  const token = ++initToken;

  // getSiteUserConfig 走的是 state.sites[id] 这条本地快路径，而 metadata store 靠 chrome.storage
  // 异步水合：没水合完就调用，它判成「配置为空」转而发一次跨上下文消息兜底。
  // 结果是白等一次 options 侧的 $onReady 才走兜底。
  //
  // ⚠️ 原注释接着说「兜底那条路径读的是另一个上下文的 store，同样可能在水合前读」——**不成立**：
  // 兜底是 sendMessage("getSiteUserConfig") → offscreen/utils/site.ts → extStore.getItem，
  // 那是直读 chrome.storage 的 SW 代理通道，不碰 pinia、没有水合概念，也不该给它补 $onReady
  // （补了是白等）。真正的风险是另一回事：options 侧此刻的 $save 可能还没落盘。
  await metadataStore.$onReady();

  try {
    const [meta, userConfig] = await Promise.all([
      metadataStore.getSiteMetadata(id),
      metadataStore.getSiteUserConfig(id, flush),
    ]);

    // 期间用户已经切到别的站点了 → 丢弃这次结果，否则旧数据会覆盖新站点的表单
    if (token !== initToken) {
      return;
    }

    siteMetaData.value = meta;
    const merged = toMerged({ inputSetting: {}, url: meta.urls[0] }, userConfig);
    siteUserConfig.value = merged;

    // fix: customSiteUrl not show in Editor (#726)
    // 用户配的 url 不在站点定义的候选列表里 → 视为自定义 url，需要展示出来让用户编辑
    customSiteUrl.value = meta.urls.includes(merged.url as TSiteUrl) ? "" : (merged.url as string);
    syncCategoryRows();
  } catch (e) {
    if (token !== initToken) {
      return;
    }
    // 原来完全没有 catch：加载失败时表单永远空白且没有任何提示，用户无从判断是加载失败还是站点没数据
    console.error("[SetSite] load site definition failed", id, e);
    runtimeStore.showSnakebar(t("SetSite.Editor.loadDefinitionFailed", { id }), { color: "error" });
  }
}

onMounted(() => {
  void initSiteData(siteId.value);
});

watch(siteId, (newValue) => {
  void initSiteData(newValue);
});

// ===== 校验：显式派生，保持 OK 按钮门控语义 =====
//
// 这里**刻意不用 a-form 的 :rules**（之前那份重构清单把它列成候选，我核过代码后撤回）：
// 1) 门控条件里有两项拿不到 form 的校验模型里 —— `missingRequiredSetting` 要遍历
//    siteMetaData.userInputSettingMeta 做动态必填校验（规则集运行时才确定，
//    :rules 表达不了）；`sortIndexMissing` 校验的是 number/NaN 而不是空值。
//    这两项只能继续留在 computed 里。
// 2) url 那一项的输入控件是 a-radio-group 里嵌的 a-input（手输自定义地址），
//    不是 form item 的直接子控件，FormItem 绑不到它的值。
// 既然门控仍要靠 computed，规则再写一份到 :rules 上就是两份逻辑并存 ———
// 与其维护两份，不如保持现状，只让「红框 + 文案」的呈现走组件自己的 API。
//
// 提示文案复用 formValidateRules 的默认信息，与旧表单实际显示的文本一致
const requiredHint = String(formValidateRules.require()(undefined));
const urlHint = String(formValidateRules.url()(undefined));

const nameMissing = computed(() => !siteName.value || String(siteName.value).trim() === "");
const sortIndexMissing = computed(() => typeof siteUserConfig.value.sortIndex !== "number" || Number.isNaN(siteUserConfig.value.sortIndex));
const urlMissing = computed(() => !siteUserConfig.value.url || String(siteUserConfig.value.url).trim() === "");
const urlInvalid = computed(() => {
  const url = siteUserConfig.value.url;
  if (!url) return false;
  const result = formValidateRules.url()(url);
  return result !== true && result !== undefined && result !== null && result !== "";
});
const missingRequiredSetting = computed(() => {
  if (siteMetaData.value.isDead) return false;
  const metas = siteMetaData.value.userInputSettingMeta ?? [];
  const setting = siteUserConfig.value.inputSetting ?? {};
  return metas.some((meta) => meta.required && !(setting as Record<string, unknown>)[meta.name]?.toString());
});

const isFormValid = computed(
  () => !nameMissing.value && !sortIndexMissing.value && !urlMissing.value && !urlInvalid.value && !missingRequiredSetting.value,
);

watch(
  isFormValid,
  (v) => {
    emit("update:formValid", v);
  },
  { immediate: true },
);

// ===== 数值型设置的受控读写（slider 需要确定的 number）=====
const timeout = computed({
  get: () => siteUserConfig.value.timeout ?? 0,
  set: (v: number) => (siteUserConfig.value.timeout = v),
});
const downloadInterval = computed({
  get: () => siteUserConfig.value.downloadInterval ?? 0,
  set: (v: number) => (siteUserConfig.value.downloadInterval = v),
});
const uploadSpeedLimit = computed({
  get: () => siteUserConfig.value.uploadSpeedLimit ?? 0,
  set: (v: number) => (siteUserConfig.value.uploadSpeedLimit = v),
});

const timeoutColor = computed(() => {
  if (timeout.value > 8 * 60e3) return "#cf1322";
  if (timeout.value > 5 * 60e3) return "#faad14";
  return "#52c41a";
});
const intervalSliderMax = computed(() => (downloadInterval.value < 600 ? 600 : 1200));
const intervalSliderStep = computed(() => (downloadInterval.value <= 60 ? 1 : 10));

/**
 * 分类映射：本站叫法 → 规范类别，存进 `siteUserConfig.categoryMap`。
 *
 * 这一张表是**每站的例外**，不是主判据 —— 主判据是 src/shared/category.ts 里那套按别名
 * 折类的规则（340 个站点、站点自己声明的分类名就有 3200 多个，逐站枚举维护不动）。
 * 只有在规则把某一站的叫法判错时，才在这里按站点纠正，纠正值优先于规则。
 * 存在用户配置顶层而不是 merge 下：这张表只有搜索结果页读，而那里拿不到站点定义的
 * metadata（要异步 import），挂到定义上就成了「写了也没人读」的死配置。
 */
const categoryRows = ref<Array<{ key: string; kind: string }>>([]);

function syncCategoryRows() {
  categoryRows.value = Object.entries(siteUserConfig.value.categoryMap ?? {}).map(([key, kind]) => ({
    key,
    kind: String(kind),
  }));
}

/** 行编辑走显式提交，不 deep watch：否则用户每敲一个字都会绕回来自家提交，光标会跳 */
function commitCategoryRows() {
  const out: Record<string, string> = {};
  for (const row of categoryRows.value) {
    const key = row.key.trim();
    if (key) out[key] = row.kind;
  }
  siteUserConfig.value.categoryMap = out;
}

function addCategoryRow() {
  categoryRows.value = [...categoryRows.value, { key: "", kind: "other" }];
}

function removeCategoryRow(idx: number) {
  categoryRows.value = categoryRows.value.filter((_, i) => i !== idx);
  commitCategoryRows();
}

const categoryKindOptions = computed<SelectProps["options"]>(() =>
  CATEGORY_KINDS.map((kind) => ({ value: kind, label: t(categoryKindLabelKey(kind)) })),
);

const groupOptions = computed<SelectProps["options"]>(() =>
  (siteMetaData.value.tags ?? []).map((tag) => ({ value: tag, label: tag })),
);
const nameOptions = computed<SelectProps["options"]>(() =>
  [siteMetaData.value.name, ...(siteMetaData.value.aka ?? [])].filter(Boolean).map((name) => ({ value: name, label: name })),
);

const timeZone: Array<{ value: timezoneOffset; title: string }> = [
  { value: "-1200", title: "(UTC -12:00) Enitwetok, Kwajalien" },
  { value: "-1100", title: "(UTC -11:00) Midway Island, Samoa" },
  { value: "-1000", title: "(UTC -10:00) Hawaii" },
  { value: "-0900", title: "(UTC -09:00) Alaska" },
  { value: "-0800", title: "(UTC -08:00) Pacific Time (US & Canada)" },
  { value: "-0700", title: "(UTC -07:00) Mountain Time (US & Canada)" },
  { value: "-0600", title: "(UTC -06:00) Central Time (US & Canada), Mexico City" },
  { value: "-0500", title: "(UTC -05:00) Eastern Time (US & Canada), Bogota, Lima" },
  { value: "-0400", title: "(UTC -04:00) Atlantic Time (Canada), Caracas, La Paz" },
  { value: "-0330", title: "(UTC -03:30) Newfoundland" },
  { value: "-0300", title: "(UTC -03:00) Brazil, Buenos Aires, Falkland Is." },
  { value: "-0200", title: "(UTC -02:00) Mid-Atlantic, Ascention Is., St Helena" },
  { value: "-0100", title: "(UTC -01:00) Azores, Cape Verde Islands" },
  { value: "+0000", title: "(UTC ±00:00) Casablanca, Dublin, London, Lisbon, Monrovia" },
  { value: "+0100", title: "(UTC +01:00) Brussels, Copenhagen, Madrid, Paris" },
  { value: "+0200", title: "(UTC +02:00) Sofia, Izrael, South Africa," },
  { value: "+0300", title: "(UTC +03:00) Baghdad, Riyadh, Moscow, Nairobi" },
  { value: "+0330", title: "(UTC +03:30) Tehran" },
  { value: "+0400", title: "(UTC +04:00) Abu Dhabi, Baku, Muscat, Tbilisi" },
  { value: "+0430", title: "(UTC +04:30) Kabul" },
  { value: "+0500", title: "(UTC +05:00) Ekaterinburg, Karachi, Tashkent" },
  { value: "+0530", title: "(UTC +05:30) Bombay, Calcutta, Madras, New Delhi" },
  { value: "+0600", title: "(UTC +06:00) Almaty, Colomba, Dhakra" },
  { value: "+0700", title: "(UTC +07:00) Bangkok, Hanoi, Jakarta" },
  { value: "+0800", title: "(UTC +08:00) ShangHai, HongKong, Perth, Singapore, Taipei" },
  { value: "+0900", title: "(UTC +09:00) Osaka, Sapporo, Seoul, Tokyo, Yakutsk" },
  { value: "+0930", title: "(UTC +09:30) Adelaide, Darwin" },
  { value: "+1000", title: "(UTC +10:00) Melbourne, Papua New Guinea, Sydney" },
  { value: "+1100", title: "(UTC +11:00) Magadan, New Caledonia, Solomon Is." },
  { value: "+1200", title: "(UTC +12:00) Auckland, Fiji, Marshall Island" },
];
const timezoneOptions = computed<SelectProps["options"]>(() =>
  timeZone.map((x) => ({ value: x.value, label: x.title })),
);
</script>

<template>
  <a-form layout="vertical" :disabled="siteMetaData.isDead">
    <div class="section-title">{{ t("common.basicInfo") }}</div>
    <a-row :gutter="12">
      <a-col :span="8">
        <a-form-item :label="t('SetSite.common.name')" :validate-status="nameMissing ? 'error' : ''" :help="nameMissing ? requiredHint : undefined">
          <a-auto-complete
            v-model:value="siteName"
            :options="nameOptions"
            size="small"
            :placeholder="siteMetaData.name"
          />
        </a-form-item>
      </a-col>
      <a-col :span="8">
        <a-form-item :label="t('common.type')">
          <a-input :value="siteMetaData.schema" size="small" disabled />
        </a-form-item>
      </a-col>
      <a-col :span="8">
        <a-form-item
          :label="t('common.sortIndex')"
          :validate-status="sortIndexMissing ? 'error' : ''"
          :help="sortIndexMissing ? t('SetSite.editor.sortIndexTip') : undefined"
        >
          <a-input-number
            v-model:value="siteUserConfig.sortIndex"
            class="full-width"
            size="small"
            :placeholder="t('SetSite.editor.sortIndexTip')"
          />
        </a-form-item>
      </a-col>
      <a-col :span="24">
        <a-form-item :label="t('SetSite.common.groups')">
          <a-select
            v-model:value="siteUserConfig.groups"
            :options="groupOptions"
            mode="tags"
            size="small"
            class="full-width"
            :placeholder="t('SetSite.common.groups')"
          />
        </a-form-item>
      </a-col>
      <a-col :span="24">
        <a-form-item :label="t('SetSite.editor.timezone')">
          <a-select
            v-model:value="siteTimezoneOffset"
            :options="timezoneOptions"
            size="small"
            class="full-width"
            show-search
            :filter-option="(input: string, option: any) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())"
          />
        </a-form-item>
      </a-col>
    </a-row>

    <a-form-item :label="t('SetSite.common.url')" :validate-status="urlMissing || urlInvalid ? 'error' : ''">
      <a-radio-group v-model:value="siteUserConfig.url" class="url-radio-group">
        <div v-for="url in siteMetaData.urls" :key="url" class="url-radio-row">
          <a-radio :value="url">
            <span class="url-text">{{ url }}</span>
          </a-radio>
          <a-tooltip :title="t('SetSite.common.open')">
            <a :href="url" target="_blank" rel="noopener noreferrer nofollow" class="url-open">
              <ExportOutlined />
            </a>
          </a-tooltip>
        </div>
        <div class="url-radio-row">
          <a-radio :value="customSiteUrl">
            <a-input
              v-model:value="customSiteUrl"
              size="small"
              class="custom-url-input"
              :placeholder="t('SetSite.editor.customUrlPlaceholder')"
              :status="urlInvalid ? 'error' : ''"
              @change="siteUserConfig.url = (customSiteUrl || undefined) as unknown as TSiteUrl"
            />
          </a-radio>
        </div>
      </a-radio-group>
    </a-form-item>

    <template v-if="siteMetaData.userInputSettingMeta && siteUserConfig.inputSetting">
      <a-divider />
      <div class="section-title">{{ t("SetSite.Editor.siteSettings") }}</div>
      <a-form-item
        v-for="userInputMeta in siteMetaData.userInputSettingMeta"
        :key="userInputMeta.name"
        :label="userInputMeta.label"
        :help="userInputMeta.hint"
        :validate-status="
          !siteMetaData.isDead && userInputMeta.required && !siteUserConfig.inputSetting[userInputMeta.name]
            ? 'error'
            : ''
        "
      >
        <a-input
          v-model:value="siteUserConfig.inputSetting[userInputMeta.name]"
          size="small"
          :placeholder="userInputMeta.hint"
        />
      </a-form-item>
      <a-divider />
    </template>

    <div class="section-title">{{ t("SetSite.Editor.otherSettings") }}</div>

    <a-form-item>
      <template #label>
        <span>{{ t("SetSite.Editor.downloadLinkSuffix") }}</span>
        <a-tooltip :title="t('SetSite.Editor.downloadLinkSuffixExample')">
          <InfoCircleOutlined class="label-help" />
        </a-tooltip>
      </template>
      <a-input
        v-model:value="siteUserConfig.downloadLinkAppendix"
        size="small"
        :placeholder="t('SetSite.Editor.downloadLinkSuffixHint')"
      />
    </a-form-item>

    <a-form-item :label="t('SetSite.Editor.requestTimeout')" :help="t('SetSite.Editor.requestTimeoutHint')">
      <div class="slider-row">
        <a-slider
          v-model:value="timeout"
          class="slider"
          :min="0"
          :max="10 * 60e3"
          :step="1e3"
          :tooltip="{ formatter: (v?: number) => formatDate(v ?? 0, 'mm:ss') }"
        />
        <a-button size="small" @click="timeout = 30e3">
          <span :style="{ color: timeoutColor }">{{ formatDate(timeout, "mm:ss") }}</span>
        </a-button>
      </div>
    </a-form-item>

    <a-form-item :label="t('SetSite.Editor.downloadInterval')" :help="t('SetSite.Editor.downloadIntervalHint')">
      <div class="slider-row">
        <a-slider
          v-model:value="downloadInterval"
          class="slider"
          :min="0"
          :max="intervalSliderMax"
          :step="intervalSliderStep"
        />
        <a-button size="small" @click="downloadInterval = 0">
          {{ formatDate(downloadInterval * 1e3, "mm:ss") }}
        </a-button>
      </div>
    </a-form-item>

    <a-form-item :label="t('SetSite.editor.uploadSpeedLimit')" :help="t('SetSite.editor.uploadSpeedLimitHint')">
      <div class="slider-row">
        <a-slider v-model:value="uploadSpeedLimit" class="slider" :min="0" :max="1024" :step="1" />
        <a-button size="small" @click="uploadSpeedLimit = 0">{{ uploadSpeedLimit }} MiB/s</a-button>
      </div>
    </a-form-item>

    <a-form-item :label="t('SetSite.Editor.categoryMap')" :help="t('SetSite.Editor.categoryMapHint')">
      <div class="category-map">
        <div v-for="(row, idx) in categoryRows" :key="idx" class="category-map-row">
          <a-input
            v-model:value="row.key"
            size="small"
            class="category-map-key"
            :placeholder="t('SetSite.Editor.categoryMapSite')"
            @change="commitCategoryRows"
          />
          <a-select
            v-model:value="row.kind"
            size="small"
            class="category-map-kind"
            :options="categoryKindOptions"
            @change="commitCategoryRows"
          />
          <a-button size="small" type="text" @click="removeCategoryRow(idx)">
            <template #icon><DeleteOutlined /></template>
            {{ t("common.remove") }}
          </a-button>
        </div>
        <a-button size="small" class="category-map-add" @click="addCategoryRow">
          <template #icon><PlusOutlined /></template>
          {{ t("SetSite.Editor.categoryMapAdd") }}
        </a-button>
      </div>
    </a-form-item>
  </a-form>
</template>

<style scoped lang="scss">
.section-title {
  margin: 8px 0;
  font-weight: 600;
}

.full-width {
  width: 100%;
}

.url-radio-group {
  display: block;
  width: 100%;
}

.url-radio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.url-text {
  font-size: 13px;
}

.url-open {
  display: inline-flex;
  color: #1677ff;
}

.custom-url-input {
  width: 320px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 分类映射的编辑行：叫法 + 规范类别 + 删除。整块限宽，不然在宽弹窗里
   那颗删除键会跑到离输入框很远的右边 */
.category-map {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 520px;
}

.category-map-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-map-key {
  flex: 1 1 auto;
  min-width: 0;
}

.category-map-kind {
  flex: 0 0 120px;
}

.category-map-add {
  align-self: flex-start;
}

.slider {
  flex: 1 1 0;
}

.label-help {
  margin-left: 4px;
  color: #1677ff;
  cursor: help;
}
</style>
