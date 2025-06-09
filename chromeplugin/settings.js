document.addEventListener("DOMContentLoaded", () => {
  const modelSelect = document.getElementById("modelSelect");
  const apiKeyInput = document.getElementById("apiKey");
  const status = document.getElementById("statusMsg");

  chrome.storage.sync.get(["model", "apiKey"], (res) => {
    if (res.model) {
      modelSelect.value = res.model;
    }
    if (res.apiKey) {
      apiKeyInput.value = res.apiKey;
    }
  });

  document.getElementById("saveSettings").addEventListener("click", () => {
    const selectedModel = modelSelect.value;
    const apiKey = apiKeyInput.value.trim();
    chrome.storage.sync.set({ model: selectedModel, apiKey }, () => {
      status.style.display = "inline";
      setTimeout(() => (status.style.display = "none"), 1500);
    });
  });
});
