import React from 'react';
import { View } from 'react-native';
import { PlaylistCard } from './PlaylistCard';

interface PlaylistListProps {
  playlists: {
    name: string;
    cover: string;
    trackCount: number;
  }[];
  onPlaylistPress: (playlist: any) => void;
  onPlaylistShuffle?: (playlist: any) => void;
  onPlaylistPlay?: (playlist: any) => void;
  onPlaylistLongPress?: (playlist: any) => void;
  onPlaylistDelete?: (playlist: any) => void;
  theme?: {
    surface: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
    icon: string;
  };
}

export function PlaylistList({ playlists, onPlaylistPress, onPlaylistShuffle, onPlaylistPlay, onPlaylistLongPress, onPlaylistDelete, theme }: PlaylistListProps) {
  // CRASH FIX (2026-10-04): corrupt/null playlist entries par
  // playlist.name access crash karata tha. Ab defensive filter.
  const safePlaylists = (Array.isArray(playlists) ? playlists : []).filter(
    (pl) => pl && typeof pl === 'object' && typeof pl.name === 'string' && pl.name.length > 0
  );

  return (
    <View>
      {safePlaylists.map((playlist, idx) => (
        <PlaylistCard
          key={`${playlist.name}_${idx}`}
          playlist={playlist}
          onPress={() => onPlaylistPress(playlist)}
          onShuffle={onPlaylistShuffle ? () => onPlaylistShuffle(playlist) : undefined}
          onPlay={onPlaylistPlay ? () => onPlaylistPlay(playlist) : undefined}
          onLongPress={onPlaylistLongPress ? () => onPlaylistLongPress(playlist) : undefined}
          onDelete={onPlaylistDelete ? () => onPlaylistDelete(playlist) : undefined}
          theme={theme}
        />
      ))}
    </View>
  );
}
