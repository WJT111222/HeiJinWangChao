import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

// M0 仅验证存储测试环境，不定义 GameSave 或提供运行时存档服务。
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('m0-storage-test', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('fixtures', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('事务已中止'));
    transaction.onerror = () => reject(transaction.error);
  });
}

function readFixture(database: IDBDatabase, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('fixtures', 'readonly');
    const request = transaction.objectStore('fixtures').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDB 测试环境', () => {
  it('数据写入后关闭并重开数据库，仍可完整读取', async () => {
    const factory = new IDBFactory();
    const database = await openDatabase(factory);
    const fixture = { id: 'm0-fixture', title: '黑金王朝 · 读写样例', entries: ['中文原文'] };

    try {
      const transaction = database.transaction('fixtures', 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore('fixtures').put(fixture);
      await done;
    } finally {
      database.close();
    }

    const reopened = await openDatabase(factory);
    try {
      expect(await readFixture(reopened, fixture.id)).toEqual(fixture);
    } finally {
      reopened.close();
    }
  });

  it('中止写入事务时，不保留部分数据', async () => {
    const database = await openDatabase(new IDBFactory());
    try {
      const transaction = database.transaction('fixtures', 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore('fixtures').put({ id: 'aborted', title: '未提交样例' });
      transaction.abort();
      await expect(done).rejects.toThrow();
      expect(await readFixture(database, 'aborted')).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
