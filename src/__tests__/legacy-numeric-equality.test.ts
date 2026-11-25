import { expect, it, vi } from 'vitest';
import { DataSource } from '../data/DataSource';
import { RowPipeline } from '../data/RowPipeline';
import { ViewStateStore } from '../views/ViewStateStore';
import type { ViewConfig } from '../data/types';
vi.mock('obsidian', () => ({ TFile: class {}, TFolder: class {}, normalizePath: (path: string) => path }));
vi.mock('../data/FileFieldObsidian', () => ({ getRowFileFieldValue: () => undefined }));
vi.mock('../data/ComputedEvaluator', () => ({ evaluateComputedFields: () => ({}) }));
it('a saved numeric comparison after an earlier numeric-to-text field change', () => {
  const records = [1, 2].map(amount => ({ file: {path: `${amount}.md`, name: `${amount}.md`, basename: String(amount)} as any, frontmatter: { amount: String(amount) } }));
  const persisted = { db_view: true, database: { id: 'test', name: 'Existing DB', columns: [{key: 'amount', type: 'text'}], views: [{ id: 'v', name: 'Saved view', viewType: 'table', filters: [{ field: 'amount', op: 'eq', value: '01' }] }] } };
  const db = (new DataSource({} as any) as any).parseDatabaseConfig(persisted);
  const view: ViewConfig = { ...db.views[0], schema: db.schema };
  const query = () => new RowPipeline().build(records, view, new ViewStateStore().get(0, 0, view)).map(row => row.file.path);
  expect(query()).toEqual(['1.md']);
  view.filters![0].comparison = "typed";
  expect(query()).toEqual([]);
});
