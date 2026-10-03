<script setup lang="ts">
import { definitionList } from "@ptd/site";

// 本组件是 router-view 直接渲染的路由页，没有调用方可以传 props，所以版本与站点数在组件内自取。
// （骨架阶段把 version / definitionCount 声明成了 props，一直没人传值，
//   于是首页两张卡恒显示成空的 "v" 和 "…"。）
const version = browser.runtime.getManifest().version;
const definitionCount = definitionList.length;

// 功能模块状态（随 Roadmap 平移逐个点亮）
const modules = [
  { name: "站点定义（340 个，按需加载）", status: "ok" as const },
  { name: "消息层 / background 中枢", status: "ok" as const },
  { name: "站点管理（添加/配置/用户信息查询）", status: "ok" as const },
  { name: "多站点搜索", status: "ok" as const },
  { name: "我的数据（用户信息总览）", status: "ok" as const },
  { name: "数据备份/导入（本地 zip + WebDAV/S3/B2）", status: "ok" as const },
  { name: "种子下载器对接（qBittorrent 等）配置页与推送 UI", status: "todo" as const },
  { name: "content script（页面内识别与悬浮入口）", status: "todo" as const },
  { name: "媒体服务器配置页", status: "todo" as const },
];
</script>

<template>
  <div class="home">
    <h2>欢迎使用 PT Assistant</h2>
    <p class="sub">PT 站点辅助扩展（WXT + Vue 3 + antdv-next 重构版）</p>

    <a-row :gutter="[12, 12]" style="margin-bottom: 24px">
      <a-col :span="8">
        <a-card size="small">
          <div class="card-label">版本</div>
          <div class="card-value">v{{ version }}</div>
        </a-card>
      </a-col>
      <a-col :span="16">
        <a-card size="small">
          <div class="card-label">内置站点定义</div>
          <div class="card-value">
            {{ definitionCount }}
            <small>个 · 按需加载</small>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <h3>功能模块</h3>
    <a-list size="small" bordered>
      <a-list-item v-for="m in modules" :key="m.name">
        <span class="dot" :class="m.status">{{ m.status === "ok" ? "✓" : "…" }}</span>
        <span :class="{ pending: m.status === 'todo' }">{{ m.name }}</span>
        <template #extra>
          <a-tag v-if="m.status === 'todo'" color="default">建设中</a-tag>
        </template>
      </a-list-item>
    </a-list>
  </div>
</template>