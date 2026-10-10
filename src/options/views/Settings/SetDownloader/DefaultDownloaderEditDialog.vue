<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { message } from "antdv-next";

import type { IDefaultDownloaderConfig, TDownloaderKey } from "@/shared/types/storages/metadata.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { getDownloaderIcon } from "@ptd/downloader";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const defaultDownloaderConfig = ref<Required<IDefaultDownloaderConfig>>({
  id: "",
  folder: "",
  tags: "",
});

const suggests = ref<{ folder: string[]; tags: string[] }>({ folder: [], tags: [] });

function updateDefaultDownloaderInput(downloaderId: TDownloaderKey, clean: boolean = true) {
  if (clean) {
    defaultDownloaderConfig.value.folder = "";
    defaultDownloaderConfig.value.tags = "";
  }
  suggests.value = {
    folder: metadataStore.downloaders?.[downloaderId]?.suggestFolders ?? [],
    tags: metadataStore.downloaders?.[downloaderId]?.suggestTags ?? [],
  };
}

/**
 * a-select 的 tags 模式值是 **数组**，而 IDefaultDownloaderConfig.folder / tags
 * 声明的是 string，且下游按 string 用（SentToDownloaderDialog 直接
 * `addTorrentOptions.savePath = folder ?? ""`、KeepUploadDialog 绑成 textarea 的
 * v-model）。原先直接 v-model 绑上去，用户往里打一个路径，store 里存进去的就是
 * `["D:\\downloads"]` —— 推送时 savePath 变成数组，被各下载器拼成
 * `"D:\\downloads"` 或直接抛错，而设置页显示出来仍是一串文本，看着像存对了。
 *
 * 这里用 computed 代理：多选侧始终是数组，落库前 join 成换行分隔的字符串。
 */
const folderValue = computed<string[]>({
  get: () => defaultDownloaderConfig.value.folder.split("\n").filter(Boolean),
  set: (v) => (defaultDownloaderConfig.value.folder = v.join("\n")),
});

const tagsValue = computed<string[]>({
  get: () => defaultDownloaderConfig.value.tags.split("\n").filter(Boolean),
  set: (v) => (defaultDownloaderConfig.value.tags = v.join("\n")),
});

/** 选中的下载器是否还在（可能被删掉或已禁用）——失效 id 不该静默留着 */
const isIdValid = computed<boolean>(() => {
  const id = defaultDownloaderConfig.value.id;
  return !id || Boolean(metadataStore.downloaders[id]);
});

const saving = ref(false);

async function saveDefaultDownloader() {
  // ⚠️ 原先空 id 也能提交，会把默认下载器整个清掉（连带 folder / tags），
  // 而用户可能只是想改路径。空 id 时明确拦下并说明。
  if (!defaultDownloaderConfig.value.id) {
    message.warning(t("SetDownloader.index.defaultDownloaderNoId"));
    return;
  }
  // 失效 id：下载器已被删/禁用，这时保存只是把一条永远用不了的配置写回去
  if (!isIdValid.value) {
    message.error(t("SetDownloader.index.defaultDownloaderIdGone"));
    return;
  }
  if (saving.value) return;
  saving.value = true;
  try {
    metadataStore.defaultDownloader = { ...defaultDownloaderConfig.value };
    await metadataStore.$save();
    showDialog.value = false;
  } catch (e) {
    message.error(t("SetDownloader.index.defaultDownloaderSaveFailed"));
    console.error("[SetDownloader] save default downloader failed", e);
  } finally {
    saving.value = false;
  }
}

function enterDialog() {
  defaultDownloaderConfig.value = { id: "", folder: "", tags: "" };
  suggests.value = { folder: [], tags: [] };

  if (metadataStore.defaultDownloader?.id) {
    defaultDownloaderConfig.value = { ...metadataStore.defaultDownloader } as Required<IDefaultDownloaderConfig>;
    updateDefaultDownloaderInput(defaultDownloaderConfig.value.id, false);
  }
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetDownloader.index.editDefaultDownloaderBtn')"
    width="600px"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :after-open-change="(open: boolean) => open && enterDialog()"
    @ok="saveDefaultDownloader"
  >
    <a-form layout="vertical">
      <a-form-item :label="t('SetDownloader.index.editDefaultDownloaderBtn')">
        <a-select
          v-model:value="defaultDownloaderConfig.id"
          :options="metadataStore.getEnabledDownloaders.map((d) => ({ value: d.id, label: d.name }))"
          style="width: 100%"
          @change="(e: string) => updateDefaultDownloaderInput(e)"
        >
          <template #option="{ value }">
            <div style="display: flex; align-items: center; gap: 8px">
              <img
                :src="getDownloaderIcon((metadataStore.downloaders[value as string] as any)?.type)"
                style="width: 20px; height: 20px"
              />
              <span>{{ (metadataStore.downloaders[value as string] as any)?.name }}</span>
              <span style="color: rgba(0,0,0,0.45)">{{ (metadataStore.downloaders[value as string] as any)?.address }}</span>
            </div>
          </template>
        </a-select>
      </a-form-item>

      <a-form-item :label="t('SetDownloader.PathAndTag.downloadPath.title')">
        <a-select
          v-model:value="folderValue"
          mode="tags"
          :options="suggests.folder.map((f) => ({ value: f, label: f }))"
          style="width: 100%"
          placeholder=""
        />
      </a-form-item>

      <a-form-item :label="t('SetDownloader.PathAndTag.tags.title')">
        <a-select
          v-model:value="tagsValue"
          mode="tags"
          :options="suggests.tags.map((tag) => ({ value: tag, label: tag }))"
          style="width: 100%"
          placeholder=""
        />

        <!-- 默认下载器被删/禁用后，原来的 id 会让下拉显示成一个找不到的裸 id，
             这里点破当前状态，别让用户对着一个空下拉猜。 -->
        <a-alert v-if="!isIdValid" type="warning" show-icon>
          <template #message>{{ t("SetDownloader.index.defaultDownloaderIdGone") }}</template>
        </a-alert>
      </a-form-item>
    </a-form>
  </a-modal>
</template>
