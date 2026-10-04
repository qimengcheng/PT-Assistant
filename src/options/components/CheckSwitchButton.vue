<script setup lang="ts" generic="T">
import { useI18n } from "vue-i18n";
import { BorderOutlined, CheckSquareOutlined, MinusSquareOutlined } from "@antdv-next/icons";


const { t } = useI18n();

const selected = defineModel<T[]>({ required: true });
const { all } = defineProps<{
  all: T[];
}>();

function updateSelected(value: T[]) {
  selected.value = value;
}
</script>

<template>
  <a-button type="primary" size="small" v-bind="$attrs" @click="() => updateSelected(all)"><template #icon><CheckSquareOutlined /></template><span>{{ t('common.checkbox.all') }}</span></a-button>
  <a-button type="primary" size="small" v-bind="$attrs" @click="() => updateSelected([])"><template #icon><BorderOutlined /></template><span>{{ t('common.checkbox.none') }}</span></a-button>
  <a-button type="primary" size="small" v-bind="$attrs" @click="() => updateSelected(all.filter((item) => !selected.includes(item)))"><template #icon><MinusSquareOutlined /></template><span>{{ t('common.checkbox.invert') }}</span></a-button>
</template>

<style scoped lang="scss"></style>
