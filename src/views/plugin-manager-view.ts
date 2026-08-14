import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type PluginManagerSidebarPlugin from '../main';
import type { ManagedPlugin } from '../types';
import { EditPluginModal } from '../modals/edit-plugin-modal';

export const VIEW_TYPE_PLUGIN_MANAGER = 'plugin-manager-view';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PluginManagerView extends ItemView {
  private readonly plugin: PluginManagerSidebarPlugin;
  private searchQuery = '';

  constructor(leaf: WorkspaceLeaf, plugin: PluginManagerSidebarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PLUGIN_MANAGER;
  }

  getDisplayText(): string {
    return 'Plugin Manager';
  }

  getIcon(): string {
    return 'package';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  private render(): void {
    const container = this.containerEl.children[1];
    if (!(container instanceof HTMLElement)) return;

    container.empty();
    container.addClass('pms-view');

    const header = container.createDiv('pms-header');
    const titleRow = header.createDiv('pms-title-row');
    const titleGroup = titleRow.createDiv('pms-title-group');

    titleGroup.createEl('h2', {
      text: 'Plugin Manager',
      cls: 'pms-title',
    });
    titleGroup.createDiv({
      text: 'Manage your community plugins',
      cls: 'pms-subtitle',
    });

    const refreshButton = titleRow.createEl('button', {
      text: '↻',
      cls: 'pms-icon-button',
      attr: {
        type: 'button',
        'aria-label': 'Refresh plugin list',
        title: 'Refresh',
      },
    });
    refreshButton.addEventListener('click', () => this.refresh());

    const searchRow = header.createDiv('pms-search-row');
    searchRow.createSpan({
      text: '⌕',
      cls: 'pms-search-icon',
    });

    const searchInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: 'Search plugins…',
      cls: 'pms-search-input',
    });
    searchInput.value = this.searchQuery;
    searchInput.setAttribute('aria-label', 'Search plugins');

    const summary = header.createDiv('pms-summary');
    const list = container.createDiv('pms-list');

    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.buildPluginList(list);
    });

    this.updateSummary(summary);
    this.buildPluginList(list);
  }

  private refresh(): void {
    const list = this.containerEl.querySelector('.pms-list');
    const summary = this.containerEl.querySelector('.pms-summary');

    if (!(list instanceof HTMLElement) || !(summary instanceof HTMLElement)) {
      this.render();
      return;
    }

    this.updateSummary(summary);
    this.buildPluginList(list);
  }

  private updateSummary(summary: HTMLElement): void {
    summary.empty();

    const plugins = this.getPlugins();
    const enabled = plugins.filter((plugin) => plugin.enabled).length;

    summary.createSpan({
      text: `${plugins.length} plugin${plugins.length === 1 ? '' : 's'}`,
      cls: 'pms-summary-count',
    });
    summary.createSpan({
      text: '·',
      cls: 'pms-summary-separator',
    });
    summary.createSpan({
      text: `${enabled} enabled`,
      cls: 'pms-summary-enabled',
    });
  }

  private buildPluginList(list: HTMLElement): void {
    list.empty();

    const plugins = this.getSortedPlugins();
    const filter = this.searchQuery.trim().toLocaleLowerCase();

    const filtered = filter
      ? plugins.filter((plugin) => {
          const name = this.getDisplayName(plugin).toLocaleLowerCase();
          const description = this.getDescription(plugin).toLocaleLowerCase();
          const id = plugin.id.toLocaleLowerCase();

          return (
            name.includes(filter) ||
            id.includes(filter) ||
            description.includes(filter)
          );
        })
      : plugins;

    if (filtered.length === 0) {
      const empty = list.createDiv('pms-empty');
      empty.createDiv('pms-empty-icon').setText(filter ? '⌕' : '◌');
      empty.createEl('strong', {
        text: filter ? 'No plugins found' : 'No community plugins installed',
      });
      empty.createDiv({
        text: filter
          ? 'Try a different search term.'
          : 'Install a community plugin to manage it here.',
        cls: 'pms-empty-text',
      });
      return;
    }

    for (const plugin of filtered) {
      this.addPluginRow(list, plugin);
    }
  }

  private getPlugins(): ManagedPlugin[] {
    const manifests = this.app.plugins.manifests;
    const plugins: ManagedPlugin[] = [];

    for (const [id, manifest] of Object.entries(manifests)) {
      if (this.app.internalPlugins.plugins[id]) continue;

      plugins.push({
        id,
        name: manifest.name,
        description: manifest.description ?? '',
        version: manifest.version,
        enabled: this.app.plugins.enabledPlugins.has(id),
        manifest,
      });
    }

    return plugins;
  }

  private getSortedPlugins(): ManagedPlugin[] {
    const pinned = new Set(this.plugin.settings.pinned);
    const order = new Map(
      this.plugin.settings.order.map((id, index) => [id, index]),
    );

    return this.getPlugins().sort((a, b) => {
      const aPinned = pinned.has(a.id);
      const bPinned = pinned.has(b.id);

      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const aOrder = order.get(a.id);
      const bOrder = order.get(b.id);

      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;

      return this.getDisplayName(a).localeCompare(
        this.getDisplayName(b),
        undefined,
        { sensitivity: 'base' },
      );
    });
  }

  private getDisplayName(plugin: ManagedPlugin): string {
    return this.plugin.settings.customNames[plugin.id]?.trim() || plugin.name;
  }

  private getDescription(plugin: ManagedPlugin): string {
    return (
      this.plugin.settings.customDescs[plugin.id]?.trim() ||
      plugin.description
    );
  }

  private addPluginRow(list: HTMLElement, plugin: ManagedPlugin): void {
    const item = list.createDiv('pms-item');
    item.dataset.pluginId = plugin.id;

    const main = item.createDiv('pms-item-main');
    const info = main.createDiv('pms-item-info');
    const titleRow = info.createDiv('pms-item-title-row');

    titleRow.createEl('strong', {
      text: this.getDisplayName(plugin),
      cls: 'pms-plugin-name',
    });

    titleRow.createSpan({
      text: plugin.enabled ? 'Enabled' : 'Disabled',
      cls: `pms-status ${plugin.enabled ? 'is-enabled' : 'is-disabled'}`,
    });

    const meta = info.createDiv('pms-plugin-meta');
    meta.createSpan({
      text: plugin.id,
      cls: 'pms-plugin-id',
    });
    if (plugin.version) {
      meta.createSpan({
        text: `v${plugin.version}`,
        cls: 'pms-plugin-version',
      });
    }

    const description = this.getDescription(plugin);
    if (description) {
      info.createDiv({
        text: description,
        cls: 'pms-plugin-description',
      });
    }

    const actions = main.createDiv('pms-actions');
    const pinned = this.plugin.settings.pinned.includes(plugin.id);

    this.createActionButton(
      actions,
      pinned ? 'Unpin' : 'Pin',
      plugin,
      'pms-pin-button',
      '◇',
      () => this.togglePin(plugin.id),
    ).toggleClass('is-pinned', pinned);

    this.createActionButton(
      actions,
      'Move up',
      plugin,
      'pms-action-button',
      '↑',
      () => this.movePlugin(plugin.id, -1),
    );

    this.createActionButton(
      actions,
      'Move down',
      plugin,
      'pms-action-button',
      '↓',
      () => this.movePlugin(plugin.id, 1),
    );

    this.createActionButton(
      actions,
      'Edit details',
      plugin,
      'pms-action-button',
      '⋯',
      () => this.editPlugin(plugin),
    );

    const toggle = actions.createEl('label', {
      cls: 'pms-toggle',
      attr: {
        title: plugin.enabled ? 'Disable plugin' : 'Enable plugin',
      },
    });

    const input = toggle.createEl('input', {
      type: 'checkbox',
    });
    input.checked = plugin.enabled;
    input.setAttribute(
      'aria-label',
      `${plugin.enabled ? 'Disable' : 'Enable'} ${this.getDisplayName(plugin)}`,
    );
    toggle.createSpan({
      cls: 'pms-toggle-track',
    });

    input.addEventListener('change', () => {
      void this.togglePlugin(plugin, input);
    });

    this.createActionButton(
      actions,
      'Uninstall',
      plugin,
      'pms-delete-button',
      '×',
      () => this.uninstallPlugin(plugin),
    );
  }

  private createActionButton(
    parent: HTMLElement,
    label: string,
    plugin: ManagedPlugin,
    className: string,
    text: string,
    callback: () => void | Promise<void>,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      text,
      cls: className,
      attr: {
        type: 'button',
        'aria-label': `${label} ${this.getDisplayName(plugin)}`,
        title: label,
      },
    });

    button.addEventListener('click', () => {
      void callback();
    });

    return button;
  }

  private async togglePlugin(
    plugin: ManagedPlugin,
    input: HTMLInputElement,
  ): Promise<void> {
    input.disabled = true;

    try {
      if (input.checked) {
        await this.app.plugins.enablePlugin(plugin.id);
      } else {
        await this.app.plugins.disablePlugin(plugin.id);
      }

      new Notice(
        `${this.getDisplayName(plugin)} ${input.checked ? 'enabled' : 'disabled'}.`,
      );
      this.refresh();
    } catch (error) {
      input.checked = !input.checked;
      new Notice(
        `Failed to toggle ${this.getDisplayName(plugin)}: ${getErrorMessage(error)}`,
      );
      this.refresh();
    }
  }

  private async togglePin(id: string): Promise<void> {
    const index = this.plugin.settings.pinned.indexOf(id);

    if (index >= 0) {
      this.plugin.settings.pinned.splice(index, 1);
    } else {
      this.plugin.settings.pinned.push(id);
    }

    await this.plugin.saveSettings();
    this.refresh();
  }

  private editPlugin(plugin: ManagedPlugin): void {
    new EditPluginModal(
      this.app,
      plugin.name,
      this.plugin.settings.customNames[plugin.id] ?? '',
      this.plugin.settings.customDescs[plugin.id] ?? '',
      async (alias, description) => {
        if (alias) {
          this.plugin.settings.customNames[plugin.id] = alias;
        } else {
          delete this.plugin.settings.customNames[plugin.id];
        }

        if (description) {
          this.plugin.settings.customDescs[plugin.id] = description;
        } else {
          delete this.plugin.settings.customDescs[plugin.id];
        }

        await this.plugin.saveSettings();
        this.refresh();
      },
    ).open();
  }

  private async uninstallPlugin(plugin: ManagedPlugin): Promise<void> {
    const displayName = this.getDisplayName(plugin);
    const confirmed = window.confirm(
      `Uninstall "${displayName}"?\n\nThis removes the plugin from your vault.`,
    );

    if (!confirmed) return;

    try {
      await this.app.plugins.uninstallPlugin(plugin.id);

      delete this.plugin.settings.customNames[plugin.id];
      delete this.plugin.settings.customDescs[plugin.id];
      this.plugin.settings.pinned = this.plugin.settings.pinned.filter(
        (id) => id !== plugin.id,
      );
      this.plugin.settings.order = this.plugin.settings.order.filter(
        (id) => id !== plugin.id,
      );

      await this.plugin.saveSettings();
      new Notice(`"${displayName}" uninstalled.`);
      this.refresh();
    } catch (error) {
      new Notice(
        `Failed to uninstall ${displayName}: ${getErrorMessage(error)}`,
      );
    }
  }

  private async movePlugin(id: string, delta: -1 | 1): Promise<void> {
    const sortedIds = this.getSortedPlugins().map((plugin) => plugin.id);
    const pinned = new Set(this.plugin.settings.pinned);
    const isPinned = pinned.has(id);

    const group = sortedIds.filter((pluginId) => pinned.has(pluginId) === isPinned);
    const index = group.indexOf(id);
    if (index < 0) return;

    const target = index + delta;
    if (target < 0 || target >= group.length) return;

    const current = group[index];
    const replacement = group[target];
    if (current === undefined || replacement === undefined) return;

    group[index] = replacement;
    group[target] = current;

    const pinnedOrder = isPinned
      ? group
      : sortedIds.filter((pluginId) => pinned.has(pluginId));
    const unpinnedOrder = isPinned
      ? sortedIds.filter((pluginId) => !pinned.has(pluginId))
      : group;

    this.plugin.settings.order = [...pinnedOrder, ...unpinnedOrder];

    await this.plugin.saveSettings();
    this.refresh();
  }
}
