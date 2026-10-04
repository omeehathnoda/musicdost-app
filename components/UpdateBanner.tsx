import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { useColorScheme } from '@/hooks/useColorScheme';

/**
 * UpdateBanner (2026-10-04, Om's request):
 * OTA update download hote waqt progress notification dikhao.
 * - "Checking for updates..." → "Downloading update... 45%" → "Restart to apply"
 */
export function UpdateBanner() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme !== 'light';
  const [status, setStatus] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);

  const checkAndDownload = useCallback(async () => {
    try {
      if (__DEV__) return; // Dev me OTA nahi
      setStatus('checking');
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setStatus('downloading');
        setProgress(0);
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
    // App start par check karo
    checkAndDownload();

    // Download progress events suno
    const sub = Updates.addListener((event) => {
      if (event.type === (Updates as any).UpdateEventType?.DOWNLOAD_STARTED) {
        setStatus('downloading');
        setProgress(0);
      } else if (event.type === (Updates as any).UpdateEventType?.DOWNLOAD_PROGRESS) {
        const ev = event as any;
        if (ev.totalBytes && ev.totalBytes > 0) {
          setProgress(Math.round((ev.bytesWritten / ev.totalBytes) * 100));
        }
      } else if (event.type === (Updates as any).UpdateEventType?.DOWNLOAD_FINISHED) {
        setStatus('ready');
        setProgress(100);
      } else if (event.type === (Updates as any).UpdateEventType?.ERROR) {
        setStatus('idle');
      }
    });
    return () => sub.remove();
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
            Downloading update... {progress > 0 ? `${progress}%` : ''}
          </Text>
          {progress > 0 && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          )}
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
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1DB954',
    borderRadius: 2,
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
