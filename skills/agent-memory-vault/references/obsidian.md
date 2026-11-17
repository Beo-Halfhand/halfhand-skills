# Using the vault in Obsidian

Obsidian is optional: the vault is plain markdown and works in any editor. If you use it:

- **Open folder as vault** and pick the vault folder.
- **Links:** notes use `[[wikilinks]]` (`[[DECISIONS]]`, `[[topics/example-project|the example]]`). `HOME.md` uses plain markdown links so it also works on GitHub; Obsidian draws both in the graph.
- **Map of content:** `HOME.md` lists every note and folder. Add a line when you add a topic home. Pin it if you like.
- **Tags:** one per note (`#vault`, `#topic`, `#log`). More than one makes the graph noisy.
- **Graph filter:** to keep generated or old material out of the picture, filter with `-path:archive -path:files`.
- **Quick open** (Cmd/Ctrl-O) finds a note by name; **search** (Cmd/Ctrl-Shift-F) finds by content.
- **Frontmatter:** each template note starts with `type`, `writer` and `updated`. Obsidian shows them as properties; assistants use `writer` to know whether they may edit.
- **Settings folder:** `.obsidian/` holds your Obsidian settings. The template's `.gitignore` keeps its per-device workspace files out of git.
- **Phone:** the Obsidian mobile app can open the same synced folder. Treat the phone as another machine: it reads freely, and if it writes, it writes its own day log (`logs/phone/`).
