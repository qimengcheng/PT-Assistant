<script setup lang="ts">
/**
 * 右键菜单「高级推送」落地页：从右键菜单携带 ?link= 打开，弹出发送到下载器对话框。
 * 平移自 PT-depiler views/ContextMenuLinkPush.vue（Vuetify → antdv）。
 */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { getHostFromUrl, type ITorrent } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import SentToDownloaderDialog from "@/options/components/SentToDownloaderDialog/Index.vue";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const showDialog = ref(false);
const torrentItems = ref<ITorrent[]>([]);

onMounted(() => {
  const link = route?.query?.link;

  if (!link || typeof link !== "string") {
    runtimeStore.showSnakebar(t("ContextMenuLinkPush.invalidLink"), { color: "error" });
    onCancel();
    return;
  }

  const torrent = { link } as ITorrent;

  // 尝试从 link 中解出站点
  if (link.match(/https?:\/\/([^/]+)/)) {
    const host = getHostFromUrl(link);
    if (metadataStore.siteHostMap[host]) {
      torrent.site = metadataStore.siteHostMap[host];
    }
  }

  torrentItems.value = [torrent];
  showDialog.value = true;
});

function onCancel() {
  showDialog.value = false;
  // 纯中转页，关闭对话框后回到首页
  router.replace({ path: "/" });
}
</script>

<template>
  <div class="link-push">
    <!--
      SentToDownloaderDialog 自身就是 a-modal（含标题/遮罩/底部按钮）。
      这里原来又套了一层 a-modal，造成双弹窗 + 双遮罩。中转页只需要把它直接渲染出来，
      关闭（cancel）或发送完成（done）后跳回首页即可。
    -->
    <SentToDownloaderDialog
      v-if="torrentItems.length"
      v-model="showDialog"
      :torrent-items="torrentItems"
      @cancel="onCancel"
      @done="onCancel"
    />
  </div>
</template>
