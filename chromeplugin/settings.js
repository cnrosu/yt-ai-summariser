document.addEventListener("DOMContentLoaded", () => {
  const modelSelect = document.getElementById("modelSelect");
  const apiKeyInput = document.getElementById("apiKey");
  const keyLocationSelect = document.getElementById("keyLocation");
  const status = document.getElementById("statusMsg");

  chrome.storage.sync.get(["model", "keyLocation"], (res) => {
    if (res.model) {
      modelSelect.value = res.model;
    }
    const location = res.keyLocation || "sync";
    keyLocationSelect.value = location;
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

    chrome.storage.sync.set({ model: selectedModel, keyLocation }, () => {
      const storage = keyLocation === "local" ? chrome.storage.local : chrome.storage.sync;
      storage.set({ apiKey }, () => {
        status.style.display = "inline";
        setTimeout(() => (status.style.display = "none"), 1500);
      });
    });
  });
});
