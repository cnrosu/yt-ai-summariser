document.addEventListener("DOMContentLoaded", () => {
  const modelSelect = document.getElementById("modelSelect");
  const apiKeyInput = document.getElementById("apiKey");
  const keyLocationSelect = document.getElementById("keyLocation");
  const assistantInput = document.getElementById("assistantId");
  const status = document.getElementById("statusMsg");
  const createBtn = document.getElementById("createAssistant");

  chrome.storage.sync.get(["model", "keyLocation", "assistantId"], (res) => {
    if (res.model) {
      modelSelect.value = res.model;
    }
    const location = res.keyLocation || "sync";
    keyLocationSelect.value = location;
    if (res.assistantId) {
      assistantInput.value = res.assistantId;
    }
    const storage = location === "local" ? chrome.storage.local : chrome.storage.sync;
    storage.get(["apiKey"], (r) => {
      if (r.apiKey) {
        apiKeyInput.value = r.apiKey;
      }
    });
  });

  document.getElementById("saveSettings").addEventListener("click", () => {
    const selectedModel = modelSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const keyLocation = keyLocationSelect.value;
    const assistantId = assistantInput.value.trim();

    chrome.storage.sync.set({ model: selectedModel, keyLocation, assistantId }, () => {
      const storage = keyLocation === "local" ? chrome.storage.local : chrome.storage.sync;
      storage.set({ apiKey }, () => {
        status.style.display = "inline";
        setTimeout(() => (status.style.display = "none"), 1500);
      });
    });
  });

  createBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      alert("Enter your API key first.");
      return;
    }
    const id = await createStandardAssistant(apiKey);
    if (id) {
      assistantInput.value = id;
      chrome.storage.sync.set({ assistantId: id }, () => {
        status.textContent = "Assistant created!";
        status.style.display = "inline";
        setTimeout(() => (status.style.display = "none"), 1500);
      });
    } else {
      alert("Failed to create assistant.");
    }
  });

  async function createStandardAssistant(apiKey) {
    console.log("Creating standard assistant from settings");
    try {
      const res = await fetch("https://api.openai.com/v1/assistants", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          model: modelSelect.value,
          name: "asst_YouTranscribe",
          instructions:
            "You are a YouTube video transcription AI. Answer questions about the provided transcript in concise HTML.",
        }),
      });
      const data = await res.json();
      console.log("Assistant API response", data);
      if (data.id) console.log("Created assistant ID", data.id);
      return data.id || null;
    } catch (err) {
      console.error("Failed to create assistant", err);
      return null;
    }
  }
});
