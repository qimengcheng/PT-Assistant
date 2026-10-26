<script setup lang="ts">
import { computed, h, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined } from "@zboson/icons";

import type { CTorrent } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

/** 要补的那一条：哪台下载器、哪个种子、打什么标签（判据在 `@/shared/torrentAutoTag`） */
interface IAutoTagAdd {
  downloaderId: string;
  id: CTorrent["id"];
  tag: string;
}

const showDialog = defineModel<boolean>();
const { torrents, suggestLabels, autoTagAdds, autoTagSkipped, autoTagScope } = defineProps<{
  /** 勾选的那几条（分类那一档只吃这个；自动那一档的范围由页面算好） */
  torrents: CTorrent[];
  suggestLabels?: string[];
  /** 自动那一档的成品清单，页面按「没勾选就用当前下载器全部行」算好传进来 */
  autoTagAdds: IAutoTagAdd[];
  /** 两档各多少条，界面分开报（并成「N 条没动」就看不出是哪种没动） */
  autoTagSkipped: { hasTags: number; noSite: number };
  /** 自动那一档这次扫过了多少条，给上面那句范围用 */
  autoTagScope: number;
}>();
const emit = defineEmits<{ (e: "done"): void }>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();

const labelInput = ref<string>("");
const busy = ref(false);

/** 两档：自动补标签是默认那一档（用户 2026-10-19 要的就是这个），手填那一档保留原行为 */
const mode = ref<"auto" | "category">("auto");

/** 上面那格当前的值 —— chip 的高亮档按它判（比 trim 后的，输入框里带空格不算换了标签） */
const picked = computed(() => labelInput.value.trim());

/**
 * `a-auto-complete` 的 options 要的是 `{ value, label }[]`：直接喂 `string[]` 会把整个控件
 * 渲染成空的（AGENTS.md §3.4 记的那条，辅种检测那颗标签框同一个坑）。这一份同时喂下拉和 chip。
 */
const labelOptions = computed(() => (suggestLabels ?? []).map((value) => ({ value, label: value })));

/**
 * 确定键：自动那一档在「一条都补不了」时按下去没有可发的请求，所以置灰。
 * 灰了要说为什么 —— disabled 的元素不收鼠标事件，浮层是画不出来的，因此那句
 * 「这一批里没有可补的种子」摆在按钮上方当可见文字（v0.109.1 那条同一课）。
 */
const okButtonProps = computed(() => ({
  color: "green",
  variant: "text",
  iconPlacement: "start",
  icon: h(CheckCircleOutlined),
  disabled: mode.value === "auto" && autoTagAdds.length === 0,
}));

function dialogEnter() {
  // 初始化为当前种子的分类（如果有的话）
  const first = torrents[0];
  labelInput.value = first?.label ?? "";
}

/** 自动那一档：逐条发。false = 那台客户端没有「追加标签」这个能力，与请求失败分开报数 */
async function confirmAutoTag() {
  busy.value = true;
  let added = 0;
  let unsupported = 0;
  let failed = 0;
  try {
    const results = await Promise.allSettled(
      autoTagAdds.map((add) =>
        sendMessage("addClientTorrentTags", { downloaderId: add.downloaderId, id: add.id, tags: [add.tag] }),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value) added += 1;
        else unsupported += 1;
      } else {
        failed += 1;
      }
    }
  } finally {
    busy.value = false;
  }
  const parts = [t("MyClient.label.autoResult", { count: added })];
  if (unsupported) parts.push(t("MyClient.label.autoUnsupported", { count: unsupported }));
  if (failed) parts.push(t("MyClient.label.autoFailed", { count: failed }));
  runtimeStore.showSnakebar(parts.join("，"), { color: added > 0 ? "success" : "error" });
  if (added > 0) emit("done");
  showDialog.value = false;
}

async function confirmSetLabel() {
  const label = labelInput.value.trim();
  if (!label) {
    runtimeStore.showSnakebar(t("MyClient.label.emptyLabel"), { color: "warning" });
    return;
  }

  busy.value = true;
  try {
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
    if (succeeded > 0) emit("done");
  } finally {
    busy.value = false;
  }
  showDialog.value = false;
}

function onOk() {
  return mode.value === "auto" ? confirmAutoTag() : confirmSetLabel();
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.label.title', { count: torrents.length })"
    :width="480"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :ok-button-props="okButtonProps"
    :cancel-button-props="{ color: 'blue', variant: 'text', iconPlacement: 'start', icon: h(CloseCircleOutlined) }"
    :confirm-loading="busy"
    :after-open-change="(open: boolean) => open && dialogEnter()"
    @ok="onOk"
  >
    <a-divider class="ma-0" />

    <!-- 两档分开：自动那一档吃「Tracker → 站点」，手填那一档写的是下载器的分类。
         两者不是同一个格子（qBittorrent 里 category 与 tags 并列），混在一句话里说会误导。 -->
    <a-radio-group v-model:value="mode" name="my-client-label-mode" button-style="solid" class="label-mode">
      <a-radio-button value="auto">{{ t("MyClient.label.modeAuto") }}</a-radio-button>
      <a-radio-button value="category">{{ t("MyClient.label.modeCategory") }}</a-radio-button>
    </a-radio-group>

    <template v-if="mode === 'auto'">
      <div class="label-auto-scope">
        {{
          torrents.length > 0
            ? t("MyClient.label.autoScopeSelected", { count: autoTagScope })
            : t("MyClient.label.autoScopeAll", { count: autoTagScope })
        }}
      </div>
      <div v-if="autoTagAdds.length > 0" class="label-auto-summary">
        {{
          t("MyClient.label.autoSummary", {
            adds: autoTagAdds.length,
            hasTags: autoTagSkipped.hasTags,
            noSite: autoTagSkipped.noSite,
          })
        }}
      </div>
      <div v-else class="label-auto-summary">{{ t("MyClient.label.autoNothing") }}</div>
    </template>

    <template v-else>
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

      <div class="label-category-hint">{{ t("MyClient.label.categoryHint") }}</div>
    </template>

    <a-divider class="ma-0" />
  </a-modal>
</template>

<style scoped lang="scss">
.label-mode {
  margin: 4px 0 12px;
}

.label-auto-scope,
.label-auto-summary,
.label-category-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--pt-color-text-secondary);
}

.label-auto-summary {
  margin-top: 4px;
}

.label-category-hint {
  margin-top: 8px;
}

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
