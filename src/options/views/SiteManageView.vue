<script setup lang="ts">
import { computed, ref } from "vue";
import { definitionList, type ISiteMetadata, type ISiteUserConfig, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { getSiteInstance, getSiteUserConfig } from "@/options/services/site.ts";

const metadataStore = useMetadataStore();

const addedSiteIds = computed(() => Object.keys(metadataStore.sites));

// ===== 添加站点 =====
const addKeyword = ref("");
const adding = ref<string | null>(null);

const addableList = computed(() => {
  const kw = addKeyword.value.trim().toLowerCase();
  return definitionList
    .filter((id) => !metadataStore.sites[id])
    .filter((id) => (!kw ? true : id.toLowerCase().includes(kw)))
    .slice(0, 30);
});

async function addSite(siteId: TSiteID) {
  adding.value = siteId;
  try {
    const siteUserConfig: ISiteUserConfig = await getSiteUserConfig(siteId);
    await metadataStore.addSite(siteId, siteUserConfig);
    selectSite(siteId);
  } finally {
    adding.value = null;
  }
}

async function removeSite(siteId: TSiteID) {
  await metadataStore.removeSite(siteId);
  if (selectedId.value === siteId) {
    selectedId.value = null;
  }
}

// ===== 选中站点 =====
const selectedId = ref<TSiteID | null>(null);
const selectedMetadata = ref<ISiteMetadata | null>(null);
const selectedUserConfig = ref<ISiteUserConfig | null>(null);
const loading = ref(false);

const selectedName = computed(() => selectedUserConfig.value?.merge?.name ?? selectedMetadata.value?.name ?? selectedId.value);
const selectedUrl = computed(() => selectedUserConfig.value?.url ?? selectedMetadata.value?.urls?.[0] ?? "#");

async function selectSite(siteId: TSiteID) {
  loading.value = true;
  selectedId.value = siteId;
  selectedMetadata.value = await import("@ptd/site").then((m) => m.getDefinedSiteMetadata(siteId));
  selectedUserConfig.value = { ...(await getSiteUserConfig(siteId)), ...(metadataStore.sites[siteId] ?? {}) };
  loading.value = false;
}

async function patchSelected(key: string, value: any) {
  if (!selectedId.value) return;
  await metadataStore.simplePatch("sites", selectedId.value, key, value);
  selectedUserConfig.value = { ...selectedUserConfig.value, [key]: value };
}

async function patchMergeName(name: string) {
  if (!selectedId.value) return;
  const merge = { ...(selectedUserConfig.value?.merge ?? {}), name: name || undefined };
  await metadataStore.simplePatch("sites", selectedId.value, "merge", merge);
  selectedUserConfig.value = { ...selectedUserConfig.value, merge };
}

// ===== 用户信息查询 =====
const userInfo = ref<any | null>(null);
const userInfoLoading = ref(false);
const userInfoError = ref<string | null>(null);

async function flushUserInfo() {
  if (!selectedId.value) return;
  userInfoLoading.value = true;
  userInfoError.value = null;
  userInfo.value = null;
  try {
    // 完整链路验证：页面上下文创建站点实例 → axios（cookies/DNR 拦截器经 background）→ DOMParser 解析
    const siteInstance = await getSiteInstance(selectedId.value);
    // getUserInfoResult / allowQueryUserInfo 定义在 PrivateSite 侧，公共站点不支持
    if ((siteInstance as any).allowQueryUserInfo === false) {
      throw new Error("该站点未启用用户信息查询（allowQueryUserInfo=false）");
    }
    userInfo.value = await (siteInstance as any).getUserInfoResult();
  } catch (e: any) {
    userInfoError.value = e?.message ?? String(e);
  } finally {
    userInfoLoading.value = false;
  }
}

const userInfoFields: Array<[string, string]> = [
  ["name", "用户名"],
  ["id", "用户 ID"],
  ["levelName", "等级"],
  ["uploaded", "上传量"],
  ["downloaded", "下载量"],
  ["ratio", "分享率"],
  ["seedingSize", "做种量"],
  ["seedingPoints", "做种积分"],
  ["bonus", "魔力值"],
  ["joinTime", "入站时间"],
  ["messageCount", "未读消息"],
  ["invites", "邀请"],
];
</script>

<template>
  <div class="layout">
    <!-- ===== 已添加站点 + 添加入口 ===== -->
    <aside class="defs">
      <header>
        <h1>我的站点</h1>
        <span class="count">{{ addedSiteIds.length }} 个</span>
      </header>
      <ul class="site-list">
        <li
          v-for="id in addedSiteIds"
          :key="id"
          :class="{ active: id === selectedId }"
          @click="selectSite(id)"
        >
          {{ metadataStore.siteNameMap[id] ?? id }}
        </li>
        <li v-if="addedSiteIds.length === 0" class="empty">还没有添加站点<br />↓ 从下方内置定义中添加</li>
      </ul>

      <header>
        <h1>添加站点</h1>
        <span class="count">{{ definitionList.length }} 内置</span>
      </header>
      <input v-model="addKeyword" type="search" placeholder="搜索站点 id…" class="search" />
      <ul class="site-list addable">
        <li v-for="id in addableList" :key="id" @click="addSite(id)">
          <span>{{ id }}</span>
          <span class="add-btn">{{ adding === id ? "添加中…" : "+" }}</span>
        </li>
      </ul>
    </aside>

    <!-- ===== 详情 ===== -->
    <section class="defs-detail">
      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="!selectedId" class="hint">← 添加或选择一个站点</div>
      <template v-else-if="selectedMetadata">
        <div class="detail-head">
          <h2>{{ selectedName }}</h2>
          <div class="head-actions">
            <a :href="selectedUrl" target="_blank" rel="noreferrer">
              <button>打开站点</button>
            </a>
            <button class="danger" @click="removeSite(selectedId!)">移除</button>
          </div>
        </div>

        <table class="detail">
          <tbody>
            <tr>
              <th>id / schema</th>
              <td>{{ selectedId }} · {{ selectedMetadata.schema }} · {{ selectedMetadata.type }}</td>
            </tr>
            <tr>
              <th>URL 覆盖</th>
              <td>
                <input
                  class="inline-input"
                  :value="selectedUserConfig?.url ?? ''"
                  :placeholder="selectedMetadata.urls?.[0] ?? ''"
                  @change="patchSelected('url', ($event.target as HTMLInputElement).value || undefined)"
                />
              </td>
            </tr>
            <tr>
              <th>自定义名称</th>
              <td>
                <input
                  class="inline-input"
                  :value="selectedUserConfig?.merge?.name ?? ''"
                  :placeholder="selectedMetadata.name"
                  @change="patchMergeName(($event.target as HTMLInputElement).value)"
                />
              </td>
            </tr>
            <tr>
              <th>离线 / 允许搜索 / 允许查用户</th>
              <td class="toggles">
                <label>
                  <input
                    type="checkbox"
                    :checked="!!selectedUserConfig?.isOffline"
                    @change="patchSelected('isOffline', ($event.target as HTMLInputElement).checked)"
                  />离线
                </label>
                <label>
                  <input
                    type="checkbox"
                    :checked="selectedUserConfig?.allowSearch !== false"
                    @change="patchSelected('allowSearch', ($event.target as HTMLInputElement).checked)"
                  />搜索
                </label>
                <label>
                  <input
                    type="checkbox"
                    :checked="selectedUserConfig?.allowQueryUserInfo !== false"
                    @change="patchSelected('allowQueryUserInfo', ($event.target as HTMLInputElement).checked)"
                  />用户信息
                </label>
              </td>
            </tr>
          </tbody>
        </table>

        <h3>用户信息</h3>
        <div class="user-info">
          <button :disabled="userInfoLoading || selectedUserConfig?.allowQueryUserInfo === false" @click="flushUserInfo">
            {{ userInfoLoading ? "查询中…（请求站点页面并解析）" : "查询用户信息" }}
          </button>
          <span v-if="userInfoError" class="error-text">查询失败：{{ userInfoError }}</span>
          <span v-else-if="!userInfo && !userInfoLoading" class="hint-inline">
            需要已在浏览器登录该站点（cookie 有效）
          </span>
        </div>
        <table v-if="userInfo" class="detail">
          <tbody>
            <tr v-for="[key, label] in userInfoFields" :key="key">
              <th>{{ label }}</th>
              <td>{{ userInfo[key] ?? "-" }}</td>
            </tr>
            <tr>
              <th>解析状态</th>
              <td>{{ userInfo.status }} · 更新于 {{ new Date(userInfo.updateAt).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </div>
</template>
