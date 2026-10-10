/**
 * CookieCloud是一个和自架服务器同步Cookie的小工具，可以将浏览器的Cookie及Local storage同步到手机和云端，它内置端对端加密。
 * homepage: https://github.com/easychen/CookieCloud
 *
 * 我们可以利用它的API来作为一个简单的备份服务器。
 * 需要配置：
 *   - url: CookieCloud 服务器地址
 *   - uuid: 你在该 CookieCloud 的身份识别信息，注意，插件仅同步已添加站点的cookies，所以尽量和该 CookieCloud 上使用的其他 uuid 不同
 *   - password: CookieCloud 下用于加解密的密码，
 * 注意：
 *  1. CookieCloud 不支持历史记录，所以 list 方法只返回当前的情况
 *  2. CookieCloud 不支持删除记录，当调用 delete 时，我们会更新服务器数据为 { cookie_data: {} }
 *  3. local_storage_data 照传（值为空对象），因为它是接口要求的字段；插件独有的数据放在 ptd_data 里。
 *     实际提交格式见下方 ICookieCloudFile 与 fileData 的构造：
 *     { cookie_data, local_storage_data(空), ptd_data, manifest }
 *     注意：原注释写的 { cookie_data, ptd_data, metadata } 错了两个键 —— 既漏了 local_storage_data、
 *     又把 manifest 写成了 metadata。照它对接服务端会错。
 *  4. 使用公用 CookieCloud 可能存在数据丢失、泄露的风险，同时 CookieCloud Server 也有备份文件大小的限制
 */

import CryptoJS from "crypto-js";
import axios, { type AxiosRequestConfig } from "axios";
import AbstractBackupServer from "../AbstractBackupServer.ts";
import { localSort, describeRequestError } from "../utils.ts";
import type {
  IBackupConfig,
  IBackupData,
  IBackupFileInfo,
  IBackupFileListOption,
  IBackupFileManifest,
  IBackupMetadata,
} from "../type.ts";

interface CookieCloudConfig extends IBackupConfig {
  config: {
    address: string;
    uuid: string;
    password: string;
    headers: string;
  };
}

export const serverConfig: CookieCloudConfig = {
  name: "CookieCloud",
  type: "CookieCloud",
  config: { address: "https://cookiecloud.example.com/", uuid: "", password: "", headers: "" },
};

export const serverMetaData: IBackupMetadata<CookieCloudConfig> = {
  description:
    "CookieCloud是一个和自架服务器同步Cookie的小工具，可以将浏览器的Cookie同步到手机和云端，它内置端对端加密。",
  requiredField: [
    { name: "地址", key: "address", type: "string" },
    {
      name: "UUID",
      key: "uuid",
      type: "string",
      description: "CookieCloud 的身份识别信息，建议不与其他已使用的UUID相同",
    },
    { name: "密码", key: "password", type: "string", description: "CookieCloud 后端强制加密，且不使用全局加密的密钥" },
    {
      name: "Headers",
      key: "headers",
      type: "strings",
      description: "CookieCloud 的鉴权 Headers，如果没有，请留空。如果有，则一行一个，格式为 key: value",
    },
  ],
};

interface ICookieCloudManifest extends IBackupFileManifest {
  encryption: true;
  fileName: string;
  path: string;
  time: number;
  size: "N/A";
}

interface ICookieCloudFile {
  cookie_data: Record<string, chrome.cookies.Cookie[]>;
  local_storage_data: {};
  ptd_data: Omit<IBackupData, "manifest" | "cookies">;
  manifest: ICookieCloudManifest;
}

export default class CookieCloud extends AbstractBackupServer<CookieCloudConfig> {
  protected version = "0.0.1";

  override get encryptionKey() {
    return this.userConfig.password!;
  }

  private async request<T>(url: string, config: AxiosRequestConfig = {}) {
    const headers = {
      ...(config.headers ?? {}),
      "Content-Type": "application/json",
    };

    if (this.userConfig.headers?.trim().length > 0) {
      const extraHeaderPairs = this.userConfig.headers!.trim().split("\n");
      for (const extraHeaderPair of extraHeaderPairs) {
        const line = String(extraHeaderPair).trim();
        if (!line) continue;
        // ⚠️ 原来用 split(":") 取第 [1] 段，值里只要还有一个冒号就被截断（实测）：
        //   "X-Token: abc:def"                            → " abc"
        //   "Cookie: a=1; expires=Wed, 01 Jan 12:30:00"    → " a=1; expires=Wed, 01 Jan 12"
        //   "Proxy-Authorization: Bearer 1:2:3"            → " Bearer 1"
        // 值里只有一个冒号的那些（如 "Authorization: Basic xxx"）原本是好的，
        // 但头值带着一个前导空格没人 trim。改成只在**第一个**冒号处切、两侧去空白。
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (!name) continue;
        (headers as Record<string, string>)[name] = value;
      }
    }

    return axios.request<T>({
      baseURL: this.userConfig.address,
      url,
      ...config,
      headers,
    });
  }

  public async ping(): Promise<boolean> {
    try {
      const pingResp = await this.request<string>("", { responseType: "text" });
      return pingResp.data?.includes("Hello World!API ROOT =") || false;
    } catch (e) {
      // 只打摘要：AxiosError 里带着自定义鉴权头（见 request）
      console?.warn(`[CookieCloud] ping failed: ${describeRequestError(e)}`);
    }
    return false;
  }

  public async addFile(fileName: string, file: IBackupData): Promise<boolean> {
    const manifest = {
      ...(file.manifest ?? {}),
      encryption: true,
      fileName,
      path: "",
      size: "N/A",
      files: {}, // 这里我们制空，减少上传体积
    } as ICookieCloudManifest;

    const fileData: ICookieCloudFile = {
      cookie_data: {},
      local_storage_data: {}, // 我们不支持 local_storage_data
      ptd_data: {},
      manifest,
    };

    /**
     * 原来这里 `delete file.cookies` / `delete file.manifest` 是**就地改调用方的入参**。
     * 现在唯一的调用方（offscreen/utils/backup.ts:165）每次自己 createBackupData、
     * 用完就丢，所以今天看不出问题；但那是个陷阱：一旦有人把同一份 IBackupData
     * 发给第二台备份服务器、或失败后重试，cookies 与 manifest 已经在第一次调用里
     * 被删掉了 —— 备份内容静默少两块，而且报错点在别的类里，根本查不到这里。
     * 备份服务器那一圈（Gist/S3/WebDAV/…）都是只读入参的，这个类不该例外。
     */
    const { cookies, manifest: _manifest, ...rest } = file;
    if (cookies) {
      fileData.cookie_data = cookies;
    }
    // manifest 不进 ptd_data（文件头已经单独放了一份），其余数据直接放进去
    fileData.ptd_data = rest as IBackupData;

    // 按照 CookieCloud 的流程对数据进行加密
    const theKey = CryptoJS.MD5(`${this.userConfig.uuid}-${this.userConfig.password}`).toString().substring(0, 16);
    const encryptedFileData = CryptoJS.AES.encrypt(JSON.stringify(fileData), theKey).toString();

    try {
      const updateResp = await this.request<{ action: "done" | "error" }>("/update", {
        method: "POST",
        data: { uuid: this.userConfig.uuid, encrypted: encryptedFileData },
      });
      return updateResp.data.action === "done";
    } catch (e) {}

    return false;
  }

  public async deleteFile(path: string): Promise<boolean> {
    // ⚠️ 原来传的是 `{ cookie: {} }`（少个 s），而 addFile 读的是 `file.cookies` ——
    // 那个字段永远取不到。两份实际上传的 payload 我跑过（.tmp-build/cookiecloud-delete-sim.mjs）：
    //   旧：cookie_data {} + ptd_data {cookie:{}}   ← 野键，谁也不读它
    //   新：cookie_data {} + ptd_data {}
    // 要说清的是：/update 是整份覆盖，所以旧写法**照样把内容清空了**，
    // 「界面报删除成功、重新拉取还是老内容」那句是不成立的（我核对过才改的注释）。
    // 真正的差处在 ptd_data 那一格：传对字段名才是「这份备份是空的」的形状，
    // 而不是带一个没人认领的 cookie 键 —— 下一次 getFile 把 ptd_data 当备份内容读回去时，
    // 读到的就是那坨野键。
    return await this.addFile("", { cookies: {} }); // 直接更新数据为 { cookie_data: {} }
  }

  public async getFile(path: string): Promise<IBackupData> {
    const fileResp = await this.request<{ encrypted: string }>(`/get/${this.userConfig.uuid}`);
    if (fileResp.data?.encrypted) {
      const theKey = CryptoJS.MD5(`${this.userConfig.uuid}-${this.userConfig.password}`).toString().substring(0, 16);
      const decrypted = CryptoJS.AES.decrypt(fileResp.data.encrypted, theKey).toString(CryptoJS.enc.Utf8);
      const parsed = JSON.parse(decrypted) as ICookieCloudFile;

      const retFile = parsed.ptd_data as IBackupData;
      retFile.cookies = parsed.cookie_data;

      // 重新构建 manifest.files
      const fileMap: Record<string, any> = {};
      for (const [key, value] of Object.entries(retFile)) {
        if (typeof value === "object") {
          fileMap[key] = true;
        }
      }

      retFile.manifest = parsed.manifest as ICookieCloudManifest;
      retFile.manifest.files = fileMap;

      // 尝试从响应头中解出 CookieCloud 的备份大小
      retFile.manifest.size = parseInt(<string>fileResp.headers?.["content-length"] ?? "0") || "N/A";

      return retFile;
    }

    throw new Error("No data found");
  }

  public async list(options: IBackupFileListOption = {}): Promise<IBackupFileInfo[]> {
    const list = [] as IBackupFileInfo[];

    const file = await this.getFile("");
    if (file.manifest) {
      list.push({
        filename: file.manifest.fileName,
        path: "",
        time: file.manifest.time!,
        size: file.manifest.size ?? "N/A",
      });
    }

    // 必须走 localSort：CookieCloud 只存单份备份，原先直接返回 list，
    // 导致备份列表的排序选项（按时间/名称/大小）对它完全无效（其余 8 个实体都调用了）。
    return localSort(list, options);
  }
}
