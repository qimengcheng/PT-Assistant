<script setup lang="ts">
/**
 * 三态复选框的说明行。
 *
 * 为什么要有这一行：`FilterCheckboxSection` 那颗复选框画的是 横杠(indeterminate) / 打勾 / 不打勾 三种样子，
 * 而横杠那一档**既不是选中也不是排除**，是「这条不参与筛选」—— 光看控件猜不出来。
 * 更猜不出来的是它回不去：点一下进必要项、再点一下进排除项，之后只在两者之间来回，
 * 要回到「不参与」只能按底部那颗「重置搜索词」（`useAdvanceFilter.toggleKeywordStateFn` 就是这么写的）。
 *
 * 说明放在这里而不是逐颗挂悬停：这条信息对整片复选区都成立，悬停要点中某一格才看得到，
 * 而「不知道有这一档」的人根本不会去悬停。
 */
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <div class="tri-state-hint">{{ t("common.AdvanceFilterGenerateDialog.triStateHint") }}</div>
</template>

<style scoped>
.tri-state-hint {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.55);
}
</style>
