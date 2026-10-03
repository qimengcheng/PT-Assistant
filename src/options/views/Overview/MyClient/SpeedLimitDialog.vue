<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined, CloseOutlined } from "@antdv-next/icons";

import type { CTorrent, TorrentSpeedLimit } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const showDialog = defineModel<boolean>();
const { torrents } = defineProps<{
  torrents: CTorrent[];
}>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();

const uploadLimit = ref<number | null>(null);
const downloadLimit = ref<number | null>(null);

function dialogEnter() {
  // 初始化为当前种子的限速（qBittorrent raw 中有 up_limit/dl_limit 字段，其他客户端留空）
  const first = torrents[0];
  const raw = first?.raw as Record<string, any> | undefined;
  uploadLimit.value = typeof raw?.up_limit === "number" ? Math.round(raw.up_limit / 1024) : null;
  downloadLimit.value = typeof raw?.dl_limit === "number" ? Math.round(raw.dl_limit / 1024) : null;
}

async function confirmSetLimit() {
  const limits: TorrentSpeedLimit = {};
  if (uploadLimit.value !== null) limits.upload = uploadLimit.value;
  if (downloadLimit.value !== null) limits.download = downloadLimit.value;
  if (Object.keys(limits).length === 0) {
    runtimeStore.showSnakebar(t("MyClient.speedLimit.emptyLimit"), { color: "warning" });
    return;
  }

  const results = await Promise.allSettled(
    torrents.map((torrent) =>
      sendMessage("setClientTorrentSpeedLimit", {
        downloaderId: torrent.clientId,
        id: torrent.id,
        limits,
      }),
    ),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.speedLimit.success", { count: succeeded }), {
    color: succeeded > 0 ? "success" : "error",
  });
  showDialog.value = false;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :width="480" @after-open-change="(open: boolean) => open && dialogEnter()">
    <template #title>
      <div class="dialog-title">
        <span>{{ t("MyClient.speedLimit.title", { count: torrents.length }) }}</span>
        <a-button type="text" size="small" :title="t('common.dialog.close')" @click="showDialog = false">
          <template #icon>
            <CloseOutlined />
          </template>
        </a-button>
      </div>
    </template>

    <a-divider class="ma-0" />

    <!-- a-alert 不渲染默认插槽，正文必须放 #message -->
    <a-alert type="info" variant="outlined" class="my-3">
      <template #message>{{ t("MyClient.speedLimit.unitNote") }}</template>
    </a-alert>

    <div class="field-row">
      <span class="field-label">{{ t("MyClient.speedLimit.upload") }}</span>
      <!-- 原 v-text-field type="number" v-model.number clearable：清空后同样是 null -->
      <a-input-number v-model:value="uploadLimit" :min="0" :step="1" class="flex-1-1-0" />
    </div>

    <div class="field-row">
      <span class="field-label">{{ t("MyClient.speedLimit.download") }}</span>
      <a-input-number v-model:value="downloadLimit" :min="0" :step="1" class="flex-1-1-0" />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div style="flex: 1" />
        <a-button color="blue" variant="text" icon-placement="start" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </a-button>
        <a-button color="green" variant="text" icon-placement="start" @click="confirmSetLimit">
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
.dialog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.field-label {
  flex: none;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
