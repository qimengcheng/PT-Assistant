/**
 * this plugin is edit from ohmree/pinia-plugin-webext-storage
 */
import type { Ref } from "vue";
import { ref, unref } from "vue";
import { MutationType, PiniaPluginContext } from "pinia";

export async function persistent<T>(key: string, newValue: T, storage: chrome.storage.AreaName = "local") {
  await chrome.storage[storage].set({ [key]: JSON.parse(JSON.stringify(newValue)) });
}

export interface restoreOptions<T = any> {
  initialValue?: T | Ref<T>;
  storage?: chrome.storage.AreaName;
  writeDefaults?: boolean;
  onError?: null | ((e: any) => void);
}

export async function restore<T>(key: string, options: restoreOptions<T> = {}): Promise<T> {
  const { initialValue, storage = "local", writeDefaults = true, onError = null } = options;

  const rawInit: T = unref(initialValue)!;

  try {
    console.debug("Restoring state for key:", key, "from storage:", storage);
    const { [key]: fromStorage } = await chrome.storage[storage].get(key);
    if (fromStorage) {
      return fromStorage as T;
    } else {
      if (writeDefaults && rawInit !== null) {
        await persistent(key, rawInit, storage);
      }
      return rawInit;
    }
  } catch (e) {
    onError?.(e);
    return rawInit;
  }
}

export interface PersistedStateOptions {
  /**
   * Storage key to use.
   * @default $store.id
   */
  key?: string;

  /**
   * Where to store persisted state.
   * @default 'local'
   */
  storageArea?: chrome.storage.AreaName;

  writeDefaultState?: boolean;
  autoSaveType?: boolean | MutationType[];

  /**
   * Hook called before state is hydrated from storage.
   * @default undefined
   */
  beforeRestore?: (context: PiniaPluginContext) => void;

  /**
   * Hook called after state is hydrated from storage.
   * @default undefined
   */
  afterRestore?: (context: PiniaPluginContext) => void;

  onRestoreError?: (e: any) => void;
}

declare module "pinia" {
  export interface DefineStoreOptionsBase<S, Store> {
    /**
     * Persist store in storage.
     */
    persistWebExt?: boolean | PersistedStateOptions;
  }

  export interface PiniaCustomProperties {
    readonly $ready: Ref<boolean>;

    $save(): Promise<void>;
    $onReady(callback?: () => void): Promise<void>;
  }
}

export function piniaWebExtPersistencePlugin(context: PiniaPluginContext) {
  const {
    options: { persistWebExt },
    store,
  } = context;

  if (!persistWebExt) {
    return {};
  }

  const {
    key = store.$id,
    storageArea = "local",
    writeDefaultState = true,
    autoSaveType = false,
    beforeRestore = null,
    afterRestore = null,
    onRestoreError = null,
  } = typeof persistWebExt !== "boolean" ? persistWebExt : {};

  const $ready = ref(false);
  /**
   * 水合是否已完成。在完成之前一律忽略 $save：
   * restore() 是异步的，期间任何 mutation 触发的保存拿到的都是「默认 state」，
   * 写回storage 就等于用默认值覆盖用户配置（真实触发路径：content-script
   * 挂载后拖一下浮动按钮 → updateContentScriptPosition → $save）。
   */
  let hydrated = false;

  beforeRestore?.(context);
  let restorePromise = restore(key, {
    initialValue: store.$state,
    storage: storageArea,
    writeDefaults: writeDefaultState,
    onError: onRestoreError,
  }).then((value) => {
    store.$patch(value as unknown as typeof store.$state);
    // 必须在 afterRestore 之前置位：afterRestore 里的迁移逻辑通常先改state 再 $save，
    // 若此时 hydrated 仍为 false，那次 $save 会被上面的守卫吞掉。
    hydrated = true;
    $ready.value = true;
    afterRestore?.(context);
  });

  const $onReady = async (callback?: () => void) => {
    const promise = restorePromise || Promise.resolve();
    if (callback) {
      promise.then(callback);
    }
    return promise;
  };

  function onChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string) {
    if (areaName === storageArea && Object.hasOwn(changes, key)) {
      store.$patch(changes[key].newValue as Parameters<typeof store.$patch>[0]);
    }
  }

  chrome.storage.onChanged.addListener(onChanged);

  const $save = async (newState = store.$state) => {
    // 水合未完成时静默忽略，避免用默认 state 覆盖用户数据（见上方 hydrated 注释）
    if (!hydrated) {
      return;
    }
    chrome.storage.onChanged.removeListener(onChanged);
    try {
      // HACK: we might want to find a better way of deeply unwrapping a reactive object.
      await persistent(key, newState, storageArea);
    } catch (error) {
      // 不能裸吞：持久化失败（配额超限/序列化循环引用）必须留下线索。
      // 更关键的是这里绝不能让异常逃出去 —— 原写法把 re-add 放在 try 内，
      // 一旦 persistent 抛错，onChanged 监听就永久丢失，该 store 的跨 tab 同步彻底死掉。
      console.error(`[pinia] persist "${key}" failed`, error);
    } finally {
      // 无论成功失败都恢复监听
      chrome.storage.onChanged.addListener(onChanged);
    }
  };

  if (autoSaveType && Array.isArray(autoSaveType)) {
    // 水合完成后再挂 $subscribe，两个原因：
    // 1) restore() 内部的 $patch 本身就是一次 mutation。提前订阅会在它之后立刻触发一次
    //    「把刚读回来的值原样再写回 storage」的无谓全量序列化；
    // 2) 水合完成前的 mutation 反正会被 restore 的 $patch 直接覆盖，提前订阅只是白写。
    // afterRestore 里显式调用的 $save 不受影响 —— 它走 hydrated 已置位的正常路径。
    restorePromise.then(() => {
      store.$subscribe((mutation, state: any) => {
        // 只在开发期打印：打开自动保存后每次 mutation 都会走到这里，无条件 log 会刷屏
        if (import.meta.env.DEV) {
          console.log(`Store "${store.$id}" change subscribed: `, mutation);
        }
        if (autoSaveType.includes(mutation.type)) {
          $save(state);
        }
      });
    });
  }

  const $dispose = () => {
    chrome.storage.onChanged.removeListener(onChanged);
    store.$dispose();
  };

  return { $dispose, $save, $ready, $onReady };
}
