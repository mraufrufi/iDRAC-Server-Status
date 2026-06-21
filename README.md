# iDRAC Server Status — GNOME Shell Extension

A GNOME Shell extension that monitors Dell iDRAC-managed servers over SSH and shows their power status (ON/OFF) as a colored indicator in the top panel. Includes remote power control (on/off/restart) and a built-in daily scheduler — all configurable through a graphical settings window, no code editing required.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 🟢🔴 **Live status indicator** — colored dot in the top bar (green = on, red = off, orange = unknown/error) per server, polled every 30 seconds
- ⚡ **Power control** — Power On, graceful Power Off, and Restart, straight from the panel menu
- ⏰ **Scheduler** — set daily ON/OFF times per server, checked every minute
- ⚙️ **Settings UI** — add, edit, and remove servers (name, IP, port, username, password) via a proper preferences window — no editing extension files
- 🔐 Talks to iDRAC via SSH + `racadm`, using `sshpass` for password authentication

## Screenshots

*(add your own screenshots here — top bar indicators, dropdown menu, and settings window)*

## Requirements

- GNOME Shell 45–50
- `sshpass` installed on your system:
  ```bash
  sudo apt install sshpass
  ```
- SSH access enabled on each iDRAC (`racadm get iDRAC.SSH` to check), with a known username/password
- `racadm` available on the iDRAC (standard on iDRAC7/8/9)

## Installation

### From release zip
```bash
unzip idrac-status@local.zip -d ~/.local/share/gnome-shell/extensions/
gnome-extensions enable idrac-status@local
```

### From source
```bash
git clone https://github.com/<your-username>/idrac-status-gnome-extension.git
cp -r idrac-status-gnome-extension/idrac-status@local ~/.local/share/gnome-shell/extensions/
gnome-extensions enable idrac-status@local
```

After installing, restart GNOME Shell:
- **X11**: <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press Enter
- **Wayland**: log out and back in

## Configuration

1. Open the settings window:
   ```bash
   gnome-extensions prefs idrac-status@local
   ```
   or right-click the extension's icon in the top bar and choose **Extension Settings...**

2. Click **Add Server** and fill in:
   - **Display name** — what shows in the top bar (e.g. "Web Server", "NAS")
   - **IP address / hostname**
   - **SSH port**
   - **Username**
   - **Password**

3. Close the settings window — the indicator appears in the top bar within ~30 seconds.

Repeat for each server you want to monitor.

## Usage

Click a server's indicator in the top bar to open its menu:

| Item | Action |
|---|---|
| Status | Shows current ON/OFF/Unknown state |
| Power On | `racadm serveraction powerup` |
| Power Off (graceful) | `racadm serveraction powerdown` |
| Restart (warm reset) | `racadm serveraction hardreset` |
| Enable schedule | Toggle the daily scheduler for this server |
| Power ON at / Power OFF at | Set a daily time (24h `HH:MM`) for automatic power actions |
| Extension Settings... | Opens the preferences window |

## How it works

- Server configuration (name, IP, port, user, password) is stored using GSettings, scoped to the extension.
- Status checks and power actions run `ssh` (via `sshpass` for password auth) to call `racadm` commands on the iDRAC.
- The scheduler is a 60-second timer inside GNOME Shell that compares the current **local system time** of your desktop against each server's configured on/off times — it does not use the server's or iDRAC's own clock, and only runs while you're logged into your GNOME session.
- Per-server schedule state (enabled, on/off times, last-triggered time) is stored in `~/.config/idrac-status/schedule.json`.

## Security notes

- Passwords are stored via GSettings (dconf), which is **not encrypted** — readable by your user account on disk. This is acceptable for a personal single-user desktop but not a hardened secrets store.
- If you need stronger security, consider switching to SSH key-based authentication on the iDRAC (note: some iDRAC firmware versions, e.g. 2.30.30.30, have bugs uploading certain key types/sizes — see [Troubleshooting](#troubleshooting)) or storing credentials in the GNOME Keyring instead.

## Troubleshooting

**"Connection refused"**
Check the SSH port on the iDRAC matches what's configured (`racadm get iDRAC.SSH`), and that nothing (firewall, router NAT) blocks the path.

**Asks for password / Permission denied despite key setup**
If trying key-based auth, verify the key is actually attached to the user: `racadm sshpkauth -i <user-id> -k 1 -v`. Some firmware versions reject larger RSA key sizes or corrupt pasted keys — use 2048-bit RSA and the `-f` file option rather than interactive paste.

**Status always shows "Unknown"**
Run the underlying command manually to see the raw output/error:
```bash
sshpass -p 'yourpassword' ssh -p <port> <user>@<host> "racadm serveraction powerstatus"
```

**Extension doesn't appear after install**
Check `metadata.json`'s `shell-version` array includes your GNOME Shell major version (`gnome-shell --version`), and that you've fully restarted the shell (not just re-enabled the extension).

**Settings window fails to open / import error**
Make sure you're on GNOME Shell 45+; the preferences API path differs on older versions and isn't supported by this extension.

## Limitations

- Scheduler only fires while your desktop session is active — it cannot wake a powered-off desktop or run when you're logged out.
- Tested against iDRAC9; should work with iDRAC7/8 wherever `racadm serveraction` is supported, but UI/firmware quirks may vary.

## License

MIT License — Copyright (c) 2026 Invoxity

You're free to use, copy, modify, merge, publish, and distribute this software, including for commercial purposes, as long as the original copyright notice and license text are retained in all copies or substantial portions of the software. See [LICENSE](LICENSE) for the full text.

## Contributing

Issues and pull requests welcome.
