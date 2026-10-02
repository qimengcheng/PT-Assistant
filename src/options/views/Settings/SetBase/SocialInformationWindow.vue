<script setup lang="ts">
/**
 * 社交信息设置：PTGen 端点、各社交站点凭据、缓存与超时。
 */
import { useConfigStore } from "@/options/stores/config.ts";

const configStore = useConfigStore();

const socialSites = [
  { key: "bangumi", field: "apikey", label: "Bangumi API Key" },
  { key: "anidb", field: "client", label: "AniDB Client" },
] as const;
</script>

<template>
  <div class="social-information-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">PTGen（通用百科信息转储服务）</div>
        <a-form-item label="PTGen API 端点">
          <a-input v-model:value="configStore.socialSiteInformation.ptGenEndpoint" placeholder="https://ptgen.example.com/" />
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.socialSiteInformation.preferPtGen" />
          <span class="label">优先使用 PTGen 获取影片信息</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">站点凭据</div>
        <a-form-item
          v-for="site in socialSites"
          :key="site.key"
          :label="site.label"
        >
          <a-input
            v-model:value="configStore.socialSiteInformation.socialSite![site.key][site.field]"
            placeholder="未配置则使用匿名访问"
            autocomplete="new-password"
            style="max-width: 420px"
          />
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">网络</div>
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item label="请求超时（秒）">
              <a-input-number
                :value="configStore.socialSiteInformation.timeout! / 1000"
                :min="1"
                :max="120"
                style="width: 100%"
                @change="(v: any) => (configStore.socialSiteInformation.timeout = (v ?? 10) * 1000)"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="缓存天数">
              <a-input-number
                v-model:value="configStore.socialSiteInformation.cacheDay"
                :min="0"
                :max="90"
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
