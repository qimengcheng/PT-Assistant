<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { FileSearchOutlined } from "@antdv-next/icons";
import type { TableColumnsType, TablePaginationConfig } from "antdv-next";
import { message } from "antdv-next";

import { sendMessage } from "@/messages.ts";
import { type ILoggerItem } from "@/shared/types.ts";
import { formatDate } from "@/options/utils.ts";

const { t } = useI18n();
const logger = shallowRef<ILoggerItem[]>([]);

// computed：标签里有 t()，setup 里一次性求值的话切语言不会重算
const columns = computed<TableColumnsType<ILoggerItem>>(() => [
  /**
   * 原来第一列是 21 位 nanoid 的日志 id（用户报「id 和时间列重叠」，于是加宽到 190）。
   * 但那串 id 用户既读不懂也没法用，而「详细信息」弹窗里 JSON.stringify(logData)
   * 本来就带着 id —— 表格这列是重复的内部标识，按 AGENTS.md §3.5 撤掉。
   * row-key 仍用 id（rc-table 只要 key 存在即可，不要求有对应列）。
   */
  {
    title: t("Logger.table.time"),
    dataIndex: "time",
    key: "time",
    width: 170,
    defaultSortOrder: "descend",
    sorter: (a, b) => (a.time ?? 0) - (b.time ?? 0),
  },
  { title: t("Logger.table.message"), dataIndex: "msg", key: "msg", ellipsis: true },
  { title: t("common.action"), key: "action", width: 100, align: "center" },
]);

const showLogDataDialog = ref<boolean>(false);
const logData = ref<ILoggerItem | null>(null);

function showLogDataDialogHandler(item: ILoggerItem) {
  logData.value = item;
  showLogDataDialog.value = true;
}

/**
 * 只有首屏那一次才配给 :loading。
 *
 * 每秒轮询也翻这个标志的话，a-table 会把整张表包进 Spin：spin 样式的
 * `&-spinning .ant-spin-container` 是 `opacity: .5` + `pointer-events: none`，
 * 还带 0.3s 的 opacity 过渡（dist/spin/style/index.js）。于是每秒整表暗一下再亮一下、
 * 期间表格点不动 —— 用户看到的「一直在闪」是这一条，不是日志产生得太快。
 */
const isLoadingLogger = ref<boolean>(false);
let hasLoadedOnce = false;

/** 一页放得下就不出分页条（用户 2026-10-07：条数少的时候不要启用分页）。本页不分档、固定 50 条 */
const tablePagination = computed<TablePaginationConfig | false>(() =>
  logger.value.length <= 50 ? false : { pageSize: 50, showSizeChanger: true, size: "small" },
);

/**
 * 这一轮和上一轮是不是同一批日志。
 *
 * 日志 id 由 logger() 生成的 nanoid，唯一且不会再改；环形缓冲满 500 条时只从头裁剪，
 * 所以「条数相同 + 最后一条同 id 同时间」就等于整批没变。
 */
function isSameLogBatch(prev: ILoggerItem[], next: ILoggerItem[]) {
  if (prev.length !== next.length) {
    return false;
  }
  const lastPrev = prev[prev.length - 1];
  const lastNext = next[next.length - 1];
  return lastPrev === undefined || (lastPrev.id === lastNext?.id && lastPrev.time === lastNext?.time);
}

/**
 * 失败提示只给一次。⚠️ 这条闸不能省：这个 catch 在**每秒轮询**的路径上，
 * 而「列表还是空的」在下一次成功之前恒成立 —— 不设闸就是每秒弹一条 error toast，
 * 界面被自己的提示淹没（原写法就是这么坏的）。成功后复位，所以下次真的坏了还会说一次。
 */
let loadFailureNotified = false;

function loadLogger() {
  // ⚠️ hasLoadedOnce 必须在**请求之前**置位，不能只在 then 里。
  // a-table 的 loading 是整表套一层 Spin（opacity .5 + pointer-events:none），
  // 而这个页面每秒轮询一次 —— 首屏那一次失败（offscreen 还没起来）时，
  // hasLoadedOnce 一直是 false，于是之后每秒都把整表罩住又放开，
  // 正是该文件注释里自称「已消灭」的闪烁在失败路径上复活。
  if (!hasLoadedOnce) {
    isLoadingLogger.value = true;
    hasLoadedOnce = true;
  }
  sendMessage("getLogger", undefined)
    .then((res) => {
      loadFailureNotified = false;
      // 没新日志就别换引用：换一次就是整表（含排序、50 行渲染）重新 diff 一遍，每秒白做。
      if (!isSameLogBatch(logger.value, res)) {
        logger.value = res;
      }
    })
    .catch((e) => {
      // 首屏失败要给一句话，不能静默 —— 否则界面停在「没有日志」且没人知道为什么
      if (logger.value.length === 0 && !loadFailureNotified) {
        loadFailureNotified = true;
        message.error(t("Logger.loadFailed"));
      }
      console.error("[PTD] load logger failed", e);
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
  pollTimer = setInterval(
    () => {
      // 标签页在后台时不做这次整包传输（一次最多 500 条，且每条可能带 data 负载）
      if (document.hidden) {
        return;
      }
      loadLogger();
    },
    1000,
  ) as unknown as number;
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
          <template v-if="column.key === 'time'">
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
