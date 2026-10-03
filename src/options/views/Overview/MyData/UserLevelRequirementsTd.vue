<script setup lang="ts">
import { computed, type Component } from "vue";
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
          <!-- 计算剩余升级情况 -->
          <template
            v-if="
              configStore.myDataTableControl.showNextLevelInDialog &&
              userLevelGroupType === 'user' &&
              !isEmpty(nextLevelUnMet)
            "
          >
            <div class="px-1 py-0 level-requirement-item">
              <UserNextLevelUnMet :next-level-un-met="nextLevelUnMet" :user-info="userInfo" />
            </div>
          </template>

          <div v-if="userLevelRequirements.length > 0" class="text-body-small text-medium-emphasis mb-1">
            {{ t("MyData.UserLevelRequirementsTd.levelList") }}
          </div>

          <!-- 展示站点用户等级 -->
          <template v-for="userLevel in userLevelRequirements" :key="userLevel.id">
            <template
              v-if="
                configStore.myDataTableControl.onlyShowUserLevelRequirement
                  ? (userLevel.groupType !== 'vip' && userLevel.groupType !== 'manager') ||
                    userLevelGroupType !== 'user'
                  : true
              "
            >
              <div class="level-requirement-item px-1 py-0 d-flex align-center">
                <component
                  :is="userLevel.id <= (userInfo.levelId ?? -1) ? CheckOutlined : MinusCircleOutlined"
                  class="level-icon mr-1"
                  :style="{ color: userLevel.id <= (userInfo.levelId ?? -1) ? '#4caf50' : '#f44336' }"
                />

                <div class="text-no-wrap">
                  <span>{{ userLevel.name }}:&nbsp;</span>
                  <!-- 展示用户等级要求时， interval 向 date 的转换应该基于 joinTime 计算 -->
                  <UserLevelsComponent
                    :user-info="userInfo"
                    :level-requirement="userLevel"
                    :useJoinTimeAsRef="true"
                  />
                </div>

                <div class="text-ellipsis text-truncate ml-2" :title="userLevel.privilege">
                  {{ userLevel.privilege }}
                </div>
              </div>
              <hr class="ma-1 level-requirement-divider" />
            </template>
          </template>
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

/* 原 v-card max-height/max-width + content-class="bg-white pa-0" */
.level-requirement-panel {
  background: #fff;
  padding: 8px;
  max-width: 800px;
  max-height: 500px;
  overflow-y: auto;
}

.level-requirement-item {
  display: flex;
  align-items: center;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
}

.level-requirement-divider:last-child {
  display: none;
}
</style>
