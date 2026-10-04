<script setup lang="ts">
/**
 * 用户信息设置：自动刷新队列、并发数、cookie 自动延长、死亡站点显示。
 */
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
const configStore = useConfigStore();
</script>

<template>
  <div class="user-info-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBase.UserInfoWindow.groupRefresh") }}</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <a-switch v-model:checked="configStore.userInfo.autoReflush.enabled" size="small" />
          <span class="label">{{ t("SetBase.UserInfoWindow.autoReflush") }}</span>
        </div>

        <template v-if="configStore.userInfo.autoReflush.enabled">
          <a-row :gutter="24">
            <a-col :span="8">
              <a-form-item :label="t('SetBase.UserInfoWindow.interval')">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.interval" :min="1" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item :label="t('SetBase.UserInfoWindow.afterTime')">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.afterTime" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item :label="t('SetBase.UserInfoWindow.queueConcurrency')">
                <a-input-number v-model:value="configStore.userInfo.queueConcurrency" :min="1" :max="20" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>

          <a-row :gutter="24">
            <a-col :span="12">
              <a-form-item :label="t('SetBase.UserInfoWindow.retryMax')">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.retry.max" :min="0" :max="10" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item :label="t('SetBase.UserInfoWindow.retryInterval')">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.retry.interval" :min="5" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
        </template>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.UserInfoWindow.groupDisplay") }}</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.userInfo.alwaysPickLastUserInfo" size="small" />
            <span class="label">{{ t("SetBase.UserInfoWindow.alwaysPickLastUserInfo") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.userInfo.showDeadSiteInOverview" size="small" />
            <span class="label">{{ t("SetBase.UserInfoWindow.showDeadSiteInOverview") }}</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.UserInfoWindow.groupCookie") }}</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <a-switch v-model:checked="configStore.autoExtendCookies.enabled" size="small" />
          <span class="label">{{ t("SetBase.UserInfoWindow.autoExtendCookies") }}</span>
        </div>
        <a-row v-if="configStore.autoExtendCookies.enabled" :gutter="24">
          <a-col :span="12">
            <a-form-item :label="t('SetBase.UserInfoWindow.triggerThreshold')">
              <a-input-number v-model:value="configStore.autoExtendCookies.triggerThreshold" :min="1" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item :label="t('SetBase.UserInfoWindow.extensionDuration')">
              <a-input-number v-model:value="configStore.autoExtendCookies.extensionDuration" :min="1" :max="12" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </div>
    </a-form>
  </div>
</template>
