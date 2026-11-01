<script setup lang="ts">
/**
 * 「删除辅种任务」确认框里那颗勾选框：要不要把它在下载器里的那些副本连数据文件一并删掉。
 *
 * 默认不勾，而且**不勾时这个确认框与改前只差那一行勾选框** —— 用户 2026-11-01 要的是
 * 「增加一个……开关，默认关闭」，删文件是不可逆的那一半，不许出现在任何默认路径上。
 *
 * 勾选状态由本组件拿着，变化通过 `onPick` 交给调用方：确认框 resolve 之后调用方要读到的是
 * **最后一次**勾选值。没做成 v-model 是因为 `h()` 传模型要靠 `useModel` 的本地回退，而这一处
 * 只有一趟单向传递，回调比它少一层语义（也少一个「父组件没把值喂回来」的悬空档）。
 *
 * 为什么单独成一个组件、而不是在页面里 `h()` 拼节点：`modal.confirm` 的内容渲染在**另一棵组件树**里，
 * 页面模板的 scoped 样式选不到它（同 `MyClient/ReseedHandoffConfirm.vue` 那条）。
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  /** 上面那句确认问话，与改前 `confirmDanger` 收的同一串 */
  text: string;
  /** 这台/这几台下载器只提供「删任务」，文件删不掉时给的那一句（由调用方按 `ignoresRemoveData` 判） */
  noFileDelete?: string;
  /** 勾选状态的变化 */
  onPick: (on: boolean) => void;
}>();

const { t } = useI18n();
const checked = ref(false);

function pick(on: boolean) {
  checked.value = on;
  props.onPick(on);
}
</script>

<template>
  <div class="task-delete-confirm">
    <p class="task-delete-confirm__text">{{ props.text }}</p>
    <a-checkbox :checked="checked" @update:checked="pick">{{ t("KeepUploadTask.withData.label") }}</a-checkbox>

    <!-- 两句说明只在勾上之后才画：没勾时它们说的是一个他不会得到的结果，画出来只是噪声 -->
    <p v-if="checked" class="task-delete-confirm__note">{{ t("KeepUploadTask.withData.shared") }}</p>
    <p v-if="checked && props.noFileDelete" class="task-delete-confirm__warn">{{ props.noFileDelete }}</p>
  </div>
</template>

<style scoped>
.task-delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-delete-confirm__text {
  margin: 0;
}

.task-delete-confirm__note {
  margin: 0;
  color: var(--pt-color-text-secondary);
}

/* 这一句要紧（它让那颗勾选失去一半意义），所以给底色而不是普通灰字，
   与 `MyClient/DeleteDialog.vue` 里那条群晖说明同一档 */
.task-delete-confirm__warn {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(207, 133, 14, 0.12);
}
</style>
