chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "transcribe") {
    const port = chrome.runtime.connectNative("yt_ai_host");
    port.postMessage({ url: msg.url });

    port.onMessage.addListener((response) => {
      chrome.storage.local.set({ transcript: response.transcript });
      chrome.runtime.sendMessage({ action: "transcription_done" });
    });

    port.onDisconnect.addListener(() => {
      console.error("Disconnected from native host");
    });
  }
});
