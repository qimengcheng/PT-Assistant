<script setup lang="ts">
import { computed } from "vue";
import { ETorrentStatus } from "@ptd/site";
import { ArrowDownOutlined, ArrowUpOutlined, CheckOutlined, DisconnectOutlined } from "@antdv-next/icons";

import { type ISearchResultTorrent } from "@/shared/types.ts";

const { torrent } = defineProps<{
  torrent: ISearchResultTorrent;
}>();

/**
 * antd 的图标是组件而不是 mdi 字符串，所以这里返回组件本身，
 * 交给 <component :is> 渲染。
 */
const icon = computed(() => {
  switch (torrent.status) {
    case ETorrentStatus.downloading:
      return ArrowDownOutlined;

    case ETorrentStatus.completed:
      return CheckOutlined;

    case ETorrentStatus.inactive:
      return DisconnectOutlined;

    case ETorrentStatus.seeding:
    default:
      return ArrowUpOutlined;
  }
});

/**
 * 原来返回的是 Vuetify 的语义色名（info / grey / success），
 * antd 的 stroke-color 与图标颜色都要真实色值，故在此映射。
 */
const color = computed(() => {
  switch (torrent.status) {
    case ETorrentStatus.downloading:
      return "#1677ff"; // info

    case ETorrentStatus.completed:
    case ETorrentStatus.inactive:
      return "#8c8c8c"; // grey

    case ETorrentStatus.seeding:
    default:
      return "#52c41a"; // success
  }
});
</script>

<template>
  <!-- 图标定宽、进度条吃剩余宽度。
       原先是 a-row + :span="2" / :span="22" 的 24 格：这一列只有六十来像素宽，
       span 2 折出来不到 6px，14px 的箭头溢出压在进度条上，条子只剩 span 22 那点宽度 ——
       就是「箭头和进度条重叠了，而且进度条也太短了」。 -->
  <div class="process-row pt-1">
    <component :is="icon" :style="{ color }" class="process-icon" />
    <a-progress
      class="process-bar"
      :percent="torrent.progress!"
      :show-info="false"
      :stroke-color="color"
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
