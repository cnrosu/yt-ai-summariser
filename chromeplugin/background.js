importScripts("lz-string.min.js");

// Global mapping: track active job IDs per tab. Polling now happens in content.js.
const activeJobs = {};

chrome.tabs.onRemoved.addListener((tabId) => {
  const job = activeJobs[tabId];
  if (job && job.jobId) {
    fetch(`http://localhost:5010/api/kill?jobId=${job.jobId}`, { method: "POST" })
      .catch(err => console.error("Error killing job on tab close:", err));
    delete activeJobs[tabId];
  }
});

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
        // Clear any record of a previous job for this tab.
        if (activeJobs[tabId]) {
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
              updateUI(tabId, data.error, "red");
              sendResponse({ success: false, error: data.error });
              return;
            }
            // NEW: If server indicates that the transcript was already cached,
            // it should have returned a JSON with "cached": true and a "transcript" field.
            if (data.cached) {
              console.log("Server returned cached transcript for video:", videoId);
              updateUI(tabId, "Done!", "green");
              const transcript = data.transcript;
              const compressed = LZString.compressToUTF16(transcript);
              chrome.storage.local.set({ [`transcript_${videoId}`]: compressed }, () => {
                console.log(`Saved transcript for video ${videoId} in chrome storage from server cache.`);
                sendResponse({ success: true, videoId, cached: true });
              });
              return;
            }
            // Otherwise, the server has started a new transcription job.
            const jobId = data.jobId;
            activeJobs[tabId] = { jobId };
            console.log("Job started with jobId:", jobId);
            // Content script will poll for status.
            sendResponse({ success: true, videoId, jobId });
            return;
          })
          .catch(err => {
            console.error("Transcription error:", err);
            updateUI(tabId, "Server offline. Click to Retry \u27F3", "red", true);
            sendResponse({ success: false, error: err.message });
          });
      }
    });
    return true;
  } else if (message.action === "killJob") {
    // Kill active job when user clicks the close ("✖") button.
    const tabId = sender.tab.id;
    const jobId = message.jobId || (activeJobs[tabId] && activeJobs[tabId].jobId);
    if (jobId) {
      if (activeJobs[tabId]) {
        delete activeJobs[tabId];
      }
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
  } else if (message.action === "openPopup") {
    chrome.action.openPopup(() => {
      if (chrome.runtime.lastError) {
        console.error("Failed to open popup", chrome.runtime.lastError);
        sendResponse({ success: false });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  } else if (message.action === "processTranscript") {
    const { videoId, transcript } = message;
    const tabId = sender.tab.id;
    (async () => {
      const apiKey = await getApiKey();
      if (!apiKey) {
        updateUI(tabId, "Missing API Key", "red");
        sendResponse({ success: false });
        return;
      }
      let fileId = await checkExistingFile(videoId, apiKey);
      let uploaded = false;
      if (!fileId) {
        fileId = await uploadTranscriptFile(videoId, transcript, apiKey);
        if (!fileId) {
          updateUI(tabId, "Upload failed", "red", false);
          sendResponse({ success: false });
          return;
        }
        await waitForFile(fileId, apiKey);
        chrome.storage.local.set({ [`file_${videoId}`]: fileId });
        uploaded = true;
      }
      updateUI(tabId, "Done!", "green");
      sendResponse({ success: true, uploaded });
      if (uploaded) chrome.action.openPopup(() => {});
    })();
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
function updateUI(tabId, buttonText, containerColor, disableBtn = false) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (btnText, bgColor, disable) => {
      const btn = document.getElementById("yt-ai-btn");
      if (btn) { 
        btn.innerText = btnText;
        btn.disabled = disable;
      }
      const container = document.getElementById("yt-ai-container");
      if (container) { container.style.backgroundColor = bgColor; }
    },
    args: [buttonText, containerColor, disableBtn]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Script injection error:", chrome.runtime.lastError);
    }
  });
}

function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["keyLocation"], (res) => {
      const location = res.keyLocation || "sync";
      const storage = location === "local" ? chrome.storage.local : chrome.storage.sync;
      storage.get(["apiKey"], (r) => {
        resolve(r.apiKey || null);
      });
    });
  });
}

async function checkExistingFile(videoId, apiKey) {
  const key = `file_${videoId}`;
  return new Promise((resolve) => {
    chrome.storage.local.get(key, async (res) => {
      let id = res[key];
      if (id) {
        try {
          const r = await fetch(`https://api.openai.com/v1/files/${id}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (r.ok) {
            const data = await r.json();
            if (data.status === "processed") {
              resolve(id);
              return;
            }
          }
        } catch (err) {
          console.error("File check error", err);
        }
      }
      try {
        const r = await fetch("https://api.openai.com/v1/files?purpose=assistants", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const data = await r.json();
        if (Array.isArray(data.data)) {
          const match = data.data.find(
            (f) => f.filename === `${videoId}.txt` && f.status === "processed"
          );
          if (match) {
            chrome.storage.local.set({ [key]: match.id });
            resolve(match.id);
            return;
          }
        }
      } catch (err) {
        console.error("File list error", err);
      }
      resolve(null);
    });
  });
}

async function uploadTranscriptFile(videoId, transcript, apiKey) {
  const form = new FormData();
  form.append("purpose", "assistants");
  form.append(
    "file",
    new Blob([transcript], { type: "text/plain" }),
    `${videoId}.txt`
  );
  try {
    const res = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("File upload error", data);
      return null;
    }
    return data.id;
  } catch (err) {
    console.error("Upload failed", err);
    return null;
  }
}

async function waitForFile(id, apiKey) {
  try {
    while (true) {
      const res = await fetch(`https://api.openai.com/v1/files/${id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      if (data.status === "processed") {
        return true;
      }
      if (data.status === "error") {
        return false;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error("File poll error", err);
    return false;
  }
}
