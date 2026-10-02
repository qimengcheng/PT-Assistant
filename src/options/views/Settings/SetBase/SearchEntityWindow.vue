<script setup lang="ts">
/**
 * 搜索设置：搜索并发、结果筛选行为、标签折叠、媒体服务器联动。
 */
import { useConfigStore } from "@/options/stores/config.ts";

const configStore = useConfigStore();
</script>

<template>
  <div class="search-entity-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">搜索行为</div>
        <a-row :gutter="24">
          <a-col :span="8">
            <a-form-item label="同时搜索站点数">
              <a-input-number
                v-model:value="configStore.searchEntity.queueConcurrency"
                :min="1"
                :max="20"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item>
          <a-switch v-model:checked="configStore.searchEntity.allowSingleSiteSearch" />
          <span class="label">允许只搜索选中的单个站点</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.searchEntity.saveLastFilter" />
          <span class="label">记住上次使用的筛选条件</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.searchEntity.quickSiteFilter" />
          <span class="label">启用快捷站点筛选</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.searchEntity.autoDetectOfficialGroupFromTitle" />
          <span class="label">从标题自动识别官方制作组</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.searchEntity.forceImdbIdMatchFilter" />
          <span class="label">强制使用 IMDb 编号匹配过滤</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">标签显示</div>
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item label="分组前最大标签数">
              <a-input-number
                v-model:value="configStore.searchEntifyControl.maxTagCountBeforeGroup"
                :min="1"
                :max="20"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="隐藏的标签名（多个用 , 分隔）">
              <a-input
                :value="configStore.searchEntifyControl.hiddenTagNames.join(',')"
                @change="(e: any) => (configStore.searchEntifyControl.hiddenTagNames = (e.target?.value ?? '').split(',').map((s: string) => s.trim()).filter(Boolean))"
              />
            </a-form-item>
          </a-col>
        </a-row>
      </div>

      <div class="group">
        <div class="group-title">媒体服务器联动</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.mediaServerEntity.autoSearchWhenMount" />
          <span class="label">打开搜索结果时自动检索媒体库</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.mediaServerEntity.autoSearchMoreWhenScroll" />
          <span class="label">滚动时自动加载更多媒体结果</span>
        </a-form-item>
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item label="单次检索条数上限">
              <a-input-number
                v-model:value="configStore.mediaServerEntity.searchLimit"
                :min="5"
                :max="100"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="同时检索服务器数">
              <a-input-number
                v-model:value="configStore.mediaServerEntity.queueConcurrency"
                :min="1"
                :max="10"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
        </a-row>
      </div>
    </a-form>
  </div>
</template>

<style scoped>
.compact-form :deep(.ant-form-item) {
  margin-bottom: 10px;
}

.group {
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}

.group-title {
  font-weight: 600;
  margin-bottom: 10px;
}

.label {
  margin-left: 10px;
}
</style>
