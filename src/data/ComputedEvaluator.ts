import { App, TFile } from "obsidian";
import { evaluateBaseComputedFields, scalarizeBaseExpressionValue } from "./BaseExpression";
import { getFileFieldValue } from "./FileFieldObsidian";
import { ComputedFieldEngine } from "./ComputedField";
import { ColumnDef, ComputedFieldDef } from "./types";

export interface ComputedEvaluationContext {
  app?: App;
  file?: TFile;
  thisFile?: TFile;
  thisFrontmatter?: Record<string, unknown>;
  /** Read-only derived values (for example Rollups) available to formulas. */
  derivedValues?: Record<string, unknown>;
}

export function hasRollupComputedDependency(
  defs: ComputedFieldDef[],
  columns: ColumnDef[]
): boolean {
  const rollupKeys = new Set(
    columns.filter((column) => column.type === "rollup").map((column) => column.key)
  );
  return rollupKeys.size > 0 && defs.some((definition) =>
    ComputedFieldEngine.extractDependencies(definition.expression, columns)
      .some((dependency) => rollupKeys.has(dependency))
  );
}

export function evaluateComputedFields(
  defs: ComputedFieldDef[],
  columns: ColumnDef[],
  frontmatter: Record<string, unknown>,
  context: ComputedEvaluationContext = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(context.derivedValues || {}) };
  // Bug 8: 注入 file.name/file.tags 到普通公式求值上下文（不求值引擎大改，只在 frontmatter 预填）
  let enrichedFrontmatter = frontmatter;
  if (context.app && context.file) {
    const cache = context.app.metadataCache.getFileCache(context.file);
    enrichedFrontmatter = {
      ...frontmatter,
      "file.name": getFileFieldValue(context.file, "file.name", frontmatter, cache, context.app),
      "file.tags": getFileFieldValue(context.file, "file.tags", frontmatter, cache, context.app),
    };
  }
  const engine = new ComputedFieldEngine([], columns);

  for (let pass = 0; pass < Math.max(defs.length, 1); pass += 1) {
    for (const def of defs) {
      if (def.expressionSyntax === "base") {
        if (!context.app || !context.file) {
          result[def.key] = null;
          continue;
        }
        const evaluated = evaluateBaseComputedFields([def], {
          app: context.app,
          file: context.file,
          frontmatter,
          thisFile: context.thisFile,
          thisFrontmatter: context.thisFrontmatter,
          computedFields: defs,
          columns,
          computedValues: result,
        }, result);
        result[def.key] = scalarizeBaseExpressionValue(evaluated[def.key]);
      } else {
        const evaluated = engine.evaluateSingleDetailed(def.expression, enrichedFrontmatter, result);
        if (evaluated.error) {
          if (pass === defs.length - 1) {
            console.warn(`ComputedField "${def.key}" evaluation failed:`, evaluated.error, `expression:`, def.expression);
          }
          result[def.key] = null;
        } else {
          result[def.key] = evaluated.value;
        }
      }
    }
  }

  // Keep the public return shape limited to formula definitions. Derived
  // values seed evaluation but remain owned by their own row layer.
  return Object.fromEntries(defs.map((def) => [def.key, result[def.key]]));
}
