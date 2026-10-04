/**
 * MusicDost API layer — OpenSpot clone ko HAMARE Render backend se jodta hai.
 *
 * Backend: https://musicdost-backend.onrender.com
 *  - POST /api/verify          {code} -> {ok, token}
 *  - GET  /api/search?q=       -> {results: [{key,title,artist,duration,cached,image,ytid}]}
 *  - GET  /api/stream?title=&artist=[&ytid=]&token=  -> audio (Range support)
 *  - GET  /api/download?...   -> audio file
 *  - GET  /api/trending?lang=  -> {songs: [{title,artist,duration,image}], name}
 *
 * Auth: token AsyncStorage me save hota hai, har request me ?token= ya X-App-Token.
 * 401 aaye to token clear + onAuthExpired listeners ko notify (login screen wapas).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SearchResponse, SearchParams, Track } from '../types/music';

export const DEFAULT_SERVER_URL = 'https://musicdost-backend.onrender.com';

const SERVER_URL_KEY = 'musicdost_server_url_v1';
const TOKEN_KEY = 'musicdost_app_token_v1';

export class MusicDostAuthError extends Error {
  constructor(message = 'Session expired. Please login again.') {
    super(message);
    this.name = 'MusicDostAuthError';
  }
}

type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

/** JioSaavn chart IDs (home ke language chips) -> hamare /api/trending lang */
const CHART_ID_TO_LANG: Record<string, string> = {
  '1134543272': 'hindi',
  '1134543273': 'english',
  '1134543511': 'punjabi',
  '1134770917': 'haryanvi',
  '1134768973': 'bhojpuri',
  '1296588511': 'bhakti',
};

const emptyTrackDefaults = {
  artistId: 0,
  albumTitle: '',
  albumId: '',
  releaseDate: '',
  genre: '',
  audioQuality: { maximumBitDepth: 16, maximumSamplingRate: 44100, isHiRes: false },
  version: null as string | null,
  label: '',
  labelId: 0,
  upc: '',
  mediaCount: 0,
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
  isrc: '',
};

export class MusicDostAPI {
  // ---------- auth listeners ----------
  static onAuthExpired(cb: AuthExpiredListener): () => void {
    authExpiredListeners.add(cb);
    return () => authExpiredListeners.delete(cb);
  }

  private static notifyAuthExpired() {
    authExpiredListeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }

  // ---------- config ----------
  static async getServerUrl(): Promise<string> {
    try {
      const v = await AsyncStorage.getItem(SERVER_URL_KEY);
      return (v || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    } catch {
      return DEFAULT_SERVER_URL;
    }
  }

  static async setServerUrl(url: string): Promise<void> {
    await AsyncStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ''));
  }

  static async getToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  static async verify(code: string): Promise<boolean> {
    const base = await this.getServerUrl();
    const res = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data && data.ok && data.token) {
      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      return true;
    }
    return false;
  }

  static async logout(): Promise<void> {
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  /** Token abhi bhi valid hai? (Render restart par in-memory tokens wipe ho jate hain) */
  static async validateToken(): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;
    try {
      const base = await this.getServerUrl();
      const res = await fetch(`${base}/api/playlists?token=${encodeURIComponent(token)}`);
      if (res.status === 401) {
        await this.logout();
        return false;
      }
      return res.ok;
    } catch {
      // network fail = offline grace, token ko valid mano
      return true;
    }
  }

  private static async req(path: string, init?: RequestInit): Promise<any> {
    const base = await this.getServerUrl();
    const token = await this.getToken();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${base}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`;
    let res = await fetch(url, init);

    // SILENT TOKEN REFRESH (2026-10-03): 401 aaye to turant logout mat
    // karo — pehle ek baar silently retry karo. Transient glitch ya
    // Render restart ke just baad ka race condition ho sakta hai.
    if (res.status === 401) {
      console.log('[auth] 401 received, attempting silent retry before logout…');
      try {
        // Token dobara validate karo (backend shayad recover ho gaya ho)
        const stillValid = await this.validateToken();
        if (stillValid) {
          // Retry with same token
          res = await fetch(url, init);
          if (res.ok) {
            console.log('[auth] silent retry succeeded!');
            return res.json();
          }
        }
      } catch {}
      // Silent refresh fail — ab logout + notify (existing flow)
      await this.logout();
      this.notifyAuthExpired();
      throw new MusicDostAuthError();
    }
    if (!res.ok) {
      throw new Error(`Server error (${res.status})`);
    }
    return res.json();
  }

  // ---------- track mapping ----------
  private static toTrack(item: {
    key?: string;
    title?: string;
    artist?: string;
    duration?: number;
    image?: string;
    ytid?: string;
  }): Track {
    const title = item.title || 'Unknown';
    const artist = item.artist || 'Unknown Artist';
    const image = item.image || '';
    const id = item.key || `${title}|${artist}`.toLowerCase();
    return {
      id,
      provider: 'saavn',
      title,
      artist,
      albumCover: image,
      duration: Number(item.duration) || 0,
      images: { small: image, thumbnail: image, large: image, back: null },
      mdTitle: title,
      mdArtist: artist,
      mdYtid: item.ytid || '',
      ...emptyTrackDefaults,
    } as Track;
  }

  // ---------- search ----------

  /**
   * SEARCH CLEANUP (2026-10-04) — Bot-like accuracy:
   * Backend se aane wale raw results me duplicates aur irrelevant
   * covers/remixes hote hain. Yahan client-side post-processing:
   *  1. Deduplicate (normalized title+artist)
   *  2. Cover/remix/lofi/slowed versions filter-out (unless query me hi ho)
   *  3. Exact title + artist match ko priority score
   *  4. Top 10 precise results return
   */
  private static normalizeForMatch(s: unknown): string {
    return (typeof s === 'string' ? s : '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Ye words title me hon to (usually) cover/remix/fan-made version hai */
  private static readonly JUNK_TITLE_PATTERNS: RegExp[] = [
    /\bcover\b/i,
    /\bremix\b/i,
    /\bmashup\b/i,
    /\blofi\b/i,
    /\bslowed/i,
    /\breverb\b/i,
    /\bkaraoke\b/i,
    /\binstrumental\b/i,
    /\bunplugged\b/i,
    /\bacoustic version\b/i,
    /\bdj\s/i,
    /\btiktok/i,
    /\bring(tone|back)?\b/i,
    /\b8d\b/i,
    /\bnightcore\b/i,
    /\bsped\s?up\b/i,
  ];

  private static isJunkVersion(title: string, query: string): boolean {
    const q = this.normalizeForMatch(query);
    // Agar user ne khud "remix" ya "cover" search kiya ho to filter mat karo
    for (const pat of this.JUNK_TITLE_PATTERNS) {
      if (pat.test(title)) {
        // query me ye word hai? (jaise user ne "lofi" manga ho)
        const word = pat.source.replace(/\\b/g, '').replace(/[^a-z]/gi, '').toLowerCase();
        if (word.length > 2 && q.includes(word)) continue;
        return true;
      }
    }
    return false;
  }

  /**
   * Relevance score: exact title match (100) + artist match (50) +
   * title starts-with (30) + word overlap bonus. Higher = better.
   */
  private static scoreResult(track: Track, query: string): number {
    const nq = this.normalizeForMatch(query);
    const nt = this.normalizeForMatch(track.title);
    const na = this.normalizeForMatch(track.artist);
    if (!nq || !nt) return 0;

    let score = 0;
    // Exact title match — sabse zyada priority
    if (nt === nq) score += 100;
    else if (nt.startsWith(nq)) score += 40;
    else if (nt.includes(nq)) score += 20;

    // Query me artist ka naam bhi ho (jaise "tum hi ho arijit singh")
    // to artist match bonus
    const qWords = nq.split(' ').filter((w) => w.length > 2);
    const tWords = new Set(nt.split(' '));
    const aWords = new Set(na.split(' '));
    let titleOverlap = 0;
    let artistOverlap = 0;
    for (const w of qWords) {
      if (tWords.has(w)) titleOverlap++;
      if (aWords.has(w)) artistOverlap++;
    }
    score += titleOverlap * 10;
    score += artistOverlap * 15;

    // Dono (title + artist) match = strong signal
    if (titleOverlap > 0 && artistOverlap > 0) score += 25;

    return score;
  }

  static cleanSearchResults(tracks: Track[], query: string): Track[] {
    if (!Array.isArray(tracks) || tracks.length === 0) return [];

    // 1. Deduplicate: normalized "title|artist" key
    const seen = new Set<string>();
    const deduped: Track[] = [];
    for (const t of tracks) {
      if (!t || t.title == null) continue;
      const key = `${this.normalizeForMatch(t.title)}|${this.normalizeForMatch(t.artist)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(t);
    }

    // 2. Junk versions filter-out (covers/remixes/lofi — unless queried)
    const filtered = deduped.filter(
      (t) => !this.isJunkVersion(String(t.title || ''), query)
    );
    // Agar filter ke baad kuch na bache to original deduped wapas do
    // (over-filtering se khaali result achha nahi)
    const candidates = filtered.length > 0 ? filtered : deduped;

    // 3. Score + sort: exact title+artist matches sabse upar
    const scored = candidates.map((t) => ({
      track: t,
      score: this.scoreResult(t, query),
    }));
    scored.sort((a, b) => b.score - a.score);

    // 4. Top 10 precise results
    return scored.slice(0, 10).map((s) => s.track);
  }

  static async searchTracks(query: string): Promise<Track[]> {
    const data = await this.req(`/api/search?q=${encodeURIComponent(query)}`);
    const results = (data && data.results) || [];
    const tracks = results.map((r: any) => this.toTrack(r));
    // SEARCH CLEANUP (2026-10-04): dedupe + junk filter + prioritization
    try {
      return this.cleanSearchResults(tracks, query);
    } catch (e) {
      console.warn('[search-cleanup] failed, returning raw:', e);
      return tracks;
    }
  }

  static async search(params: SearchParams): Promise<SearchResponse> {
    // Hamara backend sirf tracks deta hai — albums/artists/playlists khaali
    const tracks = await this.searchTracks(params.q);
    return {
      tracks,
      albums: [],
      artists: [],
      playlists: [],
      pagination: { offset: 0, total: tracks.length, hasMore: false },
    };
  }

  // ---------- stream / download ----------
  private static mdOf(track: Track): { title: string; artist: string; ytid: string } {
    const t = track as Track & { mdTitle?: string; mdArtist?: string; mdYtid?: string };
    return {
      title: t.mdTitle || t.title || '',
      artist: t.mdArtist || t.artist || '',
      ytid: t.mdYtid || '',
    };
  }

  static async getStreamUrl(track: Track): Promise<string> {
    const base = await this.getServerUrl();
    const token = await this.getToken();
    if (!token) throw new MusicDostAuthError();
    const { title, artist, ytid } = this.mdOf(track);
    let url =
      `${base}/api/stream?title=${encodeURIComponent(title)}` +
      `&artist=${encodeURIComponent(artist)}`;
    if (ytid) url += `&ytid=${encodeURIComponent(ytid)}`;
    url += `&token=${encodeURIComponent(token)}`;
    return url;
  }

  static async getDownloadUrl(track: Track): Promise<string> {
    const base = await this.getServerUrl();
    const token = await this.getToken();
    if (!token) throw new MusicDostAuthError();
    const { title, artist, ytid } = this.mdOf(track);
    let url =
      `${base}/api/download?title=${encodeURIComponent(title)}` +
      `&artist=${encodeURIComponent(artist)}`;
    if (ytid) url += `&ytid=${encodeURIComponent(ytid)}`;
    url += `&token=${encodeURIComponent(token)}`;
    return url;
  }

  // ---------- trending ----------
  static async getTrending(lang: string): Promise<Track[]> {
    const data = await this.req(`/api/trending?lang=${encodeURIComponent(lang.toLowerCase())}`);
    const songs = (data && data.songs) || [];
    return songs.map((s: any) => this.toTrack(s));
  }

  static async getPopularTracks(): Promise<Track[]> {
    return this.getTrending('hindi');
  }

  /** JioSaavn chart ID (home ke language chips) -> hamare trending */
  static async getPlaylistSongs(chartId: string): Promise<Track[]> {
    const lang = CHART_ID_TO_LANG[String(chartId)];
    if (!lang) return [];
    return this.getTrending(lang);
  }
}
