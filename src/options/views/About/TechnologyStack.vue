<script setup lang="ts">
/**
 * 项目参考与引用页（antdv-next 平移）。
 * PT 助手历代项目时间线 + 依赖清单（localStorage 缓存，异步补全 npm homepage）。
 *
 * 这张表是「**当前** package.json 依赖清单」+ 几个常驻的关联项目（见 SEED_ITEMS）：
 *  - 依赖以 package.json 为准，每轮重新对齐 —— 从 package.json 里删掉的依赖会跟着消失
 *    （原先用 `??=` 累加，删掉的包永远留在表里，表只会越积越多）；
 *  - homepage 查询失败**不写 version**，下一轮还会重试（原先在 finally 里无条件写，
 *    一次失败就把该条目永久标记成「已同步」，此后永远停在 npmjs 兜底链接）。
 */
import axios from "axios";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLocalStorage } from "@vueuse/core";
import type { TablePaginationConfig } from "antdv-next";

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

const technologyData = useLocalStorage<Record<ITDataName, ITData>>("PTD_TechnologyData", {});

const npmjsPrefix = "https://www.npmjs.com/package/";

/** 常驻条目：不是 package.json 的依赖，但与本项目相关（当初就写在 localStorage 初始值里） */
const SEED_ITEMS: Record<ITDataName, ITData> = {
  Jackett: {
    name: "Jackett",
    version: "latest",
    url: "https://github.com/Jackett/Jackett",
  },
};

const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

// 把表对齐到「当前 package.json 的依赖 + 常驻条目」。
// 原先用 `??=` 逐个累加、从不清掉已删的依赖 —— 换掉一个包之后它永远留在表里，
// 而这张表的标题写的是「依赖清单」，用户会当成现状清单看。
const synced: Record<ITDataName, ITData> = { ...SEED_ITEMS };

Object.entries(deps).forEach(([name, version]) => {
  // 沿用上轮查到的 homepage（若它不是兜底链接），但 version 以 package.json 为准
  const prev = technologyData.value[name];
  synced[name] = {
    name,
    version: prev?.version ?? "",
    url: prev?.url ?? `${npmjsPrefix}${name}`,
  };

  // version 已是这一档、且 homepage 已不是兜底链接 → 无需再查
  if (synced[name].version === version && !synced[name].url.startsWith(npmjsPrefix)) {
    return;
  }

  axios
    .get(`https://registry.npmjs.org/${name}`, { timeout: 10e3 })
    .then(({ data }) => {
      // ⚠️ 必须走 technologyData.value 改，不能改上面那个 synced：
      // `technologyData.value = synced` 之后 ref 存的是 reactive(synced) 这个**代理**，
      // 而 deep watch 的依赖是顺着代理收集的 —— 实测（.tmp-build/reactive-raw-test.mjs）
      // 写代理触发一次、写 raw 的 synced 一次都不触发。所以照作者那样写的话，
      // 查回来的 homepage 既不重渲染也不落 localStorage：这张表永远停在兜底链接，
      // 而且 version 也存不下，每次进页面都把全部依赖重查一遍。
      const entry = technologyData.value[name];
      entry.url = data?.homepage ?? `${npmjsPrefix}${name}`;
      // ⚠️ 只在**成功**时写 version：原先在 finally 里无条件写，于是网络抖一下
      // 就把这个版本号永久标记成「已同步」，此后每次进来都跳过查询 ——
      // 「查询失败时保留 npmjs 兜底链接」实际上变成「永久停在兜底」。
      entry.version = version;
    })
    .catch(() => {
      // 查询失败：保留兜底链接，且**不写 version** —— 下一轮还会重试
    });
});

technologyData.value = synced;

const columns = computed(() => [
  { title: t("common.name"), dataIndex: "name", key: "name", sorter: (a: ITData, b: ITData) => a.name.localeCompare(b.name), defaultSortOrder: "ascend" as const },
  { title: t("common.version"), dataIndex: "version", key: "version", align: "center" as const },
  { title: t("TechnologyStack.stackTableColumn.homepage"), dataIndex: "url", key: "url" },
]);

const tableDependencies = computed<ITData[]>(() => Object.values(technologyData.value));

/** 一页放得下就不出分页条（用户 2026-10-07：条数少的时候不要启用分页）。本页不分档、固定 50 条 */
const tablePagination = computed<TablePaginationConfig | false>(() =>
  tableDependencies.value.length <= 50 ? false : { pageSize: 50, showSizeChanger: true },
);
</script>

<template>
  <div class="technology-stack page-fill">
    <a-alert :title="t('TechnologyStack.thankNote')" type="info" show-icon class="block-alert" />

    <a-card :title="t('TechnologyStack.ptppHistory')" class="block-card">
      <!-- orientation="horizontal"：时间轴横向铺开，右侧才是最新一条（reverse 把数据里
           「最新在前」翻成「时间往右流」，横向读才不别扭）。mode="left" 在这里已经没有意义
           （组件把它映射成 start，而 start 本来就是默认值），所以去掉。 -->
      <a-timeline orientation="horizontal" reverse class="ptpp-history">
        <a-timeline-item v-for="history in ptppHistory" :key="history.name" :color="history.color">
          <template #label>{{ history.time }}</template>
          <strong>{{ history.name }}</strong>
          <br />
          <a :href="history.link" rel="noopener noreferrer nofollow" target="_blank">{{ history.link }}</a>
        </a-timeline-item>
      </a-timeline>
    </a-card>

    <a-card :title="t('TechnologyStack.dependency')" class="block-card page-fill-grow">
      <a-table
        bordered
        :columns="columns"
        :data-source="tableDependencies"
        :pagination="tablePagination"
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
/* 页面自身不再补 padding：外层 .content 已经留了 8px，叠上来就是 24px，
   与「灰只露 8px 缝」的口径不一致。 */
.technology-stack {
  padding: 0;
}
.block-alert {
  margin-bottom: 12px;
}
.block-card {
  margin-top: 12px;
}
/* 横向时间轴每列只分到 1/4 宽，而链接是一整串没有空格的文本、默认不断行，
   窄窗口下会直接压到相邻列上。 */
.ptpp-history :deep(a) {
  overflow-wrap: anywhere;
}
</style>
