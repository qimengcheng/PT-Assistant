<script setup lang="ts">
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import {
  ClockCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  PauseCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@antdv-next/icons";

import { type CTorrent, CTorrentState } from "@ptd/downloader";

const { item } = defineProps<{
  item: CTorrent;
}>();

const { t } = useI18n();

// ── state chip display map ────────────────────────────────────────────────
// a-tag 的 color 只接受 antd 的预设色 / 状态色，没有 Vuetify 的 "grey"，
// 这里统一映射成 antd 的 "default"（灰底灰字），其余预设色同名保留。
type TTagColor = "default" | "blue" | "green" | "orange" | "cyan" | "red";

const stateDisplay: Record<CTorrentState, { color: TTagColor; icon: Component; label: string }> = {
  [CTorrentState.downloading]: {
    color: "blue",
    icon: DownloadOutlined,
    label: "MyClient.state.downloading",
  },
  [CTorrentState.seeding]: { color: "green", icon: UploadOutlined, label: "MyClient.state.seeding" },
  [CTorrentState.paused]: { color: "default", icon: PauseCircleOutlined, label: "MyClient.state.paused" },
  [CTorrentState.queued]: { color: "orange", icon: ClockCircleOutlined, label: "MyClient.state.queued" },
  [CTorrentState.checking]: { color: "cyan", icon: ReloadOutlined, label: "MyClient.state.checking" },
  [CTorrentState.error]: { color: "red", icon: CloseCircleOutlined, label: "MyClient.state.error" },
  [CTorrentState.unknown]: { color: "default", icon: QuestionCircleOutlined, label: "MyClient.state.unknown" },
};

const stateColor = computed<TTagColor>(() => stateDisplay[item.state]?.color ?? "default");
const stateIcon = computed<Component>(() => stateDisplay[item.state]?.icon ?? QuestionCircleOutlined);
const stateLabel = computed(() => t(stateDisplay[item.state]?.label ?? "MyClient.state.unknown"));
</script>

<template>
  <a-tag :color="stateColor" class="state-tag">
    <template #icon>
      <component :is="stateIcon" />
    </template>
    {{ stateLabel }}
  </a-tag>
</template>

<style scoped lang="scss">
/* 原 v-chip size="small" label，紧凑一点 */
.state-tag {
  font-size: 12px;
  line-height: 18px;
  margin-inline-end: 0;
}
</style>
