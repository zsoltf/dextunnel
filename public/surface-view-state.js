export function createSurfaceViewState({
  defaults = {},
  scopeId = "",
  surface = "surface",
  storage = globalThis?.localStorage
} = {}) {
  const normalizedSurface = String(surface || "surface").trim().toLowerCase() || "surface";
  const normalizedScope = String(scopeId || "").trim() || "default";

  function key(kind, suffix = "") {
    return `dextunnel:view:${normalizedSurface}:${normalizedScope}:${kind}${suffix ? `:${suffix}` : ""}`;
  }

  function readJson(storageKey, fallback) {
    if (!storage) {
      return fallback;
    }

    try {
      const raw = storage.getItem(storageKey);
      if (!raw) {
        return fallback;
      }
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(storageKey, value) {
    if (!storage) {
      return;
    }

    try {
      storage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Best effort only.
    }
  }

  return {
    loadExpansionMode(threadId = "none") {
      const parsed = readJson(key("expansion-mode", String(threadId || "none")), defaults.expansionMode || "compact");
      return parsed === "expanded" ? "expanded" : "compact";
    },
    loadSidebarMode() {
      const parsed = readJson(key("sidebar-mode"), defaults.sidebarMode || "expanded");
      return parsed === "collapsed" ? "collapsed" : "expanded";
    },
    loadExpandedSections(threadId = "none") {
      const parsed = readJson(key("expanded", String(threadId || "none")), []);
      return Array.isArray(parsed)
        ? parsed.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
    },
    loadFilters() {
      const parsed = readJson(key("filters"), defaults.filters || {});
      if (!parsed || typeof parsed !== "object") {
        return { ...(defaults.filters || {}) };
      }

      const next = { ...(defaults.filters || {}) };
      for (const [name, fallback] of Object.entries(defaults.filters || {})) {
        next[name] = typeof parsed[name] === "boolean" ? parsed[name] : fallback;
      }
      return next;
    },
    saveExpandedSections(threadId = "none", keys = []) {
      writeJson(
        key("expanded", String(threadId || "none")),
        [...new Set(keys.map((value) => String(value || "").trim()).filter(Boolean))]
      );
    },
    saveExpansionMode(threadId = "none", mode = "compact") {
      writeJson(key("expansion-mode", String(threadId || "none")), mode === "expanded" ? "expanded" : "compact");
    },
    saveSidebarMode(mode = "expanded") {
      writeJson(key("sidebar-mode"), mode === "collapsed" ? "collapsed" : "expanded");
    },
    saveFilters(filters = {}) {
      const next = {};
      for (const [name, fallback] of Object.entries(defaults.filters || {})) {
        next[name] = typeof filters[name] === "boolean" ? filters[name] : fallback;
      }
      writeJson(key("filters"), next);
    }
  };
}
