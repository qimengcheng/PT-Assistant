<script setup lang="ts">
/**
 * 项目参考与引用页（antdv-next 平移）。
 * PT 助手历代项目时间线 + 依赖清单（localStorage 缓存，异步补全 npm homepage）。
 *
 * ⚠️ 原注释说「**当前** package.json 依赖清单」——与实现不符，实际是个**只增不减的历史并集**：
 *  - :49 用 `??=`，从 package.json 里删掉的依赖会永远留在表里，不会消失；
 *  - :67 的 finally **无条件**写 version，查询失败的条目也被永久标记为「已同步」，
 *    下一轮不再重查，「保留 npmjs 兜底链接」实际上是**永久停在兜底**。
 * 所以这张表只会越积越多、也修不回来 —— 当成「看过的依赖的并集」，别当现状清单。
 */
import axios from "axios";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLocalStorage } from "@vueuse/core";

import pkg from "../../../../package.json";
import { REPO_URL } from "~/helper.ts";

const { t } = useI18n();

interface IHistoryItem {
  name: string;
  time: string;
  link: string;
  color?: string;
}

const ptppHistory = computed<IHistoryItem[]>(() => [
  { name: "PT Depiler", time: "2020-10-25", link: REPO_URL, color: "blue" },
  { name: "PT Plugin Plus", time: "2018-12-16", link: "https://github.com/ronggang/PT-Plugin-Plus" },
  { name: t("TechnologyStack.ptppHistoryItem.ptPluginRhilip"), time: "2018-04-18", link: "https://github.com/Rhilip/PT-Plugin" },
  { name: "PT Plugin", time: "2014-10-10", link: "https://github.com/ronggang/PT-Plugin" },
]);

type ITDataName = string;
interface ITData {
  name: ITDataName;
  version: string;
  url: string;
}

const technologyData = useLocalStorage<Record<ITDataName, ITData>>("PTD_TechnologyData", {
  Jackett: {
    name: "Jackett",
    version: "latest",
    url: "https://github.com/Jackett/Jackett",
  },
});

const npmjsPrefix = "https://www.npmjs.com/package/";

// 从 package.json 载入依赖；版本变化时异步向 npm registry 查询 homepage
Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).forEach(([name, version]) => {
  technologyData.value[name] ??= {
    name,
    version: "",
    url: `${npmjsPrefix}${name}`,
  };

  if (
    technologyData.value[name].version !== version &&
    (technologyData.value[name].url ?? "").startsWith(npmjsPrefix)
  ) {
    axios
      .get(`https://registry.npmjs.org/${name}`)
      .then(({ data }) => {
        technologyData.value[name].url = data?.homepage ?? `${npmjsPrefix}${name}`;
      })
      .catch(() => {
        // 查询失败时保留 npmjs 兜底链接
      })
      .finally(() => {
        technologyData.value[name].version = version;
      });
  }
});

const columns = computed(() => [
  { title: t("common.name"), dataIndex: "name", key: "name", sorter: (a: ITData, b: ITData) => a.name.localeCompare(b.name), defaultSortOrder: "ascend" as const },
  { title: t("common.version"), dataIndex: "version", key: "version", align: "center" as const },
  { title: t("TechnologyStack.stackTableColumn.homepage"), dataIndex: "url", key: "url" },
]);

const tableDependencies = computed<ITData[]>(() => Object.values(technologyData.value));
</script>

<template>
  <div class="technology-stack">
    <a-alert :title="t('TechnologyStack.thankNote')" type="info" show-icon class="block-alert" />

    <a-card :title="t('TechnologyStack.ptppHistory')" class="block-card">
      <a-timeline mode="left">
        <a-timeline-item v-for="history in ptppHistory" :key="history.name" :color="history.color">
          <template #label>{{ history.time }}</template>
          <strong>{{ history.name }}</strong>
          <br />
          <a :href="history.link" rel="noopener noreferrer nofollow" target="_blank">{{ history.link }}</a>
        </a-timeline-item>
      </a-timeline>
    </a-card>

    <a-card :title="t('TechnologyStack.dependency')" class="block-card">
      <a-table
        :columns="columns"
        :data-source="tableDependencies"
        :pagination="{ pageSize: 50, showSizeChanger: true }"
        row-key="name"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'url'">
            <a :href="record.url" rel="noopener noreferrer nofollow" target="_blank">{{ record.url }}</a>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.technology-stack {
  padding: 16px;
}
.block-alert {
  margin-bottom: 12px;
}
.block-card {
  margin-top: 12px;
}
</style>
