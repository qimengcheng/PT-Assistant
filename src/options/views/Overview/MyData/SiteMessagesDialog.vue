<script setup lang="ts">
/**
 * 站内信弹窗：点「我的数据」表格上的红数字打开，在扩展里读，不用切到站点网页。
 *
 * 正文按**纯文本**显示。刻意不用 v-html：站内信是站点侧不可信内容，选项页能调 chrome.*
 * 消息，把站点 HTML 原样注进去等于给每个站点开一个 XSS 面。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CheckOutlined, ExportOutlined, InboxOutlined, SyncOutlined } from "@antdv-next/icons";
import { EResultParseStatus, type ISiteMessage, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { formatDate } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import { flushSiteLastUserInfo } from "./utils/lastUserData.ts";
import { useSiteMessageRead } from "./utils/siteMessageRead.ts";

const showDialog = defineModel<boolean>();
const { siteId, reportedUnread = 0 } = defineProps<{
  siteId: TSiteID | null;
  /**
   * 站点报告的未读数（徽章上那个数字的来源）。弹窗拿它判「一条都没读到」是真没信还是没解析出来：
   * 明明有 N 条未读却读到空列表，不能说成「没有未读消息」。
   */
  reportedUnread?: number;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();
const messageRead = useSiteMessageRead();

const isLoading = ref(false);
const messages = ref<ISiteMessage[]>([]);
/** null = 还没取过；false = 该站 schema 不支持；true = 支持 */
const supported = ref<boolean | null>(null);
const loadFailed = ref(false);

const activeIndex = ref<number>(-1);
const activeContent = ref("");
const isLoadingContent = ref(false);

const siteName = ref("");
const siteUrl = ref("");

async function openSitePage() {
  if (siteUrl.value && siteUrl.value !== "#") {
    window.open(siteUrl.value, "_blank", "noopener noreferrer");
  }
}

async function loadMessages(id: TSiteID) {
  isLoading.value = true;
  loadFailed.value = false;
  messages.value = [];
  supported.value = null;
  activeIndex.value = -1;
  activeContent.value = "";

  try {
    const result = await sendMessage("getSiteMessages", id);
    supported.value = result.supported;
    messages.value = result.messages;
    loadFailed.value = result.supported && result.status !== EResultParseStatus.success;
  } catch {
    supported.value = true;
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
}

/** 列表里还能标成已读的那几条：没有 id 或链接的行点不动，在扩展里点开过的也不算 */
const unreadItems = computed(() =>
  messages.value.filter((item) => item.unread && !readInApp(item) && item.id && item.url),
);

const isMarkingAll = ref(false);
const markProgress = ref({ done: 0, total: 0 });

/**
 * 一键已读。用的还是「点开一条正文」那条 GET —— 信箱页给的那条 viewmessage 链接，站点收到
 * 就把这条翻成已读（真页对账：LuckPT 读前横幅 8 条、点开一张正文页已经是 7 条）。
 * 所以这里不发任何 POST、不猜 authkey 那类写接口，代价只是逐条取回整页。
 * 单条成不成也不看返回值：跑完重新拉一次列表，站点标的才算。
 */
async function markAllAsRead() {
  /** 跑这一批要几十秒，中途弹窗可能换站或关掉：全程只认进来时那一站 */
  const id = siteId;
  if (!id || isMarkingAll.value || unreadItems.value.length === 0) {
    return;
  }

  const targets = unreadItems.value;
  isMarkingAll.value = true;
  markProgress.value = { done: 0, total: targets.length };
  const readIds: string[] = [];

  for (const item of targets) {
    const messageId = item.id;
    const url = item.url;
    if (messageId && url) {
      try {
        await sendMessage("getSiteMessageContent", { siteId: id, messageId, url });
        readIds.push(messageId);
      } catch {
        // 一条打不通不停下整批，剩下的接着标
      }
    }
    markProgress.value = { done: markProgress.value.done + 1, total: targets.length };
    // 逐条之间留一道缝：一口气把 N 条打过去会撞上站点对刷新频率的保护
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (readIds.length > 0) {
    await messageRead.markRead(id, readIds);
  }
  isMarkingAll.value = false;
  if (showDialog.value && siteId === id) {
    await loadMessages(id);
  }
  // 站点侧的未读数被改过了，「我的数据」那一行的红数字要跟着掉
  flushSiteLastUserInfo([id]);
}

async function selectMessage(index: number) {
  const item = messages.value[index];
  if (!item) {
    return;
  }

  activeIndex.value = index;
  activeContent.value = "";

  if (!item.id) {
    // 列表里连 id 都解析不出来的站给不了正文，但列表本身仍然可读
    activeContent.value = t("MyData.messages.noBody");
    return;
  }

  isLoadingContent.value = true;
  try {
    const result = await sendMessage("getSiteMessageContent", { siteId: siteId!, messageId: item.id, url: item.url });
    activeContent.value = result.content ?? t("MyData.messages.noBody");
    if (siteId) {
      await messageRead.markRead(siteId, [item.id]);
    }
  } finally {
    isLoadingContent.value = false;
  }
}

watch(
  () => [showDialog.value, siteId] as const,
  async ([open, id]) => {
    if (!open || !id) {
      return;
    }
    siteName.value = await metadataStore.getSiteName(id);
    siteUrl.value = await metadataStore.getSiteUrl(id);
    await loadMessages(id);
  },
  { immediate: true },
);

function timeText(time?: number) {
  return time ? formatDate(time) : "";
}

/**
 * 这一条是不是在扩展里点开过了。`item.unread` 是**列表页那次抓取**给的状态，
 * 点开正文之后它不会自己变 —— 所以「未读」那个标记必须一起看这份记账，
 * 否则刚读完的一条还挂着未读（用户 2026-10-08 报的就是这个）。
 */
function readInApp(item: ISiteMessage) {
  return !!item.id && !!siteId && messageRead.isRead(siteId, item.id);
}

function itemClasses(index: number, item: ISiteMessage) {
  return [
    "msg-item",
    { "msg-item--active": index === activeIndex.value, "msg-item--read": readInApp(item) },
  ];
}
</script>

<template>
  <a-modal v-model:open="showDialog" :title="siteName" :width="860" :footer="null">
    <div v-if="unreadItems.length > 0" class="msg-toolbar">
      <a-button size="small" :loading="isMarkingAll" @click="markAllAsRead">
        <template #icon>
          <CheckOutlined />
        </template>
        {{ isMarkingAll ? t("MyData.messages.markAllReadProgress", markProgress) : t("MyData.messages.markAllRead") }}
      </a-button>
      <a-tooltip :title="t('MyData.messages.markAllReadTip')">
        <span class="msg-toolbar-hint">{{ t("MyData.messages.unreadCount", { n: unreadItems.length }) }}</span>
      </a-tooltip>
    </div>

    <div class="msg-body">
      <div class="msg-list">
        <div v-if="isLoading" class="msg-hint">
          <SyncOutlined spin />
          <span>{{ t("MyData.messages.loading") }}</span>
        </div>

        <div v-else-if="supported === false" class="msg-hint msg-hint--stack">
          <span>{{ t("MyData.messages.unsupported") }}</span>
          <a-button size="small" @click="openSitePage">
            <template #icon><ExportOutlined /></template>
            {{ t("MyData.messages.openSite") }}
          </a-button>
        </div>

        <div v-else-if="loadFailed" class="msg-hint msg-hint--stack">
          <span>{{ t("MyData.messages.loadFailed") }}</span>
          <a-button size="small" @click="siteId && loadMessages(siteId)">
            <template #icon><SyncOutlined /></template>
            {{ t("MyData.messages.retry") }}
          </a-button>
        </div>

        <!-- 空列表有两种：真没信，和「信箱页没解析出任何一行」。后者不能报「没有未读消息」
             —— 站点那边未读数还挂着，用户会以为自己没消息，把站内信漏掉。 -->
        <div
          v-else-if="messages.length === 0"
          :class="['msg-hint', { 'msg-hint--stack': reportedUnread > 0 }]"
        >
          <template v-if="reportedUnread > 0">
            <span>{{ t("MyData.messages.emptyButReportedUnread", { n: reportedUnread }) }}</span>
            <a-button size="small" @click="openSitePage">
              <template #icon><ExportOutlined /></template>
              {{ t("MyData.messages.openSite") }}
            </a-button>
          </template>
          <template v-else>
            <InboxOutlined />
            <span>{{ t("MyData.messages.empty") }}</span>
          </template>
        </div>

        <template v-else>
          <div
            v-for="(item, index) in messages"
            :key="item.id ?? index"
            :class="itemClasses(index, item)"
            @click="selectMessage(index)"
          >
            <div class="msg-line">
              <span class="msg-title">{{ item.title }}</span>
              <span v-if="item.unread && !readInApp(item)" class="msg-flag">{{ t("MyData.messages.unreadFlag") }}</span>
            </div>
            <div class="msg-meta">
              <span>{{ item.sender || "-" }}</span>
              <span>{{ timeText(item.time) }}</span>
              <a
                v-if="item.url"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer nofollow"
                class="msg-link"
                @click.stop
              >
                {{ t("MyData.messages.openSite") }}
              </a>
            </div>
          </div>
        </template>
      </div>

      <div class="msg-detail">
        <div v-if="activeIndex < 0" class="msg-hint">{{ t("MyData.messages.pickHint") }}</div>
        <template v-else>
          <div class="msg-detail-title">{{ messages[activeIndex]?.title }}</div>
          <div v-if="isLoadingContent" class="msg-hint">
            <SyncOutlined spin />
            <span>{{ t("MyData.messages.loading") }}</span>
          </div>
          <pre v-else class="msg-content">{{ activeContent }}</pre>
        </template>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.msg-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.msg-toolbar-hint {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.msg-body {
  display: flex;
  gap: 12px;
  align-items: stretch;
  /* 左右两栏各自滚；整块限高，长正文不会把弹窗顶出视口 */
  max-height: 60vh;
}
.msg-list {
  flex: 0 0 46%;
  min-width: 0;
  overflow-y: auto;
  border-right: 1px solid rgba(5, 5, 5, 0.06);
  padding-right: 12px;
}
.msg-detail {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
}
.msg-item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.msg-item:hover {
  background: #f0f7ff;
}
.msg-item--active {
  background: #e6f4ff;
}
.msg-item--read .msg-title {
  color: rgba(0, 0, 0, 0.45);
  font-weight: 400;
}
.msg-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.msg-title {
  font-weight: 500;
  color: rgba(0, 0, 0, 0.88);
  word-break: break-all;
}
.msg-flag {
  flex: 0 0 auto;
  font-size: 11px;
  color: #c62828;
}
.msg-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.msg-link {
  margin-left: auto;
  color: #1677ff;
  text-decoration: none;
}
.msg-detail-title {
  font-weight: 600;
  margin-bottom: 8px;
  word-break: break-all;
}
.msg-content {
  margin: 0;
  /* pre 保段落换行，但站点给的长串（无空格）要能自己折行，否则把弹窗撑出横向滚动 */
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(0, 0, 0, 0.88);
}
.msg-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 4px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
.msg-hint--stack {
  flex-direction: column;
  align-items: flex-start;
}
</style>
