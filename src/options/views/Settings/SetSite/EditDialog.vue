<script setup lang="ts">
import { provide, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined } from "@antdv-next/icons";

import { type ISiteUserConfig, type TSiteID } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";

import Editor from "./Editor.vue";

const showDialog = defineModel<boolean>();
const props = defineProps<{
  siteId: TSiteID;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const isFormValid = ref<boolean>(false);

const storedSiteUserConfig = ref<ISiteUserConfig & { valid?: boolean }>({ valid: false });
provide("storedSiteUserConfig", storedSiteUserConfig);

async function patchSite() {
  await metadataStore.addSite(props.siteId, storedSiteUserConfig.value);
  showDialog.value = false;
}

function dialogEnter() {
  storedSiteUserConfig.value = {
    valid: false,
    ...(metadataStore.sites[props.siteId] ?? {}),
  };
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetSite.edit.title')"
    :width="800"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >


    <div class="editor-body">
      <Editor v-model="props.siteId" @update:form-valid="(v: boolean) => (isFormValid = v)" />
    </div>

    <template #footer>
      <a-button size="small" type="text" danger @click="showDialog = false">
        <template #icon>
          <CloseCircleOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
      </a-button>

      <a-button :disabled="!isFormValid" size="small" type="primary" @click="patchSite">
        <template #icon>
          <CheckCircleOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.ok") }}</span>
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.editor-body {
  max-height: 65vh;
  overflow-y: auto;
  padding-right: 8px;
}
</style>
