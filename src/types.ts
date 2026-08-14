export interface PluginManagerSettings {
  pinned: string[];
  order: string[];
  customNames: Record<string, string>;
  customDescs: Record<string, string>;
}

export interface ManagedPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
}
