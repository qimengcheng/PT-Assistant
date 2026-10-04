<script setup lang="ts">
import { computed, h, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { UploadFile } from "antdv-next";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  LinkOutlined,
} from "@antdv-next/icons";

import { type ITorrent, getHostFromUrl } from "@ptd/site";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SentToDownloaderDialog from "@/options/components/SentToDownloaderDialog/Index.vue";

const showDialog = defineModel<boolean>();
const metadataStore = useMetadataStore();
const { t } = useI18n();

type TInputMode = "url" | "file";

const inputMode = ref<TInputMode>("url");
const urlInput = ref("");
/** a-upload 的展示列表；beforeUpload 返回 false 时 rc-upload 不会自行建条目，这里维护 */
const uploadFileList = ref<UploadFile[]>([]);
/** 保持原 v-file-input 的 File[] 语义，供 submit() 读取 */
const torrentFiles = computed<File[]>(() =>
  uploadFileList.value.map((item) => item.originFileObj as unknown as File).filter(Boolean),
);

const showSentToDownloaderDialog = ref(false);
const pendingTorrentItems = ref<ITorrent[]>([]);

/** 原 v-btn-toggle mandatory：两个互斥模式按钮 */
const inputModeOptions = computed(() => [
  { value: "url", label: t("MyClient.pushToDownloader.modeUrl"), icon: h(LinkOutlined) },
  { value: "file", label: t("MyClient.pushToDownloader.modeFile"), icon: h(InboxOutlined) },
]);

/**
 * 只收集文件、不发起上传。
 * rc-upload 在 beforeUpload 返回 false 时不会把文件写进 fileList，所以条目在这里手动补上。
 */
function beforeUpload(file: File) {
  uploadFileList.value = [
    ...uploadFileList.value,
    {
      uid: `${file.name}-${file.size}-${uploadFileList.value.length}`,
      name: file.name,
      size: file.size,
      status: "done",
      originFileObj: file as UploadFile["originFileObj"],
    },
  ];
  return false;
}

function removeUploadFile(file: UploadFile) {
  uploadFileList.value = uploadFileList.value.filter((item) => item.uid !== file.uid);
}

function cleanStatus() {
  inputMode.value = "url";
  urlInput.value = "";
  uploadFileList.value = [];
}

async function submit() {
  const torrentItems: ITorrent[] = [];

  if (inputMode.value === "url") {
    const lines = urlInput.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const link of lines) {
      const torrent = { link, title: link } as ITorrent;
      if (link.match(/^https?:\/\//)) {
        const host = getHostFromUrl(link);
        if (metadataStore.siteHostMap[host]) {
          torrent.site = metadataStore.siteHostMap[host];
        }
      }
      torrentItems.push(torrent);
    }
  } else {
    for (const file of torrentFiles.value) {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      torrentItems.push({
        link: dataUri,
        title: file.name.replace(/\.torrent$/i, ""),
        site: "",
        id: file.name,
      } as unknown as ITorrent);
    }
  }

  if (torrentItems.length === 0) return;

  pendingTorrentItems.value = torrentItems;
  showDialog.value = false;
  showSentToDownloaderDialog.value = true;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.pushToDownloader.title')"
    :width="560"
    :after-open-change="(open: boolean) => open && cleanStatus()"
  >

    <a-segmented v-model:value="inputMode" :options="inputModeOptions" block class="mb-4" />

    <template v-if="inputMode === 'url'">
      <a-textarea
        v-model:value="urlInput"
        :placeholder="t('MyClient.pushToDownloader.urlInputLabel')"
        :rows="3"
        :auto-size="{ minRows: 3, maxRows: 10 }"
        allow-clear
      />
      <div class="field-hint">{{ t("MyClient.pushToDownloader.urlInputHint") }}</div>
    </template>

    <template v-else>
      <a-upload
        :file-list="uploadFileList"
        :before-upload="beforeUpload"
        multiple
        accept=".torrent"
        @remove="removeUploadFile"
      >
        <a-button>
          <template #icon>
            <InboxOutlined />
          </template>
          {{ t("MyClient.pushToDownloader.fileInputLabel") }}
        </a-button>
      </a-upload>
      <div class="field-hint">{{ t("MyClient.pushToDownloader.fileInputHint") }}</div>
    </template>

    <template #footer>
      <a-flex justify="flex-end" align="center" gap="small">
        <a-button color="blue" variant="text" icon-placement="start" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </a-button>
        <a-button
          :disabled="inputMode === 'url' ? !urlInput.trim() : torrentFiles.length === 0"
          color="green"
          variant="text"
          icon-placement="start"
          @click="submit"
        >
          <template #icon>
            <CloudUploadOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.ok") }}</span>
        </a-button>
      </a-flex>
    </template>
  </a-modal>

  <SentToDownloaderDialog
    v-model="showSentToDownloaderDialog"
    :torrent-items="pendingTorrentItems"
    @done="() => (showDialog = false)"
  />
</template>

<style scoped lang="scss">
/* 原 v-textarea / v-file-input 的 persistent-hint */
.field-hint {
  margin-top: 4px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
</style>
