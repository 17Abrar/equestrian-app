import Image from 'next/image';
import { cn } from '@/lib/utils';

type Variant = 'light' | 'dark';

interface CavaliqMarkProps {
  variant?: Variant;
  size?: number;
  className?: string;
  priority?: boolean;
}

export function CavaliqMark({ variant = 'light', size = 24, className, priority }: CavaliqMarkProps) {
  const src = variant === 'dark' ? '/brand/cavaliq-mark-dark.svg' : '/brand/cavaliq-mark.svg';
  return (
    <Image
      src={src}
      alt="Cavaliq"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      priority={priority}
    />
  );
}

const LOCKUP_NATURAL_WIDTH = 704;
const LOCKUP_NATURAL_HEIGHT = 256;
const WORDMARK_NATURAL_WIDTH = 866;
const WORDMARK_NATURAL_HEIGHT = 256;

interface CavaliqLogoProps {
  variant?: Variant;
  height?: number;
  className?: string;
  priority?: boolean;
}

export function CavaliqLogo({ variant = 'light', height = 32, className, priority }: CavaliqLogoProps) {
  const src =
    variant === 'dark'
      ? '/brand/cavaliq-logo-dark-trimmed.png'
      : '/brand/cavaliq-logo-trimmed.png';
  const width = Math.round((LOCKUP_NATURAL_WIDTH / LOCKUP_NATURAL_HEIGHT) * height);
  return (
    <Image
      src={src}
      alt="Cavaliq"
      width={LOCKUP_NATURAL_WIDTH}
      height={LOCKUP_NATURAL_HEIGHT}
      className={cn('shrink-0', className)}
      style={{ height, width }}
      priority={priority}
    />
  );
}

interface CavaliqWordmarkProps {
  variant?: Variant;
  height?: number;
  className?: string;
}

export function CavaliqWordmark({ variant = 'light', height = 24, className }: CavaliqWordmarkProps) {
  const src =
    variant === 'dark'
      ? '/brand/cavaliq-wordmark-dark-trimmed.png'
      : '/brand/cavaliq-wordmark-trimmed.png';
  const width = Math.round((WORDMARK_NATURAL_WIDTH / WORDMARK_NATURAL_HEIGHT) * height);
  return (
    <Image
      src={src}
      alt="Cavaliq"
      width={WORDMARK_NATURAL_WIDTH}
      height={WORDMARK_NATURAL_HEIGHT}
      className={cn('shrink-0', className)}
      style={{ height, width }}
    />
  );
}
