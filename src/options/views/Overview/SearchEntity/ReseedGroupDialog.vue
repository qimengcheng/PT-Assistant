<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { type TableColumnsType } from "antdv-next";
import { BranchesOutlined } from "@antdv-next/icons";
import { ETorrentStatus } from "@ptd/site";

import { formatSize } from "@/options/utils.ts";
import { torrentStatusMeta } from "./torrentStatusMeta.ts";
import type { IReseedGroup } from "@/shared/bestReseed.ts";
import type { ISearchResultTorrent } from "@/shared/types/storages/runtime.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

/**
 * 「更多辅种组合」：把这一批结果里**每一档**被 ≥2 个站点共有的种子都列出来让人挑。
 *
 * 为什么要有这一屏：工具条那颗 chip 只给「最多站点共有」的那一档，而它往往也是**最大**的一档
 * （一部剧的全集 2160p）。想辅同一部内容里更小的那一档时 chip 帮不上 —— 他得自己按大小排序、
 * 扫哪一档重复最多、再逐条勾。这一屏把那三步做掉了。
 *
 * 挑完一行不在这里建任务：那一组交给辅种检测弹窗，验证、下载服务器、保存路径、标签、自动辅种
 * 都在那边 —— 那颗 chip 点进去的就是同一个弹窗，所以这里不复制任何一项能力，只多一层「选哪一组」。
 */
const showDialog = defineModel<boolean>();
const { groups } = defineProps<{
  /** 打开那一刻的快照，由父组件负责（结果是一站一站陆续回包的，开着换列表会对不上账） */
  groups: IReseedGroup<ISearchResultTorrent>[];
}>();

const emit = defineEmits<{ (e: "pick", group: IReseedGroup<ISearchResultTorrent>): void }>();

const { t } = useI18n();

/** 一行 = 一档。界面上要读的东西在这里一次算完，模板里不再做判据 */
interface IRow {
  /** 分组就是按字节数分的，所以它天然唯一，当 row-key 用 */
  size: number;
  sizeText: string;
  rowCount: number;
  siteCount: number;
  /** 组里有几条被站点报成「正在做种」（判据在 `shared/bestReseed.ts`） */
  seedingCount: number;
  /** 这一组一条状态都报不出时那一格留空 —— 画个 0 会把「没查到」说成「确认没有」 */
  statusKnown: boolean;
  /** 去重后的站点，最多取前 6 颗画图标，剩下的折成「+N」 */
  icons: string[];
  /** 没画成图标的那些还剩几个 */
  restSites: number;
  title: string;
  /** 旁边那颗 chip 给的就是这一档（按传进来的名次判，不看界面第几行） */
  isBest: boolean;
  /** 传进来的名次（站点数 → 条数 → 大小），重排后分区内部照它排 */
  rank: number;
  group: IReseedGroup<ISearchResultTorrent>;
}

/** 「在做种」那一格的图标与颜色：与搜索页那一列同一档，不另挑一个绿 */
const seedingMeta = torrentStatusMeta(ETorrentStatus.seeding);

const rows = computed<IRow[]>(() => {
  const list = groups.map((group, rank) => {
    const seen: string[] = [];
    const all = new Set<string>();
    for (const item of group.items) {
      const site = String(item.site ?? "");
      if (!site || all.has(site)) continue;
      all.add(site);
      if (seen.length < 6) seen.push(site);
    }
    return {
      size: group.size,
      // formatSize 的返回类型是 string | number（它 catch 分支原样回吐入参），这里统一成字符串
      sizeText: String(formatSize(group.size)),
      rowCount: group.items.length,
      siteCount: group.siteCount,
      seedingCount: group.seedingCount,
      statusKnown: group.statusKnown,
      icons: seen,
      restSites: Math.max(0, group.siteCount - seen.length),
      // 一组里各条标题通常不同（各站自己写的），取第一条当这一档的"这是什么内容"
      title: String(group.items[0]?.title ?? ""),
      isBest: rank === 0,
      rank,
      group,
    };
  });
  /**
   * 已经在做种的那一档排到最前（用户 2026-10-11 提的）：那份数据本来就在盘上，
   * 挑这一档其余各站都是纯辅、不用重下一次。
   * 两个分区**内部**仍按传进来的名次（站点数 → 条数 → 大小）排，所以「最多站点共有」
   * 那颗标记跟着它自己那一行走（上面那条 `isBest`），不再看界面第几行 —— 否则重排之后
   * 标记会留在错的那一行上，而说明条里写的就是「第一行即最佳」。
   */
  return [...list].sort((a, b) => Number(b.seedingCount > 0) - Number(a.seedingCount > 0) || a.rank - b.rank);
});

const columns = computed<TableColumnsType<IRow>>(() => [
  { title: t("SearchEntity.reseedGroups.colSize"), key: "size", width: 104, align: "end" },
  { title: t("SearchEntity.reseedGroups.colRows"), key: "rows", width: 76, align: "end" },
  // 84 = 表头三字实测 39 + 内衬 16×2 + 余量（这一列要容得下「数字 + 一颗 14px 图标」）
  { title: t("SearchEntity.reseedGroups.colSeeding"), key: "seeding", width: 84, align: "end" },
  { title: t("SearchEntity.reseedGroups.colSites"), key: "sites", width: 200 },
  // 标题列**故意不给 width**：它是吃剩余宽度那一列（见下面模板那条 table-layout 注释）。
  { title: t("SearchEntity.reseedGroups.colTitle"), key: "title" },
  { title: t("SearchEntity.reseedGroups.colAction"), key: "action", width: 116 },
]);

/** `#bodyCell` 的 record 是 antd 的 AnyObject（各字段 any），集中在这里收窄一次 */
function rowOf(record: unknown): IRow {
  return record as IRow;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :title="t('SearchEntity.reseedGroups.title')" :width="960">
    <!-- 说明条写在内容区，不塞 #title：那个标题栏没有内衬，塞东西必和右上角 X 相撞 -->
    <a-alert type="info" show-icon class="intro">
      <template #message>{{ t("SearchEntity.reseedGroups.intro") }}</template>
    </a-alert>

    <!-- table-layout 必须显式给 fixed：不给档位时 rc-table 判出来是 auto（这张表没有 scroll.y、
         没有固定列、没有 resizable、列上也没写 ellipsis），而 auto 档位下 <table> 是按内容长出来的 ——
         台架量到表宽 1266 / 容器 741，四列写死的宽度一个都没生效（116/92/232/116 实测成 48/30/140/84），
         标题那一列被最长那条种子名撑到 964。改成 fixed 之后 col 才作数，剩余宽度归不给 width 的标题列。 -->
    <a-table
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      row-key="size"
      size="small"
      bordered
      table-layout="fixed"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'size'">
          <span class="size-text">{{ rowOf(record).sizeText }}</span>
        </template>

        <template v-else-if="column.key === 'rows'">{{ rowOf(record).rowCount }}</template>

        <!-- 整组一条状态都报不出时留空（只有 37/340 个站点定义报得出这一列）：
             画个 0 会把「没查到」说成「确认没有」，而这一格正是用来分派的。 -->
        <template v-else-if="column.key === 'seeding'">
          <a-tooltip v-if="rowOf(record).statusKnown" :title="t('SearchEntity.reseedGroups.seedingTip')">
            <span class="d-flex justify-end">
              <span>{{ rowOf(record).seedingCount }}</span>
              <component
                :is="seedingMeta.icon"
                v-if="rowOf(record).seedingCount > 0"
                class="cell-icon"
                :style="{ color: seedingMeta.color }"
              />
            </span>
          </a-tooltip>
        </template>

        <template v-else-if="column.key === 'sites'">
          <span class="site-line">
            <span class="site-count">{{ rowOf(record).siteCount }}</span>
            <SiteFavicon v-for="siteId in rowOf(record).icons" :key="siteId" :site-id="siteId" :size="18" />
            <span v-if="rowOf(record).restSites" class="site-more">+{{ rowOf(record).restSites }}</span>
          </span>
        </template>

        <template v-else-if="column.key === 'title'">
          <span class="title-line">
            <!-- 这一行就是旁边那颗 chip 给的那一档，标出来是为了让这两处对得上号。
                 按身份判（`isBest`）而不是按界面第几行 —— 已经在做种的那一档现在排在最前，
                 看 index 会把标记留在错的那一行上。 -->
            <a-tag v-if="rowOf(record).isBest" color="green" class="best-tag">
              <span class="tag-inner"><BranchesOutlined />{{ t("SearchEntity.reseedGroups.best") }}</span>
            </a-tag>
            <!-- 截断必须挂在**那一列的 flex 子项自己**身上：text-overflow 只对块级/被块化的盒生效，
                 行内 <span> 上写了等于没写（台架量到 clientWidth 与 scrollWidth 都是 0）。
                 popover 在子节点在位时不生成包装元素，所以这一颗 span 就是 .title-line 的 flex item。 -->
            <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
              <template #content>
                <div class="reveal-text">{{ rowOf(record).title }}</div>
              </template>
              <span class="title-text text-truncate">{{ rowOf(record).title }}</span>
            </a-popover>
          </span>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-button type="primary" size="small" @click.stop="emit('pick', rowOf(record).group)">
            {{ t("SearchEntity.reseedGroups.use") }}
          </a-button>
        </template>
      </template>
    </a-table>
  </a-modal>
</template>

<style scoped lang="scss">
.intro {
  margin-bottom: 12px;
}

.size-text {
  font-variant-numeric: tabular-nums;
}

/**
 * 「N 个站点」那一列：数字 + 一串站点图标排成一行。
 * inline-flex 要钉 height 并补 vertical-align: middle，否则各行不同高、图标排不齐（AGENTS §3.4）。
 */
.site-line {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  vertical-align: middle;
}

.site-count {
  font-weight: 600;
  min-width: 18px;
}

.site-more {
  font-size: 12px;
  opacity: 0.65;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 这一列是唯一不给 width 的那列。flex 子项默认 min-width:auto，超长标题会把整张表顶宽，
     所以这里要允许收缩，截断交给下面那条 flex: 1 1 0 + .text-truncate。 */
  min-width: 0;
}

.best-tag {
  flex: 0 0 auto;
  margin-inline-end: 0;
}

.tag-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.title-text {
  flex: 1 1 0;
  min-width: 0;
}

.reveal-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
