<script setup lang="ts">
/**
 * 图床的新增 / 编辑弹窗。同一个组件兼两件事：图床的差别全在预设里（字段清单），
 * 拆成 AddDialog + EditDialog 只会得到两份逐字重复的表单。
 *
 * 字段清单来自 `providers.ts` 的预设（`apiKey` / `endpoint` / `custom` 那几个长尾参数），
 * 所以这里不需要 if-else 认站点，只照清单渲染。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { nanoid } from "nanoid";

import type { IImageHostMetadata, TImageHostType } from "@/shared/imageHost/types.ts";
import { getImageHostPreset, listImageHostPresets, normalizeEndpoint } from "@/shared/imageHost/providers.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

const showDialog = defineModel<boolean>();
const { hostId } = defineProps<{ hostId?: string | null }>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

function blankHost(): IImageHostMetadata {
  return { id: nanoid(), type: "imgbb", name: "", enabled: true, endpoint: "", apiKey: "", options: {} };
}

const form = ref<IImageHostMetadata>(blankHost());

const preset = computed(() => getImageHostPreset(form.value.type));

const typeOptions = computed(() => listImageHostPresets().map((item) => ({ value: item.type, label: item.name })));

watch(showDialog, (open) => {
  if (!open) return;
  const existing = hostId ? metadataStore.imageHosts[hostId] : undefined;
  // 深拷贝：直接绑存档对象会让「取消」也把改动留在内存里（关窗不落盘，但下次打开还在）
  form.value = existing ? JSON.parse(JSON.stringify(existing)) : blankHost();
});

/**
 * 换类型时把凭证与地址清掉。
 *
 * 两类站点的 `apiKey` 语义完全不同（ImgBB 的 key 放到 SM.MS 只会 401），
 * 留着旧值等于让人对着一个必然失败的配置排查。
 */
function onTypeSelect(value: unknown) {
  const next = value as TImageHostType;
  if (next === form.value.type) return;

  const previousName = preset.value?.name ?? "";
  form.value.type = next;
  // 名字还停在上一档的默认名（或压根没填）就清掉，让它保存时自动取新预设的名字
  if (form.value.name === "" || form.value.name === previousName) form.value.name = "";
  form.value.apiKey = "";
  form.value.endpoint = "";
  form.value.options = {};
}

/** 字段键是 `apiKey` / `endpoint` / `options.xxx` 三种形态，这里统一收发 */
function fieldValue(key: string): string {
  if (key.startsWith("options.")) return form.value.options?.[key.slice("options.".length)] ?? "";
  if (key === "apiKey") return form.value.apiKey ?? "";
  if (key === "endpoint") return form.value.endpoint ?? "";
  return "";
}

function setFieldValue(key: string, value: string) {
  if (key.startsWith("options.")) {
    form.value.options = { ...(form.value.options ?? {}), [key.slice("options.".length)]: value };
  } else if (key === "apiKey") {
    form.value.apiKey = value;
  } else if (key === "endpoint") {
    form.value.endpoint = value;
  }
}

const missingFields = computed(() => (preset.value?.fields ?? []).filter((f) => f.required && fieldValue(f.key).trim() === ""));

const canSave = computed(() => !!preset.value && missingFields.value.length === 0);

async function save() {
  const current = preset.value;
  if (!current || !canSave.value) return;

  // 只留下有值的 options：存档里铺一堆 `""` 会让备份包和排障输出变成噪声
  const options = Object.fromEntries(
    Object.entries(form.value.options ?? {}).filter(([, value]) => (value ?? "").trim() !== ""),
  );

  await metadataStore.saveImageHost({
    ...form.value,
    name: form.value.name.trim() || current.name,
    // 内置档没有自定义地址，留着上一档填的地址只会误导（列表里还会显示出来）
    endpoint: current.needEndpoint ? normalizeEndpoint(form.value.endpoint) : "",
    apiKey: (form.value.apiKey ?? "").trim(),
    options,
  });
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="hostId ? t('SetImageHost.editor.titleEdit') : t('SetImageHost.editor.titleAdd')"
    :width="560"
    :mask-closable="false"
  >
    <a-form layout="vertical">
      <a-form-item :label="t('SetImageHost.editor.type')" required>
        <a-select :value="form.type" :options="typeOptions" @change="onTypeSelect" />
      </a-form-item>

      <a-form-item :label="t('SetImageHost.editor.name')">
        <a-input v-model:value="form.name" :placeholder="preset?.name" :maxlength="40" />
      </a-form-item>

      <a-form-item
        v-for="field in preset?.fields ?? []"
        :key="field.key"
        :label="t(`SetImageHost.field.${field.labelKey}`)"
        :required="field.required"
      >
        <a-input-password
          v-if="field.type === 'password'"
          :value="fieldValue(field.key)"
          :placeholder="field.placeholder"
          @update:value="(v: string) => setFieldValue(field.key, v)"
        />
        <a-textarea
          v-else-if="field.type === 'textarea'"
          :value="fieldValue(field.key)"
          :placeholder="field.placeholder"
          :auto-size="{ minRows: 2, maxRows: 6 }"
          @update:value="(v: string) => setFieldValue(field.key, v)"
        />
        <a-input
          v-else
          :value="fieldValue(field.key)"
          :placeholder="field.placeholder"
          @update:value="(v: string) => setFieldValue(field.key, v)"
        />
        <div v-if="field.hintKey" class="field-hint">{{ t(field.hintKey) }}</div>
      </a-form-item>

      <a-alert
        v-if="missingFields.length > 0 && form.name !== ''"
        type="warning"
        show-icon
        :message="t('SetImageHost.editor.requiredMissing')"
      />
    </a-form>

    <template #footer>
      <a-button @click="() => (showDialog = false)">{{ t("common.dialog.cancel") }}</a-button>
      <a-button type="primary" :disabled="!canSave" @click="save">{{ t("common.save") }}</a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.field-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
