/**
 * remote-cache-index.ts — Level 2 of tiered playback: Pre-cached Telegram index.
 *
 * Hamara DownloadDost bot hazaaron verified gaane "Cache MusicDost" Telegram
 * channel me rakhta hai. Unki index `tg_cache.json` GitHub par sync hoti hai:
 *   https://raw.githubusercontent.com/omeehathnoda/musicdost-backend/main/tg_cache.json
 * Format: { "title|artist": "<telegram_file_id>", ... }
 *
 * Ye module:
 *  1. Index ko background me download karke locally cache karta hai
 *     (AsyncStorage me meta + FileSystem me JSON, 24h TTL).
 *  2. `lookupRemoteCache(title, artist)` — instant O(1) check: kya ye gaana
 *     hamare pre-cached database me hai?
 *  3. Hit par backend ka /api/stream use hota hai jo Telegram cache se
 *     turant serve karta hai — JioSaavn/YT search ka lag nahi!
 *
 * NOTE: Telegram file_id se direct URL banane ke liye bot token chahiye
 * (secret!) — isliye actual streaming hamesha backend ke /api/stream se
 * hoti hai. Ye module sirf "availability check" ka fast path hai.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const INDEX_URL =
  'https://raw.githubusercontent.com/omeehathnoda/musicdost-backend/main/tg_cache.json';
const INDEX_META_KEY = 'md_remote_index_meta_v1';
const INDEX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** In-memory index: normalized "title|artist" -> telegram file_id */
let memoryIndex: Record<string, string> | null = null;
let indexReady = false;
let indexLoading: Promise<boolean> | null = null;

/** Bot ke cache_key() jaisa normalization: lowercase "title|artist" */
export function remoteCacheKey(title: unknown, artist: unknown): string {
  const clean = (s: unknown): string =>
    (typeof s === 'string' ? s : '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${clean(title)}|${clean(artist)}`;
}

function getIndexFileUri(): string | null {
  const base = FileSystem.cacheDirectory;
  if (!base) return null;
  return `${base}md_remote_index.json`;
}

async function loadFromDisk(): Promise<Record<string, string> | null> {
  try {
    const uri = getIndexFileUri();
    if (!uri) return null;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveToDisk(index: Record<string, string>): Promise<void> {
  try {
    const uri = getIndexFileUri();
    if (!uri) return;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(index));
    await AsyncStorage.setItem(
      INDEX_META_KEY,
      JSON.stringify({ fetchedAt: Date.now(), count: Object.keys(index).length })
    );
  } catch (e) {
    console.warn('[remote-index] save failed:', e);
  }
}

async function isIndexFresh(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_META_KEY);
    if (!raw) return false;
    const meta = JSON.parse(raw);
    const age = Date.now() - (meta?.fetchedAt || 0);
    return age < INDEX_TTL_MS && (meta?.count || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Index ensure karo. Pehle memory → phir disk (fresh) → phir network.
 * Kabhi throw nahi karta — fail par false return (L3 fallback chalega).
 */
export async function ensureRemoteIndex(): Promise<boolean> {
  if (indexReady && memoryIndex) return true;
  if (indexLoading) return indexLoading;

  indexLoading = (async (): Promise<boolean> => {
    try {
      // 1. Disk par fresh index hai to wahi use karo (instant, no network)
      if (await isIndexFresh()) {
        const disk = await loadFromDisk();
        if (disk && Object.keys(disk).length > 0) {
          memoryIndex = disk;
          indexReady = true;
          console.log(`[remote-index] loaded from disk: ${Object.keys(disk).length} entries`);
          // Background me refresh bhi kar do (stale na rahe)
          void refreshRemoteIndex();
          return true;
        }
      }

      // 2. Network se fresh download
      return await refreshRemoteIndex();
    } catch (e) {
      console.warn('[remote-index] ensure failed:', e);
      return false;
    } finally {
      indexLoading = null;
    }
  })();

  return indexLoading;
}

/**
 * GitHub se fresh index download karo. Background refresh ke liye bana hai.
 */
export async function refreshRemoteIndex(): Promise<boolean> {
  try {
    const res = await fetch(INDEX_URL);
    if (!res.ok) {
      console.warn(`[remote-index] download failed: HTTP ${res.status}`);
      // Stale disk copy se kaam chalao
      const disk = await loadFromDisk();
      if (disk && Object.keys(disk).length > 0) {
        memoryIndex = disk;
        indexReady = true;
        return true;
      }
      return false;
    }
    const parsed = await res.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid index format');
    }
    memoryIndex = parsed as Record<string, string>;
    indexReady = true;
    await saveToDisk(memoryIndex);
    console.log(`[remote-index] refreshed: ${Object.keys(memoryIndex).length} entries`);
    return true;
  } catch (e) {
    console.warn('[remote-index] refresh failed:', e);
    return indexReady;
  }
}

/**
 * LEVEL 2 CHECK — kya ye gaana hamare pre-cached Telegram database me hai?
 * Instant O(1) lookup, koi network nahi (index pehle se loaded).
 *
 * @returns telegram file_id agar hit, warna null
 */
export function lookupRemoteCache(
  title: unknown,
  artist: unknown
): string | null {
  if (!indexReady || !memoryIndex) return null;
  try {
    const key = remoteCacheKey(title, artist);
    const fileId = memoryIndex[key];
    return typeof fileId === 'string' && fileId.length > 0 ? fileId : null;
  } catch {
    return null;
  }
}

/** Index loaded hai aur lookup ke liye ready? */
export function isRemoteIndexReady(): boolean {
  return indexReady && memoryIndex !== null;
}

/** Index me kul kitne gaane hain? (Settings/debug me dikhane ke liye) */
export function getRemoteIndexCount(): number {
  return memoryIndex ? Object.keys(memoryIndex).length : 0;
}

/**
 * App start par background me index warm karo. Fire-and-forget —
 * kabhi throw nahi karta, UI block nahi hota.
 */
export function warmRemoteIndex(): void {
  void ensureRemoteIndex().catch(() => {});
}
