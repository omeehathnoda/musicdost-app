import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeImage } from './SafeImage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface PlaylistCardProps {
  playlist: {
    name: string;
    cover: string;
    trackCount: number;
  };
  onPress: () => void;
  onShuffle?: () => void;
  onPlay?: () => void;
  onLongPress?: () => void;
  onDelete?: () => void;
  theme?: {
    surface: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
    icon: string;
  };
}

const FALLBACK_COVER = 'https://misc.scdn.co/liked-songs/liked-songs-640.png';

export function PlaylistCard({ playlist, onPress, onShuffle, onPlay, onLongPress, onDelete, theme }: PlaylistCardProps) {
  const { t } = useTranslation();

  // CRASH FIX (2026-10-04): null/undefined playlist prop par render crash
  // karata tha. Ab safe defaults ke saath render karo, kabhi crash nahi.
  const safePlaylist = {
    name: typeof playlist?.name === 'string' && playlist.name.length > 0 ? playlist.name : 'Playlist',
    cover: typeof playlist?.cover === 'string' && playlist.cover.length > 0 ? playlist.cover : FALLBACK_COVER,
    trackCount: typeof playlist?.trackCount === 'number' && playlist.trackCount >= 0 ? playlist.trackCount : 0,
  };

  const safeOnPress = typeof onPress === 'function' ? onPress : () => {};
  const safeOnShuffle = typeof onShuffle === 'function' ? onShuffle : undefined;
  const safeOnPlay = typeof onPlay === 'function' ? onPlay : undefined;
  const safeOnLongPress = typeof onLongPress === 'function' ? onLongPress : undefined;
  const safeOnDelete = typeof onDelete === 'function' ? onDelete : undefined;

  return (
    <View style={[styles.card, theme && { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <TouchableOpacity
        style={styles.infoArea}
        onPress={safeOnPress}
        onLongPress={safeOnLongPress}
        delayLongPress={350}
        activeOpacity={0.85}
       >
        <SafeImage uri={safePlaylist?.cover} style={[styles.cover, theme && { borderColor: theme.border }]} contentFit="cover" />
        <View style={styles.info}>
          <Text style={[styles.name, theme && { color: theme.textPrimary }]} numberOfLines={1}>{safePlaylist.name}</Text>
          <Text style={[styles.count, theme && { color: theme.textSecondary }]}>{safePlaylist.trackCount} {safePlaylist.trackCount === 1 ? t('components.song') : t('components.songs')}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.actionRow}>
        {safeOnDelete && (
          <TouchableOpacity style={styles.iconButton} onPress={safeOnDelete}>
            <Ionicons name="trash" size={18} color="#ff4444" />
          </TouchableOpacity>
        )}
        {safeOnShuffle && (
          <TouchableOpacity style={styles.iconButton} onPress={safeOnShuffle}>
            <Ionicons name="shuffle" size={20} color={theme?.icon ?? "#fff"} />
          </TouchableOpacity>
        )}
        {safeOnPlay && (
          <TouchableOpacity style={styles.iconButton} onPress={safeOnPlay}>
            <Ionicons name="play" size={20} color={theme?.accent ?? "#1DB954"} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#242424',
    borderRadius: 12,
    marginBottom: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  infoArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 8,
    marginRight: 14,
    backgroundColor: '#222',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#222',
  },
  info: {
    flex: 1,
  },
  name: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  count: {
    color: '#888',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  iconButton: {
    marginLeft: 4,
    padding: 8,
    borderRadius: 16,
  },
});
