<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { isUndefined } from "es-toolkit/compat";
import {
  AlertOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from "@zboson/icons";
import { EResultParseStatus, type TSiteID } from "@ptd/site";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate, formatSize, formatTimeAgo } from "@/options/utils.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import ResultParseStatus from "@/options/components/ResultParseStatus.vue";

import UserLevelRequirementsTd from "./UserLevelRequirementsTd.vue";
import BonusFormatSpan from "./BonusFormatSpan.vue";
import HoverTip from "@/options/components/HoverTip.vue";

import { bonusFullText, formatRatio } from "./utils/format.ts";
import { flushSiteLastUserInfo, type IUserInfoItem } from "./utils/lastUserData.ts";

/**
 * 「我的数据」表格的一格。
 *
 * 主表和上面两块单列表（异常 / 低分享率）共用这一份渲染 —— 三处的列一旦对齐，
 * 格子里显示的东西才跟着对齐。原先是三处各抄一份：等级列一边是完整的升级要求组件、
 * 一边是裸文本，更新时间一边带浮层一边不带，同一个站在两块里看着不像同一行数据。
 *
 * 样式必须跟着模板走：`.site-cell` / `.site-unread-badge :deep(...)` / `.favicon-hover-*`
 * 这些是本组件 scoped 的规则，留在父页面里就选不到这里渲染出来的元素 —— 那颗未读徽章的
 * inset-inline-end 是按实测数字挪的（见下面那段注释），退回去就散了。
 */
defineProps<{
  column: { key?: string };
  record: IUserInfoItem;
}>();

const emit = defineEmits<{
  (e: "viewMessages", payload: { site: TSiteID; unread: number }): void;
  (e: "viewHistory", site: TSiteID): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();

/** v-badge 的 model-value/content 到 a-badge 的 count/dot 的映射 */
function unreadBadge(record: IUserInfoItem) {
  /**
   * 只显站点自己报的那个数，**不减本地已读**。v0.31.0 拿记账去减，于是徽章和站点横幅
   * 长期对不上（站点横幅「你有2条新短讯」、徽章 1，刷新也不回来）：记账只增不减，
   * 而读信那条 GET 本身就会把站点侧标成已读（LuckPT 真页：读前横幅 8、读后 7），
   * 减一次等于把同一条扣两遍。记账现在只管列表里那行的置灰，见 utils/siteMessageRead.ts。
   */
  const messageCount = record.messageCount ?? 0;
  if (!configStore.myDataTableControl.showUnreadMessage || messageCount <= 0) {
    return { count: 0, dot: false };
  }
  // 超过 10 条时原实现只显示一个小圆点（content 传 undefined）
  return messageCount > 10 ? { count: 0, dot: true } : { count: messageCount, dot: false };
}

/**
 * 那颗红数字/圆点的悬浮说明。
 *
 * 没有徽章时返回 undefined —— `HoverTip` 拿到空文案就不挂浮层、原样渲染子节点。
 * 原先这儿的原生 title 是挂在 `a-badge` 的指示物上的，指示物不出来的行本来也没有提示，
 * 换成浮层要自己守住同一条件，否则整格图标都会开始弹「阅读站内信」。
 */
function badgeTipOf(record: IUserInfoItem) {
  const badge = unreadBadge(record);
  return badge.count > 0 || badge.dot ? t("MyData.messages.badgeTip") : undefined;
}

/**
 * 红数字/圆点是「读站内信」的入口，图标本体仍然是「刷新该站数据」。
 * 两者都落在 a-badge 这一层（a-badge 把 click 挂到根 span 上），所以按事件目标分流：
 * 命中的是徽标指示物才让父页面开弹窗，否则什么都不做，让 SiteFavicon 自己的 click 去刷新。
 */
function onBadgeClick(event: MouseEvent, record: IUserInfoItem) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".ant-badge-count, .ant-badge-dot")) {
    return;
  }
  emit("viewMessages", { site: record.site, unread: record.messageCount ?? 0 });
}

/**
 * 「做种积分」那一行出不出 —— 格子里的 v-if 和浮层里的第二行**共用这一个判据**。
 * 原先是两处各写一遍，注释里还得叮嘱「两处必须判得一样，否则浮层里会多出一行格子里
 * 根本没有的东西」；收成一个函数之后那条叮嘱不再需要靠人守。
 *
 * `!== ""` 不是笔误，也不是给类型圆场：`IUserInfo.seedingBonus` 声明成 number，但上游确实
 * 会塞空串 —— 同一目录 `utils/format.ts` 的 `normalizeBonus` 就明写「站点可能报数、报空串、
 * 报 undefined」并为这三种各留一支。所以这里按 unknown 取出来判，不让声明替数据担保。
 */
function showSeedingBonus(record: IUserInfoItem) {
  const raw: unknown = record.seedingBonus;
  return configStore.myDataTableControl.showSeedingBonus && raw !== "" && !isUndefined(raw);
}

/**
 * 「积分」那一格的**一个**合并浮层：每行是「那颗图标的含义 + 不带简化的完整数字」。
 *
 * 原先这一格里挂着四个原生 title —— 两颗图标各说自己是什么（积分 / 做种积分）、
 * 两个数字各给一份完整值（数字被简化成 1.42M 时 hover 才看得到 1,419,552.50）。
 * 一次 hover 只能读到其中一个，要看全得在格子里挪四下鼠标。合成一个浮层后一次读完。
 */
function bonusRevealLines(record: IUserInfoItem) {
  const lines = [{ label: t("levelRequirement.bonus"), value: bonusFullText(record.bonus) }];
  if (showSeedingBonus(record)) {
    lines.push({ label: t("levelRequirement.seedingBonus"), value: bonusFullText(record.seedingBonus) });
  }
  return lines;
}
</script>

<template>
  <!-- 站点信息 -->
  <template v-if="column.key === 'siteUserConfig.sortIndex'">
    <div class="site-cell">
      <HoverTip :text="badgeTipOf(record)">
        <a-badge
          class="site-unread-badge"
          :count="unreadBadge(record).count"
          :dot="unreadBadge(record).dot"
          color="#f44336"
          @click="onBadgeClick($event, record)"
        >
          <div class="favicon-hover-wrapper favicon-hover-bg">
            <SiteFavicon
              :site-id="record.site"
              :size="configStore.myDataTableControl.showSiteName ? 18 : 24"
              @click="() => flushSiteLastUserInfo([record.site])"
            />
          </div>
        </a-badge>
      </HoverTip>

      <SiteName v-if="configStore.myDataTableControl.showSiteName" :site-id="record.site" />
    </div>
  </template>

  <!-- 用户名，用户ID -->
  <template v-else-if="column.key === 'name'">
    <HoverTip :text="record.id as string">
      <span class="text-no-wrap">
        {{ configStore.myDataTableControl.showUserName ? (record.name ?? "-") : "******" }}
      </span>
    </HoverTip>
  </template>

  <!-- 等级信息，升级信息 -->
  <template v-else-if="column.key === 'levelName'">
    <UserLevelRequirementsTd :user-info="record" />
  </template>

  <!-- 上传、下载 -->
  <template v-else-if="column.key === 'uploaded'">
    <div class="d-flex flex-column align-end">
      <div class="d-flex justify-end flex-nowrap">
        <span class="text-no-wrap">
          {{ typeof record.uploaded !== "undefined" ? formatSize(record.uploaded) : "-" }}
        </span>
        <ArrowUpOutlined class="cell-icon cell-icon--green" />
      </div>
      <div class="d-flex justify-end flex-nowrap">
        <span class="text-no-wrap">
          {{ typeof record.downloaded !== "undefined" ? formatSize(record.downloaded) : "-" }}
        </span>
        <ArrowDownOutlined class="cell-icon cell-icon--red" />
      </div>
    </div>
  </template>

  <!-- 真实上传、下载 -->
  <template v-else-if="column.key === 'trueUploaded'">
    <div class="d-flex flex-column align-end">
      <div class="d-flex justify-end flex-nowrap">
        <span class="text-no-wrap">
          {{ typeof record.trueUploaded !== "undefined" ? formatSize(record.trueUploaded) : "-" }}
        </span>
        <ArrowUpOutlined class="cell-icon cell-icon--green" />
      </div>
      <div class="d-flex justify-end flex-nowrap">
        <span class="text-no-wrap">
          {{ typeof record.trueDownloaded !== "undefined" ? formatSize(record.trueDownloaded) : "-" }}
        </span>
        <ArrowDownOutlined class="cell-icon cell-icon--red" />
      </div>
    </div>
  </template>

  <!-- 分享率 -->
  <template v-else-if="column.key === 'ratio'">
    <span class="text-no-wrap">{{ formatRatio(record) }}</span>
  </template>

  <!-- 真实分享率 -->
  <template v-else-if="column.key === 'trueRatio'">
    <span class="text-no-wrap">{{ formatRatio(record, "trueRatio") }}</span>
  </template>

  <!-- 发布数 -->
  <template v-else-if="column.key === 'uploads'">
    <span class="text-no-wrap">{{ record.uploads ?? "-" }}</span>
  </template>

  <!-- 做种数， H&R 情况  -->
  <template v-else-if="column.key === 'seeding'">
    <div class="d-flex flex-column align-end">
      <div class="d-flex align-center justify-end flex-nowrap">
        <span class="text-no-wrap">{{ record.seeding ?? "-" }}</span>
      </div>
      <div v-if="configStore.myDataTableControl.showHnR" class="d-flex align-center justify-end flex-nowrap">
        <span
          v-if="typeof record.hnrPreWarning !== 'undefined' && record.hnrPreWarning > 0"
          class="d-inline-flex align-center ml-2"
        >
          <HoverTip :text="t('levelRequirement.hnrPreWarning')">
            <AlertOutlined class="cell-icon cell-icon--yellow" />
          </HoverTip>
          <span class="text-no-wrap">
            {{ record.hnrPreWarning }}
          </span>
        </span>
        <span
          v-if="typeof record.hnrUnsatisfied !== 'undefined' && record.hnrUnsatisfied > 0"
          class="d-inline-flex align-center ml-1"
        >
          <HoverTip :text="t('levelRequirement.hnrUnsatisfied')">
            <ExclamationCircleOutlined class="cell-icon cell-icon--red" />
          </HoverTip>
          <span class="text-no-wrap">
            {{ record.hnrUnsatisfied }}
          </span>
        </span>
      </div>
    </div>
  </template>

  <!-- 做种量 -->
  <template v-else-if="column.key === 'seedingSize'">
    <span class="text-no-wrap">
      {{ typeof record.seedingSize !== "undefined" ? formatSize(record.seedingSize) : "-" }}
    </span>
  </template>

  <!-- 魔力/积分：整格只挂**一个**浮层（原先这一格里有四个原生 title，判据见 bonusRevealLines）。
       两颗图标不再自己带提示，含义写在浮层那一行的标签上。 -->
  <template v-else-if="column.key === 'bonus'">
    <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
      <template #content>
        <div class="bonus-reveal">
          <div v-for="line in bonusRevealLines(record)" :key="line.label" class="bonus-reveal-line">
            <span class="bonus-reveal-label">{{ line.label }}</span>
            <span class="bonus-reveal-value">{{ line.value }}</span>
          </div>
        </div>
      </template>
      <div class="d-flex flex-column align-end">
        <div class="bonus-line d-flex align-center justify-end flex-nowrap">
          <BonusFormatSpan :num="record.bonus" :reveal="false" />
          <DollarOutlined class="cell-icon cell-icon--green" />
        </div>
        <div v-if="showSeedingBonus(record)" class="bonus-line d-flex align-center justify-end flex-nowrap">
          <BonusFormatSpan :num="record.seedingBonus" :reveal="false" />
          <ThunderboltOutlined class="cell-icon cell-icon--green" />
        </div>
      </div>
    </a-popover>
  </template>

  <template v-else-if="column.key === 'bonusPerHour'">
    <BonusFormatSpan :num="record.bonusPerHour" />
  </template>

  <template v-else-if="column.key === 'invites'">
    <span class="text-no-wrap">{{ typeof record.invites !== "undefined" ? record.invites : "-" }}</span>
  </template>

  <!-- 入站时间：格子里可以选「显示成多久以前」，完整时间原先挂原生 title，改成浮层 -->
  <template v-else-if="column.key === 'joinTime'">
    <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
      <template #content>
        <div class="reveal-lines">
          <div>{{ record.joinTime ? (formatDate(record.joinTime) as string) : "-" }}</div>
        </div>
      </template>
      <span class="text-no-wrap">
        {{
          typeof record.joinTime !== "undefined"
            ? configStore.myDataTableControl.joinTimeFormat === "aliveWeek"
              ? formatTimeAgo(record.joinTime, { weekOnly: true })
              : configStore.myDataTableControl.joinTimeFormat === "alive"
                ? formatTimeAgo(record.joinTime)
                : formatDate(record.joinTime, "yyyy-MM-dd")
            : "-"
        }}
      </span>
    </a-popover>
  </template>

  <!-- 最近访问：这一格里原先有两个原生 title（完整时间 + 那颗「N 天未访问」的说明），
       合成一个浮层：第一行完整时间，第二行那句说明（只在图标出现时才有）。 -->
  <template v-else-if="column.key === 'lastAccessAt'">
    <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
      <template #content>
        <div class="reveal-lines">
          <div>{{ record.lastAccessAt ? (formatDate(record.lastAccessAt) as string) : "-" }}</div>
          <div v-if="record.lastAccessDuration >= 5" class="reveal-note">
            {{ t("MyData.table.lastAccessDurationNote", [record.lastAccessDuration]) }}
          </div>
        </div>
      </template>
      <span class="text-no-wrap">
        <template v-if="typeof record.lastAccessAt !== 'undefined'">
          {{ formatDate(record.lastAccessAt) }}
          <AlertOutlined
            v-if="record.lastAccessDuration >= 5"
            class="cell-icon"
            :style="{ color: record.lastAccessDuration >= 15 ? '#f44336' : '#ffc107' }"
          />
        </template>
        <template v-else>-</template>
      </span>
    </a-popover>
  </template>

  <!-- 更新时间 -->
  <template v-else-if="column.key === 'updateAt'">
    <template v-if="record.status === EResultParseStatus.success">
      <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
        <template #content>
          <div class="reveal-lines">
            <div>{{ record.updateAt ? (formatDate(record.updateAt) as string) : "-" }}</div>
          </div>
        </template>
        <span class="text-wrap">
          {{
            record.updateAt
              ? configStore.myDataTableControl.updateAtFormatAsAlive
                ? formatTimeAgo(record.updateAt)
                : formatDate(record.updateAt)
              : "-"
          }}
        </span>
      </a-popover>
    </template>
    <template v-else>
      <a-tag>
        <ResultParseStatus :status="record.status" />
      </a-tag>
    </template>
  </template>

  <!-- 操作 -->
  <template v-else-if="column.key === 'action'">
    <!-- 两个按钮的图标都必须走 #icon 插槽（与 SetSite、SearchEntity/ActionTd 同一写法）：
         挂在默认插槽时 antd 的 loading 图标是**插在按钮前面**的，还带一段 width 0→N 的
         过渡动画（button/DefaultLoadingIcon.js 的 existIcon 分支）—— 按钮变宽就把整张表
         的列宽重排一遍；挂进 #icon 后 loading 是原地替换同一个 .ant-btn-icon，宽度不动。
         顺带统一尺寸：默认插槽的图标不算 icon-only，内衬比 #icon 那档宽 4px。 -->
    <div class="table-action">
      <a-tooltip :title="t('MyData.table.action.viewHistoryData')">
        <a-button
          type="text"
          size="small"
          @click="emit('viewHistory', record.site)"
        >
          <template #icon><UnorderedListOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyData.table.action.flushData')">
        <a-button
          type="text"
          size="small"
          :disabled="runtimeStore.userInfo.flushPlan[record.site]"
          :loading="runtimeStore.userInfo.flushPlan[record.site]"
          @click="flushSiteLastUserInfo([record.site])"
        >
          <template #icon><SyncOutlined /></template>
        </a-button>
      </a-tooltip>
    </div>
  </template>
</template>

<style scoped lang="scss">
.cell-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
}
.cell-icon--green {
  color: #388e3c; /* Vuetify green-darken-4 */
}
.cell-icon--red {
  color: #c62828; /* Vuetify red-darken-4 */
}
.cell-icon--yellow {
  color: #f9a825; /* Vuetify yellow-darken-4 */
}

.favicon-hover-wrapper {
  cursor: pointer;
}

/* 站点列：图标在左、站名在右（原来是上下两行，行高被堆成 63.8px）。
   缝 8px：含悬停圆底那 4px 内衬，实测墨迹间距 12px。 */
.site-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

/**
 * 红数字/圆点是读站内信的入口，得看着能点（图标本体是刷新，另有 cursor）。
 *
 * 徽标只包图标那一块 —— 它标的是「这个站有几封未读」，锚点该是图标。原先包住「图标 + 站名」
 * 整块，那颗就落在站名最后一个字母的角上（台架实测中心在图标右沿外 79.3px、离图标墨迹 0 重叠），
 * 看着是浮在文字上方，而不是挂在站点上。
 *
 * inset-inline-end 从 0 收到 8px（正好等于图标到站名的那道缝）：antd 把指示物的中心放在被包
 * 元素的右外角，最宽的那档（`messageCount === 10` 的两位数胶囊，实测宽 26.8px）不收就会越过
 * 站名盒左沿 5.4px、压住第一个字；收 8px 之后一位数离站名 6.5px、两位数 2.6px、圆点 13.5px，
 * 三档都不碰文字，代价是胶囊盖住图标墨迹右上角约 23%（两位数 30%）。
 *
 * 只挪 inset-inline-end、不改 transform：入场动画的 keyframes 写死了 translate(50%, -50%)，
 * 改了 transform 会在动画结束时被 keyframes 顶回原位再跳一下。
 */
.site-unread-badge {
  :deep(.ant-badge-count),
  :deep(.ant-badge-dot) {
    cursor: pointer;
    inset-inline-end: 8px;
  }
}

.favicon-hover-bg {
  border-radius: 50%;
  transition: background 0.2s;
  display: inline-flex;
  padding: 4px;
}

.favicon-hover-bg:hover {
  background: rgba(0, 0, 0, 0.3);
}

/**
 * 「积分」那一格的合并浮层：标签在左、完整数字在右，一行一项。
 * tabular-nums 是必须的：两行位数不同（1,419,552.50 / 970,509.70），比例数字下右沿对不齐。
 */
.bonus-reveal {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}

.bonus-reveal-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.bonus-reveal-label {
  opacity: 0.75;
}

.bonus-reveal-value {
  font-variant-numeric: tabular-nums;
}

/** 日期那一族的浮层：第一行完整时间，第二行（可选）那句「N 天未访问」 */
.reveal-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 480px;
}

.reveal-note {
  opacity: 0.75;
}
</style>
