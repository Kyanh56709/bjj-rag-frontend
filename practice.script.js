// ─────────────────────────────────────────────────────────────
// Practice Page — journal entries + Coach Agent
// ─────────────────────────────────────────────────────────────

const token = localStorage.getItem('bjj_token');
if (!token) {
    window.location.href = 'login.html';
}

const API_BASE_URL = (() => {
    const isLocal = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    return isLocal ? 'http://127.0.0.1:5000' : 'https://bjj-rag-library-production.up.railway.app';
})();

const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
});

// ── DOM refs ─────────────────────────────────────────────────
const journalForm    = document.getElementById('journal-form');
const journalInput   = document.getElementById('journal-input');
const journalSubmit  = document.getElementById('journal-submit');
const journalCounter = document.getElementById('journal-counter');
const journalError   = document.getElementById('journal-error');
const entriesList    = document.getElementById('entries-list');
const coachForm      = document.getElementById('coach-form');
const coachInput     = document.getElementById('coach-input');
const coachSubmit    = document.getElementById('coach-submit');
const coachOutput    = document.getElementById('coach-output');
const logoutBtn      = document.getElementById('logout-btn');

const MAX_LEN = 10000;

// ── Logout ────────────────────────────────────────────────────
logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('bjj_token');
    window.location.href = 'login.html';
});

// ── Char counter ──────────────────────────────────────────────
journalInput.addEventListener('input', () => {
    const n = journalInput.value.length;
    journalCounter.textContent = `${n} / ${MAX_LEN}`;
    journalCounter.classList.toggle('warn', n > MAX_LEN * 0.9);
    journalCounter.classList.toggle('over', n > MAX_LEN);
});

// ── Save entry ────────────────────────────────────────────────
journalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    journalError.textContent = '';
    const content = journalInput.value.trim();
    if (!content) {
        journalError.textContent = 'Write something first.';
        return;
    }
    journalSubmit.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/api/practice/log`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ content }),
        });
        if (res.status === 401) { window.location.href = 'login.html'; return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Save failed');
        journalInput.value = '';
        journalCounter.textContent = `0 / ${MAX_LEN}`;
        await loadEntries();
    } catch (err) {
        journalError.textContent = err.message;
    } finally {
        journalSubmit.disabled = false;
    }
});

// ── Load + render entries ─────────────────────────────────────
async function loadEntries() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/practice/logs`, {
            headers: authHeaders(),
        });
        if (res.status === 401) { window.location.href = 'login.html'; return; }
        const data = await res.json();
        renderEntries(data.logs || []);
    } catch (err) {
        entriesList.innerHTML = `<p class="entries-empty">Failed to load: ${escapeHtml(err.message)}</p>`;
    }
}

function renderEntries(logs) {
    if (!logs.length) {
        entriesList.innerHTML = `<p class="entries-empty">No entries yet — your first one is up top.</p>`;
        return;
    }
    entriesList.innerHTML = '';
    for (const log of logs) {
        const el = document.createElement('article');
        el.className = 'entry';
        el.innerHTML = `
            <div class="entry-header">
                <span>${formatDate(log.created_at)}</span>
            </div>
            <div class="entry-content"></div>
            <div class="entry-actions">
                <button type="button" class="entry-action" data-action="coach">
                    <i class="fa-solid fa-stethoscope"></i> Ask Coach about this
                </button>
                <button type="button" class="entry-action danger" data-action="delete">
                    <i class="fa-regular fa-trash-can"></i> Delete
                </button>
            </div>
        `;
        el.querySelector('.entry-content').textContent = log.content;
        el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteEntry(log.id));
        el.querySelector('[data-action="coach"]').addEventListener('click', () => {
            coachInput.value = log.content;
            coachInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            coachInput.focus();
        });
        entriesList.appendChild(el);
    }
}

async function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/practice/log/${id}`, {
            method: 'DELETE',
            headers: authHeaders(),
        });
        if (!res.ok && res.status !== 204) throw new Error('Delete failed');
        await loadEntries();
    } catch (err) {
        alert(err.message);
    }
}

// ── Coach ─────────────────────────────────────────────────────
coachForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = coachInput.value.trim();
    if (!description) return;
    coachSubmit.disabled = true;
    coachOutput.hidden = false;
    coachOutput.innerHTML = `<p class="entries-empty"><i class="fa-solid fa-spinner fa-spin"></i> Diagnosing…</p>`;
    try {
        const res = await fetch(`${API_BASE_URL}/api/coach/analyze`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ description }),
        });
        if (res.status === 401) { window.location.href = 'login.html'; return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Coach failed');
        renderCoachOutput(data);
    } catch (err) {
        coachOutput.innerHTML = `<p class="entries-empty" style="color:var(--crimson,#c41230)">${escapeHtml(err.message)}</p>`;
    } finally {
        coachSubmit.disabled = false;
    }
});

function renderCoachOutput(data) {
    const recs = (data.recommendations || []).filter(r => r.chapter_title);
    const recsHtml = recs.length
        ? `<div class="coach-recs">${recs.map(renderRec).join('')}</div>`
        : `<p class="entries-empty">No matching chapters in the library.</p>`;
    coachOutput.innerHTML = `
        <div class="coach-diagnosis">${escapeHtml(data.diagnosis || '')}</div>
        <h3 class="practice-h2" style="font-size:1.15em;margin-top:18px;">Drill these next</h3>
        ${recsHtml}
    `;
}

function renderRec(r) {
    const params = new URLSearchParams({
        chunk_id: r.chunk_id || '',
        video_file_path: r.video_file_path || '',
        start: r.start_seconds ?? 0,
        chapter_title: r.chapter_title || '',
        instructor: r.instructor || '',
        technique: r.technique || '',
    });
    const href = `index.html?${params.toString()}`;
    const minutes = Math.floor((r.start_seconds || 0) / 60);
    const secs = Math.floor((r.start_seconds || 0) % 60).toString().padStart(2, '0');
    return `
        <a class="coach-rec" href="${href}">
            <span class="coach-rec-title">${escapeHtml(r.chapter_title)}</span>
            <span class="coach-rec-meta">${escapeHtml(r.instructor || 'Unknown')} · ${minutes}:${secs}${r.technique ? ' · ' + escapeHtml(r.technique) : ''}</span>
        </a>
    `;
}

// ── Helpers ───────────────────────────────────────────────────
function formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ── Init ──────────────────────────────────────────────────────
loadEntries();
