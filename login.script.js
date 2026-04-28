// ─────────────────────────────────────────────────────────────
// LOGIN PAGE — Auth Logic (Username/Password + Google OAuth)
// ─────────────────────────────────────────────────────────────

const getApiBaseUrl = () => {
    const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    return isLocal ? "http://127.0.0.1:5000" : "https://bjj-rag-library-production.up.railway.app";
};
const API_BASE_URL = getApiBaseUrl();

// Replace with your actual Google OAuth Client ID if available
// Note: This must match the GOOGLE_CLIENT_ID environment variable set on your backend.
const GOOGLE_CLIENT_ID = "636552135778-k9abgk3pp8e19a1tu0isg4vam9phvtgm.apps.googleusercontent.com";

// ── DOM refs ─────────────────────────────────────────────────
const loginForm      = document.getElementById("login-form");
const usernameInput  = document.getElementById("username");
const passwordInput  = document.getElementById("password");
const loginButton    = document.getElementById("login-button");
const errorMessage   = document.getElementById("error-message");

// ── Google Sign-In Init ───────────────────────────────────────
window.onload = () => {
    if (typeof google !== 'undefined') {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleLogin,
        });
        google.accounts.id.renderButton(
            document.getElementById("google-signin-btn"),
            { 
                theme: "filled_black", 
                size: "large", 
                width: "100%", 
                text: "signin_with",
                shape: "pill"
            }
        );
    } else {
        console.warn("Google GSI script not loaded. Google login disabled.");
    }
};

// ── Google OAuth Handler ──────────────────────────────────────
async function handleGoogleLogin(response) {
    clearError();
    try {
        const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential }),
        });

        const data = await res.json();

        if (res.status === 403) {
            throw new Error(data.msg || 'This account is not authorized.');
        }

        if (!res.ok) {
            throw new Error(data.msg || 'Google login failed.');
        }

        localStorage.setItem('bjj_token', data.access_token);
        if (data.username) localStorage.setItem('bjj_username', data.username);
        window.location.href = '/index.html';

    } catch (error) {
        showError(error.message);
    }
}

// ── Username/Password Login ────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        showError("Please enter both username and password.");
        return;
    }

    loginButton.disabled = true;
    const originalText = loginButton.innerHTML;
    loginButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;
    clearError();

    try {
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.msg || 'Login failed.');
        }

        localStorage.setItem('bjj_token', data.access_token);
        window.location.href = '/index.html';

    } catch (error) {
        showError(error.message);
        loginButton.disabled = false;
        loginButton.innerHTML = originalText;
    }
});


// ── Helpers ───────────────────────────────────────────────────
function showError(message) {
    errorMessage.innerText = message;
    errorMessage.style.display = "block";
}

function clearError() {
    errorMessage.innerText = "";
    errorMessage.style.display = "none";
}
