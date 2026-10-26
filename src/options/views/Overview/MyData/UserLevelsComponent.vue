<script setup lang="ts">
import { type ILevelRequirement, type IUserInfo } from "@ptd/site";
import { TableOutlined } from "@zboson/icons";

import UserLevelShowSpan from "./UserLevelShowSpan.vue";

const {
  userInfo,
  levelRequirement,
  hideRatioInTable = false,
  useJoinTimeAsRef = false,
  showLevelScoreConversion = false,
} = defineProps<{
  userInfo: IUserInfo;
  levelRequirement: Omit<ILevelRequirement, "id" | "name">;
  hideRatioInTable?: boolean;
  useJoinTimeAsRef?: boolean;
  /** 见 UserLevelShowSpan 上的同名 prop：只有「还差多少」那一行才该打开 */
  showLevelScoreConversion?: boolean;
}>();
</script>

<template>
  <UserLevelShowSpan
    :user-info="userInfo"
    :level-requirement="levelRequirement"
    :hide-ratio-in-table="hideRatioInTable"
    :use-join-time-as-ref="useJoinTimeAsRef"
    :show-level-score-conversion="showLevelScoreConversion"
  />
  <template v-if="levelRequirement.alternative">
    <TableOutlined class="level-icon" />
    (
    <template v-for="(alternative, key) in levelRequirement.alternative" :key="key">
      [
      <UserLevelShowSpan
        :user-info="userInfo"
        :level-requirement="alternative"
        :hide-ratio-in-table="hideRatioInTable"
        :use-join-time-as-ref="useJoinTimeAsRef"
        :show-level-score-conversion="showLevelScoreConversion"
      />
      ]
    </template>
    )
  </template>
</template>

<style scoped lang="scss">
.level-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
}
</style>
