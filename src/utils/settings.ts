import type { PluginActivity, PluginManagerDisplayMode, PluginManagerSettings, PluginUsage } from '../types';

export const DEFAULT_SETTINGS: PluginManagerSettings = {
  pinned: [],
  pinnedOrder: [],
  enabledOrder: [],
  disabledOrder: [],
  customNames: {},
  customDescs: {},
  displayMode: 'simple',
  usage: {},
  activity: [],
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

function displayMode(value: unknown): PluginManagerDisplayMode {
  return value === 'compact' || value === 'advanced' ? value : 'simple';
}

function usageMap(value: unknown): Record<string, PluginUsage> {
  if (!isRecord(value)) return {};
  const result: Record<string, PluginUsage> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item)) continue;
    const count = typeof item.count === 'number' && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0;
    const lastUsedAt = typeof item.lastUsedAt === 'number' && Number.isFinite(item.lastUsedAt) ? Math.max(0, item.lastUsedAt) : 0;
    result[key] = { count, lastUsedAt };
  }
  return result;
}

function activityList(value: unknown): PluginActivity[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      pluginId: typeof item.pluginId === 'string' ? item.pluginId : '',
      action: typeof item.action === 'string' ? item.action : '',
      timestamp: typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? Math.max(0, item.timestamp) : 0,
    }))
    .filter((item) => item.pluginId && item.action && item.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

export function normalizeSettings(data: unknown): PluginManagerSettings {
  if (!isRecord(data)) return { ...DEFAULT_SETTINGS };

  const legacyOrder = stringArray(data.order);
  const pinned = stringArray(data.pinned);
  const pinnedOrder = stringArray(data.pinnedOrder);
  const enabledOrder = stringArray(data.enabledOrder);
  const disabledOrder = stringArray(data.disabledOrder);

  return {
    pinned,
    pinnedOrder: pinnedOrder.length > 0 ? pinnedOrder : pinned,
    enabledOrder: enabledOrder.length > 0 ? enabledOrder : legacyOrder,
    disabledOrder,
    customNames: stringMap(data.customNames),
    customDescs: stringMap(data.customDescs),
    displayMode: displayMode(data.displayMode),
    usage: usageMap(data.usage),
    activity: activityList(data.activity),
  };
}
