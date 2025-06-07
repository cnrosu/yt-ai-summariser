function addTranscribeButton() {
  if (document.getElementById("yt-ai-btn")) return;

  const btn = document.createElement("button");
  btn.id = "yt-ai-btn";
  btn.innerText = "Transcribe with AI";
  btn.style = "position:fixed;top:80px;right:20px;z-index:9999;padding:10px;background:#1a73e8;color:white;border:none;border-radius:4px;cursor:pointer;";
  
  btn.onclick = async () => {
    const videoUrl = window.location.href;
    chrome.runtime.sendMessage({ action: "transcribe", url: videoUrl });
    btn.innerText = "Transcribing...";
    btn.disabled = true;
  };

  document.body.appendChild(btn);
}

window.addEventListener('load', () => {
  setTimeout(addTranscribeButton, 3000); // Wait for YouTube to load
});
