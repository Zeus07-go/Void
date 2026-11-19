// Destination registry — the ONLY place the portal learns what Universe 02 renders.
//
// Universe 02 (The Kaleidoscope) is now live.
// KaleidoscopeScene accepts { onReturn } which satisfies DestinationProps.

import type { ComponentType } from 'react';
import { KaleidoscopeScene as KaleidoscopeSceneImpl } from '../scenes/KaleidoscopeScene';

export type DestinationProps = {
  /** Call to jump back through the portal to the black hole. Same as startPortalJump('singularity'). */
  onReturn: () => void;
};

export const KaleidoscopeScene: ComponentType<DestinationProps> = KaleidoscopeSceneImpl;
export const KALEIDOSCOPE_IS_PREVIEW = false;
