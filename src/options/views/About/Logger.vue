<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { FileSearchOutlined } from "@antdv-next/icons";
import type { TableColumnsType } from "antdv-next";

import { sendMessage } from "@/messages.ts";
import { ILoggerItem } from "@/shared/types.ts";
import { formatDate } from "@/options/utils.ts";

const { t } = useI18n();
const logger = shallowRef<ILoggerItem[]>([]);

const columns: TableColumnsType<ILoggerItem> = [
  { title: "ID", dataIndex: "id", key: "id", width: 150 },
  {
    title: "Time",
    dataIndex: "time",
    key: "time",
    width: 170,
    defaultSortOrder: "descend",
    sorter: (a, b) => (a.time ?? 0) - (b.time ?? 0),
  },
  { title: "Message", dataIndex: "msg", key: "msg", ellipsis: true },
  { title: t("common.action"), key: "action", width: 100, align: "center" },
];

const showLogDataDialog = ref<boolean>(false);
const logData = ref<ILoggerItem | null>(null);

function showLogDataDialogHandler(item: ILoggerItem) {
  logData.value = item;
  showLogDataDialog.value = true;
}

function loadLogger() {
  sendMessage("getLogger", undefined).then((res) => {
    logger.value = res;
  });
}

// 原实现只在 onMounted 里 setInterval、从不 clearInterval：离开本页后仍每秒发一次消息，
// 反复进入还会叠加多个定时器。这里改成配对清理。
let pollTimer: number | undefined;

onMounted(() => {
  loadLogger();
  pollTimer = setInterval(loadLogger, 1000) as unknown as number;
});

onUnmounted(() => {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
});
</script>

<template>
  <a-alert class="mb-2" type="info" show-icon :message="t('route.About.Logger')" />

  <a-table
    :columns="columns"
    :data-source="logger"
    :pagination="{ pageSize: 50, showSizeChanger: true, size: 'small' }"
    row-key="id"
    size="small"
    :scroll="{ y: 'calc(100vh - 220px)' }"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'id'">
        <code class="text-no-wrap">{{ record.id }}</code>
      </template>

      <template v-else-if="column.key === 'time'">
        <span class="text-no-wrap">{{ formatDate(record.time ?? 0) }}</span>
      </template>

      <template v-else-if="column.key === 'action'">
        <a-tooltip :title="t('Logger.action.details')">
          <a-button
            size="small"
            type="text"
            :disabled="typeof record.data === 'undefined'"
            @click="showLogDataDialogHandler(record)"
          >
            <template #icon>
              <FileSearchOutlined />
            </template>
          </a-button>
        </a-tooltip>
      </template>
    </template>
  </a-table>

  <a-modal v-model:open="showLogDataDialog" :width="800" :footer="null">
    <template #title>{{ t("Logger.action.details") }}</template>
    <pre class="log-json">{{ JSON.stringify(logData, null, 2) }}</pre>
  </a-modal>
</template>

<style scoped lang="scss">
.log-json {
  max-height: 60vh;
  overflow: auto;
  font-size: 12px;
}
</style>
