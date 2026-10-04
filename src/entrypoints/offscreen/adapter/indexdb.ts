/**
 * 已上移到 `@/shared/indexdb.ts`（options 侧现在也要读同一个库）。
 * 这里只做再导出，保留 offscreen 内部 `../adapter/indexdb.ts` 这条既有引用路径。
 */
export { ptdIndexDb } from "@/shared/indexdb.ts";
