<script setup lang="ts">
/**
 * 用户信息设置：自动刷新队列、并发数、cookie 自动延长、死亡站点显示。
 */
import { useConfigStore } from "@/options/stores/config.ts";

const configStore = useConfigStore();
</script>

<template>
  <div class="user-info-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">用户信息刷新</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <a-switch v-model:checked="configStore.userInfo.autoReflush.enabled" size="small" />
          <span class="label">自动刷新用户信息</span>
        </div>

        <template v-if="configStore.userInfo.autoReflush.enabled">
          <a-row :gutter="24">
            <a-col :span="8">
              <a-form-item label="刷新间隔（分钟）">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.interval" :min="1" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="启动后延迟（秒）">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.afterTime" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="同时刷新站点数">
                <a-input-number v-model:value="configStore.userInfo.queueConcurrency" :min="1" :max="20" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>

          <a-row :gutter="24">
            <a-col :span="12">
              <a-form-item label="重试最大次数（0 = 不重试）">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.retry.max" :min="0" :max="10" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="重试间隔（秒）">
                <a-input-number v-model:value="configStore.userInfo.autoReflush.retry.interval" :min="5" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
        </template>
      </div>

      <div class="group">
        <div class="group-title">展示</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.userInfo.alwaysPickLastUserInfo" size="small" />
            <span class="label">优先使用最近一次获取的用户信息</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.userInfo.showDeadSiteInOverview" size="small" />
            <span class="label">显示已死亡/无法访问的站点</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">Cookie 自动延长</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <a-switch v-model:checked="configStore.autoExtendCookies.enabled" size="small" />
          <span class="label">启用 Cookie 过期自动延长（防止长期未访问导致登录态丢失）</span>
        </div>
        <a-row v-if="configStore.autoExtendCookies.enabled" :gutter="24">
          <a-col :span="12">
            <a-form-item label="触发阈值（剩余周数）">
              <a-input-number v-model:value="configStore.autoExtendCookies.triggerThreshold" :min="1" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="延长时长（月）">
              <a-input-number v-model:value="configStore.autoExtendCookies.extensionDuration" :min="1" :max="12" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </div>
    </a-form>
  </div>
</template>
