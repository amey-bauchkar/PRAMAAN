import type { ComponentType } from 'react';
import MorphSliderRaw from './MorphSlider.jsx';
import SpecularButtonRaw from './SpecularButton.jsx';
import FlexCarouselRaw from './FlexCarousel.jsx';

// The React Bits components are vendored as plain JS. These typed aliases keep the call sites checked loosely.
export interface MorphItem { image: string; caption?: string }
export const MorphSlider = MorphSliderRaw as unknown as ComponentType<{
  items: MorphItem[]; startIndex?: number; transition?: 'melt' | 'ripple' | 'shear' | 'swirl'; duration?: number; ease?: string;
  intensity?: number; scale?: number; aberration?: number; drift?: number; autoplay?: boolean; autoplayDelay?: number; loop?: boolean;
  radius?: number; overlayColor?: string; showCaptions?: boolean; showControls?: boolean; showIndicators?: boolean; className?: string;
}>;
export const SpecularButton = SpecularButtonRaw as unknown as ComponentType<Record<string, unknown> & { children?: React.ReactNode }>;
export interface CarouselItem { src: string; alt?: string; title?: string; subtitle?: string }
export const FlexCarousel = FlexCarouselRaw as unknown as ComponentType<{
  items: CarouselItem[]; preset?: 'liquid' | 'ribbon' | 'vortex' | 'arch'; intro?: 'rise' | 'bloom' | 'spin' | 'deal' | 'none';
  fit?: 'natural' | 'portrait' | 'square' | 'landscape'; cardHeight?: number; gap?: number; radius?: number; squeeze?: number;
  focusOnClick?: boolean; autoplay?: boolean; interval?: number; captions?: boolean; captureWheel?: boolean; className?: string;
}>;
