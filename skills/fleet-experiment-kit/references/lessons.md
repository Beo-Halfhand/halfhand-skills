# How experiments on agents go wrong

Each of these happened on a real fleet before it became a rule in this kit. The numbers and names here are invented; the shapes are not.

1. **The collector's number was wrong, and only the raw lines showed it.** A readout said a change gave +4%, under its +15% bar: revert. The raw block lines said otherwise: treatment blocks ran far above the control. The collector had averaged a per-minute column that mixed resting time with working time. Fixed, the change cleared the bar by a wide margin. *Rule: read the raw lines every day; trace one outcome by hand when a number surprises you.*

2. **Counts said "better" while the output got worse.** Replies per day went up after a prompt change. Reading a day of replies showed agents forgetting people they'd met, asking a forced question in every message, and greeting regulars as strangers. No counter saw any of it. *Rule: the review shows raw lines under every verdict.*

3. **The bar measured the wrong thing.** A bar counted new ratings per day. The leaderboard ranked the average rating. Volume went up, the average and the rank went down. The week was voided and the bar rewritten from the source's own definition. *Rule: read how the number is computed where it counts before writing the bar.*

4. **A volume-starved arm isn't judgeable.** One treatment agent got one chance a day to use the change because it was busy the rest of the time. Its "result" was noise. *Rule: the `volume` flag, and fix volume before reading the bar.*

5. **Three baselines, no answer.** The same row was compared against three different "before" numbers from different windows, and each gave a different verdict. *Rule: pin one baseline, with its window, in the row.*

6. **An outage looked like a treatment effect.** Every fallback in a canary came from one hour when a helper service's storage filled up. *Rule: log it as an `infra` note, count from the fix, and say so on the row.*

7. **Readings flipped.** A standings endpoint served two copies out of sync; a score went A → B → A within minutes. The tell was a count going down that can only go up. *Rule: confirm before you log; count the flaps.*

8. **A simulation matched once and was trusted.** A simulator tuned on one run predicted the next one badly, and was wrong again after it was re-tuned. *Rule: use sims to rank ideas, then test the winner live; never write a bar from a sim.*

9. **Wrong placement looks like "nothing happened".** A helper got zero calls in its first days. The events it was meant for did happen, on other code paths. *Rule: before the clock means anything, check the hook sits where the event fires. `evidence-empty` says this every time.*

10. **A dry run of an explorer can only say "untried".** A rule meant to find better options was run in shadow. It never tried anything, so it could never learn what the new options paid. *Rule: if exploring is the point, test live with a stop rule.*

11. **Exactly zero was the poll interval.** Returns on dozens of round trips were all 0.0%. Prices were snapshotted when the poller saw each trade, so trades shorter than the poll interval got the same price on both sides. *Rule: `too-clean`; suspect the instrument first.*

12. **A verifier nobody had seen say no.** It was trusted until someone ran the control: change one character of a known-good input and check that it fails. Separately, a verifier called without one optional input returned `false` for a good record: it "rejected" perfectly and was useless. *Rule: every gate shows its known-bad and known-good cases and its mutants, every run.*

13. **Unregistered live changes pile up.** "Small" improvements went live without a row and nobody could later say which helped. *Rule: audit weekly: everything live that's meant to improve something has a row, or a written reason not to.*

14. **Experiments sat.** Rows stayed "running" past their backstop because nothing forced a decision. *Rule: minimum sample plus a backstop; READY TO DECIDE; REPEAT for anything flagged twice.*
