<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { cloneDeep } from "es-toolkit";
import type { FormInstance } from "antdv-next";
import { FilterOutlined } from "@antdv-next/icons";
import { getBackupServer, getBackupServerMetaData, type IBackupMetadata } from "@ptd/backupServer";
import type { IBackupRetention } from "@ptd/backupServer";
import { DEFAULT_BACKUP_RETENTION_SAMPLE_RULES, hasBackupRetentionToApply } from "@ptd/backupServer/utils.ts";

import { BackupFields, type IBackupServerMetadata } from "@/shared/types.ts";

import ConnectCheckButton from "@/options/components/ConnectCheckButton.vue";

const { t } = useI18n();

const clientConfig = defineModel<IBackupServerMetadata>();
const emits = defineEmits<{
  (e: "update:configValid", value: boolean): void;
}>();

const hasRetention = computed(() => hasBackupRetentionToApply(clientConfig.value?.retention));

/* -------------------------------------------------------------------------- */
/*                              备份保留策略（内联）                            */
/* -------------------------------------------------------------------------- */

/**
 * 备份保留策略的表单值。界面上始终展示一份完整的默认配置（避免用户勾选后出现空输入框），
 * 再从已保存的配置覆盖，因此这里持有一份本地副本而不是直接双向绑定到 clientConfig
 */
function createDefaultRetention(): IBackupRetention {
  return {
    time: { enabled: false, maxAge: 90 },
    count: { enabled: false, maxCount: 30 },
    sample: {
      enabled: false,
      rules: Object.fromEntries(
        Object.entries(DEFAULT_BACKUP_RETENTION_SAMPLE_RULES).map(([type, rule]) => [type, { ...rule }]),
      ),
    },
  };
}

const retentionDraft = ref<IBackupRetention>(createDefaultRetention());

/** 判断一份保留策略中是否真的有已启用的规则，没有则需要将其置空以保持一致 */
function hasEnabledRetentionRule(value: IBackupRetention): boolean {
  return !!(
    (value.time?.enabled && (value.time.maxAge ?? 0) > 0) ||
    (value.count?.enabled && (value.count.maxCount ?? 0) > 0) ||
    (value.sample?.enabled &&
      Object.values(value.sample.rules ?? {}).some((rule) => rule && rule.interval > 0 && rule.horizon > 0))
  );
}

const retentionSampleRules = computed(() => Object.entries(retentionDraft.value.sample?.rules ?? {}));

/**
 * 把已保存的保留策略同步到本地草稿，使界面回显保存过的配置。
 *
 * 这里监听 `clientConfig.retention` 而不是只在挂载时初始化一次：
 * `EditDialog` 关闭后并不会销毁 Editor，再次编辑另一台服务器时需要跟着切换草稿。
 * 保存的配置可能是旧版本写入的、字段不全，因此以默认配置为基础再合并。
 *
 * 注意：本同步与下面的「草稿 → 配置」写入互为对方的输入，若不加标记会来回互相触发，
 * 因此用 `syncingFromConfig` 打断回环，并额外比较内容避免无意义的重复写入。
 */
let syncingFromConfig = false;
let lastSyncedRetention: string | undefined;

watch(
  () => clientConfig.value?.retention,
  (saved) => {
    syncingFromConfig = true;
    try {
      const draft = createDefaultRetention();

      retentionDraft.value = saved
        ? {
            time: { ...draft.time, ...saved.time },
            count: { ...draft.count, ...saved.count },
            sample: {
              ...draft.sample,
              ...saved.sample,
              rules: { ...draft.sample!.rules, ...saved.sample?.rules },
            },
          }
        : draft;

      lastSyncedRetention = JSON.stringify(retentionDraft.value);
    } finally {
      syncingFromConfig = false;
    }
  },
  { immediate: true },
);

watch(
  retentionDraft,
  (value) => {
    // 本次变化来自上面的「配置 → 草稿」同步，无需再写回配置
    if (syncingFromConfig || !clientConfig.value) {
      return;
    }

    // 未启用任何有效规则时置空，避免把一份「全未启用」的配置写入 metadata
    const nextRetention = hasEnabledRetentionRule(value) ? cloneDeep(value) : undefined;
    const nextSerialized = JSON.stringify(nextRetention ?? null);
    if (nextSerialized === lastSyncedRetention) {
      return; // 内容没有变化，避免重复写入触发无谓的持久化
    }

    lastSyncedRetention = nextSerialized;
    clientConfig.value.retention = nextRetention;
  },
  { deep: true },
);

/** 清空全部保留规则（对应「不自动清理历史备份」） */
function clearRetention() {
  retentionDraft.value = createDefaultRetention();
}

const retentionSummary = computed(() => {
  const retention = clientConfig.value?.retention;
  if (!hasBackupRetentionToApply(retention)) {
    return t("SetBackup.RetentionDialog.none");
  }

  const summary: string[] = [];
  if (retention?.time?.enabled && (retention.time.maxAge ?? 0) > 0) {
    summary.push(t("SetBackup.RetentionDialog.summary.time", { n: retention.time.maxAge }));
  }
  if (retention?.count?.enabled && (retention.count.maxCount ?? 0) > 0) {
    summary.push(t("SetBackup.RetentionDialog.summary.count", { n: retention.count.maxCount }));
  }
  if (retention?.sample?.enabled) {
    for (const [type, rule] of Object.entries(retention.sample.rules ?? {})) {
      if (rule && rule.interval > 0 && rule.horizon > 0) {
        summary.push(
          t("SetBackup.RetentionDialog.summary.sample", {
            type: t(`SetBackup.RetentionDialog.sample.type.${type}`),
            n: rule.horizon,
            interval: rule.interval,
          }),
        );
      }
    }
  }

  return summary.join(t("SetBackup.RetentionDialog.summary.separator"));
});

const clientMeta = computedAsync<IBackupMetadata<any>>(
  async () => {
    const clientType = clientConfig.value?.type;
    if (!clientType) {
      return { requiredField: [] } as IBackupMetadata<any>;
    }
    return await getBackupServerMetaData(clientType);
  },
  { requiredField: [] } as IBackupMetadata<any>,
);

const formValid = ref<boolean>(false);
const formRef = ref<FormInstance | null>(null);

/**
 * Vuetify 的 `<v-form v-model="formValid">` 会把校验结果自动回写，antd 的 a-form 不会。
 * 这里手动把校验结果同步到 formValid —— 它经 `@update:configValid` 决定
 * 添加/编辑对话框里「确定」按钮是否可用（见 AddDialog.vue / EditDialog.vue）。
 */
function syncFormValid() {
  formRef.value
    ?.validate()
    .then(() => (formValid.value = true))
    .catch(() => (formValid.value = false));
}

// 打开对话框时表单已带上了已保存的值，同步一次，避免「内容合法但按钮不可点」
onMounted(syncFormValid);

// 父对话框的「保存」原本只在 @after:check-connect 里拿 configValid，不点测试连接就永远禁用；
// 这里让校验结果自己上报，immediate 是为了挂载那一次同步的结果也能送出去。
watch(formValid, (v) => emits("update:configValid", v), { immediate: true });

async function checkConnect() {
  const clientType = clientConfig.value?.type;
  if (formValid.value && clientConfig.value && clientType) {
    const client = await getBackupServer(clientConfig.value);
    return await client.ping();
  }
  return false;
}
</script>

<template>
  <a-card class="mb-5">
    <a-form v-if="clientConfig" ref="formRef" :model="clientConfig" layout="vertical" class="editor-form">
      <div class="section-label my-2">{{ t("common.basicInfo") }}</div>
      <a-row :gutter="[16, 8]">
        <a-col :span="12" :md="4">
          <a-form-item :label="t('common.type')">
            <a-input v-model:value="clientConfig.type" disabled />
          </a-form-item>
        </a-col>
        <a-col :span="12" :md="4">
          <a-form-item
            :label="t('SetDownloader.common.name')"
            name="name"
            :rules="[{ required: true, message: t('SetDownloader.editor.nameTip') }]"
          >
            <a-input
              v-model:value="clientConfig.name"
              :placeholder="t('SetDownloader.common.name')"
              @change="syncFormValid"
            />
          </a-form-item>
        </a-col>
        <a-col :span="12" :md="4">
          <a-form-item :label="t('SetDownloader.common.uid') + t('SetDownloader.editor.uidPlaceholder')">
            <a-input v-model:value="clientConfig.id" disabled />
          </a-form-item>
        </a-col>
      </a-row>

      <div class="section-label my-2">{{ t("SetBackup.Editor.serverConfig") }}</div>

      <a-row :gutter="[16, 8]">
        <a-col v-for="metaField in clientMeta.requiredField" :key="metaField.key" :span="12">
          <a-form-item :label="metaField.name" :extra="metaField.description ?? undefined">
            <a-textarea
              v-if="metaField.type === 'strings'"
              v-model:value="clientConfig.config[metaField.key! as string]"
            />
            <a-input
              v-else-if="metaField.type === 'string'"
              v-model:value="clientConfig.config[metaField.key! as string]"
            />
            <a-switch
              size="small"
              v-else-if="metaField.type === 'boolean'"
              v-model:checked="clientConfig.config[metaField.key! as string]"
            />
          </a-form-item>
        </a-col>
      </a-row>

      <a-divider class="my-2" />

      <div class="section-label my-2">{{ t("SetBackup.Editor.backupConfig") }}</div>

      <!-- 以下三项为相互独立的备份设置，分别用子标题区分：备份内容 / 自动备份间隔 / 备份保留策略 -->
      <!-- 备份内容：v-switch + 数组 v-model + :value 是复选语义，对应 a-checkbox-group -->
      <a-checkbox-group v-model:value="clientConfig.backupFields">
        <a-row :gutter="[16, 8]">
          <a-col :span="12">
            <div class="section-label text-body-medium font-weight-medium text-medium-emphasis">
              {{ t("SetBackup.Editor.backupFields") }}
            </div>
          </a-col>
          <a-col v-for="backupField in BackupFields" :key="backupField" :span="12" :md="4">
            <a-checkbox :value="backupField">
              {{ t(`SetBackup.fields.${backupField}`) }}
            </a-checkbox>
          </a-col>
        </a-row>
      </a-checkbox-group>

      <a-divider class="my-3" />

      <!-- 自动备份间隔 -->
      <a-row :gutter="[16, 8]">
        <a-col :span="12">
          <div class="section-label text-body-medium font-weight-medium text-medium-emphasis">
            {{ t("SetBackup.Editor.backupInterval") }}
          </div>
        </a-col>
        <a-col :span="12">
          <a-form-item :extra="t('SetBackup.Editor.backupIntervalHint')">
            <div class="number-field">
              <!-- 子标题已说明用途，此处标签仅表示单位，避免与子标题重复 -->
              <a-input-number
                v-model:value="clientConfig.backupInterval"
                :min="0"
                :step="1"
                :placeholder="t('SetBackup.Editor.backupIntervalField')"
                style="width: 200px"
              />
              <span class="number-field__unit">h</span>
            </div>
          </a-form-item>
        </a-col>
      </a-row>

      <a-divider class="my-3" />

      <!-- 备份保留策略：设置项直接内联展示，不再单独弹出对话框 -->
      <a-row :gutter="[16, 8]">
        <a-col class="d-flex flex-wrap align-center ga-2" :span="12">
          <div class="section-label text-body-medium font-weight-medium text-medium-emphasis">
            {{ t("SetBackup.Editor.retention") }}
          </div>
          <!-- 仅在启用了保留策略时展示摘要，避免未启用时出现无意义的提示文字 -->
          <span v-if="hasRetention" class="text-body-small retention-summary">{{ retentionSummary }}</span>
          <a-tooltip :title="t('SetBackup.Editor.clearRetention')">
            <a-button
              v-if="hasRetention"
              color="danger"
              variant="text"
              size="small"
              @click="clearRetention"
            >
              <template #icon>
                <FilterOutlined />
              </template>
            </a-button>
          </a-tooltip>
        </a-col>

        <a-col class="text-body-small text-medium-emphasis" :span="12">
          {{ t("SetBackup.RetentionDialog.tip") }}
        </a-col>

        <a-col :span="12" class="retention-group pa-4">
          <!-- 按时间期限保留 -->
          <a-row :gutter="[16, 8]">
            <a-col :flex="'auto'" class="d-flex align-center">
              <a-switch
                :checked="retentionDraft.time!.enabled"
                size="small"
                @change="(v: any) => (retentionDraft.time!.enabled = !!v)"
              />
              <span class="retention-toggle-label">{{ t("SetBackup.RetentionDialog.time.title") }}</span>
            </a-col>
            <a-col class="retention-field" :span="12" :sm="6" :md="4">
              <div class="number-field">
                <a-input-number
                  v-model:value="retentionDraft.time!.maxAge"
                  :disabled="!retentionDraft.time!.enabled"
                  :min="1"
                  :placeholder="t('SetBackup.RetentionDialog.time.maxAge')"
                />
                <span class="number-field__unit">{{ t("SetBackup.RetentionDialog.daySuffix") }}</span>
              </div>
            </a-col>
          </a-row>

          <a-divider class="my-2" />

          <!-- 按数量保留 -->
          <a-row :gutter="[16, 8]">
            <a-col :flex="'auto'" class="d-flex align-center">
              <a-switch
                :checked="retentionDraft.count!.enabled"
                size="small"
                @change="(v: any) => (retentionDraft.count!.enabled = !!v)"
              />
              <span class="retention-toggle-label">{{ t("SetBackup.RetentionDialog.count.title") }}</span>
            </a-col>
            <a-col class="retention-field" :span="12" :sm="6" :md="4">
              <div class="number-field">
                <a-input-number
                  v-model:value="retentionDraft.count!.maxCount"
                  :disabled="!retentionDraft.count!.enabled"
                  :min="1"
                  :placeholder="t('SetBackup.RetentionDialog.count.maxCount')"
                />
                <span class="number-field__unit">{{ t("SetBackup.RetentionDialog.countSuffix") }}</span>
              </div>
            </a-col>
          </a-row>

          <a-divider class="my-2" />

          <!-- 按时间窗口采样保留 -->
          <a-row :gutter="[16, 8]">
            <a-col :span="12">
              <div class="d-flex align-center ga-2">
                <a-switch
                  :checked="retentionDraft.sample!.enabled"
                  size="small"
                  @change="(v: any) => (retentionDraft.sample!.enabled = !!v)"
                />
                <span>{{ t("SetBackup.RetentionDialog.sample.title") }}</span>
              </div>
            </a-col>
            <a-col class="text-body-small text-medium-emphasis" :span="12">
              {{ t("SetBackup.RetentionDialog.sample.hint") }}
            </a-col>

            <!-- 采样规则：窗口名称 / 保留窗口数 / 窗口宽度（天） -->
            <a-col :span="12">
              <div class="retention-table" :class="{ 'retention-table--disabled': !retentionDraft.sample!.enabled }">
                <div class="retention-table__row retention-table__head text-body-small text-medium-emphasis">
                  <div />
                  <div>{{ t("SetBackup.RetentionDialog.sample.horizon") }}</div>
                  <div>{{ t("SetBackup.RetentionDialog.sample.interval") }}</div>
                </div>

                <div v-for="[type, rule] in retentionSampleRules" :key="type" class="retention-table__row">
                  <div class="text-no-wrap">{{ t(`SetBackup.RetentionDialog.sample.type.${type}`) }}</div>
                  <!-- 展示顺序为「窗口名称 / 保留窗口数 / 窗口宽度」，与表头一致 -->
                  <a-input-number
                    v-model:value="rule.horizon"
                    :disabled="!retentionDraft.sample!.enabled"
                    :min="0"
                  />
                  <a-input-number
                    v-model:value="rule.interval"
                    :disabled="!retentionDraft.sample!.enabled"
                    :min="0"
                  />
                </div>
              </div>
            </a-col>
          </a-row>
        </a-col>
      </a-row>

      <ConnectCheckButton
        :check-fn="checkConnect"
        :reset-timeout="3e3"
        @after:check-connect="
          () => emits('update:configValid', formValid && true) // 不管是否测试成功，都允许用户进行下一步操作（保存下载服务器配置）
        "
      />
    </a-form>
  </a-card>
</template>

<style scoped lang="scss">
/* 卡片本身只是分组容器，去掉默认内边距，保持与原先 v-container.pa-0 一致的紧凑排版 */
:deep(.ant-card-body) {
  padding: 0;
}

/* 分节标题（原来是 v-label） */
.section-label {
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
}

/* 表单项不再显示底部校验/提示留白，紧凑一些 */
:deep(.ant-form-item) {
  margin-bottom: 12px;
}

/* 数值输入框 + 单位后缀 */
.number-field {
  display: flex;
  align-items: center;
  gap: 8px;

  :deep(.ant-input-number) {
    flex: 1;
    min-width: 0;
  }
}

.number-field__unit {
  flex: none;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
  white-space: nowrap;
}

/* 保留策略的开关 + 说明文字 */
.retention-toggle-label {
  margin-left: 8px;
}

/* 已启用保留策略时，摘要使用成功色以突出状态 */
.retention-summary {
  color: #52c41a;
}

/* 数值输入框不铺满整行，避免数字输入框被拉得过长（与开关之间的间距由 a-col :flex="auto" 提供） */
.retention-field {
  max-width: 260px;
}

/* 采样规则表：三列对齐（窗口名称 / 保留窗口数 / 窗口宽度），用 Grid 比嵌套 a-row 更直观 */
.retention-table {
  display: grid;
  gap: 6px;
}

.retention-table__row {
  display: grid;
  grid-template-columns: minmax(56px, 1fr) minmax(0, 190px) minmax(0, 190px);
  align-items: center;
  gap: 12px;
}

.retention-table--disabled {
  opacity: 0.55;
}

/**
 * 保留策略容器的可用宽度受外层对话框与浏览器窗口限制，
 * 与基于视口宽度的断点无关，因此这里用容器查询。
 */
.retention-group {
  container-type: inline-size;
}

/* 容器较窄时隐藏表头，采样规则改为紧凑三列（窗口名称 + 两个铺满的输入框） */
@container (max-width: 479px) {
  .retention-table__row {
    grid-template-columns: minmax(36px, auto) minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }

  .retention-table__head {
    display: none;
  }
}
</style>