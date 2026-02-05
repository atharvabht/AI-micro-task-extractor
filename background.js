let latestPageText = "";

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PAGE_TEXT") {
    latestPageText = message.payload;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TEXT") {
    sendResponse({ text: latestPageText });
  }
});
