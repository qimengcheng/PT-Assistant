<script setup lang="ts">
/**
 * 「把这条任务的数据移到我说的那个目录」那个框。
 *
 * 为什么单独成一个组件、而不是往 `modal.confirm` 的 content 里 `h()` 拼节点：确认框渲染在
 * **另一棵组件树**里，`h()` 手造的节点拿不到本组件的 scoped 样式（同 `MyClient/ReseedHandoffConfirm.vue`
 * 那一处踩过的坑）。这一屏要摆三行路径 + 一句拒绝理由，排版是有要求的。
 *
 * ⚠️ 这个框**只负责收集那一串目录**，判据一条都不在这里：`judgeMoveTarget` 住在
 * `@/shared/reseedMoveTarget.ts`，页面拿到 `kind: "ok"` 那份才去搬。把判断抄进组件 = 反证够不着，
 * 而这一族每次判错都会往用户数据上写东西。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { TMoveTargetVerdict } from "@/shared/reseedMoveTarget.ts";
import { judgeMoveTarget } from "@/shared/reseedMoveTarget.ts";
import { isCategorySavePath } from "@/shared/reseedPath.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

const props = defineProps<{
  /** 这一条任务的下载器：候选目录从那一台的 `suggestFolders` 取 */
  downloaderId: string;
  /** 那条种子**此刻**所在的目录（页面现查的，弹窗不再取一次数）。空串 = 这台没报这个字段 */
  currentPath: string;
  /** 任务上「保存路径」那一格现在写着什么 —— 摆出来是为了让他看见这一趟会把它改掉 */
  taskPath: string;
}>();

const emit = defineEmits<{
  confirm: [verdict: Extract<TMoveTargetVerdict, { kind: "ok" }>];
}>();

const open = defineModel<boolean>();
const { t } = useI18n();
const metadataStore = useMetadataStore();

const target = ref("");
/**
 * 就地显示的那句拒绝理由。不用 snakebar：此刻焦点在这个框里，提示跑到右上角等于没提示。
 * `null` 也参与渲染判断，所以它是判据的产出而不是本地格式校验 —— 三档各说一句（修法不一样）。
 */
const rejected = ref<"empty" | "category" | "placeholder" | null>(null);

/**
 * 候选目录：只列**真实目录**，把 `category:xxx` 那种分类写法筛掉 —— 这一格要发的是
 * `setLocation`，它只认目录；而下载器默认给的候选里就混着分类写法（`KeepUploadDialog`
 * 新建分类那一栏用的是同一份过滤，理由相同）。
 */
const pathOptions = computed(() =>
  (metadataStore.downloaders[props.downloaderId]?.suggestFolders ?? [])
    .filter((x) => !isCategorySavePath(x))
    .map((x) => ({ value: x, label: x })),
);

/**
 * 每次打开都重新预填成「此刻所在」那一份：这一趟要的是**改一个已经存在的落点**，
 * 从现状起步比从空白起步少一次「先去别处查一下现在在哪」。
 * 报不出目录时退回任务那一格写着的那一份 —— 那也是关于这条任务的既有事实，不是猜的。
 */
watch(open, (shown) => {
  if (!shown) return;
  target.value = props.currentPath || props.taskPath;
  rejected.value = null;
});

function submit() {
  const verdict = judgeMoveTarget({ raw: target.value, currentPath: props.currentPath });
  if (verdict.kind !== "ok") {
    rejected.value = verdict.kind;
    return;
  }
  rejected.value = null;
  emit("confirm", verdict);
  open.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="open"
    :title="t('KeepUploadTask.movePath.title')"
    :width="560"
    :ok-text="t('KeepUploadTask.movePath.confirm')"
    @ok="submit"
  >
    <div class="move-path">
      <p class="move-path__fact">
        {{ props.currentPath ? t("KeepUploadTask.movePath.current", { path: props.currentPath }) : t("KeepUploadTask.movePath.currentUnknown") }}
      </p>
      <p class="move-path__fact">
        {{ t("KeepUploadTask.movePath.task", { path: props.taskPath || t("KeepUploadTask.defaultPath") }) }}
      </p>

      <a-auto-complete
        v-model:value="target"
        :options="pathOptions"
        :placeholder="t('KeepUploadTask.movePath.target')"
        style="width: 100%"
        :popup-match-select-width="false"
        @change="rejected = null"
      />

      <p v-if="rejected" class="move-path__reject">{{ t(`KeepUploadTask.movePath.${rejected}`) }}</p>

      <!-- 三条外部行为都要在点之前说：qBittorrent 会关掉 autoTMM、会自建目录，而**只有已经下完的
           那条才真的挪文件**（还在下的只改落点）。第三条尤其不能说漏，否则他会以为进度条走到一半
           的种子也会当场搬走，然后在「怎么没动」那一栏报一条 bug。 -->
      <p class="move-path__hint">{{ t("KeepUploadTask.movePath.hint") }}</p>
    </div>
  </a-modal>
</template>

<style scoped>
.move-path {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.move-path__fact {
  margin: 0;
  font-size: 12px;
  color: var(--pt-color-text-secondary);
  /* 路径是无空格长串，不 overflow-wrap 会把弹窗整个撑出横向滚动条（同种子标题那一族） */
  overflow-wrap: anywhere;
}

.move-path__reject {
  margin: 0;
  color: var(--pt-color-danger);
}

.move-path__hint {
  margin: 0;
  color: var(--pt-color-text-secondary);
}
</style>
