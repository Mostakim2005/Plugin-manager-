export type PluginManagerDisplayMode = 'simple' | 'compact' | 'advanced';
export type PluginManagerFilter = 'all' | 'pinned' | 'enabled' | 'disabled' | 'recent' | 'frequent';

export interface PluginUsage {
  count: number;
  lastUsedAt: number;
}

export interface PluginActivity {
  pluginId: string;
  action: string;
  timestamp: number;
}

export interface PluginManagerSettings {
  pinned: string[];
  pinnedOrder: string[];
  enabledOrder: string[];
  disabledOrder: string[];
  customNames: Record<string, string>;
  customDescs: Record<string, string>;
  displayMode: PluginManagerDisplayMode;
  usage: Record<string, PluginUsage>;
  activity: PluginActivity[];
}

export interface ManagedPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
}
