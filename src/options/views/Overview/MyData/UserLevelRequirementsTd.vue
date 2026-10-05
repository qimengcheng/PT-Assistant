<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { isEmpty } from "es-toolkit/compat";
import { useBreakpoint } from "antdv-next";
import { CheckOutlined, MinusCircleOutlined, SafetyOutlined, ToolOutlined, UserOutlined } from "@antdv-next/icons";
import { getNextLevelUnMet, guessUserLevelGroupType, type IUserInfo, type TLevelGroupType } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import UserLevelsComponent from "./UserLevelsComponent.vue";
import UserNextLevelUnMet from "@/options/views/Overview/MyData/UserNextLevelUnMet.vue";

const { userInfo } = defineProps<{
  userInfo: IUserInfo;
}>();

// antd 的 useBreakpoint() 返回的是单个 Ref<ScreenMap | null>，不是一堆 ref，
// 因此断点要通过 screens.value?.xx 读取。Vuetify 的 display.mobile 等价于宽度 < 768px，
// 即 antd 断点中的 !md。
const screens = useBreakpoint();
const isMobile = computed(() => !screens.value?.md);

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();

const userLevelRequirements = computedAsync(() => {
  return metadataStore.getSiteMergedMetadata(userInfo.site, "levelRequirements", []);
}, []);

const userInfoMetadata = computedAsync(() => {
  return metadataStore.getSiteMergedMetadata(userInfo.site, "userInfo");
}, undefined);

const matchedLevelRequirements = computed(() => {
  return userLevelRequirements.value?.find((r) => r.id === userInfo.levelId);
});

const levelName = computed(() => {
  if (!configStore.myDataTableControl.normalizeLevelName) {
    return userInfo.levelName;
  }

  return matchedLevelRequirements.value?.name ?? userInfo.levelName;
});

const nextLevelUnMet = computed(() => getNextLevelUnMet(userInfo, userLevelRequirements.value!));

const userLevelGroupType = computed(() => {
  // 首先尝试从 matchedLevelRequirements 中找到对应的等级组
  if (matchedLevelRequirements.value?.groupType) {
    return matchedLevelRequirements.value.groupType;
  }

  // 如果还是没有，则考虑从用户等级名中猜测
  return guessUserLevelGroupType(userInfo.levelName ?? "user");
});

const isDonorAccountKept = computed(() => {
  return userInfo.isDonor === true && userInfoMetadata.value?.donorConfig?.isAccountKept === true;
});

const currentUserLevelColor = computed(() => {
  switch (userLevelGroupType.value) {
    case "vip":
      return "green";
    case "manager":
      return "indigo";
    case "user": {
      if (matchedLevelRequirements.value?.isKept || isDonorAccountKept.value) return "light-blue"; // 保号用户
      return "";
    }
    default:
      return "";
  }
});

/** antd 图标不吃 Vuetify 的颜色名，这里把配色名映射成 CSS 颜色 */
const levelColorMap: Record<string, string> = {
  green: "#4caf50",
  indigo: "#3f51b5",
  "light-blue": "#03a9f4",
};
const currentUserLevelIconColor = computed(() => levelColorMap[currentUserLevelColor.value]);

const userLevelGroupIconMap: Record<TLevelGroupType, Component> = {
  user: ToolOutlined, // 原 mdi-account-hard-hat
  vip: SafetyOutlined, // 原 mdi-check-decagram
  manager: UserOutlined, // 原 mdi-account-cog
};

const userLevelGroupIcon = computed(() => {
  return userLevelGroupIconMap[userLevelGroupType.value] || userLevelGroupIconMap.user;
});

const showAllLevels = ref(false);

/** 开了「只显示普通用户等级要求」时，vip/manager 等级不进列表；用户本身就是 vip/manager 则不过滤 */
const listedLevelRequirements = computed(() => {
  const list = userLevelRequirements.value ?? [];
  if (!configStore.myDataTableControl.onlyShowUserLevelRequirement || userLevelGroupType.value !== "user") {
    return list;
  }
  return list.filter((r) => r.groupType !== "vip" && r.groupType !== "manager");
});

/** 收起态只留「你当前所在的那一级」，展开态给全表；同一份行模板复用，不再分两处写 */
const visibleLevelRequirements = computed(() => {
  if (showAllLevels.value) return listedLevelRequirements.value;
  return listedLevelRequirements.value.filter((r) => r.id === userInfo.levelId);
});
</script>

<template>
  <span v-if="userInfo.levelName" class="text-no-wrap">
    <a-tooltip
      v-if="
        configStore.myDataTableControl.showLevelRequirement && userLevelRequirements && userLevelRequirements.length > 0
      "
      placement="bottomRight"
      :trigger="isMobile ? 'click' : 'hover'"
      :mouse-enter-delay="0.2"
      color="#fff"
      :styles="{ root: { maxWidth: 'none' }, container: { padding: 0 } }"
    >
      <template #default>
        <span>
          <component
            :is="userLevelGroupIcon"
            class="level-icon mr-1"
            :style="{ color: currentUserLevelIconColor }"
          />
          <span :class="`text-${currentUserLevelColor}`">{{ levelName }}</span>
          <CheckOutlined
            v-if="
              configStore.myDataTableControl.showNextLevelInTable &&
              userLevelGroupType === 'user' &&
              isEmpty(nextLevelUnMet)
            "
            class="level-icon ml-1"
            style="color: #4caf50; font-size: 14px"
          />
          <br />
          <template
            v-if="
              configStore.myDataTableControl.showNextLevelInTable &&
              userLevelGroupType === 'user' &&
              !isEmpty(nextLevelUnMet)
            "
          >
            <UserNextLevelUnMet
              :next-level-un-met="nextLevelUnMet"
              :show-next-level-name="false"
              :user-info="userInfo"
              icon-class="mr-1"
            />
          </template>
        </span>
      </template>

      <template #title>
        <div class="level-requirement-panel">
          <!-- 差值是算出来的、不在等级列表里，所以收起/展开两种形态下都固定在顶部 -->
          <div
            v-if="
              configStore.myDataTableControl.showNextLevelInDialog &&
              userLevelGroupType === 'user' &&
              !isEmpty(nextLevelUnMet)
            "
            class="level-requirement-row level-requirement-row--next"
          >
            <UserNextLevelUnMet :next-level-un-met="nextLevelUnMet" :user-info="userInfo" icon-class="mr-1" />
          </div>

          <div v-if="showAllLevels" class="text-body-small text-medium-emphasis">
            {{ t("MyData.UserLevelRequirementsTd.levelList") }}
          </div>

          <div
            v-for="userLevel in visibleLevelRequirements"
            :key="userLevel.id"
            class="level-requirement-row"
            :class="{ 'level-requirement-row--current': userLevel.id === userInfo.levelId }"
          >
            <component
              :is="userLevel.id <= (userInfo.levelId ?? -1) ? CheckOutlined : MinusCircleOutlined"
              class="level-icon"
              :style="{ color: userLevel.id <= (userInfo.levelId ?? -1) ? '#4caf50' : '#f44336' }"
            />

            <span class="level-requirement-name">
              {{ userLevel.name }}:&nbsp;
              <!-- 展示用户等级要求时， interval 向 date 的转换应该基于 joinTime 计算 -->
              <UserLevelsComponent
                :user-info="userInfo"
                :level-requirement="userLevel"
                :useJoinTimeAsRef="true"
              />
            </span>

            <!-- 权限名可能很长：用 a-typography-text 的 ellipsis.tooltip 一步拿到
                 「截断 + 悬停显示完整文案」，不再靠手写 text-ellipsis + 原生 :title -->
            <a-typography-text class="level-requirement-privilege" :ellipsis="{ tooltip: userLevel.privilege }">
              {{ userLevel.privilege }}
            </a-typography-text>
          </div>

          <button
            v-if="listedLevelRequirements.length > 1"
            type="button"
            class="level-requirement-toggle"
            @click="showAllLevels = !showAllLevels"
          >
            {{
              showAllLevels
                ? t("MyData.UserLevelRequirementsTd.collapseLevelList")
                : t("MyData.UserLevelRequirementsTd.expandLevelList", { count: listedLevelRequirements.length })
            }}
          </button>
        </div>
      </template>
    </a-tooltip>
    <span v-else>
      <component :is="userLevelGroupIcon" class="level-icon" />
      {{ levelName }}
    </span>
  </span>

  <!-- 信息还没获取 -->
  <template v-else>-</template>
</template>

<style scoped lang="scss">
.level-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
}

/* 原 v-card max-height/max-width + content-class="bg-white pa-0"。
   浮层本体已由 a-tooltip 的 color="#fff" 刷白（antdv-next 的 parseColor 会同步
   改掉 container 背景、arrow 背景和按亮度反推的 overlay-color），所以这里不再
   自带白底 —— 那圈「黑边包白块」就是旧写法留下的：卡片是白的，卡片外的
   tooltip padding 和箭头仍是 colorBgSpotlight 近黑。

   ⚠️ 面板宽度必须和 a-tooltip 上的 `styles.root.maxWidth: 'none'` 配套看。
   antdv-next 把 `max-width: 250px` 挂在 .ant-tooltip 根节点上，而承载内容的
   unique-container 是绝对定位、宽度走 shrink-to-fit，可用宽度仍被那 250px 限住。
   迁移前这份浮层能撑到 ~500px，靠的是等级串上的 white-space:nowrap 把
   min-content 顶过 250px 这个上限 —— 也就是说 nowrap 一旦去掉，宽度立刻塌回 250px，
   整串要求会在 4W; / 50GB; / 1.05; 这种地方逐段折行。别只改这里。 */
.level-requirement-panel {
  box-sizing: border-box; // 否则 padding 记在 max-width 之外，窄视口下浮层会伸出屏幕
  color: rgba(0, 0, 0, 0.88); // parseColor 给的是纯黑，压回更柔和的正文色
  padding: 6px 8px;
  width: max-content;
  /* 上限按内容给足，再用 100vw 兜住窄窗口 —— 浮层挂在 body 上，超视口的部分
     会被 autoAdjustOverflow 移位后裁掉，那时用户看到的是「右边少了东西」而不是滚动条。 */
  max-width: min(860px, calc(100vw - 40px));
  max-height: 420px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.level-requirement-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 2px;

  & + & {
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }

  .level-icon {
    flex: 0 0 auto;
    margin-top: 2px; // 行首图标对齐第一行文字，整块折行时不跟着飘到中间
  }

  &--next {
    gap: 4px;
  }

  &--current {
    background: rgba(22, 119, 255, 0.06);
  }
}

/* 等级串是这一行的主信息，必须整行读完，所以不给它 flex-shrink —— 一旦允许收缩，
   它会和权限串按 basis 比例一起缩，实测在 860px 面板下正好折成两行。
   宽度溢出由上面的 styles.root.maxWidth:'none' 解决，不是由这里折行解决。 */
.level-requirement-name {
  flex: 0 0 auto;
  white-space: nowrap;
}

/* 收缩全部由权限串承担：它是次要信息，截断后悬停能看全文。
   min-width:0 是 ellipsis 生效的前提（flex 子项默认最小尺寸按内容算）。 */
.level-requirement-privilege {
  flex: 0 1 auto;
  min-width: 0;
  color: rgba(0, 0, 0, 0.55);
}

.level-requirement-toggle {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 5px 2px 1px;
  border: 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: none;
  color: #1677ff;
  font-size: 12px;
  text-align: center;
  cursor: pointer;

  &:hover {
    color: #4096ff;
  }
}
</style>
