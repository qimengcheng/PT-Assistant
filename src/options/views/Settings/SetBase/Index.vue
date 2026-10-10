<script setup lang="ts">
/**
 * 基础设置页容器：九组设置项排在同一条长页里，左边一列目录点哪条滚到哪条，目录自己按
 * 「天天用得上 / 按需调整 / 一次配好」分三档。
 *
 * 为什么不再是 a-tabs：八档各开一页时，「改一处要跳三页」，而且每一页的宽度口径不一样
 * （五档铺满竖栏、三档自己收在 720），看着像八个页面而不是一个设置。用户 2026-10-09：
 * 「把整个设置做成一个长的滚动的页面，卡片悬浮式目录放到左边，一点就滚动到相应的部分。
 * 顺便把整个设置的风格和宽度统一一下」。
 *
 * 为什么这次又改分法（用户 2026-10-10：「设置界面的分组还是之前的插件的分组…重新设计分组
 * 和排列，更常用的放在最前面」）：那八档的名字和顺序是旧插件按**设置类别**切的，
 * 跟这里实际怎么用没有关系 —— 判据见下面 `sections` 那条注释。
 *
 * 目录那一列不参与滚动（滚的只有右边那一列）：这是新手引导页 v0.40.2 已经定过的口径 ——
 * 「目录不能被滚动滚走，应该一直都能完整看到」。那页试过「整页滚 + 目录 sticky」，
 * 滚到底时 sticky 被容器底边顶回去、目录头几条被切掉，所以这里不再走那条路。
 *
 * 各窗口直接 v-model 绑定 configStore 字段；config store 开启了 persistWebExt
 * 自动持久化（每次变更自动 $save），无需手动保存按钮。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { MutationType } from "pinia";
import { useDebounceFn } from "@vueuse/core";
import { App } from "antdv-next";

import { useConfigStore } from "@/options/stores/config.ts";

import AppearanceWindow from "./AppearanceWindow.vue";
import SitePageWindow from "./SitePageWindow.vue";
import AdvancedWindow from "./AdvancedWindow.vue";
import UserInfoWindow from "./UserInfoWindow.vue";
import SearchEntityWindow from "./SearchEntityWindow.vue";
import DownloadWindow from "./DownloadWindow.vue";
import BackupWindow from "./BackupWindow.vue";
import SocialInformationWindow from "./SocialInformationWindow.vue";
import UpdateWindow from "./UpdateWindow.vue";

const { t } = useI18n();

/**
 * 顺序 = 页面上的先后 = 目录的先后，`tier` 决定目录里归到哪一档。
 *
 * 这一套分法是按**用户做什么**排的，不再照旧插件那种「按设置类别」排（旧的分法是
 * 界面 / 用户信息 / 搜索结果 / 下载器 / 备份 / 助手 六个 tab，谁先谁后全看类别名顺不顺眼）。
 * 三条判据：
 *  1. 天天用的排前面（搜 → 推 → 在站点页面上的手感），一次配好的排后面；
 *  2. 一节只管一类动作 —— 原先「界面与内容脚本」把「插件自己的界面」和「注入到站点页面的助手」
 *     挤在同一节，前者是选语言/表格行为，后者是九个开关，两组东西没有一次一起改过；
 *     而「开发者选项」这种低频又带风险的档一直排在第一节，跟语言并列；
 *  3. 相邻两节读起来是一条路（搜索 → 下载 → 页面助手 → 账号 …），不是字典序。
 *
 * `key` 只有 `backup` 被别处深链用到（SetBackup/RestoreDialog 推 `?tab=backup`），认不出来的
 * 键由 `pickKey` 落回第一条，所以旧链接不会白屏。
 */
const sections = computed(
  () =>
    [
      {
        key: "search",
        tier: t("SetBase.Index.tierDaily"),
        label: t("SetBase.Index.secSearch"),
        desc: t("SetBase.Index.descSearch"),
        component: SearchEntityWindow,
      },
      {
        key: "download",
        tier: t("SetBase.Index.tierDaily"),
        label: t("SetBase.Index.secDownload"),
        desc: t("SetBase.Index.descDownload"),
        component: DownloadWindow,
      },
      {
        key: "site-page",
        tier: t("SetBase.Index.tierDaily"),
        label: t("SetBase.Index.secSitePage"),
        desc: t("SetBase.Index.descSitePage"),
        component: SitePageWindow,
      },
      {
        key: "account",
        tier: t("SetBase.Index.tierWhenNeeded"),
        label: t("SetBase.Index.secAccount"),
        desc: t("SetBase.Index.descAccount"),
        component: UserInfoWindow,
      },
      {
        key: "appearance",
        tier: t("SetBase.Index.tierWhenNeeded"),
        label: t("SetBase.Index.secAppearance"),
        desc: t("SetBase.Index.descAppearance"),
        component: AppearanceWindow,
      },
      {
        key: "social",
        tier: t("SetBase.Index.tierWhenNeeded"),
        label: t("SetBase.Index.secSocial"),
        desc: t("SetBase.Index.descSocial"),
        component: SocialInformationWindow,
      },
      {
        key: "backup",
        tier: t("SetBase.Index.tierOnce"),
        label: t("SetBase.Index.secBackup"),
        desc: t("SetBase.Index.descBackup"),
        component: BackupWindow,
      },
      {
        key: "update",
        tier: t("SetBase.Index.tierOnce"),
        label: t("SetBase.Index.secUpdate"),
        desc: t("SetBase.Index.descUpdate"),
        component: UpdateWindow,
      },
      {
        key: "advanced",
        tier: t("SetBase.Index.tierOnce"),
        label: t("SetBase.Index.secAdvanced"),
        desc: t("SetBase.Index.descAdvanced"),
        component: AdvancedWindow,
      },
    ] as const,
);

const route = useRoute();
const scroller = ref<HTMLElement | null>(null);
/** 当前高亮的那一条。初值取地址栏的 ?tab=，认不出来就落回第一条 */
const activeKey = ref<string>(pickKey(route.query.tab));

function pickKey(q: unknown): string {
  const k = typeof q === "string" ? q : "";
  return sections.value.some((s) => s.key === k) ? k : sections.value[0].key;
}

const sectionId = (key: string) => `set-${key}`;

/**
 * 目录按档位分段（`分组` 这一列原先是一条平铺的八条，现在三条档名 + 九节）。
 * 连续同档归成一块，所以档与档之间只由数据决定，不用手数有几条。
 */
const tocTiers = computed(() => {
  const out: { tier: string; items: { key: string; label: string }[] }[] = [];
  for (const s of sections.value) {
    const last = out[out.length - 1];
    if (last && last.tier === s.tier) last.items.push({ key: s.key, label: s.label });
    else out.push({ tier: s.tier, items: [{ key: s.key, label: s.label }] });
  }
  return out;
});

/**
 * 点目录 / 深链跳转都走这里。
 *
 * spyPaused 是必需的：平滑滚动一路上会经过中间那几条，滚轮监听会把高亮改成正在路过的条目，
 * 于是「点最后一条、高亮停在第三条」。所以跳转期间让高亮听人的，落地后再交还给滚轮。
 * 时长取 900ms：这段距离用 smooth 滚到底实测没超过它，而超时兜底比等 scrollend 可靠
 * （scrollend 在部分内核上仍是要开 flag 的）。
 */
let spyPaused = false;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function jumpTo(key: string, smooth = true) {
  const el = document.getElementById(sectionId(key));
  if (!el) return;
  activeKey.value = key;
  spyPaused = true;
  clearTimeout(resumeTimer);
  el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  resumeTimer = setTimeout(() => (spyPaused = false), 900);
}

/**
 * 滚轮跟踪：取「顶沿已经越过读数线」的最后一条。读数线在滚动区顶边往下 12px。
 *
 * 滚到底那一条要特判：最后一节往往比一屏矮，滚到底时它的顶沿还在读数线下面，
 * 按上面那条判据它永远亮不起来 —— 台架量过（滚到底，高亮停在倒数第二条）。
 * 于是「已经滚到底」直接算最后一节，其余照旧。
 */
function spy() {
  if (spyPaused) return;
  const box = scroller.value;
  if (!box) return;
  const keys = sections.value;
  if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) {
    activeKey.value = keys[keys.length - 1].key;
    return;
  }
  const line = box.getBoundingClientRect().top;
  let cur = activeKey.value;
  for (const node of box.querySelectorAll<HTMLElement>(".set-section")) {
    if (node.getBoundingClientRect().top - line <= 12) cur = node.dataset.key ?? cur;
    else break;
  }
  if (cur !== activeKey.value) activeKey.value = cur;
}

onMounted(() => {
  scroller.value?.addEventListener("scroll", spy, { passive: true });
  // 从别处跳进来（RestoreDialog 推 ?tab=backup）：直接落到位，不要来一段平滑滚动
  const key = pickKey(route.query.tab);
  if (key !== sections.value[0].key) nextTick(() => jumpTo(key, false));
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener("scroll", spy);
  clearTimeout(resumeTimer);
});

// 已经在这一页时再被推 ?tab=xxx（组件不重挂载），也要滚过去
watch(
  () => route.query.tab,
  (tab) => {
    if (route.name !== "SetBase") return;
    nextTick(() => jumpTo(pickKey(tab), false));
  },
);

// ===== 「改完就报已保存」：顶栏那句静态提示的替代品 =====
const configStore = useConfigStore();
// 走 App.useApp() 而不是静态 import { message }：静态那份挂在根上，吃不到
// entrypoints/options/App.vue 那层 a-config-provider 的 token（字号 13 等）。
// <a-app> 确实包着 router-view，正例见 views/Devtools/Debugger.vue:33。
const { message } = App.useApp();

/**
 * 三条边界都是实测来的，少一条就会凭空弹 toast：
 * 1) 订阅要等 $onReady —— 水合那次 store.$patch 本身是一次 mutation（虽然它走 patchObject，
 *    见下条），但 afterRestore 里的废弃项清理是直接改 state，不等就会在打开页面时报一次「已保存」。
 * 2) 只认 MutationType.direct —— 本页 9 个窗口全是裸 v-model（实测：三层嵌套字段赋值报 direct）；
 *    而水合与跨上下文同步（chrome.storage.onChanged → $patch）报的是 patch object，
 *    不按这个过滤，别的窗口改一下配置这边就会跟着弹。
 * 3) 必须合并 —— 文本框逐字符写 store，不合并就是每敲一个字一条 toast。
 *    延后报不会说谎：插件是每次 mutation 立刻 $save，没有 debounce。
 *
 * 改成单页之后这条更要紧：八组同时挂着，任何一个窗口写 store 都会报，
 * 而用户可能在滚着看另一组 —— 所以只在 direct（真有人碰了控件）时报，不在 patch 时报。
 */
const announceSaved = useDebounceFn(() => message.success(t("SetBase.Index.savedToast")), 600);
let stopConfigWatch: (() => void) | undefined;
let isUnmounted = false;

configStore.$onReady(() => {
  if (isUnmounted) return;
  stopConfigWatch = configStore.$subscribe(
    (mutation) => {
      if (mutation.type !== MutationType.direct) return;
      announceSaved();
    },
    { detached: true },
  );
});

onUnmounted(() => {
  isUnmounted = true;
  stopConfigWatch?.();
});
</script>

<template>
  <div class="set-base page-fill">
    <div class="set-base-body page-fill-grow">
      <div class="set-base-layout">
        <nav class="set-base-toc">
          <span class="set-base-toc-label">{{ t("SetBase.Index.toc") }}</span>
          <!-- 目录按档位分块（天天用得上 / 按需调整 / 一次配好）：九节平铺着排，
               用户仍然是从头读到尾才知道有没有自己要的那一条；档名先把范围圈出来。
               窄屏那一档（下面 @container 里那一段）只把这一列横排，块结构照留。 -->
          <div v-for="tier in tocTiers" :key="tier.tier" class="set-base-toc-tier">
            <span class="set-base-toc-tier-label">{{ tier.tier }}</span>
            <!-- 按钮 + scrollIntoView，不用 <a href="#x">：这个应用走 hash 路由
                 （createWebHashHistory），href="#x" 会被路由吃掉并跳到一个不存在的页。同 GuideView -->
            <a-button
              v-for="s in tier.items"
              :key="s.key"
              type="text"
              block
              class="set-base-toc-item"
              :class="{ 'set-base-toc-item--on': activeKey === s.key }"
              @click="jumpTo(s.key)"
            >
              {{ s.label }}
            </a-button>
          </div>
        </nav>

        <div ref="scroller" class="set-base-content">
          <section
            v-for="s in sections"
            :id="sectionId(s.key)"
            :key="s.key"
            :data-key="s.key"
            class="set-section"
          >
            <h2 class="set-section-title">{{ s.label }}</h2>
            <!-- 每一节先说清「这一节管什么、在哪儿改不了」：九节重排之后，靠标题本身
                 判断不出边界（比如「备份与数据迁移」不含备份服务器 —— 那在左侧那一页）。 -->
            <p class="set-section-desc">{{ s.desc }}</p>
            <component :is="s.component" />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* SetBase 通用布局（非 scoped，供各子窗口复用）：
   整页收进一块白表面、分组用分隔线区分、开关两列排布。
   以前是「灰底上摊着几张白卡」，卡片只有 960 宽，右边和下面整片都是灰 —— 现在换成
   与列表页 .page-panel 同档的一整块白面板（同 border / 同 10px 圆角）。 */
/* 根上这条是「内层那一列能滚」的前提：.page-fill 只给 min-height，父级高度不确定时
   子元素的 height:100% 会退成 auto，于是 grid 拿不到高度、右边那列永远不滚。
   同 GuideView 的 .guide-view（那页 v0.40.2 就是这么改的）。 */
.set-base {
  height: 100%;
}

.set-base .set-base-body {
  padding: 8px 16px 16px;
  background: #fff;
  border: 1px solid var(--pt-color-border-light);
  border-radius: 10px;
  /* 滚动交给右边那一列，面板自己不滚 */
  min-height: 0;
  overflow: hidden;
  /* 目录收不收成一列，看的是这块读书区有多宽，不是整个视口有多宽（同 GuideView） */
  container-type: inline-size;
}

/* 两列：目录 168 + 32 缝 + 内容。整块铺满面板高度，所以两列各自到边、只有右列能滚。
   1480 = 168 + 32 + 1280，竖栏那一档沿用原来的 .set-base-inner（量出来的 1280，
   见下面那条注释），只是现在左边多挂了一列目录；窗口更宽时整块居中，不再往两边摊。 */
.set-base-layout {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 0 32px;
  height: 100%;
  max-width: 1480px;
  margin: 0 auto;
}

.set-base-toc {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.set-base-toc-label {
  margin-bottom: 4px;
  font-weight: 600;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.88);
}

/* 一档一块：档名是「这一片在讲什么」的标签，不是能点的条目，所以不跟按钮同一档字重/字号 */
.set-base-toc-tier + .set-base-toc-tier {
  margin-top: 12px;
}

.set-base-toc-tier {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.set-base-toc-tier-label {
  margin: 0 0 2px 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

/* 目录这一列用 type="text" 的按钮，不是随手挑的：antd 的 Button 只在「有边框那几档」上
   才会把两个汉字的标签拆成「搜 索」（Button.js:121 的 isUnBorderedButtonVariant 判据），
   而这一列标签里「搜索 / 下载 / 备份」正好是两个字 —— 用默认档就会跟右边那节的标题
   写成两种样子。同 GuideView 的目录（那页也是 type="link" 的无边框档）。 */
.set-base-toc .ant-btn {
  justify-content: flex-start;
  padding-inline: 8px;
}

/* 当前在哪一节：跟着左侧导航那一档选中色（同 --pt-color-bg-selected / primary-text），
   不再造一套高亮。
   两条选择器都要写：antd 的 `.ant-btn-text:hover` 是 (0,2,0) 且由 cssinjs 运行时注入，
   排在静态样式之后 —— 只给 (0,1,0) 的同特异度抢不过它，鼠标悬停时选中态会被冲掉。 */
.set-base-toc .set-base-toc-item--on,
.set-base-toc .set-base-toc-item--on:hover {
  background: var(--pt-color-bg-selected);
  color: var(--pt-color-primary-text);
  font-weight: 600;
}

.set-base-content {
  min-height: 0;
  overflow-y: auto;
  /* 12px 不是留白，是 a-row :gutter="24" 的负外边距（左右各 −12）的兜底：
     这一列自己就是滚动容器，而 overflow-y:auto 会让 overflow-x 一并变成 auto
     （规范里 visible 不能跟 auto 配对），所以那 12px 溢出会当场画出一条横向滚动条。
     四节（搜索 / 账号与流量 / 外观与表格 / 百科与评分信息）各有一到两个 a-row，实测从 900 到 2400
     窗口宽、中英两语都稳定溢出 12px。台架 .tmp-build/bench-setbase-overflow。 */
  padding: 0 12px 32px;
}

/* 九节排一列：每节一个标题 + 一行说明 + 一条下分隔线，节与节之间 28px。
   原来这层分隔是 a-tabs 的卡片头给的，现在由标题自己承担。 */
.set-section {
  padding-top: 4px;
  scroll-margin-top: 8px;
}

.set-section + .set-section {
  margin-top: 28px;
}

.set-section-title {
  margin: 0 0 4px;
  padding-bottom: 6px;
  font-size: 15px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
  border-bottom: 1px solid var(--pt-color-border-light);
}

/* 标题下那一行说明：写在标题与内容之间，是因为重排之后节与节的边界靠名字判不准
   （「备份与数据迁移」里没有备份服务器，「账号与流量」里没有站点列表）。
   字号跟 .task-subtitle 同档，颜色比正文淡一档，不跟设置项的标签抢注意力。 */
.set-section-desc {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.65);
}

/* 窄到放不下两列（读书区 720px 以下）时收回成一列：目录回到正文上方横排，仍然不滚 */
@container (max-width: 720px) {
  .set-base-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .set-base-toc {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 16px;
    overflow-y: visible;
  }

  /* 横排那一档里三块摊平成一条：档名在这宽度下没有列可标，留着只会像一颗点不动的按钮 */
  .set-base-toc-tier {
    display: contents;
  }

  .set-base-toc-tier-label {
    display: none;
  }

  .set-base-toc .ant-btn {
    width: auto;
  }
}

.set-base .group {
  margin-bottom: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--pt-color-border-light);
}

.set-base .group-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 12px;
  color: rgba(0, 0, 0, 0.88);
}

/* 开关网格：一格至少 300、等宽铺满 —— 1280 竖栏里正好三列（内容宽 1248 = 1280 − 16×2 内衬）。
   原来写死 `1fr 1fr` 两列，每格 612，而这一屏最长的开关档实测只有 270（zh）/ 364（en）
   → 每格白丢 250~340，两列之间和行尾各挂着一条三四百像素的空档，就是用户 2026-10-08 圈
   出来的那两块。数字来自台架 .tmp-build/bench-setbase（真 style 块 + 真 a-switch + 真语言包
   文案，逐条量 label 的 scrollWidth）。
   ⚠️ 用 auto-fill 而不是 auto-fit：auto-fit 会把没占满的空列塌掉、把剩下的格拉宽，
   于是「表格与版本」这种两条一组的网格又被拉回 612 一档 —— 等于白改。 */
.set-base .switch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  column-gap: 24px;
  row-gap: 10px;
}

.set-base .switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 标签允许换行：en 有三条超过 400 一档（autoExtendCookies 464、methodExtension 401、
   initDownloaderTorrentOnEnter 370），原来 nowrap + ellipsis 会把设置名截断 ——
   截断一个设置名比让它占两行严重（AGENTS §3.5：用户看不全的文案等于坏文案）。 */
.set-base .switch-item .label {
  margin-left: 0;
  font-size: 13px;
}

/* 这里原来有三条 `.set-base .compact-form :deep(.ant-form-item-label / .ant-select)`，已删。
   删的是**从来没生效过**的规则，所以界面一个像素都没变：本块是 `<style>`（不带 scoped，为的是
   `.set-base .group` 那几条能伸进各窗口的内部），而 `:deep()` 只有 scoped 块才会被 SFC 编译器
   展开 —— 不带 scoped 时它原样进产物，浏览器判定整个选择器非法、整条规则丢掉。
   实测：台架里 `document.querySelector(".set-base .compact-form :deep(.ant-form-item)")` 抛
   SyntaxError，且遍历 styleSheets 时 selectorText 含 `:deep(` 的规则数是 0；构建期 lightningcss
   也报 `'deep' is not recognized as a valid pseudo-class`。
   要恢复那档紧凑间距就得写成普通后代选择器（`.set-base .compact-form .ant-form-item`），但那会
   同时收紧六节的纵向间距 —— 是一次真的界面改动，得单独验收，不放这次。
   目前仍然生效的那份在 `AppearanceWindow.vue` 自己的 scoped 块里（`.compact-form :deep(...)`，
   scoped 块里 `:deep()` 正常展开）。 */

/* 每一节都铺满右边那一列，不再有三档自己收在 720：
   原来是 a-tabs 一次只挂一档，收 720 是在「面板很宽、内容只有一小条」的前提下把读距收住；
   现在右边这一列本身只有约 1080（1480 减去目录那一列），已经和新手引导页那条 1060 的
   读书栏同档，再各自收一层就变成「八节里五节满宽、三节贴左半截」——
   用户要的「宽度统一」指的就是这个不一致。三条窗口里原来的 max-width 与居中边距一起删了。 */
</style>

