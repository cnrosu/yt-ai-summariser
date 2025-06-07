chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "transcribe") {
    fetch("http://localhost:5010/download-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: message.url })
    })
    .then(res => res.json())
    .then(data => {
      const audioBuffer = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0)).buffer;
      chrome.storage.local.set({ audioBuffer }, () => {
        chrome.notifications.create({
          title: "Transcription Ready",
          message: "Click to open AI chat.",
          iconUrl: "icons/icon48.png",
          type: "basic"
        });
        chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
      });
    });
  }
});
