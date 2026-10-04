/**
 * public-download.ts — Manual downloads → phone ke PUBLIC storage.
 *
 * MASTER FIX (2026-10-04):
 *   #2 DUPLICATE FIX: Ab file SIRF EK BAAR save hoti hai —
 *      PRIMARY: SAF (Storage Access Framework) se seedha
 *               Downloads/MusicDost/ folder me (user ek baar folder
 *               select karta hai, URI persist hota hai).
 *      FALLBACK: MediaLibrary.createAssetAsync EK BAAR (album step
 *               HATA DIYA — wahi duplicate ka kaaran tha).
 *   #3 PERMISSION FIX: Permission grant hote hi AsyncStorage me save —
 *      dobara prompt nahi aata.
 *
 * Flow:
 *   1. File pehle app ke temp (cache dir) me download hoti hai.
 *   2. Temp file ko displayName ("Title - Artist.mp3") par rename karo.
 *   3. SAF ya MediaLibrary se EK BAAR public save.
 *   4. Temp file delete (hamesha).
 */
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Track } from '../types/music';

const MIGRATION_FLAG = 'md_public_migrated_v1';
// FIX #3: Permission ek baar grant → AsyncStorage me yaad rakho
const PERM_GRANTED_KEY = 'md_media_perm_granted_v1';
// FIX #2: SAF directory URI persist (user ne ek baar Downloads/MusicDost select kiya)
const SAF_DIR_KEY = 'md_saf_downloads_dir_v1';
// Base64 copy ke liye safe limit (badi file → MediaLibrary fallback)
const SAF_SIZE_LIMIT = 25 * 1024 * 1024;

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

/**
 * FIX #3: Media library permission — ek baar grant hote hi AsyncStorage
 * me save, taaki har download par popup na aaye.
 */
export async function ensureMediaLibraryPermission(): Promise<boolean> {
  try {
    // Pehle yaad kiya hua flag check karo
    const saved = await AsyncStorage.getItem(PERM_GRANTED_KEY);
    if (saved === '1') {
      const current = await MediaLibrary.getPermissionsAsync();
      if (current.granted) return true;
      // User ne settings se revoke kar diya — flag saaf karo
      await AsyncStorage.removeItem(PERM_GRANTED_KEY).catch(() => {});
    }
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.granted) {
      await AsyncStorage.setItem(PERM_GRANTED_KEY, '1').catch(() => {});
      return true;
    }
    const req = await MediaLibrary.requestPermissionsAsync();
    if (req.granted) {
      await AsyncStorage.setItem(PERM_GRANTED_KEY, '1').catch(() => {});
    }
    return req.granted;
  } catch (e) {
    console.warn('[public-download] permission check failed:', e);
    return false;
  }
}

export interface PublicSaveResult {
  /** Public file URI — player isse bajata hai. */
  uri: string;
  /** Asset/file id — delete ke kaam aata hai. */
  assetId: string;
  /** Kahan save hua: 'saf' (Downloads/MusicDost) ya 'medialibrary' (Music/) */
  via: 'saf' | 'medialibrary';
}

/**
 * FIX #2 (PRIMARY): SAF se seedha Downloads/MusicDost/ me save.
 * User pehli baar folder select karta hai (system picker) — URI persist
 * hota hai, dobara nahi poochha jata. File EK HI BAAR likhi jati hai.
 * Returns null agar SAF available/fail ho → fallback use karo.
 */
async function saveViaSAF(tempFileUri: string, displayName: string): Promise<PublicSaveResult | null> {
  try {
    const SAF: any = (FileSystem as any).StorageAccessFramework;
    if (!SAF || typeof SAF.requestDirectoryPermissionsAsync !== 'function') {
      return null;
    }

    let dirUri = await AsyncStorage.getItem(SAF_DIR_KEY).catch(() => null);

    if (!dirUri) {
      // Pehli baar: user se Downloads ke andar MusicDost folder select karwao
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm?.granted || !perm?.directoryUri) return null;
      dirUri = perm.directoryUri as string;
      await AsyncStorage.setItem(SAF_DIR_KEY, dirUri).catch(() => {});
    }

    // Badi file → base64 memory risk, MediaLibrary fallback
    const info = await FileSystem.getInfoAsync(tempFileUri);
    if (!info.exists || (info.size ?? 0) > SAF_SIZE_LIMIT) return null;

    // SAF me file banao + base64 copy (EK HI BAAR write)
    const destUri: string = await SAF.createFileAsync(dirUri, displayName, 'audio/mpeg');
    const base64 = await FileSystem.readAsStringAsync(tempFileUri, {
      encoding: (FileSystem as any).EncodingType?.Base64 ?? 'base64',
    });
    await SAF.writeAsStringAsync(destUri, base64, {
      encoding: (FileSystem as any).EncodingType?.Base64 ?? 'base64',
    });

    console.log('[public-download] SAF save OK → Downloads/MusicDost/');
    return { uri: destUri, assetId: destUri, via: 'saf' };
  } catch (e) {
    console.warn('[public-download] SAF save failed, fallback:', String((e as any)?.message || e).slice(0, 120));
    // Corrupt persisted URI ho sakta hai — clear karo taaki agli baar dobara poochhe
    await AsyncStorage.removeItem(SAF_DIR_KEY).catch(() => {});
    return null;
  }
}

/**
 * FIX #2 (FALLBACK): MediaLibrary se EK BAAR save (Music/).
 * Album step HATA DIYA — wahi kuch devices par duplicate dikhata tha.
 */
async function saveViaMediaLibrary(tempFileUri: string): Promise<PublicSaveResult> {
  const ok = await ensureMediaLibraryPermission();
  if (!ok) {
    throw new Error('Storage permission denied — allow access to save music');
  }

  let asset: MediaLibrary.Asset | null = null;
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      asset = await MediaLibrary.createAssetAsync(tempFileUri);
      if (asset && asset.id) break;
      throw new Error('MediaStore did not return an asset');
    } catch (e: any) {
      lastError = e;
      console.warn(`[public-download] createAsset attempt ${attempt + 1} failed:`, String(e?.message || e).slice(0, 100));
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  if (!asset || !asset.id) {
    throw lastError || new Error('Could not save to Music folder — try again');
  }

  // NOTE (2026-10-04): createAlbumAsync HATA DIYA — kuch devices/file-managers
  // par album ek alag copy jaisa dikhta tha (duplicate complaint).
  // File ab SIRF EK BAAR Music/ me save hoti hai.
  return { uri: asset.uri, assetId: asset.id, via: 'medialibrary' };
}

/**
 * Temp file (private) → public storage, SIRF EK BAAR.
 *
 * displayName ("Title - Artist.mp3") ab ACTUALLY use hota hai — temp file
 * ko pehle us naam par rename kiya jata hai taaki MediaStore/SAF me
 * sundar naam dikhe (pehle ugly md_dl_<id>_<ts>.mp3 jata tha).
 */
export async function saveToPublicMusic(
  tempFileUri: string,
  displayName: string
): Promise<PublicSaveResult> {
  // File exist karti hai na — pehle verify karo
  const fileInfo = await FileSystem.getInfoAsync(tempFileUri);
  if (!fileInfo.exists) {
    throw new Error('Downloaded file missing before public save');
  }
  if ((fileInfo.size ?? 0) < 1024) {
    throw new Error('Downloaded file is empty or corrupt');
  }

  // FIX: Temp file ko sundar displayName par rename karo (same directory)
  const safeName = (displayName || '').replace(/[<>:\"/\\|?*\u0000-\u001f]/g, '').trim() || `MusicDost_${Date.now()}.mp3`;
  const lastSlash = tempFileUri.lastIndexOf('/');
  const renamedUri = lastSlash >= 0 ? tempFileUri.slice(0, lastSlash + 1) + safeName : tempFileUri;
  let workUri = tempFileUri;
  try {
    if (renamedUri !== tempFileUri) {
      await FileSystem.moveAsync({ from: tempFileUri, to: renamedUri });
      workUri = renamedUri;
    }
  } catch (e) {
    console.warn('[public-download] rename failed, using original:', e);
    workUri = tempFileUri;
  }

  let result: PublicSaveResult | null = null;
  let saveError: any = null;

  // PRIMARY: SAF → Downloads/MusicDost/
  try {
    result = await saveViaSAF(workUri, safeName);
  } catch (e) {
    saveError = e;
  }

  // FALLBACK: MediaLibrary → Music/ (EK BAAR, no album)
  if (!result) {
    result = await saveViaMediaLibrary(workUri);
  }

  // Temp file hamesha saaf karo (duplicate ka dusra kaaran)
  try {
    await FileSystem.deleteAsync(workUri, { idempotent: true });
  } catch (e) {
    console.warn('[public-download] temp cleanup failed (non-fatal):', e);
  }
  // Purana temp URI bhi (agar rename hua tha to workUri == renamedUri, safe)
  if (workUri !== tempFileUri) {
    try {
      await FileSystem.deleteAsync(tempFileUri, { idempotent: true });
    } catch {}
  }

  if (!result && saveError) throw saveError;
  if (!result) throw new Error('Could not save file — try again');
  return result;
}

/**
 * Purane manual downloads → public storage (ek baar, flag-guarded).
 * Sirf tab jab permission PEHLE SE granted ho.
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
          data.savedVia = pub.via;
          await AsyncStorage.setItem(key, JSON.stringify(data));
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
