import { Notice, Plugin } from 'obsidian';
import {
  PluginManagerView,
  VIEW_TYPE_PLUGIN_MANAGER,
} from './views/plugin-manager-view';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
} from './utils/settings';
import type { PluginManagerSettings } from './types';

export default class PluginManagerSidebarPlugin extends Plugin {
  settings: PluginManagerSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PLUGIN_MANAGER, (leaf) => {
      return new PluginManagerView(leaf, this);
    });

    this.addRibbonIcon('package', 'Open plugin manager', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-plugin-manager',
      name: 'Open sidebar',
      callback: () => {
        void this.activateView();
      },
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: import('obsidian').WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_PLUGIN_MANAGER)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);

      if (!leaf) {
        new Notice('Unable to create the plugin manager view.');
        return;
      }

      await leaf.setViewState({
        type: VIEW_TYPE_PLUGIN_MANAGER,
        active: true,
      });
    }

    void workspace.setActiveLeaf(leaf, { focus: true });
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
