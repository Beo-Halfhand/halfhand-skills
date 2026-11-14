# Running it on every push

## GitHub Actions

Put `leak-check.mjs` in your repo (for example `tools/leak-check.mjs`; it scans itself without matching itself), then:

```yaml
name: leak-check
on: [push, pull_request]
permissions:
  contents: read
jobs:
  leaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # full history, or --history and gitleaks git see one commit
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: leak-check (files, history, commit authors)
        run: node tools/leak-check.mjs . --history
      - name: gitleaks
        run: |
          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz | tar -xz gitleaks
          ./gitleaks git . --redact --no-banner
          ./gitleaks dir . --redact --no-banner
```

Pin the gitleaks version, as above, so a new release can't change your gate without you noticing. This is what the halfhand-skills repo itself runs (its `tools/check.mjs` imports the same rules and adds skill linting).

Your private terms file doesn't belong in CI: CI logs and repo secrets are the wrong place for a list of what you're hiding. Run the private-terms pass locally, before you push.

## A pre-push hook

```sh
cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
LEAK_TERMS="$HOME/.leakterms" node tools/leak-check.mjs . --history || exit 1
gitleaks git . --redact --no-banner || exit 1
EOF
chmod +x .git/hooks/pre-push
```

Hooks live in `.git/` and aren't pushed, so each clone sets this up once.

## Before a repo goes public

Run the three checks on a **fresh clone**, not your working copy: untracked and ignored files in your working copy hide what a stranger would actually get, and a fresh clone shows exactly what's published.

```sh
git clone --mirror <repo url> /tmp/check.git && git clone /tmp/check.git /tmp/check
cd /tmp/check && LEAK_TERMS=~/.leakterms node <path>/leak-check.mjs . --history && gitleaks git . --redact --no-banner
```

The mirror clone includes every branch and tag, so you also see branches you forgot.
