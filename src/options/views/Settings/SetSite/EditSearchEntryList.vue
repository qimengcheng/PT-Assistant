<script setup lang="ts">
import { onMounted, reactive } from "vue";
import type { ISiteMetadata, ISiteUserConfig, TSiteID } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";

const { item } = defineProps<{
  item: {
    id: TSiteID;
    metadata: ISiteMetadata;
    userConfig: ISiteUserConfig;
  };
}>();

const metadataStore = useMetadataStore();

const searchEntryEnabledStatus = reactive<Record<string, boolean>>({});

onMounted(() => {
  for (const [entryKey, entry] of Object.entries(item.metadata.searchEntry ?? {})) {
    let entryEnabledStatus = false;
    if (typeof item.userConfig.merge?.searchEntry?.[entryKey]?.enabled === "boolean") {
      entryEnabledStatus = item.userConfig.merge.searchEntry[entryKey]!.enabled!;
    } else {
      entryEnabledStatus = entry.enabled ?? true;
    }

    searchEntryEnabledStatus[entryKey] = entryEnabledStatus;
  }
});
</script>

<template>
  <div class="search-entry-list">
    <label v-for="(searchEntry, entryKey) in item.metadata.searchEntry" :key="entryKey" class="search-entry-row">
      <a-switch
        v-model:checked="searchEntryEnabledStatus[String(entryKey)]"
        size="small"
        @change="
          (checked: boolean | string | number) =>
            metadataStore.simplePatch("sites", item.id, `merge.searchEntry.${String(entryKey)}.enabled`, !!checked)
        "
      />
      <span class="search-entry-name">{{ searchEntry.name }}</span>
    </label>
    <div v-if="!item.metadata.searchEntry || Object.keys(item.metadata.searchEntry).length === 0" class="hint">
      -
    </div>
  </div>
</template>

<style scoped lang="scss">
.search-entry-list {
  max-height: 400px;
  overflow-y: auto;
  min-width: 240px;
  padding: 4px 0;
}

.search-entry-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
}

.search-entry-name {
  font-size: 13px;
}

.hint {
  padding: 4px 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
