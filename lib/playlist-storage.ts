import AsyncStorage from '@react-native-async-storage/async-storage';
import { Track } from '@/types/music';
import { MusicAPI } from '@/lib/music-api';

export interface Playlist {
  name: string;
  cover: string;
  trackIds: string[];
}

const PLAYLISTS_KEY = 'user_playlists';
const TRACK_DATA_KEY = 'user_track_data';

export const PlaylistStorage = {
  async getPlaylists(): Promise<Playlist[]> {
    try {
      const data = await AsyncStorage.getItem(PLAYLISTS_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      // FIX (2026-10-03): corrupt entries ko normalize karo — purane versions ya
      // aadhe-likhe data me name/trackIds missing ho sakte hain; aise me
      // library.tsx ka pl.name / pl.trackIds.length access crash karata tha!
      return parsed
        .filter((pl: any) => pl && typeof pl === 'object' && typeof pl.name === 'string')
        .map((pl: any) => ({
          name: pl.name,
          cover: typeof pl.cover === 'string' ? pl.cover : '',
          trackIds: Array.isArray(pl.trackIds) ? pl.trackIds.map((id: any) => String(id)) : [],
        }));
    } catch (error) {
      console.error('Failed to load playlists (corrupt data ignored):', error);
      return [];
    }
  },
  async savePlaylists(playlists: Playlist[]) {
    await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  },
  async addPlaylist(playlist: Playlist) {
    const playlists = await this.getPlaylists();
    if (playlists.some(p => p.name === playlist.name)) return;
    playlists.push(playlist);
    await this.savePlaylists(playlists);
  },
  async addTrackToPlaylists(track: Track, playlistNames: string[]) {
    const playlists = await this.getPlaylists();
    let changed = false;
    // FIX (2026-10-03): 'offline' jaisi system playlists pehle se na hon to
    // banao — warna download hoke bhi Downloads screen me kabhi nahi dikhta tha!
    for (const name of playlistNames) {
      if (!playlists.some(p => p.name === name)) {
        playlists.push({ name, cover: '', trackIds: [] });
        changed = true;
      }
    }
    for (const pl of playlists) {
      if (playlistNames.includes(pl.name)) {
        // FIX (2026-10-03): corrupt track (bina id ke) par track.id.toString() crash karta tha
        if (track == null || track.id == null) continue;
        const trackId = track.id.toString();
        if (!(pl.trackIds || []).includes(trackId)) {
          pl.trackIds.push(trackId);
          changed = true;
        }
      }
    }
    if (changed) {
      await this.savePlaylists(playlists);
    }
    await this.saveTrackData(track);
  },
  async removeTrackFromPlaylist(trackId: string, playlistName: string) {
    const playlists = await this.getPlaylists();
    for (const pl of playlists) {
      if (pl.name === playlistName) {
        // FIX (2026-10-03): trackIds hamesha array hota hai (getPlaylists normalize karta hai),
        // phir bhi defensive guard taaki kabhi crash na ho
        pl.trackIds = (pl.trackIds || []).filter(id => id !== trackId);
        break;
      }
    }
    await this.savePlaylists(playlists);
  },
  async saveTrackData(track: Track) {
    try {
      const trackId = track.id.toString();
      const key = `${TRACK_DATA_KEY}_${trackId}`;
      await AsyncStorage.setItem(key, JSON.stringify(track));
    } catch (error) {
      console.error('Failed to save track data:', error);
    }
  },
  async getTrackData(trackId: string): Promise<Track | null> {
    try {
      const key = `${TRACK_DATA_KEY}_${trackId}`;
      const data = await AsyncStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to get track data:', error);
      return null;
    }
  },
  async getPlaylistTracks(playlist: Playlist) {
    const tracks: Track[] = [];
    const failedIds: string[] = [];
    // FIX (2026-10-03): corrupt playlist me trackIds array na ho to for...of crash karta tha
    const trackIds = Array.isArray(playlist?.trackIds) ? playlist.trackIds : [];
    for (const id of trackIds) {
      const storedTrack = await this.getTrackData(id);
      if (storedTrack) {
        tracks.push(storedTrack);
        continue;
      }
      try {
        const track = await MusicAPI.resolveTrackById(id);
        if (track) {
          tracks.push(track);
          await this.saveTrackData(track);
        } else {
          failedIds.push(id);
        }
      } catch {
        failedIds.push(id);
      }
    }
    if (failedIds.length > 0) {
      console.warn(`[PlaylistStorage] Failed to resolve ${failedIds.length} track(s) in "${playlist.name}":`, failedIds);
    }
    return tracks;
  },
};
