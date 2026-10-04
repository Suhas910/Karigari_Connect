"""Plot test-set scores per experiment stage from reports/models/experiments.csv."""
import pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
e = pd.read_csv("reports/models/experiments.csv")
order = list(dict.fromkeys(e.stage))
fig, ax = plt.subplots(1, 2, figsize=(11, 4))
for m in ["Median per art form", "Linear Regression", "Random Forest"]:
    s = e[e.model == m].set_index("stage").loc[order]
    ax[0].plot(order, s.r2, marker="o", label=m); ax[1].plot(order, s.mae, marker="o", label=m)
ax[0].set_title("R² on frozen test set (higher is better)"); ax[1].set_title("MAE in ₹ (lower is better)")
for a in ax: a.grid(alpha=.3); a.set_xlabel("stage")
ax[0].axhline(0, color="grey", lw=.8); ax[0].legend()
plt.tight_layout(); plt.savefig("figures/experiments_progress.png", dpi=150)
