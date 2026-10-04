<script setup lang="ts">
/**
 * 社交信息设置：PTGen 端点、各社交站点凭据、缓存与超时。
 */
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
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
        <div class="group-title">{{ t("SetBase.SocialInformationWindow.groupPtGen") }}</div>
        <a-form-item :label="t('SetBase.SocialInformationWindow.ptGenEndpoint')">
          <a-input v-model:value="configStore.socialSiteInformation.ptGenEndpoint" placeholder="https://ptgen.example.com/" />
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.socialSiteInformation.preferPtGen" />
          <span class="label">{{ t("SetBase.SocialInformationWindow.preferPtGen") }}</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.SocialInformationWindow.groupCredentials") }}</div>
        <a-form-item
          v-for="site in socialSites"
          :key="site.key"
          :label="site.label"
        >
          <a-input
            v-model:value="configStore.socialSiteInformation.socialSite![site.key][site.field]"
            :placeholder="t('SetBase.SocialInformationWindow.credentialPlaceholder')"
            autocomplete="new-password"
            style="max-width: 420px"
          />
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.SocialInformationWindow.groupNetwork") }}</div>
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item :label="t('SetBase.SocialInformationWindow.timeout')">
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
            <a-form-item :label="t('SetBase.SocialInformationWindow.cacheDay')">
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

