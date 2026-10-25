/**
 * 串行队列（`src/shared/serialQueue.ts`）。
 *
 * 用户 2026-10-25：「这个把他删除之后又自己跑出来了」。根因是 `keepUploadTask` 的更新与删除
 * 各自「读整份 blob → 改 → 写回」，两条操作之间没有互斥：删除落在一次在途更新的读与写之间时，
 * 更新写回的那份旧快照会把刚删掉的任务原样带回（创建时间都还是旧的）。
 * 队列本身只是「按调用顺序一个跑完再跑下一个」，所以这里钉两件事：
 * - 顺序：在途更新先跑完，删除才跑，最终状态是删除；
 * - 失败隔离：一次存储异常不能把这把锁永久堵死（否则这个键此后再也写不进去）。
 */
import { describe, expect, it } from "vitest";

import { createSerialQueue } from "@/shared/serialQueue.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSerialQueue", () => {
  it("按入队顺序串行：前一个没结束，后一个不开始", async () => {
    const enqueue = createSerialQueue();
    const gate = deferred();
    const order: string[] = [];

    const first = enqueue(async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
      return "first";
    });
    const second = enqueue(async () => {
      order.push("second");
      return "second";
    });

    await sleep(0);
    expect(order).toEqual(["first:start"]);

    gate.resolve();
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("删除不会被在途的整条写回带回（读—改—写之间不许插队）", async () => {
    const enqueue = createSerialQueue();
    /** 模拟 `keepUploadTask`：整份 blob 里装着几条任务 */
    const store: Record<string, { title: string; autoState?: number }> = {
      taskA: { title: "Cyberpunk Edgerunners" },
      taskB: { title: "别的任务" },
    };

    const update = enqueue(async () => {
      const snapshot = structuredClone(store); // 读整份
      await sleep(20); // 下载器请求还没回来
      snapshot.taskA = { ...snapshot.taskA, autoState: 1 }; // 改一条
      // 写回整份（真实实现写的是 storage，这里落到同一个对象上）
      for (const key of Object.keys(store)) delete store[key];
      Object.assign(store, snapshot);
    });
    const remove = enqueue(async () => {
      delete store.taskA;
    });

    await Promise.all([update, remove]);
    expect(store.taskA).toBeUndefined();
    expect(store.taskB).toEqual({ title: "别的任务" });
  });

  it("前一个失败只回给它自己的调用者，队列继续往下跑", async () => {
    const enqueue = createSerialQueue();
    const failed = enqueue(async () => {
      throw new Error("boom");
    });
    const next = enqueue(async () => "ok");

    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
    // 失败之后仍然能继续入队
    await expect(enqueue(async () => "after")).resolves.toBe("after");
  });
});
