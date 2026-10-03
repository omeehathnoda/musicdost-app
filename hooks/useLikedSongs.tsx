import { useState, useEffect, useCallback, useMemo, createContext, useContext, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Track } from '../types/music';

const LIKED_SONGS_STORAGE_KEY = 'openspot_liked_songs';

interface LikedSong {
  id: string | number;
  provider?: 'saavn' | 'ytmusic';
  title: string;
  artist: string;
  albumTitle?: string;
  duration?: number;
  images: {
    small: string;
    thumbnail: string;
    large: string;
    back: string | null;
  };
  likedAt: string; 
}

interface LikedSongsContextType {
  likedSongs: LikedSong[];
  isLoading: boolean;
  isLiked: (trackId: string | number) => boolean;
  likeSong: (track: Track) => void;
  unlikeSong: (trackId: string | number) => void;
  toggleLike: (track: Track) => void;
  likedCount: number;
  recentlyLiked: LikedSong[];
  clearAllLiked: () => void;
  getLikedSongsAsTrack: () => Track[];
}

const LikedSongsContext = createContext<LikedSongsContextType | undefined>(undefined);

interface LikedSongsProviderProps {
  children: ReactNode;
}

export function LikedSongsProvider({ children }: LikedSongsProviderProps) {
  const [likedSongs, setLikedSongs] = useState<LikedSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  
  useEffect(() => {
    const loadLikedSongs = async () => {
      try {
        const savedLikedSongs = await AsyncStorage.getItem(LIKED_SONGS_STORAGE_KEY);
        if (savedLikedSongs) {
          const parsed = JSON.parse(savedLikedSongs) as LikedSong[];
          // FIX (2026-10-03): corrupt entries (null/primitive/bina-images) filter karo —
          // neeche likedSongsAsTrack me song.images.large access crash karata tha!
          const valid = Array.isArray(parsed)
            ? parsed.filter((s: any) => s && typeof s === 'object' && s.id != null)
            : [];
          setLikedSongs(valid);
        }
      } catch (error) {
        console.error('Failed to load liked songs from AsyncStorage:', error);
        setLikedSongs([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadLikedSongs();
  }, []);

  
  const saveLikedSongs = useCallback(async (songs: LikedSong[]) => {
    try {
      await AsyncStorage.setItem(LIKED_SONGS_STORAGE_KEY, JSON.stringify(songs));
    } catch (error) {
      console.error('Failed to save liked songs to AsyncStorage:', error);
    }
  }, []);

  
  const isLiked = useCallback((trackId: string | number): boolean => {
    return likedSongs.some(song => song.id === trackId);
  }, [likedSongs]);

  
  const likeSong = useCallback((track: Track) => {
    setLikedSongs(prev => {
      if (prev.some(song => song.id === track.id)) return prev;

      const likedSong: LikedSong = {
        id: track.id,
        provider: track.provider,
        title: track.title,
        artist: track.artist,
        albumTitle: track.albumTitle,
        duration: track.duration,
        images: track.images,
        likedAt: new Date().toISOString()
      };

      const updated = [likedSong, ...prev];
      saveLikedSongs(updated);
      return updated;
    });
  }, [saveLikedSongs]);

  const unlikeSong = useCallback((trackId: string | number) => {
    setLikedSongs(prev => {
      if (!prev.some(song => song.id === trackId)) return prev;

      const updated = prev.filter(song => song.id !== trackId);
      saveLikedSongs(updated);
      return updated;
    });
  }, [saveLikedSongs]);

  
  const toggleLike = useCallback((track: Track) => {
    if (isLiked(track.id)) {
      unlikeSong(track.id);
    } else {
      likeSong(track);
    }
  }, [isLiked, likeSong, unlikeSong]);

  
  const likedCount = likedSongs.length;

  
  const recentlyLiked = likedSongs.slice(0, 10);

  
  const clearAllLiked = useCallback(() => {
    setLikedSongs([]);
    saveLikedSongs([]);
  }, [saveLikedSongs]);

  
  const likedSongsAsTrack = useMemo((): Track[] => {
    return likedSongs
      .filter(song => song && typeof song === 'object' && song.id != null)
      .map(song => ({
      id: song.id,
      provider: song.provider,
      title: song.title,
      artist: song.artist,
      artistId: 0,
      albumTitle: song.albumTitle || '',
      // FIX (2026-10-03): corrupt liked entry me images missing ho to crash hota tha
      albumCover: song.images?.large || '',
      albumId: '',
      releaseDate: '',
      genre: '',
      duration: song.duration || 0,
      audioQuality: {
        maximumBitDepth: 16,
        maximumSamplingRate: 44100,
        isHiRes: false
      },
      version: null,
      label: '',
      labelId: 0,
      upc: '',
      mediaCount: 1,
      parental_warning: false,
      streamable: true,
      purchasable: false,
      previewable: true,
      genreId: 0,
      genreSlug: '',
      genreColor: '',
      releaseDateStream: '',
      releaseDateDownload: '',
      maximumChannelCount: 2,
      // FIX (2026-10-03): images missing ho to default empty object — render me
      // item.images?.large guards hain, par getOptimalImage(images) bina guard ke
      // images.large access karta hai, isliye hamesha object do
      images: song.images && typeof song.images === 'object'
        ? song.images
        : { small: '', thumbnail: '', large: '', back: null },
      isrc: ''
    }));
  }, [likedSongs]);

  const getLikedSongsAsTrack = useCallback((): Track[] => {
    return likedSongsAsTrack;
  }, [likedSongsAsTrack]);

  const contextValue: LikedSongsContextType = {
    likedSongs,
    isLoading,
    isLiked,
    likeSong,
    unlikeSong,
    toggleLike,
    likedCount,
    recentlyLiked,
    clearAllLiked,
    getLikedSongsAsTrack
  };

  return (
    <LikedSongsContext.Provider value={contextValue}>
      {children}
    </LikedSongsContext.Provider>
  );
}

export function useLikedSongs(): LikedSongsContextType {
  const context = useContext(LikedSongsContext);
  if (context === undefined) {
    throw new Error('useLikedSongs must be used within a LikedSongsProvider');
  }
  return context;
} 