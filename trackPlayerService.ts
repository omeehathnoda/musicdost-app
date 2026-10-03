import TrackPlayer, { Event } from 'react-native-track-player';
import { MusicAPI } from './lib/music-api';

/**
 * Fresh stream URL lao backend se (token expire / Render restart ke baad).
 * activeTrack me id/title/artist hota hai — usi se dobara resolve karo.
 */
async function fetchFreshStreamUrl(activeTrack: any): Promise<string | null> {
  try {
    const trackId = String(activeTrack?.id || '');
    if (!trackId) return null;
    // Minimal track object — getStreamUrl ko id + title/artist chahiye
    const track = {
      id: trackId,
      title: activeTrack?.title || '',
      artist: activeTrack?.artist || '',
    };
    const url = await MusicAPI.getStreamUrl(trackId, track as any);
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return url;
    }
    return null;
  } catch (e) {
    console.warn('[playback-service] fetchFreshStreamUrl failed:', e);
    return null;
  }
}

export default async function trackPlayerService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      await TrackPlayer.skipToNext();
      await TrackPlayer.play();
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      await TrackPlayer.skipToPrevious();
      await TrackPlayer.play();
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, async (e: any) => {
    try {
      await TrackPlayer.seekTo((e as any).position);
    } catch {}
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async (error: any) => {
    console.warn('Playback error caught:', error);
    try {
      const activeTrack = await TrackPlayer.getActiveTrack();
      if (activeTrack && activeTrack.id) {
        // 1. Fetch fresh stream URL from backend using track details
        const freshStreamUrl = await fetchFreshStreamUrl(activeTrack);

        if (freshStreamUrl) {
          // 2. Update current track metadata in player queue
          await TrackPlayer.updateMetadataForTrack((activeTrack as any).index, {
            ...activeTrack,
            url: freshStreamUrl
          });

          // 3. Automatically resume playback
          await TrackPlayer.play();
        }
      }
    } catch (err) {
      console.error('Failed to auto-recover playback stream:', err);
    }
  });
}

