/**
 * 骨架阶段没有引入 Vuetify（Roadmap：评估换轻量组件库或继续手写），
 * 但平移过来的 shared 类型引用了 VSnackbar 的 props 类型（storages/runtime.ts 搜索配置）。
 * 这里用最小结构 shim 保持类型层兼容，后续引入 UI 库时替换。
 */
declare module "vuetify/components" {
  export type VSnackbar = { $props: Record<string, any> };
}
