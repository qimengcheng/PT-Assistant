<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined } from "@antdv-next/icons";

import type { CTorrent, TorrentSpeedLimit } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const showDialog = defineModel<boolean>();
const { torrents } = defineProps<{
  torrents: CTorrent[];
}>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();

const uploadLimit = ref<number | null>(null);
const downloadLimit = ref<number | null>(null);

function dialogEnter() {
  // 初始化为当前种子的限速（qBittorrent raw 中有 up_limit/dl_limit 字段，其他客户端留空）
  const first = torrents[0];
  const raw = first?.raw as Record<string, any> | undefined;
  // ⚠️ qBittorrent 的 up_limit/dl_limit 不是「一个数字」：官方文档写明 -1 = 不限速，
  // 0 的口径没有权威说法（本仓 qBittorrent.ts:764 那句注释也只讲了 -1）。
  // 旧写法只判 `typeof number`，实测两种都会预填成 0/-0（Math.round(-1/1024) 是 -0，
  // 它不是 null，所以照样回传），而回传那侧 qBittorrent.ts:773/779 写的是
  // `limit: v > 0 ? v * 1024 : -1` —— 任何非正数都被改写成「不限速」。
  // 于是两件事同时成立：输入框里「不限速」显示成 0（看不出是哪种语义），
  // 而用户只是打开看一眼再点确定，这一项就被重发了一遍 -1；0 若真有「跟随全局」
  // 那层意思，那个语义当场丢掉。
  // 现在只预填正数（= 真正的具体限速），其余留 null，回传时这个字段压根不发出去，
  // 策略由下载器自己保持。
  uploadLimit.value = typeof raw?.up_limit === "number" && raw.up_limit > 0 ? Math.round(raw.up_limit / 1024) : null;
  downloadLimit.value = typeof raw?.dl_limit === "number" && raw.dl_limit > 0 ? Math.round(raw.dl_limit / 1024) : null;
}

const submitting = ref(false);

async function confirmSetLimit() {
  // ⚠️ 确定键原先既没有 loading 也没有闸：双击会发两批 setLimit，
  // 而这两批都返回成功 —— 用户只看到一次成功提示，实际上限被设了两遍，
  // 中间还可能被后一批的旧值覆盖。
  if (submitting.value) return;
  submitting.value = true;
  try {
    await doSetLimit();
  } finally {
    submitting.value = false;
  }
}

async function doSetLimit() {
  const limits: TorrentSpeedLimit = {};
  if (uploadLimit.value !== null) limits.upload = uploadLimit.value;
  if (downloadLimit.value !== null) limits.download = downloadLimit.value;
  if (Object.keys(limits).length === 0) {
    runtimeStore.showSnakebar(t("MyClient.speedLimit.emptyLimit"), { color: "warning" });
    return;
  }

  const results = await Promise.allSettled(
    torrents.map((torrent) =>
      sendMessage("setClientTorrentSpeedLimit", {
        downloaderId: torrent.clientId,
        id: torrent.id,
        limits,
      }),
    ),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  // 部分失败也要说出来：allSettled 不抛，失败的那些只会算成「没成功」，
  // 用户看到「0 条成功」却不知道是下载器拒绝了还是压根没发出去。
  const failed = results.length - succeeded;
  runtimeStore.showSnakebar(
    failed > 0 && succeeded > 0
      ? t("MyClient.speedLimit.partiallyFailed", { succeeded, failed })
      : t("MyClient.speedLimit.success", { count: succeeded }),
    { color: succeeded > 0 ? "success" : "error" },
  );
  // 全失败时保持弹窗打开，让用户改了值重试（和 DeleteDialog 同一口径）
  if (succeeded === 0) return;
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.speedLimit.title', { count: torrents.length })"
    :width="480"
    :after-open-change="(open: boolean) => open && dialogEnter()"
  >

    <a-divider class="ma-0" />

    <!-- a-alert 不渲染默认插槽，正文必须放 #message -->
    <a-alert type="info" variant="outlined" class="my-3">
      <template #message>{{ t("MyClient.speedLimit.unitNote") }}</template>
    </a-alert>

    <div class="field-row">
      <span class="field-label">{{ t("MyClient.speedLimit.upload") }}</span>
      <!-- 原 v-text-field type="number" v-model.number clearable：清空后同样是 null -->
      <a-input-number v-model:value="uploadLimit" :min="0" :step="1" class="flex-1-1-0" />
    </div>

    <div class="field-row">
      <span class="field-label">{{ t("MyClient.speedLimit.download") }}</span>
      <a-input-number v-model:value="downloadLimit" :min="0" :step="1" class="flex-1-1-0" />
    </div>

    <template #footer>
      <a-flex justify="flex-end" align="center" gap="small">
        <a-button color="blue" variant="text" icon-placement="start" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </a-button>
        <a-button type="primary" :loading="submitting" icon-placement="start" @click="confirmSetLimit">
          <template #icon>
            <CheckCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.ok") }}</span>
        </a-button>
      </a-flex>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.field-label {
  flex: none;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
