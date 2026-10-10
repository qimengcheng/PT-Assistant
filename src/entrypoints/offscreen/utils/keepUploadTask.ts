/**
 * 辅种任务处理函数
 */

import { onMessage } from "@/messages.ts";
import type { IKeepUploadTask, TKeepUploadTaskKey, TKeepUploadTaskStorageSchema } from "@/shared/types.ts";
import { extStore } from "@/storage.ts";

const STORAGE_KEY = "keepUploadTask" as const;

/**
 * 获取所有辅种任务
 */
export async function getKeepUploadTasks(): Promise<IKeepUploadTask[]> {
  const tasks = await extStore.getItem(STORAGE_KEY);
  return tasks ? Object.values(tasks as TKeepUploadTaskStorageSchema) : [];
}

onMessage("getKeepUploadTasks", getKeepUploadTasks);

/**
 * 根据ID获取辅种任务
 */
export async function getKeepUploadTaskById(taskId: TKeepUploadTaskKey): Promise<IKeepUploadTask | undefined> {
  const tasks = await extStore.getItem(STORAGE_KEY);
  return (tasks as TKeepUploadTaskStorageSchema)?.[taskId];
}

onMessage("getKeepUploadTaskById", async ({ data: taskId }) => {
  const task = await getKeepUploadTaskById(taskId);
  return task!;
});

/**
 * 创建辅种任务
 */
export async function createKeepUploadTask(task: IKeepUploadTask): Promise<void> {
  const tasks = ((await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema) || {};
  tasks[task.id] = task;
  await extStore.setItem(STORAGE_KEY, tasks);
}

onMessage("createKeepUploadTask", async ({ data: task }) => {
  await createKeepUploadTask(task);
});

/**
 * 更新辅种任务
 */
export async function updateKeepUploadTask(task: IKeepUploadTask): Promise<void> {
  const tasks = ((await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema) || {};
  if (tasks[task.id]) {
    tasks[task.id] = task;
    await extStore.setItem(STORAGE_KEY, tasks);
  }
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
  const tasks = (await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema | null;
  if (!tasks || !tasks[taskId]) return;
  await extStore.patchItem(STORAGE_KEY, `${taskId}.autoState`, autoState);
});

/**
 * 删除辅种任务
 */
export async function deleteKeepUploadTask(taskId: TKeepUploadTaskKey): Promise<void> {
  const tasks = ((await extStore.getItem(STORAGE_KEY)) as TKeepUploadTaskStorageSchema) || {};
  delete tasks[taskId];
  await extStore.setItem(STORAGE_KEY, tasks);
}

onMessage("deleteKeepUploadTask", async ({ data: taskId }) => {
  await deleteKeepUploadTask(taskId);
});

/**
 * 清空所有辅种任务
 */
export async function clearKeepUploadTasks(): Promise<void> {
  await extStore.setItem(STORAGE_KEY, {});
}

onMessage("clearKeepUploadTasks", clearKeepUploadTasks);

/**
 * 生成唯一ID
 */
export function generateKeepUploadTaskId(): TKeepUploadTaskKey {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
