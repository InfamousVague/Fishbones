import { invoke } from "@tauri-apps/api/core";

export async function cacheRead(bookId: string, key: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("cache_read", { bookId, key });
    return v ?? null;
  } catch {
    return null;
  }
}

export async function cacheWrite(bookId: string, key: string, contents: string): Promise<void> {
  try {
    await invoke("cache_write", { bookId, key, contents });
  } catch {
    /* ignore — cache is best-effort */
  }
}
