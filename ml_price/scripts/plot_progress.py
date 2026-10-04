"""Plot test-set scores per experiment stage from reports/models/experiments.csv.

Plain Linear Regression is left out: from S9 on it collapses (R² about -10⁸, see EXPERIMENTS.md ‡),
which would flatten every other line. Ridge, the same model with a penalty, is shown instead.
"""
import pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
e = pd.read_csv("reports/models/experiments.csv")
order = list(dict.fromkeys(e.stage))
fig, ax = plt.subplots(1, 3, figsize=(16, 4.5))
for m in ["Median per art form", "Ridge (alpha=1)", "Random Forest"]:
    s = e[e.model == m].set_index("stage").reindex(order)
    ax[0].plot(order, s.r2, marker="o", label=m); ax[1].plot(order, s.mae, marker="o", label=m)
f = e[e.model == "Logistic Regression (price band)"].set_index("stage").reindex(order)
ax[2].plot(order, f.f1_macro, marker="o", color="tab:purple", label="Logistic Regression")
ax[0].set_title("R² on frozen test set (higher is better)"); ax[1].set_title("MAE in ₹ (lower is better)")
ax[2].set_title("Price-band macro-F1 (higher is better)")
ax[0].set_ylim(-0.1, 0.85); ax[1].set_ylim(500, 1600)
for a in ax:
    a.grid(alpha=.3); a.set_xlabel("stage"); a.tick_params(axis="x", rotation=60); a.legend(fontsize=8)
plt.tight_layout(); plt.savefig("figures/experiments_progress.png", dpi=150)
