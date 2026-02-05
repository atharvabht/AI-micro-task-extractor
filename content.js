function getVisibleText() {
  const allowedTags = ["P", "LI", "ARTICLE", "SECTION", "DIV"];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (!allowedTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script,style,noscript")) return NodeFilter.FILTER_REJECT;

        const text = node.textContent.trim();
        if (text.length < 50) return NodeFilter.FILTER_REJECT;

        const codeRatio = (text.match(/[{}();]/g) || []).length / text.length;
        if (codeRatio > 0.05) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let text = "";
  let node;
  while ((node = walker.nextNode())) {
    text += node.textContent.trim() + ". ";
  }

  return text.slice(0, 3000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "EXTRACT_TEXT") {
    sendResponse({ text: getVisibleText() });
  }
});
