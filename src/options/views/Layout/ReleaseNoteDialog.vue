<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { REPO_URL } from "~/helper.ts";

const showDialog = defineModel<boolean>();
const configStore = useConfigStore();
const { t } = useI18n();

interface ParsedVersion {
  versionNumbers: number[]; // 版本号数字部分
  buildHash: string; // 构建哈希值
  fullVersion: string; // 完整版本字符串
}

function parseVersion(versionString: string): ParsedVersion {
  const versionPart = versionString.slice(1); // 移除前缀 v 后的部分
  const [mainVersion, buildHash = ""] = versionPart.split("+"); // 分割版本号和构建哈希

  // 解析版本号数字部分
  const versionNumbers = mainVersion
    .split(".")
    .map((numStr) => parseInt(numStr, 10))
    .filter((num) => !isNaN(num));

  return {
    versionNumbers,
    buildHash,
    fullVersion: versionString,
  };
}

const storeVersion = parseVersion(configStore.version);
const currentVersion = parseVersion(__EXT_VERSION__);
const failbackVersion = parseVersion("v0.0.5.1147+23f758f7"); // 这个版本号为引入更新窗口时间点前的发布送审版本号
const storeBuildHash = computed<string>(() => storeVersion.buildHash || failbackVersion.buildHash);

/**
 * 本项目 `__EXT_VERSION__` 只注入到 `v<package.json 版本>`（见 wxt.config.ts），
 * 没有旧项目那种 `v...+<commit>` 的构建哈希后缀，两端哈希拿不全时拼出来的
 * `/compare/23f758f7...` 是打不开的死链，所以哈希齐了才走精确 compare，
 * 缺任何一端就退到仓库 compare 首页。
 */
const changelogUrl = computed<string>(() => {
  const from = storeBuildHash.value;
  const to = currentVersion.buildHash;
  return from && to ? `${REPO_URL}/compare/${from}...${to}` : `${REPO_URL}/compare`;
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
    @after-open-change="onAfterOpenChange"
  >
    <div class="release-note">
      <div class="brand">
        <img src="/icon/128.png" width="128" alt="PT Assistant" />
        <div class="current-version">
          {{ currentVersion.fullVersion }}{{ t("layout.releaseNote.currentVersion") }}
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
