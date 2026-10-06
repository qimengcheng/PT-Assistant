<script setup lang="ts">
/**
 * 特别感谢页：展示参与本项目开发的 AI 编程智能体的官方 logo。
 * 图片直连各家官网/CDN（不落库），取不到时退化成只显示名称。
 */
import { reactive } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const agents = [
  { name: "Qoder", logo: "https://qoder.com.cn/favIcon.svg" },
  {
    name: "TraeCode",
    logo: "https://lf16-web-neutral.traecdn.ai/obj/trae-ai-static/trae_website/favicon.png",
  },
  { name: "OpenCode", logo: "https://opencode.ai/apple-touch-icon-v3.png" },
  {
    name: "WorkBuddy",
    logo: "https://download.codebuddy.ai/web/workbuddy/f5bce0c03cdc17fa28d25634fb48d2791c297da3/assets/logo.svg",
  },
  { name: "DeepSeek Harness", logo: "https://www.deepseek.com/harness/favicon.svg" },
  { name: "DeepSeek", logo: "https://www.deepseek.com/favicon.ico" },
  {
    name: "千问办公",
    logo: "https://img.alicdn.com/imgextra/i1/O1CN016pjfTq1KjC2STpeei_!!6000000001199-55-tps-24-24.svg",
  },
  {
    name: "千问",
    logo: "https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png",
  },
  { name: "智谱", logo: "https://www.zhipuai.cn/favicon.png" },
  { name: "OpenRouter", logo: "https://openrouter.ai/favicon/glyph.png" },
];

const logoFailed = reactive<Record<string, boolean>>({});
</script>

<template>
  <div class="special-thank">
    <a-alert :title="t('SpecialThank.thankNote')" type="info" show-icon class="thank-alert" />

    <div class="agent-wall">
      <div v-for="agent in agents" :key="agent.name" class="agent-tile">
        <img
          v-if="!logoFailed[agent.name]"
          :alt="agent.name"
          :src="agent.logo"
          class="agent-logo"
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="logoFailed[agent.name] = true"
        />
        <span class="agent-name">{{ agent.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.special-thank {
  padding: 16px;
}
.thank-alert {
  margin-bottom: 16px;
}
.agent-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.agent-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 12px 14px;
  background: #fff;
  border: 1px solid rgba(5, 5, 5, 0.06);
  border-radius: 8px;
}
.agent-logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
.agent-name {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.72);
}
</style>
