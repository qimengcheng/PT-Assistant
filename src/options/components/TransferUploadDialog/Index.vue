<script setup lang="ts">
/**
 * 转种（转载发布）：把「我的下载器」里的这一颗种子提交到另一个站的上传页。
 *
 * 与「辅种」（KeepUploadDialog）是两件事，别混：
 * - 辅种：数据已经在本地，只把同一份内容在别的站挂上做种，**不碰站点的上传页**
 * - 转种：走目标站的发布流程，要填标题 / 分类 / 简介，站点会重新生成种子
 *
 * ## 为什么要先「定位源站那颗种子」
 *
 * 下载器只报名字、大小、infoHash，没有源站条目号也没有下载链接；而转种必须交**原始那颗**
 * `.torrent`（重新打包会换 infoHash，目标站那份就成了另一颗种子）。所以开场先去源站按名字搜一轮、
 * 用 infoHash 逐字相等把它认出来（见 offscreen 的 `locateSourceTorrent`）。
 * 认出来之前不让人选目标站：目标站的表单初值要拿源标题与分类去猜，没猜的原料就只能填空白。
 *
 * ## 表单长什么样不是写死的
 *
 * 选完目标站就去抓它的上传页，按页面真实字段渲染。站点改版自动被吸收，代价是一次 GET。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FileTextOutlined, LinkOutlined, UploadOutlined } from "@antdv-next/icons";
import type { ITorrent } from "@ptd/site";

import type {
  ISourceDescription,
  ITransferDuplicateCheck,
  ITransferSourceRow,
  ITransferUploadResult,
  IUploadFormDescriptor,
} from "@/shared/upload/types.ts";
import { composeDescription, extractImageUrlsFromText, isDescriptionFieldName } from "@/shared/upload/description.ts";
import { replaceImageUrls, replaceUrlList } from "@/shared/imageHost/rewrite.ts";
import { buildInitialValues, findEmptyRequiredFields } from "@/shared/upload/uploadMatch.ts";
import { resolveTrackerHostSite } from "@/shared/trackerHost.ts";
import { sendMessage } from "@/messages.ts";
import { formatSize } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

const showDialog = defineModel<boolean>();
const { torrents } = defineProps<{
  torrents: ITransferSourceRow[];
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

/** P0 只支持单颗：多颗要逐站逐颗确认分类，批量放在 P2 */
const source = computed(() => torrents[0]);

/** 源站：默认拿 tracker 反查，认不出就留空让人自己选（认不出的形状真实存在，见 trackerHost.ts） */
const sourceSiteId = ref<string>("");
const located = ref<ITorrent | null>(null);
const isLocating = ref(false);
const locateError = ref("");

const targetSiteId = ref<string>("");
const form = ref<IUploadFormDescriptor | null>(null);
const values = ref<Record<string, string>>({});
const keepSourceTag = ref(true);

/** 源站详情页抓到的简介素材（简介 HTML / 截图 / mediainfo），与「定位到种子」是两步独立抓取 */
const sourceDescription = ref<ISourceDescription | null>(null);
const isLoadingDesc = ref(false);
const descError = ref("");
const useDescription = ref(true);
const showPreview = ref(false);

/**
 * 图床转存的状态。
 *
 * `imageUrlMap` 是「源图地址 → 图床地址」，`composedDescription` 靠它把简介里的图换掉。
 * 刻意保留这份映射而不是直接改写 `sourceDescription`：换一个图床重传时要能从原始地址重来，
 * 而且预览里也要能看出哪几张换过了。
 */
const imageHostId = ref("");
const imageUrlMap = ref<Record<string, string>>({});
const imageErrors = ref<{ url: string; error: string }[]>([]);
const isTransferringImages = ref(false);
const imageProgress = ref({ done: 0, total: 0 });

const isLoadingForm = ref(false);
const isSubmitting = ref(false);
const loadError = ref("");
const submitResult = ref<ITransferUploadResult | null>(null);
const submitError = ref("");

/**
 * 目标站的查重结果。`null` 表示还没查 —— 与「查了但没查到」必须分开：
 * 后者会显示一行说明（搜过哪些词），前者什么都不说。
 */
const dupCheck = ref<ITransferDuplicateCheck | null>(null);
const isCheckingDup = ref(false);

/**
 * 查重结果是否成立。
 *
 * 只有「保留了源站站标」时成立：清掉 `info.source` 会改 infoHash，交上去的就是另一颗种子，
 * 目标站也不会认为它重复。这一点必须说清，否则人会以为「查重过了就安全」。
 */
const duplicateBlocked = computed(() => dupCheck.value?.duplicated === true && keepSourceTag.value);

const dupMessage = computed(() => {
  if (!dupCheck.value) return "";
  if (dupCheck.value.duplicated) {
    return keepSourceTag.value
      ? t("MyClient.transferUpload.duplicateFound")
      : t("MyClient.transferUpload.duplicateSkip");
  }
  // 没查到也要说：这是「搜过并没搜到」，不是「确认没有」，更不是「可以不查」
  return dupCheck.value.note || t("MyClient.transferUpload.duplicateNone");
});

const siteOptions = computed(() =>
  metadataStore.getSortedAddedSites
    .filter((site) => !site.isOffline)
    .map((site) => ({
      value: site.id,
      label: metadataStore.siteNameMap[site.id] ?? site.merge?.name ?? site.id,
    })),
);

/** 目标站不能是自己那个站：同一颗种子在自己站上再发一次必然被查重挡住 */
const targetSiteOptions = computed(() => siteOptions.value.filter((site) => site.value !== sourceSiteId.value));

const sourceItems = computed(() => [
  { key: "name", label: t("MyClient.transferUpload.sourceTorrent"), content: source.value?.name ?? "-" },
  { key: "size", label: t("MyClient.transferUpload.sourceSize"), content: formatSize(source.value?.totalSize ?? 0) },
  ...(located.value
    ? [{ key: "title", label: t("MyClient.transferUpload.locatedTitle"), content: located.value.title }]
    : []),
]);

/** 有值的、需要人看的字段。hidden 与 file 不渲染：前者原样回传，后者由插件附加 */
const visibleFields = computed(() =>
  (form.value?.fields ?? []).filter((field) => field.kind !== "hidden" && field.kind !== "file"),
);

/**
 * 目标站装简介的那个字段名。
 *
 * 只认 `descr` / `description` 这一族（整名匹配，见 `isDescriptionFieldName`）；
 * 找不到就说明这个站不收简介 —— 那时抓到的简介用不上，界面上要明说，
 * 而不是让人以为「填了但没生效」。
 */
const descriptionFieldName = computed(() => {
  const field = (form.value?.fields ?? []).find(
    (item) => item.kind !== "hidden" && item.kind !== "file" && isDescriptionFieldName(item.name),
  );
  return field?.name;
});

/** 拼好的简介正文（正文 + 截图 + mediainfo）。没抓到就是空串，空串不往表单里灌 */
const composedDescription = computed(() => {
  const desc = sourceDescription.value;
  if (!desc) return "";

  // 图床转存过的那几张先换掉：正文 HTML 与截图清单两处都要换，
  // 只换清单的话正文里的 `<img src>` 还是源站地址，发布出去照样裂
  const rewritten = {
    ...desc,
    descrHtml: replaceImageUrls(desc.descrHtml, imageUrlMap.value),
    screenshots: replaceUrlList(desc.screenshots, imageUrlMap.value),
  };
  return composeDescription(rewritten, "html");
});

/**
 * 简介里出现的所有图片地址（正文里的 img src、BBCode、裸链接，加上截图清单）。
 *
 * 为什么要取「全部」而不只是 `screenshots`：截图清单是按文件名特征筛过的，
 * 海报、对比图这类不含截图关键词的图会被漏掉，而它们在目标站一样会裂。
 */
const sourceImages = computed(() => {
  const desc = sourceDescription.value;
  if (!desc) return [];
  const urls = [...desc.screenshots, ...extractImageUrlsFromText(desc.descrHtml)];
  return Array.from(new Set(urls.filter((url) => url.trim() !== "")));
});

const imageHostOptions = computed(() =>
  metadataStore.getEnabledImageHosts.map((host) => ({ value: host.id, label: host.name })),
);

const imageTransferHint = computed(() => {
  if (imageHostOptions.value.length === 0) return t("MyClient.transferUpload.noImageHost");
  const done = Object.keys(imageUrlMap.value).length;
  if (done > 0) return t("MyClient.transferUpload.imageTransferDone", [done]);
  return t("MyClient.transferUpload.imageHostHint");
});

const descriptionSummary = computed(() => {
  const desc = sourceDescription.value;
  if (!desc) return "";
  return t("MyClient.transferUpload.descriptionSummary", [
    desc.descrHtml.length,
    desc.screenshots.length,
    desc.mediaInfo ? t("MyClient.transferUpload.withMediaInfo") : t("MyClient.transferUpload.withoutMediaInfo"),
  ]);
});

/**
 * 简介 HTML 的纯文本形态，给预览用。
 *
 * **刻意不用 `v-html`**：源站简介是站点侧不可信内容，而选项页能调 `chrome.*` 消息、
 * 能读全部站点 cookie，一旦这里被注入就等于把整个扩展交出去。项目里 `vue/no-v-html`
 * 是 error 级的硬约定（站内信正文也是同样的理由）。代价是预览看不到最终排版 ——
 * 排版本来也要到目标站提交完才知道，这里只需要人确认「正文 / 截图 / mediainfo 抓到了」。
 */
const descrPlain = computed(() => {
  const html = sourceDescription.value?.descrHtml ?? "";
  if (html === "") return "";
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
});

const missingRequired = computed(() => (form.value ? findEmptyRequiredFields(form.value.fields, values.value) : []));
const canSubmit = computed(
  () =>
    !!form.value &&
    !!located.value &&
    !isSubmitting.value &&
    !submitResult.value?.ok &&
    !duplicateBlocked.value &&
    missingRequired.value.length === 0,
);

/** 查重的轮次号：换目标站/关掉对话框时作废在飞的搜索，理由同 `locateSeq` */
let dupSeq = 0;

function resetState() {
  dupSeq += 1;
  located.value = null;
  locateError.value = "";
  isLocating.value = false;
  sourceDescription.value = null;
  descError.value = "";
  isLoadingDesc.value = false;
  showPreview.value = false;
  useDescription.value = true;
  targetSiteId.value = "";
  form.value = null;
  values.value = {};
  loadError.value = "";
  submitResult.value = null;
  submitError.value = "";
  isLoadingForm.value = false;
  isSubmitting.value = false;
  dupCheck.value = null;
  isCheckingDup.value = false;
  imageHostId.value = imageHostId.value || metadataStore.getEnabledImageHosts[0]?.id || "";
  imageUrlMap.value = {};
  imageErrors.value = [];
  isTransferringImages.value = false;
  imageProgress.value = { done: 0, total: 0 };
}

/** 一次「回源站把这颗种子认出来」的轮次号：换站之后旧请求回来时凭它作废，不覆盖新一轮的结论 */
let locateSeq = 0;

/**
 * 回到源站把这一颗认出来。
 *
 * 一换源站就重来（换站等于换一颗种子，旧结论不能带过去）。失败只记在界面上，不拦着人换站重试。
 */
async function locate() {
  const row = source.value;
  const seq = ++locateSeq;
  located.value = null;
  locateError.value = "";
  isLocating.value = false;
  if (!showDialog.value || !row || !sourceSiteId.value) return;

  isLocating.value = true;
  try {
    const found = await sendMessage("locateTransferSource", {
      siteId: sourceSiteId.value,
      name: row.name,
      totalSize: row.totalSize,
      infoHash: row.infoHash,
    });
    if (seq !== locateSeq) return;
    located.value = found;
    // 认出来之后立刻去抓简介：简介是提交前唯一必须人看的东西（标题分类能猜，简介不能），
    // 让它在人填分类的那几十秒里先到位，比等点「预览」再等一轮好得多
    void loadDescription();
  } catch (e) {
    if (seq !== locateSeq) return;
    locateError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === locateSeq) isLocating.value = false;
  }
}

/** 抓简介的轮次号，理由同 `locateSeq` */
let descSeq = 0;

/**
 * 去源站详情页抓简介。
 *
 * 失败只记提示、不拦着继续发：简介抓不到（源站详情页要登录、种子被删、简介区是图片）
 * 只意味着「简介得手写」，把人挡在这里没有意义。
 */
async function loadDescription() {
  const seq = ++descSeq;
  sourceDescription.value = null;
  descError.value = "";
  isLoadingDesc.value = false;
  if (!showDialog.value || !located.value || !sourceSiteId.value) return;

  isLoadingDesc.value = true;
  try {
    const desc = await sendMessage("getSourceDescription", {
      siteId: sourceSiteId.value,
      torrent: located.value,
    });
    if (seq !== descSeq) return;
    sourceDescription.value = desc;
  } catch (e) {
    if (seq !== descSeq) return;
    descError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === descSeq) isLoadingDesc.value = false;
  }
}

/**
 * 把简介里的图逐张转存到选中的图床，攒下「旧地址 → 新地址」的映射。
 *
 * 逐张发而不是一批：界面要看得见 3/12 的进度，也要能一张失败一张报错。
 * 一张失败不牵连其它 —— 转存本来就是尽力而为，几张没换成也仍然可以发布，
 * 只是那几张在目标站会裂（发布前界面上会列出来）。
 */
async function transferImages() {
  if (!imageHostId.value || sourceImages.value.length === 0) return;

  const targets = [...sourceImages.value];
  const map = { ...imageUrlMap.value };
  isTransferringImages.value = true;
  imageErrors.value = [];
  imageProgress.value = { done: 0, total: targets.length };

  try {
    for (const url of targets) {
      try {
        const item = await sendMessage("uploadImageToHost", {
          hostId: imageHostId.value,
          url,
          siteId: sourceSiteId.value,
        });
        if (item.url) map[url] = item.url;
        else if (item.error) imageErrors.value.push({ url, error: item.error });
      } catch (e) {
        imageErrors.value.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
      imageProgress.value = { done: imageProgress.value.done + 1, total: targets.length };
    }
  } finally {
    // 映射一次性写回：每张都写一次会让 `composedDescription` 白算十几遍
    imageUrlMap.value = map;
    isTransferringImages.value = false;
  }
}

/** 抓表单的轮次号，理由同 `locateSeq`：连点两个目标站时，先发的那份不能盖掉后发的 */
let formSeq = 0;
async function loadForm(siteId: string) {
  const seq = ++formSeq;
  form.value = null;
  values.value = {};
  loadError.value = "";
  submitResult.value = null;
  submitError.value = "";
  isLoadingForm.value = false;
  if (!siteId || !located.value) return;

  isLoadingForm.value = true;
  try {
    const descriptor = await sendMessage("getSiteUploadForm", siteId);
    if (seq !== formSeq) return;
    form.value = descriptor;
    lastAutoDescription = "";
    values.value = buildInitialValues(descriptor.fields, {
      title: located.value.title,
      subtitle: located.value.subTitle,
      category: located.value.category,
      // 简介可能还没抓到：先不填，等 `watch(composedDescription)` 到位后补上
      description: composedDescription.value || undefined,
    });
    lastAutoDescription = descriptionFieldName.value ? (values.value[descriptionFieldName.value] ?? "") : "";
    if (!useDescription.value) applyDescriptionToField();
  } catch (e) {
    if (seq !== formSeq) return;
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === formSeq) isLoadingForm.value = false;
  }
}

/**
 * 去目标站查重：同一 infoHash 是不是已经有人发过。
 *
 * 与抓表单**并行**发，不排在它后面 —— 两者互不依赖，串起来等于让人白等一次搜索。
 * 命中了就把提交按钮禁掉并把已有那条的链接递过去：重复发布在多数站要吃警告，
 * 而站点自己的查重只在你填完整个表单、点了提交之后才回话。
 *
 * 查不到只显示搜过什么，不说「可以放心发」（理由见 `checkTransferDuplicate` 的注释）。
 */
async function checkDuplicate(siteId: string) {
  const seq = ++dupSeq;
  dupCheck.value = null;
  isCheckingDup.value = false;
  const row = source.value;
  if (!showDialog.value || !siteId || !located.value || !row?.infoHash) return;

  isCheckingDup.value = true;
  try {
    const result = await sendMessage("checkTransferDuplicate", {
      siteId,
      // 用源站标题而不是下载器里的名字：查重是按目标站的分词搜，标题里的版本/中字标记
      // 才是两站共有的那部分；下载器里的名字可能被客户端截过
      name: located.value.title || row.name,
      totalSize: located.value.size ?? row.totalSize,
      infoHash: row.infoHash,
    });
    if (seq !== dupSeq) return;
    dupCheck.value = result;
  } catch (e) {
    if (seq !== dupSeq) return;
    // 查重本身失败不拦人：查不动不等于重复
    dupCheck.value = {
      duplicated: false,
      note: t("MyClient.transferUpload.duplicateFailed", [e instanceof Error ? e.message : String(e)]),
    };
  } finally {
    if (seq === dupSeq) isCheckingDup.value = false;
  }
}

/**
 * 换源站：认出来的那一颗、目标站表单、已填的值全都失效。
 * 刻意走 `@change` 而不是 `watch(sourceSiteId)`：打开对话框那一步也要「设站点 + 定位」，
 * 用 watch 的话那次赋值与这里的显式调用会各跑一遍，源站就被搜两轮。
 */
function onSourceSiteChange() {
  resetState();
  void locate();
}

/** 上一次自动填进简介格的值，用来判断「这一格还是我填的」还是「人已经改过了」 */
let lastAutoDescription = "";

/**
 * 把（或不把）简介填进目标站的简介格。
 *
 * 只在「格子是空的」或「格子还是上次自动填的那份」时写入：简介可能比表单晚到
 * （详情页比上传页慢），那时人可能已经手写了几句，直接盖掉就是吃掉人家的输入。
 */
function applyDescriptionToField() {
  const name = descriptionFieldName.value;
  if (!name) return;

  const current = values.value[name] ?? "";
  if (current !== "" && current !== lastAutoDescription) return;

  const next = useDescription.value ? composedDescription.value : "";
  values.value[name] = next;
  lastAutoDescription = next;
}

watch(targetSiteId, (siteId) => {
  // 换站等于换一整套字段，旧值不能带过去（cat 的 value 是站点私有的数字）
  void loadForm(siteId);
  void checkDuplicate(siteId);
});

// 简介晚于表单到位、或人切换了「使用源站简介」，都要把这一个格子重新对齐一次
watch([useDescription, composedDescription], applyDescriptionToField);

watch(showDialog, (open) => {
  if (!open) {
    resetState();
    sourceSiteId.value = "";
    return;
  }
  resetState();
  // 先把 tracker 换成站点：认不出来就留空，让人自己选（认不出的形状真实存在，见 trackerHost.ts）
  sourceSiteId.value = source.value
    ? (resolveTrackerHostSite(source.value.tracker, Object.entries(metadataStore.siteHostMap)) ?? "")
    : "";
  void locate();
});

async function submit() {
  if (!form.value || !located.value) return;

  isSubmitting.value = true;
  submitError.value = "";
  submitResult.value = null;
  try {
    submitResult.value = await sendMessage("submitTransferUpload", {
      siteId: form.value.siteId,
      torrent: located.value,
      values: values.value,
      keepSourceTag: keepSourceTag.value,
    });
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.transferUpload.title')"
    :width="720"
    :mask-closable="false"
  >
    <a-alert
      v-if="torrents.length > 1"
      type="info"
      show-icon
      class="source-block"
      :message="t('MyClient.transferUpload.singleOnly')"
    />

    <!-- 用 :items 而不是 a-descriptions-item 子组件：Steps / List 那两个都是「注册了名字但
         默认插槽被静默丢掉」，同一套注册表里不冒这个险（AGENTS §3.4） -->
    <a-descriptions :column="1" size="small" bordered class="source-block" :items="sourceItems" />

    <a-form layout="vertical" class="target-form">
      <a-form-item :label="t('MyClient.transferUpload.sourceSite')" required>
        <a-select
          v-model:value="sourceSiteId"
          :options="siteOptions"
          show-search
          option-filter-prop="label"
          :placeholder="t('MyClient.transferUpload.sourceSitePlaceholder')"
          :not-found-content="t('MyClient.transferUpload.noSite')"
          @change="onSourceSiteChange"
        />
      </a-form-item>

      <a-form-item :label="t('MyClient.transferUpload.targetSite')" required>
        <a-select
          v-model:value="targetSiteId"
          :options="targetSiteOptions"
          :disabled="!located"
          show-search
          option-filter-prop="label"
          :placeholder="t('MyClient.transferUpload.targetSitePlaceholder')"
          :not-found-content="t('MyClient.transferUpload.noTargetSite')"
        />
      </a-form-item>
    </a-form>

    <a-spin v-if="isCheckingDup" :tip="t('MyClient.transferUpload.checkingDuplicate')" />

    <a-alert
      v-else-if="dupCheck"
      :type="duplicateBlocked ? 'error' : 'info'"
      show-icon
      class="form-warning"
      :message="dupMessage"
    >
      <template v-if="duplicateBlocked" #description>
        <div v-if="dupCheck.title">{{ t("MyClient.transferUpload.duplicateFoundHint", [dupCheck.title]) }}</div>
        <div v-if="dupCheck.url" class="dup-link">
          <LinkOutlined />
          <a :href="dupCheck.url" target="_blank" rel="noreferrer">{{ dupCheck.url }}</a>
        </div>
      </template>
    </a-alert>

    <a-spin v-if="isLocating" :tip="t('MyClient.transferUpload.locating')" />

    <a-alert
      v-else-if="locateError"
      type="error"
      show-icon
      class="form-warning"
      :message="t('MyClient.transferUpload.locateFailed')"
      :description="locateError"
    />

    <a-spin v-if="isLoadingDesc" :tip="t('MyClient.transferUpload.loadingDescription')" />

    <div v-else-if="sourceDescription" class="desc-block">
      <div class="desc-head">
        <FileTextOutlined />
        <span class="desc-title">{{ t("MyClient.transferUpload.description") }}</span>
        <span class="desc-summary">{{ descriptionSummary }}</span>
        <a-button size="small" type="link" @click="showPreview = !showPreview">
          {{ showPreview ? t("MyClient.transferUpload.hidePreview") : t("MyClient.transferUpload.showPreview") }}
        </a-button>
      </div>

      <a-checkbox v-model:checked="useDescription" :disabled="!descriptionFieldName">
        {{ t("MyClient.transferUpload.useDescription") }}
      </a-checkbox>

      <div v-if="form && !descriptionFieldName" class="desc-hint">
        {{ t("MyClient.transferUpload.noDescriptionField") }}
      </div>

      <!-- 图床转存：源站图片有防盗链，直接引用到目标站会裂图 -->
      <div class="desc-host">
        <a-select
          v-model:value="imageHostId"
          :options="imageHostOptions"
          size="small"
          class="desc-host-select"
          allow-clear
          :placeholder="t('MyClient.transferUpload.imageHostPlaceholder')"
          :not-found-content="t('MyClient.transferUpload.noImageHost')"
        />
        <a-button
          size="small"
          :loading="isTransferringImages"
          :disabled="!imageHostId || sourceImages.length === 0"
          @click="transferImages"
        >
          {{
            isTransferringImages
              ? t("MyClient.transferUpload.transferring", [imageProgress.done, imageProgress.total])
              : t("MyClient.transferUpload.transferImages", [sourceImages.length])
          }}
        </a-button>
        <span class="desc-host-hint">{{ imageTransferHint }}</span>
      </div>

      <div v-for="(item, index) in imageErrors" :key="index" class="desc-host-error">
        {{ item.url }} — {{ item.error }}
      </div>

      <a-alert
        v-for="(warning, index) in sourceDescription.warnings"
        :key="index"
        type="warning"
        show-icon
        class="form-warning"
        :message="warning"
      />

      <template v-if="showPreview">
        <a-alert
          type="info"
          show-icon
          class="form-warning"
          :message="t('MyClient.transferUpload.previewHint')"
        />

        <div v-if="descrPlain" class="desc-preview">
          <div class="desc-preview-label">{{ t("MyClient.transferUpload.description") }}</div>
          <pre class="desc-preview-body">{{ descrPlain }}</pre>
        </div>

        <div v-if="sourceDescription.screenshots.length > 0" class="desc-preview">
          <div class="desc-preview-label">IMG · {{ sourceDescription.screenshots.length }}</div>
          <ul class="desc-shot-list">
            <li v-for="url in sourceDescription.screenshots" :key="url">
              <a :href="url" target="_blank" rel="noreferrer">{{ url }}</a>
            </li>
          </ul>
        </div>

        <div v-if="sourceDescription.mediaInfo" class="desc-preview">
          <div class="desc-preview-label">mediainfo</div>
          <pre class="desc-preview-body">{{ sourceDescription.mediaInfo }}</pre>
        </div>
      </template>
    </div>

    <a-alert
      v-else-if="descError"
      type="error"
      show-icon
      class="form-warning"
      :message="t('MyClient.transferUpload.descriptionFailed')"
      :description="descError"
    />

    <a-spin v-if="isLoadingForm" :tip="t('MyClient.transferUpload.loadingForm')" />

    <a-alert
      v-else-if="loadError"
      type="error"
      show-icon
      class="form-warning"
      :message="t('MyClient.transferUpload.loadFormFailed')"
      :description="loadError"
    />

    <template v-else-if="form">
      <a-alert
        v-for="(warning, index) in form.warnings"
        :key="index"
        type="warning"
        show-icon
        class="form-warning"
        :message="warning"
      />

      <a-form layout="vertical" class="upload-fields">
        <a-form-item
          v-for="field in visibleFields"
          :key="field.name"
          :label="field.label"
          :required="field.required"
        >
          <a-select
            v-if="field.kind === 'select'"
            v-model:value="values[field.name]"
            :options="(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))"
            show-search
            option-filter-prop="label"
          />
          <a-radio-group
            v-else-if="field.kind === 'radio'"
            v-model:value="values[field.name]"
            :options="(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))"
          />
          <a-checkbox
            v-else-if="field.kind === 'checkbox'"
            :checked="values[field.name] === '1'"
            @change="(e: { target: { checked: boolean } }) => (values[field.name] = e.target.checked ? '1' : '')"
          >
            {{ field.label }}
          </a-checkbox>
          <a-textarea
            v-else-if="field.kind === 'textarea'"
            v-model:value="values[field.name]"
            :auto-size="{ minRows: 4, maxRows: 12 }"
          />
          <a-input v-else v-model:value="values[field.name]" />
        </a-form-item>
      </a-form>

      <a-checkbox v-model:checked="keepSourceTag" class="keep-source">
        {{ t("MyClient.transferUpload.keepSourceTag") }}
      </a-checkbox>

      <a-alert
        v-if="missingRequired.length > 0"
        type="warning"
        show-icon
        class="form-warning"
        :message="t('MyClient.transferUpload.missingRequired', [missingRequired.join('、')])"
      />
    </template>

    <a-alert
      v-if="submitError"
      type="error"
      show-icon
      class="form-warning"
      :message="t('MyClient.transferUpload.submitFailed')"
      :description="submitError"
    />

    <template v-if="submitResult">
      <a-alert
        :type="submitResult.ok ? 'success' : 'error'"
        show-icon
        class="form-warning"
        :message="submitResult.message"
      />
      <div v-if="submitResult.url" class="result-link">
        <LinkOutlined />
        <a :href="submitResult.url" target="_blank" rel="noreferrer">{{ submitResult.url }}</a>
      </div>
      <pre v-if="submitResult.detail" class="result-detail">{{ submitResult.detail }}</pre>
    </template>

    <template #footer>
      <a-button @click="() => (showDialog = false)">
        {{ t("MyClient.transferUpload.cancel") }}
      </a-button>
      <a-button type="primary" :loading="isSubmitting" :disabled="!canSubmit" @click="submit">
        <template #icon><UploadOutlined /></template>
        {{ t("MyClient.transferUpload.submit") }}
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.source-block {
  margin-bottom: 16px;
}

.target-form {
  margin-bottom: 8px;
}

.upload-fields {
  max-height: 46vh;
  overflow-y: auto;
  padding-right: 4px;
}

.form-warning {
  margin-bottom: 8px;
}

.keep-source {
  margin-bottom: 12px;
}

.desc-block {
  margin-bottom: 16px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
}

.desc-head {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}

.desc-title {
  font-weight: 600;
}

.desc-summary {
  flex: 1;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.desc-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.desc-host {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
  flex-wrap: wrap;
}

.desc-host-select {
  width: 180px;
}

.desc-host-hint {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.desc-host-error {
  margin-top: 4px;
  font-size: 12px;
  color: #ff4d4f;
  word-break: break-all;
}

.desc-preview {
  margin-top: 8px;
}

.desc-preview-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.desc-preview-body {
  max-height: 140px;
  overflow: auto;
  padding: 8px;
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--color-fill-quaternary);
  border-radius: 4px;
}

.desc-shot-list {
  max-height: 120px;
  overflow: auto;
  padding-left: 18px;
  margin: 0;
  font-size: 12px;
  word-break: break-all;
}

.result-link {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
  word-break: break-all;
}

.dup-link {
  display: flex;
  gap: 6px;
  align-items: center;
  word-break: break-all;
}

.result-detail {
  max-height: 180px;
  overflow: auto;
  padding: 8px;
  font-size: 12px;
  white-space: pre-wrap;
  background: var(--color-fill-quaternary);
  border-radius: 4px;
}
</style>
