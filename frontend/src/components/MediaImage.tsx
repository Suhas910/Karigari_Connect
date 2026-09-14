// src/components/MediaImage.tsx
import React from 'react';
import { Image, View, type ImageStyle, type StyleProp } from 'react-native';
import { useMediaSource } from '../services/media';

/** An image from a backend media URL (sent with the login token) or a local URI. */
export default function MediaImage({ url, style }: { url?: string | null; style?: StyleProp<ImageStyle> }) {
  const source = useMediaSource(url);
  if (!source) {
    return <View style={style as any} />;
  }
  return <Image source={source} style={style} />;
}
