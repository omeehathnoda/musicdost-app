/**
 * tiered-playback.ts — 3-Tier Playback Architecture (2026-10-04).
 *
 * Song play trigger hote hi URL is order me resolve hota hai:
 *
 *   Level 1 — APP LOCAL CACHE (Phone Storage, instant, offline)
 *     a) Manual download  (offline_<id> → public Music/MusicDost/)
 *     b) Auto-cache       (cache_<id>  → private md_private/cache/)
 *
 *   Level 2 — REMOTE CACHE INDEX (Pre-cached Telegram database)
 *     - `tg_cache.json` index me instant lookup (20k+ verified gaane)
 *     - Hit → backend ka /api/stream Telegram CDN se turant serve karta
 *       hai — JioSaavn/YT search ka 3-5 second lag nahi!
 *     - Ye sirf "availability fast-path" hai; actual bytes backend se.
 *
 *   Level 3 — SEARCH FALLBACK (JioSaavn / YouTube via backend)
 *     - Normal MusicDostAPI.getStreamUrl(track) — backend khud
 *       JioSaavn/YT search karke stream deta hai.
 *
 * Har tier apne andar try-catch me hai — ek tier fail ho to agla
 * tier try hota hai, app kabhi crash nahi karta.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Track } from '../types/music';
import { getCacheEntry } from './offline-storage';
import {
  lookupRemoteCache,
  isRemoteIndexReady,
  ensureRemoteIndex,
} from './remote-cache-index';
import { MusicDostAPI } from './musicdost-api';

export type PlaybackTier =
  | 'local-download' // L1a: manual download (public storage)
  | 'local-cache' // L1b: auto-cache (private storage)
  | 'remote-cache' // L2: Telegram pre-cached (backend fast path)
  | 'stream-fallback'; // L3: JioSaavn/YT search via backend

export interface TieredResult {
  /** Playable URL (local file:// ya https:// stream) */
  url: string;
  /** Kaunse tier se aaya — UI/logging ke liye */
  tier: PlaybackTier;
  /** L2 hit par telegram file_id (debug/info) */
  remoteFileId?: string;
}

/** Tier ka human-readable label (player UI me "from cache" badge ke liye) */
export function tierLabel(tier: PlaybackTier): string {
  switch (tier) {
    case 'local-download':
      return 'Downloaded';
    case 'local-cache':
      return 'Cached';
    case 'remote-cache':
      return 'Instant';
    case 'stream-fallback':
      return 'Streaming';
  }
}

// ---------- Level 1: local ----------

async function tryLocalDownload(track: Track): Promise<string | null> {
  try {
    if (track?.id == null) return null;
    const raw = await AsyncStorage.getItem(`offline_${track.id}`);
    if (!raw) return null;
    const { fileUri } = JSON.parse(raw);
    if (typeof fileUri !== 'string' || !fileUri) return null;
    const info = await FileSystem.getInfoAsync(fileUri);
    return info.exists ? fileUri : null;
  } catch {
    return null;
  }
}

async function tryLocalCache(track: Track): Promise<string | null> {
  try {
    const cached = await getCacheEntry(track?.id);
    return cached ? cached.fileUri : null;
  } catch {
    return null;
  }
}

// ---------- Level 2: remote cache index ----------

/**
 * L2 check: kya ye gaana hamare Telegram pre-cache me hai?
 * Index ready nahi hai to background me load karke null return
 * (is baar L3 chalega, agli baar se L2 hit hoga).
 */
async function tryRemoteCache(track: Track): Promise<{ fileId: string } | null> {
  try {
    const title =
      (track as any)?.mdTitle || track?.title || '';
    const artist =
      (track as any)?.mdArtist || track?.artist || '';
    if (!title) return null;

    if (!isRemoteIndexReady()) {
      // Background me warm karo — is play par L3, agli baar L2
      void ensureRemoteIndex();
      return null;
    }

    const fileId = lookupRemoteCache(title, artist);
    return fileId ? { fileId } : null;
  } catch {
    return null;
  }
}

// ---------- Level 3: stream fallback ----------

async function tryStreamFallback(track: Track): Promise<string> {
  // MusicDostAPI.getStreamUrl backend se stream URL deta hai
  // (backend khud JioSaavn/YT search karta hai)
  return MusicDostAPI.getStreamUrl(track);
}

// ---------- Main resolver ----------

/**
 * 3-tier URL resolver. Hamesha koi na koi URL return karta hai ya throw.
 * Tier order: local-download → local-cache → remote-cache → stream-fallback.
 */
export async function resolveTieredUrl(track: Track): Promise<TieredResult> {
  if (!track || track.id == null) {
    throw new Error('Cannot resolve URL: track is missing');
  }

  // L1a: manual download
  const localFile = await tryLocalDownload(track);
  if (localFile) {
    return { url: localFile, tier: 'local-download' };
  }

  // L1b: auto-cache
  const cachedFile = await tryLocalCache(track);
  if (cachedFile) {
    return { url: cachedFile, tier: 'local-cache' };
  }

  // L2: remote cache index — hit par backend turant Telegram se serve karega
  const remote = await tryRemoteCache(track);
  if (remote) {
    try {
      const url = await tryStreamFallback(track);
      return { url, tier: 'remote-cache', remoteFileId: remote.fileId };
    } catch (e) {
      // L2 ka stream fail ho to L3 par giro (neeche)
      console.warn('[tiered] remote-cache stream failed, falling to L3:', e);
    }
  }

  // L3: normal stream fallback
  const url = await tryStreamFallback(track);
  return { url, tier: 'stream-fallback' };
}

/**
 * Sirf ye check karo ki gaana instant (L1/L2) available hai ya nahi —
 * bina URL resolve kiye. UI me "⚡ Instant" badge ke liye.
 */
export async function isInstantlyAvailable(track: Track): Promise<boolean> {
  if (!track || track.id == null) return false;
  if (await tryLocalDownload(track)) return true;
  if (await tryLocalCache(track)) return true;
  const remote = await tryRemoteCache(track);
  return remote !== null;
}
