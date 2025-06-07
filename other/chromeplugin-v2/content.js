function addButton() {
  const btn = document.createElement("button");
  btn.textContent = "Transcribe with AI";
  btn.style = "position:fixed;top:100px;right:20px;z-index:9999;background:#1a73e8;color:white;padding:10px;";
  btn.onclick = () => {
    chrome.runtime.sendMessage({ action: "transcribe", url: window.location.href });
    btn.disabled = true;
    btn.textContent = "Transcribing…";
  };
  document.body.appendChild(btn);
}

window.addEventListener("load", () => {
  setTimeout(addButton, 2000);
});
