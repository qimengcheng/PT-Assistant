<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { saveAs } from "file-saver";
import { CloseOutlined, CodeOutlined, ExportOutlined, FileTextOutlined } from "@antdv-next/icons";

import type { IUserInfo, TSiteID } from "@ptd/site";

import { formatDate } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { sendMessage } from "@/messages.ts";

import { fixUserInfo } from "./utils/format.ts";

interface IHistoryUserInfo extends IUserInfo {
  date: string;
  site: TSiteID;
  siteName: string;
}

interface IExportField {
  key: string;
  label: string;
  required?: boolean;
}

const props = defineProps<{
  selectedSiteIds: TSiteID[];
}>();

const showDialog = defineModel<boolean>();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const isLoading = ref(false);

const allExportFields: IExportField[] = [
  { key: "site", label: "common.site", required: true },
  { key: "siteName", label: "MyData.exportDialog.fields.siteName", required: false },
  { key: "date", label: "common.date", required: true },
  { key: "name", label: "common.username", required: false },
  { key: "id", label: "MyData.exportDialog.fields.id", required: false },
  { key: "levelName", label: "MyData.exportDialog.fields.levelName", required: false },
  { key: "uploaded", label: "levelRequirement.uploaded", required: false },
  { key: "downloaded", label: "levelRequirement.downloaded", required: false },
  { key: "ratio", label: "levelRequirement.ratio", required: false },
  { key: "trueUploaded", label: "levelRequirement.trueUploaded", required: false },
  { key: "trueDownloaded", label: "levelRequirement.trueDownloaded", required: false },
  { key: "trueRatio", label: "levelRequirement.trueRatio", required: false },
  { key: "seeding", label: "levelRequirement.seeding", required: false },
  { key: "seedingSize", label: "levelRequirement.seedingSize", required: false },
  { key: "bonus", label: "levelRequirement.bonus", required: false },
  { key: "seedingBonus", label: "levelRequirement.seedingBonus", required: false },
  { key: "bonusPerHour", label: "levelRequirement.bonusPerHour", required: false },
  { key: "seedingBonusPerHour", label: "levelRequirement.seedingBonusPerHour", required: false },
  { key: "uploads", label: "levelRequirement.uploads", required: false },
  { key: "leeching", label: "levelRequirement.leeching", required: false },
  { key: "snatches", label: "levelRequirement.snatches", required: false },
  { key: "messageCount", label: "MyData.exportDialog.fields.messageCount", required: false },
  { key: "hnrUnsatisfied", label: "levelRequirement.hnrUnsatisfied", required: false },
  { key: "hnrPreWarning", label: "levelRequirement.hnrPreWarning", required: false },
  { key: "joinTime", label: "MyData.exportDialog.fields.joinTime", required: false },
  { key: "lastAccessAt", label: "MyData.exportDialog.fields.lastAccessAt", required: false },
  { key: "updateAt", label: "MyData.exportDialog.fields.updateAt", required: false },
];

const defaultKeys = allExportFields.map((f) => f.key);
const selectedKeys = ref<string[]>([...defaultKeys]);

const exportFormat = ref<"csv" | "json">("csv");

const querySiteIds = computed<TSiteID[]>(() => {
  if (props.selectedSiteIds.length > 0) {
    return props.selectedSiteIds;
  }
  return Object.keys(metadataStore.sites) as TSiteID[];
});

const isExportSelected = computed(() => props.selectedSiteIds.length > 0);

async function doExport() {
  isLoading.value = true;

  try {
    const tasks = querySiteIds.value.map(async (siteId) => {
      try {
        const history = (await sendMessage("getSiteUserInfo", siteId)) as Record<string, IUserInfo> | undefined;
        if (!history) return [];

        const siteName = metadataStore.siteNameMap[siteId] ?? siteId;
        const items: IHistoryUserInfo[] = [];
        for (const [date, item] of Object.entries(history)) {
          items.push({
            ...fixUserInfo(item),
            site: siteId,
            siteName,
            date,
          });
        }
        return items;
      } catch (e) {
        console.error(`加载站点 ${siteId} 历史数据失败`, e);
        return [];
      }
    });

    const results = await Promise.allSettled(tasks);
    const merged: IHistoryUserInfo[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        merged.push(...result.value);
      }
    }

    merged.sort((a, b) => b.date.localeCompare(a.date));

    if (merged.length === 0) {
      runtimeStore.showSnakebar(t("common.noData"), { color: "warning" });
      return;
    }

    const timestamp = formatDate(new Date(), "yyyyMMdd_HHmmss");
    const ext = exportFormat.value;
    const mime = exportFormat.value === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const content = exportFormat.value === "csv" ? convertToCSV(merged) : convertToJSON(merged);
    const blob = new Blob(exportFormat.value === "csv" ? ["\ufeff", content] : [content], { type: mime });
    saveAs(blob, `userinfo-${timestamp}.${ext}`);
    showDialog.value = false;
  } finally {
    isLoading.value = false;
  }
}

function getSortedExportFields(): IExportField[] {
  const site = allExportFields.find((f) => f.key === "site")!;
  const date = allExportFields.find((f) => f.key === "date")!;
  const others = allExportFields.filter((f) => f.key !== "site" && f.key !== "date");
  return [site, date, ...others];
}

function getActiveFields(): IExportField[] {
  return getSortedExportFields().filter((f) => selectedKeys.value.includes(f.key));
}

function convertToCSV(items: IHistoryUserInfo[]): string {
  const activeFields = getActiveFields();
  const headers = activeFields.map((f) => f.key);
  const rows = items.map((item) =>
    headers
      .map((key) => {
        const raw = (item as any)[key];
        const val =
          raw === Infinity || raw === -Infinity || (typeof raw === "number" && isNaN(raw)) ? "" : String(raw ?? "");
        if (/[",\n\r]/.test(val)) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function convertToJSON(items: IHistoryUserInfo[]): string {
  const activeFields = getActiveFields();
  return JSON.stringify(
    items.map((item) => {
      const obj: Record<string, any> = {};
      for (const f of activeFields) {
        const raw = (item as any)[f.key];
        obj[f.key] =
          raw === Infinity || raw === -Infinity || (typeof raw === "number" && isNaN(raw)) ? null : (raw ?? null);
      }
      return obj;
    }),
    null,
    2,
  );
}
</script>

<template>
  <!-- footer prop 传 null 会连 #footer slot 一起吞掉（antdv-next: footer: d !== null && ...），底部按钮全消失，故不设 footer -->
  <a-modal v-model:open="showDialog" :width="700">
    <template #title>
      <div class="d-flex align-center">
        <span class="flex-1-1-0">
          <template v-if="isExportSelected">
            {{ t("MyData.exportDialog.exportSelected", { count: querySiteIds.length }) }}
          </template>
          <template v-else>
            {{ t("MyData.exportDialog.exportAll", { count: querySiteIds.length }) }}
          </template>
        </span>
        <a-button type="text" size="small" :title="t('common.dialog.close')" @click="showDialog = false">
          <CloseOutlined />
        </a-button>
      </div>
    </template>

    <a-divider class="ma-0" />

    <div class="pt-4">
      <a-row>
        <a-col :span="24">
          <div class="text-body-medium font-weight-bold mb-2">{{ t("MyData.exportDialog.formatLabel") }}</div>
          <a-segmented
            v-model:value="exportFormat"
            :options="[
              { value: 'csv', label: t('MyData.exportDialog.formatCSV'), icon: FileTextOutlined },
              { value: 'json', label: t('MyData.exportDialog.formatJSON'), icon: CodeOutlined },
            ]"
          />
        </a-col>
      </a-row>

      <a-row class="mt-4">
        <a-col :span="24">
          <div class="text-body-medium font-weight-bold mb-2">{{ t("MyData.exportDialog.fieldsLabel") }}</div>
          <a-card variant="outlined">
            <div class="pa-2">
              <a-row :gutter="[8, 8]">
                <a-col v-for="field in allExportFields" :key="field.key" :span="12" :md="8">
                  <a-checkbox
                    :checked="selectedKeys.includes(field.key)"
                    :disabled="field.required"
                    @update:checked="
                      (checked: boolean) => {
                        // @update:checked 直接给布尔值。用 @change 会拿到 CheckboxChangeEvent 对象，
                        // if (v) 恒为真 —— 非必选字段取消不掉，且每次点击都往数组里塞重复项。
                        selectedKeys = checked
                          ? [...new Set([...selectedKeys, field.key])]
                          : selectedKeys.filter((k) => k !== field.key);
                      }
                    "
                  >
                    {{ t(field.label) }}
                  </a-checkbox>
                </a-col>
              </a-row>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <template #footer>
      <div class="d-flex align-center pa-4">
        <div class="flex-1-1-0" />
        <a-button class="mr-2" @click="showDialog = false">{{ t("common.dialog.cancel") }}</a-button>
        <a-button type="primary" :disabled="isLoading" :loading="isLoading" @click="doExport">
          <template #icon><ExportOutlined /></template>
          {{ t("common.export") }}
        </a-button>
      </div>
    </template>
  </a-modal>
</template>
