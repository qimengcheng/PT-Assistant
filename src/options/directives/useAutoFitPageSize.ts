/**
 * 按「这一屏实际放得下几行」实测每页条数。
 *
 * 用户的口径（2026-10-08）：「要根据页面高度自动计算最佳的每页条数，既不能出现滚动条
 * 又要把页面铺满」。原先各页的 itemsPerPage 是写死的常数（10 / 25 / 50），高屏下面板
 * 下半截全是空白，矮屏下又拖出一条滚动条。
 *
 * 这里只产出一个 `fitted`（还没量到时为 0），用不用它由调用方决定 —— 调用点是
 * `toPagination` 的 fitSize：没挑过档时这一档就等于它（一进这一页就是「铺满、不出滚动条」
 * 那一档）；他在这一页之内挑过一档之后**照他挑的，容量不再参与**（用户 2026-10-18 定的两头：
 * 「手动调整过就按手动调整的来。但是每次重新进去还是默认是不出滚动条的条目数」）。
 *
 * ## 每一项减数都必须不依赖 pageSize
 * 这是 SearchEntity 那个 `recalcTableScrollY` 踩过三次的水泥坑：拿会漂的量当基准会得到
 * 恒等式，量多少次都原样吐回当前值，永远收敛不到铺满。四项减数分别量的是：面板里同级的
 * 其它块、表头、分页器（含它自己的上下 margin）、带 scroll.x 那张表的横向滚动条厚度。
 *
 * ## 行高为什么不直接除以「最高那一行」
 * 一页里的行并不等高（下载历史的标题带标签时会多出一行，台架量到 54.2 与 59.8 两档）。
 * `floor(可用高 / 最高行高)` 最保险，但代价是白留将近一行：台架实测 826px 的面板只排到
 * 12 行、底下还空 64px —— 而他报上来的就是这个「下面空一大片」。所以分两步：
 *   ① 先用当前页的**平均**行高定初值（这一步能把页面铺到只剩几像素）；
 *   ② 把初值写回界面之后，量这一页**真实**的累计行高：超高了就一行行往回退，
 *      没超高而「剩下的缝隙还放得下最高那一行」就再加一行。
 *
 * ## ②那一圈为什么不会来回抖
 * 往回退过一次，那个值就记成本轮上限（`ceiling`），同一轮里不再往上涨回去。没有这条会成环：
 * 退掉一行后按平均高算「缝隙又够放一行了」→ 加回来一个高行 → 又超高 → 又退，实测就在
 * 12 ↔ 13 之间跳。**加行**要「这一页是满页」才做（末页只剩三行时缝隙恒常很大，不加这条会一路
 * 加到把整份数据并成一页），**退行**不看满不满：渲染出来的记录行总高已经超了可用高、滚动条就在
 * 眼前，「这一页满不满」不该挡住退路。
 *
 * 一轮（epoch）= 面板高 + 数据条数 + 表头单元格数 + 「可用高相对上一轮变了多少」；
 * 面板变高、筛选换数据、切语言改字号、显示列增删、面板里那条说明条出现/消失都落在这些上。
 * 翻页不算换轮，但换页会改 tbody 的高度，那边另有一个 ResizeObserver 负责把 ② 再跑一次。
 *
 * ## 展开出来的子行不参与「这一屏放得下几条」的判据（v0.109.6）
 * 树形数据（辅种任务把条目挂在任务行下面）时，子行与父行排在同一个 `<tbody>` 里。
 * v0.109.3 把两种行分开数之后，仍然让**子行参与**「超没超、缝隙够不够」的判定 —— 于是
 * 他每展开一条，这一页就少排一条任务（展开两条退两档，界面上是列表自己往上缩一行）。
 * 用户 2026-10-18 撤掉了这一半：「如果是因为展开造成的高度变化出现的滚动条也不用管」。
 * 所以现在只剩一个用途上的区分：**只有记录行进入算式**，展开把整屏撑超就让它出滚动条。
 * 顺带这一圈少吃一个外部输入（子行数是他点出来的、原先又反过来决定写回值），
 * 「行」与「条」混单位那一族从结构上没有了 —— 剩下的收敛问题只有「同一页里记录行不等高」。
 *
 * ## avail 不许当「换轮」的等值判据
 * 上一段那个来回还有一条放大器：avail 里减掉了横向滚动条厚度，而那个厚度随渲染行数
 * 取整，实测在 11 ↔ 12 条之间只晃 **1px**。原先「avail 变了就重开一轮」拿的是
 * 四舍五入后的等值比较，那 1px 就把 `seeded` 和 `ceiling` 一起清掉了 —— ② 那圈
 * 「退过一次就不再涨回去」的守卫被它自己喂的数据解开。现在换成与上一轮基准的**差值**
 * 判据（阈值见 `EPOCH_AVAIL_STEP`）：说明条/分页器那种几十像素的结构变化照样重开一轮，
 * 而这一圈自己制造的那 1px 抖动不算。
 */
import { getCurrentScope, nextTick, onBeforeUnmount, onMounted, shallowRef, toValue, watch, type MaybeRefOrGetter } from "vue";

interface IAutoFitPageSizeOptions {
  /** 承载表格的滚动容器，列表页就是那个 `.page-panel` */
  container: MaybeRefOrGetter<HTMLElement | null | undefined>;
  /** 当前要展示的行（过滤后的）。它变了就重新量行高基准。 */
  rows: MaybeRefOrGetter<readonly unknown[] | null | undefined>;
  /**
   * 行数下限。默认 1 —— 「不出滚动条」这一半是硬要求，所以不拿「一页至少几行才好用」
   * 去盖它（给个 3 的话，窗口矮到放不下三行时就又拖出滚动条了）。
   * 只剩 1 行的那种高度本身已经是退化形状：面板连一行都放不下时（表头 + 分页器先吃掉
   * 全部高度），谁都救不了，那条滚动条不是本机制造成的。
   */
  min?: number;
}

function cssPx(value: string) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** 一个块占掉的竖向空间：自身高度 + 上下 margin（面板是 flex 列，margin 不会被折叠掉） */
function blockSpace(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().height + cssPx(cs.marginTop) + cssPx(cs.marginBottom);
}

/** 只认 tr.ant-table-row：空态占位行、rc-table 的隐藏量宽行、展开行都拿不到这个类 */
const ROW_SELECTOR = ".ant-table-tbody > tr.ant-table-row";

/**
 * rc-table 给每一行按层级打标（`ant-table-row-level-N`，顶层是 0）。
 * 认「level-1 及以上」而不是「不是 level-0」：平铺表的行本来就全是 level-0，而真按
 * 「带不带 level-0」判，任何一处没打上这个类就会把整页记录数读成 0，那比混单位更难查。
 */
const SUB_ROW_CLASS = /ant-table-row-level-[1-9]/;

/**
 * 「avail 相对上一轮变了多少才算换一轮」（px）。两个实测数字定的这一档：
 * 这一圈自己来回写 11 ↔ 12 条时 avail 只晃 **1px**（横向滚动条厚度按渲染行数取整），
 * 而它要代理的结构变化都是几十像素（分页器出现/消失 56px、面板里那条说明条 40+）。
 * 取 24 让这两族差出一个量级，又不至于漏掉半行的变化。
 */
const EPOCH_AVAIL_STEP = 24;

export interface IAutoFitSample {
  /**
   * 属于「一页记录」的那些行的高度。**展开出来的子行不在这一列里，也不参与任何判定**
   * （用户 2026-10-18：「如果是因为展开造成的高度变化出现的滚动条也不用管」，见文件头）。
   */
  recordHeights: number[];
}

export interface IAutoFitInput {
  /** 留给行的净高度 */
  avail: number;
  sample: IAutoFitSample;
  /** 界面上当前生效的那一档（还没量到时是 0） */
  fitted: number;
  /** 本轮走过 ①（定初值）了没有 */
  seeded: boolean;
  /** 本轮往回退到过这个值就不再往上涨回去 */
  ceiling: number;
  /** 行数下限 */
  min: number;
}

export interface IAutoFitOutput {
  /** `null` = 收敛，这一轮什么都不写 */
  next: number | null;
  seeded: boolean;
  ceiling: number;
}

/**
 * 两步收敛的那半截算术，单独摆出来是为了能被 Node 直接断言（DOM 那半截只有台架量得到）。
 * 判据与理由见文件头，边界都不在这里解释。
 */
export function nextAutoFitOf({ avail, sample, fitted, seeded, ceiling, min }: IAutoFitInput): IAutoFitOutput {
  const { recordHeights } = sample;
  const records = recordHeights.length;
  if (avail <= 0 || records === 0) return { next: null, seeded, ceiling };

  const sum = recordHeights.reduce((acc, h) => acc + h, 0);
  const max = Math.max(...recordHeights);
  const fullPage = fitted > 0 && records >= fitted;
  let next: number;

  if (!seeded) {
    // ①：初值按记录行的平均高，能把这一屏铺到只剩几像素
    next = Math.floor(avail / (sum / records));
    return withNext(next, { seeded: true, ceiling }, min, fitted);
  }
  if (sum > avail) {
    // ②a：这一页记录行的总高已经超了可用高 → 往回退一条记录，并把这个值记成上限。
    // 基准取**渲染出来的记录数**而不是 fitted：fitted 只是上一轮的读数，画了几条由「数据条数」
    // 与当前档谁小说了算，照 fitted 退要空转好几轮才落到放得下的那一档。
    return withNext(records - 1, { seeded: true, ceiling: records - 1 }, min, fitted);
  }
  if (!fullPage) return { next: null, seeded, ceiling }; // 不满的一页没有「还能不能再塞一行」可判，见文件头
  if (fitted < ceiling && avail - sum >= max) {
    // ②b：缝隙还放得下**最高**那一行记录，才敢再加一条
    return withNext(fitted + 1, { seeded, ceiling }, min, fitted);
  }
  return { next: null, seeded, ceiling }; // 收敛
}

function withNext(
  raw: number,
  state: Pick<IAutoFitOutput, "seeded" | "ceiling">,
  min: number,
  fitted: number,
): IAutoFitOutput {
  const next = Math.max(min, raw);
  return { next: next === fitted ? null : next, ...state };
}

/**
 * 「这一轮要不要重开」：结构身份（key）变了，或者 avail 相对上一轮变了 `EPOCH_AVAIL_STEP`
 * 以上。单独摆出来是因为这条判据坏的样子是**无限来回**而不是量歪一档，只有能连跑两轮才看得出来。
 * 首轮 `prevKey` 是空串，必定重开；`prevAvail` 是 NaN，比差值那半边自然为假。
 */
export function isNewEpoch({ key, prevKey, avail, prevAvail }: { key: string; prevKey: string; avail: number; prevAvail: number }) {
  return key !== prevKey || Math.abs(avail - prevAvail) >= EPOCH_AVAIL_STEP;
}

export function useAutoFitPageSize({ container, rows, min = 1 }: IAutoFitPageSizeOptions) {
  const fitted = shallowRef(0);
  const scope = getCurrentScope();
  /** 本轮退到过这个值就不再往上涨回去，见文件头「那一圈为什么不会来回抖」 */
  let ceiling = Number.POSITIVE_INFINITY;
  let seeded = false;
  let epoch = "";
  /** 本轮开头量到的 avail，换轮判据拿它比差值（见 EPOCH_AVAIL_STEP） */
  let epochAvail = Number.NaN;
  let observer: ResizeObserver | null = null;
  let mutator: MutationObserver | null = null;
  let observedBody: HTMLElement | null = null;

  function theadOf(el: HTMLElement) {
    // 设了 scroll.y 时表头被拆成独立的 .ant-table-header，量它比量 thead 准（同 SearchEntity）
    return el.querySelector<HTMLElement>(".ant-table-header") ?? el.querySelector<HTMLElement>(".ant-table-thead");
  }

  /** 留给行的净高度 */
  function availableHeight(el: HTMLElement) {
    const cs = getComputedStyle(el);
    let left = el.clientHeight - cssPx(cs.paddingTop) - cssPx(cs.paddingBottom);
    for (const child of Array.from(el.children)) {
      if (child instanceof HTMLElement && !child.classList.contains("ant-table-wrapper")) {
        left -= blockSpace(child);
      }
    }
    const header = theadOf(el);
    if (header) left -= header.getBoundingClientRect().height;
    const pag = el.querySelector<HTMLElement>(".ant-table-pagination");
    if (pag) left -= blockSpace(pag);
    // 经典滚动条在滚动容器自己的盒子里占厚度：offsetHeight − clientHeight 就是它
    for (const sel of [".ant-table-content", ".ant-table-body"]) {
      const scroller = el.querySelector<HTMLElement>(sel);
      if (scroller) left -= Math.max(scroller.offsetHeight - scroller.clientHeight, 0);
    }
    return left;
  }

  /**
   * tbody 可能被整块换掉（rc-table 换数据时重建节点），那样挂在它上面的观测就哑了，
   * 所以每次量之前重新认领一次。
   */
  function watchBody(el: HTMLElement) {
    if (!observer) return;
    const body = el.querySelector<HTMLElement>(".ant-table-tbody");
    if (body && body !== observedBody) {
      if (observedBody) observer.unobserve(observedBody);
      observer.observe(body);
      observedBody = body;
    }
  }

  function measure() {
    const el = toValue(container);
    if (!el) return;

    const avail = availableHeight(el);
    if (avail <= 0) return;
    watchBody(el);

    // 轮次身份里**不摆 avail 本身**：它是这一圈自己写回去的条数的函数（滚动条厚度按行数取整，
    // 实测晃 1px），摆进来等于拿输出当「换轮」判据，把 ② 那圈「退过一次就不再涨回去」的守卫
    // 每次抖动都解开。它原先代理的那两件事（说明条、分页器出现/消失）改成比差值，见 EPOCH_AVAIL_STEP。
    const key = [el.clientHeight, toValue(rows)?.length ?? 0, el.querySelectorAll(".ant-table-thead th").length].join("|");
    if (isNewEpoch({ key, prevKey: epoch, avail, prevAvail: epochAvail })) {
      epoch = key;
      epochAvail = avail;
      ceiling = Number.POSITIVE_INFINITY;
      seeded = false;
    }

    // 只认记录行：展开出来的子行整个不进算式（文件头那一节），所以点开一条条目
    // 不会让这一页少排一条，撑超了就直接出滚动条。
    const recordHeights = Array.from(el.querySelectorAll<HTMLElement>(ROW_SELECTOR))
      .filter((tr) => !SUB_ROW_CLASS.test(tr.className))
      .map((tr) => tr.getBoundingClientRect().height);
    if (recordHeights.length === 0) return; // 空表没有行可量，撑满那件事归 style.css 那条全站规则

    const out = nextAutoFitOf({
      avail,
      sample: { recordHeights },
      fitted: fitted.value,
      seeded,
      ceiling,
      min,
    });
    seeded = out.seeded;
    ceiling = out.ceiling;
    if (out.next !== null) fitted.value = out.next;
  }

  onMounted(() => {
    const el = toValue(container);
    if (el) {
      // observe 时就会先投递一次；面板高被工具条换行/侧栏折叠/窗口变高改变时也是它。
      observer = new ResizeObserver(() => nextTick(measure));
      observer.observe(el);
      watchBody(el);
      // 面板里**直接**子节点增删（那条说明条出现/消失）既不改面板高、也不改 tbody 高，
      // 上面两个观测都哑着，只能靠 MutationObserver。只看 childList、不看 subtree，
      // 免得行内内容一变就跑一轮。
      mutator = new MutationObserver(() => nextTick(measure));
      mutator.observe(el, { childList: true });
    }
    // 这两个 watch 挂在 onMounted 而不是 setup 里：`watch` 注册时就会先跑一次 getter，
    // 而调用方那份列表普遍写在 useTableBehavior **下面**（TDZ，const 还没初始化）。
    // 用 setup 里拿到的 scope.run 包一层，是为了让它们仍然随组件销毁 —— 生命周期钩子
    // 只把 currentInstance 设上（runtime-core 的 injectHook），没有把作用域设上。
    const register = () => {
      // 数据是异步来的：面板高没变，可行从无到有，只有这一路能捞到首屏那一次
      watch(
        () => toValue(rows),
        () => nextTick(measure),
      );
      // 写回的条数换掉了一批行 → 把 ② 再跑一次
      watch(fitted, () => nextTick(measure));
    };
    if (scope) scope.run(register);
    else register();
    nextTick(measure);
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    mutator?.disconnect();
    observer = null;
    mutator = null;
    observedBody = null;
  });

  return { fitted };
}
