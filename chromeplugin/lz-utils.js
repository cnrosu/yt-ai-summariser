function safeDecompressFromBase64(str) {
  if (!str) return null;
  try {
    return LZString.decompressFromBase64(str);
  } catch (err) {
    console.error('Failed to decompress from Base64', err);
    return null;
  }
}

function safeDecompressFromUTF16(str) {
  if (!str) return null;
  try {
    return LZString.decompressFromUTF16(str);
  } catch (err) {
    console.error('Failed to decompress from UTF16', err);
    return null;
  }
}
