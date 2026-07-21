import type { Template } from '../types';
import { yinYang } from './yinYang';
import { splitCircle } from './splitCircle';
import { triskelion } from './triskelion';
import { quadrantGrid } from './quadrantGrid';

/**
 * Adding a template is a new file plus one line here. No component changes.
 * Regions are drawn in ascending `z`; the registry does not care how many
 * there are.
 */
export const TEMPLATES: Template[] = [yinYang, splitCircle, triskelion, quadrantGrid];

export const CUSTOM_TEMPLATE_ID = 'custom';

export const DEFAULT_TEMPLATE_ID = yinYang.id;

export function findTemplate(id: string, custom?: Template | null): Template {
  if (custom && custom.id === id) return custom;
  return TEMPLATES.find((t) => t.id === id) ?? yinYang;
}

export function sortedRegions(template: Template) {
  return [...template.regions].sort((a, b) => a.z - b.z);
}
