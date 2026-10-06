<script setup lang="ts">
/**
 * 特别感谢页：按本仓库的提交历史，把「智能体」与「模型」两栏各自的贡献量排出来。
 *
 * 数据来自 `src/options/data/agentStats.json`（`node scripts/gen-agent-stats.mjs` 生成、随代码入库）；
 * 图标全部在线直链、不入库，取不到时退化成首字母徽章。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import rawStats from "@/options/data/agentStats.json";

interface IRow {
  name: string;
  commits: number;
  feat: number;
  handAdd: number;
  handDel: number;
  bulkAdd: number;
  versionFrom: string;
  versionTo: string;
  partners: { name: string; count: number }[];
}

interface IStats {
  headVersion: string;
  span: {
    commits: number;
    firstDate: string;
    lastDate: string;
  };
  totals: { handAdd: number; handDel: number; bulkAdd: number };
  agents: IRow[];
  models: IRow[];
  platforms: IRow[];
}

/** git 里的名字 → 厂商名与官方 logo 直链（每条都实测过 200，且吃 chrome-extension Referer 也不被拦）。 */
const BRANDS: Record<string, { vendor?: string; logo: string }> = {
  Qoder: { logo: "https://qoder.com.cn/favIcon.svg" },
  "DeepSeek Harness": { logo: "https://www.deepseek.com/harness/favicon.svg" },
  千问办公: {
    logo: "https://img.alicdn.com/imgextra/i1/O1CN016pjfTq1KjC2STpeei_!!6000000001199-55-tps-24-24.svg",
  },
  WorkBuddy: {
    logo: "https://download.codebuddy.ai/web/workbuddy/f5bce0c03cdc17fa28d25634fb48d2791c297da3/assets/logo.svg",
  },
  Trae: { logo: "https://lf16-web-neutral.traecdn.ai/obj/trae-ai-static/trae_website/favicon.png" },
  OpenCode: { logo: "https://opencode.ai/apple-touch-icon-v3.png" },
  "Qwen3.8-Flash": {
    vendor: "千问",
    logo: "https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png",
  },
  "GLM-5.3-Flash": { vendor: "智谱", logo: "https://www.zhipuai.cn/favicon.png" },
  "Hy4 preview": {
    vendor: "腾讯混元",
    logo: "https://cdn-portal.hunyuan.tencent.com/public/static/logo/logo.png",
  },
  // minimax.io 是 .io TLD，大陆网络里解析不到；minimax.cn 是同一份 4286B 图标的国内域名。
  "Space Bunny": { vendor: "MiniMax", logo: "https://www.minimax.cn/favicon.ico" },
  "Seed-Evolving": {
    // 字节跳动公司标没有可长期直链的地址（官网 favicon 是内联 base64，站内图全是带哈希的
    // _next 产物），所以用火山引擎 —— 字节的模型云平台，豆包/Seed 系列就在上面服务。
    vendor: "字节跳动 · 火山引擎",
    logo: "https://portal.volccdn.com/obj/volcfe/misc/favicon.png",
  },
  OpenRouter: { logo: "https://openrouter.ai/favicon/glyph.png" },
  ZEN: {
    vendor: "OpenCode",
    logo: "https://opencode.ai/apple-touch-icon-v3.png",
  },
};

const stats = rawStats as unknown as IStats;
const { t } = useI18n();

const failed = ref<Record<string, boolean>>({});

/**
 * 两栏各自归一化画条：全局取最大值的话，62 次的模型会把 2 次的智能体压成看不见。
 * 标题与对侧标签都写成字面 t("…")，好让 check-locale-keys 真去解析它们。
 */
const groups = computed(() => {
  const build = (rows: IRow[], title: string, partnerLabel: string) => ({
    title,
    partnerLabel,
    max: Math.max(...rows.map((row) => row.commits)),
    rows,
  });
  return {
    agents: build(stats.agents, t("SpecialThank.agents"), t("SpecialThank.usedModels")),
    models: build(stats.models, t("SpecialThank.models"), t("SpecialThank.usedBy")),
    platforms: build(stats.platforms, t("SpecialThank.platforms"), t("SpecialThank.usedBy")),
  };
});

/** 智能体与模型左右并排（窄屏自动叠成一列），平台单独铺满一行。 */
const bands = computed(() => [
  { cls: "band-duo", groups: [groups.value.agents, groups.value.models] },
  { cls: "band-full", groups: [groups.value.platforms] },
]);

const brandOf = (name: string) => BRANDS[name] ?? { logo: "" };
const logoOf = (name: string) => {
  const logo = brandOf(name).logo;
  return logo && !failed.value[name] ? logo : "";
};

/** 没配到 logo（或图挂了）的兜底：英文取各词首字母，中文取首字。 */
const initialsOf = (name: string) => {
  const cjk = name.match(/[一-龥]/g);
  if (cjk) return cjk[0];
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
};

const fmt = (n: number) => n.toLocaleString("en-US");
const share = (n: number, max: number) => Math.max(3, Math.round((n / max) * 100));

const spanLine = computed(() =>
  t("SpecialThank.spanSummary", {
    commits: fmt(stats.span.commits),
    agents: stats.agents.length,
    models: stats.models.length,
    add: fmt(stats.totals.handAdd),
    del: fmt(stats.totals.handDel),
  }),
);
</script>

<template>
  <div class="special-thank">
    <a-alert :title="t('SpecialThank.thankNote')" type="info" show-icon class="thank-alert" />

    <div class="span-bar">
      <span>{{ spanLine }}</span>
      <span class="muted">
        {{ t("SpecialThank.asOf", { version: stats.headVersion, date: stats.span.lastDate }) }}
      </span>
    </div>

    <div v-for="band in bands" :key="band.cls" class="band" :class="band.cls">
      <section v-for="group in band.groups" :key="group.title" class="group">
        <h3 class="group-title">{{ group.title }}</h3>

        <div v-for="(row, idx) in group.rows" :key="row.name" class="rank-row">
          <span class="rank-no">{{ idx + 1 }}</span>

          <img
            v-if="logoOf(row.name)"
            :alt="row.name"
            :src="logoOf(row.name)"
            class="rank-logo"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="failed[row.name] = true"
          />
          <span v-else class="rank-logo rank-logo-text">{{ initialsOf(row.name) }}</span>

          <div class="rank-main">
            <div class="rank-head">
              <strong class="rank-name">{{ row.name }}</strong>
              <span v-if="brandOf(row.name).vendor" class="rank-vendor">
                {{ brandOf(row.name).vendor }}
              </span>
              <span class="rank-commits">
                {{ t("SpecialThank.commitsUnit", { n: fmt(row.commits) }) }}
              </span>
            </div>

            <div class="rank-bar">
              <i :style="{ width: share(row.commits, group.max) + '%' }" />
            </div>

            <div class="rank-metrics">
              <span>
                {{ t("SpecialThank.lines", { add: fmt(row.handAdd), del: fmt(row.handDel) }) }}
              </span>
              <span>{{ t("SpecialThank.feat", { n: row.feat }) }}</span>
              <span>v{{ row.versionFrom }} → v{{ row.versionTo }}</span>
              <span v-if="row.bulkAdd" class="muted">
                {{ t("SpecialThank.bulk", { add: fmt(row.bulkAdd) }) }}
              </span>
            </div>

            <div class="rank-partners muted">
              <span>{{ group.partnerLabel }}</span>
              <span v-for="partner in row.partners" :key="partner.name" class="partner">
                {{ partner.name }}&nbsp;<em>{{ partner.count }}</em>
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <p class="caliber muted">{{ t("SpecialThank.caliber") }}</p>
  </div>
</template>

<style scoped>
.special-thank {
  padding: 16px;
}
.thank-alert {
  margin-bottom: 12px;
}
.span-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 13px;
  background: #fafafa;
  border: 1px solid rgba(5, 5, 5, 0.06);
  border-radius: 8px;
}
.group {
  margin-bottom: 20px;
}
.band-duo {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 16px;
  align-items: start;
}
.band-duo .group {
  margin-bottom: 0;
}
.group-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}
.rank-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid rgba(5, 5, 5, 0.06);
  border-radius: 8px;
}
.rank-row + .rank-row {
  margin-top: 8px;
}
.rank-no {
  flex: 0 0 auto;
  width: 20px;
  padding-top: 2px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgba(0, 0, 0, 0.35);
}
.rank-logo {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.rank-logo-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: #1677ff;
  background: #f0f6ff;
  border-radius: 10px;
}
.rank-main {
  flex: 1 1 auto;
  min-width: 0;
}
.rank-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}
.rank-name {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.88);
}
.rank-vendor {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.rank-commits {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #1677ff;
}
.rank-bar {
  height: 4px;
  margin: 8px 0;
  overflow: hidden;
  background: #f0f0f0;
  border-radius: 2px;
}
.rank-bar > i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #69b1ff, #1677ff);
  border-radius: 2px;
}
.rank-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgba(0, 0, 0, 0.65);
}
.rank-partners {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
}
.partner {
  padding: 1px 8px;
  background: #fafafa;
  border: 1px solid rgba(5, 5, 5, 0.06);
  border-radius: 10px;
}
.partner > em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
  color: rgba(0, 0, 0, 0.4);
}
.caliber {
  padding-top: 4px;
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  border-top: 1px solid rgba(5, 5, 5, 0.06);
}
.muted {
  color: rgba(0, 0, 0, 0.45);
}
</style>
