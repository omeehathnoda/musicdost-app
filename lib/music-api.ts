import { SearchResponse, SearchParams, Track } from '../types/music';
import { MusicApi } from './api';
import { YTMusicAPI } from './ytmusic-api';
import { MusicDostAPI } from './musicdost-api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROVIDER_KEY = 'openspot_provider_v1';

/**
 * MusicDost mode: saare core calls HAMARE Render backend se jate hain
 * (Telegram cache + iTunes + JioSaavn + YouTube — sab server par).
 *
 * Sirf album/artist browsing hamare server par nahi hai — wahan purana
 * JioSaavn API fallback rakha hai (compromise: upstream infra par nirbhar).
 */
const isMusicDostTrack = (t?: Track | 'saavn' | 'ytmusic' | null): t is Track =>
  !!t && typeof t !== 'string' && !!(t as Track).mdTitle;

export class MusicAPI {
  private static searchCache = new Map<string, Promise<SearchResponse>>();
  private static streamCache = new Map<string, Promise<string>>();
  private static recentlyPlayedStorageKey = 'openspot_recently_played_tracks_v1';
  private static recentlyPlayedLimit = 30;

  private static async getProvider(): Promise<'saavn' | 'ytmusic'> {
    try {
      const provider = await AsyncStorage.getItem(PROVIDER_KEY);
      return (provider === 'ytmusic' ? 'ytmusic' : 'saavn') as 'saavn' | 'ytmusic';
    } catch {
      return 'saavn';
    }
  }

  private static resolveProviderHint(trackOrProvider?: Track | 'saavn' | 'ytmusic'): 'saavn' | 'ytmusic' | null {
    if (!trackOrProvider) return null;
    if (trackOrProvider === 'saavn' || trackOrProvider === 'ytmusic') {
      return trackOrProvider;
    }
    return trackOrProvider.provider || null;
  }

  static async search(params: SearchParams): Promise<SearchResponse> {
    // Hamara server: sirf track search (albums/artists/playlists khaali aate hain)
    if (!params.type || params.type === 'track') {
      return MusicDostAPI.search(params);
    }
    return {
      tracks: [],
      albums: [],
      artists: [],
      playlists: [],
      pagination: { offset: 0, total: 0, hasMore: false },
    };
  }

  static async searchTracks(query: string, page: number = 1, limit: number = 20): Promise<SearchResponse> {
    const tracks = await MusicDostAPI.searchTracks(query);
    return {
      tracks,
      albums: [],
      artists: [],
      playlists: [],
      pagination: { offset: 0, total: tracks.length, hasMore: false },
    };
  }

  static async getStreamUrl(trackId: string, trackOrProvider?: Track | 'saavn' | 'ytmusic'): Promise<string> {
    // Hamare server ka track -> hamara stream URL (Telegram cache fast!)
    if (isMusicDostTrack(trackOrProvider)) {
      return MusicDostAPI.getStreamUrl(trackOrProvider);
    }
    // Purane saavn/ytmusic tracks (album/artist fallback) -> purana tareeka
    const hintedProvider = this.resolveProviderHint(trackOrProvider);
    const provider = hintedProvider || 'saavn';
    if (provider === 'ytmusic') {
      return YTMusicAPI.getStreamUrl(trackId);
    }
    return MusicApi.getStreamUrl(trackId);
  }

  static async getDownloadUrl(trackId: string, trackOrProvider?: Track | 'saavn' | 'ytmusic'): Promise<string> {
    if (isMusicDostTrack(trackOrProvider)) {
      return MusicDostAPI.getDownloadUrl(trackOrProvider);
    }
    const hintedProvider = this.resolveProviderHint(trackOrProvider);
    const provider = hintedProvider || 'saavn';
    if (provider === 'ytmusic') {
      return YTMusicAPI.getDownloadUrl(trackId);
    }

    return MusicApi.getStreamUrl(trackId);
  }

  static async getPopularTracks(): Promise<Track[]> {
    // Hamare server ka Hindi trending
    return MusicDostAPI.getPopularTracks();
  }

  static async getAlbumSongs(albumId: string): Promise<Track[]> {
    // COMPROMISE: hamare server par album browsing nahi hai -> purana JioSaavn API
    return MusicApi.getAlbumSongs(albumId);
  }

  static async getArtistSongs(artistId: string, page: number = 0): Promise<{ tracks: Track[]; total: number }> {
    // COMPROMISE: hamare server par artist browsing nahi hai -> purana JioSaavn API
    return MusicApi.getArtistSongs(artistId, page);
  }

  static async getPlaylistSongs(playlistId: string): Promise<Track[]> {
    // JioSaavn chart IDs (home language chips) -> hamare server ka trending
    const ours = await MusicDostAPI.getPlaylistSongs(playlistId);
    if (ours.length > 0) return ours;
    // COMPROMISE: baaki public playlists ke liye purana JioSaavn API
    return MusicApi.getPlaylistSongs(playlistId);
  }

  static async getPlaylistSongsPaginated(playlistId: string, page = 0): Promise<{ tracks: Track[]; total: number }> {
    return MusicApi.getPlaylistSongsPaginated(playlistId, page);
  }

  static async getRecentlyPlayed(): Promise<Track[]> {
    try {
      const stored = await AsyncStorage.getItem(this.recentlyPlayedStorageKey);
      if (!stored) return [];
      const parsed = JSON.parse(stored) as Track[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Failed to read recently played tracks:', error);
      return [];
    }
  }

  static async addToRecentlyPlayed(track: Track): Promise<void> {
    try {
      const existing = await this.getRecentlyPlayed();
      const deduped = existing.filter((item) => item.id.toString() !== track.id.toString());
      const next = [track, ...deduped].slice(0, this.recentlyPlayedLimit);
      await AsyncStorage.setItem(this.recentlyPlayedStorageKey, JSON.stringify(next));
    } catch (error) {
      console.error('Failed to save recently played track:', error);
    }
  }

  static async clearRecentlyPlayed(): Promise<void> {
    try {
      await AsyncStorage.removeItem(this.recentlyPlayedStorageKey);
    } catch (error) {
      console.error('Failed to clear recently played tracks:', error);
    }
  }

  static async getMadeForYou(): Promise<Track[]> {
    
    return MusicApi.getMadeForYou();
  }

  static async resolveTrackById(trackId: string, preferredProvider?: 'saavn' | 'ytmusic'): Promise<Track | null> {
    // Pehle hamare server par try karo
    try {
      const ours = await MusicDostAPI.searchTracks(trackId);
      if (ours.length > 0) return ours[0];
    } catch {}

    const providers: ('saavn' | 'ytmusic')[] = preferredProvider
      ? [preferredProvider, preferredProvider === 'saavn' ? 'ytmusic' : 'saavn']
      : ['saavn', 'ytmusic'];

    for (const provider of providers) {
      try {
        const response = provider === 'saavn'
          ? await MusicApi.search({ q: trackId, type: 'track' })
          : await YTMusicAPI.search({ q: trackId, type: 'track' });
        if (response.tracks.length > 0) {
          return response.tracks[0];
        }
      } catch {

      }
    }

    return null;
  }

  static formatDuration(duration: number): string {
    const seconds = Math.floor(duration);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours > 0) {
      return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  static getOptimalImage(images: { small: string; thumbnail: string; large: string } | null | undefined): string {
    // FIX (2026-10-03): corrupt track me images null/undefined ho to images.large crash karta tha
    if (!images || typeof images !== 'object') return '';
    const raw = images.large || images.small || images.thumbnail || '';
    return MusicAPI.sanitizeImageUrl(raw);
  }

  /**
   * IMAGE URL SANITIZER (2026-10-04 MASTER FIX #1):
   * JioSaavn/YouTube image URLs saaf karta hai:
   * - JioSaavn: 150x150 -> 500x500 upgrade (better quality thumbnails)
   * - http -> https upgrade (mixed-content block se bachao)
   * - Broken/empty URLs -> '' (SafeImage placeholder dikhayega)
   */
  static sanitizeImageUrl(url: string | null | undefined): string {
    if (!url || typeof url !== 'string') return '';
    let clean = url.trim();
    if (!clean) return '';
    // Protocol-relative URLs (//cdn...) → https
    if (clean.startsWith('//')) clean = 'https:' + clean;
    // http -> https
    if (clean.startsWith('http://')) clean = 'https://' + clean.slice(7);
    if (!clean.startsWith('https://')) return '';
    // JioSaavn: low-res -> high-res (500x500)
    if (clean.includes('jiosaavn') || clean.includes('saavncdn')) {
      clean = clean.replace(/150x150/g, '500x500').replace(/50x50/g, '500x500');
    }
    // YouTube thumbnails: default.jpg -> hqdefault.jpg (better quality)
    // (i.ytimg.com / img.youtube.com)
    if (clean.includes('ytimg.com') || clean.includes('youtube.com')) {
      clean = clean.replace(/\/default\.jpg$/i, '/hqdefault.jpg')
                   .replace(/\/mqdefault\.jpg$/i, '/hqdefault.jpg')
                   .replace(/\/sddefault\.jpg$/i, '/hqdefault.jpg');
    }
    // Spotify CDN: keep as-is (already high-res)
    return clean;
  }

  static isHighQuality(track: Track): boolean {
    return track.audioQuality.isHiRes || track.audioQuality.maximumBitDepth >= 24;
  }

  static getQualityBadge(track: Track): string | null {
    if (track.audioQuality.isHiRes) return 'Hi-Res';
    if (track.audioQuality.maximumBitDepth >= 24) return 'HD';
    return null;
  }

  static clearCache(): void {
    this.searchCache.clear();
    this.streamCache.clear();
  }

  static clearSearchCache(): void {
    this.searchCache.clear();
  }

  static clearStreamCache(): void {
    this.streamCache.clear();
  }
} 