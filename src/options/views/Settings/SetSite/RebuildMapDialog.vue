<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CloseCircleOutlined, ImportOutlined } from "@antdv-next/icons";
import { message } from "antdv-next";

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

  // 这三步都是重操作（遍历 300+ 站点定义、逐个读元数据）
  if (rebuilding.value) return;
  rebuilding.value = true;
  try {
    if (reBuildControlRef.value.rebuildSiteHostMap) {
      await metadataStore.buildSiteHostMap();
    }

    if (reBuildControlRef.value.rebuildSiteNameMap) {
      await metadataStore.buildSiteNameMap();
    }

    await metadataStore.$save();
    showDialog.value = false;
  } catch (e) {
    // 原先三步都没有 try/catch：任一步抛错，弹窗既不关也没有提示，
    // 用户只看到「点了没反应」，无法判断到底有没有生效。
    message.error(t("SetSite.ReBuildMapDialog.failed"));
    console.error("[SetSite] rebuild map failed", e);
  } finally {
    rebuilding.value = false;
  }
}

const canReBuild = computed<boolean>(() => Object.values(reBuildControlRef.value).some(Boolean));
const rebuilding = ref(false);
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetSite.ReBuildMapDialog.title')"
    :width="600"
    :after-open-change="(open: boolean) => open && resetReBuildControlRef()"
  >

    <!-- component="label"：a-flex 渲染成 <label> 而不是 <div>，
         保留「点文字也能拨动开关」——label 内的 labelable 元素（a-switch 的 button）
         会被浏览器转发点击。布局交给组件，只留内边距和光标两条手写样式。 -->
    <a-flex component="label" align="center" gap="small" class="switch-row">
      <a-switch v-model:checked="reBuildControlRef.rebuildSiteHostMap" size="small" />
      <span>{{ t("SetSite.ReBuildMapDialog.rebuildSiteHostMap") }}</span>
    </a-flex>

    <a-flex component="label" align="center" gap="small" class="switch-row">
      <a-switch v-model:checked="reBuildControlRef.rebuildSiteNameMap" size="small" />
      <span>{{ t("SetSite.ReBuildMapDialog.rebuildSiteNameMap") }}</span>
    </a-flex>

    <template #footer>
      <a-button size="small" type="text" danger @click="showDialog = false">
        <template #icon>
          <CloseCircleOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
      </a-button>

      <a-button :disabled="!canReBuild" :loading="rebuilding" size="small" type="primary" @click="doReBuild">
        <template #icon>
          <ImportOutlined />
        </template>
        <span class="ml-1">{{ t("SetSite.ReBuildMapDialog.doRebuildBtn") }}</span>
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
/* 布局已在 a-flex 上，只剩内边距与手型光标 */
.switch-row {
  padding: 8px 0;
  cursor: pointer;
}
</style>
