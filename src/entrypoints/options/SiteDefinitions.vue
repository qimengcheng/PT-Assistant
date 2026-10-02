<script setup lang="ts">
import { computed, ref } from "vue";
import { definitionList, getDefinedSiteMetadata } from "@ptd/site";
import type { ISiteMetadata } from "@ptd/site";

/**
 * 开发调试视图：展示全部站点定义 id（同步，零开销），
 * 点击某个站点时才通过 getDefinedSiteMetadata() 动态 import 对应的 definition chunk ——
 * 这是「340 个定义按需加载」架构的直接验证。
 */
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
        <h1>站点定义</h1>
        <span class="count">{{ filteredList.length }} / {{ definitionList.length }}</span>
      </header>
      <input v-model="keyword" type="search" placeholder="搜索站点 id…" class="search" />
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
      <div v-if="loading" class="hint">加载定义中…</div>
      <div v-else-if="error" class="hint error">{{ error }}</div>
      <template v-else-if="selected">
        <h2>{{ selected.name ?? selectedId }}</h2>
        <table class="detail">
          <tbody>
            <tr>
              <th>id</th>
              <td>{{ selectedId }}</td>
            </tr>
            <tr>
              <th>schema</th>
              <td>{{ selected.schema }}</td>
            </tr>
            <tr>
              <th>type</th>
              <td>{{ selected.type }}</td>
            </tr>
            <tr v-if="selected.tags?.length">
              <th>tags</th>
              <td>
                <span v-for="tag in selected.tags" :key="tag" class="tag">{{ tag }}</span>
              </td>
            </tr>
            <tr>
              <th>urls</th>
              <td>
                <div v-for="url in selected.urls" :key="url" class="url">{{ url }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <div v-else class="hint">← 点击左侧站点查看按需加载的定义元数据</div>
    </section>
  </div>
</template>
