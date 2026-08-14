import { Modal, type App } from 'obsidian';

export class EditPluginModal extends Modal {
  private readonly pluginName: string;
  private readonly currentAlias: string;
  private readonly currentDescription: string;
  private readonly onSave: (alias: string, description: string) => void | Promise<void>;

  constructor(
    app: App,
    pluginName: string,
    currentAlias: string,
    currentDescription: string,
    onSave: (alias: string, description: string) => void | Promise<void>,
  ) {
    super(app);
    this.pluginName = pluginName;
    this.currentAlias = currentAlias;
    this.currentDescription = currentDescription;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pms-edit-modal');

    contentEl.createEl('h2', { text: 'Edit plugin details' });

    contentEl.createEl('label', {
      text: 'Display name',
      cls: 'pms-modal-label',
    });

    const nameInput = contentEl.createEl('input', {
      type: 'text',
      value: this.currentAlias,
      placeholder: this.pluginName,
      cls: 'pms-modal-input',
    });

    contentEl.createEl('label', {
      text: 'Custom description',
      cls: 'pms-modal-label',
    });

    const descriptionInput = contentEl.createEl('textarea', {
      value: this.currentDescription,
      placeholder: 'Optional custom description',
      cls: 'pms-modal-textarea',
    });

    contentEl.createDiv({
      text: 'Leave a field empty to use the plugin’s original value.',
      cls: 'pms-modal-hint',
    });

    const buttons = contentEl.createDiv('modal-button-container');
    const cancelButton = buttons.createEl('button', { text: 'Cancel' });
    const saveButton = buttons.createEl('button', {
      text: 'Save',
      cls: 'mod-cta',
    });

    let saving = false;

    const save = async (): Promise<void> => {
      if (saving) return;
      saving = true;
      saveButton.disabled = true;

      try {
        await this.onSave(nameInput.value.trim(), descriptionInput.value.trim());
        this.close();
      } finally {
        saving = false;
        saveButton.disabled = false;
      }
    };

    cancelButton.addEventListener('click', () => this.close());
    saveButton.addEventListener('click', () => {
      void save();
    });

    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    });

    window.setTimeout(() => {
      nameInput.focus();
      nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
