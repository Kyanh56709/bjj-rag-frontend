// --- CONFIGURATION ---
const API_URL = "https://bjj-rag-library.onrender.com/api/ask";

// --- GET HTML ELEMENTS ---
const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const videoModal = document.getElementById("video-modal");
const videoTitle = document.getElementById("video-title");
const videoPlayerContainer = document.getElementById("video-player-container");
const closeModalButton = document.querySelector(".close-button");

// --- EVENT LISTENERS ---

// Handle form submission
chatForm.addEventListener("submit", (e) => {
    e.preventDefault(); // Prevent page reload
    const userMessage = userInput.value.trim();
    if (userMessage) {
        // Add user's message to chat box
        addMessage(userMessage, "user-message");
        // Show loading indicator and send request to backend
        showLoadingIndicator();
        fetchApiResponse(userMessage);
    }
    userInput.value = ""; // Clear the input box
});

// Close the video modal
closeModalButton.addEventListener("click", () => {
    videoModal.style.display = "none";
    videoPlayerContainer.innerHTML = ""; // Stop video by removing the element
});

// Close modal if user clicks outside of it
window.addEventListener("click", (event) => {
    if (event.target == videoModal) {
        videoModal.style.display = "none";
        videoPlayerContainer.innerHTML = "";
    }
});

// --- FUNCTIONS ---

// Adds a message bubble to the chat box
function addMessage(message, className, sources = []) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${className}`;

    const p = document.createElement("p");
    p.innerHTML = message; // Use innerHTML to render line breaks if any
    messageDiv.appendChild(p);

    // If there are sources, create and append them
    if (sources.length > 0) {
        const sourcesContainer = document.createElement("div");
        sourcesContainer.className = "sources-container";

        const sourcesTitle = document.createElement("h4");
        sourcesTitle.className = "sources-title";
        sourcesTitle.innerText = "Sources:";
        sourcesContainer.appendChild(sourcesTitle);

        sources.forEach(source => {
            const sourceDiv = document.createElement("div");
            sourceDiv.className = "source-item";
            sourceDiv.innerHTML = `<span class="chapter">${source.chapter_title}</span> - ${source.technique}`;

            // Add click event listener to open video
            sourceDiv.addEventListener("click", () => {
                playVideo(source);
            });

            sourcesContainer.appendChild(sourceDiv);
        });
        messageDiv.appendChild(sourcesContainer);
    }

    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to the bottom
}

// Shows a "Bot is typing..." message
function showLoadingIndicator() {
    addMessage("Thinking...", "bot-message loading");
}

// Removes the loading indicator
function removeLoadingIndicator() {
    const loadingMessage = document.querySelector(".loading");
    if (loadingMessage) {
        loadingMessage.remove();
    }
}

// Fetches the response from the backend API
async function fetchApiResponse(query) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        removeLoadingIndicator();
        // Replace newlines in the answer with <br> tags for proper HTML rendering
        const formattedAnswer = data.answer.replace(/\n/g, '<br>');
        addMessage(formattedAnswer, "bot-message", data.sources);

    } catch (error) {
        removeLoadingIndicator();
        addMessage(`Sorry, something went wrong. Please try again. Error: ${error.message}`, "bot-message");
    }
}

// Displays the video modal and plays the video from the correct timestamp
function playVideo(source) {
    // We need to reconstruct the video URL. Let's assume a base URL structure.
    // IMPORTANT: Make sure the video_file_path from your metadata is just the filename.
    const r2BaseUrl = "https://pub-ee3b210f46814c0a94774fac09e25e1a.r2.dev"; // <-- REPLACE WITH YOUR R2 PUBLIC URL
    const videoFileName = source.video_file_path.split('/').pop(); // Gets 'craig-jones-powertop-vol-1.mp4'
    const videoUrl = `${r2BaseUrl}/${videoFileName}`;
    
    const startTime = source.start_seconds;

    console.log(`Attempting to play video: ${videoUrl} at ${startTime} seconds.`);

    // Clear the video stage of any previous content (like the placeholder)
    videoStage.innerHTML = "";

    // Create the video element
    const videoElement = document.createElement("video");
    videoElement.controls = true;
    videoElement.autoplay = true; // Start playing immediately
    
    // Set the source and seek to the correct time
    videoElement.src = `${videoUrl}#t=${startTime}`;
    
    // Append the video player to the stage
    videoStage.appendChild(videoElement);
}