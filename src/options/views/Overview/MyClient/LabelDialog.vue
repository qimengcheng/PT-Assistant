<script setup lang="ts">
import { computed, h, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined } from "@antdv-next/icons";

import type { CTorrent } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const showDialog = defineModel<boolean>();
const { torrents, suggestLabels } = defineProps<{
  torrents: CTorrent[];
  suggestLabels?: string[];
}>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();

const labelInput = ref<string>("");

/** 上面那格当前的值 —— chip 的高亮档按它判（比 trim 后的，输入框里带空格不算换了标签） */
const picked = computed(() => labelInput.value.trim());

/**
 * `a-auto-complete` 的 options 要的是 `{ value, label }[]`：直接喂 `string[]` 会把整个控件
 * 渲染成空的（AGENTS.md §3.4 记的那条，辅种检测那颗标签框同一个坑）。这一份同时喂下拉和 chip。
 */
const labelOptions = computed(() => (suggestLabels ?? []).map((value) => ({ value, label: value })));

function dialogEnter() {
  // 初始化为当前种子的标签（如果有的话）
  const first = torrents[0];
  labelInput.value = first?.label ?? "";
}

async function confirmSetLabel() {
  const label = labelInput.value.trim();
  if (!label) {
    runtimeStore.showSnakebar(t("MyClient.label.emptyLabel"), { color: "warning" });
    return;
  }

  const results = await Promise.allSettled(
    torrents.map((torrent) =>
      sendMessage("setClientTorrentLabel", {
        downloaderId: torrent.clientId,
        id: torrent.id,
        label,
      }),
    ),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.label.success", { count: succeeded }), {
    color: succeeded > 0 ? "success" : "error",
  });
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.label.title', { count: torrents.length })"
    :width="480"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :ok-button-props="{ color: 'green', variant: 'text', iconPlacement: 'start', icon: h(CheckCircleOutlined) }"
    :cancel-button-props="{ color: 'blue', variant: 'text', iconPlacement: 'start', icon: h(CloseCircleOutlined) }"
    :after-open-change="(open: boolean) => open && dialogEnter()"
    @ok="confirmSetLabel"
  >

    <a-divider class="ma-0" />

    <!-- 原 v-combobox：可自由输入 + 下拉建议。
         宽度必须写行内 style：a-auto-complete 本体是 Select，不给就缩到内容宽
         （台架实测 57.6px，截图上那个小框就是它），而 scoped class 打不进它的根。 -->
    <a-auto-complete
      v-model:value="labelInput"
      :options="labelOptions"
      allow-clear
      :placeholder="t('MyClient.label.input')"
      class="my-2"
      style="width: 100%"
    />

    <!-- 已有的标签摆成一排，点一下就填进上面那格（用户 2026-10-13）。
         再点已选中的那颗不撤销：这一格留空等于「不设置」，confirm 本来就要拦它。
         条数多就让弹窗自己滚，这里不再套第二层滚动区。 -->
    <div v-if="labelOptions.length > 0" class="label-chips">
      <span class="label-chips__title">{{ t("MyClient.label.existing") }}</span>
      <a-checkable-tag
        v-for="item in labelOptions"
        :key="item.value"
        :checked="item.value === picked"
        @change="() => (labelInput = item.value)"
      >
        {{ item.value }}
      </a-checkable-tag>
    </div>

    <a-divider class="ma-0" />
  </a-modal>
</template>

<style scoped lang="scss">
.label-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* antd 的 tag 自带 margin-inline-end: 8px，与上面的 gap 会叠成 16px */
.label-chips :deep(.ant-tag) {
  margin-inline-end: 0;
}

.label-chips__title {
  font-size: 12px;
  color: var(--pt-color-text-secondary);
}
</style>
