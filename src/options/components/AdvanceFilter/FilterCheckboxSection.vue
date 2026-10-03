<script setup lang="ts" generic="T">
/**
 * 高级筛选对话框：三态复选区（中性横杠 → 必含选中 ↔ 排除未选）。
 *
 * 必须配合「a-checkbox-group 的 v-model:value 绑 required + @click.stop 触发
 * 外部 toggle」这套机制使用，toggle 语义见 useAdvanceFilter.toggleKeywordStateFn。
 *
 * 必含/排除的归属由 required、excluded 两个数组显式计算，
 * 不再把 indeterminate 写死（Vuetify 时期的近似实现）。
 *
 * items 可以是字符串/数字（站点、下载器），也可以是对象（标签、状态）；
 * 对象场景用 itemValue 指定取哪个字段作为 checkbox 值与 toggle 载荷。
 */
const required = defineModel<(string | number)[]>("required", { required: true });

const props = defineProps<{
  items: T[];
  excluded: (string | number)[];
  /** 从 item 上取复选框值；默认 item 自身就是值 */
  itemValue?: (item: T) => string | number;
  /** 拼进 :key 前缀，reBuild 时强制重建 checkbox 内部态 */
  rebuildKey?: string | number;
  /** 列宽，语义同 a-col（span 固定宽，xs/sm/md 响应式断点） */
  span?: number;
  xs?: number;
  sm?: number;
  md?: number;
}>();

const emit = defineEmits<{
  toggle: [value: string | number];
}>();

function valueOf(item: T): string | number {
  return props.itemValue ? props.itemValue(item) : (item as string | number);
}

function isChecked(item: T): boolean {
  const v = valueOf(item);
  return required.value.some((x) => String(x) === String(v));
}

/** 既不在 required 也不在 excluded == 中性态（横杠） */
function isIndeterminate(item: T): boolean {
  if (isChecked(item)) return false;
  const v = valueOf(item);
  return !props.excluded.some((x) => String(x) === String(v));
}
</script>

<template>
  <a-checkbox-group v-model:value="required" class="advance-filter-checkbox-group">
    <a-row :gutter="0">
      <a-col
        v-for="item in items"
        :key="`${rebuildKey ?? ''}_${valueOf(item)}`"
        class="pa-0"
        :span="span"
        :xs="xs"
        :sm="sm"
        :md="md"
      >
        <a-checkbox
          :value="valueOf(item)"
          :indeterminate="isIndeterminate(item)"
          @click.stop="emit('toggle', valueOf(item))"
        >
          <slot name="item" :item="item" />
        </a-checkbox>
      </a-col>
    </a-row>
  </a-checkbox-group>
</template>

<style scoped lang="scss">
.advance-filter-checkbox-group {
  width: 100%;
}
</style>
