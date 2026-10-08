/**
 * 按「这一屏实际放得下几行」实测每页条数。
 *
 * 用户的口径（2026-10-08）：「要根据页面高度自动计算最佳的每页条数，既不能出现滚动条
 * 又要把页面铺满」。原先各页的 itemsPerPage 是写死的常数（10 / 25 / 50），高屏下面板
 * 下半截全是空白，矮屏下又拖出一条滚动条。
 *
 * 这里只产出一个 `fitted`（还没量到时为 0），用不用它由调用方决定 —— 用户在尺寸选择器里
 * 显式挑过一档时不能覆盖他（判据与写法见 toPagination 的 fitSize / picked）。
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
 * 12 ↔ 13 之间跳。另外增减都只在「这一页是满页」时做：末页只剩三行时缝隙恒常很大，
 * 不加这条会一路加到把整份数据并成一页。
 *
 * 一轮（epoch）= 面板高 + 数据条数 + 可用高 + 表头单元格数；任一项变了就重新量、重新放开
 * 上限（窗口变高、筛选换数据、切语言改字号、显示列增删、面板里那条说明条出现/消失都落在
 * 这四项上）。翻页不算换轮，但换页会改 tbody 的高度，那边另有一个 ResizeObserver 负责把
 * ② 再跑一次。
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
  /**
   * 关掉时整条量算都不跑（默认一直跑）。用户挑过一档就该传 `() => false` 那种：
   * 那一档是他定的，界面上渲染的行数跟可用高对不上，量下去只会一路退到下限，
   * 白跑几轮还顺手把 fitted 变成一个以后都用不上的错值。
   */
  enabled?: () => boolean;
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

export function useAutoFitPageSize({ container, rows, min = 1, enabled }: IAutoFitPageSizeOptions) {
  const fitted = shallowRef(0);
  const scope = getCurrentScope();
  /** 本轮退到过这个值就不再往上涨回去，见文件头「那一圈为什么不会来回抖」 */
  let ceiling = Number.POSITIVE_INFINITY;
  let seeded = false;
  let epoch = "";
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
    if (enabled && !enabled()) return;
    const el = toValue(container);
    if (!el) return;

    const avail = availableHeight(el);
    if (avail <= 0) return;
    watchBody(el);

    // 轮次身份里带上 avail 本身：面板里同级块（说明条）出现/消失、分页器出现/消失都会改它，
    // 而这些都不改面板高，光靠 clientHeight 认不出来，就会拿旧条数继续铺、拖出滚动条。
    const key = [
      el.clientHeight,
      toValue(rows)?.length ?? 0,
      avail.toFixed(1),
      el.querySelectorAll(".ant-table-thead th").length,
    ].join("|");
    if (key !== epoch) {
      epoch = key;
      ceiling = Number.POSITIVE_INFINITY;
      seeded = false;
    }

    const heights = Array.from(el.querySelectorAll<HTMLElement>(ROW_SELECTOR), (tr) =>
      tr.getBoundingClientRect().height,
    );
    if (heights.length === 0) return; // 空表没有行可量，撑满那件事归 style.css 那条全站规则

    const max = Math.max(...heights);
    const sum = heights.reduce((acc, h) => acc + h, 0);
    const fullPage = fitted.value > 0 && heights.length >= fitted.value;
    let next: number;

    if (!seeded) {
      // ①：初值按平均行高，能把这一屏铺到只剩几像素
      seeded = true;
      next = Math.floor(avail / (sum / heights.length));
    } else if (!fullPage) {
      return; // 不满的一页没有「还能不能再塞一行」可判，见文件头
    } else if (sum > avail) {
      // ②a：真放进这一页的行超高了 → 往回退一行，并把这个值记成上限
      ceiling = fitted.value - 1;
      next = fitted.value - 1;
    } else if (fitted.value < ceiling && avail - sum >= max) {
      // ②b：缝隙还放得下**最高**那一行，才敢再加一行
      next = fitted.value + 1;
    } else {
      return; // 收敛
    }

    next = Math.max(min, next);
    if (next !== fitted.value) fitted.value = next;
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
