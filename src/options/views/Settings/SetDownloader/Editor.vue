<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { format } from "date-fns";

import type { IDownloaderMetadata } from "@/shared/types.ts";
import { formValidateRules } from "@/options/utils.ts";
import { getDownloader, getDownloaderMetaData, type TorrentClientMetaData } from "@ptd/downloader";

import ConnectCheckButton from "@/options/components/ConnectCheckButton.vue";

const { t } = useI18n();

const clientConfig = defineModel<IDownloaderMetadata>();

const clientMeta = computedAsync<TorrentClientMetaData>(
  async () =>
    clientConfig.value?.type ? await getDownloaderMetaData(clientConfig.value.type) : ({} as TorrentClientMetaData),
  {} as TorrentClientMetaData,
);

const showPassword = ref<boolean>(false);

const formRef = ref();

async function validateForm() {
  if (!formRef.value) return false;
  try {
    await formRef.value.validateFields();
    return true;
  } catch {
    return false;
  }
}

async function checkConnect(): Promise<boolean> {
  const valid = await validateForm();
  if (!valid) return false;
  try {
    const client = await getDownloader(clientConfig.value!);
    return await client.ping();
  } catch {
    return false;
  }
}

function formatTimeout(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const timeoutColor = computed(() => {
  const ms = clientConfig.value?.timeout ?? 0;
  if (ms > 8 * 60e3) return "red";
  if (ms > 5 * 60e3) return "orange";
  return "green";
});

const advanceOptions = computed(() => clientMeta.value?.advanceAddTorrentOptions ?? []);
</script>

<template>
  <a-form
    v-if="clientConfig"
    ref="formRef"
    :model="clientConfig"
    layout="vertical"
  >
    <a-row :gutter="16">
      <a-col :span="24" :md="6">
        <a-form-item :label="t('common.type')">
          <a-input v-model:value="clientConfig.type" disabled />
        </a-form-item>
      </a-col>
      <a-col :span="24" :md="8">
        <a-form-item
          :label="t('SetDownloader.common.name')"
          name="name"
          :rules="[{ validator: formValidateRules.require(t('SetDownloader.editor.nameTip')), trigger: 'blur' }]"
        >
          <a-input v-model:value="clientConfig.name" :placeholder="t('SetDownloader.common.name')" />
        </a-form-item>
      </a-col>
      <a-col :span="24" :md="7">
        <a-form-item :label="t('SetDownloader.common.uid') + t('SetDownloader.editor.uidPlaceholder')">
          <a-input v-model:value="clientConfig.id" disabled />
        </a-form-item>
      </a-col>
      <a-col :span="24" :md="3">
        <a-form-item :label="t('common.sortIndex')" name="sortIndex" :rules="[{ required: true }]">
          <a-input-number v-model:value="clientConfig.sortIndex" style="width: 100%" />
        </a-form-item>
      </a-col>
    </a-row>

    <a-form-item
      :label="t('SetDownloader.common.address')"
      name="address"
      :rules="[{ validator: formValidateRules.url(t('SetDownloader.editor.addressTip')), trigger: 'blur' }]"
    >
      <a-input v-model:value="clientConfig.address" />
    </a-form-item>

    <a-form-item v-if="typeof clientConfig.username !== 'undefined'" :label="t('common.username')" name="username">
      <a-input v-model:value="clientConfig.username" />
    </a-form-item>

    <a-form-item :label="t('SetDownloader.editor.password')" name="password">
      <a-input-password
        v-model:value="clientConfig.password"
        :visibility-toggle="true"
      />
    </a-form-item>

    <a-form-item :label="t('SetDownloader.editor.timeout')">
      <a-slider
        v-model:value="clientConfig.timeout"
        :min="0"
        :max="10 * 60e3"
        :step="1e3"
        :tooltip="{ formatter: (v: number) => formatTimeout(v) }"
      />
      <a-button type="text" size="small" @click="clientConfig.timeout = 10e3">
        {{ formatTimeout(clientConfig.timeout ?? 0) }}
      </a-button>
    </a-form-item>

    <a-form-item v-if="clientMeta?.feature?.DefaultAutoStart?.allowed" :label="t('SetDownloader.editor.autoStart')">
      <a-switch
        size="small"
        v-model:checked="clientConfig.feature!.DefaultAutoStart"
        :checked-children="t('SetDownloader.editor.switchOn')"
        :un-checked-children="t('SetDownloader.editor.switchOff')"
      />
    </a-form-item>

    <a-form-item v-if="clientMeta?.feature?.BypassCSRF?.allowed" :label="t('SetDownloader.editor.bypassCsrf')">
      <a-switch v-model:checked="clientConfig.feature!.BypassCSRF" size="small" />
      <div class="form-tip">{{ t("SetDownloader.editor.bypassCsrfTip") }}</div>
    </a-form-item>

    <a-collapse v-if="advanceOptions.length > 0" bordered ghost>
      <a-collapse-panel :key="1" :header="t('common.advancedSettings')">
        <a-form-item v-for="opt in advanceOptions" :key="opt.key" :label="opt.name">
          <a-switch v-model:checked="clientConfig.advanceAddTorrentOptions![opt.key]" size="small" />
          <div v-if="opt.description" class="form-tip">{{ opt.description }}</div>
        </a-form-item>
      </a-collapse-panel>
    </a-collapse>

    <ConnectCheckButton :check-fn="checkConnect" :reset-timeout="3e3" />

    <a-alert v-if="clientMeta?.warning?.length" type="warning" show-icon style="margin-top: 12px">
      <template #message>
        <ul style="margin: 0; padding-left: 20px">
          <li v-for="(data, index) in clientMeta.warning" :key="index">{{ data }}</li>
        </ul>
      </template>
    </a-alert>
  </a-form>
</template>

<style scoped>
.form-tip {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-top: 4px;
}
</style>
