# Vuetify → antdv-next 迁移规范

UI 框架已从 Vuetify 4 换成 **antdv-next**（`antdv-next` 的 `App` 是全局安装插件，
已在 `src/options/plugins/antd.ts` 注册，模板里直接写 `a-xxx` 即可，无需 import）。

样式走 antdv-next 的 CSS-in-JS，**运行时注入 `<style>`**，不再有「构建期拆 CSS chunk +
动态 `<link>` 注入」那条链路 —— 那条链路在扩展页里加载不可靠（表现为页面完全没有表格样式）。

> Vuetify 的**原子类**（`pa-0` `text-no-wrap` `text-red` `d-flex` 等）已复刻到
> `src/entrypoints/options/vuetify-compat.css`，**这些可以保留不动**，只改组件标签。

## 标签映射表

| Vuetify | antdv-next | 备注 |
|---|---|---|
| `<v-btn>` | `<a-button>` | `variant="text/elevated"` → `type="text/default"`；`color` → `type`（primary/default/dashed/text/link）或 `danger`/`success`/`warning` |
| `<v-icon :icon="'mdi-x'">` | 从 `@antdv-next/icons` **具名导入**图标组件后 `<component :is="XxxOutlined" />` | **禁止** `import * as Icons`（1760 个模块全进包） |
| `<v-row>` / `<v-col>` | `<a-row>` / `<a-col>` | 或直接用 flex div（`d-flex` 等原子类已在兼容层） |
| `<v-container>` / `<v-spacer>` / `<v-divider>` | `<div>` / `<div style="flex:1">` / `<a-divider>` | spacer 用 `flex-1-1-0` 类即可 |
| `<v-card>` `<v-card-title>` `<v-card-text>` `<v-card-actions>` | `<a-card>` `<template #title>` 正文 `<template #extra>` | |
| `<v-list>` `<v-list-item>` `<v-list-item-title>` `<v-list-item-subtitle>` `<v-list-subheader>` | `<a-menu>` `<a-menu-item>` / `<a-list>` `<a-list-item>` | 导航类用 Menu，静态列表用 List |
| `<v-text-field>` | `<a-input v-model:value>` | `label`→`placeholder`；`clearable` 同名；`density="compact"` → `size="small"` |
| `<v-textarea>` | `<a-textarea v-model:value>` | |
| `<v-select>` | `<a-select v-model:value :options="[{value,label}]">` | options 从 Vuetify 的 `item-title/item-value` 改成 `{value,label}` 对象 |
| `<v-combobox>` | `<a-auto-complete v-model:value>` | 最接近的替代 |
| `<v-switch>` | `<a-switch v-model:checked>` | |
| `<v-checkbox>` | `<a-checkbox v-model:checked>` | |
| `<v-slider>` / `<v-range-slider>` | `<a-slider v-model:value>` / `v-model:value="[a,b]"` | |
| `<v-number-input>` | `<a-input-number v-model:value>` | |
| `<v-date-picker>` | `<a-date-picker>` | |
| `<v-dialog>` | `<a-modal v-model:open>` | `#title` / `#footer` 具名插槽；`:footer="null"` 可去掉底部 |
| `<v-menu>` | `<a-dropdown>` | 或 `<a-popover>`（纯展示浮层） |
| `<v-tooltip>` | `<a-tooltip>` | |
| `<v-chip>` | `<a-tag>` | `:closable` 同名 |
| `<v-alert>` | `<a-alert>` | `type="error/warning/success/info"` |
| `<v-progress-linear>` | `<a-progress>` | `:model-value` 而非 `v-model` |
| `<v-avatar :image>` | `<img>` | |
| `<v-img>` | `<a-image>` 或 `<img>` | 纯占位图用 `<img>` 更轻 |
| `<v-skeleton-loader>` | `<a-skeleton>` / `<a-skeleton-button>` | |
| `<v-data-table>` | `<a-table>` | **差异最大，见下** |
| `<v-window>` / `<v-window-item>` | `<a-tabs>` / `<a-tab-pane>` | |
| `<v-expansion-panels>` / `<v-expansion-panel>` | `<a-collapse>` / `<a-collapse-panel>` | |
| `<v-chip-group>` | `<a-segmented>` | |
| `<v-snackbar-queue>` | 已在 `App.vue` 里桥接到 `message` API，**视图里不用管** | |
| `<v-file-input>` | `<a-upload>` | 或 `<input type="file">` |

## `v-data-table` → `a-table`：差异最大，重点

Vuetify 是 `headers` + `items` + `#item.<key>` 插槽模型；antd 是 `columns` + `#bodyCell` 模型。

```vue
<!-- Vuetify -->
<v-data-table :headers="headers" :items="rows" item-value="id">
  <template #item.name="{ item }">{{ item.name }}</template>
</v-data-table>

<!-- antdv-next -->
<a-table :columns="columns" :data-source="rows" :row-key="(r) => r.id" :pagination="false" size="small">
  <template #bodyCell="{ column, record }">
    <template v-if="column.key === 'name'">{{ record.name }}</template>
  </template>
</a-table>
```

列定义从 `{ title, key, align, props, width, sortable }` 改成 antd 的
`ColumnType`：`{ title, dataIndex, key, align, width, sorter, ellipsis }`。

## 原样保留不动的

- 全部 `<script setup>` 业务逻辑、store 调用、消息通信
- 全部 Vuetify 原子类（已在 `vuetify-compat.css`）
- `useAdvanceFilter.ts` 指令 —— 它**不 import vuetify**，是纯函数式，直接复用
- `runtimeStore.showSnakebar(...)` 调用点 —— 已在 App.vue 桥接

## 需要一并处理的 vuetify 耦合点

| 位置 | 处理 |
|---|---|
| `import { useDisplay } from "vuetify/framework"` | 改用 antd 的 `useBreakpoint()`（返回 `{ xs, sm, md, lg, xl }` 的 refs），或直接去掉响应式分支 |
| `import type { DataTableHeader } from "vuetify"` | 本地定义列类型，见上文 ColumnType |
| `icon="mdi-xxx"`（字符串） | 具名导入图标组件后传 `:icon="XxxOutlined"` |

## 硬性要求

1. **不许编造**：拿不准的 API 去 `node_modules/antdv-next/dist/**/*.d.ts` 查真实签名，不要照记忆写
2. 改完必须 `pnpm compile`（vue-tsc）通过
3. 不要改动 `<script setup>` 里的业务逻辑，只做模板层的组件替换