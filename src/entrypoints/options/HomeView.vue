<script setup lang="ts">
const props = defineProps<{
  version: string;
  definitionCount: number | null;
}>();

// 骨架阶段的功能模块状态（随 Roadmap 平移逐个点亮）
const modules = [
  { name: "站点定义（340 个，按需加载）", status: "ok" as const },
  { name: "消息层 / background 中枢", status: "ok" as const },
  { name: "站点管理（登录态、用户信息）", status: "todo" as const },
  { name: "多站点搜索", status: "todo" as const },
  { name: "种子下载器对接（qBittorrent 等）", status: "todo" as const },
  { name: "备份同步（WebDAV 等）", status: "todo" as const },
];
</script>

<template>
  <div class="home">
    <h2>欢迎使用 PT Assistant</h2>
    <p class="sub">PT 站点辅助扩展（WXT + Vue 3 重构版）</p>

    <div class="cards">
      <div class="card">
        <span class="card-label">版本</span>
        <span class="card-value">v{{ props.version }}</span>
      </div>
      <div class="card">
        <span class="card-label">内置站点定义</span>
        <span class="card-value">
          {{ props.definitionCount ?? "…" }}
          <small v-if="props.definitionCount !== null">个 · 按需加载</small>
        </span>
      </div>
    </div>

    <h3>功能模块</h3>
    <ul class="modules">
      <li v-for="m in modules" :key="m.name">
        <span class="dot" :class="m.status">{{ m.status === "ok" ? "✓" : "…" }}</span>
        <span :class="{ pending: m.status === 'todo' }">{{ m.name }}</span>
        <span v-if="m.status === 'todo'" class="pending-tag">建设中</span>
      </li>
    </ul>
  </div>
</template>
