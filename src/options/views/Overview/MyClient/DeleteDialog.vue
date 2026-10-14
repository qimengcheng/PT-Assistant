<script setup lang="ts">
/**
 * 批量删除确认框：通用的 `components/DeleteDialog.vue` 只说「删除 N 项」，
 * 这里补上两件事 —— 列出到底是哪几条（一次点掉几十行时人得能核对），
 * 以及「同时删除文件」那个勾选对哪台下载器其实不起作用。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { CTorrent } from "@ptd/downloader";

import BaseDeleteDialog from "@/options/components/DeleteDialog.vue";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { formatDate, formatSize } from "@/options/utils.ts";

const showDialog = defineModel<boolean>();
const props = defineProps<{
  toDeleteIds: string[];
  /** 与 toDeleteIds 同一批（父组件那边就是由它算出 ids 的），这里只为把名字显示出来 */
  torrents: CTorrent[];
  confirmDelete: (toDeleteId: string, removeData: boolean) => Promise<void> | void;
  /**
   * 每一条前面挂勾选框，**勾了的那几条**才删。
   *
   * 给「行内那颗删除键」用：那一条属于同内容组时，父组件把整组端过来（折叠态下组员根本不在
   * 列表里），但他点的是其中一条 —— 所以默认全勾之外必须能取消，否则「只删这一条」就没有入口了。
   * 批量那条路（工具条）不传，行为与以前一字不差。
   */
  selectable?: boolean;
}>();
const emits = defineEmits<{
  (e: "allDelete"): void;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const removeData = ref(false);

/** 勾了的那几条才删。开弹窗时整组默认全勾（他要的是「一起删」），取消勾选就是「只删这一条」 */
const checkedKeys = ref<Set<string>>(new Set());

watch(showDialog, (val) => {
  if (!val) return;
  removeData.value = false;
  checkedKeys.value = new Set(props.toDeleteIds);
});

function toggleRow(key: string, on: boolean) {
  // Set 原地改不会触发重渲染，所以每次都换一个新 Set
  const next = new Set(checkedKeys.value);
  if (on) next.add(key);
  else next.delete(key);
  checkedKeys.value = next;
}

function wrappedConfirmDelete(id: string) {
  return props.confirmDelete(id, removeData.value);
}

const clientNameOf = (clientId: string) => metadataStore.downloaders[clientId]?.name ?? clientId;

/**
 * 群晖那条接口只调 `SYNO.DownloadStation2.Task` 的 delete，**根本不读 removeData**
 * （`packages/downloader/entity/synologyDownloadStation.ts:759-770`）——
 * 对它来说这个勾上和没勾是同一件事，所以那句「同时删除文件」是句空话，得说明白。
 */
const ignoredRemoveDataCount = computed(
  () => props.torrents.filter((t) => metadataStore.downloaders[t.clientId]?.type === "synologyDownloadStation").length,
);

const rows = computed(() =>
  props.torrents.map((t) => ({
    key: `${t.clientId}:${String(t.id)}`,
    name: t.name,
    client: clientNameOf(t.clientId),
    size: formatSize(t.totalSize),
    // 同内容的那几条名称 / 下载器 / 大小 / 保存路径四项全等（内容指纹就是这四项），
    // 能分辨的只剩添加时间，所以这一行必须把它带上 —— 否则六行一字不差，勾哪个看不出来。
    savePath: t.savePath,
    addedAt: t.dateAdded ? formatDate(t.dateAdded * 1000, "yyyy-MM-dd HH:mm") : "",
  })),
);

/** 实际要删的那几条：不可选时就是全部 */
const activeIds = computed(() =>
  props.selectable ? props.toDeleteIds.filter((id) => checkedKeys.value.has(id)) : props.toDeleteIds,
);
</script>

<template>
  <BaseDeleteDialog
    v-model="showDialog"
    :to-delete-ids="activeIds"
    :confirm-delete="wrappedConfirmDelete"
    :width="560"
    :ok-disabled="selectable && activeIds.length === 0"
    @all-delete="emits('allDelete')"
  >
    <template #append-text>
      <!-- 名字整行铺开、允许换行：这是确认框，不是列表页。截断 + 悬停在这里帮不上忙，
           人就是要一眼看清到底删的是哪几条。 -->
      <div class="delete-list-title">{{ t("MyClient.dialog.deletingList") }}</div>
      <div v-if="selectable" class="delete-list-hint">{{ t("MyClient.dialog.pickRows") }}</div>
      <div class="delete-list">
        <div v-for="row in rows" :key="row.key" class="delete-list-row">
          <label class="delete-list-pick" :class="{ 'delete-list-pick--hand': selectable }">
            <a-checkbox
              v-if="selectable"
              :checked="checkedKeys.has(row.key)"
              @update:checked="(on: boolean) => toggleRow(row.key, on)"
            />
            <span class="delete-list-name">{{ row.name }}</span>
          </label>
          <div class="delete-list-meta">
            {{ row.client }} · {{ row.size }} · {{ row.savePath }}<template v-if="row.addedAt"> · {{ row.addedAt }}</template>
          </div>
        </div>
      </div>

      <div v-if="ignoredRemoveDataCount > 0" class="delete-note">
        {{ t("MyClient.dialog.removeDataIgnored", { count: ignoredRemoveDataCount }) }}
      </div>

      <!-- 原 v-checkbox color="error" density="compact" hide-details。
           a-checkbox 没有 danger/color 这类属性（dist/checkbox 里搜不到 danger），
           原先写的 danger 是死属性，已删；要红色文案得自己加 class。 -->
      <a-checkbox v-model:checked="removeData" class="ml-2">
        {{ t("MyClient.dialog.removeData") }}
      </a-checkbox>
    </template>
  </BaseDeleteDialog>
</template>

<style scoped lang="scss">
// 通用那一份默认 340，这里传 560：340 下内容只有 292px，一条标题要吃 3~4 行，
// 220px 的列表区一次只露出 2.7 行（8 条实量：行高 64/83/64/64/83/64/64/82），几十条时根本核对不了。
// 560 下一条 1~2 行，列表区因此按视口给（45vh），不再写 220 这种死数 ——
// 几十条一起删时这块必须自己滚，不然会把确认按钮顶出视口。滚动条样式全站已有一条，这里不再逐页写。
.delete-list {
  max-height: 45vh;
  margin-top: 4px;
  overflow-y: auto;
}

.delete-list-title {
  margin-top: 8px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.delete-list-hint {
  margin-top: 2px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

/* 勾选框与名字排成一排：checkbox 是 inline-block，靠 flex 才与多行标题的顶边对齐 */
.delete-list-pick {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.delete-list-pick--hand {
  cursor: pointer;
}

.delete-list-row {
  padding: 4px 0;
  border-bottom: 1px solid rgba(5, 5, 5, 0.06);

  &:last-child {
    border-bottom: none;
  }
}

.delete-list-name {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.delete-list-meta {
  color: rgba(0, 0, 0, 0.45);
  font-size: 11px;
}

// 群晖那条说明要紧（它让那个勾选失去意义），所以给一点底色而不是普通灰字
.delete-note {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(250, 173, 20, 0.12);
  color: rgba(0, 0, 0, 0.75);
  font-size: 12px;
}
</style>
