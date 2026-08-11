# Historical return data

The canonical Model B dataset is damodaran_histretSPX_1928_2018.csv.

- Source: Aswath Damodaran, *Annual Returns on Stock, T.Bonds and T.Bills: 1928 - Current*
- Source URL: https://pages.stern.nyu.edu/adamodar/New_Home_Page/datafile/histretSPX.html
- Frozen window: 1928–2018 inclusive
- Grain: one row per calendar year; 91 chronological, same-year observations
- Units: decimal simple annual returns
- Equity: S&P 500 total return, including dividends
- Bill: 3-month U.S. Treasury bill return
- Bond: 10-year U.S. Treasury total return, including coupon and price appreciation
- Supplied source-file SHA-256: 17b989873bbfc155341afafd03a3a389cd7154a6a88408e6f83c2161fc97c8cb

Validated invariants:

- no missing, duplicate, or non-consecutive years;
- mean 3-month bill return = 0.03426263736263736;
- equity log mean / sample volatility = 0.09066332953507913 / 0.19053867269583694;
- bond log mean / sample volatility = 0.04715599437262209 / 0.07121301843927648;
- paired equity/bond log-return correlation = -0.025960613316734417;
- empirical 90%-strike one-year put premium under the report's mean-shift convention = 0.02564365741407343.

The original file in Downloads remains unchanged. Tests treat the row count,
year range, source values, and headline parameters as immutable acceptance
criteria.
