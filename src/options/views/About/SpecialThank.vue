<script setup lang="ts">
/**
 * 特别感谢页（antdv-next 平移）。
 * 感谢语、语言贡献者表、前期工作贡献者名单（按字母排序）。
 */
import { useI18n } from "vue-i18n";
import { UserOutlined } from "@antdv-next/icons";

import { definedLangMetaData } from "@/options/plugins/i18n.ts";
import { REPO_URL } from "~/helper.ts";

const { rt, tm, t } = useI18n();

// 旧版名单保持不变，仅展示时按字母排序
const sortedPeople = [
  "Rhilip (R酱)",
  "ted423",
  "luckiestone",
  "sabersalv",
  "bimzcy (白鸽男孩)",
  "DXV5 (贝壳)",
  "An",
  "Abel袁",
  "Мало",
  "tongyifan (杯杯杯杯具)",
  "the chosen one (三哥)",
  "橙子",
  "frank777777777 (杀死那个异教徒)",
].sort((a, b) => a.localeCompare(b));

const langColumns = [
  { title: "Code", dataIndex: "value", key: "value", width: 120 },
  { title: t("common.language"), dataIndex: "title", key: "title" },
  { title: t("SpecialThank.contributor"), key: "authors" },
];

// tm 返回的是翻译消息描述符数组，用 rt 解析成最终字符串
const thankNotes = (): string[] => (tm("SpecialThank.thankNote") as unknown as string[]).map((i) => rt(i));
</script>

<template>
  <div class="special-thank">
    <a-alert type="info" show-icon class="thank-alert">
      <template #message>
        <div>
          <p v-for="(note, idx) in thankNotes()" :key="idx" class="thank-line">{{ note }}</p>
          <p class="thank-links">
            {{ t("SpecialThank.contributor") }}:
            <a :href="`${REPO_URL}/graphs/contributors`" rel="noopener noreferrer nofollow" target="_blank">
              {{ REPO_URL }}/graphs/contributors
            </a>
            <br />
            {{ t("SpecialThank.issue") }}:
            <a :href="`${REPO_URL}/issues`" rel="noopener noreferrer nofollow" target="_blank">
              {{ REPO_URL }}/issues
            </a>
          </p>
        </div>
      </template>
    </a-alert>

    <a-card :title="t('SpecialThank.langContributor')" class="block-card">
      <a-table
        :columns="langColumns"
        :data-source="[...definedLangMetaData]"
        :pagination="false"
        row-key="value"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'authors'">
            {{ record.authors.join(", ") }}
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="block-card">
      <template #title>
        {{ t("SpecialThank.preWorkContributor") }} ({{ t("SpecialThank.sortByName") }})
      </template>
      <a-row :gutter="[16, 12]">
        <a-col v-for="people in sortedPeople" :key="people" :xs="24" :sm="12" :md="8" :lg="6">
          <div class="people-item">
            <a-avatar class="people-avatar">
              <template #icon><UserOutlined /></template>
            </a-avatar>
            <span>{{ people }}</span>
          </div>
        </a-col>
      </a-row>
    </a-card>
  </div>
</template>

<style scoped>
.special-thank {
  padding: 16px;
}
.thank-alert {
  margin-bottom: 12px;
}
.thank-line {
  margin: 0 0 4px;
}
.thank-links {
  margin: 8px 0 0;
}
.block-card {
  margin-top: 12px;
}
.people-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.people-avatar {
  flex: 0 0 auto;
}
</style>
