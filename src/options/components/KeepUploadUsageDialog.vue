<script setup lang="ts">
/**
 * 「辅种怎么用」说明弹窗。
 *
 * 为什么在应用里写这份说明而不是链到仓库：那颗按钮原先 href 到
 * `github.com/pt-plugins/PT-Plugin-Plus/wiki/keep-upload-task` —— 那是**上游旧项目**的 wiki，
 * 不是本仓库，讲的也不是这一版界面的按钮名。用户 2026-10-08：「不要跳转链接，直接把使用方式弹窗展示出来」。
 *
 * 正文不在这里也不在 locales/*.json，在 src/options/data/keepUploadUsage.ts（长文档，中英各一份）。
 * 这一页与「辅种检测」对话框共用本组件，所以文案里不假设用户是从哪一边点进来的。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { usageEn, usageZh } from "@/options/data/keepUploadUsage.ts";

const showDialog = defineModel<boolean>();

const { t, locale } = useI18n();

const doc = computed(() => (locale.value === "en" ? usageEn : usageZh));
/** 要点前缀的分隔符：中文用全角冒号后不接空格，英文要接 */
const itemSep = computed(() => (locale.value === "en" ? ": " : "："));
</script>

<template>
  <a-modal v-model:open="showDialog" :title="t('KeepUploadTask.usage.title')" :width="760">
    <div class="ku-usage">
      <p class="ku-intro">{{ doc.intro }}</p>

      <section v-for="section in doc.sections" :key="section.id" class="ku-section">
        <h3 class="ku-h">{{ section.title }}</h3>
        <p v-if="section.lead" class="ku-lead">{{ section.lead }}</p>

        <ol v-if="section.steps" class="ku-steps">
          <li v-for="(step, i) in section.steps" :key="i">{{ step }}</li>
        </ol>

        <ul v-if="section.points" class="ku-points">
          <li v-for="(point, i) in section.points" :key="i">
            <b v-if="point.title">{{ point.title }}{{ itemSep }}</b>{{ point.text }}
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <a-button type="primary" @click="showDialog = false">{{ t("common.dialog.close") }}</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
/* 版式跟 GuideView.vue 一套：这是给人读的长文，不塞灰底块（全站口径是灰只能当缝），
   小节标题靠一条下分隔线分组 */
.ku-usage {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ku-intro {
  margin: 0;
  line-height: 1.7;
}

.ku-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ku-h {
  margin: 0;
  padding-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--pt-color-border-light);
}

.ku-lead {
  margin: 0;
  line-height: 1.7;
}

.ku-steps,
.ku-points {
  margin: 0;
  padding-inline-start: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ku-steps li,
.ku-points li {
  line-height: 1.7;
}
</style>
