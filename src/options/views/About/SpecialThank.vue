<script setup lang="ts">
/**
 * 特别感谢页：按本仓库的提交历史，把「智能体」与「模型」两栏各自的贡献量排出来。
 *
 * 数据来自 `src/options/data/agentStats.json`（`node scripts/gen-agent-stats.mjs` 生成、随代码入库）；
 * 图标全部在线直链、不入库，取不到（或还没取到）时退化成首字母徽章。
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

/**
 * git 里的名字 → 厂商名与官方 logo 直链（每条都实测过 200，且吃 chrome-extension Referer 也不被拦）。
 *
 * 2026-10-07 本机逐条测过快慢（`.tmp-build/speedtest-logos.mjs`，直连、不走代理）：
 * 国内 CDN 一律 0.04~0.38s；`.ai` 那几条是 1.1~2.1s，慢在 TLS 往返，不是文件大。
 * 所以能换国内镜像的都换了（WorkBuddy / TraeCode，两条都和新地址逐字节相同）。
 * 剩下两条没有国内镜像、只能留在海外源：OpenCode 与 ZEN 用 opencode.ai、OpenRouter 用
 * openrouter.ai —— 它们的官网只有 `.ai` 这一个域名，npmmirror 又不放 simple-icons
 * （unpkg 白名单 403），换第三方镜像等于给别人的品牌图加一层依赖，不划算。
 * 这两条的观感靠「先亮首字母徽章、图到了再换」兜住，见模板里那段注释。
 */
const BRANDS: Record<string, { vendor?: string; logo: string }> = {
  Qoder: { logo: "https://qoder.com.cn/favIcon.svg" },
  "DeepSeek Harness": { logo: "https://www.deepseek.com/harness/favicon.svg" },
  千问办公: {
    logo: "https://img.alicdn.com/imgextra/i1/O1CN016pjfTq1KjC2STpeei_!!6000000001199-55-tps-24-24.svg",
  },
  WorkBuddy: {
    // 与旧的 download.codebuddy.ai 那条 sha256 逐字节相同（10ccbc09…），只是换成官网
    // （workbuddy.cn 首页 <link rel=icon>）自己声明的国内 CDN：本机实测 1.66s → 0.091s。
    logo: "https://download.codebuddy.cn/web/workbuddy/788eb1c5ba3681efa98cf7b58ae688e293c1bb34/assets/logo.svg",
  },
  TraeCode: {
    // 同上：与 traecdn.ai 那条逐字节相同（49d52393…），换到 trae.cn 首页声明的 .com.cn CDN，
    // 1.19s → 0.084s，而且这条路径不带部署哈希。
    logo: "https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png",
  },
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
/** 图已经下好了才换掉徽章：没配好的海外站点（opencode.ai / openrouter.ai）要 1~2s，先亮徽章比留个空洞好 */
const loaded = ref<Record<string, boolean>>({});

/**
 * 排名口径：提交次数 / 代码量（手写新增行，口径见 `SpecialThank.caliber`）。
 * 名次、进度条、右上角那个强调数字三者都跟着它走 —— 只换顺序不换条的话，
 * 条长会和名次对不上，看着像排错了。
 */
const sortBy = ref<"commits" | "lines">("commits");
const metricOf = (row: IRow) => (sortBy.value === "commits" ? row.commits : row.handAdd);
const sortOptions = computed(() => [
  { value: "commits", label: t("SpecialThank.sortByCommits") },
  { value: "lines", label: t("SpecialThank.sortByLines") },
]);

/**
 * 两栏各自归一化画条：全局取最大值的话，62 次的模型会把 2 次的智能体压成看不见。
 * 标题与对侧标签都写成字面 t("…")，好让 check-locale-keys 真去解析它们。
 */
const groups = computed(() => {
  const build = (source: IRow[], title: string, partnerLabel: string) => {
    // 排序键并列时用另一个口径做次键（与生成脚本的口径一致），不然并列项每次渲染会换位置。
    const rows = [...source].sort(
      sortBy.value === "commits"
        ? (a, b) => b.commits - a.commits || b.handAdd - a.handAdd
        : (a, b) => b.handAdd - a.handAdd || b.commits - a.commits
    );
    return { title, partnerLabel, max: Math.max(...rows.map(metricOf)), rows };
  };
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
  <!-- 整页收进一块白表面（.page-panel 同列表页那一档），原来这里是灰底上摊一条条
       小白卡，页面下半截全是灰。名次行随之改成「白底 + 行分隔线」，不再各自带边框。 -->
  <div class="special-thank page-panel">
    <a-alert :title="t('SpecialThank.thankNote')" type="info" show-icon class="thank-alert" />

    <div class="span-bar">
      <span>{{ spanLine }}</span>
      <!-- 排序切换用 a-radio-group + button-style="solid"（选中项实心蓝底白字），
           不用 a-segmented：segmented 的选中态是「灰底轨道上的一块白浮标」，
           在这条浅灰栏里几乎看不出哪个被选中（用户 2026-10-07 指着它要 solid）。
           全站这类「固定几选一」都是这么写的（SentToDownloaderDialog、SetDownloader 的候选组）。 -->
      <a-radio-group v-model:value="sortBy" button-style="solid" class="sort-control">
        <a-radio-button v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</a-radio-button>
      </a-radio-group>
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
            v-if="logoOf(row.name) && loaded[row.name]"
            :alt="row.name"
            :src="logoOf(row.name)"
            class="rank-logo"
            referrerpolicy="no-referrer"
            @load="loaded[row.name] = true"
            @error="failed[row.name] = true"
          />
          <!-- 没加载完 / 没有配图 / 图挂了，都先占同一格首字母徽章（36×36 定尺寸，换成图不会位移）。
               原来这里带 loading="lazy"：模型平台那一栏在折叠线以下，要等滚到才发起请求，
               海外源再叠 1~2s，就是「图标刷新很慢」的那一段。整页只有 12 张图，不值得懒。 -->
          <span v-else class="rank-logo rank-logo-text">{{ initialsOf(row.name) }}</span>

          <div class="rank-main">
            <div class="rank-head">
              <strong class="rank-name">{{ row.name }}</strong>
              <span v-if="brandOf(row.name).vendor" class="rank-vendor">
                {{ brandOf(row.name).vendor }}
              </span>
              <span class="rank-commits">
                {{
                  sortBy === "commits"
                    ? t("SpecialThank.commitsUnit", { n: fmt(row.commits) })
                    : t("SpecialThank.codeUnit", { add: fmt(row.handAdd) })
                }}
              </span>
            </div>

            <div class="rank-bar">
              <i :style="{ width: share(metricOf(row), group.max) + '%' }" />
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
  /* 必须是 `height` 而不是 `min-height`。这一页的面板就是根节点，全局 .page-panel 带着
     `overflow:auto` + `overscroll-behavior:contain`：写 min-height 时盒子高度跟着内容长、
     滚动范围恒等于 0，于是它仍算一个滚动容器 —— 滚轮落在它身上被 contain 就地吃掉，
     既不滚它也不往外层 .content 链，整页用滚轮滚不动（列表页没这问题，那里面板由
     .page 网格的 1fr 行拿到确定高度，是真的在滚自己）。
     给确定高度后它就成了本该有的那个滚动条宿主，灰底也仍然只露 .content 那 8px 缝。 */
  height: 100%;
  padding: 16px;
}
.thank-alert {
  margin-bottom: 12px;
}
.span-bar {
  display: flex;
  flex-wrap: wrap;
  /* 整行居中。原来这里是 baseline + 下面那条 align-self: center，实测（.tmp-build/bench-seg，
     真组件 + 全局 token.fontSize 13）结果是：控件方框上沿和正文文字上沿齐平、下沿却低出
     12.8px —— 也就是那颗胶囊整体往下坠，正是「这部分没有对齐」。改成全行居中后上下各 6.4px，
     胶囊框中心与两段文字中心都落在同一条线上（胶囊内文字与正文中心差 0.4px，看不出来）。
     旧注释说 baseline 是为了「让两种字号的正文对齐」，但这行只有 13px 一种字号
     （左右两段实测都是 19.2px 行高），baseline 换不来任何东西，只会和居中的控件打架。 */
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 13px;
  background: #fafafa;
  border: 1px solid rgba(5, 5, 5, 0.06);
  border-radius: 8px;
}
.sort-control {
  /* 三条内容挤在一行：左边汇总、右边截止日期，排序按钮靠 auto 边距贴到右侧那组前面。
     flex: 0 0 auto 是必须的 —— 台架量过：radio-group 那排比 segmented 宽 16px（181 vs 165），
     窄窗口下不钉住它，它自己被压成两行（栏高 54 → 86），该让位的是两边的文字。 */
  flex: 0 0 auto;
  margin-left: auto;
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
  padding: 10px 0;
}
/* 白底上的行不再各自一圈边框（那是灰底时代用来把卡片从灰里拎出来的），改用分隔线 */
.rank-row + .rank-row {
  border-top: 1px solid var(--pt-color-border-light);
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
