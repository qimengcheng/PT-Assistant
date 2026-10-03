<script setup lang="ts">
import { type ILevelRequirement, type IUserInfo } from "@ptd/site";
import { TableOutlined } from "@antdv-next/icons";

import UserLevelShowSpan from "./UserLevelShowSpan.vue";

const {
  userInfo,
  levelRequirement,
  hideRatioInTable = false,
  useJoinTimeAsRef = false,
} = defineProps<{
  userInfo: IUserInfo;
  levelRequirement: Omit<ILevelRequirement, "id" | "name">;
  hideRatioInTable?: boolean;
  useJoinTimeAsRef?: boolean;
}>();
</script>

<template>
  <UserLevelShowSpan
    :user-info="userInfo"
    :level-requirement="levelRequirement"
    :hide-ratio-in-table="hideRatioInTable"
    :useJoinTimeAsRef="useJoinTimeAsRef"
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
        :useJoinTimeAsRef="useJoinTimeAsRef"
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
