import { filesize } from "filesize";
import { get } from "es-toolkit/compat";
import { refDebounced } from "@vueuse/core";
import { computed, type Ref, ref, unref, watch, isRef } from "vue";
import { flatten, flattenDeep, isEqual, uniq, uniqBy } from "es-toolkit";
import { startOfDay, startOfMonth, startOfQuarter, startOfWeek, startOfYear } from "date-fns";
import searchQueryParser, { type SearchParserOptions, SearchParserResult as TFilter } from "search-query-parser";

import { parseSizeString, parseValidTimeString } from "@ptd/site";
import { formatDate } from "@/options/utils.ts";

type TAdvanceFilterFormat = "date" | "size" | "number" | "boolean";

export interface ITextValue {
  required: string[];
  exclude: string[];
}

export interface IRangedField {
  range: [number, number];
  ticks: number[];
}

interface IValueFormat {
  parse?: (value: any) => any;
  build?: (value: any) => string;
}

export const dateFilterFormat = [
  "T",
  "yyyyMMdd'T'HHmmss",
  "yyyyMMdd'T'HHmm",
  "yyyyMMdd'T'HH",
  "yyyyMMdd",
  "yyyyMM",
  "yyyy",
];

const advanceFilterFormat: Record<TAdvanceFilterFormat, IValueFormat> = {
  date: {
    parse: (value: string | number) => {
      if (typeof value === "number") return value;
      else return parseValidTimeString(value, dateFilterFormat) as number;
    },
    build: (value: string | number) => formatDate(value, "yyyyMMdd'T'HHmmss") as string,
  },
  size: {
    parse: (value: string | number) => {
      if (typeof value === "number") return value;
      else return parseSizeString(value);
    },
    build: (value: string | number) => filesize(value, { spacer: "" }) as string,
  },
  // 对 number 全部转为字符串比较
  number: {
    parse: (value: string | number) => value.toString(),
    build: (value: string | number) => value.toString(),
  },
  boolean: {
    parse: (value: string) => (value ? "1" : "0"),
    build: (value: boolean) => (value ? "1" : "0"),
  },
} as const;

type TFormat = Record<string, TAdvanceFilterFormat | IValueFormat>;

const queryEscapeMap: Record<string, string> = {
  "\\": "\\u005c",
  " ": "\\u0020",
  ",": "\\u002c",
  ":": "\\u003a",
};
const queryUnEscapeMap = Object.fromEntries(
  Object.entries(queryEscapeMap).map(([key, value]) => [value.toLowerCase(), key]),
);
const escapedQueryTokens = Object.values(queryEscapeMap).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const escapedQueryValueRegex = new RegExp(`(?:${escapedQueryTokens.join("|")})`, "gi");
const queryReservedCharsRegex = /[\\ ,:]/g;
// /pattern/[gimsuy]
const regexLiteralPattern = /^\/((?:\\.|[^\\/])*)\/([gimsuy]*)$/;
const regexCache = new Map<string, RegExp | null>();
/**
 * regexCache 上限。用户每敲一个字符就可能新增一条正则（多表实例共享同一个 Map），
 * 不设上限的话长时间使用 + 逐字输入正则会把内存慢慢吃光。超限就整体清空 ——
 * 缓存只是省掉重复 new RegExp 的开销，丢了一两次重新编译完全无害。
 */
const REGEX_CACHE_MAX = 200;

function cacheRegex(key: string, regex: RegExp | null): void {
  if (regexCache.size >= REGEX_CACHE_MAX) {
    regexCache.clear();
  }
  regexCache.set(key, regex);
}

function escapeQueryValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(queryReservedCharsRegex, (char) => queryEscapeMap[char]);
}

function unEscapeQueryValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(
    escapedQueryValueRegex,
    (escapedToken) => queryUnEscapeMap[escapedToken.toLowerCase()] ?? escapedToken,
  );
}

function normalizeFilterValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return unEscapeQueryValue(value) as string;
}

/** 仅解析 /pattern/[gimsuy] 结构，失败时返回 null */
function toRegexIfValid(value: unknown): RegExp | null {
  const normalizedValue = normalizeFilterValue(value);
  if (typeof normalizedValue !== "string") return null;

  if (regexCache.has(normalizedValue)) {
    return regexCache.get(normalizedValue) ?? null;
  }

  const matched = regexLiteralPattern.exec(normalizedValue);
  if (!matched) {
    cacheRegex(normalizedValue, null);
    return null;
  }

  const [, pattern, flags] = matched;
  try {
    // ⚠️ 必须去掉 g / y 再缓存：
    // 带 g 或 y 的正则有 lastIndex 状态，同一个实例被 tableFilterFn 跨行复用时
    // 第二次 test 会从上次的位置继续找，导致「同一行在不同列上结果不一致」的诡异 bug。
    const regex = new RegExp(pattern, flags.replace(/[gy]/g, ""));
    cacheRegex(normalizedValue, regex);
    return regex;
  } catch {
    cacheRegex(normalizedValue, null);
    return null;
  }
}

function matchFilterValue(itemValue: string, rawFilterValue: unknown): boolean {
  const filterValue = normalizeFilterValue(rawFilterValue);
  if (typeof filterValue !== "string") return false;
  const regex = toRegexIfValid(filterValue);
  return regex ? regex.test(itemValue) : itemValue === filterValue;
}

const getRaw = (x: any) => x;
function getValueFormat(key: string, format: TFormat = {}): Required<IValueFormat> {
  let valueFormatFn: IValueFormat = {};

  if (format[key]) {
    if (typeof format[key] === "string" && advanceFilterFormat[format[key] as TAdvanceFilterFormat]) {
      valueFormatFn = advanceFilterFormat[format[key] as TAdvanceFilterFormat];
    } else {
      const { parse: parseFn, build: buildFn } = format[key] as IValueFormat;
      valueFormatFn.parse ??= parseFn;
      valueFormatFn.build ??= buildFn;
    }
  }

  valueFormatFn.parse ??= getRaw;
  valueFormatFn.build ??= getRaw;

  return valueFormatFn as Required<IValueFormat>;
}

export function getThisDateUnitRange(
  dateType: "day" | "week" | "month" | "quarter" | "year",
  range: [number, number],
): [number, number] {
  const [minDate, maxDate] = range;

  const now = new Date();
  const start = {
    day: startOfDay(now),
    week: startOfWeek(now),
    month: startOfMonth(now),
    quarter: startOfQuarter(now),
    year: startOfYear(now),
  }[dateType];

  return [Math.max(minDate, start.getTime()), Math.min(maxDate, now.getTime())];
}

export function generateRangeField(data: (number | undefined)[]): IRangedField {
  const numData = data.filter((x) => !isNaN(x as unknown as number)) as number[];

  return {
    range: numData.length > 0 ? [Math.min(...numData), Math.max(...numData)] : [-Infinity, Infinity],
    ticks: Array.from(new Set(data)) as number[],
  };
}

export function setDateRangeByDatePicker(value: unknown[]): [number, number] {
  const dateRange = value as Date[];
  return [dateRange[0].getTime(), dateRange[dateRange.length - 1].getTime()];
}

type TRawItem = { [key: string]: any };

export function checkKeywordValue(
  filter: TFilter,
  rawItem: TRawItem,
  keyword: string,
  format: TFormat = {},
  exclude = false,
  // @ts-ignore
): boolean | undefined {
  const itemValue = get(rawItem, keyword); // true    filter[keyword] = ['1']
  if (filter[keyword]) {
    // 如果原始数据中没有该 keyword 字段，则直接返回 false
    if (typeof itemValue == "undefined") {
      return false;
    }

    const valueFormat = getValueFormat(keyword as string, format);
    if (Array.isArray(itemValue)) {
      const parsedValues = itemValue.map((v: any) => valueFormat.parse(v) as string);
      const filterVals = filter[keyword] as string[];
      // 如果是正向关键词则要求全部包含，如果是排除关键词则要求有任意一个包含
      return exclude
        ? filterVals.some((k) => parsedValues.some((v) => matchFilterValue(v, k)))
        : filterVals.every((k) => parsedValues.some((v) => matchFilterValue(v, k)));
    } else {
      const itemParsedValue = valueFormat.parse(itemValue) as string;
      return filter[keyword].some((k: string) => matchFilterValue(itemParsedValue, k));
    }
  }
}

export function checkRangeValue(
  filter: TFilter,
  rawItem: TRawItem,
  keyword: string,
  format: TFormat = {},
  // @ts-ignore
): boolean | undefined {
  const itemValue = get(rawItem, keyword);
  if (filter[keyword] && typeof itemValue !== "undefined") {
    const valueFormat = getValueFormat(keyword, format);
    const value = valueFormat.parse(itemValue) as number;
    const from = valueFormat.parse((filter[keyword] as any).from || -Infinity) as number;
    const to = valueFormat.parse((filter[keyword] as any).to || Infinity) as number;

    return Boolean(from && value >= from && to && value <= to);
  }
}

interface TableCustomFilterOptions<ItemType> {
  parseOptions: SearchParserOptions;
  titleFields: string[]; // item的那些部分作为title

  format?: TFormat;

  initialSearchValue?: string; // 用于生成 tableWaitFilterRef 的初始数据
  initialItems?: Ref<ItemType[]> | ItemType[]; // 用于生成 advanceFilterDictRef 的初始数据
  debouncedMs?: number; // 过滤器字符串更新的防抖时间，单位毫秒

  watchItems?: boolean; // 是否监听 items 的变化（需要传入的为ref），动态更新 advanceFilterDictRef
  autoUpdateFilter?: boolean; // 是否在 advanceFilterDictRef 变化时自动更新过滤器字符串（需要传入的为ref）
}

export function useTableCustomFilter<ItemType extends Record<string, any>>(
  options: TableCustomFilterOptions<ItemType>,
) {
  const {
    parseOptions,
    titleFields = ["title"],
    format = {},
    initialSearchValue = "",
    initialItems = [],
    debouncedMs = 500,
    watchItems = false,
    autoUpdateFilter = false,
  } = options;

  // 给 parseOptions 设置一些固定的值，以控制 searchQueryParser.parse 的结果
  parseOptions.tokenize = true;
  parseOptions.offsets = false;
  parseOptions.alwaysArray = true;

  /**
   * 用作 VInput 的 v-model ，接收用户的直接输入
   */
  const tableWaitFilterRef = ref(initialSearchValue);

  /**
   * 用作 VDataTable 的 props.search，
   * 由于 VDataTable 过滤操作较重，而 用户直接输入的更新操作触发频繁
   * 通过延迟实际使用的搜索过滤词生成来避免不必要的卡顿
   */
  const tableFilterRef = refDebounced(tableWaitFilterRef, debouncedMs); // 延迟搜索过滤词的生成

  /**
   * 用作 VDataTable 内部比较方法 tableFilterFn
   * 通过 computed 来缓存 实际使用的判断字典
   */
  const tableParsedFilterRef = computed<TFilter>(
    () => searchQueryParser.parse(tableFilterRef.value, parseOptions) as TFilter,
  );

  /**
   * 用来表示 initialItems 中 parseOptions.{keywords, ranges} 可选值的字典，结构如下
   * {
   *   `${keyword}`: string[],
   *   `${ranges}`: { range: [min, max], ticks: [x1, x2, x3, ...] }
   * }
   */
  const advanceItemPropsRef = ref<Record<string, any>>({});

  function buildAdvanceItemPropsFn() {
    const unRefedItems = unref(initialItems);

    parseOptions.keywords?.forEach((keyword) => {
      const valueFormat = getValueFormat(keyword, format);

      advanceItemPropsRef.value[keyword] = uniqBy(
        flatten(unRefedItems.map((item) => item[keyword]).filter(Boolean)),
        (x) => valueFormat.parse(x),
      );
    });
    parseOptions.ranges?.forEach((keyword) => {
      advanceItemPropsRef.value[keyword] = generateRangeField(unRefedItems.map((item) => item[keyword]));
    });
  }

  // 方法调用时主动构建一次
  buildAdvanceItemPropsFn();

  // 如果设置了主动观察，且传入的 initialItems 可以被观察，则使用 watch 来自动构建
  if (watchItems && isRef(initialItems)) {
    watch(initialItems, () => buildAdvanceItemPropsFn(), { deep: true });
  }

  /**
   * 一个中间态字典，用于缓存在高级筛选窗口中勾选的项目
   * {
   *   text: { required: string[], exclude: string[] },
   *   `${keyword}`: { required: string[], exclude: string[] },
   *   `${ranges}`: [number, number]
   * }
   */
  const advanceFilterDictRef = ref<Record<string, any>>({});

  // 从 string 中构建 advanceFilterDictRef
  function buildFilterDictFn(text: string = "") {
    const { keywords = [], ranges = [] } = parseOptions;
    const parsedFilter = searchQueryParser.parse(text ?? "", parseOptions) as TFilter;

    ["text", ...keywords].forEach((key) => {
      const valueFormat = getValueFormat(key, format);
      let required: unknown[] = [];
      let exclude: unknown[] = [];

      const thisRequired = parsedFilter[key];
      if (Array.isArray(thisRequired) && thisRequired.length > 0) {
        required = uniq(flattenDeep(thisRequired.map((v: any) => valueFormat.parse(unEscapeQueryValue(v)))));
      }

      const thisExclude = parsedFilter.exclude?.[key];
      if (Array.isArray(thisExclude) && thisExclude.length > 0) {
        exclude = uniq(flattenDeep(thisExclude.map((v: any) => valueFormat.parse(unEscapeQueryValue(v)))));
      }

      advanceFilterDictRef.value[key] = { required, exclude };
    });

    ranges.forEach((key) => {
      const valueFormat = getValueFormat(key, format);

      advanceFilterDictRef.value[key] = [
        parsedFilter[key]?.from ? valueFormat.parse(parsedFilter[key].from) : -Infinity,
        parsedFilter[key]?.to ? valueFormat.parse(parsedFilter[key].to) : Infinity,
      ];
    });
  }

  // 方法调用时主动构建一次
  buildFilterDictFn(initialSearchValue);

  function stringifyFilterDictFn() {
    const { keywords = [], ranges = [] } = parseOptions;
    const filters: any = { exclude: {} };

    ["text", ...keywords].forEach((key) => {
      const valueFormat = getValueFormat(key, format);
      const { required, exclude } = advanceFilterDictRef.value[key] as unknown as ITextValue;
      if (required?.length > 0) {
        filters[key] = uniq(flattenDeep(required.map((v) => escapeQueryValue(valueFormat.build(v)))));
      }
      if (exclude?.length > 0) {
        filters.exclude[key] = uniq(flattenDeep(exclude.map((v) => escapeQueryValue(valueFormat.build(v)))));
      }
    });

    ranges.forEach((key) => {
      const valueFormat = getValueFormat(key, format);
      const range = (advanceItemPropsRef.value[key] as unknown as IRangedField).range;
      const value = (advanceFilterDictRef.value[key] as unknown as [number, number]).map(valueFormat.parse);

      if ((value[0] && value[0] !== -Infinity) || (value[1] && value[1] !== Infinity)) {
        filters[key] = {
          from: valueFormat.build(Math.max(range[0], value[0], -Infinity)),
          to: valueFormat.build(Math.min(range[1], value[1], Infinity)),
        };
      }
    });

    return searchQueryParser.stringify(filters, parseOptions);
  }

  function updateTableFilterValueFn() {
    tableWaitFilterRef.value = stringifyFilterDictFn();
  }

  if (autoUpdateFilter) {
    watch(
      advanceFilterDictRef,
      () => {
        updateTableFilterValueFn();
      },
      { deep: true },
    );
  }

  const reBuildFilterCountRef = ref<number>(0);
  function reBuildAdvanceFilter(updateItemProps: boolean = false) {
    reBuildFilterCountRef.value++; // 更新计数，防止因为 :key 的问题导致 vue 无法重置 v-checkbox 状态
    if (updateItemProps) buildAdvanceItemPropsFn();
    buildFilterDictFn(""); // 使用空字符串构建
  }

  /**
   * 三态循环：中性 -> required -> exclude -> required -> ...
   *
   * ⚠️ 只能用在「a-checkbox-group 的 v-model:value 绑到 required」的写法上：
   * 本函数自身只改 exclude，required 是靠 checkbox-group 自己的 change 回调维护的。
   * 两者的事件顺序恰好是 DOM click（本函数）先于 input change（group 更新 required），
   * 所以本函数读到的是旧值，组合起来才构成完整循环。
   * 单向 :checked + @click 的写法（没有 checkbox-group）用它会点不动 —— required 永远没人改。
   * 那种场景请改用 setKeywordRequiredFn。
   */
  function toggleKeywordStateFn(field: string, value: string) {
    const keywordState = advanceFilterDictRef.value[field] as ITextValue;
    const state = keywordState.required!.includes(value);
    if (state) {
      keywordState.exclude!.push(value);
    } else {
      keywordState.exclude! = keywordState.exclude!.filter((x: string) => !isEqual(x, value));
    }
  }

  /**
   * 两态开关：显式把 value 加入或移出 required，并保证它不出现在 exclude 里。
   *
   * 给「单向 :checked + @change」的受控复选框用 —— 那类写法没有 checkbox-group 兜底，
   * 必须由本函数自己维护 required，否则筛选项点不动、筛选条件永远为空。
   */
  function setKeywordRequiredFn(field: string, value: string, required: boolean) {
    const keywordState = advanceFilterDictRef.value[field] as ITextValue;
    const drop = (list: string[]) => list.filter((x) => !isEqual(x, value));
    if (required) {
      if (!keywordState.required!.some((x) => isEqual(x, value))) {
        keywordState.required!.push(value);
      }
      keywordState.exclude = drop(keywordState.exclude ?? []);
    } else {
      keywordState.required = drop(keywordState.required ?? []);
    }
  }

  function tableFilterFn(value: any, query: string, item: any): boolean {
    const rawItem = item.raw as ItemType;

    const { text, exclude } = tableParsedFilterRef.value;

    /**
     * 惰性构造标题串：原来每行都无条件做一遍 titleFields.map(get) + flattenDeep + join + toLowerCase。
     * 搜索结果上万行时，改一次过滤词就是几万次这样的开销；而像「size:>10GB」这种
     * 只有区间条件的过滤压根用不到标题，却照样全算一遍。
     */
    let cachedTitle: string | undefined;
    let cachedTitleLower: string | undefined;
    const getTitle = () => {
      if (cachedTitle === undefined) {
        cachedTitle = flattenDeep(titleFields.map((key) => get(rawItem, key)))
          .filter(Boolean)
          .join("|$|")
          .toString();
        cachedTitleLower = cachedTitle.toLowerCase();
      }
      return cachedTitle;
    };
    const matchesText = (keyword: string): boolean => {
      const normalizedKeyword = normalizeFilterValue(keyword);
      if (typeof normalizedKeyword !== "string") return false;
      const regex = toRegexIfValid(normalizedKeyword);
      return regex ? regex.test(getTitle()) : (cachedTitleLower ??= getTitle().toLowerCase()).includes(normalizedKeyword.toLowerCase());
    };

    if (text) {
      const includeText = Array.isArray(text) ? text : [text];
      if (!includeText.every(matchesText)) {
        return false;
      }
    }

    if (parseOptions.keywords) {
      for (const keyword of parseOptions.keywords) {
        if (checkKeywordValue(tableParsedFilterRef.value, rawItem, keyword, format) === false) return false;
      }
    }

    if (parseOptions.ranges) {
      for (const keyword of parseOptions.ranges) {
        if (checkRangeValue(tableParsedFilterRef.value, rawItem, keyword, format) === false) return false;
      }
    }

    if (exclude) {
      const { text: exText } = exclude;

      if (exText) {
        const excludesText = Array.isArray(exText) ? exText : [exText];
        if (excludesText.some(matchesText)) {
          return false;
        }
      }

      if (parseOptions.keywords) {
        for (const keyword of parseOptions.keywords) {
          if (checkKeywordValue(exclude, rawItem, keyword, format, true) === true) return false;
        }
      }

      // NOTE： search-query-parser 不支持 range 的 exclude
    }

    return true;
  }

  return {
    tableWaitFilterRef,
    tableFilterRef,
    tableParsedFilterRef,
    advanceItemPropsRef,
    buildAdvanceItemPropsFn,
    advanceFilterDictRef,
    buildFilterDictFn,
    stringifyFilterDictFn,
    tableFilterFn,
    reBuildFilterCountRef,
    reBuildAdvanceFilter,
    updateTableFilterValueFn,
    toggleKeywordStateFn,
    setKeywordRequiredFn,
  };
}
