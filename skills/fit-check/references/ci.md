# fit-check as a deploy gate

Run it against the **preview** before you promote, and stop when it exits non-zero.

## A script

```sh
#!/bin/sh
# scripts/fit-check.sh [base-url]: check every path in scripts/fit-urls.txt on the preview
BASE=${1:-https://my-site-preview.example.com}
LIST=$(mktemp)
grep -v '^\s*#' scripts/fit-urls.txt | grep -v '^\s*$' | sed "s#^/#${BASE%/}/#" > "$LIST"
npx --yes github:Beo-Halfhand/fit-check#v0.1.3 --quiet --urls-file "$LIST" --out fit-report
rc=$?
rm -f "$LIST"
[ $rc -eq 0 ] || echo "fit-check: not clean (exit $rc). See fit-report/report.md"
exit $rc
```

`scripts/fit-urls.txt` holds paths, one per line:

```text
# every page a visitor can reach, plus variants that render differently
/
/pricing
/shop?view=list
```

When you add a page to the site, add it here.

## npm script

```json
"scripts": { "fit": "fit-check --urls-file scripts/fit-urls.txt" },
"devDependencies": { "fit-check": "github:Beo-Halfhand/fit-check#v0.1.3" }
```

## GitHub Actions

```yaml
jobs:
  fit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx playwright install --with-deps chromium-headless-shell
      - run: npx --yes github:Beo-Halfhand/fit-check#v0.1.3 --quiet --urls-file scripts/fit-urls.txt --out fit-report
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: fit-report, path: fit-report }
```

The upload step makes the report and crops downloadable from the failed run. If the repo is public, so are its Actions artifacts. Don't do this for pages that shouldn't be seen.

## Rules for the gate

- Add `fit-report/` to `.gitignore`.
- Keep all nine widths in the gate. Use `--widths` only for quick local passes.
- Treat exit 2 as a failure, never as "flaky, retry until green".
- Check `httpStatus` in `report.json` if the URL list is generated. A typo gives a clean 404 page.
