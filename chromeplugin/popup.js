let currentModel = "gpt-4o";
let storedApiKey = "";
let currentVideoId = null;
let qaHistory = [];
let assistantId = "";
const DEFAULT_ASSISTANT_NAME = "asst_youtranscribe_default";
let threadId = null;

async function loadAssistants(apiKey) {
  const container = document.getElementById("agentList");
  if (!container || !apiKey) return;
  container.innerHTML = "";
  try {
    const res = await fetch("https://api.openai.com/v1/assistants?limit=100", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });
    const data = await res.json();
    (data.data || []).forEach((a) => {
      const details = document.createElement("details");
      details.className = "card";
      const summary = document.createElement("summary");
      summary.textContent = a.name || a.id;
      details.appendChild(summary);
      const info = document.createElement("div");
      info.textContent = "";
      details.appendChild(info);
      const selectBtn = document.createElement("button");
      selectBtn.className = "select-agent-btn";
      selectBtn.textContent = "Select Agent";
      selectBtn.addEventListener("click", () => {
        chrome.storage.sync.set({ assistantId: a.id }, () => {
          assistantId = a.id;
          const input = document.getElementById("assistantId");
          if (input) input.value = a.id;
          const status = document.getElementById("agentStatus");
          if (status) {
            status.textContent = "Saved!";
            status.style.display = "inline";
            setTimeout(() => (status.style.display = "none"), 1500);
          }
        });
      });
      info.appendChild(selectBtn);
      details.addEventListener("toggle", async () => {
        if (!details.open || info.dataset.loaded) return;
        const d = await fetch(`https://api.openai.com/v1/assistants/${a.id}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Beta": "assistants=v2",
          },
        });
        const full = await d.json();
        info.innerHTML = `<p><b>Description:</b> ${full.description || ""}</p>` +
          `<p><b>Instructions:</b> ${full.instructions || ""}</p>` +
          `<p><b>Model:</b> ${full.model}</p>` +
          `<p><b>Temperature:</b> ${full.temperature ?? ""}</p>` +
          `<p><b>Top P:</b> ${full.top_p ?? ""}</p>`;
        info.dataset.loaded = "1";
      });
      container.appendChild(details);
    });
  } catch (err) {
    console.error("Failed to load assistants", err);
  }
}

async function createCustomAssistant(apiKey) {
  const body = {
    model: document.getElementById("newModel").value,
    name: document.getElementById("newName").value.trim(),
    description: document.getElementById("newDescription").value.trim(),
    instructions: document.getElementById("newInstructions").value.trim(),
    temperature: parseFloat(document.getElementById("newTemp").value),
    top_p: parseFloat(document.getElementById("newTopP").value),
    response_format: { type: document.getElementById("newResponseFormat").value },
    metadata: { reasoning_effort: document.getElementById("newReasoning").value },
    tools: Array.from(document.querySelectorAll("input[name='tool']:checked"))
      .map((c) => ({ type: c.value })),
  };
  try {
    const res = await fetch("https://api.openai.com/v1/assistants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.id) {
      await loadAssistants(apiKey);
      const status = document.getElementById("agentStatus");
      if (status) {
        status.textContent = "Assistant created!";
        status.style.display = "inline";
        setTimeout(() => (status.style.display = "none"), 1500);
      }
    } else {
      alert("Failed to create assistant.");
    }
  } catch (err) {
    console.error("Failed to create assistant", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const transcriptBox = document.getElementById("transcriptBox");
  const qaContainer = document.getElementById("qaContainer");
  const chatInput = document.getElementById("chatInput");
  const suggested = document.getElementById("suggested");

  function switchTab(id) {
    document.querySelectorAll(".tab-content").forEach((div) =>
      div.classList.add("hidden")
    );
    document.getElementById(id).classList.remove("hidden");
    document.querySelectorAll(".tab-link").forEach((b) =>
      b.classList.remove("active")
    );
    const btn = document.querySelector(`.tab-link[data-tab="${id}"]`);
    if (btn) btn.classList.add("active");
  }

  function switchSubTab(id) {
    document.querySelectorAll("#agentsTab .sub-tab-content").forEach((div) =>
      div.classList.add("hidden")
    );
    document.getElementById(id).classList.remove("hidden");
    document.querySelectorAll("#agentsTab .sub-tab-link").forEach((b) =>
      b.classList.remove("active")
    );
    const btn = document.querySelector(
      `#agentsTab .sub-tab-link[data-sub-tab="${id}"]`
    );
    if (btn) btn.classList.add("active");
  }

  document.querySelectorAll(".tab-link").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document
    .querySelectorAll("#agentsTab .sub-tab-link")
    .forEach((btn) => btn.addEventListener("click", () => switchSubTab(btn.dataset.subTab)));

  chrome.storage.sync.get(["model", "keyLocation", "assistantId"], (res) => {
    if (res.model) {
      currentModel = res.model;
      const sel = document.getElementById("modelSelect");
      if (sel) sel.value = res.model;
    }
    if (res.assistantId) {
      assistantId = res.assistantId;
      const input = document.getElementById("assistantId");
      if (input) input.value = res.assistantId;
      console.log("Loaded Assistant ID from storage:", assistantId);
    }
    const location = res.keyLocation || "sync";
    const locSel = document.getElementById("keyLocation");
    if (locSel) locSel.value = location;
    const storage = location === "local" ? chrome.storage.local : chrome.storage.sync;
    storage.get(["apiKey"], async (r) => {
      if (r.apiKey) {
        storedApiKey = r.apiKey;
        const keyInput = document.getElementById("apiKey");
        if (keyInput) keyInput.value = r.apiKey;
        await loadAssistants(r.apiKey);
        if (!assistantId) {
          console.log("No assistant ID found, creating standard assistant");
          assistantId = await createStandardAssistant(r.apiKey);
          if (assistantId) {
            chrome.storage.sync.set({ assistantId });
            console.log("Stored new Assistant ID", assistantId);
          }
        }
        if (transcriptBox.value.trim()) {
          generateSuggestions();
        }
      }
    });
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    switchTab("settingsTab");
  });

  document.getElementById("newTemp")?.addEventListener("input", (e) => {
    document.getElementById("tempVal").textContent = e.target.value;
  });
  document.getElementById("newTopP")?.addEventListener("input", (e) => {
    document.getElementById("topPVal").textContent = e.target.value;
  });

  function showCopyPopup(el) {
    const popup = document.createElement("span");
    popup.className = "copy-popup";
    popup.textContent = "\ud83d\udccb Copied";
    el.appendChild(popup);
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
  }

  function attachInteractions(wrapper, details, answerDiv, question) {
    let startX;
    let timer;
    const summary = details.querySelector("summary");

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

    const delIcon = document.createElement("span");
    delIcon.className = "delete-icon";
    delIcon.textContent = "\u274c";
    delIcon.title = "Delete";
    delIcon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.remove();
      removeQA(question);
    });
    wrapper.appendChild(delIcon);
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
          () => {
            wrapper.remove();
            removeQA(question);
          },
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
      alert("Missing API key. Please enter it on the settings tab.");
      return;
    }
    if (!transcript || transcript.startsWith("Transcript not found")) {
      alert("Transcript not loaded yet. Try transcribing the video first.");
      return;
    }
    if (!question) return;
    const wrapper = document.createElement("div");
    wrapper.className = "qa-item";

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
    wrapper.appendChild(details);
    qaContainer.prepend(wrapper);
    attachInteractions(wrapper, details, answerDiv, question);

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

  const saveStatus = document.getElementById("statusMsg");
  document.getElementById("saveSettings")?.addEventListener("click", () => {
    const selectedModel = document.getElementById("modelSelect").value;
    const apiKey = document.getElementById("apiKey").value.trim();
    const keyLocation = document.getElementById("keyLocation").value;
    chrome.storage.sync.set({ model: selectedModel, keyLocation }, () => {
      const storage =
        keyLocation === "local" ? chrome.storage.local : chrome.storage.sync;
      storage.set({ apiKey }, () => {
        currentModel = selectedModel;
        storedApiKey = apiKey;
        if (saveStatus) {
          saveStatus.textContent = "Saved!";
          saveStatus.style.display = "inline";
          setTimeout(() => (saveStatus.style.display = "none"), 1500);
        }
      });
    });
  });

  const agentStatus = document.getElementById("agentStatus");
  document.getElementById("saveAgent")?.addEventListener("click", () => {
    const id = document.getElementById("assistantId").value.trim();
    chrome.storage.sync.set({ assistantId: id }, () => {
      assistantId = id;
      if (agentStatus) {
        agentStatus.textContent = "Saved!";
        agentStatus.style.display = "inline";
        setTimeout(() => (agentStatus.style.display = "none"), 1500);
      }
    });
  });

  document.getElementById("createCustomAssistant")?.addEventListener("click", async () => {
    const apiKey = storedApiKey || document.getElementById("apiKey").value.trim();
    if (!apiKey) {
      alert("Enter your API key first.");
      return;
    }
    await createCustomAssistant(apiKey);
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
        const wrapper = document.createElement("div");
        wrapper.className = "qa-item";

        const details = document.createElement("details");
        details.className = "card fade-in";
        const summary = document.createElement("summary");
        summary.textContent = item.question;
        const answerDiv = document.createElement("div");
        answerDiv.innerHTML = item.answer;
        details.appendChild(summary);
        details.appendChild(answerDiv);
        wrapper.appendChild(details);
        qaContainer.prepend(wrapper);
        attachInteractions(wrapper, details, answerDiv, item.question);
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

  function removeQA(question) {
    if (!currentVideoId) return;
    const key = `qa_${currentVideoId}`;
    chrome.storage.local.get(key, (res) => {
      let arr = res[key] || [];
      arr = arr.filter((item) => item.question !== question);
      chrome.storage.local.set({ [key]: arr });
      qaHistory = arr.slice();
    });
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
      console.log("Loaded thread ID from storage:", threadId);
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
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      threadId = data.id;
      console.log("Created thread with ID", threadId);
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
    console.log("Using thread ID", threadId);
    if (!threadId) {
      return "Failed to create thread.";
    }
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    };
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content }),
    });
    console.log("Posted user message to thread");
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
    console.log("Run created", runId);
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
    console.log("Assistant reply received");
    return msgData.data?.[0]?.content?.[0]?.text?.value || "";
  }

  async function createAssistant(apiKey, name) {
    console.log("Creating assistant", name);
    try {
      const res = await fetch("https://api.openai.com/v1/assistants", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          model: currentModel,
          name,
          instructions:
            "You are a YouTube video transcription AI. Answer questions about the provided transcript in concise HTML.",
        }),
      });
      const data = await res.json();
      console.log("Assistant API response", data);
      if (!res.ok) {
        console.error("Assistant API error", data);
        alert(
          "Failed to create assistant: " +
            (data.error?.message || JSON.stringify(data))
        );
        return null;
      }
      if (data.id) console.log("Created assistant ID", data.id);
      return data.id || null;
    } catch (err) {
      console.error("Failed to create assistant", err);
      return null;
    }
  }

  async function createStandardAssistant(apiKey) {
    return createAssistant(apiKey, DEFAULT_ASSISTANT_NAME);
  }

  async function ensureDefaultAssistant(apiKey) {
    console.log("Ensuring default assistant exists");
    try {
      const list = await fetch(
        "https://api.openai.com/v1/assistants?limit=100",
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Beta": "assistants=v2",
          },
        }
      );
      const data = await list.json();
      const found = data.data?.find((a) => a.name === DEFAULT_ASSISTANT_NAME);
      if (found) {
        console.log("Found existing default assistant", found.id);
        return found.id;
      }
      return await createAssistant(apiKey, DEFAULT_ASSISTANT_NAME);
    } catch (err) {
      console.error("Failed to list assistants", err);
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
