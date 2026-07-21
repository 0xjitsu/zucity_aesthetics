import type { Template } from '../types';

/**
 * The square is inset to 1..11 so it occupies the same footprint as the
 * r=5 circle the other templates are built on.
 */
export const quadrantGrid: Template = {
  id: 'quadrant-grid',
  name: 'Quadrant Grid',
  viewBox: [0, 0, 12, 12],
  regions: [
    {
      id: 'tl',
      name: 'Top left',
      hint: 'North-west quarter of the square',
      d: 'M1 1H6V6H1Z',
      defaultFill: '#141416',
      z: 0,
    },
    {
      id: 'tr',
      name: 'Top right',
      hint: 'North-east quarter of the square',
      d: 'M6 1H11V6H6Z',
      defaultFill: '#e8e6e1',
      z: 1,
    },
    {
      id: 'bl',
      name: 'Bottom left',
      hint: 'South-west quarter of the square',
      d: 'M1 6H6V11H1Z',
      defaultFill: '#e8e6e1',
      z: 2,
    },
    {
      id: 'br',
      name: 'Bottom right',
      hint: 'South-east quarter of the square',
      d: 'M6 6H11V11H6Z',
      defaultFill: '#141416',
      z: 3,
    },
  ],
};
