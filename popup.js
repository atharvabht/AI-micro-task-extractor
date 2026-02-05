// ---------- State management ----------
let lastDeletedTask = null;
let undoTimeout = null;
let cooldownTimer = null;
const COOLDOWN_DURATION = 10000; // 10 seconds

// ---------- Storage helpers ----------
function loadTasks(cb) {
  chrome.storage.local.get(["tasks"], r => cb(r.tasks || []));
}

function saveTasks(tasks) {
  chrome.storage.local.set({ tasks });
}

function loadApiKey(cb) {
  chrome.storage.local.get(["hf_api_key"], r => cb(r.hf_api_key || ""));
}

function saveApiKey(key) {
  chrome.storage.local.set({ hf_api_key: key });
}

function updateAnalytics(type) {
  chrome.storage.local.get(["analytics"], r => {
    const analytics = r.analytics || { manual: 0, ai: 0, completed: 0, deleted: 0 };
    if (analytics[type] !== undefined) analytics[type]++;
    chrome.storage.local.set({ analytics });
  });
}

// ---------- UI Helpers ----------
function showStatus(msg, type = "success") {
  const status = document.getElementById("statusMessage");
  status.textContent = msg;
  status.className = `status-message show ${type}`;
  setTimeout(() => status.classList.remove("show"), 3000);
}

function showToast(msg, onUndo) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  const undoBtn = document.getElementById("undoBtn");

  toastMsg.textContent = msg;
  toast.classList.add("show");

  undoBtn.onclick = () => {
    onUndo();
    toast.classList.remove("show");
    clearTimeout(undoTimeout);
  };

  if (undoTimeout) clearTimeout(undoTimeout);
  undoTimeout = setTimeout(() => toast.classList.remove("show"), 5000);
}

function renderTasks(tasks) {
  const ul = document.getElementById("tasks");
  ul.innerHTML = "";

  if (tasks.length === 0) {
    ul.innerHTML = `
      <li class="no-tasks">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.3;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
        <h2>No Tasks</h2>
        <p>Extract tasks or add one manually.</p>
      </li>
    `;
    updateTaskStats([]);
    return;
  }

  tasks.forEach((task, index) => {
    const li = document.createElement("li");
    li.className = "task";
    if (task.done) li.classList.add("done");
    if (/(today|tomorrow|deadline|by\s+\w+|\d{1,2}\/\d{1,2})/i.test(task.text)) li.classList.add("deadline");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.onchange = () => {
      task.done = checkbox.checked;
      if (task.done) updateAnalytics("completed");
      saveTasks(tasks);
      renderTasks(tasks);
    };

    const span = document.createElement("span");
    span.textContent = task.text;

    const del = document.createElement("div");
    del.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    del.className = "delete";
    del.onclick = () => {
      lastDeletedTask = { ...task, index };
      tasks.splice(index, 1);
      saveTasks(tasks);
      renderTasks(tasks);
      updateAnalytics("deleted");
      showToast("Task deleted", () => {
        tasks.splice(lastDeletedTask.index, 0, { text: lastDeletedTask.text, done: lastDeletedTask.done });
        saveTasks(tasks);
        renderTasks(tasks);
      });
    };

    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(del);
    ul.appendChild(li);
  });

  updateTaskStats(tasks);
}

function updateTaskStats(tasks) {
  const stats = document.getElementById("taskStats");
  const remaining = tasks.filter(t => !t.done).length;
  stats.textContent = `${remaining} task${remaining === 1 ? "" : "s"} remaining`;
}

// ---------- AI Logic ----------
async function extractTasksWithAI(text, apiKey) {
  const prompt = `Extract up to 5 clear, actionable tasks from this text. Return each task on a new line started with a dash:\n${text}`;

  try {
    const res = await fetch("https://api-inference.huggingface.co/models/google/flan-t5-base", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: prompt })
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error("Invalid API Key");
      if (res.status === 503) throw new Error("AI Model is loading. Try again in a few seconds.");
      throw new Error(`API request failed (${res.status})`);
    }

    const data = await res.json();
    if (!data || !data[0] || !data[0].generated_text) return [];

    let rawOutput = data[0].generated_text;
    if (rawOutput.includes("Inputs:")) {
      rawOutput = rawOutput.split("Inputs:")[0];
    }

    return rawOutput
      .split("\n")
      .map(t => t.replace(/^[-•*]\s*/, "").trim())
      .filter(t => t.length > 5 && t.length < 200);
  } catch (err) {
    if (err.name === 'TypeError') throw new Error("Network error. Check your connection.");
    throw err;
  }
}

// ---------- Initialization ----------
document.addEventListener("DOMContentLoaded", () => {
  const addBtn = document.getElementById("addTask");
  const extractBtn = document.getElementById("extract");
  const input = document.getElementById("manualTask");
  const apiKeyInput = document.getElementById("hfApiKey");
  const saveKeyBtn = document.getElementById("saveKeyBtn");
  const loader = document.getElementById("extractionLoader");
  const btnText = extractBtn.querySelector(".btn-text");
  const btnSubtext = extractBtn.querySelector(".btn-subtext");

  loadTasks(renderTasks);
  loadApiKey(key => {
    if (key) {
      apiKeyInput.value = key;
      apiKeyInput.placeholder = "API key saved ✓";
    }
  });

  saveKeyBtn.onclick = () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    saveApiKey(key);
    showStatus("API key saved successfully!", "success");
    apiKeyInput.placeholder = "API key saved ✓";
  };

  const addTaskAction = () => {
    const text = input.value.trim();
    if (!text) return;

    loadTasks(tasks => {
      const isDuplicate = tasks.some(t => t.text.trim().toLowerCase() === text.toLowerCase());
      if (isDuplicate) {
        showStatus("Task already exists!", "error");
        return;
      }
      tasks.push({ text, done: false });
      saveTasks(tasks);
      renderTasks(tasks);
      updateAnalytics("manual");
      input.value = "";
    });
  };

  addBtn.onclick = addTaskAction;
  input.onkeypress = e => { if (e.key === "Enter") addTaskAction(); };

  async function startExtraction() {
    if (extractBtn.disabled) return;

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus("Please enter an API key first", "error");
      return;
    }

    extractBtn.disabled = true;
    loader.style.display = "block";
    btnText.textContent = "Extracting...";

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("No active tab found");

      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });

      chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_TEXT" }, async res => {
        if (chrome.runtime.lastError) {
          showStatus("Cannot access this page", "error");
          resetBtn();
          return;
        }

        if (!res?.text) {
          showStatus("No readable content found", "error");
          resetBtn();
          return;
        }

        try {
          const aiTasks = await extractTasksWithAI(res.text, apiKey);

          if (aiTasks.length === 0) {
            showStatus("No tasks found in content", "error");
            resetBtn();
            return;
          }

          loadTasks(existing => {
            let addedCount = 0;
            aiTasks.forEach(t => {
              const cleanedTask = t.trim();
              const isDuplicate = existing.some(e => e.text.trim().toLowerCase() === cleanedTask.toLowerCase());

              if (!isDuplicate && addedCount < 5) {
                existing.push({ text: cleanedTask, done: false });
                addedCount++;
                updateAnalytics("ai");
              }
            });

            if (addedCount > 0) {
              saveTasks(existing);
              renderTasks(existing);
              showStatus(`Added ${addedCount} tasks!`, "success");
              startCooldown();
            } else {
              showStatus("All tasks already exist", "error");
              resetBtn();
            }
          });
        } catch (err) {
          showStatus(err.message, "error");
          resetBtn();
        }
      });
    } catch (e) {
      showStatus(e.message || "Extraction failed", "error");
      resetBtn();
    }
  }

  function startCooldown() {
    extractBtn.disabled = true;
    extractBtn.classList.add("cooldown");
    loader.style.display = "none";

    let secondsLeft = COOLDOWN_DURATION / 1000;
    btnText.textContent = `Wait ${secondsLeft}s`;

    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(cooldownTimer);
        resetBtn();
      } else {
        btnText.textContent = `Wait ${secondsLeft}s`;
      }
    }, 1000);
  }

  extractBtn.onclick = startExtraction;

  document.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      startExtraction();
    }
  };

  function resetBtn() {
    clearInterval(cooldownTimer);
    extractBtn.disabled = false;
    extractBtn.classList.remove("cooldown");
    loader.style.display = "none";
    btnText.textContent = "Extract from Page";
  }
});

