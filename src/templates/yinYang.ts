import type { Template } from '../types';

export const yinYang: Template = {
  id: 'yin-yang',
  name: 'Yin Yang',
  viewBox: [0, 0, 12, 12],
  regions: [
    {
      id: 'yang',
      name: 'Dark half',
      hint: 'The S-curve half that wraps the top dot',
      d: 'M3.5 8.5A2.5 2.5 0 0 1 6 6a2.5 2.5 0 1 0 0-5 5 5 0 1 1 0 10 2.5 2.5 0 0 1-2.5-2.5Z',
      defaultFill: '#141416',
      z: 0,
    },
    {
      id: 'yin',
      name: 'Light half',
      hint: 'The mirrored half that wraps the bottom dot',
      d: 'M1 6a5 5 0 0 1 5-5 2.5 2.5 0 1 1 0 5 2.5 2.5 0 1 0 0 5 5 5 0 0 1-5-5Z',
      defaultFill: '#e8e6e1',
      z: 1,
    },
    {
      id: 'dotT',
      name: 'Top dot',
      hint: 'The small eye inside the upper lobe',
      d: 'M6.898 3.5a.899.899 0 1 0-1.797 0 .899.899 0 0 0 1.797 0',
      defaultFill: '#141416',
      z: 2,
    },
    {
      id: 'dotB',
      name: 'Bottom dot',
      hint: 'The small eye inside the lower lobe',
      d: 'M6.898 8.5a.899.899 0 1 0-1.797 0 .899.899 0 0 0 1.797 0',
      defaultFill: '#e8e6e1',
      z: 3,
    },
  ],
};
