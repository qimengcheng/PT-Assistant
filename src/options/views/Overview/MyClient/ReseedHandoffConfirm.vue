<script setup lang="ts">
/**
 * 「一键辅种」确认框里那一份清单：这一次要建的每一条，各自摆成「本地那条种子 → 要挂上去的站点」。
 *
 * 为什么要摆（用户 2026-10-19：「这个弹窗里能把具体哪些种子列出来吗?」）：确认框原先只有两个数
 * （几条内容、几个站点条目），而点下那颗键就是往他盘里推几十条种子。只有数字的确认框等于让人
 * 在没看到内容的情况下批一次条 —— 尤其这一批是**自动**算出来的（基准取下载器里那一份、
 * 目录取它实际所在那一层），人没有逐条过目的别处。
 *
 * 为什么单独成一个组件而不是在页面里 `h()` 拼节点：`modal.confirm` 的内容渲染在**另一棵组件树**里，
 * 页面模板的 scoped 样式选不到它（`h()` 造出来的节点不带页面的 `data-v-*`），只有组件自己的
 * scoped 样式跟着走。
 */
defineProps<{
  /** 上面那句总结：与背景那颗键同源的数字，仍由调用方那条 i18n 文案给 */
  summary: string;
  /** 列表上方那一行说明（「本地种子 → 要挂的站点」） */
  caption: string;
  rows: { name: string; sites: string[] }[];
}>();
</script>

<template>
  <div class="reseed-confirm">
    <p class="reseed-confirm__summary">{{ summary }}</p>
    <div class="reseed-confirm__caption">{{ caption }}</div>
    <ul class="reseed-confirm__list">
      <li v-for="(row, index) in rows" :key="index" class="reseed-confirm__item">
        <span class="reseed-confirm__index">{{ index + 1 }}</span>
        <div class="reseed-confirm__body">
          <div class="reseed-confirm__name">{{ row.name }}</div>
          <div class="reseed-confirm__sites">
            <span v-for="(site, siteIndex) in row.sites" :key="siteIndex" class="reseed-confirm__site">{{ site }}</span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.reseed-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reseed-confirm__summary {
  margin: 0;
}

.reseed-confirm__caption {
  color: var(--pt-color-text-secondary);
}

.reseed-confirm__list {
  /** 上限按视口给而不是死数（与 `MyClient/DeleteDialog.vue` 那个列表区同一档）：
   *  几十条要能一路滚完，而确认框不许长到看不见底下那两颗键。 */
  max-height: 45vh;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reseed-confirm__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.reseed-confirm__index {
  flex: 0 0 auto;
  min-width: 18px;
  text-align: right;
  color: var(--pt-color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.reseed-confirm__body {
  /** 种子名上百字符：不给 min-width:0，这一列就把整个 flex 项撑到不换行 */
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.reseed-confirm__name {
  /** 刻意换行而不是截断：这一屏的目的就是让人看清是哪几条，截断了就白列 */
  overflow-wrap: anywhere;
}

.reseed-confirm__sites {
  display: flex;
  flex-wrap: wrap;
  column-gap: 10px;
  row-gap: 2px;
  color: var(--pt-color-text-secondary);
}
</style>
