import { App, TFile } from "obsidian";
import { evaluateBaseComputedFields } from "./BaseExpression";
import { ComputedFieldEngine } from "./ComputedField";
import { ColumnDef, ComputedFieldDef } from "./types";

export interface ComputedEvaluationContext {
  app?: App;
  file?: TFile;
  thisFile?: TFile;
  thisFrontmatter?: Record<string, unknown>;
}

export function evaluateComputedFields(
  defs: ComputedFieldDef[],
  columns: ColumnDef[],
  frontmatter: Record<string, unknown>,
  context: ComputedEvaluationContext = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
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
        result[def.key] = evaluated[def.key];
      } else {
        const evaluated = engine.evaluateSingleDetailed(def.expression, frontmatter, result);
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

  return result;
}
