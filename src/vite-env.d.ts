// PT-depiler 沿用的编译期常量类型声明（由 wxt.config.ts 的 vite.define 注入）
declare const __BROWSER__: "chrome" | "firefox";

declare const __RESOURCE_SITE_ICONS__: string[];

// 扩展版本号（git describe 产物，见 wxt.config.ts）
declare const __EXT_VERSION__: string;
