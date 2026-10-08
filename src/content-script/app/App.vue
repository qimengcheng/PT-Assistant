<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowReactive,
  useTemplateRef,
  watch,
  withModifiers,
} from "vue";
import { useI18n } from "vue-i18n";
import { useDraggable } from "@vueuse/core";
import { message as antdMessage } from "antdv-next";
import { HomeOutlined } from "@antdv-next/icons";
import { type ITorrent } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import type { IRemoteDownloadDialogData } from "./types.ts";
import { contentOverlay, currentView, type IPtdData, pageType, updatePageType } from "./utils.ts";

import SpeedDialBtn from "./components/SpeedDialBtn.vue";
import SentToDownloaderDialog from "@/options/components/SentToDownloaderDialog/Index.vue";

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const { t } = useI18n();

const ptdIcon = chrome.runtime.getURL("icon/128.png");
const ptdData = inject<IPtdData>("ptd_data", {});
const shadowRoot = inject<ShadowRoot>("ptd_shadow_root");

/**
 * 把组件树里的浮层（modal / dropdown / tooltip）收进 shadowRoot 内的浮层宿主，
 * 否则它们挂到 document.body、拿不到扩展的任何样式。宿主元素见 utils.ts 的 contentOverlay。
 */
function getPopupContainer(): HTMLElement {
  return contentOverlay.value ?? document.body;
}

const el = useTemplateRef<HTMLElement>("el");
provide("app", el);

// 记录一下与右边界和下边界的距离
const rightX = ref<number>(0);
const bottomY = ref<number>(0);

const openSpeedDial = ref<boolean>(false);
const { x, y, style } = useDraggable(el, {
  preventDefault: true,
  initialValue: { x: -100, y: -100 }, // Default position off-screen
  onEnd: ({ x, y }) => {
    configStore.updateContentScriptPosition(x, y);
    const { clientWidth, clientHeight } = document.documentElement;
    rightX.value = clientWidth - x;
    bottomY.value = clientHeight - y;
  },
});

function onWindowResize() {
  const { clientWidth, clientHeight } = document.documentElement;

  x.value = clientWidth - rightX.value; // 右侧吸附
  if (x.value > clientWidth - 50 || x.value < 0) {
    x.value = clientWidth - 100; // 确保不会超出右边界
  }
  rightX.value = clientWidth - x.value;

  y.value = clientHeight - bottomY.value; // 底部吸附
  if (y.value > clientHeight - 50 || y.value < 0) {
    y.value = clientHeight - 100; // 确保不会超出下边界
  }
  bottomY.value = clientHeight - y.value;
}
onMounted(() => window.addEventListener("resize", onWindowResize));
onBeforeUnmount(() => window.removeEventListener("resize", onWindowResize));

// 由于 App.vue 是整个应用的根组件，此时 configStore 等 pinia store 可能还未初始化完成，所以需要监听 $onReady
configStore.$onReady(() => {
  openSpeedDial.value = configStore.contentScript?.defaultOpenSpeedDial ?? false;

  if (openSpeedDial.value) {
    updatePageType(ptdData).catch();
  }

  let { x: storeX = -100, y: storeY = -100 } = configStore.contentScript?.position ?? {};
  let { clientWidth, clientHeight } = document.documentElement;

  x.value = storeX <= 0 || storeX > clientWidth - 50 ? clientWidth - 100 : storeX; // Default to right side
  y.value = storeY <= 0 || storeY > clientHeight - 50 ? clientHeight - 100 : storeY; // Default to bottom
  rightX.value = clientWidth - x.value;
  bottomY.value = clientHeight - y.value;
});

/**
 * FAB 点击：先重算页面类型，再开合按钮组。
 *
 * 为什么需要显式写：上游（PT-Plugin-Plus）用的是 `<v-speed-dial v-model="openSpeedDial">`
 * （该标签在本仓历史里从未存在，git log -S 只命中写这条注释的那次提交，仅作外部线索），
 * 开合由 Vuetify 组件自己接管；迁到 antdv-next 后没有 speed-dial 组件，外层换成裸 div，
 * v-model 那条翻转**在移植时就没接上**（不是「随组件一起丢了」——本仓从头到尾没有过那个组件），
 * openSpeedDial 只剩「声明 + 从配置读初值」两处，于是球能画出来但点了永远没反应。
 * 点子按钮不自动收起，对应上游的 :close-on-content-click="false"。
 */
function toggleSpeedDial() {
  updatePageType(ptdData).catch((e) => console.error("[PTD] updatePageType failed", e));
  openSpeedDial.value = !openSpeedDial.value;
}

const remoteDownloadDialogData = shallowReactive<IRemoteDownloadDialogData>({
  show: false,
  torrents: [] as ITorrent[],
  isDefaultSend: false,
});
provide("remoteDownloadDialogData", remoteDownloadDialogData);

const CUSTOM_DRAG_MIME = "text/json+ptd";

const isDragging = ref<boolean>(false);

function fixDraggingLink(link: string): string {
  if (!link.startsWith("http") && !link.startsWith("magnet:")) {
    return new URL(link, window.location.href).href; // 相对链接转换为绝对链接
  }
  return link;
}

/**
 * 把站点页面上的 <a> 拖拽成本扩展的种子链接。
 *
 * 必须随组件生命周期成对挂载/卸载：这里是 document 级监听器，
 * 而 init.ts 的 MutationObserver 在节点被挤掉后会 unmount 并重新 mountApp（见 init.ts），
 * 写在 <script setup> 顶层（每次实例化都跑、且无人 removeEventListener）会随每次重挂
 * 无限累积 —— 页面上所有拖拽事件都要过一遍这些僵尸 handler，且各自持有旧的 ptdData 快照。
 */
function onDragStart(e: DragEvent) {
  const target = e.target as HTMLElement;
  if (target.tagName == "A") {
    const a = target as HTMLAnchorElement;
    const link = fixDraggingLink(a.href);
    if (link) {
      const list: ITorrent[] = [
        {
          site: ptdData.siteId || "",
          link,
          title: a.getAttribute("title") || target.innerText,
          id: getIDFromURL(URL.parse(link, location.href)),
        },
      ];
      e.dataTransfer?.setData(CUSTOM_DRAG_MIME, JSON.stringify(list));
    }
  }
  // fallback to default text/html behavior
}

onMounted(() => document.addEventListener("dragstart", onDragStart));
onBeforeUnmount(() => document.removeEventListener("dragstart", onDragStart));

const SIMPLE_URL_REGEX = /https?:\/\/[^\s]+/g;

function extractLinksManually(dataTransfer: DataTransfer): string[] {
  // prefer types: uri-list > html > text
  // ref: [MDN - Recommended_drag_types](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Recommended_drag_types#dragging_links)
  if (Array.from(dataTransfer.types).includes("text/uri-list")) {
    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      return uriList
        .split("\r\n")
        .map((line) => line.trim())
        .filter((uri) => !uri.startsWith("#") && uri.startsWith("http"));
    }
  }
  /**
   * 可以很好的适配<p><a href="...">...</a></p>这种情况
   * TODO: 但是面对选了一大片html的时候，可能会解析出来很多不是下载的链接，是否需要给每个站点/框架定义下载链接的正则表达式？
   * 比如简单的过滤 nexusphp => /passkey=[a-zA-Z0-9-]+/
   */
  if (dataTransfer.types.includes("text/html")) {
    const textData = dataTransfer.getData("text/html");
    if (textData) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(textData, "text/html");
      const links = Array.from(doc.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);
      return links.filter((link) => link.startsWith("http") || link.startsWith("magnet:"));
    }
  }
  // fallback to plain text extraction
  if (dataTransfer.types.includes("text/plain")) {
    const textData = dataTransfer.getData("text/plain");
    if (textData) {
      return Array.from(
        textData
          .matchAll(SIMPLE_URL_REGEX)
          .map((matched) => matched[0])
          .filter((url) => URL.canParse(url)),
      );
    }
  }
  return [];
}

function getIDFromURL(url?: URL | null): string {
  if (!url) return "";
  // 尝试从 searchParams 中提取 id
  for (const i of ["id", "tid", "torrent_id", "torrentId", "hash", "hash_id"]) {
    if (url.searchParams.has(i)) {
      return url.searchParams.get(i) || "";
    }
  }
  // 如果无法从 searchParams 中解出 id，则尝试从 pathname 中提取 id
  if (url.pathname) {
    for (const pathnameMatcher of [/\/(\d+)(?:\/|$)/]) {
      const match = url.pathname.match(pathnameMatcher);
      if (match) {
        return match[1] || "";
      }
    }
  }
  return "";
}

function onDrop(event: DragEvent) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    isDragging.value = false;
    return;
  }
  let torrents: ITorrent[] = [];
  // perfer types: custom > manual
  if (Array.from(dataTransfer.types).includes(CUSTOM_DRAG_MIME)) {
    try {
      torrents = JSON.parse(dataTransfer.getData(CUSTOM_DRAG_MIME));
    } catch (error) {
      console.warn("[PTD] Failed to parse dropped data as JSON:", error);
    }
  } else {
    // 尝试从其他类型中提取链接
    const links = extractLinksManually(dataTransfer);
    for (const link of links) {
      const url = URL.parse(link);
      if (!url || !(url.protocol.startsWith("http") || url.protocol.startsWith("magnet"))) continue;
      const torrentData: ITorrent = { link, title: "", site: ptdData.siteId || "", id: getIDFromURL(url) };
      torrents.push(torrentData);
    }
  }
  if (torrents.length > 0) {
    console.debug("[PTD] Dropped data:", torrents);
    remoteDownloadDialogData.torrents = torrents;
    remoteDownloadDialogData.show = true;
  } else {
    console.warn("[PTD] No valid torrent data found in the dropped content.");
  }
  isDragging.value = false; // 重置拖拽状态
}

const dropAction = computed(() => {
  if (ptdData.siteId && (configStore.contentScript?.dragLinkOnSpeedDial ?? true)) {
    return {
      drop: withModifiers((e) => onDrop(e as DragEvent), ["prevent"]),
      dragover: withModifiers(() => (isDragging.value = true), ["prevent"]),
      dragenter: () => withModifiers(() => (isDragging.value = true), ["prevent"]),
      // dragleave 和 mouseleave 事件直接使用 vue 的普通注册方式，而不是用 对象方式（因为不会有任何副作用）
    };
  }
  return {};
});

function openOptions() {
  sendMessage("openOptionsPage", "/");
}

/** Vuetify 的 v-snackbar-queue 在 WXT 选项页已经桥接到 antd 的 message；content script 是独立入口，这里自己桥接一次 */
const stopSnakebarWatch = watch(
  () => runtimeStore.uiGlobalSnakebar.length,
  () => {
    while (runtimeStore.uiGlobalSnakebar.length > 0) {
      const item = runtimeStore.uiGlobalSnakebar.shift() as { text?: string; color?: string; timeout?: number };
      const payload = { content: String(item?.text ?? ""), duration: (item?.timeout ?? 3) > 0 ? item!.timeout! : 0 };
      if (item?.color === "success") antdMessage.success(payload);
      else if (item?.color === "warning") antdMessage.warning(payload);
      else if (item?.color === "error") antdMessage.error(payload);
      else antdMessage.info(payload);
    }
  },
);
onBeforeUnmount(() => stopSnakebarWatch());
</script>

<template>
  <!-- 把 antd 的 CSS-in-JS 注入目标指向 shadow root，避免污染站点样式 -->
  <a-style-provider :container="shadowRoot">
    <!-- 浮层容器指向 shadowRoot 内的 #ptd-content-script-overlay，否则弹窗挂到 body 上拿不到样式 -->
    <!-- rowHoverBg / headerBg / headerSort*Bg 与 options 侧 entrypoints/options/App.vue 同值
         （很淡的蓝悬停 + 蓝灰表头，替代 antd 默认那两档 #fafafa —— 表头会和斑马纹奇数行同色）。
         那边改这几个色值时这里要跟着改，两处的 ConfigProvider 互相读不到。
         字号仍走 antd 默认，不跟着 options 的 fontSize:13 改。 -->
    <a-config-provider
      :get-popup-container="getPopupContainer"
      :theme="{
        components: {
          Table: {
            rowHoverBg: '#f0f7ff',
            headerBg: '#eef2f7',
            headerSortHoverBg: '#e4ebf3',
            headerSortActiveBg: '#eef2f7',
          },
        },
      }"
    >
      <div
        ref="el"
        :style="style"
        class="ptd-root"
        :class="{ 'ptd-fade-enter': configStore.contentScript.fadeEnterStyle }"
      >
        <!-- 主按钮（FAB） -->
        <a-button
          shape="circle"
          size="large"
          class="ptd-fab"
          :loading="false"
          @click="toggleSpeedDial"
          @mouseleave.prevent="isDragging = false"
          @dragleave.prevent="isDragging = false"
          v-on="dropAction"
        >
          <img :src="ptdIcon" alt="PT Assistant" class="ptd-fab-icon" :class="{ 'ptd-fab-loading': isDragging }" />
        </a-button>

        <!-- 展开的按钮组 -->
        <div v-show="openSpeedDial" class="ptd-actions">
          <!-- 这里根据 pageType 来决定显示哪些按钮 -->
          <component :is="currentView" :key="pageType" />

          <SpeedDialBtn
            key="home"
            color="#ffc107"
            :icon="HomeOutlined"
            :title="t('contentScript.openPTD')"
            @click="openOptions"
          />
        </div>
      </div>

      <!-- SentToDownloaderDialog 内部用 usePromptInDialog()，那是 inject(App 上下文)，
           所以它的祖先链上必须有 <a-app>（选项页由 entrypoints/options/App.vue 提供同一层） -->
      <a-app>
        <SentToDownloaderDialog
          v-model="remoteDownloadDialogData.show"
          :torrent-items="remoteDownloadDialogData.torrents"
          :is-default-send="remoteDownloadDialogData.isDefaultSend"
        />
      </a-app>
    </a-config-provider>
  </a-style-provider>
</template>

<style scoped lang="scss">
.ptd-root {
  position: fixed;
  z-index: 9999999;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
}

.ptd-fab {
  background: #ffc107;
  border: none;
  box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
}

.ptd-fab-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
}

.ptd-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

@keyframes onFABLoading {
  100% {
    transform: rotate(360deg);
  }
}

.ptd-fab-loading {
  animation: onFABLoading 1.9s linear infinite running;
}

.ptd-fade-enter {
  opacity: 0.6;
}
</style>
