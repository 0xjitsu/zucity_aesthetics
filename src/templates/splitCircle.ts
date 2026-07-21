import type { Template } from '../types';

export const splitCircle: Template = {
  id: 'split-circle',
  name: 'Split Circle',
  viewBox: [0, 0, 12, 12],
  regions: [
    {
      id: 'left',
      name: 'Left half',
      hint: 'Everything west of the vertical seam',
      d: 'M6 1A5 5 0 0 0 6 11Z',
      defaultFill: '#141416',
      z: 0,
    },
    {
      id: 'right',
      name: 'Right half',
      hint: 'Everything east of the vertical seam',
      d: 'M6 1A5 5 0 0 1 6 11Z',
      defaultFill: '#e8e6e1',
      z: 1,
    },
  ],
};
