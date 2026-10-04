<script setup lang="ts">
import { h, ref } from "vue";
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
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :ok-button-props="{ color: 'green', variant: 'text', iconPlacement: 'start', icon: h(CheckCircleOutlined) }"
    :cancel-button-props="{ color: 'blue', variant: 'text', iconPlacement: 'start', icon: h(CloseCircleOutlined) }"
    @ok="confirmSetLabel"
    :after-open-change="(open: boolean) => open && dialogEnter()"
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
  </a-modal>
</template>

<style scoped lang="scss"></style>
