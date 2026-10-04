import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { useColorScheme } from '@/hooks/useColorScheme';

/**
 * UpdateBanner (2026-10-04, Om's request):
 * OTA update download hote waqt progress notification dikhao.
 * - "Checking for updates..." → "Downloading update..." → "Restart to apply"
 */
export function UpdateBanner() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme !== 'light';
  const [status, setStatus] = useState<'idle' | 'checking' | 'downloading' | 'ready'>('idle');

  const checkAndDownload = useCallback(async () => {
    try {
      if (__DEV__) return;
      setStatus('checking');
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setStatus('downloading');
        await Updates.fetchUpdateAsync();
        setStatus('ready');
      } else {
        setStatus('idle');
      }
    } catch (e) {
      console.warn('[UpdateBanner] check failed:', e);
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    checkAndDownload();
  }, [checkAndDownload]);

  const handleRestart = async () => {
    try {
      await Updates.reloadAsync();
    } catch (e) {
      console.warn('[UpdateBanner] reload failed:', e);
    }
  };

  const handleDismiss = () => setStatus('idle');

  if (status === 'idle') return null;

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#1a2e1a' : '#e8f5e9' }]}>
      {status === 'checking' && (
        <View style={styles.row}>
          <ActivityIndicator size="small" color="#1DB954" />
          <Text style={[styles.text, { color: isDark ? '#fff' : '#111' }]}>
            Checking for updates...
          </Text>
        </View>
      )}
      {status === 'downloading' && (
        <View style={styles.row}>
          <ActivityIndicator size="small" color="#1DB954" />
          <Text style={[styles.text, { color: isDark ? '#fff' : '#111' }]}>
            Downloading update... please wait
          </Text>
        </View>
      )}
      {status === 'ready' && (
        <View style={styles.row}>
          <Text style={[styles.text, { color: isDark ? '#fff' : '#111' }]}>
            ✅ Update ready!
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleRestart}>
            <Text style={styles.buttonText}>Restart Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dismiss} onPress={handleDismiss}>
            <Text style={[styles.dismissText, { color: isDark ? '#888' : '#666' }]}>Later</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(29, 185, 84, 0.3)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  button: {
    backgroundColor: '#1DB954',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  dismiss: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  dismissText: {
    fontSize: 13,
  },
});
