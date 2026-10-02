<script setup lang="ts">
/**
 * 搜索方案条目标签组（antdv-next 平移）。
 * 展示形式：站点名 -> 方案详情；closable 时标签可关闭并向父组件抛出移除事件。
 * groupProps.column=true 时纵向排列（用于编辑对话框右侧已选列表）。
 */
import { CloseOutlined } from "@antdv-next/icons";

import type { ISearchSolution } from "@/shared/types.ts";

import SolutionDetail from "@/options/components/SolutionDetail.vue";
import SiteName from "@/options/components/SiteName.vue";

const {
  solutions,
  closable = true,
  groupProps = {},
} = defineProps<{
  solutions: ISearchSolution[];
  closable?: boolean;
  groupProps?: { column?: boolean };
}>();

const emit = defineEmits(["remove:solution"]);

function removeSolution(solution: ISearchSolution) {
  emit("remove:solution", solution);
}
</script>

<template>
  <div class="solution-label-group" :class="{ column: groupProps.column }">
    <a-tag v-for="solution in solutions" :key="solution.id" class="solution-tag">
      <a-space :size="4" wrap>
        <CloseOutlined v-if="closable" class="close-icon" @click="() => removeSolution(solution)" />
        <SiteName :site-id="solution.siteId" tag="span" />
        <span>-></span>
        <SolutionDetail :solution="solution" />
      </a-space>
    </a-tag>
  </div>
</template>

<style scoped>
.solution-label-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.solution-label-group.column {
  flex-direction: column;
  align-items: flex-start;
}
.solution-tag {
  margin-inline-end: 0;
  white-space: normal;
  height: auto;
  padding-block: 2px;
}
.close-icon {
  color: #999;
  cursor: pointer;
}
.close-icon:hover {
  color: #ff4d4f;
}
</style>
