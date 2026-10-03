// noinspection ES6PreferShortImport

import { type TSiteID, EResultParseStatus } from "./base";
import type { ITorrent } from "./torrent";
import type { isoDuration } from "../utils/datetime";
import type { TSize } from "../utils/filesize";

/**
 * user     组别 0-99
 * vip      组别 100-199
 * manager  组别 200-299
 */
export type TLevelId = number;
export type TLevelName = string;
export type TLevelGroupType = "user" | "vip" | "manager";

// 以下为对应等级需求，如果不指定的话，则表示不需要该需求
export interface IImplicitUserInfo {
  interval?: isoDuration; // 需要等待的日期需求（ISO 8601 - 时间段表示法）  如 P5W 代表等待五周，P2M 代表等待二个月
  /**
   * 对 涉及体积的 其 number 类型的需求，
   *  - 使用 utils/filesize 提供的单位明确真实 Byte 数值
   *  - 使用 string 类型，如 "1.5 TB"，会自动实现转换
   */

  totalTraffic?: number | TSize; // 总流量需求
  downloaded?: number | TSize; // 下载量需求
  /**
   * 下载量需求的个别站别名（BeyondHD 的 levelRequirements 用 `download` 命名）。
   * 注意：抓取侧统一用 downloaded，本字段仅用于等级需求比较。
   */
  download?: number | TSize;
  trueDownloaded?: number | TSize; // 真实下载量需求
  uploaded?: number | TSize; // 上传量需求
  trueUploaded?: number | TSize; // 真实上传量需求
  ratio?: number | [number, number]; // 分享率需求
  trueRatio?: number | [number, number]; // 真实分享率需求

  seeding?: number; // 做种数需求
  seedingSize?: number | TSize; // 做种量需求
  specialSeedingSize?: number | TSize; // 特殊做种量需求（BeyondHD 五档等级，口径区别于 seedingSize）
  seedingTime?: number | isoDuration; // 做种时间（秒）需求，如果未获取到该字段，则类似 isoDuration，可以定义 30天 为 "30D"
  averageSeedingTime?: number | isoDuration; // 平均做种时间（秒）需求

  // 注意：部分站点（GazelleJSONAPI/KaraGarga）抓不到魔力时会写入 "N/A" 占位，
  // 因此协议类型保留 string；做数值比较前需 parseFloat 归一。
  bonus?: number | string; // 魔力值/积分需求
  seedingBonus?: number; // 做种积分需求
  bonusPerHour?: number | string; // 魔力值/积分每小时需求（同样可能为 "N/A"）
  seedingBonusPerHour?: number; // 做种积分每小时需求（如果未获取到该字段，在计算剩余小时时会回落到 bonusPerHour ）

  /**
   * bonusNeededInterval 和 seedingBonusNeededInterval 是由 levelRequirementUnMet 计算得到的**结果字段**，
   * 表示下一等级魔力差值与 bonusPerHour 相除的结果，！！请不要在 levelRequirements 中定义该值！！
   */
  bonusNeededInterval?: `${number}H`;
  seedingBonusNeededInterval?: `${number}H`;

  uploads?: number; // 发布数需求
  leeching?: number; // 下载数量需求
  snatches?: number; // 完成种子数需求
  posts?: number; // 发布帖子数需求
  adoptions?: number; // 认领种子数要求

  // 音乐站（Gazelle/Unit3D 系）特有计数需求
  perfectFlacs?: number; // 完美 FLAC 数
  uniqueGroups?: number; // 独特艺术家组/专辑组数
  groups?: number; // 独特组数（部分站命名）

  percentile?: number; // 全站百分位排名需求（Secret Cinema）
  donation?: number; // 捐赠金额需求（AlphaRatio 等）

  hnrUnsatisfied?: number; // H&R 未满足的数量需求
  hnrPreWarning?: number; // H&R 预警

  /**
   * passTime 是一个由 levelRequirementUnMet 计算得到的**结果字段**（unix 毫秒时间戳），
   * 表示满足 interval 需求的绝对达标时间；前端渲染日期时优先使用该值，避免相对差值与渲染时刻的时钟错位（#1140）
   * ！！请不要在 levelRequirements 中定义该值！！
   */
  passTime?: number;
}

export const MinNonUserLevelId = 100; // 最大等级ID

export interface ILevelRequirement extends IImplicitUserInfo {
  id: TLevelId; // 等级序列，应该是一个递增的序列，不可重复，应当小于 MaxUserLevelId - 1
  name: TLevelName; // 需要与 IUserInfo中对应的 levelName 相同
  nameAka?: TLevelName[]; // 该等级的别名，通常用在i18n环境中，name 和 nameAka[*] 的值会同步用来 判断 LevelId

  groupType?: TLevelGroupType; // 等级组别，不指定的话，默认为 user

  /**
   * 当 groupType 为 user 时，指明该等级符合保号要求
   * 注意：1、大于该等级的 user group 都需要声明该参数，否则会默认不符合保级要求
   *      2、vip 和 manager 组别的等级不需要声明该参数，因为它们不参与保级要求的计算
   *      3、封存后保号不属于该范畴
   */
  isKept?: boolean;

  privilege?: string; // 获得的特权说明
  downgrade?: string; // 降级规则的人类可读说明（不参与计算，仅展示）

  alternative?: IImplicitUserInfo[]; // 可选要求
}

export interface IUserInfo extends Omit<IImplicitUserInfo, "interval"> {
  status: EResultParseStatus;
  updateAt: number; // 更新时间
  site: TSiteID;

  id?: number | string; // 用户ID
  name?: string; // 用户名
  isDonor?: boolean; // 是否是捐赠者
  levelId?: TLevelId; // 等级ID
  levelName?: TLevelName; // 等级名称
  joinTime?: number; // 入站时间

  lastAccessAt?: number; // 最近访问时间

  messageCount?: number; // 消息数量
  invites?: number; // 可邀请名额
  invited?: number; // 已邀请用户数（Gazelle 系 community 统计）
  avatar?: string; // 头像

  // 站点页面附带的非展示类字段（供后续 API 请求复用）
  numericId?: number | string; // 站内数字 ID（部分站 API 的 userID 参数与展示用 id 不同）
  csrfToken?: string; // 页面内嵌的 CSRF token（抓取自用户页，随后转存 runtimeSettings）

  // 做种列表分页信息：Gazelle 系抓取做种量时需要翻页，该字段记录总页数
  seedingPage?: number;

  // 此处仅对变化项进行覆写，其他项不再累述
  totalTraffic?: number; // 总流量
  downloaded?: number; // 下载量
  trueDownloaded?: number; // 真实下载量
  uploaded?: number; // 上传量
  trueUploaded?: number; // 真实上传量
  ratio?: number; // 分享率
  trueRatio?: number; // 真实分享率
  seedingSize?: number; // 做种量
}

export type IUserSeedingTorrent = Pick<ITorrent, "id" | "size" | "progress" | "status">;

export interface IUserSeedingInfo {
  torrents: IUserSeedingTorrent[]; // 只有 id 和 size 的种子信息
  updateAt: number; // 更新时间
}
