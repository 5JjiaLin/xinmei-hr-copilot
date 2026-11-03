// 基于 Polaris119 的 IndexedDB 事务仓储模式改造；增加 revision CAS 与发送账本原子提交。
import { operationKey, type Run, type Operation } from '../shared/types';

export class Repository {
  private database: Promise<IDBDatabase>;
  constructor(name = 'xinmei-hr-mock-v1') {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('runs', { keyPath: 'id' });
        request.result.createObjectStore('operations', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async latest(): Promise<Run | undefined> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const r = db.transaction('runs').objectStore('runs').get('active');
      r.onsuccess = () => resolve(r.result as Run | undefined);
      r.onerror = () => reject(r.error);
    });
  }
  async operation(account: string, candidate: string): Promise<Operation | undefined> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const r = db.transaction('operations').objectStore('operations').get(operationKey(account, candidate));
      r.onsuccess = () => resolve(r.result as Operation | undefined);
      r.onerror = () => reject(r.error);
    });
  }
  async operations(): Promise<Operation[]> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const r = db.transaction('operations').objectStore('operations').getAll();
      r.onsuccess = () => resolve(r.result as Operation[]);
      r.onerror = () => reject(r.error);
    });
  }
  // 整个事务完成才返回，不能把 request.onsuccess 当作持久化完成。
  async save(run: Run, expectedRevision: number | null, operation?: Operation): Promise<boolean> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['runs', 'operations'], 'readwrite');
      const store = tx.objectStore('runs');
      let changed = false;
      const request = store.get('active');
      request.onsuccess = () => {
        const previous = request.result as Run | undefined;
        if (expectedRevision === null ? !!previous : previous?.revision !== expectedRevision) return;
        if (operation) {
          const ops = tx.objectStore('operations');
          const opRequest = ops.get(operation.key);
          opRequest.onsuccess = () => {
            const old = opRequest.result as Operation | undefined;
            if (old && operation.state === 'PREPARED') return;
            if (old && operation.revision !== old.revision + 1) return;
            ops.put(operation);
            store.put(run);
            changed = true;
          };
        } else { store.put(run); changed = true; }
      };
      tx.oncomplete = () => resolve(changed);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('存储事务中断'));
    });
  }
  async clear(): Promise<void> {
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['runs', 'operations'], 'readwrite');
      tx.objectStore('runs').clear(); tx.objectStore('operations').clear();
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }
}
