export type HistoricalReturn = Readonly<{
  year: number;
  stock_return: number;
  tbill_return: number;
  bond_return: number;
}>;

export const DATASET_PATH = "data/damodaran_histretSPX_1928_2018.csv";
export const DATASET_SHA256 = "17b989873bbfc155341afafd03a3a389cd7154a6a88408e6f83c2161fc97c8cb";
export const DATASET_SOURCE_URL = "https://pages.stern.nyu.edu/adamodar/New_Home_Page/datafile/histretSPX.html";
export const DATASET_COLUMNS = [
  "year",
  "sp500_total_return",
  "tbill_3m",
  "tbond_10y_total_return",
] as const;
export const FIRST_YEAR = 1928;
export const LAST_YEAR = 2018;
export const EXPECTED_ROWS = LAST_YEAR - FIRST_YEAR + 1;

// Bundle-safe copy generated from the SHA-pinned CSV named above. Keeping the
// source text here avoids filesystem access and network fetches inside a
// browser Worker. Tests compare this copy with the pinned repository file.
export const HISTORICAL_CSV = `year,sp500_total_return,tbill_3m,tbond_10y_total_return
1928,0.438100,0.030800,0.008400
1929,-0.083000,0.031600,0.042000
1930,-0.251200,0.045500,0.045400
1931,-0.438400,0.023100,-0.025600
1932,-0.086400,0.010700,0.087900
1933,0.499800,0.009600,0.018600
1934,-0.011900,0.003200,0.079600
1935,0.467400,0.001800,0.044700
1936,0.319400,0.001700,0.050200
1937,-0.353400,0.003000,0.013800
1938,0.292800,0.000800,0.042100
1939,-0.011000,0.000400,0.044100
1940,-0.106700,0.000300,0.054000
1941,-0.127700,0.000800,-0.020200
1942,0.191700,0.003400,0.022900
1943,0.250600,0.003800,0.024900
1944,0.190300,0.003800,0.025800
1945,0.358200,0.003800,0.038000
1946,-0.084300,0.003800,0.031300
1947,0.052000,0.005700,0.009200
1948,0.057000,0.010200,0.019500
1949,0.183000,0.011000,0.046600
1950,0.308100,0.011700,0.004300
1951,0.236800,0.014800,-0.003000
1952,0.181500,0.016700,0.022700
1953,-0.012100,0.018900,0.041400
1954,0.525600,0.009600,0.032900
1955,0.326000,0.016600,-0.013400
1956,0.074400,0.025600,-0.022600
1957,-0.104600,0.032300,0.068000
1958,0.437200,0.017800,-0.021000
1959,0.120600,0.032600,-0.026500
1960,0.003400,0.030500,0.116400
1961,0.266400,0.022700,0.020600
1962,-0.088100,0.027800,0.056900
1963,0.226100,0.031100,0.016800
1964,0.164200,0.035100,0.037300
1965,0.124000,0.039000,0.007200
1966,-0.099700,0.048400,0.029100
1967,0.238000,0.043300,-0.015800
1968,0.108100,0.052600,0.032700
1969,-0.082400,0.065600,-0.050100
1970,0.035600,0.066900,0.167500
1971,0.142200,0.045400,0.097900
1972,0.187600,0.039500,0.028200
1973,-0.143100,0.067300,0.036600
1974,-0.259000,0.077800,0.019900
1975,0.370000,0.059900,0.036100
1976,0.238300,0.049700,0.159800
1977,-0.069800,0.051300,0.012900
1978,0.065100,0.069300,-0.007800
1979,0.185200,0.099400,0.006700
1980,0.317400,0.112200,-0.029900
1981,-0.047000,0.143000,0.082000
1982,0.204200,0.110100,0.328100
1983,0.223400,0.084500,0.032000
1984,0.061500,0.096100,0.137300
1985,0.312400,0.074900,0.257100
1986,0.184900,0.060400,0.242800
1987,0.058100,0.057200,-0.049600
1988,0.165400,0.064500,0.082200
1989,0.314800,0.081100,0.176900
1990,-0.030600,0.075500,0.062400
1991,0.302300,0.056100,0.150000
1992,0.074900,0.034100,0.093600
1993,0.099700,0.029800,0.142100
1994,0.013300,0.039900,-0.080400
1995,0.372000,0.055200,0.234800
1996,0.226800,0.050200,0.014300
1997,0.331000,0.050500,0.099400
1998,0.283400,0.047300,0.149200
1999,0.208900,0.045100,-0.082500
2000,-0.090300,0.057600,0.166600
2001,-0.118500,0.036700,0.055700
2002,-0.219700,0.016600,0.151200
2003,0.283600,0.010300,0.003800
2004,0.107400,0.012300,0.044900
2005,0.048300,0.030100,0.028700
2006,0.156100,0.046800,0.019600
2007,0.054800,0.046400,0.102100
2008,-0.365500,0.015900,0.201000
2009,0.259400,0.001400,-0.111200
2010,0.148200,0.001300,0.084600
2011,0.021000,0.000300,0.160400
2012,0.158900,0.000500,0.029700
2013,0.321500,0.000700,-0.091000
2014,0.135200,0.000500,0.107500
2015,0.013800,0.002100,0.012800
2016,0.117700,0.005100,0.006900
2017,0.216100,0.013900,0.028000
2018,-0.042300,0.023700,-0.000200
`;

function parseHistoricalRows(csv: string): readonly HistoricalReturn[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",");
  if (!header || header.join(",") !== DATASET_COLUMNS.join(",")) {
    throw new Error(`Model B dataset columns must be: ${DATASET_COLUMNS.join(", ")}`);
  }

  const rows = lines.map((line, index) => {
    const fields = line.split(",");
    if (fields.length !== DATASET_COLUMNS.length || fields.some((field) => field.trim() === "")) {
      throw new Error("Model B dataset contains a missing or extra value");
    }
    const [year, stockReturn, tbillReturn, bondReturn] = fields.map(Number);
    const expectedYear = FIRST_YEAR + index;
    if (!Number.isInteger(year) || year !== expectedYear) {
      throw new Error(`Model B dataset must contain consecutive ordered years ${FIRST_YEAR}--${LAST_YEAR}`);
    }
    if (![stockReturn, tbillReturn, bondReturn].every(Number.isFinite)) {
      throw new Error(`non-finite return in year ${year}`);
    }
    if ([stockReturn, tbillReturn, bondReturn].some((value) => value <= -1)) {
      throw new Error(`return must be greater than -100% in year ${year}`);
    }
    return Object.freeze({
      year,
      stock_return: stockReturn,
      tbill_return: tbillReturn,
      bond_return: bondReturn,
    });
  });

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(`Model B dataset must contain exactly ${EXPECTED_ROWS} rows; found ${rows.length}`);
  }
  return Object.freeze(rows);
}

export const HISTORICAL_RETURNS = parseHistoricalRows(HISTORICAL_CSV);
