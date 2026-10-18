<script setup lang="ts">
/**
 * 「可辅种扫描」面板：把选中的那几条内容**逐个站点真查一遍**，看那个站上到底有没有这条种子。
 *
 * 为什么要有这一屏（用户 2026-10-18：「你得挨着去查有没有这个种子才有意义啊」）：
 * 列表里那枚「待查 N 站」只说得出「你添加的站点里还没挂上这份内容」，说不出那个站上有没有。
 * 后半句只能发请求换，而一次扫描是「条目数 × 站点数」次请求，所以这一屏给的是：
 * 自己挑范围、看得见排了多少对、跳过了多少对、还剩多少对没查，以及**四档分开的结论**。
 *
 * 四档不许并成两档：「没查成」（要登录 / 超时 / 解析歪了）与「没搜到相符条目」是两种事实，
 * 说成一句会让人以为那个站确实没有这条，从此不去辅 —— 那是假阴性，比不报更糟。
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ClearOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined, BranchesOutlined } from "@antdv-next/icons";
import type { TableColumnsType } from "antdv-next";

import { sendMessage } from "@/messages.ts";
import { formatDate, formatSize } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfirmDanger } from "@/options/components/useConfirmDanger.ts";
import HoverTip from "@/options/components/HoverTip.vue";
import { planReseedScan } from "@/shared/reseedScanPlan.ts";
import { planReseedHandoff, handoffBlocksOf, type IReseedHandoffBase } from "@/shared/reseedScanHandoff.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";
import {
  RESEED_SCAN_MAX_PAIRS,
  type IReseedScanJob,
  type IReseedScanResult,
  type IReseedScanTarget,
  type TReseedScanVerdict,
} from "@/shared/types/storages/reseedScan.ts";

import type { IReseedScanScope } from "./reseedCandidateView.ts";

const showDialog = defineModel<boolean>();
const props = defineProps<{
  scopes: IReseedScanScope[];
  /** 用哪些下载器的本地指纹去验文件清单（「确有这条」那一档靠它） */
  downloaderIds: string[];
  /** 目标站点：已添加、没标离线 */
  usableSites: string[];
  /** 下载器里那些已下完的副本 = 一键辅种时的基准来源（按内容键对得上扫描那一侧） */
  bases: IReseedHandoffBase[];
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const { confirmDanger } = useConfirmDanger();

const scopeKey = ref<string>("");
const refresh = ref(false);
const verdictFilter = ref<"all" | TReseedScanVerdict>("all");
const job = ref<IReseedScanJob | null>(null);
const results = ref<IReseedScanResult[]>([]);
const starting = ref(false);
const reloading = ref(false);
/** 场上已有的辅种任务：一键辅种前拿它过一遍重复闸 */
const existingTasks = ref<IKeepUploadTask[]>([]);
const handoffBusy = ref(false);

const POLL_MS = 1500;
let timer: ReturnType<typeof setInterval> | null = null;

/** 默认落在第一个非空的范围上：一打开就摆一条没法查的选项，比少一档更容易让人以为功能坏了 */
watch(
  () => props.scopes,
  (scopes) => {
    if (!scopes.some((scope) => scope.key === scopeKey.value)) {
      scopeKey.value = scopes.find((scope) => scope.targets.length > 0)?.key ?? "";
    }
  },
  { immediate: true },
);

const activeScope = computed(() => props.scopes.find((scope) => scope.key === scopeKey.value) ?? null);
const activeTargets = computed<IReseedScanTarget[]>(() => activeScope.value?.targets ?? []);
const running = computed(() => job.value?.status === "running");

const siteNameOf = (siteId?: string) => (siteId ? (metadataStore.siteNameMap[siteId] ?? siteId) : "");

/** 结论按内容键取：面板只管「这一批条目查过哪些站」，缓存里别的范围的结论不混进来 */
const allContentKeys = computed(() => {
  const keys = new Set<string>();
  for (const scope of props.scopes) for (const target of scope.targets) keys.add(target.contentKey);
  return [...keys];
});

const cacheMap = computed(() => new Map(results.value.map((item) => [item.id, item])));

/**
 * 这一轮会排多少对 —— 用**与执行侧同一份纯判据**算，不另写一套。
 * 于是界面上说的「跳过 N 对」「还有 M 对没查」和后台真的跳了/真的没查，是同一个函数折出来的。
 */
const plan = computed(() =>
  planReseedScan({
    targets: activeTargets.value,
    usableSites: props.usableSites,
    cache: refresh.value ? new Map() : cacheMap.value,
    now: Date.now(),
    maxPairs: RESEED_SCAN_MAX_PAIRS,
  }),
);

/** 四档各一句真名 + 各自的颜色档；键写全，不许拼（动态拼出来的 i18n 键防线③看不见） */
const verdictTexts = computed<Record<TReseedScanVerdict, string>>(() => ({
  "has-it": t("MyClient.reseedScan.verdict.hasIt"),
  suspect: t("MyClient.reseedScan.verdict.suspect"),
  "no-match": t("MyClient.reseedScan.verdict.noMatch"),
  failed: t("MyClient.reseedScan.verdict.failed"),
}));

const VERDICT_COLORS: Record<TReseedScanVerdict, string> = {
  "has-it": "success",
  suspect: "warning",
  "no-match": "default",
  failed: "error",
};

/** 查到的排前面、没查成的排在没搜到之前：这一屏是给人挑「接下来去哪辅」用的 */
const VERDICT_RANK: Record<TReseedScanVerdict, number> = { "has-it": 0, suspect: 1, failed: 2, "no-match": 3 };

const verdictCounts = computed(() => {
  const keys = new Set(activeTargets.value.map((target) => target.contentKey));
  const counts: Record<TReseedScanVerdict, number> = { "has-it": 0, suspect: 0, "no-match": 0, failed: 0 };
  for (const item of results.value) {
    if (keys.has(item.contentKey)) counts[item.verdict] += 1;
  }
  return counts;
});

const shownResults = computed(() => {
  const keys = new Set(activeTargets.value.map((target) => target.contentKey));
  return results.value
    .filter((item) => keys.has(item.contentKey))
    .filter((item) => verdictFilter.value === "all" || item.verdict === verdictFilter.value)
    .sort(
      (a, b) =>
        VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
        a.contentKey.localeCompare(b.contentKey) ||
        siteNameOf(a.siteId).localeCompare(siteNameOf(b.siteId)),
    );
});

const verdictFilterOptions = computed(() => [
  { value: "all", label: t("MyClient.reseedScan.filterAll") },
  ...(["has-it", "suspect", "failed", "no-match"] as TReseedScanVerdict[]).map((verdict) => ({
    value: verdict,
    label: `${verdictTexts.value[verdict]}（${verdictCounts.value[verdict]}）`,
  })),
]);

const columns = computed<TableColumnsType<IReseedScanResult>>(() => [
  { key: "name", title: t("MyClient.reseedScan.col.name"), width: 240 },
  { key: "site", title: t("MyClient.reseedScan.col.site"), width: 140 },
  { key: "verdict", title: t("MyClient.reseedScan.col.verdict"), width: 150 },
  { key: "hit", title: t("MyClient.reseedScan.col.hit") },
  { key: "at", title: t("MyClient.reseedScan.col.at"), width: 150 },
]);

/** 表格里 `record` 是 any（antd 的 bodyCell 插槽不给类型），所以要经这两条取档：模板直接下标会漏进 TS7053 */
const verdictTextOf = (item: IReseedScanResult) => verdictTexts.value[item.verdict];
const verdictColorOf = (item: IReseedScanResult) => VERDICT_COLORS[item.verdict];

const nameOf = (item: IReseedScanResult) =>
  activeTargets.value.find((target) => target.contentKey === item.contentKey)?.name ?? "";

/** 站上那条：标题 + 大小；大小读不出就不写，不拿 0 B 冒充（同 shared/torrentSize 那条口径） */
function hitOf(item: IReseedScanResult): string {
  if (!item.siteTitle) return "";
  const size = item.siteSize && item.siteSize > 0 ? formatSize(item.siteSize) : "";
  return size ? `${item.siteTitle}（${size}）` : item.siteTitle;
}

const progressPercent = computed(() => {
  const current = job.value;
  if (!current || current.total === 0) return 0;
  return Math.min(100, Math.round((current.done / current.total) * 100));
});

const statusText = computed(() => {
  const current = job.value;
  if (!current) return t("MyClient.reseedScan.status.idle");
  if (current.status === "running") {
    return current.total === 0 ? t("MyClient.reseedScan.status.preparing") : t("MyClient.reseedScan.status.running");
  }
  if (current.status === "stopped") return t("MyClient.reseedScan.status.stopped");
  return t("MyClient.reseedScan.status.done");
});

async function loadResults() {
  const keys = allContentKeys.value;
  results.value = await sendMessage("getReseedScanResults", keys.length ? { contentKeys: keys } : undefined);
}

async function loadJob() {
  job.value = await sendMessage("getReseedScanJob", undefined);
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * 只在跑着的时候挂定时器：扫描是分钟级的事，而这一屏可能被开着忘了几十分钟，
 * 一直轮询等于一直向 offscreen 发消息、每次都整表读一遍 IndexedDB。
 */
async function tick() {
  await loadJob();
  await loadResults();
  if (!running.value) stopPolling();
}

function startPolling() {
  stopPolling();
  timer = setInterval(() => void tick(), POLL_MS);
}

async function reload() {
  if (reloading.value) return;
  reloading.value = true;
  try {
    await tick();
  } finally {
    reloading.value = false;
  }
}

async function startScan() {
  if (starting.value || running.value) return;
  if (activeTargets.value.length === 0) {
    runtimeStore.showSnakebar(t("MyClient.reseedScan.emptyScope"), { color: "warning" });
    return;
  }
  if (props.usableSites.length === 0) {
    runtimeStore.showSnakebar(t("MyClient.reseedScan.noSite"), { color: "warning" });
    return;
  }
  if (props.downloaderIds.length === 0) {
    runtimeStore.showSnakebar(t("MyClient.reseedScan.noDownloader"), { color: "warning" });
    return;
  }

  starting.value = true;
  try {
    // 只发这一条消息要的四个字段：`memberKeys` 是界面侧回查判据用的，不该进消息体
    const targets = activeTargets.value.map((target) => ({
      contentKey: target.contentKey,
      name: target.name,
      size: target.size,
      knownSites: target.knownSites,
    }));
    job.value = await sendMessage("startReseedScan", {
      downloaderIds: props.downloaderIds,
      targets,
      usableSites: props.usableSites,
      refresh: refresh.value,
    });
    startPolling();
  } catch (error) {
    runtimeStore.showSnakebar(`${t("MyClient.reseedScan.startFailed")}：${error instanceof Error ? error.message : String(error)}`, {
      color: "error",
    });
  } finally {
    starting.value = false;
  }
}

async function stopScan() {
  await sendMessage("stopReseedScan", undefined);
  await reload();
}

async function clearCache() {
  const keys = new Set(activeTargets.value.map((target) => target.contentKey));
  const hit = results.value.filter((item) => keys.has(item.contentKey)).length;
  if (hit === 0) return;
  if (!(await confirmDanger(t("MyClient.reseedScan.clearConfirm", { count: hit }), "danger", t("common.remove")))) return;
  await sendMessage("clearReseedScanCache", undefined);
  await loadResults();
}

/**
 * 一键辅种：把结论是「该站有这条」的那些对子，按内容各折成一条辅种任务。
 *
 * 只喂 `has-it` 那一档 —— `suspect`（标题相符、未验文件）说的是「大概有」，
 * 把它一起发出去就是替人赌一次。判据本体在 `@/shared/reseedScanHandoff.ts`（能被 Node 断言），
 * 这里只做「取现场那份范围 + 落库 + 催一轮后台」。
 */
const handoff = computed(() => {
  const keys = new Set(activeTargets.value.map((target) => target.contentKey));
  return planReseedHandoff({
    results: results.value.filter((item) => keys.has(item.contentKey)),
    targets: activeTargets.value,
    bases: props.bases,
    existingTasks: existingTasks.value,
  });
});

/**
 * 那颗键点不动时，把原因写在按钮下面那一行。
 *
 * 不能只写进悬停提示：`<button disabled>` 不发鼠标事件，灰着的时候那层浮层根本不出来
 * —— 用户 2026-10-18 报的就是这个（屏上 23 条「该站有这条」，键却是 (0)）。
 */
const handoffWhy = computed(() =>
  handoffBlocksOf(handoff.value, verdictCounts.value["has-it"])
    .map((block) => {
      // 四个键全部写成字面量：动态拼出来的那条防线③看不见（AGENTS §3.4 同一族）
      if (block.reason === "no-hit") return t("MyClient.reseedScan.reseedWhy.noHit");
      if (block.reason === "legacy") return t("MyClient.reseedScan.reseedWhy.legacy", { count: block.count });
      if (block.reason === "no-base") return t("MyClient.reseedScan.reseedWhy.noBase", { count: block.count });
      return t("MyClient.reseedScan.reseedWhy.duplicated", { count: block.count });
    })
    .join(" "),
);

async function loadExistingTasks() {
  // 拿不到就当没有重复：不能把「查不了」变成「建不了」（与弹窗那条同一口径）
  existingTasks.value = await sendMessage("getKeepUploadTasks", undefined).catch(() => [] as IKeepUploadTask[]);
}

async function reseedNow() {
  const tasks = handoff.value.tasks;
  if (tasks.length === 0) return;
  const sites = tasks.reduce((sum, task) => sum + (task.items?.length ?? 0), 0);
  const ok = await confirmDanger(
    t("MyClient.reseedScan.reseedConfirm", { count: tasks.length, sites }),
    "primary",
    t("MyClient.reseedScan.reseed"),
  );
  if (!ok) return;

  handoffBusy.value = true;
  let created = 0;
  try {
    for (const task of tasks) {
      await sendMessage("createKeepUploadTask", task);
      created += 1;
    }
    // 催后台立刻走一轮：不催的话这批新任务要等下一次定时（最多 1 分钟）才被看到
    if (created > 0) void sendMessage("runAutoReseedTick", undefined).catch(() => {});
    await loadExistingTasks();
    const { duplicated, skipped } = handoff.value;
    const noBase = skipped.filter((item) => item.reason === "no-base").length;
    const legacy = skipped.filter((item) => item.reason === "no-site-ref").length;
    // 每一类各一句、且只在真有的时候说：一句「另有 0 条…」看着像坏了，
    // 把两类并成一句报数更会把「老记录没存下那一半」说成「下载器里找不到基准」
    const parts = [t("MyClient.reseedScan.reseedDone", { count: created })];
    if (duplicated.length) parts.push(t("MyClient.reseedScan.reseedSkipDup", { count: duplicated.length }));
    if (noBase) parts.push(t("MyClient.reseedScan.reseedSkipNoBase", { count: noBase }));
    if (legacy) parts.push(t("MyClient.reseedScan.reseedWhy.legacy", { count: legacy }));
    runtimeStore.showSnakebar(parts.join(""), { color: created > 0 ? "success" : "warning" });
  } catch (error) {
    runtimeStore.showSnakebar(
      `${t("MyClient.reseedScan.reseedFailed")}：${error instanceof Error ? error.message : String(error)}`,
      { color: "error" },
    );
  } finally {
    handoffBusy.value = false;
  }
}

/** 打开时读一次现场；在跑就接着轮询（扫描可能是上一次没关完的那一轮，进度是落在存储里的） */
async function onOpen() {
  await Promise.all([loadJob(), loadResults(), loadExistingTasks()]);
  if (running.value) startPolling();
}

watch(showDialog, (open) => {
  if (open) void onOpen();
  else stopPolling();
});

onUnmounted(stopPolling);
</script>

<template>
  <a-modal v-model:open="showDialog" :title="t('MyClient.reseedScan.title')" :width="920" :mask-closable="false">
    <div class="reseed-scan">
      <div class="reseed-scan__row">
        <a-radio-group v-model:value="scopeKey" name="reseed-scan-scope" button-style="solid">
          <a-radio-button v-for="scope in props.scopes" :key="scope.key" :value="scope.key" :disabled="scope.targets.length === 0">
            {{ scope.label }}
          </a-radio-button>
        </a-radio-group>
        <a-checkbox v-model:checked="refresh" :disabled="running">
          {{ t("MyClient.reseedScan.refreshAll") }}
        </a-checkbox>
      </div>

      <!-- 计划说在事前：一次扫描是「条目 × 站点」次请求，点下去之前要看得见排了多少对、跳了多少对 -->
      <a-alert type="info" class="reseed-scan__plan">
        <template #message>
          {{
            t("MyClient.reseedScan.plan", {
              items: activeTargets.length,
              sites: props.usableSites.length,
              pairs: plan.pairs.length,
              skipped: plan.cached,
              remaining: plan.truncated,
              max: RESEED_SCAN_MAX_PAIRS,
            })
          }}
        </template>
      </a-alert>

      <div class="reseed-scan__row">
        <a-button type="primary" :loading="running || starting" @click="startScan">
          <template #icon><PlayCircleOutlined /></template>
          {{ t("MyClient.reseedScan.start") }}
        </a-button>
        <a-button :disabled="!running" @click="stopScan">
          <template #icon><PauseOutlined /></template>
          {{ t("MyClient.reseedScan.stop") }}
        </a-button>
        <a-button :loading="reloading" @click="reload">
          <template #icon><ReloadOutlined /></template>
          {{ t("MyClient.reseedScan.reload") }}
        </a-button>
        <!-- 一键辅种：只吃「该站有这条」那一档，基准取下载器里那一份、目录取它所在目录。
             它不绕过那张「辅种检测」弹窗，只是把这一屏已经问出来的信息直接送进去 ——
             要逐条挑目录/标签，仍然走搜索页那颗。 -->
        <HoverTip :text="t('MyClient.reseedScan.reseedTip')" placement="top" :delay="0.4">
          <a-button type="primary" :disabled="handoff.tasks.length === 0" :loading="handoffBusy" @click="reseedNow">
            <template #icon><BranchesOutlined /></template>
            {{ t("MyClient.reseedScan.reseed", { count: handoff.tasks.length }) }}
          </a-button>
        </HoverTip>
        <HoverTip :text="t('MyClient.reseedScan.clearTip')">
          <a-button type="primary" danger @click="clearCache">
            <template #icon><ClearOutlined /></template>
            {{ t("MyClient.reseedScan.clear") }}
          </a-button>
        </HoverTip>
        <!-- 点不动的原因写在按钮下面（灰键悬停不出浮层，见 handoffWhy 那条注释） -->
        <span v-if="handoffWhy" class="reseed-scan__hint text-grey">{{ handoffWhy }}</span>
      </div>

      <div class="reseed-scan__progress">
        <span>{{ statusText }}</span>
        <a-progress :percent="progressPercent" :show-info="false" style="width: 160px" />
        <span v-if="job">{{ t("MyClient.reseedScan.progress", { done: job.done, total: job.total }) }}</span>
        <span v-if="job?.currentName" class="reseed-scan__current text-truncate">
          {{ t("MyClient.reseedScan.current", { site: siteNameOf(job.currentSite), name: job.currentName }) }}
        </span>
      </div>

      <div class="reseed-scan__row reseed-scan__row--filter">
        <a-select
          v-model:value="verdictFilter"
          :options="verdictFilterOptions"
          name="reseed-scan-verdict-filter"
          size="small"
          style="width: 240px"
        />
        <span class="reseed-scan__counts">
          {{
            t("MyClient.reseedScan.counts", {
              has: verdictCounts["has-it"],
              suspect: verdictCounts.suspect,
              none: verdictCounts["no-match"],
              failed: verdictCounts.failed,
            })
          }}
        </span>
      </div>

      <a-table
        bordered
        size="small"
        :columns="columns"
        :data-source="shownResults"
        :row-key="(record: IReseedScanResult) => record.id"
        :pagination="{ pageSize: 12, showSizeChanger: false }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
              <template #content>
                <div class="reveal-text">{{ nameOf(record) }}</div>
              </template>
              <div class="text-truncate">{{ nameOf(record) }}</div>
            </a-popover>
          </template>

          <template v-else-if="column.key === 'site'">
            <span class="text-no-wrap">{{ siteNameOf(record.siteId) }}</span>
          </template>

          <template v-else-if="column.key === 'verdict'">
            <!-- 说明只在「要说清为什么」的两档出现：那两句是给人决定要不要再查一次用的 -->
            <HoverTip v-if="record.note" :text="record.note" placement="topLeft" :delay="0.4">
              <a-tag :color="verdictColorOf(record)" class="reseed-scan__tag">{{ verdictTextOf(record) }}</a-tag>
            </HoverTip>
            <a-tag v-else :color="verdictColorOf(record)" class="reseed-scan__tag">
              {{ verdictTextOf(record) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'hit'">
            <a-popover v-if="hitOf(record)" trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
              <template #content>
                <div class="reveal-text">{{ hitOf(record) }}</div>
              </template>
              <div class="text-truncate">{{ hitOf(record) }}</div>
            </a-popover>
            <span v-else class="text-grey">-</span>
          </template>

          <template v-else-if="column.key === 'at'">
            <span class="text-no-wrap">{{ formatDate(record.at) }}</span>
          </template>
        </template>
      </a-table>
    </div>

    <template #footer>
      <a-button @click="showDialog = false">{{ t("common.dialog.close") }}</a-button>
    </template>
  </a-modal>
</template>

<style scoped>
.reseed-scan {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reseed-scan__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.reseed-scan__row--filter {
  justify-content: space-between;
}

.reseed-scan__plan {
  margin: 0;
}

.reseed-scan__progress {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.reseed-scan__current {
  /* 正在查的那一条要吃掉剩余宽度并截断，否则长标题会把这一排撑出弹窗 */
  flex: 1 1 120px;
  min-width: 0;
}

.reseed-scan__counts {
  font-size: 13px;
}

.reseed-scan__hint {
  /* 按钮那一排里换到第二行：这一句是「为什么那颗键是 (0)」，跟在按钮后面会被当成按钮的一部分 */
  flex: 1 0 100%;
}

.reseed-scan__tag {
  margin-inline-end: 0;
}
</style>
