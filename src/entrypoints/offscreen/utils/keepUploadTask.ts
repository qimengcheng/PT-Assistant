/**
 * 辅种任务处理函数
 */

import { onMessage } from "@/messages.ts";
import { mergeTaskPreservingAutoState } from "@/shared/keepUploadTaskSave.ts";
import { createSerialQueue } from "@/shared/serialQueue.ts";
import type { IKeepUploadTask, TKeepUploadTaskKey, TKeepUploadTaskStorageSchema } from "@/shared/types.ts";
import { extStore } from "@/storage.ts";

const STORAGE_KEY = "keepUploadTask" as const;

/**
 * 这个键的每一次「读—改—写」都排进同一条队列。
 *
 * 为什么必须串行（用户 2026-10-25：「这个把他删除之后又自己跑出来了」）：任务都装在同一个 blob 里，
 * 更新是「读整份 → 改一条 → 写回整份」，而删除也是同一份 blob 的读—改—写。一次删除若落在
 * 某次在途更新的读与写之间，更新写回的那份**旧快照**会把刚删掉的任务原样带回来（创建时间都还是旧的）。
 * 「进页面自动回查」就会在挂载那几秒里写整条任务（认亲 / 刷新基准路径），所以这个窗口是真实存在的。
 *
 * storage.ts 里那条写队列只能把「写」串起来，读在它外面 —— 挡不住「读完之后、写之前」插进来的删除。
 * 所以这一层自己按调用顺序串起来：删除要么整段跑在更新之前，要么整段跑在它之后，不存在夹在中间。
 */
const enqueue = createSerialQueue();

/**
 * 获取所有辅种任务
 */
export function getKeepUploadTasks(): Promise<IKeepUploadTask[]> {
  return enqueue(async () => {
    const tasks = await extStore.getItem(STORAGE_KEY);
    return tasks ? Object.values(tasks as TKeepUploadTaskStorageSchema) : [];
  });
}

onMessage("getKeepUploadTasks", getKeepUploadTasks);

/**
 * 根据ID获取辅种任务
 */
export function getKeepUploadTaskById(taskId: TKeepUploadTaskKey): Promise<IKeepUploadTask | undefined> {
  return enqueue(async () => {
    const tasks = await extStore.getItem(STORAGE_KEY);
    return (tasks as TKeepUploadTaskStorageSchema)?.[taskId];
  });
}

onMessage("getKeepUploadTaskById", async ({ data: taskId }) => {
  const task = await getKeepUploadTaskById(taskId);
  return task!;
});

/**
 * 创建辅种任务
 */
export function createKeepUploadTask(task: IKeepUploadTask): Promise<void> {
  return enqueue(async () => {
    const tasks = ((await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema) || {};
    tasks[task.id] = task;
    await extStore.setItem(STORAGE_KEY, tasks);
  });
}

onMessage("createKeepUploadTask", async ({ data: task }) => {
  await createKeepUploadTask(task);
});

/**
 * 更新辅种任务
 *
 * ⚠️ 整条写回时**保住存储里那份 `autoState`**：那些「这件事提醒过没有」的标记归后台独占，
 * 而界面手里的是上一次刷新的快照（那一页 60 秒刷一次）。用户点一下「把数据移到任务目录」
 * 就把后台刚写的标记抹掉，下一轮读到 `undefined` → 同一件事又提醒一次（重复的
 * 「辅种已停止发送」就是这么来的，`othersSent` 被抹掉还会把已发出去的那几条再发一次）。
 * 判据与理由在 `@/shared/keepUploadTaskSave.ts`。
 */
export function updateKeepUploadTask(task: IKeepUploadTask): Promise<void> {
  return enqueue(async () => {
    const tasks = ((await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema) || {};
    if (tasks[task.id]) {
      tasks[task.id] = mergeTaskPreservingAutoState(tasks[task.id], task);
      await extStore.setItem(STORAGE_KEY, tasks);
    }
  });
}

onMessage("updateKeepUploadTask", async ({ data: task }) => {
  await updateKeepUploadTask(task);
});

/**
 * 后台那条自动辅种每分钟**只**往任务里写 `autoState` 这一块判据快照，不动其余字段。
 *
 * 为什么不复用上面那条整条写回：SW 那边 30 秒就可能被杀，一次 tick 手里拿的是这一轮开头读到的整条任务。
 * 把它整个写回去，就把这一分钟里用户在界面上改的东西（那颗「自动辅种」开关、换基准、改保存路径）一起盖回
 * 旧值 —— 开关被盖掉尤其难查，表现是「明明关了又自己开回来，于是种子又被自动发出去了」。
 *
 * 任务已经不在了就不写：`patchItem` 底下是 lodash 的 `set`，给一个不存在的 id 写路径会**凭空造出**
 * 一条只有 `{ autoState }` 的鬼任务，列表页第一行就在 `task.items.filter` 上抛错、整页空白。
 */
onMessage("patchKeepUploadTaskAutoState", async ({ data }) => {
  const { taskId, autoState } = data;
  await enqueue(async () => {
    const tasks = (await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema | null;
    if (!tasks || !tasks[taskId]) return;
    await extStore.patchItem(STORAGE_KEY, `${taskId}.autoState`, autoState);
  });
});

/**
 * 后台每分钟那一轮**只**往任务里写 `verify`（对账结论 + 查的时刻），不动其余字段。
 * 同上面那条：整条写回会把用户这一分钟里改的开关盖回旧值；任务不在了也不凭空造一条。
 */
onMessage("patchKeepUploadTaskVerify", async ({ data }) => {
  const { taskId, verify } = data;
  await enqueue(async () => {
    const tasks = (await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema | null;
    if (!tasks || !tasks[taskId]) return;
    await extStore.patchItem(STORAGE_KEY, `${taskId}.verify`, verify);
  });
});

/**
 * 后台每分钟那一轮**只**往任务里写 `baseLocal`（基准那份此刻在哪个目录）。
 * 同上面两条：不拿整条任务写回，任务不在了也不凭空造一条。
 */
onMessage("patchKeepUploadTaskBaseLocal", async ({ data }) => {
  const { taskId, baseLocal } = data;
  await enqueue(async () => {
    const tasks = (await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema | null;
    if (!tasks || !tasks[taskId]) return;
    await extStore.patchItem(STORAGE_KEY, `${taskId}.baseLocal`, baseLocal);
  });
});

/**
 * 删除辅种任务
 */
export function deleteKeepUploadTask(taskId: TKeepUploadTaskKey): Promise<void> {
  return enqueue(async () => {
    const tasks = ((await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema) || {};
    delete tasks[taskId];
    await extStore.setItem(STORAGE_KEY, tasks);
  });
}

onMessage("deleteKeepUploadTask", async ({ data: taskId }) => {
  await deleteKeepUploadTask(taskId);
});

/**
 * 清空所有辅种任务
 */
export function clearKeepUploadTasks(): Promise<void> {
  return enqueue(async () => {
    await extStore.setItem(STORAGE_KEY, {});
  });
}

onMessage("clearKeepUploadTasks", clearKeepUploadTasks);

/**
 * 生成唯一ID
 */
export function generateKeepUploadTaskId(): TKeepUploadTaskKey {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
