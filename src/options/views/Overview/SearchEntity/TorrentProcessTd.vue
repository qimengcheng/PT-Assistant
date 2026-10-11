<script setup lang="ts">
import { computed } from "vue";

import { torrentStatusMeta } from "./torrentStatusMeta.ts";
import { type ISearchResultTorrent } from "@/shared/types.ts";

const { torrent } = defineProps<{
  torrent: ISearchResultTorrent;
}>();

/**
 * 图标与颜色取自那份共用元数据（高级筛选对话框、搜索页那颗快速筛选读的是同一份）。
 *
 * 换掉的是一个 `default:` 也返回绿色上箭头的 switch：上箭头 = 「做种中」，也就是**认不出的值被画成
 * 一个明确的档位**。今天这一格还有一道 `Index.vue` 的 v-if 把 unknown 挡在外面，所以那半句在界面上
 * 看不出来；但搜索页新加的按档筛选里「未知」是一档能选的，画色不能再靠 default 兜到一个真档位上。
 */
const meta = computed(() => torrentStatusMeta(torrent.status));
</script>

<template>
  <!-- 图标定宽、进度条吃剩余宽度。
       原先是 a-row + :span="2" / :span="22" 的 24 格：这一列只有六十来像素宽，
       span 2 折出来不到 6px，14px 的箭头溢出压在进度条上，条子只剩 span 22 那点宽度 ——
       就是「箭头和进度条重叠了，而且进度条也太短了」。 -->
  <div class="process-row pt-1">
    <component :is="meta.icon" :style="{ color: meta.color }" class="process-icon" />
    <a-progress
      class="process-bar"
      :percent="torrent.progress!"
      :show-info="false"
      :stroke-color="meta.color"
      size="small"
    />
  </div>
</template>

<style scoped lang="scss">
.process-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.process-icon {
  flex: 0 0 auto;
  font-size: 12px;
}

.process-bar {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
</style>
