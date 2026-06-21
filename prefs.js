import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function loadServers(settings) {
    try {
        let json = settings.get_string('servers');
        let arr = JSON.parse(json);
        if (Array.isArray(arr)) return arr;
    } catch (e) {
        // ignore, return empty
    }
    return [];
}

function saveServers(settings, servers) {
    settings.set_string('servers', JSON.stringify(servers));
}

function makeId() {
    return 'srv_' + Math.random().toString(36).substring(2, 10);
}

function addServerRow(group, server, settings, servers, rows) {
    let row = new Adw.ExpanderRow({
        title: server.name || 'New Server',
        subtitle: `${server.host || ''}:${server.port || ''}`,
    });

    let nameRow = new Adw.EntryRow({ title: 'Display name (shown in top bar)' });
    nameRow.set_text(server.name || '');
    row.add_row(nameRow);

    let hostRow = new Adw.EntryRow({ title: 'IP address / hostname' });
    hostRow.set_text(server.host || '');
    row.add_row(hostRow);

    let portRow = new Adw.EntryRow({ title: 'SSH port' });
    portRow.set_text(String(server.port || 22));
    row.add_row(portRow);

    let userRow = new Adw.EntryRow({ title: 'Username' });
    userRow.set_text(server.user || 'root');
    row.add_row(userRow);

    let passRow = new Adw.PasswordEntryRow({ title: 'Password' });
    passRow.set_text(server.password || '');
    row.add_row(passRow);

    const save = () => {
        server.name = nameRow.get_text();
        server.host = hostRow.get_text();
        server.port = parseInt(portRow.get_text(), 10) || 22;
        server.user = userRow.get_text();
        server.password = passRow.get_text();

        row.title = server.name || 'Unnamed Server';
        row.subtitle = `${server.host}:${server.port}`;

        let idx = servers.findIndex(s => s.id === server.id);
        if (idx !== -1) servers[idx] = server;
        saveServers(settings, servers);
    };

    nameRow.connect('notify::text', save);
    hostRow.connect('notify::text', save);
    portRow.connect('notify::text', save);
    userRow.connect('notify::text', save);
    passRow.connect('notify::text', save);

    let removeBtn = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: 'Remove this server',
    });
    removeBtn.connect('clicked', () => {
        let idx = servers.findIndex(s => s.id === server.id);
        if (idx !== -1) servers.splice(idx, 1);
        saveServers(settings, servers);
        group.remove(row);
        let ridx = rows.indexOf(row);
        if (ridx !== -1) rows.splice(ridx, 1);
    });
    row.add_suffix(removeBtn);

    group.add(row);
    return row;
}

export default class IdracStatusPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = this.getSettings();
        let servers = loadServers(settings);

        let page = new Adw.PreferencesPage({
            title: 'Servers',
            icon_name: 'network-server-symbolic',
        });

        let group = new Adw.PreferencesGroup({
            title: 'iDRAC Servers',
            description: 'Add the servers to monitor and control. Changes save automatically and apply within ~30 seconds.',
        });
        page.add(group);

        let rows = [];
        for (let server of servers) {
            rows.push(addServerRow(group, server, settings, servers, rows));
        }

        let addButton = new Gtk.Button({
            label: 'Add Server',
            margin_top: 12,
            halign: Gtk.Align.START,
            css_classes: ['suggested-action'],
        });
        addButton.connect('clicked', () => {
            let newServer = {
                id: makeId(),
                name: 'New Server',
                host: '',
                port: 22,
                user: 'root',
                password: '',
            };
            servers.push(newServer);
            saveServers(settings, servers);
            let row = addServerRow(group, newServer, settings, servers, rows);
            rows.push(row);
            row.set_expanded(true);
        });

        let buttonGroup = new Adw.PreferencesGroup();
        buttonGroup.add(addButton);
        page.add(buttonGroup);

        window.add(page);
        window.set_default_size(640, 600);
    }
}
