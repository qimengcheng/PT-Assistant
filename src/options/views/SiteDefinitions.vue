<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { definitionList, getDefinedSiteMetadata } from "@ptd/site";
import type { ISiteMetadata } from "@ptd/site";
import type { TableColumnsType } from "antdv-next";

/**
 * 开发调试视图：展示全部站点定义 id（同步，零开销），
 * 点击某个站点时才通过 getDefinedSiteMetadata() 动态 import 对应的 definition chunk ——
 * 这是「340 个定义按需加载」架构的直接验证。
 *
 * 所以左表**只有 id**：id 来自 import.meta.glob 的键，是同步零开销的；
 * 一旦要显示站点名就得加载那个 chunk，这个页面要验证的东西就被自己破坏了。
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

// ===== 两张表的高度：实测容器，而不是 calc(100vh - N) =====
// 页面嵌在 .content（flex 撑满 100vh、自带 padding 与 overflow-y:auto）里，
// 头部工具条、卡片 padding、表头高度都不是常量，写死 calc 必然在某处对不上
// （表现为底部露灰底、或表头被切掉一半）。ResizeObserver 量的是实际可用高度。
const listBodyRef = ref<HTMLElement | null>(null);
const detailBodyRef = ref<HTMLElement | null>(null);
const listScrollY = ref(400);
const detailScrollY = ref(400);

let observer: ResizeObserver | null = null;

function measure(el: HTMLElement | null, fallback: number): number {
  if (!el) return fallback;
  // 表头（约 40px）由 a-table 自己固定在顶部，滚动区要把它让出来
  return Math.max(120, el.clientHeight - 40);
}

onMounted(() => {
  const update = () => {
    listScrollY.value = measure(listBodyRef.value, listScrollY.value);
    detailScrollY.value = measure(detailBodyRef.value, detailScrollY.value);
  };
  observer = new ResizeObserver(update);
  if (listBodyRef.value) observer.observe(listBodyRef.value);
  if (detailBodyRef.value) observer.observe(detailBodyRef.value);
  update();
});

onBeforeUnmount(() => observer?.disconnect());

// ===== 左表：站点定义 id 清单 =====

interface IDefinitionRow {
  /** 该 id 在 definitionList 里的原始下标，用于「№」列 —— 搜索过滤后仍显示原始序号 */
  index: number;
  id: string;
}

const siteColumns: TableColumnsType<IDefinitionRow> = [
  { title: "№", dataIndex: "index", key: "index", align: "center", width: 56 },
  { title: t("SiteDefinitions.colId"), dataIndex: "id", key: "id" },
];

const siteRows = computed<IDefinitionRow[]>(() =>
  filteredList.value.map((id) => ({ index: definitionList.indexOf(id) + 1, id })),
);

/** 当前行高亮。rowClassName 是 Table 声明的 prop（实测在注册表里），不是死属性 */
function rowClassName(record: IDefinitionRow) {
  return record.id === selectedId.value ? "site-row-selected" : "";
}

// ===== 右表：选中站点的元数据 =====

interface IFieldRow {
  key: string;
  /** 字段名（英文，对齐源码里的 ISiteMetadata 键） */
  name: string;
  /** 字段含义（中文，走 i18n） */
  label: string;
  /** 短摘要：文本类字段是值本身，结构类字段是「N 项」 */
  summary: string;
  /** 结构类字段的格式化 JSON；文本类字段为 undefined */
  json?: string;
}

/**
 * 结构类字段：默认折叠。
 * 它们的值是 selector / process 这类深层对象，JSON.stringify 后动辄上千字符
 * 且**不带换行**（JSON.stringify(v, null, 2) 才有，但一屏仍然全是噪音）。
 * 直接铺在单元格里会把整张表变成一堵墙 —— 所以行内只留「N 项」摘要，
 * 点开才在折叠区里看。
 */
const STRUCT_KEYS = new Set([
  "officialGroupPattern",
  "noLoginAssert",
  "search",
  "searchEntry",
  "list",
  "detail",
  "download",
  "userInfo",
  "levelRequirements",
  "userInputSettingMeta",
]);

/**
 * RegExp / function 不能 JSON.stringify（前者变 {}、后者被整个丢掉）。
 * officialGroupPattern 全是 RegExp 数组（实测 13city.ts:147 等），
 * 直接 stringify 会把整条规则显示成 `[{}]` —— 等于白显示。
 * 所以先做一次带 replacer 的归一：RegExp 转字面量、函数转标记、循环引用转标记。
 */
function normalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof RegExp) return value.toString();
  if (typeof value === "function") return "[Function]";
  if (value instanceof Set) return [...value].map((v) => normalize(v, seen));
  if (value instanceof Map) return Object.fromEntries(value);
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => normalize(v, seen));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v, seen)]),
    );
  }
  return value;
}

/** 文本类字段的展示值：数组每项一行；对象转 JSON */
function plainLines(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "object" && v !== null ? JSON.stringify(normalize(v)) : String(v)))
      .filter(Boolean);
  }
  if (typeof value === "object") return [JSON.stringify(normalize(value))];
  return [String(value)];
}

/** 结构类字段的「N 项」摘要：数组看长度、对象看键数 */
function structSummary(value: unknown): string {
  if (Array.isArray(value)) return t("SiteDefinitions.itemCount", [value.length]);
  if (value !== null && typeof value === "object")
    return t("SiteDefinitions.keyCount", [Object.keys(value).length]);
  return String(value);
}

const fieldRows = computed<IFieldRow[]>(() => {
  const meta = selected.value;
  if (!meta) return [];

  const rows: IFieldRow[] = [];
  const push = (key: keyof ISiteMetadata & string, value: unknown) => {
    if (value === undefined || value === null) return;
    const isStruct = STRUCT_KEYS.has(key);
    if (!isStruct && plainLines(value).length === 0) return;
    rows.push({
      key,
      name: key,
      label: t(`SiteDefinitions.field.${key}`),
      summary: isStruct ? structSummary(value) : plainLines(value).join(" / "),
      json: isStruct ? JSON.stringify(normalize(value), null, 2) : undefined,
    });
  };

  // 顺序按「看一个站点定义时最想知道什么」排：叫什么、是什么站、用的哪套模板、地址是什么。
  // id 挪到最后当键 —— 它是查表用的，不是判断用的。
  push("name", meta.name);
  push("aka", meta.aka);
  push("type", meta.type);
  push("schema", meta.schema);
  push("urls", meta.urls);
  push("tags", meta.tags);
  push("description", meta.description);
  push("version", meta.version);
  push("timezoneOffset", meta.timezoneOffset);
  push("collaborator", meta.collaborator);
  push("category", meta.category);
  push("legacyUrls", meta.legacyUrls);
  push("favicon", meta.favicon);
  push("isDead", meta.isDead);
  push("requestDelay", meta.requestDelay);
  push("officialGroupPattern", meta.officialGroupPattern);
  push("noLoginAssert", meta.noLoginAssert);
  push("search", meta.search);
  push("searchEntry", meta.searchEntry);
  push("list", meta.list);
  push("detail", meta.detail);
  push("download", meta.download);
  push("userInfo", meta.userInfo);
  push("levelRequirements", meta.levelRequirements);
  push("userInputSettingMeta", meta.userInputSettingMeta);
  push("id", selectedId.value);

  return rows;
});

const fieldColumns: TableColumnsType<IFieldRow> = [
  { title: t("SiteDefinitions.colField"), dataIndex: "name", key: "name", width: 200 },
  { title: t("SiteDefinitions.colValue"), dataIndex: "summary", key: "summary" },
];

/** 结构类字段的行才可展开 */
const expandedKeys = ref<string[]>([]);
function rowExpandable(record: IFieldRow) {
  return record.json !== undefined;
}
</script>

<template>
  <a-flex gap="small" class="site-defs">
    <!-- 左表：站点定义清单。点行即联动右表 -->
    <a-card size="small" class="site-defs-list" :title="t('SiteDefinitions.title')">
      <template #extra>
        <span class="site-defs-count">{{ filteredList.length }} / {{ definitionList.length }}</span>
      </template>

      <a-input
        v-model:value="keyword"
        allow-clear
        size="small"
        :placeholder="t('SiteDefinitions.searchPlaceholder')"
        class="site-defs-search"
      />

      <div ref="listBodyRef" class="site-defs-table">
        <a-table
          :columns="siteColumns"
          :data-source="siteRows"
          :pagination="false"
          :row-class-name="rowClassName"
          :scroll="{ y: listScrollY }"
          row-key="id"
          size="small"
          :on-row="
            (record: IDefinitionRow) => ({
              onClick: () => viewSite(record.id),
            })
          "
        />
      </div>
    </a-card>

    <!-- 右表：选中站点的元数据 -->
    <a-card
      size="small"
      class="site-defs-detail"
      :title="selected?.name ?? selectedId ?? t('SiteDefinitions.title')"
    >
      <a-spin :spinning="loading">
        <a-alert v-if="error" type="error" show-icon :message="error" class="site-defs-error" />

        <div v-else ref="detailBodyRef" class="site-defs-table">
          <a-table
            v-if="fieldRows.length > 0"
            v-model:expanded-row-keys="expandedKeys"
            :columns="fieldColumns"
            :data-source="fieldRows"
            :pagination="false"
            :expandable="{ rowExpandable }"
            :scroll="{ y: detailScrollY }"
            row-key="key"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <!-- 字段名：英文在上（对齐源码键），中文说明在下（不占列宽，所以不会换行） -->
              <template v-if="column.key === 'name'">
                <div class="site-defs-key">{{ (record as IFieldRow).name }}</div>
                <div class="site-defs-key-hint">{{ (record as IFieldRow).label }}</div>
              </template>

              <template v-else-if="column.key === 'summary'">
                <span :class="{ mono: (record as IFieldRow).json !== undefined }">
                  {{ (record as IFieldRow).summary }}
                </span>
              </template>
            </template>

            <!-- 结构类字段展开后的 JSON：限高 + 内部滚动，不把整表撑长 -->
            <template #expandedRowRender="{ record }">
              <pre class="site-defs-json">{{ (record as IFieldRow).json }}</pre>
            </template>
          </a-table>

          <a-empty v-else :description="t('SiteDefinitions.selectHint')" class="site-defs-empty" />
        </div>
      </a-spin>
    </a-card>
  </a-flex>
</template>

<style scoped>
/* 两张卡等高铺满内容区：.content 是 flex:auto 撑满 100vh 并带 8px padding。
   关键是「卡片 → card body → 表格容器」整条链都要做成 flex 列 —— 只要有一环是
   普通块级，容器高度就由表格内容决定，下面的 ResizeObserver 量的就不再是
   「可用高度」而是「表格自己撑出来的高度」，反推回 :scroll y 成了自我引用，
   最终塌到 measure() 的 120px 下限（表现为卡片满高、列表却只有三行）。 */
.site-defs {
  height: 100%;
  align-items: stretch;
}

.site-defs-list,
.site-defs-detail {
  display: flex;
  flex-direction: column;
}

/* 宽度：左卡固定 300px（340 个 id 最长也就十来个字符，再宽只是浪费），
   右卡吃掉剩余宽度。 */
.site-defs-list {
  flex: 0 0 300px;
}

.site-defs-detail {
  flex: 1;
  min-width: 0;
}

.site-defs-list :deep(.ant-card-body),
.site-defs-detail :deep(.ant-card-body) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 右卡多一层 a-spin。antdv-next 的嵌套 Spin 是 `.ant-spin` > `.ant-spin-container`
   （dist/spin/index.js:85-107），**没有** React 版那个 `.ant-spin-nested-loading`，
   照旧类名写选择器会静默落空、高度链在这里断掉。两层都要传高度。 */
.site-defs-detail :deep(.ant-spin),
.site-defs-detail :deep(.ant-spin-container) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.site-defs-count {
  color: var(--pt-color-text-secondary);
  font-size: 12px;
}

.site-defs-search {
  margin-bottom: 8px;
}

/* 表格容器吃掉剩余高度（min-height:0 是关键，
   否则 flex 项不肯小于内容高度，撑破卡片）。 */
.site-defs-table {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.site-defs-error,
.site-defs-empty {
  margin-top: 24px;
}

.site-defs-key {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  line-height: 1.4;
}

.site-defs-key-hint {
  color: var(--pt-color-text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.site-defs-json {
  max-height: 320px;
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  background: var(--pt-color-bg-hover);
  border-radius: 4px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.mono {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
</style>

<style>
/* 行高亮：rowClassName 返回的类名落在 <tr> 上，而 <tr> 是组件内部节点，
   scoped 选择器选不到它（组件的 scoped 属性只加在组件根和子组件根上），
   所以这条必须是全局的。 */
.site-row-selected > td {
  background: var(--pt-color-bg-selected) !important;
  font-weight: 600;
}
</style>
