function addTranscribeButton() {
  // Remove any stale container.
  const existingContainer = document.getElementById("yt-ai-container");
  if (existingContainer) {
    existingContainer.remove();
  }

  // Create a new container.
  const container = document.createElement("div");
  container.id = "yt-ai-container";
  container.style = `
    position: absolute;
    top: 15px;
    right: 15px;
    background: rgba(26, 115, 232, 0.95);
    color: white;
    padding: 10px;
    border-radius: 6px;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 10px;
  `;

  // Create the Transcribe button.
  const btn = document.createElement("button");
  btn.id = "yt-ai-btn";
  btn.innerText = "Transcribe with AI";
  btn.style = `
    background: transparent;
    border: none;
    color: white;
    font-weight: bold;
    cursor: pointer;
  `;
  btn.onclick = () => {
    btn.innerText = "Transcribing...";
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: "transcribe", url: window.location.href }, (response) => {
      // Additional UI feedback can be added here.
    });
  };

  container.appendChild(btn);

  // Create the close button.
  const closeBtn = document.createElement("span");
  closeBtn.innerText = "✖";
  closeBtn.style = `
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    color: white;
  `;
  closeBtn.onclick = () => {
    document.getElementById("yt-ai-container")?.remove();
    chrome.runtime.sendMessage({ action: "killJob" }, (response) => {
      console.log("Kill job response:", response);
    });
  };

  container.appendChild(closeBtn);

  // Insert the container when the YouTube player is ready.
  const checkPlayerInterval = setInterval(() => {
    const player = document.querySelector(".html5-video-player");
    if (player) {
      player.appendChild(container);
      clearInterval(checkPlayerInterval);
    }
  }, 500);
}

function loadCachedTranscript() {
  const urlObj = new URL(window.location.href);
  const videoId = urlObj.searchParams.get("v");
  if (!videoId) {
    console.warn("No video ID found in URL.");
    return;
  }
  
  console.log("Checking cached transcript for video id:", videoId);
  // Fetch cached transcript from the server.
  fetch(`http://localhost:5010/api/load?videoId=${videoId}`)
    .then(response => response.json())
    .then(data => {
      if (data.cached && data.transcript) {
        console.log("Cached transcript loaded.");
        let text = LZString.decompressFromBase64(data.transcript);
        if (text === null) {
          // Handle transcripts sent without compression
          text = data.transcript;
        }
        const compressed = LZString.compressToUTF16(text);
        chrome.storage.local.set({ [`transcript_${videoId}`]: compressed }, () => {
          console.log(`Transcript for video ${videoId} saved in chrome storage.`);
        });
        // Update UI: set button text and container background.
        const btn = document.getElementById("yt-ai-btn");
        if (btn) {
          btn.innerText = "Done!";
          btn.disabled = false;
        }
        const container = document.getElementById("yt-ai-container");
        if (container) {
          container.style.backgroundColor = "green";
        }
      } else {
        console.log("No cached transcript found for this video.");
      }
    })
    .catch(err => console.error("Error loading cached transcript:", err));
}

// On page load and YouTube navigation, inject fresh UI then load any cached transcript.
window.addEventListener("yt-navigate-finish", () => {
  setTimeout(() => {
    addTranscribeButton();
    loadCachedTranscript();
  }, 1000);
});
window.addEventListener("load", () => {
  setTimeout(() => {
    addTranscribeButton();
    loadCachedTranscript();
  }, 1000);
});
