<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined } from "@antdv-next/icons";

import type { CTorrent } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const showDialog = defineModel<boolean>();
const { torrents, suggestLabels } = defineProps<{
  torrents: CTorrent[];
  suggestLabels?: string[];
}>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();

const labelInput = ref<string>("");

function dialogEnter() {
  // 初始化为当前种子的标签（如果有的话）
  const first = torrents[0];
  labelInput.value = first?.label ?? "";
}

async function confirmSetLabel() {
  const label = labelInput.value.trim();
  if (!label) {
    runtimeStore.showSnakebar(t("MyClient.label.emptyLabel"), { color: "warning" });
    return;
  }

  const results = await Promise.allSettled(
    torrents.map((torrent) =>
      sendMessage("setClientTorrentLabel", {
        downloaderId: torrent.clientId,
        id: torrent.id,
        label,
      }),
    ),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.label.success", { count: succeeded }), {
    color: succeeded > 0 ? "success" : "error",
  });
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.label.title', { count: torrents.length })"
    :width="480"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >

    <a-divider class="ma-0" />

    <!-- 原 v-combobox：可自由输入 + 下拉建议 -->
    <a-auto-complete
      v-model:value="labelInput"
      :options="suggestLabels ?? []"
      allow-clear
      :placeholder="t('MyClient.label.input')"
      class="my-2"
    />

    <a-divider class="ma-0" />

    <template #footer>
      <div class="dialog-footer">
        <div style="flex: 1" />
        <a-button color="blue" variant="text" icon-placement="start" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </a-button>
        <a-button color="green" variant="text" icon-placement="start" @click="confirmSetLabel">
          <template #icon>
            <CheckCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.ok") }}</span>
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
/* 标题栏右侧的关闭按钮（原来放在 v-toolbar 的 #append 上，antd 标题插槽需自行排版） */
.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
