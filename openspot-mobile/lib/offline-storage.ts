/**
 * offline-storage.ts — MusicDost AUTO-CACHE (private) storage.
 *
 * Om ki SAHI demand (2026-10-03, corrected — pehle ulta implement ho gaya tha):
 *   1. Manual DOWNLOAD (user download button dabaye) → phone ke PUBLIC
 *      storage me (Music/MusicDost/) — dusre music players me DIKHE.
 *      → iska logic lib/public-download.ts + DownloadButton.tsx me hai.
 *   2. Auto-CACHE (gaana bas play kiya, download button NAHI dabaya) →
 *      app ke PRIVATE storage me (md_private/cache/) — SIRF app ke andar,
 *      dusre music players / file manager me NA dikhe. Dobara play par
 *      pehle cache check hoga — mile to bina internet ke instant bajega.
 *
 * Cache keys: `cache_<trackId>` → { fileUri, cachedAt }
 * Downloads screen sirf `offline_` keys + 'offline' playlist padhti hai,
 * isliye cached gaane Downloads me KABHI NAHI dikhenge.
 */
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Track } from '../types/music';

const PRIVATE_DIR_NAME = 'md_private';
const CACHE_DIR_NAME = 'cache';
const NOMEDIA_NAME = '.nomedia';
const CACHE_KEY_PREFIX = 'cache_';

/** In-progress cache downloads (double-download se bachne ke liye). */
const cachingTrackIds = new Set<string>();

/**
 * Track ID → safe filename key. Hamare server ke IDs me `|`, spaces,
 * commas hote hain ("title|artist") — inhe seedha filename me use karne
 * se Android FileSystem crash ho jata tha (bug 2026-10-03). Sirf
 * alphanumeric/dash/underscore + chhota hash suffix (collision-safe).
 */
export function safeFileKey(rawId: string | number | null | undefined): string {
  const raw = (rawId ?? 'unknown').toString();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `${safe}_${Math.abs(hash).toString(36)}`;
}

/** App-private root dir URI (Player ke share-temp ke liye bhi use hota hai). */
export function getPrivateDirUri(): string | null {
  const base = FileSystem.documentDirectory;
  if (!base) return null;
  return `${base}${PRIVATE_DIR_NAME}/`;
}

/** Private root dir ensure karo (idempotent). */
export async function ensurePrivateDir(): Promise<string> {
  const dir = getPrivateDirUri();
  if (!dir) throw new Error('Storage not available');
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/** Auto-cache dir URI: <private>/cache/ */
export function getCacheDirUri(): string | null {
  const root = getPrivateDirUri();
  if (!root) return null;
  return `${root}${CACHE_DIR_NAME}/`;
}

/**
 * Cache dir + .nomedia ensure karo. Idempotent — baar-baar call safe.
 * `.nomedia` taaki koi media scanner is folder ko index na kare.
 */
export async function ensureCacheDir(): Promise<string> {
  const dir = getCacheDirUri();
  if (!dir) throw new Error('Storage not available');

  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const nomediaUri = `${dir}${NOMEDIA_NAME}`;
  const nomediaInfo = await FileSystem.getInfoAsync(nomediaUri);
  if (!nomediaInfo.exists) {
    await FileSystem.writeAsStringAsync(nomediaUri, '');
  }

  return dir;
}

/** Is track ke liye cache file ka full URI. */
export async function getCacheFileUri(
  trackId: string | number | null | undefined
): Promise<string> {
  const dir = await ensureCacheDir();
  return `${dir}cache_${safeFileKey(trackId)}.mp3`;
}

export interface CacheEntry {
  fileUri: string;
  cachedAt: string;
}

/**
 * Cache entry nikalo — sirf tab jab file abhi bhi disk par hai.
 * Stale entry mile to saaf karke null return.
 */
export async function getCacheEntry(
  trackId: string | number | null | undefined
): Promise<CacheEntry | null> {
  if (trackId == null) return null;
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}${trackId}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (typeof entry?.fileUri !== 'string') {
      await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}${trackId}`);
      return null;
    }
    const info = await FileSystem.getInfoAsync(entry.fileUri);
    if (!info.exists) {
      await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}${trackId}`);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function saveCacheEntry(
  trackId: string | number,
  fileUri: string
): Promise<void> {
  await AsyncStorage.setItem(
    `${CACHE_KEY_PREFIX}${trackId}`,
    JSON.stringify({ fileUri, cachedAt: new Date().toISOString() })
  );
}

export async function isTrackCached(
  trackId: string | number | null | undefined
): Promise<boolean> {
  return (await getCacheEntry(trackId)) !== null;
}

/**
 * TASK 2 (2026-10-03): Resilient resumable downloader with exponential
 * backoff. downloadAsync connection drop par silently fail karta tha —
 * ab DownloadResumable + 3 retries (2s, 4s, 8s delays).
 */
async function resilientDownload(
  url: string,
  destUri: string,
  maxRetries = 3
): Promise<void> {
  const delays = [2000, 4000, 8000]; // exponential backoff
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const download = FileSystem.createDownloadResumable(url, destUri, {});
      const result = await download.downloadAsync();

      if (!result || !result.uri) {
        throw new Error('Download failed — no result URI');
      }

      // Strict HTTP validation: sirf 200/206 accept karo.
      // 401/403/500 par HTML error page .mp3 banke save NAHI hoga!
      if (result.status !== 200 && result.status !== 206) {
        throw new Error(
          `Server error (HTTP ${result.status}) — fail explicitly, no save`
        );
      }

      const info = await FileSystem.getInfoAsync(result.uri);
      if (!info.exists || (info.size ?? 0) < 1024) {
        throw new Error('Downloaded file is empty or corrupt');
      }

      return; // success!
    } catch (e: any) {
      lastError = e;
      // Non-retryable: auth errors (401/403) par retry bekar hai
      const msg = String(e?.message || '');
      if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
        throw e;
      }
      if (attempt < maxRetries) {
        const delay = delays[attempt] ?? 8000;
        console.log(
          `[resilient-download] attempt ${attempt + 1} failed, ` +
            `retrying in ${delay}ms: ${msg.slice(0, 80)}`
        );
        await new Promise((r) => setTimeout(r, delay));
        // Partial file saaf karo taaki resume clean ho
        try {
          await FileSystem.deleteAsync(destUri, { idempotent: true });
        } catch {}
      }
    }
  }
  throw lastError || new Error('Download failed after retries');
}

/**
 * Gaana background me cache karo. Fire-and-forget ke liye bana hai —
 * kabhi throw nahi karta, UI block nahi hota, koi notification nahi.
 *
 * Rules:
 *  - Manual download (offline_<id>) maujood ho to skip (redundant).
 *  - Pehle se cached ho ya caching chal rahi ho to skip.
 *  - Sirf http(s) stream URLs cache hote hain.
 *  - HTTP status + min-size validate; fail par partial file saaf.
 */
export async function cacheTrackInBackground(
  track: Track,
  streamUrl: string
): Promise<void> {
  if (!track || track.id == null) return;
  if (typeof streamUrl !== 'string' || !/^https?:\/\//i.test(streamUrl)) return;

  const idStr = track.id.toString();
  if (cachingTrackIds.has(idStr)) return;

  try {
    // Manual download hai to cache ki zaroorat nahi
    try {
      const offlineRaw = await AsyncStorage.getItem(`offline_${idStr}`);
      if (offlineRaw) {
        const { fileUri } = JSON.parse(offlineRaw);
        if (typeof fileUri === 'string') {
          const info = await FileSystem.getInfoAsync(fileUri);
          if (info.exists) return;
        }
      }
    } catch {
      /* ignore — cache karke dekho */
    }

    if (await getCacheEntry(track.id)) return;

    cachingTrackIds.add(idStr);
    const destUri = await getCacheFileUri(track.id);

    // TASK 2: Resilient resumable download (3 retries, exponential backoff)
    await resilientDownload(streamUrl, destUri);

    await saveCacheEntry(track.id, destUri);
    console.log(`[auto-cache] cached: ${track.title} — ${track.artist}`);
  } catch (e) {
    console.warn('[auto-cache] failed (non-fatal):', e);
    try {
      const destUri = await getCacheFileUri(track.id);
      await FileSystem.deleteAsync(destUri, { idempotent: true });
    } catch {
      /* ignore */
    }
  } finally {
    cachingTrackIds.delete(idStr);
  }
}

/** Poora auto-cache saaf karo (Settings → Clear Cache). */
export async function clearCache(): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_KEY_PREFIX));
    for (const key of cacheKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry;
          if (typeof entry?.fileUri === 'string') {
            try {
              const info = await FileSystem.getInfoAsync(entry.fileUri);
              if (info.exists) {
                bytes += info.size ?? 0;
                await FileSystem.deleteAsync(entry.fileUri, {
                  idempotent: true,
                });
                files++;
              }
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* corrupt entry — key to hatao */
      }
      await AsyncStorage.removeItem(key);
    }
    // cache dir khaali ho gayi to use bhi hata do (agli baar dobara ban jayegi)
    try {
      const dir = getCacheDirUri();
      if (dir) await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[auto-cache] clearCache failed:', e);
  }
  return { files, bytes };
}

/** Cache ka kul size (bytes) — Settings me dikhane ke liye. */
export async function getCacheSize(): Promise<number> {
  let total = 0;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_KEY_PREFIX));
    for (const key of cacheKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry;
          if (typeof entry?.fileUri === 'string') {
            const info = await FileSystem.getInfoAsync(entry.fileUri);
            if (info.exists) total += info.size ?? 0;
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}
