import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const POLL_INTERVAL = 30; // seconds
const SCHEDULE_CHECK_INTERVAL = 60; // seconds

// ---------- Helpers ----------

function getScheduleFilePath() {
    let homeDir = GLib.get_home_dir();
    return `${homeDir}/.config/idrac-status/schedule.json`;
}

function loadSchedules() {
    try {
        let [ok, contents] = GLib.file_get_contents(getScheduleFilePath());
        if (!ok) return {};
        let text = new TextDecoder().decode(contents);
        return JSON.parse(text);
    } catch (e) {
        return {};
    }
}

function saveSchedules(schedules) {
    try {
        let dir = `${GLib.get_home_dir()}/.config/idrac-status`;
        GLib.mkdir_with_parents(dir, 0o700);
        let text = JSON.stringify(schedules, null, 2);
        GLib.file_set_contents(getScheduleFilePath(), text);
    } catch (e) {
        logError(e, 'Failed to save schedules');
    }
}

function loadServers(settings) {
    try {
        let json = settings.get_string('servers');
        let arr = JSON.parse(json);
        if (Array.isArray(arr)) return arr;
    } catch (e) {
        // ignore
    }
    return [];
}

// Run an SSH command via sshpass, async, callback(success, stdout, stderr)
function runSshCommand(server, racadmCmd, callback) {
    let password = server.password || '';
    if (!password) {
        callback(false, '', 'No password configured');
        return;
    }

    let escapedPass = password.replace(/'/g, "'\\''");
    let script = `sshpass -p '${escapedPass}' ssh ` +
        `-o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ` +
        `-p ${server.port} ${server.user}@${server.host} ` +
        `"${racadmCmd}"`;

    let cmd = ['bash', '-c', script];

    try {
        let proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );

        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                let success = proc.get_successful();
                callback(success, stdout || '', stderr || '');
            } catch (e) {
                callback(false, '', e.message);
            }
        });
    } catch (e) {
        callback(false, '', e.message);
    }
}

// ---------- Indicator ----------

const ServerIndicator = GObject.registerClass(
class ServerIndicator extends PanelMenu.Button {
    _init(server, schedules, saveSchedulesCb, openPrefsCb) {
        super._init(0.0, `${server.name} Status`);

        this._server = server;
        this._schedules = schedules; // shared object reference
        this._saveSchedules = saveSchedulesCb;
        this._openPrefs = openPrefsCb;

        this._label = new St.Label({
            text: server.name,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._statusDot = new St.Widget({
            style: 'width: 12px; height: 12px; border-radius: 6px; background-color: gray;',
            y_align: Clutter.ActorAlign.CENTER,
        });

        let box = new St.BoxLayout({
            style: 'padding: 0 6px; spacing: 6px;',
        });
        box.add_child(this._statusDot);
        box.add_child(this._label);
        this.add_child(box);

        // --- Status item ---
        this._statusItem = new PopupMenu.PopupMenuItem('Checking...', { reactive: false });
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Power control buttons ---
        this._powerOnItem = new PopupMenu.PopupMenuItem('Power On');
        this._powerOnItem.connect('activate', () => this._powerAction('powerup'));
        this.menu.addMenuItem(this._powerOnItem);

        this._powerOffItem = new PopupMenu.PopupMenuItem('Power Off (graceful)');
        this._powerOffItem.connect('activate', () => this._powerAction('powerdown'));
        this.menu.addMenuItem(this._powerOffItem);

        this._resetItem = new PopupMenu.PopupMenuItem('Restart (warm reset)');
        this._resetItem.connect('activate', () => this._powerAction('hardreset'));
        this.menu.addMenuItem(this._resetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Scheduler section ---
        this._schedHeader = new PopupMenu.PopupMenuItem('Scheduler', { reactive: false });
        this.menu.addMenuItem(this._schedHeader);

        this._schedEnableItem = new PopupMenu.PopupSwitchMenuItem('Enable schedule', this._getSchedule().enabled || false);
        this._schedEnableItem.connect('toggled', (item) => {
            let sched = this._getSchedule();
            sched.enabled = item.state;
            this._saveSchedules();
        });
        this.menu.addMenuItem(this._schedEnableItem);

        this._onTimeItem = new PopupMenu.PopupMenuItem(`Power ON at: ${this._getSchedule().onTime || 'not set'}`);
        this._onTimeItem.connect('activate', () => this._promptTime('onTime', 'Power ON time'));
        this.menu.addMenuItem(this._onTimeItem);

        this._offTimeItem = new PopupMenu.PopupMenuItem(`Power OFF at: ${this._getSchedule().offTime || 'not set'}`);
        this._offTimeItem.connect('activate', () => this._promptTime('offTime', 'Power OFF time'));
        this.menu.addMenuItem(this._offTimeItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Settings shortcut ---
        this._settingsItem = new PopupMenu.PopupMenuItem('Extension Settings...');
        this._settingsItem.connect('activate', () => this._openPrefs());
        this.menu.addMenuItem(this._settingsItem);

        this._setColor('gray');
        this._pollTimeoutId = null;
        this._startPolling();
    }

    _getSchedule() {
        if (!this._schedules[this._server.id]) {
            this._schedules[this._server.id] = { enabled: false, onTime: null, offTime: null, _lastTriggered: {} };
        }
        return this._schedules[this._server.id];
    }

    _promptTime(key, title) {
        let sched = this._getSchedule();
        let dialog = new ModalDialog.ModalDialog({ styleClass: 'idrac-time-dialog' });

        let label = new St.Label({ text: `${title} (HH:MM, 24h format):` });
        dialog.contentLayout.add_child(label);

        let entry = new St.Entry({
            text: sched[key] || '00:00',
            can_focus: true,
            style: 'margin-top: 10px; width: 120px;'
        });
        dialog.contentLayout.add_child(entry);

        dialog.setButtons([
            {
                label: 'Cancel',
                action: () => dialog.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: 'Clear',
                action: () => {
                    sched[key] = null;
                    this._saveSchedules();
                    this._refreshScheduleLabels();
                    dialog.close();
                },
            },
            {
                label: 'Save',
                action: () => {
                    let val = entry.get_text().trim();
                    if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(val)) {
                        sched[key] = val;
                        this._saveSchedules();
                        this._refreshScheduleLabels();
                        dialog.close();
                    } else {
                        label.text = `${title} - invalid format! Use HH:MM (24h):`;
                    }
                },
                default: true,
            },
        ]);

        dialog.open();
        global.stage.set_key_focus(entry);
    }

    _refreshScheduleLabels() {
        let sched = this._getSchedule();
        this._onTimeItem.label.text = `Power ON at: ${sched.onTime || 'not set'}`;
        this._offTimeItem.label.text = `Power OFF at: ${sched.offTime || 'not set'}`;
        this._schedEnableItem.setToggleState(sched.enabled || false);
    }

    _powerAction(action) {
        let actionLabels = {
            powerup: 'Power On',
            powerdown: 'Power Off',
            hardreset: 'Restart',
        };
        this._statusItem.label.text = `${this._server.name}: ${actionLabels[action]}...`;

        runSshCommand(this._server, `racadm serveraction ${action}`, (success, stdout, stderr) => {
            if (success) {
                this._statusItem.label.text = `${this._server.name}: ${actionLabels[action]} sent`;
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
                    this._checkStatus();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._statusItem.label.text = `${this._server.name}: Action failed`;
                Main.notify('iDRAC Status', `${this._server.name}: ${actionLabels[action]} failed - ${stderr}`);
            }
        });
    }

    _setColor(color) {
        this._statusDot.style = `width: 12px; height: 12px; border-radius: 6px; background-color: ${color};`;
    }

    _startPolling() {
        this._checkStatus();
        this._pollTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_INTERVAL, () => {
            this._checkStatus();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Update server config in-place (e.g. after prefs change) without recreating the indicator
    updateServer(server) {
        this._server = server;
        this._label.text = server.name;
    }

    _checkStatus() {
        runSshCommand(this._server, 'racadm serveraction powerstatus', (success, stdout, stderr) => {
            let output = stdout.toLowerCase();

            if (success && output.includes('on')) {
                this._setColor('#2ecc71'); // green
                this._statusItem.label.text = `${this._server.name}: ON`;
                this._currentState = 'on';
            } else if (success && output.includes('off')) {
                this._setColor('#e74c3c'); // red
                this._statusItem.label.text = `${this._server.name}: OFF`;
                this._currentState = 'off';
            } else {
                this._setColor('orange');
                this._statusItem.label.text = `${this._server.name}: Unknown`;
                this._currentState = 'unknown';
            }
        });
    }

    // Called by the scheduler to apply on/off if needed
    applySchedule(nowHHMM) {
        let sched = this._getSchedule();
        if (!sched.enabled) return;
        if (!sched._lastTriggered) sched._lastTriggered = {};

        if (sched.onTime === nowHHMM && sched._lastTriggered.on !== nowHHMM) {
            sched._lastTriggered.on = nowHHMM;
            sched._lastTriggered.off = null;
            this._powerAction('powerup');
            this._saveSchedules();
            Main.notify('iDRAC Scheduler', `${this._server.name}: scheduled Power On triggered`);
        }

        if (sched.offTime === nowHHMM && sched._lastTriggered.off !== nowHHMM) {
            sched._lastTriggered.off = nowHHMM;
            sched._lastTriggered.on = null;
            this._powerAction('powerdown');
            this._saveSchedules();
            Main.notify('iDRAC Scheduler', `${this._server.name}: scheduled Power Off triggered`);
        }
    }

    destroy() {
        if (this._pollTimeoutId) {
            GLib.source_remove(this._pollTimeoutId);
            this._pollTimeoutId = null;
        }
        super.destroy();
    }
});

// ---------- Extension ----------

export default class IdracStatusExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._schedules = loadSchedules();
        this._indicators = new Map(); // id -> indicator

        this._rebuildIndicators();

        this._settingsChangedId = this._settings.connect('changed::servers', () => {
            this._rebuildIndicators();
        });

        // Scheduler tick - checks every minute
        this._schedTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SCHEDULE_CHECK_INTERVAL, () => {
            let now = GLib.DateTime.new_now_local();
            let hhmm = now.format('%H:%M');
            for (let indicator of this._indicators.values()) {
                indicator.applySchedule(hhmm);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _rebuildIndicators() {
        let servers = loadServers(this._settings);
        let seenIds = new Set();

        for (let server of servers) {
            seenIds.add(server.id);
            let existing = this._indicators.get(server.id);
            if (existing) {
                existing.updateServer(server);
            } else {
                let indicator = new ServerIndicator(
                    server,
                    this._schedules,
                    () => saveSchedules(this._schedules),
                    () => this.openPreferences()
                );
                this._indicators.set(server.id, indicator);
                Main.panel.addToStatusArea(`idrac-status-${server.id}`, indicator);
            }
        }

        // Remove indicators for servers that were deleted in prefs
        for (let [id, indicator] of this._indicators) {
            if (!seenIds.has(id)) {
                indicator.destroy();
                this._indicators.delete(id);
            }
        }
    }

    disable() {
        if (this._schedTimeoutId) {
            GLib.source_remove(this._schedTimeoutId);
            this._schedTimeoutId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        for (let indicator of this._indicators.values()) {
            indicator.destroy();
        }
        this._indicators = null;
        this._schedules = null;
        this._settings = null;
    }
}
