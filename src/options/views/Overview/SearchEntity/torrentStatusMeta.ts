import { type Component } from "vue";
import { ETorrentStatus } from "@ptd/site";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  DisconnectOutlined,
  QuestionCircleOutlined,
} from "@zboson/icons";

/**
 * 做种状态（`ITorrent.status`）的五档元数据：图标、颜色、i18n 键。
 *
 * 为什么单独一份：同一档在三个地方要长得一样 —— 高级筛选对话框的候选、搜索页那颗快速筛选下拉、
 * 以及「大小」那一列下面那行进度条的图标。原先图标/颜色只写在 `TorrentProcessTd` 的 switch 里、
 * 标签+图标+颜色又写在对话框里一份，两处各判各的，改一档要记得跑两遍。
 */
export interface ITorrentStatusMeta {
  value: ETorrentStatus;
  labelKey: string;
  /** antd 的图标组件本身（不是 mdi 字符串） */
  icon: Component;
  /** 真实色值：Vuetify 那套语义色名（info / grey / success）在 antd 的 stroke-color 上用不了 */
  color: string;
}

export const TORRENT_STATUS_META: ITorrentStatusMeta[] = [
  {
    value: ETorrentStatus.unknown,
    labelKey: "torrent.status.unknown",
    icon: QuestionCircleOutlined,
    color: "#8c8c8c",
  },
  {
    value: ETorrentStatus.downloading,
    labelKey: "torrent.status.downloading",
    icon: ArrowDownOutlined,
    color: "#1677ff",
  },
  {
    value: ETorrentStatus.seeding,
    labelKey: "torrent.status.seeding",
    icon: ArrowUpOutlined,
    color: "#52c41a",
  },
  {
    value: ETorrentStatus.inactive,
    labelKey: "torrent.status.inactive",
    icon: DisconnectOutlined,
    color: "#8c8c8c",
  },
  {
    value: ETorrentStatus.completed,
    labelKey: "torrent.status.completed",
    icon: CheckOutlined,
    color: "#8c8c8c",
  },
];

const metaByValue = new Map<ETorrentStatus, ITorrentStatusMeta>(
  TORRENT_STATUS_META.map((meta) => [meta.value, meta])
);

const unknownMeta = metaByValue.get(ETorrentStatus.unknown)!;

/**
 * 取某一档的元数据；**认不出的值一律当「未知」，不兜到某个真档位上**。
 *
 * 这条是刻意反着旧写法的：`TorrentProcessTd` 原先那个 switch 的 `default:` 返回绿色上箭头
 * （上箭头 = 「做种中」），也就是把「认不出」画成一个明确的档位。今天那一格外面还有一道
 * `Index.vue` 的 v-if 把 unknown 挡住，所以界面上看不出来；但搜索页新加的按档筛选里
 * 「未知」是一档能选的，画色不能再靠 default 兜到真档位上。
 */
export function torrentStatusMeta(status?: ETorrentStatus | null): ITorrentStatusMeta {
  return (status && metaByValue.get(status)) || unknownMeta;
}
