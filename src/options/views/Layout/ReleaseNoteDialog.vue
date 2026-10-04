<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { REPO_URL } from "~/helper.ts";

const showDialog = defineModel<boolean>();
const configStore = useConfigStore();
const { t } = useI18n();

const currentVersion = __EXT_VERSION__;

/**
 * 更新日志以 GitHub Release 页为准（CI ci.yml 按 package.json 版本发 tag `vX.Y.Z`）。
 * 正式版直接落到当前版本对应的 tag 页；dev 等非标准版本号没有对应 tag，退回 Releases 列表。
 */
const changelogUrl = computed<string>(() => {
  const mainVersion = __EXT_VERSION__.slice(1).split("+")[0];
  return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(mainVersion)
    ? `${REPO_URL}/releases/tag/v${mainVersion}`
    : `${REPO_URL}/releases`;
});

function dialogLeave() {
  configStore.version = __EXT_VERSION__;
  configStore.$save();
}

/**
 * antdv-next 的 Modal 只有 afterOpenChange（开、关都会回调），
 * 不等价于 Vuetify 的 @after-leave（只在关闭后回调），这里显式过滤掉打开的那次。
 */
function onAfterOpenChange(open: boolean) {
  if (!open) dialogLeave();
}
</script>

<template>
  <!--
    旧实现是 persistent 对话框：点遮罩、按 Esc 都不该关，必须走底部按钮才记录已读版本号，
    故 closable / mask-closable / keyboard 全部关掉。
    标题里的产品名用字面量：i18n 的 manifest.extName 仍是上游旧产品名，跟着它会把重构版显示成旧名。
  -->
  <a-modal
    v-model:open="showDialog"
    :width="600"
    :closable="false"
    :mask-closable="false"
    :keyboard="false"
    :title="t('layout.releaseNote.title', { extName: 'PT Assistant' })"
    :after-open-change="onAfterOpenChange"
  >
    <div class="release-note">
      <div class="brand">
        <img src="/icon/128.png" width="128" alt="PT Assistant" />
        <div class="current-version">
          {{ currentVersion }}{{ t("layout.releaseNote.currentVersion") }}
        </div>
      </div>

      <div class="links">
        <a :href="changelogUrl" rel="noopener noreferrer nofollow" target="_blank">
          {{ t("layout.releaseNote.changelog") }}
        </a>
        <a-divider type="vertical" />
        <!--
          这里原来挂的是「Wiki 帮助」但 href 指向 /releases，文案与目标不符；
          本仓库也没有对应的 wiki 页面，改成指向 Releases 的「下载」。
        -->
        <a :href="`${REPO_URL}/releases`" rel="noopener noreferrer nofollow" target="_blank">
          {{ t("layout.releaseNote.download") }}
        </a>
        <a-divider type="vertical" />
        <!-- 原来写死上游的 /discussions/316，那是上游 FAQ 讨论帖的编号，本仓库不存在该号 -->
        <a :href="`${REPO_URL}/discussions`" rel="noopener noreferrer nofollow" target="_blank">
          {{ t("layout.releaseNote.faq") }}
        </a>
      </div>
    </div>

    <!-- 不设 :footer="null"：那会连 #footer slot 一起吞掉（见 v0.12.2 的同类修复） -->
    <template #footer>
      <a-button block type="primary" @click="showDialog = false">
        {{ t("layout.releaseNote.startUsing") }}
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.release-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  text-align: center;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.current-version {
  color: rgba(0, 0, 0, 0.45);
}

.links {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
