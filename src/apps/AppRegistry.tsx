import React from 'react';
import { AuraBar } from './AuraBar';
import { AuraJam } from './AuraJam';
import { PixelIcon } from '../components/PixelIcon';
import { GRIDS } from '../components/PixelGrids';

export interface AppManifest {
  id: string;
  name: string;
  icon: React.ReactNode;
  component: React.ComponentType<any>;
}

export const APPS: AppManifest[] = [
  {
    id: 'app-aura-bar',
    name: 'Aura Bar',
    icon: <PixelIcon grid={GRIDS.radio} color="currentColor" />,
    component: AuraBar,
  },
  {
    id: 'app-aura-jam',
    name: 'Aura Jam',
    icon: <PixelIcon grid={GRIDS.euclid} color="currentColor" />,
    component: AuraJam,
  }
];
