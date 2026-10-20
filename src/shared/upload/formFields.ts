/**
 * 「页面上有哪些控件」→「表单描述」这一步的判据。
 *
 * DOM 遍历必须留在 offscreen（Node 侧没有 DOM，`vitest` 跑在 `environment: "node"`），
 * 所以这里只吃一份**已经拍平的控件快照**（`IRawUploadControl`），不碰 Document。
 * 好处是这条判据能直接跑断言：哪些控件该忽略、同名 radio 怎么合、必填怎么算，
 * 全是纯函数，判错时测试能指出是哪一条规则。
 *
 * 为什么不能把页面上所有 input 原样摆给用户：NexusPHP 的上传页里有大量
 * `submit` / `button` / 站点自己的「预览」按钮，还有同名 radio 各占一条记录。
 * 原样铺开会得到一张 30 行的表单，其中一半点了没意义。
 */
import type { IUploadField, IUploadOption, TUploadFieldKind } from "./types.ts";

/** DOM 那一侧拍出来的一条控件（一个 `<select>` / `<input>` / `<textarea>` 对应一条） */
export interface IRawUploadControl {
  /** `name` 属性；空字符串表示这个控件不参与提交 */
  name: string;
  tag: "select" | "input" | "textarea";
  /** `input` 的 `type`（select/textarea 传 "select"/"textarea" 即可，这里不看） */
  type: string;
  label: string;
  required: boolean;
  /** `select` 的选项；`radio` 这里是**这一条**的单个选项（同名的会在合并时收拢） */
  options?: IUploadOption[];
  /** 当前值：`select` 取选中项、`input` 取 `value`、`textarea` 取文本 */
  value?: string;
  /** `radio` / `checkbox` 是否被页面标成选中（合并同名 radio 时要靠它认默认值） */
  checked?: boolean;
  /** `select multiple`。P0 不支持多选，遇到会进 warnings */
  multiple?: boolean;
}

/** 这些 type 是页面自己的交互按钮，不是要提交的数据 */
const IGNORED_INPUT_TYPES = new Set([
  "submit",
  "button",
  "reset",
  "image",
  "search",
  "color",
  "range",
  "password",
  "tel",
  "url",
  "email",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

function kindOf(raw: IRawUploadControl): TUploadFieldKind | null {
  if (raw.tag === "select") return "select";
  if (raw.tag === "textarea") return "textarea";

  switch (raw.type) {
    case "file":
      return "file";
    case "hidden":
      return "hidden";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    default:
      return IGNORED_INPUT_TYPES.has(raw.type) ? null : "text";
  }
}

/**
 * 把控件快照折算成表单字段。
 *
 * 去重规则：**同名字段只留一条**，radio 例外 —— 同名的多个 radio 合成一条 `radio` 字段，
 * 选项按出现顺序收拢（这正是页面上那一组的真实含义）。
 */
export function describeUploadFields(raws: IRawUploadControl[]): {
  fields: IUploadField[];
  warnings: string[];
} {
  const fields: IUploadField[] = [];
  const byName = new Map<string, IUploadField>();
  const warnings: string[] = [];
  let fileCount = 0;

  for (const raw of raws) {
    const name = raw.name?.trim();
    if (!name) continue; // 没有 name 的控件不会出现在提交里

    const kind = kindOf(raw);
    if (!kind) continue;

    // 上传页只允许一个种子文件；第二个 file 控件是站点自己的「重新选择」按钮一类的残留
    if (kind === "file") {
      fileCount += 1;
      if (fileCount > 1) continue;
    }

    const existing = byName.get(name);

    if (kind === "radio") {
      const option = { value: raw.value ?? "", label: raw.label || raw.value || "" };
      if (existing) {
        existing.options = [...(existing.options ?? []), option];
        // `required` 在整组里任一条为真即算真；默认值取第一个被页面标成 checked 的那条
        existing.required ||= raw.required;
        if (raw.checked && !existing.initialValue) existing.initialValue = option.value;
        continue;
      }
      const field: IUploadField = {
        name,
        kind: "radio",
        label: raw.label || name,
        required: raw.required,
        options: [option],
      };
      if (raw.checked) field.initialValue = option.value;
      fields.push(field);
      byName.set(name, field);
      continue;
    }

    if (existing) continue; // 同名非 radio：以页面上第一次出现的为准

    const field: IUploadField = {
      name,
      kind,
      label: raw.label?.trim() || name,
      required: raw.required,
    };

    if (raw.options && raw.options.length > 0) field.options = raw.options;
    if (raw.value !== undefined && raw.value !== "") field.initialValue = raw.value;
    if (raw.multiple) warnings.push(`${field.label} 是多选字段，当前只会提交第一个值`);

    fields.push(field);
    byName.set(name, field);
  }

  return { fields, warnings };
}
