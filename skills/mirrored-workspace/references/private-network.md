# The private network

Goal: the always-on machine, your laptop and your phone can reach each other from anywhere, by name, and **nothing is open to the internet**. A mesh VPN does this: every device runs a small client, gets a private address and a name, and talks to the others over encrypted WireGuard tunnels. Your home router forwards no ports.

Worked example below: **Tailscale**. Others work the same way (see the end).

## 1. Join every device
1. Install the client on the always-on machine, the laptop and the phone (each platform's app store or package manager; on a Linux server, the vendor's install instructions).
2. Sign in to the same account on each. Each device appears in the admin console with a name.
3. Turn on **MagicDNS** in the admin console. Each device is now reachable by its name under your network's own domain (the service picks the network part; below it's written `your-tailnet`), for example `always-on.your-tailnet.ts.net`.
4. Rename the always-on machine to something plain, like `always-on`. It becomes `always-on.your-tailnet.ts.net`.

Connect by that name, never by the private address: addresses can change, names don't, and a name in a script says what it means.

Your tailnet name and device names are setup details. Keep them out of anything public (posts, repos, screenshots). In examples, write `always-on.your-tailnet.ts.net`.

## 2. Lock the network down
- **Device approval:** turn on device approval in the admin console, so a new device can't join until you approve it. Anyone who gets your login still can't add a machine silently.
- **Key expiry:** devices re-authenticate every few months by default. For the always-on machine, either disable key expiry for that one device (it's in your house and you approved it) or put the renewal date in your calendar. A server whose key expired drops off the network quietly.
- **Access rules:** the default policy lets your devices reach each other on every port. Narrow it to what you use: from your devices to the always-on machine on TCP 22 (SSH) and UDP 60000–61000 (mosh). Leave the rest closed.
- **Lost device:** remove it from the admin console first, then delete its public key from `~/.ssh/authorized_keys` on the always-on machine.

## 3. Key-only SSH on the always-on machine
1. Turn SSH on. macOS: System Settings → General → Sharing → Remote Login, limited to your user. Linux: `sudo apt install openssh-server`.
2. On **each** client, make its own key and copy the public half over (one key per device, so you can revoke one alone):

   ```sh
   ssh-keygen -t ed25519 -C "laptop"
   ssh-copy-id -i ~/.ssh/id_ed25519.pub always-on
   ```

3. Check that key login works **in a second terminal**, then turn passwords off with a drop-in file, `/etc/ssh/sshd_config.d/50-keys-only.conf`:

   ```text
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   ```

   Restart sshd (macOS: turn Remote Login off and on; Linux: `sudo systemctl restart ssh`). Keep your first session open until a new one logs in.
4. Optional: make sshd listen only on the mesh interface (`ListenAddress <the machine's private mesh address>`), so it isn't reachable even on your home Wi-Fi. Check it starts after the mesh client does, or you can lock yourself out on reboot.

The mesh service also offers its own SSH that uses your network login instead of keys. That works too; this guide uses plain sshd so it's the same with any mesh network.

## 4. mosh
mosh keeps a session alive across Wi-Fi changes, sleep and roaming, and answers keystrokes locally. It logs in with SSH, then talks UDP on 60000–61000 over the mesh.

```sh
mosh always-on -- tmux new -A -s build
```

On macOS with Homebrew, a non-interactive SSH login may not find `mosh-server`. Tell mosh where it is:

```sh
mosh --server=/opt/homebrew/bin/mosh-server always-on -- /opt/homebrew/bin/tmux new -A -s build
```

## 5. The phone
- **Reading:** the sync provider's app or a markdown app on a folder you own and sync yourself. Never a public link.
- **Attaching:** an SSH client app that supports mosh (or plain SSH), with a key made on the phone, joined to the mesh network. Approve the phone in the admin console like any device. Use `tmux new -A -s <tab>` so a dropped connection is just a re-attach.
- A phone is the device most likely to be lost: give it its own key and remove it from the network and from `authorized_keys` the day it goes missing.

## What's exposed and what isn't

| Exposed | To whom |
|---|---|
| SSH (TCP 22) and mosh (UDP 60000–61000) on the always-on machine | Only devices you approved on your mesh network, narrowed further by access rules |
| Device names, public keys, which devices connect | The mesh service's coordination server. Traffic is end-to-end encrypted between devices |
| Files you sync | Your sync provider |

| Not exposed | Why |
|---|---|
| Any port on the public internet | No port forwarding, no public listener; the mesh client dials out |
| A password to guess | SSH is key-only |
| The tabs | Reachable only after SSH key login over the mesh |
| Logs and snapshots | Nothing serves them; they're files in a 700 folder |

## Other mesh networks
- **WireGuard alone:** you write the config yourself. Give each device a fixed private address and put names in each device's hosts file (or your own DNS). Same SSH alias, same commands.
- **Headscale:** a self-hosted coordination server compatible with the same clients.
- **ZeroTier, Nebula:** private addresses plus names, same idea, different setup.

Whatever you use, the rules don't change: connect by name, approve devices, key-only SSH, nothing forwarded from the internet.
