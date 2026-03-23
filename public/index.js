const nodes = {
  badge: document.querySelector("#preflight-badge"),
  checks: document.querySelector("#preflight-checks"),
  nextSteps: document.querySelector("#preflight-next-steps"),
  refresh: document.querySelector("#preflight-refresh"),
  summary: document.querySelector("#preflight-summary")
};

function setBadge(status, label) {
  if (!nodes.badge) {
    return;
  }

  nodes.badge.textContent = label;
  nodes.badge.className = "landing-status-badge";
  nodes.badge.classList.add(`is-${status}`);
}

function setSummary(message) {
  if (nodes.summary) {
    nodes.summary.textContent = message;
  }
}

function renderChecks(checks) {
  if (!nodes.checks) {
    return;
  }

  nodes.checks.textContent = "";
  for (const check of checks || []) {
    const article = document.createElement("article");
    article.className = `preflight-card is-${check.severity || "warning"}`;

    const label = document.createElement("p");
    label.className = "preflight-card-label";
    label.textContent = check.label || "Check";

    const detail = document.createElement("p");
    detail.className = "preflight-card-detail";
    detail.textContent = check.detail || "";

    article.append(label, detail);
    nodes.checks.append(article);
  }
}

function renderNextSteps(steps) {
  if (!nodes.nextSteps) {
    return;
  }

  nodes.nextSteps.textContent = "";
  for (const step of steps || []) {
    const item = document.createElement("li");
    item.textContent = step;
    nodes.nextSteps.append(item);
  }
}

async function loadPreflight() {
  setBadge("loading", "Checking");
  setSummary("Running a local Dextunnel preflight...");

  try {
    const response = await fetch("/api/preflight?warmup=1", {
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Preflight returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const status = payload.status || "warning";
    setBadge(status, status === "ready" ? "Ready" : status === "error" ? "Needs attention" : "Almost there");
    setSummary(payload.summary || "Preflight complete.");
    renderChecks(payload.checks || []);
    renderNextSteps(payload.nextSteps || []);
  } catch (error) {
    setBadge("error", "Unavailable");
    setSummary(String(error?.message || error || "Failed to load the Dextunnel preflight."));
    renderChecks([
      {
        detail: "Try reloading this page or run npm run doctor in the repo root.",
        label: "Preflight",
        severity: "error"
      }
    ]);
  }
}

nodes.refresh?.addEventListener("click", () => {
  void loadPreflight();
});

void loadPreflight();
