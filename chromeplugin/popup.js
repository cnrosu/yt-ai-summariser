let currentModel = "gpt-4o";
let storedApiKey = "";

document.addEventListener("DOMContentLoaded", () => {
  const transcriptBox = document.getElementById("transcriptBox");
  const qaContainer = document.getElementById("qaContainer");
  const chatInput = document.getElementById("chatInput");
  const suggested = document.getElementById("suggested");

  chrome.storage.sync.get(["apiKey", "model"], (res) => {
    if (res.apiKey) {
      storedApiKey = res.apiKey;
    }
    if (res.model) {
      currentModel = res.model;
    }
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  });

  async function handleQuestion(question) {
    const apiKey = storedApiKey;
    const transcript = transcriptBox.value.trim();
    if (!question || !apiKey || !transcript || transcript.startsWith("Transcript not found")) {
      alert("Please ensure transcript is loaded and your API key is saved in settings.");
      return;
    }
    const details = document.createElement("details");
    details.className = "card";
    const summary = document.createElement("summary");
    summary.textContent = question;
    const answerDiv = document.createElement("div");
    answerDiv.innerHTML = "Loading...";
    details.appendChild(summary);
    details.appendChild(answerDiv);
    qaContainer.prepend(details);

    const messages = [
      {
        role: "system",
        content:
          "You are a helpful assistant. Provide concise answers in raw HTML only.",
      },
      { role: "user", content: `Transcript:\n${transcript}` },
      { role: "user", content: `Question:\n${question}` },
    ];

    const reply = await sendToGPT(messages, apiKey);
    answerDiv.innerHTML = cleanReply(reply);
  }

  document.getElementById("chatSend").addEventListener("click", () => {
    const q = chatInput.value.trim();
    if (!q) return;
    handleQuestion(q);
    chatInput.value = "";
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chatSend").click();
    }
  });

  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      let prompt = "";
      if (btn.dataset.type === "summary") {
        prompt = "Give me a concise summary of the transcript.";
      } else if (btn.dataset.type === "fact") {
        prompt = "Fact check the statements in the transcript.";
      } else if (btn.dataset.type === "insights") {
        prompt = "Provide actionable insights based on the transcript.";
      }
      handleQuestion(prompt);
    });
  });

  function getVideoId(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      try {
        const url = new URL(tabs[0]?.url || "");
        const videoId = url.searchParams.get("v");
        callback(videoId);
      } catch (err) {
        console.error("Failed to extract video ID", err);
        callback(null);
      }
    });
  }

  function loadTranscript(videoId) {
    const key = `transcript_${videoId}`;
    chrome.storage.local.get(key, (result) => {
      const compressed = result[key];
      if (!compressed) {
        transcriptBox.value = "Transcript not found. Try reloading.";
        return;
      }
      let transcript = LZString.decompressFromUTF16(compressed);
      if (transcript === null) {
        // Fall back for data saved without compression
        transcript = compressed;
      }
      transcriptBox.value = transcript;
      generateSuggestions();
    });
  }

  async function generateSuggestions() {
    if (!storedApiKey) return;
    const transcript = transcriptBox.value.trim();
    if (!transcript) return;
    suggested.textContent = "Loading questions...";
    const messages = [
      {
        role: "system",
        content:
          "Suggest three brief questions a viewer might ask about this transcript. Respond with each question on a new line and no numbering.",
      },
      { role: "user", content: transcript.slice(0, 4000) },
    ];
    const reply = await sendToGPT(messages, storedApiKey);
    suggested.innerHTML = "";
    reply
      .split(/\n|\r/)
      .map((q) => q.trim())
      .filter((q) => q)
      .forEach((q) => {
        const b = document.createElement("button");
        b.textContent = q;
        b.addEventListener("click", () => handleQuestion(q));
        suggested.appendChild(b);
      });
  }

  function cleanReply(text) {
    return (text || "").replace(/```(?:html)?|```/g, "").trim();
  }

  async function sendToGPT(messages, apiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: currentModel, messages }),
      });
      const data = await res.json();
      if (data.error) {
        return `Error: ${data.error.message}`;
      }
      return data.choices?.[0]?.message?.content || "";
    } catch (err) {
      console.error("GPT request failed", err);
      return "Failed to get a response.";
    }
  }

  getVideoId((videoId) => {
    if (videoId) {
      loadTranscript(videoId);
    } else {
      transcriptBox.value = "Could not detect YouTube video ID.";
    }
  });
});
