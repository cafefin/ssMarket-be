export interface StoredFile {
  data: Buffer;
  contentType: string;
}

/**
 * Where uploaded files live. Modules depend on this class only, so the local
 * disk implementation can be replaced by object storage without touching them.
 */
export abstract class StorageService {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<StoredFile | null>;
  abstract delete(key: string): Promise<void>;
}
