importScripts("lz-string.min.js");

// Global mapping: store active job info per tab.
const activeJobs = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "transcribe") {
    const url = message.url;
    const videoId = new URL(url).searchParams.get("v");
    if (!videoId) {
      console.error("Could not extract video ID");
      sendResponse({ success: false, error: "Invalid YouTube URL" });
      return;
    }
    const tabId = sender.tab.id;
    console.log("Received transcribe request for video ID:", videoId, "from tab:", tabId);

    // First, check if the transcript is already in chrome local storage.
    chrome.storage.local.get([`transcript_${videoId}`], (result) => {
      if (result && result[`transcript_${videoId}`]) {
        console.log("Transcript found in chrome local storage for video:", videoId);
        // Update UI to "Done!" state.
        updateUI(tabId, "Done!", "green");
        // Kill any active job if one exists.
        if (activeJobs[tabId] && activeJobs[tabId].pollInterval) {
          clearInterval(activeJobs[tabId].pollInterval);
          delete activeJobs[tabId];
        }
        sendResponse({ success: true, videoId, cached: true });
        return;
      } else {
        // If not in local storage, proceed to request from the server.
        fetch("http://localhost:5010/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url })
        })
          .then(res => res.json())
          .then(data => {
            if (data.error) {
              console.error("Error starting transcription job:", data.error);
              updateUI(tabId, "Error", "red");
              sendResponse({ success: false, error: data.error });
              return;
            }
            // NEW: If server indicates that the transcript was already cached,
            // it should have returned a JSON with "cached": true and a "transcript" field.
            if (data.cached) {
              console.log("Server returned cached transcript for video:", videoId);
              updateUI(tabId, "Done!", "green");
              const transcript = LZString.decompressFromBase64(data.transcript);
              const compressed = LZString.compressToUTF16(transcript);
              chrome.storage.local.set({ [`transcript_${videoId}`]: compressed }, () => {
                console.log(`Saved transcript for video ${videoId} in chrome storage from server cache.`);
                sendResponse({ success: true, videoId, cached: true });
              });
              return;
            }
            // Otherwise, the server has started a new transcription job.
            const jobId = data.jobId;
            activeJobs[tabId] = { jobId, pollInterval: null };
            console.log("Job started with jobId:", jobId);
            // Poll every second for job status.
            const pollInterval = setInterval(() => {
              fetch(`http://localhost:5010/api/status?jobId=${jobId}`)
                .then(res => res.json())
                .then(statusData => {
                  if (statusData.status === "downloading") {
                    updateUI(tabId, "Downloading...", "#1a73e8");
                  } else if (statusData.status === "transcribing") {
                    updateUI(tabId, "Transcribing...", "#1a73e8");
                  } else if (statusData.status === "done") {
                    clearInterval(pollInterval);
                    delete activeJobs[tabId];
                    updateUI(tabId, "Done!", "green");
                    const transcript = LZString.decompressFromBase64(statusData.transcript);
                    const compressed = LZString.compressToUTF16(transcript);
                    chrome.storage.local.set({ [`transcript_${videoId}`]: compressed }, () => {
                      console.log(`Compressed and saved transcript under transcript_${videoId}`);
                      sendResponse({ success: true, videoId });
                    });
                  } else if (statusData.status === "error") {
                    clearInterval(pollInterval);
                    delete activeJobs[tabId];
                    updateUI(tabId, "Error", "red");
                    sendResponse({ success: false, error: statusData.error });
                  }
                })
                .catch(err => {
                  console.error("Error during polling:", err);
                });
            }, 1000);
            activeJobs[tabId].pollInterval = pollInterval;
          })
          .catch(err => {
            console.error("Transcription error:", err);
            updateUI(tabId, "Error", "red");
            sendResponse({ success: false, error: err.message });
          });
      }
    });
    return true;
  } else if (message.action === "killJob") {
    // Kill active job when user clicks the close ("✖") button.
    const tabId = sender.tab.id;
    if (activeJobs[tabId] && activeJobs[tabId].jobId) {
      const jobId = activeJobs[tabId].jobId;
      clearInterval(activeJobs[tabId].pollInterval);
      delete activeJobs[tabId];
      fetch(`http://localhost:5010/api/kill?jobId=${jobId}`, { method: "POST" })
        .then(res => res.json())
        .then(data => {
          console.log("Kill job response:", data);
          updateUI(tabId, "Cancelled", "red");
          sendResponse({ success: true });
        })
        .catch(err => {
          console.error("Error killing job:", err);
          sendResponse({ success: false, error: err.message });
        });
    } else {
      console.log("No active job to kill for tab", tabId);
      sendResponse({ success: false, error: "No active job" });
    }
    return true;
  }
});

/**
 * Updates UI on the content page.
 * - The button (id "yt-ai-btn") text is updated.
 * - The container (id "yt-ai-container") background color is updated.
 *
 * @param {number} tabId - The tab id.
 * @param {string} buttonText - The new button text.
 * @param {string} containerColor - The new background color.
 */
function updateUI(tabId, buttonText, containerColor) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (btnText, bgColor) => {
      const btn = document.getElementById("yt-ai-btn");
      if (btn) { btn.innerText = btnText; }
      const container = document.getElementById("yt-ai-container");
      if (container) { container.style.backgroundColor = bgColor; }
    },
    args: [buttonText, containerColor]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Script injection error:", chrome.runtime.lastError);
    }
  });
}
