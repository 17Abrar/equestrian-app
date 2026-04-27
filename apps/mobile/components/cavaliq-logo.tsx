import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';
import lightLogo from '../assets/brand/cavaliq-logo.png';
import darkLogo from '../assets/brand/cavaliq-logo-dark.png';
import lightMark from '../assets/brand/cavaliq-mark.png';
import darkMark from '../assets/brand/cavaliq-mark-dark.png';

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

interface CavaliqMarkProps {
  variant?: Variant;
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function CavaliqMark({ variant = 'light', size = 32, style }: CavaliqMarkProps) {
  const source = variant === 'dark' ? darkMark : lightMark;
  return (
    <Image
      source={source}
      style={[{ height: size, width: size }, style]}
      contentFit="contain"
      accessibilityLabel="Cavaliq"
    />
  );
}
