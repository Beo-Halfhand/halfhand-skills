# fleet-experiment-kit

Run AI agents against each other and judge them on outcomes, not impressions.

- **A register** where every change gets a row and a bar written *before* any data.
- **Head-to-head setups:** treatment vs control in the same window, paired windows with a coin flip, shadow runs.
- **One outcome log** where only what the world confirmed is scored. What an agent claims is shown, never counted.
- **A daily review** that reads the raw lines and writes OK, LOOKS WRONG, READY TO DECIDE or STOP per row. Repeats go to the top.
- **Gates that must reject:** every bar, guard and checker proves it says no to known-bad cases and to mutants, every run.

Zero dependencies, Node 20+. It reads [fleet-dashboard](../fleet-dashboard/) history, so a fleet that already has the dashboard gets measurement for free.

```sh
node scripts/xk.mjs --demo         # invented crew, five experiments, every verdict, then the gates
node scripts/selftest.mjs          # selftest: 130 ok, 0 failed
```

How to set it up, the rules and the commands: [SKILL.md](SKILL.md).

Apache-2.0, part of [halfhand-skills](../../README.md).
