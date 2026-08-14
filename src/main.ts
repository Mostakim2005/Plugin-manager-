import { Plugin, Notice } from 'obsidian';
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

    this.addRibbonIcon('package', 'Open Plugin Manager', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-plugin-manager',
      name: 'Open Plugin Manager sidebar',
      callback: () => {
        void this.activateView();
      },
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PLUGIN_MANAGER);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_PLUGIN_MANAGER)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);

      if (!leaf) {
        new Notice('Unable to create the Plugin Manager view.');
        return;
      }

      await leaf.setViewState({
        type: VIEW_TYPE_PLUGIN_MANAGER,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
