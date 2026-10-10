<script setup lang="ts">
import { ref, computed, inject, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  CloudDownloadOutlined,
  CopyOutlined,
  DownloadOutlined,
  InboxOutlined,
  MinusCircleOutlined,
  SaveOutlined,
} from "@antdv-next/icons";
import { ETorrentStatus, type ITorrent } from "@ptd/site";
import type { TableColumnsType } from "antdv-next";

import { formatDate, formatSize } from "@/options/utils.ts";
import { countText } from "@/shared/torrentCount.ts";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import type { IRemoteDownloadDialogData } from "../types.ts";

import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";

const { t } = useI18n();

const showDialog = defineModel<boolean>();

// ============================================================================
// 表体高度：实测容器，不写视口常数
//
// ⚠️ 原先是 `:styles="{ body: { maxHeight: windowHeight - 256 } }"` 加
// `:scroll="{ y: windowHeight - 320 }"` 两处硬编码减数。外壳内衬一改就失准，
// 而且这两个数各减各的、彼此不对账（256 与 320 差 64 没人说得清是啥）。
// 改成量容器实高 − 表头，与 SearchEntity/Index.vue 同一套做法（那边把这条
// 公式错过三次，注释写清了四个减数都不能依赖 y）。
// ============================================================================
const tableWrapperRef = useTemplateRef<HTMLDivElement>("tableWrapper");
const tableScrollY = ref(320);

function recalcTableScrollY() {
  const el = tableWrapperRef.value;
  if (!el) return;

  const containerHeight = el.clientHeight;
  if (containerHeight <= 0) return;

  // 设了 scroll.y 后表头会被拆成独立一层，量它比量 thead 准
  const headerHeight =
    el.querySelector<HTMLElement>(".ant-table-header")?.getBoundingClientRect().height ??
    el.querySelector<HTMLElement>(".ant-table-thead")?.getBoundingClientRect().height ??
    0;

  const next = Math.max(containerHeight - headerHeight, 160);
  if (next !== tableScrollY.value) tableScrollY.value = next;
}

// ResizeObserver 在 observe 时会先投递一次观测，所以首帧那一量也归它管
let tableResizeObserver: ResizeObserver | null = null;
onMounted(() => {
  const el = tableWrapperRef.value;
  if (!el) return;
  tableResizeObserver = new ResizeObserver(() => nextTick(recalcTableScrollY));
  tableResizeObserver.observe(el);
});
onBeforeUnmount(() => tableResizeObserver?.disconnect());
// 结果集变化时分页器/表头高度会变，跟着重量一次
watch(
  () => torrentItems.length,
  () => nextTick(recalcTableScrollY),
);

const { torrentItems } = defineProps<{
  torrentItems: ITorrent[];
}>();

const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const tableHeaders = computed<TableColumnsType<ITorrent>>(
  () =>
    [
      { title: t("SearchEntity.index.table.category"), dataIndex: "category", key: "category", align: "center", width: 60 },
      // ⚠️ 标题列**不写 width**：一列都不写时表格是 auto 布局、写全是 fixed，
      // 而 fixed 下容器比列宽合计宽时浏览器会把所有列按比例放大，写了的宽度
      // 一个都不作数（最该宽的标题列被钉成定值）。留标题列吃剩余宽度。
      { title: t("SearchEntity.index.table.title"), dataIndex: "title", key: "title", align: "start" },
      { title: t("SearchEntity.index.table.size"), dataIndex: "size", key: "size", align: "end", width: 80 },
      { title: t("SearchEntity.index.table.seeders"), dataIndex: "seeders", key: "seeders", align: "end", width: 60 },
      { title: t("SearchEntity.index.table.leechers"), dataIndex: "leechers", key: "leechers", align: "end", width: 60 },
      { title: t("SearchEntity.index.table.completed"), dataIndex: "completed", key: "completed", align: "end", width: 60 },
      { title: t("SearchEntity.index.table.time"), dataIndex: "time", key: "time", align: "center", width: 90 },
    ] as TableColumnsType<ITorrent>,
);

const selectedTorrentIds = ref<ITorrent["id"][]>([]);
const selectedTorrents = computed(() => torrentItems.filter((x) => selectedTorrentIds.value.includes(x.id)));
const hasSelectedTorrent = computed(() => selectedTorrentIds.value.length > 0);
const selectedTorrentsCount = computed(() => selectedTorrentIds.value.length);
const selectedTorrentsSize = computed(() =>
  selectedTorrents.value.reduce((acc, torrent) => acc + (torrent.size ?? 0), 0),
);

const localDownloadMultiStatus = ref<boolean>(false);
async function handleLocalDownloadMulti() {
  localDownloadMultiStatus.value = true;
  try {
    // ⚠️ 逐条 catch 并汇总：原先串行 await 且只有外层一个 catch，
    // 第一个失败的种子就把整批中断（后面选中的再也下不到），提示还误用
    // 「页面解析失败」文案。参照 SiteListPage 的逐条处理。
    const results = await Promise.allSettled(
      selectedTorrents.value.map((torrent) =>
        sendMessage("downloadTorrent", { torrent, downloaderId: "local" }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected");
    for (const f of failed) {
      console.error("[PTD] download torrent failed", (f as PromiseRejectedResult).reason);
    }

    const total = results.length;
    const okCount = total - failed.length;
    if (okCount > 0) {
      runtimeStore.showSnakebar(
        t("contentScript.downloadMultiDone", { ok: okCount, total }),
        { color: failed.length > 0 ? "warning" : "success" },
      );
    } else if (total > 0) {
      runtimeStore.showSnakebar(t("contentScript.downloadMultiAllFailed", { total }), { color: "error" });
    }
  } finally {
    // 必须 finally：中途抛错时 localDownloadMultiStatus 会永远停在 true，按钮永久转圈
    localDownloadMultiStatus.value = false;
  }
}

const linkCopyMultiStatus = ref<boolean>(false);
async function handleLinkCopyMulti() {
  linkCopyMultiStatus.value = true;
  const downloadUrls = [] as string[];

  try {
    for (const torrent of selectedTorrents.value) {
      const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);
      downloadUrls.push(downloadUrl);
    }

    await navigator.clipboard.writeText(downloadUrls.join("\n").trim());
    runtimeStore.showSnakebar(t("contentScript.copyLinkSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("contentScript.copyLinkFailed"), { color: "error" });
  } finally {
    linkCopyMultiStatus.value = false;
  }
}

const remoteDownloadDialogData = inject<IRemoteDownloadDialogData>("remoteDownloadDialogData")!;

function handleRemoteDownloadMulti(isDefaultSend = false) {
  remoteDownloadDialogData.torrents = selectedTorrents.value;
  remoteDownloadDialogData.isDefaultSend = isDefaultSend;
  remoteDownloadDialogData.show = true;
}

function handleSelectSeeders() {
  selectedTorrentIds.value = torrentItems.filter((item) => item.seeders).map((x) => x.id);
}

function handleSelectNotSeeding() {
  selectedTorrentIds.value = torrentItems
    .filter(
      (item) =>
        item.status !== undefined && ![ETorrentStatus.seeding, ETorrentStatus.downloading].includes(item.status!),
    )
    .map((x) => x.id);
}

function enterDialog() {
  selectedTorrentIds.value = torrentItems.map((x) => x.id);
}

/** antd 的受控行选择：selectedRowKeys 与 v-data-table 的 v-model 等价 */
const rowSelection = computed(() => ({
  selectedRowKeys: selectedTorrentIds.value,
  onChange: (keys: (string | number)[]) => {
    selectedTorrentIds.value = keys as ITorrent["id"][];
  },
}));
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('contentScript.AdvanceListModuleDialog.title', [torrentItems.length])"
    :width="1200"
    :after-open-change="(open: boolean) => open && enterDialog()"
  >

    <div style="margin-bottom: 8px">
      <a-button type="primary" @click="handleSelectSeeders"><template #icon><InboxOutlined /></template><span>{{ t('contentScript.AdvanceListModuleDialog.selectSeeders') }}</span></a-button>
      <a-button type="primary" @click="handleSelectNotSeeding"><template #icon><MinusCircleOutlined /></template><span>{{ t('contentScript.AdvanceListModuleDialog.selectNotSeeding') }}</span></a-button>
    </div>

    <!-- 表格外层量高用：a-modal 的 body 是 flex 项（style.css 那五条把 body 收成
         flex: 1 1 auto; min-height: 0），这里再套一层 flex 容器把剩余高度交给表格 -->
    <div ref="tableWrapper" class="table-wrapper">
      <a-table
        bordered
        :columns="tableHeaders"
        :data-source="torrentItems"
        :row-key="(record: ITorrent) => record.id"
        :row-selection="rowSelection"
        :pagination="false"
        size="small"
        class="table-header-no-wrap"
        :scroll="{ y: tableScrollY }"
      >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <TorrentTitleTd :item="record" :show-social="false" />
        </template>

        <!-- 种子大小 -->
        <template v-else-if="column.key === 'size'">
          <span class="text-no-wrap">{{ formatSize(record.size ?? 0) }}</span>
        </template>

        <!-- 这三格原本直接打解析值：站点那一格里常混着自己的图标字符（详见 torrentCount.ts），
             于是同一列里有的行挂个小图标、有的不挂 -->
        <template v-else-if="column.key === 'seeders'">
          <span class="text-no-wrap">{{ countText(record.seeders) }}</span>
        </template>

        <template v-else-if="column.key === 'leechers'">
          <span class="text-no-wrap">{{ countText(record.leechers) }}</span>
        </template>

        <template v-else-if="column.key === 'completed'">
          <span class="text-no-wrap">{{ countText(record.completed) }}</span>
        </template>

        <template v-else-if="column.key === 'time'">
          <span class="text-no-wrap">
            {{ record.time ? formatDate(record.time) : "-" }}
          </span>
        </template>
      </template>
      </a-table>
    </div>

    <!-- 不设 :footer="null"：那会连 #footer slot 一起吞掉（antdv-next: footer: d !== null && ...） -->
    <template #footer>
      <div style="display: flex; align-items: center; gap: 8px">
        <span v-show="hasSelectedTorrent">
          {{
            t("contentScript.AdvanceListModuleDialog.selectedInfo", [
              selectedTorrentsCount,
              formatSize(selectedTorrentsSize),
            ])
          }}
        </span>

        <div style="flex: 1"></div>

        <a-button type="primary" :disabled="!hasSelectedTorrent" :loading="localDownloadMultiStatus" @click="handleLocalDownloadMulti"><template #icon><SaveOutlined /></template><span>{{ t('downloaderLabel.localDownload') }}</span></a-button>

        <a-button type="primary" :disabled="!hasSelectedTorrent" :loading="linkCopyMultiStatus" @click="handleLinkCopyMulti"><template #icon><CopyOutlined /></template><span>{{ t('contentScript.copyLink') }}</span></a-button>

        <a-button type="primary" :disabled="!hasSelectedTorrent" @click="() => handleRemoteDownloadMulti()"><template #icon><CloudDownloadOutlined /></template><span>{{ t('contentScript.pushTo') }}</span></a-button>

        <a-button type="primary" v-if="metadataStore.defaultDownloader?.id" :disabled="!hasSelectedTorrent" @click="() => handleRemoteDownloadMulti(true)"><template #icon><DownloadOutlined /></template><span>{{ t('contentScript.pushToDefault') }}</span></a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
/**
 * 表格外层：吃满 a-modal body 的剩余高度，供上面量表体高（scroll.y）。
 * min-height: 0 必须有 —— flex 项默认 min-height:auto，内容一高就不肯收缩，
 * 量出来的 clientHeight 会跟着内容长高，scroll.y 跟着一起长，永远不滚动。
 */
.table-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
</style>
