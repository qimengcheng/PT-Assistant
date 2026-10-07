<script setup lang="ts">
/**
 * 站内信弹窗：点「我的数据」表格上的红数字打开，在扩展里读，不用切到站点网页。
 *
 * 正文按**纯文本**显示。刻意不用 v-html：站内信是站点侧不可信内容，选项页能调 chrome.*
 * 消息，把站点 HTML 原样注进去等于给每个站点开一个 XSS 面。
 */
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ExportOutlined, InboxOutlined, SyncOutlined } from "@antdv-next/icons";
import { EResultParseStatus, type ISiteMessage, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { formatDate } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import { useSiteMessageRead } from "./utils/siteMessageRead.ts";

const showDialog = defineModel<boolean>();
const { siteId } = defineProps<{ siteId: TSiteID | null }>();

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

async function selectMessage(index: number) {
  const item = messages.value[index];
  if (!item) {
    return;
  }

  activeIndex.value = index;
  activeContent.value = "";

  if (!item.id) {
    // 解析不出 msgid 的站给不了正文，但列表本身仍然可读
    activeContent.value = t("MyData.messages.noBody");
    return;
  }

  isLoadingContent.value = true;
  try {
    const result = await sendMessage("getSiteMessageContent", { siteId: siteId!, messageId: item.id });
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

function itemClasses(index: number, item: ISiteMessage) {
  const isRead = !!item.id && messageRead.isRead(siteId!, item.id);
  return ["msg-item", { "msg-item--active": index === activeIndex.value, "msg-item--read": isRead }];
}
</script>

<template>
  <a-modal v-model:open="showDialog" :title="siteName" :width="860" :footer="null">
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

        <div v-else-if="messages.length === 0" class="msg-hint">
          <InboxOutlined />
          <span>{{ t("MyData.messages.empty") }}</span>
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
              <span v-if="item.unread" class="msg-flag">{{ t("MyData.messages.unreadFlag") }}</span>
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
