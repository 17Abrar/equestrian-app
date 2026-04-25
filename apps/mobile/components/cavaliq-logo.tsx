import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';

type Variant = 'light' | 'dark';

const lightLogo = require('../assets/brand/cavaliq-logo.png');
const darkLogo = require('../assets/brand/cavaliq-logo-dark.png');
const lightMark = require('../assets/brand/cavaliq-mark.png');
const darkMark = require('../assets/brand/cavaliq-mark-dark.png');

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
