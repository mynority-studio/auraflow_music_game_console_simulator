import React from 'react';
import { AuraBar } from './AuraBar'; 
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
  }
];
