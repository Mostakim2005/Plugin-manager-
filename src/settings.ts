import type { PluginManagerSettings } from '../types';

export const DEFAULT_SETTINGS: PluginManagerSettings = {
  pinned: [],
  order: [],
  customNames: {},
  customDescs: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))];
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

export function normalizeSettings(data: unknown): PluginManagerSettings {
  if (!isRecord(data)) return { ...DEFAULT_SETTINGS };

  return {
    pinned: stringArray(data.pinned),
    order: stringArray(data.order),
    customNames: stringMap(data.customNames),
    customDescs: stringMap(data.customDescs),
  };
}
