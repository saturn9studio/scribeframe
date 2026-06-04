export interface TransactionMetaKey<T> {
  readonly name: string;
  readonly _type?: T;
}

export const createTransactionMetaKey = <T>(
  name: string,
): TransactionMetaKey<T> => ({ name });

export class TransactionMetaStore {
  private readonly values: Map<string, unknown>;

  constructor(values?: Iterable<readonly [string, unknown]>) {
    this.values = new Map(values);
  }

  get<T>(key: TransactionMetaKey<T>): T | undefined {
    return this.values.get(key.name) as T | undefined;
  }

  set<T>(key: TransactionMetaKey<T>, value: T): TransactionMetaStore {
    return new TransactionMetaStore([...this.values, [key.name, value]]);
  }

  has<T>(key: TransactionMetaKey<T>): boolean {
    return this.values.has(key.name);
  }
}

export const emptyTransactionMeta = new TransactionMetaStore();
