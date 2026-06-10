import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';
import lightLogo from '../assets/brand/cavaliq-logo.png';
import darkLogo from '../assets/brand/cavaliq-logo-dark.png';

type Variant = 'light' | 'dark';

const LOCKUP_ASPECT = 704 / 256;

interface CavaliqLogoProps {
  variant?: Variant;
  height?: number;
  style?: StyleProp<ImageStyle>;
}

export function CavaliqLogo({ variant = 'light', height = 32, style }: CavaliqLogoProps) {
  const source = variant === 'dark' ? darkLogo : lightLogo;
  return (
    <Image
      source={source}
      style={[{ height, width: height * LOCKUP_ASPECT }, style]}
      contentFit="contain"
      accessibilityLabel="Cavaliq"
    />
  );
}
