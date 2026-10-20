/** The package version. Kept equal to package.json by a test. */
export const VERSION = '0.1.0';

/** The product token this tool uses in its `User-Agent` and to read robots.txt rules meant for it. */
export const PRODUCT_TOKEN = 'site-audit';

/** The repository, named in the `User-Agent` so site owners can see what is calling. */
export const REPO_URL = 'https://github.com/BYDTechSolutions/site-audit';

/** The `User-Agent` header sent with every request except the AI-crawler probes. */
export const USER_AGENT = `${PRODUCT_TOKEN}/${VERSION} (+${REPO_URL})`;
