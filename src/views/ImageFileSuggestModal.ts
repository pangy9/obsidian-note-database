import { App, FuzzySuggestModal, TFile } from "obsidian";

const IMAGE_EXTENSION_RE = /^(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export class ImageFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onChoose: (file: TFile) => void,
    placeholder: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles()
      .filter((file) => IMAGE_EXTENSION_RE.test(file.extension))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
