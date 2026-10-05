/**
 * content script 侧的 antdv-next **按需注册**。
 *
 * 为什么不用 `@/options/plugins/antd.ts` 的全量 `install`：
 * 全量 install 会遍历 `antdv-next/dist/components.js` 里全部 70 个可安装组件
 * （`app.use(component)`），一个都摇不掉 —— 结果 content-app 单个 chunk 4.3MB
 * （占全部产物 JS 的 65%），每个 PT 站点都要背这份 Vue + 全量 antd。
 * 巨型单文件还会触发 PLAYBOOK §13 的 esbuild >512KB 写 Temp 被杀软句柄卡住。
 *
 * 这份清单怎么来的（不是手拍的）：
 * 从 `src/content-script/app/init.ts` 出发做完整 import 闭包
 * （含 content 复用的 options 组件 SentToDownloaderDialog / TorrentTitleTd 等），
 * 抽出模板里出现的全部 `a-*` 标签，再用 Node 实跑每个组件的 `install()`
 * 得到「谁注册谁」的权威映射，做最小集合覆盖。
 *
 * 全量 install 共注册 139 个组件名（这个数是稳的），这里只装清单里的父组件 + StyleProvider，
 * 覆盖模板实际用到的组件（父组件的 install 会连带注册自己的子组件，
 * 例如 Menu → AMenuItem/ASubMenu/AMenuDivider，Table → ATableColumn/ATableSummary…）。
 * ⚠️ **父组件数与实际注册名数别手抄** —— 它们随闭包变化，跑
 * `node scripts/check-content-antd-lite.mjs` 的输出才是准的（AGENTS §3.4 同款要求）。
 * 抄一次就过期一次。
 *
 * TODO(维护)：新增/删除 content 侧模板里的 `a-*` 标签时，必须同步这张表，并跑
 * `node scripts/check-content-antd-lite.mjs` 复核（它做依赖闭包 + 标签比对，FAIL 时非零退出）。
 * 漏注册的表现是 Vue 把标签当原生元素渲染（无样式、slot 失效），线上是静默的，
 * 所以 DEV 构建下本文件会把它升级成 console.error（见 registerDevResolverGuard）。
 */
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Col,
  Collapse,
  ConfigProvider,
  Dropdown,
  Divider,
  Empty,
  Form,
  Image,
  Input,
  Menu,
  Modal,
  Popover,
  Radio,
  Row,
  Select,
  Skeleton,
  StyleProvider,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antdv-next";
import type { App as VueApp, Plugin } from "vue";

/** 模板直接用到的父组件；各自的 install 顺带注册子组件 */
const usedComponents = [
  Alert, // a-alert
  App, // a-app —— usePromptInDialog 靠 App.useApp() 拿 modal，见 app/App.vue 的包裹点
  AutoComplete, // a-auto-complete
  Button, // a-button
  Col, // a-col
  Collapse, // a-collapse / a-collapse-panel
  ConfigProvider, // a-config-provider（把浮层容器指进 shadowRoot，见 App.vue）
  Dropdown, // a-dropdown
  Divider, // a-divider
  Empty, // a-empty —— SocialSiteParseResultsDialog 解析结果为空时的空状态
        // 实测注册它 content-app.js 零增长（Δ0 KB）：Empty 的实现本来就在 chunk 里
        // （被别的组件间接引用），之前只是没注册，模板里写 <a-empty> 会静默变原生标签。
  Form, // a-form / a-form-item
  Image, // a-image
  Input, // a-input —— SentToDownloaderDialog 的「手动输入路径」输入框
  Menu, // a-menu / a-menu-item
  Modal, // a-modal
  Popover, // a-popover
  Radio, // a-radio / a-radio-group —— SentToDownloaderDialog 的下载器、保存路径单选列表
  Row, // a-row
  Select, // a-select
  Skeleton, // a-skeleton-button
  Switch, // a-switch
  Table, // a-table
  Tag, // a-tag
  Tooltip, // a-tooltip —— SentToDownloaderDialog 的「更多选项」入口（options 组件被 content 复用）
] as const;

/**
 * DEV 下把「组件没注册」从静默降级变成显式报错。
 *
 * 只拦 resolve 失败的告警，其余 warn 原样透出；生产构建不装这个 handler，
 * 避免把 Vue 的告警文案带到站点控制台。
 */
function registerDevResolverGuard(app: VueApp) {
  const upstream = app.config.warnHandler;
  app.config.warnHandler = (msg, instance, trace) => {
    if (import.meta.env.DEV && msg.includes("Failed to resolve component")) {
      console.error(
        `[PTD][content] ${msg}\n这是 src/content-script/antd-lite.ts 的按需清单缺项，补上对应组件即可。`,
      );
      return;
    }
    if (upstream) upstream(msg, instance, trace);
    else console.warn(`[PTD][content] ${msg}${trace ? `\n${trace}` : ""}`);
  };
}

/** 与 antdInstance 同形的插件对象，供 createApp(...).use(antdLiteInstance) 使用 */
export const antdLiteInstance = {
  install(app: VueApp) {
    /**
     * `as Plugin` 不是随手写的：withInstall 在运行时给每个组件挂了 `install`，
     * 但 antdv-next 的 .d.ts 把组件声明成裸 DefineComponent（见 dist/components.d.ts），
     * 类型上看不出来。运行时确实存在 —— scripts/check-content-antd-lite.mjs 会在 Node 里
     * 逐个实跑 install()，跑不通就非零退出，所以这里只做类型断言，不加运行时判断。
     */
    for (const component of usedComponents) app.use(component as Plugin);
    // StyleProvider 没有 install，全量 install 里是单独 app.component 注册的，这里保持一致
    app.component("AStyleProvider", StyleProvider);
    registerDevResolverGuard(app);
  },
};
