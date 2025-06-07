let Module;
let whisperReady = false;

export async function createWhisper({ wasmPath, modelPath }) {
  if (whisperReady) return { transcribe };

  const script = document.createElement('script');
  script.src = wasmPath.replace(/\.wasm$/, ".js");

  await new Promise((resolve) => {
    script.onload = () => {
      window.Module = {
        locateFile: (file) => wasmPath.replace(/main\.wasm$/, file),
        onRuntimeInitialized: resolve
      };
    };
    document.body.appendChild(script);
  });

  const modelArrayBuffer = await fetch(modelPath).then(res => res.arrayBuffer());
  const modelPtr = Module._malloc(modelArrayBuffer.byteLength);
  const modelView = new Uint8Array(Module.HEAPU8.buffer, modelPtr, modelArrayBuffer.byteLength);
  modelView.set(new Uint8Array(modelArrayBuffer));

  Module.ccall('whisper_init_model', 'number', ['number', 'number'], [modelPtr, modelArrayBuffer.byteLength]);

  whisperReady = true;

  return { transcribe };
}

async function transcribe(audioBuffer) {
  const ptr = Module._malloc(audioBuffer.byteLength);
  Module.HEAPU8.set(new Uint8Array(audioBuffer), ptr);

  const resultPtr = Module.ccall('whisper_transcribe', 'number', ['number', 'number'], [ptr, audioBuffer.byteLength]);
  const transcript = Module.UTF8ToString(resultPtr);

  Module._free(ptr);
  return { text: transcript };
}
