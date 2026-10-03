import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, Easing } from 'react-native';

interface AnimatedSplashProps {
  onDone: () => void;
  /** How long the splash stays fully visible before fading out (ms). */
  holdMs?: number;
}

/**
 * Branded launch splash for MusicDost.
 * "MusicDost" pops in with a springy scale, then "Crafted by Omee ✨"
 * slides up and fades in. After `holdMs` the whole overlay fades out
 * and `onDone` unmounts it.
 */
export function AnimatedSplash({ onDone, holdMs = 2000 }: AnimatedSplashProps) {
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const omeeY = useRef(new Animated.Value(24)).current;
  const omeeOpacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // Dismissal timer is set up FIRST so the splash can never get stuck,
    // even if an animation throws in a hostile environment.
    const timer = setTimeout(() => {
      try {
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => onDoneRef.current());
      } catch {
        onDoneRef.current();
      }
    }, holdMs);
    // Backup: hard-dismiss shortly after the fade should have finished.
    const backup = setTimeout(() => onDoneRef.current(), holdMs + 1000);

    try {
      // Logo pop-in
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
      ]).start();

      // "Crafted by Omee ✨" slide-up fade, delayed
      Animated.parallel([
        Animated.timing(omeeOpacity, {
          toValue: 1,
          duration: 600,
          delay: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(omeeY, {
          toValue: 0,
          duration: 600,
          delay: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } catch {
      // Animations are decorative; the timers above still dismiss the splash.
    }

    return () => {
      clearTimeout(timer);
      clearTimeout(backup);
    };
  }, [holdMs, logoOpacity, logoScale, omeeOpacity, omeeY, overlayOpacity]);

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <Animated.Text
        style={[
          styles.logo,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        MusicDost
      </Animated.Text>
      <Animated.Text
        style={[
          styles.omee,
          { opacity: omeeOpacity, transform: [{ translateY: omeeY }] },
        ]}
      >
        Crafted by Omee ✨
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  logo: {
    fontSize: 46,
    fontWeight: '800',
    color: '#1DB954',
    letterSpacing: 1,
  },
  omee: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '600',
    color: '#A3A3A3',
    letterSpacing: 0.5,
  },
});
