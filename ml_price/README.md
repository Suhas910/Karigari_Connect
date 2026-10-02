# Handicraft Price Prediction — AI&ML Course Project

Personal AI&ML course project (20-mark component), built as an extension of Karigari Connect on
the `ai-ml-price-extension` branch. It does **not** change the app's own pricing
(`backend/app/services/pricing_service.py`).

The work is done in visual tools (OpenRefine, Orange, Protégé). Everything those tools produce,
plus every report, chart and data snapshot, is stored in this folder and committed.

## Where everything lives

| Path | What's in it | Who writes it |
|---|---|---|
| [TODO.md](TODO.md) | Master checklist: every task and project part, ticked as it finishes | Claude |
| [PLAN.md](PLAN.md) | The 16 project parts, the tools, and the experiment stages | Claude |
| [PROCESSING_STEPS.md](PROCESSING_STEPS.md) | How each cleaning/processing step is done and recorded: methods, reasons, templates | Claude |
| [PROJECT_LOG.md](PROJECT_LOG.md) | Dated history of every action: what, which tool, why, and the outcome | Claude |
| [EXPERIMENTS.md](EXPERIMENTS.md) | Score table after every stage, plus the progress chart | Claude, from tool exports |
| [DATASETS.md](DATASETS.md) | Sources, licences, limits | Claude |
| `guides/` | Click-by-click instructions for each phase, written before it starts | Claude |
| `data/raw/` | Downloaded CSVs exactly as downloaded, plus `SHA256SUMS.txt` | You download; Claude adds checksums |
| `data/stages/` | Snapshot after each cleaning stage: `S01_dedup.csv.gz` … | You export from OpenRefine |
| `data/final/` | Final cleaned dataset | You export |
| `data/splits/` | Frozen test set and training set | You export from Orange |
| `tool_exports/openrefine/` | Operation-history JSON for each step (the replayable audit trail) | You export |
| `tool_exports/orange/` | `.ows` workflow files, plus results tables copied out of widgets | You save |
| `tool_exports/protege/` | `.owl` ontology file, rules | You save |
| `tool_exports/llm/` | Prompts used and responses received | Claude writes prompts; you paste responses |
| `figures/` | Every chart, named `<stage>_<topic>_<before\|after>.png` | You save from widgets |
| `reports/cleaning/` | One report per cleaning step: before / middle / after state, method, reason | Claude |
| `reports/eda/` | Statistics and analysis findings | Claude |
| `reports/knowledge_graph/` | Ontology design, rules, inferences | Claude |
| `reports/models/` | Model comparisons, tuning tries, error analysis | Claude |
| `reports/explainability/` | SHAP findings, bias audit, ethics | Claude |
| `reports/final/` | The final submission report | Claude |

Reports link figures by relative path, so the whole project can be read on GitHub.

## How each step works

1. Claude writes the guide → `guides/`
2. You do the step in the tool and export into `tool_exports/`, `data/stages/` and `figures/`
3. You tell Claude the step is done
4. Claude writes the report, adds a `PROJECT_LOG.md` entry and an `EXPERIMENTS.md` row
5. Claude commits and pushes to `origin/ai-ml-price-extension`

## Git rules for this branch

- Claude commits and pushes automatically, as often as needed. Authorised by the project owner on
  2026-10-02, for this branch only.
- Any files may change when necessary, including demo code or app-side code for showing the model.
  Project records stay in `ml_price/`.
- Each commit is one readable unit of work, with a clear message
  (e.g. `ml_price: S01 dedup report`). The `PROJECT_LOG.md` entry goes in the same commit, so
  the history on GitHub and the log always match.
- No force-pushes, no merges into `main` or `frontend-avi`, no PRs unless asked.
