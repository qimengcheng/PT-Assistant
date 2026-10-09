/**
 * 所有和 ui 相关的选项均在本 store 管理
 */
import { MutationType, defineStore } from "pinia";
import { has, unset } from "es-toolkit/compat";
import { usePreferredDark } from "@vueuse/core";

import type { IConfigPiniaStorageSchema, supportThemeType } from "@/shared/types.ts";

import { useMetadataStore } from "./metadata.ts";

const deprecatedConfigKeys = [
  "myDataTableControl.tableFontSize", // v0.0.4.961 废弃
  "myDataTableControl.joinTimeWeekOnly", // 已废弃，使用 joinTimeFormat 替代
];

/**
 * v0.21.3 起「进入我的下载器自动加载」默认改为开（旧默认下进页面不点刷新就是一片空白）。
 * 存量里那个 false 是旧默认值、不是用户的选择，所以在版本号追平 0.21.3 之前纠正成 true；
 * 追平后不再干预，用户主动关掉就能关掉。version 在下面的 afterRestore 末尾追平到当前版本
 * （v0.37.7 起；原先是 ReleaseNoteDialog 关闭时写的，那个弹窗已删）。
 * （0.5.x → 0.2x 重编号时这里漏改成了 "0.5.46"，对新编号永远判不出"更旧"，故订正。）
 */
const initTorrentOnEnterDefaultOnSince = "0.21.3";

/**
 * v0.22.37 起「记住上一次使用的下载器」默认改为开：
 * 推送弹窗把下载器/保存路径改成单选列表后，「默认选中上次用的」成了主要交互，
 * 而这个开关关着时那条数据根本不会被写入，界面上就永远只停在第一项。
 * 存量里那个 false 同样是旧默认值、不是用户的选择，所以按版本号纠正一次；
 * 追平后不再干预，用户主动关掉就能关掉。
 */
const saveLastDownloaderDefaultOnSince = "0.22.37";

/**
 * v0.29.5 起「Cookie 过期自动延长」默认改为开（用户 2026-10-07 要求）。
 * 这个功能的作用是防止长期未访问导致登录态丢失 —— 关着时用户并不会因此得到任何好处，
 * 只会偶发地被踢出登录，所以默认开更合理。
 * 存量里那个 false 同样是旧默认值、不是用户的选择，按版本号纠正一次；
 * 追平后不再干预，用户主动关掉就能关掉。
 */
const autoExtendCookiesDefaultOnSince = "0.29.5";

/**
 * v0.29.6 起「自动刷新用户信息」的间隔默认从 3 小时改成 1 小时（用户 2026-10-07：
 * "默认3分钟也太短了，默认改成60分钟" —— 他读到的是界面上那个错标的"分钟"，
 * 引擎里这个数一直是按小时乘的（`interval * 60 * 60 * 1000`），所以这次同时把标签改对）。
 *
 * 数字档的纠正比布尔档多一处误伤：存量里正好填过 3 的人也会被改成 1。判据仍按先例
 * （值 == 旧默认 且 version 比这条门旧）走一次，追平后不再干预。3 小时不是任何
 * 里程碑值，误伤代价是一次重新填表，比让所有人继续吃 3 小时划算。
 */
const autoReflushIntervalDefaultOneHourSince = "0.29.6";

/** 语义化版本按 x.y.z 逐段比数值；空串/异常串按 0.0.0 处理（即"很旧"）。 */
function isOlderVersion(a: string, b: string): boolean {
  const pa = String(a ?? "")
    .replace(/^v/, "")
    .split("+")[0]
    .split(".")
    .map((x) => Number(x) || 0);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

export const defaultTimelineBackgroundColor = "#455A64";

export const useConfigStore = defineStore("config", {
  persistWebExt: {
    /**
     * 打开变更自动落盘。缺这一项时插件不会注册 $subscribe，
     * 基础设置页（SetBase 下7 个子窗口全部裸 v-model 绑定 configStore 字段、
     * 自己不调 $save）就会「改了刷新就丢」—— 页面上的「变更即时保存」提示是假的。
     *
     * 三个类型都要覆盖：v-model 绑基本类型字段是 direct，
     * 整体替换子对象（position 等）是 patchObject，$patch(fn) 是 patchFunction。
     * 必须用 MutationType 枚举：裸字符串数组会被推断成 string[]，赋给 MutationType[] 直接编译失败。
     */
    autoSaveType: [MutationType.direct, MutationType.patchObject, MutationType.patchFunction],
    afterRestore: (context) => {
      // 清理已废弃的配置项
      const state = context.store.$state as any;
      let needsSave = false;

      // 清理已废弃的配置项
      for (const key of deprecatedConfigKeys) {
        if (has(state, key)) {
          unset(state, key);
          needsSave = true;
        }
      }

      // 清理基于 id 字段的 DownloadHistory 排序配置
      if (state.tableBehavior?.DownloadHistory?.sortBy) {
        const sortBy = state.tableBehavior.DownloadHistory.sortBy;
        // 过滤掉基于 id 字段的排序项
        const filteredSortBy = sortBy.filter((sort: any) => sort.key !== "id");

        // 如果过滤后数组长度发生变化，说明移除了基于 id 的排序项
        if (filteredSortBy.length !== sortBy.length) {
          // 如果过滤后没有任何排序项，使用默认的 downloadAt 排序
          if (filteredSortBy.length === 0) {
            state.tableBehavior.DownloadHistory.sortBy = [{ key: "downloadAt", order: "desc" }];
          } else {
            // 否则保留其他有效的排序项
            state.tableBehavior.DownloadHistory.sortBy = filteredSortBy;
          }
          needsSave = true;
        }
      }

      if (
        state.download?.initDownloaderTorrentOnEnter === false &&
        isOlderVersion(state.version, initTorrentOnEnterDefaultOnSince)
      ) {
        state.download.initDownloaderTorrentOnEnter = true;
        needsSave = true;
      }

      if (
        state.download?.saveLastDownloader === false &&
        isOlderVersion(state.version, saveLastDownloaderDefaultOnSince)
      ) {
        state.download.saveLastDownloader = true;
        needsSave = true;
      }

      if (
        state.autoExtendCookies?.enabled === false &&
        isOlderVersion(state.version, autoExtendCookiesDefaultOnSince)
      ) {
        state.autoExtendCookies.enabled = true;
        needsSave = true;
      }

      if (
        state.userInfo?.autoReflush?.interval === 3 &&
        isOlderVersion(state.version, autoReflushIntervalDefaultOneHourSince)
      ) {
        state.userInfo.autoReflush.interval = 1;
        needsSave = true;
      }

      // afterTime 曾被一个 a-input-number 绑着（v0.29.6 才换成按小时选），动过就成了数字，
      // 而 alarms.ts 拿它 `split(":")` —— 抛错的是整个自动刷新任务。存量里修一次。
      if (state.userInfo?.autoReflush && typeof state.userInfo.autoReflush.afterTime !== "string") {
        state.userInfo.autoReflush.afterTime = "00:00";
        needsSave = true;
      }

      // 记下「这份配置属于哪个版本」：上面那几条版本门都读它，所以必须在它们之后才推进。
      // 这一句原先写在 ReleaseNoteDialog 的关闭回调里（那个弹窗 v0.37.7 删掉了）——
      // 不接过来的话 version 会永远停在旧值，以后每加一条 xxxDefaultOnSince 门都会一直判「版本更旧」，
      // 把用户手动改回来的值又反复盖掉。
      if (state.version !== __EXT_VERSION__) {
        state.version = __EXT_VERSION__;
        needsSave = true;
      }

      if (needsSave) {
        context.store.$save();
      }
    },
  },
  state: (): IConfigPiniaStorageSchema => ({
    version: "",
    lang: "zh_CN",
    theme: "light",
    isNavBarOpen: true,
    autoToggleNavBarOnDisplayChange: true,

    ignoreWrongPixelRatio: false,

    saveTableBehavior: true,
    enableTableMultiSort: false,

    developerMode: false,

    contextMenus: {
      enabled: true,
      allowSelectionTextSearch: true,
      allowSocialLinkSearch: true,
      allowLinkDownloadPush: true,
    },

    contentScript: {
      enabled: true,
      enabledAtSocialSite: true,
      allowExceptionSites: false,

      position: { x: 0, y: 0 },

      applyTheme: false,
      defaultOpenSpeedDial: false,
      stackedButtons: false,
      fadeEnterStyle: false,

      doubleConfirmAction: true,
      dragLinkOnSpeedDial: true,

      socialSiteSearchBy: "chosen",
    },

    tableBehavior: {
      MyData: {
        itemsPerPage: 20,
        columns: [
          "siteUserConfig.sortIndex",
          "name",
          "levelName",
          "uploaded",
          "ratio",
          "uploads",
          "seeding",
          "seedingSize",
          "bonus",
          "joinTime",
          "updateAt",
          "action",
        ],
        sortBy: [{ key: "siteUserConfig.sortIndex", order: "desc" }],
      },
      SearchEntity: {
        itemsPerPage: 50,
        columns: [
          "site",
          "title",
          "category",
          "size",
          "seeders",
          "leechers",
          "completed",
          "comments",
          "time",
          "action",
        ],
        sortBy: [{ key: "time", order: "desc" }],
      },
      DownloadHistory: {
        itemsPerPage: 10,
        sortBy: [{ key: "downloadAt", order: "desc" }],
      },
      SearchResultSnapshot: {
        itemsPerPage: 25,
        sortBy: [{ key: "createdAt", order: "desc" }],
      },
      SetDownloader: {
        itemsPerPage: 10,
        sortBy: [{ key: "enabled", order: "desc" }],
      },
      MyClient: {
        itemsPerPage: 25,
        columns: [
          "clientId",
          "name",
          "totalSize",
          "progress",
          "state",
          "ratio",
          "uploadSpeed",
          "downloadSpeed",
          "dateAdded",
          "action",
        ],
        sortBy: [{ key: "dateAdded", order: "desc" }],
      },
      SetSearchSolution: {
        itemsPerPage: 10,
      },
      KeepUploadTask: {
        itemsPerPage: 25,
      },
      SetSite: {
        itemsPerPage: -1,
        sortBy: [{ key: "userConfig.sortIndex", order: "desc" }],
      },
    },

    userName: "",

    myDataTableControl: {
      showSiteName: true,
      showUnreadMessage: true,
      showUserName: true,
      normalizeLevelName: true,
      showLevelRequirement: true,
      onlyShowUserLevelRequirement: true,
      showNextLevelInTable: false,
      showNextLevelInDialog: true,
      showHnR: true,
      showSeedingBonus: true,
      //joinTimeWeekOnly: false,
      joinTimeFormat: "added",
      updateAtFormatAsAlive: false,
      showIntervalAsDate: false,
      simplifyBonusNumbers: false,
      showBonusNeededInterval: true,
    },

    userDataTimelineControl: {
      title: "",
      showField: {
        uploads: true,
        uploaded: true,
        downloaded: true,
        seeding: true,
        seedingSize: true,
        bonus: true,
        bonusPerHour: true,
        ratio: true,
      },
      showPerSiteField: {
        siteName: false,
        name: true,
        level: true,
        uid: true,
      },
      showTop: true,
      showTimeline: true,
      backgroundColor: defaultTimelineBackgroundColor,
      dateFormat: "time_added",
      faviconBlue: 3,
      selectedSites: [],
    },

    userStatisticControl: {
      showChart: {
        totalSiteBase: true,
        totalSiteSeeding: true,
        perSiteKuploaded: true,
        perSiteKuploadedIncr: true,
        perSiteKdownloaded: true,
        perSiteKdownloadedIncr: true,
        perSiteKseeding: true,
        perSiteKseedingIncr: true,
        perSiteKseedingSize: true,
        perSiteKseedingSizeIncr: true,
        perSiteKbonus: true,
        perSiteKbonusIncr: true,
        perSiteKseedingBonus: false,
        perSiteKseedingBonusIncr: false,
      },
      dateRange: 30,
      hidePerSitePrecentThreshold: 1,
      selectedSites: [],
    },

    searchEntifyControl: {
      showSiteName: true,
      showTorrentTag: true,
      showTorrentSubtitle: true,
      showSocialInformation: true,
      socialInformationSearchOnNewTab: true,
      uploadAtFormatAsAlive: false,
      limitTorrentTitleTdWidth: false,
      maxTagCountBeforeGroup: 0,
      hiddenTagNames: [],
    },

    userInfo: {
      queueConcurrency: 5,
      autoReflush: {
        enabled: true,
        interval: 1, // hours（v0.29.6 起 3 → 1；界面原先标的是"分钟"，见 UserInfoWindow）
        afterTime: "00:00",
        retry: {
          max: 3,
          interval: 5, // minutes
        },
      },
      alwaysPickLastUserInfo: true,
      showDeadSiteInOverview: false,
      showPassedSiteInOverview: false,
    },

    download: {
      saveDownloadHistory: true,
      allowDownloaderFilterForSite: false,
      initDownloaderTorrentOnEnter: true,
      saveLastDownloader: true,
      allowDirectSendToClient: false,
      localDownloadMethod: "browser",
      ignoreSiteDownloadIntervalWhenLocalDownload: true,
      useQuickSendToClient: true,
    },

    searchEntity: {
      queueConcurrency: 8,

      allowSingleSiteSearch: false,
      treatTTQueryAsImdbSearch: true,

      saveLastFilter: true,
      forceImdbIdMatchFilter: true,
      autoDetectOfficialGroupFromTitle: false,

      quickSiteFilter: true,
      showHotRecommendations: true,

      /**
       * 搜索页顶部「搜索方案」作用域上次的选择（方案 id、`all`、或 `site:a,b,c`）。
       * 存在这里而不是页面自己的 ref，是因为每次打开选项页都重置成"默认搜索方案"、
       * 反复要点同一个方案。读取侧见 SearchEntity/Index.vue 的 searchPlanKey：
       * 它会校验这个键是否还有效（方案被删/被禁用、站点被移除都要回落）。
       */
      lastPlanKey: "default",
    },

    mediaServerEntity: {
      queueConcurrency: 5,
      searchLimit: 50,
      autoSearchWhenMount: true,
      autoSearchMoreWhenScroll: true,
    },

    backup: {
      encryptionKey: "",
      enabledAutoBackup: false,
    },

    socialSiteInformation: {
      preferPtGen: true,
      timeout: 10e3,
      cacheDay: 7,
      socialSite: {
        anidb: {},
        bangumi: {},
        douban: {},
        imdb: {},
        tmdb: {},
        tvmaze: {},
      },
    },

    autoExtendCookies: {
      enabled: true,
      triggerThreshold: 2,
      extensionDuration: 3,
    },

    updateCheck: {
      enabled: true,
      notify: true,
    },
  }),
  getters: {
    uiTheme(): Exclude<supportThemeType, "auto"> {
      if (this.theme === "auto") {
        const preferDark = usePreferredDark();
        return preferDark.value ? "dark" : "light";
      }
      return this.theme;
    },

    isLightUiTheme(): boolean {
      return this.uiTheme === "light";
    },

    getUserName(): string {
      if (this.userName === "") {
        return this.getUserNames.perfName;
      } else {
        return this.userName;
      }
    },

    getUserNames(state) {
      const metadataStore = useMetadataStore();

      const userNames = {
        perfName: "",
        names: {} as Record<string, number>,
      };

      const allNames = Object.values(metadataStore.lastUserInfo)
        .map((userInfo) => userInfo.name)
        .filter(Boolean) as string[];

      for (const name of allNames) {
        if (!userNames.names[name]) {
          userNames.names[name] = 0;
        }
        userNames.names[name]++;

        if (name !== userNames.perfName && userNames.names[name] > (userNames.names[userNames.perfName] ?? 0)) {
          userNames.perfName = name;
        }
      }

      return userNames;
    },
  },
  actions: {
    updateTableBehavior(table: string, key: string, data: any) {
      // @ts-ignore
      this.tableBehavior[table][key] = data;
      if (this.saveTableBehavior) {
        this.$save();
      }
    },

    updateContentScriptPosition(x: number, y: number) {
      this.contentScript.position.x = x;
      this.contentScript.position.y = y;
      this.$save();
    },
  },
});
