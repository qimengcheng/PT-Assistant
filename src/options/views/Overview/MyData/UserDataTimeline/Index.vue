<script setup lang="ts">
import { saveAs } from "file-saver";
import { computed, nextTick, onMounted, reactive, ref, shallowRef, useTemplateRef, watch } from "vue";
import Konva from "konva";
// konva 组件按需局部导入（勿在 main.ts 全局 use(VueKonva)：
// 那会把 ~几百 KB 的 konva 卷进 options 主包，每个设置页都背上它）。
// 模板里的 kebab 标签 vk-stage 等会自动解析到这些 PascalCase 绑定。
import {
  Group as VkGroup,
  Image as VkImage,
  Layer as VkLayer,
  Line as VkLine,
  Rect as VkRect,
  Stage as VkStage,
  Text as VkText,
} from "vue-konva";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useElementSize } from "@vueuse/core";
import {
  ArrowLeftOutlined,
  DisconnectOutlined,
  ExportOutlined,
  HistoryOutlined,
  LockOutlined,
  SaveOutlined,
  StopOutlined,
  UndoOutlined,
  UnlockOutlined,
} from "@antdv-next/icons";

import { formatDate, formatTimeAgo } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { defaultTimelineBackgroundColor, useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import CheckSwitchButton from "@/options/components/CheckSwitchButton.vue";

import {
  canThisSiteShow,
  timelineDataRef,
  selectedSites,
  topSiteRenderAttr,
  CTimelineUserInfoField,
  image,
  text,
  divider,
  icon,
  type ITimelineUserInfoField,
  type TKonvaConfig,
  fixedLastUserInfo,
  loadFullData,
} from "./utils.ts";
import { allAddedSiteMetadata, loadAllAddedSiteMetadata } from "../utils/siteMetadata.ts";

const ext_version = __EXT_VERSION__;

// 文件名与 MyData/Index.vue 等同名，显式命名避免 KeepAlive/devtools 里全是 "Index"
defineOptions({ name: "UserDataTimeline" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const control = configStore.userDataTimelineControl;

const isLoading = ref<boolean>(false);
const { ref: timelineData, reset: resetTimelineData } = timelineDataRef;
const allowEdit = reactive({ name: false, title: false }); // 是否允许编辑用户名、时间轴标题

function resetTimelineDataWithControl() {
  // 开始生成 timeline 的数据
  resetTimelineData();

  // 将 control 中的 name 和 timelineTitle 覆盖掉自动生成的
  if (configStore.userName == "") {
    configStore.userName = configStore.getUserNames.perfName;
  }

  if (control.title !== "") {
    timelineData.value.title = control.title;
  }
}

type KonvaNode = { getNode: () => any; getStage: () => any };

const { width: containerWidth } = useElementSize(useTemplateRef("canvasContainer"));
const canvasStage = useTemplateRef<KonvaNode>("canvasStage");
const canvasLayer = useTemplateRef<KonvaNode>("canvasLayer");

const realAllSite = shallowRef<string[]>([]);

// 动态计算 canvas 的各类属性
const canvasWidth = 650; // 650px 是设计稿的宽度，下面各类宽高均根据设计稿进行调整，然后使用 scale 来控制缩放
const nameInfoHeight = 70;
const topAndTotalInfoHeight = computed<number>(() => 10 + (realShowField.value.length + 2) * 30);
const perSiteHeight = computed<number>(
  () => (control.showPerSiteField.siteName ? 24 : 20) + (realShowField.value.length + 1) * 20 + 20,
);
const siteTimeHeight = computed<number>(() =>
  control.showTimeline ? 95 + perSiteHeight.value * selectedSites.value.length : 0,
);
const canvasHeight = computed<number>(() => nameInfoHeight + topAndTotalInfoHeight.value + siteTimeHeight.value + 25);

const scale = computed(() => Math.min(containerWidth.value, canvasWidth) / canvasWidth); // 按照 650 来绘图，然后缩放显示
const stageConfig = computed(() => {
  return {
    width: canvasWidth,
    height: canvasHeight.value,
    scaleX: scale.value,
    scaleY: scale.value,
  };
});

// 绘制相关辅助函数
const favicon = (config: TKonvaConfig) => {
  const imageBaseSize = config.size ?? 24;
  const imageFilters: any[] = [`blur(${control.faviconBlue}px)`];

  const siteConfig = allAddedSiteMetadata[config.site];

  let imageElement: HTMLImageElement | OffscreenCanvas = siteConfig.faviconElement;

  if (siteConfig.isDead) {
    imageFilters.push("grayscale(1)");
  }

  // 如果设置中传入了 canvas 这个自定义参数，我们为这个 favicon 生成一个带有背景的 canvas，
  // 然后在 canvas 上居中绘制 favicon
  if (config.canvas) {
    const { width: canvasWidth = imageBaseSize, height: canvasHeight = imageBaseSize } = config.canvas;
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

    // 填充背景
    ctx.fillStyle = config.canvas.fillStyle ?? "#fff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 计算缩放比例和位置，并将 favicon 居中填充
    const x = (canvasWidth - imageBaseSize) / 2;
    const y = (canvasHeight - imageBaseSize) / 2;
    ctx.drawImage(imageElement, x, y, imageBaseSize, imageBaseSize);

    // 防止辅助函数 image() 又一次设置 scaleX 和 scaleY
    config.scaleX = 1;
    config.scaleY = 1;

    // 将 imageElement 重写为我们的 canvas
    imageElement = canvas;
  }

  return image({
    image: imageElement,
    filters: imageFilters,
    ...config,
  });
};

const siteFaviconClipFunc =
  (radius: number = 24, position: [number, number] = [stageConfig.value.width / 2, 0]) =>
  (ctx: any) => {
    ctx.beginPath();
    ctx.arc(position[0], position[1], radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.stroke();
    ctx.fill();
  };

const siteInfo = computed(() => timelineData.value.siteInfo.filter((x) => selectedSites.value.includes(x.site)));
const realShowField = computed(() => {
  const showField: ITimelineUserInfoField[] = [];
  for (const key of CTimelineUserInfoField) {
    if (control.showField[key.name]) {
      showField.push(key);
    }
  }
  return showField;
});

const formatSiteDate = (siteDate: number) =>
  computed(() => {
    if (control.dateFormat === "time_added") {
      return formatDate(siteDate, "yyyy-MM-dd");
    } else {
      return formatTimeAgo(siteDate);
    }
  });

/**
 * konva 的 filter（模糊/灰度）必须先 cache 才生效。
 * 节点由模板声明式重建，这里不维护 ref 列表，直接遍历 stage 里的 Image 节点。
 */
function updateBlue() {
  const stage = canvasStage.value?.getStage();
  if (!stage) return;

  Konva.autoDrawEnabled = false;
  for (const node of stage.find("Image")) {
    node.cache();
  }
  canvasLayer.value?.getNode()?.batchDraw();
  Konva.autoDrawEnabled = true;
}

// 拖拽滑块时 v-model 逐值更新 → 节点带新 filter 重渲染，等渲染完再统一刷缓存
watch(
  () => control.faviconBlue,
  () => nextTick(updateBlue),
);

const showFieldToggles = computed(() =>
  Object.entries(control.showField).map(([key, value]) => ({ key, value })),
);
const showPerSiteFieldToggles = computed(() =>
  Object.entries(control.showPerSiteField).map(([key, value]) => ({ key, value })),
);

function setShowField(key: string, checked: boolean) {
  (control.showField as Record<string, boolean>)[key] = checked;
}

function setShowPerSiteField(key: string, checked: boolean) {
  (control.showPerSiteField as Record<string, boolean>)[key] = checked;
}

const userNameOptions = computed(() =>
  Object.keys(configStore.getUserNames.names).map((name) => ({ value: name })),
);

onMounted(async () => {
  isLoading.value = true;

  try {
    // 加载所有站点的元数据
    await loadAllAddedSiteMetadata(Object.keys(metadataStore.sites));

    // 加载 fixedLastUserInfo
    fixedLastUserInfo.value = await loadFullData();

    realAllSite.value = Object.keys(fixedLastUserInfo.value).filter((x) => canThisSiteShow(x));

    const sitesParam = Array.isArray(route.query.sites)
      ? route.query.sites.map(String)
      : route.query.sites
        ? [String(route.query.sites)]
        : [];

    // 勾选站点，优先使用 route 参数，其次是上次保存的配置，最后是全部站点
    if (sitesParam.length > 0) {
      selectedSites.value = sitesParam;
    } else if ((configStore.userDataTimelineControl.selectedSites ?? []).length > 0) {
      selectedSites.value = [...configStore.userDataTimelineControl.selectedSites];
    } else {
      selectedSites.value = realAllSite.value;
    }

    // 开始生成 timeline 的数据
    resetTimelineDataWithControl();
  } catch (e) {
    console.error("UserDataTimeline: 数据加载失败", e);
    useRuntimeStore().showSnakebar(t("UserDataTimeline.loadDataFailed"), { color: "error" });
  } finally {
    isLoading.value = false;
  }
});

function exportTimelineImg() {
  const stage = canvasStage.value?.getStage();
  if (!stage) return;

  stage.toDataURL({
    mimeType: "image/png",
    pixelRatio: 3,
    callback: (dataUrl: string) => {
      saveAs(
        dataUrl,
        t("UserDataTimeline.exportFilename", {
          name: configStore.getUserName,
          date: formatDate(timelineData.value.createAt),
        }) + ".png",
      );
    },
  });
}

function saveControl() {
  configStore.userDataTimelineControl.selectedSites = selectedSites.value;
  configStore.$save();
  useRuntimeStore().showSnakebar(t("common.saveSuccess"), { color: "success" });
}
</script>

<template>
  <a-card variant="outlined">
    <div class="timeline-layout">
      <div
        ref="canvasContainer"
        class="timeline-canvas"
        :style="{
          maxWidth: `${canvasWidth}px`,
          height: `${stageConfig.height * scale}px`,
        }"
      >
        <a-skeleton v-if="isLoading" active :paragraph="{ rows: 10 }" />

        <!-- 使用 konva 来绘制 UserDataTimeLine -->
        <vk-stage v-else ref="canvasStage" :config="stageConfig">
          <vk-layer ref="canvasLayer">
            <!-- 1. 添加背景颜色，并填满整个画布 -->
            <vk-rect
              :config="{
                fill: control.backgroundColor,
                x: 0,
                y: 0,
                width: stageConfig.width,
                height: stageConfig.height,
              }"
            />

            <!-- 2. 绘制顶端概况 -->
            <vk-group :config="{ x: 0, y: 0 }">
              <!-- 2.1 用户图标 -->
              <vk-text :config="icon({ x: 20, y: 20, text: '󰀉' /* account-circle */ })" />
              <!-- 2.2 用户名 -->
              <vk-text :config="text({ x: 65, y: 26, text: configStore.userName, fontSize: 26 })" />
              <!-- 2.3 创建时间 -->
              <vk-text
                :config="
                  text({
                    y: 20,
                    text: formatDate(timelineData.createAt),
                    fontSize: 12,
                    fill: '#9E9E9E',
                    width: stageConfig.width - 20,
                    align: 'right',
                  })
                "
              />
            </vk-group>

            <!-- 3. 绘制基础信息 -->
            <vk-group :config="{ x: 20, y: nameInfoHeight }">
              <!-- 3.1 左侧 totalInfo -->
              <vk-group :config="{ x: 0, y: 0 }">
                <vk-text
                  :config="
                    text({
                      y: 0,
                      text: `${t('UserDataTimeline.total')}${t('UserDataTimeline.field.site')}: ${timelineData.totalInfo.sites}`,
                    })
                  "
                />
                <vk-text
                  v-if="timelineData.totalInfo.deadSites > 0"
                  :config="
                    text({
                      x: 160,
                      y: 0,
                      text: `󰖛: ${timelineData.totalInfo.deadSites}`,
                      fontFamily: 'Material Design Icons For PTD',
                      fill: '#9E9E9E',
                    })
                  "
                />
              </vk-group>
              <vk-text
                v-for="(key, index) in realShowField"
                :key="key.name"
                :config="
                  text({
                    y: 30 * (index + 1),
                    text: `${t('UserDataTimeline.total')}${t('UserDataTimeline.field.' + key.name)}: ${key.format(timelineData.totalInfo[key.name])}`,
                  })
                "
              />
              <vk-text
                :config="
                  text({
                    y: 30 * (realShowField.length + 1),
                    text: t('UserDataTimeline.ptAge', { years: timelineData.joinTimeInfo.years }),
                  })
                "
              />

              <!-- 3.2 中间分隔线、右侧冠军及亚军站点 -->
              <vk-group v-if="control.showTop" :config="{ x: 280, y: 0 }">
                <!-- 3.2.1 中间分隔线 -->
                <vk-line :config="divider({ points: [0, 5, 0, topAndTotalInfoHeight - 15] })" />
                <!-- 3.2.2 右侧冠军及亚军站点 -->
                <template v-for="(type, index) in topSiteRenderAttr" :key="type.iconFill">
                  <vk-group :config="{ x: 20 + index * 170, y: 0 }">
                    <vk-text :config="icon({ y: 0, fill: type.iconFill, fontSize: 24, text: `󰔸` /* trophy */ })" />
                    <template v-for="(key, index) in realShowField" :key="key.name">
                      <vk-group
                        v-if="timelineData.topInfo[key.name][type.valueKey] > 0"
                        :config="{ x: 0, y: 30 * (index + 1) }"
                      >
                        <vk-image
                          :ref="(el: any) => el?.getNode()?.cache() /* 挂载即 cache，filter 才生效 */"
                          :config="
                            favicon({
                              site: timelineData.topInfo[key.name][type.siteKey].site,
                              size: 20,
                              canvas: { fillStyle: control.backgroundColor },
                            })
                          "
                        />
                        <vk-text
                          v-if="timelineData.topInfo[key.name][type.valueKey] > 0"
                          :config="text({ x: 30, text: key.format(timelineData.topInfo[key.name][type.valueKey]) })"
                        />
                      </vk-group>
                    </template>
                  </vk-group>
                </template>
              </vk-group>
            </vk-group>

            <!-- 4. 绘制站点信息 -->
            <vk-group v-if="control.showTimeline" :config="{ x: 0, y: nameInfoHeight + topAndTotalInfoHeight }">
              <!-- 4.1 分割线 -->
              <vk-line :config="divider({ points: [20, 0, 630, 0] })" />
              <!-- 4.2 提示词 -->
              <vk-text
                :config="
                  text({
                    y: 15,
                    text: `... ${timelineData.title} ...`,
                    align: 'center',
                    fontStyle: 'bold',
                    width: stageConfig.width,
                  })
                "
              />

              <!-- 4.3 站点信息 -->
              <vk-group :config="{ x: 0, y: 40 }">
                <!-- 4.3.1 分割线 -->
                <vk-line
                  :config="
                    divider({
                      x: stageConfig.width / 2,
                      y: 0,
                      points: [0, 10, 0, selectedSites.length * perSiteHeight + 10],
                    })
                  "
                />
                <!-- 4.3.2 不同站点的信息 -->
                <template v-for="(userInfo, index) in siteInfo" :key="userInfo.site">
                  <vk-group :config="{ x: 0, y: index * perSiteHeight }">
                    <!-- 首先画出 favicon 并 clip -->
                    <vk-group :config="{ y: perSiteHeight / 2, clipFunc: siteFaviconClipFunc(24) }">
                      <vk-image
                        :ref="(el: any) => el?.getNode()?.cache()"
                        :config="
                          favicon({
                            site: userInfo.site,
                            size: 38,
                            x: stageConfig.width / 2 - 24,
                            y: 0 - 24,
                            canvas: { width: 48, height: 48 },
                          })
                        "
                      />
                    </vk-group>

                    <!-- 站点数据（上传下载等） -->
                    <vk-group
                      :config="{
                        x: index % 2 == 0 ? 30 : stageConfig.width / 2 + 60,
                        y: perSiteHeight / 2 - 10 - realShowField.length * 10,
                      }"
                    >
                      <vk-text
                        v-if="control.showPerSiteField.siteName"
                        :config="
                          text({
                            y: 0,
                            text: `${allAddedSiteMetadata[userInfo.site]?.isDead ? '󰖛' : ''}${allAddedSiteMetadata[userInfo.site].siteName}`,
                            fill: allAddedSiteMetadata[userInfo.site]?.isDead ? '#9E9E9E' : '#fff',
                            fontFamily: allAddedSiteMetadata[userInfo.site]?.isDead
                              ? 'Material Design Icons For PTD'
                              : undefined,
                            fontStyle: 'bold',
                          })
                        "
                      />
                      <vk-group
                        :config="{
                          x: 0,
                          y: control.showPerSiteField.siteName ? 10 : 0,
                        }"
                      >
                        <vk-text
                          v-for="(key, index) in realShowField"
                          :key="key.name"
                          :config="
                            text({
                              y: 20 * (index + 1),
                              text: `${t('UserDataTimeline.field.' + key.name)}: ${key.format(userInfo[key.name] ?? 0)}`,
                              fontSize: 16,
                            })
                          "
                        />
                        <vk-line
                          v-if="
                            index != siteInfo.length - 1 &&
                            (control.showPerSiteField.siteName || realShowField.length > 0)
                          "
                          :config="
                            divider({
                              points: [
                                0,
                                (realShowField.length + 1.5) * 20,
                                stageConfig.width / 2 - 80,
                                (realShowField.length + 1.5) * 20,
                              ],
                            })
                          "
                        />
                      </vk-group>
                    </vk-group>

                    <!-- 站点数据（用户名、用户等级、用户UID等） -->
                    <vk-group
                      :config="{ x: index % 2 == 0 ? stageConfig.width / 2 + 60 : 30, y: perSiteHeight / 2 - 20 }"
                    >
                      <vk-text
                        :config="text({ y: 0, text: `${formatSiteDate(userInfo.joinTime!).value}`, fontStyle: 'bold' })"
                      />
                      <vk-text
                        :config="
                          text({
                            y: 28,
                            width: stageConfig.width / 2 - 80,
                            wrap: 'char',
                            lineHeight: 1.25,
                            text: [
                              control.showPerSiteField.name ? userInfo.name! : '',
                              control.showPerSiteField.level ? `<${userInfo.levelName!}>` : '',
                              control.showPerSiteField.uid && userInfo.id && userInfo.id !== '0' && userInfo.id !== 0
                                ? `<${userInfo.id}>`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' '),
                            fontSize: 16,
                          })
                        "
                      ></vk-text>
                    </vk-group>
                  </vk-group>
                </template>
              </vk-group>
            </vk-group>

            <!-- 5. 构建信息 -->
            <vk-group :config="{ x: 0, y: nameInfoHeight + topAndTotalInfoHeight + siteTimeHeight }">
              <vk-line :config="divider({ points: [20, -10, 630, -10] })" />
              <vk-text
                :config="
                  text({
                    width: stageConfig.width - 20,
                    align: 'right',
                    text: 'Created By PT-Depiler (' + ext_version + ') at ' + formatDate(timelineData.createAt),
                    fontSize: 12,
                    fill: '#b5b5b5',
                  })
                "
              />
            </vk-group>
          </vk-layer>
        </vk-stage>
      </div>

      <div class="timeline-control">
        <div class="d-flex align-center mb-2">
          <a-button @click="() => router.back()"><template #icon><ArrowLeftOutlined /></template><span>{{ t('common.back') }}</span></a-button>
          <div class="flex-1-1-0" />
          <a-button @click="exportTimelineImg"><template #icon><ExportOutlined /></template><span>{{ t('common.exportImage') }}</span></a-button>
          <a-button type="primary" class="ml-2" @click="saveControl"><template #icon><SaveOutlined /></template><span>{{ t('common.saveSettings') }}</span></a-button>
        </div>

        <a-alert type="info" :title="t('UserDataTimeline.controls.styleSettings')" class="mb-2" />

        <div class="timeline-section-label">{{ t("UserDataTimeline.controls.usernameAndTitle") }}</div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("common.username") }}</span>
          <div class="user-statistic-field-control d-flex align-center">
            <a-button type="text" size="small" @click="allowEdit.name = !allowEdit.name">
              <template #icon>
                <UnlockOutlined v-if="allowEdit.name" class="text-green" />
                <LockOutlined v-else />
              </template>
            </a-button>
            <!-- AutoComplete 没有 `readonly` prop：不声明的属性会被透传到根 <div readonly>（SSR 实测），
                   压根没到内部 input，锁定状态下照样能打字。用 `disabled`。 -->
            <a-auto-complete
              v-model:value="configStore.userName"
              :options="userNameOptions"
              :disabled="!allowEdit.name"
              class="flex-1-1-0"
            />
            <a-button
              type="text"
              size="small"
              :title="configStore.getUserNames.perfName"
              @click="configStore.userName = configStore.getUserNames.perfName"
            >
              <template #icon>
                <HistoryOutlined />
              </template>
            </a-button>
          </div>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataTimeline.controls.timelineTitle") }}</span>
          <div class="user-statistic-field-control d-flex align-center">
            <a-button type="text" size="small" @click="allowEdit.title = !allowEdit.title">
              <template #icon>
                <UnlockOutlined v-if="allowEdit.title" class="text-green" />
                <LockOutlined v-else />
              </template>
            </a-button>
            <a-input
              :value="timelineData.title"
              :disabled="!control.showTimeline"
              :readonly="!allowEdit.title"
              class="flex-1-1-0"
              @change="(e: any) => ((timelineData.title = e.target.value), (control.title = e.target.value))"
            />
            <a-button
              type="text"
              size="small"
              @click="
                () => {
                  control.title = '';
                  resetTimelineDataWithControl();
                }
              "
            >
              <template #icon>
                <UndoOutlined />
              </template>
            </a-button>
          </div>
        </div>

        <div class="timeline-section-label">{{ t("UserDataTimeline.controls.components") }}</div>

        <div class="timeline-switch-row">
          <a-checkbox v-model:checked="control.showTop">
            {{ t("UserDataTimeline.controls.showTopSites") }}
          </a-checkbox>
          <a-checkbox v-model:checked="control.showTimeline">
            {{ t("UserDataTimeline.controls.showTimeline") }}
          </a-checkbox>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataTimeline.controls.customBgColor") }}</span>
          <div class="user-statistic-field-control d-flex align-center">
            <input
              type="color"
              class="timeline-color-input"
              :value="control.backgroundColor"
              @input="(e) => (control.backgroundColor = (e.target as HTMLInputElement).value)"
            />
            <a-input
              size="small"
              :value="control.backgroundColor"
              class="flex-1-1-0 ml-1"
              @change="(e: any) => (control.backgroundColor = e.target.value)"
            />
            <a-button type="text" size="small" :title="defaultTimelineBackgroundColor" class="ml-1" @click="control.backgroundColor = defaultTimelineBackgroundColor">
              <template #icon>
                <UndoOutlined />
              </template>
            </a-button>
          </div>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataTimeline.controls.faviconBlur") }}</span>
          <div class="user-statistic-field-control d-flex align-center">
            <a-slider
              v-model:value="control.faviconBlue"
              :min="0"
              :max="8"
              :step="1"
              class="flex-1-1-0"
            />
            <span class="timeline-slider-value">{{ control.faviconBlue }}</span>
          </div>
        </div>

        <div class="timeline-section-label">{{ t("UserDataTimeline.controls.displayContent") }}</div>

        <div class="timeline-sub-label">{{ t("UserDataTimeline.controls.statsSection") }}</div>
        <div class="timeline-field-grid">
          <a-checkbox
            v-for="toggle in showFieldToggles"
            :key="toggle.key"
            :checked="toggle.value"
            @update:checked="(checked: boolean) => setShowField(toggle.key, checked)"
          >
            {{ t(`UserDataTimeline.field.${toggle.key}`) }}
          </a-checkbox>
        </div>

        <div class="timeline-sub-label">{{ t("UserDataTimeline.controls.timelineSection") }}</div>
        <div class="timeline-field-grid">
          <a-checkbox
            v-for="toggle in showPerSiteFieldToggles"
            :key="toggle.key"
            :checked="toggle.value"
            @update:checked="(checked: boolean) => setShowPerSiteField(toggle.key, checked)"
          >
            {{ t(`UserDataTimeline.field.${toggle.key}`) }}
          </a-checkbox>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataTimeline.controls.timeDisplay") }}</span>
          <div class="user-statistic-field-control">
            <a-radio-group v-model:value="control.dateFormat">
              <a-radio value="time_added">{{ t("UserDataTimeline.controls.timeAdded") }}</a-radio>
              <a-radio value="time_alive">{{ t("UserDataTimeline.controls.timeAlive") }}</a-radio>
            </a-radio-group>
          </div>
        </div>

        <div class="d-flex align-center mt-4">
          <a-alert
            type="info"
            :title="t('UserDataTimeline.controls.displaySiteSettings')"
            class="flex-1-1-0"
          />
          <CheckSwitchButton
            v-model="selectedSites"
            :all="realAllSite"
            class="ml-2"
            @update:model-value="resetTimelineDataWithControl"
          />
        </div>

        <a-checkbox-group v-model:value="selectedSites" class="timeline-site-toggles" @change="resetTimelineDataWithControl">
          <div v-for="(site, siteId) in fixedLastUserInfo" :key="siteId" class="timeline-site-toggle">
            <a-checkbox :value="siteId" :disabled="!canThisSiteShow(siteId)">
              <span class="d-inline-flex align-center">
                <SiteFavicon :site-id="siteId" :size="16" />
                <span class="ml-1">
                  <SiteName :site-id="siteId" />
                  <StopOutlined
                    v-if="allAddedSiteMetadata[siteId]?.isDead"
                    class="ml-1 text-grey"
                    :title="t('UserDataTimeline.siteIsDead')"
                  />
                  <DisconnectOutlined
                    v-else-if="allAddedSiteMetadata[siteId]?.isOffline"
                    class="ml-1 text-grey"
                    :title="t('UserDataTimeline.siteIsOffline')"
                  />
                </span>
              </span>
            </a-checkbox>
          </div>
        </a-checkbox-group>
      </div>
    </div>
  </a-card>
</template>

<style scoped lang="scss">
.timeline-layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.timeline-canvas {
  flex: 0 1 auto;
}

.timeline-control {
  flex: 1 1 320px;
  max-width: 420px;
}

.timeline-section-label {
  margin: 8px 0 4px;
  font-weight: 500;
}

.timeline-sub-label {
  margin: 4px 0;
  color: rgba(0, 0, 0, 0.45);
}

.timeline-field-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 8px;
  padding-left: 16px;
  margin-bottom: 8px;
}

.timeline-switch-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.user-statistic-field {
  display: flex;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 8px;
}

.user-statistic-field-label {
  flex: 0 0 88px;
  padding-top: 4px;
}

.user-statistic-field-control {
  flex: 1 1 auto;
  min-width: 0;
}

.timeline-color-input {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}

.timeline-slider-value {
  flex: 0 0 auto;
  min-width: 24px;
  text-align: right;
}

.timeline-site-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 0;
}

.timeline-site-toggle {
  flex: 0 0 33%;
  min-width: 140px;
}
</style>
