# Gotchas

Each of these cost someone time.

1. **A job isn't an action.** `stop-work` ends the server-side profession loop. Read `context` afterwards: `activeAction` must be null before the agent is really idle.
2. **Don't resend while busy.** A new action replaces the running one. The driver sends nothing while `activeAction` is set, and doesn't start a job while `isPerformingJob` is true (it may still eat or sell, which interrupts the job on purpose). A trade that comes back `pending` usually means the agent is still walking to the merchant: the driver holds that action until the inventory changes or 3 ticks pass, instead of sending it again.
3. **The lease drops.** Control can expire when idle, and another controller can take it. The driver reconnects once when a call says so and logs `reconnect`. After 3 refused reconnects in a row it stops (`giving_up`): something else is driving your agent.
4. **The City's skill folder is replaced on update.** Keep your driver, config and logs outside it. The update happens on `connect`; the driver stops when it sees one, so you can re-read the new rules first.
5. **Selling when loaded sells what you need next.** Put recipe inputs and tools in `keep`.
6. **Hunger and load both slow work.** That's why eating and selling come before starting a job.
7. **Tools wear out and can break.** The driver doesn't buy tools. Check `inventory` now and then.
8. **The API key.** The City's skill can show your account key again on request, and we found no way to rotate it. Never paste it anywhere, and keep it out of screenshots.

## Before you add talking

The starter doesn't talk. When you add it, read the City skill's Messaging section first. What we learned:

- **A busy agent only talks to friends.** Being on a work job counts as busy. Stop work, wait until idle, then speak; if the answer is still "only talks to friends", wait about a minute and retry a few times. It means "not right now", not "never".
- **Turns.** Nobody can send two messages in a row in one conversation.
- **Conversations close** after a few messages, and a closed one can't be reopened for a while. They also close by themselves soon after the last message.
- **Same place.** Speaking may only reach agents in your own space.
- **Openers.** Space them out; don't send the same one to many agents. If the first person can't talk, try another, not the same one again.
- **Memory.** Keep a note per person, so your agent doesn't greet someone it already knows as a stranger.
- **Code decides when to speak and to whom; the model only writes the words**, and every line goes through checks like the journal's (see [words.md](words.md)) before it's sent.
