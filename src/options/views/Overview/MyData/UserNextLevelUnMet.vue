<script setup lang="ts">
import { type IImplicitUserInfo, type ILevelRequirement, IUserInfo } from "@ptd/site";
import { ArrowRightOutlined } from "@antdv-next/icons";

import UserLevelsComponent from "./UserLevelsComponent.vue";

const {
  nextLevelUnMet,
  userInfo,
  showNextLevelName = true,
  iconClass = "mr-3",
} = defineProps<{
  nextLevelUnMet: Partial<IImplicitUserInfo & { level?: ILevelRequirement }>;
  userInfo: IUserInfo;
  showNextLevelName?: boolean;
  iconClass?: string;
}>();
</script>

<template>
  <!-- 计算剩余升级情况 -->
  <ArrowRightOutlined :class="iconClass" class="next-level-icon" />

  <span v-if="showNextLevelName && nextLevelUnMet.level">{{ nextLevelUnMet.level.name }}:&nbsp;</span>

  <UserLevelsComponent :user-info="userInfo" :level-requirement="nextLevelUnMet" :hide-ratio-in-table="true" />
</template>

<style scoped lang="scss">
.next-level-icon {
  color: #ff9800; /* Vuetify 的 color="orange" */
  font-size: 14px; /* 原 <v-icon size="small"> */
}
</style>
