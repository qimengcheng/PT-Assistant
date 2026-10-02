<script setup lang="ts" generic="T">
import { useI18n } from "vue-i18n";
import { BorderOutlined, CheckSquareOutlined, MinusSquareOutlined } from "@antdv-next/icons";

import NavButton from "./NavButton.vue";

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
  <NavButton
    :text="t('common.checkbox.all')"
    :icon="CheckSquareOutlined"
    size="small"
    v-bind="$attrs"
    @click="() => updateSelected(all)"
  />
  <NavButton
    :text="t('common.checkbox.none')"
    :icon="BorderOutlined"
    size="small"
    v-bind="$attrs"
    @click="() => updateSelected([])"
  />
  <NavButton
    :text="t('common.checkbox.invert')"
    :icon="MinusSquareOutlined"
    size="small"
    v-bind="$attrs"
    @click="() => updateSelected(all.filter((item) => !selected.includes(item)))"
  />
</template>

<style scoped lang="scss"></style>
