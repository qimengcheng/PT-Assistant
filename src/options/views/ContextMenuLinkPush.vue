<script setup lang="ts">
/**
 * 右键菜单「高级推送」落地页：从右键菜单携带 ?link= 打开，弹出发送到下载器对话框。
 * 平移自 PT-depiler views/ContextMenuLinkPush.vue（Vuetify → antdv）。
 */
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getHostFromUrl, type ITorrent } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import SentToDownloaderDialog from "@/options/components/SentToDownloaderDialog/Index.vue";

const route = useRoute();
const router = useRouter();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const showDialog = ref(false);
const torrentItems = ref<ITorrent[]>([]);

onMounted(() => {
  const link = route?.query?.link;

  if (!link || typeof link !== "string") {
    runtimeStore.showSnakebar("无效的链接", { color: "error" });
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
    <a-modal
      :open="showDialog"
      title="推送到下载器"
      :footer="null"
      :mask-closable="false"
      @cancel="onCancel"
    >
      <SentToDownloaderDialog v-if="torrentItems.length" v-model="showDialog" :torrent-items="torrentItems" />
    </a-modal>
  </div>
</template>
