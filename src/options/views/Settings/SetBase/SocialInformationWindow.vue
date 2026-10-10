<script setup lang="ts">
/**
 * 社交信息设置：PTGen 端点、各社交站点凭据、缓存与超时。
 *
 * 这一页统共 5 个设置，原先每个各占一行、两条凭据输入框还各自限到 420 宽（右边挂着 860 的
 * 空档），用户 2026-10-08 判「太空了」。现在凭据两列填满一行，每个字段补一句 `:extra`。
 *
 * **说明文案每条都回源码核过**，不是照字段名猜的：
 *  - 端点必须带 `<site>` / `<sid>` 占位符 —— `packages/social/index.ts` 里是
 *    `endpoint.replace("<site>", …).replace("<sid>", …)`，不带占位符的地址替换完全不起作用，
 *    请求打过去必然拿不到数据。原先那句占位符 `https://ptgen.example.com/` 就是这个坏形状。
 *  - 留空走内置端点（`ptGenEndpoint` 在 config 默认值里根本没有这个键 → undefined →
 *    取 `buildInPtGenApi[0]`）；填了也仍会把内置的最后一个端点**并发**再试一次，
 *    `Promise.allSettled` 谁先返回用谁。
 *  - Bangumi：`entity/bangumi.ts` 把 apikey 拼成 `Authorization: Bearer <key>`，不填就是匿名请求。
 *  - AniDB：`entity/anidb.ts` 只有填了 client 才走官方 API（含 `/` 时按 `client/clientver` 拆），
 *    否则退回抓取网页解析 —— 所以「不填」对这两个站的意义并不一样，各写各的。
 *  - 超时是单次请求上限（多个端点同时试，不累加）；缓存天数见
 *    `entrypoints/offscreen/utils/socialInformation.ts` 的 `createAt < now - 86400000 * cacheDay`，
 *    填 0 时任何已存条目都算过期。
 */
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
const configStore = useConfigStore();
</script>

<template>
  <div class="social-information-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBase.SocialInformationWindow.groupPtGen") }}</div>
        <a-form-item
          :label="t('SetBase.SocialInformationWindow.ptGenEndpoint')"
          :extra="t('SetBase.SocialInformationWindow.ptGenEndpointHint')"
        >
          <a-input
            v-model:value="configStore.socialSiteInformation.ptGenEndpoint"
            placeholder="https://example.com/ptgen/<site>/<sid>.json"
          />
        </a-form-item>
        <!-- 必须套 .switch-item：这条规则在 SetBase/Index.vue 的非 scoped 样式里
             （display:flex + align-items:center + gap:8px），同页另外 5 个窗口的开关行
             全都套着。裸着放会变成行内排布 —— 实测开关与文字之间 0px 间隙、
             盒子中心比文字光学中心低 1.65px；套上之后是 8px 与 -0.6px。 -->
        <div class="switch-item">
          <a-switch v-model:checked="configStore.socialSiteInformation.preferPtGen" size="small" />
          <span class="label">{{ t("SetBase.SocialInformationWindow.preferPtGen") }}</span>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.SocialInformationWindow.groupCredentials") }}</div>
        <!-- 两条各占半行填满这一档：原先是一行一条 + max-width 420，行尾空 860 -->
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item
              label="Bangumi API Key"
              :extra="t('SetBase.SocialInformationWindow.bangumiHint')"
            >
              <a-input-password
                v-model:value="configStore.socialSiteInformation.socialSite!.bangumi.apikey"
                autocomplete="new-password"
                :visibility-toggle="true"
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item
              label="AniDB Client"
              :extra="t('SetBase.SocialInformationWindow.anidbHint')"
            >
              <a-input-password
                v-model:value="configStore.socialSiteInformation.socialSite!.anidb.client"
                autocomplete="new-password"
                :visibility-toggle="true"
              />
            </a-form-item>
          </a-col>
        </a-row>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.SocialInformationWindow.groupNetwork") }}</div>
        <a-row :gutter="24">
          <a-col :span="12">
            <a-form-item
              :label="t('SetBase.SocialInformationWindow.timeout')"
              :extra="t('SetBase.SocialInformationWindow.timeoutHint')"
            >
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
            <a-form-item
              :label="t('SetBase.SocialInformationWindow.cacheDay')"
              :extra="t('SetBase.SocialInformationWindow.cacheDayHint')"
            >
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
