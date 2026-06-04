export interface TransactionMetaKey<T> {
  readonly name: string;
  readonly _type?: T;
}

type AnyTransactionMetaKey = TransactionMetaKey<unknown>;

export const createTransactionMetaKey = <T>(
  name: string,
): TransactionMetaKey<T> => ({ name });

export class TransactionMetaStore {
  private readonly values: Map<AnyTransactionMetaKey, unknown>;

  constructor(values?: Iterable<readonly [AnyTransactionMetaKey, unknown]>) {
    this.values = new Map(values);
  }

  get<T>(key: TransactionMetaKey<T>): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: TransactionMetaKey<T>, value: T): TransactionMetaStore {
    return new TransactionMetaStore([...this.values, [key, value]]);
  }

  has<T>(key: TransactionMetaKey<T>): boolean {
    return this.values.has(key);
  }
}

export const emptyTransactionMeta = new TransactionMetaStore();
