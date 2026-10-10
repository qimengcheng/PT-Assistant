<script setup lang="ts">
/**
 * 搜索（重排之后它是基础设置的第一节）：搜索并发、结果筛选行为、标签折叠、媒体服务器联动。
 *
 * 排第一是因为他就是每天的第一件事：搜 → 挑 → 推。挑完怎么推在下一节「下载与推送」。
 */
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
const configStore = useConfigStore();
</script>

<template>
  <div class="search-entity-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBase.SearchEntityWindow.groupSearchBehavior") }}</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <span class="label" style="min-width: 110px">{{ t("SetBase.SearchEntityWindow.queueConcurrency") }}</span>
          <a-input-number v-model:value="configStore.searchEntity.queueConcurrency" :min="1" :max="20" style="width: 120px" />
        </div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.searchEntity.allowSingleSiteSearch" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.allowSingleSiteSearch") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.searchEntity.saveLastFilter" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.saveLastFilter") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.searchEntity.quickSiteFilter" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.quickSiteFilter") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.searchEntity.autoDetectOfficialGroupFromTitle" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.autoDetectOfficialGroupFromTitle") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.searchEntity.forceImdbIdMatchFilter" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.forceImdbIdMatchFilter") }}</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.SearchEntityWindow.groupTagDisplay") }}</div>
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item :label="t('SetBase.SearchEntityWindow.maxTagCountBeforeGroup')">
              <a-input-number v-model:value="configStore.searchEntifyControl.maxTagCountBeforeGroup" :min="1" :max="20" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('SetBase.SearchEntityWindow.hiddenTagNames')">
              <a-input
                :value="configStore.searchEntifyControl.hiddenTagNames.join(',')"
                @change="(e: any) => (configStore.searchEntifyControl.hiddenTagNames = (e.target?.value ?? '').split(',').map((s: string) => s.trim()).filter(Boolean))"
              />
            </a-form-item>
          </a-col>
        </a-row>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.SearchEntityWindow.groupMediaServer") }}</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.mediaServerEntity.autoSearchWhenMount" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.autoSearchWhenMount") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.mediaServerEntity.autoSearchMoreWhenScroll" size="small" />
            <span class="label">{{ t("SetBase.SearchEntityWindow.autoSearchMoreWhenScroll") }}</span>
          </div>
        </div>
        <a-row :gutter="24" style="margin-top: 10px">
          <a-col :span="12">
            <a-form-item :label="t('SetBase.SearchEntityWindow.searchLimit')">
              <a-input-number v-model:value="configStore.mediaServerEntity.searchLimit" :min="5" :max="100" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('SetBase.SearchEntityWindow.mediaQueueConcurrency')">
              <a-input-number v-model:value="configStore.mediaServerEntity.queueConcurrency" :min="1" :max="10" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </div>
    </a-form>
  </div>
</template>
