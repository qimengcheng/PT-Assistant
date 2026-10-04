<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { definitionList, getDefinedSiteMetadata } from "@ptd/site";
import type { ISiteMetadata } from "@ptd/site";

/**
 * 开发调试视图：展示全部站点定义 id（同步，零开销），
 * 点击某个站点时才通过 getDefinedSiteMetadata() 动态 import 对应的 definition chunk ——
 * 这是「340 个定义按需加载」架构的直接验证。
 */
const { t } = useI18n();

const keyword = ref("");
const selected = ref<ISiteMetadata | null>(null);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return definitionList;
  return definitionList.filter((id) => id.toLowerCase().includes(kw));
});

async function viewSite(id: string) {
  loading.value = true;
  error.value = null;
  try {
    selectedId.value = id;
    selected.value = await getDefinedSiteMetadata(id);
  } catch (e) {
    error.value = String(e);
    selected.value = null;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="layout">
    <aside class="defs">
      <header>
        <h1>{{ t("SiteDefinitions.title") }}</h1>
        <span class="count">{{ filteredList.length }} / {{ definitionList.length }}</span>
      </header>
      <input v-model="keyword" type="search" :placeholder="t('SiteDefinitions.searchPlaceholder')" class="search" />
      <ul class="site-list">
        <li
          v-for="id in filteredList"
          :key="id"
          :class="{ active: id === selectedId }"
          @click="viewSite(id)"
        >
          {{ id }}
        </li>
      </ul>
    </aside>

    <section class="defs-detail">
      <div v-if="loading" class="hint">{{ t("SiteDefinitions.loading") }}</div>
      <div v-else-if="error" class="hint error">{{ error }}</div>
      <template v-else-if="selected">
        <h2>{{ selected.name ?? selectedId }}</h2>
        <a-descriptions class="detail" :column="1" size="small" bordered>
          <a-descriptions-item label="id">
            <span>{{ selectedId }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="schema">
            <span>{{ selected.schema }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="type">
            <span>{{ selected.type }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="selected.tags?.length" label="tags">
            <a-tag v-for="tag in selected.tags" :key="tag" color="blue">{{ tag }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="urls">
            <div v-for="url in selected.urls" :key="url" class="url">{{ url }}</div>
          </a-descriptions-item>
        </a-descriptions>
      </template>
      <div v-else class="hint">{{ t("SiteDefinitions.selectHint") }}</div>
    </section>
  </div>
</template>
