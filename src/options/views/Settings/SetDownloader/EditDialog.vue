<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { cloneDeep } from "es-toolkit";
import { message } from "antdv-next";

import type { IDownloaderMetadata, TDownloaderKey } from "@/shared/types.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import Editor from "./Editor.vue";

const showDialog = defineModel<boolean>();
const { clientId } = defineProps<{
  clientId: TDownloaderKey;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const clientConfig = ref<IDownloaderMetadata>();
const saving = ref(false);

/**
 * Editor 播报的表单有效性：这里也要吃，不然「编辑」这条路径仍然能把空名称/非法地址存回去
 * （本次要修的就是提交路径不校验）。写法照 SetSite/EditDialog.vue:58 —— Add/Edit 两个对话框
 * 都门控在同一份判据上，不能只给「添加」那条。
 */
const isFormValid = ref(false);

function dialogEnter() {
  const stored = clientId ? metadataStore.downloaders[clientId] : undefined;
  // ⚠️ 原来只有 `if (clientId && store[id])` 一个守卫，取不到时 clientConfig
  // 保持 undefined 但模板上 Editor 仍会挂（v-model 一个 undefined），
  // 于是用户在一个空表单里点确定，addDownloader(undefined) 落库一条空记录。
  // 这里显式置 undefined，模板用 v-if 挡住；取不到时连弹窗都不该开。
  if (!stored) {
    clientConfig.value = undefined;
    message.error(t("SetDownloader.edit.notFound"));
    showDialog.value = false;
    return;
  }

  // ⚠️ 必须深拷贝：原来的 {...store[id]} 只是顶层展开，
  // advanceAddTorrentOptions / feature 这些嵌套对象与 store 同引用 ——
  // 用户在弹窗里拨一下开关（取消也不保存），store 里那条就已经被改坏了。
  // 兜底字段放在展开**之后**，否则会把已存的 sortIndex 覆盖回默认 100。
  clientConfig.value = {
    ...cloneDeep(stored),
    sortIndex: stored.sortIndex ?? 100,
    advanceAddTorrentOptions: stored.advanceAddTorrentOptions ?? {},
  };
}

async function editClientConfig() {
  if (saving.value) return;
  saving.value = true;
  try {
    await metadataStore.addDownloader(clientConfig.value as IDownloaderMetadata);
    showDialog.value = false;
  } catch (e) {
    message.error(t("SetDownloader.edit.saveFailed"));
    console.error("[SetDownloader] edit save failed", e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetDownloader.edit.title')"
    width="800px"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :after-open-change="(open: boolean) => open && dialogEnter()"
    :ok-button-props="{ disabled: !clientConfig || !isFormValid, loading: saving }"
    @ok="editClientConfig"
  >
    <Editor v-if="clientConfig" v-model="clientConfig" @update:form-valid="(v: boolean) => (isFormValid = v)" />
  </a-modal>
</template>
