import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MusicDostAPI, DEFAULT_SERVER_URL } from '../lib/musicdost-api';

interface MusicDostLoginProps {
  onDone: () => void;
}

/**
 * MusicDost server login — pehli baar app khulne par access code mangta hai.
 * Code sahi hua to backend token deta hai (AsyncStorage me save).
 * Server URL badalna ho to settings me option hai.
 */
export function MusicDostLogin({ onDone }: MusicDostLoginProps) {
  const [code, setCode] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [showServer, setShowServer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!code.trim()) {
      setError('Please enter your access code');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await MusicDostAPI.setServerUrl(serverUrl.trim() || DEFAULT_SERVER_URL);
      const ok = await MusicDostAPI.verify(code);
      if (ok) {
        onDone();
      } else {
        setError('Wrong code. Please try again.');
      }
    } catch (e) {
      setError('Could not reach server. Check your internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>🎵 MusicDost</Text>
        <Text style={styles.subtitle}>Connect to your music server</Text>

        <Text style={styles.label}>Access Code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="Enter code"
          placeholderTextColor="#666"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleConnect}
        />

        <TouchableOpacity onPress={() => setShowServer(!showServer)}>
          <Text style={styles.toggleServer}>
            {showServer ? '▾ Hide server settings' : '▸ Server settings'}
          </Text>
        </TouchableOpacity>

        {showServer && (
          <>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder={DEFAULT_SERVER_URL}
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footer}>Crafted by Omee ✨</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: '#262626',
  },
  logo: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1DB954',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#a9a9a9',
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d4d4d4',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
  },
  toggleServer: {
    color: '#1DB954',
    fontSize: 13,
    marginVertical: 8,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1DB954',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
