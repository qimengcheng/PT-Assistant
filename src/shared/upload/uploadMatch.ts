/**
 * 上传表单的初值猜测：把「源种子」的信息填进「目标站表单」的对应格。
 *
 * 这不是「自动转种」的花活，而是 P0 里最实的一步 —— NexusPHP 的上传页通常有 8~12 个下拉
 * （类型 / 来源 / 媒介 / 编码 / 分辨率 / 制作组…），全手选一轮比填标题还慢，而其中「类型」
 * 这一维两站的叫法虽然不同、语义却是通的（电影 / Movies / Movie(電影)），正好能用现成的
 * `categorizeByRule` 折算。**只猜能确定的这一维**，其余维度留给站点默认值与用户 ——
 * 猜错分类会把种子发到错误的板块，代价比多选两个下拉大得多。
 *
 * 为什么单独成文件而不是塞进对话框：这一段要能直接跑 Node 断言（同 `reseedCandidate.ts`、
 * `trackerHost.ts` 的先例）。判错的现场是「种子被发到了音乐区」，不是抛错。
 */
import { categorizeByRule } from "@/shared/category.ts";
import { isDescriptionFieldName } from "./description.ts";
import type { IUploadField, IUploadOption } from "./types.ts";

/** 从源种子带过来的可用信息 */
export interface IUploadHints {
  title?: string;
  subtitle?: string;
  /** 源站那颗种子的分类原样值（搜索结果里 `torrent.category`，通常是分类名而不是值） */
  category?: string | number;
  /**
   * 已经拼好的简介正文（`composeDescription` 的产物）。
   * 没给就留空 —— 目标站的简介格不预填任何占位文字，否则人会以为自己漏了什么。
   */
  description?: string;
}

/**
 * 字段名 → 它装的是标题还是副标题。
 *
 * 只认 NexusPHP 与 Unit3D 两套里确定见过的那几个名字，且**必须是整名匹配**：
 * 子串匹配会让 `name` 顺手吃掉 `anonname` / `teamname` / `small_descr` 里没有 name 的那些，
 * 把标题填进「发布组」格。
 */
const TITLE_FIELD_NAMES = new Set(["name", "title"]);
const SUBTITLE_FIELD_NAMES = new Set(["small_descr", "subtitle", "small_desc"]);

/**
 * 在目标站的选项里找「语义同类」的那一个。
 *
 * 判据是 `categorizeByRule`（全站折类的唯一口径，见 `src/shared/category.ts`）：
 * 源站写「电影」、目标站写「Movies」，两者都折成 `movie` 就算命中。
 * 一个都折不出来（`other`）时**不返回任何值** —— 与其猜一个，不如让用户手选。
 */
export function matchCategoryOption(
  options: IUploadOption[],
  rawCategory: string | number | undefined,
): IUploadOption | undefined {
  const raw = String(rawCategory ?? "").trim();
  if (!raw) return undefined;

  const kind = categorizeByRule(raw);
  if (kind === "other") return undefined;

  return options.find((option) => categorizeByRule(option.label) === kind);
}

/**
 * 生成表单初值。
 *
 * 三条规则，按优先级：
 * 1. `hidden` 一律回传页面给的 `initialValue`（站点自己的 token / 已选值，漏了就提交失败）
 * 2. 能对上标题 / 副标题的文本框，带上源种子的值
 * 3. 下拉与单选：先用源种子分类去匹配（覆盖页面默认的「请选择」），匹配不上再退回 `initialValue`
 *
 * 简介格单独一条：只有真拿到了简介正文才填。拿到的是空串时保持页面原值 ——
 * 源站没写简介、目标站又有自己的默认模板时，清空它反而是破坏。
 */
export function buildInitialValues(fields: IUploadField[], hints: IUploadHints): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of fields) {
    if (field.kind === "file") continue; // 种子本体由提交那一步填，不在这里造

    switch (field.kind) {
      case "hidden":
        values[field.name] = field.initialValue ?? "";
        break;

      case "text":
      case "textarea": {
        if (TITLE_FIELD_NAMES.has(field.name) && hints.title) {
          values[field.name] = hints.title;
        } else if (SUBTITLE_FIELD_NAMES.has(field.name) && hints.subtitle) {
          values[field.name] = hints.subtitle;
        } else if (isDescriptionFieldName(field.name) && hints.description) {
          values[field.name] = hints.description;
        } else {
          values[field.name] = field.initialValue ?? "";
        }
        break;
      }

      case "select":
      case "radio": {
        const matched =
          field.options && field.options.length > 0
            ? matchCategoryOption(field.options, hints.category)
            : undefined;
        values[field.name] = matched?.value ?? field.initialValue ?? "";
        break;
      }

      case "checkbox":
        values[field.name] = field.initialValue === "1" ? "1" : "";
        break;
    }
  }

  return values;
}

/**
 * 提交前的预检：页面标了必填、但值是空的字段，返回它们给人看的名字。
 *
 * 界面上要显示成「还差：标题、来源」而不是「表单不完整」—— 后者让人自己去找，
 * 而 NexusPHP 的必填标记常常只是说明文字里的一个红 `*`，很容易漏看。
 * 种子文件那一项不在检查范围：它由我们填，用户改不了。
 */
export function findEmptyRequiredFields(fields: IUploadField[], values: Record<string, string>): string[] {
  return fields
    .filter((field) => field.required && field.kind !== "file")
    .filter((field) => {
      const value = values[field.name];
      return value === undefined || value.trim() === "";
    })
    .map((field) => field.label || field.name);
}
