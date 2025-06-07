import { createWhisper } from './whisper-wrapper.js';

(async () => {
  const status = document.getElementById("status");
  const transcriptBox = document.getElementById("transcriptBox");

  chrome.storage.local.get("audioBuffer", async ({ audioBuffer }) => {
    if (!audioBuffer) return status.innerText = "No audio found.";

    const whisper = await createWhisper({
      wasmPath: "https://yourcdn.com/whisper/main.wasm",
      modelPath: "https://yourcdn.com/whisper/ggml-base.en.bin"
    });

    const result = await whisper.transcribe(audioBuffer);
    transcriptBox.value = result.text;
    status.innerText = "Done!";
  });
})();

document.getElementById("askBtn").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value;
  const prompt = document.getElementById("userPrompt").value;
  const transcript = document.getElementById("transcriptBox").value;

  const responseBox = document.getElementById("responseBox");
  responseBox.innerText = "Thinking...";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You're an assistant summarizing and answering questions about the transcript." },
        { role: "user", content: `Transcript:\n${transcript}` },
        { role: "user", content: prompt }
      ]
    })
  });

  const data = await res.json();
  responseBox.innerText = data.choices[0].message.content;
});
