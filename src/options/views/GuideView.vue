<script setup lang="ts">
/**
 * 新手引导：从「这个插件能干什么」一路走到「把种子推进下载器」。
 *
 * 正文不在这里，也不在 locales/*.json，而在 src/options/data/gettingStarted.ts ——
 * 那是一份长文档（九节、上百句），语言包那两个文件是给控件标签用的，塞进去会毁掉它；
 * 而且这里要表达「有序步骤 / 要点 / 问答」三种结构，JSON 表达不了。
 * 中英各写一份，跟着 locale 现取（不是常量，切语言当场就要换 —— AGENTS §3.4 最后一条）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { guideEn, guideZh } from "@/options/data/gettingStarted.ts";

const { t, locale } = useI18n();

const doc = computed(() => (locale.value === "en" ? guideEn : guideZh));

/** 条目前缀的分隔符：中文用全角冒号后不接空格，英文要接 */
const itemSep = computed(() => (locale.value === "en" ? ": " : "："));

/**
 * 目录用按钮 + scrollIntoView，不用 <a href="#x">：
 * 这个应用走 hash 路由（createWebHashHistory），href="#x" 会被路由吃掉并跳到一个不存在的页。
 */
function jumpTo(id: string) {
  document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <article class="page-fill guide-view">
    <section class="page-panel page-fill-grow">
      <div class="guide-inner">
        <header class="guide-head">
          <h1>{{ t("layout.nav.guide") }}</h1>
          <p class="guide-tagline">{{ doc.tagline }}</p>
        </header>

        <nav class="guide-toc">
          <span class="guide-toc-label">{{ doc.toc }}</span>
          <a-button v-for="section in doc.sections" :key="section.id" type="link" size="small" @click="jumpTo(section.id)">
            {{ section.title }}
          </a-button>
        </nav>

        <section v-for="item in doc.sections" :id="`guide-${item.id}`" :key="item.id" class="guide-section">
          <h2>{{ item.title }}</h2>
          <p v-if="item.lead" class="guide-lead">{{ item.lead }}</p>

          <ol v-if="item.steps" class="guide-list">
            <li v-for="(step, i) in item.steps" :key="i">{{ (step.title ? step.title + itemSep : "") + step.text }}</li>
          </ol>

          <ul v-if="item.points" class="guide-list">
            <li v-for="(point, i) in item.points" :key="i">
              <strong v-if="point.title">{{ point.title }}{{ itemSep }}</strong>{{ point.text }}
            </li>
          </ul>

          <dl v-if="item.faq" class="guide-faq">
            <template v-for="(qa, i) in item.faq" :key="i">
              <dt>{{ qa.q }}</dt>
              <dd>{{ qa.a }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </section>
  </article>
</template>

<style scoped>
/* 正文限宽：这一页是给人读的长文，铺满两千像素的屏会一行拉到一百多个汉字。
   外层 .page-panel 自己滚（.page-fill + .page-fill-grow 把白面板撑到视口底，
   不留半屏灰底 —— 见 AGENTS §3.4 与 style.css 那两条）。 */
.guide-inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 8px 8px 32px;
}

.guide-head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.guide-tagline {
  margin: 8px 0 0;
  color: rgba(0, 0, 0, 0.65);
}

.guide-toc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--pt-color-border-light);
}

.guide-toc-label {
  margin-inline-end: 8px;
  font-weight: 600;
  font-size: 13px;
}

.guide-section {
  margin-top: 24px;
  /* 目录点进来时给顶部留一条缝，标题不会被面板上沿切住 */
  scroll-margin-top: 8px;
}

.guide-section h2 {
  margin: 0 0 8px;
  padding-bottom: 6px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--pt-color-border-light);
}

.guide-lead {
  margin: 0 0 8px;
  line-height: 1.7;
}

.guide-list {
  margin: 0;
  padding-inline-start: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.guide-list li {
  line-height: 1.7;
}

.guide-faq {
  margin: 0;
}

.guide-faq dt {
  margin-top: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.guide-faq dd {
  margin: 4px 0 0;
  line-height: 1.7;
  color: rgba(0, 0, 0, 0.78);
}
</style>
