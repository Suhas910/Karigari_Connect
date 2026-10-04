"""Price advisor demo (part 16). Run from ml_price/:  .venv/bin/streamlit run app/streamlit_app.py"""
import streamlit as st
from advisor import advise, A

st.set_page_config(page_title="Handicraft Price Advisor", layout="wide")
st.title("Handicraft Price Advisor")
st.caption("AI&ML course project · market estimate from 29,805 listings · fair-wage floor from the Karigari Connect app")

with st.form("listing"):
    c1, c2 = st.columns([3, 2])
    with c1:
        title = st.text_input("Product title", "Red - Handloom Mulberry Silk Ikat Saree with Zari Border")
        desc = st.text_area("Description", "Handwoven pure mulberry silk saree in Pochampally ikat with zari border. "
                                           "Each piece is woven by hand.", height=110)
        labels = st.multiselect("Art-form labels", A["labels"], default=["pochampally ikat weaving", "handloom"])
    with c2:
        listed = st.number_input("Listed price, ₹ (optional, 0 = none)", min_value=0, value=4500, step=50)
        st.markdown("**Fair-wage floor inputs** (optional)")
        mat = st.number_input("Material cost, ₹", min_value=0, value=3000, step=50)
        hrs = st.number_input("Labour hours", min_value=0.0, value=40.0, step=1.0)
        state = st.text_input("State code (e.g. KA, TG, UP)", "TG")
        skill = st.selectbox("Self-declared skill", ["skilled", "semi_skilled", "unskilled", "highly_skilled"])
    go = st.form_submit_button("Advise")

if go:
    r = advise(title, desc, labels, listed_price=listed or None, material_cost=mat if hrs else None,
               labour_hours=hrs or None, state_code=state.strip().upper() or None, skill_level=skill)
    lo, hi = r["suggested_range"]
    m1, m2, m3 = st.columns(3)
    m1.metric("Suggested price range", f"₹{lo:,.0f} – ₹{hi:,.0f}")
    m2.metric("Market estimate (point)", f"₹{r['point']:,.0f}")
    if r["floor"]:
        f = r["floor"]
        m3.metric("Fair-wage floor", f"₹{f['amount']:,.0f}" if f["status"] == "available" else "unavailable")
    if r["verdict"]:
        (st.error if "BELOW" in r["verdict"] or "under half" in r["verdict"] else st.info)(r["verdict"])
    for c in r["cautions"]:
        st.warning(c)
    a, b = st.columns(2)
    with a:
        st.subheader("Why (knowledge layer)")
        st.write(f"**Primary art form:** {r['primary_artform']} · **Segment:** {r['segment']}")
        st.write("**Techniques:** " + (", ".join(r["techniques"]) or "none recognised"))
        st.write("**Rules fired:** " + (", ".join(r["rule_facts"]) or "none"))
        if r["floor"]:
            st.write("**Floor:** " + (r["floor"]["explanation"] or r["floor"]["status"]))
        st.write(f"**80% market range before the floor:** ₹{r['market_range'][0]:,.0f} – ₹{r['market_range'][1]:,.0f}")
    with b:
        st.subheader("Evidence: 10 most similar listings")
        st.dataframe([{"similarity": s["similarity"], "price ₹": s["price"], "listing": s["title"]} for s in r["similar"]],
                     hide_index=True, use_container_width=True)
    st.caption("Market estimates reflect asking prices in one catalogue. The fair-wage floor always overrides the market range.")
