<script setup lang="ts">
/**
 * 站点那一格悬停时的账户数浮层：上传量 / 下载量 / 分享率，再加一行「下完这一条之后」会变成什么。
 *
 * 为什么要这一层（用户 2026-10-11 指着辅种检测的站点列提的）：那一站现在分享率多少，
 * 与「把这一条下完会变成多少」是两个数，而只有第二个才决定这一条该不该下。
 * 预估走的是 `@/shared/ratioGuard.ts` 的 `projectRatio` —— 与发送前那道拦截同一个算式，
 * 两处各写一遍迟早会算出两个结果。
 *
 * 「会不会真下这一条」由调用方按当前流程判（`impact`），这里只负责选措辞：
 * 辅种里只有基准那一条要真下一次，其余是跳过校验，把体积记到它们头上就是凭空吓人。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { formatSize } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { formatRatioText, projectRatio, type TRatioImpact } from "@/shared/ratioGuard.ts";

const props = defineProps<{
  siteId: string;
  /** 这一条的体积（字节）；只有 impact 是 download 时才会用到 */
  size?: number;
  impact: TRatioImpact;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

// 派生而不是在挂载时命令式读：lastUserInfo 是异步水合的 store（AGENTS §3.4 那条竞态）
const account = computed(() => metadataStore.lastUserInfo?.[props.siteId]);

/** 字节数：拿不出就写 `-`，不替数据源编一个 0 B */
function bytesOf(value: unknown): string {
  const parsed = typeof value === "string" ? parseFloat(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return "-";
  return String(formatSize(parsed));
}

const uploadedText = computed(() => bytesOf(account.value?.uploaded));
const downloadedText = computed(() => bytesOf(account.value?.downloaded));
const ratioText = computed(() => formatRatioText(account.value?.ratio));

/**
 * 「下完这一条之后」那一行。四种不产生的情形各说各的原因 —— 都写成「不变」会把
 * 「这一条其实要下、只是算不出」和「这一条压根不会下」混成一句话。
 */
const afterText = computed(() => {
  if (props.impact === "free") return t("common.siteRatio.free");
  if (props.impact === "skipCheck") return t("common.siteRatio.skipCheck");
  if (props.impact === "localBase") return t("common.siteRatio.localBase");
  if (props.impact === "noSize") return t("common.siteRatio.noSize");

  const projected = projectRatio({
    uploaded: account.value?.uploaded,
    downloaded: account.value?.downloaded,
    ratio: account.value?.ratio,
    countedSize: props.size,
    sizeKnown: true,
  });
  // basis 不是 projected 就是缺上传量/下载量，算不出（不能拿现状冒充预估结果）
  if (!projected || projected.basis !== "projected") return t("common.siteRatio.noAccount");
  return t("common.siteRatio.afterValue", {
    downloaded: bytesOf((account.value?.downloaded as number) + (props.size ?? 0)),
    ratio: formatRatioText(projected.value),
  });
});
</script>

<template>
  <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
    <template #content>
      <div class="site-ratio-popover">
        <div class="sr-row">
          <span class="sr-label">{{ t("common.siteRatio.uploaded") }}</span>
          <span class="sr-value">{{ uploadedText }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-label">{{ t("common.siteRatio.downloaded") }}</span>
          <span class="sr-value">{{ downloadedText }}</span>
        </div>
        <div class="sr-row">
          <span class="sr-label">{{ t("common.siteRatio.ratio") }}</span>
          <span class="sr-value">{{ ratioText }}</span>
        </div>
        <div class="sr-after">
          <div class="sr-after-title">{{ t("common.siteRatio.afterTitle") }}</div>
          <div class="sr-after-value">{{ afterText }}</div>
        </div>
      </div>
    </template>
    <slot />
  </a-popover>
</template>

<style scoped lang="scss">
.site-ratio-popover {
  min-width: 200px;
}

.sr-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  line-height: 20px;
}

.sr-label {
  opacity: 0.65;
}

.sr-value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sr-after {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
}

.sr-after-title {
  margin-bottom: 2px;
  font-weight: 600;
}

.sr-after-value {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
</style>
