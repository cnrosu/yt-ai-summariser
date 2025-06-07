let currentModel = "gpt-4o"; // Default model

document.addEventListener("DOMContentLoaded", () => {
  const transcriptBox = document.getElementById("transcriptBox");
  const responseBox = document.getElementById("responseBox");
  const apiKeyInput = document.getElementById("apiKey");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const chatInput = document.getElementById("chatInput");

  // 🔒 Load saved API key
  chrome.storage.sync.get("apiKey", (result) => {
    if (result.apiKey) {
      console.log("🔐 Loaded saved API key from storage.");
      apiKeyInput.value = result.apiKey;
    } else {
      console.log("⚠️ No API key saved yet.");
    }
  });

  // 🤖 Load saved model (if any)
  chrome.storage.sync.get("model", (res) => {
    if (res.model) {
      currentModel = res.model;
      console.log("🤖 Loaded model from sync:", currentModel);
    }
  });

async function handleChatSend() {
  const apiKey = apiKeyInput.value.trim();
  const transcript = transcriptBox.value.trim();
  const question = chatInput.value.trim();

  if (!question || !apiKey || !transcript || transcript.startsWith("Transcript not found")) {
    alert("Please ensure transcript is loaded and API key is entered.");
    return;
  }

  responseBox.classList.remove("hidden");
  responseBox.innerHTML = "Answering...";

	const messages = [
	  {
		role: "system",
		content: "You are a helpful assistant. When answering, please provide your response as clean, semantic HTML that is ready to be injected via innerHTML. Do not include markdown code fences or extraneous preformatted formatting. Structure your answer with appropriate tags (e.g., <p>, <ul>, <li>, <strong>) so that it renders as rich formatted content."
	  },
	  { role: "user", content: `Transcript:\n${transcript}` },
	  { role: "user", content: `Question:\n${question}` }
	];

  const reply = await sendToGPT(messages, apiKey);
  responseBox.innerHTML = reply;
  chatInput.value = ""; // Clear the input
}

// Chat input event listener: sends the chat message when Enter is pressed
chatInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    await handleChatSend();
  }
});

// Ask button: sending the chat when clicking the button
document.getElementById("chatSend").addEventListener("click", async () => {
  await handleChatSend();
});


  // 🎥 Extract video ID from YouTube URL
  function getVideoId(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      try {
        const url = new URL(tabs[0]?.url || "");
        const videoId = url.searchParams.get("v");
        console.log("🎥 Current video ID:", videoId);
        callback(videoId);
      } catch (err) {
        console.error("❌ Failed to extract video ID:", err);
        callback(null);
      }
    });
  }

  // 📜 Load and decompress transcript from local storage
  function loadTranscript(videoId) {
    const key = `transcript_${videoId}`;
    chrome.storage.local.get(key, (result) => {
      const compressed = result[key];
      if (!compressed) {
        console.warn("📭 No transcript found for key:", key);
        transcriptBox.value = "Transcript not found. Try reloading.";
        return;
      }

      const transcript = LZString.decompressFromUTF16(compressed);
      if (transcript) {
        console.log("✅ Decompressed transcript for video:", videoId);
        transcriptBox.value = transcript;
      } else {
        console.error("⚠️ Failed to decompress transcript.");
        transcriptBox.value = "Error decompressing transcript.";
      }
    });
  }

  // 🧠 Shared function for sending message to GPT
  async function sendToGPT(messages, apiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: currentModel || "gpt-4o",
          messages
        })
      });

      const data = await res.json();
      console.log("📩 Full GPT response:", data);

      if (data.error) {
        console.error("⚠️ OpenAI error:", data.error);
        responseBox.innerText = "❌ GPT error: " + data.error.message;
        return;
      }

      const reply = data.choices?.[0]?.message?.content || "No response.";

      return reply;
    } catch (err) {
      console.error("❌ Network/GPT request error:", err);
      return "❌ Failed to get a response.";
    }
  }

  // 📊 Analyze transcript with GPT
analyzeBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const transcript = transcriptBox.value.trim();

  if (!apiKey || !transcript || transcript.startsWith("Transcript not found")) {
    alert("Please enter your API key and wait for the transcript to load.");
    return;
  }

  chrome.storage.sync.set({ apiKey });
  responseBox.innerHTML = "Analyzing with GPT-4o...";

  const prompt = `You are a helpful AI assistant.

Here is a full transcript of a YouTube video.

Please respond using raw HTML formatting only, without Markdown.

Instructions:
- Start with a <strong>Summary:</strong> followed by a short paragraph.
- Then use a <ul> list with 3–5 <li> takeaways.
- Do NOT wrap the entire output in <html> or <body> tags.
- Do NOT use triple backticks.
- This will be injected directly as innerHTML.

Transcript:
${transcript}`;

  const messages = [
    { role: "system", content: "You summarize YouTube videos helpfully." },
    { role: "user", content: prompt }
  ];

  const reply = await sendToGPT(messages, apiKey);
  const cleaned = reply.replace(/```(?:html)?|```/g, "").trim();
  responseBox.innerHTML = cleaned;
});


// Update the keydown event to use the new function.
chatInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    await handleChatSend();
  }
});

// Attach click event listener for the Ask button.
document.getElementById("chatSend").addEventListener("click", async () => {
  await handleChatSend();
});

  // 🧠 Load everything on DOM ready
  getVideoId((videoId) => {
    if (videoId) {
      loadTranscript(videoId);
    } else {
      transcriptBox.value = "❌ Could not detect YouTube video ID.";
    }
  });
});
