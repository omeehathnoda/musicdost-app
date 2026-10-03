import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, StatusBar, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSearch } from '@/hooks/useSearch';
import { TopBar } from '@/components/TopBar';
import { MusicPlayerContext } from './_layout';
import { MusicAPI } from '@/lib/music-api';
import { Track } from '@/types/music';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLikedSongs } from '@/hooks/useLikedSongs';
import { HorizontalTrackList } from '@/components/HorizontalTrackList';
import { useRouter , useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from '@/hooks/useColorScheme';
import { COUNTRY_NAMES } from '@/constants/countryNames';
import { useTranslation } from 'react-i18next';
import { useThemeMode, ThemeMode } from '@/hooks/theme-mode';
import { useConnectivity } from '@/hooks/useConnectivity';
import { GreetingHeader } from '@/components/GreetingHeader';
import { QuickActions } from '@/components/QuickActions';
import { SectionHeader } from '@/components/SectionHeader';
import { PlaylistStorage, Playlist } from '@/lib/playlist-storage';

const KWORD_URL = 'https://kworb.net/spotify/';
const REGION_URL_MAP_KEY = 'openspot_region_url_map_v1';
const REGION_URL_MAP_TIMESTAMP_KEY = 'openspot_region_url_map_ts_v1';
const REGION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REGION_OVERRIDE_KEY = 'openspot_region_override_v1';
const LANGUAGE_KEY = 'openspot_language_v1';
const FIRST_RUN_SETUP_KEY = 'openspot_first_run_setup_done_v1';
const TRENDING_ENABLED_KEY = 'openspot_trending_enabled_v1';

// Language-based trending (JioSaavn charts) — MusicDost style
const TREND_LANGS = [
  { id: 'hindi', label: 'Hindi', chartId: '1134543272' },
  { id: 'english', label: 'English', chartId: '1134543273' },
  { id: 'punjabi', label: 'Punjabi', chartId: '1134543511' },
  { id: 'haryanvi', label: 'Haryanvi', chartId: '1134770917' },
];
const TREND_LANG_KEY = 'musicdost_trend_lang_v1';

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { t, i18n } = useTranslation();
  const { mode, setMode } = useThemeMode();
  const isDark = colorScheme !== 'light';
  const theme = useMemo(
    () => ({
      background: isDark ? '#050505' : '#f5efe6',
      surface: isDark ? '#121212' : '#fffaf2',
      surfaceElevated: isDark ? '#1b1b1b' : '#efe4d6',
      textPrimary: isDark ? '#ffffff' : '#2d2219',
      textSecondary: isDark ? '#a9a9a9' : '#7a6251',
      border: isDark ? '#272727' : '#e4d5c5',
      accent: isDark ? '#1DB954' : '#167c3a',
    }),
    [isDark]
  );

  const [currentView, setCurrentView] = React.useState<'home' | 'search'>('home');
  const searchState = useSearch();
  const { clearResults } = searchState;
  const { handleTrackSelect, musicQueue, isPlaying, currentTrack } = useContext(MusicPlayerContext);
  const { getLikedSongsAsTrack } = useLikedSongs();
  const likedTracks = getLikedSongsAsTrack();
  const [detectedCountry, setDetectedCountry] = useState('your country');
  const [regionOverride, setRegionOverride] = useState<string>('auto');
  const [countryLoading, setCountryLoading] = useState(true);
  const [regionUrlMap, setRegionUrlMap] = useState<Record<string, string>>({});
  const [recentlyPlayedTracks, setRecentlyPlayedTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showFirstRunSetup, setShowFirstRunSetup] = useState(false);
  const [setupRegion, setSetupRegion] = useState<string>('auto');
  const [setupLanguage, setSetupLanguage] = useState<string>('en');
  const [setupTheme, setSetupTheme] = useState<ThemeMode>(mode);
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [isRegionModalOpen, setIsRegionModalOpen] = useState(false);
  const { isOffline } = useConnectivity();
  const wasOfflineRef = React.useRef(false);
  const [trendingEnabled, setTrendingEnabled] = useState<boolean>(true);
  const scrollRef = useRef<ScrollView>(null);
  // Language trending (MusicDost style chips)
  const [trendLang, setTrendLang] = useState<string>('hindi');
  const [langTracks, setLangTracks] = useState<Track[]>([]);
  const [langLoading, setLangLoading] = useState<boolean>(false);

  const languageOptions: { label: string; value: string; nativeLabel: string }[] = [
    { label: 'English', value: 'en', nativeLabel: 'English' },
    { label: 'Hindi', value: 'hi', nativeLabel: 'Hindi' },
    { label: 'Spanish', value: 'es', nativeLabel: 'Espanol' },
    { label: 'Chinese', value: 'zh', nativeLabel: 'Zhongwen' },
    { label: 'German', value: 'de', nativeLabel: 'Deutsch' },
    { label: 'French', value: 'fr', nativeLabel: 'Francais' },
    { label: 'Russian', value: 'ru', nativeLabel: 'Russkiy' },
    { label: 'Hebrew', value: 'he', nativeLabel: 'Ivrit' },
    { label: 'Turkish', value: 'tr', nativeLabel: 'Türkçe' },
    { label: 'Korean', value: 'ko', nativeLabel: '한국어' },
  ];

  
  useEffect(() => {
    (async () => {
      try {
        const [mapStr, done, stored, storedRegion, timestamp] = await Promise.all([
          AsyncStorage.getItem(REGION_URL_MAP_KEY),
          AsyncStorage.getItem(FIRST_RUN_SETUP_KEY),
          AsyncStorage.getItem(TRENDING_ENABLED_KEY),
          AsyncStorage.getItem(REGION_OVERRIDE_KEY),
          AsyncStorage.getItem(REGION_URL_MAP_TIMESTAMP_KEY),
        ]);
        if (mapStr) setRegionUrlMap(JSON.parse(mapStr));
        if (!done) setShowFirstRunSetup(true);
        if (stored !== null) setTrendingEnabled(stored === 'true');
        if (storedRegion && storedRegion.trim()) setRegionOverride(storedRegion);

        const isStale = !timestamp || Date.now() - parseInt(timestamp, 10) > REGION_CACHE_TTL_MS;
        if (isStale) {
          const res = await fetch(KWORD_URL);
          const html = await res.text();
          const freshMap: Record<string, string> = {};
          const regex = /<tr><td class="mp text">([^<]+)<\/td>\s*<td class="mp text">[\s\S]*?<a href="([^"]+)">Weekly<\/a>/g;
          let match;
          while ((match = regex.exec(html)) !== null) {
            const name = match[1].trim();
            freshMap[name] = `https://kworb.net/spotify/${match[2]}`;
          }
          setRegionUrlMap(freshMap);
          await AsyncStorage.setItem(REGION_URL_MAP_KEY, JSON.stringify(freshMap));
          await AsyncStorage.setItem(REGION_URL_MAP_TIMESTAMP_KEY, Date.now().toString());
        }
      } catch (e) {
        console.error('Failed to load cached data:', e);
      }
    })();
  }, []);

  useEffect(() => {
    setSetupTheme(mode);
  }, [mode]);

  useEffect(() => {
    if (!isOffline && wasOfflineRef.current) {
      void (async () => {
        try {
          const timestamp = await AsyncStorage.getItem(REGION_URL_MAP_TIMESTAMP_KEY);
          const isStale = !timestamp || Date.now() - parseInt(timestamp, 10) > REGION_CACHE_TTL_MS;
          if (!isStale) return;

          const res = await fetch(KWORD_URL);
          const html = await res.text();
          const map: Record<string, string> = {};
          const regex = /<tr><td class="mp text">([^<]+)<\/td>\s*<td class="mp text">[\s\S]*?<a href="([^"]+)">Weekly<\/a>/g;
          let match;
          while ((match = regex.exec(html)) !== null) {
            const name = match[1].trim();
            map[name] = `https://kworb.net/spotify/${match[2]}`;
          }
          setRegionUrlMap(map);
          await AsyncStorage.setItem(REGION_URL_MAP_KEY, JSON.stringify(map));
          await AsyncStorage.setItem(REGION_URL_MAP_TIMESTAMP_KEY, Date.now().toString());
        } catch (e) {
          console.error('Region URL map re-fetch error:', e);
        }
      })();
      if (regionOverride === 'auto') {
        void (async () => {
          try {
            setCountryLoading(true);
            const res = await fetch('https://ipinfo.io/json');
            const data = await res.json();
            if (data && data.country && COUNTRY_NAMES[data.country]) {
              setDetectedCountry(COUNTRY_NAMES[data.country]);
            } else {
              setDetectedCountry('your country');
            }
          } catch (e) {
            console.error('Country re-fetch error:', e);
          } finally {
            setCountryLoading(false);
          }
        })();
      }
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, regionOverride]);

  const loadRecentlyPlayed = React.useCallback(async () => {
    try {
      const recent = await MusicAPI.getRecentlyPlayed();
      setRecentlyPlayedTracks(recent);
    } catch (error) {
      console.error('Failed to load recently played tracks:', error);
      setRecentlyPlayedTracks([]);
    }
  }, []);

  useEffect(() => {
    void loadRecentlyPlayed();
  }, [loadRecentlyPlayed]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        try {
          setPlaylists(await PlaylistStorage.getPlaylists());
        } catch (e) {
          console.error('Failed to load playlists:', e);
        }
      })();
    }, [])
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('https://ipinfo.io/json');
        const data = await res.json();
        if (data && data.country && COUNTRY_NAMES[data.country]) {
          setDetectedCountry(COUNTRY_NAMES[data.country]);
        } else {
          setDetectedCountry('your country');
        }
      } catch (e) {
        console.error('Country fetch error:', e);
        setDetectedCountry('your country');
      } finally {
        setCountryLoading(false);
      }
    })();
  }, []);

  // ---- Language-based trending (MusicDost style) ----
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TREND_LANG_KEY);
        if (saved && TREND_LANGS.some((l) => l.id === saved)) setTrendLang(saved);
      } catch (e) {
        console.error('Failed to load trend lang:', e);
      }
    })();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      const lang = TREND_LANGS.find((l) => l.id === trendLang);
      if (!lang) return;
      setLangLoading(true);
      try {
        const tracks = await MusicAPI.getPlaylistSongs(lang.chartId);
        if (isMounted) setLangTracks((tracks || []).slice(0, 50));
      } catch (e) {
        console.error('Language trending error:', e);
        if (isMounted) setLangTracks([]);
      } finally {
        if (isMounted) setLangLoading(false);
      }
    };
    load();
    return () => { isMounted = false; };
  }, [trendLang]);

  const handleLangChange = React.useCallback(async (id: string) => {
    setTrendLang(id);
    try {
      await AsyncStorage.setItem(TREND_LANG_KEY, id);
    } catch (e) {
      console.error('Failed to save trend lang:', e);
    }
  }, []);

  const handleViewChange = (view: 'home' | 'search') => {
    setCurrentView(view);
    if (view === 'home') {
      clearResults();
    }
  };

  const handleSearchClick = () => {
    router.push('/search');
  };

  const handleSearchStart = () => {
    setCurrentView('search');
  };

  const saveFirstRunSetup = async () => {
    setIsSavingSetup(true);
    try {
      await AsyncStorage.setItem(REGION_OVERRIDE_KEY, setupRegion);
      await AsyncStorage.setItem(LANGUAGE_KEY, setupLanguage);
      await AsyncStorage.setItem(FIRST_RUN_SETUP_KEY, '1');
      await i18n.changeLanguage(setupLanguage);
      setMode(setupTheme);
      setRegionOverride(setupRegion);
      setShowFirstRunSetup(false);
    } catch (error) {
      console.error('Failed to save first run setup:', error);
    } finally {
      setIsSavingSetup(false);
    }
  };

  const handleHomeTrackSelect = React.useCallback(
    (track: Track, trackList?: Track[], startIndex?: number) => {
      handleTrackSelect(track, trackList, startIndex);
      setRecentlyPlayedTracks((prev) => {
        const withoutCurrent = prev.filter((item) => item.id.toString() !== track.id.toString());
        return [track, ...withoutCurrent].slice(0, 30);
      });
    },
    [handleTrackSelect]
  );

  const handleShuffleLiked = React.useCallback(() => {
    if (likedTracks.length > 0) {
      const randomIndex = Math.floor(Math.random() * likedTracks.length);
      handleHomeTrackSelect(likedTracks[randomIndex], likedTracks, randomIndex);
    }
  }, [likedTracks, handleHomeTrackSelect]);

  const handleLibraryNav = React.useCallback(() => {
    router.push('/library');
  }, [router]);

  const handleDownloadsNav = React.useCallback(() => {
    router.push('/downloads');
  }, [router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.background} translucent={false} />
      <TopBar
        currentView={currentView}
        onViewChange={handleViewChange}
        onSearchClick={handleSearchClick}
        onSearchStart={handleSearchStart}
        searchState={searchState}
      />
      <View style={styles.mainContent}>
        {currentView === 'home' ? (
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <GreetingHeader />
            <QuickActions
              onShuffleLiked={handleShuffleLiked}
              onDownloads={handleDownloadsNav}
              onLibrary={handleLibraryNav}
            />

            <View style={{ marginTop: 8 }}>
              <SectionHeader title={`🎶 ${t('home.my_playlists')}`} onSeeAll={handleLibraryNav} />
              {playlists.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                >
                  {playlists.slice(0, 10).map((pl) => (
                    <TouchableOpacity
                      key={pl.name}
                      onPress={handleLibraryNav}
                      activeOpacity={0.85}
                      style={{ width: 120 }}
                    >
                      {pl.cover ? (
                        <Image source={{ uri: pl.cover }} style={{ width: 120, height: 120, borderRadius: 14 }} contentFit="cover" />
                      ) : (
                        <View style={{ width: 120, height: 120, borderRadius: 14, backgroundColor: theme.surfaceElevated, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="musical-notes" size={40} color={theme.textSecondary} />
                        </View>
                      )}
                      <Text numberOfLines={1} style={{ color: theme.textPrimary, fontSize: 13, fontWeight: '700', marginTop: 6 }}>
                        {pl.name}
                      </Text>
                      <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                        {/* FIX (2026-10-03): corrupt entry par trackIds.length crash karta tha */}
                        {Array.isArray(pl.trackIds) ? pl.trackIds.length : 0} {t('components.songs')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <TouchableOpacity
                  onPress={handleLibraryNav}
                  activeOpacity={0.85}
                  style={[styles.emptyBox, { backgroundColor: theme.surface, borderColor: theme.border, flexDirection: 'row' }]}
                >
                  <Ionicons name="musical-notes-outline" size={24} color={theme.textSecondary} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary, marginTop: 0 }]}>
                    {t('home.empty_playlists')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {trendingEnabled && (
              <View style={{ marginTop: 8 }}>
                <SectionHeader title={`🔥 ${t('home.trending_now')}`} />
                {/* Language chips: Hindi | English | Punjabi | Haryanvi */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}
                >
                  {TREND_LANGS.map((lang) => {
                    const active = trendLang === lang.id;
                    return (
                      <TouchableOpacity
                        key={lang.id}
                        onPress={() => handleLangChange(lang.id)}
                        activeOpacity={0.85}
                        style={[
                          styles.langChip,
                          {
                            backgroundColor: active ? theme.accent : theme.surface,
                            borderColor: active ? theme.accent : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.langChipText,
                            { color: active ? '#fff' : theme.textSecondary },
                            active && { fontWeight: '700' },
                          ]}
                        >
                          {lang.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {langLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                    <ActivityIndicator color={theme.accent} />
                    <Text style={{ color: theme.textSecondary, marginTop: 8, fontSize: 13 }}>
                      {t('home.loading_trending')}
                    </Text>
                  </View>
                ) : langTracks.length > 0 ? (
                  <HorizontalTrackList
                    title=""
                    tracks={langTracks}
                    onTrackSelect={handleHomeTrackSelect}
                    isPlaying={isPlaying}
                    currentTrack={currentTrack}
                  />
                ) : (
                  <Text style={{ color: theme.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 16 }}>
                    {t('home.empty_trending')}
                  </Text>
                )}
              </View>
            )}

            <View style={{ marginTop: 16 }}>
              <SectionHeader title={t('home.liked_songs')} onSeeAll={handleLibraryNav} />
              {likedTracks.length > 0 ? (
                <HorizontalTrackList
                  title=""
                  tracks={likedTracks}
                  onTrackSelect={handleHomeTrackSelect}
                  isPlaying={isPlaying}
                  currentTrack={currentTrack}
                />
              ) : (
                <View style={[styles.emptyBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Ionicons name="heart-outline" size={24} color={theme.textSecondary} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    {t('home.empty_liked')}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ marginTop: 16 }}>
              <SectionHeader title={t('home.continue_listening')} />
              {recentlyPlayedTracks.length > 0 ? (
                <HorizontalTrackList
                  title=""
                  tracks={recentlyPlayedTracks.slice(0, 10)}
                  onTrackSelect={handleHomeTrackSelect}
                  isPlaying={isPlaying}
                  currentTrack={currentTrack}
                />
              ) : (
                <View style={[styles.emptyBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Ionicons name="time-outline" size={24} color={theme.textSecondary} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    {t('home.empty_recent')}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ height: 140 }} />
          </ScrollView>
        ) : (
          <></>
        )}
      </View>
      <Modal visible={showFirstRunSetup} transparent animationType="fade">
        <View style={styles.setupOverlay}>
          <View style={[styles.setupCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.setupTitle, { color: theme.textPrimary }]}>{t('home.welcome_title')}</Text>
            <Text style={[styles.setupSubtitle, { color: theme.textSecondary }]}>
              {t('home.welcome_subtitle')}
            </Text>

            <Text style={[styles.setupSectionTitle, { color: theme.textPrimary }]}>{t('settings.region')}</Text>
            <TouchableOpacity
              style={[styles.setupDropdownButton, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
              onPress={() => setIsRegionModalOpen(true)}
            >
              <Text style={[styles.setupDropdownButtonText, { color: theme.textPrimary }]}>
                {setupRegion === 'auto' ? t('settings.auto') : setupRegion}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.textSecondary} />
            </TouchableOpacity>

            <Text style={[styles.setupSectionTitle, { color: theme.textPrimary }]}>{t('settings.language')}</Text>
            <TouchableOpacity
              style={[styles.setupDropdownButton, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
              onPress={() => setIsLanguageModalOpen(true)}
            >
              <Text style={[styles.setupDropdownButtonText, { color: theme.textPrimary }]}>
                {languageOptions.find((option) => option.value === setupLanguage)?.label || 'English'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.textSecondary} />
            </TouchableOpacity>

            <Text style={[styles.setupSectionTitle, { color: theme.textPrimary }]}>{t('settings.theme')}</Text>
            <View style={styles.setupRow}>
              {[
                { label: t('components.theme_light'), value: 'light' as ThemeMode },
                { label: t('components.theme_dark'), value: 'dark' as ThemeMode },
                { label: t('components.theme_auto'), value: 'auto' as ThemeMode },
              ].map((themeOption) => {
                const active = setupTheme === themeOption.value;
                return (
                  <TouchableOpacity
                    key={`setup-theme-${themeOption.value}`}
                    style={[
                      styles.setupSegment,
                      { borderColor: theme.border, backgroundColor: theme.surfaceElevated },
                      active && { backgroundColor: theme.accent, borderColor: theme.accent },
                    ]}
                    onPress={() => setSetupTheme(themeOption.value)}
                  >
                    <Text style={[styles.setupSegmentText, { color: active ? '#fff' : theme.textSecondary }]}>{themeOption.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.setupContinueButton, { backgroundColor: theme.accent }]}
              onPress={saveFirstRunSetup}
              disabled={isSavingSetup}
            >
              {isSavingSetup ? <ActivityIndicator color="#fff" /> : <Text style={styles.setupContinueText}>{t('home.continue')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isLanguageModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsLanguageModalOpen(false)}
      >
        <View style={styles.setupModalOverlay}>
          <View style={[styles.setupLanguageModalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.setupSectionTitle, { color: theme.textPrimary, marginBottom: 12 }]}>{t('settings.language')}</Text>
            <FlatList
              data={languageOptions}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => {
                const active = setupLanguage === item.value;
                return (
                  <TouchableOpacity
                    style={[
                      styles.setupLanguageOptionRow,
                      { borderColor: theme.border, backgroundColor: theme.surfaceElevated },
                      active && { borderColor: theme.accent },
                    ]}
                    onPress={() => {
                      setSetupLanguage(item.value);
                      setIsLanguageModalOpen(false);
                    }}
                  >
                    <View>
                      <Text style={[styles.setupLanguageOptionTitle, { color: theme.textPrimary }]}>{item.label}</Text>
                      <Text style={[styles.setupLanguageOptionSubtitle, { color: theme.textSecondary }]}>{item.nativeLabel}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
            <TouchableOpacity style={styles.setupCancelButtonRow} onPress={() => setIsLanguageModalOpen(false)}>
              <Text style={{ color: theme.textPrimary, fontSize: 15 }}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isRegionModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsRegionModalOpen(false)}
      >
        <View style={styles.setupModalOverlay}>
          <View style={[styles.setupLanguageModalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.setupSectionTitle, { color: theme.textPrimary, marginBottom: 12 }]}>{t('settings.region')}</Text>
            <FlatList
              data={['auto', ...Object.keys(regionUrlMap)]}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const active = setupRegion === item;
                const label = item === 'auto' ? t('settings.auto') : item;
                return (
                  <TouchableOpacity
                    style={[
                      styles.setupLanguageOptionRow,
                      { borderColor: theme.border, backgroundColor: theme.surfaceElevated },
                      active && { borderColor: theme.accent },
                    ]}
                    onPress={() => {
                      setSetupRegion(item);
                      setIsRegionModalOpen(false);
                    }}
                  >
                    <Text style={[styles.setupLanguageOptionTitle, { color: theme.textPrimary }]}>{label}</Text>
                    {active && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
            <TouchableOpacity style={styles.setupCancelButtonRow} onPress={() => setIsRegionModalOpen(false)}>
              <Text style={{ color: theme.textPrimary, fontSize: 15 }}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mainContent: {
    paddingTop: 10,
    flex: 1,
  },
  setupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  setupCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  setupTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  setupSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  setupSectionTitle: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '700',
  },
  setupWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  setupChip: {
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  setupChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  setupRow: {
    flexDirection: 'row',
    gap: 8,
  },
  setupSegment: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  setupSegmentText: {
    fontSize: 13,
    fontWeight: '700',
  },
  setupDropdownButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setupDropdownButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  setupModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  setupLanguageModalCard: {
    width: '88%',
    maxHeight: '70%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  setupLanguageOptionRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setupLanguageOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  setupLanguageOptionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  setupCancelButtonRow: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  setupContinueButton: {
    marginTop: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  setupContinueText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 22,
  },
  emptyBox: {
    marginHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
  },
  langChip: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  langChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
