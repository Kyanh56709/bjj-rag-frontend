// --- CONFIGURATION ---
const API_BASE_URL = "https://bjj-rag-library.onrender.com"; // <-- REPLACE WITH YOUR RENDER URL

// --- GET HTML ELEMENTS ---
const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login-button");
const errorMessage = document.getElementById("error-message");

// --- EVENT LISTENER ---
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault(); // Prevent the form from submitting in the traditional way

    // Get user inputs
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        showError("Please enter both username and password.");
        return;
    }

    // Disable button and show loading state
    loginButton.disabled = true;
    loginButton.innerText = "Logging in...";
    clearError();

    try {
        // Send login request to the backend
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username: username, password: password }),
        });

        const data = await response.json();

        if (!response.ok) {
            // If the server returns an error (e.g., 401 Unauthorized)
            throw new Error(data.msg || 'Login failed.');
        }

        // --- SUCCESS! ---
        // Store the JWT token in the browser's local storage
        localStorage.setItem('bjj_token', data.access_token);
        
        // Redirect to the main chat page
        window.location.href = '/index.html'; // Or just 'index.html'

    } catch (error) {
        // Show the error message to the user
        showError(error.message);
        
        // Re-enable the button
        loginButton.disabled = false;
        loginButton.innerText = "Login";
    }
});


// --- HELPER FUNCTIONS ---
function showError(message) {
    errorMessage.innerText = message;
}

function clearError() {
    errorMessage.innerText = "";
}