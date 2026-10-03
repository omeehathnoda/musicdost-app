/**
 * public-download.ts — Manual downloads → phone ke PUBLIC storage.
 *
 * Om ki SAHI demand (2026-10-03, corrected):
 *   User download button dabaye → gaana Music/MusicDost/ (MediaStore) me
 *   save ho — dusre music players (Musicolet, etc.) me DIKHE.
 *
 * Flow:
 *   1. File pehle app ke temp (cache dir) me download hoti hai.
 *   2. `expo-media-library` se MediaStore me public copy banti hai
 *      (audio → Music/ directory, filename preserve hota hai).
 *   3. Best-effort: "MusicDost" album me add.
 *   4. Temp file delete.
 *
 * NOTE: Purana (galat) behavior downloads ko app-private md_private/ me
 * rakhta tha. `migratePrivateDownloadsToPublic()` un purane entries ko
 * ek baar public me le aata hai (permission pehle se granted ho tabhi —
 * launch par permission prompt NAHI dikhaya jata).
 */
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Track } from '../types/music';

const ALBUM_NAME = 'MusicDost';
const MIGRATION_FLAG = 'md_public_migrated_v1';

/**
 * Dusre players me sundar dikhne wala filename: "Title - Artist.mp3".
 * Sirf filesystem-illegal characters hataye jate hain (spaces/dash rehte hain).
 */
export function buildDisplayName(track: Track): string {
  const clean = (s: unknown): string => {
    const str = typeof s === 'string' ? s : 'unknown';
    const cleaned = str
      .replace(/[<>:\"/\\|?*\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 60);
    return cleaned.length > 0 ? cleaned : 'unknown';
  };
  return `${clean(track?.title)} - ${clean(track?.artist)}.mp3`;
}

/** Media library permission lo (pehle se granted ho to prompt nahi). */
export async function ensureMediaLibraryPermission(): Promise<boolean> {
  try {
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.granted) return true;
    const req = await MediaLibrary.requestPermissionsAsync();
    return req.granted;
  } catch (e) {
    console.warn('[public-download] permission check failed:', e);
    return false;
  }
}

export interface PublicSaveResult {
  /** Public file URI (MediaStore, file://…) — player isse bajata hai. */
  uri: string;
  /** MediaStore asset id — delete ke kaam aata hai. */
  assetId: string;
}

/**
 * Temp file (private) → MediaStore me public copy.
 * Audio files Android par Music/ directory me jati hain.
 */
export async function saveToPublicMusic(
  tempFileUri: string,
  displayName: string
): Promise<PublicSaveResult> {
  const ok = await ensureMediaLibraryPermission();
  if (!ok) {
    throw new Error('Storage permission denied — allow access to save music');
  }

  const asset = await MediaLibrary.createAssetAsync(tempFileUri);

  // Best-effort: "MusicDost" album me daalo (kuch devices par album
  // audio ke liye support na ho — fail ho to bhi file Music/ me rahegi).
  try {
    await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
  } catch (e) {
    console.warn('[public-download] album add failed (non-fatal):', e);
  }

  return { uri: asset.uri, assetId: asset.id };
}

/**
 * Purane (galat-private) manual downloads → public storage.
 * `offline_<id>` entries jinki fileUri abhi bhi documentDirectory
 * (app-private) ke andar hai, unhe MediaStore me lao.
 *
 * Sirf tab chalti hai jab media permission PEHLE SE granted ho —
 * app launch par permission prompt kabhi nahi dikhaya jata.
 * Flag-guarded, ek baar chalegi, kabhi crash nahi karegi.
 */
export async function migratePrivateDownloadsToPublic(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(MIGRATION_FLAG);
    if (done === '1') return;

    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) return;

    const base = FileSystem.documentDirectory;
    if (!base) {
      await AsyncStorage.setItem(MIGRATION_FLAG, '1');
      return;
    }

    const keys = await AsyncStorage.getAllKeys();
    const offlineKeys = keys.filter((k) => k.startsWith('offline_'));
    let moved = 0;

    for (const key of offlineKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        const uri: unknown = data?.fileUri;
        if (typeof uri === 'string' && uri.startsWith(base)) {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists) continue;
          const name = data?.trackData
            ? buildDisplayName(data.trackData as Track)
            : `MusicDost_${Date.now()}.mp3`;
          const pub = await saveToPublicMusic(uri, name);
          data.fileUri = pub.uri;
          data.assetId = pub.assetId;
          data.isPublic = true;
          await AsyncStorage.setItem(key, JSON.stringify(data));
          await FileSystem.deleteAsync(uri, { idempotent: true });
          moved++;
        }
      } catch (e) {
        console.warn(`[public-download] migrate skipped ${key}:`, e);
      }
    }

    await AsyncStorage.setItem(MIGRATION_FLAG, '1');
    console.log(`[public-download] migrated ${moved} downloads to public storage`);
  } catch (e) {
    console.warn('[public-download] migration failed (non-fatal):', e);
  }
}
