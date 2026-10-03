import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useThemeMode, ThemeModeProvider } from '@/hooks/theme-mode';
import { LikedSongsProvider } from '@/hooks/useLikedSongs';
import { useApiStatus } from '@/hooks/useApiStatus';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { MusicDostLogin } from '@/components/MusicDostLogin';
import { MusicDostAPI } from '@/lib/musicdost-api';
import { ensureCacheDir } from '@/lib/offline-storage';
import { migratePrivateDownloadsToPublic } from '@/lib/public-download';
import '@/lib/i18n';

SplashScreen.preventAutoHideAsync();

function AppNavigation() {
  const { resolvedScheme } = useThemeMode();
  const { apiStatus, loading } = useApiStatus();
  const PROVIDER_KEY = 'openspot_provider_v1';

  useEffect(() => {
    const checkAndSwitchProvider = async () => {
      if (loading || !apiStatus) return;

      try {
        const currentProvider = await AsyncStorage.getItem(PROVIDER_KEY);
        if (!currentProvider) return;

        if (currentProvider === 'ytmusic' && apiStatus.ytmusic?.disabled) {
          await AsyncStorage.setItem(PROVIDER_KEY, 'saavn');
          console.log('Auto-switched provider from ytmusic to saavn (ytmusic disabled)');
        } else if (currentProvider === 'saavn' && apiStatus.saavn?.disabled) {
          await AsyncStorage.setItem(PROVIDER_KEY, 'ytmusic');
          console.log('Auto-switched provider from saavn to ytmusic (saavn disabled)');
        }
      } catch (error) {
        console.error('Failed to check/switch provider:', error);
      }
    };

    checkAndSwitchProvider();
  }, [apiStatus, loading]);

  return (
    <LikedSongsProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
    </LikedSongsProvider>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [splashDone, setSplashDone] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // Splash ke baad: token check karo (Render restart par token dead ho sakta hai)
  useEffect(() => {
    if (!splashDone) return;
    let cancelled = false;
    (async () => {
      const ok = await MusicDostAPI.validateToken();
      if (!cancelled) {
        setLoggedIn(ok);
        setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [splashDone]);

  // AUTO-CACHE + PUBLIC DOWNLOADS (2026-10-03, corrected):
  //  - Private auto-cache dir (md_private/cache/ + .nomedia) ensure karo.
  //  - Purane galat-private manual downloads ko ek baar public storage
  //    (Music/MusicDost/) me migrate karo (best-effort).
  // Fire-and-forget — splash block nahi hoga.
  useEffect(() => {
    (async () => {
      try {
        await ensureCacheDir();
        await migratePrivateDownloadsToPublic();
      } catch (e) {
        console.warn('[startup] storage setup failed (non-fatal):', e);
      }
    })();
  }, []);

  // 401 aaye (token dead) to login screen wapas lao
  useEffect(() => {
    const off = MusicDostAPI.onAuthExpired(() => {
      setLoggedIn(false);
      setAuthChecked(true);
    });
    return off;
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeModeProvider>
          {authChecked && loggedIn ? (
            <AppNavigation />
          ) : (
            authChecked && (
              <MusicDostLogin onDone={() => setLoggedIn(true)} />
            )
          )}
          {!splashDone && <AnimatedSplash onDone={() => setSplashDone(true)} />}
        </ThemeModeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}