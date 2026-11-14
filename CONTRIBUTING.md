# Contributing

## A skill misled your agent

That's the report we most want. Open an issue with:

- the skill and the commit or tag you used;
- the agent and model;
- what you asked for;
- what the agent did, and the step where it went wrong;
- the versions involved (Node, the tool's tag, OS).

Please leave out keys, tokens, seeds, private URLs and anything from your own machine you wouldn't post publicly.

## Pull requests

Small fixes (a wrong command, a stale version, a broken link) are welcome. Before you open one:

```sh
node tools/check.mjs
gitleaks git . --redact
```

Both must be clean. A change to a skill's steps needs to say how you tested it: which agent ran the changed skill, on what task, and what happened.

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0.
