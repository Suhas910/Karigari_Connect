"""Part 2 — statistics and exploratory analysis (Unit II: descriptive statistics, distributions,
hypothesis tests, correlation).

Training split only (29,805 rows): the frozen test set stays unseen, so nothing learned here can leak
into the scores. Outputs: reports/eda/part2_eda.json, figures/P2_*.png,
data/splits/orange/P2_train_top15.csv (for the Orange Box Plot cross-check).

1. Price distribution: mean / median / skewness / kurtosis, raw vs log, D'Agostino normality test.
2. Price by art form: medians and spread for the 15 most common primary art forms.
3. Does art form change price? Levene (equal spread?), one-way ANOVA on log price, Kruskal-Wallis
   (no normality assumption) with effect sizes; repeated with one row per product family, because
   design variants repeat the same product many times.
4. Correlations: Pearson and Spearman of numeric features with price and log price.
5. Words per price band: TF-IDF words most typical of low / mid / high price, and a chi-square
   test of price band vs technique family.
"""
import json, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import stats
from sklearn.feature_extraction.text import TfidfVectorizer
from features import load

tr, _, kgc = load()
p, lp = tr.price.astype(float), tr.log_price.astype(float)
out = {"rows": len(tr), "families": int(tr.family.nunique())}

# 1 — distribution ---------------------------------------------------------------------------------
def describe(x):
    q1, q3 = x.quantile([.25, .75])
    return dict(mean=round(x.mean(), 3), median=round(x.median(), 3), std=round(x.std(), 3), min=round(x.min(), 3),
                q1=round(q1, 3), q3=round(q3, 3), max=round(x.max(), 3), skewness=round(stats.skew(x), 3),
                excess_kurtosis=round(stats.kurtosis(x), 3), dagostino_p=float(stats.normaltest(x).pvalue))
out["distribution"] = {"price": describe(p), "log_price": describe(lp)}
# Sellers pick round "price points" (₹390, ₹590, ₹990): the reason for the spikes in the histogram
out["price_endings"] = dict(ends_in_90_pct=round(100 * (p % 100 == 90).mean(), 1), multiple_of_50_pct=round(100 * (p % 50 == 0).mean(), 1),
                            most_common={int(k): int(v) for k, v in p.value_counts().head(8).items()})
fig, ax = plt.subplots(2, 2, figsize=(11, 7))
ax[0, 0].hist(p, bins=100, color="tab:orange"); ax[0, 0].set_title(f"Price (₹): skew {stats.skew(p):.2f}")
ax[0, 1].hist(lp, bins=100, color="tab:blue"); ax[0, 1].set_title(f"log(price): skew {stats.skew(lp):.2f}")
stats.probplot(p, plot=ax[1, 0]); ax[1, 0].set_title("Q-Q plot vs normal: price")
stats.probplot(lp, plot=ax[1, 1]); ax[1, 1].set_title("Q-Q plot vs normal: log(price)")
plt.tight_layout(); plt.savefig("figures/P2_price_distribution.png", dpi=130); plt.close()

# 2 — price by art form ----------------------------------------------------------------------------
top = tr.primary_artform.value_counts().head(15).index
g = tr[tr.primary_artform.isin(top)].groupby("primary_artform").price
by_art = pd.DataFrame({"rows": g.size(), "median": g.median(), "q1": g.quantile(.25), "q3": g.quantile(.75),
                       "mean": g.mean().round(0)}).sort_values("median")
out["top15_artforms"] = by_art.reset_index().to_dict("records")
fig, ax = plt.subplots(figsize=(10, 6))
ax.boxplot([tr.price[tr.primary_artform == a] for a in by_art.index], orientation="horizontal",
           tick_labels=by_art.index, showfliers=False)
ax.set_xscale("log"); ax.set_xlabel("Price (₹, log scale); whiskers 1.5 × IQR, outlier dots hidden")
ax.set_title("Price by primary art form (15 most common, sorted by median)")
plt.tight_layout(); plt.savefig("figures/P2_price_by_artform.png", dpi=130); plt.close()
tr[tr.primary_artform.isin(top)][["primary_artform", "price", "log_price"]].to_csv(
    "data/splits/orange/P2_train_top15.csv", index=False)

# 3 — hypothesis tests: does art form change price? -------------------------------------------------
def tests(df, min_rows):
    keep = df.primary_artform.value_counts()
    keep = keep[keep >= min_rows].index
    df = df[df.primary_artform.isin(keep)]
    groups = [x.values for _, x in df.groupby("primary_artform").log_price]
    n, k = len(df), len(groups)
    lev = stats.levene(*groups)
    an = stats.f_oneway(*groups)
    kw = stats.kruskal(*groups)
    grand = df.log_price.mean()
    ss_between = sum(len(x) * (x.mean() - grand) ** 2 for x in groups)
    eta2 = ss_between / ((df.log_price - grand) ** 2).sum()
    return dict(rows=n, groups=k, levene_W=round(lev.statistic, 2), levene_p=float(lev.pvalue),
                anova_F=round(an.statistic, 2), anova_p=float(an.pvalue), eta_squared=round(eta2, 3),
                kruskal_H=round(kw.statistic, 1), kruskal_p=float(kw.pvalue),
                epsilon_squared=round((kw.statistic - k + 1) / (n - k), 3))
fam = tr.groupby("family").agg(primary_artform=("primary_artform", "first"), log_price=("log_price", "median"))
out["artform_tests"] = {"all_rows (art forms with >= 30 rows)": tests(tr, 30),
                        "one_row_per_family (art forms with >= 30 families)": tests(fam, 30)}
# One pair, to show a two-group test: the two most common art forms
a, b = tr.primary_artform.value_counts().index[:2]
mw = stats.mannwhitneyu(tr.price[tr.primary_artform == a], tr.price[tr.primary_artform == b])
out["mann_whitney_top2"] = dict(a=a, b=b, median_a=float(tr.price[tr.primary_artform == a].median()),
                                median_b=float(tr.price[tr.primary_artform == b].median()), U=float(mw.statistic), p=float(mw.pvalue))

# 4 — correlations ---------------------------------------------------------------------------------
num = ["title_len", "desc_len", "desc_repeat", "artform_count", "variant_group_size", "kg_skilled", "kg_material_count"]
num = [c for c in num if c in tr.columns]
corr = pd.DataFrame({
    "pearson_price": [stats.pearsonr(tr[c], p)[0] for c in num],
    "pearson_log_price": [stats.pearsonr(tr[c], lp)[0] for c in num],
    "spearman_price": [stats.spearmanr(tr[c], p)[0] for c in num]}, index=num).round(3)
out["correlations"] = corr.reset_index(names="feature").to_dict("records")
m = tr[num + ["log_price"]].corr(method="spearman")
fig, ax = plt.subplots(figsize=(7, 6))
im = ax.imshow(m, cmap="RdBu_r", vmin=-1, vmax=1)
ax.set_xticks(range(len(m)), m.columns, rotation=45, ha="right"); ax.set_yticks(range(len(m)), m.columns)
for i in range(len(m)):
    for j in range(len(m)):
        ax.text(j, i, f"{m.iloc[i, j]:.2f}", ha="center", va="center", fontsize=8)
plt.colorbar(im); ax.set_title("Spearman correlation (training split)")
plt.tight_layout(); plt.savefig("figures/P2_correlations.png", dpi=130); plt.close()

# 5 — words per price band + chi-square ------------------------------------------------------------
cuts = p.quantile([1 / 3, 2 / 3]).values
band = pd.cut(p, [0, cuts[0], cuts[1], 1e9], labels=["low", "mid", "high"]).astype(str)
out["band_cuts"] = [float(c) for c in cuts]
tf = TfidfVectorizer(min_df=20, stop_words="english", sublinear_tf=True, token_pattern=r"(?u)\b[a-z][a-z]+\b")
X = tf.fit_transform(tr.text.str.lower()); vocab = np.array(tf.get_feature_names_out())
words = {}
for b in ["low", "mid", "high"]:
    inside = np.asarray(X[(band == b).values].mean(0)).ravel()
    rest = np.asarray(X[(band != b).values].mean(0)).ravel()
    order = np.argsort(-(inside - rest))[:15]           # most typical of this band compared with the others
    words[b] = [dict(word=vocab[i], tfidf_in_band=round(inside[i], 4), tfidf_elsewhere=round(rest[i], 4)) for i in order]
out["words_per_band"] = words
fig, ax = plt.subplots(1, 3, figsize=(13, 5))
for k, b in enumerate(["low", "mid", "high"]):
    w = words[b][::-1]
    ax[k].barh([x["word"] for x in w], [x["tfidf_in_band"] - x["tfidf_elsewhere"] for x in w], color=["tab:green", "tab:gray", "tab:red"][k])
    ax[k].set_title(f"{b} price band"); ax[k].set_xlabel("mean TF-IDF in band − elsewhere")
plt.tight_layout(); plt.savefig("figures/P2_words_per_band.png", dpi=130); plt.close()

tech = np.select([tr[f"kg_tech_{t}"] == 1 for t in ["Weaving", "Printing", "ResistDyeing", "Embroidery", "Painting",
                                                    "MetalCraft", "WoodCraft", "BeadWork"]],
                 ["weaving", "printing", "tie-dye", "embroidery", "painting", "metal", "wood", "bead work"], "other / none")
ct = pd.crosstab(tech, band)[["low", "mid", "high"]]
chi = stats.chi2_contingency(ct)
cramer = np.sqrt(chi.statistic / (ct.values.sum() * (min(ct.shape) - 1)))
out["chi_square_technique_vs_band"] = dict(table=ct.to_dict("index"), chi2=round(chi.statistic, 1), dof=int(chi.dof),
                                           p=float(chi.pvalue), cramers_v=round(cramer, 3))

json.dump(out, open("reports/eda/part2_eda.json", "w"), indent=1, default=float, ensure_ascii=False)
print(json.dumps({k: out[k] for k in ["rows", "families", "distribution", "artform_tests", "mann_whitney_top2", "band_cuts"]}, indent=1, default=float))
print(by_art.to_string()); print(corr.to_string()); print(ct.to_string())
print({k: v for k, v in out["chi_square_technique_vs_band"].items() if k != "table"})
for b in words:
    print(b, [w["word"] for w in words[b]])
