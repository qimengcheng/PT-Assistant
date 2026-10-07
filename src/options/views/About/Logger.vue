<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { FileSearchOutlined } from "@antdv-next/icons";
import type { TableColumnsType, TablePaginationConfig } from "antdv-next";

import { sendMessage } from "@/messages.ts";
import { type ILoggerItem } from "@/shared/types.ts";
import { formatDate } from "@/options/utils.ts";

const { t } = useI18n();
const logger = shallowRef<ILoggerItem[]>([]);

// computed：标签里有 t()，setup 里一次性求值的话切语言不会重算
const columns = computed<TableColumnsType<ILoggerItem>>(() => [
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
]);

const showLogDataDialog = ref<boolean>(false);
const logData = ref<ILoggerItem | null>(null);

function showLogDataDialogHandler(item: ILoggerItem) {
  logData.value = item;
  showLogDataDialog.value = true;
}

/** 后台消息在途标志：给 a-table 的 :loading 用。没它的话每秒轮询的那一瞬间表格会闪一下空态 */
const isLoadingLogger = ref<boolean>(false);

/** 一页放得下就不出分页条（用户 2026-10-07：条数少的时候不要启用分页）。本页不分档、固定 50 条 */
const tablePagination = computed<TablePaginationConfig | false>(() =>
  logger.value.length <= 50 ? false : { pageSize: 50, showSizeChanger: true, size: "small" },
);

function loadLogger() {
  isLoadingLogger.value = true;
  sendMessage("getLogger", undefined)
    .then((res) => {
      logger.value = res;
    })
    .finally(() => {
      isLoadingLogger.value = false;
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
  <!-- 原来 a-table 直接是根，白面高度=表头+行数，下面一整片是灰底。
       这页没有工具条，所以不用两行制的 .page 骨架（那会多出一条 48px 空白面板），
       改用 .page-fill + 一块吃满高度的 .page-panel。
       顺带去掉 :scroll="{ y: 'calc(100vh - 220px)' }" —— 面板本身就是滚动容器，
       再给表体钉一个目测常数等于两层滚动互相抢；代价是表头不再吸顶。 -->
  <div class="page-fill">
    <div class="page-panel page-fill-grow">
      <a-table
        bordered
        :columns="columns"
        :data-source="logger"
        :loading="isLoadingLogger"
        :pagination="tablePagination"
        row-key="id"
        size="small"
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
    </div>
  </div>

  <a-modal v-model:open="showLogDataDialog" :title="t('Logger.action.details')" :width="800" :footer="null">
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
