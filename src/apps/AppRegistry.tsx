import React from 'react';
import { AuraRadio } from './AuraRadio'; 
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
    id: 'app-aura-radio',
    name: 'Aura Radio',
    icon: <PixelIcon grid={GRIDS.radio} color="currentColor" />,
    component: AuraRadio, 
  }
];
