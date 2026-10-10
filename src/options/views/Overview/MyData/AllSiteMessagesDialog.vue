<script setup lang="ts">
/**
 * 站内信汇总：把「我的数据」里所有**报告有未读**的站的信箱一次拉齐，按站点分组，
 * 支持按站勾选 / 跨站全选，批量标已读与批量删除。
 *
 * 三条口径沿用单站弹窗（见 SiteMessagesDialog.vue 与 AGENTS.md）：
 * - 标已读只走列表页给的那条 viewmessage 链接的 GET，删除只走信箱页自己那张表单 ——
 *   都不猜接口、不写死参数名（v0.31.0 凭印象写死 `msgid` 让所有站都读不出，那次教训）；
 * - 批量动作跑完一律重拉列表 + 重取用户信息，红数字与行状态都以站点给的为准；
 * - 本地已读记账只管显示（置灰、未读标记），不参与任何计数。
 *
 * 点行上的标题就地展开正文（用户 2026-10-08：「点击消息标题应该可以看消息内容才对啊」）。
 * 刻意不做成左右分栏：这一弹窗的主用途是跨站批量处理，为「顺手看一条」把批量那套版式
 * 重排不值当；站内信绝大多数是系统广播，正文短。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDebounceFn } from "@vueuse/core";
import {
  CheckOutlined,
  DeleteOutlined,
  ExportOutlined,
  InboxOutlined,
  SyncOutlined,
} from "@antdv-next/icons";
import { EResultParseStatus, type ISiteMessage, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { formatDate } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

import { flushSiteLastUserInfo, tableData } from "./utils/lastUserData.ts";
import { useSiteMessageRead } from "./utils/siteMessageRead.ts";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();
const messageRead = useSiteMessageRead();

type TGroupState = "loading" | "ok" | "failed" | "unsupported";

interface IGroup {
  siteId: TSiteID;
  siteName: string;
  state: TGroupState;
  messages: ISiteMessage[];
}

const groups = ref<IGroup[]>([]);
const isLoadingAll = ref(false);

/**
 * 站点自己报的未读数（徽章那个）。**实时从表数据读，不在 group 上存副本** ——
 * 副本会一直停在开弹窗那一刻，批量跑完、用户信息都刷回来了，空态话还停在「站点报告 3 条未读」。
 */
function reportedOf(siteId: TSiteID): number {
  return tableData.value.find((row) => row.site === siteId)?.messageCount ?? 0;
}

/**
 * 一组「没有可显示的行」分三种，说错一种就是骗人：
 * 站点已经不报未读 = 读完了；站点还报着、信箱页一行都没读到 = 解析对不上或登录态没了；
 * 站点还报着、读到的行里没有未读 = 未读在信箱后面的分页。
 */
function emptyHintKey(group: IGroup): "allReadInGroup" | "emptyInGroup" | "noUnreadInGroup" {
  const reported = reportedOf(group.siteId);
  if (reported <= 0) {
    return "allReadInGroup";
  }
  return group.messages.length === 0 ? "emptyInGroup" : "noUnreadInGroup";
}

/** 他指定的那个开关：默认只看未读 */
const onlyUnread = ref(true);

/** 选中项：`siteId + 分隔符 + 站内信 id`。没有 id 的行点不动（没法回给站点寻址） */
const selected = ref<Set<string>>(new Set());
const KEY_SEP = "\u0000";
const keyOf = (siteId: TSiteID, messageId: string) => `${siteId}${KEY_SEP}${messageId}`;

/** 展开看正文的那一条（`keyOf(siteId, id)`）。同一时刻只展开一条，铺开几块正文会把列表撑得没法读 */
const expandedKey = ref<string | null>(null);
const expandedContent = ref("");
const isLoadingContent = ref(false);
/** 取正文要抓整页（几百毫秒到几秒），连点两条时后回来的那一份不能盖到当前这条底下 */
let bodyRequestSeq = 0;

/** 哪一颗按钮在转：两条批量动作不能同时跑，也让转的那颗自己说话 */
const busyKind = ref<"read" | "delete" | null>(null);

const isBusy = computed(() => busyKind.value !== null);
const progress = ref({ done: 0, total: 0 });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 这一组里当前该显示的行（开关只影响显示，不动已勾选的）。
 *
 * **正在看正文的那一条强制留着**：点开正文那次 GET 本身就把站点侧翻成已读了，本地记账一写，
 * 「只看未读」当场就会把它筛没 —— 人还在读，行先没了。单站弹窗没这个问题（它一直显示全部、
 * 只把读完的置灰），这一版有开关，所以必须补这一半。
 */
function visibleMessages(group: IGroup): ISiteMessage[] {
  if (!onlyUnread.value) {
    return group.messages;
  }
  return group.messages.filter(
    (item) =>
      (item.unread && !messageRead.isRead(group.siteId, item.id)) ||
      (!!item.id && expandedKey.value === keyOf(group.siteId, item.id)),
  );
}

function isUnreadRow(group: IGroup, item: ISiteMessage) {
  return !!item.unread && !messageRead.isRead(group.siteId, item.id);
}

/** 组头那行「未读 N」跟着界面走（本地点开过的不计），与行的置灰/未读标记同一判据 */
function groupUnreadCount(group: IGroup) {
  return group.messages.filter((item) => isUnreadRow(group, item)).length;
}

/** 没有 id 的行点不动：批量动作要拿它回站点寻址，取不到就没法发出去 */
function selectableInGroup(group: IGroup): ISiteMessage[] {
  return visibleMessages(group).filter((item) => !!item.id);
}

/** 当前所有能勾选的行（跨组），全选/半选都按这一份判 */
const selectableRows = computed(() =>
  groups.value.flatMap((group) =>
    selectableInGroup(group).map((item) => ({ siteId: group.siteId, messageId: item.id! })),
  ),
);

const selectedCount = computed(() => selected.value.size);
const allSelected = computed(
  () => selectableRows.value.length > 0 && selectableRows.value.every((row) => selected.value.has(keyOf(row.siteId, row.messageId))),
);
const someSelected = computed(() => selectedCount.value > 0);

function groupSelectedCount(group: IGroup) {
  return selectableInGroup(group).filter((item) => selected.value.has(keyOf(group.siteId, item.id!))).length;
}

function toggleAll(checked: boolean) {
  const next = new Set(selected.value);
  for (const row of selectableRows.value) {
    const key = keyOf(row.siteId, row.messageId);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
  }
  selected.value = next;
}

function toggleGroup(group: IGroup, checked: boolean) {
  const next = new Set(selected.value);
  for (const item of selectableInGroup(group)) {
    const key = keyOf(group.siteId, item.id!);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
  }
  selected.value = next;
}

function toggleRow(group: IGroup, item: ISiteMessage, checked: boolean) {
  if (!item.id) {
    return;
  }
  const next = new Set(selected.value);
  const key = keyOf(group.siteId, item.id);
  if (checked) {
    next.add(key);
  } else {
    next.delete(key);
  }
  selected.value = next;
}

/**
 * 红数字重取：攒 1.2 秒，连点几条只发一趟；关弹窗 / 卸载时立刻兑现。
 * 判据与单站弹窗那条完全一致（`SiteMessagesDialog.vue` 的 scheduleBadgeRefresh），
 * 因为要补的是同一件事 —— 读正文那条 GET 已经把站点侧翻成已读了，
 * 而身后表格那枚红数字读的是 `lastUserInfo[site].messageCount`，不重取就永远不掉。
 */
const pendingBadgeRefresh = new Set<TSiteID>();
const runBadgeRefresh = useDebounceFn(() => {
  const ids = [...pendingBadgeRefresh];
  pendingBadgeRefresh.clear();
  if (ids.length > 0) {
    flushSiteLastUserInfo(ids);
  }
}, 1200);

function scheduleBadgeRefresh(id: TSiteID) {
  pendingBadgeRefresh.add(id);
  runBadgeRefresh();
}

onBeforeUnmount(() => runBadgeRefresh.flush());

function isExpanded(group: IGroup, item: ISiteMessage) {
  return !!item.id && expandedKey.value === keyOf(group.siteId, item.id);
}

function collapseBody() {
  bodyRequestSeq += 1; // 让在途的那一份回来时认不出自己
  expandedKey.value = null;
  expandedContent.value = "";
  isLoadingContent.value = false;
}

/**
 * 点标题展开 / 再点收起。走的是单站弹窗同一条路：读信箱页给的那条 `item.url`，不猜接口。
 *
 * ⚠️ 这条 GET 一到站点就把该条翻成已读 —— 所以本地记账和红数字重取**都放在 seq 判断外面**：
 * 哪怕此刻界面已经切到别条，站点侧的状态也已经变了，不跟就会留下一行还挂着「未读」。
 * 只有写进那块正文才认 seq：后回来的旧内容不能盖到当前这条底下。
 */
async function toggleBody(group: IGroup, item: ISiteMessage) {
  if (!item.id) {
    return; // 没有 id 的行没法回站点寻址，跟复选框同一条判据
  }
  const key = keyOf(group.siteId, item.id);
  if (expandedKey.value === key) {
    collapseBody();
    return;
  }
  const seq = (bodyRequestSeq += 1);
  expandedKey.value = key;
  expandedContent.value = "";
  isLoadingContent.value = true;
  try {
    const result = await sendMessage("getSiteMessageContent", {
      siteId: group.siteId,
      messageId: item.id,
      url: item.url,
    });
    if (seq === bodyRequestSeq) {
      expandedContent.value = result.content ?? t("MyData.messages.noBody");
      isLoadingContent.value = false;
    }
    await messageRead.markRead(group.siteId, [item.id]);
    scheduleBadgeRefresh(group.siteId);
  } catch {
    if (seq === bodyRequestSeq) {
      expandedContent.value = t("MyData.messages.noBody");
      isLoadingContent.value = false;
    }
  }
}

/** 选中的行按站点归堆，供两条批量动作共用 */
function selectedBySite(): Map<TSiteID, string[]> {
  const map = new Map<TSiteID, string[]>();
  for (const group of groups.value) {
    const ids = group.messages.filter((item) => item.id && selected.value.has(keyOf(group.siteId, item.id))).map((item) => item.id!);
    if (ids.length > 0) {
      map.set(group.siteId, ids);
    }
  }
  return map;
}

/** 点开开关后，看不见的行要从选中里退掉：不能让「已选 N 条」里藏着界面外的行去批量删除 */
watch(onlyUnread, () => {
  const visible = new Set(selectableRows.value.map((row) => keyOf(row.siteId, row.messageId)));
  const next = new Set([...selected.value].filter((key) => visible.has(key)));
  selected.value = next;
});

async function loadOne(siteId: TSiteID) {
  const group = groups.value.find((item) => item.siteId === siteId);
  if (!group) {
    return;
  }
  // 这一组的行马上换成站点给的新内容，展开着的那块正文就成了旧账 —— 收掉。
  // 只收本站这一组：在别的组里读着、这边点重试，不该把那边关掉。
  if (expandedKey.value?.startsWith(`${siteId}${KEY_SEP}`)) {
    collapseBody();
  }
  group.state = "loading";
  try {
    const result = await sendMessage("getSiteMessages", siteId);
    group.messages = result.messages;
    group.state = !result.supported
      ? "unsupported"
      : result.status !== EResultParseStatus.success
        ? "failed"
        : "ok";
  } catch {
    group.state = "failed";
  }
}

async function loadAll() {
  isLoadingAll.value = true;
  // 「有未读」的口径就是站点报的那个消息数（跟徽章同源，不减本地记账）
  const rows = tableData.value.filter((row) => (row.messageCount ?? 0) > 0);
  groups.value = rows.map((row) => ({
    siteId: row.site as TSiteID,
    siteName: row.siteName,
    state: "loading" as TGroupState,
    messages: [],
  }));
  selected.value = new Set();
  try {
    await Promise.all(groups.value.map((group) => loadOne(group.siteId)));
  } finally {
    isLoadingAll.value = false;
  }
}

/**
 * 批量动作收尾：清掉这些站的勾选、重拉这些站的列表、再重取用户信息。
 * 一律以站点给的结果为准 —— 单条成没成不看返回值（offscreen 那边把异常和「没解析出来」
 * 都收敛成同一个 status，判不出），所以跑完重拉一次，站点标的才算。
 */
async function afterBatch(siteIds: TSiteID[]) {
  if (siteIds.length === 0) {
    return;
  }
  const next = new Set(selected.value);
  for (const group of groups.value) {
    if (siteIds.includes(group.siteId)) {
      for (const item of group.messages) {
        if (item.id) {
          next.delete(keyOf(group.siteId, item.id));
        }
      }
    }
  }
  selected.value = next;
  await Promise.all(siteIds.map((siteId) => loadOne(siteId)));
  flushSiteLastUserInfo(siteIds);
}

async function markSelectedAsRead() {
  const bySite = selectedBySite();
  const targets = [...bySite.values()].reduce((sum, ids) => sum + ids.length, 0);
  if (isBusy.value || targets === 0) {
    return;
  }
  busyKind.value = "read";
  progress.value = { done: 0, total: targets };
  const doneBySite = new Map<TSiteID, string[]>();

  // ⚠️ busyKind 必须在 finally 里复位：它是 isBusy 的来源，而 isBusy 又兼作
  // 「别重复点」的闸 —— 中途抛错不复位的话两个按钮永久禁用，只能刷新页面。
  try {
    for (const [siteId, ids] of bySite) {
      const group = groups.value.find((item) => item.siteId === siteId);
      const urls = new Map((group?.messages ?? []).filter((item) => item.id).map((item) => [item.id!, item.url]));
      for (const messageId of ids) {
        const url = urls.get(messageId);
        if (url) {
          try {
            await sendMessage("getSiteMessageContent", { siteId, messageId, url });
            doneBySite.set(siteId, [...(doneBySite.get(siteId) ?? []), messageId]);
          } catch {
            // 一条打不通不停下整批
          }
        }
        progress.value = { done: progress.value.done + 1, total: targets };
        // 逐条之间留一道缝：一口气把 N 条打过去会撞上站点对刷新频率的保护
        await sleep(300);
      }
    }

    for (const [siteId, ids] of doneBySite) {
      await messageRead.markRead(siteId, ids);
    }
  } finally {
    busyKind.value = null;
  }
  await afterBatch([...doneBySite.keys()]);
}

async function deleteSelected() {
  const bySite = selectedBySite();
  const siteIds = [...bySite.keys()];
  const targets = siteIds.reduce((sum, id) => sum + (bySite.get(id)?.length ?? 0), 0);
  if (isBusy.value || targets === 0) {
    return;
  }
  busyKind.value = "delete";
  progress.value = { done: 0, total: targets };
  const skipped: string[] = [];
  const doneSites: TSiteID[] = [];

  try {
    for (const siteId of siteIds) {
      const ids = bySite.get(siteId) ?? [];
      const siteName = groups.value.find((group) => group.siteId === siteId)?.siteName ?? siteId;
      try {
        const result = await sendMessage("deleteSiteMessages", { siteId, messageIds: ids });
        // 少于请求条数 = 有几条在那页上根本不存在，等同「没删动」，不能说成功
        if (result.supported && result.status === EResultParseStatus.success && result.handled >= ids.length) {
          doneSites.push(siteId);
        } else {
          // 删不动要说出来：报「已删除」而信还在，比不删更糟
          skipped.push(siteName);
        }
      } catch {
        skipped.push(siteName);
      }
      progress.value = { done: progress.value.done + ids.length, total: targets };
      await sleep(300);
    }
  } finally {
    busyKind.value = null;
  }
  await afterBatch(doneSites);
  if (skipped.length > 0) {
    runtimeStore.showSnakebar(t("MyData.allMessages.deleteSkipped", { sites: skipped.join("、") }), {
      color: "warning",
    });
  }
}

/**
 * 组头那颗「在网页打开」开的是**站点首页**，不拼 `/messages.php`。
 * 理由与单站弹窗一致（SiteMessagesDialog 的 openSitePage 就是打开 getSiteUrl）：信箱路径是 schema
 * 那一层的事（`metadata.message?.url` 能被站点定义覆盖），界面自己拼一份副本对了今天、错了以后。
 * 要看具体某一条，用行上那条链接 —— 那是站点自己给的地址。
 */
async function openSitePage(siteId: TSiteID) {
  const url = await metadataStore.getSiteUrl(siteId);
  if (url && url !== "#") {
    window.open(url, "_blank", "noopener noreferrer");
  }
}

watch(
  () => showDialog.value,
  async (open) => {
    if (!open) {
      // 关掉弹窗的那一眼正是他会去看红数字的时候，别把攒下的刷新留给 debounce 尾巴
      collapseBody();
      runBadgeRefresh.flush();
      return;
    }
    await loadAll();
  },
  { immediate: true },
);
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyData.allMessages.title')"
    :width="960"
    :footer="null"
  >
    <div class="am-toolbar">
      <a-checkbox
        :checked="allSelected"
        :indeterminate="someSelected && !allSelected"
        :disabled="selectableRows.length === 0"
        @change="(e: any) => toggleAll(e.target.checked)"
      >
        {{ t("MyData.allMessages.selectAll") }}
      </a-checkbox>

      <a-radio-group v-model:value="onlyUnread" button-style="solid">
        <a-radio-button :value="true">{{ t("MyData.allMessages.onlyUnread") }}</a-radio-button>
        <a-radio-button :value="false">{{ t("MyData.allMessages.showAll") }}</a-radio-button>
      </a-radio-group>

      <a-button :loading="isLoadingAll" @click="loadAll">
        <template #icon>
          <SyncOutlined />
        </template>
        {{ t("MyData.allMessages.reload") }}
      </a-button>

      <a-flex flex="auto" justify="flex-end" align="center" gap="small">
        <span class="am-selected">
          {{ t("MyData.allMessages.selectedCount", { n: selectedCount }) }}
          <template v-if="busyKind"> · {{ t("MyData.allMessages.progress", progress) }}</template>
        </span>
        <a-button :disabled="selectedCount === 0 || isBusy" :loading="busyKind === 'read'" @click="markSelectedAsRead">
          <template #icon>
            <CheckOutlined />
          </template>
          {{ t("MyData.allMessages.markRead") }}
        </a-button>
        <a-popconfirm
          :title="t('MyData.allMessages.deleteConfirm', { n: selectedCount })"
          :ok-text="t('MyData.allMessages.delete')"
          :cancel-text="t('common.dialog.cancel')"
          :disabled="selectedCount === 0"
          @confirm="deleteSelected"
        >
          <a-button type="primary" danger :disabled="selectedCount === 0 || isBusy" :loading="busyKind === 'delete'">
            <template #icon>
              <DeleteOutlined />
            </template>
            {{ t("MyData.allMessages.delete") }}
          </a-button>
        </a-popconfirm>
      </a-flex>
    </div>

    <div class="am-body">
      <div v-if="groups.length === 0" class="am-hint">
        <InboxOutlined />
        <span>{{ t("MyData.allMessages.emptyNoUnread") }}</span>
      </div>

      <section v-for="group in groups" :key="group.siteId" class="am-group">
        <a-flex align="center" gap="small" class="am-group-head">
          <a-checkbox
            :checked="selectableInGroup(group).length > 0 && groupSelectedCount(group) === selectableInGroup(group).length"
            :indeterminate="groupSelectedCount(group) > 0 && groupSelectedCount(group) < selectableInGroup(group).length"
            :disabled="selectableInGroup(group).length === 0"
            @change="(e: any) => toggleGroup(group, e.target.checked)"
          />
          <SiteFavicon :site-id="group.siteId" :size="18" />
          <span class="am-group-name">{{ group.siteName }}</span>
          <span class="am-group-meta">
            {{ t("MyData.allMessages.unreadOf", { n: groupUnreadCount(group) }) }}
            ·
            {{ t("MyData.allMessages.totalOf", { n: group.messages.length }) }}
          </span>
          <a-flex flex="auto" justify="flex-end">
            <a-button size="small" variant="text" color="blue" @click="openSitePage(group.siteId)">
              <template #icon>
                <ExportOutlined />
              </template>
              {{ t("MyData.allMessages.openSite") }}
            </a-button>
          </a-flex>
        </a-flex>

        <div v-if="group.state === 'loading'" class="am-hint am-hint--row">
          <SyncOutlined spin />
          <span>{{ t("MyData.allMessages.loading") }}</span>
        </div>

        <div v-else-if="group.state === 'unsupported'" class="am-hint am-hint--row">
          <span>{{ t("MyData.allMessages.unsupported") }}</span>
        </div>

        <div v-else-if="group.state === 'failed'" class="am-hint am-hint--row">
          <span>{{ t("MyData.allMessages.failed") }}</span>
          <a-button size="small" @click="loadOne(group.siteId)">
            <template #icon>
              <SyncOutlined />
            </template>
            {{ t("MyData.allMessages.retry") }}
          </a-button>
        </div>

        <div v-else-if="visibleMessages(group).length === 0" class="am-hint am-hint--row">
          <span>{{ t(`MyData.allMessages.${emptyHintKey(group)}`, { n: reportedOf(group.siteId) }) }}</span>
        </div>

        <template v-else>
          <template v-for="(item, index) in visibleMessages(group)" :key="item.id ?? index">
            <div class="am-item">
              <a-checkbox
                :checked="!!item.id && selected.has(keyOf(group.siteId, item.id))"
                :disabled="!item.id"
                @change="(e: any) => toggleRow(group, item, e.target.checked)"
              />
              <!-- 标题就是这一行的展开开关（没有 id 的行取不到正文，也就不给 pointer）；
                   复选框只管勾选，所以 click 只挂在标题上，不挂整行 -->
              <span
                class="am-item-title"
                :class="{
                  'am-item-title--read': !isUnreadRow(group, item),
                  'am-item-title--link': !!item.id,
                  'am-item-title--open': isExpanded(group, item),
                }"
                @click="toggleBody(group, item)"
              >
                {{ item.title }}
              </span>
              <span v-if="isUnreadRow(group, item)" class="am-item-flag">
                {{ t("MyData.allMessages.unreadFlag") }}
              </span>
              <span class="am-item-meta">
                {{ item.sender || "-" }}
                <template v-if="item.time"> · {{ formatDate(item.time) }}</template>
              </span>
              <a
                v-if="item.url"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer nofollow"
                class="am-item-link"
              >
                {{ t("MyData.allMessages.openSite") }}
              </a>
            </div>

            <div v-if="isExpanded(group, item)" class="am-item-body">
              <div v-if="isLoadingContent" class="am-hint am-hint--body">
                <SyncOutlined spin />
                <span>{{ t("MyData.allMessages.loading") }}</span>
              </div>
              <!-- 纯文本，刻意不 v-html：站内信是站点侧不可信内容，选项页能调 chrome.* 消息 -->
              <pre v-else class="am-body-text">{{ expandedContent }}</pre>
            </div>
          </template>
        </template>
      </section>
    </div>
  </a-modal>
</template>

<style scoped>
.am-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--pt-color-border-light);
  /* 滚动的是 .ant-modal-body（全局那条 flex 链）；这一条钉在顶上，
     否则列表一长，批量那三颗按钮就滚出视野了。底色必须有，不然是文字叠文字。 */
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}

.am-selected {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}

.am-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.am-group-head {
  margin-bottom: 6px;
}

.am-group-name {
  font-weight: 600;
}

.am-group-meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.am-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 4px 26px;
  min-width: 0;
}

.am-item:hover {
  background: #f5f8fc;
}

.am-item-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.am-item-title--read {
  color: rgba(0, 0, 0, 0.45);
}

.am-item-title--link {
  cursor: pointer;
}

/* 悬停与「正展开着」同色：读完的那条会留在原地（只看未读时被强制留着），
   不给个持续的高亮就看不出这块正文是哪一行的 */
.am-item-title--link:hover,
.am-item-title--open {
  color: #1677ff;
}

.am-item-body {
  margin: 2px 0 6px 26px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f7f9fc;
  /* 长正文不能把列表顶出视野：这块自己滚。上限给到大约 6 行，
     再长就读到这里该切「在网页打开」了 —— 那半句 noBody 的文案也是这么说的 */
  max-height: 200px;
  overflow-y: auto;
}

.am-body-text {
  margin: 0;
  /* pre 保段落换行，站点给的无空格长串要自己折行，否则把弹窗撑出横向滚动 */
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(0, 0, 0, 0.85);
}

.am-item-flag {
  flex: 0 0 auto;
  color: #f44336;
  font-size: 12px;
}

.am-item-meta {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.am-item-link {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 12px;
}

.am-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(0, 0, 0, 0.45);
  padding: 16px 0;
}

.am-hint--row {
  padding: 6px 0 6px 26px;
}

/* 正文块自己已经有内衬了，这条只把提示的那份 padding 撤掉，别叠两层 */
.am-hint--body {
  padding: 0;
}
</style>
