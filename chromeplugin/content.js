let statusInterval = null;
let currentJobId = null;
let playerInterval = null;
let containerRef = null;

function setLoading(btn, text) {
  if (!btn) return;
  btn.innerHTML = `${text} <span class="loader loader-white"></span>`;
}

function addTranscribeButton() {
  // Remove any stale container and stop any existing polling.
  if (containerRef) {
    containerRef.remove();
    containerRef = null;
  }
  const existingContainer = document.getElementById("yt-ai-container");
  if (existingContainer) {
    existingContainer.remove();
  }
  if (playerInterval) {
    clearInterval(playerInterval);
    playerInterval = null;
  }
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
    currentJobId = null;
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
    setLoading(btn, "Transcribing...");
    btn.disabled = true;
    chrome.runtime.sendMessage({ action: "transcribe", url: window.location.href }, (response) => {
      if (!response || !response.success) {
        btn.innerText = response && response.error ? response.error : "Error";
        container.style.backgroundColor = "red";
        btn.disabled = false;
        return;
      }
      if (response.cached) {
        btn.innerText = "Done!";
        container.style.backgroundColor = "green";
        btn.disabled = false;
      } else if (response.jobId) {
        currentJobId = response.jobId;
        statusInterval = setInterval(() => pollStatus(response.jobId, response.videoId), 5000);
      }
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
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
    if (playerInterval) {
      clearInterval(playerInterval);
      playerInterval = null;
    }
    chrome.runtime.sendMessage({ action: "killJob", jobId: currentJobId }, (response) => {
      console.log("Kill job response:", response);
    });
    currentJobId = null;
    containerRef = null;
  };

  container.appendChild(closeBtn);

  containerRef = container;

  // Insert the container when the YouTube player is ready.
  playerInterval = setInterval(() => {
    const player = document.querySelector(".html5-video-player");
    if (player && containerRef) {
      player.appendChild(containerRef);
      clearInterval(playerInterval);
      playerInterval = null;
    }
  }, 500);
}

function pollStatus(jobId, videoId) {
  fetch(`http://localhost:5010/api/status?jobId=${jobId}`)
    .then(res => {
      if (res.status === 404) {
        return { status: "error", error: "Job not found" };
      }
      return res.json();
    })
    .then(data => {
      const btn = document.getElementById("yt-ai-btn");
      const container = document.getElementById("yt-ai-container");
      if (data.status === "downloading") {
        if (btn && container) {
          btn.innerText = "Downloading...";
          container.style.backgroundColor = "#1a73e8";
        }
      } else if (data.status === "transcribing") {
        if (btn && container) {
          setLoading(btn, "Transcribing...");
          container.style.backgroundColor = "#1a73e8";
        }
      } else if (data.status === "done") {
        clearInterval(statusInterval);
        statusInterval = null;
        currentJobId = null;
        const transcript = data.transcript;
        const compressed = LZString.compressToUTF16(transcript);
        chrome.storage.local.set({ [`transcript_${videoId}`]: compressed });
        if (btn && container) {
          btn.innerText = "Processing Transcript...";
          container.style.backgroundColor = "#1a73e8";
          btn.disabled = true;
        }
        chrome.runtime.sendMessage(
          { action: "processTranscript", videoId, transcript },
          (res) => {
            if (res && res.success) {
              if (btn && container) {
                btn.innerText = "Done!";
                btn.disabled = false;
                container.style.backgroundColor = "green";
              }
              if (res.uploaded) {
                chrome.runtime.sendMessage({ action: "openPopup" });
              }
            } else if (btn && container) {
              btn.innerText = "Failed";
              container.style.backgroundColor = "red";
              btn.disabled = false;
            }
          }
        );
      } else if (data.status === "error") {
        clearInterval(statusInterval);
        statusInterval = null;
        currentJobId = null;
        if (btn && container) {
          btn.innerText = data.error ? data.error : "Failed";
          container.style.backgroundColor = "red";
          btn.disabled = false;
        }
      }
    })
    .catch(err => {
      console.error("Polling error", err);
      const btn = document.getElementById("yt-ai-btn");
      const container = document.getElementById("yt-ai-container");
      if (btn && container) {
        btn.innerText = "Server offline. Click to Retry \u27F3";
        container.style.backgroundColor = "red";
        btn.disabled = true;
      }
    });
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
        const text = data.transcript;
        const compressed = LZString.compressToUTF16(text);
        chrome.storage.local.set({ [`transcript_${videoId}`]: compressed }, () => {
          console.log(`Transcript for video ${videoId} saved in chrome storage.`);
        });
        const btn = document.getElementById("yt-ai-btn");
        if (btn) {
          btn.innerText = "Processing Transcript...";
          btn.disabled = true;
        }
        const container = document.getElementById("yt-ai-container");
        if (container) {
          container.style.backgroundColor = "#1a73e8";
        }
        chrome.runtime.sendMessage(
          { action: "processTranscript", videoId, transcript: text },
          (res) => {
            if (res && res.success) {
              if (btn && container) {
                btn.innerText = "Done!";
                btn.disabled = false;
                container.style.backgroundColor = "green";
              }
              if (res.uploaded) {
                chrome.runtime.sendMessage({ action: "openPopup" });
              }
            } else if (btn && container) {
              btn.innerText = "Failed";
              container.style.backgroundColor = "red";
              btn.disabled = false;
            }
          }
        );
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
