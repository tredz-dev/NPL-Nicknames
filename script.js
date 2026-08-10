const CONFIG = {
    APP_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzetAmaEqN_WGjygU0iQz28dlELtGkNDCqJqD6ni7Aq6zqFb1QPIz9uskNJYNwSzNKIMg/exec', // web app Apps Script URL
};


let allData = [];
let currentWeekFilter = 'all';
const MAX_WEEKS = 52;

// DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const mainContent = $('#mainContent');
const weekFilter = $('#weekFilter');
const clearFilterBtn = $('#clearFilterBtn');
const recordCount = $('#recordCount');
const weekSelect = $('#weekSelect');
const replayUrl = $('#replayUrl');
const submitBtn = $('#submitBtn');
const resetFormBtn = $('#resetFormBtn');
const statusMsg = $('#statusMsg');
const warningBox = $('#warningBox');
const warningWeek = $('#warningWeek');
const confirmOverwriteBtn = $('#confirmOverwriteBtn');
const sheetStatus = $('#sheetStatus');
const refreshBtn = $('#refreshBtn');

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getPokemonKey(name) {
    // Take everything before the first comma (base name)
    return name.split(',')[0].trim();
}


async function fetchSheetData() {
    const url = CONFIG.APP_SCRIPT_URL;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Read error');
    return json.data;
}


async function writeToSheet(rows) {
    const url = CONFIG.APP_SCRIPT_URL;
    const payload = { rows };
    const payloadStr = JSON.stringify(payload);
    const formData = new URLSearchParams();
    formData.append('payload', payloadStr);

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Write failed');
    return json;
}


function parseReplayLog(logText) {
    const lines = logText.split('\n');
    let p1Name = '', p2Name = '';
    const pokeMap = { p1: [], p2: [] };
    const nickMap = { p1: {}, p2: {} };

    for (const line of lines) {
        // player lines
        const playerMatch = line.match(/^\|player\|(p[12])\|([^|]+)\|/);
        if (playerMatch) {
            const pid = playerMatch[1];
            const name = playerMatch[2].trim();
            if (pid === 'p1') p1Name = name;
            else if (pid === 'p2') p2Name = name;
            continue;
        }

        // mon list, capture everything after third pipe, then strip trailing pipes
        const pokeMatch = line.match(/^\|poke\|(p[12])\|(.+)$/);
        if (pokeMatch) {
            const pid = pokeMatch[1];
            let raw = pokeMatch[2].trim();
            // remove trailing '|' if present 
            raw = raw.replace(/\|+$/, '');
            const clean = getPokemonKey(raw);
            pokeMap[pid].push(clean);
            continue;
        }

        // grab nicknames from switch lines
        const switchMatch = line.match(/^\|switch\|(p[12])a:\s*([^|]*)\|([^|]+)\|/);
        if (switchMatch) {
            const pid = switchMatch[1];
            const nickname = switchMatch[2].trim();
            let pokeRaw = switchMatch[3].trim();
            pokeRaw = pokeRaw.replace(/\|+$/, '');
            if (nickname) {
                const clean = getPokemonKey(pokeRaw);
                nickMap[pid][clean] = nickname;
            }
            continue;
        }
    }

    console.log('Parsed players:', p1Name, p2Name);
    console.log('PokeMap:', pokeMap);
    console.log('NickMap:', nickMap);

    if (!p1Name || !p2Name) {
        console.warn('⚠️ Player names not found. First 10 lines of log:');
        console.log(lines.slice(0, 10).join('\n'));
    }

    const players = [
        { id: 'p1', name: p1Name || 'Unknown1' },
        { id: 'p2', name: p2Name || 'Unknown2' }
    ];

    const rows = [];
    for (const pl of players) {
        const pokes = pokeMap[pl.id] || [];
        const nicks = nickMap[pl.id] || {};
        const row = {
            team: pl.name,
            opponent: pl.id === 'p1' ? p2Name : p1Name,
            pokemon: [],
            nicknames: [],
        };
        const list = [...pokes];
        while (list.length < 6) list.push('');
        for (let i = 0; i < 6; i++) {
            const poke = list[i] || '';
            row.pokemon.push(poke);
            row.nicknames.push(poke ? (nicks[poke] || 'None') : '');
        }
        rows.push(row);
    }

    return {
        p1: rows[0],
        p2: rows[1],
        p1Name,
        p2Name,
    };
}


function rowsToObjects(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const result = [];

    const idx = (name) => headers.indexOf(name);
    const teamIdx = idx('Team');
    const weekIdx = idx('Week');
    const oppIdx = idx('Opponent');
    const pIdx = [1,2,3,4,5,6].map(i => idx(`P${i}`));
    const nIdx = [1,2,3,4,5,6].map(i => idx(`N${i}`));
    const notesIdx = idx('Notes');

    for (const row of dataRows) {
        if (!row || row.length === 0) continue;
        const team = teamIdx >= 0 && teamIdx < row.length ? row[teamIdx] : '';
        if (!team) continue;
        const week = weekIdx >= 0 && weekIdx < row.length ? parseInt(row[weekIdx], 10) : 0;
        const opponent = oppIdx >= 0 && oppIdx < row.length ? row[oppIdx] : '';
        const pokemon = pIdx.map(i => (i >= 0 && i < row.length ? row[i] || '' : ''));
        const nicknames = nIdx.map(i => (i >= 0 && i < row.length ? row[i] || '' : ''));
        const notes = notesIdx >= 0 && notesIdx < row.length ? row[notesIdx] || '' : '';

        result.push({
            team: team.trim(),
            week: week,
            opponent: opponent.trim(),
            pokemon: pokemon.map(s => s.trim()),
            nicknames: nicknames.map(s => s.trim()),
            notes: notes.trim(),
        });
    }
    return result;
}

function objectsToRows(objs) {
    const headers = ['Team', 'Week', 'Opponent',
        'P1','N1','P2','N2','P3','N3','P4','N4','P5','N5','P6','N6','Notes'];
    const rows = [headers];

    for (const obj of objs) {
        const pokes = obj.pokemon || [];
        const nicks = obj.nicknames || [];
        const row = [
            obj.team || '',
            obj.week || 0,
            obj.opponent || '',
        ];
        for (let i = 0; i < 6; i++) {
            row.push(pokes[i] || '');
            row.push(nicks[i] || '');
        }
        row.push(obj.notes || '');
        rows.push(row);
    }
    return rows;
}


function renderTeamCard(item) {
    const pokes = item.pokemon.slice(0, 6);
    const nicks = item.nicknames.slice(0, 6);
    while (pokes.length < 6) pokes.push('');
    while (nicks.length < 6) nicks.push('');

    let gridHtml = '';
    for (let i = 0; i < 6; i++) {
        const poke = pokes[i] || '';
        const nick = nicks[i] || '';
        const noneClass = !nick || nick === 'None' ? 'none' : '';
        gridHtml += `
            <div class="entry">
                <span class="pname">${escapeHtml(poke || '—')}</span>
                <span class="nname ${noneClass}">${escapeHtml(nick || 'None')}</span>
            </div>
        `;
    }

    const notesHtml = item.notes ? `<div class="notes">📝 ${escapeHtml(item.notes)}</div>` : '';

    return `
        <div class="team-card">
            <div class="card-header">
                <span class="team-name">${escapeHtml(item.team)}</span>
            </div>
            <div class="pokemon-grid">${gridHtml}</div>
            ${notesHtml}
        </div>
    `;
}


function renderSpreadsheet(data, weekFilterVal) {
    const filtered = weekFilterVal === 'all'
        ? data
        : data.filter(d => d.week === parseInt(weekFilterVal, 10));

    recordCount.textContent = `${filtered.length} entries`;

    if (filtered.length === 0) {
        mainContent.innerHTML = `
            <div class="empty-state">
                <span class="emoji">📭</span>
                <p>No entries found${weekFilterVal !== 'all' ? ` for Week ${weekFilterVal}` : ''}.</p>
            </div>
        `;
        return;
    }

    const weeksMap = {};
    for (const row of filtered) {
        if (!weeksMap[row.week]) weeksMap[row.week] = [];
        weeksMap[row.week].push(row);
    }
    const sortedWeeks = Object.keys(weeksMap).sort((a, b) => a - b);

    let html = '';
    for (const week of sortedWeeks) {
        const rows = weeksMap[week];
        const matches = {};
        for (const row of rows) {
            const key = [row.team, row.opponent].sort().join('||');
            if (!matches[key]) matches[key] = [];
            matches[key].push(row);
        }

        html += `<div class="week-block">`;
        html += `<h3 class="week-title">Week ${week}</h3>`;

        for (const matchKey in matches) {
            const matchRows = matches[matchKey];
            matchRows.sort((a, b) => a.team.localeCompare(b.team));

            html += `<div class="match-row">`;
            html += renderTeamCard(matchRows[0]);
            html += `<div class="vs-separator">vs</div>`;
            html += renderTeamCard(matchRows[1]);
            html += `</div>`;
        }
        html += `</div>`;
    }

    mainContent.innerHTML = html;
}


function populateWeekSelects() {
    const selects = [weekFilter, weekSelect];
    for (const sel of selects) {
        const current = sel.value;
        sel.innerHTML = '';
        if (sel === weekFilter) {
            const opt = document.createElement('option');
            opt.value = 'all';
            opt.textContent = 'All Weeks';
            sel.appendChild(opt);
        } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '— Select Week —';
            sel.appendChild(opt);
        }
        for (let w = 1; w <= MAX_WEEKS; w++) {
            const opt = document.createElement('option');
            opt.value = w;
            opt.textContent = `Week ${w}`;
            sel.appendChild(opt);
        }
        if (current) sel.value = current;
    }
}


async function loadData() {
    sheetStatus.textContent = '⏳ loading…';
    sheetStatus.className = 'status loading';

    try {
        const raw = await fetchSheetData();
        if (!raw || raw.length < 2) {
            allData = [];
            sheetStatus.textContent = '✅ Sheet loaded (empty)';
            sheetStatus.className = 'status';
            renderSpreadsheet(allData, currentWeekFilter);
            return;
        }
        allData = rowsToObjects(raw);
        sheetStatus.textContent = `✅ ${allData.length} entries loaded`;
        sheetStatus.className = 'status';
        renderSpreadsheet(allData, currentWeekFilter);
    } catch (err) {
        console.error(err);
        sheetStatus.textContent = `❌ ${err.message.slice(0, 80)}`;
        sheetStatus.className = 'status error';
        allData = [];
        renderSpreadsheet(allData, currentWeekFilter);
    }
}


function playerExistsForWeek(weekNum, playerName) {
    return allData.some(d => d.week === weekNum && d.team === playerName);
}


async function submitReplay(weekNum, url, forceOverwrite = false) {
    const status = statusMsg;
    status.className = 'status-msg loading';
    status.textContent = '⏳ Fetching replay log…';
    status.style.display = 'block';

    try {
        let logUrl = url.trim();
        if (!logUrl.endsWith('.log')) {
            if (logUrl.endsWith('/')) logUrl = logUrl.slice(0, -1);
            logUrl += '.log';
        }
        const resp = await fetch(logUrl);
        if (!resp.ok) throw new Error(`Failed to fetch log (${resp.status})`);
        const logText = await resp.text();

        status.textContent = '🔄 Parsing replay…';
        const parsed = parseReplayLog(logText);
        if (!parsed.p1Name || !parsed.p2Name) {
            throw new Error('Could not find player names in the log.');
        }

        const p1Name = parsed.p1Name;
        const p2Name = parsed.p2Name;

        if (!parsed.p1Name || !parsed.p2Name) {
            console.error('Parsed names:', parsed.p1Name, parsed.p2Name);
            throw new Error('Could not find player names in the log. Check console for details.');
        }

        // check for already uploaded replay for that player that week
        const p1Exists = playerExistsForWeek(weekNum, p1Name);
        const p2Exists = playerExistsForWeek(weekNum, p2Name);

        if ((p1Exists || p2Exists) && !forceOverwrite) {
            warningWeek.textContent = weekNum;
            warningBox.classList.add('show');
            status.style.display = 'none';
            window._pendingSubmit = { weekNum, url, parsed };
            return;
        }

        const p1 = parsed.p1;
        const p2 = parsed.p2;
        const newRows = [];
        for (const [teamData, opponentName] of [
            [p1, p2.team],
            [p2, p1.team]
        ]) {
            const row = {
                team: teamData.team || (teamData === p1 ? parsed.p1Name : parsed.p2Name),
                week: weekNum,
                opponent: opponentName || (teamData === p1 ? parsed.p2Name : parsed.p1Name),
                pokemon: teamData.pokemon.slice(0, 6),
                nicknames: teamData.nicknames.slice(0, 6),
                notes: '',
            };
            while (row.pokemon.length < 6) row.pokemon.push('');
            while (row.nicknames.length < 6) row.nicknames.push('');
            newRows.push(row);
        }

        // overwrite rows for this week that belong to either player
        const filteredAll = allData.filter(d =>
            !(d.week === weekNum && (d.team === p1Name || d.team === p2Name))
        );
        const merged = [...filteredAll, ...newRows];

        status.textContent = '📤 Uploading to Google Sheets…';
        const sheetRows = objectsToRows(merged);
        await writeToSheet(sheetRows);

        allData = merged;
        renderSpreadsheet(allData, currentWeekFilter);
        status.className = 'status-msg success';
        status.textContent = `✅ Success! Uploaded Week ${weekNum} for ${parsed.p1Name} vs ${parsed.p2Name}.`;
        warningBox.classList.remove('show');

        replayUrl.value = '';
        weekSelect.value = '';
        window._pendingSubmit = null;

    } catch (err) {
        console.error(err);
        status.className = 'status-msg error';
        status.textContent = `❌ ${err.message}`;
        warningBox.classList.remove('show');
    }
}


const tabs = document.querySelectorAll('[data-tab]');
tabs.forEach(btn => {
    btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const panelId = btn.dataset.tab === 'main' ? 'panelMain' : 'panelSubmit';
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(panelId).classList.add('active');
        if (panelId === 'panelMain') {
            renderSpreadsheet(allData, currentWeekFilter);
        }
    });
});

weekFilter.addEventListener('change', () => {
    currentWeekFilter = weekFilter.value;
    renderSpreadsheet(allData, currentWeekFilter);
});

clearFilterBtn.addEventListener('click', () => {
    weekFilter.value = 'all';
    currentWeekFilter = 'all';
    renderSpreadsheet(allData, currentWeekFilter);
});

refreshBtn.addEventListener('click', loadData);

submitBtn.addEventListener('click', async () => {
    const week = parseInt(weekSelect.value, 10);
    const url = replayUrl.value.trim();

    if (!week || isNaN(week)) {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = '⚠️ Please select a valid Week.';
        statusMsg.style.display = 'block';
        return;
    }
    if (!url) {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = '⚠️ Please enter a replay URL.';
        statusMsg.style.display = 'block';
        return;
    }
    if (!url.includes('replay.pokemonshowdown.com')) {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = '⚠️ Please enter a valid PokéShowdown replay URL.';
        statusMsg.style.display = 'block';
        return;
    }

    await submitReplay(week, url, false);
});

confirmOverwriteBtn.addEventListener('click', async () => {
    const pending = window._pendingSubmit;
    if (!pending) return;
    warningBox.classList.remove('show');
    await submitReplay(pending.weekNum, pending.url, true);
});

resetFormBtn.addEventListener('click', () => {
    replayUrl.value = '';
    weekSelect.value = '';
    statusMsg.style.display = 'none';
    statusMsg.className = 'status-msg';
    warningBox.classList.remove('show');
    window._pendingSubmit = null;
});


populateWeekSelects();
loadData();

console.log('✅ PokéNickname Tracker loaded.');
console.log(`📝 Apps Script URL: ${CONFIG.APP_SCRIPT_URL || '(not set)'}`);