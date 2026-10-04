import React, { useState } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Image, ImageProps } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

/**
 * SafeImage (2026-10-04 MASTER FIX #1):
 * - Broken/missing thumbnail URL par default music placeholder icon dikhata hai.
 * - `onError` handler: image load fail hote hi fallback par switch.
 * - Empty/null URI par turant placeholder (network call hi nahi hota).
 */
interface SafeImageProps extends Omit<ImageProps, 'source'> {
  uri?: string | null;
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
  fallbackIconColor?: string;
  fallbackBg?: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

export function SafeImage({
  uri,
  fallbackIcon = 'musical-notes',
  fallbackIconColor = '#666',
  fallbackBg = '#1a1a1a',
  style,
  containerStyle,
  ...rest
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const cleanUri = typeof uri === 'string' ? uri.trim() : '';
  const showFallback = failed || !cleanUri;

  if (showFallback) {
    const flat = StyleSheet.flatten(style) as any;
    const size = flat?.width ?? 56;
    return (
      <View
        style={[
          styles.fallback,
          { backgroundColor: fallbackBg, width: size, height: flat?.height ?? size, borderRadius: flat?.borderRadius ?? 8 },
          containerStyle,
        ]}
      >
        <Ionicons name={fallbackIcon} size={Math.max(20, Number(size) * 0.45)} color={fallbackIconColor} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: cleanUri }}
      style={style}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
