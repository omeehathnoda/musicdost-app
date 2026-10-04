import { useState, useEffect, useCallback, useRef } from 'react';
import { Track, Album, Artist, PlaylistSearchItem } from '../types/music';
import { MusicAPI } from '../lib/music-api';

interface UseSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  results: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: PlaylistSearchItem[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  searchType: 'track' | 'album' | 'artist' | 'playlist';
  setSearchType: (type: 'track' | 'album' | 'artist' | 'playlist') => void;
  searchTracks: (searchQuery: string, type?: 'track' | 'album' | 'artist' | 'playlist') => Promise<void>;
  loadMore: () => Promise<void>;
  clearResults: () => void;
}

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [searchType, setSearchType] = useState<'track' | 'album' | 'artist' | 'playlist'>('track');


  const currentSearchRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const isLoadingMoreRef = useRef(false);

  // SEARCH CRASH FIX (2026-10-04): null-safe merge — malformed items ya
  // non-array response par 'undefined is not a function' crash rokta hai
  const mergeUniqueById = useCallback(<T extends { id: string | number }>(existing: T[], incoming: T[]) => {
    const safeExisting = Array.isArray(existing) ? existing : [];
    const safeIncoming = Array.isArray(incoming) ? incoming : [];
    const seen = new Set(safeExisting.map((item) => item?.id?.toString()).filter(Boolean));
    const merged = [...safeExisting];
    let addedCount = 0;
    for (const item of safeIncoming) {
      const key = item?.id?.toString();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(item);
        addedCount += 1;
      }
    }
    return { merged, addedCount };
  }, []);

  const searchTracks = useCallback(async (searchQuery: string, type?: 'track' | 'album' | 'artist' | 'playlist') => {
    if (!searchQuery.trim()) {
      setResults([]);
      setAlbums([]);
      setArtists([]);
      setPlaylists([]);
      setHasMore(false);
      return;
    }


    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }


    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    currentSearchRef.current = searchQuery;

    setIsLoading(true);
    setError(null);
    setPage(1);

    try {
      const response = await MusicAPI.search({
        q: searchQuery,
        page: 1,
        type: type || searchType
      });

      const searchTypeToUse = type || searchType;

      if (currentSearchRef.current === searchQuery && !abortController.signal.aborted) {
        // SEARCH CRASH FIX (2026-10-04): backend kabhi null/undefined bhej de
        // to downstream .map/.filter crash na ho — hamesha array set karo
        const asArr = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
        if (searchTypeToUse === 'track') {
          setResults(asArr(response?.tracks));
          setAlbums([]);
          setArtists([]);
          setPlaylists([]);
        } else if (searchTypeToUse === 'album') {
          setAlbums(asArr(response?.albums));
          setResults([]);
          setArtists([]);
          setPlaylists([]);
        } else if (searchTypeToUse === 'artist') {
          setArtists(asArr(response?.artists));
          setResults([]);
          setAlbums([]);
          setPlaylists([]);
        } else {
          setPlaylists(asArr(response?.playlists));
          setResults([]);
          setAlbums([]);
          setArtists([]);
        }
        setHasMore(!!response?.pagination?.hasMore);
      }
    } catch (err) {

      if (!abortController.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setAlbums([]);
        setArtists([]);
        setPlaylists([]);
        setHasMore(false);
      }
    } finally {

      if (currentSearchRef.current === searchQuery && !abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [searchType]);

  const handleSetSearchType = useCallback((type: 'track' | 'album' | 'artist' | 'playlist') => {
    if (type !== searchType) {
      setSearchType(type);
      setResults([]);
      setAlbums([]);
      setArtists([]);
      setPlaylists([]);
      setPage(1);
      setHasMore(false);
      if (query.trim()) {
        searchTracks(query, type);
      }
    }
  }, [searchType, query, searchTracks]);

  const loadMore = useCallback(async () => {
    if (!query.trim() || !hasMore || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;

    const nextPage = page + 1;

    setIsLoading(true);
    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await MusicAPI.search({
        q: query,
        page: nextPage,
        type: searchType
      });

      if (abortController.signal.aborted) return;

      if (searchType === 'track') {
        const { merged } = mergeUniqueById(results, response?.tracks);
        setResults(merged);
      } else if (searchType === 'album') {
        const { merged } = mergeUniqueById(albums, response?.albums);
        setAlbums(merged);
      } else if (searchType === 'artist') {
        const { merged } = mergeUniqueById(artists, response?.artists);
        setArtists(merged);
      } else {
        const { merged } = mergeUniqueById(playlists, response?.playlists);
        setPlaylists(merged);
      }
      setPage(nextPage);
      setHasMore(!!response?.pagination?.hasMore);
    } catch (err) {
      if (!abortController.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load more results');
        setHasMore(false);
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
      isLoadingMoreRef.current = false;
    }
  }, [query, page, hasMore, searchType, mergeUniqueById, results, albums, artists, playlists]);

  const clearResults = useCallback(() => {

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setResults([]);
    setAlbums([]);
    setArtists([]);
    setPlaylists([]);
    setQuery('');
    setError(null);
    setHasMore(false);
    setPage(1);
    setIsLoading(false);
    isLoadingMoreRef.current = false;
    currentSearchRef.current = '';
  }, []);


  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    query,
    setQuery,
    results,
    albums,
    artists,
    playlists,
    isLoading,
    error,
    hasMore,
    searchType,
    setSearchType: handleSetSearchType,
    searchTracks,
    loadMore,
    clearResults,
  };
} 