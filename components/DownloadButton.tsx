import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  TouchableOpacity,
  Animated,
  Easing,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Text
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Track } from '../types/music';
import { PlaylistStorage } from '@/lib/playlist-storage';
import { buildDisplayName, saveToPublicMusic, ensureMediaLibraryPermission } from '@/lib/public-download';
import { safeFileKey } from '@/lib/offline-storage';
import { useTranslation } from 'react-i18next';
import { MusicAPI } from '../lib/music-api';


const ANIMATION_DURATION = 350;
const ANIMATION_BOUNCE_HEIGHT = -10;
const ICON_SIZE = 24;

const downloadingTrackIds: Set<string> = new Set();

interface DownloadButtonProps {
  track: Track;
  style?: StyleProp<ViewStyle>;
  onDownloaded?: (filePath: string) => void;
  iconColor?: string;
  accentColor?: string;
  showNotification: (message: string, type: 'success' | 'error') => void;
  iconSize?: number;
  showText?: boolean;
  textColor?: string;
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({
  track,
  style,
  onDownloaded,
  iconColor = '#fff',
  accentColor = '#1DB954',
  showNotification,
  iconSize,
  showText = false,
  textColor
}) => {
  const { t } = useTranslation();
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const bounceAnim = useRef(new Animated.Value(0)).current;
  const downloadRef = useRef<FileSystem.DownloadResumable | null>(null);

  // PUBLIC DOWNLOADS (2026-10-03, corrected — pehle galat-private tha):
  // Manual download → phone ke PUBLIC storage (Music/MusicDost/ via
  // MediaStore) — dusre music players me DIKHEGA.
  // Pehle file app ke temp (cache dir) me download hoti hai, phir
  // MediaStore me public copy banti hai, temp delete ho jata hai.
  //
  // FIX (2026-10-04): temp filename me track ID + timestamp — pehle sirf
  // "Title - Artist.mp3" tha, same naam ke 2 gaane collide karke corrupt
  // download banate the (yehi "download fail" ki ek wajah thi).
  const getTempFilePath = useCallback(() => {
    const base = FileSystem.cacheDirectory;
    if (!base) throw new Error('Cannot access storage directory');
    const key = safeFileKey(track?.id);
    return `${base}md_dl_${key}_${Date.now()}.mp3`;
  }, [track]);

  useEffect(() => {
    let isMounted = true;

    const checkDownloaded = async () => {
      if (!track || !track.id) return;

      try {
        const offlineData = await AsyncStorage.getItem(`offline_${track.id}`);
        if (!isMounted) return;

        if (offlineData) {
          const { fileUri } = JSON.parse(offlineData);
          if (typeof fileUri === 'string') {
            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            if (isMounted) {
              setIsDownloaded(fileInfo.exists);
            }
          } else {
            if (isMounted) setIsDownloaded(false);
            await AsyncStorage.removeItem(`offline_${track.id}`);
          }
        } else {
          if (isMounted) setIsDownloaded(false);
        }
      } catch (error) {
        console.error('Error checking download status:', error);
        if (isMounted) setIsDownloaded(false);
      }
    };

    checkDownloaded();

    return () => {
      isMounted = false;
    };
  }, [track]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (isDownloading) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: ANIMATION_BOUNCE_HEIGHT,
            duration: ANIMATION_DURATION,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 0,
            duration: ANIMATION_DURATION,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      bounceAnim.stopAnimation();
      bounceAnim.setValue(0);
    }

    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [isDownloading, bounceAnim]);

  useEffect(() => {
    if (track?.id && downloadingTrackIds.has(track.id.toString())) {
      setIsDownloading(true);
    }
  }, [track?.id]);

  const ensureDirectoryExists = async () => {
    try {
      // temp download ke liye cache dir kaafi hai (public copy MediaStore me banegi)
      const base = FileSystem.cacheDirectory;
      if (!base) throw new Error('Cannot access storage directory');
      const info = await FileSystem.getInfoAsync(base);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(base, { intermediates: true });
      }
    } catch (error) {
      console.error('Error ensuring directory exists:', error);
      throw new Error('Cannot access storage directory');
    }
  };


  // FIX (2026-10-04): Resilient download with retry — network flakiness
  // par pehle attempt me hi "Download failed" aa jata tha. Ab 3 attempts
  // (2s, 4s backoff), sirf 200/206 accept, 401/403 par turant fail.
  const resilientTempDownload = async (audioUrl: string, tempUri: string): Promise<string> => {
    const delays = [2000, 4000];
    let lastError: any = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        downloadRef.current = FileSystem.createDownloadResumable(audioUrl, tempUri, {
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        });
        const result = await downloadRef.current.downloadAsync();
        if (!result || !result.uri) {
          throw new Error('Download failed or was cancelled');
        }
        if (result.status !== 200 && result.status !== 206) {
          throw new Error(`Server error (HTTP ${result.status})`);
        }
        const info = await FileSystem.getInfoAsync(result.uri);
        if (!info.exists || (info.size ?? 0) < 1024) {
          throw new Error('Downloaded file is empty or corrupt');
        }
        return result.uri;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');
        // Auth errors par retry bekar hai
        if (msg.includes('401') || msg.includes('403')) throw e;
        if (attempt < delays.length) {
          console.log(`[download] attempt ${attempt + 1} failed, retrying: ${msg.slice(0, 60)}`);
          try { await downloadRef.current?.cancelAsync(); } catch {}
          try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch {}
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastError || new Error('Download failed after retries');
  };

  const handleDownload = async () => {
    if (isDownloading || isDownloaded) return;
    if (!track || !track.id) {
      console.error("Cannot download: Track or track.id is undefined.");
      showNotification(t('components.download_error_track_missing') || 'Could not download track. Track data is missing.', 'error');
      return;
    }

    // FIX (2026-10-04): Permission UP FRONT mango — pehle download shuru
    // hota tha, phir MediaStore save par permission fail karke poora
    // download waste ho jata tha ("Download click par fail" ki main wajah).
    // Ab pehle hi pata chal jayega.
    const hasPermission = await ensureMediaLibraryPermission();
    if (!hasPermission) {
      showNotification(
        t('components.download_permission_needed') || 'Storage permission needed — please allow access to save music.',
        'error'
      );
      return;
    }

    let tempUri: string | null = null;
    try {
      setIsDownloading(true);
      downloadingTrackIds.add(track.id.toString());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      await ensureDirectoryExists();

      const trackIdStr = track.id.toString();
      const audioUrl = await MusicAPI.getDownloadUrl(trackIdStr, track);
      if (!audioUrl || typeof audioUrl !== 'string' || !audioUrl.startsWith('http')) {
        throw new Error('Could not get download link for this song');
      }

      // Unique temp file (track ID + timestamp — collision-proof)
      tempUri = getTempFilePath();

      const downloadedUri = await resilientTempDownload(audioUrl, tempUri);

      // PUBLIC SAVE (2026-10-04 MASTER FIX #2): temp → EK BAAR public save
      // (SAF → Downloads/MusicDost/, fallback → Music/). Temp cleanup
      // saveToPublicMusic ke andar hota hai. Display naam sundar rakho.
      const pub = await saveToPublicMusic(downloadedUri, buildDisplayName(track));
      tempUri = null; // saveToPublicMusic ne temp saaf kar di — finally me dobara nahi

      await AsyncStorage.setItem(`offline_${track.id}`, JSON.stringify({
        fileUri: pub.uri,
        assetId: pub.assetId,
        isPublic: true,
        savedVia: pub.via,
        thumbUri: null,
        trackData: track,
        downloadedAt: new Date().toISOString(),
      }));

      await PlaylistStorage.addTrackToPlaylists(track, ['offline']);

      setIsDownloaded(true);
      showNotification(t('components.downloaded') || 'Downloaded', 'success');

      if (onDownloaded) {
        onDownloaded(pub.uri);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    } catch (e: any) {
      console.error('Offline download failed:', e);

      try {
        if (downloadRef.current) {
          await downloadRef.current.cancelAsync();
        }
        // fail par temp file saaf karo (public me kuch gaya hi nahi)
        if (tempUri) {
          try {
            await FileSystem.deleteAsync(tempUri, { idempotent: true });
          } catch {
            /* ignore */
          }
        }
        await AsyncStorage.removeItem(`offline_${track?.id}`);
      } catch (cleanupError) {
        console.error("Error during cleanup after download failure:", cleanupError);
      }

      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      showNotification(t('components.download_failed') || `Download failed: ${errorMessage}`, 'error');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    } finally {
      setIsDownloading(false);
      if (track?.id) downloadingTrackIds.delete(track.id.toString());
      downloadRef.current = null;
    }
  };


  const renderButtonContent = () => {
    const size = iconSize || ICON_SIZE;
    if (isDownloaded) {
      return <Ionicons name="checkmark" size={size} color={iconColor} />;
    } else if (isDownloading) {
      return (
        <Animated.View style={{ transform: [{ translateY: bounceAnim }] }}>
          <Ionicons name="cloud-download-outline" size={size} color={accentColor} />
        </Animated.View>
      );
    } else {
      return <Ionicons name="download" size={size} color={iconColor} />;
    }
  };

  return (
    <TouchableOpacity
      onPress={handleDownload}
      style={[style, showText ? styles.downloadButtonWithText : styles.downloadButton]}
      activeOpacity={0.7}
      disabled={isDownloading}
    >
      {renderButtonContent()}
      {showText && (
        <Text style={[styles.downloadButtonText, { color: textColor || iconColor }]}>
          {isDownloaded ? (t('components.downloaded') || 'Downloaded') : (t('components.download') || 'Download')}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  downloadButton: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadButtonWithText: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  downloadButtonText: {
    fontSize: 10,
    marginTop: 4,
    fontWeight: '500',
  },
});