let currentModel = "gpt-4o";
let storedApiKey = "";
let currentVideoId = null;
let qaHistory = [];
let assistantId = "";
let threadId = null;

document.addEventListener("DOMContentLoaded", () => {
  const transcriptBox = document.getElementById("transcriptBox");
  const qaContainer = document.getElementById("qaContainer");
  const chatInput = document.getElementById("chatInput");
  const suggested = document.getElementById("suggested");

  chrome.storage.sync.get(["model", "keyLocation", "assistantId"], (res) => {
    if (res.model) {
      currentModel = res.model;
    }
    if (res.assistantId) {
      assistantId = res.assistantId;
    }
    const location = res.keyLocation || "sync";
    const storage = location === "local" ? chrome.storage.local : chrome.storage.sync;
    storage.get(["apiKey"], async (r) => {
      if (r.apiKey) {
        storedApiKey = r.apiKey;
        if (!assistantId) {
          assistantId = await createStandardAssistant(r.apiKey);
          if (assistantId) {
            chrome.storage.sync.set({ assistantId });
          }
        }
        if (transcriptBox.value.trim()) {
          generateSuggestions();
        }
      }
    });
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  });

  function showCopyPopup(el) {
    const popup = document.createElement("span");
    popup.className = "copy-popup";
    popup.textContent = "\ud83d\udccb Copied";
    el.appendChild(popup);
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
  }

  function attachInteractions(details, answerDiv) {
    let startX;
    let timer;
    const copyIcon = document.createElement("span");
    copyIcon.className = "copy-icon";
    copyIcon.textContent = "\ud83d\udccb";
    copyIcon.title = "Copy";
    copyIcon.addEventListener("click", () => {
      navigator.clipboard.writeText(answerDiv.innerText || "").catch(() => {});
      details.classList.add("copied");
      showCopyPopup(details);
      setTimeout(() => details.classList.remove("copied"), 800);
    });
    details.appendChild(copyIcon);
    details.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      timer = setTimeout(() => {
        navigator.clipboard.writeText(answerDiv.innerText || "").catch(() => {});
        details.classList.add("copied");
        showCopyPopup(details);
        setTimeout(() => details.classList.remove("copied"), 800);
      }, 600);
    });
    details.addEventListener("pointerup", (e) => {
      clearTimeout(timer);
      if (startX !== undefined && Math.abs(e.clientX - startX) > 80) {
        details.classList.add("swipe-remove");
        details.addEventListener(
          "transitionend",
          () => details.remove(),
          { once: true }
        );
      }
      startX = undefined;
    });
    details.addEventListener("pointerleave", () => clearTimeout(timer));
  }

  async function handleQuestion(question) {
    const apiKey = storedApiKey;
    const transcript = transcriptBox.value.trim();
    if (!apiKey) {
      alert("Missing API key. Please enter it on the settings page.");
      return;
    }
    if (!transcript || transcript.startsWith("Transcript not found")) {
      alert("Transcript not loaded yet. Try transcribing the video first.");
      return;
    }
    if (!question) return;
    const details = document.createElement("details");
    details.className = "card fade-in loading";
    const summary = document.createElement("summary");
    summary.addEventListener("click", (e) => {
      if (details.classList.contains("loading")) {
        e.preventDefault();
      }
    });
    summary.textContent = question + " ";
    const loader = document.createElement("span");
    loader.className = "loader";
    summary.appendChild(loader);
    const answerDiv = document.createElement("div");
    answerDiv.innerHTML = "Loading...";
    details.appendChild(summary);
    details.appendChild(answerDiv);
    qaContainer.prepend(details);
    attachInteractions(details, answerDiv);

    const first = qaHistory.length === 0;
    const content = first
      ? `Transcript:\n${transcript}\n\nQuestion:\n${question}`
      : question;

    const reply = await sendViaAssistant(content, apiKey);
    const clean = cleanReply(reply);
    answerDiv.innerHTML = clean;
    summary.removeChild(loader);
    details.classList.remove("loading");
    details.open = true;
    saveQA(question, clean);
    qaHistory.push({ question, answer: clean });
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
      const transcript = LZString.decompressFromUTF16(compressed);
      if (transcript) {
        transcriptBox.value = transcript;
      } else {
        transcriptBox.value = "Error decompressing transcript.";
        return;
      }
      generateSuggestions();
    });
  }

  function loadQA(videoId) {
    const key = `qa_${videoId}`;
    chrome.storage.local.get(key, (res) => {
      const arr = res[key] || [];
      qaHistory = arr.slice();
      arr.forEach((item) => {
        const details = document.createElement("details");
        details.className = "card fade-in";
        const summary = document.createElement("summary");
        summary.textContent = item.question;
        const answerDiv = document.createElement("div");
        answerDiv.innerHTML = item.answer;
        details.appendChild(summary);
        details.appendChild(answerDiv);
        qaContainer.prepend(details);
        attachInteractions(details, answerDiv);
      });
    });
  }

  function saveQA(question, answer) {
    if (!currentVideoId) return;
    const key = `qa_${currentVideoId}`;
    chrome.storage.local.get(key, (res) => {
      const arr = res[key] || [];
      arr.push({ question, answer });
      chrome.storage.local.set({ [key]: arr });
      qaHistory = arr.slice();
    });
    fetch("http://localhost:5010/api/save_qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: currentVideoId, question, answer }),
    }).catch((err) => console.error("Failed to save QA", err));
  }

  async function generateSuggestions() {
    if (!storedApiKey) return;
    const transcript = transcriptBox.value.trim();
    if (
      !transcript ||
      transcript.startsWith("Transcript not found") ||
      transcript.startsWith("Error decompressing") ||
      transcript.startsWith("Could not detect")
    ) {
      return;
    }
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

  function loadThread(videoId) {
    const key = `thread_${videoId}`;
    chrome.storage.local.get(key, (res) => {
      threadId = res[key] || null;
    });
  }

  async function ensureThread() {
    if (threadId) return;
    try {
      const res = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${storedApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      threadId = data.id;
      if (currentVideoId && threadId) {
        chrome.storage.local.set({ [`thread_${currentVideoId}`]: threadId });
      }
    } catch (err) {
      console.error("Failed to create thread", err);
    }
  }

  async function sendViaAssistant(content, apiKey) {
    if (!assistantId) {
      return "Assistant ID not set.";
    }
    await ensureThread();
    if (!threadId) {
      return "Failed to create thread.";
    }
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content }),
    });
    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id: assistantId }),
    });
    const run = await runRes.json();
    if (run.error) {
      return `Error: ${run.error.message}`;
    }
    const runId = run.id;
    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      const statusRes = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        { headers }
      );
      const data = await statusRes.json();
      if (data.status === "completed") break;
      if (["failed", "cancelled", "expired"].includes(data.status)) {
        return `Error: run ${data.status}`;
      }
    }
    const msgRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages?limit=1`,
      { headers }
    );
    const msgData = await msgRes.json();
    return msgData.data?.[0]?.content?.[0]?.text?.value || "";
  }

  async function createStandardAssistant(apiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/assistants", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: currentModel,
          name: "YouTranscribe",
          instructions:
            "You are a YouTube video transcription AI. Answer questions about the provided transcript in concise HTML.",
        }),
      });
      const data = await res.json();
      return data.id || null;
    } catch (err) {
      console.error("Failed to create assistant", err);
      return null;
    }
  }

  getVideoId((videoId) => {
    if (videoId) {
      currentVideoId = videoId;
      loadTranscript(videoId);
      loadQA(videoId);
      loadThread(videoId);
    } else {
      transcriptBox.value = "Could not detect YouTube video ID.";
    }
  });
});
