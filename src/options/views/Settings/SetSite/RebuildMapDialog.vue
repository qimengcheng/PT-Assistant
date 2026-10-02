<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { CloseCircleOutlined, ImportOutlined } from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useResetableRef } from "@/options/directives/useResetableRef.ts";

const showDialog = defineModel<boolean>();

const { t } = useI18n();

const { ref: reBuildControlRef, reset: resetReBuildControlRef } = useResetableRef(() => ({
  rebuildSiteHostMap: true,
  rebuildSiteNameMap: false,
}));

async function doReBuild() {
  const metadataStore = useMetadataStore();

  if (reBuildControlRef.value.rebuildSiteHostMap) {
    await metadataStore.buildSiteHostMap();
  }

  if (reBuildControlRef.value.rebuildSiteNameMap) {
    await metadataStore.buildSiteNameMap();
  }

  await metadataStore.$save();
  showDialog.value = false;
}

const canReBuild = computed<boolean>(() => Object.values(reBuildControlRef.value).some(Boolean));
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :width="600"
    @after-open-change="(open: boolean) => open && resetReBuildControlRef()"
  >
    <template #title>{{ t("SetSite.ReBuildMapDialog.title") }}</template>

    <label class="switch-row">
      <a-switch v-model:checked="reBuildControlRef.rebuildSiteHostMap" size="small" />
      <span>{{ t("SetSite.ReBuildMapDialog.rebuildSiteHostMap") }}</span>
    </label>

    <label class="switch-row">
      <a-switch v-model:checked="reBuildControlRef.rebuildSiteNameMap" size="small" />
      <span>{{ t("SetSite.ReBuildMapDialog.rebuildSiteNameMap") }}</span>
    </label>

    <template #footer>
      <a-button size="small" type="text" danger @click="showDialog = false">
        <template #icon>
          <CloseCircleOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
      </a-button>

      <a-button :disabled="!canReBuild" size="small" type="primary" @click="doReBuild">
        <template #icon>
          <ImportOutlined />
        </template>
        <span class="ml-1">{{ t("SetSite.ReBuildMapDialog.doRebuildBtn") }}</span>
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  cursor: pointer;
}
</style>
