import {
  ItemView,
  Menu,
  Modal,
  Notice,
  type PluginManifest,
  type WorkspaceLeaf,
  type App,
  TFile,
} from 'obsidian';
import type PluginManagerSidebarPlugin from '../main';
import type {
  ManagedPlugin,
  PluginActivity,
  PluginManagerDisplayMode,
  PluginManagerFilter,
} from '../types';
import { normalizeSettings } from '../utils/settings';
import { EditPluginModal } from '../modals/edit-plugin-modal';

export const VIEW_TYPE_PLUGIN_MANAGER = 'plugin-manager-view';
const LAYOUT_FILE = 'Plugin Manager Layout.json';
const RECENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 14;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PluginManagerApi {
  manifests: Record<string, PluginManifest>;
  enabledPlugins: Set<string>;
  enablePlugin(id: string): Promise<void>;
  disablePlugin(id: string): Promise<void>;
  uninstallPlugin(id: string): Promise<void>;
}

interface InternalPluginsApi {
  plugins: Record<string, unknown>;
}

interface SettingsApi {
  openTabById?: (id: string) => void;
}

interface CommandsApi {
  listCommands?: () => Record<string, { id: string; name: string }> | Array<{ id: string; name: string }>;
  executeCommandById?: (id: string) => boolean | void | Promise<boolean | void>;
}

interface AppWithPluginManager extends App {
  plugins: PluginManagerApi;
  internalPlugins: InternalPluginsApi;
  setting?: SettingsApi;
}

interface PluginCommand {
  id: string;
  name: string;
}

export class PluginManagerView extends ItemView {
  private readonly plugin: PluginManagerSidebarPlugin;
  private searchQuery = '';
  private reorderMode = false;
  private dragPluginId: string | null = null;
  private longPressTimer: number | null = null;
  private longPressStartX = 0;
  private longPressStartY = 0;
  private busyPlugins = new Set<string>();
  private filter: PluginManagerFilter = 'all';

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
    await this.reconcileSettings(false);
    this.render();
  }

  async onClose(): Promise<void> {
    this.clearLongPress();
    this.containerEl.empty();
  }

  private render(): void {
    const container = this.containerEl.children[1];
    if (!(container instanceof HTMLElement)) return;

    container.empty();
    container.addClass('pms-view');
    container.dataset.mode = this.plugin.settings.displayMode;

    const header = container.createDiv('pms-header');
    const titleRow = header.createDiv('pms-title-row');
    const titleGroup = titleRow.createDiv('pms-title-group');

    const titleLine = titleGroup.createDiv('pms-title-line');
    const title = titleLine.createEl('h2', { text: 'Plugin Manager', cls: 'pms-title' });
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.title = 'Change display mode';
    title.addEventListener('click', (event) => this.openModeMenu(event as MouseEvent));
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.openModeMenuFromElement(title);
      }
    });
    titleLine.createSpan({ text: this.getModeLabel(), cls: 'pms-mode-badge' });
    titleGroup.createDiv({ text: 'Manage your community plugins', cls: 'pms-subtitle' });

    const headerActions = titleRow.createDiv('pms-header-actions');
    this.addIconButton(headerActions, '↻', 'Refresh and repair', () => {
      void this.repairAndRefresh();
    });
    this.addIconButton(headerActions, '☰', 'Plugin manager options', (event) => {
      this.openHeaderMenu(event);
    });

    const searchRow = header.createDiv('pms-search-row');
    searchRow.createSpan({ text: '⌕', cls: 'pms-search-icon' });
    const searchInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: 'Search plugins…',
      cls: 'pms-search-input',
    });
    searchInput.value = this.searchQuery;
    searchInput.setAttribute('aria-label', 'Search plugins');
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.buildPluginList(list);
    });

    const filterButton = searchRow.createEl('button', {
      text: this.getFilterLabel(),
      cls: 'pms-filter-button',
      attr: { type: 'button', 'aria-label': 'Filter plugins' },
    });
    filterButton.addEventListener('click', (event) => this.openFilterMenu(event as MouseEvent));

    const summary = header.createDiv('pms-summary');
    const list = container.createDiv('pms-list');

    this.updateSummary(summary);
    this.buildPluginList(list);
  }

  private addIconButton(
    parent: HTMLElement,
    text: string,
    label: string,
    callback: (event: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      text,
      cls: 'pms-icon-button',
      attr: { type: 'button', 'aria-label': label, title: label },
    });
    button.addEventListener('click', callback);
    return button;
  }

  private openHeaderMenu(event: MouseEvent): void {
    const menu = new Menu();
    this.addMenuModeItems(menu);

    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(this.reorderMode ? 'Exit reorder mode' : 'Reorder plugins');
      item.setIcon('move');
      item.onClick(() => {
        this.reorderMode = !this.reorderMode;
        this.render();
      });
    });
    menu.addItem((item) => {
      item.setTitle('Filter plugins');
      item.setIcon('filter');
      item.onClick(() => this.openFilterMenuNearHeader());
    });
    menu.addItem((item) => {
      item.setTitle('Recent activity');
      item.setIcon('history');
      item.onClick(() => this.openActivityModal());
    });
    menu.addItem((item) => {
      item.setTitle('Plugin health');
      item.setIcon('heart-pulse');
      item.onClick(() => this.openHealthModal());
    });
    menu.addItem((item) => {
      item.setTitle('Plugin commands');
      item.setIcon('command');
      item.onClick(() => this.openCommandLauncher());
    });
    menu.addItem((item) => {
      item.setTitle('Import / export layout');
      item.setIcon('file-json');
      item.onClick(() => this.openLayoutMenu());
    });
    menu.addItem((item) => {
      item.setTitle('Reset customizations');
      item.setIcon('rotate-ccw');
      item.onClick(() => void this.resetCustomizations());
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle('Repair plugin list');
      item.setIcon('refresh-cw');
      item.onClick(() => void this.repairAndRefresh());
    });

    menu.showAtMouseEvent(event);
  }

  private addMenuModeItems(menu: Menu): void {
    menu.addItem((item) => {
      item.setTitle('Simple mode');
      item.setIcon('layout-list');
      item.setChecked(this.plugin.settings.displayMode === 'simple');
      item.onClick(() => void this.setDisplayMode('simple'));
    });
    menu.addItem((item) => {
      item.setTitle('Compact mode');
      item.setIcon('rows-3');
      item.setChecked(this.plugin.settings.displayMode === 'compact');
      item.onClick(() => void this.setDisplayMode('compact'));
    });
    menu.addItem((item) => {
      item.setTitle('Advanced mode');
      item.setIcon('panels-top-left');
      item.setChecked(this.plugin.settings.displayMode === 'advanced');
      item.onClick(() => void this.setDisplayMode('advanced'));
    });
  }

  private openModeMenu(event: MouseEvent): void {
    const menu = new Menu();
    this.addMenuModeItems(menu);
    menu.showAtMouseEvent(event);
  }

  private openModeMenuFromElement(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const menu = new Menu();
    this.addMenuModeItems(menu);
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private async setDisplayMode(mode: PluginManagerDisplayMode): Promise<void> {
    this.plugin.settings.displayMode = mode;
    await this.plugin.saveSettings();
    this.recordActivity('__manager__', `Switched to ${this.getModeLabel(mode)} mode`);
    this.render();
  }

  private getModeLabel(mode = this.plugin.settings.displayMode): string {
    if (mode === 'compact') return 'Compact';
    if (mode === 'advanced') return 'Advanced';
    return 'Simple';
  }

  private getFilterLabel(): string {
    switch (this.filter) {
      case 'pinned': return 'Pinned';
      case 'enabled': return 'Enabled';
      case 'disabled': return 'Disabled';
      case 'recent': return 'Recent';
      case 'frequent': return 'Frequent';
      default: return 'All';
    }
  }

  private openFilterMenu(event: MouseEvent): void {
    const menu = new Menu();
    const filters: Array<[PluginManagerFilter, string]> = [
      ['all', 'All plugins'],
      ['pinned', 'Pinned'],
      ['enabled', 'Enabled'],
      ['disabled', 'Disabled'],
      ['recent', 'Recently used'],
      ['frequent', 'Frequently used'],
    ];
    for (const [value, label] of filters) {
      menu.addItem((item) => {
        item.setTitle(label);
        item.setChecked(this.filter === value);
        item.onClick(() => {
          this.filter = value;
          this.render();
        });
      });
    }
    menu.showAtMouseEvent(event);
  }

  private openFilterMenuNearHeader(): void {
    const button = this.containerEl.querySelector('.pms-filter-button');
    if (!(button instanceof HTMLElement)) return;
    const rect = button.getBoundingClientRect();
    const menu = new Menu();
    const filters: Array<[PluginManagerFilter, string]> = [
      ['all', 'All plugins'],
      ['pinned', 'Pinned'],
      ['enabled', 'Enabled'],
      ['disabled', 'Disabled'],
      ['recent', 'Recently used'],
      ['frequent', 'Frequently used'],
    ];
    for (const [value, label] of filters) {
      menu.addItem((item) => {
        item.setTitle(label);
        item.setChecked(this.filter === value);
        item.onClick(() => {
          this.filter = value;
          this.render();
        });
      });
    }
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private async repairAndRefresh(): Promise<void> {
    try {
      await this.reconcileSettings(true);
      new Notice('Plugin manager repaired and refreshed.');
    } catch (error) {
      new Notice(`Plugin manager refresh failed: ${getErrorMessage(error)}`);
    }
    this.render();
  }

  private refresh(): void {
    this.render();
  }

  private updateSummary(summary: HTMLElement): void {
    summary.empty();
    const plugins = this.getPlugins();
    const enabled = plugins.filter((plugin) => plugin.enabled).length;
    const pinned = plugins.filter((plugin) => this.plugin.settings.pinned.includes(plugin.id)).length;
    summary.createSpan({ text: `${plugins.length} plugin${plugins.length === 1 ? '' : 's'}`, cls: 'pms-summary-count' });
    summary.createSpan({ text: '·', cls: 'pms-summary-separator' });
    summary.createSpan({ text: `${enabled} enabled`, cls: 'pms-summary-enabled' });
    summary.createSpan({ text: '·', cls: 'pms-summary-separator' });
    summary.createSpan({ text: `${pinned} pinned`, cls: 'pms-summary-pinned' });
    const frequent = Object.keys(this.plugin.settings.usage).length;
    if (frequent > 0) {
      summary.createSpan({ text: '·', cls: 'pms-summary-separator' });
      summary.createSpan({ text: `${frequent} tracked`, cls: 'pms-summary-tracked' });
    }
  }

  private buildPluginList(list: HTMLElement): void {
    list.empty();
    const groups = this.getGroupedPlugins();
    const filter = this.searchQuery.trim().toLocaleLowerCase();
    let rendered = 0;

    for (const group of groups) {
      let filtered = filter
        ? group.plugins.filter((plugin) => this.matchesFilter(plugin, filter))
        : group.plugins;
      filtered = filtered.filter((plugin) => this.matchesViewFilter(plugin));
      if (filtered.length === 0) continue;

      const section = list.createDiv('pms-section');
      const sectionHeader = section.createDiv('pms-section-header');
      sectionHeader.createSpan({ text: group.title, cls: 'pms-section-title' });
      sectionHeader.createSpan({ text: String(filtered.length), cls: 'pms-section-count' });

      const sectionList = section.createDiv('pms-section-list');
      for (const plugin of filtered) {
        this.addPluginRow(sectionList, plugin, group.key);
        rendered += 1;
      }
    }

    if (rendered === 0) {
      const empty = list.createDiv('pms-empty');
      empty.createDiv('pms-empty-icon').setText(filter ? '⌕' : '◌');
      empty.createEl('strong', { text: filter || this.filter !== 'all' ? 'No matching plugins' : 'No community plugins installed' });
      empty.createDiv({
        text: filter || this.filter !== 'all' ? 'Try another search or filter.' : 'Install a community plugin to manage it here.',
        cls: 'pms-empty-text',
      });
    }
  }

  private matchesFilter(plugin: ManagedPlugin, filter: string): boolean {
    return [this.getDisplayName(plugin), this.getDescription(plugin), plugin.id, plugin.version]
      .some((value) => value.toLocaleLowerCase().includes(filter));
  }

  private matchesViewFilter(plugin: ManagedPlugin): boolean {
    switch (this.filter) {
      case 'pinned': return this.plugin.settings.pinned.includes(plugin.id);
      case 'enabled': return plugin.enabled;
      case 'disabled': return !plugin.enabled;
      case 'recent': return this.isRecentlyUsed(plugin.id);
      case 'frequent': return (this.plugin.settings.usage[plugin.id]?.count ?? 0) > 0;
      default: return true;
    }
  }

  private isRecentlyUsed(id: string): boolean {
    const last = this.plugin.settings.usage[id]?.lastUsedAt ?? 0;
    return last > 0 && Date.now() - last <= RECENT_WINDOW_MS;
  }

  private getPluginManager(): PluginManagerApi {
    return (this.app as AppWithPluginManager).plugins;
  }

  private getInternalPlugins(): InternalPluginsApi {
    return (this.app as AppWithPluginManager).internalPlugins;
  }

  private getPlugins(): ManagedPlugin[] {
    const pluginManager = this.getPluginManager();
    const internalPlugins = this.getInternalPlugins();
    const plugins: ManagedPlugin[] = [];
    for (const [id, manifest] of Object.entries(pluginManager.manifests)) {
      if (internalPlugins.plugins[id]) continue;
      plugins.push({
        id,
        name: manifest.name,
        description: manifest.description ?? '',
        version: manifest.version,
        enabled: pluginManager.enabledPlugins.has(id),
      });
    }
    return plugins;
  }

  private getGroupedPlugins(): Array<{
    key: 'pinned' | 'enabled' | 'disabled';
    title: string;
    plugins: ManagedPlugin[];
  }> {
    const plugins = this.getPlugins();
    const pinnedIds = new Set(this.plugin.settings.pinned);
    const pinned = plugins.filter((item) => item.enabled && pinnedIds.has(item.id));
    const enabled = plugins.filter((item) => item.enabled && !pinnedIds.has(item.id));
    const disabled = plugins.filter((item) => !item.enabled);
    return [
      { key: 'pinned', title: 'Pinned', plugins: this.sortByStoredOrder(pinned, 'pinned') },
      { key: 'enabled', title: 'Enabled', plugins: this.sortByStoredOrder(enabled, 'enabled') },
      { key: 'disabled', title: 'Disabled', plugins: this.sortByStoredOrder(disabled, 'disabled') },
    ];
  }

  private sortByStoredOrder(plugins: ManagedPlugin[], group: 'pinned' | 'enabled' | 'disabled'): ManagedPlugin[] {
    const orderIds = group === 'pinned'
      ? this.plugin.settings.pinnedOrder
      : group === 'disabled' ? this.plugin.settings.disabledOrder : this.plugin.settings.enabledOrder;
    const order = new Map(orderIds.map((id, index) => [id, index]));
    return [...plugins].sort((a, b) => {
      const aOrder = order.get(a.id);
      const bOrder = order.get(b.id);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      const usageA = this.plugin.settings.usage[a.id]?.lastUsedAt ?? 0;
      const usageB = this.plugin.settings.usage[b.id]?.lastUsedAt ?? 0;
      if (usageA !== usageB) return usageB - usageA;
      return this.getDisplayName(a).localeCompare(this.getDisplayName(b), undefined, { sensitivity: 'base' });
    });
  }

  private getDisplayName(plugin: ManagedPlugin): string {
    return this.plugin.settings.customNames[plugin.id]?.trim() || plugin.name;
  }

  private getDescription(plugin: ManagedPlugin): string {
    return this.plugin.settings.customDescs[plugin.id]?.trim() || plugin.description;
  }

  private addPluginRow(list: HTMLElement, plugin: ManagedPlugin, group: 'pinned' | 'enabled' | 'disabled'): void {
    const item = list.createDiv('pms-item');
    item.dataset.pluginId = plugin.id;
    item.draggable = this.reorderMode;
    if (this.reorderMode) item.addClass('is-draggable');

    item.addEventListener('dblclick', () => this.openDetails(plugin));
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openPluginActionSheet(plugin, group);
    });
    item.addEventListener('pointerdown', (event) => this.startLongPress(event, plugin, group));
    item.addEventListener('pointermove', (event) => this.cancelLongPressOnMove(event));
    item.addEventListener('pointerup', () => this.clearLongPress());
    item.addEventListener('pointercancel', () => this.clearLongPress());

    item.addEventListener('dragstart', (event) => {
      if (!this.reorderMode || !(event.dataTransfer instanceof DataTransfer)) return;
      this.dragPluginId = plugin.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', plugin.id);
      item.addClass('is-dragging');
    });
    item.addEventListener('dragend', () => {
      this.dragPluginId = null;
      item.removeClass('is-dragging');
      this.containerEl.querySelectorAll('.pms-item.is-drag-over').forEach((node) => node.removeClass('is-drag-over'));
    });
    item.addEventListener('dragover', (event) => {
      if (!this.reorderMode || !this.dragPluginId || this.dragPluginId === plugin.id) return;
      event.preventDefault();
      item.addClass('is-drag-over');
    });
    item.addEventListener('dragleave', () => item.removeClass('is-drag-over'));
    item.addEventListener('drop', (event) => {
      if (!this.reorderMode || !this.dragPluginId || this.dragPluginId === plugin.id) return;
      event.preventDefault();
      item.removeClass('is-drag-over');
      void this.moveBefore(this.dragPluginId, plugin.id, group);
    });

    const main = item.createDiv('pms-item-main');
    if (this.reorderMode) main.createSpan({ text: '☷', cls: 'pms-drag-handle', attr: { 'aria-hidden': 'true' } });

    const info = main.createDiv('pms-item-info');
    const titleRow = info.createDiv('pms-item-title-row');
    titleRow.createEl('strong', { text: this.getDisplayName(plugin), cls: 'pms-plugin-name' });
    titleRow.createSpan({ text: plugin.enabled ? 'Enabled' : 'Disabled', cls: `pms-status ${plugin.enabled ? 'is-enabled' : 'is-disabled'}` });
    if (this.plugin.settings.pinned.includes(plugin.id)) titleRow.createSpan({ text: 'Pinned', cls: 'pms-pinned-label' });

    const meta = info.createDiv('pms-plugin-meta');
    meta.createSpan({ text: plugin.id, cls: 'pms-plugin-id' });
    if (plugin.version) meta.createSpan({ text: `v${plugin.version}`, cls: 'pms-plugin-version' });
    const usage = this.plugin.settings.usage[plugin.id];
    if (usage?.count) meta.createSpan({ text: `${usage.count} uses`, cls: 'pms-plugin-usage' });

    if (this.plugin.settings.displayMode !== 'compact') {
      const description = this.getDescription(plugin);
      if (description) info.createDiv({ text: description, cls: 'pms-plugin-description' });
    }

    const actions = main.createDiv('pms-actions');
    this.createActionButton(actions, 'Open details', plugin, 'pms-action-button', '⋯', () => this.openDetails(plugin));

    if (this.plugin.settings.displayMode === 'advanced') {
      this.createActionButton(actions, 'Open plugin settings', plugin, 'pms-action-button', '⚙', () => this.openPluginSettings(plugin));
      this.createActionButton(actions, 'Plugin commands', plugin, 'pms-action-button', '⌘', () => this.openCommandLauncher(plugin));
      this.createActionButton(actions, this.plugin.settings.pinned.includes(plugin.id) ? 'Unpin' : 'Pin', plugin, 'pms-pin-button', this.plugin.settings.pinned.includes(plugin.id) ? '◆' : '◇', () => void this.togglePin(plugin.id)).toggleClass('is-pinned', this.plugin.settings.pinned.includes(plugin.id));
      this.createActionButton(actions, 'Move up', plugin, 'pms-action-button', '↑', () => void this.movePlugin(plugin.id, -1, group));
      this.createActionButton(actions, 'Move down', plugin, 'pms-action-button', '↓', () => void this.movePlugin(plugin.id, 1, group));
    }

    this.createActionButton(actions, plugin.enabled ? 'Disable plugin' : 'Enable plugin', plugin, 'pms-toggle-button', plugin.enabled ? '●' : '○', () => void this.setPluginEnabled(plugin));

    if (this.plugin.settings.displayMode === 'advanced') {
      this.createActionButton(actions, 'Uninstall', plugin, 'pms-delete-button', '×', () => void this.uninstallPlugin(plugin));
    }
  }

  private startLongPress(event: PointerEvent, plugin: ManagedPlugin, group: 'pinned' | 'enabled' | 'disabled'): void {
    this.clearLongPress();
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    this.longPressStartX = event.clientX;
    this.longPressStartY = event.clientY;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.openPluginActionSheet(plugin, group);
    }, 500);
  }

  private cancelLongPressOnMove(event: PointerEvent): void {
    if (this.longPressTimer === null) return;
    const dx = event.clientX - this.longPressStartX;
    const dy = event.clientY - this.longPressStartY;
    if (Math.hypot(dx, dy) > 12) this.clearLongPress();
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private openPluginActionSheet(plugin: ManagedPlugin, group: 'pinned' | 'enabled' | 'disabled'): void {
    this.touchPlugin(plugin.id, 'Opened actions');
    new PluginActionSheetModal(
      this.app,
      plugin,
      this.getDisplayName(plugin),
      this.plugin.settings.pinned.includes(plugin.id),
      async () => this.setPluginEnabled(plugin),
      async () => this.togglePin(plugin.id),
      () => this.movePlugin(plugin.id, -1, group),
      () => this.movePlugin(plugin.id, 1, group),
      () => this.editPlugin(plugin),
      () => this.openDetails(plugin),
      () => this.openPluginSettings(plugin),
      () => this.openCommandLauncher(plugin),
      () => this.uninstallPlugin(plugin),
    ).open();
  }

  private createActionButton(parent: HTMLElement, label: string, plugin: ManagedPlugin, className: string, text: string, callback: () => void | Promise<void>): HTMLButtonElement {
    const button = parent.createEl('button', {
      text,
      cls: className,
      attr: { type: 'button', 'aria-label': `${label} ${this.getDisplayName(plugin)}`, title: label },
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void callback();
    });
    return button;
  }

  private touchPlugin(id: string, action: string): void {
    if (!id || id === '__manager__') return;
    const current = this.plugin.settings.usage[id] ?? { count: 0, lastUsedAt: 0 };
    this.plugin.settings.usage[id] = { count: current.count + 1, lastUsedAt: Date.now() };
    this.recordActivity(id, action);
    void this.plugin.saveSettings();
  }

  private recordActivity(pluginId: string, action: string): void {
    const entry: PluginActivity = { pluginId, action, timestamp: Date.now() };
    this.plugin.settings.activity = [entry, ...this.plugin.settings.activity.filter((item) => item.pluginId !== pluginId || item.action !== action)].slice(0, 50);
  }

  private async setPluginEnabled(plugin: ManagedPlugin): Promise<void> {
    if (this.busyPlugins.has(plugin.id)) return;
    this.busyPlugins.add(plugin.id);
    try {
      const manager = this.getPluginManager();
      const targetEnabled = !manager.enabledPlugins.has(plugin.id);
      if (targetEnabled) await manager.enablePlugin(plugin.id);
      else await manager.disablePlugin(plugin.id);

      const actualEnabled = manager.enabledPlugins.has(plugin.id);
      if (actualEnabled !== targetEnabled) throw new Error('Obsidian did not reach the requested plugin state.');

      await this.reconcileSettings(false);
      if (actualEnabled) {
        if (this.plugin.settings.pinned.includes(plugin.id)) {
          this.plugin.settings.pinnedOrder = [plugin.id, ...this.plugin.settings.pinnedOrder.filter((id) => id !== plugin.id)];
        } else {
          this.plugin.settings.enabledOrder = [plugin.id, ...this.plugin.settings.enabledOrder.filter((id) => id !== plugin.id)];
        }
      } else {
        this.plugin.settings.disabledOrder = [plugin.id, ...this.plugin.settings.disabledOrder.filter((id) => id !== plugin.id)];
      }
      this.touchPlugin(plugin.id, actualEnabled ? 'Enabled plugin' : 'Disabled plugin');
      await this.plugin.saveSettings();
      new Notice(`${this.getDisplayName(plugin)} ${actualEnabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      new Notice(`Failed to change ${this.getDisplayName(plugin)}: ${getErrorMessage(error)}`);
    } finally {
      this.busyPlugins.delete(plugin.id);
      this.refresh();
    }
  }

  private async togglePin(id: string): Promise<void> {
    const index = this.plugin.settings.pinned.indexOf(id);
    if (index >= 0) {
      this.plugin.settings.pinned.splice(index, 1);
      this.plugin.settings.pinnedOrder = this.plugin.settings.pinnedOrder.filter((value) => value !== id);
    } else {
      this.plugin.settings.pinned.push(id);
      if (!this.plugin.settings.pinnedOrder.includes(id)) this.plugin.settings.pinnedOrder.unshift(id);
    }
    this.touchPlugin(id, index >= 0 ? 'Unpinned plugin' : 'Pinned plugin');
    await this.plugin.saveSettings();
    this.refresh();
  }

  private editPlugin(plugin: ManagedPlugin): void {
    this.touchPlugin(plugin.id, 'Edited details');
    new EditPluginModal(
      this.app,
      plugin.name,
      this.plugin.settings.customNames[plugin.id] ?? '',
      this.plugin.settings.customDescs[plugin.id] ?? '',
      async (alias, description) => {
        if (alias) this.plugin.settings.customNames[plugin.id] = alias;
        else delete this.plugin.settings.customNames[plugin.id];
        if (description) this.plugin.settings.customDescs[plugin.id] = description;
        else delete this.plugin.settings.customDescs[plugin.id];
        await this.plugin.saveSettings();
        this.refresh();
      },
    ).open();
  }

  private openDetails(plugin: ManagedPlugin): void {
    this.touchPlugin(plugin.id, 'Opened details');
    new PluginDetailsModal(
      this.app,
      plugin,
      this.getDisplayName(plugin),
      this.getDescription(plugin),
      this.plugin.settings.pinned.includes(plugin.id),
      async () => this.setPluginEnabled(plugin),
      async () => this.togglePin(plugin.id),
      () => this.editPlugin(plugin),
      () => this.openPluginSettings(plugin),
      () => this.openCommandLauncher(plugin),
      () => this.openHealthModal(plugin),
    ).open();
  }

  private async uninstallPlugin(plugin: ManagedPlugin): Promise<void> {
    if (this.busyPlugins.has(plugin.id)) return;
    const displayName = this.getDisplayName(plugin);
    if (!window.confirm(`Uninstall "${displayName}"?\n\nThis removes the plugin from your vault.`)) return;
    this.busyPlugins.add(plugin.id);
    try {
      await this.getPluginManager().uninstallPlugin(plugin.id);
      this.plugin.settings.pinned = this.plugin.settings.pinned.filter((id) => id !== plugin.id);
      this.plugin.settings.pinnedOrder = this.plugin.settings.pinnedOrder.filter((id) => id !== plugin.id);
      this.plugin.settings.enabledOrder = this.plugin.settings.enabledOrder.filter((id) => id !== plugin.id);
      this.plugin.settings.disabledOrder = this.plugin.settings.disabledOrder.filter((id) => id !== plugin.id);
      delete this.plugin.settings.customNames[plugin.id];
      delete this.plugin.settings.customDescs[plugin.id];
      delete this.plugin.settings.usage[plugin.id];
      this.recordActivity(plugin.id, 'Uninstalled plugin');
      await this.plugin.saveSettings();
      new Notice(`"${displayName}" uninstalled.`);
      await this.reconcileSettings(false);
    } catch (error) {
      new Notice(`Failed to uninstall ${displayName}: ${getErrorMessage(error)}`);
    } finally {
      this.busyPlugins.delete(plugin.id);
      this.refresh();
    }
  }

  private async movePlugin(id: string, delta: -1 | 1, group: 'pinned' | 'enabled' | 'disabled'): Promise<void> {
    const currentGroup = this.getGroupedPlugins().find((item) => item.key === group)?.plugins ?? [];
    const ids = currentGroup.map((item) => item.id);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const currentId = ids[index];
    const targetId = ids[target];
    if (!currentId || !targetId) return;
    ids[index] = targetId;
    ids[target] = currentId;
    await this.persistGroupOrder(group, ids);
    this.touchPlugin(id, delta < 0 ? 'Moved up' : 'Moved down');
    this.refresh();
  }

  private async moveBefore(id: string, targetId: string, group: 'pinned' | 'enabled' | 'disabled'): Promise<void> {
    const currentGroup = this.getGroupedPlugins().find((item) => item.key === group)?.plugins ?? [];
    const ids = currentGroup.map((item) => item.id).filter((value) => value !== id);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    ids.splice(targetIndex, 0, id);
    await this.persistGroupOrder(group, ids);
    this.touchPlugin(id, 'Reordered plugin');
    this.refresh();
  }

  private async persistGroupOrder(group: 'pinned' | 'enabled' | 'disabled', ids: string[]): Promise<void> {
    if (group === 'pinned') this.plugin.settings.pinnedOrder = ids;
    else if (group === 'disabled') this.plugin.settings.disabledOrder = ids;
    else this.plugin.settings.enabledOrder = ids;
    await this.plugin.saveSettings();
  }

  private openPluginSettings(plugin: ManagedPlugin): void {
    this.touchPlugin(plugin.id, 'Opened plugin settings');
    const settingsApi = (this.app as AppWithPluginManager).setting;
    if (settingsApi?.openTabById) {
      try {
        settingsApi.openTabById(plugin.id);
        return;
      } catch (error) {
        new Notice(`Could not open settings: ${getErrorMessage(error)}`);
        return;
      }
    }
    new Notice('Plugin settings are not available through this Obsidian version.');
  }

  private openCommandLauncher(plugin?: ManagedPlugin): void {
    if (plugin) this.touchPlugin(plugin.id, 'Opened commands');
    new PluginCommandLauncherModal(this.app, this.getCommandsForPlugin(plugin), plugin ? this.getDisplayName(plugin) : 'All plugin commands', (command) => {
      return this.executePluginCommand(command, plugin?.id);
    }).open();
  }

  private getCommandsForPlugin(plugin?: ManagedPlugin): PluginCommand[] {
    const commandsApi = this.app.commands as unknown as CommandsApi;
    const listed = commandsApi.listCommands?.();
    const commands: PluginCommand[] = [];
    if (!listed) return commands;
    const values = Array.isArray(listed) ? listed : Object.values(listed);
    for (const command of values) {
      if (!command?.id || !command?.name) continue;
      if (plugin && !command.id.startsWith(`${plugin.id}:`) && !command.id.includes(plugin.id)) continue;
      commands.push({ id: command.id, name: command.name });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async executePluginCommand(command: PluginCommand, pluginId?: string): Promise<void> {
    const commandsApi = this.app.commands as unknown as CommandsApi;
    if (!commandsApi.executeCommandById) {
      new Notice('Command execution is not available.');
      return;
    }
    try {
      const result = await commandsApi.executeCommandById(command.id);
      if (result === false) throw new Error('Obsidian could not execute the command.');
      if (pluginId) this.touchPlugin(pluginId, `Ran command: ${command.name}`);
      new Notice(`Ran: ${command.name}`);
    } catch (error) {
      new Notice(`Command failed: ${getErrorMessage(error)}`);
    }
  }

  private openHealthModal(plugin?: ManagedPlugin): void {
    new PluginHealthModal(this.app, this.getHealthRows(plugin), plugin ? this.getDisplayName(plugin) : 'Plugin health').open();
  }

  private getHealthRows(only?: ManagedPlugin): HealthRow[] {
    const plugins = only ? [only] : this.getPlugins();
    const manager = this.getPluginManager();
    return plugins.map((item) => {
      const listedEnabled = manager.enabledPlugins.has(item.id);
      const loaded = Boolean(this.getInternalPlugins().plugins[item.id]);
      if (listedEnabled && loaded) return { plugin: item, status: 'ok', message: 'Enabled and loaded.' };
      if (!listedEnabled && !loaded) return { plugin: item, status: 'ok', message: 'Disabled.' };
      if (listedEnabled && !loaded) return { plugin: item, status: 'warn', message: 'Marked enabled, but no loaded instance is visible.' };
      return { plugin: item, status: 'warn', message: 'Marked disabled, but a loaded instance is visible.' };
    });
  }

  private openActivityModal(): void {
    new PluginActivityModal(this.app, this.plugin.settings.activity, (id) => this.getPlugins().find((item) => item.id === id)).open();
  }

  private openLayoutMenu(): void {
    new PluginLayoutModal(this.app, async (action) => {
      if (action === 'export') await this.exportLayout();
      else await this.importLayout();
    }).open();
  }

  private async exportLayout(): Promise<void> {
    const data = JSON.stringify(this.plugin.settings, null, 2);
    try {
      const existing = this.app.vault.getAbstractFileByPath(LAYOUT_FILE);
      if (existing instanceof TFile) await this.app.vault.modify(existing, data);
      else if (existing) throw new Error(`${LAYOUT_FILE} is not a file.`);
      else await this.app.vault.create(LAYOUT_FILE, data);
      new Notice(`Layout exported to ${LAYOUT_FILE}.`);
    } catch (error) {
      new Notice(`Export failed: ${getErrorMessage(error)}`);
    }
  }

  private async importLayout(): Promise<void> {
    const files = this.app.vault.getFiles().filter((file) => file.extension.toLocaleLowerCase() === 'json');
    if (files.length === 0) {
      new Notice('No JSON files are available in this vault.');
      return;
    }
    new PluginLayoutImportModal(this.app, files.map((file) => file.path), async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error('File no longer exists or is not a file.');
      const raw = await this.app.vault.read(file);
      const imported = normalizeSettings(JSON.parse(raw));
      this.plugin.settings = imported;
      await this.reconcileSettings(false);
      await this.plugin.saveSettings();
      new Notice('Plugin manager layout imported.');
      this.render();
    }).open();
  }

  private async resetCustomizations(): Promise<void> {
    if (!window.confirm('Reset custom plugin names and descriptions?\n\nPinning, ordering and enabled states will not change.')) return;
    this.plugin.settings.customNames = {};
    this.plugin.settings.customDescs = {};
    this.recordActivity('__manager__', 'Reset plugin customizations');
    await this.plugin.saveSettings();
    this.refresh();
    new Notice('Plugin names and descriptions reset.');
  }

  private async reconcileSettings(forceSave: boolean): Promise<void> {
    const plugins = this.getPlugins();
    const allIds = new Set(plugins.map((item) => item.id));
    const enabledIds = plugins.filter((item) => item.enabled).map((item) => item.id);
    const disabledIds = plugins.filter((item) => !item.enabled).map((item) => item.id);

    const old = JSON.stringify({
      pinned: this.plugin.settings.pinned,
      pinnedOrder: this.plugin.settings.pinnedOrder,
      enabledOrder: this.plugin.settings.enabledOrder,
      disabledOrder: this.plugin.settings.disabledOrder,
    });

    this.plugin.settings.pinned = this.uniqueExisting(this.plugin.settings.pinned, allIds);
    this.plugin.settings.pinnedOrder = this.reconcileOrder(this.plugin.settings.pinnedOrder, this.plugin.settings.pinned);
    this.plugin.settings.enabledOrder = this.reconcileOrder(this.plugin.settings.enabledOrder, enabledIds);
    this.plugin.settings.disabledOrder = this.reconcileOrder(this.plugin.settings.disabledOrder, disabledIds);

    const current = JSON.stringify({
      pinned: this.plugin.settings.pinned,
      pinnedOrder: this.plugin.settings.pinnedOrder,
      enabledOrder: this.plugin.settings.enabledOrder,
      disabledOrder: this.plugin.settings.disabledOrder,
    });

    if (forceSave || old !== current) await this.plugin.saveSettings();
  }

  private reconcileOrder(existing: string[], actualIds: string[]): string[] {
    const actual = new Set(actualIds);
    const result = existing.filter((id) => actual.has(id));
    for (const id of actualIds) if (!result.includes(id)) result.push(id);
    return [...new Set(result)];
  }

  private uniqueExisting(ids: string[], valid: Set<string>): string[] {
    return [...new Set(ids.filter((id) => valid.has(id)))];
  }
}

interface HealthRow {
  plugin: ManagedPlugin;
  status: 'ok' | 'warn';
  message: string;
}

class PluginActionSheetModal extends Modal {
  private readonly plugin: ManagedPlugin;
  private readonly displayName: string;
  private readonly pinned: boolean;
  private readonly toggleEnabled: () => Promise<void>;
  private readonly togglePin: () => Promise<void>;
  private readonly moveUp: () => Promise<void>;
  private readonly moveDown: () => Promise<void>;
  private readonly edit: () => void;
  private readonly details: () => void;
  private readonly openSettings: () => void;
  private readonly openCommands: () => void;
  private readonly uninstall: () => Promise<void>;

  constructor(app: App, plugin: ManagedPlugin, displayName: string, pinned: boolean, toggleEnabled: () => Promise<void>, togglePin: () => Promise<void>, moveUp: () => Promise<void>, moveDown: () => Promise<void>, edit: () => void, details: () => void, openSettings: () => void, openCommands: () => void, uninstall: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.displayName = displayName;
    this.pinned = pinned;
    this.toggleEnabled = toggleEnabled;
    this.togglePin = togglePin;
    this.moveUp = moveUp;
    this.moveDown = moveDown;
    this.edit = edit;
    this.details = details;
    this.openSettings = openSettings;
    this.openCommands = openCommands;
    this.uninstall = uninstall;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-action-sheet');
    contentEl.createEl('h2', { text: this.displayName });
    this.addAction(contentEl, this.plugin.enabled ? 'Disable plugin' : 'Enable plugin', async () => { await this.toggleEnabled(); this.close(); });
    this.addAction(contentEl, this.pinned ? 'Unpin plugin' : 'Pin plugin', async () => { await this.togglePin(); this.close(); });
    this.addAction(contentEl, 'Open plugin settings', () => { this.close(); this.openSettings(); });
    this.addAction(contentEl, 'Plugin commands', () => { this.close(); this.openCommands(); });
    this.addAction(contentEl, 'Move up', async () => { await this.moveUp(); this.close(); });
    this.addAction(contentEl, 'Move down', async () => { await this.moveDown(); this.close(); });
    this.addAction(contentEl, 'Edit name / description', () => { this.close(); this.edit(); });
    this.addAction(contentEl, 'Plugin details', () => { this.close(); this.details(); });
    this.addAction(contentEl, 'Uninstall', async () => { await this.uninstall(); this.close(); }, 'mod-warning');
  }

  private addAction(parent: HTMLElement, label: string, callback: () => void | Promise<void>, cls?: string): void {
    const button = parent.createEl('button', { text: label, cls: cls ? `pms-action-sheet-button ${cls}` : 'pms-action-sheet-button', attr: { type: 'button' } });
    button.addEventListener('click', () => {
      button.disabled = true;
      void (async () => { try { await callback(); } finally { button.disabled = false; } })();
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

class PluginDetailsModal extends Modal {
  constructor(private readonly appRef: App, private readonly plugin: ManagedPlugin, private readonly displayName: string, private readonly description: string, private readonly pinned: boolean, private readonly toggleEnabled: () => Promise<void>, private readonly togglePin: () => Promise<void>, private readonly edit: () => void, private readonly openSettings: () => void, private readonly openCommands: () => void, private readonly health: () => void) {
    super(appRef);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-details-modal');
    contentEl.createEl('h2', { text: this.displayName });
    contentEl.createDiv({ text: this.description || 'No description available.', cls: 'pms-details-description' });
    const status = contentEl.createDiv('pms-details-status');
    status.createSpan({ text: this.plugin.enabled ? 'Enabled' : 'Disabled', cls: `pms-status ${this.plugin.enabled ? 'is-enabled' : 'is-disabled'}` });
    if (this.pinned) status.createSpan({ text: 'Pinned', cls: 'pms-pinned-label' });

    const details = contentEl.createDiv('pms-details-grid');
    this.addDetail(details, 'Plugin ID', this.plugin.id);
    this.addDetail(details, 'Version', this.plugin.version || 'Unknown');

    const actions = contentEl.createDiv('pms-details-actions');
    this.addButton(actions, this.plugin.enabled ? 'Disable plugin' : 'Enable plugin', () => this.toggleEnabled());
    this.addButton(actions, this.pinned ? 'Unpin plugin' : 'Pin plugin', () => this.togglePin());
    this.addButton(actions, 'Open settings', () => this.openSettings());
    this.addButton(actions, 'Commands', () => this.openCommands());
    this.addButton(actions, 'Health', () => this.health());
    this.addButton(actions, 'Edit name / description', () => { this.close(); this.edit(); });
  }

  private addButton(parent: HTMLElement, label: string, callback: () => void | Promise<void>): void {
    const button = parent.createEl('button', { text: label, attr: { type: 'button' } });
    button.addEventListener('click', () => {
      button.disabled = true;
      void Promise.resolve(callback()).finally(() => { button.disabled = false; });
    });
  }

  private addDetail(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv('pms-detail-row');
    row.createSpan({ text: label, cls: 'pms-detail-label' });
    row.createSpan({ text: value, cls: 'pms-detail-value' });
  }

  onClose(): void { this.contentEl.empty(); }
}

class PluginCommandLauncherModal extends Modal {
  constructor(app: App, private readonly commands: PluginCommand[], private readonly title: string, private readonly execute: (command: PluginCommand) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-command-modal');
    contentEl.createEl('h2', { text: this.title });
    const input = contentEl.createEl('input', { type: 'search', placeholder: 'Search commands…', cls: 'pms-command-search' });
    const list = contentEl.createDiv('pms-command-list');
    const render = (): void => {
      list.empty();
      const query = input.value.trim().toLocaleLowerCase();
      const commands = this.commands.filter((item) => !query || `${item.name} ${item.id}`.toLocaleLowerCase().includes(query));
      if (commands.length === 0) {
        list.createDiv({ text: 'No matching commands.', cls: 'pms-empty-text' });
        return;
      }
      for (const command of commands.slice(0, 80)) {
        const button = list.createEl('button', { text: command.name, cls: 'pms-command-item', attr: { type: 'button' } });
        button.createSpan({ text: command.id, cls: 'pms-command-id' });
        button.addEventListener('click', () => {
          button.disabled = true;
          void this.execute(command).finally(() => this.close());
        });
      }
    };
    input.addEventListener('input', render);
    input.focus();
    render();
  }

  onClose(): void { this.contentEl.empty(); }
}

class PluginHealthModal extends Modal {
  constructor(app: App, private readonly rows: HealthRow[], private readonly title: string) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-health-modal');
    contentEl.createEl('h2', { text: this.title });
    const warnings = this.rows.filter((row) => row.status === 'warn').length;
    contentEl.createDiv({ text: warnings === 0 ? 'No state mismatches detected.' : `${warnings} plugin${warnings === 1 ? '' : 's'} need attention.`, cls: warnings === 0 ? 'pms-health-good' : 'pms-health-warn' });
    for (const row of this.rows) {
      const item = contentEl.createDiv(`pms-health-row ${row.status}`);
      item.createSpan({ text: row.status === 'ok' ? '✓' : '⚠', cls: 'pms-health-icon' });
      const info = item.createDiv('pms-health-info');
      info.createEl('strong', { text: row.plugin.name });
      info.createDiv({ text: row.message, cls: 'pms-health-message' });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

class PluginActivityModal extends Modal {
  constructor(app: App, private readonly activity: PluginActivity[], private readonly findPlugin: (id: string) => ManagedPlugin | undefined) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-activity-modal');
    contentEl.createEl('h2', { text: 'Recent activity' });
    if (this.activity.length === 0) {
      contentEl.createDiv({ text: 'No recent plugin manager activity.', cls: 'pms-empty-text' });
      return;
    }
    for (const entry of this.activity.slice(0, 30)) {
      const row = contentEl.createDiv('pms-activity-row');
      row.createSpan({ text: this.findPlugin(entry.pluginId)?.name ?? (entry.pluginId === '__manager__' ? 'Plugin Manager' : entry.pluginId), cls: 'pms-activity-plugin' });
      row.createSpan({ text: entry.action, cls: 'pms-activity-action' });
      row.createSpan({ text: new Date(entry.timestamp).toLocaleString(), cls: 'pms-activity-time' });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

class PluginLayoutModal extends Modal {
  constructor(app: App, private readonly run: (action: 'import' | 'export') => Promise<void>) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-layout-modal');
    contentEl.createEl('h2', { text: 'Plugin Manager layout' });
    contentEl.createDiv({ text: 'Export your pins, order, custom names, descriptions, mode and usage data to a JSON file in the vault. Importing replaces those manager settings; it does not install or enable plugins.', cls: 'pms-modal-hint' });
    this.addButton(contentEl, 'Export layout', 'export');
    this.addButton(contentEl, 'Import layout', 'import');
  }

  private addButton(parent: HTMLElement, label: string, action: 'import' | 'export'): void {
    const button = parent.createEl('button', { text: label, attr: { type: 'button' } });
    button.addEventListener('click', () => {
      button.disabled = true;
      void this.run(action).finally(() => this.close());
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

class PluginLayoutImportModal extends Modal {
  constructor(app: App, private readonly paths: string[], private readonly importPath: (path: string) => Promise<void>) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-layout-modal');
    contentEl.createEl('h2', { text: 'Import layout' });
    const input = contentEl.createEl('input', { type: 'search', placeholder: 'Search JSON files…', cls: 'pms-command-search' });
    const list = contentEl.createDiv('pms-command-list');
    const render = (): void => {
      list.empty();
      const query = input.value.trim().toLocaleLowerCase();
      const paths = this.paths.filter((path) => !query || path.toLocaleLowerCase().includes(query));
      for (const path of paths.slice(0, 80)) {
        const button = list.createEl('button', { text: path, cls: 'pms-command-item', attr: { type: 'button' } });
        button.addEventListener('click', () => {
          button.disabled = true;
          void this.importPath(path).finally(() => this.close());
        });
      }
    };
    input.addEventListener('input', render);
    input.focus();
    render();
  }

  onClose(): void { this.contentEl.empty(); }
}
