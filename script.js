// ======================================
//  BJJ GRAPHRAG — Main Application Script
// ======================================

const token = localStorage.getItem('bjj_token');

const appContainer = document.getElementById('app');
if (appContainer) appContainer.style.visibility = 'visible';

if (!token && window.location.pathname !== '/login.html') {
    console.warn("No auth token. Auth features limited.");
}

const getApiUrl = (endpoint) => {
    const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    const base = isLocal ? 'http://127.0.0.1:5000' : 'https://bjj-rag-library-production.up.railway.app';
    return `${base}${endpoint}`;
};

// If the backend says our token is bad/expired, drop it and send the user to login.
// Returns true when it handled the response (caller should stop processing).
function handleAuthFailure(res) {
    if (res.status !== 401) return false;
    localStorage.removeItem('bjj_token');
    localStorage.removeItem('bjj_username');
    if (!window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
    }
    return true;
}

// ── DOM REFS ──────────────────────────────────────────────────────────────────

const videoStage       = document.getElementById('video-stage');
const currentTitle     = document.getElementById('current-title');
const currentInstructor = document.getElementById('current-instructor');
const nowPlayingBar    = document.getElementById('now-playing-bar');
const videoList        = document.getElementById('video-list');
const resultCount      = document.getElementById('result-count');
const searchForm       = document.getElementById('search-form');
const searchInput      = document.getElementById('global-search');
const chatForm         = document.getElementById('chat-form');
const userInput        = document.getElementById('user-input');
const chatBox          = document.getElementById('chat-box');
const chatPanel        = document.getElementById('chat-panel');
const mascotBtn        = document.getElementById('mascot-btn');
const chatCloseBtn     = document.getElementById('chat-close-btn');
const logoutBtn        = document.getElementById('logout-btn');
const graphFitBtn      = document.getElementById('graph-fit-btn');
const graphClearBtn    = document.getElementById('graph-clear-btn');
const expandGraphBtn   = document.getElementById('expand-graph-btn');
const nodePopup        = document.getElementById('node-popup');
const nodePopupClose   = document.getElementById('node-popup-close');
const nodePopupBadge   = document.getElementById('node-popup-badge');
const nodePopupName    = document.getElementById('node-popup-name');
const nodePopupBody    = document.getElementById('node-popup-body');
const nodeSearchBtn    = document.getElementById('node-search-btn');
const nodeExpandBtn    = document.getElementById('node-expand-btn');
const nodeCountBadge   = document.getElementById('graph-node-count');
const graphEmpty       = document.getElementById('graph-empty');
const tatamiHero       = document.getElementById('tatami-hero');
const playerWrapper    = document.getElementById('video-player-wrapper');
const heroChips        = document.getElementById('hero-chips');

// ── STATE ─────────────────────────────────────────────────────────────────────

let currentVideoData   = null;
let activeCardElement  = null;
let selectedNodeId     = null;
let lastSearchQuery    = '';
let lastSearchVideos   = [];
let activeFilter       = 'all'; // 'all' | 'instructional' | 'mentioned'
let activeInstructor   = null;  // when set, video list is reduced to this instructor

// Graph state — nodes/links stored as Maps for dedup
const graphState = {
    nodes: new Map(),
    links: new Map(),
    simulation: null,
    svg: null,
    g: null,
    zoom: null,
    nodeEls: null,
    linkEls: null,
    labelEls: null,
};

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────

searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) handleSearch(q);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = userInput.value.trim();
    if (!q) return;
    addChatMessage(q, 'user-message');
    showTypingIndicator();
    askAgent(q);
    userInput.value = '';
});

// Persistent intro peek next to the mascot — dismissable, remembered per-browser.
const mascotPeek      = document.getElementById('mascot-peek');
const mascotPeekClose = document.getElementById('mascot-peek-close');
const PEEK_DISMISSED_KEY = 'bjj_mascot_peek_dismissed';

function dismissMascotPeek() {
    if (!mascotPeek || mascotPeek.classList.contains('is-dismissed')) return;
    mascotPeek.classList.add('is-dismissed');
    try { localStorage.setItem(PEEK_DISMISSED_KEY, '1'); } catch (_) {}
}

if (mascotPeek && localStorage.getItem(PEEK_DISMISSED_KEY) === '1') {
    mascotPeek.style.display = 'none';
}
mascotPeekClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissMascotPeek();
});

mascotBtn.addEventListener('click', () => {
    const isOpen = chatPanel.dataset.open === 'true';
    chatPanel.dataset.open = isOpen ? 'false' : 'true';
    chatPanel.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    // Once the user opens the chat, the peek has done its job.
    if (!isOpen) dismissMascotPeek();
    // Pulse animation reset
    mascotBtn.querySelectorAll('.mascot-ring').forEach(r => {
        r.style.animation = 'none';
        setTimeout(() => r.style.animation = '', 10);
    });
});

chatCloseBtn.addEventListener('click', () => {
    chatPanel.dataset.open = 'false';
    chatPanel.setAttribute('aria-hidden', 'true');
});

logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('bjj_token');
    window.location.href = 'login.html';
});

heroChips?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hero-chip');
    if (!btn) return;
    const q = btn.dataset.q;
    searchInput.value = q;
    handleSearch(q);
});

graphClearBtn.addEventListener('click', clearGraph);
graphFitBtn.addEventListener('click', fitGraphToView);
expandGraphBtn?.addEventListener('click', () => {
    if (currentVideoData?.technique) loadGraphForTechnique(currentVideoData.technique);
});

nodePopupClose.addEventListener('click', closeNodePopup);
nodeSearchBtn.addEventListener('click', () => {
    const id = selectedNodeId;
    if (!id) return;
    closeNodePopup();
    searchInput.value = id;
    handleSearch(id);
});
nodeExpandBtn.addEventListener('click', () => {
    const id = selectedNodeId;
    if (!id) return;
    loadGraphForTechnique(id);
    closeNodePopup();
});

// Close popup on click outside
document.addEventListener('click', (e) => {
    if (nodePopup.style.display !== 'none' &&
        !nodePopup.contains(e.target) &&
        !e.target.closest('.graph-node')) {
        closeNodePopup();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const video = videoStage.querySelector('video');
    if (!video) return;
    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            video.paused ? video.play() : video.pause();
            break;
        case 'arrowright': video.currentTime += 5; break;
        case 'arrowleft':  video.currentTime -= 5; break;
        case 'f':
            if (video.requestFullscreen) video.requestFullscreen();
            else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
            break;
    }
});

// ── API CALLS ─────────────────────────────────────────────────────────────────

function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (token && token !== 'null') h['Authorization'] = `Bearer ${token}`;
    return h;
}

async function handleSearch(query) {
    lastSearchQuery = query;
    activeInstructor = null;            // a fresh query clears any instructor filter
    videoList.innerHTML = `<div class="loading-spin"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>`;
    resultCount.classList.remove('visible');

    // Once a search runs, the home-screen hero gets out of the way.
    // The Search Stage takes over until the user plays a video.
    if (tatamiHero) tatamiHero.style.display = 'none';
    showSearchStage(query, null);

    try {
        const res = await fetch(getApiUrl('/api/search'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ query }),
        });
        if (handleAuthFailure(res)) return;
        if (!res.ok) {
            const body = await res.text();
            console.error('[/api/search]', res.status, body);
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = await res.json();
        const videos = data.videos || [];
        lastSearchVideos = videos.map(v => ({ ...v, _category: classifyVideo(v, query) }));
        renderVideoList();
        // Build graph from search results
        buildGraphFromVideos(videos);
        // Refresh stage with concrete result data
        showSearchStage(query, lastSearchVideos);
        // Update the browse rail with newly-known instructors + persist the query
        pushRecent(query);
        renderRailInstructors();
    } catch (e) {
        videoList.innerHTML = `<div class="empty-state-fancy" style="color:var(--crimson)"><i class="fa-solid fa-triangle-exclamation"></i><p>Search error: ${e.message}</p></div>`;
    }
}

// ── SEARCH STAGE ─────────────────────────────────────────────────────────────
// Replaces the hero in the right column once a search has happened but the
// user hasn't started a video yet. Echoes the query, shows the instructional /
// mention split, and surfaces top instructors so the column has presence.

const searchStageEl = document.getElementById('search-stage');

function showSearchStage(query, videos) {
    if (!searchStageEl) return;
    if (currentVideoData) return; // a video is playing; stage stays hidden

    const q = (query || '').trim() || '—';
    const total = Array.isArray(videos) ? videos.length : null;
    const inst  = Array.isArray(videos) ? videos.filter(v => v._category === 'instructional').length : null;
    const ment  = Array.isArray(videos) ? videos.filter(v => v._category === 'mentioned').length : null;

    // Top 3 instructors by frequency
    const counts = new Map();
    if (Array.isArray(videos)) {
        for (const v of videos) {
            const name = v.instructor || 'Unknown';
            counts.set(name, (counts.get(name) || 0) + 1);
        }
    }
    const topInstructors = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    const totalText = total === null ? '— SEARCHING' : `${String(total).padStart(2, '0')} RESULTS`;
    const instLine  = inst === null ? '· · ·' : `${inst} instructional${inst === 1 ? '' : 's'}`;
    const mentLine  = ment === null ? '· · ·' : `${ment} mention${ment === 1 ? '' : 's'}`;

    const instructorChips = topInstructors.length
        ? topInstructors.map(([n, c]) => `
            <span class="stage-instructor">
                <span class="stage-instructor-name">${escapeHtml(n)}</span>
                <span class="stage-instructor-count">×${c}</span>
            </span>`).join('')
        : `<span class="stage-instructor stage-instructor-empty">awaiting&nbsp;data</span>`;

    searchStageEl.innerHTML = `
        <div class="stage-grid"></div>
        <div class="stage-noise"></div>

        <div class="stage-corner stage-corner-tl">
            <span class="corner-mark">+</span>
            <span class="corner-text">N° 002 — QUERY</span>
        </div>
        <div class="stage-corner stage-corner-br">
            <span class="corner-text">${totalText}</span>
            <span class="corner-mark">+</span>
        </div>

        <div class="stage-body">
            <div class="stage-eyebrow">
                <span class="stage-dot"></span>
                <span>You searched</span>
                <span class="stage-eyebrow-rule"></span>
                <span class="stage-eyebrow-jp">検索結果</span>
            </div>

            <h2 class="stage-query">
                <span class="stage-quote stage-quote-l">“</span><span class="stage-query-text">${escapeHtml(q)}</span><span class="stage-quote stage-quote-r">”</span>
            </h2>

            <div class="stage-stats">
                <div class="stage-stat">
                    <span class="stage-stat-num">${inst === null ? '—' : inst}</span>
                    <span class="stage-stat-label">${instLine}</span>
                </div>
                <div class="stage-stat-rule"></div>
                <div class="stage-stat">
                    <span class="stage-stat-num">${ment === null ? '—' : ment}</span>
                    <span class="stage-stat-label">${mentLine}</span>
                </div>
            </div>

            <div class="stage-instructors-row">
                <span class="stage-instructors-label">Top instructors</span>
                <div class="stage-instructors">${instructorChips}</div>
            </div>

            <div class="stage-hint">
                <i class="fa-solid fa-arrow-left"></i>
                <span>Pick a chapter from the library on the left to begin</span>
            </div>
        </div>
    `;
    searchStageEl.style.display = 'block';
}

function hideSearchStage() {
    if (searchStageEl) searchStageEl.style.display = 'none';
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// Extract the course slug from a chunk (e.g. "lachlan-giles-k-guard" from
// "/videos/lachlan-giles-k-guard-vol-01.mp4" or "lachlan-giles-k-guard-vol-01-chap-05").
function courseSlug(v) {
    const path = v.video_file_path || v.video_file || '';
    const id   = v.chunk_id || '';
    let raw = path.split('/').pop() || id;
    return raw
        .replace(/\.mp4$/i, '')
        .replace(/-vol-\d+(?:-chap-\d+)?$/i, '')
        .toLowerCase();
}

// Normalize a query / slug fragment so "K-Guard", "k guard", "kguard" all match.
function normalizeForMatch(s) {
    return (s || '').toLowerCase().replace(/[\s\-_.]+/g, '');
}

// Split results into "instructional" (the COURSE itself teaches the queried thing)
// vs "mentioned" (the topic appears in a chapter of an unrelated course).
// The signal is the course slug — it represents the identity of the whole video.
// e.g. searching "k guard":
//   slug = "lachlan-giles-k-guard"      → instructional ✓
//   slug = "craig-jones-closet-closed-guard" → mentioned (chapter references K-Guard)
function classifyVideo(v, query) {
    const q = (query || '').trim();
    if (!q) return 'instructional';

    const slugN = normalizeForMatch(courseSlug(v));
    const qN    = normalizeForMatch(q);

    // Whole-phrase match in the slug → the course is about this topic.
    if (qN && slugN.includes(qN)) return 'instructional';

    // Multi-word queries: every meaningful word must land in the slug.
    const words = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (words.length >= 2) {
        const allHit = words.every(w => slugN.includes(normalizeForMatch(w)));
        if (allHit) return 'instructional';
    }

    return 'mentioned';
}

async function askAgent(query) {
    try {
        const res = await fetch(getApiUrl('/api/ask'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ query }),
        });
        if (handleAuthFailure(res)) return;
        if (!res.ok) {
            const body = await res.text();
            console.error('[/api/ask]', res.status, body);
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = await res.json();
        removeTypingIndicator();
        const formatted = (data.answer || '').replace(/\n/g, '<br>');
        addChatMessage(formatted, 'bot-message', data.sources || []);
    } catch (e) {
        removeTypingIndicator();
        addChatMessage(`Connection error: ${e.message}`, 'bot-message');
    }
}

async function loadGraphForTechnique(techniqueId) {
    try {
        const res = await fetch(getApiUrl(`/api/graph/explore?technique=${encodeURIComponent(techniqueId)}`));
        if (!res.ok) return;
        const data = await res.json();
        const { target, related_techniques } = data;

        // Add the queried technique as a node
        addGraphNode(target, 'Technique');

        (related_techniques || []).forEach(rn => {
            addGraphNode(rn.id, rn.type);
            addGraphLink(target, rn.id);
        });

        updateGraph();
    } catch (e) {
        console.warn('Graph explore failed:', e.message);
    }
}

async function loadChaptersForNode(techniqueId) {
    try {
        const res = await fetch(getApiUrl(`/api/graph/chapters?technique=${encodeURIComponent(techniqueId)}`));
        if (!res.ok) return [];
        const data = await res.json();
        return data.chapters || [];
    } catch {
        return [];
    }
}

// ── PROGRESSIVE GRAPH BUILDING ────────────────────────────────────────────────

function buildGraphFromVideos(videos) {
    if (!videos.length) return;

    // Collect unique techniques from search results
    const techniques = [...new Set(videos.map(v => v.technique).filter(Boolean))];
    techniques.forEach(t => addGraphNode(t, 'Technique'));
    updateGraph();

    // Fetch relations for each technique (limited to avoid spam)
    techniques.slice(0, 6).forEach(t => loadGraphForTechnique(t));
}

// ── VIDEO LIST RENDERING (YouTube-style) ──────────────────────────────────────

// Deterministic gradient from a string hash
function stringToGradient(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 60%, 18%), hsl(${h2}, 50%, 12%))`;
}

function formatTime(seconds) {
    if (!seconds && seconds !== 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function thumbnailUrlFor(v) {
    const srcPath = v.video_file_path || v.video_file || '';
    // Cloudflare Stream iframe: skip preview thumbnail (cross-origin restrictions),
    // we'll use gradient fallback only.
    if (srcPath.includes('videodelivery.net') || srcPath.includes('cloudflarestream.com')) return null;
    const r2Base = 'https://pub-ee3b210f46814c0a94774fac09e25e1a.r2.dev';
    const fileName = srcPath.split('/').pop();
    if (!fileName) return null;
    const start = (v.start_seconds ?? v.start ?? 0);
    // Offset a few seconds into the chapter so the frame is informative, not a black frame.
    const t = Math.max(1, Math.floor(start) + 2);
    return `${r2Base}/${fileName}#t=${t}`;
}

// Apply the active instructor filter (if any) to the search results.
function getFilteredVideos() {
    if (!activeInstructor) return lastSearchVideos;
    return lastSearchVideos.filter(v => (v.instructor || '').toLowerCase() === activeInstructor.toLowerCase());
}

function updateTabCounts() {
    const pool = getFilteredVideos();
    const all = pool.length;
    const instr = pool.filter(v => v._category === 'instructional').length;
    const ment = pool.filter(v => v._category === 'mentioned').length;
    document.querySelector('.tab-count[data-count="all"]').textContent = all;
    document.querySelector('.tab-count[data-count="instructional"]').textContent = instr;
    document.querySelector('.tab-count[data-count="mentioned"]').textContent = ment;
}

// Build a flat video card (used for "Mentions")
function buildVideoCard(v) {
    const card = document.createElement('div');
    card.className = 'video-card';
    if (v._category === 'instructional') card.classList.add('cat-instructional');
    else card.classList.add('cat-mentioned');

    const gradient = stringToGradient((v.chapter_title || '') + (v.instructor || ''));
    const timeStr  = formatTime(v.start_seconds);
    const thumbUrl = thumbnailUrlFor(v);
    const catLabel = v._category === 'instructional' ? 'Instructional' : 'Mentioned';
    const catIcon = v._category === 'instructional' ? 'fa-graduation-cap' : 'fa-quote-right';

    card.innerHTML = `
        <div class="video-thumb" style="background: ${gradient};">
            ${thumbUrl ? `<video class="thumb-frame" preload="metadata" muted playsinline disablepictureinpicture src="${thumbUrl}"></video>` : ''}
            <div class="video-thumb-overlay"></div>
            <div class="video-thumb-cat"><i class="fa-solid ${catIcon}"></i> ${catLabel}</div>
            <div class="video-thumb-play"><i class="fa-solid fa-play"></i></div>
            <div class="video-thumb-time">${timeStr}</div>
        </div>
        <div class="video-card-info">
            <div class="video-card-title">${v.chapter_title || 'Untitled Chapter'}</div>
            <div class="video-card-meta">
                <span>${v.instructor || 'Unknown'}</span>
                ${v.technique ? `<span class="sep">·</span><span class="video-card-technique">${v.technique}</span>` : ''}
            </div>
        </div>
    `;

    const thumbEl = card.querySelector('.thumb-frame');
    if (thumbEl) thumbEl.addEventListener('error', () => thumbEl.style.display = 'none');

    card.addEventListener('click', () => {
        playVideo(v);
        if (activeCardElement) activeCardElement.classList.remove('active');
        card.classList.add('active');
        activeCardElement = card;
    });

    return card;
}

// Parse volume + chapter numbers from a chunk's identifier.
// chunk_id format: "{slug}-vol-{NN}-chap-{NN}"
// fallback: video_file_path "/videos/{slug}-vol-{NN}.mp4"
function parseVolChap(v) {
    const id   = v.chunk_id || '';
    const path = v.video_file_path || v.video_file || '';
    let vol = null, chap = null;

    const m1 = id.match(/-vol-(\d+)-chap-(\d+)/i);
    if (m1) { vol = parseInt(m1[1], 10); chap = parseInt(m1[2], 10); }

    if (vol === null) {
        const m2 = (id || path).match(/-vol-(\d+)/i);
        if (m2) vol = parseInt(m2[1], 10);
    }
    if (chap === null) {
        const m3 = id.match(/-chap-(\d+)/i);
        if (m3) chap = parseInt(m3[1], 10);
    }
    return { vol, chap };
}

// Strip "Vol N" suffix from a video_title to get the course base name.
function courseBaseTitle(v) {
    const t = v.video_title || '';
    return t.replace(/\s*[-–·]?\s*vol(?:ume)?\.?\s*\d+\s*$/i, '').trim() || t;
}

// Group instructional chapters by VIDEO FILE (one mp4 = one volume = one card).
// Previously we grouped by (instructor, course), which collapsed every volume of
// a course into a single card — so a search like "K-Guard" hitting Vol 1, Vol 2,
// and Vol 3 of Lachlan's K-Guard course rendered as just ONE result. Each volume
// is its own playable file, so each volume should be its own card.
function buildSeriesGroups(videos) {
    const groups = new Map();
    videos.forEach(v => {
        const instructor = v.instructor || 'Unknown Instructor';
        const course     = courseBaseTitle(v) || 'Untitled Course';
        const { vol }    = parseVolChap(v);
        // Group key is the actual mp4 path when available — that is the unit the
        // user thinks of as "a video". Falls back to (instructor + course + vol).
        const key = (v.video_file_path || v.video_file || `${instructor}:::${course}:::vol-${vol ?? '?'}`);
        if (!groups.has(key)) groups.set(key, { instructor, course, vol, parts: [] });
        groups.get(key).parts.push(v);
    });

    // Order cards by (instructor, course, vol) so multi-volume runs stay together.
    const ordered = [...groups.entries()].sort(([, a], [, b]) => {
        return (a.instructor || '').localeCompare(b.instructor || '')
            || (a.course || '').localeCompare(b.course || '')
            || ((a.vol ?? 99) - (b.vol ?? 99));
    });

    const frag = document.createDocumentFragment();

    ordered.forEach(([, { instructor, course, vol, parts }]) => {
        // Within a card, sort chapters by their true chapter index.
        parts.sort((a, b) => {
            const A = parseVolChap(a), B = parseVolChap(b);
            return (A.chap ?? 99) - (B.chap ?? 99)
                || (a.start_seconds || 0) - (b.start_seconds || 0);
        });

        const series = document.createElement('div');
        series.className = 'series-card open';
        const initial = (instructor[0] || '?').toUpperCase();

        // Header tells the user EXACTLY which file this card represents.
        const volLabel = vol != null ? `Vol ${String(vol).padStart(2, '0')}` : '';
        const titleLine = [course, volLabel].filter(Boolean).join(' · ');
        const subBits   = [
            instructor,
            `${parts.length} matching chapter${parts.length !== 1 ? 's' : ''}`,
        ].filter(Boolean).join(' · ');

        series.innerHTML = `
            <button class="series-head" type="button">
                <div class="series-avatar">${initial}</div>
                <div class="series-meta">
                    <div class="series-instructor">${titleLine || instructor}</div>
                    <div class="series-sub">${subBits}</div>
                </div>
                <i class="fa-solid fa-chevron-down series-chevron"></i>
            </button>
            <div class="series-parts"></div>
        `;

        const partsEl = series.querySelector('.series-parts');
        const matchedKeys = new Set(parts.map(p => `${parseVolChap(p).chap ?? '?'}|${p.start_seconds ?? '?'}`));

        // Render the matched-only list first so the user sees something instantly.
        parts.forEach(v => partsEl.appendChild(buildPartRow(v, /*matched*/ true)));

        // Lazy-fetch the FULL chapter list for this mp4 the first time the card opens.
        const filePath = parts[0].video_file_path || parts[0].video_file;
        let fullLoaded = false;

        async function loadFullChapters() {
            if (fullLoaded || !filePath) return;
            fullLoaded = true;
            const loading = document.createElement('div');
            loading.className = 'part-loading';
            loading.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading full chapter list…`;
            partsEl.appendChild(loading);
            try {
                const res = await fetch(getApiUrl('/api/video-chapters'), {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ video_file_path: filePath }),
                });
                const data = await res.json();
                const chapters = Array.isArray(data.chapters) ? data.chapters : [];
                if (!chapters.length) { loading.remove(); return; }

                // Replace the matched-only list with the full list.
                partsEl.innerHTML = '';
                chapters
                    .sort((a, b) => {
                        const A = parseVolChap(a), B = parseVolChap(b);
                        return (A.chap ?? 99) - (B.chap ?? 99)
                            || (a.start_seconds || 0) - (b.start_seconds || 0);
                    })
                    .forEach(c => {
                        const key = `${parseVolChap(c).chap ?? '?'}|${c.start_seconds ?? '?'}`;
                        partsEl.appendChild(buildPartRow(c, matchedKeys.has(key)));
                    });
            } catch (_) {
                loading.remove();
            }
        }

        // Cards start expanded — kick off the full-list fetch immediately.
        loadFullChapters();

        // Collapse/expand
        series.querySelector('.series-head').addEventListener('click', () => {
            series.classList.toggle('open');
            if (series.classList.contains('open')) loadFullChapters();
        });

        frag.appendChild(series);
    });

    return frag;
}

// Build a single chapter row inside a series card.
// `matched` flags whether this chapter scored for the current query — those rows
// get a subtle highlight so the user can see why this video showed up.
function buildPartRow(v, matched) {
    const row = document.createElement('div');
    row.className = 'part-row' + (matched ? ' matched' : '');
    const thumbUrl = thumbnailUrlFor(v);
    const gradient = stringToGradient((v.chapter_title || '') + (v.instructor || ''));
    const { vol, chap } = parseVolChap(v);
    const volLabel = vol  != null ? `VOL ${String(vol).padStart(2, '0')}`  : 'VOL —';
    const chLabel  = chap != null ? `CH ${String(chap).padStart(2, '0')}` : '';
    row.innerHTML = `
        <div class="part-thumb" style="background:${gradient};">
            ${thumbUrl ? `<video class="thumb-frame" preload="metadata" muted playsinline disablepictureinpicture src="${thumbUrl}"></video>` : ''}
            <span class="part-time">${formatTime(v.start_seconds)}</span>
        </div>
        <div class="part-info">
            <div class="part-index">${volLabel}${chLabel ? ` · ${chLabel}` : ''}${matched ? ' · <span class="part-match">MATCH</span>' : ''}</div>
            <div class="part-title">${v.chapter_title || 'Untitled Chapter'}</div>
            ${v.technique ? `<div class="part-tech">${v.technique}</div>` : ''}
        </div>
        <div class="part-play"><i class="fa-solid fa-play"></i></div>
    `;
    const thumbEl = row.querySelector('.thumb-frame');
    if (thumbEl) thumbEl.addEventListener('error', () => thumbEl.style.display = 'none');
    row.addEventListener('click', () => {
        playVideo(v);
        if (activeCardElement) activeCardElement.classList.remove('active');
        row.classList.add('active');
        activeCardElement = row;
    });
    return row;
}

function renderVideoList() {
    videoList.innerHTML = '';
    const pool = getFilteredVideos();
    const total = pool.length;
    updateTabCounts();
    renderFilterBar();

    if (!total) {
        videoList.innerHTML = `
            <div class="empty-state-redirect">
                <div class="redirect-num">∅</div>
                <p class="redirect-headline">Nothing<br><em>matched.</em></p>
                <p class="redirect-sub">${activeInstructor
                    ? `No chapters by <strong>${escapeHtml(activeInstructor)}</strong> in this query.`
                    : `No chapters indexed for <strong>${escapeHtml(lastSearchQuery || 'this query')}</strong>. Try a broader term.`}</p>
            </div>`;
        return;
    }

    const instructionals = pool.filter(v => v._category === 'instructional');
    const mentions       = pool.filter(v => v._category === 'mentioned');

    let shown = 0;

    if (activeFilter === 'all' || activeFilter === 'instructional') {
        if (instructionals.length) {
            videoList.appendChild(buildSeriesGroups(instructionals));
            shown += instructionals.length;
        }
    }

    if (activeFilter === 'all' || activeFilter === 'mentioned') {
        if (mentions.length) {
            if (activeFilter === 'all' && instructionals.length) {
                const div = document.createElement('div');
                div.className = 'list-divider';
                div.innerHTML = `<span>MENTIONED IN MOVES</span>`;
                videoList.appendChild(div);
            }
            mentions.forEach(v => videoList.appendChild(buildVideoCard(v)));
            shown += mentions.length;
        }
    }

    resultCount.textContent = `${shown} ${shown === 1 ? 'result' : 'results'}`;
    resultCount.classList.add('visible');

    // Echo the active query in the sidebar header so the user sees what's being shown.
    const sidebarQuery     = document.getElementById('sidebar-query');
    const sidebarQueryText = document.getElementById('sidebar-query-text');
    if (sidebarQuery && sidebarQueryText) {
        if (lastSearchQuery) {
            sidebarQueryText.textContent = `“${lastSearchQuery}”`;
            sidebarQuery.hidden = false;
        } else {
            sidebarQuery.hidden = true;
        }
    }

    if (!shown) {
        const labels = { instructional: 'instructional chapters', mentioned: 'mentions' };
        const which  = labels[activeFilter] || 'results';
        videoList.innerHTML = `
            <div class="empty-state-redirect">
                <div class="redirect-num">—</div>
                <p class="redirect-headline">No ${which}<br><em>in this view.</em></p>
                <p class="redirect-sub">Try the <strong>All</strong> tab to see every chapter for this query.</p>
            </div>`;
    }
}

// Library starter chips (default empty state)
document.addEventListener('click', (e) => {
    const starter = e.target.closest('.library-starter');
    if (!starter) return;
    const q = starter.dataset.q;
    if (!q) return;
    const input = document.getElementById('global-search');
    if (input) input.value = q;
    handleSearch(q);
});

// Tab chips wiring
document.getElementById('sidebar-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-chip');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('.tab-chip').forEach(c => c.classList.toggle('active', c === btn));
    renderVideoList();
});

// ── BROWSE RAIL (left sidebar) ─────────────────────────────────────────────────

const RECENT_KEY = 'bjj_recent_searches';
const CURATED_INSTRUCTORS = [
    'Lachlan Giles', 'Gordon Ryan', 'John Danaher', 'Craig Jones',
    'Mikey Musumeci', 'Bernardo Faria', 'Andre Galvao', 'Marcelo Garcia',
];

function readRecent() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(Boolean).slice(0, 8) : [];
    } catch (_) { return []; }
}
function pushRecent(q) {
    if (!q || !q.trim()) return;
    const cur = readRecent().filter(x => x.toLowerCase() !== q.toLowerCase());
    cur.unshift(q.trim());
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 8))); } catch (_) {}
    renderRailRecent();
}
function clearRecent() {
    try { localStorage.removeItem(RECENT_KEY); } catch (_) {}
    renderRailRecent();
}

function renderRailRecent() {
    const host = document.getElementById('rail-recent');
    if (!host) return;
    const items = readRecent();
    if (!items.length) {
        host.innerHTML = `<p class="rail-empty-line">— no searches yet —</p>`;
        return;
    }
    host.innerHTML = items.map(q => `
        <button type="button" class="rail-recent-chip" data-q="${escapeHtml(q)}">
            <i class="fa-solid fa-clock-rotate-left"></i>${escapeHtml(q)}
        </button>
    `).join('');
}

function renderRailInstructors() {
    const host = document.getElementById('rail-instructors');
    const meta = document.getElementById('rail-instructors-meta');
    if (!host) return;

    // Build counts from current search results; fall back to curated list.
    const counts = new Map();
    for (const v of lastSearchVideos) {
        const n = (v.instructor || '').trim();
        if (!n) continue;
        counts.set(n, (counts.get(n) || 0) + 1);
    }

    let entries;
    if (counts.size) {
        entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        if (meta) meta.textContent = 'IN RESULTS';
    } else {
        entries = CURATED_INSTRUCTORS.map(n => [n, null]);
        if (meta) meta.textContent = 'CURATED';
    }

    host.innerHTML = entries.map(([name, count]) => {
        const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '·';
        const isActive = activeInstructor && activeInstructor.toLowerCase() === name.toLowerCase();
        const countBadge = count == null ? '' : `<span class="rail-instr-count">${count}</span>`;
        return `
            <li>
                <button type="button" class="rail-instructor${isActive ? ' active' : ''}" data-instructor="${escapeHtml(name)}">
                    <span class="rail-instr-avatar">${escapeHtml(initials)}</span>
                    <span class="rail-instr-name">${escapeHtml(name)}</span>
                    ${countBadge}
                </button>
            </li>`;
    }).join('');
}

function renderFilterBar() {
    const bar  = document.getElementById('library-filterbar');
    const txt  = document.getElementById('filterbar-pill-text');
    if (!bar || !txt) return;
    if (activeInstructor) {
        txt.textContent = activeInstructor;
        bar.hidden = false;
    } else {
        bar.hidden = true;
    }
}

function setInstructorFilter(name) {
    activeInstructor = name || null;
    renderRailInstructors();
    renderVideoList();
}

// Rail clicks (delegated, single listener for the whole rail)
document.querySelector('.browse-rail')?.addEventListener('click', (e) => {
    const recent = e.target.closest('.rail-recent-chip');
    if (recent) {
        const q = recent.dataset.q;
        const input = document.getElementById('global-search');
        if (input) input.value = q;
        handleSearch(q);
        return;
    }

    const pos = e.target.closest('.rail-pos');
    if (pos) {
        const q = pos.dataset.q;
        const input = document.getElementById('global-search');
        if (input) input.value = q;
        handleSearch(q);
        return;
    }

    const instr = e.target.closest('.rail-instructor');
    if (instr) {
        const name = instr.dataset.instructor;
        // Toggle off if already active
        if (activeInstructor && activeInstructor.toLowerCase() === name.toLowerCase()) {
            setInstructorFilter(null);
        } else {
            // If we have no search results yet, search for the instructor name as a fallback
            if (!lastSearchVideos.length) {
                const input = document.getElementById('global-search');
                if (input) input.value = name;
                handleSearch(name);
            } else {
                setInstructorFilter(name);
            }
        }
    }
});

document.getElementById('rail-recent-clear')?.addEventListener('click', clearRecent);
document.getElementById('filterbar-clear')?.addEventListener('click', () => setInstructorFilter(null));
document.getElementById('library-clear-q')?.addEventListener('click', () => {
    // Clear the active query and return to a clean library view
    lastSearchQuery = '';
    lastSearchVideos = [];
    activeInstructor = null;
    activeFilter = 'all';
    document.querySelectorAll('.tab-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
    const sq = document.getElementById('sidebar-query');
    if (sq) sq.hidden = true;
    resultCount.classList.remove('visible');
    hideSearchStage();
    if (tatamiHero) tatamiHero.style.display = '';
    // Restore the default empty state in the library list
    videoList.innerHTML = `
        <div class="empty-state-library" id="library-empty-default">
            <div class="library-num">01</div>
            <div class="library-rule"></div>
            <p class="library-headline">No search<br><em>yet.</em></p>
            <p class="library-sub">Run a query above, pick an instructor on the left, or try a starter:</p>
            <div class="library-starters">
                <button type="button" class="library-starter" data-q="K-Guard">K-Guard</button>
                <button type="button" class="library-starter" data-q="Heel Hook">Heel Hook</button>
                <button type="button" class="library-starter" data-q="Berimbolo">Berimbolo</button>
                <button type="button" class="library-starter" data-q="Triangle">Triangle</button>
            </div>
            <span class="library-jp">柔術 · 検索開始</span>
        </div>`;
    renderRailInstructors();
    renderFilterBar();
});

// Initial paint of the rail
renderRailRecent();
renderRailInstructors();

// ── CHAT UI ───────────────────────────────────────────────────────────────────

function addChatMessage(text, type, sources = []) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = text;

    if (sources.length > 0) {
        const row = document.createElement('div');
        row.className = 'agent-sources';
        sources.forEach(src => {
            if (!src.title) return;
            const btn = document.createElement('button');
            btn.className = 'agent-source-btn';
            btn.innerHTML = `<i class="fa-solid fa-play"></i> ${src.title}`;
            btn.addEventListener('click', () => playVideo(src));
            row.appendChild(btn);
        });
        div.appendChild(row);
    }

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'message bot-message';
    div.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
}

// ── VIDEO PLAYER ──────────────────────────────────────────────────────────────

function playVideo(videoData) {
    currentVideoData = videoData;

    const title      = videoData.chapter_title || videoData.title || 'Video Chapter';
    const instructor = videoData.instructor || 'Unknown';
    const technique  = videoData.technique || '';
    const start      = videoData.start_seconds ?? videoData.start ?? 0;
    const srcPath    = videoData.video_file_path || videoData.video_file || '';

    currentTitle.textContent = title;
    const { vol, chap } = parseVolChap(videoData);
    const volChapBits = [
        vol  != null ? `Vol ${String(vol).padStart(2, '0')}`  : null,
        chap != null ? `Ch ${String(chap).padStart(2, '0')}` : null,
    ].filter(Boolean).join(' · ');
    const metaBits = [instructor, volChapBits, technique].filter(Boolean).join(' · ');
    currentInstructor.textContent = metaBits;
    nowPlayingBar.style.display = 'flex';

    // Swap hero / search-stage → player on first play
    if (tatamiHero) tatamiHero.style.display = 'none';
    hideSearchStage();
    if (playerWrapper) playerWrapper.style.display = 'block';

    videoStage.innerHTML = '';

    if (srcPath.includes('videodelivery.net') || srcPath.includes('cloudflarestream.com')) {
        const iframe = document.createElement('iframe');
        const sep = srcPath.includes('?') ? '&' : '?';
        iframe.src = `${srcPath}${sep}startTime=${start}s&autoplay=true`;
        iframe.allow = 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;';
        iframe.setAttribute('allowfullscreen', 'true');
        videoStage.appendChild(iframe);
    } else {
        const r2Base = 'https://pub-ee3b210f46814c0a94774fac09e25e1a.r2.dev';
        const fileName = srcPath.split('/').pop();
        mountCustomVideoPlayer(`${r2Base}/${fileName}`, start);
    }

    // Expand graph for this technique
    if (technique) loadGraphForTechnique(technique);
}

// ── CUSTOM VIDEO PLAYER ───────────────────────────────────────────────────────
// Replaces native HTML5 controls (which were intermittently un-clickable)
// with a deterministic, high-z-index custom UI.

function mountCustomVideoPlayer(src, startSeconds = 0) {
    const shell = document.createElement('div');
    shell.className = 'cv-shell';
    shell.innerHTML = `
        <video class="cv-video" playsinline preload="auto"></video>
        <button class="cv-big-play" type="button" aria-label="Play"><i class="fa-solid fa-play"></i></button>
        <div class="cv-controls">
            <button class="cv-btn cv-play"  type="button" aria-label="Play/Pause"><i class="fa-solid fa-play"></i></button>
            <div class="cv-time cv-current">0:00</div>
            <div class="cv-scrub" role="slider" aria-label="Seek">
                <div class="cv-scrub-track">
                    <div class="cv-scrub-buffer"></div>
                    <div class="cv-scrub-fill"></div>
                    <div class="cv-scrub-thumb"></div>
                </div>
            </div>
            <div class="cv-time cv-duration">0:00</div>
            <div class="cv-volume-group">
                <button class="cv-btn cv-mute" type="button" aria-label="Mute/Unmute"><i class="fa-solid fa-volume-high"></i></button>
                <div class="cv-volume" role="slider" aria-label="Volume">
                    <div class="cv-volume-track"><div class="cv-volume-fill"></div></div>
                </div>
            </div>
            <button class="cv-btn cv-fs"    type="button" aria-label="Fullscreen"><i class="fa-solid fa-expand"></i></button>
        </div>
    `;
    videoStage.appendChild(shell);

    const video       = shell.querySelector('.cv-video');
    const bigPlay     = shell.querySelector('.cv-big-play');
    const playBtn     = shell.querySelector('.cv-play');
    const muteBtn     = shell.querySelector('.cv-mute');
    const fsBtn       = shell.querySelector('.cv-fs');
    const scrub       = shell.querySelector('.cv-scrub');
    const scrubFill   = shell.querySelector('.cv-scrub-fill');
    const scrubBuffer = shell.querySelector('.cv-scrub-buffer');
    const scrubThumb  = shell.querySelector('.cv-scrub-thumb');
    const volume      = shell.querySelector('.cv-volume');
    const volumeFill  = shell.querySelector('.cv-volume-fill');
    const curTime     = shell.querySelector('.cv-current');
    const durTime     = shell.querySelector('.cv-duration');

    video.src = `${src}#t=${startSeconds}`;
    video.autoplay = true;

    const setPlayIcons = () => {
        const icon = video.paused ? 'fa-play' : 'fa-pause';
        playBtn.querySelector('i').className = `fa-solid ${icon}`;
        bigPlay.querySelector('i').className = `fa-solid ${video.paused ? 'fa-play' : 'fa-pause'}`;
        shell.classList.toggle('cv-paused', video.paused);
    };
    const setMuteIcon = () => {
        const i = muteBtn.querySelector('i');
        if (video.muted || video.volume === 0) i.className = 'fa-solid fa-volume-xmark';
        else if (video.volume < 0.5)            i.className = 'fa-solid fa-volume-low';
        else                                    i.className = 'fa-solid fa-volume-high';
        volumeFill.style.width = `${(video.muted ? 0 : video.volume) * 100}%`;
    };

    const togglePlay = () => { video.paused ? video.play().catch(()=>{}) : video.pause(); };

    playBtn.addEventListener('click', togglePlay);
    bigPlay.addEventListener('click', togglePlay);
    video.addEventListener('click', togglePlay);
    video.addEventListener('play',  setPlayIcons);
    video.addEventListener('pause', setPlayIcons);

    muteBtn.addEventListener('click', () => { video.muted = !video.muted; setMuteIcon(); });
    video.addEventListener('volumechange', setMuteIcon);

    fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        } else if (shell.requestFullscreen) {
            shell.requestFullscreen();
        } else if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        }
    });

    // Time + scrubber
    video.addEventListener('loadedmetadata', () => {
        durTime.textContent = formatTime(video.duration);
    });
    video.addEventListener('timeupdate', () => {
        if (!video.duration) return;
        const pct = (video.currentTime / video.duration) * 100;
        scrubFill.style.width = `${pct}%`;
        scrubThumb.style.left = `${pct}%`;
        curTime.textContent = formatTime(video.currentTime);
    });
    video.addEventListener('progress', () => {
        if (!video.duration || !video.buffered.length) return;
        const end = video.buffered.end(video.buffered.length - 1);
        scrubBuffer.style.width = `${(end / video.duration) * 100}%`;
    });

    const seekFromEvent = (e) => {
        const rect = scrub.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        if (video.duration) video.currentTime = pct * video.duration;
    };
    let scrubbing = false;
    scrub.addEventListener('mousedown', (e) => { scrubbing = true; seekFromEvent(e); });
    window.addEventListener('mousemove', (e) => { if (scrubbing) seekFromEvent(e); });
    window.addEventListener('mouseup',   () => { scrubbing = false; });
    scrub.addEventListener('touchstart', (e) => { scrubbing = true; seekFromEvent(e); }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (scrubbing) seekFromEvent(e); }, { passive: true });
    window.addEventListener('touchend',  () => { scrubbing = false; });

    // Volume slider — drag is scoped to the slider element only,
    // so it can never block clicks on neighbouring buttons.
    const setVolFromEvent = (e) => {
        const rect = volume.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        video.muted = pct === 0;
        video.volume = pct;
    };
    let voldrag = false;
    volume.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        voldrag = true;
        setVolFromEvent(e);
        const onMove = (ev) => { if (voldrag) setVolFromEvent(ev); };
        const onUp   = () => {
            voldrag = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Auto-hide controls — only when actually playing AND mouse is outside.
    let hideTimer;
    const showControls = () => {
        shell.classList.remove('cv-idle');
        clearTimeout(hideTimer);
        if (!video.paused) {
            hideTimer = setTimeout(() => {
                if (!video.paused) shell.classList.add('cv-idle');
            }, 2500);
        }
    };
    shell.addEventListener('mousemove', showControls);
    shell.addEventListener('mouseleave', () => {
        if (!video.paused) shell.classList.add('cv-idle');
    });
    video.addEventListener('pause', () => shell.classList.remove('cv-idle'));
    showControls();

    setPlayIcons();
    setMuteIcon();
}

// ── D3 KNOWLEDGE GRAPH ────────────────────────────────────────────────────────

const NODE_COLORS = {
    Technique: 'var(--node-technique)',
    Position:  'var(--node-position)',
    Concept:   'var(--node-concept)',
};
const NODE_RADII = { Technique: 18, Position: 16, Concept: 14 };
const DEFAULT_COLOR  = 'var(--node-default)';
const DEFAULT_RADIUS = 13;

function getNodeColor(type) { return NODE_COLORS[type] || DEFAULT_COLOR; }
function getNodeRadius(type) { return NODE_RADII[type] || DEFAULT_RADIUS; }

function initGraph() {
    const container = document.getElementById('graph-container');
    const svg = d3.select('#knowledge-graph');

    const zoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
            graphState.g.attr('transform', event.transform);
        });

    svg.call(zoom);

    const g = svg.append('g');

    // Arrow markers
    svg.append('defs').append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 26)
        .attr('refY', 0)
        .attr('markerWidth', 8)
        .attr('markerHeight', 8)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'var(--border-hi)')
        .attr('opacity', 0.85);

    const simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(140).strength(0.7))
        .force('charge', d3.forceManyBody().strength(-360))
        .force('collide', d3.forceCollide(36))
        .force('center', d3.forceCenter(0, 0))
        .alphaDecay(0.025);

    graphState.svg = svg;
    graphState.g   = g;
    graphState.zoom = zoom;
    graphState.simulation = simulation;
    graphState.linkEls  = g.append('g').attr('class', 'links');
    graphState.nodeEls  = g.append('g').attr('class', 'nodes');
    graphState.labelEls = g.append('g').attr('class', 'labels');
}

// Greedy word-wrap for SVG labels — returns up to `maxLines` strings,
// truncating with an ellipsis if the text is longer than allowed.
function wrapLabel(text, maxCharsPerLine = 18, maxLines = 2) {
    if (!text) return [''];
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length <= maxCharsPerLine) {
            cur = next;
        } else {
            if (cur) lines.push(cur);
            cur = w;
            if (lines.length === maxLines) break;
        }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length > maxLines) lines.length = maxLines;
    // If text still has leftovers, ellipsize the last visible line.
    const joined = lines.join(' ');
    if (joined.length < text.length) {
        const last = lines[lines.length - 1];
        const room = Math.max(1, maxCharsPerLine - 1);
        lines[lines.length - 1] = (last.length > room ? last.substring(0, room) : last) + '…';
    }
    return lines;
}

function addGraphNode(id, type = 'Concept') {
    if (!id || graphState.nodes.has(id)) return;
    graphState.nodes.set(id, { id, type: type || 'Concept' });
}

function addGraphLink(sourceId, targetId) {
    const key = `${sourceId}→${targetId}`;
    if (graphState.links.has(key)) return;
    // Capture destination type so the edge can be colored to match.
    const dest = graphState.nodes.get(targetId);
    graphState.links.set(key, { source: sourceId, target: targetId, destType: dest?.type || 'Concept' });
}

function updateGraph() {
    const nodes = Array.from(graphState.nodes.values());
    const links = Array.from(graphState.links.values());

    // Update empty state
    if (nodes.length > 0) {
        graphEmpty.classList.add('hidden');
    }

    nodeCountBadge.textContent = `${nodes.length} node${nodes.length !== 1 ? 's' : ''}`;

    // ── Links ──
    const linkSel = graphState.linkEls.selectAll('.graph-link').data(links, d => `${d.source.id || d.source}→${d.target.id || d.target}`);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line')
        .attr('class', d => `graph-link link-${(d.destType || 'Concept').toLowerCase()}`)
        .attr('marker-end', 'url(#arrow)');
    linkEnter.append('title').text(d => `${d.source.id || d.source} → ${d.target.id || d.target}`);
    graphState.currentLinks = linkEnter.merge(linkSel);

    // ── Nodes ──
    const nodeSel = graphState.nodeEls.selectAll('.graph-node').data(nodes, d => d.id);
    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append('g')
        .attr('class', 'graph-node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag',  dragged)
            .on('end',   dragended))
        .on('click', onNodeClick);

    // Outer halo ring
    nodeEnter.append('circle')
        .attr('class', 'halo')
        .attr('r', d => getNodeRadius(d.type) + 6)
        .attr('fill', d => getNodeColor(d.type))
        .attr('fill-opacity', 0.12)
        .attr('stroke', 'none');

    // Main node body
    nodeEnter.append('circle')
        .attr('class', 'body')
        .attr('r', d => getNodeRadius(d.type))
        .attr('fill', d => getNodeColor(d.type))
        .attr('stroke', d => getNodeColor(d.type))
        .attr('stroke-opacity', 0.7)
        .attr('stroke-width', 2)
        .attr('fill-opacity', 0.92);

    // Native browser tooltip with full node id + type
    nodeEnter.append('title').text(d => `${d.id}\n(${d.type})`);

    graphState.currentNodes = nodeEnter.merge(nodeSel);

    // ── Labels — wrap long names onto two lines ──
    const labelSel = graphState.labelEls.selectAll('.graph-label').data(nodes, d => d.id);
    labelSel.exit().remove();
    const labelEnter = labelSel.enter().append('text')
        .attr('class', 'graph-label')
        .style('font-family', "'DM Sans', sans-serif")
        .style('font-size', '12px')
        .style('font-weight', '500')
        .style('fill', 'var(--text-bright)')
        .style('paint-order', 'stroke')
        .style('stroke', 'var(--bg)')
        .style('stroke-width', '4px')
        .style('stroke-linejoin', 'round')
        .style('text-anchor', 'middle')
        .style('pointer-events', 'none')
        .style('user-select', 'none');

    labelEnter.each(function(d) {
        const sel = d3.select(this);
        sel.selectAll('tspan').remove();
        const lines = wrapLabel(d.id, 18, 2);
        const baseDy = getNodeRadius(d.type) + 14;
        // Type eyebrow first (small mono caps, color-matched), then name lines.
        sel.append('tspan')
            .attr('class', 'type-eyebrow')
            .attr('x', 0)
            .attr('dy', baseDy)
            .attr('fill', getNodeColor(d.type))
            .text((d.type || 'Concept').toUpperCase());
        lines.forEach((ln, i) => {
            sel.append('tspan')
                .attr('class', 'name-line')
                .attr('x', 0)
                .attr('dy', i === 0 ? 14 : 13)
                .text(ln);
        });
    });

    graphState.currentLabels = labelEnter.merge(labelSel);

    // Restart simulation
    graphState.simulation.nodes(nodes).on('tick', ticked);
    graphState.simulation.force('link').links(links);
    graphState.simulation.alpha(0.4).restart();
}

function ticked() {
    graphState.currentLinks
        ?.attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

    graphState.currentNodes
        ?.attr('transform', d => `translate(${d.x},${d.y})`);

    // Use transform on labels so child <tspan> x="0" is relative to the node,
    // not absolute SVG-origin (which previously flung every label to the left).
    graphState.currentLabels
        ?.attr('transform', d => `translate(${d.x},${d.y})`);
}

function dragstarted(event, d) {
    if (!event.active) graphState.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}
function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}
function dragended(event, d) {
    if (!event.active) graphState.simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function onNodeClick(event, d) {
    event.stopPropagation();
    selectedNodeId = d.id;

    // Highlight selected node
    graphState.currentNodes?.classed('selected', n => n.id === d.id);

    // Position and show popup
    const rect = event.target.getBoundingClientRect();
    const popupW = 280;
    const popupH = 340;
    let left = rect.right + 10;
    let top  = rect.top;

    if (left + popupW > window.innerWidth - 10)  left = rect.left - popupW - 10;
    if (top  + popupH > window.innerHeight - 10) top  = window.innerHeight - popupH - 10;
    if (top < 10) top = 10;

    nodePopup.style.left    = `${left}px`;
    nodePopup.style.top     = `${top}px`;
    nodePopup.style.display = 'block';

    // Set header
    const type = d.type || 'Concept';
    nodePopupBadge.textContent = type;
    nodePopupBadge.className   = `node-badge ${type.toLowerCase()}`;
    if (!nodePopupBadge.className.includes('technique') &&
        !nodePopupBadge.className.includes('position') &&
        !nodePopupBadge.className.includes('concept')) {
        nodePopupBadge.className = 'node-badge default';
    }
    nodePopupName.textContent = d.id;

    // Load chapters
    nodePopupBody.innerHTML = `<p class="node-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading chapters...</p>`;
    loadChaptersForNode(d.id).then(chapters => {
        if (!chapters.length) {
            nodePopupBody.innerHTML = `<p class="node-loading" style="color:var(--text-muted)">No chapters found for this node.</p>`;
            return;
        }
        nodePopupBody.innerHTML = '';
        chapters.forEach(ch => {
            const chip = document.createElement('div');
            chip.className = 'chapter-chip';
            chip.innerHTML = `
                <div class="chapter-chip-title">${ch.title || 'Chapter'}</div>
                <div class="chapter-chip-meta">${ch.instructor || ''} · ${formatTime(ch.start)}</div>
            `;
            chip.addEventListener('click', () => {
                playVideo({ ...ch, chapter_title: ch.title, start_seconds: ch.start });
                closeNodePopup();
            });
            nodePopupBody.appendChild(chip);
        });
    });
}

function closeNodePopup() {
    nodePopup.style.display = 'none';
    selectedNodeId = null;
    graphState.currentNodes?.classed('selected', false);
}

function clearGraph() {
    graphState.nodes.clear();
    graphState.links.clear();
    graphState.simulation?.stop();
    graphState.g?.selectAll('*').remove();
    // Re-init layers
    graphState.linkEls  = graphState.g.append('g').attr('class', 'links');
    graphState.nodeEls  = graphState.g.append('g').attr('class', 'nodes');
    graphState.labelEls = graphState.g.append('g').attr('class', 'labels');
    nodeCountBadge.textContent = '0 nodes';
    graphEmpty.classList.remove('hidden');
    closeNodePopup();
}

function fitGraphToView() {
    if (!graphState.nodes.size) return;

    const nodes = Array.from(graphState.nodes.values());
    const xs = nodes.map(n => n.x).filter(Boolean);
    const ys = nodes.map(n => n.y).filter(Boolean);
    if (!xs.length) return;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bw   = maxX - minX || 100;
    const bh   = maxY - minY || 100;

    const container = document.getElementById('graph-container');
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    const scale   = Math.min(0.9 * cw / bw, 0.9 * ch / bh, 2);
    const tx      = cw / 2 - scale * ((minX + maxX) / 2);
    const ty      = ch / 2 - scale * ((minY + maxY) / 2);

    graphState.svg.transition().duration(500)
        .call(graphState.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

// ── INIT ──────────────────────────────────────────────────────────────────────

function resizeSvg() {
    const container = document.getElementById('graph-container');
    if (!container || !graphState.svg) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    graphState.svg.attr('width', w).attr('height', h);
    graphState.simulation?.force('center', d3.forceCenter(w / 2, h / 2));
}

window.addEventListener('resize', resizeSvg);

// Boot
initGraph();
resizeSvg();

// ── Auto-play from coach recommendation links ─────────────────
// Practice page deep-links into here with ?chunk_id=…&video_file_path=…&start=…
(function autoPlayFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const videoFilePath = params.get('video_file_path');
    if (!videoFilePath) return;
    const videoData = {
        chunk_id: params.get('chunk_id') || '',
        video_file_path: videoFilePath,
        chapter_title: params.get('chapter_title') || 'Chapter',
        instructor: params.get('instructor') || 'Unknown',
        technique: params.get('technique') || '',
        start_seconds: parseFloat(params.get('start') || '0') || 0,
    };
    // Defer one tick so DOM refs (videoStage, etc.) are wired up.
    setTimeout(() => playVideo(videoData), 0);
})();
