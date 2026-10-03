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
  <!--
    v-row/v-col 换成 a-row/a-col：a-row 用 :gutter="0" 取消列间距（对应原来的 gap="0"），
    align="middle" 让很矮的进度条与图标垂直居中（#1554）。
  -->
  <a-row :gutter="0" align="middle" class="pt-1">
    <a-col class="pa-0" :span="2">
      <component :is="icon" :style="{ color }" />
    </a-col>
    <a-col class="pl-1" :span="22">
      <a-progress :percent="torrent.progress!" :show-info="false" :stroke-color="color" size="small" />
    </a-col>
  </a-row>
</template>

<style scoped lang="scss"></style>
